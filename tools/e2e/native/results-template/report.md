<!--
Device-lab result template. The lab copies it to
results/<branch>/<mission-id>/<commit-sha>/report.md on the claude/device-lab-results branch and
fills every section; write "none" rather than deleting one.
Convention: tools/e2e/native/README.md#results
-->
# <mission-id>: PASS | FAIL | BLOCKED

| | |
|---|---|
| Branch | `<branch>` |
| Commit | `<40-character sha>` |
| Mission | `tools/e2e/native/<app>/redesign/missions/<mission-id>.yaml` |
| App and AVD | `<customer or rider>` on `<hg_customer or hg_rider>` (`<emulator serial>`), API 34 |
| APK | `com.halalgoes.<app>.dev`, redesign flag on, built `<time, ET>` |
| API | `<devworld or mock>` |
| Run | `<start>` to `<end>`, ET |

## Setup and reality

| Step | Result |
|---|---|
| `make dev-reset` | ok |
| `network: edge` | ok |

## Flows

| Flow | Result | Time | Notes |
|---|---|---|---|
| `tools/e2e/native/<app>/redesign/<flow>.yaml` | pass | 0 m 00 s | |

Maestro output: `maestro/` (JUnit in `maestro/junit.xml`).

## Explored

What the `explore` instructions asked, what was reached, and the screenshot of each state
(`screenshots/NN-<state>.png`). "none" when the mission has no `explore`.

## Defects

One block per defect. "none" when there are none.

### 1. <one-line summary>

- **Severity:** blocker | major | minor | cosmetic
- **Steps:** 1. … 2. … 3. …
- **Expected:** …
- **Actual:** …
- **Evidence:** `screenshots/NN-….png`, `logcat.txt` around `<time>`

## Lab notes

Anything that made this run unlike the mission (a step skipped, a retry, the emulator restarted).
"none" otherwise.
