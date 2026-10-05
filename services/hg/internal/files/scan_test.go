package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// keyedObjectStore serves bytes per object key.
type keyedObjectStore map[string][]byte

func (s keyedObjectStore) Stat(_ context.Context, _, key string) (ObjectStat, error) {
	b, ok := s[key]
	if !ok {
		return ObjectStat{}, errors.New("no such key")
	}
	return ObjectStat{Size: int64(len(b))}, nil
}

func (s keyedObjectStore) Open(_ context.Context, _, key string) (io.ReadCloser, error) {
	b, ok := s[key]
	if !ok {
		return nil, errors.New("no such key")
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (s keyedObjectStore) Remove(context.Context, string, string) error { return nil }

// seedConfirmedKYC inserts a confirmed KYC object awaiting its scan, as
// ConfirmUpload leaves it — size and SHA-256 those of data — and returns its id
// and key.
func seedConfirmedKYC(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner string, data []byte) (id, key string) {
	t.Helper()
	sum := sha256.Sum256(data)
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object
  (bucket, object_key, purpose, owner_account_id, content_type, byte_size, sha256,
   state, uploaded_by, confirmed_at, virus_scan_state)
VALUES ('hg-kyc', 'scan/'||md5(random()::text), 'KYC_DOCUMENT', $1, 'application/pdf', $2,
        $3, 'READY', $1, now(), 'PENDING')
RETURNING id, object_key`, owner, len(data), sum[:]).Scan(&id, &key); err != nil {
		t.Fatalf("seed stored object: %v", err)
	}
	return id, key
}

func seedAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('scan-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	return id
}

// approveDocument attaches an APPROVED rider document to the object, as an
// admin's approval leaves it, and returns the document id.
func approveDocument(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner, objectID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state, reviewed_by, reviewed_at)
VALUES ('RIDER', $1, 'GOVERNMENT_ID', $2, 'APPROVED', $1, now())
RETURNING id`, owner, objectID).Scan(&id); err != nil {
		t.Fatalf("approve document: %v", err)
	}
	return id
}

func documentState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var state string
	if err := pool.QueryRow(ctx, `SELECT state::text FROM kyc_document WHERE id=$1`, id).Scan(&state); err != nil {
		t.Fatalf("read document state: %v", err)
	}
	return state
}

// fixedScanner reads the whole stream and answers one verdict: a scanner whose
// signatures say what the test needs, for example that a file passed before is
// now known to be infected.
type fixedScanner struct {
	v      Verdict
	detail string
}

func (f fixedScanner) Scan(_ context.Context, r io.Reader) (Verdict, string, error) {
	if _, err := io.Copy(io.Discard, r); err != nil {
		return "", "", err
	}
	return f.v, f.detail, nil
}

// recordingPresigner mints fake URLs and remembers the headers it was asked to
// sign.
type recordingPresigner struct{ signed http.Header }

func (p *recordingPresigner) PresignHeader(_ context.Context, _, _, _ string, _ time.Duration, _ url.Values, h http.Header) (*url.URL, error) {
	p.signed = h
	return url.Parse("https://store.test/put")
}

func (p *recordingPresigner) PresignedGetObject(context.Context, string, string, time.Duration, url.Values) (*url.URL, error) {
	return url.Parse("https://store.test/get")
}

func scanStateOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) (state, detail string) {
	t.Helper()
	if err := pool.QueryRow(ctx,
		`SELECT virus_scan_state, COALESCE(virus_scan_detail, '') FROM stored_object WHERE id=$1`, id).
		Scan(&state, &detail); err != nil {
		t.Fatalf("read scan state: %v", err)
	}
	return state, detail
}

func sha256Of(b []byte) []byte {
	sum := sha256.Sum256(b)
	return sum[:]
}

// contentVersionOf reads an object's content_version.
func contentVersionOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) int64 {
	t.Helper()
	var v int64
	if err := pool.QueryRow(ctx, `SELECT content_version FROM stored_object WHERE id=$1`, id).Scan(&v); err != nil {
		t.Fatalf("read content version: %v", err)
	}
	return v
}

// approveAgain tries to approve a document again, as any writer could, and
// reports whether the database let it.
func approveAgain(ctx context.Context, pool *pgxpool.Pool, owner, docID string) error {
	_, err := pool.Exec(ctx, `
UPDATE kyc_document SET state='APPROVED', reviewed_by=$2, reviewed_at=now(), deadline_at=NULL, deadline_action=NULL
 WHERE id=$1`, docID, owner)
	return err
}

// The scan worker end to end, against a real schema and a fake clamd:
//   - while clamd is down nothing is passed — documents stay PENDING;
//   - once it is up, each document gets CLEAN or INFECTED (with the signature);
//   - a file over the scan limit is flagged TOO_LARGE without being sent;
//   - clean bytes that are not the confirmed bytes are ERROR, never CLEAN;
//   - a flagged file's document cannot be approved (the database refuses).
func TestScanWorker(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	owner := seedAccount(t, ctx, pool)

	const maxBytes = 4096
	cleanData := []byte("%PDF-1.7 a business licence")
	infectedData := append([]byte("%PDF-1.7\n"), eicar...)
	cleanID, cleanKey := seedConfirmedKYC(t, ctx, pool, owner, cleanData)
	infectedID, infectedKey := seedConfirmedKYC(t, ctx, pool, owner, infectedData)
	bigID, _ := seedConfirmedKYC(t, ctx, pool, owner, make([]byte, maxBytes+1))
	swappedID, swappedKey := seedConfirmedKYC(t, ctx, pool, owner, []byte("%PDF-1.7 the confirmed file"))
	store := keyedObjectStore{cleanKey: cleanData, infectedKey: infectedData,
		swappedKey: []byte("%PDF-1.7 a different file")}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))

	// clamd down: a closed port.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	downAddr := ln.Addr().String()
	_ = ln.Close()
	down := NewScanWorker(pool, store, NewClamdScanner(downAddr, time.Second), maxBytes, quiet)
	down.batch = 1000
	if _, err := down.Sweep(ctx); !errors.Is(err, errScannerUnavailable) {
		t.Fatalf("Sweep with clamd down: err = %v, want errScannerUnavailable", err)
	}
	if st, _ := scanStateOf(t, ctx, pool, cleanID); st != "PENDING" {
		t.Fatalf("with clamd down the document is %s; it must wait in PENDING", st)
	}

	// clamd up.
	clamd := startFakeClamd(t, 1<<20)
	up := NewScanWorker(pool, store, NewClamdScanner(clamd.addr, 5*time.Second), maxBytes, quiet)
	up.batch = 1000
	if _, err := up.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	want := map[string]string{cleanID: "CLEAN", infectedID: "INFECTED", bigID: "TOO_LARGE", swappedID: "ERROR"}
	for id, w := range want {
		if st, _ := scanStateOf(t, ctx, pool, id); st != w {
			t.Errorf("object %s: virus_scan_state = %s, want %s", id, st, w)
		}
	}
	if _, detail := scanStateOf(t, ctx, pool, infectedID); detail != "Eicar-Test-Signature" {
		t.Errorf("infected detail = %q, want the signature name", detail)
	}
	// The CLEAN verdict names the bytes it is about and the contents it was
	// read at; the swapped file's ERROR names the bytes that were really there.
	var cleanBound, swappedSeen bool
	if err := pool.QueryRow(ctx, `
SELECT (SELECT virus_scan_sha256 = sha256 AND virus_scan_version = content_version FROM stored_object WHERE id=$1),
       (SELECT virus_scan_sha256 = $3 FROM stored_object WHERE id=$2)`,
		cleanID, swappedID, sha256Of([]byte("%PDF-1.7 a different file"))).Scan(&cleanBound, &swappedSeen); err != nil {
		t.Fatalf("read verdict binding: %v", err)
	}
	if !cleanBound {
		t.Errorf("the CLEAN verdict is not bound to the file's SHA-256 and content version")
	}
	if !swappedSeen {
		t.Errorf("the ERROR verdict does not record the SHA-256 of the bytes that were scanned")
	}

	// A document whose file is not CLEAN cannot be approved, by any writer.
	for id, w := range want {
		_, err := pool.Exec(ctx, `
INSERT INTO kyc_document (subject_type, subject_id, rider_doc_type, stored_object_id, state, reviewed_by, reviewed_at)
VALUES ('RIDER', $1, 'GOVERNMENT_ID', $2, 'APPROVED', $1, now())`, owner, id)
		if w == "CLEAN" && err != nil {
			t.Errorf("approving a CLEAN document failed: %v", err)
		}
		if w != "CLEAN" && err == nil {
			t.Errorf("a document whose file is %s was approved; the database must refuse it", w)
		}
	}
}

// Objects the store cannot serve must not starve the queue: they are deferred
// with a backoff instead of being claimed again on every sweep, they do not use
// up the batch, and after repeated failures they are marked ERROR.
func TestScanQueueSkipsUnreadableObjects(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	owner := seedAccount(t, ctx, pool)

	const batch = 2
	var missing []string
	for range batch + 1 { // more unreadable objects than one batch, oldest first
		id, _ := seedConfirmedKYC(t, ctx, pool, owner, []byte("%PDF-1.7 gone"))
		missing = append(missing, id)
	}
	data := []byte("%PDF-1.7 uploaded after them")
	readyID, readyKey := seedConfirmedKYC(t, ctx, pool, owner, data)

	w := NewScanWorker(pool, keyedObjectStore{readyKey: data}, fixedScanner{v: VerdictClean},
		1<<20, slog.New(slog.NewTextHandler(io.Discard, nil)))
	w.batch = batch
	if _, err := w.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if st, _ := scanStateOf(t, ctx, pool, readyID); st != "CLEAN" {
		t.Fatalf("the readable upload behind %d unreadable ones is %s; it must be scanned", len(missing), st)
	}
	for _, id := range missing {
		var attempts int
		var due bool
		if err := pool.QueryRow(ctx, `
SELECT virus_scan_attempts, virus_scan_next_at > now() FROM stored_object WHERE id=$1`, id).Scan(&attempts, &due); err != nil {
			t.Fatalf("read attempts: %v", err)
		}
		if attempts != 1 || !due {
			t.Errorf("unreadable object %s: attempts=%d, deferred=%v; want one attempt and a later retry", id, attempts, due)
		}
	}

	// On its last attempt an unreadable object leaves the queue as ERROR.
	if _, err := pool.Exec(ctx, `
UPDATE stored_object SET virus_scan_attempts=$2, virus_scan_next_at=now() WHERE id=$1`,
		missing[0], maxUnreadableAttempts-1); err != nil {
		t.Fatalf("age the object: %v", err)
	}
	if _, err := w.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if st, detail := scanStateOf(t, ctx, pool, missing[0]); st != "ERROR" {
		t.Errorf("after %d failed reads the object is %s (%q); want ERROR", maxUnreadableAttempts, st, detail)
	}
}

// An upload URL can only ever write the declared bytes: the type, the length
// and the SHA-256 are signed into it, so reusing it after the scan cannot swap
// the file.
func TestUploadURLBindsTheBytes(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	owner := seedAccount(t, ctx, pool)

	presigner := &recordingPresigner{}
	repo := NewRepo(pool, presigner, keyedObjectStore{}, Buckets{KYC: "hg-kyc"})
	data := []byte("%PDF-1.7 to be uploaded")
	sum := sha256.Sum256(data)
	in := keyInputs{subjectType: "RIDER", subjectID: owner, docType: "GENERIC", accountID: owner}
	out, err := repo.AllocateUpload(ctx, Actor{AccountID: owner}, PurposeKYC, in, "application/pdf",
		int64(len(data)), hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatalf("AllocateUpload: %v", err)
	}
	for k, v := range out.RequiredHeaders {
		if got := presigner.signed.Get(k); got != v {
			t.Errorf("required header %s=%q is not signed into the URL (signed %q)", k, v, got)
		}
	}
	if presigner.signed.Get("x-amz-checksum-sha256") == "" || presigner.signed.Get("Content-Length") == "" {
		t.Errorf("the URL must sign the checksum and the length; signed %v", presigner.signed)
	}
}

// A document stays approved only while its file is still the clean file that
// was scanned (https://github.com/shaiknoorullah/hg-mono/issues/218):
//
//	(a) bytes swapped after a CLEAN scan are caught before a download is
//	    issued: no URL, the file gets a new content version, its verdict goes
//	    back to PENDING and the document leaves APPROVED. It cannot be approved
//	    again, and the next scan of the swapped bytes ends ERROR;
//	(b) the same swap caught at approval time (CheckScannedFile) refuses the
//	    approval and does the same;
//	(c) a file a re-scan finds INFECTED takes its approved document back to
//	    review, and it can no longer be downloaded.
func TestApprovalFollowsTheFile(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	owner := seedAccount(t, ctx, pool)
	admin := Actor{AccountID: owner, RequestID: "req-scan"}
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))

	data := []byte("%PDF-1.7 a clean driving licence")
	swapID, swapKey := seedConfirmedKYC(t, ctx, pool, owner, data)
	checkID, checkKey := seedConfirmedKYC(t, ctx, pool, owner, data)
	rescanID, rescanKey := seedConfirmedKYC(t, ctx, pool, owner, data)
	store := keyedObjectStore{swapKey: data, checkKey: data, rescanKey: data}
	clean := NewScanWorker(pool, store, fixedScanner{v: VerdictClean}, 1<<20, quiet)
	clean.batch = 1000
	if _, err := clean.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	swapDoc := approveDocument(t, ctx, pool, owner, swapID)
	checkDoc := approveDocument(t, ctx, pool, owner, checkID)
	rescanDoc := approveDocument(t, ctx, pool, owner, rescanID)
	repo := NewRepo(pool, &recordingPresigner{}, store, Buckets{KYC: "hg-kyc"})

	if _, err := repo.DownloadURL(ctx, admin, swapDoc, true); err != nil {
		t.Fatalf("download of an approved, clean, unchanged file: %v", err)
	}
	if v, ok, err := repo.CheckScannedFile(ctx, checkID, owner, "req-check"); err != nil || !ok || v != 1 {
		t.Fatalf("CheckScannedFile of a clean, unchanged file = (%d, %v, %v), want (1, true, nil)", v, ok, err)
	}

	// (a) The bytes at the key change after the scan.
	swapped := append([]byte("%PDF-1.7 "), eicar...)
	store[swapKey] = swapped
	if _, err := repo.DownloadURL(ctx, admin, swapDoc, true); !errors.Is(err, ErrNotScannedClean) {
		t.Fatalf("download after the bytes were swapped: err = %v, want ErrNotScannedClean", err)
	}
	if st, _ := scanStateOf(t, ctx, pool, swapID); st != "PENDING" {
		t.Errorf("swapped file is %s, want PENDING: new contents need a new scan", st)
	}
	if v := contentVersionOf(t, ctx, pool, swapID); v != 2 {
		t.Errorf("swapped file is at content version %d, want 2", v)
	}
	if st := documentState(t, ctx, pool, swapDoc); st != "IN_REVIEW" {
		t.Errorf("the document over a swapped file is %s, want IN_REVIEW", st)
	}
	if err := approveAgain(ctx, pool, owner, swapDoc); err == nil {
		t.Errorf("a document over swapped, unscanned bytes was approved again")
	}
	if _, err := clean.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if st, _ := scanStateOf(t, ctx, pool, swapID); st != "ERROR" {
		t.Errorf("the re-scan of swapped bytes is %s, want ERROR: they are not the confirmed upload", st)
	}
	if err := approveAgain(ctx, pool, owner, swapDoc); err == nil {
		t.Errorf("a document over a file whose re-scan is ERROR was approved")
	}

	// (b) The same swap, found when an admin approves.
	store[checkKey] = swapped
	if v, ok, err := repo.CheckScannedFile(ctx, checkID, owner, "req-check"); err != nil || ok {
		t.Fatalf("CheckScannedFile after the bytes were swapped = (%d, %v, %v), want not clean", v, ok, err)
	}
	if st, _ := scanStateOf(t, ctx, pool, checkID); st != "PENDING" {
		t.Errorf("file swapped before approval is %s, want PENDING", st)
	}
	if st := documentState(t, ctx, pool, checkDoc); st == "APPROVED" {
		t.Errorf("the document over a file swapped before approval is still APPROVED")
	}

	// (c) Newer signatures: a recorded re-scan, and this time clamd finds it.
	if _, err := pool.Exec(ctx, `UPDATE stored_object SET virus_scan_state='PENDING' WHERE id=$1`, rescanID); err == nil {
		t.Fatalf("a verdict was changed without a recorded re-scan")
	}
	if err := repo.Rescan(ctx, admin, rescanID, "signature database update"); err != nil {
		t.Fatalf("Rescan: %v", err)
	}
	infected := NewScanWorker(pool, store, fixedScanner{v: VerdictInfected, detail: "Win.Test.New"}, 1<<20, quiet)
	infected.batch = 1000
	if _, err := infected.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if st, _ := scanStateOf(t, ctx, pool, rescanID); st != "INFECTED" {
		t.Fatalf("re-scanned file is %s, want INFECTED", st)
	}
	if st := documentState(t, ctx, pool, rescanDoc); st == "APPROVED" {
		t.Errorf("the document over an INFECTED file is still APPROVED")
	}
	if _, err := repo.DownloadURL(ctx, admin, rescanDoc, true); !errors.Is(err, ErrNotScannedClean) {
		t.Errorf("download of an INFECTED file: err = %v, want ErrNotScannedClean", err)
	}
}

// Approve, then a late INFECTED verdict on the same file: the document leaves
// APPROVED in the same transaction, with an audit row, and cannot be approved
// again (https://github.com/shaiknoorullah/hg-mono/issues/218).
func TestLateInfectedVerdictRevokesApproval(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	owner := seedAccount(t, ctx, pool)
	data := []byte("%PDF-1.7 a certificate passed by yesterday's signatures")
	id, key := seedConfirmedKYC(t, ctx, pool, owner, data)
	w := NewScanWorker(pool, keyedObjectStore{key: data}, fixedScanner{v: VerdictClean}, 1<<20,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := w.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	doc := approveDocument(t, ctx, pool, owner, id)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT set_config('hg.rescan_reason', 'newer signatures', true)`); err != nil {
		t.Fatalf("set reason: %v", err)
	}
	if _, err := tx.Exec(ctx, `
UPDATE stored_object SET virus_scan_state='INFECTED', virus_scan_detail='Win.Test.Late' WHERE id=$1`, id); err != nil {
		t.Fatalf("record the late verdict: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	if st := documentState(t, ctx, pool, doc); st != "IN_REVIEW" {
		t.Fatalf("after a late INFECTED verdict the document is %s, want IN_REVIEW", st)
	}
	var audited bool
	if err := pool.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM audit_event WHERE subject_id=$1 AND action='kyc_document.reopen_virus_scan'
                AND reason_code='INFECTED')`, doc).Scan(&audited); err != nil {
		t.Fatalf("read audit: %v", err)
	}
	if !audited {
		t.Errorf("the reopened document has no audit row naming the INFECTED verdict")
	}
	if err := approveAgain(ctx, pool, owner, doc); err == nil {
		t.Errorf("a document over an INFECTED file was approved again")
	}
}

// Fail closed: a scanner answer the worker does not recognise is not a
// verdict. Nothing is recorded, the file stays PENDING, and the sweep reports
// the scanner as unusable so the worker backs off.
func TestUnknownVerdictFailsClosed(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)
	owner := seedAccount(t, ctx, pool)
	data := []byte("%PDF-1.7 scanned by a confused scanner")
	id, key := seedConfirmedKYC(t, ctx, pool, owner, data)
	w := NewScanWorker(pool, keyedObjectStore{key: data}, fixedScanner{v: Verdict("PROBABLY_FINE")}, 1<<20,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := w.Sweep(ctx); !errors.Is(err, errScannerUnavailable) {
		t.Fatalf("Sweep with an unknown verdict: err = %v, want errScannerUnavailable", err)
	}
	if st, _ := scanStateOf(t, ctx, pool, id); st != "PENDING" {
		t.Errorf("after an unknown verdict the file is %s, want PENDING", st)
	}
}
