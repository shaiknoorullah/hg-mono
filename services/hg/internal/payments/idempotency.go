package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/idempotency"
)

// Idempotency is a request's Idempotency-Key with its scope and request hash
// (internal/idempotency). The router requires the header on every money route;
// the record itself is written in the transaction of the effect it guards.
type Idempotency = idempotency.Key

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
			c, err := idempotency.Claim(ctx, tx, idem)
			switch {
			case errors.Is(err, idempotency.ErrKeyReuse):
				return domainErr(string(httpx.CodeIdempotencyKeyReuse), 409,
					"This Idempotency-Key was already used for a different request.")
			case errors.Is(err, idempotency.ErrInProgress):
				return domainErr(string(httpx.CodeIdempotencyInProgress), 409,
					"A request with this Idempotency-Key is still in progress.")
			case err != nil:
				return err
			}
			if c.Replay != nil {
				return &errReplay{out: Outcome{Status: c.Replay.Status, Replayed: true, Body: c.Replay.Body}}
			}
			recordID = c.RecordID
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
		return idempotency.Complete(ctx, tx, recordID, idempotency.Response{Status: o.Status, Body: body})
	})
	var rep *errReplay
	if errors.As(err, &rep) {
		return rep.out, nil
	}
	return out, err
}

// readIdempotentBody reads a request body once, for both the hash and the
// decoder, and builds the request's Idempotency.
func readIdempotentBody(r *http.Request, pathTemplate string) ([]byte, *Idempotency, error) {
	return idempotency.FromRequest(r, pathTemplate)
}

// writeOutcome writes a deciding call's response: the first time through the
// usual envelope, and on a replay the stored bytes with Idempotency-Replayed.
func writeOutcome(w http.ResponseWriter, r *http.Request, out Outcome) {
	if !out.Replayed {
		httpx.Respond(w, r, out.Status, out.Data)
		return
	}
	idempotency.WriteReplay(w, r, idempotency.Response{Status: out.Status, Body: out.Body})
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
