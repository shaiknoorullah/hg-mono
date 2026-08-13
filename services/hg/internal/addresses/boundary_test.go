package addresses_test

// STAGE 3 — BOUNDARY & LEAK ANALYSIS for internal/addresses.
//
// These tests close the gaps the stage-2 suite did not cover. They assume the
// implementation is guilty and probe the seams:
//
//   A) CONTRACT CONFORMANCE — the Address envelope matches the contract shape
//      exactly: the JSON key set equals the contract's Address property set (no
//      extra, no missing keys), country is the closed enum {CA}, province is a
//      Province enum member, nullable fields serialise as JSON null (not omitted).
//   B) AUTHZ LEAK — every op denies every non-CUSTOMER role with 403 and allows
//      CUSTOMER; no route is accidentally public; the four declared actions are
//      exactly the module's contract-derived set.
//   C) DATA ISOLATION / IDOR — another account's id returns 404 for read AND for
//      every write op, and never leaks a field of the owner's row.
//   D) MONEY — the Address wire shape carries no monetary field; inbound price
//      fields are rejected (covered in handler_test.go; re-asserted structurally).
//   F) CONCURRENCY / IDEMPOTENCY — setDefault run twice and concurrently keeps
//      exactly ONE default; delete run twice yields 404 the second time with no
//      double effect; update is idempotent.
//   G) ERROR TAXONOMY — every failure path returns a member of the contract's
//      ErrorCode enum, never a bare 500 or a fabricated code (ADDRESS_LIMIT_HIT).

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/addresses"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── contract-derived reference data ─────────────────────────────────────────

// contractAddressFields is the exact property set of schema `Address` in
// contracts/openapi.yaml (additionalProperties:false). A golden closed-shape
// assertion: the response body's key set must equal this set — no more, no less.
var contractAddressFields = []string{
	"id", "label", "line1", "line2", "unit", "buzzer",
	"city", "province", "postal_code", "country",
	"latitude", "longitude", "timezone", "delivery_notes", "is_default",
}

// contractErrorCodes is the subset of the contract's ErrorCode enum this module
// may legitimately emit, plus the transport codes the boundary/guard layer emits.
// Any code the handlers return that is NOT in the full contract enum is a leak;
// we assert membership against this allow-list (which is itself a subset of the
// contract enum — ADDRESS_LIMIT_HIT deliberately absent).
var contractErrorCodes = map[string]bool{
	"NOT_FOUND":               true,
	"FORBIDDEN":               true,
	"AUTHENTICATION_REQUIRED": true,
	"VALIDATION_FAILED":       true,
	"ADDRESS_IN_USE":          true,
	"INTERNAL_ERROR":          true, // allowed to exist in the enum, but a test FAILS if a 500 is hit
}

// provinceEnum is the contract Province enum.
var provinceEnum = map[string]bool{
	"AB": true, "BC": true, "MB": true, "NB": true, "NL": true, "NS": true,
	"NT": true, "NU": true, "ON": true, "PE": true, "QC": true, "SK": true, "YT": true,
}

// ─── A) CONTRACT CONFORMANCE — closed golden shape ───────────────────────────

// assertAddressShape checks a single Address object (raw JSON) against the
// contract: the key set is exactly contractAddressFields; country ∈ {CA};
// province ∈ Province enum; required non-nullable fields are non-null.
func assertAddressShape(t *testing.T, raw json.RawMessage) {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("address is not an object: %v (raw: %s)", err, raw)
	}

	// Exact key-set equality (closed shape).
	got := make([]string, 0, len(m))
	for k := range m {
		got = append(got, k)
	}
	sort.Strings(got)
	want := append([]string(nil), contractAddressFields...)
	sort.Strings(want)
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("Address key set mismatch:\n got=%v\nwant=%v", got, want)
	}

	// No extra field leaked (server-internal columns must never surface).
	for _, forbidden := range []string{"account_id", "created_at", "updated_at", "deleted_at", "location"} {
		if _, ok := m[forbidden]; ok {
			t.Errorf("Address leaks server-internal field %q", forbidden)
		}
	}

	// country is the closed enum {CA}.
	var country string
	if err := json.Unmarshal(m["country"], &country); err != nil {
		t.Errorf("country not a string: %v", err)
	} else if country != "CA" {
		t.Errorf("country=%q, want CA (closed enum)", country)
	}

	// province ∈ Province enum.
	var province string
	if err := json.Unmarshal(m["province"], &province); err != nil {
		t.Errorf("province not a string: %v", err)
	} else if !provinceEnum[province] {
		t.Errorf("province=%q is not a Province enum member", province)
	}

	// is_default is a boolean (not null, not string).
	var isDefault bool
	if err := json.Unmarshal(m["is_default"], &isDefault); err != nil {
		t.Errorf("is_default not a boolean: %v", err)
	}

	// latitude/longitude are numbers, not null (required, non-nullable).
	for _, f := range []string{"latitude", "longitude"} {
		var n float64
		if err := json.Unmarshal(m[f], &n); err != nil {
			t.Errorf("%s not a number: %v (raw %s)", f, err, m[f])
		}
	}

	// timezone required non-nullable string.
	var tz string
	if err := json.Unmarshal(m["timezone"], &tz); err != nil || tz == "" {
		t.Errorf("timezone must be a non-empty string, got %s", m["timezone"])
	}

	// Nullable fields, when the seed left them unset, must serialise as JSON null
	// (present-and-null), never be omitted — required set includes only a subset,
	// but the DTO always emits them. label/line2/unit/buzzer/delivery_notes.
	for _, f := range []string{"label", "line2", "unit", "buzzer", "delivery_notes"} {
		if _, present := m[f]; !present {
			t.Errorf("nullable field %q must be present (present-and-null), it was omitted", f)
		}
	}
}

// TestConformance_GetAddress_ClosedShape asserts the getAddress 200 body is
// exactly {data: Address} with the closed Address key set.
func TestConformance_GetAddress_ClosedShape(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, f.addressID)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	// Envelope closed shape: exactly {data}, no meta on a single resource.
	if _, ok := env["meta"]; ok {
		t.Error("single-resource response must not carry meta")
	}
	if len(env) != 1 {
		keys := make([]string, 0, len(env))
		for k := range env {
			keys = append(keys, k)
		}
		t.Errorf("envelope must be exactly {data}, got keys %v", keys)
	}
	assertAddressShape(t, env["data"])
}

// TestConformance_ListAddresses_ClosedShape asserts each element of the list and
// the meta envelope match the contract shape.
func TestConformance_ListAddresses_ClosedShape(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// A second address with all optional fields left null to exercise null serialisation.
	_ = seedAddress(t, pool, f.customerAccountID, false)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses", nil)
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.ListAddresses(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []json.RawMessage          `json:"data"`
		Meta map[string]json.RawMessage `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(env.Data) == 0 {
		t.Fatal("expected addresses in list")
	}
	for _, el := range env.Data {
		assertAddressShape(t, el)
	}
	// PageMeta closed shape: required next_cursor + has_more (total optional).
	if _, ok := env.Meta["next_cursor"]; !ok {
		t.Error("meta.next_cursor required")
	}
	if _, ok := env.Meta["has_more"]; !ok {
		t.Error("meta.has_more required")
	}
	for k := range env.Meta {
		switch k {
		case "next_cursor", "has_more", "total":
		default:
			t.Errorf("meta carries unexpected field %q", k)
		}
	}
}

// TestConformance_CreateAddress_ClosedShape asserts the 201 body is the closed
// Address shape and that country is server-fixed to CA.
func TestConformance_CreateAddress_ClosedShape(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", bytes.NewBufferString(validCreateBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H0000000000000000000SHAPE1")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM address WHERE account_id=$1 AND id!=$2`, f.customerAccountID, f.addressID)
	})
	var env map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, ok := env["meta"]; ok {
		t.Error("create response must not carry meta")
	}
	assertAddressShape(t, env["data"])
}

// ─── B) AUTHZ LEAK — full role × op sweep ────────────────────────────────────

// nonCustomerRoles is every Role the contract defines except CUSTOMER. For each
// address op (all x-roles=[CUSTOMER]) each of these must be denied 403.
func nonCustomerRoles() map[string]httpx.Role {
	return map[string]httpx.Role{
		"RIDER":              httpx.RoleRider,
		"RESTAURANT_OWNER":   httpx.RoleRestaurantOwner,
		"RESTAURANT_MANAGER": httpx.RoleRestaurantManager,
		"RESTAURANT_STAFF":   httpx.RoleRestaurantStaff,
		"SUPPORT_AGENT":      httpx.RoleSupportAgent,
		"ADMIN":              httpx.RoleAdmin,
		"SUPER_ADMIN":        httpx.RoleSuperAdmin,
	}
}

func principalWithRole(accountID string, role httpx.Role) httpx.Principal {
	return httpx.Principal{AccountID: accountID, SessionID: "sess", Roles: []httpx.Role{role}}
}

// invokeOp dispatches a single address op against handler h with principal p.
// A nil repo is fine because every op runs the auth check before touching it.
func invokeOp(h *addresses.Handler, op string, p httpx.Principal) *httptest.ResponseRecorder {
	const id = "00000000-0000-4000-8000-000000000001"
	rec := httptest.NewRecorder()
	body := `{"line1":"1 A St","city":"Toronto","province":"ON","postal_code":"M4J 1M4","latitude":43.68,"longitude":-79.32}`
	mk := func(method, path string, withBody bool) *http.Request {
		var r *http.Request
		if withBody {
			r = httptest.NewRequest(method, path, bytes.NewBufferString(body))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXX")
		} else {
			r = httptest.NewRequest(method, path, nil)
		}
		return withPrincipal(r, p)
	}
	switch op {
	case "listAddresses":
		h.ListAddresses(rec, mk(http.MethodGet, "/v1/addresses", false))
	case "createAddress":
		h.CreateAddress(rec, mk(http.MethodPost, "/v1/addresses", true))
	case "getAddress":
		h.GetAddress(rec, mk(http.MethodGet, "/v1/addresses/"+id, false), id)
	case "updateAddress":
		h.UpdateAddress(rec, mk(http.MethodPatch, "/v1/addresses/"+id, true), id)
	case "deleteAddress":
		h.DeleteAddress(rec, mk(http.MethodDelete, "/v1/addresses/"+id, false), id)
	case "setDefaultAddress":
		h.SetDefaultAddress(rec, mk(http.MethodPost, "/v1/addresses/"+id+"/default", false), id)
	default:
		panic("unknown op " + op)
	}
	return rec
}

var allOps = []string{"listAddresses", "createAddress", "getAddress", "updateAddress", "deleteAddress", "setDefaultAddress"}

// TestAuthz_EveryNonCustomerRoleDeniedOnEveryOp sweeps the full role × op matrix:
// every non-CUSTOMER role must receive 403 FORBIDDEN on every operation. No role
// leaks past the x-roles=[CUSTOMER] gate.
func TestAuthz_EveryNonCustomerRoleDeniedOnEveryOp(t *testing.T) {
	h := addresses.NewHandler(nil)
	for _, op := range allOps {
		for roleName, role := range nonCustomerRoles() {
			rec := invokeOp(h, op, principalWithRole("acct-x", role))
			if rec.Code != http.StatusForbidden {
				t.Errorf("op=%s role=%s: status=%d, want 403 (body: %s)", op, roleName, rec.Code, rec.Body.String())
				continue
			}
			var env struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
				t.Errorf("op=%s role=%s: 403 body not an error envelope: %s", op, roleName, rec.Body.String())
				continue
			}
			if env.Error.Code != "FORBIDDEN" {
				t.Errorf("op=%s role=%s: error.code=%q, want FORBIDDEN", op, roleName, env.Error.Code)
			}
		}
	}
}

// TestAuthz_AnonymousDeniedOnEveryOp: every op returns 401 for an anonymous
// principal (deny by default; a route is never accidentally public).
func TestAuthz_AnonymousDeniedOnEveryOp(t *testing.T) {
	h := addresses.NewHandler(nil)
	for _, op := range allOps {
		rec := invokeOp(h, op, anonPrincipal())
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("op=%s anon: status=%d, want 401 (body: %s)", op, rec.Code, rec.Body.String())
		}
	}
}

// TestAuthz_ActionsAreContractDerived asserts the module declares exactly the
// four action IDs the stage-2 commit documented, and no route is public. This
// pins the auth surface so a new action cannot be smuggled in un-reconciled.
func TestAuthz_ActionsAreContractDerived(t *testing.T) {
	if addresses.ActionAddressRead != "address.read" ||
		addresses.ActionAddressWrite != "address.write" ||
		addresses.ActionAddressDelete != "address.delete" ||
		addresses.ActionAddressSetDefault != "address.set_default" {
		t.Errorf("address action IDs drifted from the reconciled matrix set: %q %q %q %q",
			addresses.ActionAddressRead, addresses.ActionAddressWrite,
			addresses.ActionAddressDelete, addresses.ActionAddressSetDefault)
	}

	r := httpx.NewRouter(httpx.Options{Env: "test"})
	addresses.Routes(r, addresses.NewHandler(nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("no address route may be public, found: %v", pub)
	}
}

// ─── C) DATA ISOLATION / IDOR — write ops never touch another tenant's row ───

// TestIDOR_WriteOpsNeverMutateForeignRow verifies that update/delete/setDefault
// against another account's addressId return 404 AND leave the owner's row
// untouched (no field mutated, not soft-deleted, default unchanged).
func TestIDOR_WriteOpsNeverMutateForeignRow(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	ctx := context.Background()

	// Snapshot the owner's row before the hostile calls. Dereference the label so
	// the comparison is by value, not by pointer identity.
	type snap struct {
		label     string
		isDefault bool
		deleted   bool
	}
	read := func() snap {
		var s snap
		var label, deletedAt *string
		if err := pool.QueryRow(ctx,
			`SELECT label, is_default, deleted_at::text FROM address WHERE id=$1`, f.addressID,
		).Scan(&label, &s.isDefault, &deletedAt); err != nil {
			t.Fatalf("read owner row: %v", err)
		}
		if label != nil {
			s.label = *label
		}
		s.deleted = deletedAt != nil
		return s
	}
	before := read()

	h := newHandler(pool)
	attacker := customerPrincipal(f.otherAccountID)

	// updateAddress — attacker tries to relabel the owner's row.
	{
		req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/"+f.addressID,
			bytes.NewBufferString(`{"label":"HACKED"}`))
		req.Header.Set("Content-Type", "application/json")
		req = withPrincipal(req, attacker)
		rec := httptest.NewRecorder()
		h.UpdateAddress(rec, req, f.addressID)
		if rec.Code != http.StatusNotFound {
			t.Errorf("update IDOR: status=%d, want 404", rec.Code)
		}
	}
	// setDefaultAddress — attacker tries to flip the owner's default off/on.
	{
		req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+f.addressID+"/default", nil)
		req = withPrincipal(req, attacker)
		rec := httptest.NewRecorder()
		h.SetDefaultAddress(rec, req, f.addressID)
		if rec.Code != http.StatusNotFound {
			t.Errorf("setDefault IDOR: status=%d, want 404", rec.Code)
		}
	}
	// deleteAddress — attacker tries to soft-delete the owner's row.
	{
		req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/"+f.addressID, nil)
		req = withPrincipal(req, attacker)
		rec := httptest.NewRecorder()
		h.DeleteAddress(rec, req, f.addressID)
		if rec.Code != http.StatusNotFound {
			t.Errorf("delete IDOR: status=%d, want 404", rec.Code)
		}
	}

	after := read()
	if fmt.Sprint(before) != fmt.Sprint(after) {
		t.Errorf("owner row mutated by a cross-account write: before=%+v after=%+v", before, after)
	}
	if after.deleted {
		t.Error("owner row was soft-deleted by an attacker's DELETE")
	}
}

// TestIDOR_404BodyNeverLeaksOwnerFields asserts an IDOR 404 carries only an
// error envelope — no data, no address field of the owner's row.
func TestIDOR_404BodyNeverLeaksOwnerFields(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	req := httptest.NewRequest(http.MethodGet, "/v1/addresses/"+f.addressID, nil)
	req = withPrincipal(req, customerPrincipal(f.otherAccountID))
	rec := httptest.NewRecorder()
	h.GetAddress(rec, req, f.addressID)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status=%d, want 404", rec.Code)
	}
	body := rec.Body.String()
	// The owner's seeded values must not appear anywhere in the 404 body.
	for _, leak := range []string{"100 Test Street", "Home", "M4J 1M4", "America/Toronto"} {
		if bytes.Contains([]byte(body), []byte(leak)) {
			t.Errorf("IDOR 404 body leaks owner field %q: %s", leak, body)
		}
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err == nil {
		if _, ok := env["data"]; ok {
			t.Error("IDOR 404 must not carry a data field")
		}
	}
}

// ─── F) CONCURRENCY / IDEMPOTENCY ────────────────────────────────────────────

// TestConcurrency_SetDefaultTwice_ExactlyOneDefault runs setDefault on the same
// address twice; the result is idempotent and exactly one default remains.
func TestConcurrency_SetDefaultTwice_ExactlyOneDefault(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // f.addressID is default
	addr2 := seedAddress(t, pool, f.customerAccountID, false)
	h := newHandler(pool)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+addr2+"/default", nil)
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.SetDefaultAddress(rec, req, addr2)
		if rec.Code != http.StatusOK {
			t.Fatalf("setDefault iteration %d: status=%d (body: %s)", i, rec.Code, rec.Body.String())
		}
	}
	assertExactlyOneDefault(t, pool, f.customerAccountID, addr2)
}

// TestConcurrency_SetDefaultConcurrent_ExactlyOneDefault fires N concurrent
// setDefault calls across two addresses; the partial unique index guarantees at
// most one default survives, and there must be exactly one.
func TestConcurrency_SetDefaultConcurrent_ExactlyOneDefault(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool) // f.addressID default
	addr2 := seedAddress(t, pool, f.customerAccountID, false)
	h := newHandler(pool)

	targets := []string{f.addressID, addr2, f.addressID, addr2, f.addressID, addr2}
	var wg sync.WaitGroup
	for _, target := range targets {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/v1/addresses/"+id+"/default", nil)
			req = withPrincipal(req, customerPrincipal(f.customerAccountID))
			rec := httptest.NewRecorder()
			h.SetDefaultAddress(rec, req, id)
			// Concurrent writers may collide on the unique index; a failed one
			// returns 500 or 200 but must NEVER produce two defaults. We only
			// assert the invariant below, not each call's status.
		}(target)
	}
	wg.Wait()

	var defaultCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND is_default=true AND deleted_at IS NULL`,
		f.customerAccountID,
	).Scan(&defaultCount); err != nil {
		t.Fatalf("count defaults: %v", err)
	}
	if defaultCount != 1 {
		t.Errorf("after concurrent setDefault, expected exactly 1 default, got %d", defaultCount)
	}
}

func assertExactlyOneDefault(t *testing.T, pool *pgxpool.Pool, accountID, wantDefaultID string) {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE account_id=$1 AND is_default=true AND deleted_at IS NULL`,
		accountID,
	).Scan(&count); err != nil {
		t.Fatalf("count defaults: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 default, got %d", count)
	}
	var isDefault bool
	if err := pool.QueryRow(context.Background(),
		`SELECT is_default FROM address WHERE id=$1`, wantDefaultID,
	).Scan(&isDefault); err != nil {
		t.Fatalf("read want-default row: %v", err)
	}
	if !isDefault {
		t.Errorf("address %s should be the default", wantDefaultID)
	}
}

// TestIdempotency_DeleteTwice_SecondIs404 verifies deleting the same address
// twice does not double-effect: the first soft-deletes (204), the second finds
// nothing (404). No crash, no second deleted_at rewrite treated as success.
func TestIdempotency_DeleteTwice_SecondIs404(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	// Add a second address so deleting the default is allowed (not last default).
	_ = seedAddress(t, pool, f.customerAccountID, false)
	h := newHandler(pool)

	del := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/v1/addresses/"+f.addressID, nil)
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.DeleteAddress(rec, req, f.addressID)
		return rec
	}
	if rec := del(); rec.Code != http.StatusNoContent {
		t.Fatalf("first delete: status=%d, want 204 (body: %s)", rec.Code, rec.Body.String())
	}
	if rec := del(); rec.Code != http.StatusNotFound {
		t.Errorf("second delete: status=%d, want 404 (already gone)", rec.Code)
	}

	// Exactly one deleted_at, and it was not rewritten to a different value by
	// a spurious second soft-delete (row count check).
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM address WHERE id=$1 AND deleted_at IS NOT NULL`, f.addressID,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Errorf("expected exactly one soft-deleted row, got %d", n)
	}
}

// TestIdempotency_UpdateTwice_SameResult verifies PATCH is idempotent: applying
// the same partial update twice yields the same row.
func TestIdempotency_UpdateTwice_SameResult(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)

	upd := func() string {
		req := httptest.NewRequest(http.MethodPatch, "/v1/addresses/"+f.addressID,
			bytes.NewBufferString(`{"label":"Cottage","city":"Ottawa"}`))
		req.Header.Set("Content-Type", "application/json")
		req = withPrincipal(req, customerPrincipal(f.customerAccountID))
		rec := httptest.NewRecorder()
		h.UpdateAddress(rec, req, f.addressID)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: status=%d (body: %s)", rec.Code, rec.Body.String())
		}
		return rec.Body.String()
	}
	first := upd()
	second := upd()

	// Compare on the stable Address fields (updated_at is not in the DTO, so the
	// serialised bodies must be byte-identical).
	if first != second {
		t.Errorf("PATCH not idempotent:\n first=%s\nsecond=%s", first, second)
	}
}

// ─── G) ERROR TAXONOMY — no failure returns a non-contract code or a bare 500 ─

// TestErrorTaxonomy_AllFailurePathsUseContractCodes drives every reachable
// failure path and asserts the error.code is a member of the contract ErrorCode
// enum (allow-list) and the status is never 500.
func TestErrorTaxonomy_AllFailurePathsUseContractCodes(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	h := newHandler(pool)
	cust := customerPrincipal(f.customerAccountID)
	fakeID := "00000000-0000-4000-8000-0000000000ff"

	type probe struct {
		name string
		run  func() *httptest.ResponseRecorder
		want string // expected contract ErrorCode
	}
	probes := []probe{
		{
			name: "get/not-found",
			want: "NOT_FOUND",
			run: func() *httptest.ResponseRecorder {
				req := withPrincipal(httptest.NewRequest(http.MethodGet, "/v1/addresses/"+fakeID, nil), cust)
				rec := httptest.NewRecorder()
				h.GetAddress(rec, req, fakeID)
				return rec
			},
		},
		{
			name: "update/not-found",
			want: "NOT_FOUND",
			run: func() *httptest.ResponseRecorder {
				req := withPrincipal(httptest.NewRequest(http.MethodPatch, "/v1/addresses/"+fakeID,
					bytes.NewBufferString(`{"label":"x"}`)), cust)
				req.Header.Set("Content-Type", "application/json")
				rec := httptest.NewRecorder()
				h.UpdateAddress(rec, req, fakeID)
				return rec
			},
		},
		{
			name: "delete/not-found",
			want: "NOT_FOUND",
			run: func() *httptest.ResponseRecorder {
				req := withPrincipal(httptest.NewRequest(http.MethodDelete, "/v1/addresses/"+fakeID, nil), cust)
				rec := httptest.NewRecorder()
				h.DeleteAddress(rec, req, fakeID)
				return rec
			},
		},
		{
			name: "setDefault/not-found",
			want: "NOT_FOUND",
			run: func() *httptest.ResponseRecorder {
				req := withPrincipal(httptest.NewRequest(http.MethodPost, "/v1/addresses/"+fakeID+"/default", nil), cust)
				rec := httptest.NewRecorder()
				h.SetDefaultAddress(rec, req, fakeID)
				return rec
			},
		},
		{
			name: "create/unknown-field",
			want: "VALIDATION_FAILED",
			run: func() *httptest.ResponseRecorder {
				req := withPrincipal(httptest.NewRequest(http.MethodPost, "/v1/addresses",
					bytes.NewBufferString(`{"line1":"1 A St","city":"T","province":"ON","postal_code":"M4J 1M4","latitude":43.6,"longitude":-79.3,"evil":1}`)), cust)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXX")
				rec := httptest.NewRecorder()
				h.CreateAddress(rec, req)
				return rec
			},
		},
		{
			name: "create/malformed-json",
			want: "VALIDATION_FAILED",
			run: func() *httptest.ResponseRecorder {
				req := withPrincipal(httptest.NewRequest(http.MethodPost, "/v1/addresses",
					bytes.NewBufferString(`{not json`)), cust)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Idempotency-Key", "01HXXXXXXXXXXXXXXXXXXXXXXXXX")
				rec := httptest.NewRecorder()
				h.CreateAddress(rec, req)
				return rec
			},
		},
	}

	for _, p := range probes {
		rec := p.run()
		if rec.Code >= 500 {
			t.Errorf("%s: status=%d — a failure path returned a bare 5xx", p.name, rec.Code)
			continue
		}
		var env struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Errorf("%s: body is not an error envelope: %s", p.name, rec.Body.String())
			continue
		}
		if !contractErrorCodes[env.Error.Code] {
			t.Errorf("%s: error.code=%q is not a contract ErrorCode member (leak)", p.name, env.Error.Code)
		}
		if env.Error.Code == "INTERNAL_ERROR" {
			t.Errorf("%s: expected a typed domain error, got INTERNAL_ERROR", p.name)
		}
		if p.want != "" && env.Error.Code != p.want {
			t.Errorf("%s: error.code=%q, want %q", p.name, env.Error.Code, p.want)
		}
	}
}

// TestErrorTaxonomy_LimitCapUsesContractCode is the regression pin for the
// stage-3 leak: the 20-address cap must NOT emit the fabricated ADDRESS_LIMIT_HIT
// (absent from the contract enum). It must use a contract member.
func TestErrorTaxonomy_LimitCapUsesContractCode(t *testing.T) {
	pool := testPool(t)
	f := seedFixtures(t, pool)
	ctx := context.Background()

	for i := 0; i < 19; i++ {
		if _, err := pool.Exec(ctx, `
			INSERT INTO address (account_id, line1, city, province, postal_code, location, timezone)
			VALUES ($1, $2, 'Toronto', 'ON', 'M4J 1M4',
			        ST_SetSRID(ST_MakePoint(-79.3282, 43.6820), 4326)::geography, 'America/Toronto')`,
			f.customerAccountID, fmt.Sprintf("%d Cap St", i+1)); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}
	h := newHandler(pool)
	req := httptest.NewRequest(http.MethodPost, "/v1/addresses", bytes.NewBufferString(validCreateBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "01H00000000000000000000CAP1")
	req = withPrincipal(req, customerPrincipal(f.customerAccountID))
	rec := httptest.NewRecorder()
	h.CreateAddress(rec, req)

	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("unmarshal: %v (body: %s)", err, rec.Body.String())
	}
	if env.Error.Code == "ADDRESS_LIMIT_HIT" {
		t.Fatal("LEAK: 20-address cap emits fabricated ADDRESS_LIMIT_HIT (not in contract ErrorCode enum)")
	}
	if !contractErrorCodes[env.Error.Code] {
		t.Errorf("cap error.code=%q is not a contract ErrorCode member", env.Error.Code)
	}
	if rec.Code >= 500 {
		t.Errorf("cap returned a bare 5xx: %d", rec.Code)
	}
}
