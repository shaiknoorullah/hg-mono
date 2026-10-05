package payments

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Idempotency is a request's Idempotency-Key with the scope the contract gives
// it: (account, method, path template, key), plus a hash of the request, so
// the same key on a different request is refused rather than replayed
// (contracts/openapi.yaml, the IdempotencyKeyRequired parameter;
// docs/spec/01-platform.md, "P-37 — Idempotency keys"). The router requires the
// header on every money route; the record itself is written here, in the
// transaction of the effect it guards. Nothing else claims idempotency_record
// yet (internal/httpx/doc.go), so these refund and chargeback routes are the
// first to replay.
type Idempotency struct {
	AccountID    string
	Method       string
	PathTemplate string
	Key          string
	RequestHash  []byte
}

// Outcome is what a deciding service call produced: the status the contract
// gives it and the response's data member. On a replay Body holds the first
// response's bytes and Replayed is set.
type Outcome struct {
	Status   int
	Data     any
	Replayed bool
	Body     []byte
}

// errReplay carries a stored response out of the transaction, which is then
// rolled back: a replay changes nothing.
type errReplay struct{ out Outcome }

func (e *errReplay) Error() string { return "idempotent replay" }

// idempotencyTTL is how long a key is remembered (the contract: 24 h).
const idempotencyTTL = "24 hours"

// once runs fn in one transaction with the request's idempotency record. The
// first request with a key runs fn, and the record of its response commits
// with its effect, or neither does. A request with the same key and the same
// body gets the first response back, byte for byte, without running fn; the
// same key with a different request is 409 IDEMPOTENCY_KEY_REUSE. Two at once
// take turns on the record's unique index, so exactly one runs fn. A nil
// Idempotency runs fn in a plain transaction.
func (r *Repo) once(ctx context.Context, idem *Idempotency, fn func(tx pgx.Tx) (Outcome, error)) (Outcome, error) {
	var out Outcome
	err := r.tx(ctx, func(tx pgx.Tx) error {
		var recordID string
		if idem != nil {
			id, replay, err := claimIdempotency(ctx, tx, idem)
			if err != nil {
				return err
			}
			if replay != nil {
				return &errReplay{out: *replay}
			}
			recordID = id
		}
		o, err := fn(tx)
		if err != nil {
			return err
		}
		out = o
		if idem == nil {
			return nil
		}
		body, err := json.Marshal(struct {
			Data any `json:"data"`
		}{o.Data})
		if err != nil {
			return err
		}
		// The response is kept as a JSON string holding the exact bytes sent,
		// because jsonb would reorder its keys and the contract promises the
		// replay byte for byte.
		_, err = tx.Exec(ctx, `
			UPDATE idempotency_record
			   SET state = 'COMPLETED', response_status = $2, response_body = to_jsonb($3::text),
			       completed_at = now(), lease_until = NULL
			 WHERE id = $1`, recordID, o.Status, string(body))
		return err
	})
	var rep *errReplay
	if errors.As(err, &rep) {
		return rep.out, nil
	}
	return out, err
}

// claimIdempotency records the key as in progress, or reports the response
// already recorded for it.
func claimIdempotency(ctx context.Context, tx pgx.Tx, idem *Idempotency) (string, *Outcome, error) {
	for attempt := 0; attempt < 2; attempt++ {
		var id string
		err := tx.QueryRow(ctx, `
			INSERT INTO idempotency_record (account_id, method, path_template, key, request_hash, state,
			                                lease_until, expires_at)
			VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', now() + interval '1 minute', now() + $6::interval)
			ON CONFLICT (account_id, method, path_template, key) DO NOTHING
			RETURNING id::text`,
			idem.AccountID, idem.Method, idem.PathTemplate, idem.Key, idem.RequestHash, idempotencyTTL).Scan(&id)
		if err == nil {
			return id, nil, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", nil, err
		}
		// Someone used this key first; their transaction has finished, since
		// the insert waited on it.
		var (
			hash    []byte
			state   string
			status  *int
			body    *string
			expired bool
		)
		err = tx.QueryRow(ctx, `
			SELECT id::text, request_hash, state, response_status, response_body #>> '{}', expires_at < now()
			  FROM idempotency_record
			 WHERE account_id = $1 AND method = $2 AND path_template = $3 AND key = $4`,
			idem.AccountID, idem.Method, idem.PathTemplate, idem.Key).Scan(&id, &hash, &state, &status, &body, &expired)
		if errors.Is(err, pgx.ErrNoRows) {
			continue // removed in between; claim it again
		}
		if err != nil {
			return "", nil, err
		}
		if expired {
			// Past its 24 hours: the key is free again.
			if _, err := tx.Exec(ctx, `DELETE FROM idempotency_record WHERE id = $1`, id); err != nil {
				return "", nil, err
			}
			continue
		}
		if !bytes.Equal(hash, idem.RequestHash) {
			return "", nil, domainErr(string(httpx.CodeIdempotencyKeyReuse), 409,
				"This Idempotency-Key was already used for a different request.")
		}
		if state != "COMPLETED" || status == nil || body == nil {
			return "", nil, domainErr(string(httpx.CodeIdempotencyInProgress), 409,
				"A request with this Idempotency-Key is still in progress.")
		}
		return "", &Outcome{Status: *status, Replayed: true, Body: []byte(*body)}, nil
	}
	return "", nil, fmt.Errorf("idempotency key %q could not be claimed", idem.Key)
}

// readIdempotentBody reads a request body once, for both the hash and the
// decoder, and builds the request's Idempotency.
func readIdempotentBody(r *http.Request, pathTemplate string) ([]byte, *Idempotency, error) {
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
	return body, &Idempotency{
		AccountID:    httpx.PrincipalFrom(r.Context()).AccountID,
		Method:       r.Method,
		PathTemplate: pathTemplate,
		Key:          key,
		RequestHash:  h.Sum(nil),
	}, nil
}

// writeOutcome writes a deciding call's response: the first time through the
// usual envelope, and on a replay the stored bytes with Idempotency-Replayed.
func writeOutcome(w http.ResponseWriter, r *http.Request, out Outcome) {
	if !out.Replayed {
		httpx.Respond(w, r, out.Status, out.Data)
		return
	}
	if rid := httpx.RequestIDFrom(r.Context()); rid != "" {
		w.Header().Set("X-Request-ID", rid)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Idempotency-Replayed", "true")
	w.WriteHeader(out.Status)
	_, _ = w.Write(out.Body)
}

// decodeStrict decodes a body read by readIdempotentBody, refusing unknown
// fields so no price-shaped field can be smuggled in (the server prices every
// refund; only a goodwill refund carries an amount).
func decodeStrict(body []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("trailing content after the JSON body")
	}
	return nil
}
