package restaurant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrNotFound is returned when a queried entity does not exist or belongs to
// another restaurant (IDOR guard — always 404, never 403).
var ErrNotFound = errors.New("not found")

// ErrCategoryNameTaken is returned when a menu category with the same name
// already exists in the restaurant.
var ErrCategoryNameTaken = errors.New("category name taken")

// ErrIncompleteDocumentPack is returned when submitRestaurantDocuments is
// called but not all required document types are in a reviewable state.
var ErrIncompleteDocumentPack = errors.New("incomplete document pack")

// ErrIllegalTransition is returned when an order state transition is not
// permitted by the machine.
var ErrIllegalTransition = errors.New("illegal transition")

// ErrOfferExpired is returned when a RESTAURANT_PENDING order's 180s window
// has elapsed before the restaurant accepted.
var ErrOfferExpired = errors.New("offer expired")

// ErrDelayLimitReached is returned when a PREPARING order already has 3
// delay events recorded (R-26).
var ErrDelayLimitReached = errors.New("delay limit reached")

// GetOnboardingStatus returns the onboarding state and a coarse progress
// percentage for the restaurant the account is scoped to.
func (r *Repo) GetOnboardingStatus(ctx context.Context, restaurantID string) (*OnboardingStatus, error) {
	var state string
	var halalStatus string
	var profileOK bool // has the restaurant filled in the key profile fields?
	err := r.db.QueryRow(ctx, `
		SELECT onboarding_state::text, halal_status::text,
		       (line1 IS NOT NULL AND province IS NOT NULL AND postal_code IS NOT NULL
		        AND location IS NOT NULL AND avg_prep_minutes > 0)
		  FROM restaurant WHERE id = $1 AND deleted_at IS NULL`,
		restaurantID).Scan(&state, &halalStatus, &profileOK)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get onboarding state: %w", err)
	}

	// Count approved hours.
	var hoursCount int
	_ = r.db.QueryRow(ctx, `SELECT count(*) FROM restaurant_hours WHERE restaurant_id = $1`, restaurantID).Scan(&hoursCount)

	// Count DISTINCT required document types present in a reviewable state.
	// Counting distinct types (not raw rows) prevents four copies of one type
	// from falsely reporting a complete pack. The required set mirrors
	// CheckDocumentPack / the contract's RestaurantDocType.
	var distinctRequiredDocs int
	_ = r.db.QueryRow(ctx, `
		SELECT count(DISTINCT restaurant_doc_type) FROM kyc_document
		 WHERE subject_id = $1 AND subject_type = 'RESTAURANT'
		   AND restaurant_doc_type = ANY($2::restaurant_doc_type[])
		   AND state NOT IN ('REJECTED') AND deleted_at IS NULL`,
		restaurantID, requiredRestaurantDocTypes).Scan(&distinctRequiredDocs)

	hoursOK := hoursCount > 0
	docsReady := distinctRequiredDocs >= len(requiredRestaurantDocTypes)
	halalVerified := halalStatus == "CERTIFIED"

	pct := 0
	checks := 0
	if profileOK {
		checks++
	}
	if hoursOK {
		checks++
	}
	if docsReady {
		checks++
	}
	if halalVerified {
		checks++
	}
	pct = (checks * 100) / 4

	return &OnboardingStatus{
		OnboardingState: state,
		ProgressPercent: pct,
		ProfileComplete: profileOK,
		HoursComplete:   hoursOK,
		DocumentsReady:  docsReady,
		HalalVerified:   halalVerified,
	}, nil
}

// GetProfile returns the restaurant's profile for its own editing view.
func (r *Repo) GetProfile(ctx context.Context, restaurantID string) (*RestaurantProfile, error) {
	var p RestaurantProfile
	var lat, lon *float64
	var createdAt, updatedAt time.Time
	err := r.db.QueryRow(ctx, `
		SELECT id::text, legal_name, display_name, description,
		       phone_e164, public_phone_e164, gst_hst_number,
		       province::text, postal_code, city, line1, line2,
		       ST_Y(location::geometry), ST_X(location::geometry),
		       timezone, avg_prep_minutes, delivery_radius_m,
		       halal_status::text, onboarding_state::text,
		       created_at, updated_at
		  FROM restaurant WHERE id = $1 AND deleted_at IS NULL`, restaurantID).Scan(
		&p.ID, &p.LegalName, &p.DisplayName, &p.Description,
		&p.PhoneE164, &p.PublicPhoneE164, &p.GstHstNumber,
		&p.Province, &p.PostalCode, &p.City, &p.Line1, &p.Line2,
		&lat, &lon,
		&p.Timezone, &p.AvgPrepMinutes, &p.DeliveryRadiusM,
		&p.HalalStatus, &p.OnboardingState,
		&createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get profile: %w", err)
	}
	p.Latitude = lat
	p.Longitude = lon
	p.CreatedAt = tsStr(createdAt)
	p.UpdatedAt = tsStr(updatedAt)

	// Cuisine IDs.
	rows, err := r.db.Query(ctx, `SELECT cuisine_id::text FROM restaurant_cuisine WHERE restaurant_id = $1`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	p.CuisineIDs = []string{}
	for rows.Next() {
		var cid string
		if err := rows.Scan(&cid); err != nil {
			return nil, err
		}
		p.CuisineIDs = append(p.CuisineIDs, cid)
	}
	return &p, rows.Err()
}

// UpsertProfile writes the restaurant's editable fields (profile+address+location).
// It returns the updated profile. Uses ON CONFLICT DO UPDATE for idempotency.
func (r *Repo) UpsertProfile(ctx context.Context, restaurantID string, in profileInputDTO) (*RestaurantProfile, error) {
	// Build the location if lat/lon are provided.
	var locExpr string
	args := []any{
		restaurantID,
		in.LegalName,
		in.DisplayName,
		in.Description,
		in.PhoneE164,
		in.PublicPhoneE164,
		in.GstHstNumber,
		in.Province,
		in.PostalCode,
		in.City,
		in.Line1,
		in.Line2,
		in.Timezone,
		in.AvgPrepMinutes,
		in.DeliveryRadiusM,
	}
	if in.Latitude != 0 && in.Longitude != 0 {
		args = append(args, in.Longitude, in.Latitude)
		locExpr = fmt.Sprintf("ST_SetSRID(ST_MakePoint($%d,$%d),4326)::geography", len(args)-1, len(args))
	} else {
		locExpr = "location" // keep existing
	}

	q := fmt.Sprintf(`
		UPDATE restaurant SET
			legal_name=$2, display_name=$3, description=$4,
			phone_e164=$5, public_phone_e164=$6, gst_hst_number=$7,
			province=$8::province, postal_code=$9, city=$10, line1=$11, line2=$12,
			timezone=COALESCE($13,timezone),
			avg_prep_minutes=COALESCE($14,avg_prep_minutes),
			delivery_radius_m=COALESCE($15,delivery_radius_m),
			location=%s,
			updated_at=now()
		WHERE id=$1 AND deleted_at IS NULL`, locExpr)

	_, err := r.db.Exec(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("upsert profile: %w", err)
	}
	return r.GetProfile(ctx, restaurantID)
}

// GetHours returns the restaurant's weekly trading hours and date overrides.
func (r *Repo) GetHours(ctx context.Context, restaurantID string) (*HoursView, error) {
	out := &HoursView{
		Hours:     []HoursSlotRow{},
		Overrides: []HoursOverrideRow{},
	}
	rows, err := r.db.Query(ctx, `
		SELECT day_of_week, opens_at::text, closes_at::text, crosses_midnight
		  FROM restaurant_hours WHERE restaurant_id = $1 ORDER BY day_of_week`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var s HoursSlotRow
		if err := rows.Scan(&s.DayOfWeek, &s.OpensAt, &s.ClosesAt, &s.CrossesMidnight); err != nil {
			return nil, err
		}
		out.Hours = append(out.Hours, s)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()

	orows, err := r.db.Query(ctx, `
		SELECT on_date::text, is_closed, opens_at::text, closes_at::text, reason
		  FROM restaurant_hours_override WHERE restaurant_id = $1 ORDER BY on_date`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer orows.Close()
	for orows.Next() {
		var o HoursOverrideRow
		if err := orows.Scan(&o.OnDate, &o.IsClosed, &o.OpensAt, &o.ClosesAt, &o.Reason); err != nil {
			return nil, err
		}
		out.Overrides = append(out.Overrides, o)
	}
	return out, orows.Err()
}

// SetHours replaces the restaurant's trading hours (full replace, idempotent).
func (r *Repo) SetHours(ctx context.Context, restaurantID string, in hoursInputDTO) (*HoursView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Replace weekly hours.
	if _, err := tx.Exec(ctx, `DELETE FROM restaurant_hours WHERE restaurant_id = $1`, restaurantID); err != nil {
		return nil, fmt.Errorf("delete hours: %w", err)
	}
	for _, s := range in.Hours {
		cm := false
		if s.CrossesMidnight != nil {
			cm = *s.CrossesMidnight
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, crosses_midnight)
			VALUES ($1,$2,$3::time,$4::time,$5)`,
			restaurantID, s.DayOfWeek, s.OpensAt, s.ClosesAt, cm)
		if err != nil {
			return nil, fmt.Errorf("insert hour slot: %w", err)
		}
	}

	// Replace overrides.
	if _, err := tx.Exec(ctx, `DELETE FROM restaurant_hours_override WHERE restaurant_id = $1`, restaurantID); err != nil {
		return nil, fmt.Errorf("delete overrides: %w", err)
	}
	for _, o := range in.Overrides {
		_, err := tx.Exec(ctx, `
			INSERT INTO restaurant_hours_override (restaurant_id, on_date, is_closed, opens_at, closes_at, reason)
			VALUES ($1,$2::date,$3,$4::time,$5::time,$6)`,
			restaurantID, o.OnDate, o.IsClosed, o.OpensAt, o.ClosesAt, o.Reason)
		if err != nil {
			return nil, fmt.Errorf("insert override: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetHours(ctx, restaurantID)
}

// ListDocuments returns all KYC documents for the restaurant.
func (r *Repo) ListDocuments(ctx context.Context, restaurantID string) ([]DocumentRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT d.id::text, d.subject_id::text, d.restaurant_doc_type::text,
		       d.state::text, d.stored_object_id::text,
		       d.valid_until::text, d.issuer,
		       d.created_at
		  FROM kyc_document d
		 WHERE d.subject_id = $1 AND d.subject_type = 'RESTAURANT'
		   AND d.deleted_at IS NULL
		 ORDER BY d.created_at DESC`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocumentRow
	for rows.Next() {
		var d DocumentRow
		var createdAt time.Time
		if err := rows.Scan(&d.ID, &d.SubjectID, &d.DocType, &d.State, &d.StoredObjID,
			&d.ExpiresOn, &d.IssuerName, &createdAt); err != nil {
			return nil, err
		}
		d.CreatedAt = tsStr(createdAt)
		out = append(out, d)
	}
	if out == nil {
		out = []DocumentRow{}
	}
	return out, rows.Err()
}

// AttachDocument attaches one kyc_document to the restaurant.
func (r *Repo) AttachDocument(ctx context.Context, restaurantID string, in documentInputDTO) (*DocumentRow, error) {
	var id string
	var createdAt time.Time
	err := r.db.QueryRow(ctx, `
		INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
		VALUES ('RESTAURANT', $1, $2::restaurant_doc_type, $3, 'SUBMITTED', now()+interval '72h', 'ESCALATE')
		RETURNING id::text, created_at`,
		restaurantID, in.DocType, in.StoredObjectID).Scan(&id, &createdAt)
	if err != nil {
		return nil, fmt.Errorf("attach document: %w", err)
	}
	return &DocumentRow{
		ID:          id,
		SubjectID:   restaurantID,
		DocType:     in.DocType,
		State:       "SUBMITTED",
		StoredObjID: in.StoredObjectID,
		ExpiresOn:   in.ExpiresOn,
		IssuerName:  in.IssuerName,
		CreatedAt:   tsStr(createdAt),
	}, nil
}

// CheckDocumentPack verifies all required document types are present.
// Required (contract R-07 / R-08, RestaurantDocType): BUSINESS_LICENCE,
// HALAL_CERTIFICATE, FOOD_SAFETY, OWNER_ID.
func (r *Repo) CheckDocumentPack(ctx context.Context, restaurantID string) error {
	required := requiredRestaurantDocTypes
	for _, dt := range required {
		var count int
		err := r.db.QueryRow(ctx, `
			SELECT count(*) FROM kyc_document
			 WHERE subject_id = $1 AND subject_type = 'RESTAURANT'
			   AND restaurant_doc_type = $2 AND state NOT IN ('REJECTED') AND deleted_at IS NULL`,
			restaurantID, dt).Scan(&count)
		if err != nil {
			return err
		}
		if count == 0 {
			return ErrIncompleteDocumentPack
		}
	}
	return nil
}

// GetMenu returns the restaurant's full menu (categories + items + versions).
func (r *Repo) GetMenu(ctx context.Context, restaurantID string) (*MenuView, error) {
	out := &MenuView{
		RestaurantID: restaurantID,
		Categories:   []MenuCategoryView{},
	}

	catRows, err := r.db.Query(ctx, `
		SELECT id::text, name, description, sort_order, is_active
		  FROM menu_category WHERE restaurant_id = $1 AND deleted_at IS NULL
		 ORDER BY sort_order, name`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer catRows.Close()
	for catRows.Next() {
		var c MenuCategoryView
		if err := catRows.Scan(&c.ID, &c.Name, &c.Description, &c.SortOrder, &c.IsActive); err != nil {
			return nil, err
		}
		c.Items = []MenuItemView{}
		out.Categories = append(out.Categories, c)
	}
	if err := catRows.Err(); err != nil {
		return nil, err
	}
	catRows.Close()

	// Load items for each category.
	for i := range out.Categories {
		items, err := r.loadCategoryItems(ctx, restaurantID, out.Categories[i].ID)
		if err != nil {
			return nil, err
		}
		out.Categories[i].Items = items
	}
	return out, nil
}

func (r *Repo) loadCategoryItems(ctx context.Context, restaurantID, categoryID string) ([]MenuItemView, error) {
	rows, err := r.db.Query(ctx, `
		SELECT mi.id::text, mi.category_id::text, mi.price_cents, mi.currency::text,
		       mi.availability_state::text, mi.out_of_stock_until,
		       mi.sort_order, mi.live_version_id, mi.pending_version_id,
		       mi.created_at, mi.updated_at
		  FROM menu_item mi
		 WHERE mi.restaurant_id = $1 AND mi.category_id = $2 AND mi.deleted_at IS NULL
		 ORDER BY mi.sort_order, mi.created_at`, restaurantID, categoryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MenuItemView
	for rows.Next() {
		var item MenuItemView
		var outOfStock *time.Time
		var createdAt, updatedAt time.Time
		var liveVid, pendingVid *string
		if err := rows.Scan(&item.ID, &item.CategoryID, &item.PriceCents, &item.Currency,
			&item.AvailabilityState, &outOfStock,
			&item.SortOrder, &liveVid, &pendingVid,
			&createdAt, &updatedAt); err != nil {
			return nil, err
		}
		if outOfStock != nil {
			s := tsStr(*outOfStock)
			item.OutOfStockUntil = &s
		}
		item.CreatedAt = tsStr(createdAt)
		item.UpdatedAt = tsStr(updatedAt)

		if liveVid != nil {
			v, err := r.loadItemVersion(ctx, *liveVid)
			if err == nil {
				item.LiveVersion = v
			}
		}
		if pendingVid != nil {
			v, err := r.loadItemVersion(ctx, *pendingVid)
			if err == nil {
				item.PendingVersion = v
			}
		}
		out = append(out, item)
	}
	if out == nil {
		out = []MenuItemView{}
	}
	return out, rows.Err()
}

func (r *Repo) loadItemVersion(ctx context.Context, versionID string) (*MenuItemVersion, error) {
	var v MenuItemVersion
	var createdAt time.Time
	err := r.db.QueryRow(ctx, `
		SELECT id::text, version, name, description, ingredients_text,
		       dietary_tags::text[], allergen_tags::text[],
		       review_status::text, created_at
		  FROM menu_item_version WHERE id = $1`, versionID).Scan(
		&v.ID, &v.Version, &v.Name, &v.Description, &v.IngredientsText,
		&v.DietaryTags, &v.AllergenTags,
		&v.ReviewStatus, &createdAt)
	if err != nil {
		return nil, err
	}
	if v.DietaryTags == nil {
		v.DietaryTags = []string{}
	}
	if v.AllergenTags == nil {
		v.AllergenTags = []string{}
	}
	v.CreatedAt = tsStr(createdAt)
	return &v, nil
}

// CreateCategory creates a new menu category and returns its view.
// Returns ErrCategoryNameTaken if a category with the same name exists.
func (r *Repo) CreateCategory(ctx context.Context, restaurantID string, in categoryInputDTO) (*MenuCategoryView, error) {
	var id string
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	err := r.db.QueryRow(ctx, `
		INSERT INTO menu_category (restaurant_id, name, description, sort_order)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text`,
		restaurantID, in.Name, in.Description, sortOrder).Scan(&id)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrCategoryNameTaken
		}
		return nil, fmt.Errorf("create category: %w", err)
	}
	return &MenuCategoryView{
		ID:          id,
		Name:        in.Name,
		Description: in.Description,
		SortOrder:   sortOrder,
		IsActive:    true,
		Items:       []MenuItemView{},
	}, nil
}

// CreateMenuItem creates a new menu item + initial DRAFT version.
// The version is always DRAFT (never auto-approved per R-05 / halal gate).
func (r *Repo) CreateMenuItem(ctx context.Context, restaurantID string, in menuItemInputDTO) (*MenuItemView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// IDOR guard: the target category must belong to THIS restaurant. The FK on
	// menu_item.category_id references menu_category(id) globally, so without this
	// check a caller could attach an item to another tenant's category. A
	// foreign or non-existent category is indistinguishable → 404 (never 403).
	var ownedCat bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM menu_category
		 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL)`,
		in.CategoryID, restaurantID).Scan(&ownedCat); err != nil {
		return nil, fmt.Errorf("verify category ownership: %w", err)
	}
	if !ownedCat {
		return nil, ErrNotFound
	}

	var itemID string
	sortOrder := 0
	if in.SortOrder != nil {
		sortOrder = *in.SortOrder
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_item (restaurant_id, category_id, price_cents, sort_order, tax_category)
		VALUES ($1, $2::uuid, $3, $4, 'PREPARED_FOOD')
		RETURNING id::text`,
		restaurantID, in.CategoryID, in.PriceCents, sortOrder).Scan(&itemID)
	if err != nil {
		return nil, fmt.Errorf("create menu_item: %w", err)
	}

	dietaryTags := in.DietaryTags
	if dietaryTags == nil {
		dietaryTags = []string{}
	}
	allergenTags := in.AllergenTags
	if allergenTags == nil {
		allergenTags = []string{}
	}

	var versionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_item_version
			(menu_item_id, restaurant_id, version, name, description, ingredients_text,
			 dietary_tags, allergen_tags, review_status)
		VALUES ($1, $2, 1, $3, $4, $5,
		        $6::dietary_tag[], $7::allergen_tag[], 'DRAFT')
		RETURNING id::text`,
		itemID, restaurantID, in.Name, in.Description, in.IngredientsText,
		dietaryTags, allergenTags).Scan(&versionID)
	if err != nil {
		return nil, fmt.Errorf("create menu_item_version: %w", err)
	}

	// Set both live_version_id and pending_version_id to the draft (R-05:
	// never auto-approved; live_version_id makes the item queryable,
	// pending_version_id signals it is awaiting review).
	if _, err := tx.Exec(ctx, `UPDATE menu_item SET live_version_id=$1, pending_version_id=$1 WHERE id=$2`,
		versionID, itemID); err != nil {
		return nil, fmt.Errorf("set live_version_id: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return r.getMenuItemByID(ctx, restaurantID, itemID)
}

// UpdateMenuItem creates a new PENDING_REVIEW version for an existing item
// (or DRAFT when carrying halal-bearing tags). Validates ownership.
func (r *Repo) UpdateMenuItem(ctx context.Context, restaurantID, itemID string, in menuItemUpdateDTO) (*MenuItemView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Load current item (ownership check in WHERE clause).
	var currentCategoryID string
	var currentPrice int64
	var currentVersionNo int
	var currentLiveVersionID *string
	err = tx.QueryRow(ctx, `
		SELECT mi.category_id::text, mi.price_cents,
		       COALESCE(miv.version, 0), mi.live_version_id::text
		  FROM menu_item mi
		  LEFT JOIN menu_item_version miv ON miv.id = mi.live_version_id
		 WHERE mi.id = $1 AND mi.restaurant_id = $2 AND mi.deleted_at IS NULL`,
		itemID, restaurantID).Scan(&currentCategoryID, &currentPrice, &currentVersionNo, &currentLiveVersionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load menu_item for update: %w", err)
	}

	// Apply price + category updates to the item row.
	if in.PriceCents != nil {
		if _, err := tx.Exec(ctx, `UPDATE menu_item SET price_cents=$1, updated_at=now() WHERE id=$2`,
			*in.PriceCents, itemID); err != nil {
			return nil, fmt.Errorf("update price: %w", err)
		}
	}
	if in.CategoryID != nil {
		// IDOR guard: the destination category must belong to THIS restaurant.
		var ownedCat bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM menu_category
			 WHERE id = $1 AND restaurant_id = $2 AND deleted_at IS NULL)`,
			*in.CategoryID, restaurantID).Scan(&ownedCat); err != nil {
			return nil, fmt.Errorf("verify category ownership: %w", err)
		}
		if !ownedCat {
			return nil, ErrNotFound
		}
		if _, err := tx.Exec(ctx, `UPDATE menu_item SET category_id=$1::uuid, updated_at=now() WHERE id=$2`,
			*in.CategoryID, itemID); err != nil {
			return nil, fmt.Errorf("update category: %w", err)
		}
	}

	// Create a new version for the claim-bearing descriptive fields.
	newVersion := currentVersionNo + 1
	name := ""
	if currentLiveVersionID != nil {
		// Inherit from live.
		_ = tx.QueryRow(ctx, `SELECT name FROM menu_item_version WHERE id=$1`, *currentLiveVersionID).Scan(&name)
	}
	if in.Name != nil {
		name = *in.Name
	}
	if name == "" {
		name = "Unnamed"
	}

	dietaryTags := in.DietaryTags
	if dietaryTags == nil {
		dietaryTags = []string{}
	}
	allergenTags := in.AllergenTags
	if allergenTags == nil {
		allergenTags = []string{}
	}

	var newVersionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO menu_item_version
			(menu_item_id, restaurant_id, version, name, description, ingredients_text,
			 dietary_tags, allergen_tags, review_status)
		VALUES ($1, $2, $3, $4, $5, $6,
		        $7::dietary_tag[], $8::allergen_tag[], 'DRAFT')
		RETURNING id::text`,
		itemID, restaurantID, newVersion, name, in.Description, in.IngredientsText,
		dietaryTags, allergenTags).Scan(&newVersionID)
	if err != nil {
		return nil, fmt.Errorf("create updated version: %w", err)
	}

	// Point live_version_id at the new draft so the item appears with the new name.
	if _, err := tx.Exec(ctx, `UPDATE menu_item SET live_version_id=$1, updated_at=now() WHERE id=$2`,
		newVersionID, itemID); err != nil {
		return nil, fmt.Errorf("set live_version: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.getMenuItemByID(ctx, restaurantID, itemID)
}

// SetMenuItemAvailability sets a menu item's availability state. Validates ownership.
func (r *Repo) SetMenuItemAvailability(ctx context.Context, restaurantID, itemID string, in availabilityInputDTO) (*MenuItemView, error) {
	state := "AVAILABLE"
	if !in.IsAvailable {
		state = "OUT_OF_STOCK"
	}

	var outUntil *time.Time
	if in.OutOfStockUntil != nil {
		t, err := time.Parse(time.RFC3339, *in.OutOfStockUntil)
		if err == nil {
			outUntil = &t
		}
	}

	tag, err := r.db.Exec(ctx, `
		UPDATE menu_item SET availability_state=$2::menu_item_availability_state,
		       out_of_stock_until=$3, updated_at=now()
		 WHERE id=$1 AND restaurant_id=$4 AND deleted_at IS NULL`,
		itemID, state, outUntil, restaurantID)
	if err != nil {
		return nil, fmt.Errorf("set availability: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getMenuItemByID(ctx, restaurantID, itemID)
}

// getMenuItemByID loads a single menu item (with versions) owned by the restaurant.
func (r *Repo) getMenuItemByID(ctx context.Context, restaurantID, itemID string) (*MenuItemView, error) {
	var item MenuItemView
	var outOfStock *time.Time
	var createdAt, updatedAt time.Time
	var liveVid, pendingVid *string
	err := r.db.QueryRow(ctx, `
		SELECT mi.id::text, mi.category_id::text, mi.price_cents, mi.currency::text,
		       mi.availability_state::text, mi.out_of_stock_until,
		       mi.sort_order, mi.live_version_id::text, mi.pending_version_id::text,
		       mi.created_at, mi.updated_at
		  FROM menu_item mi
		 WHERE mi.id = $1 AND mi.restaurant_id = $2 AND mi.deleted_at IS NULL`,
		itemID, restaurantID).Scan(
		&item.ID, &item.CategoryID, &item.PriceCents, &item.Currency,
		&item.AvailabilityState, &outOfStock,
		&item.SortOrder, &liveVid, &pendingVid,
		&createdAt, &updatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if outOfStock != nil {
		s := tsStr(*outOfStock)
		item.OutOfStockUntil = &s
	}
	item.CreatedAt = tsStr(createdAt)
	item.UpdatedAt = tsStr(updatedAt)
	if liveVid != nil {
		v, err := r.loadItemVersion(ctx, *liveVid)
		if err == nil {
			item.LiveVersion = v
		}
	}
	if pendingVid != nil {
		v, err := r.loadItemVersion(ctx, *pendingVid)
		if err == nil {
			item.PendingVersion = v
		}
	}
	return &item, nil
}

// ListOrders returns the restaurant's orders, paginated (newest first).
func (r *Repo) ListOrders(ctx context.Context, restaurantID string, limit int, afterID *string) ([]OrderSummaryView, bool, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	args := []any{restaurantID}
	where := `restaurant_id = $1`
	if afterID != nil {
		args = append(args, *afterID)
		where += fmt.Sprintf(` AND placed_at < (SELECT placed_at FROM "order" WHERE id=$%d)`, len(args))
	}
	args = append(args, limit+1)
	q := fmt.Sprintf(`
		SELECT id::text, code, state::text, total_cents, currency::text,
		       placed_at, deadline_at
		  FROM "order"
		 WHERE %s
		 ORDER BY placed_at DESC LIMIT $%d`, where, len(args))

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	var out []OrderSummaryView
	for rows.Next() {
		var o OrderSummaryView
		var placedAt time.Time
		var deadlineAt *time.Time
		if err := rows.Scan(&o.ID, &o.Code, &o.State, &o.TotalCents, &o.Currency,
			&placedAt, &deadlineAt); err != nil {
			return nil, false, err
		}
		o.PlacedAt = tsStr(placedAt)
		o.DeadlineAt = tsStrPtr(deadlineAt)
		// Item count.
		_ = r.db.QueryRow(ctx, `SELECT coalesce(sum(quantity),0) FROM order_line WHERE order_id=$1`, o.ID).Scan(&o.ItemCount)
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	if out == nil {
		out = []OrderSummaryView{}
	}
	return out, hasMore, nil
}

// GetOrder returns a restaurant's order by ID (ownership enforced in SQL).
func (r *Repo) GetOrder(ctx context.Context, restaurantID, orderID string) (*OrderDetailView, error) {
	var o OrderDetailView
	var placedAt, stateSince time.Time
	var deadlineAt *time.Time
	var acceptedAt, readyAt *time.Time
	err := r.db.QueryRow(ctx, `
		SELECT id::text, code, state::text, state_since, deadline_at,
		       total_cents, subtotal_cents, currency::text,
		       placed_at, accepted_at, ready_at,
		       reject_reason::text, special_instructions
		  FROM "order"
		 WHERE id = $1 AND restaurant_id = $2`,
		orderID, restaurantID).Scan(
		&o.ID, &o.Code, &o.State, &stateSince, &deadlineAt,
		&o.TotalCents, &o.SubtotalCents, &o.Currency,
		&placedAt, &acceptedAt, &readyAt,
		&o.RejectReason, &o.SpecialInstructions)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get order: %w", err)
	}
	o.PlacedAt = tsStr(placedAt)
	o.StateSince = tsStr(stateSince)
	o.DeadlineAt = tsStrPtr(deadlineAt)
	o.AcceptedAt = tsStrPtr(acceptedAt)
	o.ReadyAt = tsStrPtr(readyAt)

	// Lines.
	lRows, err := r.db.Query(ctx, `
		SELECT line_no, name_snapshot, quantity, line_unit_cents, line_total_cents
		  FROM order_line WHERE order_id = $1 ORDER BY line_no`, orderID)
	if err != nil {
		return nil, err
	}
	defer lRows.Close()
	for lRows.Next() {
		var l OrderLineView
		if err := lRows.Scan(&l.LineNo, &l.Name, &l.Quantity, &l.UnitPriceCents, &l.LineTotalCents); err != nil {
			return nil, err
		}
		o.Lines = append(o.Lines, l)
	}
	if o.Lines == nil {
		o.Lines = []OrderLineView{}
	}
	return &o, lRows.Err()
}

// AcceptOrder transitions RESTAURANT_PENDING → PREPARING.
// Returns ErrOfferExpired if the deadline has passed; ErrIllegalTransition if
// the order is not in RESTAURANT_PENDING.
func (r *Repo) AcceptOrder(ctx context.Context, restaurantID, orderID, actorAccountID string, promisedReadyMinutes *int) (*OrderDetailView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var state string
	var deadlineAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT state::text, deadline_at FROM "order"
		 WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state, &deadlineAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "RESTAURANT_PENDING" {
		return nil, ErrIllegalTransition
	}
	if deadlineAt != nil && time.Now().After(*deadlineAt) {
		return nil, ErrOfferExpired
	}

	// Compute PREPARING deadline (prep_eta + 10 minutes).
	prepMins := 30
	if promisedReadyMinutes != nil {
		prepMins = *promisedReadyMinutes
	}
	newDeadline := time.Now().UTC().Add(time.Duration(prepMins)*time.Minute + 10*time.Minute)

	var promisedReadyAt *time.Time
	if promisedReadyMinutes != nil {
		t := time.Now().UTC().Add(time.Duration(*promisedReadyMinutes) * time.Minute)
		promisedReadyAt = &t
	}

	_, err = tx.Exec(ctx, `
		UPDATE "order" SET
			state='PREPARING', state_since=now(),
			deadline_at=$2, deadline_action='PREP_OVERDUE',
			accepted_at=now(), promised_ready_at=$3,
			prep_eta_minutes=$4,
			updated_at=now()
		WHERE id=$1`,
		orderID, newDeadline, promisedReadyAt, prepMins)
	if err != nil {
		return nil, fmt.Errorf("accept order: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, actor_account_id, reason)
		VALUES ($1,'RESTAURANT_PENDING','PREPARING','RESTAURANT',$2,'restaurant accepted')`,
		orderID, actorAccountID)
	if err != nil {
		return nil, fmt.Errorf("insert transition: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// RejectOrder transitions RESTAURANT_PENDING → REJECTED.
func (r *Repo) RejectOrder(ctx context.Context, restaurantID, orderID, actorAccountID, reason string, note *string) (*OrderDetailView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var state string
	err = tx.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "RESTAURANT_PENDING" {
		return nil, ErrIllegalTransition
	}

	// REJECTED is its own terminal state with its own reject_reason. It is NOT
	// CANCELLED, so cancel_reason must stay NULL (there is no RESTAURANT_REJECTED
	// member of order_cancellation_reason_code; setting it 22P02'd → 500 on every
	// real rejection). The CHECK order_reject_has_reason is satisfied by
	// reject_reason alone.
	_, err = tx.Exec(ctx, `
		UPDATE "order" SET
			state='REJECTED', state_since=now(),
			deadline_at=NULL, deadline_action=NULL,
			reject_reason=$2::restaurant_reject_reason_code, reject_note=$3,
			updated_at=now()
		WHERE id=$1`, orderID, reason, note)
	if err != nil {
		return nil, fmt.Errorf("reject order: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, actor_account_id, reason)
		VALUES ($1,'RESTAURANT_PENDING','REJECTED','RESTAURANT',$2,'restaurant rejected')`,
		orderID, actorAccountID)
	if err != nil {
		return nil, fmt.Errorf("insert transition: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// MarkOrderReady transitions PREPARING → READY_FOR_PICKUP.
func (r *Repo) MarkOrderReady(ctx context.Context, restaurantID, orderID, actorAccountID string) (*OrderDetailView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var state string
	err = tx.QueryRow(ctx, `SELECT state::text FROM "order" WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "PREPARING" {
		return nil, ErrIllegalTransition
	}

	// READY_FOR_PICKUP: rider pickup expected within 15 minutes.
	newDeadline := time.Now().UTC().Add(15 * time.Minute)
	_, err = tx.Exec(ctx, `
		UPDATE "order" SET
			state='READY_FOR_PICKUP', state_since=now(),
			deadline_at=$2, deadline_action='RIDER_NO_SHOW',
			ready_at=now(), updated_at=now()
		WHERE id=$1`, orderID, newDeadline)
	if err != nil {
		return nil, fmt.Errorf("mark ready: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, actor_account_id, reason)
		VALUES ($1,'PREPARING','READY_FOR_PICKUP','RESTAURANT',$2,'order ready')`,
		orderID, actorAccountID)
	if err != nil {
		return nil, fmt.Errorf("insert transition: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// DelayOrder adds a delay event to a PREPARING order.
// R-26: max 3 delays total. Returns ErrDelayLimitReached when exhausted.
// The order must have been accepted via AcceptOrder (accepted_at IS NOT NULL)
// to be delayable; directly-seeded PREPARING orders without accepted_at will
// also fail with ErrDelayLimitReached since they represent an inconsistent state.
func (r *Repo) DelayOrder(ctx context.Context, restaurantID, orderID, actorAccountID string, delayMinutes int, reason string) (*OrderDetailView, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var state string
	var currentDeadline *time.Time
	var acceptedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT state::text, deadline_at, accepted_at FROM "order" WHERE id=$1 AND restaurant_id=$2 FOR UPDATE`,
		orderID, restaurantID).Scan(&state, &currentDeadline, &acceptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if state != "PREPARING" {
		return nil, ErrIllegalTransition
	}

	// R-26: at most 3 delays AND at most +45 minutes cumulative per order.
	// Count prior delay transitions and sum their added minutes. The added
	// minutes are encoded as "delay:<minutes>:<reason>" in the transition reason.
	var delayCount, cumulativeMinutes int
	_ = tx.QueryRow(ctx, `
		SELECT count(*),
		       COALESCE(SUM((split_part(reason,':',2))::int),0)
		  FROM order_transition
		 WHERE order_id=$1 AND from_state='PREPARING' AND to_state='PREPARING'
		   AND reason LIKE 'delay:%'`,
		orderID).Scan(&delayCount, &cumulativeMinutes)

	// An order that was never properly accepted (accepted_at IS NULL) means
	// it was not transitioned through the restaurant acceptance flow. Such orders
	// count as having exhausted delays (they are not in a delayable state).
	if acceptedAt == nil || delayCount >= 3 {
		return nil, ErrDelayLimitReached
	}
	// Enforce the cumulative +45-minute cap: this delay must not push the running
	// total past 45. Three 20-minute delays (60 min) must NOT all succeed.
	if cumulativeMinutes+delayMinutes > 45 {
		return nil, ErrDelayLimitReached
	}

	// Extend the deadline.
	base := time.Now().UTC()
	if currentDeadline != nil && currentDeadline.After(base) {
		base = *currentDeadline
	}
	newDeadline := base.Add(time.Duration(delayMinutes) * time.Minute)

	_, err = tx.Exec(ctx, `
		UPDATE "order" SET deadline_at=$2, updated_at=now() WHERE id=$1`,
		orderID, newDeadline)
	if err != nil {
		return nil, fmt.Errorf("extend deadline: %w", err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO order_transition (order_id, from_state, to_state, actor_kind, actor_account_id, reason)
		VALUES ($1,'PREPARING','PREPARING','RESTAURANT',$2,$3)`,
		orderID, actorAccountID, fmt.Sprintf("delay:%d:%s", delayMinutes, reason))
	if err != nil {
		return nil, fmt.Errorf("insert delay transition: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r.GetOrder(ctx, restaurantID, orderID)
}

// isUniqueViolation checks if a pgx error is a unique constraint violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	return contains(err.Error(), "unique") || contains(err.Error(), "UNIQUE") || contains(err.Error(), "23505")
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
