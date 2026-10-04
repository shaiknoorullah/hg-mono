---
covers: []
reviewed: 2026-10-04
---

# Design audit — `apps/restaurant` (restaurant operator web)

> **Historical.** Written on 27 September 2026 about the restaurant web app as it was before its
> redesign. Superseded by the [decision log](../../decisions/README.md) and the [Claude Design
> canvases](../design-surface.md#1-where-the-screens-are) the owner approved;
> [reading the audits](../redesign-constitution.md#7-reading-the-pre-redesign-audits) explains
> what still holds.
>
> **Recommendations here that the owner decided differently:**
>
> - The three-column order board → **no Kanban board**: a live strip directly under the app bar,
>   on every page, lists every order awaiting acceptance with its countdown, and order detail opens
>   in side-by-side panes ([desktop working pages](../../decisions/README.md#design-system-and-desktop-layout),
>   [strip position](../../decisions/README.md#restaurant-1)).
> - One breakpoint with phone and portrait layouts below it → **desktop and landscape tablets from
>   1024×768 only**, on pages that fit the screen and never scroll
>   ([devices](../../decisions/README.md#restaurant-1)).
> - Reject and menu editing in dialogs and side sheets → **no overlay sheets or modals for working
>   tasks**; detail opens in in-page panels
>   ([desktop working pages](../../decisions/README.md#design-system-and-desktop-layout)).
> - Restoring the dark scheme → **light only**
>   ([dark theme](../../decisions/README.md#customer-app)).
> - Staff moved behind Settings → **owner-only accounts at launch**, the Staff screen hidden, one
>   restaurant per login ([staff accounts](../../decisions/README.md#restaurant)).
> - Drafts with "Submit for approval" → **no drafts**: restaurants edit their own menu from
>   launch and every save goes straight to review ([menu drafts](../../decisions/README.md#restaurant),
>   [menu editing](../../decisions/README.md#launch-scope-and-contract)).
> - Seal binding before "Mark ready" → **no tamper seals at launch**; the kitchen reads a pickup
>   code to the rider ([pickup](../../decisions/README.md#orders-and-delivery)).
> - A local Countdown in the app → **Countdown is a design-system composite**; apps define no
>   components.
> - 24-hour times such as "This clears at 11:00" → **12-hour times everywhere**
>   ([time format](../../decisions/README.md#every-app)).
>
> Its open questions are settled: claim-bearing menu fields never auto-approve
> ([menu approval](../../decisions/README.md#settled--reconciliations)), document review is quoted
> as "within 3 business days" ([restaurant](../../decisions/README.md#restaurant)), and locations
> come from a Mapbox map search through our API
> ([map address search](../../decisions/README.md#launch-scope-and-contract)).

**Auditor:** product design review · **Date:** 2026-09-27 · **Scope:** every file under
`apps/restaurant/src/` (9 routes, 4 onboarding steps, Shell, 8 components, 5 lib modules)
plus the frozen constraints in `docs/design/*` and the restaurant domain spec.

**This document changes no code.** It is an audit and a redesign brief.

---

## 0. The constraints this audit designs inside

### 0.1 The restaurant register — exact values

`apps/restaurant/src/App.tsx:86-87` selects `THEME = 'restaurant'`, `SCHEME = 'light'`, and
`styles.css:13-15` records the intent. The resolved values, from
`packages/ui-web/src/tokens/themes.ts` (generated from `docs/design/tokens.json`):

| Role | Light | Dark (exists, unused) | Token source |
|---|---|---|---|
| `register` | `operational` | `operational` | `themes.ts:24` |
| `density` | **`compact`** | `compact` | `themes.ts:25` |
| `density.rowHeight` | **44** | 44 | `tokens.json:326` |
| `density.cardPadding` | **12** | 12 | `tokens.json:326` |
| `density.gutter` | **12** | 12 | `tokens.json:326` |
| `surface.chrome` | **`#1B3B31`** (forest "pine") | `#0A1913` | `tokens.json:31`, `themes.ts:38` |
| `surface.base` | `#FFFAEA` (warm cream) | `#171717` | `themes.ts:33` |
| `surface.sunken` / `subtle` | `#F6EFDD` | `#000000` / `#232323` | `themes.ts:34-35` |
| `surface.raised` | `#FFFFFF` | `#33352F` | `themes.ts:36` |
| `text.primary` | `#232323` (15.07:1) | `#F6EFDD` | `themes.ts:42` |
| `action.primary.bg` / `.fg` | `#F1521E` / `#0F241C` (4.63:1) | same | `themes.ts` |
| `action.secondary.bg` / `.fg` | **`#1B3B31`** / `#FFFFFF` (12.25:1) | `#0A1913`-family | `themes.ts` |
| `action.danger.bg` / `.fg` | `#C42B1C` / `#FFFFFF` (5.66:1) | same | `themes.ts` |
| `halal.certified.seal` / ring | `#0F7A43` / `#C9A24B` brass | `#10864A` / `#DDB863` | `tokens.json:105,109` |
| `target.min` / `field` / **`criticalField`** | 44 / 56 / **72** | — | `tokens.json:396-399` |
| `breakpoint.lg` | 1024 — *"Restaurant queue switches to 4 columns at/above this"* | — | `tokens.json:420` |

Two things follow that the app does not currently honour:

1. **`target.criticalField` = 72 names this app by name.** `tokens.json:398`:
   *"Rider Accept / Decline; **restaurant Accept order**. Irreversible-under-time-pressure
   actions."* Restated in `04-accessibility.md:68`.
2. **The forest chrome `#1B3B31` is used nowhere in this app.** `grep -rn "chrome" src/` returns
   only two prose comments (`Shell.tsx:7,11`). `surface.chrome` is unreferenced. The restaurant
   register's defining surface colour is unused, and the app reads as a cream consumer admin
   panel rather than an operational surface. (Note also that `themes.ts:8-18` still describes the
   register as "Midnight chrome" — stale documentation, superseded by
   `docs/decisions/palette-and-invariant-10.md`.)

### 0.2 Frozen library — what exists and what this app uses

The app imports **21** symbols from `@hg/ui-web`: `AppShell, Button, Card, Chip, ConfirmDialog,
EmptyState, ErrorState, HalalBadge, Icon, IconButton, Input, Select, SideNav, Spinner, Textarea,
ToastProvider, TooltipProvider, cx, themeAttributes` + two types.

**Purpose-built for this surface, shipped, and unused:**

| Component | Built for | Evidence |
|---|---|---|
| `useOrderAlert` | *"the never-miss-an-order affordance for the restaurant queue"* | `packages/ui-web/src/feedback/useOrderAlert.ts:1-25` |
| `Banner` `emphasis="prominent"` | *"The highest-stakes use is the restaurant queue's SSE-disconnect banner… `emphasis` `prominent` … For the queue banner"* | `feedback/Banner.tsx:13-16,42-44` |
| `OrderCard variant="restaurant"` | masked phone, `urgent`/`late`/`stale` word badges, verbatim instructions block, `countdown`/`actions` slots, *"a destructive/constructive pair under a deadline is ≥24"* | `content/OrderCard.tsx:11-19,44,114` |
| `Switch` (primitive) | *"restaurant accepting-orders (R-22), item availability (R-18)"*; `stateLabel` required; `loading` holds the old position until the server confirms | `primitives/Switch.tsx:9-22` |
| `Price` | *"the only component in the system permitted to render money"* | `content/index.ts:12-14` |
| `Skeleton`, `StatusTimeline`, `Tabs`, `TopBar`, `Toast`, `emptyQueueDrained`, `ORDER_STATE_LABELS`, `measureSkewMs`, `remainingMs`, `HalalCertificationPanel` | — | all exported, none imported |

The app instead hand-rolls: a `StatusChip` (`components/StatusChip.tsx`), a `DeadlineTimer`
(`components/DeadlineTimer.tsx`), a `PageLoading` spinner, three separate `money()` formatters,
raw `@radix-ui/react-switch` in two places, raw `@radix-ui/react-tabs`, raw
`@radix-ui/react-dialog` for both item dialogs, a hand-built warning banner
(`StaffPage.tsx:134-140`) and a hand-built bottom nav (`Shell.tsx:113-135`).

Some of those are defensible and documented (`StatusChip`'s header is a good argument;
`@hg/ui-web` genuinely has no web bottom-nav). Others are straight bypasses of a frozen
component that exists and is better — flagged per screen below.

### 0.3 The one-breakpoint rule

`apps/marketing/AGENTS.md:46-52` records a decision worth transplanting verbatim:

> One breakpoint, and it is **`lg` (1024px)**, not `md`. Below it the phone artboard runs; at and
> above it the desktop artboard does. `md` was the switch originally and the desktop layout does
> not fit until ~1000px, so every tablet in portrait scrolled sideways — 227px on `/restaurants`.

The restaurant app is the app most likely to *be* a tablet in portrait, and it makes the exact
mistake the marketing app removed. `Shell.tsx:71` switches the 256px (`w-64`,
`SideNav.tsx:97`) rail in at `md:` = 768px, while `OrdersPage.tsx:102` does not reach two columns
until `lg:` = 1024px. On an iPad in portrait (768–834 CSS px — the default kitchen device) the
result is: a 256px desk rail, 16px gutters, and a **single ~480px column of order cards**. The
rail eats a third of the screen to show six links, and the queue is narrower than it would be on
a phone. `SideNav` accepts `collapsed`/`onToggleCollapsed` (`SideNav.tsx:61-62`); the Shell never
passes them, so that width cannot be reclaimed.

### 0.4 Two corrections to the brief's premises

Stated so the rest of this document is not built on them:

1. **"R-05 is load-bearing: claim-bearing menu fields never auto-approve."** R-05 in
   `docs/spec/03-restaurant.md:347` is *Business profile submission* and says nothing about menu
   claims. The claim/instant split lives in **R-17** (`03-restaurant.md:1043-1063`).
2. **R-17 does not say claim-bearing fields never auto-approve.** Its open decision **D-22**
   (`03-restaurant.md:1059`) proposes the opposite: *"A pending version older than 24 hours is
   **auto-approved** by a scheduled job, tagged `auto_approved=true`, and retained in an admin
   post-hoc audit list"*, explicitly contrasted with *"unlike KYC (never auto-approved)"*. It is
   still a **DECISION REQUIRED** and is not listed in `docs/decisions/README.md` blockers.

What *is* load-bearing and settled in R-17, and what this audit holds the UI to:

- **Reviewed** = `name, description, ingredients_text, dietary_tags, allergen_tags,
  image_media_id, portion_description`. **Instant** = `price_cents, availability_state,
  out_of_stock_until, category_id, sort_order, prep_minutes` (`03-restaurant.md:1057`).
- A reviewed edit writes a version at `PENDING_REVIEW` and **leaves `live_version_id`
  untouched** — customers keep seeing the old words (`:1051-1054`, AC2 `:1093`).
- `DRAFT → PENDING_REVIEW` is an explicit **"Submit for approval"** click (`:1070`).
- **R-17 R3:** rejection carries a reason code; `OTHER` needs ≥20 chars; *"The restaurant sees
  the code and note **verbatim**"*.
- The reason enum includes **`UNSUBSTANTIATED_HALAL_CLAIM`** and **`MISSING_ALLERGEN`**
  (`:1063`).

Invariants 8/9/10 are not literally violated anywhere in this app — I checked every colour
decision. There is no optimistic halal badge, nothing red carries a halal meaning, and no solid
green appears outside `HalalBadge`. The halal problems in this app are about *consent* and
*silence*, not colour, and they are worse.

---

## 1. Per screen / route

### 1.1 `components/Shell.tsx` — the persistent operator chrome

**Purpose.** Wayfinding and identity across the six authenticated routes.
**What the user is trying to do.** Get to the queue, and — critically — know from anywhere in the
app that an order is waiting.

**What it renders today.** `AppShell` with a single slot filled (`sideNav`, line 70). Inside it a
`SideNav` (lines 72-101) with a six-item group (lines 18-25), a brand header (76-84) and a
footer with the principal's role and a hand-rolled sign-out button (86-100). Below the shell, a
hand-composed fixed glass pill bottom bar (113-135) showing the first four nav items
(`MOBILE_NAV`, line 32), `md:hidden`.

**Problems.**

- **P1.1 — The queue depth is invisible from every other screen.** `SideNavItem` was built for
  exactly this: `badge: number | 'dot'` plus `badgeNoun`, *"Folded into the accessible name"*,
  producing "Orders, 3 waiting" (`SideNav.tsx:41-44,69-74`). `Shell.tsx:56-65` constructs items
  with no `badge`. A staff member editing the menu or fixing hours has no indication that a
  180-second clock is running one route away. This is the cheapest possible fix to the worst
  problem in the app and the library already implements it.
- **P1.2 — `AppShell`'s `systemBanner` slot is empty.** `AppShell.tsx:37-38` describes it as
  *"System-level banners. Above the scroll region, always visible."* There is therefore **no
  place in the current chrome** where a connection-lost banner, a sound-armed indicator, or the
  R-10 certificate-expiry banner could live. `topBar` (`:34`) and `pageHeader` (`:40`) are also
  unused.
- **P1.3 — No route-change announcement and no focus movement.** `AppShell` takes `routeKey` and
  `routeAnnouncement` (`:44-47`) and moves focus to the new `h1` on change (`AppShell.tsx:83-87`).
  The Shell passes neither, so keyboard and screen-reader users navigating the rail get no
  announcement and keep focus in the nav. `skipTargets` (`:48-52`) is also unused, so there is no
  "Skip to queue".
- **P1.4 — The `md:` rail (see §0.3).** Lines 71, 105, 115. The 768–1023px band is the worst
  layout the app can produce and it is the most likely device width.
- **P1.5 — Two navigations disagree.** The rail has six destinations, the bottom pill has four
  (line 32). Payouts and Settings are unreachable on a narrow viewport — not merely
  de-emphasised, absent. The comment (27-31) argues Settings/Staff are "desk tasks", but the
  bottom bar keeps Menu and Hours and drops Payouts and Settings, and a restaurant that is
  `CLOSED_SUSPENDED` can only learn why from Settings.
- **P1.6 — Sign-out is a hand-rolled `<button>`** (91-98) at `min-h-11` with hover styling,
  sitting where a `Button variant="ghost"` belongs, and it fires `void logout()` with no
  confirmation. On a shared kitchen tablet an accidental sign-out during service costs a
  re-login with email + password + TOTP (`LoginPage.tsx`), mid-dinner.
- **P1.7 — The brand mark is a check glyph in an orange tile** (77-79). On the product whose
  single claim is a *seal*, the identity mark in the operator chrome is a generic tick. Not a
  rule violation — `HalalBadge` correctly owns the seal — but a missed opportunity to teach the
  operator what they are part of.
- **P1.8 — `navGlyph` computes a `weight` it then discards for four of six icons** (34-48): the
  hand-drawn glyphs ignore `active`, so only Orders and Hours change weight when selected. The
  active state on the other four is carried by colour and tint alone.

### 1.2 `routes/LoginPage.tsx` — sign in

**Purpose.** Email + password + TOTP for a restaurant operator (`AGENTS.md:102`).
**What the user is trying to do.** Get into the queue, usually in a hurry.

**Renders.** A centred 400px card (35-36), an orange logo tile (38-40), `h1` at
`text-heading-md font-extrabold` (42), email/password (51-71), a conditional 6-digit OTP step
(75-89), inline error (91-95), submit (97-99), "Use a different account" (100-108), register link
(112-117). Loading, error and the MFA branch are all implemented.

**Problems.**

- **P2.1 — Any 403 is misread as "MFA required".** `lib/auth.tsx:55`:
  `if (e.is('MFA_REQUIRED') || e.status === 403) return { ok: false, mfaRequired: true }`. A
  suspended account, a revoked grant, or a role that cannot use this surface all produce a 403,
  and the operator is shown a TOTP field they can never satisfy, with no error text and no route
  out except "Use a different account". This is a dead end presented as a normal step.
- **P2.2 — No account-recovery path.** No "Forgot password", no "Lost your authenticator". Staff
  turnover is high and TOTP devices leave with the person who set them up. The only exit is the
  register link, which creates a second restaurant.
- **P2.3 — Screen title is `heading.md` (18px).** `01-foundations.md:244` assigns
  `heading.xl` (24) to "Screen title" and `heading.md` (18) to "RestaurantCard name; modal
  title". Every screen title in this app is two steps under. Compounded by `font-extrabold`
  (800) — see P0.1 below.
- **P2.4 — Success navigates unconditionally to `/onboarding`** (line 24). A live restaurant
  signing in lands on the onboarding route, which fetches status and only then redirects to
  `/orders` (`OnboardingPage.tsx:21-25`). Every sign-in costs an extra round trip and a visible
  "Checking onboarding status…" spinner before the queue appears.

### 1.3 `routes/RegisterPage.tsx` — open an account

**Purpose.** R-01 signup: business name, email, password.
**Renders.** Form (49-105) with a 12-char password minimum stated twice (85, 86); a "Check your
inbox" confirmation screen (29-47).

**Problems.**

- **P3.1 — The confirmation screen's success mark is an orange circle with a check** (33-35).
  Correct against invariant 10 (not green), but it is the same tile as the brand mark in
  `Shell.tsx:77` and the same as `LoginPage.tsx:38`, so the orange-tile-with-tick means "brand",
  "sign in" and "done" in three places.
- **P3.2 — Nothing tells the owner what they are about to commit to.** Line 55: *"Halal
  certification, documents and menu come next — this just opens the account."* That is one line
  of 13px body-sm. There is no statement of the four documents required
  (`DocumentsStep.tsx:10-15` knows them), no indication of the 72-hour review, and no mention
  that a payout account and a live menu item are required before a single order arrives. The
  owner's first honest view of the work ahead is three screens later.
- **P3.3 — `terms_version: '2026-01-01'` is submitted with no terms shown.** `lib/auth.tsx:72`
  asserts acceptance of a versioned agreement that the UI never displays or links.

### 1.4 `routes/onboarding/OnboardingPage.tsx` — the onboarding frame

**Purpose.** Render whatever `current_step` the server says (R-04: *"The client never decides the
next step"*).
**What the user is trying to do.** Find out what is stopping them going live, and do it.

**Renders.** Status fetch (16-19), redirect on `DONE` (21-25), loading (27), error (28-36), then
a progress `Card` (49-63) with `progress_percent` (51) and a client-computed "Step N of M"
(52-55), then exactly one step body (65-88).

**Problems — this is the screen the brief's fourth question is about, and the answer is no.**

- **P4.1 — `steps_completed` is never rendered.** R-04 (`03-restaurant.md:283-286`) exists to
  make a checklist possible: *"Each step's completion is recorded as a boolean in
  `steps_completed` **so the UI can render a checklist** and so a partially-completed
  application survives logout."* The payload carries six booleans (`profile,
  documents_uploaded, documents_submitted, documents_approved, payout_account, menu_published`,
  `:297`). The app renders a single percentage bar and one step. **At no point does an owner see
  the whole list of what is required.** They discover step 4 by completing step 3.
- **P4.2 — `blocking_reason` is rendered in exactly one place, as a fallback.**
  `ReviewStatus.tsx:29` shows it only when `flagged.length === 0`. R-04 AC4 is explicit:
  at 90% complete the server returns `blocking_reason='no_live_menu_item'` — and the app instead
  shows the generic `PassthroughStep` copy *"Add at least one category and one item in the menu
  editor, then come back here"* (`OnboardingPage.tsx:84`). The server's own answer to "what is
  blocking me" is fetched and discarded on five of seven steps.
- **P4.3 — The step counter is a client-side derivation that lies.** Lines 39 and 52-55 filter
  `AWAITING_REVIEW` and `FIX_DOCUMENTS` out of a locally-declared `STEPS` array (line 12) and map
  both back onto `DOCUMENTS`. A restaurant waiting on review and a restaurant whose halal
  certificate was rejected both read **"Step 2 of 5"**. R-04 R3 keeps `progress_percent`
  server-side for precisely this reason; the counter reintroduces the client-side step model
  next to it.
- **P4.4 — No `StatusTimeline`.** `03-patterns.md:346` requires
  `StatusTimeline variant="horizontal"` driven by the server's `onboarding_state`. The component
  ships (`feedback/StatusTimeline.tsx`) and is unused; a 2px progress bar (57-62) replaced it.
  The bar shows *how far*; the timeline shows *what and in what order*, which is the actual
  question.
- **P4.5 — No withdraw path.** R-04 lists `any → WITHDRAWN` (*"restaurant abandons application
  (self-service, ≥1 confirmation)"*). Absent.
- **P4.6 — `stepIndex` is computed (38) and used only for the unrecognised-step error (89).**
  Harmless, but it means an unknown server step renders a raw enum string as an error
  description to a restaurant owner.

### 1.5 `routes/onboarding/ProfileStep.tsx` — onboarding step 1

**Purpose.** R-05: the operational identity of the restaurant.
**Renders.** A two-column `Card` form (56-123): display name, legal name, owner names, phone with
`^\+1[2-9][0-9]{9}$`, description (20–1000), street, city, province `Select`, postal code with
the full Canadian pattern, average prep minutes, error, submit.

The validation patterns here are genuinely good and match R-05 R2/R3 exactly.

**Problems.**

- **P5.1 — Coordinates are hardcoded to downtown Toronto for every restaurant.**
  Lines 39-42: `latitude: 43.6532, longitude: -79.3832`. R-05 R10 is unambiguous: *"the map pin
  is authoritative and the address text is stored as entered"*, and R5/R6 write `coords`
  (`geography(Point,4326)`) from those values — the single column **used by dispatch and
  discovery**. Consequences: every restaurant on the platform is anchored to Yonge & Queen, so
  rider assignment distance, delivery-area matching and customer discovery are all computed
  against the wrong point; and R-05 R10's admin soft warning (*"pin vs. postal-code centroid
  > 5 km"*) fires for every restaurant outside the core, poisoning the review queue with noise.
  The in-code comment (39-41) calls the map picker "out of scope for v1 core" — but the fallback
  chosen is worse than asking the owner to type a lat/lng, because it is silent.
- **P5.2 — `cuisine_ids: []` is submitted, and R-05 R9 requires 1–5.** Line 44. There is no
  cuisine control on the form at all. Against a conforming server this step is **unsubmittable**;
  against a lenient one, the restaurant is listed with no cuisine, which is a discovery field on
  the customer surface. Either way the owner cannot fix it from this screen.
- **P5.3 — `gst_hst_number` is absent here but present in Settings** (`SettingsPage.tsx:153-159`).
  Open blocker O-01 (`AGENTS.md:96`) is HST registration. Asking for it only after activation
  means the field an accountant is currently blocking on is not captured at the moment the owner
  has their paperwork out.
- **P5.4 — No progressive disclosure and no save-and-resume.** Eleven fields in one submit, and
  all state is local `useState` (10-22). A tab crash, a sign-out, or a navigation loses
  everything. R-04's `steps_completed` was designed so *"a partially-completed application
  survives logout"* — for this step it does not survive a refresh.
- **P5.5 — `avg_prep_minutes` has no bound.** R-05 R7 requires 5–120; the input is a free
  `variant="numeric"` with `Number(v) || 0` (110), so `0` posts happily and the server rejects it
  with an error the operator must map back to a field themselves.
- **P5.6 — The province `Select` shows bare codes** (`PROVINCE_OPTIONS`, line 7: `{value: 'ON',
  label: 'ON'}`). Thirteen two-letter codes with no names, in a form filled by a first-time user.

### 1.6 `routes/onboarding/DocumentsStep.tsx` — onboarding step 2

**Purpose.** R-07/R-08: upload the four compliance documents and submit the pack.
**Renders.** Four `DocRow`s (160-162) with label, hint, per-document state chip (82-98), rejection
reason (105-107), a hidden file input and an Upload/Replace button (116-119); a `Submit for review`
button gated on `allSubmitted` (133-137, 169-171).

The SHA-256 hash (17-21) and the presign → PUT → confirm → attach sequence (38-66) are correct and
respect invariant 7 (private buckets, presigned).

**Problems.**

- **P6.1 — This is the one surface where `UNVERIFIED` is supposed to render, and it doesn't.**
  `03-patterns.md:346`: *"The halal certificate step carries a `HalalBadge surface="operational"`
  reflecting the certificate's real state, including `UNVERIFIED` (**this is the one surface
  where `UNVERIFIED` renders**)."* `tokens.json:141` and `HalalBadge.tsx:16,165` both exist to
  serve exactly this. The halal certificate row instead gets the same generic
  `StatusChip` as the business licence (82-98). The certificate that is the product's single
  claim is presented as one of four interchangeable PDFs.
- **P6.2 — Upload shows an indeterminate spinner, not byte progress.**
  `03-patterns.md:350`: *"Upload shows real byte progress, never an indeterminate spinner."*
  Line 117 uses `Button loading`. A 12MB scan of a halal certificate over a restaurant's Wi-Fi
  looks identical to a hung request.
- **P6.3 — The PUT failure is swallowed.** Lines 46-55 catch and ignore the object-store upload
  error with a dev-environment justification, relying on `/confirm` to detect it. In production a
  network drop mid-upload produces a confirm error attributed to the wrong step, and the
  operator's file selection is cleared (line 72) so they must find the file again.
  `03-patterns.md:352`: *"Upload failure → retained locally, retryable, **with the file name
  preserved**."*
- **P6.4 — `allSubmitted` treats "present" as "good enough"** (134-137): it accepts any state
  that is not `REJECTED`/`EXPIRED`, including `SUBMITTED` and `IN_REVIEW`. That is probably right
  for re-submission, but the Submit button carries no explanation of what is missing when it is
  disabled — and a disabled `Button` in this library stays focusable specifically so it can
  explain itself (`Button.tsx:25-27`). It explains nothing.
- **P6.5 — No expiry surface.** R-10 and `03-patterns.md:352` require a `Banner variant="warning"`
  at `[30, 14, 7, 1]` days before halal-certificate expiry, escalating, then a `danger` banner
  explaining `DELISTED` status and how to restore. `Banner` is never imported anywhere in this
  app. A restaurant's certificate silently expires, the listing goes dark (invariant 9's cool
  slate, correctly, on the admin side), and the operator's only clue is
  `ACCOUNT_STATE_LABEL.DELISTED` on the Settings screen (`SettingsPage.tsx:16`).
- **P6.6 — Document type labels are hard-coded in the client** (10-15). Fine today, but the
  rejection display (`ReviewStatus.tsx:25`) prints the raw enum `doc_type`, so a rejected
  document is announced to the owner as `HALAL_CERTIFICATE`.
- **P6.7 — `APPROVED` renders a neutral grey chip with a tick** (89-90). The comment (76-81)
  correctly reasons that it must not go solid green. But grey-with-a-tick is the same visual
  weight as `EXPIRED — reupload` (93-94), which is also neutral. The two states most different in
  consequence are the two hardest to tell apart.

### 1.7 `routes/onboarding/ReviewStatus.tsx` — onboarding step 3 (`AWAITING_REVIEW` / `FIX_DOCUMENTS`)

**Purpose.** Tell the owner they are waiting, or exactly what to fix.
**Renders.** Two branches. Rejected (9-36): a warning circle, "Documents need attention", review
cycle, one tinted block per flagged document with `review_note ?? rejection_reason_code`, and a
"Go to documents" button that calls `onRework` (= `reload`). Waiting (38-51): a clock circle,
"Documents in review", a 72-hour promise, and a review-cycle chip.

**Problems.**

- **P7.1 — "Go to documents" does not go to documents.** Line 31-33 calls `onRework`, which is
  `reload` (`OnboardingPage.tsx:68`). It refetches status. Since `current_step` is still
  `FIX_DOCUMENTS`, the server returns the same step and the user sees the same screen. The button
  labelled with a navigation verb performs a refresh. A restaurant whose halal certificate was
  rejected **cannot reach the upload form from this screen**.
- **P7.2 — Rejected documents use the warning ramp, not danger** (24-25:
  `border-feedback-warning-border bg-feedback-warning-tint`). Defensible as a deliberate
  softening, and correct in that it avoids red near a halal state — but the flagged document is
  frequently the *halal certificate*, and `#FEF1E7`/`#8F3A06` is also what the app uses for
  "overnight hours" (`HoursPage.tsx:186`) and "special instructions" (`OrdersPage.tsx:112`). Three
  unrelated meanings, one tint.
- **P7.3 — "within 72 hours" is a client-side promise with no source.** Line 45. R-08 does not
  state a 72-hour SLA to the restaurant (R-17's menu SLA is 4 business hours / 24 h backstop;
  R-04 states none for documents). `apps/marketing/AGENTS.md:20-25` establishes the house rule
  — *"if you cannot put a `source:` on it, it does not go on the page"* — and this is a
  commitment to a restaurant owner about their livelihood.
- **P7.4 — The waiting state gives the owner nothing to do.** Two paragraphs and a chip. Payouts
  (Stripe Connect) and the menu are both later steps that *could* be started in parallel from
  the owner's point of view even if the server enforces order (R-04 R4). At minimum the waiting
  screen should show the full checklist (P4.1) so the wait is legible.
- **P7.5 — `review_cycle` is shown as a bare number** ("Review cycle 2", lines 19 and 49) with no
  explanation. At `review_cycle ≥ 4` the server raises `excessive_resubmission` (R-04 R6); the
  owner has no idea the number matters.

### 1.8 `routes/onboarding/PassthroughStep.tsx` — onboarding steps 4 and 5 (`PAYOUT`, `MENU`)

**Purpose.** Hand off to Stripe Connect, or to the menu editor.
**Renders.** A generic title/description/CTA card (35-47) with a busy state and an inline error.

**Problems.**

- **P8.1 — The `MENU` step's CTA navigates away with no way back.** `OnboardingPage.tsx:86`
  navigates to `/menu`. `/menu` is inside `Shell`, which has no link to `/onboarding` in either
  navigation (`Shell.tsx:18-25`). The copy says *"then come back here"* (line 84) and the app
  provides no route to come back by, other than typing the URL. For a pre-activation restaurant
  this is the terminal step and it is a trapdoor.
- **P8.2 — The `PAYOUT` step discards the link it just minted.**
  `OnboardingPage.tsx:76-77` calls `POST /v1/connect/onboarding-link`, ignores the response, and
  calls `reload()`. The button is labelled "Continue to Stripe" and goes nowhere. This step
  cannot be completed from the UI.
- **P8.3 — The step carries no requirements.** Stripe Connect onboarding for a Canadian business
  needs a bank account, a business number and an ID. The card says *"Set up your payout account
  to start receiving orders"* and lists nothing, so the owner starts a third-party flow
  unprepared and abandons it.
- **P8.4 — One generic component for two unrelated steps** means neither gets the specific
  copy, requirements list, or `blocking_reason` it needs. This is where R-04's
  `blocking_reason` should be rendering (P4.2).

### 1.9 `routes/OrdersPage.tsx` + `DeadlineTimer` + `RejectDialog` + `SealBindRow` — the live queue ★

**Purpose.** R-23. The screen the business runs on.
**What the user is trying to do.** Notice a new order within 180 seconds, read it correctly, and
accept it — one-handed, mid-task, in a loud room, possibly on their first shift.

**Renders.** A single fetch on mount for `state=[RESTAURANT_PENDING, PREPARING, READY_FOR_PICKUP]`
(32-40); `PageLoading` centred spinner (45); `ErrorState` (46-52); `pending` sorted by
`deadline_at` (55) and `inKitchen` (56) rendered into **one** responsive grid,
`grid-cols-1 lg:grid-cols-2 xl:grid-cols-3` (102); a `Refresh` button (83-85). Pending cards
(104-139): code, `DeadlineTimer`, customer display name, delivery area, special instructions,
line items, "You earn", then `[Reject][Accept]`. In-kitchen cards (143-189): code, `StatusChip`,
name, "Ready by", lines, `Mark ready for pickup`, `SealBindRow`.

#### The brief's first question: is the deadline unmissable and honestly represented?

No, on both counts.

- **P9.1 — There is no realtime channel, so a new order does not appear at all.**
  `grep -rn "WebSocket|socket|subscribe|poll|EventSource" apps/restaurant/src` returns nothing.
  The only `setInterval` in the app is `DeadlineTimer.tsx:16`, which re-renders the clock on data
  already fetched. R-23 requires *"It loads via REST and then stays current via the SSE
  stream"*; the contract provides the channel (`contracts/websocket.md:149,242-248`:
  `restaurant:{restaurant_id}` carrying `restaurant.order_offered`, `order_offer_expired`,
  `order_offer_withdrawn`, `order_accepted` for multi-tablet fan-out, `order_rejected`,
  `status_changed`); `POST /v1/realtime/ticket` exists (`openapi.yaml:837`); and
  `@hg/api-client` already ships the typed envelopes, `channel` builders, `reconnectDelayMs`,
  `hasGap` and `SeenEventIds` (`packages/api-client/src/realtime.ts:34,202-248,465-480`).
  **None of it is wired.** An order placed at 19:03 becomes visible when a human presses
  Refresh. The 180-second window is spent waiting for a manual poll.
- **P9.2 — There is no heartbeat, so the restaurant will be offered nothing.**
  `POST /v1/restaurant/heartbeat` exists (`openapi.yaml:3346`) and R-22 D-09 specifies the web
  app POSTing it every 30 s, with `now() - last_heartbeat_at > 5 minutes` computing
  `open_state = CLOSED_OFFLINE` and **no orders offered**. The app never calls it. It does,
  however, ship the label for the state it will be permanently in:
  `HoursPage.tsx:19` — `CLOSED_OFFLINE: 'Offline — no recent heartbeat'`. Five minutes after
  opening, the tablet stops receiving orders while the availability toggle still reads as on.
- **P9.3 — No audible alert, and no sound gate.** R-24 R8: *"The audible alert repeats every 10 s
  until the order is resolved or expires; the browser tab title flashes. Sound requires a
  one-time user gesture to arm and **the UI blocks going "online" until sound is armed**."*
  `04-accessibility.md:238`: *"Audio alerts are **mandatory** and must survive autoplay policy…
  a silent queue is a broken queue, and this is an accessibility issue for deaf staff too, so the
  audible alert is always paired with a visual flash on the board and an OS-level
  notification."* `useOrderAlert` implements every clause of that — the arming gate, the repeat
  loop, the 1 Hz sub-photosensitivity flash, the once-per-condition OS notification, the blocked
  state (`useOrderAlert.ts:1-25,145-247`) — and is not imported. The Hours toggle
  (`HoursPage.tsx:73-83`) lets a restaurant go online with no sound armed.
- **P9.4 — The 180-second deadline is rendered at 11px.** `DeadlineTimer.tsx:36`:
  `text-label-sm` = `typography.label.sm` = **11px**, in a `rounded-full` pill with a 13px clock
  icon (line 44). `01-foundations.md:253` assigns `label.sm` to *"Badge and seal label… overline"*
  and `:260` sets it as the absolute floor. The single number that decides whether a paid order
  survives is set at the smallest type step in the system, on a device read at arm's length, by
  someone who is not looking for it.
- **P9.5 — The countdown is not server-anchored.** `DeadlineTimer.tsx:12,22`:
  `Date.now()` and `new Date(deadlineAt).getTime() - now`. `01-foundations.md:365` rule 1:
  *"Countdowns are linear and server-anchored. The 180 s restaurant response window (R-24) … animate
  `linear` from `server_expires_at − measured_skew`, **never from a local constant**."*
  Component 38's contract has **no `seconds` prop** and requires `serverNow`, with skew > 5 s
  switching to monotonic elapsed time (`02-components.md:555-567`). `@hg/ui-web` exports
  `measureSkewMs` and `remainingMs` (`feedback/internal.ts:84`, `feedback/index.ts:70-77`), both
  unused. A kitchen tablet whose clock is three minutes fast shows every order as already
  expired; three minutes slow shows 3:00 remaining on a dead order.
- **P9.6 — The urgency thresholds are wrong and the escalation is dishonest.**
  Lines 29-30: `urgent = remainingMs < 30_000`, `warn = remainingMs < 90_000`. Component 38
  specifies proportional thresholds — `urgent` at 25%, `critical` at 10% — which on a 180 s
  window are **45 s** and **18 s**. The app's `warn` fires at 50% (the halfway point of a normal
  order presented as a warning, so the warning is meaningless) and `urgent` at 16.7% (later than
  the spec's urgent, earlier than its critical). The three visual states also cover
  0–90 s identically for a 90 s-remaining order and a 31 s-remaining order.
- **P9.7 — Expiry does nothing.** `DeadlineTimer` renders the string `'Expired'` (line 27) and
  stops. There is no `onExpire`, no refetch, and no change to the card: the **Accept button
  remains live on an expired order**. Pressing it returns `409 offer_expired` (R-24 R2/AC1), which
  surfaces as the generic red bar at `OrdersPage.tsx:88-92`. Component 38's rule is that a
  past-`expires_at` item *"renders nothing and triggers a re-fetch rather than a negative
  countdown"*; `03-patterns.md:318` requires *"At expiry the modal closes itself and the order
  moves out of NEW — the restaurant is told what happened, not left with a dead dialog."*
- **P9.8 — The countdown is announced to nobody.** No `aria-live`, no `role`, no announcements.
  Component 38 requires *"explicit assertive announcements at 50%, 25%, 10% and 0"*, and
  `04-accessibility.md:206` lists "the remaining time is always visible **and always announced**"
  as what the platform owes in exchange for the WCAG 2.2.1 real-time exception. The only
  supplementary information is a `title` tooltip (line 42) — and `02-components.md:594` forbids a
  tooltip as *"the sole location of information required to complete a task"*.
- **P9.9 — The urgent state pulses a red box-shadow with no reduced-motion guard.**
  `styles.css:41-52` (`hg-pulse-ring`, 1.8 s infinite). `01-foundations.md:367` and
  `02-components.md:571` both require the critical pulse to be suppressed under
  `prefers-reduced-motion` while the numerals keep updating. There is no
  `@media (prefers-reduced-motion: reduce)` anywhere in `styles.css`, which also leaves
  `hg-fade-up` (35-37) and `hg-toggle-live` (66-68) unguarded.

#### The brief's second question: can a new staff member accept correctly, unprompted?

Partly. The card is legible and the two buttons are labelled with verbs. But:

- **P9.10 — There is no board, so state is not taught by structure.** R-23 requires four columns
  (New / Accepted / Preparing / Ready) plus a collapsed "Out for delivery" strip, and
  `tokens.json:420` records `breakpoint.lg` as where that happens.
  `OrdersPage.tsx:102` renders **one** grid into which `pending` and `inKitchen` are poured
  sequentially (103, 142), reaching at most three columns at `xl` (1280). On any narrow viewport
  a pending order and a ready order are adjacent cards distinguished only by whether the pill in
  the top-right is a countdown or a status chip. A new starter cannot learn the workflow from
  the layout because the layout does not encode it.
- **P9.11 — The empty state collapses the structure, which the spec forbids.** Lines 94-100
  render a centred `EmptyState`. `03-patterns.md:320`: *"the four columns persist with their
  headers (**the structure is the information**) … **Never** collapse the columns — a restaurant
  staring at a blank screen cannot tell "quiet" from "broken"."* Given P9.1 and P9.2, "broken" is
  the likely state, and this screen is designed to be indistinguishable from "quiet". The copy is
  otherwise good and honest (*"you'll have 180 seconds"*), and `tone="positive"` is right — but
  `emptyQueueDrained` (`feedback/EmptyState.tsx:159-170`) with `meta` (*"Last processed 14:02"*)
  exists precisely to separate the two and is unused.
- **P9.12 — Loading replaces the whole screen with a centred spinner.** Line 45. The spec's
  sibling rule (`03-patterns.md:322`, and `:367` for admin: *"**Never** a centred spinner
  replacing the table — that loses the header and the user's place"*) requires column headers and
  counts first, then two skeleton cards per column. `Skeleton` ships and is unused.
- **P9.13 — No `stale` state.** `OrderCard` has a `stale` prop documented *"Socket silent > 45 s.
  A stale queue must announce itself"* (`OrderCard.tsx:44`) and renders a "Not updating" word
  badge (`:88`). `Banner`'s highest-stakes documented use is the disconnect banner with
  `emphasis="prominent"`. Neither exists here. `03-patterns.md:325` calls it *"the
  highest-severity UI state on this surface"*.
- **P9.14 — `special_instructions` is rendered at 12px.** Lines 111-115: `text-caption`
  (`typography.caption` = 12px/400, with `font-semibold` applied) in a tinted box. R-23 R2 and
  `03-patterns.md:316` name it *"the highest-frequency source of order errors"* and require it
  *"verbatim, HTML-escaped, **prominent** … its own bordered block, not a metadata line."*
  `OrderCard.tsx:173-182` implements it at `body.md` (15px) with a border. Here the allergy note
  is smaller than the item names above it.
- **P9.15 — The customer's masked phone is never shown, before or after acceptance.** R-23 R1
  and `02-components.md:321` both require `customer_phone_masked`. `OrderCard.tsx:169-171` renders
  it. The app renders `display_name` only (109, 148). R-26 (rider communication) and any "the
  order is wrong" conversation are therefore impossible from the queue.
- **P9.16 — The delivery address is never shown after acceptance either.** Pending cards show
  `delivery_area` (110) — correct PII minimisation. In-kitchen cards (143-189) show **no location
  at all**, so the address that R-23 AC2 unlocks on acceptance, and that goes on the bag, is not
  in the UI.
- **P9.17 — `PICKED_UP` is labelled but never fetched.** Line 17 defines the label; line 36's
  query omits the state. R-23's "Out for delivery" strip is dead code.
- **P9.18 — No `late` flag.** R-23 R6 and `02-components.md:327` require a warning start-border
  and a "Late" badge on an order past `promised_ready_at` while `PREPARING`. The app renders
  `promised_ready_at` as a neutral 12px "Ready by 19:20" line (149-153) that looks identical
  whether that time is in the future or forty minutes past. An expeditor cannot see which order
  is running behind — which is the thing an expeditor is for.
- **P9.19 — Errors appear in a bar above the grid, far from the card that failed.** Lines 88-92.
  With up to nine cards on screen, a failed accept on card seven announces itself at the top of
  the page. `actionError` is also shared between accept, mark-ready and reject, so a second
  failure overwrites the first.
- **P9.20 — Money is hand-formatted and inconsistently tabular.** `money()` (27-29) with
  `Number(value)/100`; `data-hg-numeric="tabular"` is applied at 123 and 129 but
  `MenuPage.tsx:129` (same helper) omits it. `Price` is *"the only component in the system
  permitted to render money"* and takes branded `Cents` so lint L-5 is discharged by the type
  system. The comment at 20-26 documents a real openapi-fetch brand-erasure problem, so this is
  an honest workaround rather than carelessness — but the outcome is three divergent formatters
  (`OrdersPage.tsx:27`, `MenuPage.tsx:18`, `PayoutsPage.tsx:12`) and `.toFixed(`/`Math.round(… *
  100)` in the money path at `EditItemDialog.tsx:112,127,200-201` and `AddItemDialog.tsx:42`,
  which lint L-5 (`01-foundations.md:411`) names as a failure.

#### The brief's third question: is Reject too easy to hit by accident?

Yes.

- **P9.21 — Accept is 44px where the token set says 72.** `OrdersPage.tsx:135` uses default
  `size="md"` = `h-11` = 44px (`Button.tsx:49`). `target.criticalField` = 72 exists for this
  control and names it. Even `size="xl"` tops out at `h-15` = 60px (`Button.tsx:51`), so
  reaching 72 needs an explicit height — see §4.
- **P9.22 — Reject and Accept are the same size, the same shape, and 8px apart.**
  Line 131: `flex gap-2` (8px) with both children `fullWidth`. The rule appears in three
  independent places: `04-accessibility.md:75` (*"Destructive and constructive actions in a timed
  decision are **≥24 apart** … An accidental Decline under a 30-second clock is
  unrecoverable"*), `03-patterns.md:318` (*"Accept at `target.criticalField`, Reject separated by
  ≥24"*), and `OrderCard.tsx:114` in code (*"a destructive/constructive pair under a deadline is
  ≥24"*, implemented as `gap-6`). The app ships one third of the required separation.
- **P9.23 — Reject is first in reading and reaching order.** Line 132 places it at the start
  (left, LTR). On a propped tablet the near-side half-width button is the one a hand crossing
  the screen contacts first, and it is the irreversible one.
- **P9.24 — What does protect the operator, and what that protection costs.** `ConfirmDialog`
  will not confirm without a reason code — `blockedReason` blocks the submit with an explanatory
  message rather than a silent disable (`ConfirmDialog.tsx:114-121`), focus lands on Cancel
  (`:154-157`), and values survive a failure (`:95-101`). So a single stray tap does not void an
  authorisation. **But the countdown is not in the dialog.** `ConfirmDialog` has a `children`
  slot documented as *"Extra content — a `StatusTimeline`, a **`Countdown`**, an affected-record
  summary"* (`:62`); `RejectDialog.tsx:38-66` passes none. The moment an operator opens the
  reject dialog, the 180-second clock **disappears from the screen**, behind a focus-trapping
  `alertdialog` overlay that also hides every other card on the board. A stray tap does not cost
  the order directly; it costs the operator their view of the deadline and of the rest of the
  queue, with no sound running to tell them anything changed.
- **P9.25 — The 20-character note rule fires after the button press.**
  `RejectDialog.tsx:51-53` throws inside `onConfirm`. `ConfirmDialog` has `noteMinLength`
  (`:59`) which produces *"a live counter with an explanation, never a silently disabled
  button (A-15 R5)"*. It is not passed. The operator learns the rule by failing it. The reason
  the app hand-rolled it is real — the rule is conditional on `reasonCode === 'OTHER'` and
  `ConfirmDialog` owns `reasonCode` internally, so a caller cannot make `noteMinLength`
  conditional. That is a genuine frozen-library limitation, recorded in §5.
- **P9.26 — The dialog never closes itself on expiry** (`03-patterns.md:318`), so an expired
  order can be "rejected" into a 409.
- **P9.27 — `ITEM_UNAVAILABLE` does not offer to mark the item out of stock.** R-24 R6: such a
  rejection *"prompts (but does not force) the restaurant to mark the offending item out of
  stock, pre-filling R-18"*. The single most common reject reason leaves the cause in place, so
  the next customer orders the same missing dish.
- **P9.28 — The dialog's description states a platform fact, not a consequence.**
  Line 44: *"No refund object is created — the payment authorisation is voided outright."*
  True (invariant 5) and useful to an engineer. What a kitchen needs to read under time pressure
  is *"The customer is not charged and the order is cancelled. This cannot be undone."*

#### `SealBindRow` (lines 186-188, `components/SealBindRow.tsx`)

Correct on the invariants: tint not solid green (50-58), with a comment explaining why. Problems:
it appears on `PREPARING` **and** `READY_FOR_PICKUP` with no indication of which is expected; the
`Input` is `hideLabel` with a placeholder carrying the whole instruction (68), so the field's
purpose vanishes the moment a character is typed; success collapses the input irreversibly (50),
so a mis-scanned seal cannot be corrected from the queue; and the row is 44px of inline form
inside a 12px-padded card, competing with `Mark ready for pickup` for the same visual slot.

### 1.10 `routes/MenuPage.tsx` + `AddItemDialog` + `EditItemDialog` — menu and the claim gate ★

**Purpose.** R-14–R-20: categories, items, availability, and the R-17 review boundary.
**What the user is trying to do.** Take something off sale in ten seconds mid-service; and, more
rarely, change what an item claims.

**Renders.** Header with "Add item" (65-73); a 190px category rail (84-103); item `Card`s
(109-152) with name, up to five `StatusChip`s (114-126), description, price, an
availability word, a raw Radix `Switch` (135-142), and an edit `IconButton` (143-149).

**Problems — the halal/allergen consent failures are the important ones.**

- **P10.1 — `allergens_declared: true` is asserted on the operator's behalf, unasked.**
  `EditItemDialog.tsx:142`. The dialog has an "Allergens present" chip group (183-184) whose
  empty state is indistinguishable from "I checked and there are none", and the PATCH declares
  the operator's positive attestation regardless. This is exactly the failure mode the brief
  names — silence becoming consent — applied to a food-safety claim adjacent to the halal claim.
  R-17's rejection enum includes `MISSING_ALLERGEN` (`03-restaurant.md:1063`). An operator who
  opens the dialog to fix a typo in a description re-affirms the allergen declaration for an item
  they never inspected.
- **P10.2 — There is no "Submit for approval", so the DRAFT state is unrepresented.**
  R-17 (`03-restaurant.md:1070`) makes `DRAFT → PENDING_REVIEW` an explicit submit. The dialog's
  single "Save changes" (221-223) sends instant fields and reviewed fields in one PATCH
  (134-143). An operator cannot draft a description, and cannot tell — before pressing save —
  which of the nine fields in front of them will change the customer's screen in one second and
  which will sit in an admin queue.
- **P10.3 — The instant/reviewed split is explained only in body copy inside the modal.**
  `EditItemDialog.tsx:165-168` is the app's only statement of R-17 and it is good writing. But it
  is 13px prose above the fields rather than a property *of* the fields, it is invisible until
  the dialog is open, it is absent from `AddItemDialog` entirely, and nothing in the form marks
  which group a given field belongs to.
- **P10.4 — A rejected menu version is invisible.** The list reads `item.pending_version` only
  (121). There is no `REJECTED` branch anywhere in the app. R-17 R3 requires that *"The
  restaurant sees the code and note **verbatim**"*, and the enum's first-listed reasons are
  `MISLEADING_DESCRIPTION` and **`UNSUBSTANTIATED_HALAL_CLAIM`**. An admin rejecting a halal
  claim with a written explanation produces, in this app, the silent disappearance of the
  pending chip. The restaurant is never told, cannot correct it, and will re-submit the same
  words.
- **P10.5 — "Edit pending review" is a 11px warning pill among four identical pills.**
  Line 121, `StatusChip` at `text-label-sm` (11px) `rounded-full`, in the same row as "Blocked by
  admin", "Hidden", "Halal certified" and "2 variant groups" (114-126) — same shape, same size,
  same radius, four tones. `03-patterns.md:334` requires `Badge variant="info"` "Pending review"
  and that the item *"remain visible with their previous live values"*. The app renders one set
  of values with no indication of which are live and which are pending, and offers no
  before/after.
- **P10.6 — The reserved string "Halal certified" is rendered as a generic grey chip.**
  Line 120 renders `StatusChip tone="neutral">Halal certified<` from
  `item.dietary_tags.includes('HALAL_CERTIFIED')`. The reasoning in the comment (116-119) is
  sound — every listing on this platform is already certified, so an item-level green seal would
  be a second, redundant claim, and `Chip` deliberately has no halal tone. But the outcome is
  that the exact reserved label from C-12 R7 (`01-foundations.md:258`) appears without any part
  of the composite that RULE H-2 requires — no shield, no brass ring, no certifying body — sitting
  between "Hidden" and a variant-group count. If the words carry no weight here, they should not
  be these words; if they carry weight, they need the instrument. My recommendation in §4 is to
  drop the chip and state the guarantee once, at the top of the menu, with the real `HalalBadge`.
- **P10.7 — The availability failure path uses `window.alert()`.** `MenuPage.tsx:57`. A
  browser-modal dialog that blocks the entire tab — including the order queue, if it were live —
  until dismissed, on a touch device, mid-service. `03-patterns.md:334` requires the toggle to
  *"revert the switch and toast the reason"*. `ToastProvider` is mounted at `App.tsx:147` and no
  screen in the app ever raises a toast.
- **P10.8 — The availability toggle bypasses the frozen `Switch`.** Lines 135-142 use raw
  `@radix-ui/react-switch` with hand-written classes. `primitives/Switch.tsx:9-22` exists for
  *"item availability (R-18)"* and carries two guarantees this loses: a required
  `stateLabel: {on, off}` because *"State is never conveyed by thumb position alone"*, and a
  `loading` rule that **structurally cannot** move the thumb before the server confirms
  (*"THE LOADING RULE IS THE POINT"*). The hand-rolled version has the state word as an
  unassociated sibling `<span>` (132-134) and disables rather than holds during the write (137).
- **P10.9 — `BLOCKED` and `HIDDEN` disable the switch with no explanation at the control.**
  Line 137. The reason is a chip elsewhere in the card (114-115) and there is no
  `disabledReason`-style association. `Button.tsx:25-27` records the house rule: *"a disabled
  button must stay focusable so it can explain itself"*.
- **P10.10 — Editing is a centred modal, not the specified side sheet.** `03-patterns.md:334`
  requires *"an edit `Sheet variant="side"`"* so the item list stays visible. Both dialogs are
  `@radix-ui/react-dialog` centred overlays (`EditItemDialog.tsx:155-158`,
  `AddItemDialog.tsx:61-64`) that cover the list. `EditItemDialog` is also
  `max-h-[88vh] overflow-y-auto` with nine fields, two chip groups and a read-only variant block,
  so the Save button (221) is below the fold on a tablet.
- **P10.11 — `AddItemDialog` cannot set any claim-bearing field except name and description,**
  and does not mention review at all (no equivalent of `EditItemDialog.tsx:165-168`). R-17 R1
  requires an item's **first** version to be `APPROVED` before customers see it; nothing in the
  add flow says the item will not appear.
- **P10.12 — Raw Radix `Tabs` for the category mode switch.** `AddItemDialog.tsx:74-108` with
  hand-written pill classes, while `@hg/ui-web/navigation` exports `Tabs`.
- **P10.13 — The category rail is a fixed 190px with no responsive treatment**
  (`MenuPage.tsx:84`, `flex gap-6` at 83). Inside the 768px rail-plus-content layout of §0.3 that
  leaves roughly 270px for an item card containing a name, up to five chips, a description, a
  price, a state word, a switch and an icon button.
- **P10.14 — No search or filter.** A 120-item menu is a flat list per category with no way to
  find "chicken shawarma" during service. `FilterBar` ships in `@hg/ui-web/data`.
- **P10.15 — Price is rendered without tabular figures** (line 129), unlike the same helper's
  output on the Orders and Payouts screens. `01-foundations.md:227-231` makes tabular numerals
  non-negotiable for prices.

### 1.11 `routes/HoursPage.tsx` — availability and trading hours

**Purpose.** R-22 (the master switch) and R-06 (weekly hours, overrides).
**Renders.** Two independently-fetching cards in a `lg:grid-cols-[320px_1fr]` (212-215).
`AvailabilityCard` (29-97): a 44px power tile that glows when live (60-67), the `open_state`
label (69), `reason` at 12px (70), a raw Radix switch (73-83), a missed-offer chip (85-89).
`WeeklyHours` (99-201): seven rows of native `<input type="time">` (159-171), a Save button that
appears only when dirty (145-149), and read-only date overrides (181-193).

**Problems.**

- **P11.1 — The switch that takes the restaurant offline has no accessible label.**
  Lines 73-83: `Switch.Root` with only a `Switch.Thumb` inside — no `aria-label`, no
  `aria-labelledby`, no associated text. The `OPEN_STATE_LABEL` at line 69 is a sibling `<p>`.
  A screen-reader user reaches an unlabelled toggle whose activation stops all incoming revenue.
  `primitives/Switch.tsx` requires `label` and `stateLabel` and was built for *"restaurant
  accepting-orders (R-22)"*.
- **P11.2 — `resolvable_by` is dropped.** The contract carries
  `resolvable_by ∈ {RESTAURANT, ADMIN, TIME}` on `RestaurantAvailability`
  (`openapi.yaml:9677-9679`) and R-22 R6 requires it be exposed. A restaurant reading
  `CLOSED_SUSPENDED` (line 16 of `OPEN_STATE_LABEL`) cannot tell whether to wait, change a
  setting, or call support. This is the field that answers that, and it is fetched and thrown
  away.
- **P11.3 — The state that will actually be in force is unexplained.** `CLOSED_OFFLINE — 'Offline
  — no recent heartbeat'` (line 19) is what P9.2 guarantees. The copy names a mechanism the
  operator has never heard of and offers no action.
- **P11.4 — The missed-offer count is an 11px chip with no consequence stated.** Lines 85-89:
  `"{n} missed offer(s) recently"`. R-22 R4 and R-24 D-01: **two consecutive** expiries force
  `is_accepting_orders=false`. At one missed offer the restaurant is one order away from being
  switched off and the UI does not say so. R-22 AC3 also expects *"an email plus an in-app
  banner"* on that event; `Banner` is unused.
- **P11.5 — The toggle reads as the only control, while six of the seven `open_state` values
  ignore it.** The switch and the state label are visually coupled (one flex row, 58-84), so an
  operator whose state is `CLOSED_HOURS` will flip the switch and nothing will happen. The
  precedence chain (R-22: suspended → offline → toggle → paused → holiday → hours → open) is
  not represented.
- **P11.6 — No "pause for N minutes".** R-06 and R-22 both specify `pause_until`; the field is in
  the payload (`openapi.yaml:9664-9666`) and there is no control. Pausing for twenty minutes
  during a rush is the most common real-world need on this screen and the only option offered is
  going fully offline.
- **P11.7 — `crosses_midnight` is displayed but cannot be set.** Line 172 renders an "Overnight"
  chip; `updateDay` (113-122) hardcodes `crosses_midnight: false` on any newly-created interval
  (119). A restaurant open 17:00–01:00 cannot express it.
- **P11.8 — Closed days cannot be opened, and open days cannot be closed.**
  `updateDay` only fires from an existing interval's time inputs (162, 169), and a day with no
  interval renders the static word "Closed" (175) with no control. There is no add-day and no
  remove-day. A restaurant that submits hours missing Sunday can never add Sunday.
- **P11.9 — Native `<input type="time">` with hand-written classes** (159-171) instead of `Input`,
  so these fourteen controls sit outside the design system's field styling, focus ring, error
  handling and 44px floor (`py-1.5` + `text-body-sm` yields roughly 33px).
- **P11.10 — Unsaved changes can be navigated away from silently.** `local` state (103) holds the
  edit; the Save button only exists while `local` is set (145). Clicking any nav item discards
  it with no prompt.
- **P11.11 — Date overrides are read-only** (181-193) and are re-submitted unchanged on save
  (128). R-06's holiday overrides cannot be created or removed.
- **P11.12 — Two independent fetches, two independent loading states, two independent error
  states** (34-35, 105-106), each rendering `PageLoading` inside its own grid cell, so the page
  assembles in two jumps and a single failure leaves half a screen.

### 1.12 `routes/PayoutsPage.tsx` — weekly payouts

**Purpose.** R-31/R-32: payout history.
**Renders.** Header with a Refresh button (94-104), `EmptyState` (106-111), a table in a
`padding="0"` `Card` (113-148) with period, order count, amount (tabular, 132), state chip
(137), hold/failure reason (138-139), paid date; Newer/Older cursor buttons (151-160).

The 403-for-a-manager branch (65-78) is genuinely good design: it distinguishes a permission
boundary from a failure and explains it in plain language. The defensive fixture normalisation
(52-59) and the `meta` guard (87-90) are both documented bug fixes.

**Problems.**

- **P12.1 — The owner/manager branch misfires after every page reload.** `isOwner` (47) reads
  `principal.roles`, and `AuthProvider` sets `principal: null` when restoring a session from
  `localStorage` (`lib/auth.tsx:37-40`) — it only populates on a fresh login. So after any
  refresh `isOwner` is `false`, and an **owner** who hits any error on this page is told *"Your
  role (manager) can run the kitchen, but weekly payout history is restricted to the
  restaurant's owner account"*. The app asserts a fact about the user that it does not know, and
  gets it wrong in the common case.
- **P12.2 — `DataTable` is not used.** `@hg/ui-web/data` exports `DataTable` with grid keyboard
  navigation and `aria-sort` (`04-accessibility.md:239`), plus `Pagination` and `PiiCell`. This is
  a hand-written `<table>` (115-146) with no `scope` on the `<th>`s, no caption, no sort, and a
  hand-rolled cursor stack (41-42, 151-160).
- **P12.3 — No totals, no next-payout date, and no statement.** The header promises *"Weekly,
  every Monday, automatic"* (99) but the page never says when the next payout lands or how much
  is accrued. R-31/R-32 cover statements and next-payout; `03-patterns.md:287` (the rider
  analogue) requires *"Next payout date and amount pinned at top"*.
- **P12.4 — `HELD` maps to `warning` and `FAILED` to `danger`; `PAID` and `TRANSFERRED` map to
  `accent`** (33-37) — the same soft orange tint the app uses for "in review", "overnight hours",
  "role badge" and the active nav row. "Your money arrived" and "this document is in a queue"
  are the same colour.
- **P12.5 — Pagination buttons are always rendered once any cursor exists** (151) and rely on
  `disabled`, so a single-page history shows a disabled Newer/Older pair.
- **P12.6 — The table needs 560px minimum (115) and scrolls horizontally below that** — the
  precise failure mode `apps/marketing/AGENTS.md:46-52` was written about.

### 1.13 `routes/StaffPage.tsx` — team roster

**Purpose.** "Who can accept orders, edit the menu and adjust hours for this location" (131).
**Renders.** A hand-built warning banner disclosing that the roster is browser-local (134-140);
an invite form in a four-column grid (85-100); a table or `EmptyState` (145-187).

**The honesty here is right.** The header comment (7-21) documents that the contract has exactly
one staff-write endpoint (`POST /v1/admin/staff`, `SUPER_ADMIN`, platform-scoped), refuses to
invent one (AGENTS.md §6), and says so in the UI. That is the correct call.

**Problems.**

- **P13.1 — The screen is a navigation destination of equal weight to Orders.**
  `Shell.tsx:23` puts a non-functional local-storage demo in the primary rail, one row above
  Settings. It cannot create a sign-in, which is the only thing an operator would come here for.
  While the contract gap is open it belongs behind Settings, not in the rail.
- **P13.2 — The disclosure references a source file to a restaurant owner.** Line 138:
  *"see the note at the top of `StaffPage.tsx`"*, rendered in a `<code>` tag.
- **P13.3 — The banner is hand-built** (134-140) where `Banner variant="warning"` exists.
- **P13.4 — The roster is unscoped browser state.** `STORAGE_KEY = 'hg_restaurant_staff_roster_v1'`
  (22) is not keyed by restaurant or account, so two accounts on the same tablet share one
  roster.
- **P13.5 — Removal is a single unconfirmed `IconButton`** (173-179), with `ConfirmDialog`
  available. Harmless today because the data is fake; it will not be harmless when it is wired.
- **P13.6 — "Owner" is in `ROLE_LABEL` (35) but not in the role `Select` (92-95)**, so the
  roster can display a role it cannot produce.
- **P13.7 — The invite grid is `sm:grid-cols-[1fr_1fr_140px_auto]`** (85) — four controls plus a
  button on one row from 640px up, which at 640–780px gives each name field roughly 150px.

### 1.14 `routes/SettingsPage.tsx` — profile, account state, halal status

**Purpose.** R-12 post-activation profile edits, plus account and certification status.
**Renders.** `lg:grid-cols-[1fr_280px]` (260): a profile form (112-203) and a right column with
`HalalStatusCard` (206-235) and an onboarding-state card (264-267).

**The halal card is the best-reasoned code in this app.** `HalalStatusCard` (206-235) gets
invariant 8 exactly right: a missing `halal` object renders **no badge** and a neutral
explanatory card (213-220), never an optimistic one; the real `HalalBadge` with
`surface="operational"` is the only renderer of the halal namespace (224-230); the comment
(207-212) cites the rules it is honouring. This is the one place the product's single claim is
handled correctly.

**Problems.**

- **P14.1 — The halal card is 280px of right-column furniture.** Line 260 puts the single
  most important fact about this restaurant in a narrow sidebar below a 20-field form, at
  `label.md` heading size (216, 223 — 13px). `AGENTS.md:15`: *"The product's single claim
  is halal verification. Everything else is furniture around it."* The layout inverts that.
- **P14.2 — `HalalCertificationPanel` exists and is not used.** `@hg/ui-web/certification`
  exports it; `03-patterns.md` gives it the renewal-note row for `EXPIRING_SOON`
  (`01-foundations.md:179`). The card hand-assembles `certifying_body_name` (231) and
  `Expires {halal.expires_on}` (232) as two 12px lines below the badge instead, so the
  `EXPIRING_SOON` renewal note — the state that precedes a delisting — has no representation.
- **P14.3 — `expires_on` is printed raw.** Line 232: `Expires {halal.expires_on}`, a wire date.
  `01-foundations.md:14` requires *"absolute dates"* for the verification register, which this
  satisfies in the pedantic sense, but `2027-03-14` as body copy to a restaurant owner is a
  format, not a date.
- **P14.4 — `DELISTED` is presented as self-healing.** Line 16:
  `'Delisted — cause will clear automatically'`. For a delisting caused by an expired halal
  certificate, nothing clears automatically — the restaurant must upload a new certificate and be
  re-reviewed. This is the one wrong statement of fact I found in the app's copy, and it is
  about the halal claim.
- **P14.5 — Account state and commission are 11px/12px chips in the form header** (119-124),
  so `SUSPENDED` — which stops all revenue — is smaller than the "Display name" field label
  beneath it, and carries no `resolvable_by` and no remediation link.
- **P14.6 — The save confirmation is a 12px "Saved." that vanishes after 2.5 s** (199, 104).
  `ToastProvider` is mounted and unused.
- **P14.7 — No dirty-state protection** on a 20-field form. Navigating away discards silently.
- **P14.8 — Coordinates are carried forward unchanged** (94-96) with an honest comment. Combined
  with P5.1 this means the hardcoded downtown Toronto point is now permanent: there is no screen
  in the app that can ever correct a restaurant's location.
- **P14.9 — One submit for 16 fields, including `gst_hst_number`** (153-159), with no grouping
  and no per-field server error mapping — a 422 on the postal code surfaces as one red line
  above the buttons (189-191).
- **P14.10 — `onboarding_state` is rendered as a de-underscored enum** (266:
  `current.onboarding_state.replace(/_/g, ' ')`), so the card reads "MENU PENDING".

### 1.15 Cross-cutting

- **P0.1 — `font-extrabold` (800) appears 23 times across 10 files** (`DeadlineTimer.tsx:36`,
  `Shell.tsx:81`, `OrdersPage.tsx:80,106,127,145`, `MenuPage.tsx:67,129`, `HoursPage.tsx:69,142,207`,
  `PayoutsPage.tsx:96,132`, `SettingsPage.tsx:116,216,223,255,265`, `StaffPage.tsx:84,128`,
  `LoginPage.tsx:42`, `RegisterPage.tsx:36,53`, `OnboardingPage.tsx:46`, plus the four onboarding
  steps). The token set stops at `font.weight.bold = 700` (`tokens.json`), Plus Jakarta Sans ships
  **four static weights — 400/500/600/700** (`tokens.json:261`), and every `text-*` utility
  already carries its token weight (`theme.css:21,29,37,…`). So `font-extrabold` both overrides a
  token and asks for a weight that does not exist, leaving the browser to synthesise a fake bold.
  Every heading in this app is set in a weight the design system does not have.
- **P0.2 — Screen titles are `heading.md` (18px) everywhere**, where
  `01-foundations.md:244` assigns `heading.xl` (24) to "Screen title". Section headings are
  `label.lg`/`label.md` (15/13px, `HoursPage.tsx:142`, `SettingsPage.tsx:116,216`) rather than
  `heading.sm`/`heading.md`. The whole app is compressed one to two steps below the scale, which
  reads as density but is really loss of hierarchy — and it is what leaves the 180-second
  countdown at 11px with nothing above it to borrow scale from.
- **P0.3 — The colour scheme is pinned to light and the OS preference is overridden.**
  `App.tsx:86,98-105` sets `data-theme="light"` and `root.style.colorScheme = 'light'`
  permanently, overriding `index.html`'s own `content="light dark"`. `themes.restaurant.dark`
  exists and is complete (`themes.ts:702-760`), with `surface.chrome: #0A1913` — the value
  `tokens.json:34` labels *"Rider AppBar / restaurant queue header"*. `01-foundations.md:70` (D7):
  *"Full dark-mode parity across all four surfaces … restaurant tablets sit in dim pass-throughs.
  **Dark mode is an operational requirement, not a preference.**"* At 23:00 the app is a
  full-brightness `#FFFAEA` cream rectangle in a dim pass-through.
- **P0.4 — There is no session-expiry handling.** `createHgClient` accepts `onUnauthorized` and
  retries the request on recovery (`packages/api-client/src/client.ts:52-55,165-185`);
  `lib/api.ts:47-57` passes only `getToken` and `onError`, and its own comment (line 7) says
  *"`onUnauthorized` below is where that refresh would be wired in"* — it is not.
  `04-accessibility.md:210`: *"Session/auth expiry (15 min access token) is invisible: refresh
  rotates silently. A user is never dropped mid-form."* In this app, fifteen minutes after
  sign-in the queue's next fetch 401s and renders `ErrorState` with a Retry that will keep
  failing, mid-service, with no sign-in prompt.
- **P0.5 — No screen implements optimistic-free write feedback via the system's own
  channels.** `ToastProvider` and `TooltipProvider` are mounted (`App.tsx:146-150`) and neither
  is ever consumed. Every write result is a locally-styled inline `<p role="alert">` or, in one
  case, `window.alert()`.
- **P0.6 — No `prefers-reduced-motion` block in `styles.css`**, against three infinite or
  entrance animations (see P9.9).
- **P0.7 — Loading is a centred spinner on every screen** (`PageLoading`, used 9 times) where
  `Skeleton` ships and both `03-patterns.md:322` and `:367` forbid replacing the structure.

---

## 2. The five worst problems, ranked

### 1. The queue receives nothing, and will be offered nothing

*Evidence:* no realtime subscription anywhere in `apps/restaurant/src` (P9.1); no
`POST /v1/restaurant/heartbeat` (P9.2). `OrdersPage.tsx:32-40` fetches once on mount; the only
other path to fresh data is the `Refresh` button at line 83.

*Business cost:* **every order, structurally.** A new order becomes visible only if a human
presses Refresh inside the 180 s window (R-24 D-01), and there is nothing to prompt them to.
Compounding: five minutes after the tab opens, R-22 D-09's heartbeat gate computes
`CLOSED_OFFLINE` and the restaurant is **offered no orders at all**, while
`HoursPage.tsx`'s switch still reads as accepting. And two expiries force
`is_accepting_orders=false` (R-22 R4), so the first two orders a new restaurant misses take the
store offline until someone finds the toggle. The contract, the channel, the event payloads, the
reconnect helpers and the ticket endpoint all already exist
(`contracts/websocket.md:149,242-248`; `openapi.yaml:837,3346`;
`packages/api-client/src/realtime.ts`). This is the single change that decides whether the
product works.

### 2. There is no sound, and no gate that stops a silent queue going live

*Evidence:* P9.3. `useOrderAlert` (`packages/ui-web/src/feedback/useOrderAlert.ts`) implements the
arming gate, the repeating alert, the 1 Hz visual flash and the OS notification, is documented as
*"the never-miss-an-order affordance for the restaurant queue"*, and is imported by nothing.

*Business cost:* **missed orders, then an offline store, then a compliance flag.** In a loud
kitchen a silent visual change on a propped tablet is not a notification. R-24 R8 requires the
alert to repeat every 10 s and the tab title to flash; `04-accessibility.md:238` makes it
*mandatory* and notes it is also the accessibility path for deaf staff — which the missing flash
pairing breaks in the other direction too. R-24 R8's other clause, *"the UI blocks going
'online' until sound is armed"*, is the cheap structural fix: it makes a silent queue
unrepresentable rather than merely discouraged.

### 3. The deadline is 11px, unanchored to the server, wrong at the thresholds, silent to assistive tech, inert at expiry, and absent at the moment of decision

*Evidence:* P9.4 (`DeadlineTimer.tsx:36`, `text-label-sm` = 11px), P9.5 (`:12,22` local
`Date.now()`), P9.6 (`:29-30`, 30 s/90 s instead of 25%/10%), P9.7 (`:27`, no `onExpire`,
Accept stays live), P9.8 (no `aria-live`), P9.24 (`RejectDialog.tsx:38-66` passes no `children`,
so the clock leaves the screen).

*Business cost:* **voided authorisations and 409s presented as bugs.** Three failure paths, all
paid orders: staff do not see the clock (11px, no escalation that means anything); staff see a
clock that is wrong (device skew, which `measureSkewMs` exists to correct); staff press Accept on
an expired order and get a red bar they cannot act on. `01-foundations.md:365` states the
principle directly — *"Easing a deadline misrepresents remaining time"* — and a locally-timed,
11px, unannounced countdown misrepresents it in four ways at once.

### 4. Reject and Accept are the same target, 8px apart, with Reject nearest the hand

*Evidence:* P9.21 (`OrdersPage.tsx:135`, 44px where `target.criticalField` = 72 names this
control), P9.22 (`:131`, `gap-2` = 8px where three separate documents and the library's own
`OrderCard.tsx:114` require ≥24), P9.23 (`:132`, Reject at the start).

*Business cost:* **a paid order voided by a mis-tap, and a compliance flag for the restaurant.**
`04-accessibility.md:75`: *"An accidental Decline under a 30-second clock is unrecoverable."*
Under invariant 5 the authorisation is voided outright, so the customer is gone. And rejections
are counted: `reject_rate_7d` over 20% raises an admin compliance flag, over 40% queues a review
task (R-24 R5) — so accidental rejects accumulate into a regulatory-looking problem for a
restaurant that did nothing wrong. The reason-code requirement in `ConfirmDialog` means a single
tap does not complete a rejection, which is real protection; what the tap costs instead is the
operator's view of the deadline and of the whole board, with no sound running.

### 5. Claim-bearing menu fields assume consent, and admin rejections of halal claims are invisible

*Evidence:* P10.1 (`EditItemDialog.tsx:142`, `allergens_declared: true` sent unconditionally),
P10.4 (no `REJECTED` branch anywhere, against R-17 R3's *verbatim* requirement and an enum whose
reasons include `UNSUBSTANTIATED_HALAL_CLAIM` and `MISSING_ALLERGEN`), P10.2 (no
`DRAFT → PENDING_REVIEW` submit), P10.5 ("Edit pending review" as one of five identical 11px
pills, with no live-vs-pending distinction), P10.6 (the reserved string "Halal certified" as a
generic grey chip with none of RULE H-2's composite).

*Business cost:* **a wrong halal or allergen claim reaching a customer, and a restaurant unable to
correct one.** This is the only failure on the list that the product cannot absorb:
`AGENTS.md:15` — *"The product's single claim is halal verification… If the seal, the
certification panel and the seven-check verification instrument are wrong, nothing else
matters."* Two concrete paths. First, an operator opens Edit to fix a typo and the app re-asserts
their allergen declaration for an item they never inspected — silence becoming consent, on a
food-safety claim. Second, an admin rejects a description with `UNSUBSTANTIATED_HALAL_CLAIM` and
a written note; in this app that produces the silent disappearance of a pending chip, the
restaurant is never told why, and the same words are resubmitted. The `HalalStatusCard`
(`SettingsPage.tsx:206-235`) shows this team knows how to do this properly — the menu surface
simply never got the same attention.

---

## 3. Redesign direction

### The operating context, stated as constraints

A restaurant runs this on a tablet propped at a pass-through, or a cheap laptop on a shelf, in a
room that is hot, loud, and where both hands are usually holding something. Staff turnover is
high, so whoever is nearest the screen may be on their first shift. Two states matter and
everything else is secondary: **an order is waiting**, and **an order is running late**. Every
other job on this app — menu, hours, payouts, profile — is a desk task done at 15:30 between
services, by one person, sitting down.

That split is the whole design. The current app does not make it. It renders six equal
destinations, one visual density, one type scale and one interaction model across both jobs, and
the result is that the service-critical screen inherits the density of an admin panel.

### Seven directional decisions

**D1 — The board is the screen, and its structure never collapses.**
Three columns from the contract's real states — **New** (`RESTAURANT_PENDING`) · **Preparing**
(`PREPARING`) · **Ready** (`READY_FOR_PICKUP`) — plus a collapsed out-for-delivery strip
(`PICKED_UP`), at one breakpoint. Headers with counts render before the data and persist through
empty, loading and error, because *the structure is the information* (`03-patterns.md:320`) and
because it is the only way a restaurant can tell "quiet" from "broken" — which, given problem 1,
is the distinction this screen most needs to support. A new starter learns the workflow by
watching cards move left to right; nobody has to explain it. (Note: `03-patterns.md:303` and
`tokens.json:420` say four columns including `ACCEPTED`. The contract has no `ACCEPTED` state
(`openapi.yaml:6310-6324`), and the contract wins — see §5.)

**D2 — Arriving is louder than anything else on the screen.**
An order arrives on the socket, lands in New, sounds a repeating alert, flashes the board, raises
an OS notification, and — the part that actually changes behaviour — **the Orders rail item
carries the count from every other screen**. The manager fixing hours sees "Orders, 2 waiting"
without leaving the form. `useOrderAlert` and `SideNavItem.badge` already do all of this; the
work is wiring, not invention.

**D3 — The sound gate is a precondition, not a preference.**
R-24 R8 already says the UI blocks going online until sound is armed. Make that literal: the
board renders behind a single blocking gate until `arm()` succeeds, and a persistent indicator in
the chrome states that sound is on. This is the same move as the design system's own preference
for unrepresentability over testing (`AGENTS.md:83`): a silent queue should be a state the UI
cannot reach.

**D4 — The countdown is the largest thing on a New card, and it is the server's clock.**
`display.md` (30px/700) with tabular figures on the card, `display.lg` (36px) in the accept
surface — both existing type steps. Anchored to `expires_at` from `restaurant.order_offered` and
`server_time` from the `hello` frame, through `measureSkewMs`/`remainingMs`. Proportional
escalation at 25% and 10%. Assertive announcements at 50/25/10/0. At zero: the card leaves New,
the board refetches, and the operator is **told what happened** — *"Response window closed. The
customer was not charged."* Never presented as their fault (`04-accessibility.md:209`).
The escalation stays honest because the numeral itself is the information; colour only
reinforces it.

**D5 — Accept is a big target at the far edge; Reject is small, secondary, and far away.**
Accept at 72 (`target.criticalField`), full width, at the bottom edge of the card where a hand
lands. Reject as a `tertiary` or `ghost` button at a different size, on the opposite side,
**≥24 away**. Asymmetry is the affordance: a new starter should be able to tell which button is
the normal one without reading either. And the reject dialog carries the running countdown in
`ConfirmDialog`'s `children` slot, so the clock never leaves the screen during the one decision
that is irreversible.

**D6 — Two densities, one app.** The board and the accept surface run *above* `compact` — 72px
targets, `display` numerals, 15px body — because they are read at arm's length by someone not
looking for them. Menu, Hours, Payouts, Staff and Settings run `compact` as specified, because
they are read at 40cm by someone who came here on purpose. `compact` is the correct token for
this theme (`themes.ts:25`); what is wrong today is that it was applied to the one screen the
token's own description exempts by implication — *"a kitchen tablet read at arm's length"*
(`styles.css:15`) is an argument for larger, not smaller.

**D7 — Every claim-bearing field states its own consequence, at the field.**
Not a paragraph at the top of a modal (`EditItemDialog.tsx:165-168`). Price and prep time carry
*"Live immediately."* Name, description, ingredients, dietary tags and allergens sit in a bounded
group headed *"Customers see these only after review"*, with an explicit **Submit for approval**
action, and allergens require a positive act — either "these allergens are present" or "I have
checked: none" — before `allergens_declared` is sent. A rejection returns the admin's reason code
and note **verbatim**, on the item, in the list, until the restaurant acts on it. The rule this
enforces is the product's own: silence is never consent on a claim.

### One breakpoint

Adopt the marketing app's decision (`apps/marketing/AGENTS.md:46-52`): **one switch, at `lg`
(1024px)**. Below it — phone and every tablet in portrait — no rail, a bottom bar, one column,
full-width cards. At and above it — landscape tablet, laptop, wall display — rail plus columns.
The 768–1023px band that currently yields a 256px rail beside a 480px column disappears. This is
the same reasoning that removed `md` from marketing, applied to the app most likely to be a
tablet.

---

## 4. Screen-by-screen redesign brief

Everything below uses components and tokens that already exist. Where a size is not in the
component's prop set (the 72px Accept), the brief says so explicitly and uses a value that is
already a token.

### 4.1 `Shell`

Fill the slots `AppShell` already has.

- `topBar`: `TopBar` carrying the restaurant name, the `open_state` word, the sound-armed
  indicator, and the connection state. Never scroll-hidden (`AppShell.tsx:20-23`).
- `systemBanner`: reserved for, in precedence order — (1) `Banner variant="danger"
  emphasis="prominent"` not dismissible, *"Not receiving new orders — reconnecting"*, keyed by
  `conditionKey`; (2) `variant="warning"` halal-certificate expiry at [30, 14, 7, 1] days
  (R-10); (3) `variant="warning"` auto-offline after missed offers (R-22 AC3).
- `pageHeader`: the board's column headers on `/orders`, so they survive the scroll region.
- `routeKey` / `routeAnnouncement` / `skipTargets`: pass all three. `skipTargets`
  `[{id: 'order-board', label: 'Skip to order board'}]`.
- `SideNav`: `badge` + `badgeNoun` on Orders (*"Orders, 2 waiting"*) and on Menu when a version
  is rejected. `collapsed` + `onToggleCollapsed`, persisted per device, so 256px is reclaimable.
- Move Staff behind Settings until the contract has a restaurant-scoped staff endpoint (P13.1);
  the rail then holds five items and the bottom bar can hold all five.
- Replace the hand-rolled sign-out (`Shell.tsx:91-98`) with `Button variant="ghost"` behind a
  `ConfirmDialog` (*"Sign out of this tablet?"*).
- Restore `prefers-color-scheme`: drop the hard `SCHEME = 'light'` at `App.tsx:86` and let
  `themes.restaurant.dark` do its job.

**Visible without scrolling:** restaurant name, `open_state` word, sound indicator, connection
state, the five destinations with the Orders count.

### 4.2 `/orders` — the board ★

**Frame.** `AppShell` → `pageHeader` = three sticky column headers with live counts → a
three-column region at `lg`, one column below it, plus a collapsed out-for-delivery strip.
Columns never collapse: in empty, loading and error the headers and counts stay.

**Gate.** Before the board is usable, one `EmptyState variant="page"` (or a `ConfirmDialog` with
no cancel) with a single `Button size="xl"` — *"Turn on order sound"* — driving
`useOrderAlert().arm()`. On `soundState === 'blocked'`, `Banner variant="danger"
emphasis="prominent"` with `lastError` and a retry. The board does not render until armed.

**New card** (new local composition or `OrderCard variant="restaurant"` with slots filled):

1. **Countdown first and largest** — `display.md` (30/700) tabular, top of the card, full width,
   with the word beside it (*"2:14 left"*), escalating at 25% and 10%. A local component, because
   `@hg/ui-web` ships no `Countdown` (§5), built to component 38's contract: `expiresAt` +
   `serverNow`, `measureSkewMs`/`remainingMs` from `@hg/ui-web`, `easing.linear`, `onExpire`
   → remove + refetch, `aria-live` announcements at 50/25/10/0, pulse suppressed under
   `prefers-reduced-motion`.
2. Order code in `mono.md` (`typography.mono.md` — `01-foundations.md:209` reserves identifiers
   that must not be misread for the mono face; `heading.md` for scale).
3. Customer first name + last initial, **`customer.phone_masked`** (R-23 R1).
4. `special_instructions` at **`body.md` (15px)** in its own bordered `feedback-warning-tint`
   block, never truncated — as `OrderCard.tsx:173-182` already does it.
5. Line items at `body.md`, quantity first, with `Price size="sm"`.
6. `Price` for `restaurant_net_cents`, labelled *"You earn"*.
7. `delivery_area` only.
8. **Actions, bottom edge:** `Button` Accept — `size="xl"` plus `className="h-18"` (72px =
   `target.criticalField`; `Button`'s largest size is `h-15`/60, so the token value needs an
   explicit height, and `h-18` resolves through Tailwind's existing 4px base unit, adding no new
   spacing token). Reject as `variant="tertiary" size="md"`, **separated by `gap-6` (24px)**, on
   the opposite side, visibly smaller.

**Preparing card.** `promised_ready_at` as a countdown-to-ready; past it, `OrderCard`'s `late`
treatment — warning start-border **and** the word "Late" (`OrderCard.tsx:79,87`). Delivery
address now shown (R-23 AC2). `Mark ready for pickup` as `Button variant="secondary"` (forest
`#1B3B31`). `SealBindRow` with a visible `Input` label and a "Re-scan" affordance after success.

**Ready card.** Rider name and ETA when `dispatch.assigned` has arrived; otherwise *"Waiting for
a rider"* stated as a fact.

**Reject dialog.** `ConfirmDialog destructive` with: `children` = **the live countdown**;
`description` = consequence, not mechanism (*"The customer is not charged and the order is
cancelled. This cannot be undone."*); `reasonCodes` unchanged; auto-close and refetch on expiry;
and on `ITEM_UNAVAILABLE`, a follow-on prompt to mark the item out of stock (R-24 R6).

**Empty.** Headers and counts persist. One centred line inside the board area via
`emptyQueueDrained('Order queue', lastEventAt)` with `meta` showing the last event time — so
"quiet" and "broken" are different screens.

**Loading.** Headers and counts immediately, then two `Skeleton` cards per column. No centred
spinner.

**Error.** `ErrorState` inside the board region with the headers retained; the
disconnect/reconnect condition goes to `systemBanner`, not here.

**Visible without scrolling on a 1024×768 landscape tablet:** three column headers with counts,
the sound indicator, the connection state, and the whole of the oldest New card including its
countdown and both buttons.

### 4.3 `/menu`

- `FilterBar` above the list (search by name, filter by availability and review state).
- Category rail: `SideNav`-style list or `Tabs` below `lg`, not a fixed 190px column.
- Item rows: `Card` with the name at `heading.sm`, `Price`, the availability `Switch`
  (the **frozen primitive**, with `stateLabel={{on:'Available', off:'Out of stock'}}` and
  `loading` while the server confirms), and `disabledReason` surfaced for `BLOCKED`/`HIDDEN`.
- **Review state gets a dedicated column, not a pill in a row of pills.** Three explicit states,
  each with the live and pending values side by side where they differ:
  `Chip variant="static" tone="warning"` "Pending review" · a `Banner variant="danger"` **inside
  the row** for a rejected version, carrying the reason code and the admin's note **verbatim**
  and a "Edit and resubmit" action (R-17 R3) · nothing at all when the live version is current.
- Drop the per-item "Halal certified" chip (P10.6). State the guarantee **once**, in the page
  header, with the real `HalalBadge surface="operational"` reading the restaurant's
  `halal_display_state` — the composite, not the words alone.
- Edit moves to `AppShell`'s `aside` region (a side sheet) so the list stays visible
  (`03-patterns.md:334`), with two labelled groups:
  **"Live immediately"** — price, prep time, availability, category.
  **"Customers see these only after review"** — name, description, ingredients, dietary tags,
  allergens — with its own **Submit for approval** button, and allergens gated behind an explicit
  `Checkbox`: *"I have checked this item's allergens"* / or a positive "None present" option.
  `allergens_declared` is sent only from that act.
- Availability failure: revert the `Switch` and raise a `Toast` with the reason
  (`03-patterns.md:334`). Remove `window.alert()`.
- Replace raw Radix `Tabs` with `@hg/ui-web`'s `Tabs`.

**Visible without scrolling:** the halal status line, search, the category list, and the first
four item rows with their availability switches and review states.

### 4.4 `/hours`

- One `Card`, not two independently-loading ones. `Switch` (frozen primitive) with
  `label="Accepting orders"`, `stateLabel={{on:'Accepting orders', off:'Not accepting orders'}}`,
  `loading` during the write.
- `open_state` at `heading.sm` with `reason` at `body.md` and **`resolvable_by`** rendered as the
  next action: *"You can fix this"* / *"Contact support"* / *"This clears at 11:00"*.
- The precedence chain shown as a short `StatusTimeline` or an ordered list, so an operator can
  see that `CLOSED_HOURS` will not be fixed by the toggle.
- **Add a pause control** — `Select` of 15/30/60 minutes writing `pause_until` — the most common
  real need on this screen.
- `missed_order_count` promoted from an 11px chip to a `Banner variant="warning"` stating the
  consequence: *"One more missed order and we will stop sending you orders until you turn them
  back on."*
- Weekly hours: `Input` (not bare `<input type="time">`), a per-day open/closed `Switch`, an
  overnight `Checkbox` writing `crosses_midnight`, editable date overrides, and a sticky save bar
  with a dirty-state guard.

**Visible without scrolling:** the open state, its reason and its resolver, the accepting-orders
switch with its state word, the pause control, and today's hours.

### 4.5 Onboarding (all four steps)

**Frame.** Replace the bar and the client step counter with `StatusTimeline
variant="horizontal"` driven by the server's `onboarding_state` (`03-patterns.md:346`), and
render **`steps_completed` as a persistent six-item checklist** beside it — this is the fix for
the brief's fourth question. `progress_percent` stays as the server's number, not a derived
count.

**Every step, at the top of its card, renders `blocking_reason` verbatim** — *"What is stopping
you going live"* — so R-04 AC4's `no_live_menu_item` reaches the person who can act on it.
`Banner variant="info"` when informational, `warning` when the restaurant must act.

- **Step 1, Profile.** Two groups (business identity; location and service). **Add a cuisine
  `Select` (1–5, R-05 R9)** and **a location control** — at minimum two `Input`s for latitude and
  longitude with the Canadian bounding box validated client-side, and the postal-code-centroid
  warning shown to the operator rather than only to the admin. The hardcoded Toronto point
  (`ProfileStep.tsx:39-42`) must go: it is the geographic anchor dispatch and discovery both
  read, and no other screen can correct it. Bound `avg_prep_minutes` to 5–120. Province options
  get names. Autosave per group.
- **Step 2, Documents.** `StatusTimeline` for the pack, one row per document, with the halal
  certificate row carrying **`HalalBadge surface="operational"`** — including `UNVERIFIED`,
  because this is the one surface where it renders (`03-patterns.md:346`). Real byte progress on
  upload. Preserve the file name on failure and offer retry. Disabled "Submit for review"
  explains which documents are outstanding (`Button` keeps focus specifically so it can).
- **Step 3, Review status.** Fix the navigation: *"Go to documents"* must route to the documents
  step, not `reload()`. Rejected documents use their human labels, not raw enums, and show the
  admin's note verbatim. The waiting state shows the full checklist and what comes next; drop the
  unsourced "72 hours" or give it a source (`apps/marketing/AGENTS.md:20-25`).
- **Steps 4 and 5, Payout and Menu.** Split `PassthroughStep` into two purpose-built steps.
  Payout: list what Stripe will ask for, and **follow the minted onboarding link**. Menu: render
  `blocking_reason`, and provide a return route — either keep the menu editor inside the
  onboarding frame, or add a persistent "Back to setup" in `topBar` while
  `onboarding_state !== 'ACTIVE'`.
- Add `WITHDRAWN` behind a `ConfirmDialog` (R-04).

**Visible without scrolling, on every step:** the timeline, the six-item checklist with ticks,
the blocking reason, and the current step's first action.

### 4.6 `/payouts`, `/staff`, `/settings`

- **Payouts.** `DataTable` with `aria-sort` and grid keyboard navigation, `Pagination`, `Price`
  for every amount. Pin next-payout date and amount above the table. Fix the owner/manager
  branch by resolving `principal` on session restore rather than asserting a role the app does
  not know (P12.1). `PAID` should not share the "in progress" tint with `TRANSFERRING`.
- **Staff.** Move behind Settings. `Banner variant="warning"` for the contract-gap disclosure,
  written for a restaurant owner (no file names, no `<code>`). Key storage per restaurant.
  `ConfirmDialog` on remove.
- **Settings.** Invert the layout: **`HalalCertificationPanel` at the top, full width**, carrying
  the seal, the certifying body, the absolute expiry date and the `EXPIRING_SOON` renewal note.
  Account state at `heading.sm` with `resolvable_by` and a remediation action; fix the false
  *"cause will clear automatically"* on `DELISTED`. Group the 16 profile fields with per-group
  save, a `Toast` on success, and a dirty-state guard. Map 422 field errors onto their fields.
  Human labels for `onboarding_state`.

### 4.7 Cross-cutting

- Remove all 23 `font-extrabold`; let each `text-*` utility carry its token weight.
- Screen titles to `heading.xl` (24), section headings to `heading.md`/`heading.sm`.
- Replace `PageLoading` with `Skeleton` in the real geometry on every screen.
- Wire `onUnauthorized` in `lib/api.ts` so a 15-minute token rotates silently.
- Consume the mounted `ToastProvider`; delete `window.alert()`.
- Add a `@media (prefers-reduced-motion: reduce)` block to `styles.css` covering `hg-fade-up`,
  `hg-pulse` and `hg-toggle-live`, keeping the countdown numerals live.
- Use `surface-chrome` (`#1B3B31`) for the `topBar` so the app reads as the operational register
  it declares.
- One breakpoint: `lg`. Remove `sm:` and `md:` variants from the layout.

---

## 5. What I could not determine, and what I would need

1. **Whether claim-bearing menu fields auto-approve.** R-17's **D-22** is still
   `DECISION REQUIRED` and proposes a 24-hour auto-approve backstop with post-hoc audit — the
   opposite of the brief's premise (§0.4). It is not in `docs/decisions/README.md`. The UI copy
   differs materially between the two answers: *"Under review — customers see the current version
   until an admin approves this"* versus *"…and will go live automatically after 24 hours if not
   reviewed"*. **Need:** D-22 closed, in `docs/decisions/`. My recommendation is that a field
   whose rejection reason can be `UNSUBSTANTIATED_HALAL_CLAIM` should not auto-approve, and that
   D-22's liveness argument is better served by an SLA alarm than by a backstop.

2. **How many columns the board has.** `03-patterns.md:303` and `tokens.json:420` both say four
   (New / Accepted / Preparing / Ready); the contract's `OrderState`
   (`openapi.yaml:6310-6324`) has no `ACCEPTED`, so accept moves `RESTAURANT_PENDING → PREPARING`.
   Under `AGENTS.md:80` the contract wins and the answer is three plus the out-for-delivery
   strip, which is what §4.2 briefs. **Need:** `03-patterns.md` and the `breakpoint.lg`
   description corrected, or an `ACCEPTED` state added to the contract.

3. **Where the countdown component lives.** `Countdown` is component 38
   (`02-components.md:555-571`) with a precise contract, and `@hg/ui-web` does not export it —
   only `measureSkewMs`/`remainingMs`. The library is frozen. **Need:** a decision — add
   `Countdown` to `@hg/ui-web` (it is specified, and the rider app will need the same thing), or
   accept a local composition in each app. §4.2 assumes the latter and holds it to component
   38's contract.

4. **The conditional note minimum on reject.** `ConfirmDialog.noteMinLength` is static and the
   component owns `reasonCode` internally, so a caller cannot require 20 characters only for
   `OTHER` (P9.25). **Need:** either a frozen-library change (expose `onReasonChange`, or accept
   `noteMinLength` as a function of the reason) or a product decision to require a note on every
   rejection. The status quo — validating after the button press — is the one option that should
   not survive.

5. **Whether SSE or WebSocket is the transport.** R-09/R-23 say SSE throughout;
   `AGENTS.md:20` and `contracts/websocket.md` specify a WebSocket at `/v1/ws` with
   `POST /v1/realtime/ticket`. The contract wins, but `03-restaurant.md` still reads SSE in six
   places and the patterns doc's error states are written as *"SSE disconnect"*.
   **Need:** the spec reconciled, so the reconnect/refetch/dedupe behaviour is specified against
   the transport that exists.

6. **The real deployment device.** `01-foundations.md:454` flags this as an open question to the
   client: *"`compact` assumes a 10" tablet at arm's length in a kitchen. If the deployment is a
   phone, the queue needs `comfortable` and a two-column layout instead of four."* Everything in
   §3 and §4.2 assumes a 10" tablet, mostly landscape, mains-powered, one per kitchen.
   **Need:** the answer, plus whether multiple tablets run simultaneously — the contract's
   `restaurant.order_accepted` event exists *"fan-out to the restaurant's other tablets"*
   (`websocket.md:245`), which implies yes and implies the board must handle an order being
   accepted elsewhere while it is open in front of someone.

7. **The document review SLA quoted to restaurants.** `ReviewStatus.tsx:45` promises 72 hours
   with no source in R-08 or R-04 (P7.3). **Need:** the real SLA, or the claim removed.

8. **The geocoding decision.** R-05 R10 makes the map pin authoritative and explicitly excludes
   autocomplete/reverse geocoding from scope, but specifies no fallback for an app without a map.
   `ProfileStep.tsx:39-42` chose a hardcoded constant, which is worse than asking. **Need:** a
   decision on the V1 location control — lat/lng inputs, a `react-map-gl` dependency, or
   server-side geocoding — before this screen ships, because no other screen can correct the
   value afterwards.

9. **Things I did not audit.** I did not run the app (no browser in this session), so every
   layout claim is read from the source and the token values rather than measured; I did not
   verify the 12 contrast pairs that would result from the type/weight changes in §4 (`L-6` and
   `contrast.check.mjs` would); and I did not review the Go backend's realtime implementation, so
   I cannot say whether `restaurant:{restaurant_id}` is served today —
   `AGENTS.md:90` says the seven domain modules are not started, which suggests it is not, and
   which makes the wiring in §4.2 a design commitment rather than an immediate task.
