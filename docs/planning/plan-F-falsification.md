# Plan F — Feynman Falsification & Teach-Back

**Build hg-mono so that no line of code survives unless (a) an agent can explain it from first principles in plain language and (b) an independent agent tried hard to prove it wrong and failed.**

---

## 0. The thesis, and why it is different from Plan A

Plan A's diagnosis: *unverified work accumulates faster than anyone catches it.* Its cure: machine checks — contracts, coverage gates, drift detection, adversarial review as a step in the pipeline.

Plan F's diagnosis is narrower and, I claim, closer to the actual failure mode we can observe in the existing HalalGoes codebase: **every one of the real bugs passed every machine check that existed.**

Look at the evidence in `fleet/hg-api-core.md`:

| Real defect | Type-checked? | Compiled? | Tests would have been green? |
|---|---|---|---|
| `CacheModule` hardcodes `redis://localhost:6379`, unreachable inside Docker | ✅ | ✅ | ✅ (unit tests mock the cache) |
| `WorkflowIds.restaurantNotification` doc says "Deterministic", code returns a random id and drops `orderId` | ✅ | ✅ | ✅ |
| `rider:<id>:location` written with `GEOADD`, read with `GET`/`JSON.parse` | ✅ | ✅ | ✅ (writer and reader tested separately) |
| `sendRiderOrderRequestWorkflow` awaits `condition()` with **no timeout** | ✅ | ✅ | ✅ |
| `sendWebSocketNotificationWorkflow` returns `success: true` even when the activity reported failure | ✅ | ✅ | ✅ |
| Push/email/SMS workflows exist with **no activity implementations anywhere** | ✅ | ✅ | ✅ (never invoked) |
| `OrderChannelNotificationActivities` — unregistered, send logic commented out, always returns 0 | ✅ | ✅ | ✅ |
| WebSocket `connect_user` trusts a client-declared `userId` — anyone can drain anyone's queue | ✅ | ✅ | ✅ |

Eight defects. Zero caught by anything a stricter contract or a coverage gate would have caught. What they share is not a missing test — it is that **nobody, human or agent, ever had to say out loud what the code did.** Every one of them dies the instant someone is forced to explain it in a paragraph a non-programmer could follow:

> "When the app asks for a cached price, we look it up in Redis at `localhost`." — *Wait. Which machine is `localhost` inside a container?*

> "Each restaurant notification gets an id built from the order id, so retries don't double-send." — *Then why does the function ignore its `orderId` argument?*

That is the whole plan. **Machine checks verify conformance; they cannot verify comprehension. Plan F makes comprehension the gate.**

Two mechanisms, both automated, both producing artifacts that double as the human-facing PR summary:

1. **Teach-back (Feynman).** No increment merges unless it ships an *Understanding Record* — a ≤200-word, jargon-free, causally complete explanation that a machine can check against the code's actual effects, and that a deliberately naive model can read and correctly answer questions about. Unexplainable code is presumed misunderstood: it gets simplified or rejected, not merged with a TODO.
2. **Falsification (Popper).** Nothing is accepted because it passed. It is accepted because named claims survived deliberate, budgeted, *recorded* attempts to refute them — by adversarial agents, by mutation testing, by chaos experiments, by config probes. Corroboration is logged with its cost ("survived 7 attacks of these kinds"), never mistaken for proof.

Around those sit an **assumption registry** (every belief written down with the cheapest experiment that would kill it) and **confidence calibration** (agents state probabilities; probabilities are scored; scores route scarce human attention).

Contracts, protobufs, coverage, linting — we still do all of it. Plan F's position is simply that **schema conformance is the weakest gate in the stack**, and we should stop budgeting our attention as though it were the strongest.

### Grounding (research, not vibes)

- **Illusion of explanatory depth** (Rozenblit & Keil 2002): people rate their understanding of causal mechanisms far above reality, and the illusion *collapses specifically when they are made to write the explanation out*. It is strongest for causal-mechanism knowledge — precisely what distributed order flows are — and weaker for facts or procedures. This is the empirical basis for teach-back as a gate rather than a nicety.
- **Self-explanation effect** (Chi et al.; meta-analytic g ≈ 0.55): generating explanations improves comprehension and transfer well beyond re-reading. Expecting to teach changes how knowledge gets organized (Nestojko et al. 2014).
- **Popper / falsificationism**: universal claims ("this is idempotent") cannot be verified, only corroborated or refuted; one counterexample settles it. Modern operationalization: the POPPER framework (Huang et al., ICML 2025) has LLM agents design *sequential falsification experiments* against measurable implications of a hypothesis, with statistical error control — direct precedent for agent-run refutation.
- **Chaos engineering**: literally Popper for distributed systems — declare a *steady-state hypothesis*, then try to disprove it under real-world faults. We adopt the vocabulary verbatim.
- **Mutation testing** (Google TSE 2021; Facebook ICSE-SEIP; `gremlins`/`go-mutesting` for Go): the only widely-deployed technique that falsifies *the test suite itself*. Diff-scoped mutation is the practical form.
- **Pre-mortem / prospective hindsight** (Klein 2007; Mitchell, Russo & Pennington 1989): imagining failure as already-having-happened improves identification of failure causes ~30% versus forward-looking critique.
- **Assumption mapping** (risk × certainty matrix, riskiest-assumption-test): the product-discovery practice we borrow for the assumption registry.
- **Red/blue/purple teaming**: separation of the person who builds from the person who attacks, with a shared debrief. We use purple-team debriefs, not just red-team reports.
- **Counter-evidence we take seriously** (see §10): Turpin et al. 2023, *Language Models Don't Always Say What They Think* — model-generated explanations are systematically unfaithful; they can be plausible and confidently wrong, and unmentioned features drive the actual output. This is the single strongest argument against Plan F and it shapes several design choices below.

---

## 1. Planning system — the Ledger

Three artifact families, all plain files in the monorepo under `/ledger`, all machine-parseable, all diffable.

### 1.1 Decision records with mandatory falsifiers — `/ledger/decisions/DEC-nnn.md`

Standard ADR plus two required fields that ordinary ADRs lack:

```yaml
id: DEC-014
title: Orchestrate sagas with an in-repo Postgres stepper, not Temporal
status: accepted            # proposed | accepted | falsified | superseded
confidence: 0.75
falsifier: >
  We are wrong if EITHER (a) step throughput needs to exceed ~500/s sustained,
  OR (b) the nemesis suite shows lost or duplicated step execution under
  8 concurrent workers that we cannot fix in under one day, OR (c) three
  separate PRs need bespoke retry semantics the stepper cannot express.
review_when: [M2 complete, any nemesis failure on saga durability]
escape_hatch: DBOS Transact-Go (library, Postgres-backed, no server to run)
```

A decision without a falsifier is not a decision, it is a preference. CI (`ledgerlint`) rejects `status: accepted` without a non-empty `falsifier` and a `review_when` trigger. When a falsifier fires, the DEC flips to `falsified` and every file referencing it appears in a re-examination list.

### 1.2 Assumption registry — `/ledger/assumptions/ASM-nnn.yaml`

This is the anti-`localhost:6379` machine. Every belief that code depends on but does not verify gets a row:

```yaml
id: ASM-007
statement: "Every service's cache client reaches the same Redis the rest of the
            service uses, in every environment we deploy to."
confidence: 0.55
risk: high                 # blast radius: cache correctness across all services
blast_radius: [services/*/internal/cache, deploy/compose/*.yml]
falsification_test: test/config/deps_match_manifest_test.go
status: holding            # untested | holding | falsified | retired
last_checked: 2026-08-09
expires: 2026-11-09        # unchecked assumptions rot; expiry forces recheck
```

Mechanics that make this real rather than a wiki page nobody reads:

- **Code links assumptions.** In Go: `// ASSUME(ASM-007): cache addr comes from CACHE_ADDR env, never a literal`. `asmlint` (a `go/analysis` pass) enforces bidirectional integrity: every `ASSUME(...)` names an existing ASM; every ASM with `risk: high` has ≥1 code reference and a non-empty `falsification_test` that actually exists and actually runs in CI.
- **Cheapest-experiment rule.** The registry field is not "how would we validate this properly", it is *the cheapest observation that would kill it*. For ASM-007 that is eleven lines: boot compose, `SET` through the app's cache client, `GET` from `redis-master` with `redis-cli`, assert present. Eleven lines that the entire existing platform never wrote.
- **Expiry.** High-risk assumptions expire in 90 days. On expiry CI opens a re-verification work order automatically. Assumptions that were true in month one and quietly stopped being true are the second-largest bug family after unexplained code.
- **Falsification cascades.** When an ASM flips to `falsified`, `asmlint` fails every PR touching its `blast_radius` until each file is re-examined and re-signed. Falsification is not a note; it is a build break with a precise scope.
- **Bootstrapping.** Milestone 0 seeds the registry from the fleet analysis: every "likely bug" and "hardcoded value worth flagging" in `hg-api-core.md` becomes an ASM in hg-mono *before* the corresponding code is written.

### 1.3 Understanding Records — `/ledger/understanding/UR-<pr>.md`

Produced per PR (§3.1), and they *are* the PR body (§4). They are kept, not discarded, because they become the system's real documentation — documentation that CI verifies against code, which is the only kind that stays true. Contrast: the existing platform's docs claim determinism the code does not have.

### 1.4 Pre-mortems at milestone boundaries

Before each milestone opens, one agent writes `PM-<milestone>.md`: *"It is eight weeks later. Milestone N shipped and it is broken. Write the incident report."* Ten failure causes minimum, in past tense (prospective hindsight — this framing is the whole trick; it buys ~30% more identified causes than "what could go wrong?"). Each cause becomes either an ASM with a falsification test, a milestone scope change, or an explicitly accepted risk signed in the milestone doc. Nothing is allowed to be merely noted.

### 1.5 How decisions change

There is no freeze. Plan A freezes a spec pyramid; Plan F holds that a frozen wrong spec is exactly a confident misunderstanding with institutional backing. Instead: decisions are cheap to make, carry explicit confidence, and carry pre-declared conditions under which we abandon them. Changing a decision is normal and requires only that the falsifier fired or a new one is written. What is *expensive* is holding a decision that has been falsified — that breaks builds until resolved.

---

## 2. Execution loop

Four roles, all agents, all asynchronous, communicating only through files in the repo and the work queue. No agent approves its own work.

```
  Cartographer ──work order──► Builder ──artifact+claims──► Refuter ──┬─ FALSIFIED ─► back to Builder
       ▲                          │                                   │              (+ regression test)
       │                          └──► Simplifier (if over budget)    └─ SURVIVED ──► Gatekeeper (CI)
       └────────── milestone pre-mortem, assumption expiry ──────────────────────────────► human queue
```

**Cartographer** — decomposes a milestone into work orders. A work order is not a task description; it is a **claim to be made true**:

```yaml
id: WO-031
claim: "POST /orders persists the order and emits exactly one order.created
        outbox row, in one transaction, or neither."
context_files: [...]
boundaries: "Do not touch pricing. Do not add a new dependency."
refutation_budget: standard          # standard | deep (deep = 2 refuters, 2 model families)
must_register_assumptions_about: [outbox delivery, id generation]
```

**Builder** — works in an isolated git worktree. Red-green-refactor, but the deliverable is four things, not one: the diff, the Understanding Record, `claims.yaml` with calibrated confidences, and ASM registry deltas. The Builder never merges.

**Refuter** — spawned fresh, deliberately starved of context: it receives the **claims and the running artifact**, not the Builder's reasoning or the UR's explanation of *why* things were done. (Why: shared reasoning is contagion. A refuter who reads the builder's rationale inherits its blind spots.) Different model family from the Builder wherever available. Hostile prompt. Budgeted: 20 tool calls / 10 minutes standard, 60 / 30 minutes for `deep`. It must return `FALSIFIED` with a reproducing test, or `SURVIVED` with ≥5 enumerated concrete attacks (§3.2).

**Simplifier** — triggered automatically when the UR blows its budget (>200 words, >7 causal steps, or novice-quiz score < 4/5). Its mandate is not "add comments"; it is "restructure until the honest explanation fits." Frequently this means splitting the PR. Occasionally it means deleting an abstraction. This role exists because otherwise the pressure of an explanation budget gets released as prose engineering instead of design work.

**Throughput.** Stacked branches: WO-032 branches off WO-031 rather than waiting for it to merge, so the factory never blocks on refutation or human review. Refuters run in parallel with the next Builder. Typical wall-clock per PR: build 15–40 min, refute 10–30 min, CI gates 8–12 min, human (when required) whenever they get to it.

---

## 3. Verification — the two gates

This is the core of Plan F. Both gates are automated; neither is a meeting.

### 3.1 Gate 1 — Teach-back

Every PR ships `UR-<pr>.md` with a fixed schema. Five sections, each machine-checked.

**(a) What this does** — ≤200 words, plain language.

Checked by `teachback-lint`, deterministic and fast:
- Word count ≤ 200. Hard fail.
- Flesch-Kincaid grade ≤ 10. Hard fail.
- Every term outside a common-English wordlist must appear in `/ledger/glossary.yaml`, which itself requires a ≤25-word plain definition per term. Undefined jargon and unexpanded acronyms are hard fails. The glossary is a shared asset; adding "idempotent" once benefits everyone, but you must define it once.
- Banned phrase list: "handles", "manages", "processes", "as appropriate", "properly", "correctly", "etc." — the vocabulary of explanation-shaped text that explains nothing.

**(b) How it works, step by step** — the causal chain, with the effect-coverage check.

This is the mechanism I would keep if I could keep only one. A `go/analysis` pass (`effectscan`) extracts from the diff every **externally observable effect**: SQL statements, Redis commands, outbound HTTP/gRPC, file and object-store writes, goroutine spawns, channel operations, `time.Now()` reads, randomness sources, panics/`os.Exit`, environment reads, and mutations of package-level state. Each is emitted with a stable tag, e.g. `sql:insert:orders`, `redis:geoadd:riders_available_locations`, `rand:crypto`, `time:now`, `go:spawn`, `env:CACHE_ADDR`.

The UR's step list must tag each step with the effects it accounts for. CI then enforces **two-way effect coverage**:

- **Unexplained effect** → red build. You cannot write "we save the order" while quietly spawning a goroutine, reading the clock, and generating a random id. Every effect must appear in the prose. *This is what would have caught the dead Redis fallbacks*: a fallback path is an effect with no line in anyone's explanation.
- **Claimed-but-absent** → red build. If your explanation says "we look up the rider's saved location" and no read effect on that key exists in the diff or the functions it calls, the explanation is fiction. *This is what would have caught `getOnlineRidersFromHash` reading a hash nothing writes*, and the push/email/SMS workflows whose activities do not exist.

**(c) Normative claims must cite evidence.**

`teachback-lint` scans the UR for a closed set of load-bearing adjectives — *deterministic, idempotent, atomic, exactly-once, at-least-once, authenticated, authorized, retried, ordered, consistent, encrypted, validated, rate-limited* — and requires each occurrence to carry a citation: a test id, a claim id, or an ASM id.

Apply it retroactively: `WorkflowIds.restaurantNotification`'s doc-comment says "Deterministic". Under this gate, the word "deterministic" demands `T-xxx` demonstrating `f(a) == f(a)` for the same order. The test is four lines. It fails immediately, because the function ignores `orderId` and returns `nanoid()`. A doc lie that survived into production dies in eight seconds of CI.

**(d) Where I'd look first if this broke** — a written prediction, 1–3 named files or subsystems.

Cheap to write, and it feeds the prediction ledger: when an incident later touches this code, we score whether the prediction was right. Over months this becomes the most honest available signal of whether an agent's mental model was real, because unlike everything else in the pipeline it is scored against reality rather than against another model.

**(e) What I don't understand** — mandatory, non-empty.

"Nothing" is an automatic rejection. Every item must be dispositioned: it becomes an ASM, an issue, or an explicit `IRREDUCIBLE` tag (§10). The point is to make admitted uncertainty a normal, costless act, because the alternative — an agent that always sounds certain — is exactly the failure mode we are here to prevent.

**(f) The Novice Quiz** — automated Feynman "explain it to a child".

A deliberately *weak, cheap* model (small context, no code access, no repo knowledge) reads **only section (a) and (b)** and answers 5 auto-generated behavioral questions:

- "If Redis is unavailable when this runs, what does the caller see?"
- "If this is called twice with the same input, what happens the second time?"
- "Which of these could this code write to: Postgres, Redis, S3, nothing?"
- "What is the slowest thing that happens here?"
- "Who is allowed to trigger this?"

Its answers are then checked against reality — not against another opinion. Where possible, mechanically: the answer to "can this write to Redis?" is checked against `effectscan` output. Where not, a third agent *with* code access grades. Threshold: 4/5 to merge; 3/5 routes to the Simplifier; ≤2/5 blocks.

The quiz is the operationalization of the Feynman step people usually skip. Rozenblit & Keil's result is that the illusion breaks when you produce the explanation; the quiz adds the second half — checking whether the produced explanation actually *transfers*. An explanation that a naive reader cannot use to predict behavior is not an explanation, however fluent.

**(g) Explanation length is the complexity budget.**

If the honest UR exceeds 200 words or 7 causal steps, the increment is too large. It is split, not merged. This replaces line-count PR limits with something better: it measures *irreducible conceptual load*, not typing volume. A 600-line PR that adds one obvious CRUD endpoint explains in 90 words and sails through; a 40-line PR that quietly introduces a second source of truth cannot be explained in 200 words and gets split until each piece can be.

### 3.2 Gate 2 — Falsification

**Nothing merges because it is green. It merges because it survived attack, and the attack is on the record.**

Every PR carries `claims.yaml`:

```yaml
- id: C-031-1
  statement: "POST /orders writes the order row and exactly one outbox row, or neither."
  falsifier: "An orders row exists with no matching outbox row (or vice versa) after
              any crash point, OR two outbox rows for one request."
  confidence: 0.9
- id: C-031-2
  statement: "Two POSTs with the same Idempotency-Key create one order."
  falsifier: "count(orders where idem_key=K) > 1"
  confidence: 0.7
```

Confidence is mandatory and is a real probability (§3.4). "1.0" is rejected by lint — nothing is certain, and an agent that says it is has told you something useful about itself.

**The Refuter agent.** Hostile prompt, budgeted, artifact-only access, running against a live compose stack. Output `refutation-report.md`, schema-linted:

- `FALSIFIED`: must include a reproducing test. That test is **auto-committed to the permanent regression suite before the fix lands**, and it stays forever. Every falsification permanently narrows the space of ways the system can regress.
- `SURVIVED`: must enumerate ≥5 attacks, each with `{hypothesis, command executed, observed output digest, why this did not falsify the claim}`. A report saying "I reviewed the code and it appears correct" fails schema lint — there is no command, no output, no hypothesis. This one rule is what separates real refutation from adversarial-review theater, which is the standard failure mode of "have another agent check it".

Attack playbooks the Refuter draws from, seeded from the fleet analysis and grown every time something escapes: identity spoofing on any user-supplied id; concurrent duplicate requests; crash between write and publish; dependency down / slow / returning garbage; clock skew and DST; empty, huge, and unicode inputs; second call with same key; wrong tenant/region; response inspected for over-disclosure; config value differing between compose and code.

**Mechanical falsifiers** — the machines do the boring attacks so the agents can do the creative ones. These are model-independent, which matters enormously (§10):

1. **Diff-scoped mutation testing** (`gremlins` / `go-mutesting`, mutating only changed lines). A surviving mutant is proof that your tests would not have noticed a *wrong program*. Blocker. This is the direct Popperian upgrade over diff-coverage — it falsifies the test suite rather than counting it. Google's and Facebook's industrial experience says: diff-scoped, with mutant suppression for known-uninteresting operators, is the only form that survives contact with a real repo.
2. **Property and metamorphic tests, auto-scaffolded from claim keywords.** `deterministic` → `f(x)==f(x)` over generated inputs. `idempotent` → `f(f(x))==f(x)` and repeated-request equivalence. `total`/`never panics` → Go native fuzzing. `monotonic`, `ordered`, `commutative` similarly. The Builder gets a generated stub it must fill; the keyword in the claim *creates* the obligation.
3. **The nemesis suite** (chaos, Popperian by construction). A compose profile `nemesis` with toxiproxy in front of Postgres and Redis. Each service declares `steady-state.yaml`: *"p99 `POST /orders` < 400 ms; zero orders lost; zero duplicate charges."* Experiments try to disprove it: kill a replica mid-request, 5 s Postgres latency, Redis eviction, Traefik→service partition, worker SIGKILL mid-saga, clock jump. Nightly, plus on any PR touching saga or persistence code.
4. **Config-reality probes.** Every service exposes `GET /debug/deps` returning the **resolved addresses it actually connected to** — not what it was configured with, what it *reached*. An e2e test asserts this set equals the service manifest's declared dependencies. Plus a lint banning `localhost` / `127.0.0.1` string literals outside `_test.go`. `redis://localhost:6379` in a Docker network cannot survive ten minutes here. Neither can the `MINIO_SECRET_KEY` vs `MINIO_ACCESS_SECRET` name mismatch — the probe fails on a dependency that never connected.
5. **Deadness detector.** `golang.org/x/tools/cmd/deadcode` plus coverage from the *e2e* run, not unit runs. Any exported symbol reachable from no test and no entrypoint is flagged; the PR must either delete it or the UR must explain why it exists. The existing platform carries four empty stub modules registered in the root module, an unregistered activity class with its body commented out, three empty files, and an entire types subsystem with no runtime counterpart. Under this rule none of that can accumulate — the cost of carrying dead code becomes immediate rather than deferred.
6. **Assumption-expiry sweep.** Nightly; opens work orders for expired high-risk ASMs.

**Purple-team debrief.** Weekly, automated: every `FALSIFIED` outcome from the week is clustered by kind, and the top cluster becomes either a new mechanical falsifier or a new item in the Builder's standing checklist. Red-team findings that do not change the blue team's process are wasted; this closes the loop.

### 3.3 What each real hg-api defect meets in Plan F

Not a hypothetical — this table is how the plan was designed, and it is the plan's own falsification test (§10, ASM-000).

| Defect from `hg-api-core.md` | Caught by |
|---|---|
| Cache hardcoded to `localhost:6379` | Config-reality probe (`/debug/deps`), localhost literal lint, ASM-007 |
| Workflow id doc says "Deterministic", code random | Normative-claim citation rule → auto-scaffolded determinism property test |
| `rider:<id>:location` GEOADD-write / GET-read | Effect coverage: two effect tags on one key with incompatible types; explanation must name both |
| `await condition()` with no timeout | Stepper schema makes `deadline_at` NOT NULL — structurally impossible (§5) |
| Workflow returns `success:true` when activity failed | Novice quiz: "if delivery fails, what does the caller see?" — UR and code disagree |
| Push/email/SMS workflows with no activities | Claimed-but-absent effect check; deadness detector |
| `OrderChannelNotificationActivities` dead, logic commented out | Deadness detector; effect coverage (no effects at all for a "send" function) |
| WS trusts client-declared `userId` | Refuter identity-spoofing playbook; M2 is built around exactly this attack |
| Two `RedisService` instances from duplicate providers | Effect coverage (two connect effects); `/debug/deps` shows two connections |
| Prisma query logging on in production | Effect coverage: log effect containing user data must be explained |
| `KEYS` used for scans in production paths | Nemesis steady-state hypothesis on p99 under realistic key counts |

Eleven of eleven. Some of these Plan A also catches (integration tests against real Redis would catch #1 and #3). But #2, #5, #6, #7 are *explanation* failures — the code does something other than what its author believed — and no amount of contract strictness reaches them.

### 3.4 Calibration — making confidence mean something

Every claim, assumption, and decision carries a probability. Outcomes are recorded automatically: falsified by refuter / falsified by CI / falsified in staging / falsified in production / survived 30 days / survived 90 days.

Nightly, `calibrate` computes per-role and per-model **Brier scores** and publishes reliability diagrams to `/ledger/calibration/`. Two uses, both mechanical, neither punitive:

1. **Refutation budget routing.** If claims from a role at stated confidence 0.9 are falsified more than 25% of the time, that role's PRs are automatically upgraded to `deep` refutation (two refuters, different model families) until calibration recovers. Miscalibration buys more scrutiny, not scolding.
2. **Human queue ordering.** Human review priority = `(1 − confidence) × blast_radius × novelty`. Humans see the least-trusted, highest-consequence work first. This is the concrete answer to "human bandwidth is the scarce resource": we do not just make PRs small, we *rank* them by expected information gain from a human look.

Known limits, stated up front: Brier scores need volume (hundreds of resolved claims before the signal beats noise — realistically month three), and "survived 90 days" is a weak positive label since absence of a report is not absence of a bug. We treat calibration as a slow instrument and do not let it gate anything in the first two milestones.

---

## 4. Human review model

**The Understanding Record is the PR body.** This is the plan's best structural bargain: the artifact we force agents to produce for comprehension reasons is *exactly* the artifact a human reviewer needs, and it is already machine-validated to be short, jargon-free, causally complete, and consistent with the code's real effects. We are not adding a summarization step; we are harvesting one.

The rendered PR:

```
[orders] Create an order and tell the rest of the system about it     +212 −8

WHAT THIS DOES  (147 words, grade 8.1, novice quiz 5/5)
When a customer taps "Place order", the app sends us the cart and the address.
We save one row in the orders table. In the same database transaction we also
save a short message in an "outbox" table saying "order 123 was created". A
separate small worker reads the outbox a moment later and tells the other
services. Because both writes happen in one transaction, it is impossible to
end up with an order nobody was told about, or a message about an order that
does not exist. If the customer's phone retries and sends the same request
twice, we notice the repeated Idempotency-Key and return the first order
again instead of making a second one. ...

CLAIMS AND WHAT WE DID TO BREAK THEM
  C-1  order row + exactly one outbox row, or neither   conf 0.90  SURVIVED (7 attacks)
       tried: SIGKILL between writes ×3 crash points, duplicate concurrent POST,
       Postgres 5s latency, outbox worker killed mid-batch, disk-full simulation
  C-2  same Idempotency-Key creates one order           conf 0.70  FALSIFIED → fixed
       counterexample: two concurrent POSTs, same key, 4ms apart → 2 orders.
       Regression test added: test/orders/idem_race_test.go. Fix: unique index.

WHAT I DON'T UNDERSTAND
  - Whether the outbox worker's 200ms poll is fast enough under real load.
    → registered as ASM-031, falsification test scheduled for M2 load run.

WHERE I'D LOOK FIRST IF THIS BROKE:  internal/outbox/publisher.go, then the
  unique index on orders(idempotency_key).

GATES: teachback ✓  effect-coverage ✓ (11/11)  mutation 0 survivors  nemesis ✓
       deadcode ✓  deps-probe ✓  refuter SURVIVED  calibration: role OK (0.11)
```

**The human is asked exactly one question:** *"Does this explanation make sense, and does the diff look like the explanation?"*

Not "is this code correct." A human cannot answer that about code they did not write, in a system they have not held in their head, at the rate agents produce it — and pretending otherwise is how review becomes rubber-stamping. But "is this explanation coherent, and does the diff plausibly match it" is answerable in 90 seconds by someone who understands the business, and it catches a specific and important class of error: **the confidently wrong model.** When an agent has misunderstood the domain, the explanation reads *fine to the agent* and *wrong to the human* — "wait, we charge the delivery fee before the restaurant accepts?"

**Escalation rules** (everything else auto-merges after surviving Gate 1 + Gate 2):

Human review is mandatory when any of:
- the change touches money, authentication/authorization, or personal data;
- it crosses a service boundary or changes a published contract;
- an assumption was falsified, or a new `risk: high` assumption was registered;
- the Refuter returned `FALSIFIED` at any point in this PR's history;
- the novice quiz scored 3/5;
- the authoring role's current Brier score is out of band;
- `IRREDUCIBLE` was claimed.

Empirically this should land somewhere around 20–30% of PRs. The rest merge on the strength of survived refutation, and the human sees them in a **daily digest**: one page, one line per auto-merged PR (the UR's first sentence), with any of them clickable. Sampling: 5% of auto-merged PRs are randomly flagged for a human read anyway, as an audit of the gates themselves — if the gates are being gamed, the sample is where we find out.

**Hard caps:** 400 changed lines; UR ≤200 words; ≤5 claims. Any breach splits the PR.

---

## 5. Orchestration — derive it from the explainability criterion

**First principles.** What does an order-flow orchestrator actually have to do here? Sequence a handful of steps across services; survive process death; retry with backoff; time out long waits (restaurant acceptance, rider acceptance); compensate on failure; and — critically — let an on-call human answer *"what is happening to order 12345 right now?"* in one query.

Now add Plan F's selection rule: **choose the mechanism whose failure modes an agent can teach back in 200 words and a human can verify by looking.**

Temporal fails that test — not because it is bad software (it is excellent) but because its correctness rests on machinery that is invisible at the call site: event-history replay, workflow determinism constraints, the sandbox, versioning/patching, task-queue routing, worker-bundle boundaries. An honest teach-back of "what happens if this worker dies mid-workflow" cannot be compressed into plain language without lying. And we have direct evidence of what that costs on this exact product: ten separate worker registrations, a workflow bundle that imports signal definitions across a module boundary, a `condition()` awaited with no timeout, workflow ids documented as deterministic and generated randomly, and workflows for push/email/SMS whose activities do not exist. Those are not Temporal's bugs. They are what confident misunderstanding looks like when the substrate is too subtle to explain.

**Choice: an explicit saga state machine in Postgres, driven by a ~400-line in-repo `stepper` package.**

```sql
create table saga_runs (
  id            uuid primary key,
  kind          text not null,              -- 'checkout'
  correlation   text not null,              -- order id
  state         text not null,              -- current step name
  status        text not null,              -- running|done|failed|compensating|compensated
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null
);

create table saga_steps (
  id              bigserial primary key,
  run_id          uuid not null references saga_runs(id),
  name            text not null,
  status          text not null,            -- pending|running|done|failed|compensated
  attempt         int  not null default 0,
  max_attempts    int  not null,
  idempotency_key text not null,            -- effects are keyed, so retries are safe
  run_after       timestamptz not null,     -- backoff / scheduling
  deadline_at     timestamptz not null,     -- NOT NULL: every wait must time out
  compensate_with text,                     -- declared inverse step
  last_error      text,
  unique (run_id, name, attempt)
);
```

Workers: `SELECT ... FROM saga_steps WHERE status='pending' AND run_after <= now() ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 10`. Execute the named step function. Effects carry the idempotency key. Cross-service effects go through a transactional **outbox** written in the same transaction as the step's state change. A separate sweeper marks steps past `deadline_at` as failed and enqueues their compensation.

Why this, from first principles:

1. **The state is one query away.** `SELECT * FROM saga_steps WHERE run_id = (SELECT id FROM saga_runs WHERE correlation='12345')`. Twelve rows, human-readable, in the same database as the business data. The teach-back is verifiable by *looking*, which is the only kind of explanation that cannot rot.
2. **The failure semantics fit in three sentences.** "Each step runs at least once. Each step's effects are keyed so running it twice does nothing extra. If a step fails all its attempts or passes its deadline, we run its named undo step and walk backwards." That is a complete and *true* mental model. There is no fourth sentence about replay determinism.
3. **`deadline_at NOT NULL` makes the rider-acceptance bug structurally impossible.** The single most dangerous line in the existing platform — `await condition(...)` with no timeout, bounded only by a caller-supplied workflow timeout that surfaces as a crash rather than a graceful "nobody accepted" — cannot be expressed in this schema. Long waits are rows with deadlines, not blocked goroutines.
4. **Zero new infrastructure.** Postgres is already there. Compose gets no Temporal server, no Elasticsearch, no UI container, no namespace configuration. Every container removed from compose is a container that cannot be misconfigured.
5. **It is small enough to read completely.** ~400 lines. An agent can teach back the *entire orchestrator*, not just its own usage of it. Nothing else on the shortlist has that property.

**Deliberate divergence from Plan A.** Plan A puts orchestration behind a `Saga`/`Orchestrator` port and adopts River. Plan F declines the port: at this size, an interface whose only implementation is 400 lines of readable Go is an abstraction that costs comprehension and buys optionality we have no evidence of needing. We buy optionality differently — with a falsifier and a pre-vetted escape hatch (DEC-014 above):

- If the nemesis suite demonstrates lost or duplicated step execution under 8 workers that we cannot fix in a day → adopt **River** (Go-native, Postgres-backed queue) for the claiming/retry layer, keeping our step tables.
- If durable-execution ergonomics (long-lived workflows, human-in-the-loop waits, versioning) become the real bottleneck → adopt **DBOS Transact-Go**: durable workflows as a *library* over the Postgres we already run, no server to operate. This preserves the "one query away" property, which Temporal does not.
- If neither happens, we never pay for either.

**Async messaging between services**: outbox → a small relay → Redis Streams (already in the stack; consumer groups give at-least-once with visible pending lists — again, inspectable by query). NATS JetStream if the nemesis suite falsifies Streams' durability under our failure model.

---

## 6. Deployment — docker compose + Traefik, with deployment claims treated like code claims

The distinctive move: **the deployment has claims and gets refuted, exactly like a function does.** "It deploys" is not a status, it is a hypothesis under continuous attack.

Stack: Traefik v3 (label provider + one static file), Postgres, Redis, MinIO, four Go services (`orders`, `catalog`, `identity`, `realtime`), the outbox relay, and a `nemesis` profile with toxiproxy. Compose profiles: `core`, `e2e`, `nemesis`, `load`.

```yaml
  orders:
    build: ./services/orders
    environment:
      DATABASE_URL: postgres://app@postgres:5432/hg
      CACHE_ADDR:   redis:6379          # no literal 'localhost' survives lint
    labels:
      - traefik.enable=true
      - traefik.http.routers.orders.rule=PathPrefix(`/api/orders`)
      - traefik.http.services.orders.loadbalancer.server.port=8080
      - traefik.http.services.orders.loadbalancer.healthcheck.path=/healthz
      - traefik.http.services.orders.loadbalancer.healthcheck.interval=2s
    healthcheck:
      test: ["CMD", "/app/healthcheck"]
      interval: 5s
    deploy:
      replicas: 2
```

Every service template mandates `/healthz` (process alive), `/readyz` (dependencies reachable), `/debug/deps` (resolved addresses actually connected to), `/metrics`.

Standing deployment claims, each with an automated falsification attempt:

| Claim | Falsification test |
|---|---|
| DEP-1 Killing any single replica loses zero in-flight requests | `vegeta` at 200 rps, `docker kill` a replica mid-run, assert zero non-2xx and zero orphaned saga rows |
| DEP-2 No service reads a hardcoded host; all config comes from env | localhost-literal lint + `/debug/deps` equals declared manifest |
| DEP-3 The stack boots cold (no volumes, no images cached) in < 120 s to all-ready | nightly cold-boot timing test |
| DEP-4 Traefik routes every declared path to exactly one service | route-table diff against `deploy/routes.yaml`, generated from service manifests |
| DEP-5 Scaling `orders` to 4 replicas increases throughput ~linearly to 4× | load profile run at 1/2/4 replicas, assert ≥ 3× at 4 replicas |
| DEP-6 No service starts successfully with a missing required env var | boot each service with each required var removed; assert fast, loud failure |

DEP-6 deserves a note: the existing platform's `RedisService` swallows connection errors in `onModuleInit` "so the app still boots." An app that boots without its database is an app that lies about being healthy. Plan F's template fails loudly at startup and `/readyz` stays false — because "we are up" must be a claim that can be falsified, and swallowed errors make it unfalsifiable.

E2E runs against the *composed* stack in CI on every PR (core profile), and against the nemesis profile nightly.

---

## 7. UI/UX overhaul

Same philosophy, applied to interfaces: **an interface you cannot explain in plain words is one users cannot use, and a screen with only a happy path is an unfalsified claim.**

**Screen Understanding Records.** Before any pixels, each screen ships a `SUR-<screen>.md`, ≤150 words, same lint:
- What can a person do here? (verbs, in their language — "see how far away my food is", not "renders `OrderTrackingView`")
- What do they see while waiting?
- What do they see when it fails?
- What do they see the very first time, with no data?
- What is the single most important thing on this screen?

**The Empty / Slow / Broken triad.** Every screen must demonstrate three non-happy states before it can merge: empty (no orders yet, no restaurants nearby), slow (network at 3 s latency — real skeletons, not spinners-forever), broken (backend 500, connection lost mid-order). Screenshot-tested via Playwright (web) and Maestro (Expo). A screen with only the happy path is a hard CI failure. The existing platform's mock screens and four divergent regional configs are what happens without this rule.

**Automated 5-second test.** A fresh model with no context sees the rendered screenshot and answers: "what is this screen for, and what is the main thing you'd do here?" Its answer is compared against the SUR's stated purpose and primary action. Mismatch = the design is unclear, not the model. This is the novice quiz for pixels, and it is cheap enough to run on every visual diff.

**Build order.** (1) `packages/design` — tokens (color, type scale, spacing, radius, motion), then primitives (Button, Field, Sheet, Money, Address, StatusPill, EmptyState, ErrorState). All four surfaces consume it; a screen importing a raw color literal fails lint. (2) Flows before screens: order → track → arrive; go online → accept → deliver; receive → accept → mark ready. (3) Screens.

**Surfaces.** Customer app (Expo/React Native), rider app (Expo), restaurant tablet app (Expo, large-touch layout), admin web (Next.js). One design system, four consumers, one `Money` component so a rounding bug can only exist in one place.

**Real-user falsification.** Every milestone ends with three real people (a rider, a restaurateur, a customer) doing the flow unaided while recorded. Their confusion is a counterexample — logged as a falsification of a SUR, with the same weight as a failing test. No amount of internal agreement substitutes; this is the one gate in the whole plan that no model participates in.

---

## 8. Migration from the existing HalalGoes system

Strangler fig, framed as falsification of one over-arching claim: **"hg-mono behaves like the existing system, except where we deliberately chose otherwise, and we have written down every exception."**

**Phase 0 — Behavior archaeology (M0–M1, runs in parallel).** For each legacy endpoint and workflow, an agent writes a plain-language teach-back of what it *actually does* — read from code *and* production logs, never from docs. Output: `/ledger/legacy/<area>.md` plus `divergence.yaml` (intended differences). This phase's real product is a list of places where the existing docs and the existing code disagree; we already know several (deterministic workflow ids, `requiresAuth` channel metadata that nothing enforces, MinIO env names, a `queued` counter that never increments). Copying a system you have only read the docs of is how confident misunderstanding gets inherited wholesale.

**Phase 1 — Traefik in front of both.** hg-mono's Traefik becomes the single entry point; unmatched paths proxy to the legacy NestJS API. Day-one change, zero user-visible effect, and it makes every later step a routing rule.

**Phase 2 — Shadow traffic.** Traefik mirroring duplicates read traffic to hg-mono. A comparator logs response divergences by endpoint. **Every divergence is a falsification event** and is triaged into exactly one of: new code is wrong (fix), archaeology was wrong (update the legacy record — valuable!), or intended divergence (record in `divergence.yaml`). Shadowing is how we get falsification pressure from *production reality* rather than only from our own imagination, which is the thing our imagination is worst at.

**Phase 3 — Cut over one bounded context at a time,** in ascending order of blast radius: catalog/feed (read-mostly) → identity & real-time (the security fix, high value) → orders/checkout → payments (last, most dangerous). Per context: dual-write via outbox where state is shared, backfill with a reconciliation job that reports row-count and checksum deltas, then flip the Traefik rule, then keep the legacy path warm for 14 days with a one-line rollback.

**Data.** Keep the existing Postgres. Prisma-generated schema becomes hand-reviewed SQL migrations (`goose`); hg-mono reads shared tables during transition and takes ownership one context at a time. Redis keys are re-namespaced under `v2:` so old and new cannot collide — the existing key registry has three overlapping queue mechanisms and two parallel channel schemes, and we are not inheriting that ambiguity.

**Seeded counterexamples.** Before writing the corresponding feature, every known defect from the fleet analysis is committed as a *failing* test in hg-mono: unauthenticated WS connect must be rejected; workflow ids must be deterministic; a rider's location must round-trip through the same data type; a cache write must be readable from the container Redis; a notification whose delivery failed must not report success; queue drain must not be destructive for other users. The regression suite starts non-empty on day one, populated entirely by mistakes that were already made once.

---

## 9. Milestone sequence — the first three deliverables

### M0 — "The Explainable Skeleton" (week 1)

One service (`orders`), one endpoint (`POST /orders` → one row + one outbox row), behind Traefik in compose at 2 replicas, plus the entire gate machinery live:

- `teachback-lint`, `effectscan` (effect coverage both directions), glossary, novice quiz runner
- `claims.yaml` schema + Refuter agent + `refutation-report.md` schema lint
- Diff-scoped mutation testing, Go fuzz harness, property-test scaffolder
- `asmlint` + registry seeded with ~15 assumptions from the fleet analysis
- `/healthz`, `/readyz`, `/debug/deps`, config-reality probe, localhost-literal lint, deadcode gate
- Nemesis profile with one experiment (kill a replica under load) + first `steady-state.yaml`
- Calibration job (collecting, not yet gating)
- Pre-mortem PM-1 written and dispositioned

**Definition of done:** a human opens one PR, reads a 147-word explanation and a refutation report listing 7 attacks, answers one question, and merges. And: the seeded-bug audit (ASM-000, §10) has been run.

**Cost honesty:** this is a week with almost no product in it. That is the plan's bet.

### M1 — "The Saga You Can Read" (weeks 2–3)

The `stepper` package and the checkout saga skeleton: create order → authorize payment → notify restaurant → *wait for accept (deadline row)* → assign rider → *wait for accept (deadline row)* → complete, with declared compensations for each. Payment, restaurant and rider are stubs with injectable failure and latency.

Falsification focus: nemesis kills workers at each of 9 crash points; asserts exactly-once *effects* via idempotency keys, zero orphaned runs, every deadline fires, every compensation runs exactly once, and that `SELECT * FROM saga_steps WHERE run_id=…` tells an on-call human the whole story.

Headline claim: **"An in-flight order's complete state is one SQL query away, and every saga terminates — in success, failure, or compensation — within its declared deadlines."**

### M2 — "Authenticated Real-Time" (weeks 4–6)

Replace the WebSocket free-for-all with: token-derived identity (server never trusts a client-supplied `userId`), per-channel authorization actually enforced, and at-least-once delivery via a per-user cursor instead of the current destructive drain. Plus the first customer screen (order tracking) on the design-token package, with demonstrated Empty/Slow/Broken states.

Falsification focus: a red-team agent with a valid customer token attempts to (1) connect as a rider, (2) join an order channel it is not party to, (3) drain another user's notification queue, (4) replay a token after logout, (5) subscribe to `admin:system:alerts`. All five are known-successful attacks against the current system. Each becomes a permanent regression test. This milestone is chosen third because it is where falsification pays for itself most visibly — security bugs are exactly the class where "it works" and "it is correct" diverge.

---

## 10. Honest self-critique

I am obliged by my own philosophy to state where this fails, so here it is without softening.

**1. Explanation ≠ correctness, and this is the plan's central vulnerability.** Turpin et al. (2023) showed that model-generated explanations are *systematically unfaithful*: they are influenced by features the explanation never mentions, and they are plausible precisely when they are most misleading. A fluent agent can write a beautiful, coherent, wrong UR — and the reviewer's confidence will *rise*. Worse, a coherently-wrong model will also produce a coherent novice-quiz transcript, because the quiz grades derivability from the explanation, not truth. If I am honest about where the weight really sits: **the effect analyzer, mutation testing, config probes, deadcode detection and chaos experiments are the model-independent gates, and they carry most of the load. Teach-back carries the rest by making mismatch cheap to *notice*, not by proving correctness.** Anyone reading this plan as "explanations make code correct" has read it wrong. The claim is narrower: explanations make *a specific and currently-invisible failure class* visible.

**2. Goodhart will come for the lints.** A word-list check measures readability, not truth. Agents will converge on 198-word explanations that pass every lint and say nothing — "we save the order and tell the other services" with correct effect tags and no insight. Countermeasures (rotating quiz generators, 5% human audit sampling, banned-phrase lists) are real but partial, and I expect this to degrade over months rather than weeks. The 5% audit is the canary; if audited PRs start reading as boilerplate, the gate has been captured and must be redesigned.

**3. "Independent" refutation is approximate.** Builder and Refuter drawn from the same model family share priors and therefore share blind spots — a bug that is invisible to one is often invisible to the other. Different families help; artifact-only access helps; the mechanical falsifiers (which do not reason at all) help most. But there is no configuration in which "independent agent review" is genuinely independent, and I would not claim otherwise.

**4. The ceremony cost is real and could sink this.** Five artifacts per PR (UR, claims, refutation report, ASM deltas, calibration entry). At 30 PRs/week that is 150 artifacts weekly. If agent time is cheap this is fine. If *human* attention leaks into curating, reconciling, or arguing about them, the system inverts and becomes an elaborate way to produce paperwork. **Explicit kill metric:** track `artifacts a human actually opened / artifacts produced`. If it falls below ~10% for two consecutive weeks, delete artifact types — starting with calibration entries, then ASM deltas — until it recovers. I would rather ship this plan at 60% of its design than defend all five artifacts.

**5. Calibration is a slow, weak instrument.** Brier scores over 40 resolved claims are noise; you need hundreds. "Survived 90 days" is a weak positive label — absence of an incident report is not absence of a bug, especially pre-launch when nobody is using the thing. Calibration will not be actionable before month three, and routing human attention by a noisy score early would be worse than random.

**6. The simplification bias is a genuine hazard.** "If you cannot explain it, simplify it" is *wrong* for irreducibly hard things: geospatial indexing, currency rounding and reconciliation, payment settlement, TLS, timezone/DST arithmetic, consistent hashing. The rule pressures the system toward the explainable-but-inferior algorithm. Escape valve: an `IRREDUCIBLE` tag granting a 500-word UR budget and mandatory human expert review — but a valve that is used too readily reopens the original hole, and one used too rarely means we are shipping naive geo queries. I do not have a principled boundary here, only a quarterly review of every `IRREDUCIBLE` tag.

**7. Falsification is unbounded; corroboration is not proof.** "Survived 7 attacks" means those 7 attacks failed. The refuter's budget is arbitrary, chosen for cost. Popper's own point cuts against any comfort we take from a `SURVIVED` report: reality has an unbounded attack budget and a longer time horizon. The reports risk creating exactly the false confidence they were meant to prevent, dressed in more credible clothing than a green checkmark.

**8. Slower start than Plan A.** M0 spends roughly a week building gate machinery before a single product feature exists. If the project is cancelled at week three, Plan A shipped more. The bet is that the crossover comes early (I would guess week 5–6, when defect-rework begins dominating) — but it is a bet, and a project under acute delivery pressure should probably run Plan A's walking skeleton first and layer Plan F's gates onto it in week two. **These two plans are more compatible than competitive**, and if I am being maximally honest, the strongest program is Plan A's structure with Plan F's Gate 1 and mechanical falsifiers bolted on.

**9. The illusion of explanatory depth applies to this document.** I have written a fluent, confident explanation of a system that does not exist, which is the exact epistemic position the plan warns about. So it gets an assumption row, and it should be tested *before* the program commits:

```yaml
id: ASM-000
statement: "Teach-back + falsification gates catch confidently-wrong code at a
            materially higher rate than adversarial review plus strict contracts."
confidence: 0.6
risk: critical
falsification_test: >
  Week 1, day 3. Take 20 real defects from the fleet analysis. Reconstruct each
  as a synthetic PR in the hg-mono skeleton. Run two pipelines blind:
  (A) contracts + coverage + adversarial reviewer, (F) full Plan F gates.
  Measure catch rate and cost per catch. Plan F is falsified if it catches
  fewer than 14/20, or fewer than 4 more than pipeline A, or costs more than
  3× per PR.
status: untested
```

If ASM-000 fails, we adopt Plan A and keep only the mechanical falsifiers. Writing that sentence is the plan's own teach-back: I have said what would make me wrong, and what I will do about it.

---

### Sources

- [Rozenblit & Keil, *The misunderstood limits of folk science: an illusion of explanatory depth*, Cognitive Science 2002](https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog2605_1) · [The Decision Lab summary](https://thedecisionlab.com/biases/the-illusion-of-explanatory-depth)
- [Turpin et al., *Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting*, NeurIPS 2023](https://papers.neurips.cc/paper_files/paper/2023/file/ed3fea9033a80fea1376299fa7863f4a-Paper-Conference.pdf)
- [Huang et al., *Automated Hypothesis Validation with Agentic Sequential Falsifications* (POPPER), ICML 2025](https://icml.cc/virtual/2025/poster/44356) · [code](https://github.com/snap-stanford/POPPER)
- [Principles of Chaos Engineering (steady-state hypothesis)](https://principlesofchaos.org/) · [Defining a steady state hypothesis, Litmus](https://litmuschaos.github.io/tutorials/tutorial-defining-steady-state-hypothesis/index.html)
- [Petrović, Ivanković et al., *Practical Mutation Testing at Scale: A view from Google*, TSE 2021](https://homes.cs.washington.edu/~rjust/publ/practical_mutation_testing_tse_2021.pdf) · [*What It Would Take to Use Mutation Testing in Industry — a Study at Facebook*](https://arxiv.org/pdf/2010.13464) · [gremlins (Go)](https://github.com/go-gremlins/gremlins)
- [Klein, *Performing a Project Premortem*, HBR 2007](https://www.researchgate.net/publication/3229642_Performing_a_Project_Premortem) · [Veinott et al., *Evaluating the Effectiveness of the PreMortem Technique*, ISCRAM 2010](https://idl.iscram.org/files/veinott/2010/1049_Veinott_etal2010.pdf)
- [Assumption mapping (risk × certainty)](https://maze.co/blog/assumption-mapping/) · [Pip Decks Assumption Map](https://pipdecks.com/pages/assumption-map)
- [Red vs blue vs purple teaming](https://www.praetorian.com/security-101/red-team-vs-blue-team-vs-purple-team/)
- [Brier score & reliability diagrams](https://www.statstest.com/calibration-checks-brier-score-reliability-diagrams) · [Calibration and Correctness of Language Models for Code](https://openreview.net/attachment?id=VDZkSSpa_b&name=pdf)
- [Feynman technique & self-explanation evidence](https://whennotesfly.com/concepts/learning-science-knowledge/feynman-technique-learn-anything-faster) · [Falsifiability in software testing](https://muuktest.com/blog/falsifiability-in-software-testing)
- [DBOS Transact-Go — Postgres-backed durable workflows as a library](https://github.com/dbos-inc/dbos-transact-golang) · [DBOS vs Temporal](https://tiarebalbi.com/en/blog/dbos-vs-temporal-postgres-durable-execution)
