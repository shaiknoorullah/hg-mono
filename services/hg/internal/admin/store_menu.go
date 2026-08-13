package admin

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// menuCategoryRow is the projection for a menu_category row.
type menuCategoryRow struct {
	ID           string
	RestaurantID string
	Name         string
	Description  *string
	SortOrder    int
	IsActive     bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// menuItemRow is the projection for a menu_item row with its version data.
type menuItemRow struct {
	ID                string
	RestaurantID      string
	CategoryID        string
	PriceCents        int64
	Currency          string
	AvailabilityState string
	TaxCategory       string
	SortOrder         int
	CreatedAt         time.Time
	UpdatedAt         time.Time
	// live version fields (nullable)
	LiveVersionID           *string
	LiveVersionName         *string
	LiveVersionDescription  *string
	LiveVersionDietaryTags  []string
	LiveVersionAllergenTags []string
	LiveVersionReviewStatus *string
	LiveVersionReviewedAt   *time.Time
	// pending version fields (nullable)
	PendingVersionID           *string
	PendingVersionName         *string
	PendingVersionDescription  *string
	PendingVersionReviewStatus *string
}

// menuItemVersionRow is the projection for menu_item_version queue listing.
type menuItemVersionRow struct {
	ID                  string
	MenuItemID          string
	RestaurantID        string
	Version             int
	Name                string
	Description         *string
	DietaryTags         []string
	AllergenTags        []string
	ReviewStatus        string
	RejectionReasonCode *string
	ReviewNote          *string
	SubmittedAt         *time.Time
	ReviewedBy          *string
	ReviewedAt          *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// ErrCategoryNameTaken is returned when a duplicate category name is detected.
var ErrCategoryNameTaken = errors.New("admin: category name taken")

// ErrItemDeleted is returned when the menu_item has been soft-deleted.
var ErrItemDeleted = errors.New("admin: item deleted")

// CreateMenuCategoryOnBehalf inserts a new menu_category for the given restaurant
// on behalf of an admin (A-19). The restaurant must exist (returns ErrNotFound
// otherwise). Duplicate name within the same restaurant returns ErrCategoryNameTaken.
func (r *Repo) CreateMenuCategoryOnBehalf(ctx context.Context, actor auditActor, restaurantID, name string, description *string, sortOrder int) (menuCategoryRow, error) {
	var out menuCategoryRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// Verify restaurant exists.
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM restaurant WHERE id=$1)`, restaurantID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}

		const ins = `
INSERT INTO menu_category (restaurant_id, name, description, sort_order, is_active)
VALUES ($1, $2, $3, $4, true)
RETURNING id, restaurant_id, name, description, sort_order, is_active, created_at, updated_at`
		if err := tx.QueryRow(ctx, ins, restaurantID, name, description, sortOrder).Scan(
			&out.ID, &out.RestaurantID, &out.Name, &out.Description,
			&out.SortOrder, &out.IsActive, &out.CreatedAt, &out.UpdatedAt,
		); err != nil {
			// Postgres unique-violation code 23505.
			if isUniqueViolation(err) {
				return ErrCategoryNameTaken
			}
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "menu.create_on_behalf",
			subjectType: "MENU_CATEGORY",
			subjectID:   &out.ID,
			outcome:     "SUCCESS",
			after:       map[string]any{"restaurant_id": restaurantID, "name": name},
		})
	})
	return out, err
}

// menuItemCreate carries every validated field for an admin-on-behalf item
// create. Grouping them keeps the store signature stable as the contract's
// MenuItemInput grows, and makes it obvious that every value here was validated
// at the handler before it reaches a typed column or enum cast.
type menuItemCreate struct {
	restaurantID      string
	categoryID        string
	priceCents        int64
	name              string
	description       *string
	ingredientsText   *string
	dietaryTags       []string
	allergenTags      []string
	allergensDeclared *bool
	imageObjectID     *string
	prepMinutes       *int
	sortOrder         *int
	taxCategory       string
}

// CreateMenuItemOnBehalf inserts a new menu_item + a version pre-approved by the
// admin (A-19: reviewer == author, so it is immediately APPROVED with live_version_id
// set). The restaurant and category must exist. Price validation (50..50000 cents)
// and enum/length validation are done at the handler layer.
func (r *Repo) CreateMenuItemOnBehalf(
	ctx context.Context, actor auditActor, in menuItemCreate,
) (menuItemRow, error) {
	restaurantID := in.restaurantID
	var out menuItemRow
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// Verify restaurant exists.
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM restaurant WHERE id=$1)`, restaurantID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}

		// Verify category belongs to restaurant.
		var catExists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM menu_category WHERE id=$1 AND restaurant_id=$2 AND deleted_at IS NULL)`,
			in.categoryID, restaurantID,
		).Scan(&catExists); err != nil {
			return err
		}
		if !catExists {
			return ErrNotFound
		}

		taxCategory := in.taxCategory
		if taxCategory == "" {
			taxCategory = "PREPARED_FOOD"
		}
		sortOrder := 0
		if in.sortOrder != nil {
			sortOrder = *in.sortOrder
		}

		// Insert the menu_item (no live/pending version yet).
		var itemID string
		const insItem = `
INSERT INTO menu_item (restaurant_id, category_id, price_cents, currency, availability_state, tax_category, prep_minutes, sort_order)
VALUES ($1, $2, $3, 'CAD', 'AVAILABLE', $4::tax_category, $5, $6)
RETURNING id`
		if err := tx.QueryRow(ctx, insItem, restaurantID, in.categoryID, in.priceCents, taxCategory, in.prepMinutes, sortOrder).Scan(&itemID); err != nil {
			return err
		}

		// Get next version number.
		var versionNo int
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(MAX(version),0)+1 FROM menu_item_version WHERE menu_item_id=$1`, itemID,
		).Scan(&versionNo); err != nil {
			return err
		}

		allergensDeclared := false
		if in.allergensDeclared != nil {
			allergensDeclared = *in.allergensDeclared
		}

		// Insert version as APPROVED (admin creates = auto-approved per A-19).
		var versionID string
		var reviewedBy any
		if actor.staffID != "" {
			reviewedBy = actor.staffID
		}
		const insVer = `
INSERT INTO menu_item_version
  (menu_item_id, restaurant_id, version, name, description, ingredients_text,
   dietary_tags, allergen_tags, allergens_declared, image_object_id,
   review_status, submitted_at, reviewed_by, reviewed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7::dietary_tag[], $8::allergen_tag[], $9, $10::uuid,
        'APPROVED', now(), $11, now())
RETURNING id`
		if err := tx.QueryRow(ctx, insVer,
			itemID, restaurantID, versionNo, in.name, in.description, in.ingredientsText,
			in.dietaryTags, in.allergenTags, allergensDeclared, in.imageObjectID, reviewedBy,
		).Scan(&versionID); err != nil {
			return err
		}

		// Point live_version_id at the new version.
		if _, err := tx.Exec(ctx,
			`UPDATE menu_item SET live_version_id=$1, pending_version_id=NULL WHERE id=$2`,
			versionID, itemID,
		); err != nil {
			return err
		}

		// Read back the full item row.
		const sel = `
SELECT mi.id, mi.restaurant_id, mi.category_id, mi.price_cents, mi.currency::text,
       mi.availability_state::text, mi.tax_category::text, mi.sort_order,
       mi.created_at, mi.updated_at,
       lv.id, lv.name, lv.description, lv.dietary_tags::text[], lv.allergen_tags::text[],
       lv.review_status::text, lv.reviewed_at,
       NULL::uuid, NULL::text, NULL::text, NULL::text
  FROM menu_item mi
  LEFT JOIN menu_item_version lv ON lv.id = mi.live_version_id
 WHERE mi.id=$1`
		if err := tx.QueryRow(ctx, sel, itemID).Scan(
			&out.ID, &out.RestaurantID, &out.CategoryID, &out.PriceCents, &out.Currency,
			&out.AvailabilityState, &out.TaxCategory, &out.SortOrder,
			&out.CreatedAt, &out.UpdatedAt,
			&out.LiveVersionID, &out.LiveVersionName, &out.LiveVersionDescription,
			&out.LiveVersionDietaryTags, &out.LiveVersionAllergenTags,
			&out.LiveVersionReviewStatus, &out.LiveVersionReviewedAt,
			&out.PendingVersionID, &out.PendingVersionName, &out.PendingVersionDescription,
			&out.PendingVersionReviewStatus,
		); err != nil {
			return err
		}

		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "menu.create_on_behalf",
			subjectType: "MENU_ITEM",
			subjectID:   &itemID,
			outcome:     "SUCCESS",
			after:       map[string]any{"restaurant_id": restaurantID, "name": in.name, "price_cents": in.priceCents},
		})
	})
	return out, err
}

// ListMenuReviewQueue returns menu_item_versions in PENDING_REVIEW state, optionally
// filtered by restaurant_id. Keyset-paginated by submitted_at, id.
func (r *Repo) ListMenuReviewQueue(
	ctx context.Context,
	restaurantID *string,
	limit int,
	cursorSubmitted *time.Time, cursorID *string,
) ([]menuItemVersionRow, error) {
	const q = `
SELECT miv.id, miv.menu_item_id, miv.restaurant_id, miv.version, miv.name, miv.description,
       miv.dietary_tags::text[], miv.allergen_tags::text[],
       miv.review_status::text, miv.rejection_reason_code::text,
       miv.review_note, miv.submitted_at, miv.reviewed_by::text, miv.reviewed_at,
       miv.created_at, miv.updated_at
  FROM menu_item_version miv
 WHERE miv.review_status = 'PENDING_REVIEW'
   AND ($1::uuid IS NULL OR miv.restaurant_id = $1)
   AND ($2::timestamptz IS NULL OR (miv.submitted_at, miv.id) > ($2, $3::uuid))
 ORDER BY miv.submitted_at ASC, miv.id ASC
 LIMIT $4`
	rows, err := r.pool.Query(ctx, q, restaurantID, cursorSubmitted, cursorID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []menuItemVersionRow
	for rows.Next() {
		var v menuItemVersionRow
		if err := rows.Scan(
			&v.ID, &v.MenuItemID, &v.RestaurantID, &v.Version, &v.Name, &v.Description,
			&v.DietaryTags, &v.AllergenTags,
			&v.ReviewStatus, &v.RejectionReasonCode,
			&v.ReviewNote, &v.SubmittedAt, &v.ReviewedBy, &v.ReviewedAt,
			&v.CreatedAt, &v.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// decideMenuVersionResult is the return type for DecideMenuVersion.
type decideMenuVersionResult struct {
	ID                  string
	MenuItemID          string
	RestaurantID        string
	Version             int
	Name                string
	Description         *string
	DietaryTags         []string
	AllergenTags        []string
	ReviewStatus        string
	RejectionReasonCode *string
	ReviewNote          *string
	SubmittedAt         *time.Time
	ReviewedBy          *string
	ReviewedAt          *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// DecideMenuVersion approves or rejects a PENDING_REVIEW menu_item_version.
// On APPROVE: sets review_status=APPROVED, advances live_version_id, clears pending_version_id.
// On REJECT: sets review_status=REJECTED with reason_code.
// Returns ErrNotFound if the version does not exist, ErrAlreadyDecided if not PENDING_REVIEW,
// ErrItemDeleted if the menu_item has been soft-deleted.
func (r *Repo) DecideMenuVersion(
	ctx context.Context, actor auditActor,
	versionID, decision string,
	reasonCode *string, reviewNote *string,
) (decideMenuVersionResult, error) {
	var out decideMenuVersionResult
	err := r.inTx(ctx, func(tx pgx.Tx) error {
		// Lock the version row.
		var menuItemID, restaurantID, currentStatus string
		if err := tx.QueryRow(ctx, `
SELECT menu_item_id, restaurant_id, review_status::text
  FROM menu_item_version
 WHERE id=$1
   FOR UPDATE`, versionID,
		).Scan(&menuItemID, &restaurantID, &currentStatus); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}

		if currentStatus != "PENDING_REVIEW" {
			return ErrAlreadyDecided
		}

		// Check menu_item is not deleted.
		var deletedAt *time.Time
		if err := tx.QueryRow(ctx,
			`SELECT deleted_at FROM menu_item WHERE id=$1`, menuItemID,
		).Scan(&deletedAt); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrItemDeleted
			}
			return err
		}
		if deletedAt != nil {
			return ErrItemDeleted
		}

		var reviewedBy any
		if actor.staffID != "" {
			reviewedBy = actor.staffID
		}

		var newStatus string
		switch decision {
		case "APPROVE":
			newStatus = "APPROVED"
		case "REJECT":
			newStatus = "REJECTED"
		}

		// Update the version.
		const updVer = `
UPDATE menu_item_version
   SET review_status=$2::menu_review_status,
       rejection_reason_code=$3::menu_rejection_reason_code,
       review_note=$4,
       reviewed_by=$5,
       reviewed_at=now()
 WHERE id=$1
RETURNING id, menu_item_id, restaurant_id, version, name, description,
          dietary_tags::text[], allergen_tags::text[],
          review_status::text, rejection_reason_code::text,
          review_note, submitted_at, reviewed_by::text, reviewed_at,
          created_at, updated_at`
		if err := tx.QueryRow(ctx, updVer,
			versionID, newStatus, reasonCode, reviewNote, reviewedBy,
		).Scan(
			&out.ID, &out.MenuItemID, &out.RestaurantID, &out.Version, &out.Name, &out.Description,
			&out.DietaryTags, &out.AllergenTags,
			&out.ReviewStatus, &out.RejectionReasonCode,
			&out.ReviewNote, &out.SubmittedAt, &out.ReviewedBy, &out.ReviewedAt,
			&out.CreatedAt, &out.UpdatedAt,
		); err != nil {
			return err
		}

		// If APPROVE: advance live_version_id and clear pending_version_id.
		if decision == "APPROVE" {
			if _, err := tx.Exec(ctx, `
UPDATE menu_item SET live_version_id=$1, pending_version_id=NULL WHERE id=$2`,
				versionID, menuItemID,
			); err != nil {
				return err
			}
		} else {
			// REJECT: clear pending_version_id only.
			if _, err := tx.Exec(ctx, `
UPDATE menu_item SET pending_version_id=NULL WHERE id=$1 AND pending_version_id=$2`,
				menuItemID, versionID,
			); err != nil {
				return err
			}
		}

		reasonStr := ""
		if reasonCode != nil {
			reasonStr = *reasonCode
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "menu_version.decide",
			subjectType: "MENU_ITEM_VERSION",
			subjectID:   &versionID,
			outcome:     "SUCCESS",
			reasonCode:  reasonCode,
			reason:      &reasonStr,
			before:      map[string]any{"review_status": "PENDING_REVIEW"},
			after:       map[string]any{"review_status": newStatus},
		})
	})
	return out, err
}

// isUniqueViolation checks if the error is a PostgreSQL unique constraint violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// pgx wraps pgconn.PgError for Postgres errors.
	type pgErr interface {
		SQLState() string
	}
	var pe pgErr
	if errors.As(err, &pe) {
		return pe.SQLState() == "23505"
	}
	return false
}
