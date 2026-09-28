package catalog

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Seed helpers for the home-feed integration tests.
//
// A restaurant is visible to customers only through the real halal chain:
// restaurant.halal_status is derived by trigger and may never be hand-set
// (docs/spec/01-platform.md "Filters and halal certification"). CERTIFIED needs an APPROVED certificate from an ACCEPTED issuing
// body carrying all seven checks at PASS — a deferred constraint, so the
// certificate and its checks go in inside one transaction. Seeding through that
// chain, rather than around it, is what makes "an uncertified restaurant is in
// no section" a real assertion.

// feedWorld is one isolated set of rows, removed on cleanup.
type feedWorld struct {
	t     *testing.T
	pool  *pgxpool.Pool
	actor string // the admin account that decides certificates

	restaurants []string
	accounts    []string
}

func newFeedWorld(t *testing.T, pool *pgxpool.Pool) *feedWorld {
	t.Helper()
	w := &feedWorld{t: t, pool: pool}
	w.actor = w.account("admin")
	t.Cleanup(w.cleanup)
	return w
}

func (w *feedWorld) exec(q string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), q, args...); err != nil {
		w.t.Fatalf("exec %.60q: %v", q, err)
	}
}

func (w *feedWorld) scan(q string, dst any, args ...any) {
	w.t.Helper()
	if err := w.pool.QueryRow(context.Background(), q, args...).Scan(dst); err != nil {
		w.t.Fatalf("scan %.60q: %v", q, err)
	}
}

// account creates a customer-shaped account (a verified phone) and returns its id.
func (w *feedWorld) account(label string) string {
	w.t.Helper()
	var id string
	w.scan(`
		INSERT INTO account (email, phone_e164, phone_verified_at, status)
		VALUES ($1||'-'||substr(md5(random()::text),1,8)||'@feed.test',
		        '+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'),
		        now(), 'ACTIVE')
		RETURNING id`, &id, label)
	w.accounts = append(w.accounts, id)
	return id
}

// cuisineID returns the id of a seeded cuisine by name.
func (w *feedWorld) cuisineID(name string) string {
	w.t.Helper()
	var id string
	w.scan(`SELECT id FROM cuisine WHERE name = $1`, &id, name)
	return id
}

// restaurantOpts describes one seeded restaurant.
type restaurantOpts struct {
	name      string
	lat, lng  float64
	certified bool     // false = UNVERIFIED: must appear in no section
	cuisines  []string // seeded cuisine names
	rating    *float64
}

// restaurant creates a LIVE restaurant, certified through the real chain when
// opts.certified, and returns its id.
func (w *feedWorld) restaurant(o restaurantOpts) string {
	w.t.Helper()
	ctx := context.Background()
	var id string
	w.scan(`
		INSERT INTO restaurant (
			slug, legal_name, display_name, province, city, line1, postal_code,
			location, onboarding_state, account_state, is_accepting_orders,
			commission_rate_bps, tax_role, minimum_order_cents, rating_avg
		) VALUES (
			'feed-'||substr(md5(random()::text),1,10), $1||' Inc.', $1, 'ON',
			'Toronto', '1 Test St', 'M5J0C3',
			ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
			'ACTIVE', 'LIVE', true, 0, 'RESTAURANT_IS_SUPPLIER', 0, $4
		) RETURNING id`, &id, o.name, o.lng, o.lat, o.rating)
	w.restaurants = append(w.restaurants, id)

	for _, c := range o.cuisines {
		w.exec(`INSERT INTO restaurant_cuisine (restaurant_id, cuisine_id) VALUES ($1, $2)`, id, w.cuisineID(c))
	}
	if !o.certified {
		return id
	}

	tx, err := w.pool.Begin(ctx)
	if err != nil {
		w.t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	one := func(q string, dst any, args ...any) {
		w.t.Helper()
		if err := tx.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			w.t.Fatalf("certify %.50q: %v", q, err)
		}
	}
	var bodyID, objID, docID, certID string
	one(`SELECT id FROM halal_issuing_body WHERE status = 'ACCEPTED' ORDER BY name LIMIT 1`, &bodyID)
	one(`INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
	     VALUES ('hg-kyc', 'feed/'||md5(random()::text), 'KYC_DOCUMENT', 'application/pdf', 1024,
	             decode(repeat('b2',32),'hex'), 'READY', $1, now())
	     RETURNING id`, &objID, w.actor)
	one(`INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
	     VALUES ('RESTAURANT', $1, 'HALAL_CERTIFICATE', $2, 'IN_REVIEW', now()+interval '72 hours', 'ESCALATE')
	     RETURNING id`, &docID, id, objID)
	one(`INSERT INTO halal_certificate
	       (restaurant_id, document_id, certificate_number, issuing_body_id, certified_legal_name,
	        certified_address, scope, issued_on, expires_on, status, checklist_version, verified_by, verified_at)
	     VALUES ($1, $2, 'FEED-'||substr(md5(random()::text),1,8), $3, $4||' Inc.', '1 Test St Toronto',
	             'WHOLE_ESTABLISHMENT', current_date-60, current_date+300, 'APPROVED', 1, $5, now())
	     RETURNING id`, &certID, id, docID, bodyID, o.name, w.actor)
	for _, key := range []string{
		"H1_LEGIBLE_COMPLETE", "H2_ISSUER_ACCEPTED", "H3_NAME_MATCH", "H4_ADDRESS_MATCH",
		"H5_DATES_VALID", "H6_SCOPE_SUFFICIENT", "H7_UNIQUE_NOT_REUSED",
	} {
		// H5 and H7 are server-computed and may not be overridden: result must
		// equal computed_result. The others are overridable.
		overridable := key != "H5_DATES_VALID" && key != "H7_UNIQUE_NOT_REUSED"
		if _, err := tx.Exec(ctx, `
			INSERT INTO halal_certificate_check
			  (halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at)
			VALUES ($1, $2, 'PASS', 'PASS', $3, $4, now())`, certID, key, overridable, w.actor); err != nil {
			w.t.Fatalf("certify check %s: %v", key, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		w.t.Fatalf("certify commit: %v", err)
	}
	return id
}

// deliveredOrder records one order from customer at restaurant, delivered
// daysAgo days ago. Terminal (COMPLETED), so it carries no deadline.
func (w *feedWorld) deliveredOrder(customer, restaurant string, daysAgo int) {
	w.t.Helper()
	var pricingID, jurisdiction, addressID, cartID, quoteID string
	w.scan(`SELECT id FROM pricing_config ORDER BY version DESC LIMIT 1`, &pricingID)
	w.scan(`SELECT code FROM tax_jurisdiction WHERE code = 'CA-ON'`, &jurisdiction)
	w.scan(`
		INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone)
		VALUES ($1, '88 Harbour St', 'Toronto', 'ON', 'M5J0C3',
		        ST_SetSRID(ST_MakePoint(-79.381, 43.6412),4326)::geography, 'America/Toronto')
		RETURNING id`, &addressID, customer)
	w.scan(`
		INSERT INTO cart (account_id, restaurant_id, delivery_address_id, fulfilment, deleted_at)
		VALUES ($1, $2, $3, 'DELIVERY', now()) RETURNING id`, &cartID, customer, restaurant, addressID)
	// deleted_at: a placed order has retired its cart. cart_one_open allows one
	// open (undeleted) cart per account, and these customers have many orders.
	w.scan(`
		INSERT INTO quote (account_id, cart_id, restaurant_id, delivery_address_id, fulfilment, currency,
		                   pricing_config_id, tax_jurisdiction_code,
		                   subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
		                   input_hash, state_hash, created_at, expires_at)
		VALUES ($1, $2, $3, $4, 'DELIVERY', 'CAD', $5, $6, 1000, 449, 0, 1449,
		        sha256(random()::text::bytea), sha256(random()::text::bytea), now(), now()+interval '1 hour')
		RETURNING id`, &quoteID, customer, cartID, restaurant, addressID, pricingID, jurisdiction)
	at := fmt.Sprintf("now() - interval '%d days'", daysAgo)
	w.exec(`
		INSERT INTO "order" (code, quote_id, account_id, restaurant_id, delivery_address_id, state,
		                     subtotal_cents, delivery_fee_cents, tip_cents, total_cents,
		                     placed_at, delivered_at, completed_at)
		VALUES ('FD-'||substr(md5(random()::text),1,10), $1, $2, $3, $4, 'COMPLETED',
		        1000, 449, 0, 1449, `+at+`, `+at+`, `+at+`)`,
		quoteID, customer, restaurant, addressID)
}

func (w *feedWorld) cleanup() {
	ctx := context.Background()
	// Errors are reported, not swallowed. An earlier version ignored them, the
	// certificate delete failed on every run, and certified restaurants piled up
	// in the database until they crowded the tests' own rows out of the rail.
	del := func(q string, arg any) {
		if _, err := w.pool.Exec(ctx, q, arg); err != nil {
			w.t.Errorf("cleanup %.50q: %v", q, err)
		}
	}
	del(`DELETE FROM "order" WHERE account_id = ANY($1)`, w.accounts)
	del(`DELETE FROM quote WHERE account_id = ANY($1)`, w.accounts)
	del(`DELETE FROM cart WHERE account_id = ANY($1)`, w.accounts)
	del(`DELETE FROM address WHERE account_id = ANY($1)`, w.accounts)
	// restaurant.halal_certificate_id and halal_certificate.restaurant_id point at
	// each other, so neither row can be deleted first. Soft-deleting the
	// certificate breaks the cycle the schema's own way: the sync trigger
	// recomputes the restaurant as UNVERIFIED and clears the link.
	del(`UPDATE halal_certificate SET deleted_at = now() WHERE restaurant_id = ANY($1)`, w.restaurants)
	del(`DELETE FROM halal_certificate WHERE restaurant_id = ANY($1)`, w.restaurants)
	del(`DELETE FROM kyc_document WHERE subject_id = ANY($1)`, w.restaurants)
	del(`DELETE FROM restaurant_cuisine WHERE restaurant_id = ANY($1)`, w.restaurants)
	del(`DELETE FROM restaurant WHERE id = ANY($1)`, w.restaurants)
	del(`DELETE FROM stored_object WHERE uploaded_by = $1`, w.actor)
	del(`DELETE FROM account WHERE id = ANY($1)`, w.accounts)
}

// halalStatus reads a restaurant's derived halal status.
func (w *feedWorld) halalStatus(id string) string {
	w.t.Helper()
	var s string
	w.scan(`SELECT halal_status::text FROM restaurant WHERE id = $1`, &s, id)
	return s
}
