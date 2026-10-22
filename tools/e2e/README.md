---
covers:
  - .github/workflows/e2e.yml
  - tools/e2e/**
reviewed: 2026-10-22
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
| A pull request with the **`e2e` label** | The web flows only, on every push while the label is on. No APK build and no emulator: those take the longest ([below](#what-it-costs)). Without the label no job starts |
| A pull request with the **`e2e-full` label** | Every flow, emulator included, on every push while the label is on. The by-hand run for a pull request: a workflow can only be started from the Actions tab once it is on `main`. Remove the label when done |

**Beside the flows, `captures`.** The boards draw states the real stack cannot produce on demand — a
failed payout, an expired certificate, a refused upload — so the specs that capture them are written
against the mock and skip when `E2E_MODE` is real. The `flows` job runs the real stack, so a
`captures` job runs the redesign projects in **mock** mode and uploads what they take. It needs no
compose stack, no Go and no APKs, runs in parallel, and `serve.sh` starts `pnpm mock` itself. Until
it existed, the first run that produced verdicts compared **4** boards where the one run done by
hand compared **143** ([#1049](https://github.com/shaiknoorullah/hg-mono/issues/1049)).

A failing capture spec does not fail that job: a spec that failed took no capture, which the diff
already reports as a board without one, and that is the number to read. A crash still fails it.

Real-mode captures are written to `design-captures-real` and are **not** compared. Three boards are
declared by both a real-mode and a mock-mode spec, measured, and nothing dedupes by board
([#1028](https://github.com/shaiknoorullah/hg-mono/issues/1028)), so comparing both would count
those three twice.

**After the flows, `design-diff`.** Whenever the `flows` job succeeds, a second job renders every
`restaurant` and `admin` board from `claude/redesign-canvases` on the same Chromium build the
captures were taken on, compares the captures with the boards they name, writes a per-area verdict
table to the job summary and uploads the HTML report as the `design-diff` artifact
([tools/design-diff/README.md](../design-diff/README.md)). It is its own job because it needs no
emulator, no stack and no APKs, and a 20-minute emulator run should not wait on rendering boards.

It compares with `--no-strict`: the diff exits 1 on any failing board and no board passes yet, so a
gate there would be red before the first board is fixed and would block every merge. A crash still
fails the job. The regression gate — a board that passed on `main` failing on a pull request — comes
once there is something to protect ([#1034](https://github.com/shaiknoorullah/hg-mono/issues/1034)),
and native captures join it once they have a view hierarchy
([#1026](https://github.com/shaiknoorullah/hg-mono/issues/1026)).

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
| 4 | Rider and restaurant | Maestro and Playwright | The rider signs in, goes online standing at the restaurant and waits on the offer screen; meanwhile the restaurant marks the order ready for pickup and sees its 4-digit pickup code, and the rider receives the dispatch offer for it |
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
| Yusuf | Customer, home 900 m from the grill | `+1 416 555 0112`, through the API, for the redesigned rider's offer (Omar's order is still in flight by then) |
| Bilal | Rider, approved, payouts set up, offline | `+1 416 555 0161` on the Android app |
| Admin | Super admin | `admin@e2e.halalgoes.test`, the run's password and a TOTP code |

Every id starts `e2e00000`, so the rows are easy to find. The password and the TOTP secret are
made fresh for each run and written to `world.json`, which the workflow deletes before it uploads
anything. This seed is where the dev-world harness
([#20](https://github.com/shaiknoorullah/hg-mono/issues/20)) grows from: more personas go in
`world.sql` and `world.mjs`, and `verify.sql` checks each one.

## Run it on a laptop

Needs Docker, Go, Node 22 (the version in `.nvmrc`) with pnpm, `psql`, and for the Android flows an emulator (with KVM)
plus Maestro. From the repository root:

```bash
pnpm install
pnpm --filter @hg/e2e exec playwright install chromium
bash tools/e2e/stack/up.sh        # the stack, on ports 8080 (API), 5432, 6379, 9000
bash tools/e2e/seed/seed.sh       # the world, and e2e-out/world.json
bash tools/e2e/web/serve.sh       # restaurant on :4173, admin on :4174 (and the redesign builds, below)
E2E_FLOWS=web bash tools/e2e/run.sh  # or E2E_FLOWS=all with an emulator attached and the APKs in e2e-out/apk/
```

The web runs and the design captures use one pinned Chromium build, recorded in `tools/design-diff/src/browser.mjs` as `CHROMIUM_BUILD`, currently build 1223 (Chromium 148). The build matters because the Chromium that ships with the pinned Playwright fails to render several boards' icons, and a capture taken on a different build is not comparable: design-diff reports `BROWSER MISMATCH` rather than a pixel figure. The install step above gives you the build the pinned Playwright 1.50.1 ships, 1155, **not** 1223: fetch the pinned build from the release that carries it, **`npx -y playwright@1.60.0 install chromium`**, and check that `~/.cache/ms-playwright/chromium-1223/` now exists — its binary reports `Google Chrome for Testing 148`. Name that version rather than `@latest`: Playwright's bundled Chromium moves on (1.61 ships 1228, 1.63 ships 1243, 1.64 ships 1248), so `@latest` stops providing 1223 and the boards become uncomparable again. **CI does this too**, in the `flows` job, and fails the job if the build is missing rather than capturing on a browser whose pixels cannot be compared. It stays a separate install until one Playwright is pinned everywhere ([aligning the pinned Playwright repo-wide](https://github.com/shaiknoorullah/hg-mono/issues/842)); the reference renderer refuses to draw boards on any other build rather than produce pixels that cannot be compared.

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
| Web redesign specs | `web/redesign-<app>.<topic>.spec.ts` here (for example `redesign-admin.orders.spec.ts`) | the `VITE_HG_REDESIGN=1` build, desktop 1440x900 and tablet 1024x768 — and, where a design board draws a narrower width, phone 320 and 720 (`redesign-restaurant.frame-phone.spec.ts` drives the console frame at both) |
| Native redesign flows | `native/<app>/redesign/*.yaml` here, in name order | the `EXPO_PUBLIC_HG_REDESIGN=1` APK |
| Device-lab missions | `native/<app>/redesign/missions/<id>.yaml` here | the device lab only, never as flows |
| Device-lab flows | `native/<app>/redesign/lab/*.yaml` here: flows that need devworld (`make dev-scenario`, `make dev-journey`), the emulator camera, or backend work that has not merged. They are otherwise the same journeys as the flows beside them, with `takeScreenshot` replaced by design captures and the typing matched to the boards | the device lab, through a mission. `run.sh` does not run the folder: it runs the few files `lab_for_ci` names — those that take design captures **and** need nothing CI lacks, which today is `customer/redesign/lab/1-sign-in.yaml` alone. A named flow **replaces** the file of the same name beside it rather than running as well, because it is that journey plus the captures; running both signs in twice and the second sign-in fails on a stale `CODE`. The other capture-taking lab flows wait on devworld in CI ([#1030](https://github.com/shaiknoorullah/hg-mono/issues/1030)); rider's lab flows take no captures at all |

**Native sign-in, once per run.** Each redesign flow gets the world's values (`PHONE`, and `CODE` when
the app has a `redesign/1-ask-for-code.yaml`, which `run.sh` runs first). The e2e world's phones
are not in the reserved development range, so their codes are random: a flow signs in with
`CODE`, never a fixed code. The rider's `1-sign-in.yaml` signs in once; the flows after it keep
that session with `launchApp: { stopApp: false }`, because a relaunch or `clearState` loses it,
and a fresh sign-in after the code is used needs a new one. Their missions list `1-sign-in.yaml`
first for the same reason. A default under a flow's `env:` is written `${PHONE || "+15550100151"}`: a plain
value there overrides the `-e` values `run.sh` passes, so the flow would sign in someone who is
not in the e2e world.

**The rider's offer, on the emulator.** `run.sh` runs the rider's `redesign/3-offer.yaml` with a
real order: while the flow waits online at the restaurant, it places an order through the API
(`lib/api.mjs place-order redesign`, as Yusuf, and refreshes the restaurant heartbeat first), accepts it with the `@cross-accept` spec and, once the rider is
online, marks it ready with `@cross-ready`. The flow checks the offer shows the drop-off area and
not the address, then declines it. Accepting and the trip stay in the device lab until the backend
takes the pickup code instead of a seal scan ([#315](https://github.com/shaiknoorullah/hg-mono/issues/315)).

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
Only the app under test is running on the emulator: `run.sh` force-stops the rider app once the
cross-app flow has its offer, and the other app before each app's redesign flows. The cross-app
rider stays online on the server, though, so a redesign flow must not assume no rider is online.

**Specs that change the shared restaurant** (2026-10-10, `redesign-restaurant.hours.spec.ts`):
in real mode the Hours journeys read the restaurant's hours and open state through the API first
and put them back in a `finally` (the weekly hours and special dates with one `PUT`, the pause
with a `PATCH` to accepting, unpaused), so the tablet pass and other specs see the world as it
was. They sign in once per persona per worker (sign-in is rate-limited per account). The
`paused@seed.hg` and `suspended@seed.hg` journeys use devworld personas and skip themselves in a
world without them (the CI seed world); the suspended one opens the editor and saves nothing.
In mock mode the spec answers the hours `PUT` and the availability `PATCH` with `page.route`,
echoing what was sent, because the mock forgets every write.
The settings capture for a pause until closing still reads the time, because the Settings Orders card does not use `pause_kind` yet ([#989](https://github.com/shaiknoorullah/hg-mono/issues/989)).

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

## Design captures

A capture that names a design board says "this screen must match that board". The
[design-diff harness](../design-diff/README.md) renders the boards, pairs each capture with its
board by that name, and judges it (a web capture pixel by pixel, a native one by layout geometry); the flows themselves never fail on it.

- **Playwright:** `await expectDesign(page, '<app>/<area>/<Board>')` (`web/design.ts`), for
  example `expectDesign(page, 'restaurant/sign-in/SignIn-Invalid')`. It saves a full-page
  screenshot and a layout snapshot to `$E2E_OUT/design-captures/<app>/<width>x<height>/`.
  `redesign-restaurant.sign-in.spec.ts` names a board for each sign-in state.
- **Maestro:** `runFlow: ../../design-capture.yaml` with `SHOT: design--<area>--<Board>` (it takes the
  screenshot and has the view hierarchy and device recorded beside it), for
  example `design--sign-in--Main` in `native/customer/redesign/lab/1-sign-in.yaml` (a device-lab flow).
  A native capture is judged on layout geometry and colour, not pixels. Capture on the
  design AVD in the state the board is drawn in ([phone captures](../design-diff/README.md#phone-captures)).
  `<area>` is the canvas folder and `<Board>` the file name without `.dc.html`, spelled exactly (case included);
  the app is the folder the screenshots are in, so a customer capture is the board `customer/<area>/<Board>`.
  The captures live in the device-lab flows (`lab/`, and `1-first-run.yaml` that the sign-in mission also runs).
  **8 of the 19 are taken in CI**: the 3 in `1-first-run.yaml`, and the 5 in `lab/1-sign-in.yaml`, which `lab_for_ci`
  in [`run.sh`](run.sh) names because it takes captures and needs nothing CI lacks. It runs **in place of**
  `redesign/1-sign-in.yaml`, being the same journey with the captures added, so the run signs in once. The other 11 are
  in lab flows that need devworld, so they are taken in the device lab until CI has it
  ([#1030](https://github.com/shaiknoorullah/hg-mono/issues/1030)).
  What let any of them run in CI was measuring the width: the CI emulator is a
  Pixel 6 profile, 411 dp wide, and a native capture of another width than its board is not compared, so
  [`android/design-size.sh`](android/design-size.sh) sets it to 1170 x 2532 px at 480 dpi (390 x 844 dp at 3x, the
  device-lab AVD) before `run.sh` and fails the job unless it reads back. The `design-size:` line in the `flows` job's
  log is the measured size, and it has read `390.00 x 844.00 dp` since
  [#1024](https://github.com/shaiknoorullah/hg-mono/pull/1024). Trust a native capture's verdict only when that line does.
  The customer boards that no flow captures, each with its reason, are in
  [`native/customer-boards.mjs`](native/customer-boards.mjs); `pnpm e2e:boards:check` fails on a capture named for a
  board that does not exist, and (with `origin/claude/redesign-canvases` fetched) on a board that is neither captured nor
  given a reason. A new flow screenshot of a board's screen should be named for it; a screen with no board stays unnamed.

Every redesign web spec declares the board of each screenshot it takes, and the board has to be
the exact file `canvases/<app>/<area>/project/<Board>.dc.html` on `origin/claude/redesign-canvases`.
Nothing is matched by name similarity: a capture with no declared board is recorded as `"board": null`
in its `.capture.json` and reported as uncovered. Three helpers in `web/design.ts` and `web/shots.ts`:

- `expectDesign(page, board)` / `expectDesignFor(page, { 1440: board, 1024: tabletBoard })` capture
  for the board declared for the viewport width; a width with no entry takes no capture.
  The restaurant console opens with its side navigation collapsed to icons; for the areas whose
  boards draw it expanded (menu-hours, settings, payouts) `expectDesign` first presses the rail's
  own expand button, unless a panel is open (the rail is then collapsed on the board and the app).
- `declareUnpairable(page, board, reason)` for a **composite** board (several states drawn side by
  side, such as `admin/restaurant-verification/SignIn-Errors`). One screenshot cannot be compared
  with a composite, so the capture goes to `<app>/unpairable/` with the reason in its `.capture.json`
  and is listed as not comparable, never as a 20-odd percent difference. It is also how a board
  that no screen of the app can be paired with is declared, with its reason: a component or a
  specimen drawn alone, or a state that needs a contract operation, a contract field or an owner
  decision the app does not have yet (`redesign-admin.rider-onboarding-unpairable.spec.ts` lists
  the rider onboarding area's, each with its reason). The capture then shows what the app draws
  in that state's place.
- `stepper(app, prefix, boards)` takes the declarations of a step-by-step spec by step name.

`node tools/e2e/web/check-boards.mjs` checks that every declared board exists on the canvases branch.

`<area>` is the canvas folder (`sign-in`, `live-orders`) and `<Board>` the board's file name
without `.dc.html`, as the canvas's `canvas.json` lists it. Then:

```bash
pnpm --filter @hg/design-diff diff --refs <rendered boards> --captures ../../e2e-out/design-captures --out ../../e2e-out/design-diff
pnpm --filter @hg/design-diff report --results ../../e2e-out/design-diff
```

## What it costs

The repository is public, so minutes on GitHub-hosted Linux runners are free and no label or
nightly run spends an allowance (`gh repo view --json isPrivate` says `false`). What a run still
costs is time, and a pull request waits on it. Estimates until the first runs measure them; every
job has a timeout:

| Run | Jobs | Minutes of run time, about |
|---|---|---|
| Nightly, apps changed | plan 1, two APK builds 2 × 15, flows 30 | 60 |
| Nightly, apps unchanged (the APKs come from the cache) | plan 1, APKs 2 × 1, flows 30 | 35 |
| Nightly, `main` unchanged since the last nightly | plan 1 | 1 |
| A push to a PR labelled `e2e` (web flows) | plan 1, flows 15 | 16 |
| A push to a PR labelled `e2e-full` | as a nightly run | 35 to 60 |
| Run workflow, `flows: web` | plan 1, flows 15 | 16 |
| Each redesign build, once an app has redesign specs or flows | web: about 1 more per app in `flows`; Android: one more APK build, 15 (1 from the cache), and its flows | +1 to +30 |

A month of nightly runs on a busy `main` is about 1,000 to 1,800 minutes of run time, which costs
nothing here. To spend less time, label only the pull requests that change an app's flows, or run
the nightly on fewer days (the `cron` line in the workflow). If the repository ever goes private
again, the free allowance is 2,000 minutes a month on GitHub Free and 3,000 on Pro, and this
section's arithmetic matters again. iOS runs need macOS runners, which are slower to get and
run, and are not part of this workflow
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
| [`web/`](web/) | `serve.sh`, the Playwright config (`mode.ts`: mock or real), and the restaurant and admin tests, legacy and redesign. `redesign-<app>.*.spec.ts` are the specs for the redesign (flag `VITE_HG_REDESIGN` on), run in the `<app>-redesign-*` projects; `redesign-restaurant.support.ts` signs in for them, against the mock server (`E2E_MODE=mock`) or the real API (`E2E_MODE=real`: it signs in once per test worker as the seeded world's restaurant owner from `world.json` on the e2e stack, or as the devworld `bismillah-grill` owner against `make dev-reset` (or whenever `E2E_DEVWORLD=1`), because sign-in is rate-limited per account). Specs that drive devworld scenarios run only with `E2E_DEVWORLD=1`: they run `make` in `E2E_SERVICES_HG` (default `../../services/hg`) and, if set, run `E2E_RESET_LIMITS_CMD` first, since each scenario signs the customer persona in by phone code, which is rate-limited. `openLive()` signs in and passes the go-live gate on Live orders, as a person does with one click. `redesign-restaurant.sign-in.spec.ts` (2026-10-10, WP2) drives the sign-in form itself: in mock mode every sign-in, register and email-link state, with `page.route` standing in for the login error envelopes the contract has no fixture for; in real mode the live owner signing in (and no token left in `localStorage`), a wrong password, the unverified `fresh` persona, the `suspended` persona reaching its console, forgot password, and a new owner each run going register → check email → verify → sign in → onboarding → forgot → reset → sign in. It reads the emailed verification and reset links from the local database, as devworld does, through `E2E_PSQL_CMD` (default `docker exec -i hg-postgres-1 psql -U hg -d hg -tA`). Set `E2E_RESET_LIMITS_CMD` (for example `docker exec hg-redis-1 valkey-cli FLUSHALL`) so its real-mode tests clear the sign-in rate limits first. `run.sh` sets both for the e2e stack (`hg-e2e-postgres-1`, `hg-e2e-redis-1`) unless they are already set, and the `fresh` and `suspended` persona tests run only with `E2E_DEVWORLD=1`. The app keeps its session in memory only, so a real-mode spec that checks the server itself takes the owner's token from `liveAccessToken(page)`, never from `localStorage`. `redesign-restaurant.menu.spec.ts` (WP8) answers `getOwnMenu` with a menu covering every row state in mock mode; in real mode it signs in as `bismillah-grill` and `suspended`, toggles an item, adds a category and an item, edits a price, and puts each change back at the end. `redesign-restaurant.payouts.spec.ts` (mock mode only) captures the payout account, the history, one payout open beside it and contact support, 47 design boards in all (the three tablet boards at 1024 and the 320 px reflow board included), serving every state with `page.route` from the mock's fixtures; four composition and component boards are declared unpairable. `redesign-restaurant.history.spec.ts` (mock mode only) captures the Past orders page at `/orders/history`: the list with its status chips and load more, every list state, and a past order open beside it, 13 History boards in all (two are three-board sheets, declared unpairable). It serves the list with `page.route` the way the server answers it, built from the `restaurant_order_*` fixtures. `redesign-restaurant.device.spec.ts` (mock mode only) captures the eight "This device" boards (`Settings-Device` and `Device-*`), giving the page the browser answer each board draws (a notification permission, a sound that plays, is blocked or never ends, a screen that cannot stay on). `redesign-restaurant.documents-upload.spec.ts` (mock mode only) captures seven settings boards the settings spec lists as having no screen ([#883](https://github.com/shaiknoorullah/hg-mono/issues/883)): the sheet that sends a new food safety certificate, business licence or owner ID (`Doc-*`), the cancel question on an upload in flight (`Renew-Cancel`) and the too-early renewal the server turns away with 409 `STEP_NOT_AVAILABLE` (`Renew-TooEarly`); it walks the upload road for real with `page.route` answering each call. `redesign-restaurant.settings.spec.ts` (mock mode only) does the same for the settings pages and the panels beside them (halal certification in every display state and with a renewal beside it, account and orders right now, business profile and its edit panels, documents, sign-in and security, contact support, and the renewed-certificate upload walked from choosing a file to sending it): 83 of the area's 152 design boards compared, 20 declared unpairable (hosts, component boards, and the two phone-width boards, which wait on the phone frame being rewritten in pull request #957), and the rest listed in the spec's header with the reason each cannot be captured (no contract operation for a reviewed change, or no screen in the app yet, [#883](https://github.com/shaiknoorullah/hg-mono/issues/883)). `redesign-admin.orders-captures.spec.ts` (mock mode only, desktop project) declares 102 of the admin orders area's design boards and two unpairable (the two 200% zoom boards): the orders and disputes lists, the order workspace, the cancel and reveal panels and live alerts. 25 of the 102 are the states [issue 1006](https://github.com/shaiknoorullah/hg-mono/issues/1006) added fixtures for (cancel results, system cancellations, delivered orders with refunds, disputes opened at other points, a failed payment, refund and ledger states, dispatch variants and an automatic resolution); they are declared but not yet measured. Every response is a contract fixture served by the mock by scenario name, the browser clock is the fixtures' frozen clock, and the live alerts socket is bridged to the mock's with a realtime fixture named on the address. The boards it leaves out (no screen, or no fixture for the state) are listed in its pull request. `redesign-admin.live-map-captures.spec.ts` (mock mode only, desktop project) captures the seventeen `LiveMap*` boards of the live map pane on the order workspace. Fixtures carry no coordinates, so each capture serves the named fixture with the contract's location fields added; each state is made as it happens (a position that stopped, a socket that drops, the network going away, a session ending, a map that never arrives). The build it runs against sets `VITE_HG_MAP_FLAT` so the map is one flat sunken field with no tiles and no token, which is what the boards draw; the pins' place cannot match, because the boards put each at a fixed pixel. `redesign-admin.refunds.spec.ts`, `redesign-admin.refunds-panel.spec.ts` and `redesign-admin.staff.spec.ts` (mock mode only, desktop project) capture 39 of the admin Refunds area's 57 boards (the Refunds page, and the refund panel in the order workspace through its form, review and every answer the contract lists for issuing) and 37 of the Staff area's 84 (the list in every state a viewer sees, the account panel, the invite results, the 1024, 720 and 320 wide layouts and an invite link that does not work). `redesign-admin.refunds-staff-unpairable.spec.ts` declares the other 18 and 47, each with its reason and the issue that holds it: [refund boards not built](https://github.com/shaiknoorullah/hg-mono/issues/917), [refund boards that disagree with the contract](https://github.com/shaiknoorullah/hg-mono/issues/915), [staff boards that disagree with the contract](https://github.com/shaiknoorullah/hg-mono/issues/908) and [the pages emails link to](https://github.com/shaiknoorullah/hg-mono/issues/1033). The staff accounts are the boards' own, answered with `page.route`, because the contract's staff fixtures carry placeholder names; the refund answers are contract fixtures, with two added for states none described (`order_admin_view_delivered_no_halal`, a restaurant with no halal status on file, and `refund_submitted_no_split`). |
| [`web/design.ts`](web/design.ts) | `expectDesign()`, `expectDesignFor()`, `declareUnpairable()`: a capture that must match a design board, or is declared not comparable ([Design captures](#design-captures)). [`web/check-boards.mjs`](web/check-boards.mjs) checks the declared boards exist |
| [`native/`](native/) | The Maestro flows for the customer and rider apps (`<app>/redesign/` for the redesign APK), and the device-lab missions, routes and result template ([native/README.md](native/README.md)). `pnpm e2e:missions:check` checks every mission and says how to fix each problem; reality steps run once, before the flows |
| [`native/rider/redesign/`](native/rider/redesign/) | The rebuilt rider app's flows (a dev APK built with `EXPO_PUBLIC_HG_REDESIGN=1`) and their `missions/`: what the device lab on the owner's machine runs, with the reality steps (GPS route, network loss, camera, dark mode, font scale) for each. `run.sh` runs the flows (never `missions/`) on the redesign APK in e2e-full, nightly and dispatch runs |
| [`native/customer/redesign/`](native/customer/redesign/) | Flows for the redesigned customer app, built with `EXPO_PUBLIC_HG_REDESIGN=1`, and their device-lab missions (`missions/*.yaml`). The owner's emulator runs the missions ([#656](https://github.com/shaiknoorullah/hg-mono/issues/656)); `run.sh` runs the flows on the redesign APK in e2e-full, nightly and dispatch runs |
| [`reality/`](reality/) | Allow-listed helpers that put the emulator into a mission's conditions: GPS route, network, theme, text size, permissions, lock ([reality/README.md](reality/README.md)) |
| [`lib/`](lib/) | The API client, the sign-in code reader, the TOTP generator, the run summary |
| [`android/allow-cleartext.sh`](android/allow-cleartext.sh) | Lets the emulator's APKs reach the runner over plain HTTP. The release-builds workflow also uses it, for a dev build given an `http://` `api_base_url` ([docs/release/README.md](../../docs/release/README.md#a-build-without-a-tag)). |
| [`run.sh`](run.sh) | Runs the flows in order and records each result |

## API journey runner

`tools/e2e/api/run.mjs` drives the launch path through the API alone (no app UI): an admin, a restaurant, a rider and a customer, from sign-up to a delivered and refunded order. Its rider confirms pickup with the pickup code from the restaurant's order view. It needs an explicit `--base`, and it refuses unless the API itself reports a non-production environment. It signs in only with the fictional `+1 NPA 555 0100-0199` numbers and a dedicated test staff login from environment variables. Its README is [tools/e2e/api/README.md](api/README.md); it shares the TOTP helper in `lib/totp.mjs`.

