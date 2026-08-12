package system

import (
	"net/http"
	"time"

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
}

// NewHandler builds the system handler.
func NewHandler(cfg *config.Config, st *store.Store, startedAt time.Time, probes []store.Probe) *Handler {
	return &Handler{cfg: cfg, store: st, startedAt: startedAt, bootProbes: probes}
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
