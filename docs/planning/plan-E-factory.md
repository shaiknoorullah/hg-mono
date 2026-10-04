# Plan E — The Agent Software Factory

**An org-shaped operating model for building `hg-mono`.**
Philosophy: *the bottleneck is coordination and accountability, not code.*

> Positioning vs the incumbent: **Plan A is artifact-centric** — it freezes a spec pyramid and gates on artifacts (protos, tests, coverage). **Plan E is role/process-centric** — it defines *who is accountable for what*, *what may cross a handoff*, and *how the line stops*. A can produce a beautiful frozen spec that nobody is accountable for keeping true. E can produce impeccable process around mediocre design. The two disagree most sharply on **freezing** (A freezes; E makes decisions cheap to revise but never anonymous) and on **where verification lives** (A: in CI gates per PR; E: in a standing adversary with memory, plus gates).

---

## 0. Thesis, in one paragraph

An agent that writes 50 files an hour is not the constraint. The constraint is that nobody can say, three weeks later, **who decided this, who checked it, and what evidence they had.** Every failure mode in the maturity audit — green CI asserting nothing, 8-of-18 MCP tools stubbed but shipped as "done", `AGENTS.md` describing a repo that no longer exists, a governance audit chain with one genesis line — is an *accountability* failure, not a capability failure. Somebody's agent produced it, nothing tested it, no named owner was on the hook, and the CI job exited 0. So: model the delivery system on a high-functioning software organization. Named long-lived roles with charters. Formal handoffs with entry/exit criteria. Nobody reviews their own work. A standing risk registry fed by pre-mortems. Any role — and the machinery itself — can stop the line. Measure escaped defects and rework, not output. **And bound the cost of all of it with a three-lane system so that ~60% of work sees almost no process at all.**

Delivery-first commitment, stated up front so it can be held against this plan: **process must pay rent every week.** Section 11 lists the kill criteria under which each ceremony gets deleted.

---

## 1. Planning system — how decisions get made, recorded, and changed

Plan A freezes a spec pyramid. Plan E does not freeze; it makes every decision **cheap to revise and impossible to make anonymously.** Three registers, three owners, all in `/ops/`:

| Register | Owner | What it holds | Change protocol |
|---|---|---|---|
| **Decision Register** (`/ops/decisions/ADR-*.md`) | Chief Architect | Structural/technology choices with alternatives + reversal cost | Supersede-by-new-ADR. Never edit in place. |
| **Invariant Register** (`/ops/invariants.yaml`) | Domain Modeler | Business rules that must never be false, each with a test ID | Change requires a DOM signature + QA countersignature + a migration note |
| **Risk Registry** (`/ops/risks.yaml`) | Process Steward | Live risks with owner, trigger signal, and mitigation *or* explicit acceptance | Grows from pre-mortems + every incident |

### 1.1 The Invariant Register is the highest-leverage artifact in the plan

Not prose. Executable claims:

```yaml
- id: INV-PRICE-01
  statement: Order total is computed server-side; client-supplied prices are never trusted.
  owner: DOM
  tests: [BST-014, BST-015]          # bestiary regression tests
  enforced_by: [test, arch-lint]      # arch-lint bans price fields on inbound DTOs
  origin: halal-goes production bug 2025-11
- id: INV-KYC-01
  statement: Rider KYC documents live only in a private bucket; no public URL is ever minted.
  owner: SEC
  tests: [BST-031]
  enforced_by: [test, secret-scan, arch-lint]
```

An invariant without a test ID is a **draft** and is auto-flagged weekly. This is the poka-yoke against "governance as prose" — the exact failure of the `.audit/decisions.jsonl` genesis-only chain in the audit.

### 1.2 Pre-mortems drive the plan, not the other way around

Before every milestone and before every Lane-3 work order, the Process Steward runs a **structured pre-mortem** (Klein; prospective hindsight reliably increases the number and quality of risks surfaced — roughly +30% in the classic result, more in some replications):

1. Prompt: *"It is 8 weeks from now. The `hg-mono` order flow shipped and it was a disaster. Write the post-mortem."*
2. **ARCH, DOM, QA, SEC, UX, REL each write independently and in isolation** — they do not see each other's answers first. This is non-negotiable: pooled brainstorming among agents built on the same base model converges instantly (sycophancy propagation in multi-agent systems is well documented; agents shift from correct to incorrect under peer pressure). Independent-then-share is the whole value.
3. PS merges, dedupes, and forces each survivor into the registry with **an owner and a trigger signal**. A risk with no owner is not a risk, it is a wish, and it gets deleted.
4. Each risk resolves to exactly one of: a **poka-yoke** (machine check), a **lane upgrade**, a **bestiary test**, or a written **accepted-risk** note signed by the human.

Output of a pre-mortem is not a document. It is a set of CI checks and lane assignments. That is the delivery-first test of whether the ceremony earned its tokens.

### 1.3 What the human decides

Only three classes reach a human at planning time: (a) irreversible or expensive-to-reverse decisions (data model of money, auth model, deployment topology), (b) anything that changes what users can do, (c) accepted risks. Everything else is an ADR that the human can read later or never.

---

## 2. The roles — charters and separation of duties

Nine roles. Six are long-lived (persistent identity, persistent memory file, persistent metric they own). Three are pooled/ephemeral.

| Role | Lifetime | Charter (one sentence) | **May not** |
|---|---|---|---|
| **ARCH** Chief Architect | long-lived | Owns decomposition, service boundaries, ADRs, cross-cutting ports. | Write production code. Approve their own ADR's implementation. |
| **DOM** Domain Modeler | long-lived | Owns ubiquitous language, entity state machines, the Invariant Register, the saga transition tables. | Write handlers, infra, or UI. |
| **UX** Designer | long-lived | Owns flows, design tokens, screen specs incl. the states matrix, a11y. | Approve backend work. Ship a screen spec without all 5 states. |
| **IMP** Implementer | ephemeral pool | The **only** role that writes production code. | Write or edit acceptance tests. Merge. Assign its own lane. |
| **QA** Adversarial QA | long-lived | Owns test strategy, the **bug bestiary**, acceptance tests, escaped-defect metric. Prompted to *refute*. | Write production code. See the implementer's rationale before reviewing. |
| **SEC** Security & Privacy | long-lived | Owns threat model, authz matrix, PII/KYC handling, secrets, dependency risk. Has **veto**. | Be overridden by anyone but the human. |
| **REL** Integrator / Release Mgr | long-lived | **Sole merge authority.** Owns trunk health, the compose stack, release trains, rollback runbooks. | Author the change it merges. |
| **DOC** Technical Writer | long-lived | Owns runbooks, generated API docs, ADR index, and the **doc-drift detector**. | Mark docs done without a drift check passing. |
| **PS** Process Steward | long-lived, *cheap* | Runs the board, WIP limits, metrics, pre-mortems, seeded-defect audits, escalation. | Touch any product artifact. Approve any PR. |

### 2.1 Separation-of-duties matrix (enforced, not advisory)

|  | Writes prod code | Writes acceptance tests | Approves | Merges | Veto |
|---|:--:|:--:|:--:|:--:|:--:|
| ARCH | ✗ | ✗ | design only | ✗ | on boundary violations |
| DOM | ✗ | ✗ | invariants only | ✗ | on invariant violations |
| UX | ✗ (design-system tokens only) | ✗ | client PRs | ✗ | ✗ |
| IMP | **✓** | ✗ | ✗ | ✗ | ✗ |
| QA | ✗ | **✓** | ✓ | ✗ | on failing acceptance |
| SEC | ✗ | ✗ | ✓ | ✗ | **✓ absolute** |
| REL | ✗ | ✗ | ✓ | **✓** | on trunk health |
| DOC | ✗ | ✗ | ✗ | ✗ | ✗ |
| PS | ✗ | ✗ | ✗ | ✗ | escalate only |

**Enforcement is mechanical, not cultural.** `CODEOWNERS` gives `/tests/acceptance/**` to QA and `/ops/invariants.yaml` to DOM; a CI check (`sod-gate`) reads the work-order handoff record and fails if the same role ID appears as both author and approver, or if a diff touches a path its role does not own. The four-eyes principle only works when the tooling refuses, not when the charter asks nicely.

### 2.2 Long-lived means it has a memory file

Each long-lived role owns `/ops/roles/<ROLE>/memory.md` — an append-mostly ledger of "what I have learned about this system." QA's is the most valuable: it accumulates the defect taxonomy. SEC's holds the standing threat model. This is what makes "adversarial QA" different from Plan A's per-PR critic: **an adversary with a career and a grudge list**, not a fresh sceptic each time who re-learns nothing.

---

## 3. Execution loop — the choreography

### 3.1 Three lanes (the anti-bureaucracy mechanism — read this before judging the process cost)

Lane is assigned **by machine rule from changed paths + labels**, never by judgement. Anyone may upgrade a lane for free; downgrading requires PS + the relevant veto-holder and is logged.

| Lane | Triggers (path/label rules) | Choreography | Target share |
|---|---|---|---|
| **L1 Express** | docs, tests-only, additive config, dependency bumps, UI copy, non-behavioral refactor | IMP → automated gates → REL auto-merge. **No QA, no human.** | ~55–65% of PRs |
| **L2 Standard** | ordinary features/services touching no hazardous path | DOR → IMP → **blind QA** → REL merge. Human gets a 5-line summary; auto-merges unless human objects in the trunk window. | ~30% |
| **L3 Hazardous** | money, auth/authz, PII/KYC, order state machine, DB migrations, public API contracts, anything matching a bestiary tag, Traefik/edge config | Pre-mortem note → DOR → IMP → blind QA → **SEC** → REL → **human approval required** | ≤10% |

If L3 exceeds ~15% of merged PRs for two consecutive weeks, the decomposition is wrong and PS escalates — because the process cost of this plan is dominated by L3.

### 3.2 The work order and its stations

Every unit of work is a file: `/ops/work/WO-####.md` with YAML front-matter. It moves through stations; each station has entry criteria (DoR) and exit criteria (DoD), and each transition appends a **handoff record** with the role ID, timestamp, evidence, and checks performed.

```
Shaping (ARCH/DOM/UX)  →  Ready  →  Build (IMP)  →  Verify (QA, blind)
   →  [Security (SEC) if L3]  →  Integrate (REL)  →  Released  →  Field Watch (QA, 7 days)
```

**Definition of Ready** (gate into Build; machine-checked where marked ✓):
1. ✓ One sentence of user-observable behavior ("a customer can see a restaurant's menu with prices").
2. ✓ Lane assigned by rule.
3. ✓ Named owner per station.
4. Contract delta stated: which proto/OpenAPI/DB objects change, or "none".
5. ✓ Referenced invariants listed by ID (`INV-*`) — at least one, or an explicit `none` with reason.
6. **Acceptance tests already written by QA and failing red** — not "acceptance criteria in prose". This is the single strongest DoR item and the one that stops hallucinated completion.
7. ✓ Diff budget declared and ≤ lane maximum (L1 150 / L2 400 / L3 250 lines).
8. Rollback stated in one line.

**Definition of Done** (gate out of Verify):
1. ✓ All QA acceptance tests green, and the **assertion count is non-zero and published**.
2. ✓ Stub-sniffer clean on all touched paths (no `not_yet_implemented`, `TODO`, `::notice::`-style no-op, empty handler, `panic("unimplemented")`).
3. ✓ Behavior verified against the **running composed stack**, not mocks — at least one assertion executed over HTTP through Traefik.
4. ✓ Every listed invariant has a passing test referencing its ID.
5. ✓ Doc-drift check green (routes, env vars, service list, ADR index all match reality).
6. ✓ Rollback verified or explicitly N/A.
7. Review record contains a `checks_performed` block with reproducible commands and their output — **prose-only approval is rejected by CI** (§4.1).
8. ✓ SoD gate green: author ≠ approver, no role touched a path it does not own.

### 3.3 Pull, not push — with an honest caveat

Stations pull from the ready queue; PS enforces WIP limits per station (default: 4 in Build, 3 in Verify, 1 in Integrate). The purpose is **not** agent focus (agents don't context-switch expensively) — it is **queue visibility and blast-radius control**: an unbounded Build queue means a bad architectural decision gets replicated into 30 PRs before Verify catches it once. WIP limits are the throttle between decision error and rework volume. See §11.6 for why this is also the weakest borrowed metaphor in the plan.

---

## 4. Verification, anti-hallucination, and the andon cord

Plan A's answer is "adversarial verifier + CI gates". Plan E keeps those and adds four mechanisms that specifically target the failure modes of *role-based agent orgs*.

### 4.1 Evidence-bound review (kills prose approval)

A review is a structured record, not an opinion:

```yaml
work_order: WO-0142
reviewer: QA
verdict: reject
checks_performed:
  - cmd: "go test ./internal/pricing -run TestServerAuthoritative -v"
    result: "FAIL: total accepted client-supplied unit_price"
    artifact: ci/logs/wo-0142-qa-1.txt
  - cmd: "curl -s -XPOST http://edge/api/v1/orders -d @fixtures/tampered.json | jq .total"
    result: "returned 4.00, expected 12.50"
findings:
  - severity: blocker
    invariant: INV-PRICE-01
    location: internal/pricing/quote.go:88
```

CI (`review-gate`) rejects any review with an empty `checks_performed`, or where a claimed command was never executed in the run log. **An approval that cost nothing is not an approval.** This is the most direct structural answer to agents rubber-stamping each other.

### 4.2 Blind review

QA receives: the contract, the acceptance tests, and the diff. QA does **not** receive: the implementer's rationale, commit messages explaining intent, or the implementer's identity. Anchoring on a confident author's explanation is the dominant sycophancy pathway in multi-agent review; withholding the narrative is free and effective. SEC reviews with the threat model and the diff only.

### 4.3 Seeded-defect audits (the rubber-stamp detector)

Periodically — target 1-in-12 work orders, randomized, unannounced — PS injects a **known defect** into the branch before Verify: a dropped authz check, an off-by-one in a price rounding, a silently swallowed error, a mock left where a real call belongs.

- If QA catches it → normal reject cycle, and the seed is logged as caught.
- If QA misses it → **reviewer escape**, recorded against QA's own metric, and PS opens a poka-yoke ticket to convert that defect class into a machine check.

This is the only mechanism in the plan that measures whether review is real. Without it, "adversarial QA" is a job title. Seed catalogue is versioned in `/ops/seeds/` and rotated; a caught-rate below 70% over 20 seeds is an automatic human escalation.

### 4.4 Poka-yoke: policy that can be a check, must be a check

Standing rule enforced by PS: **any process rule that survives two cycles as a human/agent attestation gets a ticket to convert into a machine check, or gets deleted.** This is the ratchet that stops the operating model becoming the drifted `AGENTS.md` from the audit. Current standing checks:

| Check | Kills |
|---|---|
| `stub-sniffer` | Stubs shipped as done (the 8-of-18 MCP tools problem) |
| `assertion-count` — every CI job emits an executed-assertion count; **a job asserting zero fails** | Green-but-hollow CI (the eight `::notice:: stub` verbs) |
| `doc-drift` — generated inventories of apps/routes/env/ADR links diffed against docs | `AGENTS.md` describing a different repo; dead ADR links |
| `sod-gate` | Author approving own work |
| `review-gate` | Prose-only approval |
| `lane-gate` | Hazardous change sneaking through Express |
| `invariant-coverage` | Invariants with no test |
| `diff-budget` | PRs too big for a human to review in 5 minutes |
| `states-matrix` | UI shipped happy-path-only (§7) |
| `license-consistency` | The MIT-vs-Apache-2.0 class of contradiction |

### 4.5 The bug bestiary

Every defect found in HalalGoes production **and** every defect that escapes a station becomes a named, permanent regression test (`BST-###`) with an owner and a tag. Tags feed lane assignment: touching code tagged `BST:pricing` auto-upgrades to L3. The bestiary is QA's memory made executable, and it is the mechanism by which the system gets *harder to break over time* rather than merely *bigger*.

### 4.6 The andon cord — stop the line

**Who may pull:** any role, the human, or the machinery itself.

**Mechanism:** a pull writes `/ops/andon/OPEN-<id>.yaml` declaring `zone` (path globs), `observation`, `evidence`, `blast_radius`, `containment`. A CI job `andon-gate` then **fails every PR touching that zone**, including in-flight ones. Merges outside the zone continue — this is a line stop, not a factory stop.

**Required to open:** evidence artifact. No evidence, no cord. **Required to clear:** the pulling role plus REL, with a root cause and *either* a new machine check *or* a bestiary test. A cord cleared without one of those is reopened automatically.

**Automated pulls (jidoka — the machine detects the abnormality and halts itself):**
- A saga instance stuck beyond its SLA in the running stack.
- Trunk e2e smoke pack red twice consecutively.
- Assertion count for any job drops >20% week-over-week (someone deleted tests).
- Seeded-defect caught-rate below threshold.
- Escaped-defect found in Field Watch on an L3 work order.

I trust the automated pulls considerably more than the agent-initiated ones (§11.5).

**Escalation:** any cord open >24h auto-escalates to the human with a one-paragraph summary. Cords are metered: pull count, mean-time-to-clear, and false-pull rate per role are on the weekly one-pager.

---

## 5. Human review model — small, plain, async, rare

The human is not a reviewer of record for most work. The human is the **escalation path, the accepted-risk signer, and the metrics owner.**

### 5.1 What reaches a human

1. **L3 PRs** — money, auth, PII/KYC, order state machine, migrations, public contracts, edge config.
2. **ADRs above a reversal-cost threshold** (roughly: >1 week to undo, or user-visible).
3. **Andon cords open >24h.**
4. **Role deadlocks** — two roles disagree and no machine check can settle it. PS presents both positions in ≤10 lines with a recommended default.
5. **The weekly one-pager** (§9.5).

### 5.2 What never reaches a human

Style, naming, test structure, refactors passing gates, dependency bumps, L1 anything, any disagreement a machine check can settle, "should we use X or Y library" below the ADR threshold, and — critically — **anything that has already been escalated once in the same class.** A human decision on a class becomes a rule (§5.4).

### 5.3 PR format — a fixed 5-line contract

```
WO-0142 · L3 · pricing: server-authoritative order totals

WHAT     Order totals are now computed from the DB menu price; client prices ignored.
WHY      INV-PRICE-01. Legacy accepted client-supplied unit_price (bestiary BST-014).
BREAKS   Clients sending unit_price get 400 instead of silent acceptance. 2 call sites updated.
CHECKED  12 acceptance assertions green vs live stack; tampered-payload curl returns 400; SEC signed.
ROLLBACK Revert commit; no migration.

QUESTION (default = YES, silence merges in 24h):
  Should tampered payloads return 400, or 200 with corrected total? Default: 400.
```

Rules: ≤400 changed lines (L3 ≤250). Exactly one question, maximum, with a **pre-selected default so that silence is a decision.** Screenshots mandatory for any client surface. Everything else lives in the work order for anyone who wants it; the human never has to open it.

### 5.4 The load-reduction loop (the reason this stays sustainable)

**Every human REJECT automatically creates two things: a bestiary test and a poka-yoke ticket.** The commitment is that the same *class* of problem never reaches the human twice. Human touches per merged PR is a tracked metric with a downward target; if it is not falling month over month, the factory is not learning and PS must say so on the one-pager.

The human also holds an andon cord, and a standing right to say "this ceremony is not worth it" about any process artifact — which is enforceable because §11 pre-commits the kill criteria.

---

## 6. Orchestration — replacing Temporal, Go-natively

The legacy system runs Temporal (`hg-api/temporal/*`, TS workflows). For `hg-mono` we do **not** adopt another heavy engine.

**Choice: transactional outbox + explicit saga state machines in Postgres + [River](https://riverqueue.com) (Go-native, Postgres-backed job queue) for retries, timers, and async steps — all behind an internal `Orchestrator` port.**

Rationale: zero new infrastructure beyond the Postgres we already need; pure Go with compile-time type safety; jobs and saga state are **queryable in SQL**, which matters enormously for agents (an agent can `SELECT * FROM saga_instances WHERE state='stuck'` — it cannot introspect a proprietary event history nearly as easily); trivially unit-testable; and no separate cluster to run in docker-compose. If we later need cross-service durable RPC or long-lived human-in-the-loop workflows, **Restate** (single binary, Go SDK) swaps in behind the port — that is an ADR we defer, not a bet we make now.

### 6.1 The role-centric twist (this is what differentiates E on this dimension)

The saga is a **domain artifact owned by DOM, not an implementation detail owned by IMP.**

- Each saga lives as a declarative transition table in `/ops/domain/sagas/order.yaml`: states, allowed transitions, guards, compensations, timeouts, and the invariant IDs each transition must preserve.
- Go code (state enum, transition switch, guard interfaces, exhaustiveness test) is **generated** from that table. IMP fills in step bodies; IMP cannot add a state or an edge.
- A **saga conformance test** is generated too: every declared transition must be exercised, every compensation must be exercised, and unreachable states fail the build. This is what stops the classic agent failure of implementing the happy path and stubbing the compensations.
- Adding a transition = a DOM-signed change = automatic L3 = human sees a rendered state diagram in the PR.
- Any instance stuck beyond its declared timeout **pulls the andon cord automatically** and appears on REL's board with the per-saga runbook DOC wrote.

Order saga (first target): `created → priced → paid → accepted → assigned → picked_up → delivered`, with compensations for `payment_failed`, `restaurant_rejected`, `no_rider_within_SLA`, `customer_cancelled_pre_accept`. Every one of those compensation paths is a required conformance test before the saga can merge.

---

## 7. Deployment — docker-compose + Traefik, proven continuously

REL owns this end to end; it is the one area where a single role has both design and operational authority (deliberate: split ownership of deployment is how "works on my machine" is born).

- **Traefik v3** as edge; routing, TLS, and load balancing via container labels. One compose file plus overrides: `compose.yaml` + `compose.dev.yaml` / `compose.e2e.yaml` / `compose.prod.yaml`.
- **Load balancing is proven, not assumed**: stateless services run `deploy.replicas: 2+` in the e2e profile, Traefik round-robins, and the smoke pack includes an assertion that N distinct instance IDs served N requests, plus a kill-one-replica test that must show zero failed requests. Docker healthchecks gate whether Traefik routes at all. Sticky sessions only where genuinely needed (rider location WebSocket).
- **The smoke pack** (`S-01`…`S-20`) is a numbered, named list of assertions run against the composed stack on every L2/L3 merge and nightly. Each publishes its executed-assertion count. A smoke job that runs but asserts nothing **fails** — this rule exists specifically because the audited template had eight e2e verbs that echoed a notice and exited 0 while three workflows reported green.
- **Migrations** are L3 by rule and require a restore drill: the PR must show a backup taken, migration applied, rollback applied, and data intact, all inside the CI stack.
- **Cutover mechanism**: Traefik weighted services let REL shift a route from legacy to new at 1% → 10% → 100% with a documented rollback that is a one-line weight change. This is how §8 actually lands.

---

## 8. UI/UX overhaul — a designer in the pipeline, not a design doc

Four surfaces (customer, rider, restaurant/merchant, admin) currently spread across seven apps in the legacy repo with a shared `packages/ui`. The overhaul runs through UX as a **gating station**, and UX's approvals are evidence-bound like everyone else's.

**Order of work (deliberately design-system-first, like Plan A — this is a place where converging is correct):**
1. **Flows** — UX writes the flow spec per surface: entry points, decision points, failure paths, offline behavior.
2. **Design system package** — tokens (color, spacing, type, radius, motion) + primitives. A lint rule bans raw hex/px/`#RRGGBB` outside the tokens package. Poka-yoke against the four-regional-configs divergence the legacy system grew.
3. **Screen specs** with the **states matrix** — every screen must specify: `empty`, `loading`, `error`, `offline`, `success`, plus RTL where applicable (real requirement for this product's audience).
4. **Implementation** by IMP against the spec.

**UX's exit criteria are machine-checkable:**
- `states-matrix` CI check counts state fixtures per screen component; fewer than the declared states = fail. This directly attacks the strongest, most reliable agent blind spot: agents build the happy path and mean it sincerely.
- Playwright screenshots against the **running** stack, attached to the PR — UX signs off on pixels that exist, not mockups.
- `axe` a11y run with zero criticals; contrast checked in both themes.
- A designer-owned "component inventory" that DOC's drift checker compares against actual imports, so the design system cannot quietly fork.

UX has approval authority on client PRs and no authority on backend PRs — a narrow charter is what makes the role's approval mean something.

---

## 9. Migration from the existing HalalGoes system

Observed legacy shape: `hg-api` (NestJS/TS, Prisma, Redis + Redis Streams, Temporal, MinIO; services for carts, checkout, feed, orders, payments, pricing, ratings, restaurants, riders, users, admin), `halal-goes` (Turborepo: apps `users`, `rider`, `restaurant`, `restaurant-web`, `admin-web`, `web`, `docs`; packages `ui`, `auth`), `hg-docker` (separate compose). Exported API collections exist (`API v1.0.10.json`, `API v1.2.23.json`, `API v1.2.25.json`) — these are gold and become the migration's source of truth.

**Strangler fig, run as an org process:**

1. **Parity Ledger (DOM owns).** Machine-derive every endpoint from the exported API collections into `/ops/migration/parity.yaml`, each with status `not-started | shadowed | cutover | retired | wont-port`. This is the migration's burndown and it cannot be fudged, because status transitions are gated on evidence.
2. **Do-Not-Port Register (ARCH owns).** Explicit list of legacy behaviors we are intentionally dropping, with reasons. Without this, agents faithfully reimplement dead features they found in the code — and nobody can tell later whether an omission was a decision or a bug.
3. **Bestiary-before-rewrite (QA owns).** Before any bounded context is extracted, its known production bugs become `BST-*` tests running against the **new** service: server-authoritative pricing, auth-required-everywhere, private KYC buckets, idempotent payment capture, no negative quantities. The rewrite must fail those tests first.
4. **Shadow-traffic differential testing (QA owns).** The strongest anti-hallucination weapon available for a migration: replay recorded legacy requests against the new service and diff responses field-by-field, with an allowlist of intended differences. A context is not `shadowed → cutover` until its diff rate is zero-or-explained over a real traffic sample. Agents cannot argue with a diff.
5. **Data (REL + DOM).** Per bounded context: dual-write via the outbox → backfill → read-switch → retire. Never big-bang. Each step is its own L3 PR with a restore drill.
6. **Extraction order by risk, lowest first** — restaurants/feed (read-mostly) → menu/catalog → carts → ratings → riders → orders → payments last. Payments moves only after the saga engine has run real traffic in shadow for two weeks.
7. **Edge (REL).** Traefik fronts both systems from day one, per-route weighted. Rollback is a weight change, not a redeploy. This is what makes the whole migration reversible and therefore safe to run fast.

---

## 10. Milestones — the first three deliverables

### M0 — "The factory is real" (target: 5–7 days)
**Deliverable:** `hg-mono` repo with the operating model *executable*, proven by shipping something through it.
- `/ops/` skeleton: role charters + memory files, work-order template, DoR/DoD, lane rules, risk registry seeded by the first pre-mortem, empty bestiary.
- CI checks live and failing-when-they-should: `sod-gate`, `review-gate`, `lane-gate`, `stub-sniffer`, `assertion-count`, `doc-drift`, `diff-budget`, `license-consistency`.
- Andon mechanism working: a test cord blocks a test PR and clearing it requires a check or a bestiary test.
- Seeded-defect harness + first 5 seeds.
- Metrics collector + the first weekly one-pager generated.

**Acceptance (this is the point — M0 is not a docs milestone):** one throwaway work order — a Go service exposing `/healthz` behind Traefik in compose — travels the full choreography through all nine roles, gets **deliberately failed once by a seeded defect that QA must catch**, then merges. Human reviews exactly one 5-line PR summary. If the seed is not caught, M0 is not done.

### M1 — "Menu path live, shadowing legacy" (target: ~2 weeks)
**Deliverable:** the first real user-visible slice, plus proof that the migration mechanism works.
- Go `catalog` service (restaurants + menus, read path), Postgres, behind Traefik in compose.
- 2 replicas with round-robin proven by a smoke assertion + a kill-one-replica zero-error test (`S-01`…`S-08`).
- Design system package v0 (tokens + 10 primitives), customer app menu screen rebuilt on it with all 5 states + RTL, Playwright screenshots in the PR.
- Shadow differential tests green over ≥20 legacy endpoints; parity ledger shows those endpoints `shadowed`.
- Traefik weighted cutover exercised at 10% and rolled back once, deliberately, to prove the rollback.
- Bestiary seeded with ≥8 legacy bugs, all red-then-green.

### M2 — "Order placement and payment, end to end" (target: ~3 weeks)
**Deliverable:** the hard, hazardous core, done in Lane 3 throughout.
- Saga engine: outbox + River + generated transition machine from `order.yaml`; conformance tests cover **every** transition and **every** compensation.
- Order flow live in the composed stack: place → price (server-authoritative) → pay → restaurant accept → rider assign → deliver, with compensations tested for payment failure, restaurant rejection, rider-assignment timeout, and pre-accept cancellation.
- SEC threat model on payments + authz matrix signed; PII/KYC invariants enforced by test and by secret-scan.
- Stuck-saga auto-andon demonstrated by deliberately wedging an instance in CI.
- Rider assignment behind a port with a naive implementation — explicitly deferred, explicitly registered as a risk, explicitly not stubbed-and-called-done.
- Human touches for the milestone: target ≤12 PR summaries + 2 ADRs + 1 accepted-risk signature.

---

## 11. Honest self-critique — where this philosophy fails

I would rather name these than have them found later.

**11.1 The token bill is the real objection.** Nine roles, handoff records, evidence blocks, blind re-reads of context, pre-mortems with six independent writers. Multi-agent systems already run roughly an order of magnitude more tokens than single-agent work; this adds coordination on top. My honest estimate is **3–8× the tokens per merged line** versus one competent implementer with good CI, and the pre-mortem/one-pager overhead is fixed cost regardless of throughput. The lane system is the mitigation and it is genuinely load-bearing — but if lane rules are mis-tuned and L3 creeps to 30% of work, this plan is strictly worse than Plan A on both cost and speed. **The whole plan's economics rest on one tunable parameter, which is uncomfortable.**

**11.2 Rubber-stamping is the existential risk and I have only partially solved it.** Seeded-defect audits measure the *detectable and seeded* class of misses. They do not measure correlated blind spots — and since ARCH, QA, SEC, and IMP are all the same base model wearing different prompts, their blind spots *are* correlated, structurally. A defect none of them would ever conceive of passes nine reviews as easily as one. Model diversity for adversarial roles helps and costs money; it is on the risk registry, not solved. Additionally, agents may learn the seed distribution over time, degrading the metric exactly as it becomes trusted.

**11.3 Role identity is a fiction with no teeth.** "Named owner" works in human orgs because names attach to careers, reputations, and consequences. An agent's charter is a prompt; its "memory" is a file I could delete. Accountability without consequence is bookkeeping, and I should not pretend otherwise. The parts of this plan that actually bind are the *mechanical* ones — `CODEOWNERS`, `sod-gate`, `review-gate`, the automated andon triggers. The parts that depend on a role "taking ownership" are decoration, and a fair reading of this plan is that it is a good CI design wearing an org costume.

**11.4 The operating model will drift exactly like the docs in the maturity audit.** Charters, DoR/DoD checklists, and registries are documents, and documents rot — that audit found an `AGENTS.md` describing 2 apps when 11 existed. My `doc-drift` checker guards *product* docs. **Nothing guards `/ops/` itself.** PS owns the process, computes the metrics that judge the process, and reports on itself — a separation-of-duties violation sitting at the center of a plan whose thesis is separation of duties. The only real fix is periodic human audit, which is the scarce resource I claimed to be conserving.

**11.5 The agent-pulled andon cord will probably go unused.** Models trained to be helpful do not readily halt a production line over a hunch; the realistic failure is under-pulling, not abuse. I expect ~90% of value to come from the *automated* triggers (stuck saga, hollow CI, assertion-count drop) and near-zero from an agent deciding on its own that something smells wrong. If that proves true, the "any role may stop the line" framing is aspirational and should be cut down to "the machinery stops the line, and roles file blockers."

**11.6 WIP limits are an imported constraint that may not apply.** Lean's WIP limits exist because humans context-switch expensively and inventory ages. Agents parallelize nearly free. I justified them via blast-radius control (§3.3) and I believe that argument, but it is a rationalization of a borrowed practice, and capping Build at 4 when 40 could run in parallel may cost far more in wall-clock delivery than it saves in rework. This is the practice I would delete first.

**11.7 Metrics will be gamed, and DORA-style metrics are already degrading.** Rework rate is defeated by waiting 15 days. Escaped-defect rate is defeated by reclassifying defects as enhancements. Diff budgets are defeated by splitting one change across four PRs. And the industry signal is unkind: DORA's 2025 work found PRs merged per person up ~98% while incidents per PR rose ~243% — throughput metrics look elite precisely while quality rots. A dashboard that says "elite" here would prove very little.

**11.8 Cold start is a real cost against a real alternative.** M0 spends a week building the factory before one user-visible feature exists. Plan A's walking skeleton ships something real sooner. If the project is descoped or cancelled at week 3, the M0 investment is a total write-off. My defense is that M0's acceptance test is a shipped service through Traefik, not a document — but it is still a week of overhead purchased on the belief that the project runs for months.

**11.9 "Silence merges in 24h" erodes exactly when it matters.** If the human is genuinely away for a week, L3 work either stalls or the pressure to downgrade lanes becomes irresistible — and lane downgrade is precisely how control erosion happens in real organizations. I have logged downgrades and required two signatures, which slows the erosion without stopping it.

**11.10 This plan is weakest where Plan A is strongest.** A's frozen contracts give a single, checkable source of truth for *what the system is*. E gives a strong account of *how work moves* and a comparatively thin account of *what is being built* — my Invariant Register is smaller and less complete than a full spec pyramid. A hybrid (A's contracts as the artifact spine, E's roles and andon as the process spine) would likely beat either, and I would rather say so than defend a monoculture.

### 11.11 Kill criteria — pre-committed, so process cannot become ceremony

Reviewed on the weekly one-pager; PS must report against each:

| Practice | Delete it if… |
|---|---|
| Pre-mortems | Two consecutive pre-mortems produce no new machine check and no lane change |
| WIP limits | Median queue-wait exceeds median build-time for 2 weeks with no rework reduction |
| Seeded defects | Caught-rate stays >95% for 30 seeds (review is real; stop paying for the audit) — or drops below 50% (review is theatre; the whole plan needs rethinking, escalate) |
| Any role | It produces no reject, no finding, and no artifact change for 3 weeks |
| Blind review | Reject rate is indistinguishable from non-blind over 40 work orders |
| The weekly one-pager | The human stops reading it |
| Lane 3 process | L3 escaped-defect rate is no better than L2's |

---

## 12. Summary of the five mechanisms that carry this plan

If everything else were stripped away, these are what I would keep:

1. **Machine-enforced separation of duties** (`CODEOWNERS` + `sod-gate`): the author of a change can never be its approver, and no role can write outside its charter's paths.
2. **Evidence-bound review** (`review-gate`): an approval without reproducible commands and their outputs is not an approval.
3. **Seeded-defect audits**: the only instrument in the plan that measures whether review is real rather than performed.
4. **The andon cord with automated triggers**: the system halts itself on stuck sagas, hollow CI, and disappearing assertions — no agent judgement required.
5. **The human-reject learning loop**: every human rejection becomes a bestiary test plus a poka-yoke ticket, so human review load falls monotonically instead of growing with the codebase.

---

### Sources consulted

- [MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework](https://arxiv.org/html/2308.00352v6) — SOP-encoded role pipelines (PM/Architect/Engineer/QA), structured outputs as the handoff medium
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — orchestrator-worker pattern, ~15× token cost, delegation prompt lessons
- [When to use multi-agent systems (and when not to)](https://claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them)
- [Too Polite to Disagree: Sycophancy Propagation in Multi-Agent Systems](https://arxiv.org/html/2604.02668) and [The Cost of Consensus: Isolated Self-Correction Prevails Over Unguided Homogeneous Multi-Agent Debate](https://arxiv.org/pdf/2605.00914) — why independent-then-share, blind review, and adversarial framing are necessary
- [CONSENSAGENT: sycophancy mitigation in multi-agent LLM interactions](https://aclanthology.org/2025.findings-acl.1141/)
- [The Pre-Mortem Technique (Gary Klein / prospective hindsight)](https://get-alfred.ai/blog/pre-mortem-technique) and [premortem method notes](https://corporate.jasoncollins.blog/premortem)
- [Jidoka: built-in quality, andon, stop-the-line](https://www.learnleansigma.com/lean-manufacturing/what-is-jidoka-the-lean-approach/) and [Jidoka vs. Poka-Yoke](https://pananth.substack.com/p/jidoka-vs-poka-yoke-a-lean-comparison)
- [DORA metrics in the AI era — throughput up, incidents per PR up](https://larridin.com/developer-productivity-hub/why-dora-metrics-break-ai-era) and [DORA Metrics Explained (2026)](https://larridin.com/developer-productivity-hub/dora-metrics-explained-complete-guide-2026) — rework rate as a fifth metric, change-failure-rate as the AI canary
- [Definition of Ready vs Definition of Done as entry/exit quality gates](https://resources.scrumalliance.org/Article/definition-vs-ready) and [minimal quality gates / DoR antipatterns](https://qeunit.com/blog/the-definition-of-ready-in-quality-engineering/)
- [Four-eyes principle / separation of duties in software delivery](https://www.flagsmith.com/blog/what-is-the-four-eyes-principle), [maker-checker](https://en.wikipedia.org/wiki/Maker-checker), [SOX for software delivery](https://www.harness.io/harness-devops-academy/sox-compliance-for-software-delivery-explained)
- [Temporal alternatives for durable execution](https://www.zenml.io/blog/temporal-alternatives) and [Restate vs Temporal](https://restate.dev/vs/temporal)
- [Traefik + Docker Compose load balancing with replicas](https://community.traefik.io/t/optimizing-docker-compose-load-balancing-with-traefik-scenario-and-configuration/22273)
