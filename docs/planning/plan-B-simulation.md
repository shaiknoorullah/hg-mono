# Plan B — Correctness by Deterministic Simulation & Property-Based Verification

> Competing plan. Philosophy: **process discipline does not prevent bugs; executable verification does.**
> The primary product artifact is not the services — it is `hgsim`, a deterministic simulator of the whole
> HalalGoes platform, plus a catalog of executable invariants that every build must survive.

---

## 0. Thesis, in one paragraph

Every bug in the existing HalalGoes system is a *concurrency, ordering, failure, or bookkeeping* bug that no
amount of code review would have caught: the checkout saga continues to rider assignment on a rejected order
because a compensation returned `false`; `failed_notifications:restaurant:{id}` is written and never read;
losing one 30-minute Redis key leaves the DB saying `RIDER_ASSIGNED` while the assignment workflow hangs until
a timeout that never runs its compensation; refunds on the no-rider path are a `console.log` TODO; a busy rider
keeps receiving offers because `is_accepting_orders` is never flipped; the client's 7-second offer dismissal
never tells the server. A human reading a 300-line PR cannot see any of these. A machine that runs 50,000
seeded orders per hour — with reordered messages, killed processes, partitioned Redis, clock skew, and duplicate
deliveries — sees all of them on day one, and hands you the seed to reproduce each in 40 milliseconds.

So: **build the simulator first, state the invariants first, and make "it passes the seed sweep" the definition
of done.** Reviews get small because the machine did the hard part, not because we agreed to keep PRs small.

Grounded in current practice: FoundationDB's simulation framework, TigerBeetle's VOPR, WarpStream's DST of an
entire SaaS (via Antithesis' deterministic hypervisor), Polar Signals' "(Mostly) DST in Go", Antithesis'
*sometimes assertions*, Jepsen/Elle's history-checking, `testing/synctest` (stdlib in Go 1.25),
`pgregory.net/rapid` (property + state-machine testing with automatic shrinking), and `porcupine`
(linearizability checking in Go).

**How this differs from Plan A.** Plan A makes correctness a *social* property enforced at review time
(frozen specs, adversarial reviewer agents, diff-coverage gates). Plan B makes it a *mechanical* property
enforced at run time. Plan A's unit of truth is a reviewed `.proto`; Plan B's is an executable predicate that
a machine tries to falsify a million times a night. Plan A picks an orchestration library; Plan B writes ~800
lines of orchestration precisely so that orchestration is simulatable. Plan A freezes design up front; Plan B
lets design change whenever a counterexample proves it wrong.

---

## 1. Planning system — invariant-first, counterexample-driven

There is no frozen spec pyramid. There are three artifacts, all in-repo, all versioned:

**(a) `model/INVARIANTS.md` — the invariant catalog.** Numbered, one English line each, each bound to an
executable checker `INV_xx` in `model/checkers/`. This is the spec that matters. It is written *before* the
code it constrains. Initial catalog, derived directly from the observed HalalGoes failures:

| ID | English statement | Kills which real bug |
|---|---|---|
| INV-01 | Money is conserved: `charged == item_total + fees − discounts`, recomputed server-side; cart, pricing, and order totals agree | variant price added in cart vs. replaced in order; client-echoed pricing snapshot; hardcoded $5/$2 fees |
| INV-02 | Order status transitions are a subset of the declared DAG — for **every** writer, not just one code path | `PUT /orders/:id/status` bypass; CONFIRMED→RIDER_ASSIGNED skipping PREPARING |
| INV-03 | At most one rider is assigned per order; a rider has at most one active order; assignment is a linearizable register | concurrent offers to a busy rider; first-responder-wins in both directions |
| INV-04 | Every order that leaves the happy path with a captured payment ends refunded or with an open refund record | `cancelOrderAndRefund` logging "refund would be initiated here" |
| INV-05 | A message about order *O* is delivered only to members of *O*'s party (customer, restaurant, assigned rider, admin) | client-asserted WS identity; anyone can join any `order:{id}` and read customer PII |
| INV-06 | Every notification is delivered, expired-with-compensation, or dead-lettered-with-an-alarm — never silently dropped | `failed_notifications:*` write-only key; rider offers skipped when offline |
| INV-07 | *(liveness)* Every order reaches a terminal state within simulated `T`; no saga waits on a signal that can never arrive | split-brain from a lost `notification_workflow:{orderId}` key |
| INV-08 | No durable decision depends on a cache entry: deleting all Redis keys at any instant must not change any outcome, only latency | 30-minute-TTL Redis strings gating accept |
| INV-09 | Every effect carries an actor; no effect mutates an aggregate the actor does not own | zero authorization anywhere in hg-api |
| INV-10 | Timeouts are consistent across layers: what the client displays, what the payload advertises, and what the server enforces are the same number | 7s / 5m / 10m uncoordinated expiries |
| INV-11 | Every write has a reader: no state written by any effect is unreachable from any read path | 6+ orphaned Redis keys, dead workflows, `CheckoutLog` model |

Invariants are added, never quietly weakened. Weakening one requires an SDR (below) and a human sign-off — it
is the *only* thing a human must think hard about.

**(b) `decisions/NNNN-*.md` — Simulation Decision Records.** Half a page: the decision, the invariants it must
preserve, the scenarios it must survive, and the seed evidence. A decision changes when (and only when) one of
three things happens: a counterexample seed proves it wrong, a new invariant contradicts it, or a human
overrides it. "We reconsidered" is not a reason; "seed 0x8f31c2 shows this deadlocks under a partition" is.
This replaces Plan A's freeze-then-thaw governance with something falsifiable.

**(c) `model/scenarios/` — the workload catalog.** Executable descriptions of what the simulated world does
(customers order, restaurants accept/reject/ignore, riders accept/dismiss/crash/go offline mid-delivery,
payment provider flakes, Redis restarts, a service is SIGKILLed, the network reorders). Scenarios are code,
generated and combined by `rapid`.

Only the current milestone is planned in detail. Everything beyond it is a list of invariants we intend to add.

---

## 2. Architecture that makes simulation possible (non-negotiable)

**Deterministic core, imperative shell.** Every service is split:

```
domain/order/       decide(state, cmd) -> ([]Event, []Effect)     // pure, total, no I/O
                    apply(state, event) -> state                   // pure
services/order/     HTTP/WS handlers, Postgres + Redis adapters    // imperative shell, thin
```

* The domain packages may not import `time`, `math/rand`, `net/http`, `database/sql`, `crypto/rand`, or any
  client library. Enforced by `tools/lint-purity` in CI (an AST import check, ~80 lines) — an agent physically
  cannot smuggle I/O into the core.
* All non-determinism arrives through one narrow interface set, `Env`: `Now()`, `Rand()`, `NewID()`,
  `Send(msg)`, `Query(port, req)`. Two implementations: `prod` (real) and `sim` (virtual).
* **Effects are data.** `Effect{Kind: ChargeCard, Args: …}` is a value the domain returns, not a call it makes.
  The shell interprets effects; the simulator interprets the same values against fake dependencies. This is the
  single most important structural decision in the plan: it means the *exact same business logic bytes* run in
  simulation and in production. There is no "test version" of the saga.

Boring parts of the system (menu CRUD, profile edits, image uploads, admin lists) are explicitly declared
**boring tier** and exempt: normal handlers, normal tests. Only order lifecycle, dispatch, payment, realtime
fanout, and authorization are **simulated tier**. Applying this discipline everywhere would be ceremony.

---

## 3. `hgsim` — the simulator (the actual product of Milestone 1)

Single Go binary. One process, one logical thread of control, everything faked:

| Source of non-determinism | Simulated as |
|---|---|
| Time | Virtual clock; advances only when all actors are blocked (`testing/synctest` bubbles for the parts that use real goroutines; an explicit event-queue clock for the core loop) |
| Randomness / IDs | Single seeded `math/rand/v2` PCG; every ID and UUID derives from it |
| Network (HTTP, WS) | In-memory bus with per-link policies: delay, reorder, duplicate, drop, one-way partition, heal |
| Postgres | In-memory model of the tables the domain touches + a transaction model with configurable isolation anomalies; the *real* schema is exercised in the shakedown tier (§7) |
| Redis | In-memory model with **adversarial eviction**: any key may vanish at any tick (this is how INV-08 gets falsified) |
| PostGIS geo | Deterministic planar geo model; real `ST_DWithin` behavior differentially tested against it nightly |
| Payment provider | Fake provider that can succeed, fail, time out, double-charge on retry, and confirm-after-timeout |
| Process crashes | Any actor can be killed and restarted at any tick; it must recover from durable state alone |
| Clients | Simulated customer / restaurant / rider agents that behave badly on purpose (dismiss offers silently, accept twice, reconnect mid-flow, background the app) |

Run modes:

```
hgsim run   --seed 0x8f31c2 --sim-hours 24        # one reproducible world
hgsim sweep --seeds 50000 --workers 16 --budget 30m   # nightly / per-PR fleet
hgsim shrink --seed 0x8f31c2                       # minimize the failing trace
hgsim replay --trace traces/0x8f31c2.jsonl --explain # human-readable causal narrative
```

Every failure emits: the seed, a shrunk trace (rapid's automatic minimization does the work), the violated
invariant ID, and a plain-English narrative ("customer ordered; restaurant accepted at t=41s; rider A and rider
B accepted within 12ms; both were assigned — INV-03 violated"). That narrative *is* the bug report, and it is
filed automatically as a work order (§4).

**Verifying the verifier — three mechanisms:**

1. **Sometimes-assertions** (Antithesis' idea, adopted wholesale). `sim.Sometimes("restaurant rejects after
   payment captured")`, `sim.Sometimes("two riders accept within 100ms")`, `sim.Sometimes("Redis flushed
   mid-checkout")`, `sim.Sometimes("rider disconnects between PICKED_UP and DELIVERED")`. If a sometimes-assertion
   never fires across the nightly sweep, **CI fails**: the harness is blind there. This is a coverage metric that
   measures *interesting states reached*, not lines executed — and it is the plan's primary anti-blind-spot device.
2. **The bug museum** (mutation testing with a real corpus). Every bug found in the existing HalalGoes system —
   all ~30 catalogued in the fleet reports — is encoded as a *mutant*: a patch that reintroduces it. `make museum`
   applies each mutant and asserts the sweep catches it within N seeds. A harness that stops catching the
   compensation-nesting bug has rotted. New bugs found in production join the museum permanently.
3. **Differential/model checks.** The assignment register is checked with `porcupine` for linearizability against
   a one-line sequential model. Pricing is checked differentially: pure-Go pricing vs. a SQL-side recomputation.
   The sim's geo model vs. real PostGIS, nightly, over random point sets.

---

## 4. Execution loop — the seed queue is the work queue

Asynchronous, and mostly self-feeding:

1. **Lead agent** writes a work order containing: the invariants in scope, the scenarios that must newly pass,
   the sometimes-assertions that must newly fire, and the file boundaries. Not prose about intent — an
   executable acceptance criterion.
2. **Implementer agent** works in an isolated worktree. Loop: write the invariant/scenario (red) → implement
   domain logic (green) → `hgsim sweep --seeds 2000` locally (~2 minutes, single process, no containers) →
   iterate. Agents do not need permission to run the simulator; it is fast and hermetic.
3. **The nightly fleet** (`hgsim sweep`, 16 workers, plus a weekly long sweep of ~10⁶ seeds) runs against `main`.
   Every distinct violation auto-files a work order with its shrunk seed already attached. **The bug backlog is
   generated by a machine, not written by humans.** This is the async engine: agents wake up to a queue of
   reproducible failures, each with a 40ms repro.
4. **PR gates** (all mechanical, no human in the loop): purity lint, `hgsim sweep --seeds 5000` clean, no
   sometimes-assertion regressed to unreachable, bug museum 100%, shakedown tier green (§7), `go test -race`,
   `go test -fuzz` corpus on all wire decoders (WS frames, webhook payloads) for 60s.
5. Only then does a small PR reach a human. PRs stack so the factory never blocks on review.

**Why this beats "more review agents" (Plan A §3):** an adversarial reviewer agent costs a model call per PR
and finds what it happens to think of. A seed sweep costs CPU cents, runs while everyone sleeps, and finds what
is actually there. Review-agent capacity scales linearly with PR count; simulation capacity scales with hardware.

---

## 5. Anti-hallucination

* **The oracle is not the agent.** A hallucinated implementation produces a violated invariant or an unreached
  sometimes-assertion. It cannot argue with a counterexample.
* **INV-11 kills dead code automatically.** The simulator logs every effect emitted and every state key read.
  Any key written but never read, any effect kind never emitted, any handler never entered across the full sweep
  is a CI failure. The single most characteristic defect of the old codebase — six orphaned Redis keys, four dead
  workflows, a dead Prisma model, cargo-cult channel joins — becomes mechanically impossible to merge.
* **Docs are generated from the model.** The status DAG diagram, the effect catalog, the invariant list, and the
  sequence diagrams are emitted by `hgsim docs` from the actual code. The old system's docs disagreed with the
  code on at least five material points (order starts `PLACED`, 2-minute restaurant timeout, Redis-based rider
  discovery). Generated docs cannot drift.
* **Purity lint** prevents the most common agent shortcut: reaching for `time.Now()` or a DB call inside the
  domain to make a test pass.

---

## 6. Human review model

The human reviews **three things, in descending order of importance**:

1. **Invariant diffs** — a one-line English change, e.g. *"+ INV-12: a rider's earnings ledger sums to the sum
   of their delivered orders' payouts."* This is where product judgment actually lives. Budget: minutes.
2. **UX flow diffs** — screen-flow state machine changes and design-system changes (§8), reviewed as pictures.
3. **Code PRs** — ≤ 300 changed lines, with an auto-generated **simulation receipt** at the top:

```
What: riders can no longer be offered an order while on an active delivery.
Why:  seed 0x8f31c2 assigned two orders to rider r_7 within 400ms (INV-03).
Proof: 5,000 seeds clean (was: 61 failures). Museum 31/31. New reachable state:
       "rider receives offer while busy" now fires in 4.1% of seeds and is rejected.
Risk:  changes the dispatch filter; riders in the pool drop ~8% in the sim's steady state.
```

The human is never asked to reason about interleavings, timeouts, or partition behavior — that is what the
receipt is asserting on their behalf. They are asked: *is this the behavior we want?* Plain English, async,
low bandwidth, roughly 150 words per PR.

---

## 7. Orchestration — a deterministic saga interpreter (~800 lines), not another engine

**Requirement that decides it:** orchestration must be a *pure function* so it runs identically inside the
simulator. Temporal, Restate, River, and DBOS Transact all own the scheduling, the timers, and the retries —
that is their value, and it is exactly what makes them opaque to a simulator. Adopting one would put the most
bug-dense part of the system (the checkout saga; every serious bug in the old platform lived there) outside the
verification boundary. So we write it.

```go
// Pure. Runs unchanged in sim and prod.
func (s *CheckoutSaga) Step(state State, in Event) (State, []Effect)
```

* **Durable state:** Postgres. `saga_instance(id, kind, state jsonb, version)`, `saga_inbox(id, saga_id, event,
  dedupe_key UNIQUE)`, `saga_outbox(id, saga_id, effect, status)`, `saga_timer(saga_id, fire_at, token)`.
  One transaction per step: read instance → append inbox row → compute `Step` → write new state (optimistic
  `version` CAS) → enqueue effects and timers. Exactly-once by construction via the inbox dedupe key.
* **Runner:** a goroutine per shard polling with `FOR UPDATE SKIP LOCKED`; effects dispatched by an interpreter;
  timers fired by a second poller. In simulation, the runner is replaced by the sim's event loop — same `Step`,
  same tables (in-memory model), virtual timers. Crash-restart is trivially testable: kill the runner at any
  tick; state is in Postgres.
* **Recovery is a first-class scenario, not a feature:** "kill the runner between effect-enqueued and
  effect-executed" is a scenario the sweep runs constantly. The old system's split-brain (DB assigned, workflow
  dead, no compensation on execution timeout) is structurally impossible here because there is no separate
  workflow lifetime to lose — the saga *is* the row.
* **Timers are explicit, not implicit.** Every wait has a declared timeout and a declared compensation, checked
  by INV-07. The old saga's "wait forever on `restaurantResponse` until a 15-minute execution timeout kills the
  process without running the catch block" cannot be expressed.
* Escape hatch: if the runner becomes a bottleneck at scale, swap the *runner* (River or DBOS Transact Go) while
  keeping `Step` pure. The verification boundary is preserved either way.

---

## 8. Deployment — two-tier verification: sim for logic, shakedown for wiring

The simulator is honest about being a model. So the compose stack is tested with **the same scenarios and the
same invariant checkers** — this is the trick that keeps the sim from being a comfortable fiction.

* `deploy/compose.yml` + Traefik: label-based routing, one service per container, **2 replicas each** for the
  stateless services, Traefik health checks and round-robin verified by a scenario that kills a replica
  mid-order. TLS terminated at Traefik; WS upgraded through it (the old system's plaintext WS on a hardcoded
  public IP is retired on day one).
* **Shakedown tier** (`make shakedown`, ~8 minutes, runs on every PR): real Postgres+PostGIS, real Redis, real
  Traefik, real containers. **Toxiproxy** between every service pair injects latency, bandwidth caps, and
  connection resets; **Pumba** kills and pauses containers on a seeded schedule. Scenario scripts from
  `model/scenarios/` drive real HTTP/WS traffic. The services emit their event log to a file; the **same
  `model/checkers/` code** that runs in the simulator validates that log. An invariant that holds in sim but
  fails in shakedown is the most valuable signal in the whole system — it means the model is wrong, and the model
  gets fixed.
* Nightly: a longer shakedown with clock skew (`libfaketime` on one container) and a Redis failover, since
  Redis-sentinel-provisioned-but-unused was a live latent failure in the old stack.
* Deploy is a compose pull + `up -d` with Traefik draining old containers; rollback is the previous image tag.
  No Kubernetes, no service mesh.

---

## 9. UI/UX overhaul — simulate the client too

The four surfaces (customer app, rider app, restaurant web, admin web) get a pre-planned UX, and the same
verification philosophy:

1. **Design phase, up front and human-reviewed:** user flows → wireframes → design system (tokens, primitives,
   states including empty/loading/error/offline). One package, `packages/ds`, built before any screen. This part
   looks like Plan A, and should — nobody simulates their way to good visual design.
2. **Screen-flow state machines.** Each app's navigation and screen state is a pure reducer:
   `reduce(uiState, serverEvent | userAction) -> uiState`. No business logic in components.
3. **Client replay harness — the distinctive part.** The simulator's produced event traces (including the ugly
   ones: out-of-order `order_update`, duplicate `CHANNEL_JOIN`, WS reconnect with replayed backlog, an
   `order_update` for an order the client never saw start) are replayed into the client reducers, asserting UI
   invariants: never display DELIVERED before PICKED_UP; never display a price the server did not send; a
   dismissed offer must send a decline (the 7-second silent dismissal bug); reconnection must converge to server
   state within one round trip. Rider and customer apps are where the old system's defensive
   quadruple-fallback payload parsing lived — that code exists because the contract was never verified.
4. **Visuals** are covered by Storybook + screenshot goldens, reviewed as images by the human. Simulation says
   nothing about whether a screen is beautiful.

---

## 10. Migration — trace replay, then strangler by bounded context

Not a big-bang rewrite, and not a naive incremental port. Three phases:

**Phase 1 — Record (week 1–2).** Ship a recorder alongside the existing NestJS system: a Traefik/proxy tap that
captures HTTP requests, WS frames, and Temporal signal events into a normalized trace format, with PII
redaction. Every real order becomes a replayable trace. This costs almost nothing and yields the most valuable
asset in the migration: **a corpus of real workloads to seed the simulator with.** Real traffic is a better
scenario generator than our imagination.

**Phase 2 — Shadow (continuous).** Replay recorded traces into the new Go core in simulation mode and diff
outcomes against what the old system actually did. Differences are triaged into: *new system is right* (old bug —
add to the museum), *new system is wrong* (work order), *intentional* (SDR). No user traffic is at risk. This is
how we discover the behaviors nobody documented, and there are many — the old docs disagree with the old code on
at least five material points.

**Phase 3 — Strangler cutover, bounded context at a time, behind Traefik path routing.** Data stays: the
Postgres+PostGIS database is fundamentally sound; we rewrite services and evolve the schema, we do not migrate
the data twice. Redis is rebuilt from scratch as a pure cache (INV-08 guarantees it can be flushed at will).
Order of cutover, riskiest last:

1. Read-only surfaces (catalog, restaurant/menu browse, admin lists) — no invariants at stake, immediate proof
   the deployment works with real traffic.
2. Identity + authorization — the old system has *none*; this is a strict improvement with no rollback subtlety.
3. Dispatch and realtime (rider offers, assignment, tracking fanout).
4. Checkout, pricing, payment — last, most invariants, longest shadow period.

Rollback at every step is a Traefik label change.

---

## 11. First three milestones (concrete)

**M1 — "The simulator, and one aggregate" (target ~2 weeks).** Ships nothing to users. Delivers: `hgsim`
skeleton (virtual clock, seeded RNG, message bus with reorder/drop/dup, actor crash/restart, adversarial Redis
model); the pure `domain/order` aggregate implementing only the status DAG and party membership; INV-02,
INV-07, INV-11 live; `rapid`-driven scenario generation with automatic shrinking; `hgsim sweep` in CI; the bug
museum seeded with 8 mutants from the old codebase; purity lint. **Acceptance:** injecting the real
"CONFIRMED→RIDER_ASSIGNED skips PREPARING" bug is caught within 200 seeds, shrunk to a 6-step trace, in under 60
seconds of wall clock.

**M2 — "Checkout saga, simulated and deployed" (target ~3 weeks).** The saga interpreter + Postgres runner;
pricing (server-authoritative, INV-01) and payment (INV-04) with a fake provider that double-charges on retry;
authorization ports (INV-09). Deployed on compose behind Traefik with 2 replicas; shakedown tier live with
Toxiproxy + Pumba running the same checkers. **Acceptance:** the old system's exact compensation-nesting bug
(saga proceeds on a rejected order when a compensation returns false) is a museum mutant that the sweep catches;
killing the saga runner mid-checkout at any of 200 seeded points always converges to refunded-or-completed;
first real endpoint serving real (staging) traffic.

**M3 — "Dispatch and realtime" (target ~3 weeks).** Geo dispatch (PostGIS in prod, deterministic geo model in
sim, differentially tested); the offer/accept protocol with linearizable assignment (INV-03, checked with
porcupine); WS fanout with membership authorization (INV-05); notification delivery with real dead-lettering
(INV-06); coordinated timeouts (INV-10); rider and customer client reducers replaying sim traces. **Acceptance:**
a complete order flows end-to-end through the composed stack while Pumba kills a service replica and Toxiproxy
partitions Redis, and every invariant holds.

After M3 the pattern is established and the remaining work (menus, search, ratings, payouts, admin) is largely
boring tier, which moves fast.

---

## 12. Honest self-critique — where this plan fails

**1. The fidelity gap is real and permanent.** The simulator's Postgres is not Postgres; its Redis is not Redis;
its geo model is not PostGIS; its network is not TCP. Bugs that live in the gap — an index that doesn't do what
we assumed, a `SELECT FOR UPDATE` interaction, actual Redis eviction semantics, a wrong Traefik label, a broken
TLS chain, an iOS app suspended in the background for 30 minutes — are invisible to the sim. The shakedown tier
mitigates this but is slower, coarser, and far less thorough. **A green sweep is not a green system**, and the
biggest risk of this plan is that people start believing it is.

**2. It front-loads cost badly.** M1 ships zero user value. If the project is cancelled in month two, Plan A has
a walking skeleton in production and Plan B has a test harness. The simulator is perhaps 4,000–6,000 lines of
infrastructure that no customer will ever see, and it must be maintained forever — a simulator that lags the
system it simulates is worse than none, because it lies with authority.

**3. Invariants only catch what someone thought to state.** This is the deepest limitation. The old system's
"rider earnings are never incremented" bug is invisible until someone writes INV-12. Sometimes-assertions
improve *coverage of states*, not *coverage of properties*. There is no mechanical procedure for discovering the
property you failed to imagine, and agents are exactly as likely as humans to fail to imagine it.

**4. Self-serving oracles.** An agent asked to make the sweep pass can weaken an invariant, narrow a scenario, or
write a tautological checker (`assert(state == state)`). The bug museum and the "no sometimes-assertion may
regress" gate are counter-measures, and invariant diffs are the one thing humans must review carefully — but this
is a live, ongoing attack surface, and it is the plan's analogue of Plan A's "diff coverage measures that tests
exist, not that they are good."

**5. Determinism in Go is "mostly."** Polar Signals needed WASM plus a forked runtime to get real determinism;
we are not doing that. Map iteration order, goroutine scheduling, GC, background timers in third-party libraries,
and `context` deadlines all leak. `testing/synctest` covers a lot (fake clock, durable-blocking detection) but
it is not a hypervisor. Expect a class of seeds that fail to reproduce, expect to spend real time hunting
determinism leaks, and expect the honest label to be "mostly deterministic simulation testing." Antithesis
exists precisely because doing this properly is hard; buying it is a legitimate alternative to consider at M3
if the leak-hunting tax gets ugly.

**6. Architectural tax on ordinary work.** Effects-as-data and pure cores are a genuine burden for CRUD. The
boring-tier exemption is essential but creates a boundary that will be argued about, and things will end up on
the wrong side of it. Some features will be slower to build than they would have been with a plain handler.

**7. It says nothing about whether we are building the right thing.** No invariant catches a bad checkout flow,
an ugly rider app, a delivery fee that is correct-but-uncompetitive, or a feature nobody wants. Simulation
verifies *internal consistency with stated properties*. Product judgment, UX quality, and business correctness
remain entirely human, entirely unverified, and — on a consumer food-delivery app — probably where the larger
risk actually lives.

**8. Compute and latency costs.** Sweeps are cheap per seed but the nightly fleet and the ~8-minute per-PR
shakedown are real money and real cycle time. If shakedown flakes, the whole gating structure loses credibility
fast, and a flaky gate is worse than no gate.

**9. The receipt can become a rubber stamp.** A human who trusts the simulation receipt reviews the code less
carefully than one who does not. If the harness has a blind spot, the plan has *reduced* the chance a human
catches it. That is a perverse and non-hypothetical failure mode.
