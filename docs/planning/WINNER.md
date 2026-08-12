# WINNER — Plan G: "Front Door Factory"

**Strangler spine (C) + mechanical falsifiers (F/E) + one bug corpus + one closure ledger. Everything else is cut.**

---

## 1. Thesis, spine, and what each plan contributed

**Thesis.** The scarce resources are (a) time-to-real-user and (b) human judgment, in that order. So the plan that owns production routing on day 4 (Plan C) is the spine — it is the only plan where every increment is live, measured, and reversible with a file write, and the only one whose cancellation story is good at every week. But C is a superb *migration* verifier and a mediocre *correctness* system (Correctness judge: 5 of 10 defects, and its diff oracle actively canonizes legacy bugs). So we bolt onto C's spine the cheapest, highest-catch-power **mechanical** gates from the other five plans — the ones that are model-independent, cost tens of lines, and caught defects the diff oracle structurally cannot: config-reality probes, the deadline-mandatory stepper, server-authoritative money enforcement, the bug corpus, assertion-count/stub-sniffer, and the Empty/Slow/Broken screen gate. We take **process shape** from E (lanes, evidence-bound review, seeded audits, the reject ratchet) while deleting its org costume, and **honesty discipline** from F (falsifiers on decisions, refutation evidence schema) while deleting its prose-lint apparatus. B's simulator and D's generator suite are discarded whole; their *ideas* (invariant catalog, timers-explicit saga, server-authoritative annotation, generated clients) survive in boring form.

**Spine: Plan C** — front door on day 4, per-endpoint 8-step ladder, Promotion Cards, contracted-routes burndown, identity brokering, expand/contract DB. Why: it is the only plan the Delivery judge scored 8/10 under the user's own constraints ("delivery first", "avoid huge design decisions", degrades gracefully), and its weaknesses are exactly the ones the other plans' salvageable mechanisms patch cheaply. B's weaknesses (disproportionate machinery, lies-with-authority under pressure) and D's (front-loaded irreversible metamodel) are structural and unpatchable within the user's constraints.

**Contributions:**
- **A** → walking skeleton + golden-path service template for the ~40% new scope; just-in-time milestone specs; PR stacking.
- **B** → the invariant catalog (INV-01…11, one English line + executable checker) — enforced by ordinary integration tests against the composed stack, *not* a simulator; the "every write has a reader" idea, inverted into the Closure Ledger (§5.3).
- **C** → the entire spine: Fig, ladder, cards, burndown, auth delegation, expand/contract, auto-rollback guards.
- **D** → generated typed clients from the already-working buf pipeline; DTCG tokens → Style Dictionary → four surfaces; the server-authoritative-money *idea*, implemented as middleware + lint instead of a metamodel; escape-hatches-with-CI-failing-expiry as a pattern.
- **E** → three-lane path-rule triage; stub-sniffer + assertion-count; evidence-bound review; seeded-defect audits; the human-reject ratchet; pay-rent kill criteria for every ceremony.
- **F** → the ~400-line Postgres stepper with `deadline_at NOT NULL`; config-reality probes (`/debug/deps` + localhost lint + fail-loud env); seeded counterexamples red-first; Empty/Slow/Broken screen triad; normative-claim citation (light form); falsifier fields on major decisions; 5% audit sampling of auto-merges.

Where two mechanisms overlapped, one was picked; §8 lists every cut and why.

---

## 2. The ten dimensions

### 2.1 Planning system
No frozen spec pyramid. Three living, machine-checkable artifacts:
1. **`observed/` corpus outputs** (C): nightly-regenerated `openapi.yaml`, traffic profile, `unknowns.md`. Never hand-edited; the citation source for the ~60% legacy surface.
2. **`INVARIANTS.md`** (B's format, E's enforcement): numbered one-line English invariants, each bound to a test ID, enforced by integration tests against the composed stack. Weakening one requires human sign-off — the one planning act a human must think hard about.
3. **Milestone-N specs, just-in-time** (A): the current milestone's contexts specified in full (protos + flows); milestone N+1 stays a sketch. For the ~40% new scope (refunds, disputes, onboarding, UI overhaul) this is the only spec; it ships behind flags to internal users until it earns real traffic (C §3.4's rule, kept).

Major decisions are ADRs with **mandatory falsifier + review-trigger fields** (F's DEC format): "we are wrong if X; check at milestone Y; escape hatch Z." `ledgerlint` rejects an accepted decision without one. No confidence scores, no Brier ledger — just the falsifier.

### 2.2 Execution loop
Three agent stages, pipeline not queue (C's shape, E's lanes):
- **Observer** (continuous): emits Strangle Orders from the corpus for legacy surface; emits work orders from milestone specs for new surface. Output is data.
- **Implementer** (pooled, parallel, isolated worktrees): red-green-refactor. For legacy endpoints, acceptance = corpus replay (sampled fresh after branch cut, so it can't be overfit). For new surface, acceptance = the Bug-Ledger tests + invariant tests + generated-client conformance. PRs stack; the factory never blocks on review.
- **Triage/Promoter** (C): classifies live shadow diffs; proposes weight increases; executes auto-rollback. Never writes application code. Normalizers obey the 20-example rule and a ratchet: budgets only tighten, every normalizer human-reviewed with an example diff.

Lane assignment is **by path rule** (E §3.1): L1 express (~60%, auto-merge on green, no human), L2 standard (~30%, gates + blind card in digest, silence merges in 24h), L3 hazardous (money, auth/authz, PII/KYC, order state machine, migrations, Traefik/edge, anything touching a Bug-Ledger tag) — full gate stack + explicit human YES.

### 2.3 Verification / anti-hallucination
Two oracles the implementer does not control: **production traffic** (for the legacy 60%) and **generated contracts + the Bug Ledger + invariant tests against the live composed stack** (for the new 40%). The full ordered gate stack is §3. The principle, from the Correctness judge: any gate that reduces to "an agent writes tests and CI runs them" gets zero credit — so every load-bearing gate here is either exogenous (production diff), structural (schema makes the bug unrepresentable), or authored by a different party than the implementer (Bug Ledger, generated clients, closure matrix).

### 2.4 Human review model
§4 in full. Summary: two card types, one question each, pre-selected default, silence-is-a-decision, ≤10 minutes/day typical, load shrinks structurally via contracted endpoints + the reject ratchet, and the *reviewer themselves* is maintained and audited (§5.2).

### 2.5 Orchestration (Temporal replacement)
**The Stepper** — F's ~400-line in-repo Postgres saga package, verbatim schema: `saga_runs` + `saga_steps` with `deadline_at NOT NULL` (every wait must time out — the legacy `await condition()` forever-bug is unrepresentable), `idempotency_key` per step (retries safe by construction), `compensate_with` declared per step, workers on `FOR UPDATE SKIP LOCKED`, transactional outbox in the same tx as every state change. State of any order is one SQL query. Zero new infrastructure.

**Migration property taken from C's reconciler:** the stepper runs for weeks as a **read-only shadow** — it computes the transition it *would* make and diffs against what Temporal actually did, daily report. When divergence ≈ 0, it becomes the actuator for **new orders only**; in-flight Temporal workflows drain naturally; Temporal is deleted when its last workflow completes. No running order is ever migrated.

Pre-named escape hatches (F DEC-014, never built speculatively): River for the claiming layer if kill-tests show lost/duplicated step execution unfixable in a day; DBOS Transact-Go if long human-in-the-loop workflows genuinely appear. Cut: A's `Orchestrator` port (an interface with one 400-line implementation costs comprehension and buys nothing), C's separate reconciler engine, D's generated saga engine, Restate.

### 2.6 Deployment
One `docker-compose.yml` + Traefik v3 from day one, in front of production (C §6): TLS at Traefik, weights via the dynamic file provider (`hgctl` rewrites it; rollback is a file write), labels for simple routers, 2+ replicas per stateless service with health checks. The Fig owns shadow/diff/identity-injection (Traefik mirroring can't diff); Traefik owns weights/TLS/LB. `compose-e2e` CI job stands up the full stack with a corpus-backed legacy stub and runs smoke through Traefik's public port — including a kill-one-replica zero-failed-requests assertion and an N-requests-hit-≥2-instances assertion (E's S-pack). Week-one infra fixes from the hg-docker audit (redis mount path, missing AOF volume, PgBouncer bypass, unpinned images) ship as L1 PRs. Standing deployment claims DEP-1..6 (F §6) each have an automated falsification test; DEP-6 (no service boots with a missing required env var — fail loud) is mandatory in the service template.

### 2.7 UI/UX overhaul
Design big, ship thin (C §7 + A + E/F gates):
1. **Up-front, one human review:** flows for all four surfaces + screen inventory + the divergence list ("these N screens change behavior, not just looks").
2. **`@hg/ui` design system first**: DTCG tokens (Figma-exported) → Style Dictionary → NativeWind preset / CSS vars / native constants (D). Raw hex/px outside the tokens package fails lint.
3. **Generated `@hg/api-client`** from the buf pipeline (D) — kills the `/api`-prefix, casing, hand-redeclared-DTO bug class; all four surfaces consume the same client.
4. **Hard CI gate: Empty/Slow/Broken** (F §7 ≡ E's states-matrix — one mechanism, kept once): every screen must demonstrate empty, slow (3s latency, real skeletons), and broken states via Playwright/Maestro screenshots before merge. Happy-path-only screens cannot merge.
5. **Screen-level strangling** (C): `ScreenV2` behind per-user server-resolved flags; promotion gate is funnel telemetry (no regression at 5% over 72h), rollback one flag. Native apps via Expo OTA.
6. **Real-user check per milestone** (F): three real people (a rider, a restaurateur, a customer) do the flow unaided, recorded. Their confusion is logged as a defect with the same weight as a failing test. This is the one gate no model participates in.

### 2.8 Migration from existing HG
C §8 nearly verbatim, with two amendments:
- **Step 0 (week 1):** DNS → Traefik → Fig → legacy at 100% passthrough; edge normalizations; **emergency authz on the wide-open admin/refund routes and WS identity enforcement at the handshake** — real user-protecting value shipped before any scaffolding exists. Rollback: DNS, TTL 60s, drilled before go-live.
- **The 8-step ladder per endpooint** (observe → generate → implement → shadow → clean → drill → canary → contract), tiered T1–T5, burndown = routes contracted / routes observed, published weekly. **Amendment 1:** each bounded context gets a **dated contract deadline set when its cutover starts**, not later (anti-long-tail). **Amendment 2:** the week-one QPS validation is a hard gate — if production traffic is trivial, the shadow-diff oracle is dropped (not the Fig, not the ladder, not expand/contract) and verification weight shifts entirely to the Bug Ledger + invariant tests (C's own pre-named fallback).
- **Auth:** delegated first, strangled last. Fig validates tokens against legacy, mints internal `X-HG-Identity`; new services do authorization only. The ~20 `/auth/*` endpoints that never existed are new-scope work, built spec-first.
- **DB:** expand/contract with the additive-only migration CI linter (rejects DROP/RENAME/NOT-NULL-without-default); shadow writes to `hgnew.*` with a comparator; dual-write legacy-authoritative; flip; soak 2 weeks; contract last, human-gated, backed up.
- **PII:** redaction-at-capture reviewed by a human **before** the recorder turns on; documented retention; DPA check is an M1 entry criterion (binding per Delivery judge).

### 2.9 Milestone sequence
§6 in full: six weeks detailed, then milestone-level to the **dated pilot at end of week 10**.

### 2.10 Self-critique
- The plan's biggest bet is inherited from C: that production traffic is meaningful. The week-one QPS gate is the falsifier, and the fallback is pre-named.
- The stitched plan has more gates than any single source plan; the defense is that each is ≤ a few hundred lines, mechanical, and covered by the pay-rent kill rule (§7 last row). If the kill rule is not enforced, this plan decays into Plan E's ceremony.
- The Closure Ledger (§5.3) is invented here and untested; it gets its own falsifier (§7).
- The pilot date will pressure the cut list; the cut list is signed in week 6 precisely so that pressure lands on scope, not on gates.

---

## 3. The verification gate stack — ordered, with defect class and cost

Ordered by when they run; each earns its place against a *real* defect class from the legacy corpus. Everything the judges called theater is cut (listed at bottom).

| # | Gate | Catches (real defect class) | Cost |
|---|------|------------------------------|------|
| 1 | **Generated typed clients + contract drift** (buf pipeline, exists today) | The entire endpoint-mismatch class: 60 ghost endpoints, `is_accepting` vs `isAccepting`, `/api` prefix drift (defect 9) | ~0 — pipeline already works |
| 2 | **Config-reality probes**: `/debug/deps` (resolved-connected addresses vs manifest) + localhost-literal lint + fail-loud-on-missing-env | `redis://localhost:6379`-in-Docker class; MINIO env-name mismatch class (defect 1) | ~11 lines per probe, one-time template |
| 3 | **Stepper schema constraints**: `deadline_at NOT NULL`, per-step idempotency key, declared compensation | Untimeboxed waits, saga-proceeds-on-failed-compensation, split-brain (defect 8) — made *unrepresentable*, not tested-for | Schema design, one-time |
| 4 | **Server-authoritative money**: middleware rejecting client-supplied price/total fields + arch-lint banning price fields on inbound DTOs + INV-01 conservation test | Pay-what-you-want checkout, zero-pricing persisted verbatim (defects 4, 5) | ~1 day; D's idea without D's metamodel |
| 5 | **The Bug Ledger** (single bug corpus — see §8 for the three merged duplicates): all ~30 known legacy defects committed as *failing* tests against the new stack before the corresponding feature is written; every future escaped defect and every human reject joins it permanently | Recurrence of every known bug; the regression suite starts non-empty on day one | ~2 days seeding, then incremental |
| 6 | **Invariant integration tests vs the composed stack through Traefik** (INV-01…11 + growth) + **assertion-count** (a CI job asserting zero fails) + **stub-sniffer** (no TODO/unimplemented/no-op handlers merge as done) | Hollow-green CI (the 8-of-18-stubs-shipped-as-done class); GEOADD-write/GET-read round-trip failures (defects 2, 5, 6) | Ordinary Go integration tests; two ~50-line CI scripts |
| 7 | **Shadow-diff oracle** (legacy surface only): replay gate on fresh corpus samples → shadow ≥24h/N-requests/K-users → **coverage-of-reality gate** (every observed status code and shape variant exercised, or promotion blocked) → latency/error gate → rollback drill before first promotion; **order-swap runs** to detect hidden shared state | Hallucinated endpoint behavior; unexercised variants; hidden coupling between old and new write paths | The Fig (built in M1); CPU not tokens |
| 8 | **Closure Ledger** (§5.3 — the invented gate) | The symptomless missing requirement: rider earnings never credited, ratings never submitted, tips collected and dropped | One YAML registry + matrix generator + nightly reconciliation query |
| 9 | **L3-only refutation with evidence schema**: hazardous-lane PRs get one adversarial agent pass, budgeted (20 tool calls / 10 min), whose SURVIVED verdict is schema-rejected unless it lists ≥5 attacks with executed commands and outputs; FALSIFIED auto-commits the reproducing test to the Bug Ledger | Confidently-wrong money/auth logic; identity spoofing; the class that "looks fine" in a diff | Bounded token spend on ≤10% of PRs — not A's linear per-PR verifier |
| 10 | **Diff-scoped mutation testing, L3 paths only** (money/auth/saga) | Self-serving oracles — tests that would not notice a wrong program (defect 7's dead-fallback class on the paths that matter) | Minutes per L3 PR; sampled if >10 min |
| 11 | **Empty/Slow/Broken screenshot gate** per screen + a11y/axe zero-criticals | Happy-path-only UI — the most reliable agent blind spot; the mock-screens class | Playwright/Maestro, per-screen fixtures |
| 12 | **Seeded-defect audits**: 1-in-12 work orders get a planted defect before review; caught-rate <70% over 20 seeds escalates to the human; >95% over 30 reduces audit frequency | Measures whether review is real at all — the only gate that audits the other gates | Cheap; unannounced; E's numbers kept |

**Cut as theater (judges' explicit discards):** diff-coverage gates (all ten real defects had green tests); per-PR adversarial verifier (linear spend, "finds what it happens to think of"); the "completeness critic" question; the novice quiz, Flesch-Kincaid/glossary/banned-word lints; Brier-score calibration; the entire `hgsim` simulator, sometimes-assertions, porcupine, nightly seed fleets, 8-minute shakedown; the simulation receipt; D's model-coverage gate (nothing to cover without the metamodel); F's `effectscan` — **bounded, not built**: adopt only if a post-incident review shows the cheap gates missed the class it targets.

---

## 4. Human review protocol

**What the human sees.** A twice-daily digest containing at most two artifact types:
1. **Promotion Card** (traffic-weight changes, C's format verbatim): endpoint, shadow hours/requests/users, mismatch rate with every diff classified, latency delta, rollback command **with drill date**, "risk if wrong" in one sentence.
2. **PR Card** (L3 code changes, E's 5-line format): WHAT / WHY (invariant or Bug-Ledger ID) / BREAKS / CHECKED (executed evidence, counts) / ROLLBACK — plus, from F's normative-claim rule in light form: any load-bearing adjective on the card (*idempotent, atomic, authorized, retried…*) must cite a test ID or the card fails lint.

**The ONE question.** Every card carries exactly one question with a **pre-selected default**. For Promotion Cards: *"Is this measured risk acceptable?"* For PR Cards: *"Does this match what we want the product to do?"* Never "is this code correct" — the machine certified conformance; the human certifies intent and risk, the two things only they can judge.

**Minutes.** ~90 seconds per card; target ≤10 minutes/day, ≤12 cards/week in steady state. Waiting is productive: a card's evidence keeps accumulating while it sits (C).

**Auto-merge rules.** L1: merge on green, never read. L2: gates + 24h silence-merges, card in digest, reading optional. L3: explicit YES required; money-path canaries (T4) need a named human at each weight step, 48h silence window. **5% of all auto-merged PRs are randomly sampled into the digest for actual reading** (F) — the audit that keeps auto-merge from becoming blindness.

**Escalation triggers** (mandatory human, no default): weakening an invariant; marking a Closure-matrix cell `n/a`; adding a normalizer; any DB contract step; T4 canary; a falsified ADR; a missed seeded defect; changing the pilot scope-cut list.

**How load SHRINKS** (three ratchets):
1. **Contracted endpoints exit forever** (C): review load is bounded by endpoint count, and the burndown is monotone.
2. **The reject ratchet** (E §5.4): every human REJECT auto-creates a Bug-Ledger test + a machine-check ticket; the same *class* never reaches the human twice. Human-touches-per-merged-PR is tracked with a downward target.
3. **Class-once escalation** (E): anything escalated and decided once becomes a rule; it may not return as a question.

---

## 5. The three meta-gap solutions

### 5.1 Delivery gap — the dated pilot cohort
**Milestone P, end of week 10, dated on day one:** one real restaurant, 3–5 real riders, an invite-list of ~30 real customers, placing live paid orders 100% through the new stack (order → pay → accept → dispatch → deliver → payout), routed by per-user flags at the Fig. Not staging, not shadow — money moves.

**The pre-agreed value-ordered scope-cut list**, signed by the human in week 6, executed top-down if the week-6 checkpoint forecasts >2 weeks of slip:
1. Cut first: promo codes, ratings UI, tip UI, admin analytics, restaurant self-serve menu editing (admin does it manually), all animation/polish passes.
2. Cut second: rider auto-dispatch (dispatcher assigns manually from admin), in-app chat, scheduled orders.
3. Never cut: checkout with server-authoritative pricing, payment capture + refund path, order tracking, rider payout ledger, the security fixes.

The pilot date moves at most once. The weekly burndown carries a pilot-countdown line. After the pilot: cohort telemetry (funnel completion, support contacts, order success rate) becomes a promotion gate alongside diff rates — the product finally has an oracle, not just the code.

### 5.2 Bandwidth gap — maintaining the reviewer
Two mechanisms, both cheap, both mechanical:
1. **The State-of-the-System Briefing**: a weekly one-page briefing **generated from repo facts, never hand-written** (so it cannot drift): services live and their routes; contracted-routes % and delta; invariants added/changed this week; Closure-matrix fill rate; the three decisions currently trending toward irreversibility (DB contract steps approaching, ADRs whose falsifier windows close); open risks with owners. Ten minutes of reading that keeps the human's *global* model current enough for their *local* card answers to mean something. If the human stops reading it (self-reported or inferred from an unanswered embedded question), that fact goes on the next briefing — the decay is surfaced, not hidden.
2. **Human-aimed seeded defects**: once per month, one card in the human's digest is deliberately wrong — a claim on the card contradicts the diff, a risk number is falsified, a rollback command is stale. If the human approves it, nothing merges (the seed is flagged pre-merge); the miss is logged. **Threshold: missing 2 of any rolling 4 human-seeds declares review decayed**, which triggers: auto-merge scope freezes (no new classes move to L2), the briefing gains a mandatory 15-minute monthly walkthrough, and card volume is cut in half until the catch rate recovers. This is E's seeded-audit instrument pointed at the last unaudited component: the human.

### 5.3 Correctness gap — the Closure Ledger (symptomless missing requirements)
Three interlocking mechanisms, all mechanical:

1. **The Actor×Terminal-State matrix, generated exhaustively.** `closure.yaml` declares the actors (customer, rider, restaurant, platform, admin) and the terminal states of every lifecycle entity (order: DELIVERED, CANCELLED, REJECTED, AUTO_CANCELLED, DISPUTED…). A generator emits the **full cross-product**: for every (actor, terminal state) cell, CI demands either (a) a passing test ID proving what that actor received or can now do — *rider × DELIVERED → a test proving an earnings ledger row exists with the correct payout*; *customer × DELIVERED → receipt issued + rating prompt available*; *restaurant × DELIVERED → settlement row*; *customer × CANCELLED → refund record open or closed* — or (b) an explicit `n/a: <reason>` that requires human sign-off (an escalation trigger, §4). **The exhaustive generation is the point**: nobody has to *imagine* "did we credit the rider?" — the matrix emits the cell mechanically, and an unfilled cell is a red build, not a silent omission. The bug class the Correctness judge said no plan catches — the ledger that simply isn't there — becomes a hole in a machine-generated table that someone must either fill or sign.

2. **Money closure, end-to-end, nightly.** After the e2e suite runs a day's worth of synthetic orders through the composed stack, one reconciliation query asserts that every settled order's cash fully decomposes: `customer_charge == restaurant_payout + rider_earnings + platform_fee + tip − discounts`, summed and per-order, residual exactly zero. "Rider earnings never credited" cannot hide: the money doesn't balance, because someone's ledger is short. This is B's INV-01 upgraded from "the charge is computed right" to "every party's ledger closes."

3. **Collected-input lint (client side).** Every UI control that collects user input (tip amount, rating stars, dispute text) must map to an RPC call in the generated client, statically checked on the screen files. Input collected and never sent — the ratings `console.log` TODO, the tip that goes nowhere — fails lint. This is INV-11 ("every write has a reader") inverted and pushed to the edge: every promise the UI makes has a writer.

---

## 6. Timeline

### Week-by-week, first six weeks

**Week 1 — Take the front door.**
DNS → Traefik → Fig → legacy, 100% passthrough (rollback = DNS, drilled first). Edge normalizations (prefix/casing/double-slash). **Emergency authz rules on wide-open admin/refund routes; WS identity enforced at the handshake.** PII redaction reviewed by a human, then the corpus recorder turns on; DPA check done. **QPS validation gate**: measure real traffic; if trivial, the shadow oracle is dropped now (fallback pre-named, §2.8). hg-docker infra fixes as L1 PRs. Cheap CI gates live: stub-sniffer, assertion-count, localhost lint, additive-migration linter, lane-gate.

**Week 2 — Walking skeleton + the corpus of truth.**
Golden-path Go service template (health, `/readyz`, `/debug/deps`, metrics, fail-loud env, OTel) + first service (catalog, read-only) through Traefik in compose, 2 replicas, kill-a-replica test green. Generated `@hg/api-client` v0 from the buf pipeline. First nightly `observed/openapi.yaml`. **Bug Ledger seeded: ~30 legacy defects as failing tests.** `INVARIANTS.md` v1 (INV-01…11). `closure.yaml` v0 + matrix generator emitting its first red cells.

**Week 3 — First endpoints contracted; design system.**
`GET /restaurants/:id/menu` + `GET /feed/:userId` through the full 8-step ladder to **contracted**. Promotion Cards + `hgctl` + auto-rollback guards live. `@hg/ui` v0: DTCG tokens + primitives + state matrix; `@hg/api-client` adopted by restaurant-web. Burndown number #1 published.

**Week 4 — The Stepper, shadowing Temporal.**
Stepper package (~400 lines) + checkout saga skeleton with deadline rows and declared compensations; kill-tests at 9 crash points. Stepper runs read-only, diffing intended transitions against Temporal daily. Fig identity broker live (`X-HG-Identity`); new services implement authorization only.

**Week 5 — Dispatch and realtime.**
New Go WS gateway subscribed to legacy gateway; event-sequence parity; 5% of rider-app users on the new URL. `PUT /riders/:id/location` and availability contracted (T2, shadow-write comparator proven). Customer order-tracking screen on `@hg/ui` with Empty/Slow/Broken screenshots gating merge.

**Week 6 — Checkout in shadow; the human loop closes.**
Checkout compute-only shadow (T4): candidate computes decisions + intended effects, logged not performed; server-authoritative pricing live behind it (legacy diffs where legacy is wrong → Bug Ledger rows). First weekly State-of-the-System briefing generated. First human-aimed seed scheduled. **Pilot scope-cut list signed.** Week-6 checkpoint: pilot forecast reviewed.

### Milestone-level to pilot

- **M2 (weeks 7–8) — Stepper takes new orders.** Divergence ≈ 0 → stepper becomes actuator for new orders; Temporal drains; checkout canary 1%→5% internal users; money-closure nightly query green; payout ledger + Closure matrix money cells filled.
- **M3 (weeks 9–10) — PILOT (dated).** One restaurant, 3–5 riders, ~30 invited customers, live paid orders 100% on the new stack via flags. Real-user recorded sessions (F). Support channel staffed. Auto-rollback guards on every pilot route.
- **M4+ — Burndown to cutover.** Per-context contract deadlines dated at each context's start; UI overhaul rolls out screen-by-screen behind flags gated on funnel telemetry; auth strangled last with dual-issuance; Temporal deleted at last-workflow-complete; DB contract steps last, human-gated, backed up; legacy retired context by context.

---

## 7. Kill criteria / falsifiers (numeric, pre-committed)

| Mechanism | Abandon when | Replaced by |
|---|---|---|
| Shadow-diff oracle | Week-1 QPS below ~5k meaningful requests/day or <10 orders/day | Fig + ladder kept without diffing; verification weight moves to Bug Ledger + invariant tests (C's own fallback) |
| The Stepper | Kill-tests show lost/duplicated step execution not fixed within one day | River for the claiming layer, same tables; DBOS Transact-Go if durable human-in-the-loop flows appear |
| Normalizer registry | >25 normalizers on any tier, or any budget loosened | Promotions freeze on that tier until a human audits the registry |
| Lane rules | L3 >15% of merged PRs for 2 consecutive weeks | Decomposition is wrong: re-slice work orders; do not add process |
| Agent seeded audits | Caught-rate <70% over 20 seeds → human escalation; >95% over 30 → halve audit frequency | (E's thresholds kept verbatim) |
| Human review | Human misses 2 of any rolling 4 human-aimed seeds | Auto-merge scope freezes; briefing walkthrough mandatory; card volume halved until recovery |
| Pilot date | Week-6 checkpoint forecasts >2 weeks slip | Execute the signed cut list top-down; date moves at most once |
| L3 mutation testing | >10 min wall-clock per PR sustained | Sample mutants instead of exhaustive; never expand to L1/L2 |
| Per-context migration | Context <90% contracted at its dated deadline +2 weeks | Forced decision: cut remaining endpoints' features or big-bang the remainder; no silent limbo |
| Closure Ledger | Two quarters with zero matrix-caught omissions AND >1 hr/week maintenance | Shrink to money-closure query + collected-input lint only |
| Any CI gate | Catches zero defects in 6 weeks AND costs >2 min/PR | Deleted (E's pay-rent rule, applied to everything above) |

---

## 8. Discarded from each plan — specific and unsentimental

**From A (contracts-first):** The frozen full spec-of-record and its "one hard human review" — a front-loaded design decision the user forbade, with no drift guard on its own prose; only milestone-N JIT specs survive. The per-PR adversarial verifier — linear unbounded token spend finding "what it happens to think of"; replaced by L3-only refutation with an evidence schema. The diff-coverage gate — all ten real defects had green tests; it measures typing, not truth. The completeness critic — a question is not a mechanism. River-as-default — demoted to the stepper's escape hatch.

**From B (simulation):** The entire `hgsim` simulator, virtual clock, adversarial Redis model, in-memory Postgres model, sometimes-assertions, porcupine checks, nightly 50k-seed fleets, weekly 10⁶ sweeps, 8-minute shakedown, simulation receipts, and the deterministic-core/effects-as-data architecture tax — 4–6k lines of permanent infrastructure, "mostly deterministic" in Go, disproportionate to a compose-deployed food app, and its schedule-pressure failure mode (a lagging simulator that lies with authority) is disqualifying. What survives: the invariant catalog *statements* tested conventionally, the timers-explicit saga idea (folded into the stepper), and the bug-museum *concept* (folded into the Bug Ledger).

**From C (the spine — still cut):** Weekly rollback drills on already-contracted read-only endpoints (drilling a rollback nobody will ever use). Floating mismatch budgets (replaced by a tighten-only ratchet). Any Fig scope beyond route/record/shadow/identity — the Fig is a SPOF and must stay boring. The undated long tail — replaced by dated per-context deadlines set at cutover start.

**From D (generate):** The custom metamodel (`hg.options.v1`), all six bespoke generators (~6–8k lines), the Hole Manifest, the FSM/saga/screen DSLs, and the hand-written-LOC dashboard — the hugest, most irreversible front-loaded design decision of the six, with the documented MDD death spiral and system-wide unreviewed generator-bug blast radius, and worst cancellation salvage. What survives is only what already works or is standard tooling: the buf client pipeline, DTCG tokens, the server-authoritative idea as middleware+lint, and expiry-dated escape hatches as a pattern.

**From E (factory):** The nine-role org chart, role charters, memory files, handoff records, WIP limits, agent-pulled andon cords, per-work-order pre-mortems, and the Process Steward — E's own §11.3 concedes role identity is "a fiction with no teeth" and the plan is "a good CI design wearing an org costume," at 3–8× token cost. The costume is deleted; the ~8 mechanical checks, the lanes, the seeded audits, the reject ratchet, and the kill-criteria discipline are kept. Automated halt triggers (stuck saga, assertion-count drop) survive as plain CI/alerting — no cord metaphor.

**From F (falsification):** teachback-lint, Flesch-Kincaid ceilings, the glossary, banned-word lists, the novice quiz, Brier calibration and confidence routing, and the five-artifact-per-PR ceremony — F's own citation (Turpin et al.) shows fluency and truth are uncorrelated in the failure cases that matter, calibration is admittedly noise before month three, and the artifacts would be curated by the human attention we're conserving. `effectscan` is bounded, not built — adopted only if a post-incident review shows the cheap gates missed its class. What survives: the stepper, config probes, seeded counterexamples, Empty/Slow/Broken, the refutation evidence schema, decision falsifiers, and 5% auto-merge sampling.

**Duplicates resolved (pick-one calls):**
- *Bug corpus* (A's encoded invariants ≡ B's museum ≡ E's bestiary ≡ F's seeded counterexamples) → **one** Bug Ledger: failing tests red-first against the new stack; escaped defects and human rejects join it forever. B's mutant form needs the simulator; cut.
- *Orchestration* (A's outbox+River / B's interpreter / C's reconciler / D's generated engine / E's generated tables / F's stepper) → **F's stepper schema running C's shadow-then-actuate migration**. Three plans independently converged on deadline-mandatory schemas — the strongest signal in the exercise — and F's is the smallest.
- *PR summary* (B's receipt / C's card / D's MCR / E's 5-liner / F's UR) → **two cards only**: C's Promotion Card for traffic, E's 5-line card for L3 code, both with F's citation rule and E's silence-default.
- *Happy-path UI gate* (E's states-matrix ≡ F's triad) → one gate, F's Empty/Slow/Broken naming, E's CI-fixture-count enforcement.
- *Review-is-real audit* (E's seeded defects ≡ F's 5% sampling) → both kept because they audit different things: seeds audit *reviewers* (agent and, newly, human); sampling audits the *auto-merge tier*. They do not overlap.
