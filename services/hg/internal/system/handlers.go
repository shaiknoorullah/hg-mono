package system

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/store"
)

// ActionDepsRead is the P-05 action guarding the dependency report. The contract
// gives getDependencyStatus x-roles [ADMIN, SUPER_ADMIN]; the role→action
// mapping itself belongs in the authz matrix the auth sibling owns.
const ActionDepsRead httpx.Action = "platform_deps.read"

// Handler serves the system operations.
type Handler struct {
	cfg       *config.Config
	store     *store.Store
	startedAt time.Time
	// bootProbes are the G-7 probe results captured at boot. They are reported
	// as of boot, not re-run per request: a probe that mutates or scans buckets
	// is not something to hang off a public HTTP path.
	bootProbes []store.Probe
	// openAPIDocJSON is the contracts/openapi.yaml document marshalled as JSON,
	// served by getOpenApiDocument. Nil if the file was not found at boot (the
	// handler answers 501 in that case rather than crashing).
	openAPIDocJSON []byte
}

// NewHandler builds the system handler. It attempts to load contracts/openapi.yaml
// from the working directory upward so that getOpenApiDocument can serve it; the
// handler boots normally even if the file is absent.
func NewHandler(cfg *config.Config, st *store.Store, startedAt time.Time, probes []store.Probe) *Handler {
	h := &Handler{cfg: cfg, store: st, startedAt: startedAt, bootProbes: probes}
	if b, err := loadContractAsJSON(); err == nil {
		h.openAPIDocJSON = b
	}
	return h
}

// loadContractAsJSON walks up from the process working directory looking for
// contracts/openapi.yaml, parses it as YAML, and re-encodes it as JSON so the
// getOpenApiDocument handler can serve an application/json body.
func loadContractAsJSON() ([]byte, error) {
	dir, err := os.Getwd()
	if err != nil {
		return nil, err
	}
	var yamlBytes []byte
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "contracts", "openapi.yaml")
		if b, readErr := os.ReadFile(candidate); readErr == nil {
			yamlBytes = b
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	if yamlBytes == nil {
		return nil, os.ErrNotExist
	}
	// Parse YAML into a generic map and re-encode as JSON so the body is
	// standards-compliant JSON (clients expect application/json, not YAML).
	var doc any
	if err := yaml.Unmarshal(yamlBytes, &doc); err != nil {
		return nil, err
	}
	// yaml.Unmarshal uses map[string]interface{} for objects, which json.Marshal
	// handles correctly, but map keys decoded by the go-yaml library may be
	// interface{} when the YAML has non-string keys. Normalise to string keys.
	doc = normaliseYAMLNode(doc)
	return json.Marshal(doc)
}

// normaliseYAMLNode converts map[interface{}]interface{} (as emitted by go-yaml
// v2 for non-string-keyed maps) into map[string]interface{} so json.Marshal can
// encode it. yaml.v3 already emits map[string]interface{} for object nodes, but
// we normalise defensively.
func normaliseYAMLNode(v any) any {
	switch val := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, child := range val {
			out[k] = normaliseYAMLNode(child)
		}
		return out
	case map[any]any:
		out := make(map[string]any, len(val))
		for k, child := range val {
			out[jsonKey(k)] = normaliseYAMLNode(child)
		}
		return out
	case []any:
		for i, child := range val {
			val[i] = normaliseYAMLNode(child)
		}
		return val
	default:
		return v
	}
}

func jsonKey(k any) string {
	if s, ok := k.(string); ok {
		return s
	}
	b, _ := json.Marshal(k)
	return string(b)
}

// healthStatus is the contract's HealthStatus schema.
type healthStatus struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	StartedAt string `json:"started_at"`
}

// Health implements getHealth: 200 while the process is alive. It never touches
// a dependency — that is what readiness is for, and conflating them is how a
// liveness probe ends up restarting a healthy replica because a database was
// briefly slow.
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	httpx.Respond(w, r, http.StatusOK, healthStatus{
		Status:    "ok",
		Version:   h.cfg.ServiceVersion,
		StartedAt: httpx.Timestamp(h.startedAt),
	})
}

// readinessDependency is one item of the contract's ReadinessStatus.dependencies.
type readinessDependency struct {
	Name   string  `json:"name"`
	Ready  bool    `json:"ready"`
	Detail *string `json:"detail"`
}

// readinessStatus is the contract's ReadinessStatus schema.
type readinessStatus struct {
	Ready        bool                  `json:"ready"`
	Dependencies []readinessDependency `json:"dependencies"`
}

// Readiness implements getReadiness.
//
// This is the walking skeleton's proof of wiring: it runs a real `SELECT 1`
// through pgx, a real PING through go-redis and a real ListBuckets through
// minio-go, and answers 503 with the failing dependency named so Traefik removes
// the replica from rotation.
func (h *Handler) Readiness(w http.ResponseWriter, r *http.Request) {
	rep := h.store.Check(r.Context())

	out := readinessStatus{Ready: rep.Ready(), Dependencies: make([]readinessDependency, 0, len(rep.Dependencies))}
	for _, d := range rep.Dependencies {
		item := readinessDependency{Name: d.Name, Ready: d.Connected}
		if d.Detail != "" {
			detail := d.Detail
			item.Detail = &detail
		}
		out.Dependencies = append(out.Dependencies, item)
	}

	status := http.StatusOK
	if !out.Ready {
		status = http.StatusServiceUnavailable
	}
	// G-6: the status and the body always agree. A not-ready body never ships
	// with a 200, which is what makes this usable as a load-balancer check.
	httpx.Respond(w, r, status, out)
}

// contractDependency is one item of the contract's DependencyReport.dependencies.
// The schema sets additionalProperties:false, so this shape is exact.
type contractDependency struct {
	Name            string `json:"name"`
	ResolvedAddress string `json:"resolved_address"`
	Connected       bool   `json:"connected"`
}

type contractProbe struct {
	Name   string  `json:"name"`
	Passed bool    `json:"passed"`
	Detail *string `json:"detail"`
}

type dependencyReport struct {
	Environment  string               `json:"environment"`
	Dependencies []contractDependency `json:"dependencies"`
	BootProbes   []contractProbe      `json:"boot_probes"`
}

// DependencyStatus implements getDependencyStatus (GET /internal/deps), in the
// contract's exact shape.
func (h *Handler) DependencyStatus(w http.ResponseWriter, r *http.Request) {
	rep := h.store.Check(r.Context())

	out := dependencyReport{
		Environment:  rep.Environment,
		Dependencies: make([]contractDependency, 0, len(rep.Dependencies)),
		BootProbes:   make([]contractProbe, 0, len(h.bootProbes)),
	}
	for _, d := range rep.Dependencies {
		out.Dependencies = append(out.Dependencies, contractDependency{
			Name:            d.Name,
			ResolvedAddress: d.ResolvedAddress,
			Connected:       d.Connected,
		})
	}
	for _, p := range h.bootProbes {
		item := contractProbe{Name: p.Name, Passed: p.Passed}
		if p.Detail != "" {
			detail := p.Detail
			item.Detail = &detail
		}
		out.BootProbes = append(out.BootProbes, item)
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// debugDependency is the richer, non-contract shape.
//
// configured_address and resolved_address are both present and that is the
// entire point: a report that shows only one of them cannot express the failure
// it exists to catch. `matches` is precomputed rather than left to the reader,
// because the failure mode is someone glancing at a healthy-looking page.
type debugDependency struct {
	Name              string  `json:"name"`
	ConfiguredAddress string  `json:"configured_address"`
	ResolvedAddress   string  `json:"resolved_address"`
	Matches           bool    `json:"matches"`
	Connected         bool    `json:"connected"`
	LatencyMS         float64 `json:"latency_ms"`
	Detail            *string `json:"detail"`
}

type debugReport struct {
	Environment  string            `json:"environment"`
	Version      string            `json:"version"`
	StartedAt    string            `json:"started_at"`
	Ready        bool              `json:"ready"`
	Dependencies []debugDependency `json:"dependencies"`
	BootProbes   []contractProbe   `json:"boot_probes"`
}

// DebugDependencies serves /debug/deps: the config-reality probe.
//
// It answers, for every dependency: what address were we configured with, what
// address are we actually connected to, do they agree, and is it live right now.
func (h *Handler) DebugDependencies(w http.ResponseWriter, r *http.Request) {
	rep := h.store.Check(r.Context())

	out := debugReport{
		Environment:  rep.Environment,
		Version:      h.cfg.ServiceVersion,
		StartedAt:    httpx.Timestamp(h.startedAt),
		Ready:        rep.Ready(),
		Dependencies: make([]debugDependency, 0, len(rep.Dependencies)),
		BootProbes:   make([]contractProbe, 0, len(h.bootProbes)),
	}
	for _, d := range rep.Dependencies {
		item := debugDependency{
			Name:              d.Name,
			ConfiguredAddress: d.ConfiguredAddress,
			ResolvedAddress:   d.ResolvedAddress,
			Matches:           sameEndpoint(d.ConfiguredAddress, d.ResolvedAddress),
			Connected:         d.Connected,
			LatencyMS:         float64(d.Latency.Microseconds()) / 1000,
		}
		if d.Detail != "" {
			detail := d.Detail
			item.Detail = &detail
		}
		out.Dependencies = append(out.Dependencies, item)
	}
	for _, p := range h.bootProbes {
		item := contractProbe{Name: p.Name, Passed: p.Passed}
		if p.Detail != "" {
			detail := p.Detail
			item.Detail = &detail
		}
		out.BootProbes = append(out.BootProbes, item)
	}
	httpx.Respond(w, r, http.StatusOK, out)
}

// ── PublicConfig (getPublicConfig GET /v1/config/public) ────────────────────

// publicMapCenter is the contract's PublicConfig.default_map_center nested object.
type publicMapCenter struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// publicConfig is the contract's PublicConfig schema.
//
// Fields match the contract exactly (additionalProperties:false):
// required: currency, served_provinces, quote_ttl_seconds,
//
//	restaurant_response_window_seconds, max_tip_cents,
//	support_enabled, default_map_center.
//
// optional: support_phone_e164, support_hours, terms_version.
type publicConfig struct {
	Currency                        string          `json:"currency"`
	ServedProvinces                 []string        `json:"served_provinces"`
	QuoteTTLSeconds                 int32           `json:"quote_ttl_seconds"`
	RestaurantResponseWindowSeconds int32           `json:"restaurant_response_window_seconds"`
	MaxTipCents                     int64           `json:"max_tip_cents"`
	SupportEnabled                  bool            `json:"support_enabled"`
	SupportPhoneE164                *string         `json:"support_phone_e164,omitempty"`
	SupportHours                    *string         `json:"support_hours,omitempty"`
	DefaultMapCenter                publicMapCenter `json:"default_map_center"`
	TermsVersion                    *string         `json:"terms_version,omitempty"`
}

// PublicConfig implements getPublicConfig (GET /v1/config/public).
//
// Returns the runtime constants clients must never hardcode. Invariant #1
// (the server prices every order) is re-stated here: max_tip_cents is
// returned but no fee parameter that would let a client compute a price is
// ever present.
//
// Values are authoritative constants documented in the contract:
//
//   - currency: CAD (V0 — present so V2 multi-currency is additive)
//   - served_provinces: ["ON"] (Ontario only at launch)
//   - quote_ttl_seconds: 600 (how long a quoted price is honoured)
//   - restaurant_response_window_seconds: 180 (R-04 reconciled value)
//   - max_tip_cents: 5000 ($50 CAD tip ceiling)
//   - support_enabled: false (not yet configured — no A2P registration)
//   - default_map_center: downtown Toronto (WGS84)
func (h *Handler) PublicConfig(w http.ResponseWriter, r *http.Request) {
	httpx.Respond(w, r, http.StatusOK, publicConfig{
		Currency:                        "CAD",
		ServedProvinces:                 []string{"ON"},
		QuoteTTLSeconds:                 600,
		RestaurantResponseWindowSeconds: 180,
		MaxTipCents:                     5000,
		SupportEnabled:                  false,
		DefaultMapCenter: publicMapCenter{
			Latitude:  43.6532,
			Longitude: -79.3832,
		},
	})
}

// ── OpenAPI document (getOpenApiDocument GET /v1/openapi.json) ───────────────

// OpenAPIDocument implements getOpenApiDocument (GET /v1/openapi.json).
//
// Serves the committed contracts/openapi.yaml re-encoded as JSON. If the
// document was not found at boot the handler returns 501 rather than crashing:
// the binary still starts and all other routes remain operational.
//
// The CI drift check (P-36) should compare this response against the committed
// contracts/openapi.yaml to prove the running server's contract matches the
// source of truth.
func (h *Handler) OpenAPIDocument(w http.ResponseWriter, r *http.Request) {
	if h.openAPIDocJSON == nil {
		httpx.Fail(w, r, http.StatusNotImplemented,
			httpx.CodeFeatureNotAvailableYet, "OpenAPI document not available — contracts/openapi.yaml not found at boot", nil)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if rid := httpx.RequestIDFrom(r.Context()); rid != "" {
		w.Header().Set("X-Request-ID", rid)
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(h.openAPIDocJSON)
	}
}
