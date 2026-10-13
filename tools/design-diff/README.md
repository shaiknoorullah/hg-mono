---
covers:
  - tools/design-diff/**
reviewed: 2026-10-13
---

# Design diff

The owner's bar for the redesigned apps is pixel perfection against the design. This package
measures it, screen by screen: it renders every Claude Design board to a PNG, compares a capture
of the app with the board it names, pixel by pixel, and writes a report with the verdict, where
the screens differ, and what differs in words.

```bash
# 1. The references: every board of the apps you name, from the canvases' mirror branch.
pnpm --filter @hg/design-diff render-refs --out ../../e2e-out/design-refs --apps restaurant,admin
# 2. Captures: specs and flows that name a board (tools/e2e/README.md, "Design captures").
E2E_MODE=mock pnpm --filter @hg/e2e web --project 'restaurant-redesign-*'
# 3. Compare, then read the report.
pnpm --filter @hg/design-diff diff --refs ../../e2e-out/design-refs --captures ../../e2e-out/design-captures --out ../../e2e-out/design-diff
pnpm --filter @hg/design-diff report --results ../../e2e-out/design-diff
```

Paths are relative to `tools/design-diff/`, where pnpm runs the scripts. On a machine where
Playwright's own Chromium is not installed, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a
Chromium or headless shell, as for the web flows.

## Render the references

`render-refs` (`src/render-refs.mjs`) reads the canvases from a git ref (default
`origin/claude/redesign-canvases`, through `git archive`; `--repo` names the checkout) or from a
folder (`--src`), and renders each board at the size its `canvas.json` gives: phone boards (the
customer and rider apps) at 3 device px per dp, as on the 480 dpi capture device; web boards at 1.
`--apps`, `--areas` and `--only <regex on app/area/Board>` pick boards; `--concurrency` (default
3) is the number of pages at once.

It writes `<out>/<app>/<area>/<Board>.png`, a `<Board>.layout.json` (every text and painted box
the board shows, for the worded findings) and `<out>/manifest.json`, per board:

| Field | What |
|---|---|
| `title`, `w`, `h`, `scale` | The board's title and size in dp; device px per dp |
| `theme` | `dark` or `light` when the board's name, title or `data-theme` says so, else null (light) |
| `widthVariant` | `phone-390`, `phone-360`, `web-1440`, `web-1024`… |
| `notes` | The designers' notes hidden from the picture: `{ kind, text }` |
| `caveats` | The notes (or the title) saying the drawing is not the approved design |
| `missingBlobs` | Uploaded images (`/_blob/<id>`) the mirror does not carry; they render empty |
| `browser` | The Chromium binary that drew it |
| `blocked`, `errors` | Requests to other hosts that were refused; what went wrong |

Per area, `manifest.areas` has the artifact's link and the union of its missing images, so they can
be fetched from the artifact's asset store later. A second run into the same folder updates the
boards it renders and keeps the rest.

**The designers' notes.** Boards carry inline notes ("Needs API: …", "Proposed component: …",
"DS issue: …") that are not UI and push the layout. They are hidden before the screenshot and kept
in the manifest (`src/page-scripts.mjs`, `hideNotes`): by the classes the canvases use only for
notes, by their opening words, and by small mono-font sentences. The outlines drawn around
proposed components go too, and so does the margin a box kept for a chip hung above it. The rules
are heuristics over today's canvases; a note they miss shows up in the diff as text "only in the
design".

**Same input, same pixels.** React 18.3.1 (`third-party/react/`, MIT, the files the canvases' runtime
loads, checked against its integrity hashes) is in the page before the design system's bundle reads
it. The web fonts are in `third-party/fonts/` (SIL Open Font License, `OFL-*.txt`), as Google Fonts
served them to the canvases; `node src/vendor-fonts.mjs --src <canvases>` refreshes them when a
canvas asks for a new family or weight. Every other request off the local server is blocked and
listed. The clock is fixed at 9:41 on 1 October 2026 (Toronto), animations are off, and Chromium
starts with the web flows' flags. Render the boards with the Chromium binary the web captures use
(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, or Playwright's default for both): a full Chrome and the
headless shell of the same version rasterise text differently, 0.5 to 1.3 % of a board's pixels.
Each board records its `browser` in the manifest.

## Compare

`diff` (`src/diff.mjs`) pairs each capture under `--captures` with its board by name (below),
compares them (`src/compare.mjs`) and writes `<out>/results.json` and, per pair, `diff.png` and
`side-by-side.png` (design, app, difference) under `<out>/pairs/`.

**Verdict.** After pixelmatch's anti-aliasing detection, a pair passes when at most 0.1 % of the
board's pixels differ and no connected group of differing pixels is larger than 4 × 4 device px.
Anything else fails, with the regions in dp. `--max-mismatch`, `--max-region` and `--threshold`
(pixelmatch's colour threshold, 0.1) change the bars. A capture of another width is listed as not
compared; a taller one is cut to the board, a shorter one padded, and the padding counts as
different. `--strict` exits 1 when a pair fails or names no board.

**In words.** When the capture has a `.layout.json` (every Playwright capture does), the diff
matches texts and boxes with the board's and words what differs, most telling first: copy only in
the design or only in the app, type ("28/34 bold in the design, 24/32 semibold in the app"),
text colour, a box's radius, fill, border or shadow, and where the spacing starts to drift.

**Pairing.** A capture is `design--<area>--<Board>.png`; its app is the nearest folder named for
an app, or `--app`. `--map pairs.json` adds screenshots named otherwise:
`{ "<path under --captures>": "<app>/<area>/<Board>" }`.

## Report

`report` (`src/report.mjs`) turns a diff run into one HTML page that opens anywhere: a table of
every capture, then per capture its verdict, numbers, findings, the designers' notes and the side
by side, embedded at a reduced size (the full-size images are linked). Boards whose notes say the
drawing is not the approved design are flagged first, so nobody moves an app toward a drawing
known to be wrong; a board whose own script failed in the design runtime (its `errors` in the
manifest) is flagged as not trustworthy; the uploaded images missing offline are listed per area.

## Phone captures

A board is the app's content only. A phone capture comes from an emulator whose content area is
the board's size, and loses Android's status and navigation bars before the comparison.

1. **The device.** `android/create-avd.sh design-390` makes an AVD 390 dp wide at 480 dpi
   (1170 px), its height 844 dp of content plus a 24 dp status bar and a 48 dp three-button
   navigation bar (2748 px); `design-360` is the same 360 dp wide (1080 px). Software rendering,
   no device frame. Override the bar heights with `STATUS_DP` and `NAV_DP` if the image measures
   others (step 2 says).
2. **Its state.** With the emulator running, `android/device-setup.sh light` (or `dark`, for
   the dark boards) turns animations off, sets the font scale to 1.0 and the density to 480,
   switches to three-button navigation and the system theme, enters System UI demo mode (clock
   9:41, full battery and signal, no notifications), and measures the bars into `insets.json`
   (`src/insets.mjs`).
3. **A design APK.** The redesign flag on and the API pointed at the mock on the host (the
   emulator reaches the host's `localhost` as 10.0.2.2), built the way the
   [e2e workflow's](../../.github/workflows/e2e.yml) `apk` job builds its APKs:

   ```bash
   pnpm mock &                                    # the mock API on :4010, contracts/fixtures
   export EXPO_PUBLIC_HG_REDESIGN=1 API_BASE_URL=http://10.0.2.2:4010
   cd apps/customer                               # or apps/rider
   node ../../scripts/release/app-env.cjs dev -- pnpm exec expo prebuild --platform android --no-install
   bash ../../tools/e2e/android/allow-cleartext.sh android
   cd android && node ../../../scripts/release/app-env.cjs dev -- ./gradlew assembleRelease \
     -PreactNativeArchitectures=x86_64 \
     -Pandroid.injected.signing.store.file="$PWD/app/debug.keystore" \
     -Pandroid.injected.signing.store.password=android \
     -Pandroid.injected.signing.key.alias=androiddebugkey \
     -Pandroid.injected.signing.key.password=android
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

4. **Capture and compare.** Run the flows (`tools/e2e/run.sh`, or `maestro test`); every
   `takeScreenshot: design--<area>--<Board>` is a capture. Then
   `pnpm --filter @hg/design-diff diff --refs <refs> --captures <screenshots>/customer --app customer --insets insets.json --out <out>`
   (`--profile phone-390` uses the stock bar heights instead of measured ones).

## Files

| Path | What |
|---|---|
| `src/render-refs.mjs` | Renders the boards; the note rules' word and class lists |
| `src/page-scripts.mjs` | Runs in the page: hides the notes, snapshots the layout, waits for it to settle |
| `src/diff.mjs`, `src/compare.mjs`, `src/layout-diff.mjs` | Pairing, the pixel comparison and verdict, the worded findings |
| `src/report.mjs`, `src/png.mjs` | The HTML report; PNG helpers |
| `src/names.mjs`, `src/insets.mjs` | The capture names; the phone profiles and their bars |
| `src/vendor-fonts.mjs`, `third-party/` | React and the fonts the boards load, and their licences |
| `android/` | The capture AVDs and the device state |
| `test/` | `pnpm --filter @hg/design-diff test:unit`: the verdict, the bars, the names, the findings |
