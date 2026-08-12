# Go & Polyglot Backend Readiness Evaluation

**Repo:** `/workspace/shaiknoorullah/ts-monorepo-template`
**Evaluated for:** greenfield **Go-microservices** food-delivery backend (customers/riders/restaurants/admin, realtime tracking, geo dispatch, payments, checkout saga)
**Date:** 2026-08-09
**Git state:** single squashed drop — `git log` shows one substantive change, the merge of `feat/platform-foundation-impl` (PR #2, `e5d203f`). There is **no incremental phase history**; the "Phase 3/4/5" language sprinkled through stubs is a *plan*, not delivered increments.

---

## TL;DR

This is a **TypeScript SaaS monorepo template** that has grown a **credible polyglot proof-of-concept** (one Go, one Rust, one Python "hello" service) plus an **excellent, genuinely-working cross-language contracts pipeline**. It is *not* a Go-microservices platform. The Go story is a single hand-written reference service with real, idiomatic code but several declared-but-unwired capabilities (gRPC, Redis, OTel spans, outbox). The data/eventing plane is **spec-rich and compose-rich but orchestration-stubbed**. There is **no Go generator/scaffolder**, **no shared Go libraries**, and **no saga/Temporal implementation** (only a decision-doc).

---

## 1. Go support in the Nx graph

### Wiring
- `@nx-go/nx-go` (^3.3.2) is registered in `nx.json` `plugins[]` alongside `@nxlv/python` and `@monodon/rust`. `useInferencePlugins: true`.
- `apps/go-hello/project.json` defines targets:
  - `build` → `@nx-go/nx-go:build` (`main: cmd/server/main.go`, `dependsOn: ["^build","contracts:generate"]`)
  - `test` → `@nx-go/nx-go:test` (`./...`)
  - `test:integration` → `@nx-go/nx-go:test` with `-tags=integration`
  - `lint` → `golangci-lint run ./...` (run-commands)
  - `container`, `chart:lint`, `chart:render` → run-commands (docker buildx / helm)
  - `implicitDependencies: ["contracts"]`
- Per-app `Taskfile.yml` mirrors these (`go run`, `go build`, `go test`).

### What a Go service actually looks like (`apps/go-hello`)
Real, idiomatic, small. Layout:
```
cmd/server/main.go            boot: config → otel → pgxpool → kafka.Writer → chi router → /metrics
internal/config/config.go     envconfig struct (HTTP/GRPC/METRICS ports, PG_DSN, REDIS_URL, KAFKA_BROKERS, OTEL_*)
internal/handlers/health.go   /healthz, /readyz (readyz pings PG)
internal/handlers/users.go    REST /v1/users (GET list, POST create, GET /{id}); interfaces UserStore + EventPublisher
internal/store/user.go        PGUserStore over jackc/pgx/v5 pgxpool (raw SQL)
internal/events/kafka.go      KafkaPublisher over segmentio/kafka-go (JSON-marshals User, writes to topic)
internal/telemetry/otel.go    InitTracer: OTLP/gRPC exporter + TracerProvider (tracing only)
internal/handlers/users_test.go       unit tests (httptest) for health
test/integration/user_pg_test.go      testcontainers-go postgres round-trip (build tag `integration`)
```
Stack: `go-chi/chi v5`, `jackc/pgx/v5`, `segmentio/kafka-go`, `rs/zerolog`, `prometheus/client_golang`, `go.opentelemetry.io/otel` + OTLP trace exporter, `kelseyhightower/envconfig`, `testcontainers-go`. **This code compiles and the tests are real.** It consumes the generated contracts Go module via a `replace` directive (see §2).

### Build / test / container
- **Build/test:** works locally via nx or `go` directly. **CI does NOT exercise Go build or test** — `ci.yml`'s build job only sets up pnpm (no Go toolchain) and runs `nx run-many -t build --exclude=py-hello` and `pnpm test:coverage` (vitest). Go/Rust/Py app targets are effectively untested in CI beyond hadolint and a soft-fail container build.
- **Container:** `apps/go-hello/Dockerfile` is real (distroless, multi-stage, buildx cache mounts, non-root). **But** `container-build.yml` builds with `context: .` (repo root) while the Dockerfile expects the *app dir* as context (`COPY go.mod go.sum ./`). The workflow marks this `continue-on-error: true` and documents it as a known unfixed bug — **no Go image is actually produced in CI.**
- **Version drift:** `go.mod` says `go 1.25.0`; `Dockerfile`/`build.yaml`/`META.yaml` pin Go **1.24**. README/AGENTS say 1.24.

### Is there a real Go microservice generator/template?
**No.**
- `internal/templates/` has a `go.Dockerfile.template` (+ python/rust/typescript equivalents and shared snippets `otel-init.snippet`, `healthcheck.snippet`) — but **no Go project skeleton** (no `cmd/`/`internal/` scaffold, no `go.mod` template). Only TS/web/mobile/marketing/docs archetypes have real template dirs.
- `internal/cli` scaffolder: `repo new app <archetype>` supports only `api|worker|web|mobile|marketing|docs` — **all TypeScript.** There is no `go`/`rust`/`py` archetype.
- `internal/cli/src/commands/new/backend.ts` (the "Scaffold a backend app (TS/Py/Go/Rust)" command) is a **stub** — it calls `emitNotImplemented(...)` returning `{"status":"not_yet_implemented", "plan_phase":"Phase 4 (Reference apps + generators)"}`.

**Implication:** every new Go service is a **copy-paste of `apps/go-hello`** by hand. There is no golden-path generator.

---

## 2. Cross-language contracts — the strongest part

`packages/contracts/` is a real **buf v2** setup and it works end-to-end.

- **Source of truth:** `src/proto/{user,health}/v1/*.proto`. `UserService` (GetUser/CreateUser/ListUsers) + `HealthCheck` gRPC services defined; `User` message with `google.protobuf.Timestamp`.
- **Codegen (`buf.gen.yaml`, managed mode):**
  - Go: `protocolbuffers/go` + `grpc/go` → `gen/go` (messages **and** gRPC stubs; `require_unimplemented_servers=false`)
  - TS: `bufbuild/es` (protobuf-es v2) → `gen/ts` (messages only; note "no runtime gRPC; HTTP/connect-style wired in app code")
  - Python: `protocolbuffers/python` + `grpc/python` → `gen/py`
  - Rust: `neoeinstein-prost` + `neoeinstein-tonic` → `gen/rs/src` (messages + tonic gRPC)
- **Generated output is committed** for all four languages under `gen/`. Verified present: `gen/go/{user,health}/v1/*.pb.go` + `*_grpc.pb.go`, `gen/py/**_pb2*.py`, `gen/rs/src/*.rs` (+ `.tonic.rs`), `gen/ts/**_pb.ts`.
- **Distribution per language:**
  - Go: `gen/go` is its own module `github.com/ts-monorepo-template/contracts/gen/go`; `apps/go-hello/go.mod` consumes it via `replace ... => ../../packages/contracts/gen/go`. Idiomatic and works.
  - Python: `packages/contracts-py` wheel; `scripts/sync-gen.sh` copies `gen/py` into the wheel `src/`.
  - Rust: `packages/contracts-rs` crate `include!`s `gen/rs/src`.
  - TS: `@ts-monorepo-template/contracts` exports the `gen/ts` files.
- **CI (`.github/workflows/contracts-codegen.yml`):** `buf lint` → conditional `buf breaking` (against `main`, skipped on bootstrap) → `buf generate` + python sync → **`git diff --exit-code` drift gate**. This is a proper, working contract-drift guard. Each contracts test (`tests/*.test.sh`) checks buf config/lint/gen shape.

**gRPC reality check:** gRPC *stubs* are generated in all languages, but **no service actually serves gRPC.** `go-hello` declares `grpc-api` capability and a `GRPCPort=9000`, imports `userv1`, but `main.go` starts only an HTTP (chi) server + a Prometheus `/metrics` server — **no `grpc.NewServer`, no `RegisterUserServiceServer` anywhere in the repo.** The proto `UserService` is used only as a **struct/JSON DTO** in the REST handlers. So contracts are excellent for *typed shared models*; gRPC transport is scaffolded but not wired.

**Implication for a food-delivery backend:** the contracts pipeline is production-usable today and is the best reason to adopt this base. You would extend it with `order.proto`, `rider.proto`, `dispatch.proto`, `payment.proto`, etc. But you must **build the gRPC server/interceptor layer yourself** (register services, health, reflection, otel/logging interceptors) — none exists.

---

## 3. Data & eventing plane

### Datastores/brokers provided (compose)
`docker/` contains a **rich, real** set of compose files:
- `compose.dev.yml` — single-node dev stack: **postgres 16, redis 7.4, kafka (KRaft, single node), apicurio schema-registry, otel-collector**, plus a TS `api` service. Real, detailed KRaft config.
- Production/HA variants: `postgres-ha.compose.yml` (primary+replica+pgBouncer), `redis-cluster.compose.yml` (6-node), `kafka.compose.yml`, `debezium.compose.yml`, `kroxylicious.compose.yml`, `apicurio.compose.yml`, `observability-deps.compose.yml`, plus SaaS commons (keycloak, chatwoot, lago, unleash, umami, meilisearch, uptime-kuma).

### Orchestration is STUBBED
- `scripts/dev/data-up.sh` → `echo "data-up: shape=... — docker-compose wiring lands Phase 5"` (does nothing).
- `scripts/dev/data-down.sh` → `echo "data-down: stub — Phase 5"`.
- `Taskfile.yml` `data:up`/`data:up:full`/`data:up:kafka`/`data:down` all delegate to those stubs.
- **`compose.dev.yml` references `./observability/otel-collector-dev.yml` which does not exist** (`docker/observability/` is absent) — so `compose.dev.yml up` fails on the otel-collector service as-is.

You can bring the plane up manually (`docker compose -f docker/postgres-ha.compose.yml ... up`, per the data-eventing README), but the `task`/script convenience layer is non-functional and the dev compose has a missing-file bug.

### Event journal / outbox pattern
- **Specs are extensive and high-quality but `status: draft`, "implementation gated on consolidation review":**
  - `docs/specs/data-eventing/`: outbox+Debezium (full SQL schema + connector JSON + WAL-slot heartbeat guidance), CloudEvents 1.0 + Apicurio, Kafka KRaft scale path, Redis cluster, Postgres HA, kysely db package, topic runbooks.
  - `docs/specs/event-journal/`: two competing designs — R2 (explicit decorator, ~5k LoC) and R3 (OTel-native + PG `pg_logical_emit_message` outbox, ~470 LoC). Decision doc, not code.
- **No implementation:** the `@pkg/outbox` package described in the spec **does not exist** (`packages/outbox` absent). Debezium connector config is documented, not deployed. There is **no outbox table, no outbox helper in any language.**
- **`go-hello` uses a raw dual-write** (handler does `store.Create()` then `pub.PublishUserCreated()` sequentially) — exactly the anti-pattern the outbox spec warns against. For a checkout saga / payments, this is the wrong correctness model and would need replacing.

### How a Go service gets pg/redis/kafka clients
- **Postgres:** `jackc/pgx/v5` pgxpool directly in `internal/store` (raw SQL, no migrations tooling wired for Go — Atlas is mentioned in specs for the TS kysely package only).
- **Kafka:** `segmentio/kafka-go` `Writer` directly.
- **Redis:** **not wired at all in Go.** `REDIS_URL` is `required:"true"` in `config.go` (so a Go service won't boot without it) yet **no Redis client dependency in `go.mod` and no usage** — dead required-config.
- There are **no shared Go client libraries.** By contrast the repo's `@pkg/*` libraries (`db-client`/kysely, `logger`, `tracking`, `auth-client`, etc.) are **all TypeScript-only.** Rust's `Cargo.toml` workspace does declare `sqlx`, `redis`, `rdkafka` (rdkafka commented out in `rs-hello` due to build-dep friction). Go has the narrowest client story of the three backend languages.

---

## 4. Runtime / observability

- **Collector:** OTLP collector present in compose (referenced config file missing, see §3). OTLP gRPC on 4317.
- **Per-language telemetry modules exist but differ in completeness:**
  - **Go (`internal/telemetry/otel.go`):** inits a `TracerProvider` with OTLP/gRPC exporter + resource attrs (service.name, deployment.environment). **Tracing only.** **No metrics via OTel** (metrics are Prometheus `promhttp` on :9090). **Critically, no HTTP instrumentation is wired** — `otelhttp` is only an *indirect* dependency and is not used; the chi router has no otel middleware, so **per-request spans are never created.** No trace/context propagation. So OTel is initialized but effectively emits nothing from request handling.
  - **Rust:** `tracing` + `tracing-opentelemetry` + `opentelemetry-otlp` + `tower-http` trace layer — the most complete.
  - **Python:** `structlog` JSON + OTel `TracerProvider` + OTLP exporter.
- **Logger:** `@pkg/logger` is **TypeScript-only**. Go uses `rs/zerolog` inline; Rust uses `tracing`; Python uses `structlog`. No cross-language logging contract.
- **Dockerfile snippet** `otel-init.snippet` sets standard `OTEL_*` env, and `META.yaml` declares `otel-tracing`+`prometheus-metrics` capabilities and a `/metrics` scrape — the *declarations* are consistent even where the *wiring* is thin.

**Implication:** for a Go backend you'll need to add otel HTTP/gRPC interceptors, context propagation, and OTel metrics yourself; the current Go telemetry is a resource+exporter bootstrap only.

---

## 5. Honest real-vs-stub assessment

### Genuinely real & working
- **Cross-language contracts pipeline** (buf v2, 4-language codegen, committed output, lint + breaking + drift CI). *Best asset.*
- **`go-hello` service code**: compiles, idiomatic, real unit + testcontainers integration tests. Same for `py-hello`, `rs-hello` (endpoint-parity reference trio).
- **Dockerfile templates** (go/py/rust/ts) — real, distroless, non-root, cache-mounted.
- **Compose files** in `docker/` — real and detailed (dev + HA + registry + CDC + proxy + observability).
- **Specs** — genuinely thoughtful engineering docs (outbox, CloudEvents, Temporal decision rule, event-journal R2/R3, Postgres HA, Redis cluster).
- **Nx polyglot graph** — `@nx-go/nx-go`, `@nxlv/python`, `@monodon/rust` registered; per-app targets defined.

### Scaffolded but not wired (declared ≠ working)
- **gRPC serving** — stubs generated in all langs; no server started anywhere. `grpc-api` capability + `GRPCPort` declared, unused.
- **Redis in Go** — `REDIS_URL` required but no client/usage.
- **Go OTel spans/metrics** — tracer inited, no instrumentation middleware, no OTel metrics.
- **Container build in CI** — soft-failed (`continue-on-error`) due to known context bug; produces no image.
- **Go build/test in CI** — not run (no Go toolchain in CI jobs).

### Stub / aspirational (explicitly "Phase N", `not_yet_implemented`, or echo-only)
- **Backend scaffolder** `new:backend` (Go/Rust/Py) → `emitNotImplemented` ("Phase 4"). No Go archetype in `repo new app`.
- **Data plane scripts** `data-up.sh`/`data-down.sh` → echo "Phase 5". Taskfile `data:*` and `ready` are stubs.
- **Broad CLI surface** → `emitNotImplemented`: `env check/reconcile`, `secrets bootstrap/where`, `launch`, `init`, all `nx-cloud/*`, `new/lib`, `new/frontend`.
- **Outbox / event-journal / Debezium** — spec only; `@pkg/outbox` package absent; no outbox table.
- **Saga / Temporal for checkout** — **only** `docs/specs/governance-saas/temporal-when-and-when-not.md` (a decision doc). No Temporal worker, no workflow code, no saga engine anywhere.
- **Geo dispatch / realtime tracking / payments** — nothing; these are net-new.
- ~99 files contain `TODO`/`stub`/`Phase 4/5`/`not_yet_implemented`/`aspirational` markers (excluding node_modules).

### Single-squashed-commit caveat
Everything arrived in one PR merge. The "Phase 3 shipped…", "Phase 4/5 lands…" comments throughout are **forward-looking narrative baked into a single drop**, not evidence of delivered, iterated phases. Treat every "will land in Phase N" as **not present**.

---

## Top implications for a from-scratch Go backend on this base

1. **Adopt it for contracts + Nx graph + compose + specs; do not expect a Go platform.** The buf pipeline is the compelling reason to build here. Everything Go-service-shaped beyond one reference app is DIY.
2. **You will hand-roll the Go golden path.** No generator exists. Budget for: a real Go service template (cmd/internal layout, go.mod with contracts replace, config, health, graceful shutdown), and ideally your own scaffolder — `new:backend` is a stub.
3. **Build the gRPC serving layer yourself.** Stubs exist; server bootstrap, health/reflection, and otel/logging/auth interceptors do not. For inter-service calls (dispatch↔orders↔riders) this is foundational and currently absent.
4. **Replace the dual-write with a real outbox before payments/checkout.** The spec (Debezium + PG outbox, or R3 OTel-native) is good; implement it. `go-hello`'s publish-after-commit is unsafe for money/saga flows.
5. **Expect to write shared Go libraries from scratch.** db/redis/kafka clients, logger, and telemetry are TS-first (or Rust-declared). Go has pgx+kafka-go inline, **no Redis**, and telemetry that emits no spans. Standardize a `pkg/` (Go) set: otelhttp/otelgrpc middleware, OTel metrics, structured logging, redis client, outbox helper.
6. **Fix the boot-blocking + CI gaps early.** `REDIS_URL` required-but-unused (blocks boot), go.mod 1.25 vs Docker 1.24 drift, missing `docker/observability/otel-collector-dev.yml`, non-functional `task data:up`, and Go not built/tested in CI or containerized in CI (context bug). None are hard, but all are load-bearing for a real backend.
7. **Saga/Temporal and the domain (geo dispatch, realtime tracking, payments) are 100% greenfield.** Only a Temporal *decision doc* exists. Plan the durable-execution/saga substrate as net-new work.

**Bottom line:** Usable today for a Go backend = the **contracts codegen pipeline**, the **Nx/Task polyglot harness**, the **compose infra definitions**, the **Dockerfile templates**, and **one copyable reference service**. Missing/greenfield = **Go generator, gRPC serving, shared Go libs (esp. Redis + real OTel), outbox/eventing implementation, saga/Temporal, and the entire food-delivery domain.** This is a strong *scaffold and reference*, not a *platform* — good bones, ~70% of the backhaul still to build.
