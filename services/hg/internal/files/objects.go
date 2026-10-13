package files

import (
	"context"
	"io"

	"github.com/minio/minio-go/v7"
)

// ObjectStat is the metadata confirmUpload verifies against the declared upload.
type ObjectStat struct {
	Size        int64
	ContentType string
}

// ObjectStore is the narrow slice of the object store confirmUpload needs beyond
// presigning (P-28): stat the object, read it to verify the checksum and sniff
// its magic bytes, and delete it when it fails verification. Keeping it an
// interface makes the confirm logic unit-testable without a live MinIO.
//
// A nil ObjectStore is honest: confirmUpload answers 503 rather than marking an
// object READY it never verified — the same posture the payments and orders
// siblings take for an unwired provider.
type ObjectStore interface {
	// Stat returns the object's size and content type, or an error if absent.
	Stat(ctx context.Context, bucket, key string) (ObjectStat, error)
	// Open returns a reader over the object's bytes; the caller closes it.
	Open(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	// Remove deletes the object's bytes for good: every stored version of the
	// key, not only the current one (used when verification fails).
	Remove(ctx context.Context, bucket, key string) error
}

// minioObjectStore adapts *minio.Client to ObjectStore. It lives here rather than
// in internal/store so files owns its own seam and does not import store.
type minioObjectStore struct {
	client *minio.Client
}

// NewMinIOObjectStore wraps the shared MinIO client as an ObjectStore. A nil
// client yields a nil ObjectStore so the boot can pass the honest unwired seam.
func NewMinIOObjectStore(client *minio.Client) ObjectStore {
	if client == nil {
		return nil
	}
	return &minioObjectStore{client: client}
}

func (m *minioObjectStore) Stat(ctx context.Context, bucket, key string) (ObjectStat, error) {
	info, err := m.client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ObjectStat{}, err
	}
	return ObjectStat{Size: info.Size, ContentType: info.ContentType}, nil
}

func (m *minioObjectStore) Open(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	obj, err := m.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}

// Remove deletes every version of exactly this key. Every bucket is versioned
// (the object storage row of docs/decisions/README.md,
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01),
// and on a versioned bucket a plain RemoveObject only adds a delete marker: the
// bytes of a rejected KYC upload would stay stored for another 35 days as an
// old version. Keys are server-generated and written once, so removing all of
// a key's versions never touches another object. Listing by prefix can return
// longer keys that share it; those are skipped.
func (m *minioObjectStore) Remove(ctx context.Context, bucket, key string) error {
	// List first, then delete, so deleting never shifts the listing's pages.
	listCtx, cancel := context.WithCancel(ctx)
	defer cancel() // stops the listing goroutine if we return early
	var versions []string
	for v := range m.client.ListObjects(listCtx, bucket, minio.ListObjectsOptions{Prefix: key, WithVersions: true}) {
		if v.Err != nil {
			return v.Err
		}
		if v.Key == key {
			versions = append(versions, v.VersionID)
		}
	}
	for _, id := range versions {
		if err := m.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{VersionID: id}); err != nil {
			return err
		}
	}
	return nil
}
