package dispatch

import (
	"log/slog"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Logger: slog.Default(), Env: "local"})
	Routes(r, NewHandler(nil))
	if err := r.Verify(); err != nil {
		t.Fatalf("dispatch routes fail Verify: %v", err)
	}
	if len(r.PublicRoutes()) != 0 {
		t.Fatalf("dispatch must register no public routes, got %v", r.PublicRoutes())
	}
}
