package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"io"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// fakeObjectStore serves fixed bytes for one key so ConfirmUpload can be tested
// without a live MinIO. It records whether Remove was called.
type fakeObjectStore struct {
	data        []byte
	contentType string
	removed     bool
	statErr     error
}

func (f *fakeObjectStore) Stat(ctx context.Context, bucket, key string) (ObjectStat, error) {
	if f.statErr != nil {
		return ObjectStat{}, f.statErr
	}
	return ObjectStat{Size: int64(len(f.data)), ContentType: f.contentType}, nil
}

func (f *fakeObjectStore) Open(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	return io.NopCloser(bytes.NewReader(f.data)), nil
}

func (f *fakeObjectStore) Remove(ctx context.Context, bucket, key string) error {
	f.removed = true
	return nil
}

// pngBytes returns a minimal PNG (signature + padding) of at least n bytes.
func pngBytes(n int) []byte {
	sig := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	b := make([]byte, 0, n)
	b = append(b, sig...)
	for len(b) < n {
		b = append(b, 0x00)
	}
	return b
}

func TestMagicMatches(t *testing.T) {
	cases := []struct {
		ct   string
		head []byte
		want bool
	}{
		{"application/pdf", []byte("%PDF-1.7\n..."), true},
		{"application/pdf", []byte("MZ\x90\x00"), false}, // a Windows executable disguised as a pdf
		{"image/jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0}, true},
		{"image/png", []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, true},
		{"image/webp", append([]byte("RIFF\x00\x00\x00\x00"), []byte("WEBP")...), true},
		{"image/png", []byte("not a png"), false},
		{"text/plain", []byte("hello"), false},
	}
	for _, c := range cases {
		if got := magicMatches(c.ct, c.head); got != c.want {
			t.Errorf("magicMatches(%q) = %v, want %v", c.ct, got, c.want)
		}
	}
}

func dialTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HG_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("skipping integration test: HG_TEST_POSTGRES_DSN is not set")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedPending inserts a PENDING KYC stored_object whose declared size/type/sha256
// describe data, returning its id and the uploader account id.
func seedPending(t *testing.T, ctx context.Context, pool *pgxpool.Pool, contentType string, data []byte) (uploadID, owner string) {
	t.Helper()
	if err := pool.QueryRow(ctx, `
INSERT INTO account (email, status) VALUES ('u-'||substr(md5(random()::text),1,8)||'@hg.test', 'ACTIVE') RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed account: %v", err)
	}
	sum := sha256.Sum256(data)
	if err := pool.QueryRow(ctx, `
INSERT INTO stored_object
  (bucket, object_key, purpose, owner_account_id, content_type, byte_size, sha256, state, uploaded_by, deadline_at, deadline_action)
VALUES ('hg-kyc', 'k/'||md5(random()::text), 'KYC_DOCUMENT', $1, $2, $3, $4, 'PENDING', $1, now()+interval '1 hour', 'DELETE_UNCONFIRMED')
RETURNING id`, owner, contentType, len(data), sum[:]).Scan(&uploadID); err != nil {
		t.Fatalf("seed stored object: %v", err)
	}
	return uploadID, owner
}

// A matching object is verified and marked READY; a checksum mismatch rejects
// and deletes; a disguised file is a content-type mismatch. Ownership is
// enforced: a stranger gets ErrNotFound.
func TestConfirmUpload(t *testing.T) {
	ctx := context.Background()
	pool := dialTestPool(t)

	// Happy path: bytes match the declared fingerprint.
	data := pngBytes(2048)
	uploadID, owner := seedPending(t, ctx, pool, "image/png", data)
	repo := NewRepo(pool, nil, &fakeObjectStore{data: data, contentType: "image/png"}, Buckets{})
	actor := Actor{AccountID: owner, RequestID: "req-c"}

	out, err := repo.ConfirmUpload(ctx, actor, uploadID, false)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if out.State != "READY" {
		t.Fatalf("state = %s, want READY", out.State)
	}
	// Idempotent: a second confirm returns the same READY object.
	if out2, err := repo.ConfirmUpload(ctx, actor, uploadID, false); err != nil || out2.State != "READY" {
		t.Fatalf("second confirm not idempotent: %v state=%s", err, out2.State)
	}

	// Ownership: a stranger cannot confirm someone else's upload.
	uploadID2, _ := seedPending(t, ctx, pool, "image/png", data)
	if _, err := repo.ConfirmUpload(ctx, Actor{AccountID: "00000000-0000-0000-0000-000000000000"}, uploadID2, false); err != ErrNotFound {
		t.Fatalf("stranger confirm want ErrNotFound, got %v", err)
	}

	// Checksum mismatch: the store serves different bytes than were declared.
	uploadID3, owner3 := seedPending(t, ctx, pool, "image/png", data)
	badRepo := NewRepo(pool, nil, &fakeObjectStore{data: pngBytes(4096), contentType: "image/png"}, Buckets{})
	if _, err := badRepo.ConfirmUpload(ctx, Actor{AccountID: owner3}, uploadID3, false); err != errChecksum {
		t.Fatalf("checksum mismatch want errChecksum, got %v", err)
	}
	var state3, reason3 string
	if err := pool.QueryRow(ctx, `SELECT state::text, COALESCE(reject_reason,'') FROM stored_object WHERE id=$1`, uploadID3).Scan(&state3, &reason3); err != nil {
		t.Fatalf("read rejected: %v", err)
	}
	if state3 != "REJECTED" || reason3 != "CHECKSUM_MISMATCH" {
		t.Fatalf("state=%s reason=%s, want REJECTED/CHECKSUM_MISMATCH", state3, reason3)
	}

	// Content-type mismatch: a .pdf that is really a PNG.
	pdfDeclared := pngBytes(2048)
	uploadID4, owner4 := seedPending(t, ctx, pool, "application/pdf", pdfDeclared)
	fakeStore := &fakeObjectStore{data: pdfDeclared, contentType: "application/pdf"}
	pdfRepo := NewRepo(pool, nil, fakeStore, Buckets{})
	if _, err := pdfRepo.ConfirmUpload(ctx, Actor{AccountID: owner4}, uploadID4, false); err != errContentType {
		t.Fatalf("content type mismatch want errContentType, got %v", err)
	}
	if !fakeStore.removed {
		t.Fatal("a rejected object's bytes should be deleted")
	}
}

// A nil object store is honest: confirmUpload cannot mark READY what it never
// verified.
func TestConfirmUploadUnwired(t *testing.T) {
	repo := NewRepo(nil, nil, nil, Buckets{})
	if _, err := repo.ConfirmUpload(context.Background(), Actor{}, "x", false); err != errNotConfigured {
		t.Fatalf("want errNotConfigured, got %v", err)
	}
}
