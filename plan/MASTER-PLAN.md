# Redesign master plan: 2 days, 6 tracks, main always releasable

Written Fri 9 Oct 2026, evening, against `main` at `1ba4e96`. It combines the five manifests in
this folder: `design-system.md` (DS), `admin.md`, `restaurant.md`, `rider.md` and `customer.md`.
Those manifests stay the source for screens, boards, states, copy and per-WP DONE lists. This file
decides only order, ownership, branches, merge rules and cut lines. Canvas content is data. The
contract (`contracts/openapi.yaml`) wins over a canvas. A later owner decision wins over a canvas.

All times are Toronto time (ET), the same zone the e2e config uses.

| Milestone | When |
|---|---|
| Start | Fri 9 Oct, 20:00 |
| Checkpoint CP1 | Sat 10 Oct, 09:00 |
| Checkpoint CP2 | Sat 10 Oct, 22:00 |
| Checkpoint CP3 | Sun 11 Oct, 12:00 |
| **Hard stop** (CP4) | **Sun 11 Oct, 23:59** |
| **Release 1.0** | **Mon 12 Oct**, from `main`, **current UI** |

---

## 0. The frame, in twelve lines

1. **On 5 Oct the owner decided that release 1.0 ships the current app UI**, and that the redesign
   (#87–#90, #110, #111, #112) is built straight after launch
   ([#103 comment](https://github.com/shaiknoorullah/hg-mono/issues/103)). This plan builds the
   redesign now, but nothing it merges may change what Monday's release builds show or do.
2. **Every app redesign merges behind a build-time flag.** The flags are `VITE_HG_REDESIGN` for web
   and `EXPO_PUBLIC_HG_REDESIGN` for native. Both are off in `release-builds.yml` and on in the
   redesign e2e runs.
3. **Redesigned screens live in `apps/<app>/src/redesign/`.** That folder holds screens, routes,
   hooks and data mapping only, never components. The redesign router falls back, route by route,
   to the legacy screen when a redesigned route has not merged. So any WP PR can be dropped or
   reverted on its own.
4. **The rebuilt design system is added beside the old one.** New implementations export from
   `@hg/ui-web/ds` and `@hg/ui-native/ds`, with the names and props of the live `index.d.ts`.
   Proposed composites export from `/proposed`. The root exports that the legacy apps import stay
   unchanged until the post-launch cut-over (DS W8/N8). This replaces the DS plan's in-place swap
   for this weekend only.
5. **W0 is contract and backend work, and some of it is launch-critical.** Once #315 merges, the
   backend refuses a pickup without the code. The legacy rider app must then send the code (#311),
   and the legacy restaurant app must show it. Otherwise Monday's release cannot hand over food.
6. **The critical path is native:** S0 → N0 (NativeWind, or the fallback) → N1 → N2/N3 →
   rider WP3/WP4 and customer WP5/WP6. Also on it: #290 → #315 → rider WP4/WP5 and the customer
   delivery code.
7. **Apps start before the DS is finished.** On Fri night they build shells, data layers, routes,
   tests against fixtures, and screens made from exports that already exist. The `/ds` barrel first
   re-exports legacy components wherever their shape matches the live `.d.ts`. DS WPs then replace
   entries one at a time, and app code does not change.
8. **One owner session on Sat morning gates most composites:** the approval packet (DS §2.3), plus
   a yes or no on merging proposed composites to `main` behind the flag (§6, O1).
9. **Only the DS tracks touch `packages/ui-*`, any `package.json` dependency and
   `pnpm-lock.yaml`.** Only the orchestrator lane touches `contracts/`, the generated client,
   fixtures, devworld, CI, lefthook and shared e2e config. App tracks touch their own `apps/<app>`
   and their own e2e spec files.
10. **The realistic target for Sun 23:59:** every app's "never cut" journeys are redesigned behind
    the flag, merged, and green in mock and real-API e2e. The flag is off, so release 1.0 is
    unaffected. The rest follows the cut lines in §4.
11. **Capacity is about 13 agents:**
    - the orchestrator/W0/harness lane: 1
    - the DS tracks: 2 web and 2 native
    - the app tracks: 2 each
12. **Nothing merges on Monday except release fixes.** W8/N8 cut-over, flipping the flags on and
    deleting legacy screens all happen after launch.

---

## 1. Waves and critical path

### 1.1 W0: contract and backend prerequisites (orchestrator lane, Fri 20:00 → Sat 09:00)

State on 9 Oct (REST API):

| PR | Branch → base | State | Notes |
|---|---|---|---|
| #290 | `feat/contract-handover-codes` → `main` | open, **dirty** | 81 contract files, generated client, mock server |
| #315 | `fix/handover-codes-backend` → **#290** | open, unstable | 45 `services/hg` files. The backend enforces the codes |
| #300 | `feat/contract-address-search` → **#290** | open, unstable | Contract only. **No backend handler** (#179) |
| #312 | `feat/contract-round2-changes` → **#300** | open, **dirty** | Contract plus 4 backend files |
| #644 | `feat/contract-cart-multi-variant` → `main` | open, clean | **Breaking** (`!`). Contract plus 29 backend files |
| #655 | → #644 | clean | One full-price variant group per dish |
| #623 | `feat/staff-2fa-opt-in` → `main` | open, clean | **Breaking.** Staff two-step sign-in is opt-in. Moving money still needs MFA |
| #622 | `feat/devworld-onboard-admin` → `main` | clean | Must change after #623 |
| #654 | devworld Toronto dates | clean | Stabilises admin E8 (the H5 path) |
| #649 | → #634 (customer stack) | clean | Includes the #644 diff. See §2.3 |

**Merge order.** One contract merge at a time. After each one: `pnpm generate`, fixture rebuild
and `pnpm check`. Then post a "rebase now" message to every track.

1. **#644**, together with the minimal legacy-customer adapter so the released app still adds
   dishes. The adapter is `variant_ids`, lifted from #649's `ordering/itemSelection.ts`. Proof:
   Maestro `2-sign-in-and-order` green (`e2e-full`). Then #655, retargeted to `main`.
2. **#623**, then **#622**, rebased and fixed for #623. Proof: legacy `admin.spec.ts` passes
   (label `e2e`).
3. **#290**, rebased on `main`. Contract only, so it is safe to release: seal operations move to
   V1, and the legacy apps must still typecheck.
4. **#315 + #311 + the legacy restaurant pickup-code display, in one window.** Retarget #315 to
   `main`. Do **not** merge #315 until the legacy rider app sends `pickup_code` (#311) and the
   legacy restaurant app shows `pickup_code`. These are launch fixes on legacy screens, not
   redesign. Filing the restaurant issue is the orchestrator's job if it does not exist. Proof:
   `e2e-full` (rider Maestro, restaurant Playwright). **Deadline Sat 09:00.** If it slips, #315
   waits, and every redesign journey that types a code runs against the mock only.
5. **#300**, retargeted to `main`, merges only if `pnpm check` and the conformance gate pass while
   its operations have no handlers. Otherwise it waits. No app needs it: every app has a drag-pin
   or manual-address fallback.
6. **#312**, rebased onto `main`.
7. **#654** at any time.

**Which app WPs need which PR:**

| PR | Hard dependency (cannot ship as drawn without it) | Soft dependency (a fallback ships until it lands) |
|---|---|---|
| **#290 / #315** | restaurant WP4 (PickupCode, DS W7); rider WP4 (pickup code, 422/423) and WP5 (delivery code, 4-cell entry from DS N3); customer WP7 (delivery code, G1/G45) | admin: `overrideHandoverCode` has no board (owner Q6). Nothing to build |
| **#300** | none | customer WP11 (search behind a flag; drag-pin is the default); restaurant WP6 and WP10 (manual address plus pin); DS W7 AddressCombobox and N7 AddressMapPicker |
| **#312** | admin WP-10 and WP-9 (SMS-sender banner); rider WP3 (`dropoff.area`, nullable `radius_m`) | restaurant WP3/WP4/WP9 (pause until closing: hidden until the backend lands); restaurant settings and payouts, and rider WP9 (`support_email`); admin WP-8 (`WRONG_ADDRESS`); customer WP8 (several reports, new refund fixtures, copy drift R7); customer G5/G7 (`replaceCart`, optional) |
| **#644 (+#655)** | customer WP5 (item sheet and cart; fixtures exist only in #644/#649) | restaurant WP4 (`OrderLine.variants[]`, else `variant_name`); DS N3 RadioGroup (one variant per group) |
| **#623 (+#622)** | admin WP-1 (sign-in with the code field conditional; accept-invite step 1 only), WP-8 (`403 MFA_REQUIRED`), WP-11 (staff MFA badges) | DS W3/W5: build QR only if enrolment stays in launch |
| **#335** | none (no board) | customer J4 (mid-session suspension journey) |

### 1.2 W1: design system (Fri 20:00 → Sun 18:00), and what each DS WP unblocks

WP contents and sizes are in DS §4. The order below is changed by the release frame (§0.4) and the
Sunday hard stop. **W8 and N8 (cut-over, delete legacy, lint to error) move to after launch.**

**S0: tokens and guard rails, Fri 20:00–23:00, one agent.**
- `scripts/design-sync`, the pinned snapshot, the parity check.
- Import the 76 live roles as **additions**.
- The composition lint, set to **warn**.
- Create the `/ds` and `/proposed` barrels, re-exporting legacy components where their shape
  matches.
- **Value changes to existing tokens wait for S0b after launch**, because they would alter the
  released UI: `pinRider` to forest, the IBM Plex Mono family, the #167 fixes on existing roles.
  They can come earlier only with the owner's OK (O4).
- Delete `packages/design-tokens` only if nothing imports it. Verify first.

| DS WP (track) | Window | Unblocks (app WPs) |
|---|---|---|
| S0 + W0 shadcn foundation (web) | Fri 20:00–Sat 02:00 | admin WP-1 and restaurant WP1 skeletons (shim barrel) |
| **W1 Core** | Sat 02:00–07:00 | admin WP-1; restaurant WP1, WP2; every list and card |
| **W2 Layout and shell** (SideNav, DetailPanel, SplitPanes, approved) | Sat 07:00–12:00 | admin WP-1 shell → WP-2/5/7/10; restaurant WP1, WP4, WP8, WP10 |
| **W3 Forms** (second web agent, alongside W2) | Sat 07:00–12:00 | admin WP-1 sign-in, WP-4, WP-8 (MoneyInput); restaurant WP2, WP6–WP10 |
| **W4 Feedback** (Banner/InlineAlert with slate, Empty/Error, Countdown silent, PageAnnouncer) | Sat 12:00–16:00 | every screen's states; restaurant WP3 countdowns; admin WP-9 |
| **W6 Data** (LyteNyte grid and cells, FilterBar, DateCell) | Sat 12:00–17:00 | admin WP-2, 4, 5, 6, 7, 8, 11; restaurant WP5, WP8, WP11 |
| **W7a NewOrdersStrip + OfferTile + DeclineForm + StatusCard + PickupCode** | Sat 17:00–22:00 | **restaurant WP3 (critical) and WP4** |
| **W5 Halal (web)** (SevenChecks, DecisionBar, RiderChecklist, HalalBadge expiring) | Sat 16:00–20:00 | **admin WP-3 (the product's claim)**, WP-5, WP-2; restaurant WP10 and the WP4 halal state |
| W7b Weekly hours editor, DocumentViewer, LiveMap port, AddressCombobox/MapPinPicker | Sat 22:00–Sun 06:00 | restaurant WP9, WP6, WP10; admin WP-3 viewer, WP-7 map |
| N0 spike (1 h) → **decision at Sat 01:00** | Fri 20:00–21:00 | picks NativeWind + RNR, or the fallback: RNR primitives styled with StyleSheet (DS risk 2) |
| **N0 foundation** | Fri 21:00–Sat 03:00 | customer WP0, rider WP0 |
| **N1 Core** | Sat 03:00–08:00 | customer WP2–WP9 lists and cards; rider WP2, WP10 |
| **N2 Navigation and overlays** (AppBar tones, BottomNav links, Sheet full/field, Modal, Toast) | Sat 08:00–13:00 | customer WP0 tabs, WP4, WP5; **rider WP0, WP3 (offer)** |
| **N3 Forms** (alongside N2; 56/72 sizes, OTP-6 and 4-cell, RadioGroup price slot, QuantityStepper, DateInput) | Sat 08:00–13:00 | customer WP1, **WP5**, WP6, WP11; rider WP1, WP7, **WP4/WP5 (4-cell)** |
| **N5 Feedback and status** (InlineAlert slate, Empty/Error, WaitProgress, Countdown, ProgressSteps, StatusLabel) | Sat 13:00–17:00 | customer WP7; rider WP2, WP3, WP7/WP8, WP10 |
| N4 Halal (native) (light first; dark roles after the packet) | Sat 13:00–16:00 | customer WP2, WP3, WP4, WP9 (rider shows no halal badge) |
| N6 Lists and content (ListRow, Disclosure, MediaFrame, RestaurantCardCompact, rider composites, FilterChip) | Sat 17:00–22:00 | customer WP2, WP3, WP4, WP9, WP10; rider WP4–WP6, WP9, WP11 |
| N7 Capture and maps (FileUpload, system camera, MapView, MapPreview, AddressMapPicker) | Sat 22:00–Sun 04:00 | rider WP4/WP5 (photo proof), WP8 (documents); customer WP7 map, WP8, WP11 |

**DS reprioritisation rule.** When an app's critical-path WP waits on a DS item, that item jumps
the DS queue. Priority order: restaurant strip, rider offer and handover, customer item sheet and
checkout, admin verification console.

### 1.3 W2: four app tracks in parallel (Fri 21:00 → Sun 18:00)

Each track runs two agents: **stream A** on the critical path and **stream B** on independent
screens. WP numbers follow each manifest.

| Track | Fri night (shim barrel, fixtures) | Sat (after CP1) | Sun until 18:00 (after CP3, only what is in flight) | Critical path |
|---|---|---|---|---|
| **admin** | A: WP-1 shell, routes, data and flag. B: test kit, fixtures requests | A: WP-1 sign-in (#623) → WP-2 → WP-3 (after W5). B: WP-6 → WP-11 | A: WP-3 finish → WP-7 → WP-8. B: WP-5, WP-10, WP-4, WP-9 | WP-1 → WP-2 → WP-3; WP-6 → WP-7 → WP-8 |
| **restaurant** | A: WP1 shell, `refreshSession`-first 401, account-state router. B: WP2 sign-in (public routes) | A: WP3 strip (after W7a) → WP4 (#290). B: WP8 menu → WP6 onboarding I | A: WP4 finish, WP9 hours. B: WP10 settings, WP5 history, WP7, WP11 | WP1 → WP3 → WP4 |
| **rider** | A: WP0 foundation (theme follows the phone, 3 tabs, outbox, router). B: test util (operationId → scenario shim) | A: WP1 → WP2 → WP3 (after N2) → WP4 (#290/#315). B: WP10, WP9, WP7 | A: WP5 → WP6. B: WP8, then WP11 if time | WP0 → WP1 → WP2 → WP3 → WP4 → WP5 |
| **customer** | A: absorb the #625 stack (§2.3), WP0 shell. B: WP1 sign-in logic port | A: WP4 → WP5 (#644) → WP6. B: WP2, WP11 (drag-pin), WP1 views | A: WP7 (#290) → WP8. B: WP3, WP9, WP10 | WP0 → WP4 → WP5 → WP6 → WP7 |

### 1.4 W3: e2e hardening (Sun 12:00 → 23:59)

- Real-API journeys for each track's merged WPs, from the manifests' §6 journey tables:
  - admin E1–E27, the subset that shipped;
  - restaurant §6 column (b);
  - rider `1-sign-in` to `6-cancel`;
  - customer J1–J20, the subset that shipped.
- Both viewports on web: 1440x900 and 1024x768. Light and dark on native.
- Flag off, run the full legacy suite. **Release 1.0 must be green there.**
- From 20:00, no new WP PRs. Fix only.
- Final step at 23:30: a release-build dry run on `main` with the flags off (`release-builds.yml`,
  workflow_dispatch) and `e2e-full` nightly-equivalent. Then hand over to release.

### 1.5 Critical path

```
Fri 20:00  S0 ──► N0 spike ─(Sat 01:00 decision)─► N0 ─► N1 ─► N2 ∥ N3 ─► rider WP3 ─► rider WP4 ─► rider WP5 ─► e2e-full
                                                                     └──► customer WP5 ─► WP6 ─► WP7 ─────────────┘
Fri 20:00  #290 rebase ─► #290 ─► #315 + #311 + restaurant code display (Sat 09:00) ─┘ (rider WP4/5, customer WP7, restaurant WP4)
Web:       S0 ─► W0 ─► W1 ─► W2 ∥ W3 ─► W4 ─► W7a ─► restaurant WP3 ─► WP4
                              └──► W6 ─► admin WP-2 ─► (W5) ─► admin WP-3 ;  W6 ─► admin WP-6 ─► WP-7 ─► WP-8
Owner:     approval packet Sat 09:00–11:00 ─► proposed composites usable; dark halal roles (customer dark boards)
```

Slack is about zero on native. If the N0 decision is late, the customer and rider tracks take the
N0 fallback at Sat 01:00 without waiting.

---

## 2. Tracks, branches and PR strategy

### 2.1 Branch names

Git cannot hold both `claude/redesign-admin` and `claude/redesign-admin/<x>`, because a ref
cannot be a file and a folder at once. So WP branches use a **suffix**, not a path.

| Track | Track branch (first PR, then the integration point) | WP branches | PR strategy |
|---|---|---|---|
| DS web | `claude/redesign-ds-web` (S0 + W0) | `claude/redesign-ds-web-w1-core`, `-w2-layout`, `-w3-forms`, `-w4-feedback`, `-w5-halal`, `-w6-data`, `-w7a-strip`, `-w7b-console`, `-deps-<n>` | One PR per WP (DS §4). Stack only where the table says "depends". Merge each within 1 h of green so the stacks stay one deep |
| DS native | `claude/redesign-ds-native` (N0) | `-n1-core`, `-n2-nav`, `-n3-forms`, `-n4-halal`, `-n5-feedback`, `-n6-lists`, `-n7-capture-maps`, `-deps-<n>` | Same |
| admin | `claude/redesign-admin` (WP-1: flag, router, shell) | `claude/redesign-admin-wp2-restaurant-queue`, `-wp3-halal-console`, … | **Fan-out PRs per WP**, each based on `main` after the track PR merges. They are not deep stacks: WPs are separate route sets |
| restaurant | `claude/redesign-restaurant` (WP1) | `-wp2-sign-in`, `-wp3-strip`, `-wp4-live-board`, … | Fan-out. WP4 stacks on WP3, because they share the panel and the strip |
| rider | `claude/redesign-rider` (WP0) | `-wp1-sign-in`, `-wp2-home`, `-wp3-offer`, `-wp4-pickup`, `-wp5-dropoff`, … | Fan-out. WP3 → WP4 → WP5 is a real stack, so merge each as soon as it is green |
| customer | `claude/redesign-customer` (WP0 + the #625 absorption) | `-wp1-sign-in`, `-wp4-restaurant`, `-wp5-item-cart`, `-wp6-checkout`, `-wp7-tracking`, … | Fan-out. WP5 → WP6 → WP7 is a real stack |
| orchestrator | `claude/harness-e2e-config` (shared e2e config), `claude/harness-fixtures-<n>`, `claude/harness-devworld-<n>` | — | Small, serialized PRs |

**Every PR, whatever the track:**
- Title prefix per CONTRIBUTING.md (`feat(admin): …`), which sets the label.
- One PR does one thing.
- Body sections:
  - the boards covered, with side-by-side screenshots;
  - the constitution §5 gate checklist;
  - Needs-API items hit, each with its issue;
  - "flag-off build unchanged: yes".
- **Droppable test:** reverting the PR leaves `main` green and the flag-off build byte-for-byte
  equivalent in behaviour. CI proves it: legacy e2e at flag off (label `e2e`), plus redesign specs
  at flag on.

### 2.2 Merge rules

- Merge to `main` with CI green, plus label `e2e` for web PRs and `e2e-full` for native PRs that
  touch navigation, config or deps.
- Squash-merge.
- No force-push to `main`.
- The orchestrator merges. Track agents do not merge their own PRs, so contract and lockfile
  rebases stay serialized.

### 2.3 Customer: absorbing the #625 stack

The stack, open and built on the legacy `@hg/ui-native` with app-local components:
- #625 → `main`
- #634, #635 and #639 → #625
- #649 → #634, and it includes the #644 diff

Between them they edit `packages/ui-native` (BottomNav, AppBar, Input, Radio `priceCents`,
QuantityStepper, Icon maps, `order-track`), `packages/ui-web` (#634, #635), `pnpm-lock.yaml`,
`deploy/` and `RELEASING.md` (#639). They visibly change the released customer app, which the
5 Oct decision defers. So they are **not merged to `main` as they are**.

1. **Fri 20:00, orchestrator:** merge #644 with the legacy adapter (§1.1). Put #625, #634, #635,
   #639 and #649 in draft, with a comment saying "superseded by `claude/redesign-customer-*`; logic
   carried over; close when the replacing WP merges". Closing them needs the owner's OK (O3).
2. **Fri 20:00–Sat 02:00, customer stream A** on `claude/redesign-customer`:
   - Port their **non-UI logic** into `apps/customer/src/redesign/` and shared non-UI modules:
     `signin/*`, `api/auth.ts`, `api/support.ts`, `ordering/itemSelection.ts`, `addErrors.ts`,
     `lines.ts`, `payments/*`, `sheetController.ts`, `confirmResult.ts`, `tracking/*`,
     `realtime/orderSocket.ts`, `discover/format.ts`, `useActiveOrder`.
   - Keep their tests, including "request never carries a price".
   - Drop their app-local UI components.
3. **Their `packages/ui-native` and `ui-web` edits go to the DS tracks as a patch**, not as app
   commits. Customer stream A exports `git diff main...<pr> -- packages/` per PR and sends it to
   `claude/redesign-ds-native`. The DS track folds it into N2 (BottomNav, AppBar), N3 (Input,
   Radio price slot, QuantityStepper), N1 (Icon map) and N5 (`order-track`).
4. The `pnpm-lock.yaml` change from #639 goes to the native deps window. The `deploy/` and
   `RELEASING.md` changes go to the orchestrator lane: release-relevant, reviewed on their own.
5. WP mapping, from the customer manifest's "What the open PRs already do":

   | WP | Takes from |
   |---|---|
   | WP0 tabs | #625 |
   | WP1 | #635 sign-in |
   | WP2, WP4 | #634 |
   | WP5 | #634 + #649 |
   | WP6, WP7, WP9 | #639 |
   | WP10 | #635 account |

**Fallback (O3 = "merge them for 1.0").** Rebase the stack in the stated order: #625 → #634 →
#649 → #639 → #635 last. Gate each on `e2e-full`, merged by Sat 09:00. N0 then starts on top of
them. Past Sat 09:00, the absorption above applies regardless.

---

## 3. Shared-file conflict hotspots and rules

| Hotspot | Who may edit | Rule |
|---|---|---|
| `packages/ui-web/**` | DS web track only | Apps file a **DS request** (below). Never edit locally, even a one-line fix |
| `packages/ui-native/**` | DS native track only | Same. The customer stack's package edits arrive as patches (§2.3) |
| `pnpm-lock.yaml`, every `package.json` `dependencies`/`devDependencies` (apps included) | DS tracks only, in **deps windows**: Fri 23:00, Sat 13:00, Sat 21:00, Sun 11:00 | One `-deps-<n>` PR per platform per window. Apps request dependencies through the DS track. Native additions change the release APK even with the flag off, so a native deps PR needs `e2e-full` green. NativeWind wiring in `apps/*/babel.config.js` and `metro.config.js` (N0) follows the same rule. If it is not green by **Sat 15:00**, take the StyleSheet fallback |
| `contracts/openapi.yaml`, `contracts/fixtures/**` (and `_build`), `packages/api-client/src/generated/**`, `tools/mock-server` | Orchestrator lane only | Contract changes are W0. App tracks never run `pnpm generate` into a commit. Fixtures are generated: change the builder. Fixture requests are batched into `claude/harness-fixtures-<n>` PRs, every ~4 h. After each merge, tracks rebase |
| `services/hg/**` (devworld personas and scenarios) | Orchestrator lane | Scenario requests from the manifests' "missing seed" lists, batched (§5.4) |
| `.github/workflows/**`, `lefthook.yml`, root `package.json` scripts, `coverage/` | Orchestrator lane | A single PR on Fri adds the redesign e2e matrix (§5.3). Tracks do not touch CI |
| `tools/e2e/web/playwright.config.ts`, `tools/e2e/run.sh`, `tools/e2e/seed/**`, `tools/e2e/lib/**` | Orchestrator lane (`claude/harness-e2e-config`, Fri night) | Tracks add **only their own spec files** (§5.2) |
| `apps/<app>/src/App.tsx` / entry, flag switch | That app's track | The flag switch lands in the track's first PR. Legacy screens are not edited, except W0 launch fixes (#311, the restaurant code display), which the orchestrator lane owns |
| `docs/decisions/README.md`, `CLAUDE.md` §7–8, `docs/design/02-components.md` | Orchestrator (decisions, CLAUDE); DS tracks (component docs) | Record owner answers the same day |
| `apps/*/src/components/**` | Nobody adds | The composition lint (S0, warn) reports new files. Reviewers refuse them |

**DS request protocol (app → DS).**
1. The app agent comments on the matching DS issue (#191–#198, or #167 for tokens). The comment
   gives the component name, the variant or state needed, the board path, the app WP it blocks and
   the time needed by.
2. The app agent sends the same message to the DS track session (SendMessage).
3. The DS track answers within 30 min with the export name and an ETA.
4. While waiting, the app builds the rest of the screen and leaves a typed TODO naming the issue.
   It never builds a placeholder component.

**Rebase cadence.** Each track rebases its open branches on `main` after every W0, fixture or deps
merge. The orchestrator announces those merges.

---

## 4. Timeline, checkpoints and cut lines

### Fri 20:00–24:00 (kick-off)

- **Orchestrator:**
  - #644 with the legacy adapter;
  - #623 → #622;
  - #290 rebase;
  - `claude/harness-e2e-config`;
  - put the customer stack in draft;
  - book the owner session for Sat 09:00.
- **DS web:** S0, then W0.
- **DS native:** N0 spike, then N0.
- **Apps:** first track PR (flag, router, shell on the shim barrel, data layer, test kit). Customer
  absorbs the stack.

### CP1, Sat 09:00

**Exit criteria:**
- #644, #623 and #290 are merged.
- #315 + #311 + the restaurant code display are merged, or explicitly deferred (then mock-only
  code journeys).
- S0, W0, W1, N0 and N1 are on `main`.
- The NativeWind decision is taken.
- Each app's first track PR is merged, with the flag off and the legacy e2e green.

**Owner session (09:00–11:00):**
- the approval packet (DS §2.3);
- O1–O6;
- app questions marked "launch-relevant" in §6.

**Cut line A, if CP1 is missed:**
- web: drop W7b to "DocumentViewer image only";
- native: drop N7 maps to the text-panel degrade;
- admin: drop WP-4, WP-9, WP-10 What's new;
- rider: drop WP11;
- customer: drop WP3 filters, WP10 What's new and App settings.

### CP2, Sat 22:00

**Exit criteria:**
- W2, W3, W4, W6, N2, N3 and N5 are merged.
- W5 and W7a are in review.
- Packet approved, or the fallback is declared: legacy hand-built components through `/ds`,
  recorded as debt.
- Each app's sign-in and shell plus its first core screen are on `main` behind the flag:
  - admin WP-1, WP-2, WP-6;
  - restaurant WP1, WP2 and the WP3 data layer;
  - rider WP1, WP2, WP10;
  - customer WP1, WP2, WP4.
- Mock-layer e2e is green for each of them.

**Cut line B (apply the manifests' cut lists down to here):**
- admin cut list items 1–4;
- restaurant 1–4;
- rider 1–3;
- customer 1–5.

### CP3, Sun 12:00

**Exit criteria (money and the claim):**
- admin WP-3 (verification console) and WP-7 merged; WP-8 in review;
- restaurant WP3 + WP4 merged;
- rider WP3 + WP4 merged;
- customer WP5 + WP6 merged.

**Cut line C:**
- No WP that has not started may start.
- Remaining work, in this order: rider WP5 → WP6; customer WP7 → WP8; admin WP-8; restaurant
  WP9 → WP10.
- The rest of every manifest's cut list applies.
- W8/N8 are confirmed as post-launch.

### CP4, Sun 23:59: hard stop

- 20:00: feature freeze. Only fixes and e2e.
- 23:30: release dry run on `main`, flags off: release-builds dispatch plus a full e2e run.
- At 23:59, whatever is not merged is dropped. Branches are kept and PRs stay open for after
  launch.
- Record in #257 and #103 what the redesign reached behind the flag.

### Never cut (from the manifests)

| Area | Never cut |
|---|---|
| Halal | Badge rules (missing field shows nothing, expired is slate, expiring is amber with its date); the admin seven-check console; the customer certification sheet |
| Money paths | Restaurant strip accept/decline/sound/keys and Mark ready with the pickup code; rider offer, pickup code and drop-off proof; customer item sheet → checkout → tracking → outcome; admin refund panel 202/409 |
| Access | Sign-in and forced routes in every app |
| States | Empty, loading and error on every screen that ships |
| Release | The flag-off release staying green |

---

## 5. E2E harness, common to all apps

### 5.1 Two layers, one scenario vocabulary

| Layer | What runs | Data | Used for |
|---|---|---|---|
| **A. Mock** | Screen tests (`vitest` web, `jest` + RNTL native). Playwright against Vite on `pnpm mock` | `contracts/fixtures/**` through `tools/mock-server` (`:4010`, WS `/v1/ws`). Scenario **per operation**, via `X-Mock-Scenario` / `?scenario=` / cookie | Every board state. Runs on every PR, fast, no stack |
| **B. Real API (devworld)** | Playwright (web) and Maestro (native) against `services/hg` in the compose stack (`tools/e2e/stack/up.sh`) | `make dev-reset` personas; `make dev-scenario s=…`; `make dev-journey route= speed= auto= [manual=rider]`; `make dev-admin` / `dev-totp`; the e2e seed `tools/e2e/seed/world.sql` | Journeys across apps. One order goes through customer → restaurant → rider → admin |
| **C. Device lab (native, real devices)** | **TBD by device-lab research** | — | Placeholder. Today: the Android x86_64 emulator in CI (`e2e-full`, nightly); exploratory runs through mobile-mcp |

**Shared pieces.** The orchestrator lane builds these on Fri night in `claude/harness-e2e-config`:

- **Operation-to-scenario shim.** One module per platform maps `operationId` to a fixture scenario
  for screen tests:
  - web: `@hg/ui-web/testing` gains `mockApi({ op: scenario })`;
  - native: `@hg/ui-native/testing` gains the same.

  Rider WP0 and customer WP0 both asked for this. Build it once. It lives in a DS package, so the
  DS tracks merge it, and the orchestrator writes it.
- **Flag in tests.** `renderRedesign()` sets the flag. Legacy smoke tests run unchanged.
- **Playwright.** Projects `desktop` (1440x900) and `tablet` (1024x768), times two:
  - `legacy`, flag off, the existing specs;
  - `redesign`, flag on, files `tools/e2e/web/redesign-<app>.*.spec.ts`.

  `mock` and `real` modes come from an env var. Settings: `en-CA`, `America/Toronto`,
  `workers: 1` on the real stack. Screenshots per step through `shots.ts`/stepper.
- **Maestro.** Redesign flows in `tools/e2e/native/<app>-redesign/*.yaml`. The dev APK is built
  with `EXPO_PUBLIC_HG_REDESIGN=1`, a second APK beside the legacy one. Reality simulation, from the
  rider and customer manifests §6:
  - GPS: `travel` and `adb emu geo fix`;
  - network loss: airplane mode and `svc data|wifi`;
  - dark mode: `cmd uimode night yes`;
  - 200% text: `font_scale 2.0`;
  - camera: virtual scene plus `adb push`;
  - lock screen: `keyevent 26`.
- **Helpers.** OTP from the API log (`tools/e2e/lib/otp.mjs`), TOTP (`totp.mjs`), API actors
  (`api.mjs`). Add helpers for "read `pickup_code` / `delivery_code` from the API" (needs #290)
  and "admin cancel / reassign".
- **Visual check.** Each step screenshot goes in an HTML side-by-side report with the canvas board
  PNG, exported from Claude Design. DS components are checked against `preview.html` renders
  (DS §5.2). A human reviews. Pixel diff is cut first.

### 5.2 Ownership

- Each app track owns its spec and flow files and its screen tests.
- The orchestrator owns config, seed, helpers, CI, fixtures and devworld.
- Journeys that cross apps (place in customer, accept in restaurant, pick up in rider, refund in
  admin) are written by the orchestrator in W3, from the tracks' merged flows.

### 5.3 CI integration

| Trigger | What runs |
|---|---|
| Every PR (`ci.yml`) | `pnpm check`, unit and screen tests (layer A), lint (L-4, composition lint as warn), typecheck of legacy and redesign |
| Label **`e2e`** | Web flows on the real stack: **legacy (flag off) and redesign (flag on)**, both viewports. Required for web app PRs and DS web PRs |
| Label **`e2e-full`** | Everything: web plus both APKs (legacy and redesign) on the emulator. Required for native app PRs that change navigation, config or deps, for DS native deps or N0 PRs, and for W0 PRs that change what the legacy apps send (#644, #315, #311) |
| Nightly 05:30 UTC on `main` | Everything, with legacy and redesign flags. Sat and Sun nightlies are the checkpoint evidence |
| Workflow dispatch on Sun 23:30 | Release dry run (flags off) |

The orchestrator adds the `redesign` dimension to `e2e.yml` and keeps its trust rules: read-only
token, no `pull_request_target`, pinned actions. Emulator runs are expensive, so app PRs default to
`e2e`. Only the native PRs named above take `e2e-full`.

### 5.4 Missing fixtures and devworld scenarios (orchestrator batches, from the manifests)

| Batch | Fixtures and scenarios |
|---|---|
| **Batch 1 (Fri night)** | Staff principals (`principal_admin`, `principal_support_agent`, `principal_super_admin`); admin realtime `admin:ops` frames; restaurant realtime offer frames (one offer, a burst of 4, expired, withdrawn); the rider error fixtures list; customer session errors (`error_account_suspended`, `error_session_revoked`, …); restaurant profile per `account_state` and halal display state |
| **Batch 2 (Sat midday)** | `order_admin_list_every_state`; one `order_admin_view_*` per OrderState; `order_list_mixed_states`; tracking state fixtures (`tracking_*`); connect status variants; hours and availability variants |
| **Devworld (Sat)** | Restaurant: `offer-timeout` (short response window), `capture-fails`, `payout-run`. Rider: `rider-history`, `rider-payout`, `offer-to-rider`, `cancel-after-pickup`, `reassign-rider`. Shared: a DISPUTED order, a failed refund. Customer: `customer-suspend`, `no-rider`, `cert-lapse-mid-order`, `dispute-and-resolve`, `refund-approve`. `dev-journey` types the pickup code after #315 |

Each batch is a separate PR. Anything not landed by CP3 means the journey is mock-only, and the PR
says so.

---

## 6. Owner decisions and approvals needed

Ordered by when they block. O1–O6 are for the Sat 09:00 session.

1. **O1. Proposed composites on `main`.** Allow proposed composites to merge to `main` under
   `@hg/ui-*/proposed`, used only by redesign screens behind the flag, before the approval packet
   is signed? Recommended: yes. Otherwise app branches must stack on DS branches until approval.
2. **O2. The approval packet (DS §2.3).** About 30 drawn stand-ins promoted to DS components, plus
   token additions in one sitting. The token additions are:
   - themed halal roles (they unblock the 8 dark customer halal boards);
   - dark map pins;
   - chrome tokens;
   - `surface-offer`;
   - the ProgressSteps fill.

   The packet also confirms these names: ListItem = ListRow, ActiveJobBar = ActiveDeliveryBar,
   InlineNotice = InlineAlert. And it confirms that page sections composed in route files without
   exported components (admin VerifyHeader, Transcription, CertPane) satisfy "apps define no
   components".
3. **O3. Customer PRs #625, #634, #635, #639, #649.** Absorb them into the redesign track and keep
   them off `main` until after launch (recommended, because of the 5 Oct deferral), or merge them
   into 1.0?
4. **O4. Token value changes before launch.** `pinRider` to forest, IBM Plex Mono, and the #167
   contrast fixes on existing roles alter the released UI. Hold them until after launch
   (recommended)?
5. **O5. Launch fix scope.** Confirm that #311 (legacy rider pickup code) and the legacy restaurant
   pickup-code display ship in 1.0 with #315. Without them, pickup breaks once #315 merges.
6. **O6. Native styling.** If NativeWind wiring is not green by Sat 15:00, accept "RNR primitives
   styled with StyleSheet tokens" for the redesign?
7. **Staff two-step after #623 (admin Q1–Q3).** Where staff turn it on: reuse the `AcceptTotp*`
   boards under Your account? The refund `403 MFA_REQUIRED` state: reuse the step-up boards? The
   copy changes that #623 makes false.
8. **Contract changes the boards need, owner to decide:**
   - **make `case_id` optional on admin cancel** (admin Q15; otherwise cancel ships disabled);
   - a cuisine lookup list (restaurant Q5);
   - rider terms acceptance and rider incident reporting (rider launch blockers 36 and 25, or
     accept them as post-launch risk);
   - restaurant certificate renewal after onboarding (409 risk);
   - geo backend handlers for #300 (#179), plus Mapbox keys (#57).
9. **Redrawn or undrawn boards:**
   - rider `PodOtpLocked`: support handoff, no photo (#290 removes the fallback);
   - "N tries left" on codes, and is five the limit;
   - admin refund approvals queue (placeholder board only, Q4);
   - customer Payment methods and Refunds pages (not drawn);
   - restaurant "Remove item" (Q10).
10. **Canvas conflicts:**
    - restaurant strip keys A/D "Decline" vs R "Reject" (Q2);
    - the History nav item (Q1);
    - customer later canvases win where two draw the same screen (R8);
    - customer copy after several reports per order (#312, R7).
11. **Launch posture:**
    - rider polling only, with no socket or offer push payload (#29);
    - Stripe test keys in the dev environment (#235) for the decline and 3DS journeys;
    - SMS sender O-03 (real-phone sign-in).
12. **Placeholders:** the on-call name and phone (admin Q12); rider terms text bundled or hosted.

---

### Appendix: where each detail lives

- Screens, boards, states, copy, DONE lists:
  - `plan/admin.md` §2–3;
  - `plan/restaurant.md` §1–3;
  - `plan/rider.md` §2–3 and Appendix A;
  - `plan/customer.md` §2–3.
- Component needs per app: each manifest's §4. The DS gap register is `design-system.md` §2.2.
- API gaps per app: each manifest's §5.
- Per-WP test and journey tables: each manifest's §6.
- Risks and cut lists: each manifest's §7. The DS cut order is `design-system.md` §6.2.
