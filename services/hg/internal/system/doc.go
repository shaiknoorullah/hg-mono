// Package system implements the contract's `system` tag: the probes and the
// config-reality report that every other module is diagnosed through.
//
// Operations (contracts/openapi.yaml, tag: system):
//
//   - getHealth            GET /health           PUBLIC — liveness; touches nothing.
//   - getReadiness         GET /health/ready      PUBLIC — real dependency probes.
//   - getDependencyStatus  GET /internal/deps     ADMIN  — resolved addresses + boot probes.
//   - getOpenApiDocument   GET /v1/openapi.json   PUBLIC — contracts/openapi.yaml as JSON.
//   - getPublicConfig      GET /v1/config/public  PUBLIC — runtime constants for clients.
//
// Two aliases exist beyond the contract and are labelled as such in the route
// table: /healthz and /readyz, because Kubernetes-shaped tooling and several
// container health checks look for those names, and /debug/deps, which returns a
// *richer* body than the contract's DependencyReport.
//
// Why /debug/deps is a separate route rather than a wider /internal/deps: the
// contract fixes DependencyReport with additionalProperties:false and only
// carries `resolved_address`. The whole point of this probe is to show the
// configured address *and* the connected one side by side — one number is not a
// comparison. Widening the contract shape would be a contract change, which is
// not this task's to make, so the contract operation returns exactly what the
// contract says and the debug alias carries the extra field. See the report.
//
// getOpenApiDocument serves the committed contracts/openapi.yaml re-encoded as
// JSON. The handler loads the file at boot by walking up from the working
// directory, so no embedded file or build-time code generation is required. If
// the file is absent at boot the route returns 501 and all other routes remain
// operational. A future P-36 CI drift gate should compare the 200 body against
// the committed YAML to prove the running server and the source of truth agree.
//
// getPublicConfig serves hardcoded runtime constants (currency, served provinces,
// quote TTL, restaurant response window, tip ceiling, support state, default map
// centre) that clients must never hardcode. No fee parameter that would let a
// client compute a price is ever present (invariant #1).
package system
