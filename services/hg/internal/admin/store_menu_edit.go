package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrMenuVersionPending is returned when an admin's claim-bearing edit would
// replace a restaurant edit still waiting for review. The admin decides that
// version first (decideMenuVersion); it is never silently discarded.
var ErrMenuVersionPending = errors.New("admin: menu version pending review")

// ErrItemNameRequired is returned when a claim-bearing edit reaches an item that
// has no live version to inherit a name from and the body names none.
var ErrItemNameRequired = errors.New("admin: item name required")

// menuItemUpdate carries every validated field of an admin-on-behalf item
// update. A nil pointer (or nil slice) is a field the body did not carry.
type menuItemUpdate struct {
	restaurantID      string
	itemID            string
	categoryID        *string
	priceCents        *int64
	prepMinutes       *int
	sortOrder         *int
	name              *string
	description       *string
	ingredientsText   *string
	dietaryTags       []string
	allergenTags      []string
	allergensDeclared *bool
	imageObjectID     *string
}

// claimBearing reports whether the update touches a field that lives on a menu
// item version (name, words, tags, allergens, photo) rather than on the item.
func (u menuItemUpdate) claimBearing() bool {
	return u.name != nil || u.description != nil || u.ingredientsText != nil ||
		u.dietaryTags != nil || u.allergenTags != nil || u.allergensDeclared != nil ||
		u.imageObjectID != nil
}

// menuItemFull is a menu item with its live and pending versions, read back
// after a write to render the contract's MenuItemOwnerView.
type menuItemFull struct {
	ID                string
	RestaurantID      string
	CategoryID        string
	PriceCents        int64
	Currency          string
	AvailabilityState string
	OutOfStockUntil   *time.Time
	TaxCategory       string
	PrepMinutes       *int
	SortOrder         int
	Live              *menuItemVersionRow
	Pending           *menuItemVersionRow
}

// UpdateMenuItemOnBehalf applies an admin's edit to a restaurant's menu item
// (updateMenuItemOnBehalf). Operational fields (price, category, prep time, sort
// order) change on the item at once. Claim-bearing fields make a new version
// that is approved on save, with the admin as its reviewer, exactly as an item an
// admin creates is approved on creation; unsent claim-bearing fields carry over
// from the live version. Returns ErrNotFound when the item is not on this
// restaurant's menu, ErrMenuVersionPending when a claim-bearing edit meets a
// restaurant edit waiting for review, ErrUploadNotFound for a photo the admin
// may not use, and restaurant.ErrMenuLocked while the restaurant is suspended
// or banned.
//
// The item already has a live version or never had one; this write neither
// adds nor removes a live item, so it cannot move onboarding and does not
// recompute it. That keeps the restaurant row under a share lock only.
func (r *Repo) UpdateMenuItemOnBehalf(ctx context.Context, actor auditActor, in menuItemUpdate) (menuItemFull, error) {
	var out menuItemFull
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// The restaurant must exist, and its menu must not be locked.
		if err := lockMenuOnBehalf(ctx, tx, in.restaurantID); err != nil {
			return err
		}

		var categoryID string
		var priceCents int64
		var liveVersionID, pendingVersionID *string
		if err := tx.QueryRow(ctx, `
SELECT category_id::text, price_cents, live_version_id::text, pending_version_id::text
  FROM menu_item
 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL
   FOR UPDATE`, in.itemID, in.restaurantID,
		).Scan(&categoryID, &priceCents, &liveVersionID, &pendingVersionID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}

		before := map[string]any{}
		after := map[string]any{}

		if in.claimBearing() {
			// A restaurant's own edit waiting for review is never silently
			// discarded (docs/spec/05-admin.md, A-19): decide it first.
			var waiting bool
			if err := tx.QueryRow(ctx, `
SELECT $2::uuid IS NOT NULL OR EXISTS (
  SELECT 1 FROM menu_item_version
   WHERE menu_item_id = $1 AND review_status = 'PENDING_REVIEW')`,
				in.itemID, pendingVersionID).Scan(&waiting); err != nil {
				return err
			}
			if waiting {
				return ErrMenuVersionPending
			}
			if err := checkMenuImageOnBehalf(ctx, tx, actor, in.restaurantID, in.imageObjectID); err != nil {
				return err
			}
		}

		if in.categoryID != nil && *in.categoryID != categoryID {
			var catExists bool
			if err := tx.QueryRow(ctx,
				`SELECT EXISTS(SELECT 1 FROM menu_category WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL)`,
				*in.categoryID, in.restaurantID,
			).Scan(&catExists); err != nil {
				return err
			}
			if !catExists {
				return ErrNotFound
			}
			before["category_id"], after["category_id"] = categoryID, *in.categoryID
		}
		if in.priceCents != nil && *in.priceCents != priceCents {
			before["price_cents"], after["price_cents"] = priceCents, *in.priceCents
		}
		if in.prepMinutes != nil {
			after["prep_minutes"] = *in.prepMinutes
		}
		if in.sortOrder != nil {
			after["sort_order"] = *in.sortOrder
		}

		if _, err := tx.Exec(ctx, `
UPDATE menu_item
   SET category_id  = COALESCE($2::uuid, category_id),
       price_cents  = COALESCE($3, price_cents),
       prep_minutes = COALESCE($4, prep_minutes),
       sort_order   = COALESCE($5, sort_order)
 WHERE id = $1`,
			in.itemID, in.categoryID, in.priceCents, in.prepMinutes, in.sortOrder); err != nil {
			return err
		}

		if in.claimBearing() {
			versionID, versionNo, err := insertApprovedVersionOnBehalf(ctx, tx, actor, in, liveVersionID)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx,
				`UPDATE menu_item SET live_version_id=$1, pending_version_id=NULL WHERE id=$2`,
				versionID, in.itemID); err != nil {
				return err
			}
			if liveVersionID != nil {
				before["live_version_id"] = *liveVersionID
			}
			after["live_version_id"] = versionID
			after["version"] = versionNo
		}

		full, err := loadMenuItemFull(ctx, tx, in.itemID)
		if err != nil {
			return err
		}
		out = full

		after["restaurant_id"] = in.restaurantID
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "menu.update_on_behalf",
			subjectType: "MENU_ITEM",
			subjectID:   &in.itemID,
			outcome:     "SUCCESS",
			before:      before,
			after:       after,
		})
	})
	return out, err
}

// insertApprovedVersionOnBehalf writes the next version of the item, approved
// with the admin as its reviewer: the sent claim-bearing fields over the live
// version's. It returns the new version's id and number.
func insertApprovedVersionOnBehalf(ctx context.Context, tx pgx.Tx, actor auditActor, in menuItemUpdate, liveVersionID *string) (string, int, error) {
	var name string
	var description, ingredientsText, imageObjectID *string
	dietaryTags, allergenTags := []string{}, []string{}
	allergensDeclared := false
	if liveVersionID != nil {
		if err := tx.QueryRow(ctx, `
SELECT name, description, ingredients_text, dietary_tags::text[], allergen_tags::text[],
       allergens_declared, image_object_id::text
  FROM menu_item_version WHERE id = $1`, *liveVersionID,
		).Scan(&name, &description, &ingredientsText, &dietaryTags, &allergenTags,
			&allergensDeclared, &imageObjectID); err != nil {
			return "", 0, err
		}
	}
	if in.name != nil {
		name = *in.name
	}
	if name == "" {
		return "", 0, ErrItemNameRequired
	}
	if in.description != nil {
		description = in.description
	}
	if in.ingredientsText != nil {
		ingredientsText = in.ingredientsText
	}
	if in.dietaryTags != nil {
		dietaryTags = in.dietaryTags
	}
	if in.allergenTags != nil {
		allergenTags = in.allergenTags
	}
	if in.allergensDeclared != nil {
		allergensDeclared = *in.allergensDeclared
	}
	if in.imageObjectID != nil {
		imageObjectID = in.imageObjectID
	}

	var versionNo int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(MAX(version),0)+1 FROM menu_item_version WHERE menu_item_id=$1`, in.itemID,
	).Scan(&versionNo); err != nil {
		return "", 0, err
	}

	var reviewedBy any
	if actor.staffID != "" {
		reviewedBy = actor.staffID
	}
	var versionID string
	if err := tx.QueryRow(ctx, `
INSERT INTO menu_item_version
  (menu_item_id, restaurant_id, version, name, description, ingredients_text,
   dietary_tags, allergen_tags, allergens_declared, image_object_id,
   review_status, submitted_at, reviewed_by, reviewed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7::dietary_tag[], $8::allergen_tag[], $9, $10::uuid,
        'APPROVED', now(), $11, now())
RETURNING id`,
		in.itemID, in.restaurantID, versionNo, name, description, ingredientsText,
		dietaryTags, allergenTags, allergensDeclared, imageObjectID, reviewedBy,
	).Scan(&versionID); err != nil {
		return "", 0, err
	}
	return versionID, versionNo, nil
}

// DeleteMenuItemOnBehalf removes a restaurant's menu item for an admin
// (deleteMenuItemOnBehalf): a soft delete, so the item leaves every customer
// read and the restaurant's own menu at once while order lines keep their own
// snapshot. A version still waiting for review is withdrawn, and deciding it
// afterwards is ITEM_DELETED. Returns ErrNotFound when the item is not on this
// restaurant's menu or is already removed, and restaurant.ErrMenuLocked while the
// restaurant is suspended or banned.
func (r *Repo) DeleteMenuItemOnBehalf(ctx context.Context, actor auditActor, restaurantID, itemID string) error {
	return r.inTx(ctx, func(tx pgx.Tx) error {
		// The restaurant must exist, and its menu must not be locked.
		if err := lockMenuOnBehalf(ctx, tx, restaurantID); err != nil {
			return err
		}

		var pendingVersionID *string
		if err := tx.QueryRow(ctx, `
SELECT pending_version_id::text FROM menu_item
 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL
   FOR UPDATE`,
			itemID, restaurantID).Scan(&pendingVersionID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE menu_item SET deleted_at = now(), pending_version_id = NULL WHERE id = $1`,
			itemID); err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
UPDATE menu_item_version SET review_status = 'WITHDRAWN'
 WHERE menu_item_id = $1 AND review_status IN ('PENDING_REVIEW', 'DRAFT')`, itemID)
		if err != nil {
			return err
		}

		before := map[string]any{"deleted_at": nil}
		if pendingVersionID != nil {
			before["pending_version_id"] = *pendingVersionID
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "menu.delete_on_behalf",
			subjectType: "MENU_ITEM",
			subjectID:   &itemID,
			outcome:     "SUCCESS",
			before:      before,
			after: map[string]any{
				"restaurant_id":      restaurantID,
				"deleted":            true,
				"versions_withdrawn": tag.RowsAffected(),
			},
		})
	})
}

// loadMenuItemFull reads an item and its live and pending versions inside tx.
func loadMenuItemFull(ctx context.Context, tx pgx.Tx, itemID string) (menuItemFull, error) {
	var out menuItemFull
	var liveID, pendingID *string
	if err := tx.QueryRow(ctx, `
SELECT id::text, restaurant_id::text, category_id::text, price_cents, currency::text,
       availability_state::text, out_of_stock_until, tax_category::text, prep_minutes,
       sort_order, live_version_id::text, pending_version_id::text
  FROM menu_item WHERE id = $1`, itemID,
	).Scan(&out.ID, &out.RestaurantID, &out.CategoryID, &out.PriceCents, &out.Currency,
		&out.AvailabilityState, &out.OutOfStockUntil, &out.TaxCategory, &out.PrepMinutes,
		&out.SortOrder, &liveID, &pendingID); err != nil {
		return out, err
	}
	var err error
	if out.Live, err = loadMenuItemVersion(ctx, tx, liveID); err != nil {
		return out, err
	}
	if out.Pending, err = loadMenuItemVersion(ctx, tx, pendingID); err != nil {
		return out, err
	}
	return out, nil
}

// loadMenuItemVersion reads one version, or nil for a nil id.
func loadMenuItemVersion(ctx context.Context, tx pgx.Tx, id *string) (*menuItemVersionRow, error) {
	if id == nil {
		return nil, nil
	}
	var v menuItemVersionRow
	if err := tx.QueryRow(ctx, `
SELECT id::text, menu_item_id::text, restaurant_id::text, version, name, description,
       ingredients_text, dietary_tags::text[], allergen_tags::text[],
       review_status::text, rejection_reason_code::text, review_note,
       submitted_at, reviewed_by::text, reviewed_at, created_at, updated_at,
       image_object_id::text
  FROM menu_item_version WHERE id = $1`, *id,
	).Scan(&v.ID, &v.MenuItemID, &v.RestaurantID, &v.Version, &v.Name, &v.Description,
		&v.IngredientsText, &v.DietaryTags, &v.AllergenTags,
		&v.ReviewStatus, &v.RejectionReasonCode, &v.ReviewNote,
		&v.SubmittedAt, &v.ReviewedBy, &v.ReviewedAt, &v.CreatedAt, &v.UpdatedAt,
		&v.ImageObjectID); err != nil {
		return nil, err
	}
	return &v, nil
}
