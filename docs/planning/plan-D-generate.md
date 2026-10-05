# Plan D — Single Source of Truth, Generate Everything

> **Thesis in one line:** agents hallucinate what they *type*; they cannot hallucinate what is *generated*. So make the hand-written surface of `hg-mono` small enough that a human can read all of it, and generate the other ~85%.

**How this differs from Plan A.** Plan A uses contracts as a **gate**: humans/agents write Go, and a drift check punishes them when the code disagrees with the `.proto`. Plan D uses generation as the **primary production mechanism**: nobody writes a Go service, a SQL migration, a client SDK, a compose file, or a test harness. Those artifacts have no author. The drift gate still exists but it is nearly vacuous, because there is almost nothing that *can* drift — regeneration is the build step, not a verification step. Plan A's unit of work is "a PR implementing a behavior." Plan D's unit of work is "a **hole**": a named function body whose signature, contract, and failing tests were all generated before any agent saw it.

**What we inherit.** The existing `packages/contracts` buf v2 pipeline is the one part of the base repo the audit calls "genuinely real & working" (buf lint → buf breaking → buf generate → `git diff --exit-code` drift gate, 4-language output, committed `gen/`). Plan D is that pipeline taken to its logical extreme and pointed at everything, not just DTOs.

**What we are preventing.** `crosscut-api-contract.md` documents the failure this design targets: frontends calling ~20 `/auth/*` endpoints that exist in no backend; `POST /payments/:id/refund` vs admin-web's `/admin/payments/:id/refund`; a rider app hardcoding `https://api.halalgoes.com` past its own base URL; `PricingSnapshot` echoed by the client and trusted by the server; every route unauthenticated while clients dutifully attach Bearer tokens. Every one of those is a *typed-by-hand* mistake. None of them is expressible in a system where the client is generated from the same file as the server.

---

## 0. The model (what "single source of truth" concretely means)

The SoT is a directory, `model/`, that is the **only** hand-authored declarative material in the repo. It has six parts, all machine-readable, all under human review.

```
hg-mono/
  model/                             # hand-written, human-reviewed, ~3–5k lines total
    proto/hg/options/v1/hg.proto     # our custom option extensions (the metamodel)
    proto/hg/order/v1/order.proto    # domain types + services + protovalidate rules
    proto/hg/rider/v1/…  restaurant/v1/…  payment/v1/…  identity/v1/…
    fsm/order.fsm.yaml               # state machines as data
    fsm/rider_onboarding.fsm.yaml
    saga/checkout.saga.yaml          # saga = FSM + compensations + timers
    policy/authz.yaml                # who may call what, and on whose rows
    topology/hg-mono.topology.yaml   # services, ports, deps, routes, scaling
    design/tokens.dtcg.json          # W3C DTCG design tokens (Figma-exported)
    design/screens/*.screen.yaml     # screen ↔ RPC ↔ state-matrix binding
    migration/legacy-map.yaml        # legacy NestJS route + Prisma column mapping
  tools/gen/                         # the generators — Go, protogen-based, ~6–8k lines
  gen/                               # 100% generated. Never hand-edited. Committed.
  services/<svc>/internal/logic/     # THE HOLES — the only hand-written Go
  apps/<surface>/src/screens/*.view.tsx  # THE HOLES — the only hand-written UI
```

### 0.1 The metamodel: protobuf custom options carry more than wire shape

`buf` + protobuf is the substrate because it is the one pipeline already proven in this codebase, it is polyglot (Go server + TS/React Native clients + Python tooling), and `protovalidate` compiles CEL rules **into the message descriptors** with no extra plugin, so the same constraint is enforced in Go, in TS, and in generated tests from one declaration.

We extend the descriptor with our own options (`hg.options.v1`) so one `.proto` file drives persistence, authz, lifecycle, and money-safety:

```proto
message Order {
  option (hg.table)      = { name: "orders", pk: "id", soft_delete: true };
  option (hg.lifecycle)  = { fsm: "order.fsm.yaml", state_field: "status" };
  option (hg.audit)      = { on: [CREATE, STATE_CHANGE], actor_field: "actor_id" };

  string id            = 1 [(hg.column) = { type: "uuid", default: "gen_random_uuid()" }];
  string user_id       = 2 [(hg.column) = { type: "uuid", index: true, fk: "users.id" }];
  OrderStatus status   = 3 [(hg.column) = { type: "text" }];
  Money   total        = 4 [(hg.server_authoritative) = true];   // ← client value is REJECTED
  Geo     dropoff      = 5 [(hg.column) = { type: "geography(Point,4326)", gist: true }];
  string  cancel_reason= 6 [(buf.validate.field).string.max_len = 280];
}

service OrderService {
  rpc Checkout(CheckoutRequest) returns (CheckoutResponse) {
    option (hg.authz)   = { subject: "user", must_own: "cart.user_id" };
    option (hg.saga)    = "checkout.saga.yaml";
    option (hg.idempotent) = { key_field: "idempotency_key" };
  }
}
```

Three things to notice, because they are the whole argument:

1. **`(hg.server_authoritative) = true` on `Order.total`.** The single worst HalalGoes bug — the client sends the pricing snapshot and the server does not recompute — becomes a *model annotation*. The generator emits, in every service that accepts this message, a decode-time guard that zeroes and rejects client-supplied values, and emits a test that asserts a tampered request is rejected. The bug class is fixed in one place for all present and future messages. **Every production bug we have evidence of gets converted into a model constraint, not a regression test.** (Plan A encodes bugs as regression tests — one test per bug. Plan D encodes them as generator rules — one rule per bug *class*.)
2. **`(hg.authz)` on the RPC.** "Every REST route is unauthenticated" is not reachable: the generated interceptor table is exhaustive over the service descriptor. An RPC with no `hg.authz` option **fails generation** — there is no default-open.
3. **`(hg.column)` / `(hg.table)`.** The DB schema is a *projection* of the domain model, not a parallel artifact that can disagree with it.

### 0.2 State machines and sagas as data

`model/fsm/order.fsm.yaml` — derived directly from the real transition table already in `hg-api`'s `orderTrackingWorkflow`:

```yaml
name: OrderLifecycle
state_enum: hg.order.v1.OrderStatus
initial: PENDING_PAYMENT
actors: [user, restaurant, rider, system, admin]
states:
  CONFIRMED:
    on_enter: [notify_restaurant]
    timeout: { after: 90s, to: AUTO_CANCELLED, reason: restaurant_no_response }
transitions:
  - { from: PENDING_PAYMENT, to: CONFIRMED,       by: system,     event: PaymentCaptured }
  - { from: CONFIRMED,       to: PREPARING,       by: restaurant, event: Accepted }
  - { from: CONFIRMED,       to: REJECTED,        by: restaurant, event: Rejected, requires: [reason] }
  - { from: PREPARING,       to: AWAITING_PICKUP, by: restaurant, event: Ready }
  - { from: AWAITING_PICKUP, to: PICKED_UP,       by: rider,      event: PickedUp, guard: rider_assigned }
  - { from: PICKED_UP,       to: ON_THE_WAY,      by: rider,      event: Departed }
  - { from: ON_THE_WAY,      to: DELIVERED,       by: rider,      event: Delivered, terminal: true }
terminal: [DELIVERED, CANCELLED, REJECTED, AUTO_CANCELLED, DISPUTED]
```

`model/saga/checkout.saga.yaml` — steps, compensations, timers, and which signals it waits for:

```yaml
name: Checkout
timeout: 15m
steps:
  - { id: reserve_cart,   call: CartService.Reserve,       compensate: CartService.Release }
  - { id: price,          call: PricingService.Quote,      server_authoritative: true }
  - { id: capture,        call: PaymentService.Capture,    compensate: PaymentService.Refund, retry: {max: 3, backoff: exp} }
  - { id: create_order,   call: OrderService.Create,       compensate: OrderService.VoidDraft }
  - { id: await_restaurant, await_signal: RestaurantDecision, timeout: 90s, on_timeout: compensate_from: capture }
  - { id: dispatch,       call: DispatchService.Assign,    async: true }
```

This single file generates: the Go saga struct + step enum, the Postgres state table + migration, the River job types for timers and retries, the compensation call sites (as **holes**), a Mermaid diagram for docs, and a **model-based failure test** that injects a failure at every step and asserts the compensation chain runs in reverse order with no orphaned payment.

### 0.3 Topology, design tokens, legacy map

- `topology/hg-mono.topology.yaml` — each service's image, ports, health path, dependencies, replica count, Traefik route rules, and a `migration:` field per route (`legacy | shadow | new`). Generates `docker-compose.yml` + Traefik labels + `.env.example` + the CI e2e matrix.
- `design/tokens.dtcg.json` — W3C DTCG format (stable since 2025.10), exported from Figma Variables. Style Dictionary transforms it into a NativeWind preset, CSS custom properties, a TS token module, and native constants — one token set, four surfaces.
- `migration/legacy-map.yaml` — old NestJS route → new RPC, and old Prisma column → new column, with a transform expression. Generates the anti-corruption adapter, the backfill job, and the reconciliation differ.

---

## 1. Planning system — Model Change Requests, and generated documentation

**Rule: nothing exists unless it is in the model.** There is no design doc that describes a service; the service catalog, endpoint list, event catalog, ER diagram, and state diagrams are all *generated* from `model/` into `docs/generated/`. A doc can therefore never be stale, and "the docs describe a different, simpler template than what is on disk" (the audit's verdict on the base repo) is structurally impossible.

**Decisions are recorded as MCRs — Model Change Requests.** An MCR is a PR that touches only `model/`, and its body is a template:

```
WHY:        one paragraph, plain English
ALTERNATIVES REJECTED: 2–4 bullets
BLAST RADIUS: (auto-filled by CI bot — see §4)
REVERSIBILITY: cheap | costly-because-X
```

The rationale is *also* stored in the model, as a `hg.decision` annotation on the changed element, so `docs/generated/decisions.md` is a real ADR log assembled by the generator with links to the exact fields the decision governs. Decisions do not rot in a separate `docs/adr/` directory with dead links.

**Three planning horizons, but the artifact is always model:**
- **Frozen core** — the metamodel (`hg/options/v1`) and the FSM/saga schema. Changed rarely, reviewed hard.
- **Current milestone** — domain protos + FSMs for the slice being built, fully specified.
- **Next milestone** — a stub proto with `// DRAFT` service definitions and no `hg.authz` options, so it *cannot* generate. Drafts are visible and un-shippable at the same time.

**Change process:** amendments are cheap and expected. Because everything downstream is regenerated, "we got the model wrong" costs one MCR plus re-filling whatever holes changed signature — not a hand-refactor across 9 services. This is the main answer to Plan A's self-admitted mini-waterfall risk: Plan D can afford to be wrong about the model because the cost of changing the model is bounded by the generator, not by the codebase size.

---

## 2. Execution loop — the Hole Manifest as a generated work queue

The loop has four tiers with wildly different volumes and review costs.

| Tier | Volume | Author | Human review |
|---|---|---|---|
| **Model** | ~1–3 PRs/day | agent drafts, human approves | **High** — this is where the humans spend their bandwidth |
| **Generator** | ~1–2 PRs/week | senior agent + human | **Highest** — two-key rule for authz/money |
| **Regeneration** | every model PR | machine | **None** — auto-merged, diff suppressed |
| **Hole** | 20–60 PRs/day | agents, fully parallel | **Low** — one function, plain-English summary |

### 2.1 The Hole Manifest

`protoc-gen-hg-holes` emits `gen/holes.json` after every regeneration. Each entry is a complete, self-contained work order that **no human or lead agent wrote**:

```json
{
  "id": "dispatch.AssignRider.selectBestRider",
  "file": "services/dispatch/internal/logic/assign.go",
  "signature": "func (l *Logic) selectBestRider(ctx context.Context, o *orderv1.Order, cands []*riderv1.Rider) (*riderv1.Rider, error)",
  "contract": {
    "preconditions":  ["len(cands) > 0", "o.Status == AWAITING_PICKUP"],
    "postconditions": ["result ∈ cands", "result.IsAcceptingOrders"],
    "errors": ["NO_ELIGIBLE_RIDER"]
  },
  "tests_generated": ["services/dispatch/internal/logic/assign_gen_test.go:TestSelectBestRider_*"],
  "fence": ["services/dispatch/internal/logic/assign.go"],
  "depends_on": ["dispatch.QueryCandidates"],
  "status": "empty"
}
```

An agent claims a hole (atomic claim in a small SQLite/Postgres work table), opens a worktree, and may edit **only the files in `fence`**. A pre-commit hook and a CI job both enforce the fence. The agent's entire context is: the hole entry, the generated interfaces it may call, and the generated failing tests. It does not need to know the rest of the system, which is precisely why 40 agents can run at once without stepping on each other.

### 2.2 Why this is the strongest anti-hallucination property in the plan

In Plan A (and in normal agentic TDD), the implementer agent writes the red test and then makes it green. If the agent misunderstands the requirement, it writes a test that encodes the misunderstanding, and the test passes. The green light is self-referential.

In Plan D, **the tests are generated from the model before the agent exists.** The agent cannot author, edit, or delete `*_gen_test.go` — the fence forbids it, CI re-generates them and diffs. The only way to go green is to satisfy a specification the agent had no hand in writing. That is a genuinely different epistemic situation, and it is the reason the human review of hole PRs can be shallow.

### 2.3 Async, no blocking

Holes are independent by construction (they sit behind generated interfaces), so there is no PR stacking and no ordering dependency except the explicit `depends_on`. A blocked or failed hole is re-queued to a different agent with the previous attempt's diff attached as a negative example. Holes untouched for 24h get escalated to the "hard holes" queue that a stronger model handles.

---

## 3. Verification & anti-hallucination

Seven mechanisms, in rough order of power:

1. **Generated types.** An agent cannot reference `order.cancelReason` if the field is `cancel_reason`, cannot invent `/auth/refresh`, and cannot call an RPC that doesn't exist — the client is generated from the same descriptor as the server. The entire class of contract-mismatch bugs in `crosscut-api-contract.md` is unreachable.
2. **Generated tests the agent cannot touch** (§2.2). From the FSM: an exhaustive transition matrix, including a **negative test for every one of the ~N²−T illegal transitions**, and an actor test asserting a rider cannot drive a restaurant-only transition. From protovalidate CEL rules: boundary and fuzz corpora. From the saga: failure-injection at every step asserting compensation ordering. From `hg.authz`: a table test hitting every RPC with every subject class asserting deny-by-default.
3. **Determinism gate.** CI regenerates the whole repo from a pinned toolchain (buf plugins pinned by digest, generator binaries built from the same commit, hermetic container) **twice**, and requires `git diff --exit-code` both times. Two runs, not one, because the classic MDD failure is map-iteration nondeterminism producing a generator that drifts against itself.
4. **Model coverage.** A generated report asserting every state, every transition, every error code, every authz rule, and every saga compensation is exercised by at least one *passing* test. Unlike line coverage, this measures coverage of the **specification**, so it cannot be gamed by tests that assert nothing. Merge blocks below 100% on model coverage (it is achievable — the tests are generated).
5. **Fence enforcement.** `gen/**` is protected: any commit touching it that isn't produced by the regeneration bot fails CI. Hand-written Go outside `services/*/internal/logic/**` fails CI. This is the mechanical guarantee behind "the hand-written surface is small."
6. **Hand-written surface budget.** CI tracks `handwritten_go_loc / total_go_loc` and fails if it exceeds a declining budget (start 25%, target ≤10% by M3). Every escape hatch (§10) carries an owner and expiry and shows up on this dashboard. When one shape of hole is repeatedly escape-hatched, that's the signal to extend the generator — tracked as an explicit **generator-debt backlog**.
7. **Adversarial verification, but concentrated.** Plan A runs an adversarial verifier per PR, and admits it scales linearly with PR count. Plan D runs adversarial review only on **model PRs and generator PRs** — ~5% of the volume — because the other 95% is already pinned by generated tests. Same total assurance, ~20× less verifier spend.

**Known blind spot this does *not* cover, stated plainly:** the generator itself is unverified by all of the above. §10 and §4 address it.

---

## 4. Human review model — reviewing meaning, not bytes

Generated diffs are enormous: one field added to `Order` can touch 400 files. Solving this is a hard requirement of the plan, and it is solved by **never showing generated code to a human**.

**Mechanics:**
- `gen/**` and `docs/generated/**` carry `linguist-generated=true -diff` in `.gitattributes`, so GitHub collapses them by default and they are excluded from CODEOWNERS review.
- Regeneration is a **separate auto-merged commit** produced by the bot immediately after a model PR merges. Humans never see it in a review queue at all.
- Every model PR gets a bot comment: the **Model Change Report**.

**The Model Change Report** is a plain-English semantic diff produced by our own model-differ (buf breaking for wire compat, plus an FSM/policy/topology differ). Example:

```
MODEL CHANGE REPORT — MCR #214 "Restaurant may cancel after accepting"

WHAT CHANGED (plain English)
  • OrderStatus gains one state: CANCELLED_BY_RESTAURANT (terminal).
  • 2 new transitions: PREPARING → CANCELLED_BY_RESTAURANT (actor: restaurant, requires reason)
                      CANCELLED_BY_RESTAURANT → REFUNDED (actor: system)
  • Order gains column cancel_reason (text, nullable, ≤280 chars).
  • Checkout saga gains compensation: refund on late restaurant cancel.

WIRE COMPATIBILITY  ✅ backward-compatible (additive enum value + optional field)

BLAST RADIUS
  services regenerated: order, payment, notification (3 of 9)
  new migration:        0042_add_cancel_reason.sql  (additive, online-safe, no lock)
  clients regenerated:  customer, restaurant, admin (rider unaffected)
  NEW HOLES: 2   → payment.Logic.RefundOnLateCancel
                 → notification.Logic.RenderRestaurantCancelPush
  generated tests added: 14 (incl. 9 negative-transition tests)

RISK FLAGS
  ⚠️ touches money path (compensation added) → two-key review required
  ✅ no authz rule changed
  ✅ no breaking client change
```

**What the human actually reads:** a ~20-line YAML/proto diff plus this report. Ten minutes, no system-wide context required, and — unlike Plan A's "small PR" — the reviewer is looking at the *decision* rather than at one of forty consequences of the decision. This is the inversion that makes the whole plan work: **~90% of human review effort is spent on ~5% of the repository**, and that 5% is the part where being wrong is expensive.

**Hole PRs** get a three-line template: what the function does, which generated tests now pass, and anything surprising. Humans skim; the tests are the real reviewer.

**Two-key rule:** generator PRs and model PRs flagged `touches money | touches authz | touches PII` require two human approvals. Everything else, one.

---

## 5. Orchestration — generated sagas on Postgres + River (no Temporal)

The existing system uses Temporal with 9 workers in one Nest process, workflow IDs as business IDs, signals racing REST controllers, and a documented "checkouts worker not registered" incident. That coupling — business logic living inside workflow code that only Temporal can run — is exactly what we're eliminating.

**Choice: generate the saga engine; run it on Postgres with [River](https://riverqueue.com) for timers, retries, and async steps.**

- **Why not Temporal:** heavy cluster, its own deployment surface, and — decisively for Plan D — its workflow code is *hand-written* and is therefore the largest un-generatable blob in the system. It also makes local `docker-compose` e2e testing much heavier.
- **Why not DBOS-Go** (shipped a Go SDK in April 2026, Postgres-backed, library-not-cluster — genuinely attractive): its programming model is decorated *hand-written* Go functions. Same objection. We keep it as the named fallback if our generated engine hits a wall, because it needs no new infra either.
- **Why not Restate:** another server to run; better than Temporal operationally but still a hand-written-handler model.

**What gets generated from `checkout.saga.yaml`:**
- `saga_instances` and `saga_steps` tables + Atlas migration (state, step cursor, attempt counts, compensation cursor, idempotency keys).
- A Go executor: deterministic step loop, at-least-once semantics with generated idempotency keys, compensation in reverse order, and typed signal handlers (`RestaurantDecision`, `RiderDecision`) that write to the same transaction as the state advance — no Redis mapping keys, no lost signals.
- River job definitions for every `timeout:`, `retry:`, and `async: true` step. River is Go-native and Postgres-backed, so it adds **zero new infrastructure** to compose.
- A **transactional outbox** row written in the same tx as every state change, drained to WebSocket fan-out and to the event log. The current system's `store.Create()` then `publish()` dual-write is not expressible.
- Compensation bodies as **holes** (`payment.Logic.RefundOnLateCancel`) with generated contract and failure tests.
- A Mermaid sequence diagram in `docs/generated/`.

The FSM generator separately emits, for `order.fsm.yaml`, an `Advance(ctx, orderID, event, actor)` function that is the *only* way to change order status. There is no `PUT /orders/:id/status` raw-DB path, because no hand-written code can reach the column: `gen/db` exposes no setter for `status`.

---

## 6. Deployment — compose + Traefik generated from the topology model

`topology/hg-mono.topology.yaml`:

```yaml
services:
  order:
    replicas: 2
    ports: { http: 8080, grpc: 9090, metrics: 9091 }
    deps: [postgres, redis, river]
    health: /healthz
    routes:
      - { host: api.hg.local, path: /hg.order.v1.OrderService/*, migration: new }
      - { host: api.hg.local, path: /orders/*,                   migration: shadow, legacy: hg-api-legacy }
```

Generates:
- `docker-compose.yml` (+ `.dev.yml`, `.ci.yml` overlays) with correct `depends_on: condition: service_healthy`, resource limits, and every env var the service's generated config struct requires — **the "`REDIS_URL` required but unused, service won't boot" class of bug is gone**, because the config struct and the compose env block come from one source.
- Traefik labels: routers, path/host rules, TLS, and `loadbalancer` with `replicas: 2` producing two container instances behind one service — round-robin LB proven, not assumed. Sticky sessions declared per-route for the WebSocket gateway.
- `.env.example`, the Prometheus scrape config, and the OTel collector config (the base repo's compose references a collector config file that doesn't exist — generated configs cannot be missing).
- The **CI e2e matrix**: `docker compose up`, wait on health, run generated smoke tests through Traefik (not against containers directly, so routing/LB is what's tested), plus a generated load-balance assertion that N requests hit ≥2 distinct instance IDs.

Every service Dockerfile is generated from a single template (distroless, multi-stage, non-root) with the app dir as build context — the base repo's soft-failed `continue-on-error` container build is not reproducible here because there is exactly one Dockerfile shape.

**e2e runs on every model PR** (against the regenerated stack) and nightly. "It deploys" is a generated, continuously-proven property.

---

## 7. UI/UX overhaul — generate the skeleton, hand-write the surface

**Honest framing first:** you cannot generate good visual design, and attempts to do so are where MDD-for-UI historically dies. What you *can* generate is everything around it — and in this codebase, that "everything around it" is where the rot was (four regional configs, mock screens, dead hooks, two parallel `toggleAvailability` implementations, a hardcoded LAN IP in a WebSocket hook).

**Design source of truth:** Figma Variables → exported W3C DTCG JSON (`design/tokens.dtcg.json`, stable spec since 2025.10) → Style Dictionary 4 in CI → NativeWind preset + CSS custom properties + TS token module + native constants. One token set, four surfaces, regenerated on every design change. Hex codes in component code fail lint.

**Screen model:** each screen declares its data and its states, not its layout.

```yaml
# design/screens/order_tracking.screen.yaml
surface: customer
route: /orders/[orderId]
data:
  - { rpc: OrderService.GetOrder, as: order, live: WebSocket.OrderUpdated }
  - { rpc: RiderService.StreamLocation, as: riderLoc, live: true }
states: [loading, empty, error, offline, ok]
actions:
  - { rpc: OrderService.Cancel, guard: "order.status ∈ fsm.cancellable_by(user)" }
```

Generated: the route file, the typed data hooks (`@connectrpc/connect-query` + TanStack Query, generated by `protoc-gen-connect-query` from the same protos), the state-shell component with loading/empty/error/offline branches wired, the action buttons with **FSM-derived enable/disable logic** (a Cancel button is disabled in states the FSM says the user can't cancel from — the client and server agree by construction), a Storybook story per state, and a screenshot test per state.

**The hole:** `order_tracking.view.tsx` receives fully-typed, non-null data for the `ok` state and renders it. That file is where an agent (or a human designer) does visual work, using only design-system primitives. Roughly: layout and beauty are hand-written; data, states, navigation, permissions, and error handling are generated.

This also kills the four-surface divergence problem: the rider, customer, restaurant, and admin clients consume the **same generated client module** and the same tokens, so `EXPO_PUBLIC_BASE_API_URL` vs `EXPO_PUBLIC_API_BASE_URL` cannot happen — env var names are generated into a typed config module from the topology model.

---

## 8. Migration from the existing HalalGoes system

**Strangler fig, with the strangler routing generated.** The `migration:` field per route in the topology model is the control surface: flip `legacy → shadow → new` in one YAML line, regenerate, redeploy Traefik. No hand-edited nginx/Traefik config, and rollback is a one-line revert.

Four stages, each mechanized:

1. **Model the legacy surface.** `migration/legacy-map.yaml` encodes the existing REST routes (we already have a complete inventory in `crosscut-api-contract.md`) and the Prisma schema. Generates an **anti-corruption adapter**: a Go service exposing the legacy REST paths and translating them to new RPCs. Old clients keep working, unmodified, against `hg-mono`. This is what buys us the right to rebuild the backend without shipping four new apps on day one.
2. **Shadow.** Routes marked `shadow` are duplicated by Traefik to both stacks; the new stack's response is compared, not returned. A generated **reconciliation differ** logs semantic mismatches (ignoring known-intentional divergences declared in the map, e.g. "new stack rejects client-supplied pricing"). Shadowing on read paths first (`/feed`, `/restaurants/:id/menu`, `/orders/:id`), then on writes with a generated idempotency shim.
3. **Data.** Field-level mapping in the model generates the backfill job, the ongoing CDC-style sync, and a continuous row-count + checksum reconciler. Geo columns (`rider.coords`, PostGIS) and money columns get explicit declared transforms because they're the ones that silently corrupt.
4. **Cut over per route,** newest-and-least-coupled first. Order of cutover: read-only feed/menu → identity/auth (a *net-new* surface: the frontends already call ~20 `/auth/*` endpoints that never existed, so implementing them in hg-mono is pure gain with no legacy to shadow) → cart/pricing → checkout saga → dispatch/tracking → admin.

**Migration-specific escape hatch:** legacy adapters live in `services/legacy-acl/` with a **declared expiry date** in the model. Expired adapters fail CI. Anti-corruption layers that outlive their purpose are the classic way a strangler becomes permanent.

---

## 9. First three deliverables

### M1 — "The Spine" (target: 2 weeks, humans review ~200 lines)
Prove the whole mechanism on the smallest possible domain slice.
- `hg/options/v1` metamodel + `identity/v1` proto (one message, two RPCs, real `hg.authz`, real protovalidate).
- Four generators working: `protoc-gen-hg-service` (Connect+gRPC server skeleton, config, health, OTel interceptors, graceful shutdown), `protoc-gen-hg-sql` (DDL → Atlas → sqlc queries), `protoc-gen-hg-authz`, `protoc-gen-hg-holes`.
- `hg-gen-topology` producing compose + Traefik with **2 replicas of the one service**, e2e test through Traefik proving round-robin.
- Generated typed client consumed by a throwaway screen in the customer app.
- CI: double-regeneration determinism gate, fence gate, model coverage gate, Model Change Report bot.
- **Exit criterion:** a human changes one field in one `.proto`, and within one CI run the DB migration, Go server, TS client, compose file, docs, and tests have all moved — with a Model Change Report they can read in under two minutes, and zero hand-written Go touched.

### M2 — "The Order Lifecycle Is Data" (target: 3 weeks)
- `order.fsm.yaml` + `checkout.saga.yaml` modeled from the real system, with the two known invariants encoded as model constraints: server-authoritative pricing, and no path to `orders.status` except `Advance()`.
- `protoc-gen-hg-saga` generating the Postgres+River executor, outbox, and compensations-as-holes.
- Order, Payment (mocked provider behind a generated port), Cart, Pricing services generated; ~15 holes filled by agents.
- Generated FSM test matrix passing at 100% model coverage, including all illegal-transition negatives.
- **Exit criterion:** a full checkout runs end-to-end in compose; failure injection at every saga step produces correct compensation with no orphaned payment; the restaurant-no-response timeout auto-cancels and refunds.

### M3 — "Four Surfaces, One Client" (target: 3 weeks)
- DTCG tokens → Style Dictionary → all four surfaces; screen model + `hg-gen-ui` generating routes, connect-query hooks, state shells, and FSM-derived action guards.
- Dispatch service (PostGIS radius search generated; the *ranking heuristic* is a hole) + WebSocket fan-out from the outbox.
- Legacy ACL service generated from `legacy-map.yaml`; first read routes flipped to `shadow` against the real hg-api.
- **Exit criterion:** the customer app tracks a live order through generated clients; the rider app accepts and delivers it; shadow diffs on `/feed` and `/orders/:id` are clean for 48h.

---

## 10. Honest self-critique — where this philosophy fails

**1. The bootstrap is on the critical path, and it is not small.** M1 ships no user-visible feature and requires ~6 working code generators. Realistically 6–8k lines of Go in `tools/gen/`. If M1 slips, Plan D has produced *less* than Plan A would have in the same time, and the slip is highly visible. This is the single biggest reason to reject this plan. Mitigation: M1 is deliberately scoped to one message and two RPCs, and three of the four generators are thin wrappers over existing tools (buf plugins, Atlas, sqlc) rather than novel machinery — but "thin wrapper" is where estimates go to die.

**2. Generator bugs are systemic, and nobody reviews their output.** §4's central move — humans never read generated code — means a generator that emits an authz bypass ships to every service simultaneously with zero human eyes on it. This is a *worse* failure mode than Plan A's, where a bad authz check is at least visible in one PR. Mitigations, all partial: golden-file tests per generator (snapshot of full output for a fixture model, reviewed by a human when it changes); the two-key rule on generator PRs; a small set of hand-written, generator-independent "constitutional" tests that hit the running stack and assert deny-by-default and money-tamper rejection from outside; and a mandatory blast-radius regeneration on every generator PR showing the semantic diff across all services. None of these fully closes the hole. **A human should personally read every line of `protoc-gen-hg-authz`.**

**3. The 20% that genuinely resists generation.** Concretely, for this domain: rider-ranking heuristics (ETA, load balancing, fairness); surge/promo pricing rules; the map/tracking UI; payment-provider webhook quirks and 3DS flows; push-notification vendor behavior; anything with a human-judgement threshold (fraud, dispute resolution); and one-off migration reconciliation. That's a real fraction of the *interesting* work — generation is most powerful exactly where the work is least interesting. Plan D's honest claim is not "we generate the hard parts," it's "we generate everything else so the hard parts get all the attention." If a reviewer believes the hard parts are 40% rather than 20%, the plan's leverage roughly halves.

**4. Model expressiveness ceiling → DSL creep.** The first time someone needs a conditional transition guard, they add `guard:` to the FSM schema. Then `unless:`. Then an expression language. Six months later `model/` is a programming language with no type checker, no debugger, no IDE, and one implementation. This is the documented death of MDD projects. Mitigation: a hard rule that **the model may only contain declarations, never expressions** — anything conditional becomes a named hole (`guard: rider_assigned` resolves to a Go function an agent writes). Enforced by a schema validator that rejects operators. This rule will be under constant pressure and must be defended.

**5. Round-trip is impossible, and that's a feature until it isn't.** You cannot edit generated code. When a generated service needs one unusual thing — a bespoke index, a hand-tuned query, a nonstandard middleware order — the options are (a) extend the generator for everyone, (b) escape hatch. Escape hatches are `//hg:escape reason="…" owner="…" expires="2026-11-01"` blocks in a `logic/` file, counted against the hand-written budget, surfaced on a dashboard, and **CI-failing after expiry**. If the escape-hatch count trends up instead of down, the philosophy is failing and should be partially abandoned — that trend line is the plan's own falsification test. Name it explicitly: **if hand-written LOC share is not below 15% by end of M3, stop building generators and revert to Plan A's model for new services.**

**6. Review bandwidth is concentrated, which is efficient and fragile.** One under-considered model PR now propagates further than any single bad PR could under Plan A. The reviewer must understand not just the model but the generator's *semantics* — what `hg.server_authoritative` actually emits. A "20-line diff" that a reviewer cannot fully evaluate is a false sense of smallness. Mitigation: the Model Change Report exists precisely to translate model semantics into consequences, and it must be treated as a first-class product, not a nice-to-have bot.

**7. Protobuf is an imperfect metamodel.** No native sum types (enums + `oneof` is clumsy for state payloads), no decimal (money must be int64 minor units by convention — enforceable by a lint rule, not by the type system), awkward for geospatial, and `optional`/presence semantics are a recurring source of subtle bugs. Every one of those becomes a convention the generator enforces rather than something the schema language guarantees.

**8. Debuggability.** A stack trace through generated code is harder to reason about, and an agent debugging a failure may not have the generator's source in context. Mitigation: generated files carry a header with the generator name, version, and the exact model file+line each block came from, so any stack frame maps back to a model element.

**9. Shared risk with Plan A:** nothing reaches real users until M3's shadow traffic. The strangler/ACL in §8 is the mitigation, and it should be pulled *earlier* if the risk is judged unacceptable — the ACL is generatable from M1's tooling and could ship in M2 instead.
