# Frontend completion — integration status

_Wave: frontend-completion. Integrated into `main` on 2026-09-11. Four app worktree
increments merged; gates run; the two web apps re-driven against the live backend._

This is a candid status, not a launch sign-off. Where something is only typecheck- or
build-verified and not exercised at runtime, it says so.

---

## 1. What was merged

Four worktree increments (all uncommitted diffs over the wave base `913a6bb`), one per app,
plus the shared packages and backend files they each touched:

| App | Increment (headline) | Also touched |
|---|---|---|
| **admin** (WT8) | Dependency dashboard explains the by-design `/internal/deps` edge restriction (G-7); refunds/staff screens; error-state copy | `ui-web` (HalalChecklist, MenuItemCard, RestaurantCard, ErrorState), Go: `admin/cursor.go`, `orders/ordersread_store.go` |
| **restaurant** (WT6) | Payouts page: owner-only (P-19) permission boundary rendered as a neutral EmptyState instead of a red error | `deploy/.env.example` (CORS) |
| **customer** (WT7) | Discovery screen + address API | `ui-native/RestaurantCard`, Go: `auth/store_account.go`, `orders/cart_store.go` |
| **rider** (WT5) | Camera capture (`capture.ts`), geolocation (`location.ts`), base64 helper; onboarding/assignment/availability screens; adds `expo-image-picker`, `expo-location` | `pnpm-lock.yaml` |

### Reconciliation of shared files

- **`packages/ui-web/src/tokens/tokens.css` — WT8's hand-edit was REJECTED.** WT8 hand-edited
  this generated file to rebrand gold → red (`#FFC220` → `#C1272D`) and swap the UI font
  (Inter → Plus Jakarta Sans) **without touching the source `docs/design/tokens.json`.** That
  violates the repo rule against hand-editing generated files, and the `generate:tokens:check`
  gate would have failed on it. The checked-in file remains the generated gold palette. A
  rebrand of this size is a deliberate design decision: it must go through `docs/design/tokens.json`,
  be regenerated, and carry a `docs/decisions/` entry. All of WT8's other changes were kept —
  the components consume `var(--hg-*)`, so they render correctly against the gold tokens.
- **`deploy/.env.example` — merged.** WT6 and WT8 both widened `HG_CORS_ALLOWED_ORIGINS`;
  taken as the union: `5173,5174,5175,5176,5183,8081,19006`. (The running backend already
  allowed the app ports, so the earlier CORS block the restaurant driver noted is resolved.)
- No other file was touched by more than one worktree. The generated API client was **not**
  edited.

---

## 2. Gates — all green

| Gate | Result |
|---|---|
| `pnpm check` (contract + fixtures + client drift + tokens drift + lint + typecheck + backend) | **PASS** (exit 0) |
| `pnpm -r typecheck` (all 4 apps + 4 packages) | **PASS** |
| admin `build` (Vite) | **PASS** — 2126 modules, incl. mapbox-gl |
| restaurant `build` (Vite) | **PASS** — 131 modules |
| customer `build:web` (Expo export) | **PASS** — 320 modules, 798 kB |
| rider `build:web` (Expo export) | **PASS** — 399 modules, 843 kB |

Backend gate detail: `go vet`, full `go test -race ./...` (incl. the notify suite), and the
kin-openapi conformance run all pass. Contract: 152 operations, 267 schemas; 330 fixtures valid.

---

## 3. Runtime verification (live backend on :8080)

Backend rebuilt with the integrated Go changes (`make up`, postgres seed volume preserved,
387 accounts). Both web apps driven end-to-end with Playwright. Screenshots in `tools/verify/`.

### admin — RUNS (web) — `tools/verify/full-*.png`
Login (email + password + TOTP, single-shot) → 200. Every screen loads against real data:
- onboarding queue, application detail + **halal verification instrument** (Barakah Grill,
  DOCUMENTS_REVIEW, 5 approval blockers in amber **not red**, documents table, "No halal
  certificate on file" empty state) — the core product surface works;
- riders queue, orders grid, refunds, staff, system dashboard — all 200.
- **One defect:** order-detail (`GET /v1/admin/orders/{id}`) returns **500** for one seeded
  order — see §5. The admin app renders a graceful error state ("Something went wrong on our
  side / Try again"), not a crash.

### restaurant — RUNS (web) — `tools/verify/resto2-*.png`
Two-step login (email+password → backend returns `MFA_REQUIRED`/403 → TOTP field revealed →
200). Every screen loads: onboarding, orders, menu, hours, settings, staff — all 200.
- **payouts returns 403 — by design.** `payout.read` is `RESTAURANT_OWNER`-only (P-19); the
  test account is a `RESTAURANT_MANAGER`, so WT6's neutral "Payouts are visible to the account
  owner" EmptyState renders (verified in `resto2-payouts.png`) — a permission boundary, not a
  failure.

> Seed note for reproducing the drives: the rebuilt backend uses the real `HG_APP_DATA_KEY`
> from `deploy/.env`, so TOTP secrets must be seeded with that key (`/tmp/seedtotp`), and
> `resto-qa`'s password was (re)set with `/tmp/seedpw` to `RestoQA@1234`. Drivers:
> `admin-full-drive.mjs` (`APP_URL=http://localhost:5175`), `resto-full.mjs` (5183).

### customer & rider — BUILD + TYPECHECK ONLY this session
Both Expo/React-Native apps typecheck clean and export a web bundle. They were **not**
re-driven at runtime in this session — the task re-drive scope was the two web apps.
Runtime evidence exists from the worktree drives (`tools/verify/rt-*.png` for customer, WT7;
`rider-live2-*.png` for rider, WT5), captured before this integration, so treat those as
prior-wave evidence, not a post-integration re-verification.

---

## 4. Needs an Expo dev build (native surfaces)

The RN apps run on the Expo web target (and web builds pass), but web is a shim. The following
require `expo prebuild` + a custom dev client (Expo Go cannot load the native modules):

- **rider — camera:** KYC document capture (onboarding) and proof-of-delivery photo
  (assignment) via `expo-image-picker`. On web this falls back to a file input; real camera
  capture and QR handoff scanning need a native build.
- **rider — geolocation:** shift go-online fix and position reporting via `expo-location`.
  Web uses the browser Geolocation API; native GPS/background needs a dev build.
- **rider & customer — maps:** live map / Mapbox rendering is only meaningful on a native
  build (customer discovery and address selection work on web without it).

So: rider and customer are **web-verifiable** for their non-native flows, but their defining
native surfaces (camera, QR, GPS, maps) are unverified until someone runs a dev build on a
device or simulator. That is the single biggest gap between "builds" and "shippable" for these two.

---

## 5. Known defects surfaced (not papered over)

1. **admin order-detail 500 — pre-existing backend/seed defect, partially fixed.**
   `admin/store_orders.go` `GetOrder` scans `ST_Y(r.location::geometry)` into a non-nullable
   `float64` (`RestaurantLat`). For a seeded order whose restaurant has a NULL `location`, this
   panics with `cannot scan NULL into *float64` → 500. The contract **requires**
   `restaurant_location`, so the clean fix is either backfilling restaurant coordinates in the
   seed (a restaurant should have a location to operate) or a NULL-guard that keeps the field
   contract-valid. WT8 fixed the *sibling* NULL-scan (rider position, `loadRiderForOrder`) and
   that fix IS integrated; this second site was out of the wave's scope and remains. Not
   introduced by this integration.
2. **`/internal/deps` unreachable from the browser — by design (G-7), now explained.** Traefik
   restricts `/internal` and `/debug` to `127.0.0.1`; a browser is refused. WT8's dependency
   dashboard now states this is intentional rather than showing a transport error.

---

## 6. Candid completion estimate

- **Contract, gates, builds:** done and green. High confidence.
- **admin (web):** functionally complete and runtime-verified end-to-end, minus the one
  backend seed/NULL-guard defect above. ~95%.
- **restaurant (web):** functionally complete and runtime-verified end-to-end, including the
  owner-only payouts boundary. ~95%.
- **customer (Expo):** non-native flows build and (per prior worktree evidence) run on web;
  maps and any device-only flow unverified pending a dev build. Call it ~75% verified.
- **rider (Expo):** most complete-looking increment on paper (camera + GPS + onboarding), but
  its defining surfaces — camera, QR handoff, GPS, maps — are exactly the ones that need a dev
  build and are therefore **unverified at runtime**. Web bundle builds. Call it ~65% verified.

**Bottom line:** the two web apps are genuinely runnable against the live backend today; the
two React-Native apps compile, typecheck, and bundle for web, but their native heart is
unproven until a dev build is run on a device. Do not read "builds" as "works on a phone."
One real backend defect (order-detail 500) remains and should be ticketed before it is called
launch-ready.
