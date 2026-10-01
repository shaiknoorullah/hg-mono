package files

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
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
// ConfirmUpload leaves it, and returns its id and key.
func seedConfirmedKYC(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner string, size int64) (id, key string) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object
  (bucket, object_key, purpose, owner_account_id, content_type, byte_size, sha256,
   state, uploaded_by, confirmed_at, virus_scan_state)
VALUES ('hg-kyc', 'scan/'||md5(random()::text), 'KYC_DOCUMENT', $1, 'application/pdf', $2,
        digest(random()::text, 'sha256'), 'READY', $1, now(), 'PENDING')
RETURNING id, object_key`, owner, size).Scan(&id, &key); err != nil {
		t.Fatalf("seed stored object: %v", err)
	}
	return id, key
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

// The scan worker end to end, against a real schema and a fake clamd:
//   - while clamd is down nothing is passed — documents stay PENDING;
//   - once it is up, each document gets CLEAN or INFECTED (with the signature);
//   - a file over the scan limit is flagged TOO_LARGE without being sent;
//   - a flagged file's document cannot be approved (the database refuses).
func TestScanWorker(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)

	var owner string
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('scan-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE')
RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed account: %v", err)
	}

	const maxBytes = 4096
	cleanData := []byte("%PDF-1.7 a business licence")
	infectedData := append([]byte("%PDF-1.7\n"), eicar...)
	cleanID, cleanKey := seedConfirmedKYC(t, ctx, pool, owner, int64(len(cleanData)))
	infectedID, infectedKey := seedConfirmedKYC(t, ctx, pool, owner, int64(len(infectedData)))
	bigID, _ := seedConfirmedKYC(t, ctx, pool, owner, maxBytes+1)
	store := keyedObjectStore{cleanKey: cleanData, infectedKey: infectedData}
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
	want := map[string]string{cleanID: "CLEAN", infectedID: "INFECTED", bigID: "TOO_LARGE"}
	for id, w := range want {
		if st, _ := scanStateOf(t, ctx, pool, id); st != w {
			t.Errorf("object %s: virus_scan_state = %s, want %s", id, st, w)
		}
	}
	if _, detail := scanStateOf(t, ctx, pool, infectedID); detail != "Eicar-Test-Signature" {
		t.Errorf("infected detail = %q, want the signature name", detail)
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
