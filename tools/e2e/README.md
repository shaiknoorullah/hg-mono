---
covers:
  - .github/workflows/e2e.yml
  - tools/e2e/**
reviewed: 2026-10-10
---

# End-to-end flows

The HalalGoes apps driven the way people use them, against the real API built from the same
commit, with a small seeded world:

- the **customer and rider Android apps** on an Android emulator, driven by
  [Maestro](https://github.com/mobile-dev-inc/maestro) (open source, Apache-2.0);
- the **restaurant and admin web apps** in Chromium, driven by [Playwright](https://playwright.dev).

The [e2e workflow](../../.github/workflows/e2e.yml) runs them on GitHub's runners and keeps a
screenshot of every step. Goal: [release 1.0](https://github.com/shaiknoorullah/hg-mono/issues/257),
every major flow of every app tested end to end. This is the first set of flows: the CI side of
[#77](https://github.com/shaiknoorullah/hg-mono/issues/77) (the mobile apps emulated in CI) and of
[#91](https://github.com/shaiknoorullah/hg-mono/issues/91) (the regression pass with screenshots).
The full list of journeys still to cover is the harness plan in
[#34](https://github.com/shaiknoorullah/hg-mono/issues/34); the
[launch flows](../../docs/testing/launch-flows.md) list each flow and the test that covers it.

## When it runs

| Trigger | What runs |
|---|---|
| **Run workflow** on the Actions tab (`workflow_dispatch`) | Every flow, or only the web flows (input `flows`), on the branch picked |
| **Nightly**, 05:30 UTC | Every flow, on `main`. Skipped when `main` has not changed since the last nightly run, passed or failed: a failure is retried by hand or by the next change |
| A pull request with the **`e2e` label** | The web flows only, on every push while the label is on. No APK build and no emulator: those cost the most minutes ([below](#what-it-costs)). Without the label no job starts, so it costs nothing |
| A pull request with the **`e2e-full` label** | Every flow, emulator included, on every push while the label is on. The by-hand run for a pull request: a workflow can only be started from the Actions tab once it is on `main`. Remove the label when done |

A run on a pull request reads no secret. No run needs one: the API runs with `HG_ENV=local`, so it
uses its fake payment client (no Stripe keys) and writes phone sign-in codes to its own log
instead of texting them. No flow sends an SMS or charges a card.

## The flows

One runner holds one stack for the whole run: the API, the two web apps and the emulator. The
flows run in this order, because steps 2 to 4 share one order (the cross-app smoke):

| # | App | Runner | What it does |
|---|---|---|---|
| 1 | Restaurant | Playwright | The owner signs in with email and password, sees the live order queue, and accepts an order a second customer placed through the API |
| 2 | Customer | Maestro | Signs in with a test phone and the code from the API's log, sees the certified restaurant and not the expired one, opens it, adds a dish, checks out and places the order |
| 3 | Restaurant | Playwright | Accepts that order within its 180 seconds |
| 4 | Rider and restaurant | Maestro and Playwright | The rider signs in, goes online standing at the restaurant and waits on the offer screen; meanwhile the restaurant marks the order ready for pickup, and the rider receives the dispatch offer for it |
| 5 | Admin | Playwright | Signs in with email, password and the authenticator code, finds and opens the order, then opens the verification register: the review queue and the seven-check halal verification of each restaurant's certificate |

Beyond the cross-app smoke, the browser specs walk the partner and admin apps' own journeys:
onboarding review, the seven-check halal verification, menus, operating hours, the order
lifecycle, and navigation at phone width. They read every person and record from the seeded
`world.json` and fail clearly when it is missing.

A flow that needs an earlier one is skipped, with the reason, when that one failed. The run's
summary page lists each flow's result. A pull request run (web flows only) does steps 1 and 5.

**Artifacts** (`e2e-screenshots-and-traces`, kept 14 days):

- `screenshots/<app>/`: one picture per step, numbered in order;
- `playwright/<flow>/report/`: the HTML report of each Playwright run, with the trace and video of any failed test;
- `maestro/<flow>/`: Maestro's JUnit report and debug output, with a screenshot of any failure;
- `logs/`: the stack's logs (`compose.log`), the web servers' and the emulator's app log.

## The world

[`seed/seed.sh`](seed/seed.sh) builds it after the migrations: the reference seed every
environment gets, then [`seed/world.sql`](seed/world.sql), then passwords and the TOTP secret
through the API's own code (`cmd/seedpw`, `cmd/seedtotp`), then a check
([`seed/verify.sql`](seed/verify.sql)) that fails the run when the world is not as the flows
expect. Things that exist are written in SQL; things that happen (orders, going online) go
through the API during the flows.

| Who | What | Signs in with |
|---|---|---|
| Bismillah Grill | Live, halal certificate approved (expires in 200 days), open around the clock, three dishes | Owner: `owner@bismillah-grill.e2e.halalgoes.test` and the run's password |
| Crescent Kitchen | Live, certificate expired 7 days ago: customers never see it | — |
| Amina | Customer, home 900 m from the grill | `+1 416 555 0110` on the Android app |
| Omar | Customer, home 900 m from the grill | `+1 416 555 0111`, through the API (one active order per customer, so a second person) |
| Bilal | Rider, approved, payouts set up, offline | `+1 416 555 0161` on the Android app |
| Admin | Super admin | `admin@e2e.halalgoes.test`, the run's password and a TOTP code |

Every id starts `e2e00000`, so the rows are easy to find. The password and the TOTP secret are
made fresh for each run and written to `world.json`, which the workflow deletes before it uploads
anything. This seed is where the dev-world harness
([#20](https://github.com/shaiknoorullah/hg-mono/issues/20)) grows from: more personas go in
`world.sql` and `world.mjs`, and `verify.sql` checks each one.

## Run it on a laptop

Needs Docker, Go, Node 22 with pnpm, `psql`, and for the Android flows an emulator (with KVM)
plus Maestro. From the repository root:

```bash
pnpm install
pnpm --filter @hg/e2e exec playwright install chromium
bash tools/e2e/stack/up.sh        # the stack, on ports 8080 (API), 5432, 6379, 9000
bash tools/e2e/seed/seed.sh       # the world, and e2e-out/world.json
bash tools/e2e/web/serve.sh       # restaurant on :4173, admin on :4174 (and the redesign builds, below)
E2E_FLOWS=web bash tools/e2e/run.sh  # or E2E_FLOWS=all with an emulator attached and the APKs in e2e-out/apk/
```

`e2e-out/world.json` holds the run's password and the admin's TOTP secret; set `E2E_PASSWORD`
before seeding to choose the password yourself.

One flow at a time:

```bash
pnpm --filter @hg/e2e web --project restaurant-legacy-desktop --grep @api-order
pnpm --filter @hg/e2e web --project admin-legacy-desktop
maestro test -e PHONE=+14165550110 tools/e2e/native/customer/1-ask-for-code.yaml
node tools/e2e/lib/otp.mjs +14165550110       # the code the API just logged for that phone
node tools/e2e/lib/totp.mjs <secret>          # the admin's code of the moment
pnpm --filter @hg/e2e typecheck
```

The APKs the emulator runs are release builds (the JavaScript bundled in, no Metro) signed with
Android's debug key, for x86_64, pointed at `http://10.0.2.2:8080` (the emulator's address for
its host). They allow plain HTTP for that, which no dev or prod APK does
([`android/allow-cleartext.sh`](android/allow-cleartext.sh)). Stop the stack with
`docker compose --project-name hg-e2e -f deploy/docker-compose.yml --env-file deploy/.env.e2e down`.

## Redesign

The redesigned screens merge to `main` behind a build-time flag, and release 1.0 ships the
current ones ([MASTER-PLAN §0.2 and §5](https://github.com/shaiknoorullah/hg-mono/issues/660)).
These flows test both builds of every app.

| Flag | Apps | On | Off |
|---|---|---|---|
| `VITE_HG_REDESIGN` | restaurant, admin (Vite) | `"1"` | anything else, or unset |
| `EXPO_PUBLIC_HG_REDESIGN` | customer, rider (Expo) | `"1"` | anything else, or unset |

Each app reads its flag in its own entry (the app tracks wire that). The flags are **off in every
release build**: [release-builds.yml](../../.github/workflows/release-builds.yml) pins both to
`"0"`, [`scripts/release/app-env.cjs`](../../scripts/release/app-env.cjs) refuses a prod build
with either on (every native build runs it through `app.config.js`), and
[`scripts/release/redesign-off.cjs`](../../scripts/release/redesign-off.cjs) fails the build,
before it and again on the built bundle. A flag compiled to a constant leaves no trace in a
minified bundle, so to make the bundle check positive an app's flag module may log the marker
`hg-redesign:on` inside `if (REDESIGN)`: it is then in a flag-on bundle only, the legacy e2e APK
is checked for its absence, and the redesign APK's check reports whether it carries it.

**Where the tests go.** Tracks add only these files; the config, `serve.sh`, `run.sh`, `lib/`
and `seed/` belong to the harness.

| What | Where | Runs on |
|---|---|---|
| Web redesign specs | `web/redesign-<app>.<topic>.spec.ts` here (for example `redesign-admin.orders.spec.ts`) | the `VITE_HG_REDESIGN=1` build, desktop 1440x900 and tablet 1024x768 |
| Native redesign flows | `native/<app>/redesign/*.yaml` here, in name order | the `EXPO_PUBLIC_HG_REDESIGN=1` APK |
| Device-lab missions | `native/<app>/redesign/missions/<id>.yaml` here | the device lab only, never as flows |

**Playwright projects** are `<app>-<flag>-<viewport>`: `restaurant-legacy-desktop`,
`restaurant-legacy-tablet`, `restaurant-redesign-desktop`, `restaurant-redesign-tablet`, and the
same for `admin`. `--project` takes wildcards (`'*-redesign-*'`). Every project uses `en-CA` and
`America/Toronto`. Legacy projects run the existing `<app>.spec.ts`; redesign projects run the
`redesign-<app>.*` files, and pass when there are none. `web/mode.ts` gives a spec its mode
(`E2E_MODE`), its project (`projectMeta()`: app, flag, viewport) and `mockScenario(page, name)`.
`stepper` writes the legacy desktop project's screenshots to `screenshots/<app>/` as before, and
every other project's to `screenshots/<app>/<flag>-<viewport>[-mock]/`.

**Two modes**, from `E2E_MODE`:

| `E2E_MODE` | API | Data | Workers |
|---|---|---|---|
| `real` (default) | the compose stack (`stack/up.sh`) on :8080 | the seeded world (`world.json`), `make dev-*` scenarios | 1: one world, one order |
| `mock` | `pnpm mock` on :4010 (`serve.sh` starts it) | `contracts/fixtures/**` by scenario: `mockScenario(page, 'order_arrived')` sends `X-Mock-Scenario` | 2 |

The legacy specs read the seeded world, so in mock mode they are not collected. `run.sh` drives
the real stack only; `E2E_FLOWS` (`all` or `web`, formerly `E2E_MODE`) picks its flows.

**In CI** ([e2e.yml](../../.github/workflows/e2e.yml)): the `e2e` label runs the legacy flows,
then each app's redesign specs against its redesign build, both viewports. The legacy specs stay
on desktop: they share one world and one order, and a second pass would find it already taken.
`e2e-full`, the nightly run and Run workflow (`all`) also build a redesign APK beside the legacy
one, for an app with redesign flows only, and run those flows on it after the legacy ones. An app
without redesign specs or flows costs nothing and is recorded as skipped. Redesign specs and flows
run after the legacy cross-app smoke on the same world: Amina's order is still active, so a flow
that needs a fresh order uses Omar or creates what it needs through `lib/api.mjs`. Each redesign
flow gets `PHONE` (the app's persona), `RESTAURANT`, `DISH`, `EXPIRED_RESTAURANT`, `LATITUDE`,
`LONGITUDE`, and `CODE` when the folder has a `1-ask-for-code.yaml` (run first, with the code read
from the API's log). Each redesign spec runs twice against one world (desktop, then tablet), so it
must not depend on state the other pass changed.

**Run it locally:**

```bash
# Mock: no stack, no seed.
E2E_MODE=mock E2E_REDESIGN=1 bash tools/e2e/web/serve.sh     # mock on :4010; legacy 4173/4174, redesign 4175/4176
E2E_MODE=mock pnpm --filter @hg/e2e web --project 'restaurant-redesign-*'

# Real: the stack and the world, as above, then
bash tools/e2e/web/serve.sh                                   # builds a redesign app when it has specs (E2E_REDESIGN=1: always)
pnpm --filter @hg/e2e web --project 'admin-redesign-*'
E2E_FLOWS=web bash tools/e2e/run.sh                           # legacy, then redesign

# Native: a redesign APK, then its flows (in the order run.sh gives them)
EXPO_PUBLIC_HG_REDESIGN=1 node scripts/release/app-env.cjs dev -- pnpm --filter @hg/rider exec expo run:android
cd tools/e2e/native/rider && maestro test -e PHONE=+14165550161 redesign/1-ask-for-code.yaml
```

`serve.sh` builds the redesign into `apps/<app>/dist-redesign/`. A laptop whose
`deploy/.env.e2e` predates the redesign ports needs it deleted once, so `stack/up.sh` writes the
CORS list with 4175 and 4176.

## What it costs

The repository is private, so every minute counts against the account's monthly Actions
allowance (2,000 minutes on GitHub Free, 3,000 on Pro; Linux minutes count once). Estimates until
the first runs measure them; every job has a timeout:

| Run | Jobs | Minutes, about |
|---|---|---|
| Nightly, apps changed | plan 1, two APK builds 2 × 15, flows 30 | 60 |
| Nightly, apps unchanged (the APKs come from the cache) | plan 1, APKs 2 × 1, flows 30 | 35 |
| Nightly, `main` unchanged since the last nightly | plan 1 | 1 |
| A push to a PR labelled `e2e` (web flows) | plan 1, flows 15 | 16 |
| A push to a PR labelled `e2e-full` | as a nightly run | 35 to 60 |
| Run workflow, `flows: web` | plan 1, flows 15 | 16 |
| Each redesign build, once an app has redesign specs or flows | web: about 1 more per app in `flows`; Android: one more APK build, 15 (1 from the cache), and its flows | +1 to +30 |

A month of nightly runs on a busy `main` is about 1,000 to 1,800 minutes, most of a Free
allowance. To spend less: run the nightly on fewer days (the `cron` line in the workflow), or
label only the PRs that change an app's flows. iOS runs would cost ten times as much per minute
on macOS runners and are not part of this workflow
([#77](https://github.com/shaiknoorullah/hg-mono/issues/77)).

## What these flows cannot do yet

| Gap | Effect here | Issue |
|---|---|---|
| The customer app has no card form, and stored Stripe webhooks are never processed | The order is paid by the API's fake payment client. The flow stops to screenshot the checkout where the card would go; paying with a Stripe test card waits for one real payment end to end | [#63](https://github.com/shaiknoorullah/hg-mono/issues/63), [#231](https://github.com/shaiknoorullah/hg-mono/issues/231) |
| No app receives live updates yet | The restaurant test clicks Refresh until the order shows; the rider flow taps "Check again" until the offer shows | [#27](https://github.com/shaiknoorullah/hg-mono/issues/27), [#29](https://github.com/shaiknoorullah/hg-mono/issues/29) |
| The apps are being rebuilt from the approved designs | Selectors follow today's screens (visible text and labels); they change with the rebuilds | [#87](https://github.com/shaiknoorullah/hg-mono/issues/87)–[#90](https://github.com/shaiknoorullah/hg-mono/issues/90) |
| An admin cannot approve a rider through the API | The rider is seeded already approved | [#163](https://github.com/shaiknoorullah/hg-mono/issues/163) |
| The API still takes orders at a restaurant whose certificate expired, if the client knows a dish's id | The flows check only that the customer app never shows that restaurant | [#292](https://github.com/shaiknoorullah/hg-mono/issues/292) |
| Every other journey in the inventory | Not driven yet | [#34](https://github.com/shaiknoorullah/hg-mono/issues/34), [#91](https://github.com/shaiknoorullah/hg-mono/issues/91) |

## Files

| Path | What |
|---|---|
| [`stack/up.sh`](stack/up.sh) | Boots `deploy/docker-compose.yml` with throwaway secrets, migrates, waits until ready |
| [`seed/`](seed/) | The world: `seed.sh`, `world.sql`, `world.mjs`, `verify.sql` |
| [`web/`](web/) | `serve.sh`, the Playwright config (`mode.ts`: mock or real), and the restaurant and admin tests, legacy and redesign. `redesign-<app>.*.spec.ts` are the redesign's specs (flag `VITE_HG_REDESIGN` on), run in the `<app>-redesign-*` projects; `redesign-restaurant.support.ts` signs in for them, against the mock server (`E2E_MODE=mock`) or the real API (`E2E_MODE=real`: it signs in once per test worker as the seeded world's restaurant owner from `world.json` on the e2e stack, or as the devworld `bismillah-grill` owner against `make dev-reset` (or whenever `E2E_DEVWORLD=1`), because sign-in is rate-limited per account). Specs that drive devworld scenarios run only with `E2E_DEVWORLD=1`: they run `make` in `E2E_SERVICES_HG` (default `../../services/hg`) and, if set, run `E2E_RESET_LIMITS_CMD` first, since each scenario signs the customer persona in by phone code, which is rate-limited. `openLive()` signs in and passes the go-live gate on Live orders, as a person does with one click. `redesign-restaurant.sign-in.spec.ts` (2026-10-10, WP2) drives the sign-in form itself: in mock mode every sign-in, register and email-link state, with `page.route` standing in for the login error envelopes the contract has no fixture for; in real mode the live owner signing in (and no token left in `localStorage`), a wrong password, the unverified `fresh` persona, the `suspended` persona reaching its console, forgot password, and a new owner each run going register → check email → verify → sign in → onboarding → forgot → reset → sign in. It reads the emailed verification and reset links from the local database, as devworld does, through `E2E_PSQL_CMD` (default `docker exec -i hg-postgres-1 psql -U hg -d hg -tA`). Set `E2E_RESET_LIMITS_CMD` (for example `docker exec hg-redis-1 valkey-cli FLUSHALL`) so its real-mode tests clear the sign-in rate limits first. |
| [`native/`](native/) | The Maestro flows for the customer and rider apps (`<app>/redesign/` for the redesign APK), and the device-lab missions, routes and result template ([native/README.md](native/README.md)). `pnpm e2e:missions:check` checks every mission and says how to fix each problem; reality steps run once, before the flows |
| [`native/rider/redesign/`](native/rider/redesign/) | The rebuilt rider app's flows (a dev APK built with `EXPO_PUBLIC_HG_REDESIGN=1`) and their `missions/`: what the device lab on the owner's machine runs, with the reality steps (GPS route, network loss, camera, dark mode, font scale) for each. `run.sh` runs the flows (never `missions/`) on the redesign APK in e2e-full, nightly and dispatch runs |
| [`native/customer/redesign/`](native/customer/redesign/) | Flows for the redesigned customer app, built with `EXPO_PUBLIC_HG_REDESIGN=1`, and their device-lab missions (`missions/*.yaml`). The owner's emulator runs the missions ([#656](https://github.com/shaiknoorullah/hg-mono/issues/656)); `run.sh` runs the flows on the redesign APK in e2e-full, nightly and dispatch runs |
| [`reality/`](reality/) | Allow-listed helpers that put the emulator into a mission's conditions: GPS route, network, theme, text size, permissions, lock ([reality/README.md](reality/README.md)) |
| [`lib/`](lib/) | The API client, the sign-in code reader, the TOTP generator, the run summary |
| [`android/allow-cleartext.sh`](android/allow-cleartext.sh) | Lets the emulator's APKs reach the runner over plain HTTP. The release-builds workflow also uses it, for a dev build given an `http://` `api_base_url` ([docs/release/README.md](../../docs/release/README.md#a-build-without-a-tag)). |
| [`run.sh`](run.sh) | Runs the flows in order and records each result |

## API journey runner

`tools/e2e/api/run.mjs` drives the launch path through the API alone (no app UI): an admin, a restaurant, a rider and a customer, from sign-up to a delivered and refunded order. It needs an explicit `--base`, and it refuses unless the API itself reports a non-production environment. It signs in only with the fictional `+1 NPA 555 0100-0199` numbers and a dedicated test staff login from environment variables. Its README is [tools/e2e/api/README.md](api/README.md); it shares the TOTP helper in `lib/totp.mjs`.

