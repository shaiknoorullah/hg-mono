package admin

// This bridge replaces the hand-transcribed []string field lists that used to
// live in handler_orders_conformance_test.go / handler_menu_conformance_test.go.
// Those lists were the reason drift passed: a "closed schema" check is only as
// correct as the human transcription behind it, and the menu file's own header
// admitted it whitelisted non-contract fields.
//
// assertConformant runs the LIVE response through the real kin-openapi oracle
// (internal/conformance.ValidateResponse) against contracts/openapi.yaml, so the
// loaded contract — additionalProperties:false + required[] + closed enums — is
// the single source of truth. No []string can drift.

import (
	"net/http"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/conformance"
)

// assertConformant validates resp against the contract schema for its matched
// operation and status. It fails the test on any violation. resp.Request must be
// set (the http client sets it), so the operation and status are derived from
// the real round-trip.
func assertConformant(t *testing.T, resp *http.Response) {
	t.Helper()
	spec := conformance.LoadSpec(t)
	if resp.Request == nil {
		t.Fatalf("assertConformant: response has no associated request")
	}
	opID, err := conformance.ValidateResponse(t, spec, resp.Request, resp)
	if err != nil {
		t.Errorf("CONFORMANCE FAIL (%s): %v", opID, err)
	}
}
