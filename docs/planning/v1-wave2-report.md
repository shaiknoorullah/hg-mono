# Halal Goes — v1 Wave 2 Integration Report

_Date: 2026-08-15 · Branch: `integration` · Merge commit: `4edac27`_

This report is written to the standard of the repo's AGENTS.md: **claim only what
was observed by running the real gate.** Nothing below is a self-report from a
buildout agent — every "verified" line was reproduced in the main `integration`
tree against live Postgres.

---

## 1. What this wave was

Merge the five wave-2 buildout increments into `integration` in dependency order
(backend ops before the app screens that consume them), reconcile shared files,
and run the real gate.

**Finding on arrival:** the four app increments existed as _uncommitted working-tree
changes_ inside their worktrees (`wf_663c431d-618-2..5`), each branched from the
current `integration` HEAD and touching **only** `apps/<name>/` plus `pnpm-lock.yaml`.
The "deferred backend ops" increment (`more-admin` worktree) was **already merged**
into `integration` — its conformance test was byte-identical to the committed one,
and its `COVERAGE.md` was an _older_ 94/144 copy versus integration's 144/144. So
the dependency ordering was already satisfied: backend ops landed first, app screens
merged on top.

No worktree touched `contracts/`, `packages/api-client/`, or `services/hg/migrations/`
— so the contract stayed generator-owned (no hand-edits) and migrations stayed
monotonic (00001–00020, untouched). The only shared file needing reconciliation was
`pnpm-lock.yaml`, regenerated once via `pnpm install` after merging admin's new
`package.json` deps (mapbox-gl, lytenyte-core, @types/mapbox-gl).

---

## 2. Per-workstream: what landed + real verification

| Workstream | What landed | Verified by |
|---|---|---|
| **Customer** | Addresses (list/form/default), Orders list, Notifications, Profile, Rate-order, tab bar; new api modules (addresses, orders, notifications, profile, ratings) | `apps/customer typecheck: Done` under `pnpm check` |
| **Rider** | Onboarding, Earnings, Payout detail, Delivery history, Profile; sha256 helper, apiTypes | `apps/rider typecheck: Done` |
| **Restaurant** | Payouts, Settings, Staff, Edit-item dialog; Shell + icons + menu edits | `apps/restaurant typecheck: Done` + `lint: Done` |
| **Admin** | Orders + Order-detail, Refund cases, Rider queue + application detail, Dependency dashboard; LiveMapBox, KeysetGrid, HealthPill, format/health libs; new deps (mapbox-gl, lytenyte) | `apps/admin lint: Done` + `typecheck: Done`; lockfile reconciled |
| **Deferred backend ops** | Dispatch offer-expiry (D-15), restaurant go-live wiring, admin read projections — **already in `integration` before this wave** | Conformance `getOrderAdmin`, `listOrdersAdmin`, `listMenuReviewQueue` PASS; 144/144 tally |

Screen/page counts now in tree: customer 11, rider 9, restaurant 9, admin 10.

---

## 3. The real backend gate (run from `services/hg` against live Postgres)

Env: `HG_TEST_POSTGRES_DSN=postgres://hg:***@localhost:5432/hg?sslmode=disable`
(Postgres `hg-postgres-1` up 9h, healthy).

| Step | Result |
|---|---|
| `go build ./...` | **PASS** (`BUILD_OK`) |
| `go vet ./...` | **PASS** (`VET_OK`) |
| `make generate-check` | **PASS** — `git diff --exit-code` on `types.gen.go` clean; contract types not stale, not hand-edited |
| `go test ./...` | **PASS** — all 23 packages `ok` (account, admin, auth, orders, payments, realtime, restaurant, rider, notify, conformance, …) |
| `go test -run Conformance -v ./internal/conformance/...` | **PASS** — real per-op output, **174 `--- PASS` lines, 0 FAIL, 0 SKIP** |

Conformance is genuinely exercised, **not a silent 0/144 skip**. Final tally, quoted
verbatim from the run:

```
=== RUN   TestConformance_CoverageAccountability
    coverage_test.go:125: conformance coverage so far: 144/144 operations validated (final tally enforced in TestMain)
--- PASS: TestConformance_CoverageAccountability (0.00s)
PASS
conformance: validated 144/144 contract operations (see COVERAGE.md)
ok  	github.com/shaiknoorullah/hg-mono/services/hg/internal/conformance	3.659s
```

Sample per-op PASS lines observed: `getRiderDashboard`, `listAddresses`,
`listNotifications`, `listOrdersAdmin`, `getOrderAdmin`, `listMenuReviewQueue`,
`rejectOrder`, `delayOrder`, `acceptOrder`, `TestConformance_CartHalalSeal`.

**Note (not a failure):** `TestConformance_Reachability` PASSES but logs two
advisory DRIFT notes — `getOrder` and `getCustomerProfile` return 200 where the
auth-matrix/route registration expected 403/405. These are pre-existing advisory
observations the test is designed to surface, not gate failures.

---

## 4. The frontend gate — `pnpm check` at repo root

**`PNPM_CHECK_EXIT=0`.** Runs contract validation → `pnpm -r lint` → `pnpm -r typecheck`
→ `check:backend` (`make check`). All 13 workspace projects lint + typecheck clean,
including all four apps. L-4 no-green-solids lint clean.

**One fix applied to get here:** `pnpm check`'s `check:backend` runs the fuller
`make check`, which includes `fmt-check`. That flagged `cmd/hg/main.go` as not
gofmt-clean — a **pre-existing** stale import ordering committed in `433855c` (the
notify-module merge), untouched by this wave. Applied `gofmt -w cmd/hg/main.go`
(a 2-line import reorder); re-ran → `PNPM_CHECK_EXIT=0`.

---

## 5. Remaining for a true v1 (honest)

The gates are green, but green here means **types compile, contract conforms, and
the Go server answers all 144 operations correctly against Postgres.** It does not
mean the product is done:

- **App screens are typecheck-verified, not runtime-verified.** No agent booted the
  customer/rider Expo apps or the admin/restaurant Vite apps against the live
  backend and clicked through the new flows. "Compiles" ≠ "works on device."
- **Near-zero app-level tests** (customer 0, rider 0, restaurant 0, admin 1). The
  breadth is wide, the test net under the apps is thin.
- **Admin depends on `mapbox-gl`** — needs a real Mapbox token + network to render
  `LiveMapBox`; unverified visually.
- **Human-blocked launch items still open** (per `docs/decisions/README.md`):
  O-01 HST registration, O-03 SMS/A2P (nobody can sign in without phone OTP),
  O-04 refund liability, O-05 launch province, O-06 self-declared listing.
- **Compose stack**: Postgres/Redis/MinIO are up and the gate ran against them, but
  the full app-to-backend wiring in a deployed environment is unproven.
- The `TestConformance_Reachability` DRIFT notes on `getOrder` / `getCustomerProfile`
  deserve a deliberate decision (widen contract 2xx table, or fix route/auth).

---

## 6. Candid completion estimate

**Backend (Go binary): ~90% of v1.** Builds, vets, 144/144 conformance, full test
suite green against Postgres. Remaining 10% is deploy-time wiring, the two
reachability drift decisions, and the human-blocked SMS/tax gates that no code can close.

**Frontend apps: ~55–65% of v1.** Breadth is in and typechecks, but "verified" stops
at the compiler. Runtime verification against the live backend, a real test net, and
device/browser smoke passes are the bulk of what stands between here and shippable.

**Overall v1: roughly 65–70% complete. Not done.** This wave delivered integrated,
type-safe breadth across all four apps with a fully green real backend gate — a solid
integration milestone, not a finished product.

---

## 7. Housekeeping

- Merge commit `4edac27` on `integration` (50 files, +5763/−107).
- `pnpm-lock.yaml` regenerated (not hand-merged); migrations monotonic; contract
  generator-owned and drift-free.
- Stale prior-wave branches `feat/be-orders` / `feat/be-orders-ops` (172 behind;
  their orders module already in `integration`) and the six merged wave-2 worktrees
  pruned.
