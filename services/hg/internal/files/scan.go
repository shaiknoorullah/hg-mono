package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ScanWorker virus-scans every confirmed KYC upload: the spec says confirm
// "enqueues a virus scan for KYC uploads" (docs/spec/01-platform.md#p-28--presigned-upload-and-download).
// ConfirmUpload marks a KYC object READY with virus_scan_state=PENDING; this
// worker streams the bytes from the object store to the scanner and records
// CLEAN, INFECTED, TOO_LARGE or UNSCANNABLE. It hashes the bytes as they stream
// and records ERROR, never CLEAN, when they are not the bytes that were
// confirmed: a verdict is about one exact file, not about whatever sits at the
// key (https://github.com/shaiknoorullah/hg-mono/issues/218).
//
// The queue is the table itself, so a restart, a Redis flush or a second
// replica loses nothing: each object is claimed with FOR UPDATE SKIP LOCKED in
// its own transaction, scanned while the row is held, and released either with
// a verdict or — when the scanner cannot answer — still PENDING, untouched.
//
// When the scanner is down the worker backs off and tries again; documents wait
// in PENDING meanwhile and cannot be approved, because the database refuses to
// approve a KYC document whose file is not CLEAN (migration 00028_virus_scan).
type ScanWorker struct {
	pool     *pgxpool.Pool
	objects  ObjectStore
	scanner  Scanner
	maxBytes int64
	log      *slog.Logger

	interval   time.Duration // between sweeps while the scanner is healthy
	maxBackoff time.Duration // ceiling on the wait while it is not
	batch      int           // objects per sweep
}

// NewScanWorker builds the worker. Files whose recorded size exceeds maxBytes
// are flagged TOO_LARGE without being sent: the scanner would stop reading
// part-way, and a partial scan is not a scan.
func NewScanWorker(pool *pgxpool.Pool, objects ObjectStore, scanner Scanner, maxBytes int64, log *slog.Logger) *ScanWorker {
	return &ScanWorker{
		pool: pool, objects: objects, scanner: scanner, maxBytes: maxBytes, log: log,
		interval: 5 * time.Second, maxBackoff: 2 * time.Minute, batch: 20,
	}
}

// Run sweeps until ctx is cancelled, doubling the wait after each sweep the
// scanner could not serve and returning to the normal interval once it can.
func (w *ScanWorker) Run(ctx context.Context) {
	wait := w.interval
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		n, err := w.Sweep(ctx)
		switch {
		case err != nil:
			wait = min(wait*2, w.maxBackoff)
			w.log.Warn("virus scan sweep failed, documents stay pending",
				slog.String("error", err.Error()), slog.Duration("retry_in", wait))
		default:
			wait = w.interval
			if n > 0 {
				w.log.Info("virus scan sweep", slog.Int("scanned", n))
			}
		}
		timer.Reset(wait)
	}
}

// errScannerUnavailable marks a failure of the scanner itself, which stops the
// sweep: every other object would fail the same way. errObjectUnreadable marks
// a failure to read one object from the store, which only defers that object.
var (
	errScannerUnavailable = errors.New("files: virus scanner unavailable")
	errObjectUnreadable   = errors.New("files: object unreadable")
)

// maxUnreadableAttempts is how many times an object the store cannot serve is
// retried, on a backoff from 30 seconds up to an hour, before it is marked
// ERROR. Ten attempts span about four and a half hours.
const maxUnreadableAttempts = 10

// Sweep scans up to one batch of pending objects and returns how many got a
// verdict. It stops at the first scanner failure and returns it. An object the
// store cannot serve is deferred with a backoff and does not count toward the
// batch, so unreadable objects at the head of the queue cannot starve the
// uploads behind them.
func (w *ScanWorker) Sweep(ctx context.Context) (int, error) {
	scanned := 0
	skip := []string{}
	for scanned < w.batch {
		id, err := w.scanOne(ctx, skip)
		switch {
		case errors.Is(err, errScannerUnavailable):
			return scanned, err
		case errors.Is(err, errObjectUnreadable):
			// skip guards this sweep even if recording the deferral fails.
			skip = append(skip, id)
			if derr := w.deferUnreadable(ctx, id, err); derr != nil {
				return scanned, derr
			}
		case err != nil:
			return scanned, err
		case id == "":
			return scanned, nil // queue empty
		default:
			scanned++
		}
	}
	return scanned, nil
}

// deferUnreadable records one failed read of an object: it pushes the next
// attempt back (30 s, doubling, at most an hour) and, once the attempts run
// out, marks the object ERROR so it leaves the queue and an admin sees it. It
// runs in its own transaction because the scan's transaction rolled back.
func (w *ScanWorker) deferUnreadable(ctx context.Context, id string, cause error) error {
	var state string
	var attempts int
	err := inTx(ctx, w.pool, func(tx pgx.Tx) error {
		const upd = `
UPDATE stored_object
   SET virus_scan_attempts = virus_scan_attempts + 1,
       virus_scan_next_at  = now() + least(interval '1 hour',
                                           interval '30 seconds' * power(2, virus_scan_attempts)),
       virus_scan_state    = CASE WHEN virus_scan_attempts + 1 >= $2 THEN 'ERROR' ELSE virus_scan_state END,
       virus_scan_detail   = CASE WHEN virus_scan_attempts + 1 >= $2 THEN 'object unreadable: ' || $3
                                  ELSE virus_scan_detail END,
       virus_scanned_at    = CASE WHEN virus_scan_attempts + 1 >= $2 THEN now() ELSE virus_scanned_at END
 WHERE id = $1 AND virus_scan_state = 'PENDING'
RETURNING virus_scan_state, virus_scan_attempts`
		err := tx.QueryRow(ctx, upd, id, maxUnreadableAttempts, cause.Error()).Scan(&state, &attempts)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // someone else decided it meanwhile
		}
		if err != nil || state != "ERROR" {
			return err
		}
		return writeAudit(ctx, tx, auditEntry{
			action:      "stored_object.virus_scan",
			subjectType: "STORED_OBJECT",
			subjectID:   &id,
			outcome:     "FAILED",
			reasonCode:  "ERROR",
			reason:      "object unreadable",
		})
	})
	if err != nil {
		return err
	}
	if state == "ERROR" {
		w.log.Error("virus scan: object unreadable, giving up",
			slog.String("stored_object_id", id), slog.Int("attempts", attempts),
			slog.String("error", cause.Error()))
	} else {
		w.log.Warn("virus scan: object unreadable, will retry",
			slog.String("stored_object_id", id), slog.Int("attempts", attempts),
			slog.String("error", cause.Error()))
	}
	return nil
}

// scanOne claims the oldest due pending object not in skip, scans it and
// records the verdict, all in one transaction. It returns the claimed id (""
// when there was nothing to claim). On any error the transaction rolls back and
// the object stays PENDING.
func (w *ScanWorker) scanOne(ctx context.Context, skip []string) (string, error) {
	var id string
	err := inTx(ctx, w.pool, func(tx pgx.Tx) error {
		const claim = `
SELECT id, bucket, object_key, byte_size, sha256
  FROM stored_object
 WHERE state = 'READY' AND virus_scan_state = 'PENDING' AND deleted_at IS NULL
   AND (virus_scan_next_at IS NULL OR virus_scan_next_at <= now())
   AND NOT (id = ANY($1::uuid[]))
 ORDER BY virus_scan_next_at NULLS FIRST, confirmed_at
 LIMIT 1
 FOR UPDATE SKIP LOCKED`
		var bucket, key string
		var size int64
		var sha []byte
		err := tx.QueryRow(ctx, claim, skip).Scan(&id, &bucket, &key, &size, &sha)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}

		verdict, detail, err := w.verdict(ctx, bucket, key, size, sha)
		if err != nil {
			return err
		}

		const upd = `
UPDATE stored_object
   SET virus_scan_state = $2, virus_scan_detail = NULLIF($3, ''), virus_scanned_at = now(),
       virus_scan_next_at = NULL
 WHERE id = $1`
		if _, err := tx.Exec(ctx, upd, id, string(verdict), detail); err != nil {
			return err
		}
		if verdict != VerdictClean {
			w.log.Warn("virus scan: file flagged",
				slog.String("stored_object_id", id), slog.String("verdict", string(verdict)),
				slog.String("detail", detail))
		}
		outcome := "SUCCESS"
		if verdict != VerdictClean {
			outcome = "FAILED"
		}
		return writeAudit(ctx, tx, auditEntry{
			action:      "stored_object.virus_scan",
			subjectType: "STORED_OBJECT",
			subjectID:   &id,
			outcome:     outcome,
			reasonCode:  string(verdict),
			reason:      detail,
		})
	})
	return id, err
}

// verdict decides one object: the bytes confirmed as size bytes with SHA-256
// sha. A failure is classified as the scanner's (errScannerUnavailable) or the
// object store's (errObjectUnreadable).
func (w *ScanWorker) verdict(ctx context.Context, bucket, key string, size int64, sha []byte) (Verdict, string, error) {
	if size > w.maxBytes {
		return VerdictTooLarge, fmt.Sprintf("%d bytes is over the %d-byte scan limit", size, w.maxBytes), nil
	}
	rc, err := w.objects.Open(ctx, bucket, key)
	if err != nil {
		return "", "", fmt.Errorf("%w: %v", errObjectUnreadable, err)
	}
	defer rc.Close()
	h := sha256.New()
	src := &readRecorder{r: io.TeeReader(rc, h)}
	v, detail, err := w.scanner.Scan(ctx, src)
	if err != nil {
		if src.err != nil {
			return "", "", fmt.Errorf("%w: %v", errObjectUnreadable, src.err)
		}
		return "", "", fmt.Errorf("%w: %v", errScannerUnavailable, err)
	}
	// CLEAN is a claim about the confirmed file, so it needs proof that the
	// scanner read exactly that file, every byte. Anything else is ERROR.
	if v == VerdictClean && (src.n != size || !bytes.Equal(h.Sum(nil), sha)) {
		return VerdictError, "checksum mismatch: the scanned bytes are not the confirmed upload", nil
	}
	return v, detail, nil
}

// readRecorder counts the bytes read and remembers the first non-EOF read
// error, so a failed scan can be blamed on the right side.
type readRecorder struct {
	r   io.Reader
	n   int64
	err error
}

func (rr *readRecorder) Read(p []byte) (int, error) {
	n, err := rr.r.Read(p)
	rr.n += int64(n)
	if err != nil && !errors.Is(err, io.EOF) && rr.err == nil {
		rr.err = err
	}
	return n, err
}
