package rider

// This bridge replaces the hand-transcribed enum var lists and closed-object
// key sets that used to live in rider_shape_test.go (enumOnboardingState,
// assertClosedObject, assertKycDocumentShape, …). A "closed shape" check is only
// as correct as the human transcription behind it; the file even hard-coded the
// RiderMe key set as a literal. The real oracle is the loaded contract.
//
// checkConformant serves a request through the rider router and validates the
// live recorder body against contracts/openapi.yaml via the kin-openapi oracle
// (internal/conformance.ValidateResponse). additionalProperties:false +
// required[] + closed enums are enforced automatically — no []string can drift.

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/conformance"
)

// checkConformant issues method+path (with optional JSON body + auth) against
// the router, asserts the status, validates the live body against the contract,
// and returns the decoded {data} object for any additional value assertions.
func checkConformant(t *testing.T, router http.Handler, method, path string, body any, authHeader string, wantStatus int, extraHeaders ...string) map[string]any {
	t.Helper()

	var bodyReader io.Reader
	var raw []byte
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		raw = b
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, path, bodyReader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(raw)), nil }
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	for i := 0; i+1 < len(extraHeaders); i += 2 {
		req.Header.Set(extraHeaders[i], extraHeaders[i+1])
	}

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Fatalf("%s %s: status=%d, want %d — body: %s", method, path, rec.Code, wantStatus, rec.Body)
	}

	// Reconstruct an *http.Response from the recorder for the validator.
	resp := &http.Response{
		StatusCode: rec.Code,
		Header:     rec.Header(),
		Body:       io.NopCloser(bytes.NewReader(rec.Body.Bytes())),
		Request:    req,
	}
	spec := conformance.LoadSpec(t)
	opID, verr := conformance.ValidateResponse(t, spec, req, resp)
	if verr != nil {
		t.Errorf("CONFORMANCE FAIL (%s): %v", opID, verr)
	}

	var env map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	data, _ := env["data"].(map[string]any)
	return data
}
