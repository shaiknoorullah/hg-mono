---
covers:
  - services/hg/cmd/devworld/**
  - services/hg/internal/devworld/**
  - services/hg/migrations/devworld/**
  - apps/restaurant/.claude/skills/**
  - docs/playbooks/**
reviewed: 2026-10-09
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

Every restaurant route is implemented in the Go backend, local payments run on `fakeStripe` when `HG_STRIPE_SECRET_KEY` is unset, and customer OTP defaults to the `log` provider. The backend can carry real end-to-end testing; it has no purposeful data to test with. `migrations/seed/` holds reference data only; `migrations/test/fixtures.sql` serves the conformance suite and its restaurant manager is phone-only, so it cannot sign in to the email + password + TOTP restaurant portal. The one working restaurant login (`resto-qa@demo.hg`) was hand-made in a prior session and is not reproducible. No email leaves a local or dev API: with no Resend key it writes each email, links included, to its log ([`LogEmailSender`](../../../services/hg/internal/notify/senders.go)), and with a key it emails only the addresses on `HG_EMAIL_ALLOWLIST`; a scenario reads a verification, reset or invite link from that log.

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
- Time-passage states: prep overdue, pickup overdue, certificate lapsing on its own. The API cannot move the clock; forging `deadline_at` is exactly what [every non-terminal order state carries a deadline (invariant 4)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) exists to prevent. Reached by waiting; a dev-only clock is a possible later spec. The exception is the certificate: the expiry job runs "as of" any future instant (`RunAt` in `services/hg/internal/halalexpiry/`), which the dev controls in [#235](https://github.com/shaiknoorullah/hg-mono/issues/235) can call.
- A timed-out order in seeded history (would add 180 s to every reset). A timeout is produced live by leaving a `new-order` alone.
- Changing production behaviour. Everything new is gated to `HG_ENV=local` or lives in dev tooling.

## 3. Principles

- **Things that exist → SQL. Things that happen → API.** Static world state (accounts, restaurants at a lifecycle stage, menus, hours, staff, certificates, payouts) is idempotent SQL. Anything with a clock or a ledger consequence (orders, dispatch, delivery, admin decisions) is produced by calling the real API.
- **Purpose is declared, then checked.** Each persona declares the state it lands in; a verifier asserts it after every seed. The coverage tables (see [personas and coverage](#5-personas-and-coverage)) are data the verifier reads, so they cannot silently drift.
- **Time-relative, not calendar-fixed.** "Expires in 10 days" is `now() + interval '10 days'` at seed time, so states stay true after any reset. Dates are counted from today in Toronto, the personas' timezone, not from the database server's UTC date, because the halal state compares a certificate's dates with the restaurant's local date.
- **Seeded history stays inside retention.** The API binary runs the hourly retention sweep ([`services/hg/internal/retention`](../../../services/hg/internal/retention/rules.go)) in every environment, local included. A seeded row older than its table's retention period (a notification over 90 days old, a quote expired over 30 days ago with no order, a sign-in attempt over 90 days old) is deleted within the hour, so a persona that depends on one would silently drift out of its declared state.
- **Auth is exercised, not bypassed.** Personas sign in with real password + TOTP. The only dev accommodation is a fixed OTP for a reserved fictional phone range, and only when the process environment is local or staging (see [scenario sign-in](#64-scenario-sign-in)).

## 4. Architecture

```
dev-reset                                         (make dev-reset)
  └─ cmd/devworld reset
       1. guard: HG_ENV=local, and the database host is loopback, a Unix socket,
          or the compose service name postgres. Anything else is refused.
       2. drop schema public (topology extensions first, they pin objects), then goose up
          as the same local superuser (new orders start open: migrating recreates the
          ordering-pause row switched off)
       3. load the reference seed
       4. load migrations/devworld/001_personas.sql, then the Toronto catalogue
          (internal/devworld/catalogue.go) and its pictures
       5. set one shared password hash. The admin authenticator is enrolled only when
          HG_APP_DATA_KEY is set. The fresh restaurant email stays unverified.
       6. flush Redis only when HG_REDIS_ADDR is local. A connection failure does not fail the reset.
       7. verify: every persona in its declared state, or a non-zero exit

dev-scenario                                      (make dev-scenario s=new-order)
dev-totp                                          (make dev-totp — prints the admin code, not the secret)
```

`reset`, `seed`, `verify`, `list`, `totp`, `scenario` and `journey` exist. The world is one SQL file. Service paths below are relative to `services/hg/`.

The reset does not re-run `roles/roles.sql` and does not migrate as `hg_migrator`. The first migration recreates the roles, and goose uses the local superuser in `HG_POSTGRES_DSN`. Credentials are hashed in the command. `seedpw` is not used, because that command also marks the email verified. Connect rows for the live restaurant, the payout-pending restaurant and the sim rider are stand-ins with test account ids. They are not Stripe accounts. Payout and ledger rows are not seeded.

| Unit | Location | Responsibility | Depends on |
|---|---|---|---|
| World SQL | `migrations/devworld/001_personas.sql` | Static personas and their data, fixed UUIDs, idempotent | reference seed |
| `devworld` command | `cmd/devworld/` | `reset` / `seed` / `scenario` / `journey` / `totp` / `list` / `verify` | pgx, auth credential helpers |
| Scenario client | `internal/devworld/scenario.go` | HTTP calls that sign in as personas and place orders | auth sign-in |
| Scenario registry | `internal/devworld/scenario.go` | Named scenarios the command accepts | scenario client |
| Journey simulator | `internal/devworld/journey.go` | Drives one order as far as the API allows | scenario client, route line |
| Route data | `internal/devworld/route.go` | Straight-line approach. A directions line is used only when a token is set | — |
| Persona manifest | `internal/devworld/personas.go` | Name, app, login, declared state, purpose — the single source the verifier, `list` and the coverage docs read | — |
| Playbooks | `playbooks/<app>/*.md` under `docs/` | Human- and Claude-readable test scripts with assertions | `devworld`, running stack |
| Run skill | `apps/<app>/.claude/skills/run-<app>/` | Agent launch + drive recipe, gains a `--backend` mode | playbooks |

`migrations/devworld/` is never loaded by `make migrate`, `make seed`, `testseed`, or any deploy path. Only `cmd/devworld` loads it.

## 5. Personas and coverage

Email-login personas share one local password and sign in as `<persona>@seed.hg`. Only the admin persona is enrolled in an authenticator, and only when `HG_APP_DATA_KEY` is set. That secret is derived from the email, not stored in the repository. Phone-login personas keep their reserved numbers, and the fixed sign-in range is built (see [scenario sign-in](#64-scenario-sign-in)). Fixed UUIDs stay the same across resets.

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
| `expired-halal` | ACTIVE | DELISTED (reason `HALAL_CERTIFICATE_EXPIRED`) | EXPIRED (expired now − 7 d) | — | slate, never red ([never red for a halal state (invariant 9)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants)); hidden from customers. Not `LIVE`: the schema refuses a listed restaurant with an expired certificate ([#252](https://github.com/shaiknoorullah/hg-mono/issues/252)) |
| `paused` | ACTIVE | LIVE | CERTIFIED | PAUSED, with reason | availability toggle + reason |
| `suspended` | ACTIVE | SUSPENDED | CERTIFIED | CLOSED_SUSPENDED | what a suspended operator sees |

The customer apps see `expiring-halal` as Bamyan Kebab House and `paused` as Galata Pide & Grill. Their slugs, logins and states are unchanged.

### 5.1a Toronto catalogue

Reset also seeds 14 live, certified restaurants within 8 km of both the Danforth persona address and downtown, so a new phone sign-in sees a full marketplace once it saves a Toronto address. Three are the personas above (`bismillah-grill`, `expiring-halal`, `paused`). The other 11 are created by [`catalogue.go`](../../../services/hg/internal/devworld/catalogue.go), each with a verified certificate, a Connect stand-in and an owner who signs in as `<slug>@seed.hg`. One of them, `padma-river-kitchen`, has no trading hours on the reset day, so adding to its cart and quoting refuse with `RESTAURANT_CLOSED` that day, as at any restaurant outside its hours ([#648](https://github.com/shaiknoorullah/hg-mono/issues/648)). Menus have 12 to 20 items, with one variant group at most per item, required and optional add-on groups, and some items, variants and add-ons out of stock. Photos come from Wikimedia Commons under the licences in [`catalogue_photos.json`](../../../services/hg/internal/devworld/catalogue_photos.json). The reset downloads them to a cache outside the repository and uploads them to the local `hg-media` bucket. Logos, and any photo it cannot fetch, are generated. `HG_DEVWORLD_PHOTOS=off` skips the download. While `make run` serves a local stack, the API stands in for the catalogue's order screens: once a minute it touches the heartbeat of each seeded restaurant that is live and taking orders ([`tablets`](../../../services/hg/internal/devworld/tablets/tablets.go), `HG_DEVWORLD_TABLETS=on`, refused unless `HG_ENV` is `local`), so discovery keeps them open within their hours and `paused` stays paused.

### 5.2 `bismillah-grill` depth

- **Menu** — 3 categories; one item per review state the portal shows (APPROVED, PENDING_REVIEW, REJECTED with `UNSUBSTANTIATED_HALAL_CLAIM`, DRAFT); one item per availability state (AVAILABLE, OUT_OF_STOCK, HIDDEN); at least one item with variants and add-ons so order lines carry them.
- **Hours** — weekday standard, Friday/Saturday overnight (11:00–01:00), one closed-holiday override and one late-opening override, dated relative to now.
- **Staff** — `bismillah-manager@seed.hg` (RESTAURANT_MANAGER, ACTIVE), `bismillah-staff@seed.hg` (RESTAURANT_STAFF, ACTIVE), one INVITED, one SUSPENDED. Manager and staff can sign in to test the role matrix.
- **Payouts** — one per state (DRAFT, READY, TRANSFERRING, TRANSFERRED, PAID, FAILED, HELD). See the payout-seeds risk in [risks to settle in planning](#12-risks-to-settle-in-planning).
- **Order history** — produced by bootstrap scenarios, not SQL (see [bootstrap](#62-bootstrap-not-run-by-reset)).

### 5.3 Supporting personas (shared by every app)

| Persona | Role | Purpose |
|---|---|---|
| `customer-amina` | CUSTOMER, phone `+15550100101`, 3 saved addresses (near, far, unit/buzzer) | places every scenario order |
| `rider-sim` | RIDER, ACTIVE, Connect enabled, phone `+15550100151` | the journey's rider |
| `admin-seed` | SUPER_ADMIN, email + password + TOTP | admin-decision scenarios |

These are the seed for the customer, rider and admin coverage tables that [extending to another app](#10-extending-to-another-app) adds.

## 6. Scenarios

`devworld scenario <name>` calls the API at `HG_API_URL` (default `http://127.0.0.1:8080`). `devworld scenario list` prints the names the command accepts. Each run signs in as the personas it needs and prints the order code and every observed state. The command follows the API when this table and the running code disagree:

- A customer cancel ends in `CANCELLED`.
- A restaurant rejection ends in `REJECTED`.
- Rush places one order for each of the two seeded customers, a few seconds apart, then a further order for the first customer. The API refuses that third order while one is still active. The five-order rush in the table waits until more customers exist.
- Menu approve and reject sign in as `admin-seed`, take the oldest version waiting in the menu review queue for the `menu` persona, and decide it. Reset seeds that persona with two versions waiting for review (Draft Stew and Draft Soup), so each scenario runs once per reset, in either order; a third run says to reset. They do not call the restaurant save: it numbers the next version from the live version only and saves `DRAFT`, never `PENDING_REVIEW`, so it cannot put a version in the queue ([#594](https://github.com/shaiknoorullah/hg-mono/issues/594)). Reset also closes the running API's database sessions, whose prepared statements point at the dropped schema, and waits for it to reconnect.

`journey` is `devworld journey`. Arrival at the restaurant is a step inside that command, not a separate scenario. Default target is `bismillah-grill`.

### 6.1 Catalogue

| Scenario | API actions | Resulting state |
|---|---|---|
| `new-order` | customer: cart → quote → checkout | RESTAURANT_PENDING, live 180 s clock; left alone → real RESTAURANT_TIMEOUT with void |
| `rush` | 5 × `new-order`, a few seconds apart | busy queue sorted by deadline |
| `order-preparing` | `new-order` + restaurant accept | PREPARING |
| `order-ready` | … + restaurant ready | READY_FOR_PICKUP awaiting a rider |
| `rider-arrives` | step inside `devworld journey`, not its own scenario | rider at pickup, seal handoff pending |
| `customer-cancels` | customer cancels a pending order | offer withdrawn |
| `docs-approve` / `docs-reject` | `admin-seed` decides `docs-review` | onboarding advances / shows reason |
| `menu-approve` / `menu-reject` | `admin-seed` decides the pending menu version | review badge resolves |
| `onboard-restaurant` | a new restaurant signs up and completes onboarding; `admin-seed` approves its documents, halal certificate, application and first menu item | the new restaurant is `ACTIVE` and its approved item is on the customer menu ([playbook](../../playbooks/restaurant/onboarding.md)) |
| `onboard-rider` | a new rider signs in with a fresh number, submits profile, bicycle and documents; `admin-seed` approves them and the application; the rider sets up payouts and goes online | the new rider is `ACTIVE` and online beside `bismillah-grill` ([playbook](../../playbooks/rider/onboarding.md)) |
| `journey` | see [journey](#63-journey) | one live order through delivery when the rider is driven |

### 6.2 Bootstrap (not run by `reset`)

Reset does not run the journey. A cancelled order and a rejected order are the scenario commands, not part of reset.

### 6.3 Journey

`devworld journey` places one order at `bismillah-grill` and drives it as far as the API allows. `make dev-journey` runs it (`route=short`, `speed=1x`, `auto=none`; `manual=rider` leaves the rider to a person).

1. `customer-amina` orders from the target restaurant. An order she already has in a state this command can continue is reused. When that order is still waiting for payment and the process has a test Stripe secret, the command confirms the test card and prints only the status word. It refuses a live secret. It prints neither the secret nor the intent id. With no secret set, it skips the confirm.
2. Restaurant steps default to waiting. The command prints the order state until someone accepts and marks it ready, or until the command's deadline. `--auto=restaurant` and `--auto=all` accept a pending order and mark a preparing order ready, including when the order becomes pending during the wait. A created order that is still unpaid after about 90 seconds stops the wait.
3. `--route=early-rider` brings `rider-sim` online at the start of the approach before the kitchen marks the order ready, posts positions up to the door, and polls for an offer. Dispatch offers only a ready order, so none arrives. The command then marks the order ready. A rider transition does not mark a preparing order ready: the running pickup refuses that state ([early pickup](https://github.com/shaiknoorullah/hg-mono/issues/317)). If the order is already ready, the command says the early arrival cannot be shown and continues with the short approach.
4. When `--auto=all` drives the rider, `rider-sim` is online at the route start before the order is marked ready, so the first sweep can see the rider. The command polls the current offer. It does not call the sweep itself. `--manual=rider`, and any run that does not pass `--auto=all`, stops once the order is ready and leaves the rider to a person.
5. The simulator posts positions along the pickup leg. `1x` waits 5 seconds between posts, `4x` waits a quarter of that, and `max` does not wait and may send up to 10 points at once. At the restaurant it records en route and arrived. The restaurant then tries to bind a seal. The world has no issued seal, so the bind is refused, the command prints that status, and the ride continues. It does not insert a seal. The rider marks the order picked up, walks to the drop-off, uploads a proof-of-delivery photo, and records delivered.
6. The command then waits for the order to complete. As the customer it reads the receipt, submits a food rating and a rider rating, and requests a full refund. As the restaurant it reads the order back. It keeps going through those reads when one of them is refused, and exits non-zero if any of them fails or the order never completes.

Flags: `--route=short|long|early-rider`, `--speed=1x|4x|max` (default `1x`), `--auto=none|restaurant|all`, `--manual=rider`.

The default line is straight between the approach start and the restaurant door, so a run needs no network. A directions response is used only when `MAPBOX_TOKEN` or `HG_MAPBOX_TOKEN` is set. If that request fails, the command uses the straight line. The earlier draft of this section called for fixed JSON route files and no routing service.

### 6.4 Scenario sign-in

Customers and riders authenticate by phone OTP. Phones `+15550100100` through `+15550100199` (a fictional 555 range) accept code `000000` when `HG_ENV` is `local` or `staging`. Production, an empty environment, and every other value refuse that code, including for a phone in the range. The range never reaches a configured phone verifier or the SMS sender. Scenarios still call `/v1/auth/otp/request` and `/v1/auth/otp/verify` — the real session, refresh and role-matrix code runs. Email + password + authenticator personas (restaurant staff, admin) sign in through the normal login endpoint. The same range lets a person sign in to the customer and rider apps by hand on a local or staging server.

## 7. Playbooks (Claude in Chrome and headless)

Planned, in a new `playbooks/restaurant/` folder under `docs/`: `onboarding-personas.md`, `order-handling.md`, `journey.md`, `menu-review.md`, `hours-availability.md`, `staff-roles.md`, `payouts.md`.

Each playbook step is: **setup command** (terminal) → **action** (in browser) → **assertion** (what must be visible). Example:

> 1. Run the `dev-scenario` make target with `s=new-order` → wait for `order HG-… RESTAURANT_PENDING`
> 2. In the queue, the card `HG-…` appears; countdown < 180 s.
> 3. Click **Accept** → card shows **Preparing**.

Playbooks describe the app **as it behaves today**. Where the app does not yet update live, the step says "press Refresh"; the companion feature spec rewrites those steps to "appears without Refresh" when it lands. *Done for the restaurant order queue (Oct 2026, [#27](https://github.com/shaiknoorullah/hg-mono/issues/27)): `journey.md` and `order-handling.md` wait for orders to appear on their own; **Refresh** stays as a manual option.*

Two runners, same playbook:

- **Claude in Chrome** — the user connects the extension to the Claude Code session (`/chrome`); Claude runs the terminal commands and drives the user's visible Chrome, reporting each assertion.
- **Headless** — `agent-browser`, via the app's run skill (`apps/restaurant/.claude/skills/run-restaurant/`), which gains a `--backend` mode (servers up against the Go stack instead of the mock). `--backend local` runs `make up` when `/health/ready` does not answer, then `make dev-reset` (`RESET=0` skips it), then starts the console against `:8080`.

## 8. Verification

1. **World verify in CI** — `devworld reset` against an empty migrated database; `devworld verify` asserts every manifest persona is in its declared state (signing in through the API as each persona where the state is visible that way). Non-zero exit fails CI.
2. **Journey** — `journey --auto=all --speed=max` stops when the restaurant cannot bind a seal. Delivered, and a ledger that sums to zero, wait on an issued seal. The command does not insert one.
3. **Acceptance** — the restaurant `journey.md` playbook run end to end in the user's Chrome via Claude in Chrome, in front of the user.

Two automated additions, each pinning a behaviour this spec introduces — within the repo's "few, high-value tests" rule.

## 9. Delivery stages

Each stage is usable on its own.

1. **World core + restaurant personas** — `cmd/devworld` (`reset`, `seed`, `verify`, `totp`, `list`), manifest, restaurant + supporting personas, CI verify.
2. **Scenarios** — scenario client, fixed-OTP test range, the [scenario catalogue](#61-catalogue) except `journey`, bootstrap history.
3. **Journey simulator** — route line, rider movement, and a stop when a seal cannot be bound.
4. **Restaurant playbooks** — the [playbooks](#7-playbooks-claude-in-chrome-and-headless), plus `run-restaurant --backend`.

## 10. Extending to another app

Adding customer, rider or admin coverage is additive — no change to the [architecture](#4-architecture):

1. **Personas** — add a coverage table for the app's states to the manifest and a `migrations/devworld/<nn>_<app>_*.sql` file; `verify` picks them up.
2. **Scenarios** — add scenarios under `internal/devworld/scenarios/` for states only a flow can produce; reuse the journey (`--manual=rider` for the rider app, customer steps for the customer app).
3. **Playbooks** — `playbooks/<app>/*.md` under `docs/`, in the same setup → action → assertion form. The customer folder starts with [`card-payments.md`](../../playbooks/customer/card-payments.md): paying at checkout with Stripe test cards, on web and on a device.
4. **Run skill** — `apps/<app>/.claude/skills/run-<app>/` with a `--backend` mode (the customer and rider apps are Expo; their web target is the automation surface).

One GitHub issue per app tracks this.

## 11. Relationship to the realtime feature

The harness produces real realtime events (order state changes, offers, `rider.location`) whether or not an app renders them. The restaurant realtime feature can be built and unit-tested against the scripted WebSocket playback of the mock (`ws://localhost:4010/v1/ws?scenario=realtime_order_happy_path`); its end-to-end acceptance uses this harness's `journey`. Neither blocks the other's construction.

## 12. Risks to settle in planning

- **Payout seeds vs the ledger.** The [zero-residual ledger rule (invariant 6)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) requires every order's money to decompose to zero via the append-only ledger. If payout rows need backing ledger batches the SQL cannot honestly produce, payouts move from SQL to an admin payout run over the API; any state the API cannot reach (e.g. FAILED) is listed as a gap rather than forged. Against a Stripe sandbox, Stripe's own test-mode events reach those states: the webhook worker applies `transfer.*` and `payout.*` to the payout, `account.updated` to the payout account and `charge.dispute.*` to a chargeback ([#249](https://github.com/shaiknoorullah/hg-mono/issues/249)). Refunds in every state come from the API too: a customer's request, then staff approval or decline (`approveRefund`, `declineRefund`, [#172](https://github.com/shaiknoorullah/hg-mono/issues/172)), so each approved refund carries its ledger batch and approver.
- **Proof of delivery.** If PoD requires an uploaded object in MinIO, the simulator uploads a bundled test image through the documented presigned flow.
- **Dispatch reach.** The journey assumes dispatch offers to an online rider within range of the restaurant. `rider-sim` starts at the route's origin inside that radius; planning confirms the radius and offer loop in `internal/dispatch`.
- **Drift.** The world SQL must follow schema migrations. Mitigated by the world verify in CI (see [verification](#8-verification)) — a migration that breaks the world fails the build.
- **One document per rider file.** The world SQL cannot give a rider two live `kyc_document` rows for the same document type and `stored_object`; the database refuses the second (`kyc_document_rider_file_once`, `services/hg/migrations/00038_rider_document_attached_once.sql`). Each seeded rider document needs its own file.
- **CORS.** `HG_CORS_ALLOWED_ORIGINS` must include each app's dev origin (restaurant `http://localhost:5183`); `.env.example` has them, and `devworld reset` warns when the running config lacks one.
- **Trusted proxy.** The compose stack refuses to start without `HG_TRUSTED_PROXY_CIDRS`, the networks whose forwarded client address the API believes (see the client-address step of the [middleware chain](../../spec/01-platform.md#p-06--deny-by-default-routing-and-the-middleware-chain)). A `deploy/.env` copied before the setting existed needs the line from `.env.example`. Without it every request would carry Traefik's address, and the per-address sign-in limit would throttle every persona as one caller.

**The platform account.** Migration `00056` creates the platform's own account (`platform@halalgoes.invalid`, `SUSPENDED`, no role and no credentials). The pickup-cap canceller (`services/hg/cmd/hg/pickup.go`) names it as the requester and approver of the refund a deadline owes ([#336](https://github.com/shaiknoorullah/hg-mono/issues/336)). `make dev-reset` keeps it, because the migrations create it, so no persona or scenario needs to seed it.

