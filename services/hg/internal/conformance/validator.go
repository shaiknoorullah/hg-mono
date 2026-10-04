// Package conformance is the durable contract-conformance oracle for the
// HalalGoes Go backend. It closes the loop that every other gate leaves open: it
// takes bytes the running server actually emits and validates them against
// contracts/openapi.yaml with kin-openapi.
//
// Why this exists (the mechanism, not a bug fix): before this package, NO gate
// ever compared a running server's response body to the contract. The Go
// "conformance" tests asserted against hand-transcribed []string field lists
// and hand-maintained enum maps; the apps were built against the Prism mock,
// which always emits contract-perfect shapes. So backend drift from the
// contract was structurally invisible until the real server ran in production.
//
// This validator makes the contract itself the oracle. Because the contract
// schemas use additionalProperties:false + required[...] + closed enums,
// openapi3filter automatically rejects:
//   - extra fields a handler leaks (additionalProperties:false),
//   - missing required fields,
//   - wrong types,
//   - out-of-enum values,
//   - wrong nesting (flat where nested is required).
//
// No hand-copied []string can drift out of sync, because there is no hand-copied
// []string: the loaded openapi.yaml is the single source of truth.
package conformance

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// Spec bundles a loaded OpenAPI document with a route matcher and the set of
// declared operations. It is built once (LoadSpec) and shared read-only across
// every conformance test, so the 10k-line YAML is parsed a single time.
type Spec struct {
	Doc    *openapi3.T
	Router routers.Router

	// Operations maps operationId -> the declared method/path so a test can
	// enumerate the whole surface and account for coverage.
	Operations map[string]OperationRef
}

// OperationRef is one declared operation from the contract.
type OperationRef struct {
	OperationID string
	Method      string
	Path        string
	Public      bool // x-roles contains PUBLIC
	// HasJSON2xx is true when at least one 2xx response declares an
	// application/json body schema — i.e. there is something to validate.
	HasJSON2xx bool
}

// specConformanceHost is the host the harness rewrites every request to before
// route matching. The contract's servers list uses public hostnames
// (api.halalgoes.com); the in-process httptest servers use 127.0.0.1:<port>.
// LoadSpec normalises the doc's servers to this single host so gorillamux
// matches on path alone, regardless of the ephemeral test port.
const specConformanceHost = "https://conformance.local"

var (
	loadOnce sync.Once
	loaded   *Spec
	loadErr  error
)

// LoadSpec loads contracts/openapi.yaml exactly once and returns the shared
// Spec. The path is resolved relative to this package's directory
// (services/hg/internal/conformance) up to the repo root, so it works from the
// test working directory regardless of where `go test` is invoked.
func LoadSpec(t *testing.T) *Spec {
	t.Helper()
	loadOnce.Do(func() {
		loaded, loadErr = loadSpec()
	})
	if loadErr != nil {
		t.Fatalf("conformance: load openapi.yaml: %v", loadErr)
	}
	return loaded
}

func loadSpec() (*Spec, error) {
	path, err := findContract()
	if err != nil {
		return nil, err
	}

	loader := openapi3.NewLoader()
	loader.IsExternalRefsAllowed = false
	doc, err := loader.LoadFromFile(path)
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", path, err)
	}
	if err := doc.Validate(loader.Context); err != nil {
		return nil, fmt.Errorf("validate contract document: %w", err)
	}

	// Normalise servers to a single, host-only server so the gorillamux router
	// matches purely on the /v1/... path. Without this, the router would insist
	// on api.halalgoes.com and never match a 127.0.0.1 httptest request.
	doc.Servers = openapi3.Servers{{URL: specConformanceHost}}

	router, err := gorillamux.NewRouter(doc)
	if err != nil {
		return nil, fmt.Errorf("build router from contract: %w", err)
	}

	ops := map[string]OperationRef{}
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			if op == nil || op.OperationID == "" {
				continue
			}
			ref := OperationRef{
				OperationID: op.OperationID,
				Method:      method,
				Path:        path,
				Public:      rolesContainPublic(op),
				HasJSON2xx:  hasJSON2xx(op),
			}
			ops[op.OperationID] = ref
		}
	}

	return &Spec{Doc: doc, Router: router, Operations: ops}, nil
}

// findContract resolves contracts/openapi.yaml relative to this source file's
// directory. It walks up from the package dir until it finds a directory that
// contains contracts/openapi.yaml (the repo root), so the harness is robust to
// the go-test working directory.
func findContract() (string, error) {
	// The test working directory is the package directory
	// (services/hg/internal/conformance). Walk up to the repo root.
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "contracts", "openapi.yaml")
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("could not locate contracts/openapi.yaml walking up from %s", mustGetwd())
}

func mustGetwd() string {
	d, _ := os.Getwd()
	return d
}

func rolesContainPublic(op *openapi3.Operation) bool {
	raw, ok := op.Extensions["x-roles"]
	if !ok {
		return false
	}
	roles, ok := raw.([]interface{})
	if !ok {
		return false
	}
	for _, r := range roles {
		if s, ok := r.(string); ok && s == "PUBLIC" {
			return true
		}
	}
	return false
}

func hasJSON2xx(op *openapi3.Operation) bool {
	if op.Responses == nil {
		return false
	}
	for code, ref := range op.Responses.Map() {
		if !strings.HasPrefix(code, "2") {
			continue
		}
		if ref == nil || ref.Value == nil {
			continue
		}
		if mt := ref.Value.Content.Get("application/json"); mt != nil && mt.Schema != nil {
			return true
		}
	}
	return false
}

// matchOptions are the openapi3filter options the harness uses everywhere.
// MultiError collects every violation (so a report lists all drift on a body,
// not just the first). IncludeResponseStatus fails a response whose status the
// contract does not declare. AuthenticationFunc is a noop because the contract
// declares security schemes and validation would otherwise reject every op.
func matchOptions() *openapi3filter.Options {
	return &openapi3filter.Options{
		MultiError:            true,
		IncludeResponseStatus: true,
		AuthenticationFunc:    openapi3filter.NoopAuthenticationFunc,
	}
}

// findRoute matches an HTTP request to a contract operation. It rewrites the
// request's scheme+host to the normalised conformance host so matching depends
// only on method + path.
func (s *Spec) findRoute(req *http.Request) (*routers.Route, map[string]string, error) {
	// Clone the URL so the caller's request is untouched, and pin scheme/host.
	clone := *req
	u := *req.URL
	u.Scheme = "https"
	u.Host = "conformance.local"
	clone.URL = &u
	clone.Host = "conformance.local"
	return s.Router.FindRoute(&clone)
}

// ValidateResponse validates a live HTTP response body against the matched
// operation's declared response schema for the returned status code. This is
// the core oracle: it runs openapi3filter.ValidateResponse, which enforces
// additionalProperties:false, required[...], types, and closed enums from the
// contract — no hand-copied field lists.
//
// It returns the matched operationId (for coverage accounting) and any
// validation error. A nil error means the live body conforms to the contract.
//
// The response body is fully read and replaced so the caller may still read it.
func ValidateResponse(t *testing.T, spec *Spec, req *http.Request, resp *http.Response) (operationID string, err error) {
	t.Helper()

	route, pathParams, matchErr := spec.findRoute(req)
	if matchErr != nil {
		return "", fmt.Errorf("no contract operation matches %s %s: %w", req.Method, req.URL.Path, matchErr)
	}
	opID := ""
	if route.Operation != nil {
		opID = route.Operation.OperationID
	}

	body, readErr := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if readErr != nil {
		return opID, fmt.Errorf("read response body: %w", readErr)
	}
	// Restore the body for the caller.
	resp.Body = io.NopCloser(strings.NewReader(string(body)))

	reqInput := &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
		Options:    matchOptions(),
	}
	respInput := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: reqInput,
		Status:                 resp.StatusCode,
		Header:                 resp.Header,
		Options:                matchOptions(),
	}
	respInput.SetBodyBytes(body)

	if verr := openapi3filter.ValidateResponse(context.Background(), respInput); verr != nil {
		return opID, fmt.Errorf("response for %s (%s %s) status %d violates contract: %w",
			opID, req.Method, req.URL.Path, resp.StatusCode, verr)
	}
	return opID, nil
}

// ValidateRequest validates a request (method, path, params, and JSON body)
// against the matched operation's request schema. This catches INPUT DTO drift:
// a handler that renames a field and then decodes strictly will reject a
// contract-valid body; conversely, a request the contract forbids should be
// rejected here. The harness uses it to prove the wire *inputs* conform, and to
// pin the renamed-field drifts (reason vs reason_code, etc.).
//
// req.Body is read and restored so the caller may re-issue the same request.
func ValidateRequest(t *testing.T, spec *Spec, req *http.Request) (operationID string, err error) {
	t.Helper()

	route, pathParams, matchErr := spec.findRoute(req)
	if matchErr != nil {
		return "", fmt.Errorf("no contract operation matches %s %s: %w", req.Method, req.URL.Path, matchErr)
	}
	opID := ""
	if route.Operation != nil {
		opID = route.Operation.OperationID
	}

	// Snapshot and restore the body so a caller can re-send the request.
	if req.Body != nil {
		raw, rerr := io.ReadAll(req.Body)
		_ = req.Body.Close()
		if rerr != nil {
			return opID, fmt.Errorf("read request body: %w", rerr)
		}
		req.Body = io.NopCloser(strings.NewReader(string(raw)))
		req.GetBody = func() (io.ReadCloser, error) {
			return io.NopCloser(strings.NewReader(string(raw))), nil
		}
	}

	reqInput := &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
		Options:    matchOptions(),
	}
	if verr := openapi3filter.ValidateRequest(context.Background(), reqInput); verr != nil {
		return opID, fmt.Errorf("request for %s (%s %s) violates contract: %w",
			opID, req.Method, req.URL.Path, verr)
	}
	return opID, nil
}
