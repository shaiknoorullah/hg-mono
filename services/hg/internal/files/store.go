package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when an object or document row does not exist.
var ErrNotFound = errors.New("files: not found")

// ErrNotScannedClean is returned when a download is asked for a document whose
// file the virus scanner has not passed: still pending, infected, too large or
// unscannable, or found changed since its scan. No URL is minted for it
// (https://github.com/shaiknoorullah/hg-mono/issues/218).
var ErrNotScannedClean = errors.New("files: file not virus-scanned clean")

// Presigner is the narrow slice of the MinIO client this module needs. Keeping
// it an interface means the key/DB logic is unit-testable without a live MinIO,
// and the presign call itself is a thin, mockable seam.
//
// The implementation is store.MinIO.Signer, configured for the public host
// phones reach — never the internal client, whose links name minio:9000.
// Uploads are signed with PresignHeader only: PresignedPutObject signs the Host
// header alone, which lets one link upload any bytes of any size and type.
type Presigner interface {
	PresignHeader(ctx context.Context, method, bucket, object string, expires time.Duration, reqParams url.Values, extraHeaders http.Header) (*url.URL, error)
	PresignedGetObject(ctx context.Context, bucket, object string, expires time.Duration, reqParams url.Values) (*url.URL, error)
}

// uploadTTL is how long a presigned upload link lives (docs/spec/01-platform.md,
// "P-28 — Presigned upload and download").
const uploadTTL = 300 * time.Second

// Repo is the files module's data access plus the object presigner and the
// object-store seam confirmUpload needs. It never opens its own pool or client —
// both are the shared ones from store.Open.
type Repo struct {
	pool      *pgxpool.Pool
	presigner Presigner
	objects   ObjectStore
	buckets   Buckets
}

// NewRepo builds the repository. objects may be nil, in which case confirmUpload
// answers 503 rather than marking an object READY it never verified.
func NewRepo(pool *pgxpool.Pool, presigner Presigner, objects ObjectStore, buckets Buckets) *Repo {
	return &Repo{pool: pool, presigner: presigner, objects: objects, buckets: buckets}
}

// storedObjectRow is the stored_object projection.
type storedObjectRow struct {
	ID           string
	Purpose      string
	State        string
	ContentType  string
	ByteSize     int64
	RejectReason *string
}

// AllocateUpload inserts a PENDING stored_object with a server-generated key and
// a one-hour deadline, then returns a presigned PUT whose TTL is 300 s (P-28).
// The signature binds the object key, the content type, the length and the
// checksum; the client supplies only the bytes, and only the declared ones.
// Reusing the link after confirm or after the virus scan therefore cannot
// swap the file (https://github.com/shaiknoorullah/hg-mono/issues/218).
func (r *Repo) AllocateUpload(ctx context.Context, actor Actor, p Purpose, in keyInputs, contentType string, byteSize int64, sha256hex string) (uploadResult, error) {
	var out uploadResult
	bucket, ok := bucketFor(p, r.buckets)
	if !ok {
		return out, errBadPurpose
	}
	key, err := buildKey(p, in, contentType)
	if err != nil {
		return out, errBadContentType
	}

	sha, err := hexDecode(sha256hex)
	if err != nil {
		return out, errBadChecksum
	}

	err = inTx(ctx, r.pool, func(tx pgx.Tx) error {
		const ins = `
INSERT INTO stored_object
  (bucket, object_key, purpose, owner_account_id, restaurant_id, order_id,
   content_type, byte_size, sha256, state, uploaded_by,
   deadline_at, deadline_action)
VALUES
  ($1, $2, $3::stored_object_purpose, $4, $5, $6,
   $7, $8, $9, 'PENDING', $10,
   now() + interval '1 hour', 'DELETE_UNCONFIRMED')
RETURNING id`
		var restaurantID, orderID any
		if in.subjectType == "RESTAURANT" && in.subjectID != "" {
			restaurantID = in.subjectID
		}
		if in.orderID != "" {
			orderID = in.orderID
		}
		var owner any
		if actor.AccountID != "" {
			owner = actor.AccountID
		}
		if err := tx.QueryRow(ctx, ins, bucket, key, string(p), owner, restaurantID, orderID,
			contentType, byteSize, sha, owner).Scan(&out.UploadID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return out, err
	}

	u, headers, err := presignUpload(ctx, r.presigner, bucket, key, contentType, byteSize, sha)
	if err != nil {
		return out, err
	}
	out.URL = u.String()
	out.ExpiresAt = time.Now().UTC().Add(uploadTTL)
	out.RequiredHeaders = headers
	return out, nil
}

// presignUpload signs a PUT that only succeeds with exactly the declared
// Content-Type, Content-Length and SHA-256: each is a signed header, so changing
// any one of them fails the signature, and the store checks the bytes against
// the signed checksum. A link minted for a 1 MiB JPEG cannot push a 9 MiB PDF
// (docs/spec/01-platform.md, "P-28 — Presigned upload and download", the first
// rule and the first acceptance criterion; contract openapi.yaml
// PresignedUpload.required_headers).
//
// The headers the client is told to send and the headers that are signed are
// the same map, so the two cannot drift apart.
func presignUpload(ctx context.Context, p Presigner, bucket, key, contentType string, byteSize int64, sha []byte) (*url.URL, map[string]string, error) {
	required := map[string]string{
		"Content-Type":          contentType,
		"Content-Length":        itoa(byteSize),
		"x-amz-checksum-sha256": base64.StdEncoding.EncodeToString(sha),
	}
	signed := make(http.Header, len(required))
	for k, v := range required {
		signed.Set(k, v)
	}
	u, err := p.PresignHeader(ctx, http.MethodPut, bucket, key, uploadTTL, nil, signed)
	if err != nil {
		return nil, nil, err
	}
	return u, required, nil
}

// uploadResult is the internal shape the handler renders as PresignedUpload.
type uploadResult struct {
	UploadID        string
	URL             string
	ExpiresAt       time.Time
	RequiredHeaders map[string]string
}

// DownloadURL mints a 120-second presigned GET for a KYC document and audits the
// issuance (P-28): every download-url issuance names the actor, the document and
// the request id in the audit trail. Ownership/authorization is decided by the
// caller before this runs; a document the caller may not see returns ErrNotFound
// so no URL is minted and existence is not leaked.
//
// Only a file the virus scanner passed is served, and only while its bytes are
// still the ones that were scanned: the object is re-read and its SHA-256
// compared with the scanned one before the URL is minted. A file that changed
// gets a new content version, which sends its verdict back to PENDING and any
// approved document on it back to review (see migration 00031_virus_scan). Both
// refusals are ErrNotScannedClean
// (https://github.com/shaiknoorullah/hg-mono/issues/218).
func (r *Repo) DownloadURL(ctx context.Context, actor Actor, documentID string, canReadAny bool) (downloadResult, error) {
	var out downloadResult
	var objectID, subjectType, subjectID string
	err := inTx(ctx, r.pool, func(tx pgx.Tx) error {
		const q = `
SELECT kd.stored_object_id::text, kd.subject_type::text, kd.subject_id::text
  FROM kyc_document kd
 WHERE kd.id = $1 AND kd.deleted_at IS NULL`
		err := tx.QueryRow(ctx, q, documentID).Scan(&objectID, &subjectType, &subjectID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		// Ownership: a partner may only fetch their own document. The global
		// kyc_document.download action (admins) bypasses the ownership check.
		if !canReadAny && !r.ownsSubject(ctx, tx, actor.AccountID, subjectType, subjectID) {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	file, err := r.verifyScannedFile(ctx, actor, objectID, "checksum mismatch at download")
	if err != nil {
		return out, err
	}

	err = inTx(ctx, r.pool, func(tx pgx.Tx) error {
		// Still passing now, and still the contents whose bytes were just
		// checked: a re-scan or a recorded change may have landed meanwhile.
		var passed bool
		var version int64
		if err := tx.QueryRow(ctx, `
SELECT virus_scan_passed(so), so.content_version FROM stored_object so WHERE so.id = $1 FOR SHARE`,
			objectID).Scan(&passed, &version); err != nil {
			return err
		}
		if !passed || version != file.version {
			return ErrNotScannedClean
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "kyc_document.download",
			subjectType: "KYC_DOCUMENT",
			subjectID:   &documentID,
			outcome:     "SUCCESS",
		})
	})
	if err != nil {
		return out, err
	}

	params := url.Values{}
	params.Set("response-content-disposition", "attachment")
	u, err := r.presigner.PresignedGetObject(ctx, file.bucket, file.key, 120*time.Second, params)
	if err != nil {
		return out, err
	}
	out.URL = u.String()
	out.ExpiresAt = time.Now().UTC().Add(120 * time.Second)
	return out, nil
}

// CheckScannedFile re-reads a file from the object store and reports whether it
// is still the file the virus scanner passed, and at which content_version. The
// admin review calls it before approving a document (wired in cmd/hg/main.go),
// so approval, like download, refuses bytes that are not the scanned bytes.
// clean is false, with a nil error, when the file has not passed its scan or
// its bytes changed; a change is recorded first (see markContentChanged), with
// the reviewer as the actor. An error means the file could not be checked.
func (r *Repo) CheckScannedFile(ctx context.Context, objectID, actorAccountID, requestID string) (version int64, clean bool, err error) {
	f, err := r.verifyScannedFile(ctx, Actor{AccountID: actorAccountID, RequestID: requestID},
		objectID, "checksum mismatch at approval")
	switch {
	case errors.Is(err, ErrNotScannedClean):
		return 0, false, nil
	case err != nil:
		return 0, false, err
	}
	return f.version, true, nil
}

// scannedFile is a file whose stored bytes were just found to be the bytes its
// CLEAN verdict is about, at content version version.
type scannedFile struct {
	bucket, key string
	version     int64
}

// verifyScannedFile checks that a file has passed its virus scan and that the
// bytes at its key are still the scanned bytes. A file that has not passed is
// ErrNotScannedClean. A file whose bytes differ is recorded as changed (reason
// names where it was found) and is ErrNotScannedClean too. Fail closed: a file
// the store cannot read is an error, never a pass.
func (r *Repo) verifyScannedFile(ctx context.Context, actor Actor, objectID, reason string) (scannedFile, error) {
	var f scannedFile
	var size int64
	var scanned []byte
	var passed bool
	err := r.pool.QueryRow(ctx, `
SELECT so.bucket, so.object_key, so.byte_size, so.virus_scan_sha256, so.content_version,
       virus_scan_passed(so)
  FROM stored_object so
 WHERE so.id = $1 AND so.deleted_at IS NULL`, objectID).
		Scan(&f.bucket, &f.key, &size, &scanned, &f.version, &passed)
	if errors.Is(err, pgx.ErrNoRows) {
		return f, ErrNotFound
	}
	if err != nil {
		return f, err
	}
	if !passed {
		return f, ErrNotScannedClean
	}
	if r.objects == nil {
		return f, errNotConfigured
	}
	same, err := sameBytes(ctx, r.objects, f.bucket, f.key, size, scanned)
	if err != nil {
		return f, err
	}
	if !same {
		if err := inTx(ctx, r.pool, func(tx pgx.Tx) error {
			return markContentChanged(ctx, tx, actor, objectID, f.version, reason)
		}); err != nil {
			return f, err
		}
		return f, ErrNotScannedClean
	}
	return f, nil
}

// sameBytes reports whether the object at key is exactly size bytes with the
// given SHA-256. An error means the store could not be read, not a mismatch.
func sameBytes(ctx context.Context, objects ObjectStore, bucket, key string, size int64, sha []byte) (bool, error) {
	rc, err := objects.Open(ctx, bucket, key)
	if err != nil {
		return false, err
	}
	defer rc.Close()
	h := sha256.New()
	n, err := io.Copy(h, rc)
	if err != nil {
		return false, err
	}
	return n == size && bytes.Equal(h.Sum(nil), sha), nil
}

type downloadResult struct {
	URL       string
	ExpiresAt time.Time
}

// ownsSubject reports whether the account is the owner of the KYC subject. For a
// RIDER the subject_id is the rider's account_id; for a RESTAURANT it is the
// restaurant_id, which the account must hold a live RESTAURANT_* grant scoped to.
func (r *Repo) ownsSubject(ctx context.Context, tx pgx.Tx, accountID, subjectType, subjectID string) bool {
	if accountID == "" {
		return false
	}
	switch subjectType {
	case "RIDER":
		return accountID == subjectID
	case "RESTAURANT":
		var ok bool
		err := tx.QueryRow(ctx, `
SELECT true FROM account_role
 WHERE account_id=$1 AND scope_type='RESTAURANT' AND scope_id=$2::uuid AND revoked_at IS NULL
 LIMIT 1`, accountID, subjectID).Scan(&ok)
		return err == nil && ok
	}
	return false
}

// inTx runs fn in a transaction.
func inTx(ctx context.Context, pool *pgxpool.Pool, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var (
	errBadPurpose     = errors.New("files: purpose not allowed")
	errBadContentType = errors.New("files: content type not accepted")
	errBadChecksum    = errors.New("files: sha256 must be 64 lowercase hex chars")
)
