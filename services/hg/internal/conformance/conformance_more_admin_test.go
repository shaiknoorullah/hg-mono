package conformance

// Additional admin-module conformance coverage (class: more-admin).
//
// This file extends the contract-conformance oracle to the admin WRITE surface
// the existing admin-rider-writes file did not reach: the halal issuing-body
// lifecycle (propose → set status), certificate transcription, KYC document
// review (restaurant + rider), admin menu-on-behalf creation, and menu-version
// decisions. It reuses the existing newARWHarness (which already wires the admin
// module) and the arwSeed* helpers (same package), and adds its own mad-prefixed
// seed helpers where a bespoke state is needed.
//
// For every op: a contract-valid request body is proven with ValidateRequest,
// then the live 2xx body is validated against contracts/openapi.yaml with
// ValidateResponse (the additionalProperties:false + required[] + closed-enum
// oracle). No hand-transcribed field list is involved.
//
// ops_not_2xx_here:
//   - cancelOrderAdmin — MONEY class; a 200 requires a seeded order in a
//     cancellable state whose cancel path (admin/store_orders.go) is under
//     concurrent edit for the media/join work. Its request body is proven
//     contract-valid (ValidateRequest records the op); the live call is issued
//     and asserted only to NOT be an unknown-field rejection. Documented, not
//     faked.

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── mad seed helpers (scoped to this file) ─────────────────────────────────

// madSeedPlainRestaurant inserts a minimal restaurant and returns its id. Enough
// for the admin menu-on-behalf and document-review routes, which only require
// the restaurant to exist.
func madSeedPlainRestaurant(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name)
VALUES ('mad-'||substr(md5(random()::text),1,10), 'MAD Kitchen Inc.', 'MAD Kitchen')
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("madSeedPlainRestaurant: %v", err)
	}
	return id
}

// madSeedRiderAccount inserts a rider account (RIDER role) and returns its id.
// Used as the subject_id of a rider KYC document.
func madSeedRiderAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (phone_e164, status)
VALUES ('+1'||lpad((floor(random()*900000000)+100000000)::bigint::text,9,'0'), 'ACTIVE')
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("madSeedRiderAccount: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO account_role (account_id, role, scope_type) VALUES ($1,'RIDER','GLOBAL')`, id); err != nil {
		t.Fatalf("madSeedRiderAccount role: %v", err)
	}
	return id
}

// madSeedStoredObject inserts a READY KYC stored object whose virus scan came
// back CLEAN — only such a file's document may be approved — and returns its id
// (the FK a kyc_document row requires).
func madSeedStoredObject(t *testing.T, ctx context.Context, pool *pgxpool.Pool, actorID string) string {
	t.Helper()
	return madSeedScannedObject(t, ctx, pool, actorID, "CLEAN")
}

// madSeedScannedObject is madSeedStoredObject with a chosen virus_scan_state.
func madSeedScannedObject(t *testing.T, ctx context.Context, pool *pgxpool.Pool, actorID, scan string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at, virus_scan_state)
VALUES ('hg-kyc','mad/'||md5(random()::text),'KYC_DOCUMENT','application/pdf',2048,
        decode(repeat('c3',32),'hex'),'READY',$1,now(),$2)
RETURNING id`, actorID, scan).Scan(&id); err != nil {
		t.Fatalf("madSeedStoredObject: %v", err)
	}
	return id
}

// madSeedKycDocument inserts a RESTAURANT KYC document in IN_REVIEW (on the
// review clock, per the deadline CHECK) and returns its id.
func madSeedKycDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, subjectType, subjectID, storedObjID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ($1::kyc_subject_type, $2, 'BUSINESS_LICENCE', $3, 'IN_REVIEW', now()+interval '72 hours', 'ESCALATE')
RETURNING id`, subjectType, subjectID, storedObjID).Scan(&id); err != nil {
		t.Fatalf("madSeedKycDocument: %v", err)
	}
	return id
}

// madSeedRiderKycDocument inserts a RIDER KYC document in IN_REVIEW and returns
// its id. The rider doc-type column (not the restaurant one) is set, per the
// kyc_document_type_shape CHECK.
func madSeedRiderKycDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, riderAcctID, storedObjID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ('RIDER', $1, 'DRIVERS_LICENCE', $2, 'IN_REVIEW', now()+interval '72 hours', 'ESCALATE')
RETURNING id`, riderAcctID, storedObjID).Scan(&id); err != nil {
		t.Fatalf("madSeedRiderKycDocument: %v", err)
	}
	return id
}

// madSeedPendingMenuVersion inserts a menu_category, a menu_item and a
// PENDING_REVIEW menu_item_version under the restaurant, and returns the version
// id — the row decideMenuVersion transitions.
func madSeedPendingMenuVersion(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restaurantID string) string {
	t.Helper()
	var categoryID string
	if err := pool.QueryRow(ctx, `
INSERT INTO menu_category (restaurant_id, name) VALUES ($1, 'MAD Review Cat') RETURNING id`,
		restaurantID).Scan(&categoryID); err != nil {
		t.Fatalf("madSeedPendingMenuVersion category: %v", err)
	}
	var itemID string
	if err := pool.QueryRow(ctx, `
INSERT INTO menu_item (restaurant_id, category_id, price_cents, availability_state, tax_category)
VALUES ($1, $2, 1200, 'AVAILABLE', 'PREPARED_FOOD') RETURNING id`,
		restaurantID, categoryID).Scan(&itemID); err != nil {
		t.Fatalf("madSeedPendingMenuVersion item: %v", err)
	}
	var versionID string
	if err := pool.QueryRow(ctx, `
INSERT INTO menu_item_version (menu_item_id, restaurant_id, version, name, review_status, submitted_at)
VALUES ($1, $2, 1, 'MAD Pending Dish', 'PENDING_REVIEW', now())
RETURNING id`, itemID, restaurantID).Scan(&versionID); err != nil {
		t.Fatalf("madSeedPendingMenuVersion version: %v", err)
	}
	// Point the item's pending_version_id at the seeded version so the approve
	// path's live/pending bookkeeping is coherent.
	if _, err := pool.Exec(ctx,
		`UPDATE menu_item SET pending_version_id=$1 WHERE id=$2`, versionID, itemID); err != nil {
		t.Fatalf("madSeedPendingMenuVersion link: %v", err)
	}
	return versionID
}

// ─── tests ──────────────────────────────────────────────────────────────────

// TestConformance_MoreAdmin_IssuingBodies covers proposeHalalIssuingBody and
// setHalalIssuingBodyStatus. Propose creates a PROPOSED body (201); the returned
// id is then transitioned via setHalalIssuingBodyStatus (200). Both request
// bodies are proven contract-valid first.
func TestConformance_MoreAdmin_IssuingBodies(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	ctx := context.Background()
	saID := arwSeedSuperAdmin(t, ctx, pool)

	// proposeHalalIssuingBody — 201 HalalIssuingBody.
	proposeBody := map[string]any{
		"name":          fmt.Sprintf("MAD Halal Authority %d", time.Now().UnixNano()%1_000_000),
		"aliases":       []string{"MHA"},
		"country":       "CA",
		"justification": "Conformance probe: a well-established Canadian halal certifier proposed for the registry.",
	}
	proposeRq := Request{
		Method: "POST", Path: "/v1/admin/halal-issuing-bodies",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-propose-%d", time.Now().UnixNano()),
		Body:    proposeBody,
	}
	req := h.Build(t, proposeRq)
	opID, verr := ValidateRequest(t, h.Spec, req)
	h.MarkCovered(opID)
	if verr != nil {
		t.Fatalf("proposeHalalIssuingBody body not contract-valid (fix the test): %v", verr)
	}
	_, resp := h.Do(t, proposeRq)
	defer resp.Body.Close()
	if id, err := ValidateResponse(t, h.Spec, req, resp); err != nil {
		t.Errorf("CONFORMANCE FAIL (proposeHalalIssuingBody): %v", err)
	} else {
		h.MarkCovered(id)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("proposeHalalIssuingBody status = %d, want 201", resp.StatusCode)
	}
	bodyID, _ := dataObject(t, resp)["id"].(string)
	if bodyID == "" {
		t.Fatalf("proposeHalalIssuingBody: empty id in response")
	}

	// setHalalIssuingBodyStatus — 200 HalalIssuingBody. A super admin may accept
	// a proposed body.
	statusRq := Request{
		Method: "POST", Path: "/v1/admin/halal-issuing-bodies/" + bodyID + "/status",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-setstatus-%d", time.Now().UnixNano()),
		Body: map[string]any{
			"status":        "ACCEPTED",
			"justification": "Conformance probe: verified accreditation and accepting into the registry.",
		},
	}
	sreq := h.Build(t, statusRq)
	sopID, sverr := ValidateRequest(t, h.Spec, sreq)
	h.MarkCovered(sopID)
	if sverr != nil {
		t.Fatalf("setHalalIssuingBodyStatus body not contract-valid (fix the test): %v", sverr)
	}
	h.CheckResponse(t, statusRq, http.StatusOK)
}

// TestConformance_MoreAdmin_Transcribe covers transcribeHalalCertificate. The
// PENDING certificate arwSeedHalalCert seeds (with its ACCEPTED issuing body) is
// transcribed; the response HalalCertificate is validated.
func TestConformance_MoreAdmin_Transcribe(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	ctx := context.Background()
	saID := arwSeedSuperAdmin(t, ctx, pool)
	certID, bodyID := arwSeedHalalCert(t, ctx, pool, saID)

	body := map[string]any{
		"certificate_number":   fmt.Sprintf("MAD-CERT-%d", time.Now().UnixNano()%1_000_000),
		"issuing_body_id":      bodyID,
		"certified_legal_name": "MAD Kitchen Inc.",
		"certified_address":    "99 Test Ave, Toronto, ON",
		"scope":                "WHOLE_ESTABLISHMENT",
		"issued_on":            time.Now().AddDate(0, -2, 0).Format("2006-01-02"),
		"expires_on":           time.Now().AddDate(1, 0, 0).Format("2006-01-02"),
	}
	rq := Request{
		Method: "PUT", Path: "/v1/admin/halal-certificates/" + certID + "/transcription",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-transcribe-%d", time.Now().UnixNano()),
		Body:    body,
	}
	req := h.Build(t, rq)
	opID, verr := ValidateRequest(t, h.Spec, req)
	h.MarkCovered(opID)
	if verr != nil {
		t.Fatalf("transcribeHalalCertificate body not contract-valid (fix the test): %v", verr)
	}
	h.CheckResponse(t, rq, http.StatusOK)
}

// TestConformance_MoreAdmin_DocumentReview covers reviewRestaurantDocument and
// reviewRiderDocument. A KYC document in IN_REVIEW state is seeded for each
// subject family and APPROVED; the 200 KycDocument body is validated.
func TestConformance_MoreAdmin_DocumentReview(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	ctx := context.Background()
	saID := arwSeedSuperAdmin(t, ctx, pool)

	// Restaurant document.
	t.Run("reviewRestaurantDocument", func(t *testing.T) {
		restaurantID := madSeedPlainRestaurant(t, ctx, pool)
		storedObjID := madSeedStoredObject(t, ctx, pool, saID)
		docID := madSeedKycDocument(t, ctx, pool, "RESTAURANT", restaurantID, storedObjID)

		rq := Request{
			Method: "POST", Path: "/v1/admin/restaurant-documents/" + docID + "/review",
			AccountID: saID, Roles: []string{roleSuperAdmin},
			IdemKey: fmt.Sprintf("mad-revrest-%d", time.Now().UnixNano()),
			Body:    map[string]any{"decision": "APPROVE"},
		}
		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("reviewRestaurantDocument body not contract-valid (fix the test): %v", verr)
		}
		h.CheckResponse(t, rq, http.StatusOK)
	})

	// Rider document.
	t.Run("reviewRiderDocument", func(t *testing.T) {
		riderAcctID := madSeedRiderAccount(t, ctx, pool)
		storedObjID := madSeedStoredObject(t, ctx, pool, saID)
		docID := madSeedRiderKycDocument(t, ctx, pool, riderAcctID, storedObjID)

		rq := Request{
			Method: "POST", Path: "/v1/admin/rider-documents/" + docID + "/review",
			AccountID: saID, Roles: []string{roleSuperAdmin},
			IdemKey: fmt.Sprintf("mad-revrider-%d", time.Now().UnixNano()),
			Body:    map[string]any{"decision": "APPROVE"},
		}
		req := h.Build(t, rq)
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("reviewRiderDocument body not contract-valid (fix the test): %v", verr)
		}
		h.CheckResponse(t, rq, http.StatusOK)
	})

	// A document whose file has not been virus-scanned clean — still pending,
	// or infected — is refused with 409, never approved
	// (spec: docs/spec/01-platform.md#p-28--presigned-upload-and-download).
	for _, scan := range []string{"PENDING", "INFECTED"} {
		t.Run("reviewRestaurantDocument refuses a "+scan+" file", func(t *testing.T) {
			restaurantID := madSeedPlainRestaurant(t, ctx, pool)
			storedObjID := madSeedScannedObject(t, ctx, pool, saID, scan)
			docID := madSeedKycDocument(t, ctx, pool, "RESTAURANT", restaurantID, storedObjID)

			rq := Request{
				Method: "POST", Path: "/v1/admin/restaurant-documents/" + docID + "/review",
				AccountID: saID, Roles: []string{roleSuperAdmin},
				IdemKey: fmt.Sprintf("mad-revscan-%d", time.Now().UnixNano()),
				Body:    map[string]any{"decision": "APPROVE"},
			}
			h.CheckResponse(t, rq, http.StatusConflict)
			var state string
			if err := pool.QueryRow(ctx, `SELECT state::text FROM kyc_document WHERE id=$1`, docID).Scan(&state); err != nil {
				t.Fatalf("read document: %v", err)
			}
			if state != "IN_REVIEW" {
				t.Errorf("document state = %s after a refused approval, want IN_REVIEW", state)
			}
		})
	}
}

// TestConformance_MoreAdmin_MenuOnBehalf covers createMenuCategoryOnBehalf,
// createMenuItemOnBehalf and decideMenuVersion. The category and item are
// created through the admin-on-behalf routes; the menu-version decision runs
// against a seeded PENDING_REVIEW version.
func TestConformance_MoreAdmin_MenuOnBehalf(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	ctx := context.Background()
	saID := arwSeedSuperAdmin(t, ctx, pool)
	restaurantID := madSeedPlainRestaurant(t, ctx, pool)

	// createMenuCategoryOnBehalf — 201 MenuCategory.
	catBody := map[string]any{
		"name":        fmt.Sprintf("MAD Mains %d", time.Now().UnixNano()%1_000_000),
		"description": "Conformance probe category.",
	}
	catRq := Request{
		Method: "POST", Path: "/v1/admin/restaurants/" + restaurantID + "/menu/categories",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-cat-%d", time.Now().UnixNano()),
		Body:    catBody,
	}
	catReq := h.Build(t, catRq)
	catOpID, catVerr := ValidateRequest(t, h.Spec, catReq)
	h.MarkCovered(catOpID)
	if catVerr != nil {
		t.Fatalf("createMenuCategoryOnBehalf body not contract-valid (fix the test): %v", catVerr)
	}
	_, catResp := h.Do(t, catRq)
	defer catResp.Body.Close()
	if id, err := ValidateResponse(t, h.Spec, catReq, catResp); err != nil {
		t.Errorf("CONFORMANCE FAIL (createMenuCategoryOnBehalf): %v", err)
	} else {
		h.MarkCovered(id)
	}
	if catResp.StatusCode != http.StatusCreated {
		t.Fatalf("createMenuCategoryOnBehalf status = %d, want 201", catResp.StatusCode)
	}
	categoryID, _ := dataObject(t, catResp)["id"].(string)
	if categoryID == "" {
		t.Fatalf("createMenuCategoryOnBehalf: empty category id")
	}

	// createMenuItemOnBehalf — 201 MenuItemOwnerView.
	itemBody := map[string]any{
		"category_id":   categoryID,
		"name":          "MAD Chicken Shawarma",
		"price_cents":   1499,
		"dietary_tags":  []string{},
		"allergen_tags": []string{},
	}
	itemRq := Request{
		Method: "POST", Path: "/v1/admin/restaurants/" + restaurantID + "/menu/items",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-item-%d", time.Now().UnixNano()),
		Body:    itemBody,
	}
	itemReq := h.Build(t, itemRq)
	itemOpID, itemVerr := ValidateRequest(t, h.Spec, itemReq)
	h.MarkCovered(itemOpID)
	if itemVerr != nil {
		t.Fatalf("createMenuItemOnBehalf body not contract-valid (fix the test): %v", itemVerr)
	}
	h.CheckResponse(t, itemRq, http.StatusCreated)

	// decideMenuVersion — 200 MenuItemVersion. Seed a PENDING_REVIEW version.
	versionID := madSeedPendingMenuVersion(t, ctx, pool, restaurantID)
	decRq := Request{
		Method: "POST", Path: "/v1/admin/menu-reviews/" + versionID + "/decision",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-decidever-%d", time.Now().UnixNano()),
		Body:    map[string]any{"decision": "APPROVE"},
	}
	decReq := h.Build(t, decRq)
	decOpID, decVerr := ValidateRequest(t, h.Spec, decReq)
	h.MarkCovered(decOpID)
	if decVerr != nil {
		t.Fatalf("decideMenuVersion body not contract-valid (fix the test): %v", decVerr)
	}
	h.CheckResponse(t, decRq, http.StatusOK)
}

// TestConformance_MoreAdmin_CancelOrderAdmin proves the cancelOrderAdmin request
// body is contract-valid (recording the op) and that the handler does not reject
// the contract field names with an unknown-field 400/422. A 2xx is NOT asserted:
// it requires a seeded order in a cancellable state whose cancel path
// (admin/store_orders.go) is under concurrent edit — documented, not faked.
func TestConformance_MoreAdmin_CancelOrderAdmin(t *testing.T) {
	pool := openPool(t)
	h := newARWHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	ctx := context.Background()
	saID := arwSeedSuperAdmin(t, ctx, pool)

	rq := Request{
		Method: "POST",
		// A well-formed but non-existent order id: the handler validates the body
		// first, so a 404/409 here still proves the DTO field names are accepted.
		Path:      "/v1/admin/orders/00000000-0000-4000-8000-00000000ca01/cancel",
		AccountID: saID, Roles: []string{roleSuperAdmin},
		IdemKey: fmt.Sprintf("mad-cancel-%d", time.Now().UnixNano()),
		Body: map[string]any{
			"reason_code": "SUPPORT_CANCELLED",
			"reason_text": "Conformance probe: support-initiated cancellation.",
			"case_id":     "00000000-0000-4000-8000-00000000ca02",
		},
	}
	req := h.Build(t, rq)
	opID, verr := ValidateRequest(t, h.Spec, req)
	h.MarkCovered(opID)
	if verr != nil {
		t.Fatalf("cancelOrderAdmin body not contract-valid (fix the test): %v", verr)
	}
	_, resp := h.Do(t, rq)
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusBadRequest || resp.StatusCode == http.StatusUnprocessableEntity {
		env := mustJSONMap(t, resp)
		code := ""
		if e, ok := env["error"].(map[string]any); ok {
			code, _ = e["code"].(string)
		}
		if code == "UNKNOWN_FIELD" || code == "VALIDATION_FAILED" {
			t.Errorf("INPUT DRIFT: cancelOrderAdmin rejected a contract-valid body with %d %s (%v)",
				resp.StatusCode, code, env)
		}
	}
	// If the handler surprises us with a 200 (e.g. a wired cancel path lands),
	// validate that body too — never leave a reachable 2xx unchecked.
	if resp.StatusCode == http.StatusOK {
		if _, err := ValidateResponse(t, h.Spec, req, resp); err != nil {
			t.Errorf("CONFORMANCE FAIL (cancelOrderAdmin 200): %v", err)
		}
	}
}
