// Package system implements the contract's `system` tag: the probes and the
// config-reality report that every other module is diagnosed through.
//
// Operations (contracts/openapi.yaml, tag: system):
//
//   - getHealth            GET /health        PUBLIC  — liveness; touches nothing.
//   - getReadiness         GET /health/ready  PUBLIC  — real dependency probes.
//   - getDependencyStatus  GET /internal/deps ADMIN   — resolved addresses + boot probes.
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
// Not implemented here yet: getOpenApiDocument and getPublicConfig, the other
// two `system` operations. The first must be generated from the route registry
// rather than hand-written (P-36 / the contracts README drift gate), and the
// second needs pricing_config, served provinces and support settings that do not
// exist yet.
//
// TODO(siblings): getPublicConfig (PublicConfig schema: currency, served
// provinces, quote_ttl_seconds=600, restaurant_response_window_seconds=180,
// max_tip_cents, support contact, default map centre) once config lands.
// TODO: getOpenApiDocument, served from the generated document, with the CI
// drift check against contracts/openapi.yaml.
package system
