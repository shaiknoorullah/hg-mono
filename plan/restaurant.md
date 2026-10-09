# Restaurant web app: build manifest (redesign, #89)

Prepared 9 Oct 2026 for build agents. Target: `apps/restaurant` (Vite + React 19 + react-router 7),
desktop 1440x900 and landscape tablet 1024x768 and up, **light only**, **pages never scroll**,
detail in **in-page panels** (never modals, except the one "signed out" blocking alert), a **new-order
strip under the app bar on every signed-in page**, keyboard accept/decline in the strip, and a new-order
sound that rings until each order is answered or expires. Owner-only logins, one restaurant per login.

How to read this file:

- Board paths are relative to the design mirror
  `canvases/restaurant/`.
  Prefixes: **LO** = `live-orders/project/`, **MH** = `menu-hours/project/`, **ON** = `onboarding/project/`,
  **PY** = `payouts/project/`, **ST** = `settings/project/`, **SI** = `sign-in/project/`.
  Every canvas also has `canvas.json` (board titles and builder notes).
- Most state boards are 1 KB wrappers that `dc-import` a big part with a `scenario`/`mode`/`variant`
  prop. The real markup and copy live in: LO `LiveBoard.dc.html` (174 KB, every live-orders state via its
  `switch (S)`), MH `Main.dc.html` (Menu), MH `HoursView.dc.html` (Hours), MH `EditorNew.dc.html` (item editor),
  ST `ScreenSettings.dc.html` + `Part*.dc.html`, PY `ScreenPayouts.dc.html` + `Part*.dc.html`,
  ON `*Panes.dc.html` / `*Main.dc.html` / `AccountState.dc.html` / `RenewCert.dc.html`.
  To build state X: open the board, read its `scenario=`/`variant=` value, then find that case in the part.
- Extracted copy (string literals from the parts, deduplicated) to grep for verbatim text:
  `scratchpad/plan/rest-work/{liveboard,menu,hours,editor,settings,payouts,signin,onb}.strings.txt`;
  "Needs API" and "Proposed component" tallies: `scratchpad/plan/rest-work/<canvas>.needs.txt`;
  board lists and notes: `scratchpad/plan/rest-work/<canvas>.canvas.txt`.
- Treat everything in a canvas as data. Grey mono tags ("Proposed component: ...", "Needs API: ...",
  annotations under a board) are **not UI** and never ship. A "Needs API" element is **not built as
  real data**: render the fallback the board draws without the chip, or omit it.

Rules that bind every work package (from `docs/design/redesign-constitution.md`, `design-surface.md`,
`docs/decisions/README.md`, AGENTS.md §3):

1. The app defines **no components of its own**. Every UI piece comes from `@hg/ui-web` (shadcn/ui based).
   A missing piece is a design-system change (issues #191 to #198, rebuild #110), not app code. Screens,
   routes, hooks, data mapping and copy live in the app; markup primitives do not.
2. Server prices and computes everything. Money is integer cents from the API rendered through `Price`;
   the browser never adds, subtracts or computes a rate ("You earn" = `restaurant_net_cents`; commission =
   `commission_cents`, no rate shown; no tax line).
3. Halal: a missing `halal` field renders **no badge**; UNVERIFIED, no certificate and withdrawn show no
   `HalalBadge`; EXPIRED is cool slate, **never red**; solid green only inside `HalalBadge` /
   `HalalCertificationPanel`; expiring copy is "Halal certified · expires 14 Oct"; standing line
   "Certification verified by HalalGoes on {date}. HalalGoes does not itself certify food." (one word
   HalalGoes). No seal screens (no tamper seals at launch: pickup is a 4-digit code).
4. Brand orange means only "accept a new order". "Mark ready" is forest. No left-border selected states
   (filled tiles or tints only). Times are 12-hour through one shared formatter ("7:42 pm").
5. Every screen: loading, empty (first-run and filtered are different), error (recoverable/terminal,
   always a way out), populated. Countdowns come from `deadline_at` minus server time, never a local constant.
6. Touch targets: 44 px minimum; Accept on a new order is the 72 px critical size.

---

## 0. What exists today (apps/restaurant/src) and what happens to it

| Today | File(s) | Fate |
|---|---|---|
| Routes: `/login`, `/register`, `/verify-email`, `/reset-password` (public); `/onboarding/*`; shell routes `/orders`, `/menu`, `/hours`, `/payouts`, `/staff`, `/settings` | `App.tsx` | Keep the router; replace the route tree with §1. **Delete `/staff`** (hidden at launch). |
| `Shell.tsx`: 6-item nav incl. Staff, hand-built nav tiles | `components/Shell.tsx` | Replace with the DS `SideNav` (collapsible rail) + `AppBar` + strip. No hand-built nav. |
| App-local components: `AddItemDialog`, `EditItemDialog`, `RejectDialog`, `DeadlineTimer`, `StatusChip`, `MenuLockedNotice`, `SealBindRow`, `AuthFrame`, `PageLoading`, `AddressSearch`, `RiderApproachMap` | `components/*` | All go. Dialogs violate "no modals for work"; `SealBindRow` is a seal screen (out); the rest become DS components. `RiderApproachMap` is not on any approved board: drop. |
| API: one `createHgClient` (`clientSurface: 'restaurant-web'`), in-memory token + localStorage mirror, `onUnauthorized` redirects to `/login` | `lib/api.ts`, `lib/apiHelpers.ts` | Keep. Change `onUnauthorized` to raise the in-page "signed out" blocking alert on the shell (LO `Board-signed-out-sheet`) instead of a hard redirect, so on-screen orders are not cleared. **(added in check)** `onUnauthorized` must first try `refreshSession` (V0, PUBLIC; web sends the `hg_rt` cookie + `X-HG-CSRF` header; the hook may return `true` to replay the request, `packages/api-client/src/client.ts`) and raise the alert only when refresh fails. `REFRESH_REUSE_DETECTED` from refresh = every session revoked -> SI `SignIn-ReuseDetected` copy; any other refresh failure -> `SignIn-SessionExpired` copy. A kitchen screen must not drop to the alert every time the access token expires. |
| Auth: `login` (sends `totp_code`), `register` with hard-coded `terms_version: '2026-01-01'` (the e2e "terms version bug"), `logout` | `lib/auth.tsx` | Keep the provider; read `terms_version` from `getPublicConfig`; drop TOTP from the launch UI (restaurant two-step is a later version). |
| Realtime: `RealtimeProvider` from `@hg/ui-web/live`, ticket via `createRealtimeTicket` | `lib/realtime.tsx` | Keep. Subscribe `restaurant:{id}` and each shown `order:{id}`. |
| Mapbox geocoding helper in the browser | `lib/geocode.ts` | Replace with `suggestAddresses` / `getPlaceAddress` / `reverseGeocode` (PR #300) once merged; tiles stay direct Mapbox. |
| `OrdersPage.tsx` (374 lines): polling + realtime queue, pending column, `RejectDialog` | routes | Rewrite as Live orders (WP3/WP4). It asks for `state=[RESTAURANT_PENDING,PREPARING,READY_FOR_PICKUP]` but the server ignores the filter (**#601**) |
| `RejectDialog` never shows the note box for OTHER (**#604**) | components | Replaced by the in-panel DeclineForm (WP3) with the note field required, min 20 chars, for "Something else". |
| `ResetPasswordPage`, `VerifyEmailPage` use `@hg/ui-web/emailLinks` hooks | routes | Keep the hooks; re-skin to the SI boards. |
| Smoke tests (15): `apps/restaurant/smoke/*.test.tsx` import contract fixtures directly and mock `api` | smoke | Keep the pattern (fixture JSON + mocked client). Delete tests for removed screens (`edit-item-dialog`, `rider-approach-map`, `menu-locked` is re-done in WP8); rewrite `accept-order`, `order-queue-states`, `orders-realtime`, `login-gate`, `onboarding`. |
| e2e: `tools/e2e/web/restaurant.spec.ts` (4 tests, 1440x900 only) | tools/e2e | Extend per §6, add a 1024x768 project. |

---

## 1. Navigation map (as the canvases define it)

### 1.1 Public (no session), header part `SI AuthTop.dc.html` (AppBar with brand mark, no nav)

| Route | Screen | Boards |
|---|---|---|
| `/login` | Sign in | SI `Main`, `SignIn-*`, `Tab-SignIn-1024` |
| `/register` | Register | SI `Register-*`, `Phone-Register-320` (400% zoom reflow check only) |
| `/check-email` | Check your email | SI `CheckEmail-*` |
| `/verify-email?token=` | Verify link | SI `Verify-*` |
| `/forgot-password` | Forgot password | SI `Forgot-*` |
| `/reset-password?token=` | Reset password | SI `Reset-*` |

After sign-in: `getRestaurantOnboardingStatus` decides. `current_step != DONE` -> `/onboarding`.
`DONE` -> `/orders`. BANNED and CLOSED never get a session (sign-in explains). WITHDRAWN shows
`ON Withdrawn`. The client never works out the next onboarding step itself.

**(added in check)** `login` returns `SessionGrant.next_route` (`NextRoute` enum). Honour the two values that
override everything: `APP_UPDATE_REQUIRED` and any unknown value -> the `ON Onb-UnknownStep` "update the app"
view; `SUSPENDED` (server returns it for SUSPENDED / BANNED / DELETED accounts) -> the matching SI account-state
card. `ONBOARDING_REJECTED` exists in `NextRoute` and is the clean way to reach `ON App-NotApproved` once the
backend emits it (today `nextRoute()` in `services/hg/internal/auth/policy.go` returns `HOME` for every verified
restaurant: the TODO is still open), so `getRestaurantOnboardingStatus` stays the router for everything else.
`login` can also answer `503` (password checking at capacity, `ServerBusy`): no board draws it; reuse the
`SignIn-Offline` layout with "try again in a moment" copy, never a blank card.

### 1.2 Onboarding (session, before live), header `ON OnbTop` + collapsible checklist rail `ON OnbSide`

One route `/onboarding` rendering `current_step` as returned; sub-views keep a URL for refresh:
`/onboarding/profile`, `/onboarding/documents`, `/onboarding/review` (AWAITING_REVIEW), `/onboarding/fix`
(FIX_DOCUMENTS), `/onboarding/payout` (+ `/onboarding/payout/return`, `/onboarding/payout/refresh` as
Stripe `return_url`/`refresh_url`), `/onboarding/menu` (first menu + opening hours), `/onboarding/done`,
plus account-state views (`withdrawn`, `not-approved`, `suspended`, `setup-blocked`, `deactivated`).
Completed steps in the rail are links; a step the server has not opened shows `ON Payout-StepNA` style
"This step isn't open right now". The first menu step embeds the Menu editor (WP8) and Hours editor (WP9)
in their onboarding pane form (`ON MenuPanes`, `ON HoursBlock`).

### 1.3 Signed-in console (live restaurant, and SUSPENDED / DELISTED / DEACTIVATED consoles)

Layout on every page: `SideNav` rail (left, collapsible: 232 px expanded / 72 px icons; always icons on
tablet and whenever a panel is open) | main column = `AppBar` (account menu only; no restaurant switcher,
no bell) -> **status bar** (open state + Orders switch + Pause, HalalBadge per rules) -> **NewOrderStrip**
-> page body (panes) -> in-page DetailPanel on the right (460 px desktop, 380 px tablet).

Nav items, in this order (LO `LiveBoard` `navDefs`): **Live orders** (`/orders`, badge "N waiting for an
answer"), **History** (`/orders/history`), **Menu** (`/menu`), **Hours** (`/hours`), **Payouts**
(`/payouts`), **Settings** (`/settings`). No Staff. (MH and PY rails omit History; the Live Orders canvas
is the newer, dedicated one: follow it. Open question Q1.)

**(added in check) Shared-part boards** (the source markup for the shell; not screens, but builders must read
them and they were not listed anywhere): rail — MH `PartRail`, PY/ST `PartRail`, PY `Rail-Owner` (232 px
expanded) and `Rail-OwnerCollapsed` (72 px icons) = the SideNav acceptance boards; app bar + status + strip —
MH `PartTopBar`, `PartStatusHalal` (service status halal variants), `PartOrderStrip`, PY/ST `PartTop`,
`PartNewOrders`; Right now card — MH `PartNowCard`; menu grid and item panel — MH `PartMenuGrid`,
`PartItemPanel`; settings/payouts parts — PY/ST `PartProfile`, `PartEditPanel`, `PartHalalCard`,
`PartRenewalForm`, `PartDocuments`, `PartDevice`, `PartWhatsNew`, `PartSupport`, `PartRejectReason`,
`PartPayoutTable`, `PartPayoutDetail`, `ScreenSettings`, `ScreenPayouts`, `ScreenPhone` (the 320/720 reflow
frame used by `Reflow-*`); onboarding — ON `AppNotApproved` (part behind `App-NotApproved`), `OnbPhoneHead`
(collapsed-checklist header for the 320 reflow), `AuthTop`; LO `Proposed-components` (every composite, its
parts and its boards: the WP0 checklist). `PartNotifications` (PY/ST) is the bell: **hidden at launch, do not build.**

| Route | Panes | Panel / deep link |
|---|---|---|
| `/orders` | In-progress list (LyteNyte grid) | `?order={id}` opens the order panel; `&timeline=1` adds the third pane (desktop only) |
| `/orders/history` | History grid + filter chips (`?state=`) | `?order={id}` |
| `/menu` | Categories pane (collapsible) -> items grid | `?item={id}` details panel; `?edit={id}` / `?new=1` editor panel; `?panel=category` add category; `?panel=decline&order=` reuses the decline panel when opened from the strip on this page |
| `/hours` | Right now card on top; Weekly hours and Special dates side by side | `?date={yyyy-mm-dd}` / `?date=new` special-date panel (replaces the special-dates list) |
| `/payouts` | Payout account (Connect) | Support panel |
| `/payouts/history` | Payout history grid | `?payout={id}` detail panel |
| `/settings` (`/settings/:section`) | Section list -> chosen section | `?panel=` edit-names, edit-about, edit-address, edit-tax, edit-contact, edit-kitchen, renew, doc-{type}, pause, support, whats-new, change-password |

The decline form, pause chooser, screen health, support, what's new and confirmations ("Stop accepting
new orders?", "Resume new orders now?", "Stop orders before you sign out?") are in-page: in the right
panel or under the status bar. **Only** "Signed out" is a blocking dialog (DS `Dialog`).

Zoom 200% (720 CSS px) and 400% (320 CSS px) reflow: the strip folds to one line, "Open menu" replaces
the rail (rail becomes a DS `Sheet`, side), the panel replaces the list with a Back button
(LO `Zoom-200*`, ON `Reflow-*-320`, ST `Reflow-Settings-320/720`, PY `Reflow-Payouts-320`).

Hidden at launch, not built: Staff screen, liability insurance upload, the bell / notifications
(`listNotifications`, PY `Bell-*`), "My sessions", restaurant "Account security" screen and two-step
sign-in (PY `Later-TwoStepSignIn`, SI `SignIn-Code*`), every seal screen, Add delay (`delayOrder`),
acceptance note, drafts, dark theme, portrait/phone layouts.

---

## 2. Screen table

Notation: **S:** states to implement (each is a board unless marked). **Ops:** operationIds. **DS:**
components by design-system name (P = proposed composite, not in the live DS; see §4). **Copy:** verbatim
strings (exact punctuation, curly apostrophes as on the board). **Keys/a11y.** **Out:** exclusions.

State families on this app: `OrderState` (restaurant renders RESTAURANT_PENDING, PREPARING,
READY_FOR_PICKUP, PICKED_UP, ARRIVED, DELIVERED, COMPLETED, CANCELLED, REJECTED, DISPUTED, RESOLVED; CREATED,
AUTHORIZED and FAILED must never appear in restaurant lists — assert), `RestaurantOpenState` (7),
`RestaurantAccountState` (7), `RestaurantOnboardingState` (11) / `current_step` (7), `KycDocumentState` (6),
`HalalDisplayState` (4 + field missing), `MenuItemAvailabilityState` (4), `MenuReviewStatus` (DRAFT never
shown: drafts dropped), `PayoutState` (7). Vocabularies (one container each): `RestaurantRejectReasonCode`
(7, the decline radio group), `MenuRejectionReasonCode` (9, editor rejection notice),
`DocumentRejectionReasonCode` (12, document fix notice; copy table SI `Ref-Rejections`), blocking_reason
copy (SI `Ref-BlockingReasons`).

**(added in check)** `design-surface.md` lists `RestaurantAvailabilityState` (5) under "restaurant hours" and
`HalalCertificateStatus` (6) under "restaurant settings". Neither reaches this app: `RestaurantAvailabilityState`
lives only on the customer `RestaurantAvailabilityInfo` (OUT_OF_RANGE, NO_ADDRESS), and `HalalCertificate` is an
admin schema (`getHalalCertificate` is ADMIN/SUPPORT only). The restaurant renders `RestaurantOpenState` and
`profile.halal` + the HALAL_CERTIFICATE `KycDocumentState` row. Do not import or switch on the other two.
`MenuReviewStatus` also has SUPERSEDED (6 values): it is only the `EditorSuperseded` view, never a review-column label.

### 2.1 Sign-in and account access (canvas SI)

| Screen | Boards | States | Ops | DS | Copy / notes |
|---|---|---|---|---|---|
| Sign in | SI `Main`, `SignIn-Submitting`, `-Invalid` (401), `-Unverified` (401 `email_verification_required=true`, primary "Send a new link"), `-TooMany` (429, Countdown from Retry-After + Date), `-Locked` (423 temporary), `-LockedPermanent` (423 until support), `-Offline`, `-SessionExpired` (orders at risk), `-ReuseDetected` (signed out everywhere), `-NotRestaurant`, `-Suspended`, `-Banned` (403 BANNED), `-NotActive`, `-Deactivated` (403 DELETED), `-RestaurantClosed`; `Tab-SignIn-1024` | 16 | `login`, `resendEmailVerification`, `getPublicConfig` (support phone/hours, support_enabled), `getRestaurantOnboardingStatus` (routing) | AppBar (P: brand-mark slot), Card, Input, Button, Banner (P), Countdown, Icon | "Sign in to your restaurant" / "Use the email and password you registered with." / "Forgot your password?" "Reset it by email" / "New to HalalGoes?" "Register your restaurant". Session expired must state the cost: new orders time out after 3 minutes and two missed in a row stop new orders. Enter submits; on error focus moves to the error summary. No MFA at launch: `MFA_REQUIRED` is unexpected for restaurants -> generic error. `[support phone]`, `[support hours]` from PublicConfig; when `support_enabled=false` use `SI Ref-SupportUnavailable`. |
| Register | SI `Register-Default`, `-Submitting`, `-Errors` (422, summary + focus), `-EmailTaken` (409), `-TermsUpdated` (409 TERMS_VERSION_STALE: refetch config), `-NetError`, `-RateLimited` (429) | 7 | `registerRestaurant` (Idempotency-Key reused on retry), `getPublicConfig` (`terms_version`) | Card, Input, Checkbox (never pre-ticked), Button, Banner (P) | "Create the owner account. After you confirm your email, you'll add your business details and documents." Terms link has no URL (Needs API): render the label without a link. 201 issues no session -> `/check-email`. Fixes the e2e step `02-register-submit-terms-version-bug`. |
| Check your email | SI `CheckEmail-Default`, `-Cooldown` (1-minute wait), `-DailyLimit` (429, 5/day), `-Offline` | 4 | `resendEmailVerification` | Card, Button, Countdown, Icon (letter glyph gap) | "Check your email" / "Open the link we sent to" / "Wrong email?" "Register again with the right one" / "The link works for 24 hours. Can't find it? Check your spam folder, or send a new link." / button "Send a new link" in every state / "You've asked for 5 links today". |
| Verify link | SI `Verify-Working`, `-Expired`, `-ExpiredSending`, `-ExpiredError`, `-Used` (VERIFICATION_TOKEN_USED, primary Sign in), `-Error` | 6 | `verifyEmail`, `resendEmailVerification` | Card, Button, Spinner | Reuse `@hg/ui-web/emailLinks` hooks. |
| Forgot password | SI `Forgot-Password`, `-Sending`, `-Error`, `-Sent` | 4 | `requestPasswordReset` (V0 in main) | Card, Input, Button | "Reset your password" / "Enter the email you registered with. We’ll send a link to set a new password." Sent never says whether the account exists: "The link works for 30 minutes and only once. Can’t find it? Check your spam folder, or ask for another." |
| Reset password | SI `Reset-Password`, `-Saving`, `-PasswordError` (422, breached / < 12 chars), `-LinkInvalid` (400 / `error_reset_token_not_valid`), `-Done` (signed out everywhere: sign in on the order screen again) | 5 | `resetPassword` | Card, Input, Button, Banner (P) | Min 12 chars, no composition rules. |
| Reference only | SI `Ref-BlockingReasons` (copy source for blocking_reason and the checklist halal line), `Ref-Rejections` (document rejection copy), `Ref-NeedsAPI`, `Focus-States`, `Ref-ForcedColors` | – | – | – | Copy sources, not screens. Out: `SignIn-Code*` (later version). |

### 2.2 Onboarding (canvas ON)

| Screen | Boards | States | Ops | DS | Copy / notes |
|---|---|---|---|---|---|
| Frame | ON `Onb-Loading`, `Onb-LoadError`, `Onb-UnknownStep` (unknown step or app update required) | 3 | `getRestaurantOnboardingStatus` | AppBar, SideNav-style checklist (P SetupChecklist / Stepper), ProgressBar (P), Banner "What’s needed now" (P) | Banner copy from `blocking_reason` via SI `Ref-BlockingReasons` table; unknown code -> "Something still needs doing. Refresh, or call partner support." (raw code never shown, reported). Halal status line under the seal only when UNVERIFIED (6 lines in Ref-BlockingReasons). |
| Business profile | ON `Profile-Empty`, `-Saving`, `-Errors` (422), `-SaveError`, `-SessionExpired` (401: sign in again **in the page**, retry same values), `-Returning` (local draft "Welcome back"), `-Conflict` (409 setup moved on), `-Location` (searching), `-SearchError` (no match, pin by hand), `-PinPlaced`, `-PinMoved`, `-Loading`, `-LoadError`, `-ReadOnly` (Needs API); parts `ProfilePanes`, `ProfileMain`; `Reflow-Profile-320` | 14 (ReadOnly: build as plain read-only, no pending-change claim) | `getRestaurantProfile`, `submitRestaurantProfile`, `suggestAddresses`/`getPlaceAddress`/`reverseGeocode` (PR #300) | Input, Select, Textarea (P), Multi-select (P, cuisines), AddressCombobox (P), MapPinPicker (P), KeyValueList (P approved), Banner (P), InlineAlert (P), ResizableSplit (P) | Five sections left, fields right; "Save and continue" saves the whole profile. Out-of-area errors on Postal code. Pin moves with arrow keys. Cuisine names: Needs API (show ids? no: render the sample list only if a lookup exists; otherwise hide the cuisine field label values behind Q-list, see §5). Local draft in localStorage (try/catch). |
| Documents | ON `Docs-None` (0 of 4), `-Uploading`, `-UploadCancelled`, `-AttachErrors`, `-UploadErrors` (type, size, checksum, scan, certifier), `-ScanRejected`, `-Ready` (4 of 4), `-ViewError` (download link expired), `-DownloadGone` (404), `-Incomplete` (422), `-SendError`, `-Replacing`, `-Locked` (409), `-Loading`, `-LoadError`; parts `DocsPanes`, `DocsMain`; `Tab-Docs-1024`, `Reflow-Docs-320` | 15 | `listRestaurantDocuments`, `createUpload`, `confirmUpload`, `attachRestaurantDocument`, `submitRestaurantDocuments`, `createDocumentDownloadUrl` | FileDrop (P approved), DateField (P), Select, Input, ListRow (P), ProgressBar (P), Banner (P), Button | Four required documents (halal certificate, food safety, business licence, owner ID). **Liability insurance hidden.** "Send for review" never disabled, primary only at 4 of 4. "within 3 business days". Download makes a new 2-minute link each click; file downloads. Never red on the halal certificate row. |
| Awaiting review | ON `Review-InReview`, `-Round2`, `-Partial` (live), `-Stale` (live updates disconnected), `-Expired` (halal expired while waiting: slate), `-Expired-FoodSafety`, `-ExpiredDetails`, `-ExpiredDetailsError`, `-ExpiredReplaced`, `-ExpiredSending`, `-ExpiredSendFailed`, `-AllApproved`, `-Loading`, `-LoadError`; `ReviewPanes`, `ReviewMain`, `Tab-Review-1024` | 14 | `getRestaurantOnboardingStatus`, `listRestaurantDocuments`, WS `document.review_state_changed`, `onboarding.state_changed`; renewal: `attachRestaurantDocument` + `submitRestaurantDocuments` (confirm allowed mid-review, §5) | ListRow, Badge, InlineAlert, FileDrop, DateField | The restaurant never sees the seven halal checks. In review is neutral. |
| Fix documents | ON `Fix-Rejected`, `-Multi`, `-MultiOneReplaced`, `-Integrity` (SUSPECTED_FORGERY: primary "Call partner support"), `-Duplicate` (arrives as OTHER today), `-Uploading`, `-Details`, `-DetailsError`, `-Replaced`, `-Sending`, `-SendFailed` (422), `-SendNetError`; `Tab-Fix-1024`, `Reflow-Fix-320` | 12 | same as Documents | same | Labels from SI `Ref-Rejections`; reviewer notes verbatim. One primary per page. |
| Payout setup | ON `Payout-NotStarted`, `-Creating`, `-CreateError`, `-Checking`, `-ReturnEnabled`, `-Due`, `-Verifying`, `-Stale`, `-Disabled`, `-Enabled`, `-ContinueError`, `-LinkError`, `-LinkExpired` (refresh return), `-StatusError`, `-StepNA` (409), `-PastDue` (live restaurant: orders continue, strip visible); `PayoutPanes`, `PayoutMain`; `Tab-Payout-1024`, `Reflow-Payout-320` | 16 | `createConnectAccount` (Idempotency-Key), `createConnectOnboardingLink`, `getConnectStatus`, WS `connect.requirements_changed` | KeyValueList, Disclosure (P), InlineAlert, Button | Stripe requirement names verbatim but secondary. Payouts must be on before the menu step. |
| First menu and hours | ON `Menu-None`, `Menu-V0` (first item live, two with a reviewer), `Menu-Loading`, `Menu-LoadError`, `Menu-HoursEditing`, `-HoursSaving`, `-HoursError` (422), `-HoursNetError`, `-HoursLoading`, `-HoursLoadError`, `Menu-HoursSet`, `Hours-Set`; `MenuPanes`, `MenuMain`, `HoursBlock`; `Tab-Menu-1024` | 12 | `getOwnMenu`, `createMenuCategory`, `createMenuItem`, `updateMenuItem`, `getRestaurantHours`, `setRestaurantHours` | Reuses WP8 / WP9 screens in pane form; Weekly hours editor (P), TimeField (P), EmptyState (P) | Menu published when a reviewer approves the first item. Each day Closed or up to 3 ranges, past midnight allowed. `steps_completed.hours_set` missing: read hours (Needs API fallback). |
| Setup done | ON `Onb-Done`, `-Expiring`, `-Expiring-Renew` | 3 | `getRestaurantProfile` (`halal`), renewal ops | HalalBadge (only from profile.halal), Button, RenewCert panel | "Go to orders" -> `/orders` (go-live gate). |
| Withdraw / ends / blockers | ON `Withdraw-Confirm` (in page), `-Confirming`, `-Error`, `Withdrawn`, `App-NotApproved` (final), `Suspended-Setup`, `Suspended-SetupNoReason` (fallback copy), `Delisted-Setup` (halal ended during setup = setup blocker, account stays PENDING, slate), `Delisted-Setup-FoodSafety`, `Delisted-Uploading`, `-Details`, `-DetailsError`, `-Sending`, `-SendFailed`, `-Sent`, `Deactivated-Setup`; part `AccountState`, `RenewCert`; `Tab-AppNotApproved-1024` | 16 | withdraw: **Needs API** (build disabled-free: hide Withdraw until op exists, Q-list); renewal: attach+submit; reactivate: **Needs API** (Contact support only) | Banner, InlineAlert, FileDrop, DateField, Button | Never mentions a listing during setup. |
| Account-state consoles | ON `Suspended-Console` (read-only console, header strip, no Kanban), `Delisted-Console`, `-Console-Renew`, `-Console-Sent`; `Tab-SuspendedConsole-1024`, `Tab-DelistedConsole-1024` | 6 | as Live orders + renewal | as Live orders | Implemented by WP4 banners + Settings renewal panel; boards here are the acceptance reference. |

### 2.3 Live orders (canvas LO) — the working page

Shared shell (every console page): SideNav rail, AppBar (account menu: "You are signed in as this
person", What's new, Sign out), status bar, NewOrderStrip, bottom-left toast stack (never over the panel or
strip), PageAnnouncer.

| Screen / flow | Boards | States | Ops / events | DS | Copy / keys / a11y |
|---|---|---|---|---|---|
| Live orders page | LO `Main` (busy), `Board-detail-open`, `Board-three-panes`, `Board-nav-expanded`, `Board-quiet`, `Board-empty`, `Board-loading`, `Board-first-load-error`, `Board-error-stale`, `Board-refreshed` (what live-only facts lose after refresh), `Board-other-screen` | 11 | `listRestaurantOrders` (state filter: PREPARING, READY_FOR_PICKUP, PICKED_UP, ARRIVED, DISPUTED; RESTAURANT_PENDING feeds the strip), `getRestaurantOrder`, WS `order.state_changed`, `order.items_adjusted`, `order.note_added`, `order.eta_updated`, `order.cancelled`, `dispatch.assigned/unassigned/state_changed` | DataTable (LyteNyte, virtualised), ResizableSplit (P), DetailPanel (P), EmptyState (P), ErrorState (P), Skeleton (P), Badge, Button, Price | Empty: "Nothing in progress" / "Orders you accept appear here, soonest ready time first. Ready orders stay until the rider picks them up." Error: "We couldn't load orders in progress. They are safe on the server." + "Try again". Sort "Ready first, then soonest ready time". **#601**: the server ignores `state`; the client must still send the filter and **also** drop rows whose state is not in the set (defensive, pinned by a test) until the backend fix lands. |
| Go-live gate | LO `Board-gate` (sound check before taking orders), `Board-gate-notif-denied` | 2 | `sendRestaurantHeartbeat` starts after the gate | Card, Button ("Play test chime"), Icon | "Keep this screen open and on. If it closes or sleeps, new orders stop reaching you within 5 minutes." Browsers need a user gesture before audio: the gate is that gesture. Wake Lock requested here. |
| Connection / screen health | LO `Board-reconnecting` ("Reconnecting: new orders may not ring" — Accept still works), `Board-reconnect-rest-down` (Accept off), `Board-closed-offline` ("This screen is offline"), `Board-sound-blocked`, `Board-health-open` (panel "Screen health"), `Board-health-degraded-sheet` (2 variants), `Board-signed-out-sheet` (2: the one blocking alert), `Board-sign-out`, `Board-sign-out-off` | 11 | heartbeat every 30 s (`sendRestaurantHeartbeat`, 4/min), realtime control frames, any 401 | Banner (P), DetailPanel, Dialog (signed-out only), Button | "This screen lost its live connection at 6:46 pm. Orders on screen are safe, the timers keep running, and Accept and Decline still work. It reconnects on its own." / "Offline for 5 minutes. If no other screen is open, HalalGoes has stopped sending you orders. You reopen automatically when a screen reconnects." / "Sign in again to keep answering orders" / "Stop orders before you sign out?" ... Connection messages are spoken once by the banner's region (reconnecting polite, offline assertive). |
| Open state and switch (status bar) | LO `Board-paused`, `Board-pause-menu` (15 min, 30 min, 1 hour, until closing), `Board-resume-confirm`, `Board-paused-offers`, `Board-not-accepting`, `Board-off-with-offers`, `Board-turn-off-confirm`, `Board-auto-off` (2 timed out in a row), `Board-closed-hours`, `Board-closed-holiday`, `Board-hours-offers`, `Board-suspended`, `Board-switch-failed`, `Board-switch-on-loading`, `Board-switch-on-failed`, `Board-payouts-restricted` | 16 | `getRestaurantAvailability`, `setRestaurantAcceptingOrders` (`pause_until`; `pause_until_closing` after PR #312), WS `restaurant.status_changed` | StatusCard (P: Badge, Switch, Menu, Button), Banner, Menu (pause choices) | Open-state keys and precedence: suspended -> offline -> switched off -> paused -> special date -> hours -> open (OPEN, PAUSED, CLOSED_TOGGLE, CLOSED_OFFLINE, CLOSED_HOURS, CLOSED_HOLIDAY, CLOSED_SUSPENDED). Confirmations in the page, first focus on the least-change button ("Keep accepting", "Stay paused"). "The switch moves when HalalGoes confirms." "Pause until closing (11:00 pm)": the time needs the API (show "Pause until closing" without a time until `next_closing` exists, or hide the option until #312 lands: Q-list). "New orders stopped: 2 orders timed out in a row". |
| Halal on the console | LO `Board-cert-expiring` (reminders 30/14/7/1), `Board-cert-expired` (slate), `Board-cert-unverified` ("We’re checking your certificate"), `Board-cert-rejected`, `Board-cert-missing` (no badge at all) | 5 | `getRestaurantProfile.halal`, `listRestaurantDocuments` (HALAL_CERTIFICATE row) | HalalBadge, Banner (neutral/slate, P) | "Your halal certificate expires on 14 October 2026" / "We can’t currently vouch for your halal certificate" / "It expired on 20 September 2026, so customers can’t find or order from you. ..." Upload renewal links to Settings renew panel. **(added in check)** `Board-cert-unverified` and `Board-cert-rejected` set halal UNVERIFIED: render **no** `HalalBadge` at all — not even the DS `operational` variant's dashed "Not verified" badge (ST note: "Not verified, no certificate and a withdrawal show no HalalBadge in Settings or the app bar"); `Board-cert-missing` = `halal` absent -> nothing, plus `reportClientError('HALAL_DISPLAY_STATE_MISSING')` as the HalalBadge README requires. The rejected banner's "Reason from HalalGoes: …" is **Needs API** (certificate record status rejected/revoked + reason): until it exists, show the HALAL_CERTIFICATE document row's `review_note` verbatim if present, else the banner without a reason line. Both banners are info/clock tone, never danger. |
| NewOrderStrip (every page) | LO `Offer-one`, `-three`, `-four-overflow` ("+1 more"), `-four-focus`, `-keyboard`, `-loading` (earnings/area loading after the ring), `-reduced-motion`, `-accepting`, `-accept-failed`, `-accept-too-late` (409 OFFER_EXPIRED), `-timed-out`, `-capture-failed`, `-accepted`, `-accepted-elsewhere`, `-declined-elsewhere`, `-withdrawn`, `-withdrawn-payment`, `-reconnect-accepting`, `-reconnect-accepted`, `-reconnect-failed`; `Keyboard-strip`, `NewOrderStrip`, `OfferTile`; MH `OrderStripStates`; PY `Orders-Strip-*` | 20 + 3 reference | WS `restaurant.order_offered`, `order_offer_expired`, `order_offer_withdrawn`, `order_accepted`, `order_rejected`; `listRestaurantOrders?state=RESTAURANT_PENDING` (sorted by `deadline_at`), `getRestaurantOrder` (fill tile after ring), `acceptOrder` (Idempotency-Key; body `prep_eta_minutes` only, **no note**; **(added in check)** the contract's `AcceptOrderInput` does carry an optional `accepted_note` — the client must never send it, owner decision "No note with an acceptance") | NewOrderStrip (P), OfferTile (P), Countdown (needs **silent mode**), Price, Badge, Button (72 px Accept, orange) | Keys (only while focus is on a tile; tile is the tab stop, roving tabindex, `aria-keyshortcuts`): Left/Right move, **A** accepts the focused order, **D** opens the decline form, Enter opens it in the panel. A new order never takes focus. Focus stays on the same order across re-sorts; when the focused order ends focus moves to its note, and the next A does nothing. Up to 3 tiles in full (1440 and tablet), 4th behind "+1 more". Copy: "Confirming with HalalGoes. Don’t tap again." / "Couldn’t confirm. Still waiting for you." / "Too late to accept" "The 3 minutes ran out first. The customer was not charged." / "Payment didn’t go through" "Don’t prepare this order. The customer was not charged." / "A7K2 accepted · ready by 7:08 pm" "It’s at the top of In progress." Accessible name: "New order A7K2, 2 minutes 12 seconds left, $37.69"; "Accept order A7K2, ready in 20 minutes". Sound rings until every order is accepted, declined or expired. |
| Decline (in the panel) | LO `Decline-no-reason` (group error, focus moved), `-other` (note < 20), `-item-unavailable` (tick items, "Also mark the ticked items out of stock until closing"), `-new-offer` (a new order rings meanwhile), `-sending`, `-failed`, `-too-late`, `-expired-open`, `Decline-availability-failed`; `Tablet-decline`; MH `MenuRejectPanel`, `MenuRejectOther`, `MenuRejected`; PY `Orders-Strip-Reject`, `-RejectExpired` | 9 | `rejectOrder` (`reason_code`, `note` required >= 20 chars for OTHER, `unavailable_menu_item_ids`), then `setMenuItemAvailability` (until closing) after the decline succeeds | DeclineForm (P: RadioGroup, Checkbox, Button, Textarea) inside DetailPanel | Reasons (vocabulary): "An item is unavailable", "Kitchen is too busy", "We are closing soon", "Equipment isn’t working", "Delivery address is too far", "The order looks suspicious", "Something else". "Why are you declining?" / "Write at least 20 characters." / buttons "Keep order" (first focus) and "Decline order". Nothing preselected; Decline needs a reason. "We couldn’t send the decline" "The order is still waiting for you. Check the connection and try again. It won’t be declined twice." **Fixes #604** (note field shown and required for OTHER). **(added in check)** `rejectOrder` takes a **required** `Idempotency-Key` (`IdempotencyKeyRequired`, rate class MONEY): generate it when the form opens and reuse it on every retry — that is what makes "It won’t be declined twice" true. The follow-up `setMenuItemAvailability` body needs `availability_state: OUT_OF_STOCK` (required) plus `out_of_stock_until`; a failure there is `Decline-availability-failed` and never un-declines the order. |
| In progress: prepare, ready, hand-off | LO `Prep-rider-waiting`, `Prep-rider-unassigned`, `Mark-ready-sending`, `Mark-ready-failed` (network, and server refused), `Ready-waiting`, `Ready-rider-here` (read the pickup code), `Ready-rider-here-code-error`, `Ready-no-rider`, `Handoff-picked-up`, `Out-empty`, `Out-disputed`, `Prep-cancelled`, `Prep-cancelled-refreshed`, `Ready-cancelled` ("keep the bag aside"), `Prep-items-adjusted`, `Prep-note-added`, `Prep-rider-eta-updated`, `Prep-overdue-sheet` (2), `Auto-cancelled-overdue`; `Tablet-rider-here` | 20 | `markOrderReady` (Idempotency-Key), `getRestaurantOrder` (`pickup_code` after PR #290), dispatch events | PickupCode (P), Button (forest "Mark ready"), Badge, InlineNotice (P) | Pickup code: "Hand bag K7J1 to Daniel P." + code; error state "Still missing? Call support, they can read it to you." "K7J1 picked up" "Daniel P. entered the pickup code. It’s out for delivery." Rider phase, cancel reason, notes, extension count are **live only** (lost on refresh): show them only from events; after refresh render `Board-refreshed` / `Prep-cancelled-refreshed`. |
| Order detail panel | LO `Detail-pending` (Accept footer; **no phone until accepted**), `-accepting`, `-accept-failed`, `-offer-ended-sheet` (3), `Offer-stepper-bounds` (prep 1..120 min, steps of 5), `Detail-preparing` (late: call support, quote the code), `-items-adjusted`, `-ready`, `-out` (read only), `-loading`, `-error`, `-not-found`, `Support-contact-sheet` (on/off), `Detail-toast-footer`; `Tablet-detail`, `Tablet-offer-ended` | 17 | `getRestaurantOrder`, `acceptOrder`, `markOrderReady`, `getPublicConfig` (support on/off) | DetailPanel (P), KeyValueList (P), Price, StatusTimeline (third pane), Button | "You earn" = `restaurant_net_cents`; "Phone number and full address appear after you accept." Lines render `line.variants[]` once PR #644 merges (`variant_name` stays joined meanwhile). Focus moves to the panel heading (the order code); Close/Escape returns focus to the source tile/row. Timeline pane: "Times from placed, accepted and ready times only". "Need to reach the customer?" -> support only. |
| History | LO `History`, `-filtered-empty`, `-filter-loading`, `-empty`, `-loading`, `-error`, `-loading-more`, `-load-more-failed`, `Detail-finished`, `Detail-declined`, `History-detail-cancelled-sheet` (3), `-detail-other-sheet` (3), `Detail-disputed`, `History-delivered`, `History-halal-upheld`, `History-halal-goodwill`; `Tablet-history`, `-history-states-sheet`, `-history-detail` | 21 | `listRestaurantOrders` (cursor; `state` from the chip), `getRestaurantOrder` | DataTable (LyteNyte), FilterChip (P), DetailPanel, EmptyState, ErrorState, Price | Chips: "All past orders", "Delivered, settling", "Completed", "Resolved", "Declined", "Cancelled" (each reloads from the server). "We couldn't load past orders. Your records are safe on the server." Decline/cancel reasons, dispute outcome and HALAL_CONCERN are **Needs API**: render the no-reason variant ("Declined", "Cancelled before it was accepted") — never invent a reason. |
| Accessibility references | LO `FocusControls`, `Keyboard-strip`, `A11y-announcements`, `A11y-countdown-silent`, `Focus-skip-link` ("Skip to new orders"), `Focus-states`, `Zoom-200`, `Zoom-200-panel`, `Zoom-200-nav`, `Forced-colors` | 10 | – | PageAnnouncer (P), Sheet | One page announcer (polite + assertive, rate-limited). Thresholds 25%, 10%, 0 (drop the DS 50% step). Polite: "New order A7K2, 3 items, 3 minutes to answer." Assertive at 10%: "B3M9, 18 seconds left to accept." Never spoken: per-second ticks, re-sorts, ETA changes. |
| Tablet | LO `Tablet-busy`, `-one-offer`, `-three-offers`, `-reconnecting`, `-load-sheet` | 5 (+ tablet rows above) | – | – | Rail icons only; panel 380 px; Decline on a tile is a 44 px close IconButton "Decline order A7K2, choose a reason"; key hints hidden. |

### 2.4 Menu (canvas MH)

| Screen | Boards | States | Ops | DS | Copy / notes |
|---|---|---|---|---|---|
| Menu list | MH `Main` (every item state), `MenuLoading`, `MenuError`, `MenuStale`, `MenuFirstRun` (no categories: "add your first category"), `MenuFilteredEmpty`, `MenuSearchResults`, `MenuAllOut`, `MenuCategoryOut`, `MenuLiveChanges`, `MenuSaved`, `MenuOptionUnavailable`, `MenuRowDetails` (item details panel); `Tablet-Menu`, `Tablet-MenuDetails` | 15 | `getOwnMenu` (refetch on focus and every 60 s: no menu WS events) | SideNav list variant (P, categories pane), DataTable (LyteNyte, 44 px rows), Switch, Badge, Input (search), ResizableSplit (P), DetailPanel (P), EmptyState, ErrorState, Skeleton, Banner | Review column: Approved, Under review, Waiting for first review, Not approved, Withdrawn (never Draft). Hidden is system-set, Blocked is the only admin state; never send a change to learn why. Sizes/add-ons read-only (#149 writes later). |
| Availability switch | MH `MenuAvailability` (saving, failed, blocked refusal, stored end time), `MenuAvailabilitySwitch` (length menu open, late night), `MenuAvailabilityNoHours`; `Tablet-MenuAvailability` | 4 | `setMenuItemAvailability` (`out_of_stock_until`: next closing / +1 h / null) | Switch, Menu (length menu: "Until closing (10:00 pm)", "For 1 hour (until 8:10 pm)", "Until you turn it back on") | Turning off marks out of stock **until closing at once**, then opens the length menu with that ticked; Escape keeps until closing. Back to Available is one tap. With no hours left today, Until closing is off with its reason. Menu lacks `menuitemradio`: add visually hidden ", current" to the ticked label (DS issue). Closing time must come from the server (Needs API: next closing): until then compute nothing — Q-list. |
| Categories | MH `MenuCreateCategory` (panel), `MenuCategorySaving`, `MenuCategoryCreated`, `MenuCategoryFailed`, `MenuCategoryTaken` (409), `MenuCategoryLimit` (40) | 6 | `createMenuCategory` (Idempotency-Key); `updateMenuCategory`, `deleteMenuCategory` exist in main but no board draws them: don't build | DetailPanel (task), Input, Textarea | "Categories group items on your menu. They need no review. Customers see a category once it has an approved item." "You have 40 categories, the most allowed." |
| Item editor | MH `EditorNew`, `EditorSubmitting`, `EditorSaveFailed`, `EditorErrors` (price out of range, client-side 50–50000 cents), `EditorServerErrors`, `EditorErrorsProhibited`, `EditorServerRefused` ("Halal certified" claim refused), `EditorConflict`, `EditorFirstReview`, `EditorPending`, `EditorPendingPrice`, `EditorApproved`, `EditorRejected`, `EditorRejectedAllergen`, `-New`, `-Offensive`, `-Other`, `-Photo`, `-Prohibited` (read-only, Contact support), `EditorWithdrawn`, `EditorSuperseded`, `EditorMoveInactive`, `EditorViewBlocked`, `EditorViewHidden`, `EditorLoading`, `EditorLoadFailed`, `EditorNotFound`, `EditorDiscard`, `EditorDiscardNew` (asks in the panel footer), `EditorPhotoUploading`, `-Checking`, `-Ready` (implicit), `-Failed`, `-Expired`, `-Invalid`; `Tablet-ItemEditor` | 34 | `createMenuItem` (Idempotency-Key), `updateMenuItem`, `createUpload` + `confirmUpload` (image), `getOwnMenu` | DetailPanel editor variant (P), Input, Textarea (P), Select, Checkbox, Price, FileDrop (P), ActionBar (P), Banner, KeyValueList | Sections: Live immediately (price, prep, position, category), Options (read-only until #149), Customers see these only after review. Submit off until something changed, says why; price-only change on an item under review says "Save changes". No drafts: nothing saved until submit. Opening the editor collapses the rail and categories pane; the row being edited shows "Editing". `allergens_declared` not on the owner view (Needs API): never write "Contains none of the listed allergens" unless true. |
| Account / certificate states | MH `MenuCertificateExpired`, `-ExpiredNoDate`, `-Expiring`, `-ExpiringNoDate`, `-Suspended` (cert + suspended), `-Unverified`, `MenuDeactivated` (view only; reactivate through support), `MenuDelisted` (editable), `MenuSuspended` (read-only lock), `MenuSuspendedRefused` (stale tab: 403 MENU_LOCKED) | 10 | same + `error_menu_locked` handling | Banner (neutral/slate), HalalBadge rules | Lock follows account state: SUSPENDED/BANNED locked (items, categories, prices, availability, photos); DELISTED editable; DEACTIVATED view only (drawn). Expired/unverified cert hides the restaurant: status strip keeps the open badge and says customers can’t see you. Never red. |
| Focus reference | MH `FocusStates` | – | – | – | Grid, switch, side navigation, panels, error summary, strip. |

### 2.5 Hours (canvas MH, `HoursView` part)

| Screen | Boards | States | Ops | DS | Copy / notes |
|---|---|---|---|---|---|
| Hours view and Right now | MH `HoursView` (late hours, 1 missed), `HoursLoading`, `HoursError`, `HoursNone`, `HoursOpenStates` (every open state), `HoursClosedHours`, `HoursOffline`, `HoursPaused`, `HoursPausedUntilClose` (needs #312), `HoursPauseMenu`, `HoursPauseStale`, `HoursToggleStates` (in flight / failed), `HoursAutoOff` (event toast), `HoursSoundGate`, `HoursSoundOff`, `HoursSuspended` (editable), `HoursTwentyFour`; `Tablet-Hours` | 18 | `getRestaurantHours`, `getRestaurantAvailability`, `setRestaurantAcceptingOrders`, WS `restaurant.status_changed` | StatusCard (P "Right now"), Switch, Menu, Banner (prompt, in page), EmptyState | Pause: 15, 30 or 60 minutes or until closing, each names its end time; no length preselected. Turning New orders on while sound is off shows the sound prompt under the status, not a dialog. Same open and close time = 24 hours. |
| Weekly editor | MH `HoursEdit`, `HoursDayClosed` (3 ranges), `HoursOverlap`, `HoursOverlapNight`, `HoursLimits` (21 ranges, 90 dates), `HoursUnsaved` (asks in save bar), `HoursClosesNow` (asks in save bar), `HoursSaving`, `HoursSaved`, `HoursSaveFailed`, `HoursConflict` (re-read just before save; no version check in contract); `Tablet-HoursEdit` | 12 | `setRestaurantHours` (replaces intervals + overrides) | Weekly hours editor (P), TimeField (P), Checkbox/Switch (Closed), ActionBar (P save bar), Banner (error summary takes focus) | 12-hour times; up to 3 ranges per day; past midnight allowed (`crosses_midnight`). Read-only once DEACTIVATED. |
| Special dates | MH `HoursSpecialEmpty`, `HoursSpecialEmptyEdit`, `HoursOverrideModal` (add, in-page panel despite the name), `HoursOverrideFromView`, `HoursOverrideEdit`, `HoursOverrideClosed`, `HoursOverride24`, `HoursOverrideNight`, `HoursOverrideErrors`, `HoursOverrideDuplicate`, `HoursOverrideRemove` (confirmed in its panel), `HoursServerError`, `HoursPastDates`, `HoursHolidayToday`, `HoursHolidayEdit`, `HoursHolidayRemoved`, `HoursSpecialNight` | 17 | `setRestaurantHours` (overrides; "Special dates save straight away and never wait for Save hours") | DetailPanel (task: special date), DateField (P), TimeField (P), Input (reason) | Panel replaces the list (list -> date). Whether customers see the reason: Needs API/Q. |

### 2.6 Payouts (canvas PY)

| Screen | Boards | States | Ops | DS | Copy / notes |
|---|---|---|---|---|---|
| Payout account | PY `Main` (payouts on), `Payouts-Loading`, `-ConnectError`, `-NoAccount`, `-NoAccount-Creating`, `-NoAccount-Error`, `-NotApprovedYet`, `-Suspended`, `-Banned`, `-DueSoon`, `-SetupIncomplete`, `-SetupList`, `-StripeOpening`, `-StripeError`, `-Stripe409`, `-StripeReturn-Checking`, `-StripeReturn-On`, `-StripeReturn-Still`, `Support-Payout`; `Tablet-Payouts`, `Reflow-Payouts-320` | 21 | `getConnectStatus` (404 = no account), `createConnectAccount`, `createConnectOnboardingLink`, `getPublicConfig` (support), WS `connect.requirements_changed` | KeyValueList (P), Disclosure (P), Banner, ErrorState, Skeleton, Button, DetailPanel (support) | "Couldn't load your payout account" "Your payouts themselves are not affected, and orders keep coming in." / "Orders never wait on payouts. ..." / "See your payouts" -> history. Requirements grouped Past due / Needed by / Not needed yet; Stripe codes secondary. 409 on link: Finish disabled, support is the way. "Never set up" vs "restricted later" is not distinguishable (Needs API): banners say "can't go live" only for non-live accounts. |
| Payout history | PY `Payouts-History`, `-HistoryLoading`, `-Empty`, `-Error`, `-LoadMore`, `-LoadMoreError`, `-End`, `-LiveFailed`, `-LiveSending`; `Tablet-PayoutsHistory` | 10 | `listRestaurantPayouts` (cursor), WS `restaurant.payout_updated` | DataTable, Price, Badge, EmptyState, ErrorState | PayoutState badges for all 7 (DRAFT, READY, TRANSFERRING "Sending", TRANSFERRED "Sent to Stripe", PAID, FAILED, HELD "On hold"). Tablet: drop "Paid into your bank" column while panel open. |
| Payout detail panel | PY `PayoutDetail-Draft`, `-Ready`, `-Sending`, `-SentToStripe`, `-Paid`, `-PaidNoCount`, `-Failed`, `-FailedNoReason`, `-OnHold`, `-OnHoldNoReason`, `-OnHoldSetup-Sep7`, `-OnHoldSetup-Aug31`, `-OnHoldSuspended`, `-OnHoldBanned`, `-ReversalLater`, `-HalalAdjustment`, `-DeepLinkLoading`, `-NotFound`, `-LoadError`; `Tablet-PayoutDetail` | 20 | No detail-by-id for restaurants: find the row via `listRestaurantPayouts` paging (deep link pages until found / not found). Entries (reversal, halal adjustment) are **Needs API**: build the no-entries variants; ReversalLater and HalalAdjustment only if entries arrive (cut candidate). | DetailPanel, KeyValueList, Price, Badge | Amounts only from server cents; failed row keeps its amount; money appears once. |
| Focus | PY `Focus-Visible` | – | – | – | Reference. Out: `Bell-*`, `Later-TwoStepSignIn`. |

### 2.7 Settings (canvas ST)

| Screen | Boards | States | Ops | DS | Copy / notes |
|---|---|---|---|---|---|
| Settings frame | ST `Settings-Overview`, `-Loading`, `-Error` ("Couldn't load your settings"), `-Profile`, `-ProfileIncomplete`, `-Account`, `-Security` (sign-in details), `-Documents`, `-Device`; `Tablet-Settings` | 10 | `getRestaurantProfile`, `getRestaurantAvailability`, `listRestaurantDocuments`, `getConnectStatus`, `getPublicConfig` | SectionNav (P), Card, KeyValueList (P), DetailPanel (P), Banner, Skeleton, ErrorState | Section list left with a one-line summary; chosen section beside; panel right; while a panel is open the rail collapses and the section list shows titles only (tablet: section list hides). Confirmations inside the panel. |
| Orders right now | ST `Settings-PauseChoose`, `-Paused`, `-PausedUntilClosing` (#312), `-Closed`, `-ClosedByHours`, `-ClosedToggle`, `-Offline`, `-AutoOffline`, `-Holiday` | 9 | `getRestaurantAvailability`, `setRestaurantAcceptingOrders` | StatusCard, RadioGroup (pause lengths), Button | "Pause new orders for" — no length preselected; "Pause new orders" disabled until one is picked. "Customers can still see your menu, but can't order until the pause ends. Orders already waiting keep their full 3 minutes." |
| Halal certification states | ST `Settings-HalalNone` (missing field: no badge), `-HalalNotVerified`, `-HalalNoCertificate`, `-HalalExpiring` (30), `-HalalExpiring14`, `-HalalExpiring7`, `-HalalExpiring1`, `-HalalExpired`, `-HalalRevoked`, `-FoodSafetyExpired` | 10 | `getRestaurantProfile.halal` (`HalalBadge`: display_state, certifying_body_name, expires_on), `listRestaurantDocuments` | HalalBadge, HalalCertificationPanel (restaurant variant: P; renders nothing without data), Banner | Standing line verbatim (rule 3). "Your halal certificate expires in 7 days, on 5 October 2026" pattern; expired: "Your halal certificate expired on 12 September 2026. Upload a renewed certificate. Your restaurant comes back when a reviewer approves it." Expired slate. |
| Account states | ST `Settings-Pending`, `-Suspended`, `-Banned`, `-Deactivated`, `-Delisted`, `Support-Account` | 6 | `getRestaurantProfile.account_state` | Banner, Badge | "Your account is suspended" "Orders already in progress still complete. You receive no new orders, and payouts are paused. You can read your details but not change them. You can still update your opening hours on the Hours page." Reasons: Needs API (no reason shown). |
| Edit business profile | ST `Edit-Names` (owner name: saves at once), `-NamesReviewed`, `-NamesSending`, `-NamesSent`, `-NamesFailed`, `-NamesInvalid`, `-About`, `-AboutSending`, `-AboutFailed`, `-AboutError`, `-SavedAbout`, `-AddressAfter150`, `-AddressAfter150Failed`, `-AddressPin`, `-AddressSent`, `-Tax`, `-TaxSending`, `-TaxFailed`, `-TaxError`, `-SavedTax`, `-Contact`, `-ContactError`, `-SavedContact`, `-Kitchen`, `-KitchenError`, `-SavedKitchen`, `-Saving`, `-Saved`, `-Conflict`, `-Discard`, `-UnknownField`, `-OtherCardInvalid`; `Tablet-SettingsEdit` | 33 | Immediate fields (owner name, phones, kitchen details/prep time): `submitRestaurantProfile` (whole profile; re-read before save). **Reviewed changes** (display/legal name, address, description, GST/HST): **Needs API** — see §5. | DetailPanel, Input, Textarea (P), AddressCombobox (P), MapPinPicker (P), Banner, ActionBar | Do **not** ship reviewed-change requests over `submitRestaurantProfile` (it applies at once and would bypass the halal-claim gate on name/description). Until the op exists: locked fields show "Request a change" -> Support panel. |
| Halal certificate renewal | ST `Renew-First`, `-Choose`, `-Uploading`, `-Ready`, `-Sending`, `-SendFailed`, `-UploadFailed`, `-Cancel`, `-WrongType`, `-TypeMismatch`, `-TooLarge`, `-Invalid`, `-Certifier`, `-TooEarly`, `-AlreadyExpired`, `-AfterExpiry`, `-FromExpiring`, `-Locked`, `Settings-RenewNotYet`; review outcomes `Renewal-Submitted`, `-InReview`, `-InReviewExpiring`, `-InReviewExpiryDay`, `-Approved`, `-ApprovedEarly`, `-Early`, `-Rejected`, `-RejectedDuplicate`, `-RejectedStillValid`; `Support-Halal`; `Tablet-SettingsRenew` | 31 | `createUpload`, `confirmUpload`, `attachRestaurantDocument`, `submitRestaurantDocuments` — **confirm they work for a LIVE restaurant** (canvas: onboarding-only today, 409 STEP_NOT_AVAILABLE); certifier list readable by restaurants: Needs API | FileDrop (P), DateField (P), Select / Input (certifier free text), ProgressBar (P), Banner | Never emailed; private bucket; "within 3 business days". |
| Other documents | ST `Docs-Loading`, `Docs-Error`, `Docs-FileLinkError`, `Docs-FoodExpiring`, `Docs-FoodRejected`, `Doc-Upload`, `Doc-UploadLicence`, `Doc-UploadOwnerId`, `Doc-Ready`, `Doc-Sent`; `Docs-History` (future state: skip) | 10 | `listRestaurantDocuments`, `createDocumentDownloadUrl`, upload + attach | ListRow (P), FileDrop, Button | "Your food safety certificate expires on 12 October 2026" / "Upload renewed certificate". No liability insurance row. |
| This device | ST `Device-NotificationsAsk`, `-NotificationsAsking`, `-NotificationsBlocked`, `-SoundOff`, `-SoundPlaying`, `-SoundBlocked`, `-NoWakeLock` | 7 | browser APIs only (Notification, Audio, Wake Lock); persist per-device prefs in localStorage with try/catch | Card, Switch, Button, Banner | |
| Sign-in details (change password) | ST `Security-ChangePassword`, `-PasswordSaving`, `-PasswordSaved` (other devices signed out), `-PasswordError` (current wrong), `-NewPasswordRejected` (422), `-PasswordFailed` | 6 | `changePassword` (V0 in main) | DetailPanel, Input, Button, Banner | "At least 12 characters. Any characters are fine; we refuse passwords known from data breaches." "Changing it signs you out on every other device, including a kitchen tablet that takes orders. Sign in there again straight away so new orders reach it." **Do not** render the "Two-step sign-in" block or sessions (hidden: "Account security" screen). See Q3. |
| What's new | ST `WhatsNew-FirstRun`, `-AfterUpdate`, `-Page`, `-Loading`, `-Error`, `-UpToDate`, `-OnOrders`, `-Interrupted` (an order arrives; the panel stays) | 8 | none in the contract: release notes are static, shipped with the app build; "last version seen" in localStorage; new device shows only the latest notes | DetailPanel, Badge (account-menu marker) | No bell. |
| Support panel | ST `Support-Sheet` (now in-page panel), `Support-Halal`, `Support-Account`; PY `Support-Payout`; LO `Support-contact-sheet` | 5 | `getPublicConfig` (`support_phone_e164`, `support_hours`, `support_enabled`; `support_email` after #312) | DetailPanel, Button, KeyValueList | No support endpoint; sample email must not ship until `support_email` exists. |
| Reflow | ST `Reflow-Settings-320`, `-720` | 2 | – | – | Zoom checks. |

---

## 3. Work packages

Eleven packages. Each is one agent, about 2 to 4 hours of build once its design-system pieces exist.
"Gate" = constitution §5: (1) owner-approved and only DS components, (2) empty/loading/error exist, (3)
44 px min, 72 px for Accept, (4) body text >= 4.5:1, (5) primary action identifiable, (6) no solid
green outside halal tokens, no halal red, (7) light only, (8) halal/trust wording approved, (9) selected =
fill not left border, (10) 12-hour times, (11) page fits the screen, detail in in-page panels. Every WP's
DONE also includes: `pnpm check`, `pnpm --filter @hg/restaurant typecheck lint test` green; the L-4 lint
(`apps/restaurant` `lint` script) clean; no file under `apps/restaurant/src/components/`; every board in
the WP's list compared side by side at 1440x900 and its tablet board at 1024x768 (screenshots attached to
the PR); coverage of touched files not lowered (#118).

**WP0 — Design-system prerequisites (not an app WP; blocks the rest).** The app may not start a screen
until the components it needs are in `@hg/ui-web` (#110, #191 to #198). Minimum set before WP1: SideNav
(collapsible), AppBar brand slot, Banner, InlineAlert, EmptyState, ErrorState, Skeleton, DetailPanel,
ResizableSplit, Textarea, KeyValueList, Countdown silent mode. Before WP3: NewOrderStrip, OfferTile,
PageAnnouncer, StatusCard, DeclineForm. See §4. If the DS team is behind, the orchestrator decides whether
an app WP builds the composite **inside `packages/ui-web`** (owner-approved boards exist for every one) —
never in `apps/restaurant`.

### WP1 — Shell, routing and platform plumbing
- Screens: console layout (rail, AppBar, status bar slot, strip slot, panel slot, toast stack), route
  tree §1, session handling, LO `Board-signed-out-sheet` blocking alert, `Board-sign-out`/`-sign-out-off`,
  skip links, zoom-200 nav sheet (LO `Zoom-200-nav`), What's new marker in the account menu (content in WP10).
- Plumbing: shared 12-hour formatter + absolute-date formatter (`formatAbsoluteDate` exists); server-clock
  offset from response `Date` header (for Countdown); `useServerResource` (load/stale/error) on top of the
  client; realtime subscriptions (`restaurant:{id}`, `order:{id}` set) with gap/refetch handling; heartbeat
  every 30 s on every console page while visible; PageAnnouncer mount; `onUnauthorized` -> alert, not redirect;
  account-state router (onboarding vs console vs blocked) from `getRestaurantOnboardingStatus` +
  `getRestaurantProfile`; remove `/staff` and app-local components.
- Ops: `getCurrentPrincipal`, `getRestaurantOnboardingStatus`, `getRestaurantProfile`, `getPublicConfig`,
  `createRealtimeTicket`, `sendRestaurantHeartbeat`, `logout`, `logoutAll` (not used: hidden);
  **(added in check)** `refreshSession` (silent refresh before the signed-out alert, see §0), and parts
  MH `PartRail` / PY `Rail-Owner`, `Rail-OwnerCollapsed`, MH `PartTopBar`, `PartStatusHalal` as the shell's
  acceptance boards. DONE also: an expired access token with a valid refresh cookie never shows the alert (test).
- DS: SideNav, AppBar, Menu, Dialog, Sheet, Toast, IconButton, Icon, Badge, PageAnnouncer.
- Depends on: WP0 minimum set.
- DONE: every console route renders inside the shell with empty/loading/error placeholders; a 401 shows
  the blocking alert and keeps on-screen data; heartbeat fires every 30 s (test with fake timers); page
  height = viewport at 1440x900 and 1024x768 with no document scroll (Playwright asserts
  `document.scrollingElement.scrollHeight <= innerHeight`); Gate.

### WP2 — Sign-in and account access (SI, 44 boards)
- Screens: §2.1 all rows.
- Ops: `login`, `registerRestaurant`, `resendEmailVerification`, `verifyEmail`, `requestPasswordReset`,
  `resetPassword`, `getPublicConfig`.
- DS: Card, Input, Checkbox, Button, Banner, Countdown, Icon, AppBar.
- Depends on: WP1 (router, formatter). Can start in parallel with WP1 on the public routes.
- DONE: every SI state reachable in a component test from a fixture or mocked error; `terms_version` read
  from config (e2e register step passes end to end); Retry-After countdown uses the Date header; focus
  moves to the error summary; Gate.

### WP3 — New-order strip, accept, decline, sound and go-live (LO strip + decline; MH/PY strip rows)
- Screens: NewOrderStrip on every console page; OfferTile states (20); decline panel (9) incl.
  "mark items out of stock until closing"; go-live gate (2); sound blocked (1); keyboard and announcer
  behaviour (LO `Keyboard-strip`, `A11y-*`).
- Ops: `listRestaurantOrders?state=RESTAURANT_PENDING`, `getRestaurantOrder`, `acceptOrder`
  (`prep_eta_minutes`, Idempotency-Key reused on retry), `rejectOrder`, `setMenuItemAvailability`;
  WS `restaurant.order_offered/_offer_expired/_offer_withdrawn/_order_accepted/_order_rejected`.
- DS: NewOrderStrip, OfferTile, Countdown (silent), Price, Badge, Button, DeclineForm, RadioGroup,
  Checkbox, Textarea, DetailPanel, PageAnnouncer.
- Sound: one audio loop per shell, rings while any RESTAURANT_PENDING order is on screen, stops on
  accept/decline/expiry/withdrawn; respects the gate gesture; reduced motion = steady tint.
- Depends on: WP1.
- Fixes: **#604** (note required for OTHER, >= 20 chars, reaches `rejectOrder.note`), and the strip half
  of **#601** (pending list filtered client-side too).
- DONE: A/D/Enter/arrow keys act only on the focused tile (test: a keypress with focus elsewhere does
  nothing); a new order never steals focus; re-sort keeps focus on the same order; accept retry never
  sends a new Idempotency-Key; capture-failed and too-late states render from `error_capture_failed` /
  `error_offer_expired`; sound starts/stops correctly (fake Audio); announcer thresholds 25/10/0 (fake
  timers); Gate (72 px Accept, orange only here).

### WP4 — Live orders board: in progress, detail panel, hand-off, open state, halal (LO)
- Screens: §2.3 rows "Live orders page", "Connection / screen health", "Open state and switch",
  "Halal on the console", "In progress", "Order detail panel", tablet rows; ON `Suspended-Console`,
  `Delisted-Console*` as acceptance references.
- Ops: `listRestaurantOrders` (in-progress states), `getRestaurantOrder` (`pickup_code` after #290),
  `markOrderReady`, `getRestaurantAvailability`, `setRestaurantAcceptingOrders`, `getRestaurantProfile`,
  `listRestaurantDocuments`, `getPublicConfig`; WS order/dispatch/status events.
- DS: DataTable (LyteNyte), ResizableSplit, DetailPanel, KeyValueList, StatusTimeline, StatusCard,
  Switch, Menu, Banner, InlineNotice, PickupCode, HalalBadge, Price, EmptyState, ErrorState, Skeleton.
- Depends on: WP1, WP3 (shares the panel and strip).
- Fixes: client side of **#601** (drop non-live states; COMPLETED/PICKED_UP must leave the list on
  refresh; test pins it). The backend fix (handler applies `state` and cursor) stays on #601.
  **(added in check) Correction:** PICKED_UP and ARRIVED do **not** leave the list — LO `Handoff-picked-up`,
  `Detail-out` and `Out-*` keep them as read-only "Out for delivery" / "At the customer" rows ("Read only. Nothing
  to do; it leaves this list when delivered."), and DISPUTED keeps its place with its own status (`Out-disputed`).
  The guard drops everything **outside** {PREPARING, READY_FOR_PICKUP, PICKED_UP, ARRIVED, DISPUTED}: DELIVERED,
  COMPLETED, CANCELLED, REJECTED, RESOLVED (and CREATED/AUTHORIZED/FAILED, which must never appear). A cancelled
  order stays as a "remove" row only while it came from a live `order.cancelled` event (`Prep-cancelled`,
  `Ready-cancelled`); after refresh it is gone (`Prep-cancelled-refreshed`). The WP4 e2e therefore asserts the
  order leaves after **delivery** (`dev-journey ... auto=all` to completion), not after pickup.
- DONE: every OrderState the restaurant can see has a distinct, labelled treatment; live-only facts render
  only from events and the refreshed board matches `Board-refreshed`; pickup code shown only when
  READY_FOR_PICKUP and the rider is here, error state when missing; open-state precedence implemented as
  one pure function with a table test over all 7 `RestaurantOpenState` values; Gate.

### WP5 — Order history (LO History rows)
- Screens: §2.3 "History" (21 boards incl. tablet).
- Ops: `listRestaurantOrders` (cursor + state chip), `getRestaurantOrder`.
- DS: DataTable, FilterChip, DetailPanel, KeyValueList, Price, Badge, EmptyState, ErrorState, Skeleton.
- Depends on: WP1, WP4 (detail panel).
- DONE: first-run empty and filtered empty differ; load more and its failure; terminal-state panels never
  invent a reason (Needs API variants); Gate.

### WP6 — Onboarding I: frame, profile, documents, review, fix (ON)
- Screens: §2.2 rows Frame, Business profile, Documents, Awaiting review, Fix documents (58 boards + tablet/reflow).
- Ops: `getRestaurantOnboardingStatus`, `getRestaurantProfile`, `submitRestaurantProfile`,
  `suggestAddresses`/`getPlaceAddress`/`reverseGeocode` (#300; until merged, manual address + pin drag
  with Mapbox tiles only, ON `Profile-SearchError` path), `listRestaurantDocuments`, `createUpload`,
  `confirmUpload`, `attachRestaurantDocument`, `submitRestaurantDocuments`, `createDocumentDownloadUrl`;
  WS `onboarding.state_changed`, `document.review_state_changed`.
- DS: SetupChecklist/Stepper, ProgressBar, Banner, InlineAlert, Input, Select, Multi-select, Textarea,
  AddressCombobox, MapPinPicker, FileDrop, DateField, ListRow, KeyValueList, ResizableSplit.
- Depends on: WP1.
- DONE: screens render exactly `current_step`; liability insurance absent; download makes a fresh link per
  click; local draft survives reload and fails soft without storage; Gate.

### WP7 — Onboarding II: payout setup, first menu and hours, done, ends and blockers (ON)
- Screens: §2.2 rows Payout setup, First menu and hours, Setup done, Withdraw/ends/blockers.
- Ops: `createConnectAccount`, `createConnectOnboardingLink`, `getConnectStatus`, `getOwnMenu`,
  `createMenuCategory`, `createMenuItem`, `getRestaurantHours`, `setRestaurantHours`, renewal ops.
- DS: as WP6 + KeyValueList, Disclosure; embeds WP8 item editor and WP9 weekly editor in pane form.
- Depends on: WP6 (frame), WP8 + WP9 for the embedded editors (or ship the onboarding menu step with
  links into `/menu` and `/hours` if they are late).
- DONE: Stripe return and refresh URLs handled; withdraw hidden or disabled with reason until the op
  exists (Q4); Gate.

### WP8 — Menu: list, availability, categories, item editor (MH)
- Screens: §2.4 (69 boards incl. tablet).
- Ops: `getOwnMenu`, `setMenuItemAvailability`, `createMenuCategory`, `createMenuItem`, `updateMenuItem`,
  `createUpload`, `confirmUpload`.
- DS: SideNav list variant, DataTable, Switch, Menu, ResizableSplit, DetailPanel (editor/task), Input,
  Textarea, Select, Checkbox, Price, FileDrop, ActionBar, Banner, EmptyState, ErrorState, Skeleton, Badge.
- Depends on: WP1. Independent of WP3/4.
- DONE: lock follows account state (SUSPENDED/BANNED locked incl. availability; DELISTED editable;
  DEACTIVATED view only); MENU_LOCKED from a stale tab shows `MenuSuspendedRefused`; no Draft label
  anywhere; availability switch goes to "until closing" immediately and Escape keeps it; price checked
  50–50000 cents client-side only as a hint; refetch on focus + 60 s; Gate.

### WP9 — Hours and pause (MH HoursView rows)
- Screens: §2.5 (47 boards incl. tablet).
- Ops: `getRestaurantHours`, `setRestaurantHours`, `getRestaurantAvailability`,
  `setRestaurantAcceptingOrders` (`pause_until`; `pause_until_closing` after #312).
- DS: StatusCard, Weekly hours editor, TimeField, DateField, DetailPanel, ActionBar, Banner, Switch, Menu,
  EmptyState, ErrorState, Skeleton.
- Depends on: WP1; shares StatusCard with WP4.
- DONE: overlap (incl. past midnight into next day, Sun->Mon) checked on screen and server errors mapped
  to the day; limits 21 ranges / 90 dates; editable while SUSPENDED, read-only when DEACTIVATED; special
  dates save immediately; 12-hour throughout; Gate.

### WP10 — Settings (ST)
- Screens: §2.7 (all rows, 134 boards incl. tablet and reflow).
- Ops: `getRestaurantProfile`, `submitRestaurantProfile` (immediate fields only), `getRestaurantAvailability`,
  `setRestaurantAcceptingOrders`, `listRestaurantDocuments`, `createUpload`, `confirmUpload`,
  `attachRestaurantDocument`, `submitRestaurantDocuments`, `createDocumentDownloadUrl`, `changePassword`,
  `getPublicConfig`, `getConnectStatus` (summary).
- DS: SectionNav, Card, KeyValueList, DetailPanel, HalalBadge, HalalCertificationPanel (restaurant
  variant), FileDrop, DateField, Input, Textarea, RadioGroup, Switch, Banner, Badge.
- Depends on: WP1; the renewal panel is reused by WP4 ("Upload renewal") and WP7.
- Could split if late: WP10a (frame, right now, halal states, account states, device, change password,
  what's new, support) and WP10b (edit profile panels, renewal, other documents).
- DONE: reviewed-change fields never call `submitRestaurantProfile`; halal banners per day thresholds
  (30/14/7/1) computed from `expires_on` vs server date; no two-step or sessions UI; Gate.

### WP11 — Payouts (PY)
- Screens: §2.6 (51 boards incl. tablet and reflow).
- Ops: `getConnectStatus`, `createConnectAccount`, `createConnectOnboardingLink`, `listRestaurantPayouts`,
  `getPublicConfig`; WS `restaurant.payout_updated`, `connect.requirements_changed`.
- DS: KeyValueList, Disclosure, DataTable, DetailPanel, Price, Badge, Banner, EmptyState, ErrorState, Skeleton.
- Depends on: WP1.
- DONE: all 7 PayoutState badges; deep link `/payouts/history?payout=` pages until found/not found;
  no browser arithmetic on money; Gate.

**Suggested order (with parallelism):** WP0 (DS) -> WP1 -> { WP2, WP3, WP8, WP9, WP11 in parallel } ->
{ WP4 (after WP3), WP6, WP10 } -> { WP5 (after WP4), WP7 (after WP6, WP8, WP9) }. Critical path for
launch: WP1 -> WP3 -> WP4 (a restaurant can take orders), with WP2 (sign in) and WP8 (mark sold out) as
the other must-haves.

---

## 4. Component needs

Live design system (artifact 1GwGVZz8Ju9wcz4HfCnzbv, `components/index.d.ts`): AppBar, Badge,
BottomNav, Button, Card, Checkbox, Countdown, DataTable, Dialog, HalalBadge, HalalCertificationPanel,
HalalChecklist, HalalShield, Icon, IconButton, Input, Menu, Modal, Price, Radio, RadioGroup, Rating,
SegmentedControl, Select, Sheet, StatusTimeline, Switch, Toast.

### 4.1 Used from the live DS
AppBar, Badge, Button, Card, Checkbox, Countdown, DataTable (on LyteNyte, #141), Dialog (signed-out alert
only), HalalBadge, HalalCertificationPanel, Icon, IconButton, Input, Menu, Price, RadioGroup/Radio,
Select, Sheet (zoom-200 nav only), StatusTimeline (order timeline pane), Switch, Toast. Not used:
BottomNav, Rating, HalalChecklist (admin), HalalShield (only inside HalalBadge), Modal, SegmentedControl.

### 4.2 Not in the live DS (flag = Proposed component unless noted). Issue to land it in.

| Component | Status on canvases | Used by | Issue |
|---|---|---|---|
| SideNav (collapsible rail; list variant for categories; SectionNav for settings) | Owner-approved, not yet in DS | WP1, WP8, WP10 | #192 |
| KeyValueList | Owner-approved | WP4, WP6, WP7, WP10, WP11 | #195 |
| FileDrop (+ MediaFrame preview) | Owner-approved | WP6, WP7, WP8, WP10 | #193 |
| DetailPanel (in-page, collapsible; editor and task variants) | Proposed (desktop layout rule) | all | #192 |
| ResizableSplit / ResizeHandle (shadcn Resizable, 44 px hit area) | Proposed | WP4, WP6, WP8 | #192 |
| NewOrderStrip, OfferTile | Proposed | WP3 | #197 |
| DeclineForm (RadioGroup, Checkbox, Button, Textarea) | Proposed | WP3 | #197 |
| PickupCode | Proposed | WP4 | #197 |
| StatusCard ("Right now": Badge, Switch, Menu, Button) | Proposed | WP4, WP9, WP10 | #197 |
| PageAnnouncer (polite + assertive, rate-limited) | Proposed | WP1, WP3 | #197 |
| Banner (danger/warning/info/neutral/slate; error-summary variant) | Proposed (ui-web has a pre-redesign Banner) | all | #191 |
| InlineAlert / InlineNotice | Proposed | all | #191 |
| EmptyState, ErrorState, Skeleton, Spinner | Proposed (pre-redesign versions in ui-web) | all | #191 |
| Textarea (+ counter) | Proposed (shadcn) | WP2, WP3, WP6, WP8, WP10 | #193 |
| DateField (shadcn Calendar in Popover, typed entry), TimeField | Proposed | WP6, WP9, WP10 | #193 |
| Weekly hours editor | Proposed | WP7, WP9 | #193 |
| AddressCombobox (shadcn Command), MapPinPicker (Mapbox, draggable, arrow keys) | Proposed | WP6, WP10 | #193 / #150 |
| Multi-select (cuisines) | Proposed | WP6 | #193 |
| ListRow (44 px) | Proposed | WP6, WP10 | #195 |
| ActionBar (pane footer / save bar) | Proposed | WP8, WP9, WP10 | #195 |
| Disclosure (shadcn Collapsible) | Proposed | WP7, WP11 | #195 |
| ProgressBar (shadcn Progress) | Proposed | WP6, WP10 | #191 |
| FilterChip | Proposed | WP5 | #195 |
| SetupChecklist / Stepper (onboarding rail) | Proposed | WP6, WP7 | #192 |
| HalalCertificationPanel restaurant variant (renders nothing without data) | Proposed variant | WP10, WP7 | #196 |

### 4.3 Design-system defects the app depends on (report, do not override locally)
- Countdown speaks at 50/25/10/0 per instance with no off switch: needs a **silent mode** (LO A11y).
- AppBar has no logo slot (SI, ON).
- Menu: no `menuitemradio`/`aria-checked` (availability and pause length menus); disabled-item reason ~2.3:1.
- Text tertiary #6E7C77 inside components is 4.36:1 on white (fails gate item 4).
- Bundle reads `--type-*-size`/`--type-*-tracking` that tokens.css never defines.
- Input drops an outside `aria-describedby`.
- Icon gaps (Solar): Menu/document list, Payouts/wallet, Settings, letter (#198). Until added, collapsed
  rail items show their name under the icon.
- HalalBadge and progress bar need a forced-colors rule.

---

## 5. API gaps ("Needs API" / "Contract to confirm") and which PR covers them

Status of main (9 Oct): `requestPasswordReset`, `resetPassword`, `changePassword`, `createMenuCategory`,
`createMenuItem`, `updateMenuItem`, `updateMenuCategory`, `deleteMenuCategory`, `listRestaurantPayouts`
are already **V0 in main** (several canvas chips are stale). `error_reset_token_not_valid` exists (the
"specific code for an invalid reset link" is covered).

| Need (where) | Covered by | Notes for builders |
|---|---|---|
| Pickup code on the restaurant's order view (LO hand-off, `Ready-rider-here`) | **#290** (contract: `OrderRestaurantView.pickup_code`; seal ops to V1; `overrideHandoverCode`) + **#315** (backend enforcement) | Blocking for launch hand-off. Until merged: render `Ready-rider-here-code-error` ("Still missing? Call support...") — never a blank slot. |
| Address search, place details, reverse geocode (ON profile, ST address) | **#300** (`suggestAddresses`, `getPlaceAddress`, `reverseGeocode`; contract + fixtures, **no backend handler**) | Backend handlers still missing (#179). Fallback: manual address + drag pin (ON `Profile-SearchError`). |
| Pause until closing (LO pause menu, MH `HoursPausedUntilClose`, ST `Settings-PausedUntilClosing`) | **#312** (`pause_until_closing` on `setRestaurantAcceptingOrders`; contract only) | Backend missing. Hide the option until both land; never compute closing time in the browser. **(added in check)** Per #312's diff: send `pause_until` **or** `pause_until_closing`, never both (`error_pause_with_both_times`); outside trading hours the server answers `RESTAURANT_CLOSED` (`error_pause_until_closing_outside_hours`) — draw it as the pause panel's inline error; the response's `pause_until` is the closing time the server chose, so the "Paused until 11:00 pm" label comes from the response (fixture `restaurant_open_state_paused_until_closing`). The menu item "Pause until closing (11:00 pm)" still has no time before the call (needs next closing, Missing). |
| Support email (ST/PY support panels) | **#312** (`PublicConfig.support_email`) | Until merged: phone and hours only; no sample email. **(added in check)** #312 also adds fixtures `public_config_phone_support_off` and `public_config_without_support_email`: test the support panel against both. A non-phone partner contact when `support_enabled=false` (SI `Ref-SupportUnavailable`) is still **Missing**. |
| **(added in check)** Delete / withdraw an item (MH editor chip "Needs API #149: withdraw this item") | **Already V0 in main:** `deleteMenuItem` (soft delete, withdraws a pending version, 404 if gone) — the chip is stale | No board draws a working delete, so do **not** build it without the owner (Q10). Withdrawing only a pending change (keeping the live item) is still Missing. |
| **(added in check)** `delist_reasons[]` on the profile / onboarding status; meaning of `404` on the restaurant's own `createDocumentDownloadUrl` (ON `Docs-DownloadGone`); owner name required on the profile | **Missing** (SI `Ref-NeedsAPI`) | Delisted console shows the generic delisted copy; treat a 404 on download as "no longer available" on the Download action only (row state unchanged). |
| Multi-variant order lines on the restaurant ticket (detail panel lines) | **#644** (`OrderLine.variants[]`; `variant_name` stays joined) | Render `variants[]` when present, else `variant_name`. |
| Staff 2FA opt-in | **#623** | Not used by the restaurant launch UI (restaurant two-step stays later). No change needed. |
| Masked phone hidden until acceptance (LO `Detail-pending`) | **Missing** (server must enforce; contract sends `phone_masked` before accept) | Client must not display it before PREPARING anyway. |
| Rider phase, picked-up/arrived/delivered times, cancel/decline reason and actor, notes, extension count, dispute reason/outcome, HALAL_CONCERN + substantiated on the restaurant order view | **Missing** | Live-only from events; refreshed variants drawn. |
| Next opening / closing / last-order time, who switched off, who paused and when, on availability | **Missing** | Render without times ("New orders start when you next open."). |
| Structured suspension / delist / ban reasons; `account_state` change event | **Missing** | Show the service status `reason` verbatim only; re-read profile on focus. |
| Reviewed profile changes (display + legal name, address with pin, description, GST/HST); pending change on profile; profile version check / partial update | **Missing** | Do not use `submitRestaurantProfile` for these. Locked + support. |
| Cuisine lookup (id + label) readable by restaurants | **Missing** | Q5. |
| Accepted certifier registry readable by restaurants | **Missing** | Free-text issuer until then. |
| Renewed certificate after onboarding (attach + submit for a LIVE/DELISTED restaurant); single-document review | **Contract to confirm** (canvas says 409 STEP_NOT_AVAILABLE outside onboarding) | Blocks ST Renew-*, LO "Upload renewal", ON Delisted-Console-Renew. Check the handler; raise an issue if refused. |
| HalalRejectionReasonCode on the partner document view (duplicate, scope, issuer) | **Missing** | Arrives as OTHER + `review_note` verbatim. |
| REJECTED application on `RestaurantOnboardingStatus` | **Missing** | `App-NotApproved` reachable only via `rejection` object if present; else unknown-step fallback. |
| Withdraw onboarding; reactivate a deactivated restaurant | **Missing** | Hide Withdraw (Q4); Reactivate = Contact support. |
| `steps_completed.hours_set`; `blocking_reason` as an enum | **Missing** | Read hours; map known strings, unknown -> fallback copy. |
| Terms document URL | **Missing** | Label without link. |
| KYC accepted file types / size; several files per document | **Missing** | Use `createUpload` errors; one file per document. |
| Menu: block/hidden reason, `allergens_declared` on owner view, superseded version, last availability change, version check on `updateMenuItem` and hours, menu item WS events, prohibited-word details, withdraw a pending change only, bulk availability, variant/add-on writes | **Missing** (#149 for bulk/variants) | Build the drawn fallbacks; poll on focus + 60 s. |
| Special dates crossing midnight / 24 h / past dates and the 90 limit; is a special date's reason shown to customers | **Contract to confirm** | Q6. |
| Restaurant payout detail by id + entries (reversal, halal adjustment), payout weekday/next date, failed/held counts | **Missing** | Page through `listRestaurantPayouts`. |
| Connect: "never set up" vs "restricted later"; plain-language requirement names and `disabled_reason`; Stripe dashboard link | **Missing** (decision row 2026-10-01 says the contract will tell them apart) | Show Stripe codes as secondary text. |
| Restaurant-readable certification panel (`getRestaurantCertification` is CUSTOMER-only) | **Missing** | Use `profile.halal` (HalalBadge data) + HALAL_CERTIFICATE document row. |
| Server-written release notes | Not needed | Static in the app bundle. |
| `listRestaurantOrders` ignores `state` and cursor | **Bug #601** (backend) | Client filters defensively (WP4/WP5). |

---

## 6. Dev harness and E2E plan

Harness facts: `cd services/hg && make up && make migrate && make dev-reset` seeds personas (email
personas share password `Seed!2026`, `services/hg/internal/devworld/personas.go`); `make dev-scenario
s=<name>` (new-order, rush, order-preparing, order-ready, customer-cancels, restaurant-rejected,
docs-approve, docs-reject, menu-approve, menu-reject, onboard-restaurant, onboard-rider);
`make dev-journey route=short|long|early-rider speed=1x|max auto=none|restaurant|all`. Mock:
`pnpm mock` (:4010, `?scenario=<fixture>`; WS `ws://localhost:4010/v1/ws?ticket=dev&scenario=...&autoplay=1`).
Restaurant personas: `fresh`, `profile`, `docs-todo`, `docs-review`, `docs-rejected`, `payout`, `menu`,
`bismillah-grill` (live), `expiring-halal`, `expired-halal`, `paused`, `suspended`.
E2E: `tools/e2e/web/restaurant.spec.ts`, config `tools/e2e/web/playwright.config.ts` (1440x900 only today,
`timezoneId: America/Toronto`). **Add a `restaurant-tablet` project at 1024x768** (same specs, tagged).
Component tests: `apps/restaurant/smoke/*.test.tsx` import `contracts/fixtures/**.json` and mock `api`;
keep that pattern, one test file per WP, each state asserted by role/name, plus `axe` checks where cheap.

| WP | (a) Component/screen tests vs mocked API (fixtures) | (b) E2E on the real API (Playwright, Chromium, 1440x900 + 1024x768) | Harness drive |
|---|---|---|---|
| WP1 | Shell renders per account_state (`restaurant_profile` patched per state); 401 -> blocking alert keeps rows; heartbeat cadence (fake timers, `restaurant_heartbeat`); no-scroll layout assertion | Sign in as `bismillah-grill`, visit every nav item, assert no document scroll at both sizes; token revoked mid-session (`logoutAll` from a second context) -> "Signed out" alert, Sign in again restores | `make dev-reset` |
| WP2 | Each SI state: `restaurant_registration`, `error_register_restaurant_rate_limited`, `error_validation_failed`, `error_verification_token_expired/used`, `error_reset_token_not_valid`, `error_breached_password`, `error_rate_limited`, `public_config` | Register a new restaurant -> Check your email -> follow the verify link (token from API log / devworld) -> sign in -> onboarding; `fresh` signs in -> Unverified -> Send a new link; forgot -> reset -> sign in; `suspended` sign-in path | personas `fresh`, `suspended`; `s=onboard-restaurant` |
| WP3 | Strip: 1/3/4 offers (`restaurant_order_queue_busy`, `restaurant_order_restaurant_pending`), keys only on focused tile, accept retry same key, `error_capture_failed`, `error_offer_expired`, decline every reason incl. OTHER with note (#604), item-unavailable + availability call (`menu_item_marked_out_of_stock_until`), WS frames from `realtime_order_restaurant_rejects` + hand-written restaurant frames | Order placed by API (`s=new-order`) rings -> keyboard A accepts -> appears in progress; `s=rush` -> 4 offers, "+1 more", keyboard to 4th; decline with "Something else" + 20-char note; let one time out (needs short window, below) | `bismillah-grill`; `s=new-order`, `s=rush`, `s=restaurant-rejected`, `s=customer-cancels` |
| WP4 | List states (`restaurant_order_preparing/ready_for_pickup/picked_up`, `restaurant_order_queue_empty`), #601 guard (fixture with COMPLETED row is dropped), open-state table test over 7 `restaurant_open_state_*`, halal banners from profile variants, pickup code present/missing, mark-ready failure | `s=order-preparing` -> Mark ready -> `dev-journey auto=all` picks up -> row turns read-only "Out for delivery" -> after delivery it leaves the list, also after refresh (#601) **(corrected in check: it does not leave on pickup)**; pause 15 min -> status; switch off -> confirm -> on; `paused` persona; `expiring-halal` / `expired-halal` banners | `s=order-preparing`, `s=order-ready`, `dev-journey route=short speed=max auto=all` |
| WP5 | History chips each send `state`; empty vs filtered empty; load more + failure; terminal panels (`order_*` restaurant variants needed) | After a journey completes and one rejected order: History shows Completed and Declined; open each | `s=restaurant-rejected`, journey |
| WP6 | Each `restaurant_onboarding_*` fixture renders its step; documents (`restaurant_document_pack_empty/incomplete/complete`, `document_*`), upload (`presigned_upload`, `stored_object_*`), `error_documents_incomplete` | `profile` fills profile (manual address + pin) -> `docs-todo` uploads 4 files -> send -> `s=docs-reject` -> Fix -> resend -> `s=docs-approve` -> payout step | `profile`, `docs-todo`, `docs-review`, `docs-rejected`; `s=docs-approve`, `s=docs-reject` |
| WP7 | Connect fixtures (`connect_status_complete`, `connect_status_requirements_due`, 404), first menu + hours | `payout` -> Set up payouts (fake Stripe client returns link) -> return URL -> menu step -> add item -> `s=menu-approve` -> Done -> Go to orders; `s=onboard-restaurant` end to end | `payout`, `menu`; `s=menu-approve`, `s=onboard-restaurant` |
| WP8 | `owned_menu_with_pending_version`, `menu_item_*`, `menu_version_*`, `error_menu_locked`, `error_price_out_of_range`, `error_prohibited_ingredient`, `error_halal_tag_not_writable`, `error_category_name_taken`, `error_item_blocked_by_admin` | `menu`: first category + item -> Under review -> `s=menu-reject` -> Not approved notice -> resubmit -> `s=menu-approve`; `bismillah-grill`: toggle availability, length menu; `suspended`: everything read-only | `menu`, `bismillah-grill`, `suspended`; `s=menu-approve`, `s=menu-reject` |
| WP9 | `restaurant_hours_standard`, availability fixtures, overlap/limit validation | Edit Friday split + late night -> save -> reload; add special date closed today -> Right now shows Closed today -> remove; pause 30 min -> resume confirm | `bismillah-grill`, `paused`, `suspended` (hours editable) |
| WP10 | Profile/halal variants, `session_grant_password_changed`, `error_current_password_incorrect`, `error_breached_password`, documents | Change password -> other context signed out; renew halal certificate on `expiring-halal` (if the op works live); device sound toggle | `bismillah-grill`, `expiring-halal`, `expired-halal` |
| WP11 | `payout_*`, `restaurant_payout_history`, `payout_list_empty`, connect fixtures | `bismillah-grill` opens payouts and history (needs a payout run seeded: missing) | `bismillah-grill` |

### 6.1 Fixtures and seed data that are missing (file issues; contract fixtures are generated: change the builder, not the JSON)

Contract fixtures:
- Restaurant order views for DELIVERED, COMPLETED, CANCELLED (before and after accept), DISPUTED,
  RESOLVED, ARRIVED; a READY_FOR_PICKUP view with `pickup_code` (after #290); a list containing a
  COMPLETED row (pins #601 client guard).
- Realtime restaurant scenarios: `restaurant.order_offered` (one, burst of 4), `order_offer_expired`,
  `order_offer_withdrawn` (customer_cancelled, payment_failed), `order_accepted` / `order_rejected` from
  another screen, `restaurant.status_changed` (auto-off after 2 timeouts), `order.items_adjusted`,
  `order.note_added`, `order.eta_updated`, `dispatch.assigned/unassigned`, `restaurant.payout_updated`,
  `connect.requirements_changed`, `document.review_state_changed`.
- Restaurant profile per `account_state` (PENDING, LIVE, DELISTED, SUSPENDED, DEACTIVATED) and per halal
  `display_state` incl. missing `halal`.
- Login errors: invalid credentials (401), `email_verification_required`, 423 temporary and permanent lock,
  403 BANNED / DELETED / suspended / not-a-restaurant, 409 email taken, 409 TERMS_VERSION_STALE;
  `requestPasswordReset` 202, `resendEmailVerification` 202 and 429 daily limit.
- Connect status: no account (404), payouts disabled with `disabled_reason`, verifying, past due on a live account.
- Hours: none set, 3 ranges + crossing midnight, special dates (closed, 24 h, past midnight), limits.
- Availability: PAUSED until closing (after #312), CLOSED_TOGGLE after auto-off with `missed_order_count=2`.
- Owned menu: empty (owner view), every review status, category limit (40), suspended lock.
- Payout list: several pages (cursor), every state.

Dev-world personas / scenarios:
- Personas: `delisted` (live restaurant, certificate lapsed), `deactivated`, `banned`, `closed`,
  `withdrawn`, `payout-restricted` (live, Stripe past due), `halal-unverified-renewal` (renewal in review),
  `hours-none`, `holiday-today`, `locked` (423).
- Scenarios: `offer-timeout` and `offer-timeout-twice` (auto-off; needs a short response window in local,
  e.g. `HG_RESPONSE_WINDOW_SECONDS`, or a clock hook), `capture-fails` (fake payment client failure on the
  next capture), `rider-unassigned`, `prep-overdue` (extensions), `items-adjusted`, `note-added`,
  `disputed` / `resolved-halal-upheld`, `payout-run` (seed a paid + held + failed payout for
  `bismillah-grill`), `pickup-code` (rider enters the code; after #315).

---

## 7. Risks, open questions, cut list

### 7.1 Risks
1. **Design-system dependency.** ~25 proposed composites (§4.2) are not in the live DS and the app may
   define none. If #110/#191-#198 slip, every WP stalls. Mitigation: the orchestrator assigns composite
   building inside `packages/ui-web` per WP, from the owner-approved boards, first.
2. **Pickup code** (#290 contract, #315 backend) not merged: without it no order can reach PICKED_UP
   without a seal scan, so the hand-off and the end-to-end journey break.
3. **#601** (state filter ignored) makes Live orders show finished orders; the client guard hides it, but
   History paging also depends on the cursor working.
4. Audio autoplay and Wake Lock policies differ by browser and tablet; the sound is the restaurant's main
   alarm. Test on Chromium tablet emulation plus one real tablet before launch.
5. Live-only facts (rider phase, cancel reasons) disappear on refresh: kitchens refresh often. Expect
   support calls; the refreshed variants must still be honest.
6. Renewal after onboarding may be refused by the server (409 STEP_NOT_AVAILABLE): a certificate expiring
   after launch would then have no in-app path.
7. Reviewed profile changes have no API: the owner expects them at launch.
8. Volume: about 630 renderings across 6 canvases (live-orders 143, menu-hours 122, onboarding 121, settings
   134, payouts 62, sign-in 45, excluding parts, references and later-version boards).
   **(added in check)** Raw board counts in each `canvas.json` (parts and references included): live-orders 147,
   menu-hours 129, onboarding 139, settings 152, payouts 87 (6 on the "Later version" page: `Bell-*` ×4,
   `Later-TwoStepSignIn`), sign-in 55 (4 later-version: `SignIn-Code`, `-CodeSubmitting`, `-CodeError`,
   `-CodeLocked`). Every board file has a canvas entry and vice versa.

### 7.2 Open questions for the owner
- Q1. Nav: the Live Orders canvas adds **History** as its own nav item; Menu & Hours and Payouts rails do
  not. Build the six-item rail?
- Q2. Strip keys and wording: Live Orders says **A** accept / **D** decline and "Decline"; the Payouts
  canvas and the decision log say "R" and "Reject". Which one? (Plan follows Live Orders: A/D, "Decline".)
- Q3. "Account security stays hidden" vs "changePassword moved into launch" with a "Sign-in and security"
  section in Settings. Plan: ship the Sign-in details section with Change password only; no two-step, no sessions. Confirm.
- Q4. Withdraw application has no API: hide the button, or show it disabled with "call partner support"?
- Q5. Cuisines: no restaurant-readable list. Ship onboarding without the cuisine picker (server default) or
  block on the lookup?
- Q6. Special dates: does a closing time earlier than opening run into the next day, and is the reason
  shown to customers?
- Q7. Pause "until closing" before #312's backend lands: hide it, or ship 15/30/60 only?
- Q8. Can a DEACTIVATED restaurant edit its menu? (Drawn view only.)
- Q9. Who reads an acceptance note? (Plan: no note at launch, per the canvas.)
- Q10. **(added in check)** `deleteMenuItem` is V0 in main but the Menu canvas draws "withdraw this item" only as a
  Needs API chip. Ship a "Remove item" action at launch (needs a board), or leave it out? (Plan: leave out.)

### 7.3 What to cut first if time runs out before Mon 12 Oct (in this order)
1. Later-version and reference boards (already out): bell, two-step, seal, staff, Docs-History.
2. WP11 payout **detail** variants that need entries (ReversalLater, HalalAdjustment) and deep-link paging;
   keep the payout account page and the history list.
3. WP10b: profile edit panels for reviewed fields (they have no API anyway; leave locked + Contact
   support), What's new, This device extras (notifications ask; keep sound).
4. Zoom-200 nav sheet and 320 px reflow polish (keep no horizontal scroll).
5. WP5 history filter chips beyond All (keep All + panel).
6. WP9 special-date edge cases (24 h, past midnight, past dates view); keep add/remove closed day.
7. WP8 item editor rejection variants beyond the generic Not approved + note; keep create, edit,
   availability switch, lock.
8. WP7 withdraw/blocker flows except Suspended-Setup and Delisted-Setup.

Never cut: the strip (accept/decline/sound/keys), Live orders in-progress list with Mark ready and the
pickup code, open/pause switch, sign in and reset, the halal rules (no badge when missing, slate expired),
empty/loading/error on every shipped screen.
