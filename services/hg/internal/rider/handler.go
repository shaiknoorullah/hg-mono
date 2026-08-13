package rider

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// ─── Types (stubs — Stage 1 RED) ─────────────────────────────────────────────

// Repo is the database access layer for the rider package.
// UNIMPLEMENTED — exists so the package compiles; every method panics.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo backed by the given pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// Service holds the business logic for the rider domain.
// UNIMPLEMENTED — exists so the package compiles.
type Service struct {
	repo *Repo
}

// NewService builds a Service.
func NewService(repo *Repo) *Service {
	return &Service{repo: repo}
}

// Handler is the HTTP handler for the rider surface.
// UNIMPLEMENTED — every method returns 501 Not Implemented.
type Handler struct {
	svc *Service
}

// NewHandler builds a Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ─── Action constants (must be present in the auth matrix) ───────────────────

const (
	ActionRiderReadSelf         httpx.Action = "rider.read_self"
	ActionRiderOnboardingRead   httpx.Action = "rider.onboarding.read"
	ActionRiderOnboardingWrite  httpx.Action = "rider.onboarding.write"
	ActionRiderDocumentRead     httpx.Action = "rider.document.read"
	ActionRiderDocumentWrite    httpx.Action = "rider.document.write"
	ActionRiderDashboardRead    httpx.Action = "rider.dashboard.read"
)

// ─── Routes ──────────────────────────────────────────────────────────────────

// Routes registers all rider self-service endpoints on the router.
// All routes require the RIDER role (x-roles: [RIDER]).
func Routes(r *httpx.Router, h *Handler) {
	r.Get("/v1/riders/me", httpx.Policy{
		Action:      ActionRiderReadSelf,
		Class:       httpx.ClassRead,
		OperationID: "getRiderMe",
	}, h.getRiderMe)

	r.Get("/v1/riders/me/onboarding/status", httpx.Policy{
		Action:      ActionRiderOnboardingRead,
		Class:       httpx.ClassRead,
		OperationID: "getRiderOnboardingStatus",
	}, h.getRiderOnboardingStatus)

	r.Post("/v1/riders/me/onboarding/profile", httpx.Policy{
		Action:      ActionRiderOnboardingWrite,
		Class:       httpx.ClassWrite,
		OperationID: "submitRiderProfile",
	}, h.submitRiderProfile)

	r.Post("/v1/riders/me/onboarding/vehicle", httpx.Policy{
		Action:      ActionRiderOnboardingWrite,
		Class:       httpx.ClassWrite,
		OperationID: "submitRiderVehicle",
	}, h.submitRiderVehicle)

	r.Get("/v1/riders/me/documents", httpx.Policy{
		Action:      ActionRiderDocumentRead,
		Class:       httpx.ClassRead,
		OperationID: "listRiderDocuments",
	}, h.listRiderDocuments)

	r.Post("/v1/riders/me/documents", httpx.Policy{
		Action:      ActionRiderDocumentWrite,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "attachRiderDocument",
	}, h.attachRiderDocument)

	r.Post("/v1/riders/me/onboarding/documents", httpx.Policy{
		Action:      ActionRiderOnboardingWrite,
		Class:       httpx.ClassWrite,
		Idempotent:  true,
		OperationID: "submitRiderDocuments",
	}, h.submitRiderDocuments)

	r.Get("/v1/riders/me/dashboard", httpx.Policy{
		Action:      ActionRiderDashboardRead,
		Class:       httpx.ClassRead,
		OperationID: "getRiderDashboard",
	}, h.getRiderDashboard)
}

// ─── Handlers (stubs — return 501) ───────────────────────────────────────────

func (h *Handler) getRiderMe(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"getRiderMe not implemented", nil)
}

func (h *Handler) getRiderOnboardingStatus(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"getRiderOnboardingStatus not implemented", nil)
}

func (h *Handler) submitRiderProfile(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"submitRiderProfile not implemented", nil)
}

func (h *Handler) submitRiderVehicle(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"submitRiderVehicle not implemented", nil)
}

func (h *Handler) listRiderDocuments(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"listRiderDocuments not implemented", nil)
}

func (h *Handler) attachRiderDocument(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"attachRiderDocument not implemented", nil)
}

func (h *Handler) submitRiderDocuments(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"submitRiderDocuments not implemented", nil)
}

func (h *Handler) getRiderDashboard(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotImplemented, httpx.CodeFeatureNotAvailableYet,
		"getRiderDashboard not implemented", nil)
}
