package files

import (
	"context"
	"errors"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when an object or document row does not exist.
var ErrNotFound = errors.New("files: not found")

// Presigner is the narrow slice of the MinIO client this module needs. Keeping
// it an interface means the key/DB logic is unit-testable without a live MinIO,
// and the presign call itself is a thin, mockable seam.
type Presigner interface {
	PresignedPutObject(ctx context.Context, bucket, object string, expires time.Duration) (*url.URL, error)
	PresignedGetObject(ctx context.Context, bucket, object string, expires time.Duration, reqParams url.Values) (*url.URL, error)
}

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
// The signature binds the object key; the client controls only the bytes.
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

	u, err := r.presigner.PresignedPutObject(ctx, bucket, key, 300*time.Second)
	if err != nil {
		return out, err
	}
	out.URL = u.String()
	out.ExpiresAt = time.Now().UTC().Add(300 * time.Second)
	out.RequiredHeaders = map[string]string{
		"Content-Type":   contentType,
		"Content-Length": itoa(byteSize),
	}
	return out, nil
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
func (r *Repo) DownloadURL(ctx context.Context, actor Actor, documentID string, canReadAny bool) (downloadResult, error) {
	var out downloadResult
	var bucket, key, subjectType, subjectID string
	err := inTx(ctx, r.pool, func(tx pgx.Tx) error {
		const q = `
SELECT so.bucket, so.object_key, kd.subject_type::text, kd.subject_id::text
  FROM kyc_document kd
  JOIN stored_object so ON so.id = kd.stored_object_id
 WHERE kd.id = $1 AND kd.deleted_at IS NULL`
		err := tx.QueryRow(ctx, q, documentID).Scan(&bucket, &key, &subjectType, &subjectID)
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
	u, err := r.presigner.PresignedGetObject(ctx, bucket, key, 120*time.Second, params)
	if err != nil {
		return out, err
	}
	out.URL = u.String()
	out.ExpiresAt = time.Now().UTC().Add(120 * time.Second)
	return out, nil
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
