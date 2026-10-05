package admin

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Config holds the settings the admin handlers need that are owned elsewhere.
//
// HalalCertMinRemainingDays and the SLA hours are platform_setting values (A-06)
// owned by the config module. Until that module exposes a reader, the boot wires
// these from the spec defaults; the values are read here, never hard-coded into
// the SQL, so the swap to a live reader is a one-line change.
type Config struct {
	// HalalCertMinRemainingDays is halal_cert_min_remaining_days (default 30).
	HalalCertMinRemainingDays int
	// OnboardingReviewSLAHours is onboarding_review_sla_hours (default 48).
	OnboardingReviewSLAHours int
}

// DefaultConfig returns the spec defaults (A-06) for the settings this module
// reads. TODO(config sibling): replace with a live platform_setting reader.
func DefaultConfig() Config {
	return Config{HalalCertMinRemainingDays: 30, OnboardingReviewSLAHours: 48}
}

// Handler serves the admin operations. It holds the repository and the settings
// it reads; it never opens a pool or reads identity from a request body.
type Handler struct {
	repo       *Repo
	ordersRepo *OrdersRepo
	cfg        Config
	now        func() time.Time
}

// NewHandler builds the admin handler.
func NewHandler(repo *Repo, cfg Config) *Handler {
	return &Handler{
		repo:       repo,
		ordersRepo: NewOrdersRepo(repo.pool, repo.orderCancelled),
		cfg:        cfg,
		now:        func() time.Time { return time.Now().UTC() },
	}
}

// today is the America/Toronto business date used for H5's expiry arithmetic
// (0.1: business rules evaluate in America/Toronto).
func (h *Handler) today() time.Time {
	loc, err := time.LoadLocation("America/Toronto")
	if err != nil {
		loc = time.UTC
	}
	n := h.now().In(loc)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC)
}

// actorFrom builds the audit actor from the verified principal (A-04): identity
// always comes from the session, never from the body.
func actorFrom(r *http.Request) auditActor {
	p := httpx.PrincipalFrom(r.Context())
	roles := make([]string, 0, len(p.Roles))
	for _, role := range p.Roles {
		roles = append(roles, string(role))
	}
	return auditActor{
		staffID:   p.AccountID,
		roles:     roles,
		sessionID: p.SessionID,
		requestID: httpx.RequestIDFrom(r.Context()),
		ip:        httpx.ClientIP(r),
		userAgent: r.Header.Get("User-Agent"),
	}
}

// decodeJSON strictly decodes the request body, refusing unknown fields
// (contract additionalProperties:false) and trailing content. It returns false
// and writes a 422 on any failure, so the caller returns immediately.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	dec := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
			"The request body could not be parsed against the schema.",
			[]httpx.FieldError{{Field: "body", Code: "invalid", Message: err.Error()}})
		return false
	}
	if dec.More() {
		httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed,
			"The request body carried trailing content.", nil)
		return false
	}
	return true
}

// fieldFail writes a single-field VALIDATION_FAILED.
func fieldFail(w http.ResponseWriter, r *http.Request, field, msg string) {
	httpx.Fail(w, r, http.StatusUnprocessableEntity, CodeValidationFailed, msg,
		[]httpx.FieldError{{Field: field, Code: "invalid", Message: msg}})
}

// parseLimit reads the ?limit= param, clamped to [1,100] with a default of 20.
func parseLimit(r *http.Request) int {
	const def, max = 20, 100
	v := r.URL.Query().Get("limit")
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// ptr returns a pointer to a copy of v, for the nullable contract fields.
func ptr[T any](v T) *T { return &v }

// tsPtr renders a nullable timestamp as the contract Timestamp scalar.
func tsPtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	return ptr(httpx.Timestamp(*t))
}

// dateStr renders a nullable date as YYYY-MM-DD.
func dateStr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	return ptr(t.Format("2006-01-02"))
}
