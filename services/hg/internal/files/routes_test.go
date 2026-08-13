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
	// The three contract ops must all be registered.
	want := map[string]bool{
		"POST /v1/uploads":                            false,
		"POST /v1/uploads/{uploadId}/confirm":         false,
		"GET /v1/documents/{documentId}/download-url": false,
	}
	for _, got := range r.Routes() {
		if _, ok := want[got]; ok {
			want[got] = true
		}
	}
	for route, present := range want {
		if !present {
			t.Errorf("expected route %q to be registered", route)
		}
	}
}
