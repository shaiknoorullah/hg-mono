package catalog

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resolver is the real MediaResolver: it turns a stored-object into the public
// URL a client can GET directly. Only the hg-media bucket is public-read (the
// deploy stack runs `mc anonymous set download hg/hg-media`); KYC and POD stay
// private behind short-lived presigned URLs and are never resolved here. A media
// object's public URL is therefore direct and unsigned:
//
//	<publicBase>/<bucket>/<object_key>
//
// where object_key is the server-allocated key (e.g.
// hg-media/menu-item/{id}/{ulid}_{variant}.webp), which is not derivable from
// the object id and must be read from stored_object.
type Resolver struct {
	pool        *pgxpool.Pool
	publicBase  string // scheme+host, no trailing slash
	mediaBucket string // the single public-read bucket
}

// NewResolver builds a media resolver over the shared pool. publicBase is the
// scheme+host clients reach the public bucket at (config.MinIO.PublicBaseURL);
// mediaBucket is the public-read bucket name (config.MinIO.Buckets.Media). A
// blank publicBase makes every URL null — contract-valid, and the honest answer
// when the deployment has not declared where media is served from.
func NewResolver(pool *pgxpool.Pool, publicBase, mediaBucket string) *Resolver {
	return &Resolver{pool: pool, publicBase: publicBase, mediaBucket: mediaBucket}
}

// URLForKey builds the public URL from an already-fetched (bucket, object_key)
// pair — the list and menu projections join stored_object and hand the key
// straight here, so there is no per-row lookup (no N+1). It returns nil unless
// the object lives in the public media bucket and both inputs are non-empty:
// a private bucket, an empty key or an unconfigured base all render as null,
// which the contract shows as a neutral placeholder rather than a broken link.
func (r *Resolver) URLForKey(bucket, objectKey string) *string {
	if r == nil || r.publicBase == "" || bucket == "" || objectKey == "" {
		return nil
	}
	if bucket != r.mediaBucket {
		// Never mint a public URL for a private object, even if a caller wired
		// the wrong id: KYC/POD are private by invariant (P-27 / #7).
		return nil
	}
	u := r.publicBase + "/" + bucket + "/" + objectKey
	return &u
}

// PublicURL resolves a single stored-object id to its public URL with one
// lookup. It reads (bucket, object_key) WHERE id=$1 AND state='READY' — an
// unconfirmed or deleted object is never served — and returns nil when the
// object is missing, not ready, or lives in a private bucket. This is the
// single-item path; list projections use URLForKey after a join to avoid N+1.
func (r *Resolver) PublicURL(ctx context.Context, objectID string) *string {
	if r == nil || r.pool == nil || r.publicBase == "" || objectID == "" {
		return nil
	}
	var bucket, objectKey string
	err := r.pool.QueryRow(ctx,
		`SELECT bucket, object_key FROM stored_object WHERE id = $1 AND state = 'READY'`,
		objectID).Scan(&bucket, &objectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		// A read failure is not a place to fabricate a URL; render null.
		return nil
	}
	return r.URLForKey(bucket, objectKey)
}
