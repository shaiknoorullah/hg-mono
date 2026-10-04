# Session report

The work that produced this repository, what was decided, what was found, and what was got wrong. Written as a handoff: a new session on another machine should be able to read this and continue without archaeology.

---

## 1. What was asked, and what happened

The task began as "analyse three repos," became "evaluate a monorepo template as a base," then "plan the rebuild," and finally "build it." The repository is the output of that last phase; `docs/analysis/` and `docs/planning/` are the outputs of the earlier ones and explain *why* the code looks the way it does.

Order of work:

1. **Forensic analysis** of `hg-api`, `halal-goes`, `hg-docker` — 19 parallel agents, 18 reports → `docs/analysis/legacy-system/`
2. **Base evaluation** of `ts-monorepo-template` — 4 agents → `docs/analysis/base-evaluation/`. Verdict: harvest, don't fork.
3. **Operating-model tournament** — 6 competing plans, 3 independent judges, 1 synthesis → `docs/planning/`
4. **Specification** — the client SOW made technically unambiguous: 198 features, 141 decisions → `docs/spec/`
5. **Contract** — OpenAPI 3.1, 144 operations, 80 enums → `contracts/`
6. **Contract kit** — generated client, 311 fixtures, mock server
7. **Design system** — tokens, 41 components, patterns, accessibility → `docs/design/`
8. **Component libraries** — 81 components across native and web, plus two galleries (since removed — component review happens in the [UI/UX rework](https://github.com/shaiknoorullah/hg-mono/milestone/16))
9. **Backend foundation** — Go skeleton, compose stack, 91-table schema

## 2. The findings that shaped everything

Four discoveries from the legacy analysis drove most of the invariants in `AGENTS.md`.

**The published backend was not the one serving production.** Git forensics: the rider app was calling `api.halalgoes.com` five days *before* `hg-api`'s first commit, and frontends kept integrating new endpoints for 116 days after it went silent. About 60 called endpoints had no handler in the source. The only surviving specification of the real system was the frontends' HTTP calls. This is why the contract is now the single source of truth and is machine-checked.

**Checkout charged a client-supplied price.** The server never recomputed. And because the pricing endpoint was itself broken (it fed a cart ID into an order lookup), the client's value stayed at its all-zero default — so orders were written with **every monetary field zero**. Hence: the server prices every order, and inbound DTOs may not carry price fields.

**Money had no closure.** Rider earnings were never credited; ratings were collected and never sent. No invariant, no diff, no dead code, no runtime symptom — nothing any review or test would have caught, because nobody had ever stated the property. Hence the double-entry ledger with a zero-residual trigger, and the Closure Ledger concept.

**Live credentials were committed in cleartext.** `hg-api/minio/.minio.sys` contained a working admin-scoped service account, and the rider KYC bucket was world-readable *and* world-writable. Hence: private buckets, presigned URLs only, and secrets never in the tree.

## 3. Decisions of record

Client decisions and every reconciliation are in `docs/decisions/README.md`. The ones with the widest blast radius:

- **A Go modular monolith, not microservices.** The previous system was eight services with a workflow engine; the request was explicitly to reduce volume. Packages call each other as functions, so there is nothing to orchestrate across.
- **Temporal is replaced by `deadline_at` plus a ticker.** Three of the six competing plans independently converged on a deadline-mandatory schema — the strongest signal in the tournament — and the smallest implementation won.
- **Authorise then capture.** Capture on restaurant acceptance; reject and timeout *void*. Free cancellation becomes voiding an authorisation rather than issuing a refund, which deletes the entire "refund failed" failure class.
- **0% commission at launch**, delivery fee passed through entirely to riders. This means the platform *loses roughly $1.30 per order* to Stripe fees. That is an accepted acquisition cost, not an oversight; the service-fee mechanism ships set to zero so it is correctable by configuration.
- **Halal is a precondition for listing, not a filter.** Offering a filter would teach customers that uncertified listings exist. A missing halal field renders no badge. No halal state is ever red — red reads as *haram*, a religious ruling the platform does not make.

## 4. What was got wrong, and corrected

Recorded because the corrections are more instructive than the successes.

**A ten-week timeline was presented for an agent-executed project.** The plans were written in the idiom of the human-methodology corpus they researched, and the units were passed through unexamined. The correction was to separate three clocks: compute (hours, parallel), evidence (uncompressible — you cannot parallelise the arrival of traffic or a weekend of seasonality), and world (Stripe approval, A2P registration, a willing restaurant). Only the first is agent-bound.

**Two agents were over-scoped and produced nothing.** "41 components × 2 themes × every state, plus a gallery" in one task has no natural first file; both spun on planning until killed. Re-dispatched as six agents with strict file ownership, all six succeeded. The lesson is the one the whole plan rests on — small bounded units — and it was not applied to dispatch itself.

**Shared manifests were contended.** Subfolder ownership was assigned but `package.json`, `tsconfig.json` and barrels are inherently shared; several were overwritten mid-flight. Ownership must be assigned per *file*, not per directory.

**A generated directory was hand-edited.** The halal seed fixture was written by hand into `contracts/fixtures/`, then destroyed by the author's own `fixtures:build` run and committed away silently by `git add -A`. It is now emitted by the generator.

**An invariant was cited that does not exist.** A backend agent was told to implement "DEP-6"; nothing in `docs/` matches it — it came from a planning document that never entered the repo. The agent found the real rule (G-7) and implemented that instead. The contract-first design corrected its own author.

## 5. State at handoff

**Complete and verified** (`pnpm check` green, all tests passing):

| Area | Detail |
|---|---|
| Specification | 198 features, SOW-traceable, `docs/spec/` |
| Decisions | 141 surfaced, settled/reconciled/open, `docs/decisions/` |
| Design system | DTCG tokens, 41 components, a11y, `docs/design/` |
| Contract | 144 operations, 249 schemas, 80 enums, all refs resolving |
| Contract kit | Generated client, **311 fixtures**, mock server with scripted WebSocket |
| Components | 81 across native + web, both themes, every declared state |
| Backend | Go skeleton + compose stack; **91-table schema, 59 invariant assertions** |

**Not started:** seven backend domain modules (briefs in `docs/planning/backend-modules.md`); four client apps.

**Never executed:** the docker compose stack. No Docker daemon existed in the authoring environment. It passes `docker compose config` but images, Traefik routing, load balancing and MinIO bucket creation are unexercised. **The first `make up` on a real machine is the real test.**

**Verified on the wrong version:** migrations ran against Postgres 16.13 + PostGIS 3.4.2, not the specified 17 + 3.6. Nothing uses a 17-only feature, but that is inference. CI runs the same sequence on `postgis/postgis:17-3.5`.

## 6. Blocked on a human

From `docs/decisions/README.md`. Two of these gate taking real money:

- **O-01 HST registration + supplier position** — no legal basis to charge tax without it. Accountant.
- **O-03 SMS / A2P registration** — nobody signs in without phone OTP, and approval takes days to weeks. **Longest lead time in the project.** Check whether the old Supabase setup has a usable Twilio account behind it before filing fresh.
- O-04 refund liability allocation · O-05 launch province (default Ontario) · O-06 self-declared halal listing (default: hide)

## 7. Continuing from another machine

```bash
git clone https://github.com/shaiknoorullah/hg-mono && cd hg-mono
corepack enable && pnpm install
pnpm check                              # must be green before you change anything
cd services/hg && make up && make migrate   # the first real test of the stack
```

Read `AGENTS.md` first. It carries the invariants, the layout, the commands and the known gaps — a fresh agent that skips it will rediscover them expensively, or "fix" something deliberate.
