package files

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// fakePresigner signs nothing: it answers a fixed link, so AllocateUpload runs
// to the end without an object store.
type fakePresigner struct{}

func (fakePresigner) PresignHeader(context.Context, string, string, string, time.Duration, url.Values, http.Header) (*url.URL, error) {
	return url.Parse("https://files.example.test/upload")
}

func (fakePresigner) PresignedGetObject(context.Context, string, string, time.Duration, url.Values) (*url.URL, error) {
	return url.Parse("https://files.example.test/download")
}

// A delivery photo upload is keyed to an order only for the rider who holds
// that order's live assignment, and only while the order is in the rider's
// hands (picked up, on the way, or at the drop-off): docs/spec/01-platform.md,
// "P-28 — Presigned upload and download". Anyone else, the order's customer
// included, and an order that does not exist get errNotDelivering, and no
// upload is allocated (https://github.com/shaiknoorullah/hg-mono/issues/370).
func TestPODUploadOnlyForTheRiderCarryingTheOrder(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	repo := NewRepo(pool, fakePresigner{}, nil, testBuckets())

	orderID, customerID := seedFixtureOrderCopy(t, ctx, pool)
	rider := seedAccount(t, ctx, pool, "pod-rider")
	stranger := seedAccount(t, ctx, pool, "pod-stranger")

	allocate := func(accountID, order string) error {
		_, err := repo.AllocateUpload(ctx, Actor{AccountID: accountID}, PurposePOD,
			keyInputs{accountID: accountID, orderID: order}, "image/jpeg", 2048, sha256Hex)
		return err
	}
	uploadsFor := func(order string) int {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM stored_object WHERE order_id = $1`, order).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	setAssignment := func(state string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `DELETE FROM assignment WHERE order_id = $1`, orderID); err != nil {
			t.Fatal(err)
		}
		if state == "" {
			return
		}
		if _, err := pool.Exec(ctx, `
INSERT INTO assignment (order_id, rider_account_id, state, required_pod_method, pod_recorded, terminated_at)
VALUES ($1, $2, $3::assignment_state, 'PHOTO', $4, CASE WHEN $4 THEN now() END)`,
			orderID, rider, state, state == "DELIVERED"); err != nil {
			t.Fatalf("seed %s assignment: %v", state, err)
		}
	}

	setAssignment("ARRIVED_AT_DROPOFF")
	for name, tc := range map[string]struct{ account, order string }{
		"another rider":                {stranger, orderID},
		"the order's customer":         {customerID, orderID},
		"an order that does not exist": {rider, "01a10a55-0000-7000-8000-000000000000"},
		"a malformed order id":         {rider, "not-an-order"},
	} {
		if err := allocate(tc.account, tc.order); !errors.Is(err, errNotDelivering) {
			t.Errorf("%s: err = %v, want errNotDelivering", name, err)
		}
	}
	for _, state := range []string{"", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_AT_PICKUP", "DELIVERED"} {
		setAssignment(state)
		if err := allocate(rider, orderID); !errors.Is(err, errNotDelivering) {
			t.Errorf("rider with assignment %q: err = %v, want errNotDelivering", state, err)
		}
	}
	if n := uploadsFor(orderID); n != 0 {
		t.Fatalf("refused uploads allocated %d objects under the order, want 0", n)
	}

	for _, state := range []string{"PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_AT_DROPOFF"} {
		setAssignment(state)
		if err := allocate(rider, orderID); err != nil {
			t.Errorf("assigned rider at %s: err = %v, want the upload allocated", state, err)
		}
	}
	if n := uploadsFor(orderID); n != 3 {
		t.Fatalf("the carrying rider's uploads = %d, want 3", n)
	}
}

const sha256Hex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// seedAccount inserts an ACTIVE account and removes it when the test ends.
func seedAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, prefix string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ($1||'-'||substr(md5(random()::text),1,10)||'@hg.test', 'ACTIVE') RETURNING id`,
		prefix).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM assignment WHERE rider_account_id = $1`, id)
		_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE uploaded_by = $1`, id)
		_, _ = pool.Exec(c, `DELETE FROM account WHERE id = $1`, id)
	})
	return id
}

// seedFixtureOrderCopy copies the conformance fixtures' PREPARING order (and
// its quote, one order per quote) into a new order of its own, so the test's
// assignments never meet another test's. It returns the order and its
// customer, and skips when the fixtures (migrations/test/fixtures.sql) are not
// loaded.
func seedFixtureOrderCopy(t *testing.T, ctx context.Context, pool *pgxpool.Pool) (orderID, customerID string) {
	t.Helper()
	const fixtureOrder, fixtureQuote = "88888888-8888-4888-8888-888888888888", "77777777-7777-4777-8777-777777777777"
	var loaded bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "order" WHERE id = $1)`, fixtureOrder).Scan(&loaded); err != nil {
		t.Fatal(err)
	}
	if !loaded {
		t.Skip("the conformance fixtures (migrations/test/fixtures.sql) are not loaded")
	}
	err := pool.QueryRow(ctx, `
WITH q AS (
  INSERT INTO quote
  SELECT (jsonb_populate_record(NULL::quote, to_jsonb(q) || jsonb_build_object('id', uuid_generate_v7()))).*
    FROM quote q WHERE id = $2
  RETURNING id
), lines AS (
  INSERT INTO quote_tax_line
  SELECT (jsonb_populate_record(NULL::quote_tax_line, to_jsonb(l) || jsonb_build_object('quote_id', (SELECT id FROM q)))).*
    FROM quote_tax_line l WHERE quote_id = $2
)
INSERT INTO "order"
SELECT (jsonb_populate_record(NULL::"order", to_jsonb(o) || jsonb_build_object(
          'id', uuid_generate_v7(), 'quote_id', (SELECT id FROM q),
          'code', 'HG-'||upper(substr(md5(random()::text), 1, 8))))).*
  FROM "order" o WHERE id = $1
RETURNING id, account_id`, fixtureOrder, fixtureQuote).Scan(&orderID, &customerID)
	if err != nil {
		t.Fatalf("copy the fixture order: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM stored_object WHERE order_id = $1`, orderID)
		var quoteID string
		_ = pool.QueryRow(c, `DELETE FROM "order" WHERE id = $1 RETURNING quote_id`, orderID).Scan(&quoteID)
		_, _ = pool.Exec(c, `DELETE FROM quote_tax_line WHERE quote_id = $1`, quoteID)
		_, _ = pool.Exec(c, `DELETE FROM quote WHERE id = $1`, quoteID)
	})
	return orderID, customerID
}
