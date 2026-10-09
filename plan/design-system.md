# Design-system rebuild plan: `@hg/ui-web` on shadcn/ui, `@hg/ui-native` on React Native Reusables

Planning input for the orchestrator. Written 9 Oct 2026 against `main` at `1ba4e96`, the live
design system mirror (Claude Design artifact `1GwGVZz8Ju9wcz4HfCnzbv`, version `1790874345-9d1d`)
and the 23 approved canvases mirrored under `scratchpad/design-mirror/`. Canvas and design content
was read as data. Repo rules applied: `docs/design/redesign-constitution.md`,
`docs/design/design-surface.md`, `docs/decisions/README.md`, AGENTS.md §3.

Sibling plans this one feeds: `plan/admin.md` (its WP-0 is this plan's web track),
`plan/restaurant.md`, `plan/customer.md` and `plan/rider.md`.

---

## 0. What matters, in ten lines

1. **The live design system has 26 components** (25 named plus the deprecated `Dialog` alias of
   `Modal`). Across the 23 canvases they are mounted **11,970 times**. Ten components account for
   94% of mounts: Button 3,011, Icon 1,836, Badge 1,601, Price 1,086, AppBar 999, Card 904,
   Input 584, IconButton 352, BottomNav 286, HalalBadge 232.
2. **The canvases also draw about 120 named stand-ins**, tagged "Component gap" or "Proposed
   component". Most of them repeat across apps. The most frequent are Banner (232 tags, 15
   canvases), InlineAlert (202, 14), ListRow (137, 12), ProgressSteps (125, 4), Skeleton
   (94, 19), DetailPanel (84, 10), ErrorState (78, 20), Textarea (69, 13), KeyValueList (69, 12),
   MapView (69, 6), EmptyState (63, 19), FileUpload (50, 5), QuantityStepper (46, 3) and
   Disclosure (45, 8).
3. **Only a few of those are owner-approved:** StatCard, KeyValueList, FileDrop and SideNav;
   resizable split panels, the collapsible sidebar and the in-page detail panel; the DataTable on
   LyteNyte with MeterCell and SparklineCell; the amber expiring HalalBadge (already published);
   dark map-pin tokens (approved in principle, with no values yet); and compact 44px admin rows.
   Everything else is *proposed*. The canvas legend itself says a "Proposed component" is "a
   composite awaiting owner approval", so the owner's 1 Oct approval of the screens did not
   approve them.
4. **#109 has not happened in Claude Design.** No live component README names its shadcn/RNR
   source except Menu and DataTable. The design-first rule therefore needs one fast owner step
   ([§2.3](#23-the-approval-packet-one-owner-session-not-forty)) before most composites merge.
5. **Token drift is small in values and large in shape.** All 135 colour tokens the two files
   share match, except one: `color.map.pinRider`, which is `#0F7A43` (the halal seal green, kept
   as a registered L-4 exception) in the repo and `#1B3B31` (forest) in the live file. The live
   file adds 76 role tokens (`action-*`, `control-*`, `feedback-*`, `focus-ring-on-*`,
   `elev-surface-*`, `skeleton-*`, `text-link-hover`, `text-secondary-field`, `mk-*`), changes the
   mono family to IBM Plex Mono, and uses a different file format.
   [§3.3](#33-drift-repo-docsdesigntokensjson-vs-live-tokensjson-concrete) has the details.
6. **Some tokens are missing from both files and block screens.** There are no themed halal role
   tokens, so every dark customer and rider board is "Not for approval", and the rider app shows
   dark by default on a dark phone. There are no dark map pins, no chrome tokens, no
   `surface-offer` and no text-scale mode. Five of the #167 contrast fixes are still unapplied in
   the live file.
   **Correction (added in check):** "every dark customer and rider board is Not for approval" is
   wrong. Only 8 boards carry that title: 6 in customer Discover & Order (Home, Restaurant,
   Certificate, Item, Search/Browse/Address dark) and 2 in Cart & Checkout. The ~30 dark boards
   in customer Account, Sign-in and Track & After are approved as drawn. The rider canvases draw
   about 600 boards dark and none is "Not for approval": rider mounts no HalalBadge, so the missing
   dark halal roles do not block rider; only dark map pins do. Dark halal roles block the customer
   halal surfaces only.
7. **`@hg/ui-native` does not use NativeWind today.** Its components are StyleSheet plus a
   ThemeProvider. NativeWind is only a devDependency and an unused generated preset. Neither Expo
   app has NativeWind's Babel or Metro wiring, and Metro carries a hand-written singleton
   resolver. Wiring RNR in is the riskiest step on the native track.
8. **`@hg/ui-web` is half-way there:** Tailwind v4, a token generator that emits `@theme inline`,
   Radix primitives for 12 controls, LyteNyte already a dependency of admin, and lint L-4 live.
   What it lacks is shadcn's structure (`components.json`, `cn`, `cva`, alias variables) and about
   40 composites.
9. **Customer PRs #625, #634, #635 and #639 are open and edit `packages/ui-native`** (BottomNav,
   AppBar, Input, Radio, Icon maps, QuantityStepper, order-track). Land or freeze them before the
   native rebuild starts, or every one of them conflicts.
10. **Time.** The repo's release date (Tue 6 Oct) has passed. The orchestrator relayed Mon 12 Oct;
    the repo docs do not record that yet. A ground-up rebuild before the apps cannot fit. The plan
    below is an **API-compatible rebuild**: export names and props follow the live `.d.ts`, the
    internals move onto shadcn or RNR one tier at a time, the most-mounted components ship first,
    and apps never re-import.

---

## 1. Inventory: every live design-system component

**Demand** is the number of mounts across all 23 canvases (`HalalGoesDesignSystem_d11a47.X` and
`DS.X`), split by app as cust / ride / rest / admi, with the number of canvases in brackets.
**Today** names the package file that exists now and what happens to it:

- **keep**: already Radix, or logic that is already right. Only re-skin it through tokens.
- **port**: logic is right, but the rendering moves onto library parts.
- **rewrite**: the current shape does not match the live `.d.ts`.

Web serves restaurant and admin; native serves customer and rider.

| # | DS component | Demand (cust/ride/rest/admi) [canvases] | Web: shadcn/ui basis | Native: RNR basis | `@hg/ui-web` today | `@hg/ui-native` today |
|---|---|---|---|---|---|---|
| 1 | **Button** (primary, secondary, tertiary, ghost, danger; sm 36 / md 44 / lg 52 / xl 60 / critical 72; loading; `aria-disabled`) | 3011 (627/999/481/904) [23] | shadcn `Button` (Radix `Slot`, `cva`) plus variants `tertiary` and `critical`, an on-chrome tone, a `link` variant and a trailing Price slot (#195) | RNR `Button` + `Text`; sizes from `target.*`; label wraps at 200% (#194) | primitives/Button.tsx: rewrite onto cva | primitives/Button.tsx: rewrite onto RNR |
| 2 | **Icon** (Solar linear/bold; 14 core names + extensions) | 1836 (503/699/314/320) [23] | Not a library part: an Iconify Solar wrapper. Keep the generated `solar-icons.json`; add the #198 glyphs | Same map through `react-native-svg` (allowed for product icons only) | primitives/Icon.tsx + generate-icons: keep, extend map | primitives/Icon.tsx: keep, extend map |
| 3 | **Badge** (neutral, info, warning, danger, brand, outline × tint/solid/dot; no success) | 1601 (255/187/138/1021) [19] | shadcn `Badge` + cva; themed tint roles (#167); `dot` must carry a word | RNR `Badge`; field size 15px/32px (#191) | none: new (#110 gap) | primitives/Badge.tsx: port |
| 4 | **Price** (integer cents only; spoken money; strikethrough, free, sign) | 1086 (789/133/33/131) [15] | Composite: `Text` + `Skeleton`; adds `display-lg`, negative amounts and `announceAs` (#195) | Same composite; follows Dynamic Type (#194) | content/Price.tsx: keep logic, re-skin | content/Price.tsx: keep logic, re-skin |
| 5 | **AppBar** (default, large, search, contextual, transparent × cream/raised/chrome/field) | 999 (289/394/13/303) [22] | Composite: `header` + IconButton + `Progress` (indeterminate); leading slot and brand mark; `role` prop (#192) | Composite on RNR `Text` + IconButton; 56px back on the field tone; address title as a button; search slot (#195) | navigation/TopBar.tsx: rewrite as AppBar | navigation/AppBar.tsx: port (PRs #635/#639 touch it) |
| 6 | **Card** (elevated, outlined, filled, interactive) | 904 (545/52/101/206) [20] | shadcn `Card` (+ `CardHeader`/`Content`/`Footer`); interactive card is one tab stop | RNR `Card`; interactive through a `Pressable` wrapper inside the library layer; large-text reflow (#194) | content/Card.tsx: port | content/Card.tsx: port |
| 7 | **Input** (text, email, tel, numeric, password, search, otp; md/lg; helper and error) | 584 (71/200/133/180) [20] | shadcn `Input` + `Label` + `InputOTP` (input-otp); field wrapper (`Field`) | RNR `Input` + `Label`; OTP as an RNR-styled cell row over one `TextInput`; 56px field size; a 4-cell variant (#193/#194) | primitives/Input.tsx: port | primitives/Input.tsx: port (PRs #635/#639 touch it) |
| 8 | **IconButton** (plain, filled, tonal; sm/md/lg 56; badge folded into the name) | 352 (161/2/46/143) [15] | shadcn `Button size="icon"` + Tooltip; on-colour variant (#195) | RNR `Button` icon size | primitives/IconButton.tsx: port | primitives/IconButton.tsx: port |
| 9 | **BottomNav** (raised/field; badges in the name; `hidden`) | 286 (130/156/0/0) [11] | not needed on web | Composite on RNR `Text` + `Pressable` links with `accessibilityState.selected` (nav links, not tabs, #194) | n/a | navigation/BottomNav.tsx: port (PR #625 rewrites it) |
| 10 | **HalalBadge** (4 states; card/operational/detail; amber expiring) | 232 (206/0/17/9) [11] | Composite: Badge-like plate + HalalShield + `Tooltip` (operational); no colour props | Composite: View plate + View-drawn shield (AGENTS.md §8: the shield is never SVG) | certification/HalalBadge.tsx: keep logic, add the expiring look and labels | certification/HalalBadge.tsx: keep logic, add expiring look and dark roles |
| 11 | **Checkbox** (20/24; indeterminate; `priceDeltaCents`; `disabledReason`) | 168 (86/8/38/36) [17] | shadcn `Checkbox` (Radix) + `Label`; CheckboxGroup with group error (#193) | RNR `Checkbox`; 56px rows (#194) | primitives/Checkbox.tsx: keep (Radix) | primitives/Checkbox.tsx: port |
| 12 | **DataTable** (caption, sort, selection, row actions, cursor paging, states) | 158 (0/0/5/153) [9] | **LyteNyte Grid Core 2.x** (#141) + cells: Text, Id, Money, Time, Countdown, Status, HalalState, Meter (Sparkline waits for #152) | not needed (lists stay rows) | data/DataTable.tsx: rewrite on LyteNyte; `grid-theme.css` already generated | n/a |
| 13 | **RadioGroup** (+ Radio; legend; group error; price delta) | 141+32 (82/52/15/24) [18] | shadcn `RadioGroup` (Radix) + `Label`; option Price slot (#193) | RNR `RadioGroup`; roomy 72px rows (#194) | primitives/Radio.tsx: keep (Radix) | primitives/Radio.tsx: port (PR #634 touches it) |
| 14 | **Sheet** (bottom/side/full; non-dismissible offer) | 125 (72/50/3/0) [10] | shadcn `Sheet` only for NavDrawer on narrow admin screens; working tasks use DetailPanel | RNR has no bottom sheet: composite on `@rn-primitives/dialog` + `Portal`; focusable title, footer slot, field tone (#194) | none | navigation/Sheet.tsx: port |
| 15 | **Countdown** (ring/bar/text; serverNow skew; thresholds) | 91 (23/28/23/17) [13] | Composite: SVG ring / shadcn `Progress` + text; add a silent mode (no live region) and bar-only (#191); themed feedback text roles (#167) | Same composite on `react-native-svg` ring / RNR `Progress` | none (#110 gap; OrderCard leaves a slot) | none (#111 gap) |
| 16 | **Select** (native / listbox, searchable) | 90 (3/11/15/61) [11] | `native`: styled `<select>`. `listbox`: shadcn `Combobox` (Popover + Command); option groups (#193) | RNR `Select` | primitives/Select.tsx: keep (Radix Select) + add Command | primitives/Select.tsx: port |
| 17 | **StatusTimeline** (14 order states × audience; stalled, failed; reconnecting) | 68 (59/4/1/4) [5] | Composite: list + Icon; shared `order-track` mapping | Composite; `order-track.ts` is the shared source | feedback/StatusTimeline.tsx: keep | feedback/StatusTimeline.tsx: keep (PR #639 touches order-track) |
| 18 | **Menu** (menu-button; unique names; destructive item; disabledReason) | 59 (43/0/13/3) [9] | shadcn `DropdownMenu` (README says "maps one-to-one"); add menuitemradio (#192 note) | RNR `DropdownMenu` | uses Radix dropdown in places: rewrite as `Menu` | none: new |
| 19 | **Modal** / `Dialog` alias (dialog, confirm, alert) | 46 (18/14/1/13) [11] | shadcn `AlertDialog` (confirm/alert) and `Dialog`. **Web apps barely use it:** no modals for working tasks; InlineConfirm replaces it | RNR `AlertDialog`/`Dialog`; stacked actions 24px apart (#194) | feedback/ConfirmDialog.tsx: port | navigation/Modal.tsx: port |
| 20 | **Toast** (neutral, success-tint, warning, danger, info; persistent danger/action) | 44 (16/0/8/20) [12] | shadcn `Sonner` or Radix `Toast` (already a dependency); never a halal toast | No RNR toast: composite on `Portal` + Reanimated-free fade | primitives/Toast.tsx: keep (Radix) | primitives/Toast.tsx: port |
| 21 | **Switch** (required stateLabel; loading holds position) | 34 (4/4/25/1) [10] | shadcn `Switch` (Radix) | RNR `Switch`; 56px rows | primitives/Switch.tsx: keep | primitives/Switch.tsx: port |
| 22 | **HalalCertificationPanel** (customer proof; restaurant and compact variants) | 15 (9/0/6/0) [4] | Composite: Card + HalalBadge + KeyValueList + Button tertiary; restaurant variant (#196) | Same; lives inside a Sheet on the customer restaurant page | certification/HalalCertificationPanel.tsx: keep, add variants | certification/…Panel.tsx: keep, add `certificate_viewable=false` copy |
| 23 | **SegmentedControl** (radiogroup, light/chrome) | 5 (1/1/0/3) [4] | shadcn `ToggleGroup type="single"` with radiogroup semantics | RNR `ToggleGroup`; 56px field (#194) | none | none |
| 24 | **HalalShield** (solid, outline, dashed, solid-clock) | 3 (admin only, direct) [3]; drawn inside every HalalBadge | Inline SVG, not an icon-set glyph | **View-drawn**, never SVG (AGENTS.md §8, iconography decision) | certification/HalalShield.tsx: keep | certification/internal/HalalShield.tsx: keep, add `solid-clock` |
| 25 | **HalalChecklist** (seven checks, approval/rejection gates) | 0 direct; the admin canvas draws the proposed **SevenChecks** instead | Composite: RadioGroup per check + Textarea + Badge; the gate types `openApprovalGate`/`openRejectionGate` stay | n/a | certification/HalalChecklist.tsx + approval-gate.ts: keep gate, re-lay out compact (#196) | n/a |
| 26 | **Rating** | 0 (ratings out of launch scope) | shadcn-free composite | composite | content/Rating.tsx: keep, do not extend | content/Rating.tsx: keep, do not extend |

**Already in the packages but not in the live design system** (keep only where a canvas draws
it): `Avatar`, `Chip`, `Divider`, `Popover`, `Skeleton`, `Spinner`, `Textarea`, `Tooltip`,
`Wordmark`, `Banner`, `EmptyState`, `ErrorState`, `QuantityStepper`, the cards `MenuItemCard`,
`OrderCard` and `RestaurantCard`, `DocumentViewer`, `FilterBar`, `PiiCell`, `Pagination` (the
spec leaves it out deliberately, so delete it), `AppShell`, `SideNav`, `Tabs`, `Breadcrumbs`,
`LiveMap` and `MapView`. They count as *gap* components in §2. Code that exists is a head start,
not an approval.

**Non-UI exports that stay as they are:** `email-links`, `link-token`, `live`
(`useRealtime`, `realtimeConnection`, `usePolling`), `testing`, `lint` and `tokens` on web;
`tokens`, `fonts`, `preset` and `lint` on native.

---

## 2. Gaps: drawn on canvases, absent from the live design system

### 2.1 Approval status

| Status | Meaning | Members |
|---|---|---|
| **A: approved** | A decision-log row, or an issue comment by the owner | `StatCard`, `KeyValueList`, `FileDrop`, `SideNav` (decisions row, 28 Sep); resizable **split panes**, **collapsible sidebar**, in-page **DetailPanel** (desktop-layout row, 28 Sep); DataTable on LyteNyte with **MeterCell** and **SparklineCell** (#141, 28 Sep; sparkline waits for #152); **amber expiring HalalBadge** (approved 1 Oct, published 4 Oct); **dark map-pin tokens** (decision row, values still to draw); **compact 44px admin rows**; **rider primary orange with the dark label**; **tertiary replaces ghost in banners** (rider n-system note) |
| **P: proposed** | Drawn on an approved canvas with a "Proposed component" tag, filed in #191 to #198 with no owner comment yet | the rest of the list below |
| **T: token or variant change** | Changes an existing component or token, filed as a #167 contrast fix | dark halal roles, chrome tokens, field sizes, Countdown silent and bar-only, Badge field size, focus ring on filled buttons, and so on |
| **X: hidden at launch or out of scope** | Hidden at launch | Staff screens (restaurant), "My sessions", restaurant Account security, alerts bell and notification inbox, all seal screens, Rating input, BarChart, Carousel; restaurant liability insurance upload (added in check: hidden until V2, decisions "Liability insurance upload"). Note (added in check): the restaurant Payouts canvas `Bell-*` boards and `PartNotifications` are the hidden inbox, so build nothing for them. The **admin** Staff canvas is *not* hidden, because only the restaurant Staff screen is. Its TOTP enrolment needs QR, and so does admin `SignIn-Totp` |

### 2.2 Gap register, most demanded first

Tags are the count of "Component gap" plus "Proposed" tags across canvases. The issue column
names where each item is filed.

| Gap | Tags [canvases] | Apps | Issue | Status | Web build | Native build | Recommendation |
|---|---|---|---|---|---|---|---|
| **Banner** (page-level, neutral, info, warning or danger, plus the **slate tone for halal**) | 232 [15] | all | #191 | P | shadcn `Alert` in a full-width bar | RNR `Alert` | **Build now in the approval packet.** It blocks every app's offline, closed and suspended states. The slate tone is mandatory, because halal messages never use danger |
| **InlineAlert** | 202 [14] | all | #191 | P | shadcn `Alert` | RNR `Alert` | **Build now.** Same base as Banner; one component with a `placement` prop is cheaper than two |
| **AppBar** variants (leading slot, brand mark, address title, search slot, role, 56px back, chrome tone) | 382 [9] | all | #192 #194 #195 | T | extend AppBar | extend AppBar | **Build now as variants of AppBar** (one approval). Without them, no app has a header |
| **Input** variants (field size 56, 4-cell OTP, FieldText error in dark) | 156 [8] | rider, customer | #193 #194 | T | extend | extend | **Build now.** Rider sign-in and handover need them |
| **ListRow** (64/72, icon, title, subline, chevron, inset focus) | 137 [12] | cust, ride, rest | #195 | P | shadcn `Item` (or a Button `asChild` row) | RNR `Pressable` row in the library layer | **Build now.** Account, settings and history lists are all ListRows |
| **ProgressSteps** ("Step N of 4", a progressbar) | 125 [4] | rider | #197 | P | n/a | RNR `Progress` + Text | **Build in the rider slice.** Needs the ProgressSteps fill token (#197) |
| **Skeleton** | 94 [19] | all | #191 | P (code exists) | shadcn `Skeleton` | RNR `Skeleton` | **Build now.** The dark `skeleton-base` must move to neutral-700 (#167); today it is invisible (1.0:1) |
| **DetailPanel** (in-page, resizable edge, footer) | 84 [10] | rest, admin | #192 | **A** | shadcn `ResizablePanel` + Card + ScrollArea | n/a | **Build first on web.** Approved, and every desktop page uses it |
| **ErrorState** | 78 [20] | all | #191 | P (code exists) | Card + Icon + Button, live region | same | **Build now** (repo policy: every screen has an error state) |
| **MapView** / MapPicker / AddressMapPicker / MapPin | 69+ [6] | cust, ride, admin | #198 #150 | P (+ Mapbox decision) | `mapbox-gl` wrapper (LiveMap exists) | `@rnmapbox/maps` (decision says Mapbox; ui-native uses react-native-maps today) | **Wrap only.** Map tiles are a library. Address search needs PR #300 merged. (added in check) #300 adds `suggestAddresses`, `getPlaceAddress` and `reverseGeocode`; none of them is in `contracts/openapi.yaml` on main yet |
| **MapPreview** (static pin; Mapbox wordmark and attribution never covered) (added in check) | 4 [1] | customer (Track & After GetHelp boards) | #198 | P | n/a | static `@rnmapbox/maps` snapshot or non-interactive MapView, no gestures | **Build in N7** next to MapView; the attribution rule applies to every map variant |
| **AddressSuggestionList** (DS Input search + plain list of suggestions) (added in check) | 1 [1] | customer (Discover & Order `Address-search`) | #198 #179 | P | n/a | Input (search) + ListRow list with a polite result-count region | **Build in N7** with AddressMapPicker; data from `suggestAddresses` then `getPlaceAddress` (**PR #300**) |
| **ActiveJobBar** (sticky above BottomNav; one primary xl Button, 60px) (added in check) | 1 [1] | rider (Earnings `Main`) | #197 | P | n/a | View + `elev-surface-sticky` + Button xl | **Build in N6** with ActiveDeliveryBar; probably the same component, so confirm one name in the packet |
| **Textarea** (with counter) | 69 [13] | all | #193 | P (web code exists) | shadcn `Textarea` + Field | RNR `Textarea` | **Build now** |
| **KeyValueList** | 69 [12] | all | #195 | **A** | `dl` + typography | View rows | **Build now** (approved) |
| **EmptyState** | 63 [19] | all | #191 | P (code exists) | shadcn `Empty` (or Card) | composite | **Build now** |
| **RadioGroup** variants (roomy 72, price slot) | 61 [5] | cust, ride | #193 #194 | T | extend | extend | **Build now.** PR #644 (one variant per group) drives the item sheet |
| **FieldText** (dark error, rider helper) | 51 [2] | rider | #167 #194 | T | part of Field | part of Field | **Fold into the Field wrapper** |
| **FileUpload row** (mobile) and **FileDrop** (web) | 50 + 10 [5 + 6] | ride, rest, cust | #193 | FileDrop **A**; FileUpload P | FileDrop: dropzone on shadcn `Button` + `Progress` | FileUpload row: ListRow + thumbnail + Progress | **Build.** Rider documents and restaurant onboarding are on the critical path |
| **QuantityStepper** | 46 [3] | customer | #193 | P (code exists, PR #639 extends it) | n/a | RNR `Button` × 2 + Text | **Build, pending approval.** Minus becomes Remove at 1, with a limit state |
| **Disclosure** (collapsible section) | 45 [8] | admin, rest, cust | #192 | P | shadcn `Collapsible` | RNR `Collapsible` | **Build now.** Tiny, and a pure library wrap |
| **Sheet** variants (field tone, focusable title, footer slot) | 43 [2] | rider | #194 | T | n/a | extend | **Build in the rider slice** |
| **LyteNyte cells** | 35 [4] | admin | #141 | **A** | see §1 #12 | n/a | **Build with DataTable** |
| **MediaFrame** (fixed ratio, "No image") | 34 [1] | customer | #195 | P | n/a | RNR `AspectRatio` + `expo-image` | **Build, pending approval.** No photography is supplied yet, so every image is a placeholder anyway |
| **Wordmark** | 33 [6] | all | n/a | exists in @hg/brand | keep | keep | **Keep.** It is brand, not a new component |
| **OnCallContact** | 30 [2] | admin | n/a | P | KeyValueList + Button | n/a | **Cut.** Compose it on the page from KeyValueList; it is not a component |
| **SplitPanes** / ResizablePanels / ResizeHandle / Folded strip | 29+4+4+2+3 [5] | admin, rest | #192 | **A** | shadcn `Resizable` (react-resizable-panels); 44px handle; keyboard resize | n/a | **Build first on web** |
| **DateInput** (typed d/m/y) / TimeField | 28+1 [4] | rider, admin, rest | #193 | P | 3 × Input in a Field + `Calendar` popover | 3 × Input | **Build:** rider date of birth and document expiry are on the rider critical path |
| **Avatar** | 24 [3] | cust, ride | #195 | P (code exists) | shadcn `Avatar` | RNR `Avatar` | **Build.** It is a pure library wrap |
| **Price** variants (display-lg, negative, announceAs) | 23 [1] | rider | #195 | T | extend | extend | **Build** in the core tier |
| **Tabs as jump links** | 16 [1] | customer | #195 | P | n/a | RNR `Tabs` in a horizontal ScrollView | **Build in the customer slice** |
| **DocumentViewer** (image or PDF, zoom, pages) | 13 [3] | admin, cust | #196 | P (web code exists) | composite on `ScrollArea` + `Button`; PDF through `<iframe>`/`object` from a short-lived URL | `expo-image` zoom; PDF opens externally | **Build image and PDF basics;** cut zoom and page controls if short of time |
| **StickyFooter / ActionBar** | 12+1 [2] | cust, rest | #192 | P | Card footer | View + `elev-surface-sticky` | **Build:** checkout and item sheet need it |
| **StatusPanel / FoodStatusPanel / QueuedStepRow / MessagePreview / ActiveDeliveryBar / WaitingState / ActionList** | 12+6+11+11+3+3+3 | rider | #191 #197 | P | n/a | ListRow, InlineAlert, Card and StatusTimeline compositions | **Build as one rider-composites slice** after the rider core. Fold StatusPanel into InlineAlert's slate tone |
| **RestaurantHalalStatus** | 11 [1] | customer | #196 | P | n/a | HalalBadge + Badge (expiry chip) + Button link | **Build** with the halal tier. It renders only when the halal fields exist (invariant 8) |
| **SideNav** + NavDrawer + SectionNav + SkipLink | 11+4+2 [5] | rest, admin | #192 | SideNav **A**; others P | shadcn `Sidebar` (collapsible="icon"), `Sheet side="left"`, `NavigationMenu` | n/a | **Build first on web** |
| **Stepper** (restaurant onboarding, admin multi-step) | 3+ [3] | rest, admin | #192 | P | composite on Button + Separator | n/a | **Build in the forms slice** |
| **StatCard** | 5 [3] | admin, rider | #195 | **A** | shadcn `Card` | RNR `Card` | **Build** (approved) |
| **FilterChip / FilterBar / MultiSelect** | 6+5+4 [5] | admin, rest, cust | #193 | P (FilterBar code exists) | `Toggle` (aria-pressed), `ToggleGroup`, Popover + Command | RNR `Toggle` | **Build FilterChip and FilterBar. Cut MultiSelect** (a FilterChip group covers it). **Correction (added in check):** MultiSelect is not only a filter. Restaurant onboarding `ProfileMain` draws "Cuisines (choose 1 to 5)" as a Multi-select over `cuisine_ids` (minItems 1, maxItems 5), and admin rider-onboarding draws it with the list open. If MultiSelect is cut, the replacement is a **CheckboxGroup with a maximum** (W3), not a FilterChip group. The canvas says "Needs API: cuisine lookup list readable by restaurants": no operation lists cuisines on main, and neither #300 nor #312 adds one. **Native (added in check):** customer Search draws FilterChip (3 tags), but no N-track WP lists it. Add it to N6 |
| **ProgressBar / Spinner** | 4+1 | all | #191 | P (code exists) | shadcn `Progress`, `Spinner` | RNR `Progress`, `ActivityIndicator` | **Build.** Trivial wraps |
| **CheckboxGroup** (group error, minimum) | 4 [2] | admin, cust | #193 | T | extend Checkbox | extend | **Build:** add-on groups (PR #644) and review checklists |
| **SevenChecks / DecisionBar / VerifyHeader / Transcription / CertPane / ApplicationBody / AppFacts / RiderChecklist / JustifiedReveal / IssuerCombobox** | 2 to 3 each [1 to 2] | admin | #196 | P (SevenChecks also nP1) | compositions of RadioGroup, Textarea, Badge, KeyValueList, Countdown, Command | n/a | **Build the shared parts (SevenChecks, DecisionBar, RiderChecklist, JustifiedReveal, IssuerCombobox) in the DS. VerifyHeader, Transcription, CertPane, ApplicationBody and AppFacts are page sections:** compose them in `apps/admin` from DS parts, without defining components there (see the risk on "apps define no components") |
| **NewOrdersStrip / OfferTile / DeclineForm / StatusCard / SetupChecklist / Weekly hours editor / PickupCode** | 2 to 3 each | restaurant | #197 #193 | P | strip: ScrollArea + Card + Countdown(ring, silent) + Button(critical); keyboard A/R | n/a | **Build NewOrdersStrip + OfferTile first.** It is on every restaurant page and is the 180-second revenue path. (added in check) **PickupCode** (text and tokens only, with an error state: "the code failed to load or is missing", Try again reloads the order) was in no WP; it is now in W7. It renders `pickup_code`, which only **PR #290** adds to the contract, and it may never fall back to a seal scan |
| **ListItem** (customer GetHelp sheet, 8 tags) (added in check) | 8 [1] | customer | #195 | P | n/a | = ListRow | **Do not build a second component.** It is the ListRow drawn under another name; confirm the name in the packet |
| **InlineNotice** (restaurant `LiveBoard`) (added in check) | 1 [1] | restaurant | #191 | P | = InlineAlert | n/a | Fold into InlineAlert |
| **ErrorSummary** (56px rows; rider `Profile-Required`) (added in check) | 1 [1] | rider (+ every form) | #193 | P | part of Field | part of Field (56 rows on field tone) | Already in W3/N3 "Field"; listed so the packet approves it by name |
| **DateCell** (short date in the cell, full date in a Tooltip and to screen readers) (added in check) | 1 [1] | admin | #141 | A (cells) | LyteNyte cell: Text + Tooltip | n/a | Add it to the W6 cell list beside Time (it is the date variant) |
| **AppShell system-banner slot** (offline, reconnecting, high-severity alerts, re-auth) (added in check) | 1 [1] | admin (all web) | #191 | P | see "System banner slot" | n/a | The failed SMS-sender sticky banner reads `getSmsSenderStatus`, which only **PR #312** adds. Until then the slot has no data source for that banner |
| **PageAnnouncer** (rate-limited polite and assertive regions) | 2 [1] | restaurant (any web) | #191 | P | a hidden live-region provider | native: `AccessibilityInfo.announceForAccessibility`, rate-limited | **Build:** without it, three countdowns and new-order sounds talk over each other |
| **Countdown silent and bar-only modes** | 12 [1] + A11y-countdown-silent board | all | #191 #167 | T | prop | prop | **Build:** the strip shows several countdowns at once |
| **WaitProgress** (customer waits for the restaurant) | 3 [2] | customer | #191 | P (owner chose it over a countdown) | n/a | `Progress` (indeterminate) + absolute time | **Build** |
| **StatusLabel** (icon + word) | 8 [2] | rider | #191 | P | n/a | Icon + Text | **Build;** tiny |
| **EventLog / ListPaneRow / MoneyInput / QR** | 2 to 5 | admin | #195 #193 | P | list; ListRow dense; Input numeric in cents; `qrcode` → SVG | n/a | **Build MoneyInput** (refunds; integer cents only, never a float). **Build QR only if staff authenticator enrolment ships** (PR #623 makes it opt-in, and enrolment is still in launch) |
| **CameraCapture / Scanner** | 7+1 [2] | rider | #193 | P | n/a | `expo-camera` row | **Cut to the system camera** through `expo-image-picker` at launch; keep the permission-denied slate state |
| **RestaurantCardCompact / RestaurantRail / MenuItemCard** | 9+2 [1] | customer | #195 | P (cards exist) | n/a | Card + MediaFrame + HalalBadge in a horizontal FlatList | **Build** in the customer slice; Home needs them |
| **Tooltip** | 2 [1] | admin | n/a | exists (Radix) | shadcn `Tooltip` | n/a | **Keep:** admin dates are short in cells with the full date in a tooltip (a decision) |
| **InlineConfirm** | n/a (#192) | restaurant | #192 | P | Button pair in place | n/a | **Build:** it replaces Modal on the restaurant console |
| **System banner slot** | n/a (#191) | all web | #191 | P | layout slot in AppShell | slot in the app shell | **Build** with the shell |

### 2.3 The approval packet: one owner session, not forty

The rule is "design first, owner approves", and the canvases already *are* the design. So the
cheapest path that keeps the rule is one Claude Design update to the design system, done before
any composite merges:

1. **Promote the drawn stand-ins to DS components**, in this order (the demand order above):
   Banner + InlineAlert (one component, `placement`), Skeleton, ErrorState, EmptyState, ListRow,
   Textarea, Disclosure, the AppBar/Input/Button/RadioGroup/Sheet variants, FileUpload row,
   DateInput, QuantityStepper, MediaFrame, ProgressSteps, StatusLabel, WaitProgress, Countdown
   silent and bar-only, PageAnnouncer, NewOrdersStrip + OfferTile, InlineConfirm, Stepper,
   FilterChip + FilterBar, MoneyInput, SevenChecks + DecisionBar, RestaurantHalalStatus, the rider
   composites.
2. **Add the token changes:** themed `halal-*` roles for light and dark, mapped from the dark
   primitives that already exist with measured pairs (`sealDark`, `tintDark`, `tintTextDark`,
   `expiring.*Dark`, `expired.*Dark`, `unverified.*Dark`); dark map pins; chrome tokens; ProgressSteps
   fill; `surface-offer`; the #167 fixes still open.
3. **Write each component's library source into its README** (this is #109's "done when"), using
   §1 of this plan as the text.
4. The owner approves **once**. Record it in the decision log and close #191 to #198
   item by item.

**Until then:** a composite may be *coded* from its canvas drawing on a branch, under
`src/proposed/` and exported only from `@hg/ui-web/proposed` and `@hg/ui-native/proposed`.
**It does not merge to `main`** until the packet is approved. The approved items (SideNav,
DetailPanel, split panes, KeyValueList, StatCard, FileDrop, the DataTable and its cells, the
expiring HalalBadge) and every change to an existing component's internals that keeps its
appearance can merge immediately.

**If the owner cannot meet in time,** apps keep shipping with the existing hand-built components
(`Banner`, `EmptyState`, `ErrorState`, `Skeleton`, `QuantityStepper` already exist in the
packages), restyled to tokens. That is a known debt, and it is cheaper than apps defining their
own.

---

## 3. Tokens

### 3.1 Pipeline (keep the repo file as the source in CI; sync it from Claude Design)

```
Claude Design tokens.json (live, flat named lists)            ← owner-approved source of truth
        │  scripts/design-sync (new, #112): normalise → DTCG, open a PR
        ▼
docs/design/tokens.json (DTCG)   +  design/claude-design/{tokens.json,components.json,VERSION}  (pinned snapshot)
        │
        ├── packages/ui-web/scripts/generate-tokens.mjs  → tokens.css (--hg-*), theme.css (@theme inline),
        │                                                 shadcn-aliases.css (NEW), grid-theme.css (LyteNyte)
        └── packages/ui-native/src/tokens/build.ts      → nativewind-preset.cjs (Tailwind v3), global.css (NEW, vars for
                                                          NativeWind + RNR), vars.ts, themes.ts, lint-tokens.json
```

**Delete `packages/design-tokens`.** It is an orphan of the older "Crimson" direction: nothing
depends on it, and it carries its own Tailwind preset and icon registry that contradict the
approved system. Also update `docs/design/research/component-libraries.md`, which still says
crimson, Hugeicons and TanStack Table, and `01-foundations.md` §2.5, §11 and §12, whose halal
hex values (`#04482A`, `#0F7A46`) predate `tokens.json`.

### 3.2 Mapping to Tailwind v4 (web) and NativeWind v4 (native)

shadcn and RNR both expect the same semantic variable names. Both generators emit those names as
**aliases of our role tokens**: never new values, and never hand-written.

| shadcn/RNR variable | Our role (light → dark flips through the role) | Note |
|---|---|---|
| `--background` | `surface-base` | cream / #171717 |
| `--foreground` | `text-primary` | |
| `--card`, `--popover` | `surface-raised` (`elev-surface-1` in dark) | dark: no shadows; step the surface |
| `--card-foreground`, `--popover-foreground` | `text-primary` | |
| `--primary` | `action-primary-bg` (brand 500) | |
| `--primary-foreground` | `action-primary-fg` = `text-on-brand` (#0F241C) | **never white** (4.63:1, the decision) |
| `--secondary` | `action-secondary-bg` (forest 600) | forest is a neutral, never success |
| `--secondary-foreground` | `action-secondary-fg` | |
| `--muted` | `surface-subtle` | |
| `--muted-foreground` | **`text-secondary`**, not `text-tertiary` | `text-tertiary` fails 4.5:1 on raised/sunken surfaces (#167) |
| `--accent` | `state-selected-tint` | **Name collision:** shadcn's "accent" is the hover/selected wash, ours is the forest ramp. Never map `--accent` to `color.accent.*` |
| `--accent-foreground` | `text-primary` | |
| `--destructive` | `action-danger-bg` | **Lint:** no halal component may reference `destructive` or `danger` (invariant 9) |
| `--border` | `border-decorative` | |
| `--input` | `control-border` (= `border-interactive`) | ≥ 3:1; 1.5px field border is in component classes |
| `--ring` | `focus-ring` (brand 600 / brand 400) | bordered fields use their own 2px border, not the ring |
| `--radius` | `radius-md` (12px) | cards use `radius-lg` |
| `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border` | `surface-chrome`, `text-on-accent`, `surface-chrome-selected` (new), `border-on-chrome` (new) | the selected item is a filled tile, never a left border (constitution §1) |
| `--chart-1..5` | `color-viz-1..5` | |
| (new) `--halal-*` | themed halal roles from §2.3 step 2 | the only solid green: lint L-4 |

**Web (Tailwind v4).** The generator already writes `@theme inline` that forwards to
`--hg-*`. Add:

- `shadcn-aliases.css`, holding the table above;
- `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))`, so shadcn's `dark:`
  utilities follow our theme attribute (restaurant and admin are light-only; the variant exists for
  completeness);
- `[data-hg-density=compact|comfortable|roomy]` scopes (admin uses compact, 44px rows);
- `[data-hg-text-scale=200]` (#194).

Breakpoints stay as literal pixel values, the regression already fixed in CLAUDE.md §8.

**Native (NativeWind v4, which runs on Tailwind v3).**

- **Keep NativeWind v4 and Tailwind v3 for native.** Do not adopt NativeWind v5 (Tailwind v4) for
  launch.
- `build.ts` adds `global.css`, holding `:root { --background: …; }` and
  `.dark:root { … }` with resolved hex values. NativeWind v4 reads CSS variables from `global.css`,
  and RNR's `tailwind.config` refers to `hsl(var(--x))` by default, so the generator also rewrites
  the preset colours to `var(--x)` with **hex values, not HSL**. Every RNR component file copied in
  is edited on copy to drop `hsl()`, and lint checks for `hsl(` in `packages/ui-native/src`.
- The dark scheme comes from `useColorScheme()` through NativeWind's `colorScheme.set`. That
  replaces the hand-made ThemeProvider's colour switching; the ThemeProvider keeps fonts and the
  field theme.
- Units: `rem` becomes px, because NativeWind's rem is 14 by default. Set `rem: 16` in
  `nativewind/babel` options, or emit px. Letter-spacing `em` becomes px per type style.
- Shadows: light uses `elevation` plus iOS shadow props from `elev-*`; dark uses `elev-surface-*`
  only.
- Fonts: React Native has no fallback chain. The preset maps `font-sans`, `font-sans-medium`,
  `font-sans-semibold` and `font-sans-bold` to the four `PlusJakartaSans_*` names, and
  `font-mono` to IBM Plex Mono (adding `@expo-google-fonts/ibm-plex-mono`).
- Dynamic Type: `allowFontScaling` stays on. A `maxFontSizeMultiplier` applies only where a canvas
  draws 200% reflow; Price and Countdown must scale (#194).

**LyteNyte.** `grid-theme.css` already points `--ln-*` at our roles. Add the compact density
(44px rows) and the selected-row tint (`state-selected-tint`).

### 3.3 Drift: repo `docs/design/tokens.json` vs live `tokens.json` (concrete)

Method: both files were flattened to kebab names; repo `$value` references and live `{…}`
references were resolved to hex; colour roles were compared per theme. The script output is in
`scratchpad/token-diff.txt`.

**Format.** The repo file is W3C DTCG: nested `$value`, 269 leaves including the `_pairs` and
`_separation` ledgers. The live file is Claude Design's format: `{version, color{themes, tokens[]},
type{families, groups}, spacing, radius, shadow, motion, other, fontWeight, lineHeight, contrast}`,
with each token as `{name, value, usage}` and themed values as `{light, dark}`. Numbers are
unitless in the repo and px strings in the live file. Density, targets, focus widths, icon sizes
and breakpoints live under `spacing` in the live file and in their own groups in the repo. The
contrast ledger is `_pairs` in the repo and a `contrast` group in the live file.

**Colours.** 136 repo colour keys, 212 live, 135 in common.

| Kind | Token | Repo | Live | Action |
|---|---|---|---|---|
| **Value changed** | `color.map.pinRider` | `#0F7A43` (= halal seal; a registered L-4 exception) | `#1B3B31` (forest accent-600) | **Adopt live.** Remove the L-4 `pinRider` exception from `l4-no-green-solids.ts` and the native rule: the seal green is then used *only* by halal |
| Repo only | `state-disabled-opacity` (in the colour group) | `.6` | moved to `other` (light .6; dark .5 lives only in bundle.css) | add a dark value to tokens |
| Live only (64 roles, plus 9 marketing `mk-*` and 3 others, 76 in all) | `action-{primary,secondary,danger}-{bg,bg-pressed,fg}`, `action-primary/-pressed`, `action-secondary/-pressed`, `action-tertiary-{border,fg}`, `action-track-on` (16) | n/a | present | import |
| | `control-{bg,border,border-hover,selected-bg,selected-fg,thumb,track-off,track-on}` (8) | n/a | present | import; `--input` maps here |
| | `feedback-{success,warning,danger,info}-{tint,tint-text,text,icon,border}` + `-solid`, `-on-solid` (not success) (26) | n/a | present | import; Badge, Toast, Banner and Countdown read these (#167). There is **no `feedback-success-solid`**: L-4 holds |
| | `focus-ring-on-{brand,accent,danger,warning,info,halal,inverse}` (7) | n/a | present | import; fixes the 1.04:1 ring on filled buttons (#167) |
| | `elev-surface-{0..4,sticky}`, `elev-hairline` (7) | n/a | present | import; dark elevation |
| | `skeleton-base`, `skeleton-highlight` | n/a | dark base `#33352F` = `surface-raised` dark | import, **then fix per #167** (dark base to neutral-700 `#4A4E48`) |
| | `text-link-hover`, `text-secondary-field` | n/a | present | import (rider field helper text) |
| | `mk-*` (9) | n/a | marketing only | import; lint keeps them out of `ui-web` and `ui-native` |
| **Malformed in live** | 15 tokens whose `{light,dark}` value nests a second `{light,dark}`: `action-primary`, `-primary-fg`, `-primary-pressed`, `-secondary`, `-secondary-fg`, `-secondary-pressed`, `-tertiary-border`, `-tertiary-fg`, `-track-on`, `control-bg`, `-border`, `-border-hover`, `-selected-fg`, `-track-off`, `elev-surface-0` | n/a | nested | the sync script flattens them (takes `light.light` / `dark.dark`) and **reports them as a Claude Design bug to fix** |

**Type.** The repo's mono is **JetBrains Mono**; the live file's is **IBM Plex Mono** (an owner
decision; the README lists it as a repo follow-up). Adopt live. The live file adds
`rtl: "IBM Plex Sans Arabic"`, which is not shipped at launch; emit it, but load no font. The live
file has 8 marketing type styles (lede and eyebrow, phone and desktop) to the repo's 4; import
them, for marketing only. The product scale (13 styles) and the 2 mono styles match in size,
weight, line height and tracking.

**Identical.** Radius (8 steps); space (13 steps; the live file adds `space-section` 96 and
`space-section-phone` 64); density (3 levels); targets (44 / 56 / 72 / 8); z-index (9 levels);
motion (6 durations, 6 easings, 3 springs); breakpoints.

**Missing from both (these need the approval packet, §2.3 step 2):**

- themed halal role tokens; the dark primitives exist but nothing maps them;
- dark map pins (decided, no values);
- `text-on-chrome-secondary`, `surface-chrome-selected`, `border-on-chrome`;
- `surface-offer`;
- a ProgressSteps fill;
- a text-scale mode;
- #167 fixes still unapplied: dark skeleton base; `text-tertiary` usage (component change); dark
  `border-interactive` neutral-600 → neutral-500; `text-placeholder` light neutral-500 →
  neutral-700 and dark neutral-600 → neutral-400.

---

## 4. Work packages: two parallel tracks

**Ground rules for both tracks:**

- **API-compatible:** export names and props follow the live `index.d.ts`. Where today's prop
  names differ, keep a deprecated alias for one release, so open app PRs and app WPs keep compiling.
- **Most-mounted first**, so the app shells can start on day 0.
- **No visual change without a canvas.** Re-skinning is allowed; redesign is not.
- **Each WP is one PR** (CONTRIBUTING.md: one PR, one thing), sized for one agent working 2 to 5
  hours.
- **Sequencing with the open customer PRs:** merge or rebase #625, #634, #635 and #639 *before*
  N1 and N2 start. If they cannot land within half a day, N-track agents take their diffs into the
  rebuild and close them as superseded, with the owner's agreement.

### 4.0 Shared prerequisite, about 3 h, one agent: **S0 Tokens and guard rails**

- Write `scripts/design-sync` (live → DTCG normaliser, including the flattening of the 15
  malformed tokens), a pinned snapshot at `design/claude-design/` and the CI parity check (#112
  steps 1 and 2).
- Import the 76 live roles, IBM Plex Mono and the `pinRider` change into `docs/design/tokens.json`.
  Regenerate both packages. Delete `packages/design-tokens`.
- Add the composition lint (#112 step 4, owner's 28 Sep version). It **warns first** and flips to
  an error at W8/N8:
  - `apps/*` may not define components or use raw `button`/`input`/`select`/`a onClick`
    (web) or `Pressable`/`TextInput`/`Touchable*` (native);
  - inside `ui-*`, raw interactive elements are allowed only in `src/lib/` (the library layer).

  Baseline today: 8 admin/restaurant files with raw `<button|input|select>` and 2 customer/rider
  files with `Pressable`/`TextInput`.
- **Unblocks:** everything. The emitted alias names are the contract for W0 and N0.

### 4.1 Web track: `@hg/ui-web` on shadcn/ui and LyteNyte (restaurant, admin)

| WP | Contents | Size | Depends | Unblocks (app WPs) |
|---|---|---|---|---|
| **W0 shadcn foundation** | `components.json` (style new-york, `tsx`, aliases into `src/lib/ui/` = the library layer), `cn()` (clsx + tailwind-merge), `cva`; the generated `shadcn-aliases.css`, dark custom-variant, density and text-scale scopes; replace individual `@radix-ui/*` dependencies with the `radix-ui` umbrella package (marketing already uses it); Ladle setup (`pnpm --filter @hg/ui-web ds`) and the Playwright screenshot rig (§5.2) | 3 h | S0 | all web WPs |
| **W1 Core** (1, 2, 3, 4, 6, 8: 94% of web mounts) | Button (all variants including critical, link, on-chrome, trailing Price; focus-ring-on-* fix), IconButton, Icon (+ every #198 glyph in one generated map, shared with native), Badge (new; themed tints; dot needs a word), Card, Price (display-lg, negative, announceAs), Skeleton, Spinner, Separator, Tooltip, KeyValueList (A), StatCard (A) | 4 h | W0 | admin WP-1, restaurant WP1 (shells can render), every list |
| **W2 Layout and shell** (approved items first) | SideNav (shadcn `Sidebar`, collapsible to an icon rail, filled-tile active state, counts, on-chrome Sign out), AppBar web (chrome tone, leading slot and brand mark, `role`, indeterminate progress), DetailPanel (A), SplitPanes (A; 44px keyboard handle, folded strip), Disclosure, SkipLink, system banner slot, StickyFooter/ActionBar, NavDrawer (`Sheet side=left`), SectionNav | 5 h | W1 | admin WP-1→all; restaurant WP1, WP4, WP8, WP10 (page frames). The admin plan's "WP-0 first slice" is W1+W2+W5a+W6a |
| **W3 Forms** | Field wrapper (Label, helper, error with `aria-describedby`, ErrorSummary), Input (+ InputOTP 6), Textarea + counter, Select (native + listbox through Command, option groups), Checkbox + CheckboxGroup, RadioGroup (+ price slot), Switch (stateLabel, loading holds position), SegmentedControl (ToggleGroup), DateInput, TimeField, MoneyInput (integer cents), FileDrop (A), Stepper, InlineConfirm | 5 h | W1 | restaurant WP2 (sign-in), WP6 and WP7 (onboarding), WP8 and WP9 (menu, hours), WP10; admin WP-1 sign-in, WP-8 refunds |
| **W4 Feedback** | Banner + InlineAlert (`Alert`; neutral, info, warning, danger **and slate**), EmptyState, ErrorState, Toast (Radix kept), Modal/AlertDialog (barely used; confirm and alert only), Menu (DropdownMenu + menuitemradio), ProgressBar, PageAnnouncer, Countdown (ring, bar, text; silent; bar-only; themed text roles), StatusTimeline (port to tokens) | 4 h | W1 | every screen's loading, empty and error states; restaurant WP3 (strip countdowns); admin WP-9 banners |
| **W5 Halal (web)** | HalalShield, HalalBadge (four states + amber expiring + operational Tooltip; null renders nothing and reports), HalalCertificationPanel (restaurant + compact variants, `certificate_viewable=false` copy), SevenChecks (compact HalalChecklist: locked H5 and H7, restricted H2 and H6, unrecorded row) + DecisionBar, IssuerCombobox, JustifiedReveal, RiderChecklist | 4 h | W3, W4 | admin WP-3 (verification console), WP-5 (rider review), WP-2; restaurant WP10 (settings halal card), WP4 (halal state) |
| **W6 Data (LyteNyte)** | DataTable on `@1771technologies/lytenyte-core` 2.x with the DS contract (caption, `aria-sort`, roving rows, selection, row Menu, cursor "load more", loading, empty, filtered-empty and error states with the header kept), cells (Text, Id+copy, Money via Price, Time (short with Tooltip), Countdown (silent), Status (Badge), HalalState (HalalBadge operational; missing value = "No status on file"), Meter), FilterBar, FilterChip, ListPaneRow, EventLog. Retire `Pagination` and `useGridKeyboard`. (added in check) DateCell (short date + Tooltip); EmptyState and ErrorState inside the grid body (admin `OrdersGrid`: "EmptyState / ErrorState inside the grid body"); the paging-error InlineAlert that keeps the loaded rows | 5 h | W1, W4 | admin WP-2, WP-4, WP-5, WP-6, WP-7, WP-8, WP-11; restaurant WP5 (history), WP8 (menu grid), WP11 (payouts table) |
| **W7 Restaurant console composites** | NewOrdersStrip + OfferTile (critical Accept 72px, Decline → DeclineForm, Countdown ring silent, roving arrow keys, A/R only while focus is in the strip, sound hook, PageAnnouncer), StatusCard (Right now: Switch + pause Menu), SetupChecklist, Weekly hours editor (Closed or up to 3 ranges, 12-hour), DocumentViewer (image and PDF from a short-lived URL, loading and expired-link states), QR, LiveMap port (Mapbox GL, dark pin tokens), AddressCombobox + MapPinPicker (**needs PR #300**: `suggestAddresses`, `getPlaceAddress`, `reverseGeocode`). (added in check) PickupCode (renders `pickup_code` from **PR #290**; loading, error and missing states) | 5 h | W3, W4, W6 | restaurant WP3 (the 180-second strip: **critical path**), WP4, WP6, WP9; admin WP-3 viewer, WP-7 map |
| **W8 Cut-over** | Migrate admin and restaurant to the new exports (aliases make this mechanical); delete `content/MenuItemCard`, `content/RestaurantCard`, `content/OrderCard` and `content/QuantityStepper` from web (native only), `Pagination`, `Breadcrumbs` (if unused); flip the composition lint and the provenance check (#112 step 3) to errors; update `02-components.md` | 3 h | W1–W7 | release gate |

**Web critical path:** S0 → W0 → W1 → W2 → W6 → admin WP-2/WP-6; and W1 → W4 → W7 →
restaurant WP3. W3 and W5 run beside W2 and W6 with a second agent.

### 4.2 Native track: `@hg/ui-native` on React Native Reusables and NativeWind (customer, rider)

| WP | Contents | Size | Depends | Unblocks (app WPs) |
|---|---|---|---|---|
| **N0 NativeWind + RNR foundation (spike first)** | 1-hour spike: one RNR Button rendering in `apps/rider` on Expo 54 / RN 0.81.4 / React 19.1, iOS sim + Android emu + react-native-web. Then: `nativewind` + `tailwindcss@3` + `react-native-css-interop` as app dependencies, `nativewind/babel` in both `babel.config.js` (keeping the resolve-through-expo preset trick), `withNativeWind(config, { input: global.css })` wrapped **around** the existing Metro singleton `resolveRequest` (keep the singleton branch first), generated `global.css` from S0, RNR `components.json` with an alias into `packages/ui-native/src/lib/ui`, `@rn-primitives/*` deps hoisted once, `<PortalHost />` in both App roots, `cn()`, colour-scheme bridge, fonts (Plus Jakarta + IBM Plex Mono). Jest: `nativewind` jest preset, RNTL. DS gallery route (dev builds only) + Maestro screenshot flow | 5 h incl. spike | S0; customer PRs landed or frozen | every native WP; customer WP0, rider WP0 |
| **N1 Core** (1, 2, 3, 4, 6, 8: 93% of native mounts) | Text + typography variants, Button (sizes to 72 critical, field 56, label wraps at 200%, rider primary orange with dark label), IconButton (56 lg), Icon (shared generated map + #198), Badge (+ field size), Card (+ interactive, reflow at 2x), Price (display-lg, negative, announceAs, Dynamic Type), Skeleton (dark fix), Spinner, Separator, Avatar, KeyValueList (A), StatCard (A) | 4 h | N0 | customer WP2–WP9 lists and cards; rider WP2, WP10 |
| **N2 Navigation and overlays** | AppBar (cream, raised and field tones; address title button; search slot; 56px back on field; titles wrap), BottomNav (links with selected state, not tabs; `hidden`; customer Home/Search/Orders/Account, rider Home/Earnings/Account), Sheet (bottom; full + non-dismissible for the offer at `z-offer-sheet`; focusable title; sticky footer slot; field tone; keyboard avoiding), Modal (AlertDialog; actions stacked 24px apart), Toast (Portal composite), StickyFooter | 5 h | N1 | customer WP0 (tabs), WP4 (cert sheet), WP5 (item sheet); rider WP0 (3 tabs + offer layer), WP3 (offer) |
| **N3 Forms** | Field (helper, error, ErrorSummary), Input (+ OTP 6 and 4-cell handover, 56 field, tel +1 national), Textarea + counter, Select (RNR Select), Checkbox + CheckboxGroup (56 rows), RadioGroup (price slot, roomy 72), Switch (stateLabel, loading), SegmentedControl (ToggleGroup, 56), DateInput (typed d/m/y), QuantityStepper (Remove at 1, limit state; absorb PR #639) | 5 h | N1 | customer WP1 (sign-in OTP), WP5 (item options: **PR #644**), WP6 (tip), WP11; rider WP1, WP7 (profile, DOB), WP5 (handover 4-cell OTP: **PR #290**) |
| **N4 Halal (native)** | HalalShield (View-drawn; add `solid-clock`), HalalBadge (4 states, amber expiring, **dark roles from the packet**, null renders nothing), HalalCertificationPanel (+ unviewable copy, offline-15-minute rule is app logic), RestaurantHalalStatus (only with fields present) | 3 h | N1, approval packet for dark roles | customer WP2 (Home cards), WP3 (search), WP4 (restaurant + cert sheet), WP9 (orders); dark customer boards |
| **N5 Feedback and status** | Banner + InlineAlert (incl. slate), EmptyState, ErrorState, WaitingState, WaitProgress, ProgressBar, Countdown (ring, bar, text; silent; `onDark`), StatusTimeline (port to tokens; keep `order-track.ts`), ProgressSteps, StatusLabel, announcer (rate-limited `announceForAccessibility`) | 4 h | N1 | every screen's states; customer WP7 (tracking); rider WP2 (waiting), WP3 (30-second offer), WP7 and WP8 (steps), WP10 |
| **N6 Lists and content** | ListRow (64/72, inset focus), Disclosure (Collapsible), Menu (DropdownMenu), Tabs as jump links, MediaFrame, RestaurantCardCompact + Rail, MenuItemCard, OrderCard (re-skin), rider composites (ActiveDeliveryBar, QueuedStepRow, MessagePreview, FoodStatusPanel, ActionList as critical-button list). (added in check) ActiveJobBar (rider Earnings; sticky above BottomNav), FilterChip (customer Search filters; RNR `Toggle`, aria-pressed) | 5 h | N1, N5 | customer WP2, WP4, WP9, WP10; rider WP4–WP6, WP9, WP11 |
| **N7 Capture and maps** | FileUpload row (thumbnail, PDF, retry, Progress), system-camera capture (permission denied in slate), DocumentViewer native (image zoom; PDF opens externally), MapView on Mapbox (`@rnmapbox/maps`; keys #57) with a text-panel fallback (keep today's graceful degrade), dark pin tokens, AddressMapPicker (map search + draggable pin; **needs PR #300**). (added in check) MapPreview (static pin, Mapbox attribution always visible), AddressSuggestionList (Input search + ListRow results, from `suggestAddresses` and `getPlaceAddress`) | 5 h | N1, N5 | rider WP4, WP5 (photo proof), WP8 (documents); customer WP7 (live map), WP11 (address form), WP8 (evidence) |
| **N8 Cut-over** | Migrate customer and rider imports; delete StyleSheet internals (`internal/primitives.tsx`, `interaction.tsx`, the colour paths of `ThemeProvider`); flip the lints; regenerate icons; one Maestro smoke on both apps | 3 h | N1–N7 | release gate |

**Native critical path:** S0 → (land customer PRs) → N0 → N1 → N2 → rider WP3 offer and customer
WP5 item sheet. N3 and N5 run beside N2.

### 4.3 Calendar against the relayed Mon 12 Oct date

Four agents, two per track, starting Fri 9 Oct evening:

| When | Web agents | Native agents |
|---|---|---|
| Fri eve | S0 (one agent), W0 | land/freeze customer PRs; N0 spike → N0 |
| Sat am | W1 → W2 ∥ W3 | N1 → N2 ∥ N3 |
| Sat pm | W4 ∥ W6 | N5 ∥ N4 (light only until the packet lands) |
| Sun | W5 ∥ W7 | N6 ∥ N7 |
| Mon am | W8 | N8 |

The app agents start **Sat midday** on W1 and W2 or N1 and N2 outputs, using the existing
packages for anything not yet rebuilt. Because the rebuild is API-compatible, their code does not
change when a component's internals swap.

**The owner's approval packet (§2.3) must be scheduled for Sat.** Without it, every "P" composite
stays on a branch, and the apps fall back to the existing hand-built versions.

---

## 5. Verification

### 5.1 Per component (table-driven, few and high-value, per AGENTS.md §6)

**Every component**, in one parameterised test per package
(`__tests__/contract.test.tsx`, iterating a registry of `{component, stateProps[]}`):

- **States:** renders every variant and size the `.d.ts` declares, plus default, loading,
  disabled (`aria-disabled`, still focusable on web) and error where they apply.
- **Accessibility:** on web, `vitest-axe` on each state plus `getByRole` with the accessible name
  the README specifies (Button "Back to {previous}", IconButton "Cart, 3 items", Price "12 dollars
  and 34 cents"). On native, RNTL `accessibilityRole`, `accessibilityState` and
  `accessibilityLabel` checks.
- **Targets:** measured hit area ≥ 44 (web and native), ≥ 56 for `field` sizes, ≥ 72 for
  `critical` (gate §5 item 3).
- **Tokens only:** a static test that `src/**` contains no hex values, no `rgb(`/`hsl(` outside
  generated files, and no ramp names (`brand-500`) in components (lint L-2).
- **No left-border active state:** a static check for `border-l`, `borderLeft*` or
  `border-inline-start` on selected or active classes (gate §5 item 9).

**Halal invariants**, in dedicated tests (these already exist in part and are kept and extended):

- **Invariant 8:** HalalBadge, HalalCertificationPanel, RestaurantHalalStatus and the
  HalalStateCell render **nothing** for `null`, `undefined` or an unknown state, and report
  `HALAL_DISPLAY_STATE_MISSING`. The certification panel's "View certificate" is absent when
  `certificate_viewable=false`.
- **Invariant 9:** for EXPIRED, UNVERIFIED and EXPIRING_SOON, in both themes, no computed colour
  resolves to any `danger.*` or `feedback-danger-*` value. Banner and InlineAlert in a halal
  context accept `slate`, not `danger` (a type-level check: `tone: Exclude<Tone,'danger'>` on the
  halal-message props).
- **Invariant 10 and L-4:** the existing L-4 rule runs over `ui-web` and the ESLint rule over
  `ui-native`, after the `pinRider` exception is removed. A render test confirms that only
  HalalBadge(CERTIFIED) and HalalShield paint the seal colour. Badge, Toast and Button have no
  `success` solid.
- **Fixed strings:** the labels "Halal certified", "Halal certified · expires 20 Oct",
  "Certification expired" and "Not verified", the spoken labels, and the standing line with and
  without a date ("{date}" is never shown). The test compares against the table exported from
  `labels.ts` and `HalalBadge` and is shared by web and native.
- **Approval gate:** the existing `approval-gate.types.test.ts` is kept. Six of seven is a
  rejection; H5 and H7 are locked.

**Money and time:** Price refuses non-integers and renders nothing (`MONEY_NOT_INTEGER_CENTS`), and
negative amounts use U+2212. Countdown has no `seconds` prop, applies the skew rule, fires
`onExpire` once, never shows a negative number, and in silent mode renders no live region. Times
use the one 12-hour formatter (gate §5 item 10).

### 5.2 Visual check against the approved design

The canvases cannot be rendered locally as mirrored, because every board loads the unpublished
`./support.js`. The **design system's own previews can be**: `components/<Name>/preview.html` plus
`components/bundle.js` and `bundle.css` are on disk. So:

1. **Reference renders:** a Playwright script opens each live `preview.html` (React 18.3 from
   `lib/`) at 1440 px and 390 px, and screenshots each `[data-testid]` specimen. The output is
   `scratchpad/ds-ref/<Name>/<state>.png`, regenerated whenever the snapshot (#112) changes.
2. **Web candidate renders:** Ladle stories in `packages/ui-web/src/**/*.stories.tsx`, one story
   per state, named like the preview's specimens. Playwright (`tools/e2e/web` already has the
   config and `shots.ts`) screenshots them, then:
   - runs a pixel diff with a 2% tolerance (text antialiasing differs between React 18 and 19);
   - writes the pairs into a **side-by-side HTML report**, which is what a human reviews. Pixel
     diffs flag; people decide.
3. **Native candidate renders:** a dev-only `/__ds` gallery screen in each app, listing the same
   states.
   - Maestro (`tools/e2e/native`) `takeScreenshot` on the Android emulator in light and dark, at
     font scale 1.0 and 2.0.
   - The same gallery under react-native-web (the customer app already builds for web with shims)
     goes through the Playwright diff against the 390 px references.
4. **Screen-level:** app agents compare their screens with the canvas board PNGs. Those PNGs come
   from the published canvas artifacts (open in Claude Design and export), not from the mirror.
   This belongs to the app plans, not the DS.

Storybook is not required; Ladle is lighter and Vite-native. If time runs short, cut the
automated pixel diff and keep the side-by-side report.

### 5.3 Constitution §5 gate, mapped to where it is enforced for components

| Gate item | Enforced by |
|---|---|
| 1. Owner-approved, design-system components only | §2.3 packet; provenance check (#112 step 3) at W8/N8; composition lint in `apps/*` |
| 2. Empty, loading and error exist | EmptyState, ErrorState, Skeleton and `status` props on DataTable, Select and Price; app plans test the screens |
| 3. Targets 44 / 56 / 72 | contract test, measured |
| 4. Contrast 4.5:1, 7:1 on rider | a token-pair ledger test that recomputes `_pairs` from the generated values, plus the #167 fixes; rider-field pairs must be ≥ 7 |
| 5. Primary action identifiable | Button `primary` once per view: an app-level review item, not a DS test |
| 6. No solid green outside halal, no halal red | L-4 + invariant 9 and 10 tests |
| 7. Themes as decided | native: light and dark galleries; web: light only (dark variant compiled, not reviewed) |
| 8. Approved halal wording | fixed-strings test |
| 9. Fills, never left borders | static check |
| 10. 12-hour times | one formatter exported from both packages, unit-tested |
| 11. In-page panels, not overlays (web) | DetailPanel, SplitPanes and InlineConfirm exist; Modal and Sheet are not offered by `@hg/ui-web`'s main barrel for working tasks (export only `AlertDialog` for destructive confirms) |

---

## 6. Risks, and what to cut first

### 6.1 Risks, highest first

1. **The calendar.** The repo date has passed and the relayed date is three days away. A
   ground-up rebuild before the apps is impossible.
   *Mitigation:* the API-compatible rebuild, most-mounted first, with apps starting on W1/W2 and
   N1/N2 outputs.
2. **NativeWind is not wired today.**
   - `@hg/ui-native` is StyleSheet-based, and neither app has NativeWind's Babel, Metro or
     `global.css`.
   - Metro's hand-written singleton resolver, the react-native-web shims and `withNativeWind`
     must coexist. A wrong order brings back the duplicate-`InitializeCore` crash.
   - *Mitigation:* the N0 spike is first and time-boxed. If it fails, **fall back to "RNR-shaped,
     StyleSheet-backed"**: copy the `@rn-primitives/*` headless primitives, which need no NativeWind,
     and style them with the generated `themes.ts`. That keeps "built on RNR primitives" without the
     NativeWind risk.
3. **Expo SDK 54 / RN 0.81 / React 19.1 and RNR.**
   - RNR and `@rn-primitives` must support the new architecture.
   - Some RNR components pull in `react-native-reanimated`; SDK 54 ships Reanimated 4, which needs
     `react-native-worklets` and its own Babel plugin.
   - RNR's default icons are `lucide-react-native`; replace every one with our Solar `Icon` on
     copy-in, and fail lint on `lucide`.
   - *Mitigation:* pin exact versions, choose components without Reanimated where possible, and
     test in the N0 spike.
4. **NativeWind v4 (Tailwind v3) vs web Tailwind v4.**
   - There are two generators and two config dialects.
   - RNR's templates assume `hsl(var(--x))`.
   - NativeWind's default rem is 14px.
   - *Mitigation:* one alias table generated into both, hex not HSL, `rem: 16`, a lint against
     `hsl(`. **Do not adopt NativeWind v5 or Tailwind v4 on native for 1.0.**
5. **Monorepo hoisting under pnpm.**
   - The packages are consumed as TypeScript source.
   - `@rn-primitives/*`, `react-native-css-interop` and `radix-ui` must resolve to a single copy
     beside the app's React.
   - The shadcn and RNR CLIs write relative paths that assume an app, not a package.
   - *Mitigation:*
     - put these packages in `ui-*` `peerDependencies` and the apps' `dependencies` (the pattern
       react-native already uses);
     - extend the Metro singleton list;
     - run the CLIs inside `packages/ui-*` with `components.json` aliases into `src/lib/ui`;
     - keep Tailwind `@source` for web.
6. **Design-first versus speed.**
   - Most composites are "proposed", and #109 (library sources in Claude Design) is not done.
   - Merging unapproved composites breaks the constitution.
   - Making apps wait breaks the date.
   - *Mitigation:* the §2.3 single approval packet, `proposed/` branches, and a fallback to the
     existing hand-built components.
7. **Dark halal tokens are missing, and the rider app follows the phone's theme**, so it is often
   dark. Every dark customer board is "Not for approval". **Correction (added in check):** only
   the 8 dark halal-bearing customer boards (Discover & Order and Cart & Checkout) are "Not for
   approval". Rider dark boards are approved and mount no HalalBadge; their dark blocker is the
   map-pin tokens.
   *Mitigation:* this is the first item in the approval packet. Until it is approved, the native
   HalalBadge keeps today's in-component dark mapping, which uses existing primitives with
   measured pairs, and is labelled as debt.
8. **The open customer PRs edit `ui-native`** (#625, #634, #635, #639). Rebuilding underneath them
   causes conflicts and lost fixes. *Mitigation:* land them first, or absorb them.
9. **LyteNyte Core semantics and the DS DataTable contract.** The README requires a real caption,
   `aria-sort`, roving rows, a row Menu and cursor paging. A virtualised grid uses grid ARIA, not
   table semantics. *Mitigation:* accept `role="grid"` with a caption via `aria-labelledby`, and
   record the change in the DataTable README in the approval packet. The keyboard model follows
   the README.
10. **shadcn naming collisions.** shadcn's `accent` is not our forest accent, and shadcn's
    `secondary` is not our secondary button. A careless mapping paints forest washes on hover, or
    paints success green. *Mitigation:* generated aliases only, plus lint L-4.
11. **"Apps define no components" against page-specific sections** such as the verification
    console's VerifyHeader, Transcription and CertPane. Defining them in an app breaks the rule;
    putting them in the DS bloats it. *Mitigation:* page sections are plain JSX composed of DS
    parts in route files, with no exported component and no raw interactive elements. Ask the
    owner to confirm that reading in the packet.
12. **Maps.** The decision is Mapbox, but `ui-native` uses `react-native-maps`.
    `@rnmapbox/maps` needs a config plugin, a prebuild and keys (#57). *Mitigation:* keep the
    text-panel degrade; ship the map wrapper behind it.
13. **Stale documents mislead agents:** `@hg/design-tokens` (Crimson),
    `research/component-libraries.md` (crimson, Hugeicons, TanStack) and `01-foundations.md`
    (old halal hex values, Lucide, gradients). *Mitigation:* delete or update them in S0.
14. **Fonts:** IBM Plex Mono is not installed anywhere. *Mitigation:* S0 and N0.

### 6.2 Cut order (first cut first)

1. **Automated pixel diffs.** Keep the side-by-side report and human review.
2. **Rating** (no launch use), **SparklineCell**, **BarChart**, **Carousel**, **QR**, **MultiSelect**
   (use FilterChip groups) and **OnCallContact** (compose it on the page). If staff authenticator
   enrolment is still in launch after #623, build QR as a 30-line wrapper rather than cut it.
3. **CameraCapture and Scanner** in favour of the system camera through `expo-image-picker`.
4. **DocumentViewer zoom and page controls.** Open PDFs externally from the short-lived link.
5. **Dark variants on web** (restaurant and admin are light-only), **NavDrawer** (no admin layout
   below 1024 px), **SectionNav** (use a ListRow list).
6. **Native NativeWind adoption** (risk 2's fallback): RNR primitives styled by StyleSheet tokens.
7. **Tabs as jump links** and **RestaurantRail** (fall back to a vertical list plus one row).
8. **Never cut:** HalalBadge and the halal family (including the expiring look and the
   missing-field rule), Price, Countdown, Banner and InlineAlert slate, Skeleton, EmptyState,
   ErrorState, Button and Input target sizes, DetailPanel and SplitPanes, DataTable states,
   NewOrdersStrip, the 56 and 72 rider sizes, L-4.
