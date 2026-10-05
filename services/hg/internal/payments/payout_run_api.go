package payments

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The admin payout-run operations: createPayoutRun, listPayoutRuns and
// getPayoutRun in contracts/openapi.yaml (issue #251).

// codeMFARequired is the contract's MFA_REQUIRED error code.
const codeMFARequired httpx.ErrorCode = "MFA_REQUIRED"

// PayoutPayeeDTO is the contract PayoutPayee schema.
type PayoutPayeeDTO struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// PayoutRunInput is the contract PayoutRunInput schema. It carries no money.
type PayoutRunInput struct {
	Reason string          `json:"reason"`
	Payee  *PayoutPayeeDTO `json:"payee,omitempty"`
	AsOf   *string         `json:"as_of,omitempty"`
}

// PayoutRunDTO is the contract PayoutRun schema.
type PayoutRunDTO struct {
	ID          string          `json:"id"`
	Kind        string          `json:"kind"`
	State       string          `json:"state"`
	Payee       *PayoutPayeeDTO `json:"payee"`
	PeriodStart string          `json:"period_start"`
	PeriodEnd   string          `json:"period_end"`
	AsOf        string          `json:"as_of"`
	DueAt       string          `json:"due_at"`
	RequestedBy *string         `json:"requested_by"`
	Reason      *string         `json:"reason"`
	StartedAt   *string         `json:"started_at"`
	FinishedAt  *string         `json:"finished_at"`
	Attempts    int32           `json:"attempts"`
	Partners    int32           `json:"partners"`
	Paid        int32           `json:"paid"`
	Held        int32           `json:"held"`
	Released    int32           `json:"released"`
	Carried     int32           `json:"carried"`
	Failed      int32           `json:"failed"`
	PaidCents   int64           `json:"paid_cents"`
	HeldCents   int64           `json:"held_cents"`
	Error       *string         `json:"error"`
	CreatedAt   string          `json:"created_at"`
}

// PayoutRunLineDTO is the contract PayoutRunLine schema.
type PayoutRunLineDTO struct {
	Payee       PayoutPayeeDTO `json:"payee"`
	Outcome     string         `json:"outcome"`
	PayoutID    *string        `json:"payout_id"`
	AmountCents int64          `json:"amount_cents"`
	Detail      *string        `json:"detail"`
	At          string         `json:"at"`
}

// PayoutRunDetailDTO is the contract PayoutRunDetail schema.
type PayoutRunDetailDTO struct {
	PayoutRunDTO
	Lines []PayoutRunLineDTO `json:"lines"`
}

func payoutRunToDTO(r PayoutRunRow) PayoutRunDTO {
	dto := PayoutRunDTO{
		ID: r.ID, Kind: r.Kind, State: r.State,
		PeriodStart: tsFor(r.PeriodStart), PeriodEnd: tsFor(r.PeriodEnd),
		AsOf: tsFor(r.AsOf), DueAt: tsFor(r.DueAt), RequestedBy: r.RequestedBy, Reason: r.Reason,
		StartedAt: tsPtr(r.StartedAt), FinishedAt: tsPtr(r.FinishedAt), Attempts: r.Attempts,
		Partners: r.Partners, Paid: r.Paid, Held: r.Held, Released: r.Released, Carried: r.Carried,
		Failed: r.Failed, PaidCents: r.PaidCents, HeldCents: r.HeldCents, Error: r.Error,
		CreatedAt: tsFor(r.CreatedAt),
	}
	if r.Payee != nil {
		dto.Payee = &PayoutPayeeDTO{Type: r.Payee.Type, ID: r.Payee.ID}
	}
	return dto
}

// asQueued is a run as it was when it was queued: what a replayed request
// returns, so the replay is byte-identical to the first response.
func asQueued(r PayoutRunRow) PayoutRunRow {
	return PayoutRunRow{
		ID: r.ID, Kind: r.Kind, State: RunQueued, PeriodStart: r.PeriodStart, PeriodEnd: r.PeriodEnd,
		AsOf: r.AsOf, DueAt: r.DueAt, Payee: r.Payee, RequestedBy: r.RequestedBy, Reason: r.Reason,
		Fingerprint: r.Fingerprint, CreatedAt: r.CreatedAt,
	}
}

// WithPayoutRunner gives the service the payout runner that admin requests
// queue work for. Without one (Stripe not configured), createPayoutRun
// answers 503.
func (s *Service) WithPayoutRunner(r *PayoutRunner) *Service {
	s.payouts = r
	return s
}

// RequestPayoutRun queues an admin payout run for the admin in ctx.
func (s *Service) RequestPayoutRun(ctx context.Context, req PayoutRunRequest) (PayoutRunDTO, bool, error) {
	if _, err := requirePayoutAdmin(ctx, true); err != nil {
		return PayoutRunDTO{}, false, payoutAuthError(err)
	}
	if s.payouts == nil {
		return PayoutRunDTO{}, false, ErrStripeNotConfigured
	}
	run, replayed, err := s.payouts.Request(ctx, req)
	switch {
	case errors.Is(err, ErrNotPayoutAdmin), errors.Is(err, ErrTwoStepRequired):
		return PayoutRunDTO{}, false, payoutAuthError(err)
	case errors.Is(err, ErrReasonRequired):
		return PayoutRunDTO{}, false, domainErr(string(httpx.CodeValidationFailed), http.StatusUnprocessableEntity,
			"reason must be 10–500 characters: say why the run is needed now.")
	case errors.Is(err, ErrNotFound):
		return PayoutRunDTO{}, false, domainErr(httpxNotFound, http.StatusNotFound, "No restaurant or rider with this id.")
	case errors.Is(err, ErrAsOfInFuture):
		return PayoutRunDTO{}, false, domainErr(string(httpx.CodeValidationFailed), http.StatusUnprocessableEntity,
			"as_of may not be in the future: a run never pays a week before it has closed.")
	case errors.Is(err, ErrOwnPayout):
		return PayoutRunDTO{}, false, domainErr(string(httpx.CodeForbidden), http.StatusForbidden,
			"You may not run a payout for yourself or for a restaurant you belong to.")
	case errors.Is(err, ErrIdempotencyReuse):
		return PayoutRunDTO{}, false, domainErr(string(httpx.CodeIdempotencyKeyReuse), http.StatusConflict,
			"This Idempotency-Key was already used with a different body.")
	case err != nil:
		return PayoutRunDTO{}, false, err
	}
	if replayed {
		run = asQueued(run)
	}
	return payoutRunToDTO(run), replayed, nil
}

// payoutAuthError maps a refused caller to its 403.
func payoutAuthError(err error) error {
	if errors.Is(err, ErrTwoStepRequired) {
		return domainErr(string(codeMFARequired), http.StatusForbidden,
			"Running a payout needs a session signed in with two-step sign-in.")
	}
	return domainErr(string(httpx.CodeForbidden), http.StatusForbidden,
		"Only an admin may run or read payout runs.")
}

// GetPayoutRun returns one run and its lines, to an admin in ctx.
func (s *Service) GetPayoutRun(ctx context.Context, id string) (PayoutRunDetailDTO, error) {
	if _, err := requirePayoutAdmin(ctx, false); err != nil {
		return PayoutRunDetailDTO{}, payoutAuthError(err)
	}
	if _, err := uuid.Parse(id); err != nil {
		return PayoutRunDetailDTO{}, domainErr(httpxNotFound, http.StatusNotFound, "No such payout run.")
	}
	run, err := s.repo.GetPayoutRun(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return PayoutRunDetailDTO{}, domainErr(httpxNotFound, http.StatusNotFound, "No such payout run.")
	}
	if err != nil {
		return PayoutRunDetailDTO{}, err
	}
	lines, err := s.repo.PayoutRunLines(ctx, id)
	if err != nil {
		return PayoutRunDetailDTO{}, err
	}
	out := PayoutRunDetailDTO{PayoutRunDTO: payoutRunToDTO(run), Lines: make([]PayoutRunLineDTO, 0, len(lines))}
	for _, l := range lines {
		out.Lines = append(out.Lines, PayoutRunLineDTO{
			Payee:   PayoutPayeeDTO{Type: l.Payee.Type, ID: l.Payee.ID},
			Outcome: string(l.Outcome), PayoutID: l.PayoutID, AmountCents: l.AmountCents,
			Detail: l.Detail, At: tsFor(l.At),
		})
	}
	return out, nil
}

// ListPayoutRuns returns runs newest first, to an admin in ctx.
func (s *Service) ListPayoutRuns(ctx context.Context, limit int, cursor string) ([]PayoutRunDTO, error) {
	if _, err := requirePayoutAdmin(ctx, false); err != nil {
		return nil, payoutAuthError(err)
	}
	if cursor != "" {
		if _, err := uuid.Parse(cursor); err != nil {
			return nil, domainErr(string(httpx.CodeValidationFailed), http.StatusUnprocessableEntity, "The cursor is not valid.")
		}
	}
	runs, err := s.repo.ListPayoutRuns(ctx, limit, cursor)
	if err != nil {
		return nil, err
	}
	out := make([]PayoutRunDTO, 0, len(runs))
	for _, r := range runs {
		out = append(out, payoutRunToDTO(r))
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

// CreatePayoutRun implements POST /v1/admin/payout-runs (createPayoutRun).
func (h *Handler) CreatePayoutRun(w http.ResponseWriter, r *http.Request) {
	// The router has already refused anyone without payout_run.create (only
	// admins hold it); the service checks the caller again, with two-step
	// sign-in, before anything is queued.
	if _, err := requirePayoutAdmin(r.Context(), true); err != nil {
		h.fail(w, r, payoutAuthError(err))
		return
	}
	var in PayoutRunInput
	if err := decodeJSON(r, &in); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"The request body is not valid.", []httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return
	}
	if n := len([]rune(strings.TrimSpace(in.Reason))); n < 10 || n > 500 {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
			"reason must be 10–500 characters: say why the run is needed now.",
			[]httpx.FieldError{{Field: "reason", Code: "length", Message: "must be 10–500 characters"}})
		return
	}
	req := PayoutRunRequest{Reason: strings.TrimSpace(in.Reason)}
	req.IdempotencyKey, _ = httpx.IdempotencyKeyFrom(r.Context())
	if in.Payee != nil {
		if in.Payee.Type != PayeeRestaurant && in.Payee.Type != PayeeRider {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"payee.type must be RESTAURANT or RIDER.",
				[]httpx.FieldError{{Field: "payee.type", Code: "enum", Message: "must be RESTAURANT or RIDER"}})
			return
		}
		if _, err := uuid.Parse(in.Payee.ID); err != nil {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"payee.id must be a uuid.", []httpx.FieldError{{Field: "payee.id", Code: "format", Message: "must be a uuid"}})
			return
		}
		req.Payee = &PayeeRef{Type: in.Payee.Type, ID: in.Payee.ID}
	}
	if in.AsOf != nil {
		t, err := time.Parse(time.RFC3339Nano, *in.AsOf)
		if err != nil {
			httpx.Fail(w, r, http.StatusUnprocessableEntity, httpx.CodeValidationFailed,
				"as_of must be an RFC 3339 timestamp.", []httpx.FieldError{{Field: "as_of", Code: "format", Message: "must be RFC 3339"}})
			return
		}
		req.AsOf = &t
	}
	run, replayed, err := h.svc.RequestPayoutRun(r.Context(), req)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if replayed {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	httpx.Respond(w, r, http.StatusAccepted, run)
}

// ListPayoutRuns implements GET /v1/admin/payout-runs (listPayoutRuns).
func (h *Handler) ListPayoutRuns(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := min(atoiDefault(q.Get("limit"), 20), 100)
	runs, err := h.svc.ListPayoutRuns(r.Context(), limit, q.Get("cursor"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	meta := httpx.Meta{HasMore: len(runs) == limit}
	if len(runs) > 0 && meta.HasMore {
		meta.NextCursor = &runs[len(runs)-1].ID
	}
	httpx.RespondList(w, r, http.StatusOK, runs, meta)
}

// GetPayoutRun implements GET /v1/admin/payout-runs/{runId} (getPayoutRun).
func (h *Handler) GetPayoutRun(w http.ResponseWriter, r *http.Request) {
	run, err := h.svc.GetPayoutRun(r.Context(), chi.URLParam(r, "runId"))
	if err != nil {
		h.fail(w, r, err)
		return
	}
	httpx.Respond(w, r, http.StatusOK, run)
}
