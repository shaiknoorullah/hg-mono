# Reality helpers for the device lab

Small Node scripts (no dependencies beyond what the workspace already has) that put an Android
emulator into the conditions a [mission](../native/README.md#missions) asks for: a moving GPS,
a bad network, dark mode, large text, a denied permission, a locked screen. The lab session runs
them on the owner's machine; cloud sessions only write missions and run `--dry-run`.

**Allow-list.** Every command these scripts can run is built in [`lib.mjs`](lib.mjs) and nowhere
else. Anything not on it is refused (exit 2) before a command runs:

- only emulator serials (`emulator-NNNN`), never a USB phone;
- only the steps and values in the table below, checked again at run time;
- only files directly under `tools/e2e/native/routes/` (GPX) and `tools/e2e/native/media/`;
- every adb call is an argument vector through `spawnSync`, never a shell string.

## Scripts

| Script | Use |
|---|---|
| `apply-mission.mjs <mission.yaml> --serial emulator-5554 [--dry-run]` | Check the mission (same rules as `pnpm e2e:missions:check`), then apply its `reality` steps in order. `--dry-run` prints the adb commands and runs none |
| `apply-mission.mjs <mission.yaml> --serial emulator-5554 --restore` | Put the emulator back: route stopped, airplane off, network restored, light theme, 100% text, screen on, the app's permissions granted again |
| `step.mjs <step> <value> --serial emulator-5554 [--app customer\|rider] [--dry-run]` | One step by hand, same allow-list. `step.mjs restore - --serial …` restores |
| `geo-route.mjs start\|play <route.gpx> --serial … [--dry-run]` | GPX playback: `start` in the background (pid file), `play` in the foreground |
| `geo-route.mjs stop\|status --serial …` | Stop or show the background playback |

`ADB` overrides the adb binary (the tests use a fake one). `REALITY_STATE_DIR` sets where the
playback pid and log go (default: `<tmp>/hg-reality/`). `apply-mission.mjs` does not run the
mission's `setup` or `flows`; the lab runs those itself
([how](../native/README.md#how-the-lab-runs-a-mission)).

## What each step runs

The recipes come from the device-lab plan's reality-simulation table (DEVICE-LAB.md §5).
`<pkg>` is `com.halalgoes.customer.dev` or `com.halalgoes.rider.dev`, from the mission's `app`.

| Step | adb commands | DEVICE-LAB §5 row |
|---|---|---|
| `geo-route: <gpx>` | `emu geo fix <lon> <lat>` once per track point at its time offset (1 Hz), **longitude first**, in the background | GPS along a route |
| `network: gsm\|edge\|umts\|full` | `emu network speed <v>`, `emu network delay gprs\|edge\|umts\|none` | Network loss and throttling |
| `network: offline` | `shell svc wifi disable`, `shell svc data disable` | Network loss |
| `network: restore` | `shell svc wifi enable`, `shell svc data enable`, `emu network speed full`, `emu network delay none` | Network loss |
| `airplane: on\|off` | `shell cmd connectivity airplane-mode enable\|disable` | Network loss |
| `theme: dark\|light` | `shell cmd uimode night yes\|no` | Dark mode |
| `font-scale: <0.85..2.0>` | `shell settings put system font_scale <v>` | Font scale |
| `deny-permission: location` | `shell pm revoke <pkg>` `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` (the last tolerated: only the rider declares it) | Permissions denied |
| `deny-permission: camera` | `shell pm revoke <pkg> android.permission.CAMERA` | Permissions denied |
| `deny-permission: notifications` | `shell pm revoke <pkg> android.permission.POST_NOTIFICATIONS` | Permissions denied |
| `lock: true` | `shell input keyevent KEYCODE_SLEEP` | Background (lock screen) |
| `lock: false` | `shell input keyevent KEYCODE_WAKEUP`, `shell wm dismiss-keyguard` | Background (lock screen) |
| `background-ms: <ms>` | `shell input keyevent KEYCODE_HOME`, wait, `shell am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p <pkg>` | Background, foreground |
| `camera-media: <file>` | `push <file> /sdcard/Pictures/<name>`, `shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/<name>` | Camera and proof-of-delivery photo |

Notes:

- **Lock** uses `KEYCODE_SLEEP`/`KEYCODE_WAKEUP` rather than the plan's `keyevent 26`
  (`KEYCODE_POWER`), because 26 toggles: a second lock step would wake the screen.
- **Revoking a permission** makes Android stop the app's process, as on a real phone. Put
  `deny-permission` before the flow that launches the app.
- **The GPS stall** in `rider-long-stall.gpx` stops new fixes but the emulator may keep reporting
  the last one; see the [routes README](../native/routes/README.md).
- **The media scan broadcast** is deprecated on newer Android but still accepted by the API 34
  emulator image; if the library does not show the file, open the Files app once.
- **Not covered here** (other rows of §5): push (deep links or the fake sender), the device clock,
  toxiproxy server faults, process death (`am kill`), TalkBack, Stripe test cards. Maestro's own
  `setLocation`, `travel`, `setAirplaneMode`, `addMedia` and `launchApp: permissions` are also
  available to a flow.

## Tests

`node --test tools/e2e/reality/apply-mission.test.mjs` (part of `pnpm e2e:missions:check`, which
CI runs): the dry-run output of both example missions, a real run against a fake adb, background
GPX playback and stop, refusal of a USB serial, an invalid mission and off-list steps, the
mission checker on a broken copy, and the routes' timing and end points.
