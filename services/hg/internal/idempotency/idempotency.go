// Package idempotency records a request's Idempotency-Key and replays the
// first answer to a retry (docs/spec/01-platform.md, "P-37 — Idempotency
// keys"; contracts/openapi.yaml, the IdempotencyKeyRequired parameter).
//
// The router only requires the header (httpx.IdempotencyKey). The record is
// claimed here, in the transaction of the effect it guards, so the effect and
// the record commit together or not at all. A module calls Claim first in that
// transaction and, once it knows its response, Complete.
//
// Scope is (account, method, path template, key), plus a hash of the request,
// so the same key on a different request is refused rather than replayed.
package idempotency

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Key is a request's Idempotency-Key with its scope and request hash.
type Key struct {
	AccountID    string
	Method       string
	PathTemplate string
	Key          string
	RequestHash  []byte
}

// Response is a recorded answer: its status and the exact bytes sent.
type Response struct {
	Status int
	Body   []byte
}

// Claimed is what Claim found. Exactly one of these holds:
//   - Replay is set: the key already answered; send Replay and do nothing else.
//   - ResourceID is set: an earlier attempt made its effect (and attached
//     ResourceID) but died before it answered, and its lease ran out. This
//     request now holds the record and finishes that attempt's work, which
//     must itself be safe to repeat (deterministic Stripe keys, conditional
//     updates).
//   - Neither: this request is the first; it holds RecordID.
type Claimed struct {
	RecordID   string
	ResourceID string
	Replay     *Response
}

var (
	// ErrKeyReuse is the same key on a different request: 409 IDEMPOTENCY_KEY_REUSE.
	ErrKeyReuse = errors.New("idempotency key reused for a different request")
	// ErrInProgress is the same request still running elsewhere: 409 IDEMPOTENCY_IN_PROGRESS.
	ErrInProgress = errors.New("a request with this idempotency key is in progress")
)

// ttl is how long a key is remembered (the contract: 24 h); lease is how long
// an attempt holds the record before another may take it over.
const (
	ttl   = "24 hours"
	lease = "1 minute"
)

// Claim records k as in progress in tx, or reports what is already recorded
// for it. Two requests at once take turns on the record's unique index: the
// second waits for the first's transaction and then sees its outcome.
func Claim(ctx context.Context, tx pgx.Tx, k *Key) (Claimed, error) {
	for attempt := 0; attempt < 2; attempt++ {
		var id string
		err := tx.QueryRow(ctx, `
			INSERT INTO idempotency_record (account_id, method, path_template, key, request_hash, state,
			                                lease_until, expires_at)
			VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now() + $6::interval, now() + $7::interval)
			ON CONFLICT (account_id, method, path_template, key) DO NOTHING
			RETURNING id::text`,
			k.AccountID, k.Method, k.PathTemplate, k.Key, k.RequestHash, lease, ttl).Scan(&id)
		if err == nil {
			return Claimed{RecordID: id}, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return Claimed{}, err
		}
		// Someone used this key first; their transaction has finished, since
		// the insert waited on it. Lock the record so one retry at a time
		// may take over an abandoned attempt.
		var (
			hash       []byte
			state      string
			status     *int
			body       *string
			resourceID *string
			expired    bool
			leaseLive  bool
		)
		err = tx.QueryRow(ctx, `
			SELECT id::text, request_hash, state, response_status, response_body #>> '{}', resource_id::text,
			       expires_at < now(), coalesce(lease_until > now(), false)
			  FROM idempotency_record
			 WHERE account_id = $1 AND method = $2 AND path_template = $3 AND key = $4
			   FOR UPDATE`,
			k.AccountID, k.Method, k.PathTemplate, k.Key).
			Scan(&id, &hash, &state, &status, &body, &resourceID, &expired, &leaseLive)
		if errors.Is(err, pgx.ErrNoRows) {
			continue // removed in between; claim it again
		}
		if err != nil {
			return Claimed{}, err
		}
		if expired {
			// Past its 24 hours: the key is free again.
			if _, err := tx.Exec(ctx, `DELETE FROM idempotency_record WHERE id = $1`, id); err != nil {
				return Claimed{}, err
			}
			continue
		}
		if !bytes.Equal(hash, k.RequestHash) {
			return Claimed{}, ErrKeyReuse
		}
		if state == "COMPLETED" && status != nil && body != nil {
			return Claimed{Replay: &Response{Status: *status, Body: []byte(*body)}}, nil
		}
		if leaseLive || resourceID == nil {
			return Claimed{}, ErrInProgress
		}
		// The attempt that made the effect died before answering: take over.
		if _, err := tx.Exec(ctx, `
			UPDATE idempotency_record SET lease_until = now() + $2::interval WHERE id = $1`, id, lease); err != nil {
			return Claimed{}, err
		}
		return Claimed{RecordID: id, ResourceID: *resourceID}, nil
	}
	return Claimed{}, fmt.Errorf("idempotency key %q could not be claimed", k.Key)
}

// Attach names the resource the claimed request created, in the transaction
// that created it, so a retry that takes over knows what was already done.
func Attach(ctx context.Context, tx pgx.Tx, recordID, resourceType, resourceID string) error {
	_, err := tx.Exec(ctx, `
		UPDATE idempotency_record SET resource_type = $2, resource_id = $3::uuid WHERE id = $1`,
		recordID, resourceType, resourceID)
	return err
}

// Execer is a pool or a transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Complete stores the answer for a claimed record. The body is kept as a JSON
// string holding the exact bytes sent, because jsonb would reorder its keys
// and the contract promises the replay byte for byte.
func Complete(ctx context.Context, db Execer, recordID string, res Response) error {
	_, err := db.Exec(ctx, `
		UPDATE idempotency_record
		   SET state = 'COMPLETED', response_status = $2, response_body = to_jsonb($3::text),
		       completed_at = now(), lease_until = NULL
		 WHERE id = $1`, recordID, res.Status, string(res.Body))
	return err
}

// FromRequest reads a request body once, for both the hash and the decoder,
// and builds the request's Key; nil when the route took no key.
func FromRequest(r *http.Request, pathTemplate string) ([]byte, *Key, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return nil, nil, err
	}
	key, ok := httpx.IdempotencyKeyFrom(r.Context())
	if !ok {
		return body, nil, nil
	}
	h := sha256.New()
	fmt.Fprintf(h, "%s %s\n", r.Method, r.URL.Path)
	h.Write(body)
	return body, &Key{
		AccountID:    httpx.PrincipalFrom(r.Context()).AccountID,
		Method:       r.Method,
		PathTemplate: pathTemplate,
		Key:          key,
		RequestHash:  h.Sum(nil),
	}, nil
}

// WriteReplay sends a recorded answer with Idempotency-Replayed: true.
func WriteReplay(w http.ResponseWriter, r *http.Request, res Response) {
	if rid := httpx.RequestIDFrom(r.Context()); rid != "" {
		w.Header().Set("X-Request-ID", rid)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Idempotency-Replayed", "true")
	w.WriteHeader(res.Status)
	_, _ = w.Write(res.Body)
}

// Capture runs write against w and returns the status and the bytes it sent,
// so they can be recorded exactly.
func Capture(w http.ResponseWriter, write func(http.ResponseWriter)) Response {
	c := &capture{ResponseWriter: w, status: http.StatusOK}
	write(c)
	return Response{Status: c.status, Body: c.body.Bytes()}
}

type capture struct {
	http.ResponseWriter
	status int
	body   bytes.Buffer
}

func (c *capture) WriteHeader(status int) {
	c.status = status
	c.ResponseWriter.WriteHeader(status)
}

func (c *capture) Write(b []byte) (int, error) {
	c.body.Write(b)
	return c.ResponseWriter.Write(b)
}
