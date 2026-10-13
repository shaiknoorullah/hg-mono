package devworld

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const catalogueAdminID = "a0000000-0000-4000-8000-000000000001"

// ApplyCatalogue inserts the catalogue restaurants, their certificates, hours,
// payout stand-ins and menus, in one transaction. It is idempotent: a second
// run inserts nothing and leaves the first run's rows alone. Pictures are a
// separate step (SeedImages) because they need the object store.
func ApplyCatalogue(ctx context.Context, dsn string) error {
	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	bodies, err := acceptedBodies(ctx, tx)
	if err != nil {
		return err
	}
	today := torontoWeekday(time.Now())
	items := 0
	for _, r := range Catalogue {
		if err := applyRestaurant(ctx, tx, r, bodies, today); err != nil {
			return fmt.Errorf("devworld: catalogue %s: %w", r.Slug, err)
		}
		for _, c := range r.Categories {
			items += len(c.Items)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("devworld: catalogue commit: %w", err)
	}
	fmt.Fprintf(os.Stderr, "devworld: catalogue %d restaurants, %d menu items\n", len(Catalogue), items)
	return nil
}

func acceptedBodies(ctx context.Context, tx pgx.Tx) ([]string, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text FROM halal_issuing_body
		 WHERE status = 'ACCEPTED' AND deleted_at IS NULL
		 ORDER BY name`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("devworld: no accepted issuing body; the reference seed is missing")
	}
	return ids, nil
}

// torontoWeekday is the restaurant-local day of week, 0 = Sunday, as
// restaurant_hours counts it.
func torontoWeekday(now time.Time) int {
	if loc, err := time.LoadLocation("America/Toronto"); err == nil {
		now = now.In(loc)
	}
	return int(now.Weekday())
}

func (r CatalogueRestaurant) address() string {
	return r.Line1 + ", Toronto"
}

func applyRestaurant(ctx context.Context, tx pgx.Tx, r CatalogueRestaurant, bodies []string, today int) error {
	if !r.Persona {
		if err := insertOwnedRestaurant(ctx, tx, r, bodies); err != nil {
			return err
		}
	}

	// The profile every catalogue restaurant shares, personas included.
	if _, err := tx.Exec(ctx, `
		UPDATE restaurant SET
		       display_name = $2, legal_name = $2 || ' Inc.', description = $3, cuisine_text = $4, tags_text = $5,
		       line1 = $6, city = 'Toronto', province = 'ON', postal_code = $7,
		       location = ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
		       price_band = $10::price_band, rating_avg = $11, rating_count = $12,
		       avg_prep_minutes = $13, minimum_order_cents = $14
		 WHERE id = $1`,
		r.ID, r.Name, r.Description, cuisineNames(r.Cuisines), r.Tags,
		r.Line1, r.PostalCode, r.Lng, r.Lat,
		r.PriceBand, r.Rating, r.RatingCount, r.PrepMinutes, r.MinOrder); err != nil {
		return fmt.Errorf("profile: %w", err)
	}
	// A persona certificate was issued for the persona SQL's address; follow the move.
	if _, err := tx.Exec(ctx, `
		UPDATE halal_certificate SET certified_address = $2, certified_legal_name = $3
		 WHERE restaurant_id = $1
		   AND (certified_address IS DISTINCT FROM $2 OR certified_legal_name IS DISTINCT FROM $3)`,
		r.ID, r.address(), r.Name+" Inc."); err != nil {
		return fmt.Errorf("certified address: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO restaurant_cuisine (restaurant_id, cuisine_id)
		SELECT $1, id FROM cuisine WHERE slug = ANY($2)
		ON CONFLICT DO NOTHING`, r.ID, r.Cuisines); err != nil {
		return fmt.Errorf("cuisines: %w", err)
	}
	if err := insertHours(ctx, tx, r, today); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO connect_account (owner_type, owner_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted)
		VALUES ('RESTAURANT', $1, $2, true, true, true)
		ON CONFLICT DO NOTHING`, r.ID, "acct_test_devworld_"+strings.ReplaceAll(r.Slug, "-", "_")); err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	return insertMenu(ctx, tx, r)
}

func cuisineNames(slugs []string) string {
	names := make([]string, len(slugs))
	for i, s := range slugs {
		names[i] = strings.ReplaceAll(s, "-", " ")
	}
	return strings.Join(names, ", ")
}

// insertOwnedRestaurant creates the owner account, the restaurant and a verified
// certificate, the way the persona SQL creates bismillah-grill.
func insertOwnedRestaurant(ctx context.Context, tx pgx.Tx, r CatalogueRestaurant, bodies []string) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO account (id, email, email_verified_at, status, timezone)
		VALUES ($1, $2, now(), 'ACTIVE', 'America/Toronto')
		ON CONFLICT (id) DO NOTHING`, r.OwnerID, r.Email()); err != nil {
		return fmt.Errorf("owner: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO restaurant (
		  id, slug, legal_name, display_name, email,
		  line1, city, province, postal_code, location, timezone,
		  onboarding_state, account_state, is_accepting_orders, last_heartbeat_at,
		  approved_at, approved_by
		) VALUES (
		  $1, $2, $3, $4, $5,
		  $6, 'Toronto', 'ON', $7, ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography, 'America/Toronto',
		  'ACTIVE', 'LIVE', true, now(), now(), $10
		) ON CONFLICT (id) DO NOTHING`,
		r.ID, r.Slug, r.Name+" Inc.", r.Name, r.Email(),
		r.Line1, r.PostalCode, r.Lng, r.Lat, catalogueAdminID); err != nil {
		return fmt.Errorf("restaurant: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO account_role (account_id, role, scope_type, scope_id)
		SELECT $1, 'RESTAURANT_OWNER', 'RESTAURANT', $2
		 WHERE NOT EXISTS (SELECT 1 FROM account_role
		                    WHERE account_id = $1 AND role = 'RESTAURANT_OWNER' AND scope_id = $2)`,
		r.OwnerID, r.ID); err != nil {
		return fmt.Errorf("owner role: %w", err)
	}

	body := bodies[r.Body%len(bodies)]
	certID := catalogueID(r.Slug, "certificate")
	docID := catalogueID(r.Slug, "certificate-document")
	objID := catalogueID(r.Slug, "certificate-object")
	number := "DW-" + strings.ToUpper(r.Slug) + "-0001"
	if _, err := tx.Exec(ctx, `
		INSERT INTO stored_object (
		  id, bucket, object_key, purpose, owner_account_id, restaurant_id,
		  content_type, byte_size, sha256, state, virus_scan_state, uploaded_by, confirmed_at
		) VALUES (
		  $1::uuid, 'hg-kyc', 'devworld/' || $3 || '.pdf', 'KYC_DOCUMENT', $4, $2,
		  'application/pdf', 1024, sha256($1::uuid::text::bytea), 'READY', 'CLEAN', $4, now()
		) ON CONFLICT (id) DO NOTHING`, objID, r.ID, number, catalogueAdminID); err != nil {
		return fmt.Errorf("certificate object: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO kyc_document (
		  id, subject_type, subject_id, restaurant_doc_type, stored_object_id,
		  halal_issuing_body_id, certificate_number, issued_on, valid_until,
		  state, reviewed_by, reviewed_at
		) VALUES (
		  $1, 'RESTAURANT', $2, 'HALAL_CERTIFICATE', $3,
		  $4, $5, current_date - 40, current_date + $6::int,
		  'APPROVED', $7, now()
		) ON CONFLICT (id) DO NOTHING`, docID, r.ID, objID, body, number, r.CertDays, catalogueAdminID); err != nil {
		return fmt.Errorf("certificate document: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO halal_certificate (
		  id, restaurant_id, document_id, certificate_number, issuing_body_id,
		  certified_legal_name, certified_address, scope, issued_on, expires_on,
		  status, checklist_version, verified_by, verified_at
		) VALUES (
		  $1, $2, $3, $4, $5,
		  $6, $7, 'WHOLE_ESTABLISHMENT', current_date - 40, current_date + $8::int,
		  'APPROVED', 1, $9, now()
		) ON CONFLICT (id) DO NOTHING`,
		certID, r.ID, docID, number, body, r.Name+" Inc.", r.address(), r.CertDays, catalogueAdminID); err != nil {
		return fmt.Errorf("certificate: %w", err)
	}
	// The seven checks, all PASS and attributed: the approval trigger requires them.
	if _, err := tx.Exec(ctx, `
		INSERT INTO halal_certificate_check (
		  halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at
		)
		SELECT $1, k::halal_check_key, 'PASS', 'PASS',
		       k NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED'), $2, now()
		  FROM unnest(ARRAY[
		    'H1_LEGIBLE_COMPLETE', 'H2_ISSUER_ACCEPTED', 'H3_NAME_MATCH', 'H4_ADDRESS_MATCH',
		    'H5_DATES_VALID', 'H6_SCOPE_SUFFICIENT', 'H7_UNIQUE_NOT_REUSED'
		  ]) AS k
		ON CONFLICT DO NOTHING`, certID, catalogueAdminID); err != nil {
		return fmt.Errorf("certificate checks: %w", err)
	}
	return nil
}

// insertHours writes the weekly hours once; a restaurant that already has
// hours (the personas) keeps them.
func insertHours(ctx context.Context, tx pgx.Tx, r CatalogueRestaurant, today int) error {
	var opens, closes string
	skip := -1
	switch r.Hours {
	case hoursAfternoon:
		opens, closes = "12:00", "23:59"
	case hoursClosedToday:
		opens, closes = "11:00", "22:00"
		skip = today
	default:
		opens, closes = "00:00", "23:59"
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at)
		SELECT $1, d, $2::time, $3::time
		  FROM generate_series(0, 6) AS d
		 WHERE d <> $4
		   AND NOT EXISTS (SELECT 1 FROM restaurant_hours h WHERE h.restaurant_id = $1)`,
		r.ID, opens, closes, skip)
	if err != nil {
		return fmt.Errorf("hours: %w", err)
	}
	return nil
}

func insertMenu(ctx context.Context, tx pgx.Tx, r CatalogueRestaurant) error {
	for ci, c := range r.Categories {
		catID := c.ID
		if catID == "" {
			catID = catalogueID(r.Slug, "category", c.Name)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO menu_category (id, restaurant_id, name, sort_order)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
			catID, r.ID, c.Name, ci+1); err != nil {
			return fmt.Errorf("category %s: %w", c.Name, err)
		}
		for ii, it := range c.Items {
			if err := insertItem(ctx, tx, r, catID, (ci+1)*100+ii+1, it); err != nil {
				return fmt.Errorf("item %s: %w", it.Key, err)
			}
		}
	}
	return nil
}

// ItemIDs returns the menu item and live version ids of a catalogue item.
func (r CatalogueRestaurant) ItemIDs(it Item) (itemID, versionID string) {
	if it.ID != "" {
		return it.ID, it.VersionID
	}
	return catalogueID(r.Slug, "item", it.Key), catalogueID(r.Slug, "item", it.Key, "v1")
}

func insertItem(ctx context.Context, tx pgx.Tx, r CatalogueRestaurant, catID string, sort int, it Item) error {
	itemID, versionID := r.ItemIDs(it)
	availability := "AVAILABLE"
	var until *time.Time
	if it.OutOfStock {
		availability = "OUT_OF_STOCK"
		if it.OutOfStockHours > 0 {
			t := time.Now().Add(time.Duration(it.OutOfStockHours) * time.Hour)
			until = &t
		}
	}
	// A persona item keeps its price and availability; only its place moves.
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_item (id, restaurant_id, category_id, price_cents, availability_state, out_of_stock_until,
		                       tax_category, prep_minutes, sort_order)
		VALUES ($1, $2, $3, $4, $5::menu_item_availability_state, $6, 'PREPARED_FOOD', $7, $8)
		ON CONFLICT (id) DO UPDATE SET category_id = EXCLUDED.category_id, sort_order = EXCLUDED.sort_order`,
		itemID, r.ID, catID, it.Cents, availability, until, r.PrepMinutes, sort); err != nil {
		return err
	}
	diet := it.Diet
	if diet == nil {
		diet = []string{}
	}
	allergens := it.Allergens
	if allergens == nil {
		allergens = []string{}
	}
	var spiceLevel *int
	if it.Spice > 0 {
		spiceLevel = &it.Spice
	}
	// Approved by the admin persona: a claim-bearing field is never approved
	// without a named reviewer, even in the dev world.
	if _, err := tx.Exec(ctx, `
		INSERT INTO menu_item_version (
		  id, menu_item_id, restaurant_id, version, name, description, ingredients_text,
		  dietary_tags, allergen_tags, allergens_declared, spice_level,
		  review_status, submitted_at, reviewed_by, reviewed_at
		) VALUES (
		  $1, $2, $3, 1, $4, $5, $6,
		  $7::dietary_tag[], $8::allergen_tag[], true, $9,
		  'APPROVED', now(), $10, now()
		) ON CONFLICT (id) DO NOTHING`,
		versionID, itemID, r.ID, it.Name, it.Desc, it.Ingr, diet, allergens, spiceLevel, catalogueAdminID); err != nil {
		return fmt.Errorf("version: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE menu_item SET live_version_id = $2 WHERE id = $1 AND live_version_id IS NULL`, itemID, versionID); err != nil {
		return err
	}

	if v := it.Variants; v != nil {
		gid := catalogueID(r.Slug, "item", it.Key, "variants")
		if _, err := tx.Exec(ctx, `
			INSERT INTO variant_group (id, menu_item_id, name, required, sort_order)
			VALUES ($1, $2, $3, true, 1) ON CONFLICT (id) DO NOTHING`, gid, itemID, v.Name); err != nil {
			return fmt.Errorf("variant group: %w", err)
		}
		for i, opt := range v.Options {
			var price, delta *int64
			c := opt.Cents
			if v.Mode == "DELTA" {
				delta = &c
			} else {
				price = &c
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO variant (id, variant_group_id, name, pricing_mode, price_cents, delta_cents,
				                     is_default, is_available, sort_order)
				VALUES ($1, $2, $3, $4::variant_pricing_mode, $5, $6, $7, $8, $9)
				ON CONFLICT (id) DO NOTHING`,
				catalogueID(r.Slug, "item", it.Key, "variant", opt.Name), gid, opt.Name, v.Mode,
				price, delta, i == 0, !opt.Off, i+1); err != nil {
				return fmt.Errorf("variant %s: %w", opt.Name, err)
			}
		}
	}
	for gi, g := range it.Addons {
		gid := catalogueID(r.Slug, "item", it.Key, "addons", g.Name)
		if _, err := tx.Exec(ctx, `
			INSERT INTO addon_group (id, menu_item_id, name, min_select, max_select, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
			gid, itemID, g.Name, g.Min, g.Max, gi+1); err != nil {
			return fmt.Errorf("addon group %s: %w", g.Name, err)
		}
		for ai, a := range g.Options {
			if _, err := tx.Exec(ctx, `
				INSERT INTO addon (id, addon_group_id, name, price_cents, is_available, sort_order)
				VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
				catalogueID(r.Slug, "item", it.Key, "addon", g.Name, a.Name), gid, a.Name, a.Cents, !a.Off, ai+1); err != nil {
				return fmt.Errorf("addon %s: %w", a.Name, err)
			}
		}
	}
	return nil
}
