package catalog

import (
	"context"
	"net/url"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
)

// minioPresigner is a Presigner backed by the shared MinIO client. It mints a
// short-lived, single-use GET URL for a private object (P-28). The certificate
// document lives in a private bucket and is never served from a public URL.
type minioPresigner struct {
	objects *store.MinIO
}

// NewMinIOPresigner builds a Presigner over the store's MinIO client. A nil
// client (or nil store) yields a nil Presigner, which the handler treats as "no
// certificate is viewable" — a 404 rather than a fabricated URL.
func NewMinIOPresigner(objects *store.MinIO) Presigner {
	if objects == nil || objects.Client == nil {
		return nil
	}
	return &minioPresigner{objects: objects}
}

// PresignGet mints a presigned GET for bucket/objectKey valid for ttl. expiresAt
// is computed from the request time and the TTL so the client can display the
// exact expiry the URL was signed with.
func (p *minioPresigner) PresignGet(ctx context.Context, bucket, objectKey string, ttl time.Duration) (string, time.Time, error) {
	signedURL, err := p.objects.Client.PresignedGetObject(ctx, bucket, objectKey, ttl, url.Values{})
	if err != nil {
		return "", time.Time{}, err
	}
	return signedURL.String(), time.Now().UTC().Add(ttl), nil
}
