# v1 — WAVE 1 integration report (honest)

_Author: consolidation pass on the `integration` branch. Date: 2026-08-15._

> **Bottom line up front: v1 is NOT complete.** WAVE 1 delivered the **backend
> API surface and the cross-module seams** to a genuinely gate-green state
> (144/144 contract operations validated against a live Postgres, full Go suite
> passing). The four apps remain **v0 core-flow slices**, several launch items
> are **blocked on the client**, and the ~24 deferred v1 operations are not
> built. This report states, per workstream, what actually landed and what was
> actually verified — distinguishing evidence I reproduced from self-reports I
> did not re-run in isolation.

---

## 0. What WAVE 1 was

Twelve increments, each built in its own isolated worktree on a `feat/*` branch,
following a TDD stage discipline (Stage 1 RED → Stage 2 GREEN → Stage 3 boundary/
leak audit → Stage 4 adversarial hardening). They fall in three families plus one
gap-closer:

| # | Workstream | Branch | Scope |
|---|---|---|---|
| 1 | admin-orders | `feat/gap-adminorders` | `listOrdersAdmin`, `getOrderAdmin`, `cancelOrderAdmin` (A-38) |
| 2 | orders-read | `feat/gap-ordersread` | `getOrderTracking`, `getOrderReceipt`, `getOrderRiderPublicProfile` |
| 3 | restaurant | `feat/gap-restaurant` | all 19 restaurant operations |
| 4 | rider | `feat/gap-rider` | 8 rider self-service operations |
| 5 | account | `feat/gap2-account` | account package (profile/self-service) |
| 6 | addresses | `feat/gap2-addresses` | addresses package (CRUD + default) |
| 7 | admin-menu | `feat/gap2-adminmenu` | 4 menu-moderation ops (A-19) |
| 8 | auth-totp | `feat/gap2-authtotp` | `changePassword`, `enrollTotp`, `verifyTotpEnrolment`, `disableTotp` |
| 9 | seam-capture | `feat/seam-capture` | capture on accept (T6), void on reject (T7) — orders↔payments seam |
| 10 | seam-dispatch | `feat/seam-dispatchlc` | dispatch assignment machine wired to order lifecycle |
| 11 | seam-realtime | `feat/seam-realtime` | transactional-outbox realtime event on every state transition |
| 12 | more-admin | `d6d81c3` (detached) | offer expiry + wave escalation (D-15); restaurant go-live wiring; admin order joins/media |

**Note:** WAVE 1 is **backend-and-seams**, not apps. The four apps (`feat/app-*`,
Aug 13) are a *prior* wave and are covered here only under "remaining for v1".

---

## 1. Integration state — the surprise, stated plainly

**All 12 increments are already merged into the `integration` branch.** They were
not left as 12 loose worktrees waiting to be merged; the consolidation already
happened, in dependency order (gap → gap2 → seam → more-admin), with explicit
reconciliation merges in the history (e.g. `4e95299 merge: gap2 features …
reconciled matrix`).

- `integration` is **168 commits ahead of `main`**, **0 behind**.
  `git merge-base main integration == main`, so `main` is a strict ancestor.
- Therefore **`main` → `integration` is a clean fast-forward.** There is no
  three-way merge to reconcile between the 12 increments — that work is done and
  its result is what I verified below.

Evidence:
```
main:        87479ed
integration: 29de109
merge-base:  87479ed          # == main
integration ahead of main: 168 ; main ahead of integration: 0
```

---

## 2. Real verification status (reproduced on the `integration` tree)

I verified the **consolidated** result, which is stronger than the 12 isolated
self-reports — but I did **not** re-run each worktree's increment in isolation. So
per-workstream status below is "green as part of the merged whole," not "re-proven
standalone." Infra used: the running `hg-postgres-1` / `hg-minio-1` / `hg-redis-1`
containers (healthy, 8h uptime); store/conformance tests otherwise spin their own
Postgres via testcontainers.

### Backend gate — every step reproduced GREEN

| Check | Command | Result |
|---|---|---|
| Build | `go build ./...` | **PASS** (exit 0) |
| Vet | `go vet ./...` | **PASS** (exit 0) |
| Format | `make fmt-check` | **PASS** (exit 0) |
| Contract drift | `make generate-check` → `git diff internal/contract/` | **PASS** — regenerated, **NONE** (no drift, not hand-edited) |
| Unit + integration tests | `go test ./...` | **PASS** — every package `ok` |
| Contract conformance | `go test -run Conformance …` with `HG_TEST_POSTGRES_DSN` set | **PASS — 144/144 operations validated** |
| Generated TS client | `pnpm --filter @hg/api-client typecheck` | **PASS** (`tsc --noEmit` clean) |

Test-function counts by wave package (evidence the suites are substantial, not
token): account 71, addresses 62, admin 140, auth 85, restaurant 87, rider 79,
orders 81, dispatch 26, realtime 19, payments 44.

Conformance evidence (against the live migrated DB — 119 public tables):
```
coverage_test.go:125: conformance coverage so far: 144/144 operations validated
conformance: validated 144/144 contract operations (see COVERAGE.md)
```
The oracle is `openapi3filter.ValidateResponse` (kin-openapi) enforcing
`additionalProperties:false` + `required[]` + closed enums on every live 2xx
response.

### ⚠️ The one honest caveat on "144/144"

The conformance gate is **fail-open on skip.** Without `HG_TEST_POSTGRES_DSN`, a
bare `go test ./...` reports the conformance package as `ok` while **every
conformance test SKIPs and coverage is 0/144** — and the gate does *not* fail:

```
coverage_test.go:125: conformance coverage so far: 0/144 operations validated
--- PASS: TestConformance_CoverageAccountability
```

So the "144/144" claim is real **only when CI sets the DSN against a live migrated
Postgres.** A CI job that forgets the env var goes green having validated nothing.
This is the single most important operational risk in WAVE 1 (see §5).

### Per-workstream verdict

| # | Workstream | Verdict | Basis |
|---|---|---|---|
| 1 | admin-orders | **PASS (as-merged)** | admin pkg 140 tests + conformance ops covered; Stage-4 closed money+error-taxonomy leaks in cancel |
| 2 | orders-read | **PASS (as-merged)** | orders pkg green incl. `ordersread_regression_test.go`; Stage-4 fixed 3 real bugs |
| 3 | restaurant | **PASS (as-merged)** | restaurant 87 tests incl. `stage4_regression`; 19 ops conformant |
| 4 | rider | **PASS (as-merged)** | rider 79 tests; Stage-4 closed 500-leaks, enum drift, dashboard earnings bug |
| 5 | account | **PASS (as-merged)** | account 71 tests incl. Stage-3 boundary + Stage-4; token-uniqueness race closed |
| 6 | addresses | **PASS (as-merged)** | addresses 62 tests; second-default `23505` + silent bad-data writes closed |
| 7 | admin-menu | **PASS (as-merged)** | admin `handler_menu_conformance_test.go`; enum-drift 500 + DTO drift closed |
| 8 | auth-totp | **PASS (as-merged)** | auth 85 tests; **notably closed a `disableTotp` mandatory-MFA bypass + `changePassword` session leak** — a real security fix |
| 9 | seam-capture | **PASS (as-merged)** | restaurant/payments green; test asserts no capture/void on a failed transition |
| 10 | seam-dispatch | **PASS (as-merged)** | dispatch 26 tests; `TestAcceptIsRaceFree` de-flaked; row created on `RunWave`, bridge failures made visible |
| 11 | seam-realtime | **PASS (as-merged)** | realtime 19 tests; transactional-outbox invariant locked with negative + nil-emitter regressions |
| 12 | more-admin | **PARTIAL / thinner evidence** | D-15 offer expiry + restaurant go-live landed and build/tests pass, but this was a detached-HEAD catch-up ("two under-scoped v0 gaps"); least isolated of the twelve, weakest standalone provenance |

No workstream is currently **FAIL** on the integration tree. "PARTIAL" on
more-admin reflects provenance, not a known defect.

---

## 3. Integration plan — merging WAVE 1 into `main`

Because consolidation already happened on `integration`, the plan is not a 12-way
merge; it is **promote `integration` to `main` cleanly, after resolving four
uncommitted artifacts that live only in the working tree.**

### 3a. Dependency order (already realised in `integration`)
1. **gap / gap2 packages first** (account, addresses, admin-orders, admin-menu,
   auth-totp, restaurant, rider, orders-read) — leaf handlers, no cross-module
   dependence beyond auth/store.
2. **seams next** (capture → dispatch-lc → realtime) — these depend on the order
   state machine and the handlers above existing.
3. **more-admin last** (D-15 expiry, go-live wiring, admin joins) — depends on
   dispatch + restaurant + media.

This is the exact order in `main..integration`; re-doing it is unnecessary.

### 3b. Resolve the four working-tree artifacts (BLOCKER before promotion)
These are **untracked / modified and belong to no branch** — a naïve
`git checkout main` would strand or lose them:

| Artifact | State | Recommended action |
|---|---|---|
| `services/hg/cmd/seedpw/`, `cmd/seedtotp/`, `cmd/totpnow/` | untracked | Commit as dev-only seed helpers (they are the documented `make seed` workaround). Build-verified (compile clean). |
| `packages/design-tokens/` | untracked (has `package.json`, `src`, `tokens`, and a stray `node_modules`) | Commit **without** `node_modules`; add to workspace + `.gitignore` the nested modules. Do not fast-forward main over this silently. |
| `deploy/docker-compose.isolated.yml` | untracked | Commit as the isolated-stack compose (referenced by the parallel-worktree workflow). |
| `pnpm-lock.yaml` | modified | Reconcile against whichever package additions land; regenerate with `pnpm install` and commit deliberately. |

### 3c. Promotion sequence
1. Commit/curate 3b on `integration` (or a short `chore/pre-main` branch).
2. Re-run the full gate **with `HG_TEST_POSTGRES_DSN` set**:
   `make check` (fmt-check + vet + generate-check + test + conformance) and
   `pnpm check`.
3. Fast-forward `main` to `integration` (or squash if a clean single history is
   wanted — the branch names encode the audit trail either way).
4. **Prune the ~40 stale worktrees/branches** (`feat/gap*`, `feat/gap2*`,
   `feat/seam*`, `feat/be-*`, `feat/app-*`, `worktree-wf_*`). They are all merged
   or superseded; leaving them invites merging the same work twice. Use
   `git worktree remove` + branch delete (non-destructive to `main`).

### 3d. Shared-file reconciliation
The one recurrent shared file across increments is the **authz matrix** (rebuilt
repeatedly — see the `fix(auth): reconcile matrix …` commits going
`57→78→84→98 actions`). It is already reconciled at HEAD; any future increment
must re-run the reconciler (it scans all module `.go` files) before merge. The
generated `internal/contract/` is regenerated, not hand-merged — never resolve it
by hand.

---

## 4. What remains for a TRUE v1 (per workstream and beyond)

WAVE 1 closed the **backend API + seams**. v1 still needs:

**Apps (the bulk of remaining product work — currently v0 slices):**
- `apps/customer` (~18 files), `apps/rider` (~14), `apps/restaurant-web` (~12),
  `apps/admin` (~12) are **core-flow slices**, not complete products. v1 needs:
  customer order history/reorder, profile, saved addresses, notifications,
  ratings; rider onboarding, earnings/payouts, documents, history; restaurant
  hours/settings, staff, payouts, menu editor; admin disputes, refunds,
  rider/restaurant management, system dashboards. Each screen needs empty/
  loading/error, verified through the UI.

**Backend tail:**
- The **~24 deferred v1 operations** (not in the 144 core surface) once the app
  surfaces need them.
- Cart price-snapshot migration; per-handler adoption of generated contract
  types; rider `phone_alias` (overlaps O-03).

**Cross-cutting / hardening:**
- The 15–25 invariant test suite as a named suite; a security-review pass
  (note: WAVE 1 already fixed a live MFA-bypass — treat auth as high-attention);
  observability/OTel.

**Blocked on the client (config flips, seams already exist):**
- **O-03 SMS / A2P** — no phone sign-in until an A2P sender is approved (longest
  lead time in the project). `SMSSender` seam ready; dev uses a logger.
- **Stripe live** — `Stripe.Configured()` gate; flip = env keys.
- **O-01 HST** — tax computed; needs registration number (+ possible
  supplier-of-record branch).
- **O-05 province / O-06 self-declared halal / O-04 refund liability** — defaults
  coded (Ontario / hide); flip = config.

---

## 5. Top risks / blockers

1. **Conformance gate is fail-open on skip.** Without `HG_TEST_POSTGRES_DSN` the
   144/144 evaporates to 0/144 and CI still greens. **Fix: make the gate fail
   when the DSN is absent in CI**, or pin a required-infra check. Highest-severity
   item because it can silently rot the product's core guarantee.
2. **Four uncommitted working-tree artifacts** (§3b) can be lost on promotion; one
   (`design-tokens/`) carries a stray `node_modules`. Must be curated before any
   branch switch on the main tree.
3. **~40 stale branches/worktrees** create real risk of double-merging or merging
   an unreconciled matrix. Prune before promotion.
4. **Apps are thin.** The largest slice of v1-by-effort is untouched app breadth;
   do not let backend green read as "v1 nearly done."
5. **Client blockers** (esp. O-03 SMS/A2P) gate *launch* regardless of eng state.
6. **more-admin provenance** — the only increment with weaker standalone
   verification; give it a focused review during promotion.
7. **First real `make up`/deploy still unexercised at scale** — infra is up in dev
   but the compose stack has never run in a prod-like setting.

---

## 6. Candid completion estimate

- **Backend core API surface + invariants + seams:** effectively **v1-complete and
  gate-green** — 144/144 conformant, seams (capture/void, dispatch lifecycle,
  realtime outbox) proven, the order money/state invariants hold. Call it ~90%,
  with the ~24 deferred ops and the tail remaining.
- **Apps:** ~**20–30%** of v1 product breadth (core-flow slices only).
- **Launch readiness:** gated by client blockers (SMS/A2P, Stripe, HST), which are
  config flips but not yet flipped.

**Weighted, honest overall: roughly 55–65% to a true v1.** WAVE 1 did the hard,
correctness-critical middle; the remaining 35–45% is dominated by app buildout,
the deferred operations, hardening, and the client-blocked config. **v1 is not
complete, and should not be represented as complete.**
