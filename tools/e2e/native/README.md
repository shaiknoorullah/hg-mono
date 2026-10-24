# Native flows and device-lab missions

The Maestro flows for the customer and rider Android apps, and the **missions** the device lab
runs against the redesigned apps.

| Path | What |
|---|---|
| `customer/*.yaml`, `rider/*.yaml` | The legacy flows the [e2e workflow](../../../.github/workflows/e2e.yml) runs ([../README.md](../README.md)) |
| `<app>/redesign/*.yaml` | Flows for the redesigned app (flag on, `EXPO_PUBLIC_HG_REDESIGN=1`). Each app track owns its own |
| `<app>/redesign/missions/<id>.yaml` | Device-lab missions, one file each ([below](#missions)) |
| [`mission.schema.json`](mission.schema.json) | The mission format |
| [`check-missions.mjs`](check-missions.mjs) | Checks every mission in the repo: `pnpm e2e:missions:check` (CI runs it) |
| [`check-boards.mjs`](check-boards.mjs), [`customer-boards.mjs`](customer-boards.mjs), [`rider-boards.mjs`](rider-boards.mjs) | Which customer and rider design boards a flow captures (`SHOT: design--<area>--<Board>`) and, for every other board, why none can, or that it is listed in [`boards/<app>.json`](boards) (the boards the capture entry opens against the mock; a board is captured, listed, or unpairable, never two of them): `pnpm e2e:boards:check` (CI runs it; with `origin/claude/redesign-canvases` fetched it also checks every board is accounted for) |
| [`routes/`](routes/) | GPX routes on the devworld map, made by [`routes/build-routes.mjs`](routes/build-routes.mjs) |
| [`media/`](media/) | Files a mission may push to the emulator's photo library |
| [`results-template/report.md`](results-template/report.md) | The report the lab writes per mission run |
| [`../reality/`](../reality/README.md) | The allow-listed helpers that apply a mission's reality steps |

## Captures against the mock

Most of the customer and rider boards draw a state no flow can reach: a request that never answers, a 5xx, a
forced sign-out, a screen nothing opens. The **capture** APK reaches them. It is the redesigned app built with
`EXPO_PUBLIC_HG_CAPTURE=1` against the contract mock (`pnpm mock`, `10.0.2.2:4010`), with a dev-only entry
(`apps/<app>/src/redesign/capture/entry.ts`) that signs in a fixture session, sets the mock scenario, moves the
clock to the fixtures' frozen clock and opens the board's real screen through the app's own navigation. The plan
and the reasons: [issue 1141](https://github.com/shaiknoorullah/hg-mono/issues/1141).

| Path | What |
|---|---|
>>>>>>> origin/main
| [`capture/lib.mjs`](capture/lib.mjs) | Its pure parts (manifest, link, the app's log, "settled"), tested by `capture/lib.test.mjs` (`pnpm e2e:boards:check`) |

The `native-captures` job of the [e2e workflow](../../../.github/workflows/e2e.yml) runs it on an emulator, one
job per app and shard, only when the emulator runs (`e2e-full` label, nightly, dispatch). Its captures join the
flows' in the "Design fidelity, native" table.

**How a board is taken.** The runner stops the app, opens `hg<app>://__capture?board=…&route=…&params=…&scenario=…`
and waits for the app's log to say it acted on the link (`[capture] <board>: …`) or refused it (`[capture]
nothing opened. <why>`). It then waits until the view hierarchy is the same three reads in a row, 700 ms apart
(never a fixed sleep), takes the screenshot, dumps the hierarchy and provenance with the capture server the
flows use ([`capture-server.mjs`](../../design-diff/android/capture-server.mjs)), and keeps the capture only if that
hierarchy is the settled one. The files are `design--<area>--<Board>.png` with `.capture.json` and
`.hierarchy.xml` beside them, the pair the design diff reads. A link the entry refuses, an app that never
answers or crashes, and a screen that never settles are **failed captures with their reason**: the runner exits
1 and names each in the job summary. None is skipped quietly, so a board is listed in the manifest only when it
captures.

**What "captured" proves, and what it does not.** It proves one screen, in one state, matches its board: the
real screen, the real navigator and the real data hooks, fed by the mock. It does **not** prove the backend
answers that way, that a user can reach the state, or that a journey works: the `flows` job (real stack) and
`tools/e2e/api` keep doing that. A list of 1,000 captured boards is not 1,000 end-to-end journeys.

A board is in exactly one of three places ([`check-boards.mjs`](check-boards.mjs)): captured by a flow,
listed in `boards/<app>.json`, or declared unpairable with a reason in `customer-boards.mjs` /
`rider-boards.mjs`. The pilot lists the rider's `shift-offers` states (Home loading, failing, on a delivery,
blocked, offline) and the customer's forced sign-out screens (`sign-in/Blocked-*`) with the loading, failing and
empty states of Home, Browse, Orders, Addresses and Account. The customer's `sign-in/Code-*` boards are not
among them: the entry refuses `code` (a step inside the sign-in flow that owns its state), and the rider's
offer outcomes need a tap or a countdown at a chosen second.

## The device lab

Cloud containers cannot run an Android emulator, so the redesigned apps are tested on an emulator
on the owner's machine, driven by a Claude Code session there (Remote Control). App tracks never
talk to it directly: they commit a **mission** on their branch, and the lab session finds it, runs
it, and pushes a **result** to the `claude/device-lab-results` branch.

## Missions

`tools/e2e/native/<app>/redesign/missions/<id>.yaml`:

```yaml
id: rider-wp4-pickup-code          # kebab-case, unique, equal to the file name
app: rider                          # customer | rider (and the folder it lives in)
avd: hg_rider                       # hg_customer for customer, hg_rider for rider
api: devworld                       # devworld: local services/hg after make dev-reset | mock: pnpm mock
setup: [ "make dev-scenario s=order-ready" ]   # optional, run from services/hg, in order
reality:                            # optional, applied in order
  - geo-route: tools/e2e/native/routes/restaurant-to-amina.gpx
  - network: edge
  - theme: dark
  - font-scale: 1.3
flows: [ "tools/e2e/native/rider/redesign/<flow>.yaml" ]
build:                              # optional: EXPO_PUBLIC_* build env and a note for the lab
  env: { EXPO_PUBLIC_HG_REDESIGN: "1" }
  note: "Clear the Metro cache when building."
explore: "Optional free-form instructions for the lab agent to explore and screenshot."
```

**Setup** commands are only these forms (anything else is refused):

| Command | What |
|---|---|
| `make dev-reset` | Wipe and re-seed the local world: the personas and the Toronto catalogue |
| `make dev-admin` | A sign-in-able dev super admin |
| `make dev-scenario s=<name>` | One devworld scenario. `<name>` must be in `ScenarioNames` in [`scenario.go`](../../../services/hg/internal/devworld/scenario.go); the checker reads it from there |
| `make dev-journey [route=short\|long\|early-rider] [speed=1x\|4x\|max] [auto=none\|restaurant\|all] [manual=rider]` | One live order, driven through the API |

**Reality** steps, each a one-key item (what they run: [../reality/README.md](../reality/README.md)):

| Step | Values |
|---|---|
| `geo-route` | A GPX file in `routes/`, played back at 1 Hz in the background |
| `network` | `gsm`, `edge`, `umts`, `full` (speed and latency), `offline` (Wi-Fi and data off), `restore` |
| `theme` | `light`, `dark` |
| `font-scale` | `0.85` to `2.0` |
| `deny-permission` | `location`, `camera`, `notifications` |
| `lock` | `true` (screen off), `false` (screen on, keyguard dismissed) |
| `background-ms` | `1` to `600000`: home, wait, back to the app |
| `airplane` | `on`, `off` |
| `camera-media` | A file in `media/`, pushed to `/sdcard/Pictures` for the photo library |

Reality steps run once, in order, before the flows. A change in the middle of a flow (airplane mode for one tap, a GPS jump) belongs in the flow itself, for example Maestro `setAirplaneMode`; free-text notes for the lab go in `explore`.

**Flows** are one or more Maestro files under `tools/e2e/native/<app>/redesign/` (never the legacy
flows, never `missions/`). They target `com.halalgoes.<app>.dev`.

**Examples.** `customer/redesign/missions/example-customer-launch.yaml` and
`rider/redesign/missions/example-rider-launch.yaml` are harmless examples: they only launch the
app through `<app>/redesign/0-launch.yaml`. The lab may skip any id starting `example-`. Copy one,
rename it, and set `id` to the new file name.

**Check before pushing:** `pnpm e2e:missions:check`. It fails, with one line per problem, when a
mission does not match the schema, its id is not its file name or is used twice, it sits in the
other app's folder, a setup command is not allowed or names an unknown scenario, or a flow, route
or media file does not exist. It also checks the routes match their generator and runs the reality
helpers' tests.

### How the lab runs a mission

1. Build the dev APK from the mission's branch with `EXPO_PUBLIC_HG_REDESIGN=1`, plus any
   `build.env` the mission sets, and install it on the mission's AVD. `EXPO_PUBLIC_*` values are
   inlined when Metro transforms the code, so clear the Metro cache (`expo start --clear` or a
   fresh `expo export`) whenever the flag differs from the last build: a warm cache serves the
   legacy app.
2. `cd services/hg && <each setup command>` (for `api: devworld`), or `pnpm mock` (for `api: mock`).
3. `node tools/e2e/reality/apply-mission.mjs <mission> --serial <emulator>`; check first with
   `--dry-run`.
4. `maestro test --format junit --output <result>/maestro/junit.xml --test-output-dir <result>/maestro <each flow>`.
5. If `explore` is set, explore with `maestro mcp` or mobile-mcp and screenshot each state.
6. `node tools/e2e/reality/apply-mission.mjs <mission> --serial <emulator> --restore`.
7. Write the result (below) and push it.

## Results

The lab writes each run to the `claude/device-lab-results` branch, and nowhere else:

```
results/<branch>/<mission-id>/<commit-sha>/
  report.md        pass or fail per flow, what was explored, defects with steps (template below)
  screenshots/     every screenshot, numbered in order
  maestro/         Maestro's junit.xml and its debug output
  logcat.txt       adb logcat for the run (adb -s <serial> logcat -d)
```

- `<branch>` is the mission's branch with `/` kept, e.g. `results/claude/redesign-rider-wp4/…`.
- `<commit-sha>` is the full 40-character SHA the APK was built from. A mission "has a result"
  when this folder exists for the branch's current head; a new push means a new run.
- Start `report.md` from [`results-template/report.md`](results-template/report.md).
- Never commit secrets, sign-in codes or the admin TOTP secret into a result.
