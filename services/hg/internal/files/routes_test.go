package files

import (
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The uploads/documents routes must carry coherent, non-public policies: an
// upload URL and a document URL are both authenticated (P-28), and the router's
// Verify proves every route names an Action.
func TestRoutesVerify(t *testing.T) {
	r := httpx.NewRouter(httpx.Options{Env: "local"})
	Routes(r, &Handler{})
	if err := r.Verify(); err != nil {
		t.Fatalf("files routes failed policy verification: %v", err)
	}
	if pub := r.PublicRoutes(); len(pub) != 0 {
		t.Errorf("files routes must never be public, found: %v", pub)
	}
}
