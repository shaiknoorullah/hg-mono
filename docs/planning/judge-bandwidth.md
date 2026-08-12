# Judge: Human Review Bandwidth, Operability & Economics

Lens: the user's hard constraint — *all async from humans; humans only review small, plainly-explained PRs*. Judged on: what the human sees, minutes per review, whether load grows or shrinks with the codebase, what the human is asked to certify, cost per merged unit, tunables that can invert the economics, drift guards on the plan's own machinery, and rubber-stamping risk.

---

## 1. Per-plan analysis

### Plan A — Contracts-First Spec Pyramid

**What the human sees per PR.** One enormous up-front spec-of-record review (hours to days — the plan calls it "one hard human review" and moves on), then a stream of small PRs with "plain-English summary" after adversarial agent verification and CI gates. The summary format is unspecified. The question the human is answering is unspecified — which in practice means "is this correct?", the one question the plan's own self-critique admits the human cannot answer ("assumes the human reviewer can meaningfully judge a small PR without whole-system context").

**Minutes per review.** 5–15 min per PR, poorly bounded because the human has no structured artifact and no defined question — they will either read the diff (slow, incompetent to judge) or rubber-stamp (fast, worthless).

**Load over time: GROWS, linearly and admitted.** Adversarial verification "scales linearly with PR count; may become the bottleneck" — the plan says this about its agents and offers nothing; the same is true of its human. There is no auto-merge tier, no escalation taxonomy, no load-reduction loop. Every PR reaches the human.

**Economics.** One adversarial-verifier model call per PR is a linear, unbounded spend that finds only "what it happens to think of" (Plan B's critique is correct). The frozen spec is prose + protos; the drift gate covers protos only. Milestone slices and the spec-of-record narrative have **no drift guard** — this is precisely the maturity-audit failure (docs describing a repo that no longer exists) reproduced at the plan's foundation. If the spec is wrong, re-review of the freeze is another large synchronous human event.

**Async.** PR stacking is genuinely good; the factory doesn't block on review.

**Score: 4/10.** The plan correctly names the scarce resource (reviewer trust per PR) and then spends it in the least structured way of all six: undefined question, linear growth, no triage, no drift guard on its own spec.

---

### Plan B — Deterministic Simulation

**What the human sees per PR.** Three tiers: (1) invariant diffs — one English line each, rare, and explicitly the only thing requiring hard thought; (2) UX flow diffs as pictures; (3) code PRs ≤300 lines topped with a generated **simulation receipt**: What / Why (with the counterexample seed) / Proof (5,000 seeds clean, museum 31/31, new state reachable) / Risk. ~150 words. The question is explicit and answerable: *"is this the behavior we want?"* — product judgment, not correctness. A non-expert who knows the food-delivery business can answer it.

**Minutes per review.** 2–4 min per code PR; 1–2 min per invariant diff. Invariant weakening — the one dangerous act — is the single thing routed to hard human attention. That is exactly the right shape.

**Load over time: grows linearly with PR volume, at the lowest per-PR cost of any plan — but it grows.** B's one real bandwidth flaw: *every* code PR reaches the human. There is no auto-merge tier, no boring-tier digest, no attention-routing. At 30 PRs/day that is an hour a day forever. The plan's own self-critique #9 (receipt becomes a rubber stamp) is the predictable resolution: the human converts to auto-merge informally, without the audit sampling that would make that safe.

**Economics.** Best of the six. The oracle scales with hardware, not model calls: "a seed sweep costs CPU cents, runs while everyone sleeps, and finds what is actually there." Cost per merged unit is bounded and tunable (seed counts, sweep budgets). Real costs: 8-min shakedown per PR (flake risk is named and is real — a flaky gate destroys the whole trust economy), the nightly fleet, and 4–6k lines of harness maintained forever.

**Drift guard on its own machinery: best in class, by far.** This is the only plan that *tests its own verifier*: the bug museum (mutants must be re-caught or the harness has rotted), the sometimes-assertion never-fires gate (CI fails when the harness goes blind), and the shakedown tier running the *same checkers* against real containers (sim-vs-reality divergence is detected, and "the model gets fixed"). Docs generated from the model cannot drift. The maturity-audit failure mode is structurally addressed, not hoped away.

**Rubber-stamping.** Agent-to-agent sycophancy is nearly eliminated because the reviewer is a machine that cannot be flattered. Human receipt-trust decay is admitted (#9) but unmitigated — no audit sampling of "green" PRs.

**Async.** Excellent: PRs stack, and the nightly fleet auto-files reproducible work orders — the backlog generates itself while the human sleeps. This is the most genuinely asynchronous plan.

**Score: 8/10.** Docked one point for the missing auto-merge/digest tier (linear human load with no triage) and one for the unmitigated human-side rubber-stamp decay and shakedown-flake fragility.

---

### Plan C — Strangler Fig

**What the human sees per PR.** Two classes. Type-S (90% of volume): auto-merged, never read, provably zero blast radius — the correct treatment of most agent output. Type-P: a one-line config diff plus a generated **Promotion Card** — traffic %, shadow hours, request count, mismatch rate with every diff classified, latency delta, rollback command with drill date, "risk if wrong" in one sentence, and one explicit reviewer question. The human certifies *"is this measured risk acceptable?"* — the single most answerable question in any of the six plans, judgeable by a complete non-expert, because every number on the card was measured against production, not asserted by an agent.

**Minutes per review.** ~90 seconds per card, batched into a twice-daily digest, and evidence *improves* while a card waits — waiting is productive, which is a beautiful async property. Exception: T4 (money/auth/PII) requires a named human at every canary step (1%→5%→25%→50%→100%) — five touches per endpoint on the paths that matter most. Async-compatible (steps have hold periods anyway) but the heaviest human involvement of any plan exactly where stakes are highest.

**Load over time: SHRINKS structurally — for the covered surface.** Load is bounded by *endpoint count*, not codebase size, and the burndown (routes contracted / routes observed) is measured, monotone, and terminates. A contracted endpoint is "done and never revisited." No other plan can say human load goes to zero per unit of surface.

**The hole.** By its own accounting, ~40% of the needed surface (all of `/auth/*` that never existed, refunds, disputes, settlements, onboarding, **and the entire UI/UX overhaul the user asked for**) has no oracle and "falls back to specification and ordinary review" — i.e., Plan A's undesigned review model, for nearly half the project. The bandwidth story is superb for the 60% and absent for the 40%.

**Economics.** Two systems run in parallel for the entire migration; the long tail ("where strangler projects die") makes the dual-run duration — and therefore cost — **unbounded**. The plan's countermeasure (dated contract deadlines) is admittedly "a countermeasure, not a solution." And the whole apparatus has a mis-settable precondition rather than a tunable: if production QPS is trivial, the Fig + corpus + comparator is strictly worse than a weekend cutover — the plan admits this and mandates a week-one QPS check with a fallback to Plan A. Credit for pre-committing the check. Privacy/legal cost of recording production traffic is real and paid by no other plan.

**Drift guards.** Good: the corpus is regenerated nightly and never hand-edited (cannot drift); rollback drills run weekly and *demote endpoints whose drills fail* — the machinery is exercised, not trusted. Normalizer creep ("places where you decided to stop looking") is the plan's own drift vector; the 20-example rule and human-reviewed registry are partial.

**Score: 7/10.** The Promotion Card and the shrink-to-zero burndown are the best bandwidth mechanisms in the field; the plan loses points because the constraint it serves best (existing traffic as oracle) covers barely half of a project that is a rebuild-plus-full-UI-overhaul, and its dual-run cost is unbounded in duration.

---

### Plan D — Generate Everything

**What the human sees per PR.** Model PRs: a ~20-line proto/YAML diff plus the **Model Change Report** — plain-English change list, wire compatibility, blast radius, new holes, risk flags. ~10–20 min each, 1–3/day. Hole PRs: three lines, "humans skim, the tests are the real reviewer" — at 20–60/day nobody skims; these are auto-merges wearing a review costume, and the plan should say so. Generator PRs: 1–2/week, two-key, and "a human should personally read every line of `protoc-gen-hg-authz`" — hours of deep *expert* review.

**Minutes per review.** 30–60 min/day on model PRs, plus periodic multi-hour generator reviews. Concentrated, not small.

**Load over time: shrinks relative to codebase — the strongest scaling argument here.** Review load tracks *domain evolution* (model churn), not LOC. 90% of human effort on 5% of the repo, and that 5% is where being wrong is expensive. As the system grows, hole volume grows but review of it is ~zero.

**What the human certifies — the problem.** The reviewer of a model PR is certifying *what the generator will do with this annotation* — they must hold the generator's semantics in their head. The plan admits it: "a 20-line diff that a reviewer cannot fully evaluate is a false sense of smallness." This fails the non-expert test outright. The user in this scenario cannot review `protoc-gen-hg-authz` line by line; the plan's central safety assumption has no one to perform it. And the flip side is worse: generated code — the entire codebase — is reviewed by *no one*, so a generator bug ships to every service simultaneously with zero eyes (admitted, "worse failure mode than Plan A's"). Constitutional tests mitigate; they are a handful of assertions guarding millions of generated lines.

**Economics.** 6–8k lines of generators on the critical path before any product exists ("thin wrapper is where estimates go to die" — their words). Generator maintenance and DSL creep are the unbounded costs; the model schema growing an expression language is "the documented death of MDD projects." Credit: this is the only plan with a hard, numeric self-kill criterion (hand-written LOC share not below 15% by M3 → stop building generators, revert to Plan A). That is exactly the pre-committed tunable this lens demands.

**Drift guards.** Excellent on paper: docs generated (cannot drift), double-regeneration determinism gate, escape hatches with CI-failing expiry, generator-debt backlog. The meta-system's blind spot is the generators themselves — guarded only by golden files and the expert review that doesn't exist.

**Async.** Best parallelism of all six: holes are independent by construction, 40 agents with no merge conflicts, no stacking needed, failed holes auto-requeue.

**Score: 6/10.** Superb load *concentration* and async properties, undone on this lens by requiring an expert reviewer the constraint says we don't have, and by the nobody-reviews-the-codebase inversion.

---

### Plan E — Agent Software Factory

**What the human sees per PR.** For ~10% of PRs (L3): a fixed 5-line contract — WHAT / WHY / BREAKS / CHECKED / ROLLBACK — plus exactly one question **with a pre-selected default so silence is a decision** (silence merges in 24h). Weekly one-pager. Target for a whole milestone: ≤12 PR summaries + 2 ADRs + 1 signature. Nothing else ever reaches a human, and a whole class of things ("anything already escalated once in the same class") is banned from returning.

**Minutes per review.** 2–3 min per L3 summary; 5–10 min weekly one-pager.

**Load over time: SHRINKS by design — the only plan with an explicit monotone load-reduction loop.** §5.4: every human REJECT auto-creates a bestiary test + a poka-yoke ticket; the commitment is the same *class* never reaches the human twice; human-touches-per-merged-PR is a tracked metric with a downward target, and PS must report if it isn't falling. This is the single best answer in the field to "does load grow or shrink."

**Economics: the worst, and self-confessed.** 3–8× tokens per merged line, fixed ceremony overhead regardless of throughput, and — the plan's own words — "the whole plan's economics rest on one tunable parameter" (lane rules). If L3 creeps to 30%, E is "strictly worse than Plan A on both cost and speed." This is the textbook case of the mis-settable tunable this lens penalizes, named by the plan about itself.

**Meta-drift: the fatal admission.** §11.4: "Nothing guards `/ops/` itself. PS owns the process, computes the metrics that judge the process, and reports on itself — a separation-of-duties violation sitting at the center of a plan whose thesis is separation of duties." E reproduces the exact maturity-audit failure (governance prose describing a repo that no longer exists) at its own core and says the only fix is periodic human audit — the resource it claims to conserve. Kill criteria (§11.11) partially compensate, but they're reviewed on a one-pager whose own kill criterion is "the human stops reading it."

**Rubber-stamping.** E is the only plan that *measures whether review is real*: seeded-defect audits with a caught-rate threshold, plus evidence-bound review (an approval without executed commands is rejected by CI) and blind review. These three mechanisms are the best anti-sycophancy tooling in any plan. But E also admits the roles are "a good CI design wearing an org costume" — nine charters, memory files, handoff records, and WIP limits are ceremony around perhaps five load-bearing checks.

**Async.** Silence-merges is clever but §11.9 admits it erodes exactly when the human is away for a week — L3 stalls or lanes get downgraded, "precisely how control erosion happens."

**Score: 5/10.** Contains the two or three mechanisms most worth stealing on this entire lens, wrapped in the most expensive, most drift-prone, most ceremonial package of the six.

---

### Plan F — Falsification & Teach-Back

**What the human sees per PR.** The best single PR artifact of the six: the Understanding Record *is* the PR body — ≤200 words, machine-linted to grade-8 plain language, banned-phrase-checked, effect-coverage-verified against the actual diff — plus the claims table with the attack record ("SURVIVED (7 attacks): SIGKILL ×3 crash points, duplicate concurrent POST, …"), a mandatory "what I don't understand," and a novice-quiz score. The human is asked exactly one question: *"does this explanation make sense, and does the diff look like the explanation?"* — explicitly *not* "is this correct," with the honest argument for why (pretending otherwise "is how review becomes rubber-stamping"). Answerable in ~90 seconds by someone who knows the business, not the code. It catches precisely the class agents are worst at: the confidently wrong domain model.

**Minutes per review.** 90s–3min for the 20–30% of PRs that escalate (class-based triggers: money/auth/PII, contract changes, falsified assumptions, low quiz score, out-of-band calibration). 70–80% auto-merge into a one-line-each daily digest. 5% of auto-merges randomly sampled for human read — **the only plan that audits its own auto-merge tier**, which is what makes auto-merge safe rather than blind.

**Attention routing — unique in the field.** Human queue priority = `(1 − confidence) × blast_radius × novelty`. No other plan ranks the human's queue at all. Under overload, F degrades gracefully (the human sees the least-trusted, highest-consequence work first); every other plan degrades arbitrarily (FIFO or whatever GitHub shows).

**Load over time: grows sub-linearly, doesn't shrink.** Escalation is class-based but there is no E-style "this class never returns" ratchet; 20–30% of a growing PR volume is a growing absolute number. The purple-team loop (falsifications become mechanical falsifiers) shrinks *agent* rework, not human touches.

**Economics.** Bounded by construction: refuter budgets are explicit (20 tool calls / 10 min standard), mutation is diff-scoped, and most of the falsification load is carried by model-independent, near-free mechanisms (effectscan, config probes, deadcode, lints). Five artifacts per PR is real ceremony — but F pre-commits the kill metric this lens exists to demand: track `artifacts a human actually opened / artifacts produced`; below 10% for two weeks → delete artifact types, starting with calibration entries. "I would rather ship this plan at 60% of its design than defend all five artifacts." That sentence is worth a point on its own.

**Drift guards.** URs cannot drift from code — effectscan enforces two-way prose↔effect coverage on every PR, so the documentation (which the URs become) is CI-verified against reality. Assumptions expire and force recheck. Decisions carry falsifiers; a falsified decision breaks builds in its blast radius. ASM-000 even pre-registers the falsification test for the plan itself. Honest admitted weakness: Goodhart on the lints — 198-word explanations that pass everything and say nothing, expected to degrade "over months rather than weeks," with the 5% audit as the canary. The gate most likely to rot is named, and its canary is named.

**Rubber-stamping.** Strongest anti-sycophancy design: refuter starved of the builder's rationale (shared reasoning is contagion), different model family, and SURVIVED reports schema-rejected unless they contain ≥5 attacks with executed commands and outputs — "I reviewed the code and it appears correct" is un-submittable.

**Score: 7.5/10.** Best per-PR artifact, best triage, only audited auto-merge tier, bounded costs with a pre-committed ceremony-kill switch. Docked for the absent load-shrink ratchet and the admitted months-scale Goodhart decay of its central gate.

---

## 2. Scores

| Plan | Score | One-line justification |
|---|---|---|
| **B — Simulation** | **8.0** | Cheapest verification per merged unit (CPU, not model calls); receipt asks an answerable product question; only plan whose verifier is itself tested (museum, sometimes-assertions, shakedown cross-check). Flaw: every PR still reaches the human. |
| **F — Falsification** | **7.5** | Best PR artifact and only ranked human queue + audited auto-merge; bounded budgets and a pre-committed ceremony kill-switch. Flaw: no load-shrink ratchet; teach-back lint will Goodhart over months. |
| **C — Strangler** | **7.0** | Promotion Card is the most answerable human question anywhere ("is measured risk acceptable"); load shrinks to a measured zero — but only for the ~60% with an oracle; dual-run cost unbounded in duration; the UI overhaul (a core requirement) falls outside the design. |
| **D — Generate** | **6.0** | Best load concentration and parallelism; but the human must be a generator-semantics expert (constraint violated), and nobody reviews the actual codebase — a generator bug ships everywhere with zero eyes. |
| **E — Factory** | **5.0** | Owns the best individual mechanisms (seeded defects, evidence-bound review, reject→ratchet loop) inside the worst economics (3–8× tokens, one mis-settable tunable) and an admitted unguarded meta-system — the audit's failure mode rebuilt at the center. |
| **A — Contracts-First** | **4.0** | Undefined review question ("is this correct?" — unanswerable), linear unbounded verifier spend, load grows with no triage or reduction loop, and the frozen spec prose has no drift guard — the exact documented failure it was written to prevent. |

## 3. Strict ranking

**B > F > C > D > E > A.**

**Winner on this lens: Plan B (Simulation).** The decisive facts: (1) the human is asked something they can actually answer, backed by evidence a machine gathered rather than an agent's opinion; (2) verification cost scales with hardware while every review-agent-based plan scales with model calls per PR; (3) it is the only plan whose own machinery carries a working drift guard — the bug museum mutation-tests the harness, unreached sometimes-assertions fail CI, and shakedown catches the simulator lying. B wins *despite* its bandwidth flaw (no auto-merge tier), because that flaw is trivially patched with F's escalation/digest/sampling layer, whereas the other plans' flaws (unanswerable questions, expert-only review, unbounded dual-run, unguarded meta-process) are structural.

## 4. Salvage list — mechanisms that most reduce human load or most improve review trust

1. **C's Promotion Card + question inversion.** Never ask the human to certify correctness; ask them to certify a *measured* risk, with the rollback command and drill date printed on the card. Portable to any plan that can produce numbers.
2. **E §5.4 — the reject ratchet.** Every human rejection auto-creates a regression test + a machine-check ticket; the same class never returns; human-touches-per-merged-PR is a tracked metric with a downward target. The only mechanism in six plans that makes human load *fall* monotonically. Steal it wholesale.
3. **E's seeded-defect audits.** The only instrument anywhere that measures whether review (agent *or* human) is real rather than performed. Cheap, unannounced, with a numeric escalation threshold.
4. **E's evidence-bound review.** An approval with an empty `checks_performed` block is rejected by CI. Kills prose approval and most agent-to-agent sycophancy for the cost of a schema lint.
5. **F's UR-as-PR-body + effect coverage.** The comprehension artifact, the PR summary, and the living documentation are one machine-verified object — the summary cannot drift from the diff because effectscan diffs them. This is how you get "simple explained short summary PRs" that are *guaranteed* not to be fiction.
6. **F's human-queue ranking** (`(1−confidence) × blast_radius × novelty`) **+ auto-merge with daily digest + 5% audit sample.** The complete async triage layer every other plan is missing; the audit sample is what keeps auto-merge from becoming blindness.
7. **B's verifier-drift guards**: bug museum (mutants must stay caught), sometimes-assertion never-fires gate, shakedown running the same checkers against real containers. Apply the pattern to *any* meta-machinery: the harness must be continuously falsified too.
8. **B's simulation receipt** proof block (seeds clean / museum N/N / newly-reachable states) — machine-gathered evidence in the PR header, so trust attaches to numbers, not to an agent's paragraph.
9. **E/F's silence-as-decision**: exactly one question per PR, with a pre-selected default, and a bounded silence-merge window — the correct primitive for a human who is asleep 12 hours a day. (Pair with C's rule that evidence keeps accumulating while a card waits.)
10. **D's Model Change Report + `linguist-generated` diff suppression + escape hatches with CI-failing expiry dates.** Reviewing the decision instead of its forty consequences, and mechanically preventing generated noise from ever entering a human's diff view; expiring escape hatches are the right template for any "temporary" mechanism.

## 5. Discard list — ceremony to cut, and unbounded costs

- **A's per-PR adversarial reviewer agent.** Linear, unbounded model spend that "finds what it happens to think of." Replace with mechanical gates (B's sweep, F's mutation/effectscan) and keep adversarial model review only where D puts it: on the few decision-level artifacts.
- **E's org costume**: nine role charters, role memory files, handoff records, PS as a standing role, WIP limits (E itself would "delete first"), and the agent-pulled andon cord (E predicts ~zero pulls). Keep the five mechanical checks; delete the personnel department.
- **E's recurring pre-mortems** beyond milestone boundaries — kept only under its own kill rule (two consecutive pre-mortems producing no new machine check → delete).
- **F's calibration ledger in months 1–2** (F admits: noise until hundreds of resolved claims) and ASM-delta artifacts the moment the opened/produced ratio drops — F pre-commits this deletion; hold it to it.
- **B's human-reads-every-PR default.** Without an auto-merge tier this is ceremony that will be informally abandoned (unaudited) within weeks; formalize the abandonment with F's layer instead.
- **D's full six-generator bootstrap before any product**, and any model-schema expression creep (`guard:`→`unless:`→DSL). D's own 15%-by-M3 kill criterion is the fence; enforce it.
- **C's entire Fig apparatus if week-one QPS is trivial** (C's own instruction: adopt A, keep only the Fig + expand/contract) — and C's weekly rollback drills on contracted read-only endpoints, which drill a rollback nobody will ever use.
- **Unbounded costs to cap explicitly**: C's dual-run duration (two systems' operating cost with no terminal date — put a hard sunset per bounded context or don't start); E's fixed weekly process overhead (invariant to throughput); A's verifier spend; D's generator maintenance + DSL surface.
- **Artifacts generated but never read, across plans**: role memory files (E), handoff records (E), refutation-report bodies beyond the summary block (F), SDR/ADR prose without machine triggers (A, B, C), hole-PR "reviews" that are skims in name only (D — convert honestly to auto-merge + sampling).

## 6. The one thing all six plans get wrong

**Every plan optimizes the cost of a single review and none maintains the reviewer.** All six shrink the per-PR artifact — a receipt, a card, a report, a 5-line summary, a UR — and every one of those artifacts asks the human a *local* question whose answer secretly depends on *global* context: "is this the behavior we want?" (B), "is this risk acceptable?" (C), "does this explanation make sense?" (F) are only answerable by someone who still holds a current model of the whole system in their head. But the process each plan designs guarantees the human never builds or refreshes that model: for months they see only decontextualized 150-word fragments, so their judgment quality decays at exactly the rate the system grows — and their approvals decay from decisions into reflexes. Plan A admits the problem in one self-critique line and does nothing; E audits whether *agent* review is real (seeded defects) but never audits the human's; F samples auto-merges but never measures whether the human's 90 seconds still discriminates. Not one plan contains the two cheap mechanisms this actually needs: (1) a regenerated, drift-proof *system state briefing* — "here is what hg-mono now is, what changed this week, and the three decisions trending toward irreversibility" — that keeps the human's global model current enough for their local answers to mean something; and (2) occasional seeded defects aimed at the *human*, so someone measures the day their review stops being real. Over months, under these plans as written, the human becomes the drifted document: an approval process describing a reviewer who no longer exists.
