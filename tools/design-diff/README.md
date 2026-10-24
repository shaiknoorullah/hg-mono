---
covers:
  - tools/design-diff/**
reviewed: 2026-10-24
---

# Design diff

The owner's bar for the redesigned apps is pixel perfection against the design. This package
measures it, screen by screen: it renders every Claude Design board to a PNG, compares a capture
of the app with the board it names, pixel by pixel, and writes a report with the verdict, where
the screens differ, and what differs in words.

```bash
# 1. The references: every board of the apps you name, from the canvases' mirror branch.
#    --repo names the checkout: pnpm runs the script inside tools/design-diff, and `git archive`
#    resolves its pathspec relative to the directory it runs in, so without it the canvases are
#    looked for under tools/design-diff/ and none is found.
pnpm --filter @hg/design-diff render-refs --repo ../.. --out ../../e2e-out/design-refs --apps restaurant,admin
# 2. Captures: specs and flows that name a board (tools/e2e/README.md, "Design captures").
E2E_MODE=mock pnpm --filter @hg/e2e web --project 'restaurant-redesign-*'
# 3. Compare, then read the report.
pnpm --filter @hg/design-diff diff --refs ../../e2e-out/design-refs --captures ../../e2e-out/design-captures --out ../../e2e-out/design-diff
pnpm --filter @hg/design-diff report --results ../../e2e-out/design-diff
```

**Reading one board from a CI run.** The HTML report is for looking at a board and `results.json`
holds everything, but neither is quick to reach from a slow link — a 28 MB artifact download to read
four lines has taken minutes. So the `design-diff` job also prints the failing boards in words:

```bash
gh run view <run id> --log | grep -A 4 'restaurant/sign-in/Verify-Used'
```

```
FAIL  0.045 %  restaurant/sign-in/Verify-Used
    · 2 patches of difference larger than the 4 px allowed; the largest is 11 x 6 dp at 612, 338 (54 px)
    - Resend code: text #5A6B63 in the design, #44544C in the app.
```

A board **under** the mismatch percentage and still failing is failing the other half of the rule —
no connected group of differing pixels over `maxRegionPx` — and the percentage alone hides that.
Those are the boards closest to passing, so that is the line worth reading first.

**CI runs this on every `e2e-full` or `e2e` run**, in the `design-diff` job of `.github/workflows/e2e.yml`: it renders the boards, compares the captures the `flows` job uploaded, writes the per-area verdict table to the job summary and uploads the HTML report as the `design-diff` artifact. It compares with `--no-strict`, so a failing board reports rather than failing the run — no board passes yet, and a gate that is red before the first one is fixed blocks every merge and tells nobody anything. A regression gate comes once there is something to protect ([#1034](https://github.com/shaiknoorullah/hg-mono/issues/1034)).

**The phone apps are compared in CI too, when the run took native captures** (`e2e-full`, nightly, dispatch; an `e2e`-label run has none, and the native steps are skipped before any board is drawn). After the web comparison the same job stages `screenshots/customer` and `screenshots/rider` from the `flows` artifact into `design-captures-native/`, renders only the customer and rider boards into `design-refs-native/`, and runs a second `diff.mjs --no-strict` into `design-diff-native/`. The bars are cut by `insets.json`, which the `flows` job measures on the emulator right after `design-size.sh` (`tools/e2e/android/measure-insets.sh`, `dumpsys window`); if that was not measured the stock `--profile phone-390` is used. Density is not an option here: each capture's `.capture.json` records it (`wm density`, 3 at 480 dpi). Its verdict table goes to the job summary under "Design fidelity, native", its findings to the log, and `design-diff-native/` is in the `design-diff` artifact. A native crash does not turn the web verdicts red (`continue-on-error`).

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
| `missingBlobs` | Uploaded images (`/_blob/<id>`) the mirror does not carry and the renderer does not draw; they render empty |
| `failedAssets` | Every request the board made of the local server that failed: `[{ url, status }]`. Any entry makes the board a defective reference (see Compare) |
| `browser` | The Chromium binary that drew it |
| `blocked`, `errors` | Requests to other hosts that were refused; what went wrong |

Per area, `manifest.areas` has the artifact's link and the union of its missing images, so they can
be fetched from the artifact's asset store later. A second run into the same folder updates the
boards it renders and keeps the rest.

A note is hidden, not removed, so the pixels are right — and the **box keys ignore it too**. A box
is keyed by the words it shows, which is not `textContent`: that returns the text of hidden
descendants as well, so a note used to put its own words into the key of every box around it and
those boxes could not be paired. A run reported
`Boxes holding "Proposed component: AppBar with brand mark…": the text names more than one box on a
side, so they were not compared` on a board whose pixels were already correct. That changes no
verdict for a web board, which is judged on pixels, but it loses the worded findings for those
boxes — and a native board **is** judged on its layout, so there it can change the verdict.

**The designers' notes.** Boards carry inline notes ("Needs API: …", "Proposed component: …",
"DS issue: …") that are not UI and push the layout. They are hidden before the screenshot and kept
in the manifest (`src/page-scripts.mjs`, `hideNotes`): by the classes the canvases use only for
notes, by their opening words, by small mono-font sentences, and by mono chips screen readers skip
that hold the API's words ("403 ACCOUNT_NOT_ACTIVE", "requirements.past_due"), and by small dashed tags
(`noteTag`: a dashed outline on all four sides, type of 12 px or less, four words or more; the settings
boards' "Mapping: …" tag). A file drop zone is dashed too but large, in body type; a badge such as
"Not verified" is dashed but short, so neither is hidden. The outlines drawn around
proposed components go too, and so does the margin a box kept for a chip hung above it. The rules
are heuristics over today's canvases; a note they miss shows up in the diff as text "only in the
design".

**Same input, same pixels.** React 18.3.1 (`third-party/react/`, MIT, the files the canvases' runtime
loads, checked against its integrity hashes) is in the page before the design system's bundle reads
it. The web fonts are in `third-party/fonts/` (SIL Open Font License, `OFL-*.txt`), as Google Fonts
served them to the canvases; `node src/vendor-fonts.mjs --src <canvases>` refreshes them when a
canvas asks for a new family or weight. **The wordmark.** The boards load the HalalGoes logo as `/_blob/<id>`, bytes that live only in Claude
Design's blob store. The renderer answers those requests with the artwork the apps ship, from
`packages/brand` (`src/wordmark.mjs`), the dark or light file by the surface the board puts it on, with the
letterforms in the theme colour the app paints them. Each upload's surface is listed in `WORDMARK_UPLOADS`
and checked against the drawn board; a new upload id is not drawn and fails its boards until it is listed.
Every other request off the local server is blocked and
listed. The clock is fixed at 9:41 on 1 October 2026 (Toronto), animations are off, and Chromium
starts with the web flows' flags. Each board records the `browser` that drew it, and the Chromium version, in the manifest.

**One browser for both sides.** A board and the capture compared with it must come from the same
Chromium build: builds, and a full Chrome against the headless shell, rasterise text differently,
which fails boards for reasons that are not our UI. Which build is written down once, in
`src/browser.mjs` (`CHROMIUM_BUILD`, today 1223, Chromium 148), and both the reference renderer and
the web captures (`tools/e2e/web/playwright.config.ts`, `design.ts`) read it, so nobody has to set
an environment variable in two places. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` still overrides it, on
both sides alike. `render-refs` stops if the pinned build is not installed rather than drawing with
another. Each web capture gets a `.capture.json` beside it with the browser that took it, and the
diff enforces the match: a capture from a different browser, or one with no recorded browser (taken
before this existed), is reported as `BROWSER MISMATCH`, is not compared, and fails the run like
any other non-PASS verdict. Retake such a capture. Android captures (customer, rider) come from no
browser, so this rule is for the web apps (restaurant, admin) only; see "Native boards" below. Why 1223: playwright 1.50.1 ships build 1155, which cannot parse
`var(--icon-md)` in an SVG `width`, so most sign-in boards do not render on it.

**Launching Chromium.** Chromium always starts with `--no-sandbox --disable-setuid-sandbox --disable-gpu --enable-unsafe-swiftshader --disable-dev-shm-usage`, because on hosts that cannot start Chromium's sandbox the first page died at once and the renderer looked like a hang rather than a failure. `--enable-unsafe-swiftshader` keeps WebGL, in software: without it, under `--disable-gpu`, this Chromium has none, and a screen drawing a map with mapbox-gl (the admin live map) never left its error state. The launch has a 60 second timeout, and both settle waits are bounded at 30 seconds, so a wedged page gives up and says so instead of hanging for ever.

## Compare

`diff` (`src/diff.mjs`) pairs each capture under `--captures` with the board its spec declared (see Pairing),
compares them (`src/compare.mjs`) and writes `<out>/results.json` and, per pair, `diff.png` and
`side-by-side.png` (design, app, difference) under `<out>/pairs/`.

It yields to the event loop once a pair. Node frees an image's memory only on a turn of the event
loop, and without one the diff held every image it had decoded: on CI it grew about 19 MB a pair
until the runner ran out of memory, about 700 pairs in, and the job was cancelled without an error
([#1074](https://github.com/shaiknoorullah/hg-mono/pull/1074) measured it). Keep a loop over pairs
`await`ing; calling `global.gc()` instead does not free them.

**Height (the shared-height scale).** Boards are drawn at a fixed height; a real page is as tall as
its content. Only the rows the capture and the board both have are compared, and the percentage is of
that area. A taller capture is cut to the board's height (the part below was not compared and is noted).
A shorter capture is not padded: its missing rows are not counted as different. They are reported as
`shortfall` (`dp`, and `pctOfBoardArea`, the share of the board's area that was not compared), and a
pair whose shortfall is over `--max-shortfall` cannot `PASS`, because nothing vouches for the part that
was not drawn. The default is `ceil(scale)` device px, one dp of rounding (`results.json` `thresholds.maxShortfallPx` reads `"ceil(scale)"`, or the number you passed): it covers a shortfall that is only
an artefact of converting dp to device px, and nothing larger. A wider allowance would change what `PASS`
means, which is the owner's decision ([issue 877](https://github.com/shaiknoorullah/hg-mono/issues/877)), not
a harness default. The shortfall is always reported, in dp and in device px (`shortfall.dp`, `.px`, the
limit as `.limitPx`), within the limit or not; a `FAIL` whose compared-height percentage is low but whose
shortfall is over the limit says so in its `heightNotes`, the console line and the report. This
changes what the percentage means, so it has a new name: `sharedHeightMismatchPct` (the old
`mismatchPct`, and `informationalMismatchPct`, are gone) and `results.json` carries
`comparison.convention` (`shared-height-v2`), as does every pair; the console prints it, and the report
shows it in a banner and labels a results file from before the change as the older scale. The two
scales are not comparable: before, a page 332 dp short of a 768 dp board read 33.7 % and now reads
5.1 % with a 30.2 % shortfall. Pairs of equal height produce the same number on both scales. Reversing
this is a change to `src/compare.mjs` only. No app and no board changes with it.

**Verdict.** After pixelmatch's anti-aliasing detection, a pair passes when at most 0.1 % of the
board's pixels differ and no connected group of differing pixels is larger than 4 × 4 device px.
Both limits, the 0.1 % and the 4 × 4 cap, are measured in device pixels, not density-independent pixels: on a
390 × 844 board rendered at deviceScaleFactor 3 the 4 × 4 cap is about 1.3 × 1.3 dp.
Anything else fails, with the regions in dp. `--max-mismatch`, `--max-region`, `--max-shortfall` and `--threshold`
(pixelmatch's colour threshold, 0.1) change the bars. A capture of another width is listed as not
compared. Height is described next. A board with any `failedAssets` is `DEFECTIVE REFERENCE`: the diff names the assets and does
not compare it, because the missing picture is the renderer's and would be charged to the app as a UI
difference. The diff fails by default: it exits 1 when any pair is FAIL, NO BOARD (including a board whose
reference recorded errors, and a declared board missing from the manifest), UNCOVERED, DEFECTIVE REFERENCE, NOT COMPARED, BROWSER MISMATCH, NO PROVENANCE or NO LAYOUT;
A second screenshot of a board already captured (a `--captures` directory that holds every screenshot twice, such as `$E2E_OUT` with Maestro's own copies under `maestro/`) is a `duplicates` entry in `results.json`, listed on stdout naming both paths: it is not compared and not counted, so each board counts once, and it fails the run. UNPAIRABLE, a capture its spec declared cannot be compared, does not fail the run; `--no-strict` reports and exits 0, `--strict` is an accepted
alias of the default, and a crash or usage error exits 2. The summary also lists the uncaptured boards
(boards of the rendered apps with no capture); that count alone does not fail the run.

**In words.** When the capture has a `.layout.json` (every Playwright capture does), the diff
matches texts and boxes with the board's and words what differs, most telling first: copy only in
the design or only in the app, type ("28/34 bold in the design, 24/32 semibold in the app"),
text colour, a box's radius, fill, border or shadow, and where the spacing starts to drift.

**Pairing.** A pair is declared, never inferred. A web capture's `.capture.json` names its board
(`board`, `<app>/<area>/<Board>`, written by the spec: `tools/e2e/README.md`, "Design captures"), and
that board wins over the file name and over `--map`. Nothing is matched by similarity. The outcomes:

| The capture's sidecar | Verdict | Why |
|---|---|---|
| `board` names a board in the manifest | compared (PASS, FAIL, ...) | declared |
| `board` names a board that is not in the manifest | `NO BOARD`, naming it | a typo or an unrendered area; never matched to another board |
| `unpairable: { board, reason }` (written under `<app>/unpairable/`) | `UNPAIRABLE`, carrying the reason | a composite board no single screenshot can match; no mismatch percentage, and the run does not fail on it |
| `board: null`, or no `board` at all (an older capture) | `UNCOVERED` | nothing says which board it is for; re-run the capture or declare one in the spec |

`--map pairs.json` (`{ "<path under --captures>": "<app>/<area>/<Board>" }`) names a board for a
screenshot that declares none; it never overrides a declaration, and a map entry that disagrees with a
declared board stops the run. A native capture (customer, rider) cannot declare: a Maestro flow only
names its file, `design--<area>--<Board>.png` in a folder named for the app (or `--app`), so that exact
name is its declaration and is read as one. A web capture is never paired by its file name.
`results.json` records `pairing` (counts of declared, map and name) and each pair's `pairing`; the
summary prints the same.

Layout findings also say a box drawn on one side only, or whose text names several boxes (so it was not
compared). A box with no text is not in the layout snapshot, so a difference confined to one (a border
on a button with no label) is still missed. Widening the snapshot so that a box with no text is
measured too is not part of what [#844](https://github.com/shaiknoorullah/hg-mono/issues/844)
delivered, and is still to do.

## Report

`report` (`src/report.mjs`) turns a diff run into one HTML page that opens anywhere: a table of
every capture, then per capture its verdict, numbers, findings, the designers' notes and the side
by side, embedded at a reduced size (the full-size images are linked). Boards whose notes say the
drawing is not the approved design are flagged first, so nobody moves an app toward a drawing
known to be wrong; a board whose own script failed in the design runtime (its `errors` in the
manifest) is flagged as not trustworthy; the uploaded images missing offline are listed per area.

**The nearly passing pairs, on their own.** In CI the `design-diff` artifact holds every pair's
images; at about 1,100 pairs it passed 900 MB, over an hour to download on a slow link. `near`
(`src/near.mjs`) copies the pairs under 3 % (passing ones included) with their side-by-side and diff
into a second artifact, `design-diff-near`, with `results.json`, `findings.txt` and an `index.txt`
best first. Those are the boards worth reading pixel by pixel:
`gh run download <run> -n design-diff-near`.

## The regression gate

`passing.json` lists every board that has passed on `main`. In CI, after the report, `gate`
(`src/gate.mjs`) fails the `design-diff` job when any listed board is not `PASS` in the run: it
fails, was not compared, or has no capture at all (a capture spec that broke counts). The diff
itself stays `--no-strict`, so the hundreds of boards not passing yet block nothing; only a board
that has passed can. Boards that pass and are not listed are printed in the job log, to be added in
the pull request that makes them pass. Removing one needs its reason in that pull request. `admin/staff/AcceptInvalid` (the invite-link page) is the first admin board on the list.

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
| `src/uiautomator.mjs`, `src/native-geometry.mjs` | A native capture's view hierarchy as a layout record; the geometry and colour verdict and its tolerances |
| `src/maestro-hierarchy.mjs` | The same record from Maestro's own hierarchy JSON, which is where a capture's layout has to come from ([#1026](https://github.com/shaiknoorullah/hg-mono/issues/1026)) |
| `src/report.mjs`, `src/png.mjs` | The HTML report; PNG helpers |
| `src/job-summary.mjs` | A run's verdicts as one Markdown table, areas worst first, for a CI job summary |
| `src/findings.mjs` | The failing boards in words, for a CI job log: why each one is not passing, and where |
| `src/near.mjs` | The pairs under 3 % with their side-by-side and diff images, for the small `design-diff-near` CI artifact |
| `src/gate.mjs`, `passing.json` | The regression gate: the boards that have passed on `main`, and the CI step that fails a run in which one of them does not pass |
| `src/names.mjs`, `src/insets.mjs` | The capture names; the phone profiles and their bars |
| `src/capture-size.mjs` | A board's size from its `canvas.json`, and the viewport a web capture is taken at: a board taller than the window at the same width is captured at its own height, because the consoles scroll inside a fixed-height frame and `fullPage` would stop at the window; and whether a capture is taken at all: only at the board's own width (`widthMismatch`); and the frame a reference is drawn in (`referenceFrame`): a board under 200 dp high is drawn in a 200 dp window and cut to its size |
| `src/vendor-fonts.mjs`, `third-party/` | React and the fonts the boards load, and their licences |
| `android/` | The capture AVDs and the device state; `capture-server.mjs`, which writes a native capture's hierarchy and provenance |
| `test/` | `pnpm --filter @hg/design-diff test:unit`: the verdict, the bars, the names, the findings, which capture specs failed, and the ratchet that fails the captures job on a new failure ([`tools/e2e/web/capture-failures.mjs`](../e2e/web/capture-failures.mjs) — it lives with the e2e suite that writes the reports, and is tested here because what it reports is a board without a capture) |

## Native boards (customer, rider)

Web and native are measured differently, on purpose. A customer or rider board is HTML drawn by
Chromium; its capture is a React Native screen drawn by Android. They use different text
rasterisers, hinting and subpixel behaviour, so they never agree pixel for pixel: "at most 0.1 % of
pixels differ" is the wrong measurement for them, and no amount of good UI work would meet it. The
pixel criterion stays with the web boards, where both sides are the same Chromium.

What the harness does for a native capture:

- **Provenance is required instead of a browser.** Beside the screenshot, a `.capture.json` must
  record `device` (the device or emulator) and `appBuild` (the app version or commit), and should
  record `density` (device px per dp, 3 at 480 dpi). With neither `device` nor `appBuild` the pair is
  `NO PROVENANCE`: untrusted, not compared, and the run fails.
- **A view hierarchy is required.** Beside the screenshot, a `.hierarchy.xml` (`uiautomator dump`).
  Without it the pair is `NO LAYOUT`: reported as its own state, and the run fails. Pixels are never
  a fallback.

  **No native capture has one yet**, so every native pair is `NO LAYOUT` and no tolerance here has
  been measured against a device. `uiautomator dump` needs the one `UiAutomation` connection Android
  grants, and Maestro's driver holds it for the length of a flow — the one moment a design capture
  runs. See [#1026](https://github.com/shaiknoorullah/hg-mono/issues/1026), which has the evidence
  and the ways out; the hierarchy will have to come from the driver rather than from a second client.
- **With both, the pair is `PASS` or `FAIL` on geometry and colour** (`src/native-geometry.mjs`).
  The pixel figure is kept in `results.json` as `informationalSharedHeightMismatchPct` and never sets a verdict:
  no native board passes on pixels.

**Where native captures come from.** Two places, never the same board twice
(`tools/e2e/native/check-boards.mjs`): the Maestro flows (real stack, `design-capture.yaml`), and the
`native-captures` job, which opens boards listed in `tools/e2e/native/boards/<app>.json` on the capture APK
against the mock (`tools/e2e/native/capture/run.mjs`). The runner is not inside a flow, so its
`uiautomator dump` works: it writes the `.hierarchy.xml` and `.capture.json` itself, through
`android/capture-server.mjs`'s `capture()`, once the screen has settled. The e2e workflow's `design-diff`
job merges both into `design-captures-native/<app>/`.

**How a capture is measured.**

1. The hierarchy becomes dp (`src/uiautomator.mjs`): bounds in px divided by `density`, with the
   status and navigation bars cut as for the screenshot (`--insets` or `--profile`). The status bar's
   own views (package `com.android.systemui`) are dropped.
2. The capture and the board must be the same width in dp (1 dp slack). Another width is
   `NOT COMPARED`, not rescaled: stretching 360 dp to 390 dp would hide the responsive differences
   being measured. The scale factor is handled by dp, not by resizing.
3. Only what the screen shows is measured: the board is the whole page, the capture one screen, so
   board elements below the screen's last row are left out.
4. Texts are matched by their words, as for web (`src/layout-diff.mjs`). A matched text must have the
   same top and height, and the same left edge, centre or right edge (a view's box is wider than its
   glyphs, so alignment is not assumed), within the tolerance. Widths of texts are not compared.
5. A board box (one the board draws with a fill) is matched to the capture's view holding the same
   words; its position and size are compared. A view the hierarchy does not list (React Native
   flattens views that only lay out) is counted as unmeasured, not failed.
6. Colour is read from pixels on both sides, the same way: a box's fill is the median of four points
   just inside its edges, a text's ink is the pixel furthest from its background in lightness. Not in
   colour: Chromium draws the board's text with subpixel antialiasing, whose tinted stroke edges are
   further from a cream background than the ink is, so the furthest pixel by colour read #4A4E66 for
   #4A4E48. (A hierarchy dump carries no colours; reading both pictures also covers fills with
   transparency.)
7. The board is `FAIL` when any measurement is outside the tolerance, when fewer than 80 % of the
   board's visible texts are in the capture, or when nothing could be matched at all.

**The tolerances** are the one constant `TOLERANCE` in `src/native-geometry.mjs`, and are written
into each pair's `geometry` in `results.json`:

| Measure | Tolerance | Why |
|---|---|---|
| Position and size | 2 dp | Native text snaps to whole device px (a third of a dp) and the board's CSS px are rounded to half; a dp is rounding, two is a visible slip. `layout-diff.mjs` already words a difference from 2 dp |
| Box fill colour | CIE76 distance 4 | About twice the smallest visible difference (2.3), far above colour management's effect on a flat fill |
| Text ink colour | CIE76 distance 10 | Thin glyphs reach the full ink colour under one rasteriser and nearly under another; a different colour entirely is well over 20 |
| Texts present | 80 % | Board data is sample copy, the capture shows seeded data |

These are judgements, not measurements from a device: tighten or loosen them in that one place once
real captures show the spread.

**Taking the captures.** A Maestro flow cannot run `adb`, so a design capture uses the subflow
`tools/e2e/native/design-capture.yaml` (`SHOT: design--<area>--<Board>`), which takes the screenshot
and asks `android/capture-server.mjs` (started by `tools/e2e/run.sh` for each flow) to write the
`.hierarchy.xml` and `.capture.json` (device, app build, density) beside it. If the server is not
running the flow still passes and the diff reports `NO LAYOUT`.

**Where a native capture's layout comes from.** Not `uiautomator dump`: that is killed while a
Maestro flow is in progress, and a capture runs inside a flow by definition — measured on one device
in one run, `Killed`/`rc=137` during a flow and `rc=0` with nothing driving
([#1026](https://github.com/shaiknoorullah/hg-mono/issues/1026)). Maestro holds the hierarchy anyway
and writes it for any step that failed or was retried, so `tools/e2e/native/design-capture.yaml`
asks for an element named after the capture that nothing has. The capture server takes the newest
such file at the moment the flow POSTs, which is the step straight after that probe, and writes it
beside the screenshot as `<capture>.hierarchy.json`.

It cannot be matched by file name: Maestro names the file from the **literal** command text, so a
real run leaves `step-022-tapOnElement-${SHOT}.json` with the variable unsubstituted. Each file is
used once, so a probe that wrote nothing is given nothing rather than the previous capture's screen.
`diff.mjs` reads `.hierarchy.json` first and falls back to the `.hierarchy.xml` of a dump.

A capture never fails the journey it measures, so the only account of why one is missing is what the
server logged, so it is made to say as much as it can.

It runs the dump inside a device shell that always exits 0 and prints the command's own output and
exit code (`uiautomator dump … 2>&1; echo "rc=$?"`). Reading the host process is not enough: `adb
shell` reports the remote command's status but not what it said, and every capture in CI failed with
`Command failed: adb … uiautomator dump` and nothing on either stream. It also requires the dump to
say it wrote the file, because on several Android versions that command prints
`ERROR: could not get idle state.` and still exits 0 — taken as success, it would copy back whatever
file the device still held, which is the previous screen, and compare it as this one. Node's error
`stderr` is kept too, for the commands that do use it.

The first failure in a run also prints `adb forward --list` once. Maestro drives the device over a
gRPC service in its driver app, on a port it forwards with adb, and that driver already holds the
hierarchy — it logs `View hierarchy received in 36 ms` in the same second a dump fails. Whether the
host can reach that port is the open question in
[#1026](https://github.com/shaiknoorullah/hg-mono/issues/1026). Neither addition can fail a capture.

**Which customer boards are captured.** Of the customer app's 568 boards, 19 are named by a flow
(`grep -rn "SHOT: design--" tools/e2e/native/customer`); the other 549 are listed with a reason in
`tools/e2e/native/customer-boards.mjs` (dark, 360 wide, enlarged text, keyboard, composite or specimen
boards, screens and states no flow reaches, boards the app does not follow). `pnpm e2e:boards:check`
keeps the two lists whole. A board whose screen the flows reach but whose content comes from dev-world
data (restaurant names, prices, a different number of lines) is captured only where the layout at the top of the
screen does not depend on that data; the rest read as unpairable rather than as a layout difference that is
really a data difference. Text and layout from the dev world still differ from the boards' sample copy, so a capture
of a restaurant page fails the "texts present" bar above until the dev world is seeded with the boards' sample restaurant.

**Which rider boards are captured.** Of the rider app's 652 boards, 70 are named by a flow
(`grep -rn "SHOT: design--" tools/e2e/native/rider`); the other 582 are listed with a reason in
`tools/e2e/native/rider-boards.mjs`, and `pnpm e2e:boards:check` keeps the two lists whole, as for the customer app.
The rider boards are drawn in the dark theme, so the rider's captures are taken with the phone dark
(`tools/e2e/run.sh`, and `theme: dark` in the rider missions); the 45 light boards are unpaired.

**Not verified on a device.** The hierarchy parser and the comparison are tested against a
hand-written dump in the AOSP `uiautomator` shape (`test/fixtures/native-home.hierarchy.xml`) and
the capture server against a stand-in `adb`; neither has run against a real emulator or Maestro, as
none was available when this was written. Run one flow on the design AVD and read the result before
trusting a number: that run is [#966](https://github.com/shaiknoorullah/hg-mono/issues/966). Which
emulator takes design captures at all is [#963](https://github.com/shaiknoorullah/hg-mono/issues/963)
— the boards are 390 dp and the emulator the pull-request flows use is a Pixel 6 profile at 411 dp,
so a capture taken there was never compared. The `e2e-full` run now sets that emulator to 1170 x 2758 px at 480 dpi (844 dp of
content plus the 154 px and 72 px bars it measures) before the flows (`tools/e2e/android/design-size.sh`)
and prints the measured size. The screen must be taller than the board by the bars: at exactly 844 dp the
app's window is 75 dp shorter than its board and every footer, primary button and tab bar a board pins to
its bottom sits 75 dp too high.
