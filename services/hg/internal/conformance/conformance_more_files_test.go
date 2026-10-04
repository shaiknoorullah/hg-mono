package conformance

// Files/uploads + catalog-discovery conformance — class: more-files.
//
// This file closes the loop on the object-store and discovery surfaces the core
// harness leaves open. It stands up its OWN in-process server (like the payments
// file) wiring catalog + files with STUB presigners and a stub object store, so
// no live MinIO is required: the presigners fabricate a URL, and confirmUpload is
// exercised via its state=READY idempotent short-circuit (which returns the
// stored object without touching the object store).
//
// Operations covered here:
//
//	getHomeFeed               GET  /v1/feed
//	search                    GET  /v1/search
//	getRestaurantCertification GET /v1/restaurants/{restaurantId}/certification
//	createCertificateViewUrl  POST /v1/restaurants/{restaurantId}/certificate-url
//	createUpload              POST /v1/uploads
//	confirmUpload             POST /v1/uploads/{uploadId}/confirm
//	createDocumentDownloadUrl GET  /v1/documents/{documentId}/download-url
//
// Every 2xx body is validated against contracts/openapi.yaml via the shared
// ValidateResponse oracle; write bodies are additionally ValidateRequest-checked.

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/catalog"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/files"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── stub presigners / object store (no live MinIO) ──────────────────────────

// mfCatalogPresigner implements catalog.Presigner. The certificate-view route
// needs only a URL minted for a private object; a stub proves the handler wires
// the presigner and renders the PresignedDownload body without a live MinIO.
type mfCatalogPresigner struct{}

func (mfCatalogPresigner) PresignGet(_ context.Context, _, _ string, _ time.Duration) (string, time.Time, error) {
	return "https://stub.local/certificate", time.Now().UTC().Add(5 * time.Minute), nil
}

// mfFilesPresigner implements files.Presigner (PUT + GET presign).
type mfFilesPresigner struct{}

func (mfFilesPresigner) PresignHeader(_ context.Context, _, _, _ string, _ time.Duration, _ url.Values, _ http.Header) (*url.URL, error) {
	return url.Parse("https://stub.local/put")
}

func (mfFilesPresigner) PresignedGetObject(_ context.Context, _, _ string, _ time.Duration, _ url.Values) (*url.URL, error) {
	return url.Parse("https://stub.local/get")
}

// mfObjectStore implements files.ObjectStore. It is non-nil (so confirmUpload
// does not answer 503 on the honest-unwired path). The confirmUpload test drives
// the state=READY idempotent short-circuit, which never touches the store; the
// download-url test reads mfKycBytes back, because a download is issued only
// while the stored bytes still match the confirmed SHA-256.
type mfObjectStore struct{}

func (mfObjectStore) Stat(context.Context, string, string) (files.ObjectStat, error) {
	return files.ObjectStat{Size: int64(len(mfKycBytes))}, nil
}
func (mfObjectStore) Open(context.Context, string, string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(mfKycBytes)), nil
}
func (mfObjectStore) Remove(context.Context, string, string) error { return nil }

// mfKycBytes is the content of every object the stub store serves.
var mfKycBytes = []byte("%PDF-1.7 a scanned KYC document")

// mfBuckets returns the P-27 bucket names the files module keys objects under.
func mfBuckets() files.Buckets {
	return files.Buckets{KYC: "hg-kyc", POD: "hg-pod", Media: "hg-media", Exports: "hg-exports", Tmp: "hg-tmp"}
}

// ─── harness ─────────────────────────────────────────────────────────────────

// mfNewHarness stands up catalog + files with the stub presigners/object store.
func mfNewHarness(t *testing.T, pool *pgxpool.Pool) *Harness {
	t.Helper()
	spec := LoadSpec(t)

	router := httpx.NewRouter(httpx.Options{
		Env:           "local",
		Authenticator: testAuthenticator{},
		Authorizer:    authMatrix(),
	})

	catalogRepo := catalog.NewRepo(pool)
	catalog.Routes(router, catalog.NewHandler(
		catalogRepo, nil, mfCatalogPresigner{}, catalog.NewPgScopeResolver(catalogRepo)))

	files.Routes(router, files.NewHandler(files.NewRepo(pool, mfFilesPresigner{}, mfObjectStore{}, mfBuckets())))

	if err := router.Verify(); err != nil {
		t.Fatalf("mf harness router verify: %v", err)
	}

	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return &Harness{Pool: pool, Server: srv, Spec: spec, covered: map[string]bool{}}
}

// ─── seed helpers ────────────────────────────────────────────────────────────

// mfSeedCertifiedRestaurant seeds a fully APPROVED, VISIBLE, certified restaurant
// (account_state LIVE, halal_status CERTIFIED via the derive trigger) with a
// certificate document backed by a READY stored object, so createCertificateViewUrl
// resolves a certificate object rather than 404ing. It is built in one transaction
// because the halal approval-complete constraint is DEFERRABLE INITIALLY DEFERRED:
// the seven PASS checks and the APPROVED certificate must land in the same tx.
func mfSeedCertifiedRestaurant(t *testing.T, pool *pgxpool.Pool, actorID string) (restaurantID string) {
	t.Helper()
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant begin: %v", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()

	if err := tx.QueryRow(ctx, `
INSERT INTO restaurant (slug, legal_name, display_name, line1, city, province, postal_code,
                        location, timezone, onboarding_state, account_state, is_accepting_orders,
                        commission_rate_bps)
VALUES ('mf-'||substr(md5(random()::text),1,8), 'MF Certified Inc.', 'MF Certified Kitchen',
        '10 Halal St', 'Toronto', 'ON', 'M4J1M1',
        ST_SetSRID(ST_MakePoint(-79.3332, 43.6810), 4326)::geography, 'America/Toronto',
        'ACTIVE', 'LIVE', true, 0)
RETURNING id`).Scan(&restaurantID); err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant restaurant: %v", err)
	}

	var bodyID string
	if err := tx.QueryRow(ctx, `
INSERT INTO halal_issuing_body (name, country, status, decided_by, decided_at)
VALUES ('MF HMA '||substr(md5(random()::text),1,6), 'CA', 'ACCEPTED', $1, now())
RETURNING id`, actorID).Scan(&bodyID); err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant issuing body: %v", err)
	}

	var storedObjID string
	if err := tx.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, uploaded_by, confirmed_at)
VALUES ('hg-kyc','mf/'||md5(random()::text),'KYC_DOCUMENT','application/pdf',2048,
        decode(repeat('c3',32),'hex'),'READY',$1,now())
RETURNING id`, actorID).Scan(&storedObjID); err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant stored_object: %v", err)
	}

	var docID string
	if err := tx.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, restaurant_doc_type, stored_object_id, halal_issuing_body_id, state, deadline_at, deadline_action)
VALUES ('RESTAURANT',$1,'HALAL_CERTIFICATE',$2,$3,'IN_REVIEW',now()+interval '72 hours','ESCALATE')
RETURNING id`, restaurantID, storedObjID, bodyID).Scan(&docID); err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant kyc_document: %v", err)
	}

	var certID string
	if err := tx.QueryRow(ctx, `
INSERT INTO halal_certificate
  (restaurant_id, document_id, certificate_number, issuing_body_id, certified_legal_name,
   certified_address, scope, issued_on, expires_on, status, checklist_version, verified_by, verified_at)
VALUES ($1,$2,'MF-'||substr(md5(random()::text),1,8),$3,'MF Certified Inc.',
        '10 Halal St Toronto','WHOLE_ESTABLISHMENT',current_date-60,current_date+305,'APPROVED',1,$4,now())
RETURNING id`, restaurantID, docID, bodyID, actorID).Scan(&certID); err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant certificate: %v", err)
	}

	// The seven checks, all PASS. H5/H7 are the hard computed flags and must be
	// non-overridable (overridable=false), which requires result=computed_result;
	// PASS=PASS satisfies that. Any assessed result requires checked_by/checked_at.
	checks := []struct {
		key         string
		overridable bool
	}{
		{"H1_LEGIBLE_COMPLETE", true},
		{"H2_ISSUER_ACCEPTED", true},
		{"H3_NAME_MATCH", true},
		{"H4_ADDRESS_MATCH", true},
		{"H5_DATES_VALID", false},
		{"H6_SCOPE_SUFFICIENT", true},
		{"H7_UNIQUE_NOT_REUSED", false},
	}
	for _, c := range checks {
		if _, err := tx.Exec(ctx, `
INSERT INTO halal_certificate_check
  (halal_certificate_id, check_key, result, computed_result, overridable, checked_by, checked_at)
VALUES ($1, $2::halal_check_key, 'PASS', 'PASS', $3, $4, now())`,
			certID, c.key, c.overridable, actorID); err != nil {
			t.Fatalf("mfSeedCertifiedRestaurant check %s: %v", c.key, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("mfSeedCertifiedRestaurant commit: %v", err)
	}
	committed = true

	t.Cleanup(func() {
		bg := context.Background()
		// Deleting the certificate fires the sync trigger, which NULLs the
		// restaurant's halal_certificate_id; then the restaurant can be removed.
		_, _ = pool.Exec(bg, `UPDATE restaurant SET halal_certificate_id=NULL WHERE id=$1`, restaurantID)
		_, _ = pool.Exec(bg, `DELETE FROM halal_certificate_check WHERE halal_certificate_id=$1`, certID)
		_, _ = pool.Exec(bg, `DELETE FROM halal_certificate WHERE id=$1`, certID)
		_, _ = pool.Exec(bg, `DELETE FROM kyc_document WHERE id=$1`, docID)
		_, _ = pool.Exec(bg, `DELETE FROM stored_object WHERE id=$1`, storedObjID)
		_, _ = pool.Exec(bg, `DELETE FROM halal_issuing_body WHERE id=$1`, bodyID)
		_, _ = pool.Exec(bg, `DELETE FROM restaurant WHERE id=$1`, restaurantID)
	})
	return restaurantID
}

// mfSeedReadyObject inserts a READY stored_object owned by ownerID and returns
// its id — the confirmUpload READY short-circuit reads it back idempotently.
func mfSeedReadyObject(t *testing.T, pool *pgxpool.Pool, ownerID string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, owner_account_id, uploaded_by, confirmed_at)
VALUES ('hg-kyc','mf/'||md5(random()::text),'KYC_DOCUMENT','application/pdf',2048,
        decode(repeat('d4',32),'hex'),'READY',$1,$1,now())
RETURNING id`, ownerID).Scan(&id); err != nil {
		t.Fatalf("mfSeedReadyObject: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM stored_object WHERE id=$1`, id) })
	return id
}

// mfSeedKycDocument inserts a READY, virus-scanned CLEAN stored_object holding
// mfKycBytes + a kyc_document for a RIDER subject (subject_id = ownerID) and
// returns the document id — the target of createDocumentDownloadUrl. A SUPER_ADMIN caller (canReadAny) bypasses ownership.
func mfSeedKycDocument(t *testing.T, pool *pgxpool.Pool, subjectAccountID string) string {
	t.Helper()
	ctx := context.Background()
	var storedID string
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object (bucket, object_key, purpose, content_type, byte_size, sha256, state, owner_account_id, uploaded_by, confirmed_at,
                           virus_scan_state, virus_scan_sha256, virus_scan_version)
VALUES ('hg-kyc','mf/'||md5(random()::text),'KYC_DOCUMENT','application/pdf',$2,
        digest($3::bytea,'sha256'),'READY',$1,$1,now(),'CLEAN',digest($3::bytea,'sha256'),1)
RETURNING id`, subjectAccountID, len(mfKycBytes), mfKycBytes).Scan(&storedID); err != nil {
		t.Fatalf("mfSeedKycDocument stored_object: %v", err)
	}
	var docID string
	if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state, deadline_at, deadline_action)
VALUES ('RIDER',$1,'DRIVERS_LICENCE',$2,'IN_REVIEW',now()+interval '72 hours','ESCALATE')
RETURNING id`, subjectAccountID, storedID).Scan(&docID); err != nil {
		t.Fatalf("mfSeedKycDocument kyc_document: %v", err)
	}
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = pool.Exec(bg, `DELETE FROM kyc_document WHERE id=$1`, docID)
		_, _ = pool.Exec(bg, `DELETE FROM stored_object WHERE id=$1`, storedID)
	})
	return docID
}

// ─── tests ───────────────────────────────────────────────────────────────────

// TestConformance_MoreFiles_CatalogDiscovery covers getHomeFeed, search,
// getRestaurantCertification and createCertificateViewUrl.
func TestConformance_MoreFiles_CatalogDiscovery(t *testing.T) {
	pool := openPool(t)
	h := mfNewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	t.Run("getHomeFeed", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/feed",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
			Query: "latitude=43.6532&longitude=-79.3832"}, 200)
	})

	t.Run("search", func(t *testing.T) {
		h.CheckResponse(t, Request{Method: "GET", Path: "/v1/search",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
			Query: "q=biryani&latitude=43.6532&longitude=-79.3832"}, 200)
	})

	t.Run("getRestaurantCertification", func(t *testing.T) {
		// fxRestaurantID exists; the certification panel is emitted regardless of
		// whether a viewable certificate is attached (viewable=false is legal).
		h.CheckResponse(t, Request{Method: "GET",
			Path:      "/v1/restaurants/" + fxRestaurantID + "/certification",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200)
	})

	t.Run("createCertificateViewUrl", func(t *testing.T) {
		// getCertificateObject joins through the visible-restaurant predicate, so
		// the target must be a LIVE, halal-CERTIFIED restaurant with a certificate
		// document backed by a stored object. Seed exactly that.
		restaurantID := mfSeedCertifiedRestaurant(t, pool, fxSuperAdminID)
		h.CheckResponse(t, Request{Method: "POST",
			Path:      "/v1/restaurants/" + restaurantID + "/certificate-url",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}}, 200)
	})
}

// TestConformance_MoreFiles_Uploads covers createUpload, confirmUpload and
// createDocumentDownloadUrl.
func TestConformance_MoreFiles_Uploads(t *testing.T) {
	pool := openPool(t)
	h := mfNewHarness(t, pool)
	t.Cleanup(func() { writeCoverage(t, h) })

	// ── createUpload ── (KYC PDF; server allocates the object and stub-presigns.)
	t.Run("createUpload", func(t *testing.T) {
		body := map[string]any{
			"purpose":      "KYC_DOCUMENT",
			"content_type": "application/pdf",
			"byte_size":    2048,
			"sha256":       strings.Repeat("a", 64),
			"order_id":     nil,
		}
		idemKey := "mf-create-upload-000001"

		req := h.Build(t, Request{Method: "POST", Path: "/v1/uploads",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}, Body: body, IdemKey: idemKey})
		opID, verr := ValidateRequest(t, h.Spec, req)
		h.MarkCovered(opID)
		if verr != nil {
			t.Fatalf("createUpload body is not contract-valid (fix the test, not the server): %v", verr)
		}

		h.CheckResponse(t, Request{Method: "POST", Path: "/v1/uploads",
			AccountID: fxCustomerID, Roles: []string{roleCustomer}, Body: body, IdemKey: idemKey}, 201)
	})

	// ── confirmUpload ── (READY object → idempotent 200 StoredObject.)
	t.Run("confirmUpload", func(t *testing.T) {
		uploadID := mfSeedReadyObject(t, pool, fxCustomerID)
		h.CheckResponse(t, Request{Method: "POST",
			Path:      "/v1/uploads/" + uploadID + "/confirm",
			AccountID: fxCustomerID, Roles: []string{roleCustomer},
			IdemKey: "mf-confirm-upload-00001"}, 200)
	})

	// ── createDocumentDownloadUrl ── (SUPER_ADMIN bypasses ownership.)
	t.Run("createDocumentDownloadUrl", func(t *testing.T) {
		docID := mfSeedKycDocument(t, pool, fxCustomerID)
		h.CheckResponse(t, Request{Method: "GET",
			Path:      "/v1/documents/" + docID + "/download-url",
			AccountID: fxSuperAdminID, Roles: []string{roleSuperAdmin}}, 200)
	})
}
