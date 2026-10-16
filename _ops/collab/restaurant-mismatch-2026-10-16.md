---
covers: [apps/restaurant/src/components/Shell.tsx]
reviewed: 2026-10-16
---

# What the restaurant design-diff mismatch is made of (16 Oct 2026)

> **Older scale.** Every percentage below counts a short capture's missing rows as different (field `mismatchPct`). The harness now compares over the shared height and reports the shortfall apart (field `sharedHeightMismatchPct`, convention `shared-height-v2`; see [the design-diff README, Height](../../tools/design-diff/README.md)). The two scales are not comparable; pairs of equal height are unchanged.

Analysis of existing output only: `design-diff-out/diff-20261016-0440/results.json` (design-diff run of the redesign canvases at `d117731f`), the board geometry in `design-diff-out/refs/restaurant/*/*.layout.json`, and the per-pair `diff.png` / `side-by-side.png`. No capture, no server, no change to `tools/design-diff`. Tracking: [#658](https://github.com/shaiknoorullah/hg-mono/issues/658); Card border: [#878](https://github.com/shaiknoorullah/hg-mono/issues/878); the unrenderable hours boards: [#853](https://github.com/shaiknoorullah/hg-mono/issues/853).

## Headline

The 20-25 % is **not** a sum of many small things. On the pages that carry the app shell (live orders and menu and hours), **about 10 to 18 points of it is the shell's colour**: the boards paint the left rail and the 56 px header bar in dark green `rgb(27, 59, 49)`, and the app paints both in cream or white. Those zones mismatch at 91-98 % density, so they cost almost their whole area. Everything else (content) sits at roughly the level the admin control already has. Fixing the shell tone (and, on the expanded-rail boards, the rail width) would take live orders from a median 14.5 % to about 4 %, which is what admin scores. It does **not** reach 0.1 %: the residual about 4 % is ordinary content difference, and no board in this run is under 0.28 %.

The rail's width alone is cheap when the colours agree (admin: about 1.6 points per 24 px). Here the width error is expensive for a different reason: the strip between the app's 80 px rail and the board's 224 px rail is dark on the board and light in the app, so the strip costs its full area, about 9 points.

## Attribution (median points of mismatch per board, restaurant pages with the shell)

Groups: live orders at 1440 (n=21, median 14.45 %), live orders at 1024 (n=5, 24.6 %), menu and hours with the 224 px expanded board rail (n=14, 24.5 %), menu and hours with an 80-88 px board rail (n=8, 20.6 %). All 48 together: median 18.7 %, range 12.2 to 29.4 %.

| Cause | Points | How measured | Confidence |
|---|---|---|---|
| Chrome tone: rail (x below 80 px) dark green on the board, light in the app | 4.6 to 5.5 in every group (pixel density 91 %) | Mismatched pixels of `diff.png` inside the rail column, less admin's density for the same zone (8 %) | High |
| Chrome tone: 56 px header bar dark green on the board, light in the app | 4.9 to 5.9 (density 98 %) | Mismatched pixels in rows 0 to 55 right of the rail, less admin's 4 % density | High |
| Rail width: board rail wider than the app's 80 px (224 px boards only) | 8.3 on those 14 boards; 0 to 0.6 elsewhere | Mismatched pixels in the strip between 80 px and the board's rail width (density 91 %), less admin's 8 % | High. The strip only costs this because its colours differ: it is a tone cost wearing a width label |
| Content differs from the board (data, states, row counts, layout below the header) | 0.3 (live 1440) to 7.8 (live 1024) above a baseline of about 3.2; menu and hours 2.3 to 4.6 above it | Content-zone mismatch minus admin's content density (3.7 %) times the same area | Medium. The size is measured, the split inside it is not (below) |
| Content baseline: what admin also has | about 3.2 | The admin control, same method | Medium |
| Page height (capture shorter than board) | 0 on live orders and menu and hours; the whole mismatch on sign-in | `heightNotes` per pair; see the sign-in section | High |
| Card border ([#878](https://github.com/shaiknoorullah/hg-mono/issues/878)) | at most 0.1 to 0.2 | Mismatched pixels within a 2 px band around every board box with a transparent 1 px border, any cause included (median 0.11, 0.17 on 80 px menu boards) | High that it is small. This is an upper bound, because the 1 px inward shift of content inside cards is not isolated |
| Fonts, antialiasing, device scale | at most 0.3 to 0.8 | Sign-in boards share the fonts and have no shell: 13 with no height shortfall sit at median 0.83 %, minimum 0.29 %, and that figure contains every other cause. Every pair is scale 1 | Medium: an upper bound from a control, not a direct measurement |

Per group, in the same order (tone rail, tone header, width strip, content):

| Group | Median total | Rail tone | Header tone | Width strip | Content | Total minus chrome excess |
|---|---|---|---|---|---|---|
| live 1440 (21) | 14.45 | 4.67 | 5.52 | 0.00 | 3.55 raw (0.27 over baseline) | 4.3 |
| live 1024 (5) | 24.64 | 6.49 | 6.25 | 0.00 | 10.98 raw (7.82 over baseline) | 11.9 |
| menu and hours, 224 px rail (14) | 24.52 | 4.59 | 4.94 | 8.28 | 5.22 raw (2.29 over baseline) | 6.7 |
| menu and hours, 80-88 px rail (8) | 20.62 | 5.52 | 5.85 | 0.58 | 7.81 raw (4.62 over baseline) | 8.7 |

The last column is the median total with the three chrome zones brought down to admin's density. For comparison admin's own median in this run is 4.2 %.

## Where the content mismatch sits (live and menu and hours, content zone only)

Mismatched pixels in the content zone, split by what the board has at that spot (median points):

| Region | Live 1440 | Live 1024 | Menu and hours |
|---|---|---|---|
| Inside text boxes the app does not render (board-only copy) | 0.84 | 1.13 | 1.46 |
| Inside text boxes the app renders (same copy, different pixels: font, position) | 0.68 | 1.38 | 1.11 |
| Inside text the app has and the board lacks (estimated boxes) | 0.18 | 0.81 | 0.56 |
| Outside every text box (surfaces, rows, borders, icons, shifted blocks) | 2.13 | 7.15 | 3.28 |

Half of every board's text is not matched in the app (median 43-53 % of board text boxes have no counterpart), because the app is rendering a different state with different seed data: the live orders `Main` board shows two ringing offers and six orders, the capture shows "No new orders" and four orders; the header reads "Zaytoun Grill" against "Hamza H. · Mississauga". That is the state and seed-data cause (the restaurant counterpart of [#961](https://github.com/shaiknoorullah/hg-mono/issues/961)). Its size is bounded by the content table, not separated from layout: across the 48 boards content points correlate only weakly with the unmatched-text share (r = 0.38, slope about 6 points from none to all unmatched).

## Control: admin

Admin (20 numeric pairs): median 4.2 %. Its rail zone (264 px, same dark tone in board and app) mismatches at 8 % density, 1.5 points; its header at 4 %; the rest at 3.7 %. Restaurant minus admin is therefore almost entirely the two dark zones: what restaurant has that admin does not is a light shell drawn where the board draws a dark one.

## The other restaurant areas

* **Sign-in (37 pairs, median 7.0 %)**: no shell. 24 of the 37 captures are shorter than the board (`heightNotes`: "the missing part counts as different"). Mismatch tracks the shortfall at r = 0.998: median shortfall 6.25 % of the frame, residual 1.2 % (range 0.3 to 3.4). **Page height is the entire sign-in story.** Boards with no shortfall: median 0.83 %.
* **Onboarding (4 pairs)**: `App-NotApproved` 2.9, `Docs-LoadError` 2.9, `Docs-None` 5.8, `Tab-AppNotApproved-1024` 33.7 (332 dp shorter than its board, again the whole of it).

## What I could not determine

* **Fix the shell and what remains**: the 4 to 12 % residual is content, layout and state; I could not split it between seed data, different states and layout without a render, because the app-side layout of live orders and menu and hours is not stored (only sign-in has `.layout.json` beside its captures).
* **The width cost and the colour cost on the 224 px boards are not separable** in this data: the strip is wrong in both at once.
* The app's expanded rail never appears in these captures: every shell capture is the collapsed light rail.
* The 0.28 % best board still fails; I did not test whether 0.1 % is reachable on any shell page.

## Method (to recheck)

1. `results.json` `pairs`: 143 records; 109 carry `mismatchPct` (34 are unpairable or have no board). Restaurant: 89 numeric, of which live orders 26, menu and hours 22, onboarding 4, sign-in 37.
2. `mismatchedPx` is exactly reproduced by `pixelmatch(threshold 0.1, includeAA false)` on the two panels of `side-by-side.png` (design | app | diff, equal panels with a 24 px gap): for example `live-orders/Tablet-busy`, 193 794 px both ways, and the share equals px / (width x height).
3. Mismatch mask: the `(230, 0, 90)` pixels of `diff.png`; per pair scaled to the recorded count.
4. Zones: board rail width from `refs/restaurant/<area>/<board>.layout.json` (box at the origin, near full height, dark `bg`, width 40 to 400), app rail 80 px (measured: the rail edge in the app panel is at x = 80, colour `rgb(246, 239, 221)` on `rgb(255, 250, 234)`), header 56 px. Tone zone x below min(board, 80); strip between 80 and the board rail; header rows 0 to 55 right of the rail; content the rest.
5. Admin baseline density per zone from the 20 admin pairs with the same zoning (rail 264 both sides): rail 8.2 %, header 4.1 %, rest 3.7 %. "Excess" = measured minus density times area.
6. Text regions from the board `texts` (x, y, w, h padded 1 px) and the `missing` findings in `layout.findings`; card band from boxes with `border: 1px solid rgba(0, 0, 0, 0)`.
7. Scripts are in the session scratchpad only; each is under 60 lines of Python and a pixelmatch call in Node using the repo's own `pixelmatch` and `pngjs`.

## Where the brief was wrong

* The run has **no settings or payouts boards** (the reference tree has 152 settings layouts, but this run paired live orders, menu and hours, onboarding and sign-in only), and "105 restaurant pairs" is 89 numeric: 12 menu and hours boards have no board and 4 are unpairable, and the hours failures are [#853](https://github.com/shaiknoorullah/hg-mono/issues/853).
* The app rail in every capture is the **80 px collapsed light rail**, not 255 expanded or 63 collapsed.
* "20-25 %" holds only for menu and hours and the 1024 tablets; live orders at 1440 is 14.5 % and sign-in 7 %.
* The admin median of 6.7 % is 4.2 % in this run (orders 8.0, alerts 3.8, restaurant verification 3.9).
* Rail width is not the cause by itself, as the admin test showed; the cause is the tone, and width only matters because the strip is the wrong tone.
