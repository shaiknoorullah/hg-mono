# Rider app — design audit and redesign brief

**Status:** audit · **Date:** 2026-09-27 · **Scope:** `apps/rider/` as committed
**Auditor's remit:** design only. No code was changed.
**Read against:** `AGENTS.md` · `docs/design/01-foundations.md` · `02-components.md` · `03-patterns.md` §2 · `04-accessibility.md` · `docs/design/tokens.json` · `docs/spec/04-rider.md` · `contracts/openapi.yaml` · `contracts/websocket.md` · `docs/decisions/palette-and-invariant-10.md`

---

## 0. The numbers this audit measures against

These are quoted, not invented. Where `tokens.json` and the prose docs disagree, `tokens.json` wins (`01-foundations.md` header).

| Thing | Value | Source |
|---|---:|---|
| `target.min` — absolute floor, every surface | **44** | `docs/design/tokens.json:396` |
| `target.field` — **every control in the rider app** | **56** | `tokens.json:397` ("gloved thumb, one-handed") |
| `target.criticalField` — **irreversible actions under time pressure** (rider Accept/Decline) | **72** | `tokens.json:398` |
| `target.spacing` — minimum gap between adjacent targets | **8** | `tokens.json:399` |
| Destructive/constructive separation in a timed decision | **≥24** | `04-accessibility.md:75`; `02-components.md:337`; `03-patterns.md:220`. (The `Button` entry at `02-components.md:51` says "within 16" — an outlier against three statements of 24. This audit uses **24**.) |
| `density.roomy` (rider) — rowHeight / cardPadding / gutter | **72 / 20 / 20** | `tokens.json:327` |
| Rider body-text contrast | **≥7:1 (AAA)** | `04-accessibility.md:26`, `:237`; `tokens.json:470` |
| Countdown easing | **`linear` only** — "easing a deadline misrepresents remaining time" | `tokens.json:369`; `01-foundations.md` §7.4.1 |
| `zIndex.offerSheet` | **700** — above toast 600, modal 500, sheet 400, appBar/bottomNav 200 | `tokens.json:402–412` |
| Offer sheet dismissibility | **non-dismissible until server `expires_at`** | `tokens.json:412`; `03-patterns.md:205`; spec D-14 |

**The theme resolves these correctly.** `theme="rider"` gives `target.min: 56`, `target.critical: 72`, `densityMode: 'roomy'`, `register: 'field'` (`packages/ui-native/src/tokens/generated/themes.ts:1425–1441`). The rider type scale also bumps `body.md` → 17 and `label.md` → 15 at the theme root — but **`caption` stays 12 / weight 400** and does not get the field bump. That matters below.

**The frozen library already ships what this app needs and does not use.** `Sheet variant="full" dismissible={false}` exists and swallows hardware back (`packages/ui-native/src/navigation/Sheet.tsx:4–10, 39–63, 121–130`), routes to `zIndex.offerSheet`. `Button` has a `critical` prop that resolves `theme.target.critical` = 72 (`primitives/Button.tsx:55–58, 114`). `MapView` exists with rider/restaurant/customer pins, route, `stale`/`degraded`/`permission-denied`/`error` states and a required text `summary` (`feedback/MapView.tsx:1–85`). `StatusTimeline`, `Chip`, `IconButton`, `Skeleton`, `Toast`, `Modal`, `OrderCard variant="rider"` all exist. **None of them appear anywhere in `apps/rider/`.**

**A note on how targets are measured in this audit.** `Button` renders its size token's height and then pads the hit area to `theme.target.min` with `hitSlop` (`primitives/Button.tsx:186`; `internal/interaction.tsx:77–80`, `pad = ceil((target − visual) / 2)`). So a `size="md"` button in the rider theme is **44 visible, 56 touchable**, and `04-accessibility.md:73` explicitly sanctions that: "If the visual is smaller than the target, the hit area is expanded… the *hit area* grows." Where this audit says a control is below the rider floor, it means **visually** below it — which is the thing that matters when a gloved thumb has to aim at it in the rain, and which is also what `target.field`'s own description is about ("gloved thumb, one-handed"). Two places where the distinction bites harder than usual: `hitSlop` grows *horizontally* too, so two `md` ghost buttons in a `space-between` row have hit areas 12pt closer together than they look (§1.5); and `target.criticalField` (72) is not a hit-area rule at all — `02-components.md:19` and `:51` say such a button "must be ≥`target.criticalField`", i.e. actually that big, because the rider has to find it under a countdown.

**One documented component is missing from the library**, and it is the one the offer needs: `Countdown` (`02-components.md` §38 — `expiresAt` + `serverNow` required, no `seconds` prop, `ring|bar|text`, linear, assertive announcements at 50/25/10/0%). `grep -rn "Countdown" packages/ui-native/src` returns only doc comments referring to it. This is a **gap in the frozen 41, not licence to invent a primitive** — see §6.

---

## 1. Per screen

### 1.0 Shell, router, navigation — `RiderShell.tsx`, `Router.tsx`, `nav.tsx`

**Purpose.** Hold the screen stack and the three fixed rider tabs; get out of the way during flows that take over the screen.

**What the rider is trying to do.** Know where they are and get to the one thing that matters in one tap.

**What it renders today.** A hand-rolled typed stack (`nav.tsx:15–83`) rendering exactly one screen (`Router.tsx:22–51`); `BottomNav` with three tabs — Shift / Deliveries / Profile — plus a detached circular action button (`RiderShell.tsx:40–97`). The bar unmounts on `offer`, `assignment`, `onboarding` (`RiderShell.tsx:22, 37, 84`).

**Problems.**

1. **The offer is a route, not a layer.** `offer` is an ordinary stack entry (`nav.tsx:18`, `Router.tsx:29–30`) rendered inside `Screen`, which puts an `AppBar` **back chevron** on it whenever `canGoBack` (`screens/Screen.tsx:39–44`). A rider can therefore dismiss a live offer with the back affordance, and Android hardware back pops the stack. D-14 and `tokens.json:412` both say the offer sheet is non-dismissible until the server's `expires_at`; `03-patterns.md:205` repeats it; the shipped legacy app's 7-second auto-dismiss is named in the spec as the exact failure this rule exists to prevent. This app has reintroduced dismissibility by a different route.
2. **`zIndex.offerSheet` is unreachable by construction.** Because the offer is a stack entry, it cannot outrank anything — there is nothing above it to outrank and nothing below it that survives. The z-index ladder the brief asks about is simply not in play.
3. **The action button's glyph is wrong and its label is two labels.** `icon={<Icon name="check" …>}` for availability (`RiderShell.tsx:88–92`): a checkmark means *done*, not *online*. The `accessibilityLabel` flips between "Availability — open" and "Go online or offline" (`:86`) — so the same control announces as a navigation target sometimes and as a toggle other times, and it is neither: it pushes a screen.
4. **The primary affordance costs three interactions.** Tap action → Availability screen mounts → network read → tap `Switch` → wait for PUT. `03-patterns.md:240` specifies the `OFFLINE` dashboard as "a full-width 72h 'Go online' `Switch`-button" on the home screen itself. Going online is the rider's shift starting; it is currently the most indirect thing in the app.
5. **`Deliveries` outranks the active delivery in the tab bar.** Three tabs are Shift / Deliveries / Profile, where "Deliveries" is *history* (`RiderShell.tsx:47–52` → `DeliveryHistoryScreen`). The live assignment has no tab and no persistent affordance; it is reachable only from a hardcoded button on Home (see §1.2). `03-patterns.md:244` — "A rider must never be able to reach home with a live assignment and no visible resume affordance."
6. **No back affordance on `assignment`.** `HIDDEN_ON` hides the nav bar during the assignment (correct), and the assignment is pushed so `Screen` gives it a back chevron — which pops to Home mid-delivery with no state. Combined with (5), the rider can strand themselves.
7. `TAB_FOR` maps `earnings` and `payoutDetail` to the `profile` tab (`RiderShell.tsx:27–29`) — the Profile tab reads active while the rider is on an Earnings screen. Minor, but it is the kind of thing a rider glancing for two seconds reads as "I'm in the wrong place".

### 1.0b The sign-in gate — `App.tsx:38–183`

Not in the brief's list of eight, but it is the first screen every rider sees and it is the only place in the app that breaks the token system outright.

**What it renders today.** A hand-built phone/OTP form outside `ThemeProvider` (`App.tsx:201–210` — the provider only wraps the authed tree at `:214`), using raw `StyleSheet` values.

**Problems.**

1. **Invariant 10 / RULE H-1 / lint L-4 violated: a solid green CTA.** `backgroundColor: '#1a7a4a'` on the primary button (`App.tsx:172`), and the same green as link text (`:182`). That is a saturated green in the 100°–180° band, filled, outside `color.halal.*`. The amended invariant is explicit: the reserved solid green signals *halal-verified* and nothing else; **action is orange `#F1521E`** precisely "so green never means 'tap here'" (`docs/decisions/palette-and-invariant-10.md`, Amendment §3). The first thing a rider ever taps in this product is a green button.
2. **Lint L-1 violated:** eleven raw hex literals in `apps/**` (`App.tsx:105, 133, 153, 160, 161, 164, 169, 172, 179, 180, 182`).
3. **Every target is below the rider floor.** `paddingVertical: 14` + 16pt label ≈ 44 on the button (`:171–177`); `paddingVertical: 10` + 16pt on the inputs ≈ 40 (`:162–170`). `target.field` is 56 for **every control in the rider app** (`tokens.json:397`).
4. **The field border fails WCAG 1.4.11.** `borderColor: '#ccc'` on `#fff` computes to **≈1.61:1** (my calculation, WCAG 2.1 relative luminance). The bar for a boundary that bounds an interactive control is 3:1 (`04-accessibility.md:29`). Outdoors at max brightness those input boxes are invisible.
5. **Hand-rolled OTP.** `Input variant="otp"` (six discrete cells, paste-aware, `autoComplete="one-time-code"`) exists in the library (`02-components.md` §3); this is a bare `TextInput` (`App.tsx:114–124`).
6. **Type is off-scale:** `fontSize: 24 / 14 / 16 / 13` (`:160, 161, 168, 180`) — none of these are scale steps, and 13 for the error text is below the rider register's floor.

### 1.1 `RiderHome.tsx` — "Your shift"

**Purpose.** Per D-18 / `03-patterns.md` §2.2: one of three server-determined modes — `OFFLINE`, `ONLINE_IDLE`, `ON_DELIVERY` — and the **only crash-recovery path**.

**What the rider is trying to do.** Start or end a shift; see today's money; resume a live delivery after the app died.

**What it renders today.** `GET /v1/riders/me` (`:62`) → an identity card with an XL `Avatar`, name, phone, `Rating`; three status `Badge`s; a "WORK LOOP" card of three navigation buttons; an onboarding card when incomplete; an "ACCOUNT" card of three more navigation buttons; a Refresh button; a `__DEV__` readout.

**Problems.**

1. **It calls the wrong endpoint.** The dashboard — `GET /v1/riders/me/dashboard` — returns `mode`, `today {gross_cents, trips, online_seconds}`, `active_assignment` (the full `Assignment`), `current_offer` (the full `DispatchOffer`), `tracking_health` and `blocking_reasons` (`contracts/openapi.yaml`, `RiderDashboard`). Home calls `/v1/riders/me` instead and therefore shows **no earnings, no trips, no online time, no resume card, no tracking warning**. Every D-18 requirement is one call away and the call is not made. (The Availability screen *does* call the dashboard — `AvailabilityScreen.tsx:90` — and discards everything except `mode` and `blocking_reasons`.)
2. **Crash recovery is a hardcoded UUID.** "Active delivery" pushes `assignment` with the literal `'4ea97aca-78d6-4735-a8f0-253dd437e00d'` (`:265–276`). There is no `active_assignment` read. A rider whose app died mid-delivery lands on Home and the only route back to their real assignment is a button pointing at a fixture. This is the single rule `03-patterns.md:244` states as non-negotiable.
3. **It is a menu, not a dashboard.** Nine buttons in four cards, seven of which are navigation, all styled `secondary` or `primary` at `lg`/`xl`. Nothing on this screen tells a rider what to do next. `03-patterns.md` §2.2 asks for one mode-specific layout with one dominant action; this is a site map.
4. **The one thing a rider needs in one tap needs two.** "Availability — go online / offline" (`:249–256`) navigates; it does not toggle.
5. **`ONLINE_IDLE` is rendered as a badge, not as the working state.** `03-patterns.md:246` — "`ONLINE_IDLE` with no offers is **not** an empty state — it is the working state, and it says so ('Waiting for offers · online 42 min')." Here it is a 26pt tinted pill among two other pills (`:231–239`).
6. **Badge `brand` is the action colour used for status.** `AVAILABILITY` maps `ONLINE_IDLE → 'brand'` (`:45`), and `brand` resolves to the orange action ramp. Orange is the one colour in this palette that means *tap here* (palette decision §3). Spending it on non-interactive status pills — here, and on "Account active" (`:235`), "Active" (`:341`), "Paid", "Approved", "Transferred" across four other screens — flattens exactly the hierarchy a two-second glance depends on.
7. **Raw enums leak to the rider.** `rider.account_status` is rendered verbatim as a badge label (`:238`), as is `rider.onboarding_state` when not `ACTIVE` (`:234`). `DOCUMENTS_REVIEW` is not rider copy.
8. **Loading is a spinner where the geometry is known** (`:119–137`). `03-patterns.md:14` — "Loading has geometry… a centred spinner is permitted only where the eventual geometry is genuinely unknown." `Skeleton` is exported and unused app-wide.
9. `maxWidth: 640, alignSelf: 'center'` (`:87–88`) is a web-layout habit on a phone-first surface; harmless, but it means the content column is narrower than the gutters imply on a tablet.

### 1.2 `AvailabilityScreen.tsx` — going online

**Purpose.** D-10. Ask the server to change availability and render exactly what comes back.

**What the rider is trying to do.** Start earning. If they can't, find out why and fix it.

**What it renders today.** Dashboard read → a `Switch` with `loading`, two badges, a "Since …" line, a conflict `Banner`, a blocking-reasons card, and an info `Banner` pointing at the offer screen.

**What is right, and worth keeping.** The switch does not move until the server answers (`:192–199`, `loading={busy}`) — the exact pattern `02-components.md` §8 demands. `blocking_reasons[]` are mapped to human copy with a machine-code fallback (`:54–64, 227–231`). A 409 gets the `go_offline_after_delivery` explanation (`:165–168`).

**Problems.**

1. **Location reporting lives on this screen and dies with it.** `useLocationReporting(...)` is called in this component (`:116–118`); its interval is cleaned up on unmount (`location.ts:95–97`). `Router` renders exactly one screen. So the moment the rider navigates away — to Home, to the offer, anywhere — position reporting stops. The server marks `ONLINE_IDLE → ONLINE_STALE` after 120 s without a fix and the rider **stops being dispatchable while the UI still says "Online"** (spec §0.4, D-10 transition table). A rider who goes online and then looks at their earnings silently stops getting work.
2. **No background location at all.** D-12 requires a background task (Android foreground service, iOS `allowsBackgroundLocationUpdates`) from the instant the assignment starts, with a local ring buffer and batched flush. `location.ts` is foreground-only, one point per 20 s, no buffering, no `assignment_id`. The permissions are declared in `app.json` (`ACCESS_BACKGROUND_LOCATION`, `NSLocationAlwaysAndWhenInUse…`) but nothing uses them. A rider who pockets the phone disappears from the customer's map and from `tracking_health`.
3. **"Since" is fabricated.** The initial read sets `since: new Date().toISOString()` (`:96`) because the dashboard payload has no `since` field, then renders it as `Since {…toLocaleTimeString()}` (`:213–215`). The rider reads "Since 2:41 PM" as *when my shift started*; it is *when this screen loaded*. This is a client-invented value presented as server fact, on the one screen whose doc comment says "the server is the single source of truth".
4. **The screen tells the rider to go hunting for offers.** `Banner … action: 'View current offer'` (`:236–243`). Dispatch is push-based by design — D-18: "There is no list of 'available orders' to browse." Teaching the rider to poll a screen is teaching the wrong model, and it is the only way an offer can currently be seen (§1.3).
5. **The `Switch` is the whole shift control, and it is a row, not a target.** It is target-compliant — `Switch` sizes its row and its hit area off `theme.target.min`, which is 56 under the rider theme (`primitives/Switch.tsx:76, 117`) — but the *visible* control is a 52×32 track at the end of a label row (`:21`), whereas `03-patterns.md:240` specifies a **full-width 72-high "Go online" switch-button** as the dominant element of the `OFFLINE` mode. Starting a shift should be the biggest thing on the screen, not a toggle at the end of a sentence.
6. **No loading geometry**; `LoadingView` spinner again (`:184`).
7. `can_receive_offers` renders as a second badge in the same visual weight as the authoritative state (`:207–211`) — two pills side by side, one of which is derived, with no hierarchy between them.

### 1.3 `OfferScreen.tsx` — the 30-second decision

**Purpose.** D-14. The full-screen, non-dismissible offer with a server-anchored countdown, Accept and Decline.

**What the rider is trying to do.** In two seconds: decide whether this job is worth taking, then hit one large target without misfiring.

**What it renders today.** A routed `Screen` (AppBar + ScrollView) containing: a demo scenario `Select` under `IS_MOCK`; a card with a countdown `Badge` + wave `Badge`, pickup, drop-off, "You earn" + `Price`, tip line; a "Simulate accept race" `Switch` under `IS_MOCK`; an `xl` Accept button; a `Card` containing a reason `Select` and a `lg` Reject button.

**What is right.** The skew correction is conceptually correct: anchor `server_time − Date.now()` once per offer and measure `expires_at` against the corrected clock (`:84–101`) — D-14 R3 satisfied in principle. Money goes through `Price` (`:264, 271`). Reject requires a `reason_code` from the closed taxonomy (`:42–54, 319`). The 409 accept race is handled with the right copy — "Another rider took this order first" (`:165–167`) — stated as fact, not fault, as `03-patterns.md:230` requires.

**Problems — this is the worst screen in the app.**

1. **An offer cannot arrive.** There is no WebSocket and no push. `grep` for `WebSocket` / `expo-notifications` across `apps/rider/` returns nothing; neither is in `package.json`. The only read of `/v1/riders/me/offers/current` is this screen's own mount effect (`:117–139`), and the only way to mount it is for the rider to tap a button. The contract has all three paths — `POST /v1/realtime/ticket` → `wss://…/v1/ws` (`contracts/openapi.yaml:837`; `contracts/websocket.md:33–44`), the `dispatch.offer` event on `rider:{account_id}` carrying `expires_at` + `server_time` (`websocket.md:263`), and `dispatch.offer_withdrawn` (`:264`) — plus the pull endpoint. D-14 requires all three in parallel and "**Every event that requires rider action is also sent as a push notification.** The WebSocket is an optimisation, never the only delivery path." A rider with the app in their pocket receives nothing; a rider staring at this screen sees an offer only if they happen to tap Retry inside a 30-second window.
2. **It is dismissible, and it is not a sheet.** Back chevron via `Screen` (`Screen.tsx:43`), hardware back pops the stack. `Sheet variant="full" dismissible={false}` — which exists for exactly this and swallows hardware back (`Sheet.tsx:121–130`) — is unused.
3. **The countdown is a 26-pixel pill of 15pt text.** `Badge label={`${remaining}s left`} size="lg"` (`:226–229`): `Badge` `lg` is 26 high with `label.md` type (`primitives/Badge.tsx:24, 48`) — 15pt under the rider theme. The spec's instrument is a **`Countdown` ring**, and the earnings figure beside it is `display.lg` 36/700 (`03-patterns.md:209, 211`; `02-components.md` §19). What ships is the smallest possible treatment of the most time-critical number in the product.
4. **The countdown has no urgency ladder and the wrong colours.** `variant={expired ? 'neutral' : remaining < 10 ? 'warning' : 'brand'}` (`:227`). Spec: `normal` info → `urgent` <25% warning → `critical` <10% danger + 1 Hz pulse (`02-components.md` §38). Here the resting state is **brand orange** — the action colour — and there is no critical state at all. At 3 seconds left it looks the same as at 11.
5. **No announcements.** `02-components.md` §38 and §19: the ticking numeral is `aria-live="off"` and explicit assertive announcements fire at 50 / 25 / 10 / 0 %, with the offer announced once in full on open. There is no `AccessibilityInfo.announceForAccessibility` anywhere in the app. A rider using TalkBack gets silence, then an expiry.
6. **Drift.** `setInterval(…, 1000)` (`:93`) with a `tick` counter. RN timers drift and are throttled in background; the displayed value is recomputed from the anchor each tick so it self-corrects, but the *tick rate* can visibly stall. `easing.linear` is a token for an animated ring (`tokens.json:369`); a 1 Hz integer stepper is not the same instrument and cannot show sub-second urgency.
7. **Expiry is wrong in both directions.** `onExpire` does not exist; at zero the screen just disables Accept and relabels it "Offer expired" (`:298–301`) and then **sits there indefinitely**. D-14: the sheet shows "Offer expired" for **3 s** and then closes. And per `02-components.md` §38, an offer whose `expires_at` is already past must render **nothing** and trigger a re-fetch — here a late pull renders a dead card with a disabled button.
8. **Accept is 60 high, not 72, and is not marked critical.** `Button size="xl"` (`:293–302`) = 60 (`Button.tsx:36`). The `critical` prop exists, resolves 72 (`Button.tsx:55–58, 114`), and is used nowhere in the app. `tokens.json:398` names "Rider Accept / Decline" as the reason the token exists.
9. **Decline is 52 high — below the 56 rider floor — and gated behind a picker.** `Button size="lg"` (`:314–323`) = 52. It is `disabled` until a reason is chosen from a `Select` (`:307–313`), whose default `native` variant opens a platform picker: open, scroll, confirm, then find the button. That is three-plus interactions to decline, inside 30 seconds, with gloves. The spec requires the reason code (D-17) — so the fix is not to drop it, but the current sequencing makes declining slower than ignoring, which converts deliberate declines into `EXPIRED` offers. Three consecutive expiries force the rider `OFFLINE` for unresponsiveness (D-10).
10. **Accept and Decline are in the wrong places relative to each other and the thumb.** Spec layout: both 72, Accept **at the bottom edge under the thumb**, Decline separated by ≥24 (`03-patterns.md:220`; `04-accessibility.md:75`). Here Accept floats mid-scroll and Decline is *below* it inside a card — so in a ScrollView whose content exceeds the viewport, the button nearest the thumb is **Decline**. Under a countdown, the target closest to the thumb should never be the one that forfeits the money.
11. **The earnings breakdown the contract provides is thrown away.** `OfferEarningsEstimate` carries `base_cents`, `distance_cents`, `surge_cents`, `tip_so_far_cents`, `estimated_total_cents` (`contracts/openapi.yaml`). The screen shows the total and the tip (`:264, 271`). D-14 and `03-patterns.md:211` require base · distance · surge · tip-so-far. `est_duration_s` is also in the payload and never rendered — the rider cannot see how long the trip takes, only how far.
12. **Distance is formatted, duration is absent, pickup distance is conflated.** `${(distance_m / 1000).toFixed(1)} km` (`:252–254`) is rendered in `caption` (12pt) inside the drop-off block, next to the item count — so the single number that decides whether a job is worth taking sits at the smallest type size on the screen, attached to the wrong section. The spec wants distance-to-pickup and trip distance/duration as separate, legible facts (`03-patterns.md:212–216`).
13. **Demo scaffolding occupies the offer.** The scenario `Select` is the **first card on the screen** (`:205`) and a "Simulate accept race" `Switch` sits **between the offer and the Accept button** (`:281–291`). Both are `IS_MOCK`-gated, and `IS_MOCK` is `API_BASE_URL === 'http://localhost:4010'` (`api.ts:30`) — so any demo build pointed at the mock shows a rider a fixture picker where the countdown ring belongs.
14. **No sound, no haptic.** `04-accessibility.md:237` and D-14: sound + vibration must fire **in silent mode** when `ONLINE_IDLE` (Android `IMPORTANCE_HIGH` + DND bypass; iOS time-sensitive). Nothing. No `expo-haptics`, no audio.
15. **No map.** The offer has `pickup.latitude/longitude` and `dropoff.latitude/longitude` in the payload and `MapView` exists. A rider cannot tell whether "Danforth Ave" is toward or away from where they are standing.
16. **`Screen`'s `loading` prop drives the AppBar progress bar for both Accept and Reject** (`:204`) — a 2px hairline at the top of the screen is the only feedback that an irreversible accept is in flight, other than the button spinner.

### 1.4 `AssignmentScreen.tsx` — the live delivery

**Purpose.** D-19 / D-20 / D-21. One screen per assignment state; one forward action; record proof.

**What the rider is trying to do.** Get to the restaurant, confirm the right food, get to the door, hand it over, get paid — and have a way out when reality doesn't match the screen.

**What it renders today.** Demo `Select`; a card with state + order-code badges, pickup name/address, drop-off name/address/unit/instructions, "You earn" + `Price`; an items card; then one of: delivered `Banner`, `SealScanCard`, `PodCard`, or a "Next step" card containing "Open in Maps" (`secondary`, 52) above the forward action (`primary`, 60).

**What is right.** No prices or order totals anywhere (D-19 honoured). Transitions are explicit rider actions with `Idempotency-Key` (`:199–212`) — no timers advance state, which is the deleted legacy mechanism (§0.6). `FORWARD` is a strictly-forward ladder with no back (`:102–118`). POD method comes from the server (`:223`). The 423 OTP-lock gets specific copy (`:270–272`).

**Problems.**

1. **Transitions are stamped with the destination's coordinates, not the rider's.** `const loc = step.at === 'pickup' ? state.assignment.pickup : state.assignment.dropoff` then `latitude: loc.latitude, longitude: loc.longitude, accuracy_m: 5` (`:194, 204–211`); the same for the final `DELIVERED` transition (`:249, 256–262`). Every transition therefore claims the rider is standing exactly on the restaurant or the customer's pin with 5-metre accuracy. The 150 m geofence (`geo.arrival_radius_m`) can never fail, `assignment_transition.lat/lng/geofence_ok` become fiction, and the `override_reason` path the contract provides (`AssignmentTransitionInput.override_reason`, "mandatory when the geofence check fails… flagged for ops") is unreachable. This is a design decision with a fraud consequence: the app asserts a location the rider may not be at, in the record that decides disputes.
2. **There is no exception path.** D-32 states the rule in the strongest terms in the whole domain: "**A rider must always have a forward path that is not 'falsely mark delivered'.** Every screen from `ASSIGNED` onward exposes the exception action. This is the single most important rider-safety and data-integrity rule in the domain." This screen has no such action in any state. A rider at a wrong address, at a closed restaurant, with a customer who will not answer, after an accident, has exactly two affordances: the forward button, or back out of the delivery. **Note: this is a contract gap, not only a client omission** — there is no rider exception, incident or support endpoint in `contracts/openapi.yaml` (the rider paths are enumerated at `:3617–4340`; the only adjacent thing is `/v1/orders/{orderId}/handoff/tamper-report`, `:5675`).
3. **`handover_method` is hardcoded.** `handover_method: 'LEFT_AT_DOOR'` on every photo POD (`:243`), regardless of what happened. The enum exists to distinguish `HANDED_TO_CUSTOMER` / `LEFT_AT_DOOR` / `LEFT_WITH_RECEPTION` / `HANDED_TO_OTHER_PERSON` (spec D-21). The app writes a constant into the field that decides "I never got my food" disputes. The rider is never asked.
4. **No contact affordance.** No call customer, no call restaurant, no templates. `Assignment` carries `pickup.phone_alias` and `dropoff.phone_alias` — proxy numbers, "the restaurant's real line is never sent to the rider" — and neither is rendered. `03-patterns.md:256` requires contact `IconButton`s on every step screen. (Again partly a contract gap: `POST …/contact` from D-24 is not in the contract, but the aliases *are* in the payload and `Linking` is already imported at `:23` for maps, so a `tel:` dial is available today.)
5. **The rider cannot tell whether the food is ready.** `pickup.order_state` is in the payload and is not rendered. `pickup_notes` is in the payload and is not rendered. D-20 gates `PICKED_UP` on the restaurant being `READY_FOR_PICKUP` or an override — the rider will discover this by having the transition rejected.
6. **`buzzer` is dropped.** `dropoff.buzzer` is in the payload; the screen renders `address` + `unit` only (`:338–341`). A rider stands outside a locked lobby holding food.
7. **`delivery_instructions` — the closed five-value enum — is not rendered.** Only the free-text `special_instructions` is, and it is rendered in **`caption` (12pt / 400) in `text.tertiary`** (`:342–346`) — the smallest, lightest, lowest-ranked text style on the screen. `caption` is the one style the rider theme does **not** bump (12pt in both registers). D-19 and `04-accessibility.md:195` require these verbatim, never truncated, and `03-patterns.md:267` requires them verbatim and never silently truncated. `POD` requirements are *derived* from this enum (D-21 table), so the instruction that determines whether the rider needs an OTP or a photo is currently the least visible sentence on the screen.
8. **Allergen and halal notes are dropped entirely.** `items[].allergen_tags`, `items[].addon_names`, `items[].note` are all in the contract; `ItemsCard` renders `quantity × name (variant)` as plain `Text` (`:444–461`). D-19: "Allergen and halal notes present on an item are shown as chips so the rider does not swap bags." `Chip` with a `warning` tone exists for exactly this (`02-components.md` §10). This is the one place in the rider app where the product's single claim touches the rider's hands, and it renders nothing.
9. **No map, no route, no ETA.** `MapView` exists; `03-patterns.md:256` requires a map strip at the top of every step screen. Instead: a `secondary` "Open in Maps" button *above* the primary action (`:408–419`), which ejects the rider into another app and back.
10. **The maps deep link ignores the vehicle.** `travelmode=driving` hardcoded (`:122`); `mapsUrl` builds only the universal HTTPS URL. D-22: profile follows `vehicle_type` (`driving`/`cycling`/`walking`), deep link `google.navigation:q=…&mode=d|b|w` with the documented fallback chain. A cyclist is routed down a highway.
11. **The primary action is 60, not 72, and it is not at the bottom edge.** `Button size="xl"` (`:420–428`) inside a card, after the items list, inside a ScrollView. `03-patterns.md:256` — "**one primary 72h action at the bottom edge**". With a four-item order and instructions, the action is below the fold: the rider scrolls to find the button that advances a delivery.
12. **Visual order inverts priority.** "Open in Maps" (secondary) is above the forward action (primary) in the same card (`:408–428`), so the first large target the eye lands on is the one that leaves the app.
13. **`tracking_health` is in the payload and never surfaced.** D-18 and `03-patterns.md:250` require a persistent `Banner variant="warning"` — "Tracking isn't reporting — you may stop receiving offers" — with a one-tap deep link to permissions/battery settings. Given §1.2(2), tracking will be unhealthy routinely and the rider will never be told.
14. **No offline queue.** D-20 requires transitions queued with their `occurred_at` and an idempotency key, a "Will send when back online" banner, and local advance with a pending marker. A failed transition renders `Banner variant="warning" title="Couldn't advance"` (`:405–407`) with no retry and no queue. `03-patterns.md:279` and gate 8 both require the full flow to complete with the network disabled from `ARRIVED_AT_PICKUP` onward.
15. **`PHOTO_WITH_ATTESTATION` is unimplemented.** The 423 path tells the rider to "Use photo with attestation" (`:270–272`) and no such path exists. `ProofOfDeliveryInput.attestation_reason` is in the contract. The rider is handed a dead end after five failed OTP attempts, at a door, at night.
16. **POD photos can come from the library.** `uploadPodPhoto` → `captureImage()` → on any `UNAVAILABLE` outcome it silently falls back to `pickImage()` (`capture.ts:63, 68–71`). D-21: "The photo must be captured in-flow, never picked from the library." Sharing the KYC capture helper with POD has imported a permissive fallback into the one place where provenance is the entire point.
17. **Delivery ends in an info `Banner`.** `title="Delivered" … "Proof of delivery is recorded. Nice work."` (`:371–376`). D-27: "A per-delivery breakdown screen appears immediately after `DELIVERED`, populated from the server response." The rider finishes a job and is not shown what they earned.
18. **`accuracy_m: 5` is a literal** (`:207, 259`) — a fabricated accuracy on a record used for pay and dispute.
19. **Seal state is local and lost.** `pickupSealDone` / `deliverySealDone` are component state (`:161–162`). Any remount — a reload, a nav away and back — asks the rider to scan again, and (given §1.5) re-submits an attestation.
20. **Demo `Select` is the first card here too** (`:290–299`).

### 1.5 `SealScanCard.tsx` — the chain-of-custody moment

Not one of the eight screens, but it owns two irreversible actions inside the delivery flow, and it is where the product's physical halal claim is recorded (`docs/design/handoff-verification.md`).

**Problems.**

1. **The attestation is pre-checked and submitted by aiming the camera.** `sealIntact` defaults to `true` (`:36`); `onBarcodeScanned` fires `submit(data)` the instant a QR is in frame (`:106`), POSTing `seal_intact: sealIntact` (`:60`). So a rider who points the phone at a **visibly broken seal** has already attested it intact, before reading the checkbox that sits above the viewfinder. There is no confirm step and no undo (`submittedRef` guards re-entry, `:39, 52`). The handoff doc makes this the integrity half of the guarantee — "the package was sealed at the kitchen and **still sealed at the door**". An optimistic default on a trust attestation is the same class of error invariant 8 exists to prevent: silence is never consent on a halal claim.
2. **"No seal on this package" is a 44-high ghost button adjacent to a visually identical one.** Both `variant="ghost" size="md"` in a `space-between` row (`:127–134`): 44 visible, and because `hitSlop` pads each to 56 it also pads them 6pt *toward each other*, so the two hit areas are 12pt closer than the two labels look. They are indistinguishable in weight, colour and size, and one of them permanently records "no seal bound" and skips the evidence step. That is an irreversible action reachable by accident, with gloves, at a door. `04-accessibility.md:75` requires ≥24 between a constructive and a destructive action in a timed decision; this pair is worse — they are indistinguishable.
3. **Raw layout constants:** `height: 220`, `borderRadius: 16` (`:96–100`) rather than `radius.lg`.
4. **The camera has no framing guidance, no torch, no manual-focus escape.** At night, over a bag, one-handed, with a 220pt viewfinder and no reticle. The manual code entry exists (`:109–120`) but is reached through a ghost button labelled "Enter code manually" that shares a row with the skip.
5. `heading.sm` / `body.md` are named explicitly (`:29–31`) rather than the register defaults — harmless today (rider bumps `body.md` to 17) but it hardcodes an assumption the theme owns.

### 1.6 `OnboardingScreen.tsx` — get verified

**Purpose.** D-02 → D-06. Render the server's `next_step`; capture documents through the presigned flow.

**What is right, and genuinely good.** The screen never decides its own step — it renders `next_step` and `steps_completed` (`:187–206`). The three-call upload flow is honest (`:617–656`). `AWAITING_REVIEW` is a real state with real copy, not a spinner (`:192–198`). The Stripe return is explicitly not trusted — readiness comes from the webhook, and the rider taps "I'm done — check status" (`:362–370, 510–512`). Specific error codes get specific copy: `UNDERAGE`, `EMAIL_IN_USE`, `PLATE_IN_USE`, `DOCUMENTS_INCOMPLETE`, `DOCUMENT_EXPIRES_TOO_SOON` (`:238–243, 314–318, 544–551, 662–666`). The bicycle/on-foot branch refuses to collect plate fields (`:345–350`).

**Problems.**

1. **Progress is six badges, not the specified instrument.** `02-components.md` "Deliberately absent" — "**`Stepper`/wizard chrome** — onboarding progress is `StatusTimeline variant="horizontal"` driven by the server's `onboarding_state` enum". `StatusTimeline` is exported and unused; this is six `Badge`s in a wrapping row plus a bare "42%" (`:152–185`). A rider cannot see which step is *current*, only which are done — and the badges use `brand` (the action colour) for "done".
2. **Every document is offered, every time.** `ALL_DOC_TYPES` renders six `DocumentCard`s (`:68–75, 564–566`) regardless of `vehicle_type`, even though D-05 defines the required set per vehicle (car: licence + registration + insurance + photo; bicycle/on-foot: government ID + photo). A cyclist is shown three documents they must not supply and discovers the truth from a 422.
3. **Expiry is a typed `YYYY-MM-DD` string, pre-filled with today + 365.** `defaultExpiry()` (`:98–102`) and an `Input` with a regex gate (`:691–699, 712`). The rider is asked to transcribe a date from a licence into a text field, with a plausible wrong value already in it — so the path of least resistance produces a document whose recorded expiry is a year from today and unrelated to the document. Every downstream consequence of expiry (D-05: forced offline, `account_status=SUSPENDED`) hangs off this field.
4. **Capture buttons are `size="md"` (44)** (`:707–716`) — below the 56 rider floor — and so are the expiry inputs (`size="md"`, `:697`).
5. **The step buttons are `lg` (52)**, below 56 (`:268, 352, 507, 510, 582`).
6. **A capture error renders as bare 12pt text**, not an `ErrorState` or inline field error: `Text style={{...caption, color: feedbackRole(theme,'danger').text}}` (`:701–705`).
7. **`DocumentCard` has no preview of what was captured.** After a successful capture the state returns to `idle` (`:657`) and the only feedback is the badge changing on the next parent reload. A rider cannot see whether the photo they took is legible — which is the single most common cause of `REJECTED`.
8. **The rejection note is 12pt `caption`** (`:687–689`) — the text that tells the rider what to fix.
9. **`Divider` inside the card after the button** (`:717`) is decorative noise below the primary action.
10. Loading is a spinner (`:128`); no skeleton for the six document rows whose geometry is fully known.

### 1.7 `EarningsScreen.tsx` — earnings and payouts

**Purpose.** D-26 / D-27 / D-28. Server ledger, three tabs.

**What is right.** No client arithmetic: every figure is a server field through `Price` (`:116–122, 134, 157, 276, 373`); `Row` passes cents straight through. Tabs keep independent state so switching never blanks a loaded tab. The empty period renders "zeroed buckets, not an empty chart" (`:143–145`) — exactly `03-patterns.md:289`. The payout copy — "weekly, Monday, automatic, no minimum" (`:138, 358`) — **correctly follows the contract over the spec** (`contracts/openapi.yaml:4314`; decisions S-04 / R-03 supersede the spec's `$10` minimum). That is the right instinct and worth recording.

**Problems.**

1. **This is the one screen where "no number rather than a wrong number" is a named rule, and the failure mode is a spinner.** `03-patterns.md` §5 matrix: rider earnings loading = skeletons. Every tab uses `LoadingView` (`:105, 260, 353`). `Price` has a documented `loading` state that renders a `Skeleton` at the exact glyph width so totals do not jump (`02-components.md` §20) — unused.
2. **The period selector is a `Select`, not the spec's day/week/month control.** `03-patterns.md:287` asks for a period selector; a native picker for three mutually exclusive short options should be `Tabs` or a segmented `Select variant="inline"` (`02-components.md` §5: "`inline` (segmented, ≤3 short options)"). Three taps to change period, on a screen a rider checks constantly.
3. **Nine unstyled `Text` nodes with no type token.** `<Text style={{ color: theme.color.text.secondary }}>` with no `useTypeStyle` (`:125, 126, 133, 154, 181`, and `:273, 370` with a raw `fontWeight: '600'`). These fall back to the RN default 14pt — *below* the rider register's 17pt body and below the 15pt label. The rider's money is partly set in a size the design system does not contain.
4. **Ledger rows are not rows.** `ListRow` is the specified component for this (`02-components.md` §39) and is **not exported by the library at all** (see §6). Each entry is a `Card` with a nested flex row (`:270–292`) — no `rowHeight: 72` from `density.roomy`, no consistent tap target, and the entry cards are not pressable at all, so a rider cannot drill into a delivery's breakdown. D-27: "each entry drills into a full breakdown identical to D-26's components."
5. **The per-delivery breakdown does not exist.** The `EarningEntry` components (`base_cents`, `distance_cents`, `wait_cents`, `guarantee_topup_cents`, `tip_cents`) are retained in the contract specifically so the rate card can be switched on (`contracts/README.md` row 7). Nothing renders them. A rider sees a gross figure with no explanation — the exact condition D-23's rule about the unpaid pickup leg ("must be stated plainly… so it is not perceived as missing pay") exists to prevent.
6. **`loadMore` has no error branch.** `try/finally` with no `catch` (`:239–256`, `DeliveryHistoryScreen.tsx:61–78`): a failed page silently stops the spinner and nothing changes. The rider taps again and nothing happens.
7. **"Load more" is `size="md"` (44)** (`:295`), below the rider floor.
8. **`Badge` `sm` (18 high, `label.sm` 11pt)** for entry and payout status (`:279–283, 376–380`) — 11pt status text on a screen read outdoors, where the register's floor is 17.
9. **`hold_reason` and `failure_message` are rendered raw** (`:387–392`) — server strings in 12pt caption where a `Banner` with code-keyed copy belongs. D-28 requires the provider's reason "mapped to rider-readable copy".
10. **Tips are labelled "Tips (100% pass-through)"** (`:120`) — correct and good — but bonuses and adjustments carry no explanation at all, and `sign="always"` on adjustments (`:122`) means a rider sees `−$4.00` with no reason and no link to one.

### 1.8 `PayoutDetailScreen.tsx` — one payout

**Purpose.** D-28. The payout and the entries that fund it.

**Problems.**

1. **No empty state and no `loading` geometry.** `Load` has three cases (`:37–40`); the entries list assumes non-empty (`:108`). A payout with zero entries renders an "ENTRIES" heading over nothing. `AGENTS.md` §6: "Every screen implements empty, loading and error."
2. **Six `Text` nodes with no type token** (`:78, 111`) — RN default 14pt again, on money.
3. **Nothing is tappable.** An entry cannot be opened, and there is no route back to the delivery it came from — even though `entry.order_code` is rendered (`:113`). D-28: "Every payout has a downloadable statement listing each contributing delivery." There is no statement affordance.
4. **`hold_reason` / `failure_message` raw in 12pt caption** (`:94–101`) — same as §1.7(9). For a `FAILED` payout this is the most important text on the screen and it is the smallest.
5. **`FAILED` and `HELD` map to `warning`** (`:24–25`); a failed payout is the one genuinely `danger`-class event on this surface — money the rider expected did not arrive. (`danger` is correct here and carries no halal meaning, so invariant 9 is not engaged.)
6. The period range is the screen's identity and is rendered as untokened 14pt secondary text next to a `md` badge (`:77–87`), while the `Price` gets `xl` (`:88`). The hierarchy is inverted relative to what the rider is looking for ("which week was this?").

### 1.9 `ProfileScreen.tsx` — identity, vehicle, documents

**Purpose.** D-09. Identity, vehicle, per-document review state, sign out.

**What is right.** Two independent reads with independent states (`:82–121`) so one failure does not blank the other. The `REJECTED`/`EXPIRED` banner with a one-tap route to the fix (`:165–172`) is exactly the remediation pattern `02-components.md` §37 describes. Empty documents is a real empty state with an action (`:181–188`).

**Problems.**

1. **Raw enums as the rider's identity.** `Badge label={identity.rider.account_status}` and `label={identity.rider.onboarding_state}` (`:148–149`), both `outline` `sm` (18 high, 11pt). `PROFILE_PENDING` in 11pt is not information.
2. **Sign out is the fourth of four identical buttons.** Four `variant="secondary" size="lg" fullWidth` buttons in a row (`:214–234`), the last of which ends the session. It has no `destructive` treatment, no confirmation, and is visually identical to "Delivery history" directly above it — at 52 high with an 8-ish gap. `logout(); nav.resetHome()` (`:229–230`) is immediate. With the app's in-memory token (`App.tsx:9`), signing out by accident means re-running phone OTP — during a shift, that is minutes of lost work. `02-components.md` §31: a destructive confirm is an `alertdialog` whose focus lands on the least destructive action. `Modal variant="confirm"` exists and is unused.
3. **Document rows are hand-built `View`s with untokened `Text`** (`:190–210`) — no `rowHeight`, not pressable, so a rider cannot open a document to see what they submitted. `DocumentViewer` is specified (`02-components.md` §25) and is **not in the library** (§6).
4. **`valid_until` is printed as the raw ISO date string** (`:202–206`) — `2027-04-01` in 12pt caption. Expiry is the field that suspends the rider's account; `04-accessibility.md` requires absolute dates, but formatted ones.
5. **Vehicle is one line of untokened text** (`:156–159`) — `CAR · BXTM 449`.
6. **No settings at all.** D-09 covers settings; there is no notification preference, no `go_offline_after_delivery`, no timezone, no support route, no emergency contact.
7. **Nothing addresses D-29 performance metrics or D-31 ratings.** Both are absent from the contract too (see §6), but the rider's `rating_avg` *is* in `RiderMe` and is shown only on Home (`RiderHome.tsx:220–221`), not here.

### 1.10 `DeliveryHistoryScreen.tsx` — past deliveries

**Purpose.** D-30. Past deliveries, newest first, cursor-paginated.

**What is right.** The doc comment is the most honest thing in the codebase: there is no rider-facing order-list endpoint, so the earnings ledger filtered to `type=DELIVERY` **is** the history, and that is server-authoritative rather than derived (`:1–13`). Cursor pagination, never offset (`:47, 67`).

**Problems.**

1. **It is the earnings ledger with a different title.** D-30 requires `restaurant_name`, `dropoff_area`, `duration_seconds`, `billable_distance_m`, `rating_given_by_customer`, `terminal_reason` per row, and a detail view with the transition timeline, the earnings breakdown, the route map and the POD artefact. Rows show order code, gross, status badge, timestamp (`:94–113`). This is a contract limitation, honestly handled — but the screen does not say so to the rider, and it promises "Every completed trip" in its subtitle (`:81`) while showing none of the trip.
2. **Rows are not pressable** (`:95`), so there is no detail view and no "report a problem with this delivery" (D-30, available 14 days after delivery). Given (1) that route does not exist anyway — but the rider's only way to dispute a delivery is currently nothing.
3. **Untokened `Text` with raw `fontWeight: '600'`** (`:98–100`) — RN default 14pt for the order identifier.
4. **`Badge size="sm"`** (11pt) for payment status (`:103–107`).
5. **`loadMore` has no `catch`** (`:61–78`) — same silent failure as §1.7(6).
6. **`{new Date(entry.earned_at).toLocaleString()}`** (`:109`) produces a locale-dependent full date-time in 12pt caption. For a list read at a glance, "Today 6:42 PM" / "Tue 12 Sep" is the register-appropriate treatment.
7. **No filter, no period grouping** — a rider with 250 rows scrolls. Cursor paging is right; the absence of any grouping is a design gap.
8. Loading is a spinner where five row skeletons are specified (`03-patterns.md:291`).

---

## 2. Cross-cutting findings

These are not per-screen; they are one decision made once and repeated everywhere.

| # | Finding | Evidence |
|---|---|---|
| C-1 | **No realtime, no push.** No WebSocket client, no `expo-notifications`, no haptics, no audio. The contract ships the ticket endpoint, the socket, `dispatch.offer`, `dispatch.offer_withdrawn`, `dispatch.assigned`, `rider.availability_changed`, `rider.earnings_updated`. | `apps/rider/package.json`; `contracts/openapi.yaml:837`; `contracts/websocket.md:259–270` |
| C-2 | **Spinners everywhere, skeletons nowhere.** `LoadingView` (a `Spinner` + label in a `Card`) is the loading state on all ten screens. `Skeleton`, `RestaurantCardSkeleton`, `OrderCardSkeleton`, `Price loading` all exist. | `screens/Screen.tsx:62–80`; `03-patterns.md:14` |
| C-3 | **Error copy is keyed off `error.message`, not `error.code`.** `ErrorView` passes `description={e.message}`, and `ErrorState` uses `props.description ?? copy.description` — so the supplied message **overrides** the code-keyed table. `copyForCode` / `ERROR_COPY` are exported and bypassed; `onUnmappedCode` is never wired, so the gap-reporting the library provides is dead. Rider spec §0.1: "UI copy is keyed off `code`, never off `message`." | `screens/Screen.tsx:93–101`; `feedback/ErrorState.tsx:63–68, 99–100` |
| C-4 | **Network-offline is not a distinct state.** `ErrorState` has an `offline` prop and `OFFLINE_COPY`; nothing passes it. Every failure reads as a server failure. | `feedback/ErrorState.tsx:64`; `03-patterns.md` §5 |
| C-5 | **No dark mode.** `ThemeProvider theme="rider" scheme="light"` hardcoded, and `userInterfaceStyle: "light"` in `app.json`. No `useColorScheme`. Divergence D7 in foundations calls full dark parity "an operational requirement, not a preference" because riders work at night; the field register is specified as Midnight 900/950 chrome "so the screen is not a mirror". The rider dark theme exists and is fully built (`surface.base #171717`, `sunken #000000`). | `App.tsx:214`; `apps/rider/app.json`; `01-foundations.md` §10 D7; `themes.ts` rider.dark |
| C-6 | **No accessibility announcements anywhere.** No `AccessibilityInfo`, no live regions. The offer's 50/25/10/0% announcements, the timeline's per-change announcement, and the "offer announced once on open" requirement are all unimplemented. Explicit accessibility props appear in exactly two files: two on `EarningsScreen`, five in the hand-rolled sign-in gate. Every other screen relies entirely on whatever the library components label themselves. | `grep` across `apps/rider/src`; `02-components.md` §19, §38; `04-accessibility.md` §3 |
| C-7 | **`Text` without a type token, repeatedly.** At least eighteen `<Text>` nodes carry only a colour and fall through to RN's 14pt default — below the rider register's 17pt body and 15pt label floor. Concentrated on the money screens. | `EarningsScreen.tsx:125, 126, 133, 154, 181, 273, 370`; `PayoutDetailScreen.tsx:78, 111`; `ProfileScreen.tsx:156, 193`; `DeliveryHistoryScreen.tsx:98`; `OnboardingScreen.tsx:346, 452, 484, 573, 679` |
| C-8 | **`caption` (12 / 400) carries operational detail.** It is the one style the rider theme does not bump. It currently holds special instructions, distances, item counts, expiry dates, rejection notes, payout failure reasons and timestamps. | `themes.ts` rider `caption: fontSize 12`; cited per screen above |
| C-9 | **`Badge variant="brand"` (the orange action ramp) is the app's status colour.** Used for `ONLINE_IDLE`, `Account active`, vehicle `Active`, `PICKED_UP`, `EN_ROUTE_TO_DROPOFF`, `DELIVERED`, `PAID`, `APPROVED`, `TRANSFERRED`, and every completed onboarding step. Orange is the only colour that means *tap here*. | `RiderHome.tsx:45, 235, 341`; `AssignmentScreen.tsx:89–92`; `EarningsScreen.tsx:201, 311–312`; `OnboardingScreen.tsx:80, 163–182`; palette decision §3 |
| C-10 | **`target.field` (56) is met by `hitSlop`, not by the visuals, and `criticalField` (72) is met nowhere.** `theme.target.min` (56) appears twice in app code, both as a `minHeight` on a loading row; every explicit `Button size` is `md` (44 visible), `lg` (52) or `xl` (60). Hit areas comply (see §0), visible targets mostly do not. `size="xl"` (60) is the rider primary size and is still **12 short of `criticalField`**, which is a size rule rather than a hit-area rule. The `critical` prop that resolves 72 is used zero times, including on rider Accept/Decline — the two actions the token was created for. | `Button.tsx:31–36, 55–58, 114`; `grep -rn "critical" apps/rider/src` → one hit, a doc comment in a test |
| C-11 | **Demo scaffolding sits in the primary content area of the two most time-critical screens**, gated only on the base URL pointing at localhost. | `OfferScreen.tsx:205, 281–291`; `AssignmentScreen.tsx:290–299`; `api.ts:30` |
| C-12 | **Reduced motion, dynamic type and RTL are untested here.** No `fontScale` check at 1.3×/2.0×/3.0× (`04-accessibility.md` §5 requires snapshots); `justifyContent: 'space-between'` rows with two ghost buttons and long labels will collide at 2.0×. Logical properties are used correctly (no `left`/`right` found), so L-7 holds. | `04-accessibility.md` §5, §7 |
| C-13 | **What the app gets right and should not lose in a redesign.** Server-authoritative state throughout (no client-persisted `isApproved`); no client money arithmetic (`cents(Number(x))` is a documented re-brand at the `Price` boundary, `apiTypes.ts:1–12`); no prices on any rider screen; `Idempotency-Key` on every mutation; no timer advances a state; the Stripe redirect is explicitly not trusted; the contract beats the spec on payout minimums; every screen has loading/empty/error branches even where the treatment is wrong. | throughout |

---

## 3. The five worst problems, ranked

### 1. An offer cannot reach a rider who is not staring at the offer screen

**What.** No push, no WebSocket. The only delivery path is a manual mount of `OfferScreen` (`OfferScreen.tsx:117–139`), reachable by tapping through Home or a banner on Availability.

**Cost.** Total. `dispatch.offer_ttl_seconds` is 30 and `dispatch.wave_size` is 3 (spec §0.5): a rider must see, read and decide within 30 seconds or the offer moves to the next wave. A rider riding, waiting outside a restaurant, or with the phone in a pocket receives **nothing**. Every unseen offer is `EXPIRED`, not `REJECTED` — and `EXPIRED` counts against acceptance rate *and* feeds the unresponsiveness counter, so **three unseen offers force the rider `OFFLINE` with reason `UNRESPONSIVE`** (D-10). The app therefore converts its own missing transport into a punishment for the rider. In money: 100% of dispatch. In safety: a rider who learns to check the offer screen manually is a rider looking at a phone while moving.

### 2. Transitions assert a location the rider may not be at, and there is no exception path

**What.** Every transition posts the *destination's* coordinates with `accuracy_m: 5` (`AssignmentScreen.tsx:194, 204–211, 256–262`). No exception action exists in any assignment state (D-32's "single most important rider-safety and data-integrity rule in the domain").

**Cost.** Safety and integrity, together. The geofence can never fail, so `assignment_transition.geofence_ok` is meaningless and the `override_reason` audit trail is empty — which means ops cannot distinguish a rider at a mis-geocoded address from a rider marking arrival from three kilometres away, and the evidence that resolves "I never got my food" is fabricated. Meanwhile the rider who *genuinely* cannot deliver — wrong address, closed restaurant, customer not answering, accident, unsafe situation — has exactly one forward button on screen. The two failures compound: the app makes the false-delivered path easy and the honest path impossible. Add the hardcoded `handover_method: 'LEFT_AT_DOOR'` (`:243`) and the library-fallback POD photo (`capture.ts:63, 68–71`) and the entire proof chain is compromised at the point where the platform's only defence against a dispute is supposed to be built.

### 3. The 30-second decision is rendered at the smallest scale in the app, and Decline is the nearest target

**What.** The countdown is a 26-high tinted `Badge` with 15pt text (`OfferScreen.tsx:226–229`); earnings is a `Price` `xl` next to a body label rather than `display.lg`; Accept is 60 high and not `critical`; Decline is 52 high, gated behind a native picker, and positioned **below** Accept in a ScrollView so it is the control nearest the thumb.

**Cost.** Money, per offer, forever. The rider's whole job at this moment is: read one number (earnings), read one number (distance/time), read one number (seconds left), hit one target. Each of those three numbers is currently at or near the smallest type size on the screen, and the fourth step is the largest risk: an accidental Decline under a 30-second clock is unrecoverable (`04-accessibility.md:75` says so in those words). Every misfire is one delivery's earnings plus an acceptance-rate hit that feeds the dispatch score (D-17).

### 4. Going online is three interactions, and staying dispatchable depends on staying on one screen

**What.** The availability toggle is behind a navigation push (`RiderShell.tsx:95`, `RiderHome.tsx:249–256`), and `useLocationReporting` is mounted by `AvailabilityScreen` alone (`AvailabilityScreen.tsx:116–118`), so position reporting stops the moment the rider navigates away.

**Cost.** Silent, continuous, and invisible to the rider. 120 seconds after leaving the Availability screen the server moves them to `ONLINE_STALE` — **not dispatchable, still "online" in the UI** (spec §0.4). The rider believes they are working. They are not receiving offers, they have no signal that anything is wrong (`tracking_health` is in the dashboard payload and is never rendered), and the app's own "Online — idle" badge actively reassures them. Combined with problem 1, a rider can be online for an hour and earn nothing with no explanation available anywhere in the interface.

### 5. The delivery screen drops the fields that stop the rider making the wrong handover

**What.** `items[].allergen_tags`, `items[].note`, `items[].addon_names`, `dropoff.buzzer`, `dropoff.delivery_instructions`, `pickup.order_state`, `pickup.pickup_notes`, `pickup.phone_alias`, `dropoff.phone_alias` and `tracking_health` are all in the `Assignment` payload and none is rendered. `special_instructions` *is* rendered — in `caption` 12pt `text.tertiary` (`AssignmentScreen.tsx:342–346`), the least prominent text on the screen. And the seal attestation defaults to "intact" and submits on camera aim (`SealScanCard.tsx:36, 60, 106`).

**Cost.** This is where the product's single claim reaches the rider's hands, and it is where the interface says least. D-19 requires allergen and halal notes as chips "so the rider does not swap bags" — a swapped bag on a halal platform is not a service failure, it is a breach of the one promise the company makes. The buzzer omission and the missing contact aliases turn a two-minute handover into a ten-minute one at every apartment building in Toronto. A pre-checked seal attestation that fires when the camera focuses means the integrity half of the chain-of-custody guarantee records "intact" by default — an optimistic trust assertion of exactly the kind invariant 8 forbids.

---

## 4. Redesign direction

Everything below follows from one sentence: **a rider gets two seconds, one thumb, and no second chance.** The operating context is not a constraint on the design; it is the specification.

**1 · Work comes to the rider; the rider never goes looking for work.**
The offer is a layer, not a destination. It arrives over the socket and over push, it lands at `zIndex.offerSheet` (700) above everything including toasts, it cannot be dismissed, and it closes only when the server's clock says so. No screen in the app should ever contain a button that means "check whether I have work". The `Sheet variant="full" dismissible={false}` already in the library is the whole mechanism; the missing half is the transport.

**2 · One screen, one job, one target — and the target is at the bottom edge.**
`04-accessibility.md:237`: "One-handed reach: every primary action in the bottom third." Today the primary action is wherever the scroll happens to put it. Every rider screen should be: a fixed header stating *where you are*, a scrollable middle stating *what you need to know*, and a **fixed footer holding the one action**, at 72 when the action is irreversible under time pressure and 56 otherwise. If a screen has two primary actions, one of them is not primary.

**3 · Size is the hierarchy. Colour is only the confirmation.**
In sunlight and in rain, colour is the first thing to go and size is the last. So the three numbers a rider actually reads — seconds remaining, money, distance/time — get `display.lg` (36/700) and `heading.xl` (24/700), in that order, and everything else falls back. Nothing operational is ever set in `caption` (12pt), because `caption` is the one style the rider register does not bump. Reserve `caption` for timestamps and disclaimers, which is what foundations §3.3 says it is for.

**4 · Orange means tap. Nothing else may be orange.**
Per the palette decision, action is `#F1521E` "so green never means 'tap here'". That protection is only worth something if the converse holds: **status is never the action colour.** Replace every `Badge variant="brand"` used for a state with `neutral`, `info`, `outline`, or — where the state is genuinely good news — a word. A glance should find exactly one orange thing on screen, and it should be the thing to tap.

**5 · Never optimistic, never fabricated, never red on a halal state.**
The app already refuses to compute money and refuses to persist approval flags. Extend the same discipline to everything it currently invents: the fabricated "Since" time, the destination coordinates, the hardcoded `accuracy_m: 5`, the hardcoded `handover_method`, the pre-checked seal attestation, the hardcoded assignment UUID. Each of these is the same bug — a client asserting something it does not know. And on the halal and seal side specifically: a broken seal is **cool slate and a route to support**, never red, never "haram" language (invariant 9; `handoff-verification.md` "Halal tie-in").

**6 · Every state the rider can be in must be visible on the screen they are on.**
`ONLINE_STALE` is the clearest example: a server state that means "you are earning nothing" and that the UI currently renders as "Online — idle". Same for `tracking_health != HEALTHY`, a queued offline transition, a pending POD upload, and a held payout. The rule: if a server field changes whether the rider makes money, it gets a persistent `Banner` with a one-tap fix, not silence.

**7 · Dark is the default register, not a preference.**
Unlock the scheme. Read `useColorScheme()`, drop `userInterfaceStyle: "light"` from `app.json`, and let the fully-built rider dark theme do its job. A cream `#FFFAEA` canvas at maximum brightness at 11pm is a lamp pointed at the rider's face, and foundations D7 already decided this.

**8 · The rider always has a way out that is not a lie.**
An exception action on every assignment screen, from `ASSIGNED` onward. This needs a contract change (§6) — until then, the escape hatch that *does* exist (`/v1/orders/{orderId}/handoff/tamper-report`) plus a support route should be surfaced rather than leaving the rider with one forward button and no alternative.

**9 · Loading has geometry; failure has a cause and a next step.**
Replace `LoadingView` with per-screen skeletons in the real layout, and stop passing `error.message` as `description` so the code-keyed copy table can do the work it was built for. Wire `onUnmappedCode` so the gaps become discoverable instead of invisible.

**10 · Demo scaffolding lives behind a gesture, not in the content.**
Scenario pickers move out of the primary column entirely — a long-press on the AppBar title, or a debug row at the very bottom. Never between the offer and the Accept button.

---

## 5. Screen-by-screen redesign brief

All components named below exist in `@hg/ui-native` today unless marked **[library gap]**. No new primitives, no new tokens.

### 5.1 Offer — `Sheet variant="full" dismissible={false}`

**Structure.** Not a route. A layer owned above the router, opened by a socket/push event, deduped on `offer_id`, mounted at `zIndex.offerSheet`.

Visible without scrolling, in this order, on one screen with no scroll at all:

1. **Countdown, top centre.** The numeral in `display.lg` (36/700), tabular figures, with the ring. Server-anchored from `expires_at − server_time`, `easing.linear`, `normal → urgent (<25%, warning) → critical (<10%, danger + 1 Hz pulse, suppressed under reduced motion)`. **[library gap: `Countdown` — `02-components.md` §38, not exported. See §6.]** Until it ships, compose the numeral from `Text` + `useTypeStyle('display.lg')` with `fontVariant: ['tabular-nums']` and a `Skeleton`-free linear bar; the skew hook at `OfferScreen.tsx:84–101` is already correct and should be lifted out of the screen.
2. **Earnings in `display.lg`**, with the breakdown directly beneath in `label.lg`: base · distance · surge · tip so far, each through `Price`. All four fields are in `OfferEarningsEstimate`.
3. **`MapView`** at `height` ≈ 180, `interactive={false}`, `follow="fit-all"`, `restaurant` and `customer` pins from the offer's lat/lng, `summary` = "Pickup {restaurant}, {x} km. Drop-off {area}, {y} km, {z} min" — which is also the screen's accessible content and the fallback when tiles fail.
4. **Pickup / drop-off block** in `heading.md` (restaurant name) + `body.lg` (address / area), with distance and `est_duration_s` per leg in `label.lg` — never `caption`. Drop-off stays street + neighbourhood; the unit arrives on accept.
5. **Item count + weight class** as a `Chip` row.
6. **Fixed footer, outside the scroll:** `Button critical` (72) **Accept**, full width, at the bottom edge. `Button critical` (72) **Decline** above it with ≥24 between them, or — better, and cheaper for the rider — Decline opens the reason `Sheet` *after* the offer is already declined server-side is not permissible (D-17 requires the code with the reject), so: Decline is a 72 `tertiary` button that swaps the footer for a reason list of `Chip variant="choice"` rows at 56 each, one tap = one POST. No native picker under a countdown.

**States.** `pending` · `accepting` (Accept `loading`, both blocked) · `expired` (footer replaced by "Offer expired", 3 s, then the sheet closes — `onExpire` fires once, idempotently) · `withdrawn` (`dispatch.offer_withdrawn` reason → close with the reason) · `duplicate` (deduped on `offer_id`, one sheet). A late offer whose `expires_at` has passed renders **nothing** and re-pulls.

**Loading.** The sheet opens from the push payload and the countdown starts immediately; secondary fields are `Skeleton`s; **Accept is enabled the whole time**.

**Announce.** Once on open, in full. Then at 15 / 10 / 5 s only.

**Also required, outside the design system:** sound + haptic that fire in silent mode when `ONLINE_IDLE`.

### 5.2 Home / Shift — three modes off `GET /v1/riders/me/dashboard`

**Structure.** `AppBar` (no back, never scroll-hidden) + one mode layout + `BottomNav`. One call. No menu.

- **`OFFLINE`:** today's `Price` in `display.lg` with trips beneath → **a full-width 72-high "Go online" control right there** (a `Button critical` that PUTs availability, with the `Switch` semantics of not moving until the server answers) → if `blocking_reasons[]` is non-empty, the button is replaced by a `Banner variant="warning"` per reason, each with its own 56 action that deep-links to the fix. Empty state: "No trips yet today. Go online to start receiving offers."
- **`ONLINE_IDLE`:** `MapView follow="rider"` filling the upper half → "Waiting for offers · online 42 min" in `heading.lg` (this is the **working** state, not an empty one) → today's earnings + trips → surge if any → a 56 "Go offline" `tertiary` in the footer.
- **`ON_DELIVERY`:** a full-width `OrderCard variant="rider"` built from `active_assignment`, with a 72 `Button` **"Resume delivery"** in the fixed footer, deep-linking to the correct step from `assignment.state`. This replaces the hardcoded UUID and is the crash-recovery path.

Persistent across all three: a `Banner variant="warning"` when `tracking_health != HEALTHY` with a one-tap deep link to permissions/battery settings, and a `Banner` when a transition or POD upload is queued offline.

**Loading.** 5 s server cache renders instantly; `Price` in its `loading` state (skeleton at exact glyph width); never a stale or client-computed number. **Error while `ON_DELIVERY` cached:** the assignment card renders from cache with a "Reconnecting" `Banner` and the action stays live — transitions are idempotent.

**Move the account menu out.** Earnings, history, profile belong to the `BottomNav` tabs and the Profile screen, not to six buttons on the shift screen.

### 5.3 Availability — fold into Home, keep the blocking-reason screen

The toggle belongs on Home (5.2). What survives as its own surface is the **"why can't I go online"** case: the `blocking_reasons[]` list, one `Banner` per reason at `body.lg`, each with a 56 action, plus the continuous-online cap warning. Keep the server-authoritative `Switch` semantics and the code→copy map exactly as built (`AvailabilityScreen.tsx:54–64`) — they are correct.

**Move `useLocationReporting` to the shell**, keyed off the dashboard's `mode`, so reporting follows the *shift*, not the screen. Delete the fabricated `since`; render online time from `today.online_seconds`, which is a real server field.

### 5.4 Assignment — one step, one action, at the edge

**Structure** (per `03-patterns.md:256`, every state):

1. **`MapView`** strip, `height` ≈ 200, `follow="rider"`, route for the current leg, `summary` carrying the address and ETA as the accessible content and the tile-failure fallback. An `IconButton` (56) on the strip hands off to the device navigator — deep link built from `vehicle_type` (`d|b|w`), not hardcoded `driving`.
2. **The objective in `heading.xl`** — "Go to Al-Noor Grill", "Hand over to Amina K." — so the answer to "what do I do next" is the largest text on the screen.
3. **Address block** in `body.lg`, with **unit and buzzer at equal weight** (a buzzer code in 12pt is a buzzer code nobody can read), and two 56 `IconButton`s: call restaurant / call customer, from the `phone_alias` fields already in the payload.
4. **`delivery_instructions`** as `Chip`s, and **`special_instructions` verbatim in `body.lg` inside a `Banner variant="info"`** — never truncated, scrolls if long. This is the field that determines the POD method; it should be impossible to miss.
5. **Items** as rows at `density.rowHeight` (72): quantity + name in `body.lg`, add-ons and the item note beneath, and **`allergen_tags` as `Chip tone="warning"`**. The halal/allergen chips are the reason this section exists.
6. **At pickup only:** `pickup.order_state` as the ready/not-ready fact in `heading.md`, and a wait clock from `arrived_pickup_at` (the wait-pay component starts here) — so the rider can see the eight free minutes running.
7. **Fixed footer:** exactly one 72 primary action, at the bottom edge. Plus a persistent, visually quieter **"Something's wrong"** route (`tertiary`, 56) that opens the exception `Sheet` — D-32's non-negotiable forward path. **[contract gap — see §6.]**

**Geofence.** Send the rider's **real** fix and real accuracy from `location.ts`. On `422 GEOFENCE_REQUIRED`, show the measured distance inline and offer the override, which requires a typed reason (`override_reason`, min 5 chars, already in the contract) — a rider at a mis-geocoded address must not be stuck, and ops must be able to see which is which.

**POD.** Camera only, no library fallback. Viewfinder at 4:3 with the instruction enum overlaid as a reminder. OTP as `Input variant="otp"` (four cells). After five failures, a real `PHOTO_WITH_ATTESTATION` path with `attestation_reason`. **Ask for `handover_method`** — four `Chip variant="choice"` rows at 56 — instead of writing a constant.

**Delivered.** Not a `Banner`. A per-delivery breakdown from the server's response to the `DELIVERED` transition: gross in `display.lg`, components beneath through `Price`, then a 72 "Back to shift". This is the rider's payday moment and currently it is four words of body text.

**Seal scan (both phases).** Reverse the attestation: the camera scan establishes *identity* and submits nothing about integrity; **integrity is a deliberate, explicit choice after the scan** — two 72 `Chip variant="choice"` or `Button` options, "Seal intact" / "Seal broken or missing", neither pre-selected. "No seal on this package" moves out of the ghost-button pair into a `tertiary` 56 control with a one-line confirm, so it cannot be hit by accident; and per the handoff doc, a broken seal is recorded and **never blocks the handoff**, framed in slate, never red, never "haram".

### 5.5 Earnings

**Structure.** `Tabs` (already right) → period as `Select variant="inline"` segmented or a second `Tabs` row, not a native picker → total in `display.lg` through `Price` → components (`delivery`, `tips`, `bonus`, `adjustment`) as 72-high rows → unpaid balance + next payout date pinned near the top → bucket list → ledger rows.

**Every ledger row is a 72-high pressable row** opening a per-delivery breakdown with the D-26 components. Put `order_code` and the restaurant where they can be read at a glance, `earned_at` as a short relative date, and give `ADJUSTMENT` / `CLAWBACK` rows their reason inline.

**Loading:** `Price loading` for the total, five row skeletons in the real geometry. **Error:** no number at all rather than a wrong one — this is already the rule and the copy should say it. `loadMore` gets a `catch` and a retry affordance.

### 5.6 Payout detail

Header: the period in `heading.xl` (it is the screen's identity), state as a `Badge`, amount in `display.lg`. `FAILED`/`HELD` promote to a `Banner variant="danger"`/`warning` at the top with code-keyed copy, not raw `failure_message` in 12pt. Entries as 72-high pressable rows linking back to the delivery. Add the empty and loading states. Add the statement affordance D-28 requires.

### 5.7 Profile

Identity card with `Avatar lg`, name in `heading.lg`, **human copy for `account_status` / `onboarding_state`** (a map, like `BLOCKING_COPY` — never the raw enum). Vehicle as a labelled row. Documents as 72-high pressable rows with state `Badge` at `md`+, formatted expiry in `label.lg`, and a preview — **[library gap: `DocumentViewer`, `02-components.md` §25]**. Settings section (notifications, `go_offline_after_delivery`, timezone, support). **Sign out is separated by `space.8`, styled `tertiary` with `destructive` copy, and confirmed through `Modal variant="confirm"` with focus on Cancel** — it is not the fourth identical button in a stack.

### 5.8 Delivery history

Keep the honest ledger-as-history decision and **say it in the subtitle** rather than promising "every completed trip". Group by day with `Divider label`. Rows at 72: restaurant or order code in `body.lg`, gross through `Price`, short relative date in `label.md`, status `Badge md`. Pressable → the same per-delivery breakdown as Earnings. Five row skeletons; `loadMore` with a `catch`.

### 5.9 Onboarding

`StatusTimeline variant="horizontal"` driven by `onboarding_state` — the specified instrument, and the one that shows *current* rather than only *done*. **Show only the documents the rider's `vehicle_type` requires.** Replace the typed expiry field with a date control and stop pre-filling a plausible wrong value. Capture buttons at 56. Show a thumbnail of what was captured so an unreadable photo is caught before review, not after. Rejection notes in `body.lg` inside a `Banner variant="warning"`, not 12pt caption. Keep everything else — the server-driven step, the three-call upload, the untrusted Stripe redirect, the specific error codes. This screen's logic is the best in the app; it is the presentation that is off-register.

### 5.10 Shell, nav, sign-in

**Shell.** Tabs stay three. Rename "Deliveries" to "History" and let the **live assignment own a persistent resume affordance** (the `ON_DELIVERY` Home mode plus a sticky strip above the `BottomNav` on any other tab). The detached action button either becomes a real availability toggle with a correct glyph and one stable label, or it goes away — a circular button that navigates is not a primary affordance.

**Offer layer.** Lift it above the router so it can occupy `zIndex.offerSheet`, and remove `offer` from `RiderRoutes` entirely so it cannot be pushed, popped or backed out of.

**Assignment.** No back chevron. Leaving a live delivery is an explicit action, not a chevron.

**Sign-in.** Rebuild inside `ThemeProvider` from `Input variant="tel"`, `Input variant="otp"`, `Button size="xl"` at 56+, `Banner` for errors. Zero raw hex. **The CTA is orange.**

---

## 6. What I could not determine, and what I would need

**1 · `Countdown` is specified and not built.** `02-components.md` §38 defines it precisely (required `expiresAt` + `serverNow`, no `seconds` prop, `ring|bar|text`, `urgentThreshold` 0.25, `criticalThreshold` 0.1, linear only, assertive announcements at 50/25/10/0%, `allowFontScaling={false}` as the single registered lint exception). `grep -rn "Countdown" packages/ui-native/src` finds only doc comments referring to it — `OrderCard.tsx:17, 46, 70` and `ThemeProvider.tsx:77, 186` all assume it exists. **I cannot design the offer sheet's primary instrument without it, and I will not invent a primitive.** I need a decision: does the frozen library ship the missing §38 `Countdown` (my recommendation — it is one of the documented 41, not an addition), or does the offer compose the numeral inline and accept losing the ring, the announcements and the font-scaling exception? Same question, lower stakes, for **`ListRow`** (§39, "the most-used component in the system after `Button`") and **`DocumentViewer`** (§25) — both specified, neither exported.

**2 · There is no contract for the rider's way out.** D-32 calls the exception path the most important rule in the domain, and `contracts/openapi.yaml` has no rider exception, incident, or support endpoint (rider paths: `:3617–4340`). Nor is there `POST …/contact` (D-24 masked call + templates), `GET …/route` (D-22 server-computed polyline/ETA), `GET …/performance` (D-29), `GET …/notifications` (D-33), or `GET …/assignments?status=…` (D-30 history). Since the contract is authoritative, **these features cannot be designed into the app until the contract widens.** I need to know which of them are in V1 scope, because three of my five worst problems are partly downstream of this. The `phone_alias` fields *are* already in the `Assignment` payload, so masked calling via `tel:` is available today without a contract change — that is the cheapest safety win on the board.

**3 · I could not run the app.** This audit is a code-and-spec read. I have not seen it on a phone, in sunlight, at night, or at `fontScale` 2.0×. Specifically unverified: whether the offer screen's content exceeds the viewport on a small device (which determines whether Decline really is the nearest target — I believe it is, from the layout, but a screenshot would settle it); whether `MapView` falls back to its text panel on every build (the `react-native-maps` stub at `shims/react-native-maps.js` returns `{}` and `@rnmapbox/maps` is excluded from autolinking in `package.json`, so I expect the text path always, on device as well as web — **if so, no map is currently possible at all**, and that changes 5.1 and 5.4 materially); and whether the `space-between` ghost-button rows collide at 2.0× type. I would want device screenshots at 1.0× and 2.0×, light and dark, plus one outdoor photo at midday.

**4 · Two contrast figures are mine, not the system's.** `#ccc` on `#fff` ≈ 1.61:1 (sign-in field border, below the 3:1 for a control boundary) and rider `text.tertiary` `#4A4E48` on `#FFFAEA` ≈ 8.1:1 (which **passes** the 7:1 field requirement — so my objection to `caption` usage is about size and rank, not contrast). `docs/design/contrast.check.mjs` is referenced by `01-foundations.md` §8 as CI-blocking and I did not find it in the repo; I could not confirm the `_pairs` table is actually being checked. Worth verifying before trusting any contrast claim in this document, including the system's own.

**5 · Two product questions I must not answer.** (a) The offer's tip visibility is an open decision in the spec (D-26, "tip visibility before accept") while the contract already ships `tip_so_far_cents` and the app renders it — I have designed to the contract, but the decision is recorded as unresolved. (b) The seal programme's phasing (`handoff-verification.md`: v1 software, v1.x physical stock) determines whether "No seal on this package" is an edge case or the common path at launch. If most orders have no seal at launch, the escape hatch is the main flow and needs to be designed as such rather than hidden behind a confirm.

**6 · Screen count.** The brief says eight screens; `apps/rider/src` contains nine renderable screens (`RiderHome` plus eight under `screens/`), and two further surfaces that own decisive interactions: the sign-in gate inside `App.tsx` and `SealScanCard`. All eleven are audited above. If the intended eight excluded something deliberately, say which and I will drop it.
