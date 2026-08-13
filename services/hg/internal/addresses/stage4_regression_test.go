package addresses_test

// STAGE 4 — ADVERSARIAL REGRESSION SUITE for internal/addresses.
//
// Each test here corresponds to a concrete bug found by throwing hostile /
// boundary inputs at the write operations. Before the stage-4 fix
// (internal/addresses/validate.go), every one of these either
//
//   (a) reached a Postgres enum cast / CHECK constraint and surfaced as a bare
//       500 INTERNAL_ERROR (province "ZZ"/"on", postal "NOPE"/lowercase), or
//   (b) was accepted by the looser DB column and PERSISTED a contract-illegal
//       value (empty line1/city; postal with a contract-disallowed letter;
//       latitude 999 which PostGIS silently WRAPPED to -81; NaN coordinates),
//
// both of which are leaks. The fix is a validate-before-DB layer that returns
// 422 VALIDATION_FAILED (a contract ErrorCode) for every one, never a 500 and
// never a silent write.
//
// These are DB-backed (they must prove no row was written and no 500 leaked),
// so they skip when HG_TEST_POSTGRES_DSN is unset.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// postCreate runs createAddress with the given raw JSON body as the fixture's
// customer and returns the recorder.
func postCreate(t *testing.T, pool *pgxpool.Pool, accountID, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H0000000000000000000STAGE4")
	req = withPrincipal(req, customerPrincipal(accountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)
	return rec
}

func patchUpdate(t *testing.T, pool *pgxpool.Pool, accountID, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/"+id, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req = withPrincipal(req, customerPrincipal(accountID))
	rec := httptest.NewRecorder()
	h.UpdateAddress(rec, req, id)
	return rec
}

func countAddresses(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND deleted_at IS NULL`, accountID,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func errCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body not an error envelope: %s", rec.Body.String())
	}
	return env.Error.Code
}

// ─── createAddress — hostile / boundary inputs (≥ 5) ─────────────────────────

// TestStage4_CreateAddress_HostileInputsReturn422 fires a battery of hostile and
// boundary bodies at createAddress. Every one must be a clean 422
// VALIDATION_FAILED with NO row written — never a 500, never a stored bad row.
func TestStage4_CreateAddress_HostileInputsReturn422(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // seeds 1 address; baseline count is 1
	baseline := countAddresses(t, pool, f.customerAccountID)

	cases := []struct {
		name string
		body string
	}{
		// (a) 22P02 on ::province — previously a 500.
		{"province_unknown_ZZ", `{"line1":"1 A","city":"T","province":"ZZ","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`},
		{"province_lowercase_on", `{"line1":"1 A","city":"T","province":"on","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`},
		{"province_injection", `{"line1":"1 A","city":"T","province":"ON'; DROP TABLE address;--","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`},
		// (a) 23514 on postal CHECK — previously a 500.
		{"postal_garbage", `{"line1":"1 A","city":"T","province":"ON","postal_code":"NOPE","latitude":43.6,"longitude":-79.3}`},
		{"postal_empty", `{"line1":"1 A","city":"T","province":"ON","postal_code":"","latitude":43.6,"longitude":-79.3}`},
		// (b) contract-illegal but DB-legal — previously a silent 201 write.
		{"postal_disallowed_letter", `{"line1":"1 A","city":"T","province":"ON","postal_code":"D0D 0D0","latitude":43.6,"longitude":-79.3}`},
		{"line1_empty", `{"line1":"","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`},
		{"city_empty", `{"line1":"1 A","city":"","province":"ON","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`},
		{"latitude_out_of_range", `{"line1":"1 A","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":999,"longitude":-79.3}`},
		{"longitude_out_of_range", `{"line1":"1 A","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":43.6,"longitude":999}`},
		{"latitude_negative_oob", `{"line1":"1 A","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":-91,"longitude":-79.3}`},
		{"label_too_long", fmt.Sprintf(`{"label":%q,"line1":"1 A","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`, longString(31))},
		{"delivery_notes_too_long", fmt.Sprintf(`{"delivery_notes":%q,"line1":"1 A","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3}`, longString(201))},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := postCreate(t, pool, f.customerAccountID, c.body)
			if rec.Code >= 500 {
				t.Fatalf("hostile input %q leaked a %d (bare 5xx); want 422 (body: %s)", c.name, rec.Code, rec.Body.String())
			}
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status=%d, want 422 for %q (body: %s)", rec.Code, c.name, rec.Body.String())
			}
			if code := errCode(t, rec); code != "VALIDATION_FAILED" {
				t.Errorf("error.code=%q, want VALIDATION_FAILED for %q", code, c.name)
			}
		})
	}

	// No hostile body may have written a row: the count is unchanged.
	if got := countAddresses(t, pool, f.customerAccountID); got != baseline {
		t.Errorf("hostile create wrote %d row(s); the count must stay at %d", got-baseline, baseline)
	}
}

// TestStage4_CreateAddress_LatitudeWrapCorruption is the sharp regression: the
// exact value 999 previously reached PostGIS, which WRAPPED it to -81 and stored
// a point on the wrong side of the planet with a 201. The fix rejects it at the
// door, so no row exists and the response is 422.
func TestStage4_CreateAddress_LatitudeWrapCorruption(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	baseline := countAddresses(t, pool, f.customerAccountID)

	rec := postCreate(t, pool, f.customerAccountID,
		`{"line1":"1 A","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":999,"longitude":-79.3}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := countAddresses(t, pool, f.customerAccountID); got != baseline {
		t.Errorf("a wrapped-coordinate row was persisted (count %d, want %d)", got, baseline)
	}
	// Belt and braces: no row for this account carries the wrapped latitude.
	var wrapped int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND (ST_Y(location::geometry) < -90 OR ST_Y(location::geometry) > 90)`,
		f.customerAccountID,
	).Scan(&wrapped); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if wrapped != 0 {
		t.Errorf("found %d address rows with out-of-range latitude", wrapped)
	}
}

// TestStage4_CreateAddress_PostalNormalised proves the normalisation path: a
// valid postal in a non-canonical form ("m4j1m4", no space, lowercase) is
// accepted (201) and STORED in the contract's canonical "M4J 1M4" form, not
// echoed back verbatim.
func TestStage4_CreateAddress_PostalNormalised(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)

	rec := postCreate(t, pool, f.customerAccountID,
		`{"line1":"1 A","city":"T","province":"ON","postal_code":"m4j1m4","latitude":43.6,"longitude":-79.3}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM address WHERE account_id=$1 AND id!=$2`, f.customerAccountID, f.addressID)
	})
	var env struct {
		Data struct {
			PostalCode string `json:"postal_code"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data.PostalCode != "M4J 1M4" {
		t.Errorf("postal_code=%q, want normalised %q", env.Data.PostalCode, "M4J 1M4")
	}
}

// ─── updateAddress — hostile / boundary inputs (≥ 5) ─────────────────────────

// TestStage4_UpdateAddress_HostileInputsReturn422 fires hostile PATCH bodies at
// an owned address. Each must be a clean 422 that does NOT mutate the row.
func TestStage4_UpdateAddress_HostileInputsReturn422(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)

	// Snapshot the owner's row so we can prove no hostile PATCH mutated it.
	type snap struct {
		line1, city, province, postal string
		lat, lon                      float64
	}
	read := func() snap {
		var s snap
		if err := pool.QueryRow(context.Background(), `
			SELECT line1, city, province::text, postal_code,
			       ST_Y(location::geometry), ST_X(location::geometry)
			FROM address WHERE id=$1`, f.addressID,
		).Scan(&s.line1, &s.city, &s.province, &s.postal, &s.lat, &s.lon); err != nil {
			t.Fatalf("read row: %v", err)
		}
		return s
	}
	before := read()

	cases := []struct {
		name string
		body string
	}{
		{"province_unknown", `{"province":"ZZ"}`},
		{"province_lowercase", `{"province":"on"}`},
		{"postal_garbage", `{"postal_code":"NOPE"}`},
		{"postal_disallowed_letter", `{"postal_code":"D0D 0D0"}`},
		{"line1_empty", `{"line1":""}`},
		{"city_empty", `{"city":""}`},
		{"latitude_out_of_range", `{"latitude":999,"longitude":-79.3}`},
		{"longitude_out_of_range", `{"latitude":43.6,"longitude":-999}`},
		{"only_latitude_supplied", `{"latitude":44.0}`},
		{"only_longitude_supplied", `{"longitude":-80.0}`},
		{"label_too_long", fmt.Sprintf(`{"label":%q}`, longString(31))},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := patchUpdate(t, pool, f.customerAccountID, f.addressID, c.body)
			if rec.Code >= 500 {
				t.Fatalf("hostile PATCH %q leaked a %d (bare 5xx); want 422 (body: %s)", c.name, rec.Code, rec.Body.String())
			}
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status=%d, want 422 for %q (body: %s)", rec.Code, c.name, rec.Body.String())
			}
			if code := errCode(t, rec); code != "VALIDATION_FAILED" {
				t.Errorf("error.code=%q, want VALIDATION_FAILED for %q", code, c.name)
			}
		})
	}

	if after := read(); before != after {
		t.Errorf("a hostile PATCH mutated the row: before=%+v after=%+v", before, after)
	}
}

// TestStage4_UpdateAddress_CoordinatePairEnforced proves the paired-coordinate
// rule: supplying only one of latitude/longitude is a 422 (the repo would
// otherwise leave location untouched, silently ignoring the caller's intent) —
// while supplying BOTH valid coordinates succeeds and moves the point.
func TestStage4_UpdateAddress_CoordinatePairEnforced(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)

	// Only latitude → 422.
	if rec := patchUpdate(t, pool, f.customerAccountID, f.addressID, `{"latitude":45.0}`); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("lat-only PATCH: status=%d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	// Both → 200 and the point moves.
	rec := patchUpdate(t, pool, f.customerAccountID, f.addressID, `{"latitude":45.0,"longitude":-75.0}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("both-coords PATCH: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if env.Data.Latitude < 44.9 || env.Data.Latitude > 45.1 || env.Data.Longitude > -74.9 || env.Data.Longitude < -75.1 {
		t.Errorf("point did not move to (45,-75): got (%v,%v)", env.Data.Latitude, env.Data.Longitude)
	}
}

// TestStage4_UpdateAddress_PromoteToDefaultIsAtomic is the regression for the
// second-default bug: a PATCH with {"is_default":true} on a non-default address,
// while another address is already the account's default, previously tripped the
// partial unique index address_one_default (23505) and surfaced as a 500. The
// fix demotes the existing default in the same transaction, so the flip succeeds
// (200) and the account still has EXACTLY ONE default — the newly promoted row.
func TestStage4_UpdateAddress_PromoteToDefaultIsAtomic(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // f.addressID is_default=true
	addr2 := seedAddress(t, pool, f.customerAccountID, false)

	rec := patchUpdate(t, pool, f.customerAccountID, addr2, `{"is_default":true}`)
	if rec.Code >= 500 {
		t.Fatalf("promote-to-default PATCH leaked a %d; want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Exactly one default, and it is addr2.
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND is_default=true AND deleted_at IS NULL`,
		f.customerAccountID,
	).Scan(&n); err != nil {
		t.Fatalf("count defaults: %v", err)
	}
	if n != 1 {
		t.Errorf("after promote-via-PATCH, expected exactly 1 default, got %d", n)
	}
	var addr2IsDefault, origIsDefault bool
	if err := pool.QueryRow(context.Background(), `SELECT is_default FROM address WHERE id=$1`, addr2).Scan(&addr2IsDefault); err != nil {
		t.Fatalf("read addr2: %v", err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT is_default FROM address WHERE id=$1`, f.addressID).Scan(&origIsDefault); err != nil {
		t.Fatalf("read orig: %v", err)
	}
	if !addr2IsDefault {
		t.Error("addr2 must be the default after promote-via-PATCH")
	}
	if origIsDefault {
		t.Error("the original default must be demoted after promote-via-PATCH")
	}
}

// TestStage4_UpdateAddress_DemoteDefaultAllowed verifies the inverse: a PATCH
// with {"is_default":false} on the current default plainly unsets it (200), no
// pre-clear needed, and leaves the account with zero defaults.
func TestStage4_UpdateAddress_DemoteDefaultAllowed(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // f.addressID is_default=true

	rec := patchUpdate(t, pool, f.customerAccountID, f.addressID, `{"is_default":false}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("demote PATCH: status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND is_default=true AND deleted_at IS NULL`,
		f.customerAccountID,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("after demote, expected 0 defaults, got %d", n)
	}
}

// longString returns a string of n ASCII 'a' runes.
func longString(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = 'a'
	}
	return string(b)
}
