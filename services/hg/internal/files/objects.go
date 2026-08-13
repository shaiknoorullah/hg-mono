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
	// Remove deletes the object (used when verification fails).
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

func (m *minioObjectStore) Remove(ctx context.Context, bucket, key string) error {
	return m.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}
