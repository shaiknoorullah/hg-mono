---
covers:
  - services/hg/cmd/**
  - services/hg/migrations/**
  - apps/restaurant/.claude/skills/**
reviewed: 2026-10-04
---

# Dev world — seeded personas, live scenarios, journey simulation, playbooks

**Status:** design approved 2026-09-28 · **Kind:** dev / QA / testing harness (no product features)
**First app covered:** restaurant web. **Built to extend to:** customer, rider, admin (see [extending to another app](#10-extending-to-another-app)).
**Companion spec:** [`2026-09-28-restaurant-realtime-design.md`](2026-09-28-restaurant-realtime-design.md) — the restaurant app's live-update feature. That spec is product work; this one is tooling. Neither blocks the other's construction (see [relationship to the realtime feature](#11-relationship-to-the-realtime-feature)).

## 1. Problem

The apps can only be exercised against the contract mock (`tools/mock-server`). Taking the restaurant app as the worked example, the mock:

- has no restaurant login (default `login` returns `session_grant_customer`, so the shell labels the operator "CUSTOMER");
- is stateless (Accept returns 200, the card never moves);
- serves one state per operation unless a scenario header is sent, which the app never sends;
- returns duplicated orders (`restaurant_order_queue_busy` repeats IDs).

Every restaurant route is implemented in the Go backend, local payments run on `fakeStripe` when `HG_STRIPE_SECRET_KEY` is unset, and customer OTP defaults to the `log` provider. The backend can carry real end-to-end testing; it has no purposeful data to test with. `migrations/seed/` holds reference data only; `migrations/test/fixtures.sql` serves the conformance suite and its restaurant manager is phone-only, so it cannot sign in to the email + password + TOTP restaurant portal. The one working restaurant login (`resto-qa@demo.hg`) was hand-made in a prior session and is not reproducible.

The mock stays for contract work. Manual, agent-driven and e2e testing moves to the real backend.

## 2. Goals and non-goals

**Goals**

1. A deterministic, resettable dev world in which **every seeded row exists to put a named screen into a named state**.
2. Live, time-bound state (orders) created on demand **through the real HTTP API**, never forged in SQL.
3. A full order lifecycle simulated in real time — customer, restaurant, dispatch, rider driving a route, delivery — so any app can be watched mid-lifecycle.
4. Flows scripted as playbooks that Claude can run in the user's visible Chrome (Claude in Chrome) or headless (`agent-browser`).
5. A structure other apps extend by adding personas, scenarios and playbooks — not by redesigning (see [extending to another app](#10-extending-to-another-app)).

**Non-goals (stated, not hidden)**

- Any product feature, including live updates in any app. The world and simulator produce real events; whether an app *shows* them live is each app's feature work (companion spec for restaurant; issues for the others).
- Time-passage states: prep overdue, pickup overdue, certificate lapsing on its own. The API cannot move the clock; forging `deadline_at` is exactly what [every non-terminal order state carries a deadline (invariant 4)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) exists to prevent. Reached by waiting; a dev-only clock is a possible later spec.
- A timed-out order in seeded history (would add 180 s to every reset). A timeout is produced live by leaving a `new-order` alone.
- Changing production behaviour. Everything new is gated to `HG_ENV=local` or lives in dev tooling.

## 3. Principles

- **Things that exist → SQL. Things that happen → API.** Static world state (accounts, restaurants at a lifecycle stage, menus, hours, staff, certificates, payouts) is idempotent SQL. Anything with a clock or a ledger consequence (orders, dispatch, delivery, admin decisions) is produced by calling the real API.
- **Purpose is declared, then checked.** Each persona declares the state it lands in; a verifier asserts it after every seed. The coverage tables (see [personas and coverage](#5-personas-and-coverage)) are data the verifier reads, so they cannot silently drift.
- **Time-relative, not calendar-fixed.** "Expires in 10 days" is `now() + interval '10 days'` at seed time, so states stay true after any reset.
- **Seeded history stays inside retention.** The API binary runs the hourly retention sweep ([`services/hg/internal/retention`](../../../services/hg/internal/retention/rules.go)) in every environment, local included. A seeded row older than its table's retention period (a notification over 90 days old, a quote expired over 30 days ago with no order, a sign-in attempt over 90 days old) is deleted within the hour, so a persona that depends on one would silently drift out of its declared state.
- **Auth is exercised, not bypassed.** Personas sign in with real password + TOTP. The only dev accommodation is a fixed OTP for a reserved fictional phone range, local-only (see [scenario sign-in](#64-scenario-sign-in)).

## 4. Architecture

```
dev-reset                                         (planned make target)
  └─ cmd/devworld reset
       1. guard: HG_ENV=local and DB host is local, else refuse
       2. drop schema public, migrate up, flush Redis
       3. load migrations/seed/*            (reference data — unchanged)
       4. load migrations/devworld/*.sql    (the static world)
       5. set credentials                   (password hash + encrypted TOTP, via the seedpw/seedtotp code paths)
       6. run bootstrap scenarios over HTTP (order history, admin decisions that must be real)
       7. verify: every persona in its declared state → table printed, non-zero exit on mismatch

dev-scenario s=<name> [p=<persona>] [ARGS=...]    (planned make target)
  └─ cmd/devworld scenario <name>  → HTTP only, as seeded customer / rider / admin

dev-totp p=<persona> [QR=1]                       (planned make target)
  └─ cmd/devworld totp <persona>
```

None of these units exists yet; every location below is planned. Service paths are relative to `services/hg/`.

| Unit | Location | Responsibility | Depends on |
|---|---|---|---|
| World SQL | `migrations/devworld/` | Static personas and their data, fixed UUIDs, idempotent; one file per app group (`10_restaurant_*.sql`, later `20_customer_*.sql` …) | reference seed |
| `devworld` command | `cmd/devworld/` | `reset` / `seed` / `scenario` / `totp` / `list` / `verify` | pgx, auth credential helpers |
| Scenario client | `internal/devworld/client/` | Typed HTTP calls using generated contract types; signs in as personas | `internal/contract` |
| Scenario registry | `internal/devworld/scenarios/` | One file per scenario, registered by name with a one-line purpose | scenario client |
| Journey simulator | `internal/devworld/journey/` | Drives one order end-to-end, rider along a route | scenario client, route data |
| Route data | `migrations/devworld/routes/*.json` | Fixed Toronto route lines between seeded places | — |
| Persona manifest | `internal/devworld/personas.go` | Name, app, login, declared state, purpose — the single source the verifier, `list` and the coverage docs read | — |
| Playbooks | `playbooks/<app>/*.md` under `docs/` | Human- and Claude-readable test scripts with assertions | `devworld`, running stack |
| Run skill | `apps/<app>/.claude/skills/run-<app>/` | Agent launch + drive recipe, gains a `--backend` mode | playbooks |

`migrations/devworld/` is never loaded by `make migrate`, `make seed`, `testseed`, or any deploy path. Only `cmd/devworld` loads it.

## 5. Personas and coverage

All email-login personas sign in as `<persona>@seed.hg`, password `Seed!2026`, each with its own fixed TOTP secret stored in the manifest. Phone-login personas use the reserved test range (see [scenario sign-in](#64-scenario-sign-in)). Fixed UUIDs use a readable prefix per persona.

### 5.1 Restaurant personas

| Persona | Onboarding | Account | Halal | Open state | Purpose |
|---|---|---|---|---|---|
| `fresh` | REGISTERED (email unverified) | PENDING | — | — | verify-email gate |
| `profile` | PROFILE_PENDING | PENDING | — | — | profile step |
| `docs-todo` | DOCUMENTS_PENDING, 1 of 3 uploaded | PENDING | — | — | upload flow, incomplete pack |
| `docs-review` | DOCUMENTS_REVIEW | PENDING | — | — | awaiting-review screen; target of `docs-approve` / `docs-reject` |
| `docs-rejected` | DOCUMENTS_REJECTED — halal cert `ILLEGIBLE` | PENDING | — | — | rejection reason + resubmit |
| `payout-setup` | PAYOUT_PENDING | PENDING | — | — | payout-account step |
| `menu-setup` | MENU_PENDING, empty menu | PENDING | — | — | first-menu creation |
| **`bismillah-grill`** | ACTIVE | LIVE | CERTIFIED | OPEN | the operating surface (see [its depth below](#52-bismillah-grill-depth)) |
| `expiring-halal` | ACTIVE | LIVE | EXPIRING_SOON (expires now + 10 d) | OPEN | expiring warning |
| `expired-halal` | ACTIVE | LIVE | EXPIRED (expired now − 7 d) | — | slate, never red ([never red for a halal state (invariant 9)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants)); hidden from customers |
| `paused` | ACTIVE | LIVE | CERTIFIED | PAUSED, with reason | availability toggle + reason |
| `suspended` | ACTIVE | SUSPENDED | CERTIFIED | CLOSED_SUSPENDED | what a suspended operator sees |

### 5.2 `bismillah-grill` depth

- **Menu** — 3 categories; one item per review state the portal shows (APPROVED, PENDING_REVIEW, REJECTED with `UNSUBSTANTIATED_HALAL_CLAIM`, DRAFT); one item per availability state (AVAILABLE, OUT_OF_STOCK, HIDDEN); at least one item with variants and add-ons so order lines carry them.
- **Hours** — weekday standard, Friday/Saturday overnight (11:00–01:00), one closed-holiday override and one late-opening override, dated relative to now.
- **Staff** — `bismillah-manager@seed.hg` (RESTAURANT_MANAGER, ACTIVE), `bismillah-staff@seed.hg` (RESTAURANT_STAFF, ACTIVE), one INVITED, one SUSPENDED. Manager and staff can sign in to test the role matrix.
- **Payouts** — one per state (DRAFT, READY, TRANSFERRING, TRANSFERRED, PAID, FAILED, HELD). See the payout-seeds risk in [risks to settle in planning](#12-risks-to-settle-in-planning).
- **Order history** — produced by bootstrap scenarios, not SQL (see [bootstrap](#62-bootstrap-run-by-reset)).

### 5.3 Supporting personas (shared by every app)

| Persona | Role | Purpose |
|---|---|---|
| `customer-amina` | CUSTOMER, phone `+15550100101`, 3 saved addresses (near, far, unit/buzzer) | places every scenario order |
| `rider-sim` | RIDER, ACTIVE, Connect enabled, phone `+15550100151` | the journey's rider |
| `admin-seed` | SUPER_ADMIN, email + password + TOTP | admin-decision scenarios |

These are the seed for the customer, rider and admin coverage tables that [extending to another app](#10-extending-to-another-app) adds.

## 6. Scenarios

All scenarios act over HTTP against the running stack (Traefik on the published port). Default target is `bismillah-grill`; `--persona` picks another restaurant; `--count=N` repeats. Each prints the order code and every observed state change, so a person or agent can follow along in any app.

### 6.1 Catalogue

| Scenario | API actions | Resulting state |
|---|---|---|
| `new-order` | customer: cart → quote → checkout | RESTAURANT_PENDING, live 180 s clock; left alone → real RESTAURANT_TIMEOUT with void |
| `rush` | 5 × `new-order`, a few seconds apart | busy queue sorted by deadline |
| `order-preparing` | `new-order` + restaurant accept | PREPARING |
| `order-ready` | … + restaurant ready | READY_FOR_PICKUP awaiting a rider |
| `rider-arrives` | `rider-sim` accepts offer, drives to restaurant, arrives | rider at pickup, seal handoff pending |
| `customer-cancels` | customer cancels a pending order | offer withdrawn |
| `docs-approve` / `docs-reject` | `admin-seed` decides `docs-review` | onboarding advances / shows reason |
| `menu-approve` / `menu-reject` | `admin-seed` decides the pending menu version | review badge resolves |
| `journey` | see [journey](#63-journey) | one order, whole lifecycle, live |

### 6.2 Bootstrap (run by `reset`)

For `bismillah-grill`: 3 DELIVERED orders (via `journey --auto=all --speed=max`), 1 CUSTOMER_CANCELLED, 1 rejected by the restaurant (`KITCHEN_AT_CAPACITY`). Ledger, payment intents and dispatch records are whatever the real code writes.

### 6.3 Journey

1. `customer-amina` orders from the target restaurant.
2. **Restaurant steps** — default *manual*: the simulator waits and prints `waiting for restaurant to accept (178 s left)`, then `waiting for ready`. `--auto=restaurant` performs them via API.
3. `rider-sim` is set online at the route's start point; real dispatch offers the order; the simulator accepts. (`--manual=rider` leaves the rider steps to a person or agent in the rider app instead — the hook the rider app's coverage uses, see [extending to another app](#10-extending-to-another-app).)
4. The simulator walks the route polyline, posting `/v1/riders/me/positions` every 5 s (the contract's throttle), advancing assignment transitions at the pickup and drop-off points, entering the seal code at pickup, and submitting proof of delivery with a bundled test image.
5. Terminates at DELIVERED (or reports the state it stopped in and why).

Flags: `--route=short|long|early-rider` (early-rider arrives before the food is ready), `--speed=1x|4x|max` (default 1x, real pace), `--auto=none|restaurant|all`, `--manual=rider`.

Routes are fixed JSON route lines between seeded coordinates (restaurant ↔ customer addresses), so a run is identical every time and no external routing service is called.

### 6.4 Scenario sign-in

Customers and riders authenticate by phone OTP. New config: phones `+15550100100` through `+15550100199` (a fictional 555 range) accept code `000000` **only when `HG_ENV=local`**; config validation refuses the setting in any other environment. Scenarios still call `/v1/auth/otp/request` and `/v1/auth/otp/verify` — the real session, refresh and role-matrix code runs. Email + password + TOTP personas (restaurant staff, admin) sign in normally using the manifest's TOTP secret. The same range lets a person or agent sign in to the customer and rider apps by hand.

## 7. Playbooks (Claude in Chrome and headless)

Planned, in a new `playbooks/restaurant/` folder under `docs/`: `onboarding-personas.md`, `order-handling.md`, `journey.md`, `menu-review.md`, `hours-availability.md`, `staff-roles.md`, `payouts.md`.

Each playbook step is: **setup command** (terminal) → **action** (in browser) → **assertion** (what must be visible). Example:

> 1. Run the `dev-scenario` make target with `s=new-order` → wait for `order HG-… RESTAURANT_PENDING`
> 2. In the queue, the card `HG-…` appears; countdown < 180 s.
> 3. Click **Accept** → card shows **Preparing**.

Playbooks describe the app **as it behaves today**. Where the app does not yet update live, the step says "press Refresh"; the companion feature spec rewrites those steps to "appears without Refresh" when it lands.

Two runners, same playbook:

- **Claude in Chrome** — the user connects the extension to the Claude Code session (`/chrome`); Claude runs the terminal commands and drives the user's visible Chrome, reporting each assertion.
- **Headless** — `agent-browser`, via the app's run skill (`apps/restaurant/.claude/skills/run-restaurant/`), which gains a `--backend` mode (servers up against the Go stack instead of the mock).

## 8. Verification

1. **World verify in CI** — `devworld reset` against an empty migrated database; `devworld verify` asserts every manifest persona is in its declared state (signing in through the API as each persona where the state is visible that way). Non-zero exit fails CI.
2. **Journey integration test** — `journey --auto=all --speed=max` in the backend integration suite reaches DELIVERED; the order's ledger batches sum to zero.
3. **Acceptance** — the restaurant `journey.md` playbook run end to end in the user's Chrome via Claude in Chrome, in front of the user.

Two automated additions, each pinning a behaviour this spec introduces — within the repo's "few, high-value tests" rule.

## 9. Delivery stages

Each stage is usable on its own.

1. **World core + restaurant personas** — `cmd/devworld` (`reset`, `seed`, `verify`, `totp`, `list`), manifest, restaurant + supporting personas, CI verify.
2. **Scenarios** — scenario client, fixed-OTP test range, the [scenario catalogue](#61-catalogue) except `journey`, bootstrap history.
3. **Journey simulator** — routes, rider movement, pickup, proof of delivery.
4. **Restaurant playbooks** — the [playbooks](#7-playbooks-claude-in-chrome-and-headless), plus `run-restaurant --backend`.

## 10. Extending to another app

Adding customer, rider or admin coverage is additive — no change to the [architecture](#4-architecture):

1. **Personas** — add a coverage table for the app's states to the manifest and a `migrations/devworld/<nn>_<app>_*.sql` file; `verify` picks them up.
2. **Scenarios** — add scenarios under `internal/devworld/scenarios/` for states only a flow can produce; reuse the journey (`--manual=rider` for the rider app, customer steps for the customer app).
3. **Playbooks** — `playbooks/<app>/*.md` under `docs/`, in the same setup → action → assertion form.
4. **Run skill** — `apps/<app>/.claude/skills/run-<app>/` with a `--backend` mode (the customer and rider apps are Expo; their web target is the automation surface).

One GitHub issue per app tracks this.

## 11. Relationship to the realtime feature

The harness produces real realtime events (order state changes, offers, `rider.location`) whether or not an app renders them. The restaurant realtime feature can be built and unit-tested against the scripted WebSocket playback of the mock (`ws://localhost:4010/v1/ws?scenario=realtime_order_happy_path`); its end-to-end acceptance uses this harness's `journey`. Neither blocks the other's construction.

## 12. Risks to settle in planning

- **Payout seeds vs the ledger.** The [zero-residual ledger rule (invariant 6)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) requires every order's money to decompose to zero via the append-only ledger. If payout rows need backing ledger batches the SQL cannot honestly produce, payouts move from SQL to an admin payout run over the API; any state the API cannot reach (e.g. FAILED) is listed as a gap rather than forged.
- **Proof of delivery.** If PoD requires an uploaded object in MinIO, the simulator uploads a bundled test image through the documented presigned flow.
- **Dispatch reach.** The journey assumes dispatch offers to an online rider within range of the restaurant. `rider-sim` starts at the route's origin inside that radius; planning confirms the radius and offer loop in `internal/dispatch`.
- **Approved documents need a clean scan.** An `APPROVED` `kyc_document` in the world SQL must point at a `stored_object` with `virus_scan_state = 'CLEAN'`, `virus_scan_sha256` equal to its `sha256` and `virus_scan_version` equal to its `content_version`; the database refuses the approval otherwise (`services/hg/migrations/00031_virus_scan.sql`).
- **Drift.** The world SQL must follow schema migrations. Mitigated by the world verify in CI (see [verification](#8-verification)) — a migration that breaks the world fails the build.
- **CORS.** `HG_CORS_ALLOWED_ORIGINS` must include each app's dev origin (restaurant `http://localhost:5183`); `.env.example` has them, and `devworld reset` warns when the running config lacks one.
- **Trusted proxy.** The compose stack refuses to start without `HG_TRUSTED_PROXY_CIDRS`, the networks whose forwarded client address the API believes (see the client-address step of the [middleware chain](../../spec/01-platform.md#p-06--deny-by-default-routing-and-the-middleware-chain)). A `deploy/.env` copied before the setting existed needs the line from `.env.example`. Without it every request would carry Traefik's address, and the per-address sign-in limit would throttle every persona as one caller.
