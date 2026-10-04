# Plan C — Strangler-Fig: Never Stop Shipping

> Competing philosophy. Judged against Plan A (contracts-first spec pyramid) on the same ten dimensions.

---

## 0. Core thesis

**The running system is the specification. We do not have its source — so we read it from its traffic.**

Plan A's premise is that the scarce resource is human verification bandwidth, and its answer is to write a spec, freeze it, and generate downward. That works when the spec-writer knows the truth. Here, nobody does:

- `api.halalgoes.com` was serving `/riders` on **2025-09-30, five days before hg-api's first commit exists** (gap-git-history §2 Phase A). The published repo is not the production backend.
- ~60 endpoints the four clients call every day have **no handler anywhere in the source we hold** — the whole `/auth/*` family, all onboarding, all admin refunds/disputes/settlements, Stripe Connect (crosscut-api-contract §4).
- The clients themselves disagree with the source we hold on casing (`is_accepting` vs `isAccepting`), on prefixes (`/api/...` vs root), on shape (`{data:[]}` vs bare array).

Writing a spec-of-record in this situation is writing fiction. Whatever we freeze, production will contradict, and we will discover the contradiction at cutover — the single most expensive moment. **So: never cut over.**

Instead: put a facade in front of production on day one, and replace it endpoint-by-endpoint, *in production*, each increment live behind a flag and reversible in one command. Correctness is not argued from a document; it is **measured by running the new implementation against the old one on real requests and diffing the answers** (Fowler's StranglerFigApplication + GitHub Scientist + branch-by-abstraction + expand/contract).

Three consequences that define everything below:

1. **The oracle is production, not a test suite.** An agent cannot hallucinate an endpoint's behavior when the merge gate is "your implementation matched the live one on 10,000 real requests."
2. **Every unit of work is shippable and reversible on the day it is written.** There is no integration Big Day.
3. **We buy knowledge before we buy code.** The first deliverable produces the missing API documentation as a *byproduct of serving traffic*, not as an archaeology project.

---

## 1. Planning system — the Observation Ledger

No frozen spec pyramid. Three artifacts, all living, all machine-checkable.

### 1.1 The Corpus (the real spec-of-record)
A versioned, redacted, deduplicated store of **real request/response pairs** captured by the Fig (§6), keyed by `method + route-template + scenario-hash`. From it we *generate*:
- `observed/openapi.yaml` — schemas inferred from real payloads, per endpoint, with observed nullability, enum value sets, and field frequency.
- `observed/traffic-profile.md` — QPS, p50/p95/p99, status-code distribution, caller app, auth-header presence, per endpoint.
- `observed/unknowns.md` — endpoints called by clients that production also 404s (i.e. genuinely unbuilt, not just missing from our copy).

This is regenerated nightly. It is never hand-edited. It is the citation source for every design decision.

### 1.2 The Divergence Register (`decisions/divergences.md`)
Strangling preserves behavior — including bugs. Production has real ones: `GET /riders/:id/orders/:orderId` ignores `orderId`; `toggle-accepting` silently no-ops on key mismatch; REST has zero auth guards. Bug-for-bug compatibility is the default, and **every intentional deviation must be an explicit, numbered, human-approved row**:

| ID | Endpoint | Legacy behavior | New behavior | Why | Clients affected | Diff rule |
|---|---|---|---|---|---|---|
| DIV-001 | `GET /riders/:id/orders/:orderId` | returns all rider orders | returns one order | live bug | rider app | expect-mismatch, allowlisted |
| DIV-007 | all `/admin/*` | unauthenticated | requires admin JWT | security | admin-web | diff on 401 ignored during shadow |

A diff that is *not* in the register and *not* benign is a defect. This inverts Plan A: instead of specifying everything, we specify only where we intend to differ. That document is ~50 rows, not 5,000 lines, and every row is a real decision a human should make.

### 1.3 ADRs with evidence tags
Every decision record must carry one of three tags:
- `EVIDENCE: corpus` + the query that proves it (`corpus q 'GET /feed/:id' --field pricing.coupons_applied --frequency`).
- `EVIDENCE: client-code` + file:line in `halal-goes`.
- `EVIDENCE: none — speculative` — allowed, but such an ADR **cannot gate a promotion to >5% traffic** until evidence exists.

Decisions change by superseding ADRs, and a superseded ADR must list which promotions it invalidates. This is deliberately lighter than a frozen pyramid: we expect to be wrong, and the cost of being wrong is one flag flip.

---

## 2. Execution loop — four agent roles, async, evidence-gated

Work flows as a pipeline, not a queue. Each stage has a different agent with a different prompt and a different definition of done.

**(a) Observer agent** — runs continuously. Reads the corpus, produces *strangle candidates*: "`GET /restaurants/:id/menu`, 4.1 rps, 3 distinct response shapes, no writes, 2 clients, safe tier." Emits a **Strangle Order**: endpoint, observed contract, traffic profile, tier, dependencies, rollback plan. Its output is data, not opinion.

**(b) Candidate agent** — implements one endpoint in Go in an isolated worktree. Its acceptance criteria are literally generated from the corpus: a `corpus-replay` test harness replays N recorded requests at the new handler and asserts semantic equality with recorded responses. The agent runs this locally, and it is *impossible to satisfy by inventing behavior*, because the expected outputs are production's. Definition of done: replay-green + shadow-deployed. **Not** "merged to serve traffic."

**(c) Diff-triage agent** — the highest-leverage role and the one Plan A has no analogue for. It reads the live mismatch stream from the Fig and classifies each diff into: `benign` (timestamp/ordering/float formatting → propose a normalizer rule), `divergence` (matches a register row → close), `defect` (candidate is wrong → file a fix order), or `legacy-bug-discovered` (candidate is right, legacy is wrong → propose a register row for human decision). It is forbidden from adding normalizer rules that would mask a defect class it hasn't sampled at least 20 examples of.

**(d) Promoter agent** — proposes traffic-weight increases when statistical gates pass (§3), writes the Promotion Card, and executes rollback automatically when guards trip. It never writes application code.

**Async property:** stages (a)–(c) are entirely invisible to users. Only (d) touches the live path, and only through a one-line config change. Agents therefore run 24/7 without any human being awake, and the worst outcome of a bad agent-day is a pile of shadow services nobody promoted.

**Concurrency:** N candidate agents work on N endpoints in parallel with no merge conflicts, because each new endpoint is a new file/service and the only shared surface is the Fig's route table (append-only, one line per endpoint).

---

## 3. Verification & anti-hallucination — the diff oracle

Plan A prevents hallucination with contracts + adversarial reviewers. Plan C prevents it with **an oracle that the agent does not control**.

### 3.1 Layered gates (each must pass before the next)
1. **Replay gate** — candidate must reproduce ≥99.5% of recorded corpus responses semantically. Corpus is sampled *after* the agent's branch is cut (fresh requests it has never seen) to prevent overfitting.
2. **Shadow gate** — deployed to production, receives a *copy* of live traffic, response discarded. Must run ≥24h **and** ≥N requests **and** ≥K distinct users, with mismatch rate below the endpoint's budget (read-only: 0.1%; writes: 0.0% for non-allowlisted classes).
3. **Latency/error gate** — candidate p99 ≤ 1.2× legacy p99; candidate 5xx rate ≤ legacy.
4. **Coverage-of-reality gate** — the shadow must have exercised every response *status code* and every observed response *shape variant* the corpus knows for that endpoint. This is the anti-blind-spot mechanism: not "did you write tests," but "did reality exercise your code in all the ways it exercises the old one." Un-exercised variants block promotion and generate a targeted synthetic-traffic task.
5. **Rollback drill gate** — before first promotion, the endpoint is rolled back and re-promoted once in staging, automatically, and the drill is recorded. An endpoint that has never been rolled back is not considered rollback-capable.

### 3.2 Semantic diffing
A Go `hgscientist` package (Scientist port: `Use(control)` / `Try(candidate)`, control's answer always returned, mismatches published, panics in the candidate swallowed and counted). Comparison is **normalized-JSON semantic**, not byte equality: configurable per-endpoint normalizers for timestamps, UUIDs generated in-flight, array ordering, float precision, and known volatile fields. Every normalizer is a reviewed one-liner in a registry with an example diff attached — because a normalizer is a place where you deliberately stop looking, so it gets human eyes.

Additional Scientist-derived technique: **order-swap runs.** Periodically run candidate-before-control instead of control-before-candidate. A mismatch-rate asymmetry between the two orderings proves hidden shared state (cache warming, Redis key reuse, DB row contention) — the single best detector of "these two are not actually independent," which is exactly the failure that kills dual-running write paths.

### 3.3 What this catches that specs don't
- Undocumented headers, cookies, and query params clients actually send.
- The real enum universe (production emits statuses hg-api's enum doesn't have).
- The 4% of requests that hit a code path nobody remembers writing.
- Bare-array vs `{data:[]}` envelope questions — answered by data, not argument.

### 3.4 What it structurally cannot catch — and the fallback
Endpoints production **also** doesn't implement (refunds, disputes, settlements, most onboarding, the entire UI overhaul) have **no oracle**. For those we explicitly fall back to spec-first development, marked `EVIDENCE: none — speculative`, with a hard rule: *speculative endpoints ship behind a client-side flag to internal users only until they have 2 weeks of real traffic of their own.* We do not pretend the strangler covers them. See §10.

---

## 4. Human review model — Promotion Cards, not code review

Two PR classes, and only one of them needs a human.

**Type-S (Shadow) — auto-merge, no human.** Adds or changes a service that receives zero user-facing traffic. Blast radius provably zero: CI asserts the diff touches no file in `fig/routes/` and no `weight:` value. These merge on green (replay gate + build + lint). This is where 90% of agent output lands. A human never reads them, and nothing bad can happen if they are wrong — the wrongness shows up as a mismatch rate, which is a number, not a code review.

**Type-P (Promotion) — human, ~90 seconds.** A one-line config diff plus a generated **Promotion Card**:

```
PROMOTE  GET /restaurants/:id/menu   legacy → hg-catalog   5% → 25%

What it does      Returns a restaurant's menu. Read-only. No writes, no money.
Shadow evidence   38h, 412,904 requests, 8,113 distinct users
Mismatch rate     0.02%  (81 diffs)
  · 79  menu item ordering when two items share sort_order   → normalizer NRM-014
  · 2   restaurant deleted mid-request                        → benign race
Latency           p99 41ms vs legacy 96ms  (−57%)
Errors            5xx 0.00% vs legacy 0.01%
Unknowns          none
Rollback          `hgctl weight menu legacy=100` — 4s to take effect. Drill passed 2026-08-07.
Risk if wrong     Menus render stale/empty for ≤25% of menu views until rollback.
Reviewer question Is 79 ordering-diffs/day acceptable, or should sort be made total?
```

The human is asked a **judgment question about risk**, never asked to verify correctness — the machine did that against production. This is the key bandwidth argument versus Plan A: Plan A asks a human to certify that code is right; Plan C asks a human to certify that a measured risk is acceptable. The second is far cheaper and far more within a human's actual competence.

**Batching:** promotions queue into a twice-daily digest. Nothing blocks: while a promotion waits, shadow work continues, and the candidate keeps accumulating evidence (the card's numbers get *better* while it waits).

**Escalation rules:** money paths, auth, and anything touching PII require a named human on every step (1%→5%→25%…), no batching.

---

## 5. Orchestration — reconcilers, not sagas

Temporal must go (heavy, JVM-adjacent ops burden, and `restaurant-web` currently talks gRPC to it *directly from a Next.js server*, which is an architectural leak we must close). But we cannot stop it: there are live orders inside running workflows.

**Choice: a ~600-line Go reconciler over Postgres. No new infrastructure, no engine.**

```go
type Instance struct {
    ID, Kind      string
    Desired       State          // what should be true
    Observed      State          // what we believe is true
    NextAttemptAt time.Time
    Attempt       int
    Lease         *time.Time
}

// A step is a pure function. Effects are returned, not performed.
type Step func(ctx context.Context, in Instance) (next State, effects []Effect, err error)
```

- **Durability** = a Postgres row. **Timers** = `next_attempt_at`. **Concurrency** = `SELECT … FOR UPDATE SKIP LOCKED` with a lease. **Retries** = `attempt` + backoff. **Idempotency** = effects carry deterministic keys; the effect log is a table with a unique index.
- **Testability**: steps are pure functions of state; the entire order lifecycle is unit-testable with zero infrastructure and no determinism-replay mental model.
- **Observability**: the current state of every order is a `SELECT`, not a workflow-history scan. (Today `restaurant-web` scans *entire Temporal histories client-side* to find an order — that whole class of pathology disappears.)

**Why a reconciler and not a saga engine — and why it is the strangler-native choice:** a reconciler compares *desired* to *observed* and converges. During migration, `Observed` can be populated **by reading the legacy system** (Temporal workflow query, or the orders table). That means the reconciler runs for months as a **read-only shadow controller**: it computes what it *would* do, logs the divergence from what Temporal actually did, and touches nothing. It is the exact same shadow/diff pattern as the Fig, one layer down. When its divergence rate is near zero, we flip a per-order flag making it the actuator for *new* orders only; in-flight Temporal orders drain naturally over ~2 hours. Temporal is deleted when its last workflow completes. **At no point do we migrate a running order.**

A saga engine (Plan A's outbox + River) cannot do this: a saga owns the process from the start, so adopting it requires a cutover per workflow type. The reconciler's dual-state model *is* the migration mechanism.

Escape hatch: everything sits behind an `Orchestrator` port; if the reconciler proves insufficient for a genuinely long-running human-in-the-loop flow (disputes, settlements), Restate slots in behind the port for that flow only.

---

## 6. Deployment — Traefik + the Fig, in front of production, on day one

Three tiers, all in one `docker-compose.yml`, deployed to the existing box before a single new service exists.

```
DNS api.halalgoes.com
      │
   [ Traefik ]  TLS, HTTP/2, rate limits, weighted round-robin, access logs
      │              (weights + LB via dynamic FILE provider — see note)
      ├── weight ──▶ [ hg-fig ]  Go strangler proxy: route table, record, shadow, diff, identity injection
      │                   ├─▶ legacy upstream  (the private prod backend, untouched)
      │                   └─▶ hg-* Go services (candidates: shadow or live)
      └── weight ──▶ legacy upstream directly   (escape hatch: bypass the Fig entirely)
```

**Traefik note (real constraint):** Traefik OSS exposes `weighted` and `mirroring` services only through the **file/KV provider**, not through Docker labels. So the compose stack mounts `traefik/dynamic/*.yml`, and `hgctl` rewrites that file (Traefik hot-reloads it in seconds). Docker labels stay for the simple per-service routers. Rollback is therefore a file write, not a deploy.

**Division of labor, deliberately:** Traefik does weights (canary), TLS, and load balancing. Traefik's *mirroring* discards the mirrored response, so it cannot diff — therefore **the Fig owns shadowing and diffing**, because diffing requires holding both responses. Traefik mirroring is still used for pure load-shape testing (can the candidate survive the traffic volume) before diffing begins.

**Load balancing / scale:** each Go service runs `N` replicas behind a Traefik weighted service with health checks; `docker compose up --scale hg-catalog=3`. Sticky sessions only for WS.

**Tested end-to-end, continuously:** a `compose-e2e` CI job stands up the full stack (Postgres+PostGIS, Redis, MinIO, Traefik, Fig, all services, a stubbed "legacy" upstream that replays corpus responses) and runs the client-facing smoke suite through Traefik's public port. The stubbed legacy is generated from the corpus — so our integration environment behaves like production without needing production. This lands in Milestone 1, not at the end.

**Fixing the known infra defects while we're there** (from hg-docker analysis): the `./config/redis/master/redis.conf` mount path bug (mounts a nonexistent dir), redis-master having no data volume despite `appendonly yes`, slaves announcing host ports that aren't mapped, unpinned `:latest` images, PgBouncer deployed but bypassed by `DATABASE_URL`. These are Type-S PRs, done in week one, verified by the compose-e2e job.

---

## 7. UI/UX overhaul — design big, ship thin

This is the one place where up-front batch work is correct, and Plan C says so plainly: **design is cheap, reversible, and its failure mode is inconsistency** — which is precisely what HalalGoes has (four apps, three auth flows, mocked approval screens, dead legacy stores). You cannot strangle your way to a coherent visual language.

So: **UX is designed up front in one pass; UI is shipped screen-by-screen behind flags.**

1. **Design system package first** (`@hg/ui`): tokens, primitives, motion, empty/error/loading states, and — critically — a **canonical state matrix** every screen must implement (loading / empty / error / offline / stale / partial). Most of HalalGoes' worst UX today is missing states, not ugly ones.
2. **Full flow design up front** for the four surfaces, reviewed once by a human: customer order lifecycle, rider onboarding + delivery, restaurant order console, admin review queues. Delivered as annotated flows + screen inventory + the divergence list ("these 9 screens change behavior, not just looks").
3. **Generated API client** (`@hg/api-client`) from `observed/openapi.yaml`. This single artifact kills an entire documented bug class: the `/api` prefix mismatch, `is_accepting` vs `isAccepting`, `//` double-slash URLs, the `LocationSelector` double-unwrap, hand-redeclared DTOs in every app. Clients stop guessing.
4. **Screen-level strangling**: each screen ships as `ScreenV2` behind a per-user flag resolved server-side by the Fig (`X-HG-Flags` header) — so we can promote a redesigned screen to 5% of users, watch task-completion and error telemetry, and roll back in one flag. Old and new screens share the generated client, so UI work never blocks backend work and vice versa.
5. **Rider/restaurant native apps** get the same treatment via OTA (Expo updates) with the flag read at boot.

The UX oracle is not a diff (a redesign is *supposed* to differ). It is **task telemetry**: funnel completion, time-to-first-order, error-state frequency, support contacts. Promotion gate: no regression in funnel completion at 5% over 72h.

---

## 8. Migration — the core, in detail

### 8.1 Step 0: take the front door (week 1, zero behavior change)
Point `api.halalgoes.com` at Traefik → Fig → legacy upstream, 100% passthrough. Ship it. This is a production deploy on day ~4 with **no functional change** and it is the highest-value thing in the plan: from that moment we own routing, we can observe everything, and every subsequent change is a config edit.

Rollback: DNS/CNAME back to the legacy host. Practiced before go-live. TTL kept at 60s for the first month.

Also on day one: **stop pretending the clients agree.** The Fig normalizes the known client-side defects at the edge (strip stray `/api` prefixes, collapse `//`, accept both `is_accepting` and `isAccepting`) so those bugs die immediately for all users without touching four client codebases. Each normalization is a Divergence Register row.

### 8.2 Endpoint tiering (drives order of work)
| Tier | Examples | Shadow strategy | Mismatch budget |
|---|---|---|---|
| **T1 Read-only** | `GET /feed/:id`, `/restaurants/:id/menu`, `/orders/:id`, `/pricing/:cartId`, `/admin/analytics` | Full shadow, response discarded | 0.1% |
| **T2 Idempotent writes** | `PUT /riders/:id/location`, `PUT /riders/:id/availability`, `PUT /carts/:userId` | Shadow writes to `hgnew` schema | 0.05% |
| **T3 Stateful writes** | `PUT /restaurants/:rid/orders/:oid`, order status transitions | Shadow **compute-only** (candidate computes decision + intended effects; effects logged, not performed) | 0% unregistered |
| **T4 Money & identity** | `/orders/checkout/:cartId`, `/payments/*`, `/auth/*` | Compute-only shadow + manual review of every diff; canary 1%→5% with named human each step | 0% |
| **T5 Realtime** | WS gateway `:9080` | Fan-out shadow (§8.6) | event-level diff |

### 8.3 The per-endpoint ladder (identical for every endpoint — this is the factory)
1. **Observe** — Fig records ≥1,000 requests or 7 days.
2. **Generate** — observed contract + replay fixtures + a scaffolded Go handler stub.
3. **Implement** — candidate agent; replay-green.
4. **Shadow** — deploy; Fig dual-runs; diffs stream to triage. *(Response still 100% legacy. Zero user risk.)*
5. **Clean** — triage drives mismatch rate under budget; every diff classified.
6. **Drill** — automated rollback rehearsal in staging.
7. **Canary** — 1% → 5% → 25% → 50% → 100%, each step a Promotion Card, each with a hold period (T1: 2h; T4: 48h) and auto-rollback guards on error rate / p99 / diff rate.
8. **Contract** — delete the legacy route from the Fig table; the legacy backend never sees that path again. Endpoint is *done* and never revisited.

Because step 8 exists and is explicit, we can always answer "how far along are we?" with a number: **routes contracted / routes observed**. That's the burndown, and it is measured, not estimated.

### 8.4 Database: expand/contract, legacy stays authoritative longest
The new Go services must not fork the data. Sequence per bounded context:

1. **Read-only shadow reads** — candidates read from a **Postgres read replica** of the production DB. No schema change. Diffing proves read parity.
2. **Expand** — additive-only migrations on the live schema (new columns nullable, new tables, new indexes; never rename, never drop). Every migration must be safe against a running legacy that knows nothing about it. Enforced by a CI linter that rejects `DROP`, `RENAME`, `NOT NULL` without default, and type narrowing.
3. **Shadow writes** — candidate writes go to `hgnew.*` tables; a comparator job diffs `hgnew` rows against legacy rows for the same entity every minute. This is how we validate write correctness **without any write risk at all**.
4. **Dual write, legacy authoritative** — candidate writes both; reads still come from legacy. Comparator still running. Divergence = alarm.
5. **Flip authority** — reads come from the new path; legacy still written (so rollback is instant and lossless).
6. **Stop dual write** — after a defined soak (2 weeks per context) with zero comparator alarms.
7. **Contract** — drop legacy columns/tables. This is the *only* irreversible step in the whole plan, it happens last per context, and it requires a named human plus a verified backup.

Backfill for new-shape data uses batched, resumable, rate-limited jobs with a progress table; backfill correctness is itself verified by the comparator before it counts.

### 8.5 Auth: strangled **last**, delegated **first** (the key unlock)
Auth is the one thing every request needs and the one thing whose source we most conclusively do not have (gap-git-history proves `/auth/*` never existed in hg-api's history and postdates its HEAD by 3.5 months). Reimplementing it early would be pure guesswork and would gate everything else.

So invert it. **The Fig becomes the identity broker:**
- Fig receives the client's `Authorization: Bearer …`.
- Fig validates it by **delegating to the legacy backend** (introspection call or a cheap authenticated legacy endpoint), caching the result in Redis for the token's remaining life.
- Fig mints a short-lived internal JWT and injects `X-HG-Identity: {sub, role, scopes}` on the hop to new Go services (mTLS/internal network only; the header is stripped from all inbound external requests unconditionally).
- New Go services trust `X-HG-Identity` and implement **authorization** (who may do what) without implementing **authentication** (who are you).

Immediate side benefits: the Fig can enforce authz **today** on the currently wide-open legacy routes (`POST /admin`, `DELETE /admin/users/:id`, refunds) without touching the legacy code — an emergency security fix delivered as a proxy rule in week one. And WS identity (currently entirely client-asserted, "MVP mode") gets the same treatment: the Fig terminates the WS handshake and refuses `connect_user` for an identity that doesn't match the token.

Auth itself is strangled at the very end, using the same ladder plus token dual-issuance: new service issues tokens, both issuers' tokens accepted by both validators, verify agreement on real tokens, then flip issuance, then retire.

### 8.6 Realtime / WebSocket strangling
The new Go WS gateway starts life as a **client of the legacy gateway**: it connects as a subscriber, receives `order_request` / `order_update` / `notification`, normalizes them to the new event schema, and re-emits to clients that have opted in. Diffing is event-level: for each order, did the new gateway emit the same event sequence (modulo ordering and normalizers) as the legacy? Clients migrate by WS URL flag, per user, reversible. Only after event parity does the new gateway become a first-class publisher fed by the reconciler.

### 8.7 Rollback discipline
- Every stage is one `hgctl` command, and the command is printed on the Promotion Card.
- Auto-rollback guards run in the Fig itself: error-rate, p99, and diff-rate thresholds per endpoint, evaluated on a 60s window, rollback executed without human involvement, human notified after.
- **Weekly rollback drills**: a scheduled job picks a random promoted endpoint, rolls it back in staging, verifies traffic serves correctly from legacy, re-promotes, and records the result. An endpoint whose drill fails is automatically demoted in production. Rollback that has never been exercised is not rollback.
- The only steps without a fast rollback are DB *contract* steps (8.4.7) and legacy route deletion (8.3.8). Both are deliberately last, human-gated, and backed up.

---

## 9. Milestone sequence — the first three deliverables

### M1 — "The Fig is live" (target: 2 weeks, ships to production)
- Traefik + `hg-fig` in front of `api.halalgoes.com`, 100% passthrough, TLS, access logs, per-route metrics.
- Corpus recorder with **PII redaction at capture time** (phone, email, address, name, KYC document URLs, tokens hashed not stored) and a documented retention window.
- `observed/openapi.yaml` + traffic profile generated nightly — **this is the deliverable that finally documents the real backend**, the one nobody has.
- Edge normalizations shipped (prefix/casing/double-slash) + emergency authz rules on the wide-open admin/refund routes.
- Compose-e2e CI job green, with the corpus-backed legacy stub.
- `hgctl` with `weight`, `shadow`, `rollback`, and drill commands.
- **User-visible change: none. Risk: routing only. Rollback: DNS.**

### M2 — "First endpoints contracted" (target: +3 weeks)
`GET /restaurants/:id/menu` and `GET /feed/:userId` (T1, highest traffic, read-only) taken through the full eight-step ladder to **contracted** — legacy no longer serves them.
- Proves: candidate scaffolding, replay harness, `hgscientist` diffing, triage loop, Promotion Cards, canary weights, auto-rollback guards, drills, replica reads, and the Go service template — all of it, on real traffic.
- Also ships `@hg/api-client` v0 generated from the observed spec, adopted by `restaurant-web` first (the app with the worst prefix drift).
- Deliverable includes the first **contracted-routes burndown** number.

### M3 — "Reconciler shadows Temporal + WS parity" (target: +4 weeks)
- `hg-reconciler` runs read-only over the order lifecycle, computing intended transitions and diffing them against what Temporal actually did. Publishes a daily divergence report. Owns nothing.
- New Go WS gateway subscribed to the legacy gateway, achieving event-sequence parity, with 5% of rider-app users on the new URL.
- First T2 endpoints (`PUT /riders/:id/location`, `PUT /riders/:id/availability`) contracted — proving the shadow-write + comparator machinery.
- After M3, the hard parts (stateful orchestration, realtime, writes) are all *proven under observation*, and the remaining work is the same ladder repeated, which is exactly the work agents do best unattended.

---

## 10. Honest self-critique — where this philosophy fails

**1. The oracle may be empty.** Everything above assumes `api.halalgoes.com` carries meaningful, diverse, real traffic. HalalGoes may be pre-launch or near-zero traffic. If so, shadow diffing degrades into replaying a handful of synthetic requests — which is Plan A with an expensive proxy bolted on. *Mitigation is honest but weak:* a synthetic traffic generator driven by the four client apps' actual call patterns. This is the single biggest bet in the plan and it must be validated in week one, before M1 ships, by measuring actual production QPS. **If QPS is trivial, adopt Plan A and keep only the Fig + expand/contract from this plan.**

**2. ~40% of the needed surface has no legacy to strangle.** By the crosscut inventory, roughly 60 called endpoints don't exist anywhere — the entire admin refunds/disputes/settlements suite, Stripe Connect onboarding, most onboarding flows, menu image upload. Plus the whole UI overhaul. For all of that, the diff oracle is *vacuous* and we fall back to specification and ordinary review. Plan C is therefore not a complete methodology; it is a superb method for the ~60% that exists and a mediocre one for the rest. A fair reading is that Plan C and Plan A are complements, and Plan C's claim is only that the *sequencing* should be strangler-first.

**3. It canonizes the legacy's bugs and its data model.** Diffing rewards bug-for-bug fidelity. Worse, reading and dual-writing the existing schema for months means the existing Prisma model shapes the new services' internals; the clean domain model may quietly never arrive, and we end up with Go microservices wearing a NestJS schema. The Divergence Register fights this at the behavioral level but has no answer at the structural level. Plan A's frozen domain model is genuinely better here.

**4. The long tail is where strangler projects die.** The last 15% of endpoints — rare, weird, low-traffic, hard to shadow because they barely fire — take disproportionate time, and the organization's attention moves on once the visible 85% is done. The permanent-two-systems outcome is the classic strangler failure mode, and it is *worse* than either pure alternative because you pay both operating costs forever. Countermeasure: a hard, dated contract deadline per bounded context, and the burndown published weekly. It is a countermeasure, not a solution.

**5. The Fig is a new single point of failure and a new monolith.** Everything now flows through one Go proxy holding routing, recording, diffing, identity brokering, flags, and normalizations. Its bugs are total outages. Its feature creep is architectural rot. It must be boring, small, heavily tested, and deployable independently — and it will be tempting to make it clever. Traefik's direct-to-legacy escape route exists precisely because we expect the Fig to fail at least once.

**6. Recording production traffic is a real privacy and legal exposure.** Names, phone numbers, delivery addresses, KYC document URLs, payment metadata. Redaction-at-capture is engineering that can be wrong in ways that don't show up in a test. This is a genuine cost Plan A does not pay at all, and depending on jurisdiction it may require a DPA/consent review before M1 can ship.

**7. Mismatch budgets normalize deviance.** "0.1% is fine" quietly becomes "0.4% is basically fine." Normalizer rules are, by construction, places where we decided to stop looking; a diff-triage agent under throughput pressure will write too many of them. The 20-example rule and human-reviewed normalizer registry are mitigations, not guarantees.

**8. Substantial machinery that delivers zero user value.** The Fig, corpus, replay harness, comparator jobs, drill scheduler, `hgctl` — that is a real engineering investment producing no feature. It pays back only if the migration is long (many months) and the risk is high (live money, live orders). For a small system with low traffic and a tolerant user base, a weekend cutover would genuinely be cheaper, and this plan would be the more expensive mistake.

**9. It cannot catch what production never does.** Unexercised paths, seasonal behavior, failure modes under load the system has not yet seen, and every requirement that is *new*. Shadow traffic proves you match yesterday; it says nothing about tomorrow.

---

## Appendix — one-line comparison to Plan A

| | Plan A | Plan C |
|---|---|---|
| Source of truth | Human-written frozen spec | Recorded production traffic |
| First deliverable | Walking skeleton (no users) | Fig in production (all users, no change) |
| Correctness proof | Tests + adversarial review | Diff vs live system on real requests |
| Human's job | Certify code is right | Certify measured risk is acceptable |
| Orchestration | Outbox + saga + River | Reconciler over Postgres (shadow-capable) |
| Auth | Built to spec | Delegated to legacy, strangled last |
| Failure mode | Wrong spec propagates everywhere | Permanent two-system limbo |
| Best when | Behavior is genuinely new | Behavior exists and is unknown |

**Sources consulted:** [Fowler — StranglerFigApplication](https://martinfowler.com/bliki/StranglerFigApplication.html) · [Thoughtworks — Embracing the Strangler Fig pattern](https://www.thoughtworks.com/insights/articles/embracing-strangler-fig-pattern-legacy-modernization-part-one) · [github/scientist](https://github.com/github/scientist) · [Flexport — refactoring with Scientist (order-swap runs)](https://flexport.engineering/using-githubs-scientist-library-to-refactor-with-confidence-9d34600edd5e) · [Pete Hodgson — Expand/Contract](https://blog.thepete.net/blog/2023/12/05/expand/contract-making-a-breaking-change-without-a-big-bang/) · [Zero-downtime migrations: expand/contract, shadow reads](https://thebackenddevelopers.substack.com/p/zero-downtime-database-migrations) · [Traefik — traffic mirroring](https://doc.traefik.io/traefik-hub/api-gateway/expose/services/api-gateway-mirroring) · [Traefik — canary via weighted round robin](https://doc.traefik.io/traefik-hub/api-gateway/expose/services/api-gateway-canary) · [Restate vs Temporal](https://restate.dev/vs/temporal)
