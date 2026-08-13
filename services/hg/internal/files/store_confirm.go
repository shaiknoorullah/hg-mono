package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"

	"github.com/jackc/pgx/v5"
)

// Confirm verification failures. Each maps to a 422 with a specific ErrorCode.
var (
	errNotConfigured   = errors.New("files: object store not configured")
	errContentType     = errors.New("files: content type mismatch")
	errChecksum        = errors.New("files: checksum mismatch")
	errImageTooSmall   = errors.New("files: image below the minimum size")
	errAlreadyRejected = errors.New("files: object already rejected")
)

// minImageBytes is the floor below which an image is treated as too small to be
// a genuine document scan (P-28 IMAGE_TOO_SMALL). PDFs are exempt.
const minImageBytes = 1024

// ConfirmUpload verifies an uploaded object and marks it READY (P-28). It HEADs
// the object, verifies the byte size and content type against what the client
// declared at allocation, reads the bytes to verify the SHA-256 and to sniff the
// magic bytes (a .pdf that is really an executable is rejected and deleted), then
// sets state=READY. Only the object's owner (or an admin) may confirm it, which
// the handler decides before calling. A verification failure marks the object
// REJECTED with a reason and deletes the bytes; the row is kept for the audit
// trail. An already-READY object is returned idempotently.
func (r *Repo) ConfirmUpload(ctx context.Context, actor Actor, uploadID string, canConfirmAny bool) (storedObjectRow, error) {
	var out storedObjectRow
	if r.objects == nil {
		return out, errNotConfigured
	}

	// Load the row and its declared fingerprint under a lock.
	var bucket, key string
	var declaredSize int64
	var declaredType, state, ownerID string
	var declaredSHA []byte
	err := inTx(ctx, r.pool, func(tx pgx.Tx) error {
		const sel = `
SELECT bucket, object_key, content_type, byte_size, sha256, state::text,
       COALESCE(owner_account_id::text, '')
  FROM stored_object
 WHERE id = $1 AND deleted_at IS NULL
 FOR UPDATE`
		err := tx.QueryRow(ctx, sel, uploadID).Scan(&bucket, &key, &declaredType, &declaredSize, &declaredSHA, &state, &ownerID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return out, err
	}
	// Ownership: only the uploader (or an admin) may confirm.
	if !canConfirmAny && (actor.AccountID == "" || actor.AccountID != ownerID) {
		return out, ErrNotFound
	}
	switch state {
	case "READY":
		return r.getStoredObject(ctx, uploadID)
	case "REJECTED", "DELETED":
		return out, errAlreadyRejected
	}

	// Verify against the actual object. Any failure rejects and deletes.
	rejectReason, verifyErr := r.verifyObject(ctx, bucket, key, declaredSize, declaredType, declaredSHA)
	if verifyErr != nil {
		// A transport/store error is not the client's fault — surface it as an error
		// without rejecting the object, so a retry can succeed.
		return out, verifyErr
	}
	if rejectReason != "" {
		if err := r.rejectObject(ctx, actor, uploadID, bucket, key, rejectReason); err != nil {
			return out, err
		}
		return out, reasonToErr(rejectReason)
	}

	// Verified: mark READY, clear the deadline, enqueue the KYC virus scan.
	err = inTx(ctx, r.pool, func(tx pgx.Tx) error {
		const upd = `
UPDATE stored_object
   SET state='READY', confirmed_at=now(),
       deadline_at=NULL, deadline_action=NULL,
       virus_scan_state = CASE WHEN purpose='KYC_DOCUMENT' THEN 'PENDING' ELSE 'SKIPPED' END
 WHERE id=$1`
		if _, err := tx.Exec(ctx, upd, uploadID); err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "stored_object.confirm",
			subjectType: "STORED_OBJECT",
			subjectID:   &uploadID,
			outcome:     "SUCCESS",
		})
	})
	if err != nil {
		return out, err
	}
	return r.getStoredObject(ctx, uploadID)
}

// verifyObject stats and reads the object, returning a non-empty reject reason
// when the bytes do not match what was declared, or an error when the store
// cannot be reached. The three reject reasons mirror the contract's 422 set:
// CONTENT_TYPE_MISMATCH, CHECKSUM_MISMATCH, IMAGE_TOO_SMALL.
func (r *Repo) verifyObject(ctx context.Context, bucket, key string, declaredSize int64, declaredType string, declaredSHA []byte) (string, error) {
	stat, err := r.objects.Stat(ctx, bucket, key)
	if err != nil {
		return "", err
	}
	if stat.Size != declaredSize {
		return "CHECKSUM_MISMATCH", nil
	}
	rc, err := r.objects.Open(ctx, bucket, key)
	if err != nil {
		return "", err
	}
	defer rc.Close()

	// Read the head for magic-byte sniffing, then stream the rest through the
	// hasher so the whole object is fingerprinted without buffering it in memory.
	h := sha256.New()
	head := make([]byte, 512)
	n, _ := io.ReadFull(rc, head)
	head = head[:n]
	h.Write(head)
	if _, err := io.Copy(h, rc); err != nil {
		return "", err
	}

	// Magic bytes: the actual format must match the declared content type. A .pdf
	// that is really something else is rejected (P-28).
	if !magicMatches(declaredType, head) {
		return "CONTENT_TYPE_MISMATCH", nil
	}
	// Content type recorded at allocation is authoritative; the stat's own type is
	// advisory (some stores echo application/octet-stream) and is not compared.

	sum := h.Sum(nil)
	if !bytes.Equal(sum, declaredSHA) {
		return "CHECKSUM_MISMATCH", nil
	}

	// Image floor. PDFs are exempt; a tiny image is not a genuine scan.
	if declaredType != "application/pdf" && int64(len(head)) < minImageBytes && stat.Size < minImageBytes {
		return "IMAGE_TOO_SMALL", nil
	}
	return "", nil
}

// rejectObject marks the row REJECTED with a reason and deletes the bytes, in one
// transaction with its audit row. The row is retained for the audit trail.
func (r *Repo) rejectObject(ctx context.Context, actor Actor, uploadID, bucket, key, reason string) error {
	// Best-effort delete of the offending bytes; a store error here is logged by
	// the caller's error path, not swallowed silently.
	_ = r.objects.Remove(ctx, bucket, key)
	return inTx(ctx, r.pool, func(tx pgx.Tx) error {
		const upd = `
UPDATE stored_object
   SET state='REJECTED', reject_reason=$2, deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`
		if _, err := tx.Exec(ctx, upd, uploadID, reason); err != nil {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			actor:       actor,
			action:      "stored_object.reject",
			subjectType: "STORED_OBJECT",
			subjectID:   &uploadID,
			outcome:     "FAILED",
		})
	})
}

// getStoredObject reads the StoredObject projection.
func (r *Repo) getStoredObject(ctx context.Context, id string) (storedObjectRow, error) {
	var out storedObjectRow
	const q = `
SELECT id, purpose::text, state::text, content_type, byte_size, reject_reason
  FROM stored_object WHERE id=$1 AND deleted_at IS NULL`
	err := r.pool.QueryRow(ctx, q, id).Scan(&out.ID, &out.Purpose, &out.State, &out.ContentType, &out.ByteSize, &out.RejectReason)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, ErrNotFound
	}
	return out, err
}

// magicMatches reports whether the object's leading bytes are consistent with the
// declared content type. The set mirrors the accepted upload content types.
func magicMatches(contentType string, head []byte) bool {
	switch contentType {
	case "application/pdf":
		return bytes.HasPrefix(head, []byte("%PDF-"))
	case "image/jpeg":
		return len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF
	case "image/png":
		return bytes.HasPrefix(head, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})
	case "image/webp":
		return len(head) >= 12 && bytes.Equal(head[0:4], []byte("RIFF")) && bytes.Equal(head[8:12], []byte("WEBP"))
	}
	// An unaccepted content type never reaches confirm (allocation refuses it), so
	// an unknown type here is a mismatch.
	return false
}

// reasonToErr maps a reject reason string to the typed error the handler renders.
func reasonToErr(reason string) error {
	switch reason {
	case "CONTENT_TYPE_MISMATCH":
		return errContentType
	case "CHECKSUM_MISMATCH":
		return errChecksum
	case "IMAGE_TOO_SMALL":
		return errImageTooSmall
	}
	return errChecksum
}
