# Judge: Delivery Risk & Time-to-Value

Lens: "keep everything as simple as possible", "stay delivery first minded", "avoiding huge complex design decisions." Scored on: time to real shipped value, what survives cancellation at week 3 / week 8, upfront machinery on the critical path, deferral vs front-loading of irreversible decisions, proportionality to a food-delivery app, coverage of the ~40% NEW scope, and graceful degradation under schedule pressure.

---

## 1. Scores

### Plan A — Contracts-First Spec Pyramid + Walking Skeleton: **7/10**

The best ratio of machinery-to-motion among the "build it fresh" plans. The walking skeleton is the right first move: it is small, it is on the real target stack (compose + Traefik + CI gates), and every later service clones its shape, so the upfront cost amortizes immediately. Orchestration is deferred behind a port with the simplest viable default (outbox + saga table + River) — that is exactly "defer complexity behind cheap abstractions." It handles the 40% new scope natively, since spec-first doesn't care whether legacy exists. Deductions: (1) its own self-critique is correct that *nothing ships to real users until many milestones land* — the first milestone ships zero user value, and there is no strangler/cutover story at all, which for a rebuild is a genuine big-bang risk; (2) the frozen spec-of-record is a front-loaded design decision of exactly the kind the user said to avoid — if the domain model is wrong, everything inherits it, and "one hard human review" of a whole domain model is the single heaviest human moment in any plan; (3) per-PR adversarial verifier cost scales linearly and is admitted to be a potential bottleneck. Cancelled at week 3 you have a deployed skeleton and a slice; at week 8, several working vertical slices in compose but no users. Under pressure it degrades acceptably: skip the adversarial verifier and you still have contracts, TDD gates, and small PRs.

### Plan B — Deterministic Simulation: **3/10**

This is the most intellectually impressive plan and the worst one on this lens, and its own §12.2 says so: "If the project is cancelled in month two, Plan A has a walking skeleton in production and Plan B has a test harness." 4,000–6,000 lines of simulator that no customer sees, on the critical path, maintained forever, plus a permanent architectural tax (pure cores, effects-as-data, purity lint) on every ordinary feature, plus an admitted "mostly deterministic" Go reality that guarantees a leak-hunting tax. This is FoundationDB/TigerBeetle discipline pointed at a food-delivery app that deploys on docker-compose — complexity radically disproportionate to the product. Its failure mode under schedule pressure is the worst of the six: when corners get cut, the simulator lags the system and *lies with authority*, and the 8-minute per-PR shakedown flakes and destroys gate credibility. The nightly fleet + weekly 10⁶-seed sweeps are exactly the unbounded compute/token cost this lens penalizes. Credit that keeps it off the floor: the invariant catalog derived from real legacy bugs is excellent and portable; the bug museum (legacy bugs as mutants) is the best regression idea in any plan; the trace-recorder migration Phase 1 is cheap and valuable; M2 does at least reach staging traffic. But the plan's core bet — build the verifier before the product — is the opposite of delivery-first.

### Plan C — Strangler-Fig: **8/10**

The only plan where something real is in production in week one. "Take the front door" (Traefik + Fig at 100% passthrough on day ~4) is the highest-value/lowest-risk first move in any of the six plans: zero behavior change, instant observability, and — crucially — *emergency authz on the wide-open admin/refund routes and WS identity enforcement in week one*, which is real user-protecting value shipped before any competitor plan has finished its scaffolding. Cancellation math is the best of the six: at week 3 you keep the Fig, the security fixes, and `observed/openapi.yaml` — the real API documentation nobody has, valuable even if everything else stops; at week 8 you have contracted endpoints serving real traffic. Big design decisions are systematically deferred: auth is delegated, not rebuilt; the legacy schema stays authoritative; every step reverses with a file write. The per-endpoint 8-step ladder is a true factory with a measured burndown ("routes contracted / routes observed"). Why not higher: (1) the plan's own biggest bet — that production traffic exists in meaningful volume — is unvalidated, and if QPS is trivial the whole oracle collapses (the plan honestly says "adopt Plan A" in that case); (2) it is admittedly *mediocre for the ~40% new scope* — refunds, disputes, onboarding, the entire UI overhaul have no oracle and fall back to spec-first, i.e., the plan is incomplete exactly where the new product value is; (3) the Fig + corpus + comparator + drill scheduler is real machinery producing no features, the Fig is a new SPOF, and PII capture is a legal exposure that could block M1; (4) the classic strangler death — permanent two-system limbo on the long tail — is the plan's own named failure mode, and its countermeasure (dated deadlines) is weak. Under pressure, though, it degrades most gracefully of all: legacy keeps serving users no matter how badly the new work goes.

### Plan D — Generate Everything: **2/10**

The plan most directly at war with the user's constraints. "Avoiding huge complex design decisions" — Plan D's first deliverable is the hugest, most irreversible design decision available: a custom metamodel (`hg.options.v1`), an FSM/saga/screen/topology DSL, and ~6–8k lines of bespoke generators, all on the critical path before any feature. Its own §10.1 calls the bootstrap "the single biggest reason to reject this plan," and §10.4 names the documented death of MDD projects (DSL creep) as its trajectory. M1 ships zero user value; cancellation at week 3 leaves generators that are worthless outside this plan — the worst salvage value of the six. Under schedule pressure it degrades into the worst hybrid: escape hatches proliferate, half the code is generated and half hand-written against generated interfaces, and a generator bug ships an authz bypass to every service simultaneously *with zero human eyes on the output* (§10.2 admits this is worse than Plan A's failure mode). It also concedes its leverage halves if the "resists generation" fraction is 40% rather than 20% — and this project's new scope (dispute flows, onboarding judgment, the whole UI overhaul) is heavily in the resists-generation category. Two genuinely cheap, proven fragments deserve rescue (the already-working buf contracts pipeline for generated typed clients; DTCG tokens driving all four surfaces), but the plan around them is over-engineering of the first order.

### Plan E — Agent Software Factory: **5/10**

Middling, and honest about why. On the plus side: M0 is only 5–7 days and its acceptance test is a real service through Traefik, and M1 at ~week 3 ships an actual user-visible slice (menu path rebuilt, shadowing legacy, a 10% cutover exercised and rolled back) — earlier real shipping than A, B, D, or F. The lane system is a genuine anti-bureaucracy device, and the pre-committed kill criteria (§11.11) are the best schedule-pressure hedge in any plan. Several of its poka-yokes (stub-sniffer, assertion-count, doc-drift) are cheap and kill exactly the hollow-green-CI failure the legacy audit documented. Now the minus column: nine roles, handoff records, evidence blocks, pre-mortems with six independent writers — an admitted **3–8× token cost per merged line**, which this lens explicitly penalizes, with the entire economics resting "on one tunable parameter" (L3 share). The author's own §11.3 concedes the plan is "a good CI design wearing an org costume" — meaning ~60% of its page count is decoration around mechanisms that could ship as ten CI checks and three roles. Under pressure it degrades the way real orgs do: lane downgrades, gamed metrics (§11.7 cites DORA's own throughput-up/incidents-up data), and process that survives as ceremony. It is a proportionate plan wearing a disproportionate costume; judged as written, the costume costs real tokens and real wall-clock.

### Plan F — Feynman Falsification: **4/10**

Contains the single best simplicity decision in any plan — the ~400-line Postgres stepper with `deadline_at NOT NULL`, no port, no engine, state one query away — and the most delivery-honest self-critique: §10.8 flatly says "a project under acute delivery pressure should probably run Plan A's walking skeleton first and layer Plan F's gates onto it in week two," which is the plan conceding this lens. Judged as written, though: M0 is a week of gate machinery (teachback-lint, effectscan, novice quiz, glossary, refuter schemas, mutation harness, calibration) with "almost no product in it" (its words), and real users see nothing through M2 at week 6 — the migration's Traefik-in-front and shadow phases carry no committed timeline. Effectscan is a bespoke static-analysis tool whose build cost is hand-waved; the five-artifacts-per-PR ceremony (UR, claims, refutation report, ASM deltas, calibration) is process mass a food-delivery rebuild does not need, and §10.4's own kill metric anticipates humans ignoring 90% of it. Credit for bounded refutation budgets (20 tool calls standard — the only plan that hard-caps adversarial token spend), for config-reality probes (`/debug/deps` + localhost lint — eleven lines that kill a real legacy bug class), for seeded counterexamples from day one, and for the Empty/Slow/Broken screen gate. But the plan front-loads epistemics the way B front-loads simulation: verification machinery before product, crossover "guessed" at week 5–6, and ASM-000 admits the whole premise is untested.

---

## 2. Strict ranking

**C > A > E > F > B > D**

1. **Plan C (8)** — ships to production in week one, best cancellation salvage, defers every big decision, measured burndown.
2. **Plan A (7)** — cheapest credible machinery, right first artifact (walking skeleton), but no user-facing shipping story and a front-loaded frozen spec.
3. **Plan E (5)** — earliest user-visible feature slice after C, good kill criteria, but 3–8× token cost and nine roles of costume.
4. **Plan F (4)** — best orchestration choice and bounded budgets, but a week of epistemics before product and no committed cutover timeline; its own author defers to A under pressure.
5. **Plan B (3)** — brilliant, disproportionate; a test harness where a product should be; worst schedule-pressure failure mode (a simulator that lies with authority).
6. **Plan D (2)** — front-loads the biggest irreversible design decision of any plan, worst cancellation salvage, documented MDD death spiral, generator bugs ship system-wide unseen.

---

## 3. Best plan on this lens: Plan C

Plan C is the only plan that takes "delivery first" literally: production traffic flows through its infrastructure on day ~4, real security value (authz on wide-open admin/refund routes, WS identity enforcement) ships in week one, and every subsequent increment is live, measured, and reversible with a file write. It is also the only plan whose cancellation story is good at *every* point: stop at week 3 and you still own the front door, the real API documentation, and emergency security fixes; stop at week 8 and contracted endpoints keep serving. It defers rather than front-loads every hard decision — auth delegated to legacy, schema kept authoritative, orchestration shadowing before owning — which is precisely "avoiding huge complex design decisions." Its two honest weaknesses (empty-oracle risk if traffic is trivial; no oracle for the ~40% new scope) are both explicitly hedged in the plan itself, with a named week-one validation and a named fallback ("adopt Plan A, keep the Fig and expand/contract"). A winner that names the conditions under which it should lose is exactly what you want under delivery risk. The winning synthesis is C's sequencing and front door, with A's spec-first method applied *only* to the 40% of scope C admits it cannot cover.

---

## 4. SALVAGE LIST — mechanisms the winning synthesis must preserve

**From Plan C (the spine):**
- **"Take the front door" Step 0** — Traefik + Fig at 100% passthrough on `api.halalgoes.com` in week one, rollback = DNS. (C §8.1)
- **Week-one edge security fixes** — Fig-enforced authz on wide-open admin/refund routes; WS identity enforcement at the handshake. (C §8.5)
- **Fig as identity broker; auth strangled last, delegated first** — token introspection against legacy, `X-HG-Identity` injection; new services do authorization only. (C §8.5)
- **The per-endpoint 8-step ladder** (observe → generate → implement → shadow → clean → drill → canary → contract) and the **contracted-routes burndown** as the project's progress metric. (C §8.3)
- **Promotion Cards** — the human certifies a measured risk, never code correctness; one judgment question, pre-computed rollback command. (C §4)
- **Expand/contract DB sequence with the additive-only migration CI linter** (rejects DROP/RENAME/NOT-NULL-without-default). (C §8.4)
- **Auto-rollback guards + rollback drills** — rollback that has never been exercised is not rollback. (C §8.7)
- **The week-one QPS validation gate** — measure real traffic before committing to the oracle; pre-named fallback to spec-first. (C §10.1)

**From Plan A:**
- **The walking skeleton as first code artifact** — one proto → one golden-path Go service → Traefik/compose → CI gates live — used for the ~40% new scope where C has no oracle. (A §2)
- **Golden-path service template** — every service the same shape, so structure cannot be hallucinated per-service. (A §2)
- **Just-in-time spec expansion** — milestone N in detail, N+1 a sketch; never a full frozen pyramid. (A §1)
- **Outbox + saga state machine in Postgres behind a port** — simplest orchestration default, zero new infra. (A §5) — *or* swap in F's stepper, below; pick one, not both.
- **PR stacking so the factory never blocks on human review.** (A §3)

**From Plan F:**
- **The ~400-line Postgres stepper with `deadline_at NOT NULL`** — makes the legacy wait-forever bug structurally inexpressible; state is one SQL query away. The best "simple orchestration" candidate of the six. (F §5)
- **Config-reality probes**: `/debug/deps` returning actually-connected addresses, diffed against the manifest, + localhost-literal lint + fail-loud-on-missing-env (DEP-6). Kills the `localhost:6379` bug class for ~11 lines each. (F §3.2.4, §6)
- **Seeded counterexamples**: every known legacy bug committed as a failing test in hg-mono *before* the corresponding feature is written. (F §8; same mechanism as A's encoded invariants, B's bug museum, E's bestiary — keep exactly one instance of it.)
- **The Empty/Slow/Broken screen triad as a hard CI gate** (F §7; equivalently E's `states-matrix`) — the cheapest fix for the strongest agent blind spot, happy-path-only UI.

**From Plan E:**
- **`stub-sniffer` + `assertion-count` CI checks** — a green job that asserts nothing fails; directly kills the audited hollow-CI failure. (E §4.4)
- **The three-lane system assigned by path rules** — most work sees near-zero process; money/auth/PII/migrations get the full treatment. (E §3.1)
- **The human-reject learning loop** — every human rejection auto-creates a regression test + a machine-check ticket, so human load falls monotonically. (E §5.4)
- **Pre-committed kill criteria for every process artifact** — ceremony that must pay rent weekly or be deleted. (E §11.11)

**From Plan B:**
- **The invariant catalog format** (INV-01…INV-11, one English line each, bound to an executable check) as the *statement* of what matters — enforced by ordinary integration tests against the composed stack, not by a simulator. (B §1a)
- **The lightweight traffic recorder** (B Phase 1 / C's corpus — same mechanism) as the migration's knowledge asset.

**From Plan D:**
- **Generated typed API clients from the already-working buf contracts pipeline** — one schema drives server + all four clients; kills the `/api`-prefix, casing, and hand-redeclared-DTO bug class at near-zero cost since the pipeline exists. (D §0, §7)
- **DTCG design tokens → Style Dictionary → all four surfaces** — one token set, four apps; cheap, standard tooling, no bespoke generator. (D §7)

---

## 5. DISCARD LIST — drop or strictly bound

- **Plan B's `hgsim` deterministic simulator, adversarial Redis model, sometimes-assertion CI gates, porcupine linearizability checks, virtual-clock machinery** — DROP. 4–6k lines of permanent infrastructure, "mostly deterministic" in Go, disproportionate to a compose-deployed food app, and its schedule-pressure failure mode (a lagging simulator that lies) is disqualifying. Keep only the invariant *statements*, tested conventionally.
- **Plan B's nightly fleet / weekly 10⁶-seed sweeps and 8-minute per-PR shakedown** — DROP (unbounded compute on the critical path; flake risk destroys gate credibility).
- **Plan D's custom metamodel (`hg.options.v1`), FSM/saga/screen DSLs, Hole Manifest, and the 6–8k-line generator suite** — DROP. This is the front-loaded irreversible design decision the user forbade, with the documented MDD/DSL-creep death spiral and system-wide unreviewed generator-bug blast radius. Keep only what already works (buf pipeline, tokens).
- **Plan E's nine-role org** — BOUND to three effective roles (implementer, adversarial reviewer, merge authority). E's own §11.3 concedes role identity is "a fiction with no teeth" and the binding parts are the mechanical checks; keep the checks, drop the org chart, and with it most of the 3–8× token multiplier.
- **Plan E's WIP limits and agent-pulled andon cords** — DROP (author's own candidates: §11.6 "the practice I would delete first"; §11.5 expects agent pulls to go unused). Keep only the *automated* halt triggers (stuck saga, assertion-count drop).
- **Plan E's per-work-order pre-mortems** — BOUND to milestone boundaries only, and only if the previous one produced a machine check (E's own kill criterion).
- **Plan F's novice quiz, glossary lint, Flesch-Kincaid gates, and Brier-score calibration apparatus** — DROP. Turpin et al. (cited by F itself) undercuts the premise; calibration is admittedly non-actionable before month three; this is ceremony per PR on a project that needs shipping. Keep a single plain-English PR summary format (F's UR prose, or E's 5-line card, or C's Promotion Card — one, not three).
- **Plan F's `effectscan` two-way effect coverage** — BOUND: do not build the bespoke analyzer up front; adopt only if a post-incident review shows the cheap gates (config probes, deadness detector, integration tests) missing the class it targets. It is on nobody's critical path.
- **Plan F's per-PR mutation testing** — BOUND to money/auth/saga paths (L3 lane) only; diff-scoped mutation on every PR is cycle-time tax.
- **Plan A's "one hard human review" of a full spec-of-record** — BOUND: spec only the current milestone's contexts (A already half-says this); never freeze beyond the active slice.
- **Plan A's per-PR adversarial verifier** — BOUND by E's lanes: hazardous paths only. Linear verifier cost across all PRs is the unbounded token sink A itself flags.
- **Plan C's corpus PII capture** — BOUND hard: redaction-at-capture reviewed by a human before M1, documented retention, legal/DPA check as an explicit M1 entry criterion. This is the one thing that can block C's week-one ship.
- **Plan C's normalizer registry and mismatch budgets** — BOUND with a ratchet: budgets may only tighten; every normalizer human-reviewed with example diffs (C's 20-example rule kept); a scheduled audit of total normalizer count, because normalizers are "places we decided to stop looking."
- **Plan C's long tail** — BOUND with dated per-context contract deadlines published on the burndown from day one, not added later; permanent two-system limbo is the strangler's grave.

---

## 6. The one thing ALL six plans get wrong about delivery risk

**All six equate delivery risk with defect risk, and none puts a real user on the critical path in the first month.** Every plan's first milestone is verification machinery — a skeleton, a simulator, a proxy, generators, a factory, epistemic gates — and every plan measures its own health by internal proxies: invariants held, seeds caught, mismatch rates, model coverage, Brier scores, assertion counts. Not one plan defines the actual minimum sellable event — *one real customer orders food from one real restaurant and one real rider delivers it through the new system* — as a dated target, and not one ranks the ~40% NEW scope (refunds, disputes, onboarding, the UI overhaul — the part that is presumably the reason for the rebuild) by user value or names what will be cut when the schedule slips. Only C (funnel telemetry) and F (three real people per milestone, unaided, recorded) even gesture at external feedback, and in both it arrives after the machinery. For a consumer food-delivery app, the dominant delivery risk is not a wrong interleaving or a hallucinated endpoint — it is months of provably-correct software that no customer has touched, encoding product guesses (fees, flows, onboarding friction, dispute UX) that only live usage can falsify. Plan B's own §12.7 admits it: product judgment is "entirely human, entirely unverified, and probably where the larger risk actually lives." Every plan builds an oracle for the code; none builds an oracle for the product. The winning synthesis needs a seventh mechanism no plan contains: a dated pilot-cohort milestone (one restaurant, a handful of riders and customers, live orders through the new stack) inside the first 4–6 weeks, with a pre-agreed scope-cut list ordered by user value to protect that date.
