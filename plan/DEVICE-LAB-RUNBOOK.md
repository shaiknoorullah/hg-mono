# Device lab on the owner's machine (Remote Control)

The cloud containers have no KVM, so the customer and rider apps are tested as dev APKs on an Android
emulator on the owner's computer, driven by a Claude Code session that runs there.

## 1. One-time setup on the owner's machine (about 45 minutes)
- Linux with KVM (`ls /dev/kvm`) or an Apple-silicon Mac. 16 GB RAM or more, ~60 GB free disk.
- Install: Android Studio (or cmdline-tools) with an emulator and the system image
  `system-images;android-34;google_apis;x86_64` (`arm64-v8a` on Apple silicon); JDK 17; Node 22 + pnpm;
  Docker; Maestro 2.10.0 (`curl -fsSL https://get.maestro.mobile.dev | bash`).
- Create two AVDs, `hg_customer` and `hg_rider` (Pixel 6, API 34), with `-camera-back virtualscene`.
- Clone the repo and check out `main`; `pnpm install`; `cd services/hg && make up && make migrate && make dev-reset`.
- Start the session from the clone: `claude remote-control` (it then shows in the Claude Code app), and
  give it the prompt in §2. Keep the machine awake and on power for the weekend.

## 2. Prompt for the lab session
> You are the HalalGoes device lab. Read `plan/DEVICE-LAB-RUNBOOK.md` and `plan/DEVICE-LAB.md` on the
> `claude/redesign-canvases` branch. Every 10 minutes: `git fetch`, find missions (§3) on open
> `claude/redesign-*` branches that have no result yet, run each (build the APK from that branch,
> install it on the named AVD, run the flows with Maestro, apply the reality steps), and push the
> results to `claude/device-lab-results`. Never touch production; never push to any other branch.

## 3. Mission file (written by the app tracks)
`tools/e2e/native/<app>/redesign/missions/<id>.yaml` on the track's branch:
```yaml
id: rider-wp4-pickup-code
app: rider            # customer | rider
avd: hg_rider
api: devworld         # the local services/hg with make dev-reset
setup: [ "make dev-scenario s=order-ready" ]
reality:              # optional, applied in order
  - geo-route: tools/e2e/native/routes/restaurant-to-amina.gpx
  - network: edge     # gsm | edge | umts | full | offline | restore
  - theme: dark       # light | dark
  - font-scale: 1.3
flows: [ "tools/e2e/native/rider/redesign/pickup-code.yaml" ]
explore: "Optional free-form instructions for the lab agent to explore with maestro mcp / mobile-mcp and screenshot every state it reaches."
```

## 4. Results (written by the lab session)
`results/<branch>/<mission-id>/<commit-sha>/` on `claude/device-lab-results`: `report.md` (pass/fail per
flow, what was explored, defects found with steps), `screenshots/`, `maestro/` (JUnit + debug), `logcat.txt`.
