package catalog

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// Handler serves the catalogue and discovery operations. It holds the repo, a
// media resolver for image URLs, a presigner for certificate views, and a
// resolver that maps an authenticated staff principal to the restaurant it acts
// for.
type Handler struct {
	repo      *Repo
	media     MediaResolver
	presigner Presigner
	scope     RestaurantScopeResolver
	now       func() time.Time
}

// Presigner mints a short-lived GET URL for a private object (P-28). The files
// module owns the MinIO-backed implementation; the certificate-view route needs
// only this narrow capability.
type Presigner interface {
	PresignGet(ctx context.Context, bucket, objectKey string, ttl time.Duration) (string, time.Time, error)
}

// RestaurantScopeResolver maps an authenticated principal to the restaurant id
// it is scoped to (P-07). Ownership is answered by the account_role table the
// staff/RBAC module owns; catalogue only consumes the answer. A principal with
// no restaurant scope yields ("", false).
type RestaurantScopeResolver interface {
	RestaurantForPrincipal(ctx context.Context, p httpx.Principal) (string, bool)
}

// NewHandler builds the catalogue handler. media and presigner may be nil in a
// minimal wiring; a nil media renders every image as null (a neutral
// placeholder, which is correct per the contract), and a nil presigner makes
// certificate_viewable false and createCertificateViewUrl answer 404.
func NewHandler(repo *Repo, media MediaResolver, presigner Presigner, scope RestaurantScopeResolver) *Handler {
	if media == nil {
		media = nilMedia{}
	}
	return &Handler{
		repo:      repo,
		media:     media,
		presigner: presigner,
		scope:     scope,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

// fail404NotFound is the single not-found answer. For a customer read path this
// is deliberately the same answer whether the restaurant does not exist or is
// merely not halal-visible (C-13) — the two are indistinguishable by design.
func (h *Handler) failNotFound(w http.ResponseWriter, r *http.Request) {
	httpx.Fail(w, r, http.StatusNotFound, codeRestaurantNotFound, "No such restaurant.", nil)
}

// mapErr writes the correct status for a repository error and reports whether it
// handled one.
func (h *Handler) mapErr(w http.ResponseWriter, r *http.Request, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errNotFound) {
		h.failNotFound(w, r)
		return true
	}
	slog.Error("catalog internal error", slog.String("path", r.URL.Path), slog.Any("err", err))
	httpx.Fail(w, r, http.StatusInternalServerError, httpx.CodeInternalError,
		"Something went wrong reading the catalogue.", nil)
	return true
}
