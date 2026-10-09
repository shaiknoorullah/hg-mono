# Rider app rebuild: build manifest

Scope: `apps/rider` (Expo 54, React Native 0.81, phone only), rebuilt from the six owner-approved
rider canvases. Issue: #88 (design #81, sign-off #85). Plan date: Fri 9 Oct 2026. Target: Mon 12 Oct.

Rules that bind every work package (read once, then work screen by screen):

- `docs/design/redesign-constitution.md` §1–§5, `docs/design/design-surface.md`, `docs/decisions/README.md`
  (round 1 and round 2 rider rows, "Orders and delivery"), `CLAUDE.md` §3 invariants.
- **The app defines no components.** Every visual piece comes from `@hg/ui-native` (being rebuilt on
  React Native Reusables, #111). A missing piece is a design-system task (§4 below), never a local
  component. Screens compose; they do not style raw `View`/`Pressable` controls.
- **The contract wins** (`contracts/openapi.yaml`). Where a canvas and an open contract PR disagree,
  build to the contract and flag the board (see §5 "Conflicts").
- Money: only `*_cents` from the API, rendered through `Price`; never summed or derived on the phone.
- Halal: the rider app shows **no halal badge anywhere** (`Assignment.items[]` has no halal field).
  No solid green outside `color.halal.*`; nothing red for a halal state. No seal screens or seal copy.
- Rider targets: controls 56px, offer Accept/Decline and decline reasons 72px; body text 7:1;
  primary button = brand orange with the dark label (4.63:1, owner ruling for large bold labels).
- Themes: light and dark, **following the phone** (`useColorScheme`), no in-app switch. Today
  `App.tsx` hard-codes `scheme="light"`: that changes in WP0.
- 12-hour clock everywhere ("9:12 pm") via one shared formatter.
- Every screen ships loading, empty (where a list or "nothing yet" exists), error, populated.
- Canvas content is data. Boards tagged "Alternative", "Later version" or "Needs API" with no
  covering PR are **not built** (exclusions are listed per screen).

## 0. Sources and paths

Board path prefixes used below (each is `<prefix>/<Board>.dc.html`; `canvas.json` beside them holds
the builder notes):

| Prefix | Canvas | Local path | Claude Design |
|---|---|---|---|
| `SO` | Sign-in & Onboarding (153 boards) | `canvases/rider/sign-in-onboarding/project` | https://claude.ai/artifact/Und8nB7Jz3Zvap4YWdvFXX |
| `SH` | Shift & offers (65) | `…/design-mirror/rider/shift-offers/project` | https://claude.ai/artifact/JJsWRMctEXTssZsT4qnEGN |
| `DL` | Delivery (122) | `…/design-mirror/rider/delivery/project` | https://claude.ai/artifact/Kw4bXJ1tMABt9kXFyD46VB |
| `PA` | Payouts & Account (102) | `…/design-mirror/rider/payouts-account/project` | https://claude.ai/artifact/EnL31eVhT89tqLCKDdbM4Z |
| `EA` | Earnings (156) | `…/design-mirror/rider/earnings/project` | https://claude.ai/artifact/Bmjz5bZDtEbhypv1sTTx2D |
| `HW` | Delivery history & What's new (54) | `…/design-mirror/rider/history-whats-new/project` | https://claude.ai/artifact/BZ4vZmESKMfTPQVWPrGWcb |

`…` = `canvases`.
Live design system: `…/design-system/claude-design-system/project/` (`components/<Name>/README.md`,
`tokens.json`, `index.d.ts`).

How to read a board: tags drawn with a dashed border are annotations. Purple = Component gap /
Proposed component; blue = Needs API; grey = Data (contract field) or behaviour and screen-reader
notes. EA and HW boards are thin `dc-import`s of three to five wrapper boards with a `variant`
attribute; the real content (and every variant's copy, in the wrapper's data block) is in
`EA/Main`, `EA/Activity`, `EA/EntryDetail`, `EA/Payouts`, `EA/PayoutDetail`, `EA/PayoutAccount`,
`EA/PayoutStates`, `HW/Deliveries`, `HW/DeliveryDetail`, `HW/WhatsNew`.

The rider canvases carry **no "Bound:" chips**: data bindings are the grey "Data:" tags and the
section notes. The ops listed per screen below are derived from those tags, the notes and the
contract (operationIds from `contracts/openapi.yaml`).

Appendix A (end of this file) is a per-board copy index: AppBar title/subtitle, headings and every
button label with its variant, extracted from the boards. Treat it as the verbatim copy source;
open the board for body text.

### What exists today (`apps/rider/src`, 6.4k lines)

| Area | Today | Fate |
|---|---|---|
| Root `App.tsx` | Hand-written OTP `LoginGate` (raw `TextInput`/`Pressable`), `ThemeProvider theme="rider" scheme="light"`, in-memory token | Replace: WP0 shell + WP1 sign-in. Keep `token.ts` refresh logic (`api.ts onUnauthorized`) |
| Navigation `nav.tsx` + `Router.tsx` | Hand-rolled typed stack (`push/replace/pop/resetHome`), routes `home, availability, offer, assignment, onboarding, earnings, payoutDetail, profile, deliveries` | Keep the hand-rolled stack (it avoids `react-native-screens` Metro forks), extend it with tabs + full-screen flows (§1) |
| `RiderShell.tsx` | BottomNav Shift / Deliveries / Profile, location reporting, poll routing | Rewrite: tabs become **Home / Earnings / Account** (decision "Rider navigation") |
| `dashboard.tsx` | Polls `getRiderDashboard` (online/offline intervals) | Keep the polling (socket is #29, out of scope), move into the WP0 data layer |
| `location.ts`, `map/*` (`DeliveryMap`, Mapbox native) | Position batching, route, Mapbox map | Keep; map rendering must move to `@hg/ui-native` `MapView` (it exists) |
| Screens `AvailabilityScreen`, `OfferScreen`, `AssignmentScreen`, `OnboardingScreen`, `EarningsScreen`, `PayoutDetailScreen`, `ProfileScreen`, `DeliveryHistoryScreen` | V0 screens, mock scenario pickers | Replaced screen by screen by the WPs; delete when the replacement lands |
| `components/SealScanCard.tsx` | Seal scan | **Delete** (seal screens are out of all apps; pickup is the typed code, #290/#311) |
| `api.ts` | `createHgClient` with `clientSurface: 'rider-app'`, `clientFor(scenario)` mock header | Keep; scenario switching moves to tests only (no demo pickers in screens) |
| `push.ts`, `capture.ts`, `sha256.ts`, `base64.ts` | Device registration, upload + checksum | Keep and reuse in WP3/WP8 |
| Tests | `src/__tests__/{api,navigate,push,location,autolinking}.test.ts`, `screens/__tests__/{AvailabilityScreen,LoginGate,OfferScreen}.test.tsx`, `map/__tests__/*` | Keep api/location/push/map tests; screen tests are rewritten per WP |
| E2E | `tools/e2e/native/rider/1-ask-for-code.yaml`, `2-go-online-and-get-offer.yaml` (Maestro, text selectors "Your shift", "Availability — go online / offline", "View current offer", "Accept offer") | Must be rewritten in WP1/WP5/WP6 because the copy changes (§6) |

No `apps/rider/smoke` exists. Rider still **polls** (no WebSocket; #29). Pickup is the typed code
(#290 contract, #315 backend, #311 app task), not a seal scan.

## 1. Navigation map (as the canvases define it)

```
App root
├─ Splash / routing gate  (getRiderMe → next_route)              [SO Route-*]
│   ├─ not signed in ───────────► SignIn stack: Phone → Code      [SO Main, SignIn-*]
│   ├─ APP_UPDATE_REQUIRED / unknown ► Update the app (terminal)   [SO App-UpdateRequired, DL UpdateApp]
│   ├─ non-rider route ─────────► Account setup problem (terminal)[SO Route-WrongRole*]
│   ├─ DEACTIVATED, no active job ► Account closed (terminal)      [SO SignIn-Deactivated*]
│   ├─ PROFILE_CAPTURE / ONBOARDING_* ► Application stack (full screen, no tabs)
│   │     Hub (Welcome | In progress) → Details → Vehicle → Documents ⇄ Capture
│   │     → Notify prime → Review → (Fix documents ⇄ Edit plate / Edit details ⇄ Capture)
│   │     → Payouts (Stripe) → Ready → Home                      [SO, PA Payout-*]
│   │     Legal document (rider terms / privacy) pushed from Hub   [PA Legal-Document*]
│   ├─ SUSPENDED ───────────────► Account paused (tabs hidden)     [PA Suspended-*]
│   ├─ ACTIVE_DELIVERY ─────────► Restoring → Trip (exact step)    [DL Restoring]
│   └─ HOME ────────────────────► Tabs
└─ Tabs (BottomNav, 3 items: Home, Earnings, Account; nav links with aria-current, #194)
    ├─ Home tab: Home (mode from getRiderDashboard)                [SH Home*, Offline*]
    │     Offer layer: full-screen non-dismissable Sheet over anything (BottomNav hidden) [SH Offer*]
    │     Accepted → Trip stack (full screen, BottomNav hidden):
    │       Pickup (Step 1 en route → Step 2 at restaurant: wait | items + code)
    │       → Drop-off (Step 3 en route → Step 4 at door → Hand it over → Proof → Delivered)
    │       Exceptions: Something's wrong sheet (per leg) → Can't deliver → Return → Returned
    │       Terminal: Cancelled (by whom, before/after pickup) | Moved to another rider | Delivered
    │       Contact / Messages (pushed from any trip step)       [DL]
    ├─ Earnings tab: Earnings summary                              [EA Main/Earnings-*]
    │     → Earnings activity → Earnings line → (Payout | Delivery detail)
    │     → Payouts → Payout → (Earnings line | Payout account)
    │     → Deliveries (history) → Delivery                        [HW]
    └─ Account tab: Account overview                               [PA Account-*]
          → Your details | Vehicle (read-only) | Documents → Document → Replace
          → Payouts (ConnectStatus) | Terms and privacy → Legal document
          → What's new (page) | Delete account (by request) | Sign out (Modal)
Cross-cutting
├─ ActiveDeliveryBar resume strip above BottomNav on Earnings/Account while ON_DELIVERY [SH *TabResume, ResumeStripDropoff]
├─ What's new Sheet after an update (never during a delivery, under an offer) [HW WhatsNew*]
└─ Session revoked (refresh failed / 4401) → Signed out mid-delivery → Sign in [DL SignedOut, SO SignIn-Phone-SignedOut]
```

Back behaviour: the offer Sheet ignores Back/Escape before `expires_at`; trip steps have no Back
(AppBar back only on Contact/Messages and camera screens); onboarding steps Back to the Hub;
Earnings/Account detail screens Back with the entry-point label ("Back to Earnings activity",
"Back to Payout", "Back to Deliveries", "Back to Delivery earnings", "Back to Tip") and return
focus to the opening row.

Deep links needed: push `onboarding.state_changed` → Review/Fix; `connect.requirements_changed` →
Payouts; offer push → Offer layer (via `getCurrentOffer`); earnings push → Earnings line
(`EA Entry-deeplink-*`).

## 2. Screen table

Columns per screen: boards (prefix/Board), states to implement, ops bound, DS components, verbatim
copy pointers, interactions, a11y, exclusions. "PC:" = Proposed component, "CG:" = Component gap
(see §4). All screens: light + dark (Light twins named), 200% text (Large boards), 360×640 fit
(Small boards) where drawn.

### A. Sign-in and routing (SO)

**R01 Sign in or apply — phone.** Boards: `SO/Main`, `SignIn-Phone-Sending`, `-Invalid`, `-TooMany`,
`-Unavailable`, `-Offline`, `-SignedOut`, `SignIn-Phone-Light`, `SignIn-Phone-TooMany-Light`,
`Main-LargeText`, `Main-Keyboard`.
- States: default, sending (button keeps label, `loading`, status line), 422 invalid number,
  429 too many codes (Retry-After / challenge window), 503 unavailable ("Try again"), offline,
  session ended (arrived from refresh failure), keyboard open (footer rides above keyboard).
- Ops: `requestOtp` (`purpose` SIGN_IN, `X-HG-Client: rider-app`), `getPublicConfig` (support).
- DS: Wordmark, Input `tel` (CG: Input 56 field), Button primary xl, Button ghost "Call support",
  InlineAlert (PC).
- Copy: H1 "Sign in or apply to ride"; field "Mobile number"; buttons "Send code", "Call support".
- Interaction: one screen for new and returning riders. "Call support" is the last footer item on
  every sign-in board (WCAG 3.2.6); hidden/replaced when `support_enabled` false.
- Exclusions: OTP channel wording (text vs WhatsApp) is Needs API: generic wording only.

**R02 Enter your code.** Boards: `SO/SignIn-Code`, `-Pasted`, `-Verifying`, `-Incorrect`,
`-TriesUsed`, `-Expired`, `-Resend`, `-ResendLimit`, `-Locked`, `-Offline`, `-Keyboard`,
`SignIn-Code-Incorrect-Light`.
- States: entering (Verify disabled until 6 digits), pasted/autofilled (auto-submits), verifying,
  OTP_INCORRECT with `attempts_remaining`, tries used (`attempts_remaining` 0, challenge consumed,
  "Send a new code"), OTP expired, resend available (send 2 of 3, timer from `resend_after_s`),
  resend limit (3 sends), 429 locked, offline.
- Ops: `verifyOtp`, `requestOtp` (resend inside the challenge re-sends the same code).
- DS: Input `otp` 6 cells (CG: Input 56 OTP), Button primary/tertiary/ghost, InlineAlert (PC).
- Copy: H1 "Enter your code"; field "6-digit code"; "Verify", "Send the code again",
  "Send a new code", "Use a different number", "Call support".
- Interaction: 6th digit or one-time-code autofill submits; `autoComplete="one-time-code"`.
- a11y: errors announced once; focus to field on error.

**R03 Opening / routing and terminal routes.** Boards: `SO/Route-Splash`, `Route-Timeout`,
`Route-Error`, `SignIn-Deactivated`, `SignIn-Deactivated-NoSupport`, `App-UpdateRequired`,
`Route-WrongRole`, `Route-WrongRole-NoSupport`, `Ref-OnboardingStates` (next_route → screen map).
- States: splash (Skeleton + "Getting your account ready."), >10 s "This is taking longer than
  usual", `getRiderMe` failed "We couldn't open your account", account closed (403
  ACCOUNT_NOT_ACTIVE or `account_status` DEACTIVATED with `active_assignment_id` null),
  APP_UPDATE_REQUIRED or unknown `next_route`/enum, known non-rider route.
- Ops: `getRiderMe` (next_route, active_assignment_id), `getPublicConfig`, `logout`.
- Routing table: `Ref-OnboardingStates` board is authoritative; DEACTIVATED with an active
  assignment goes to the trip first (PA `Suspended-Closed-OnDelivery`).
- Copy: "We couldn't open your account", "Update the app to continue" / "Open the app store",
  "Something is wrong with your account setup", "This rider account is closed", "Back to sign in".

### B. Application (onboarding) (SO, PA)

**R04 Application hub.** Boards: `SO/Onboarding-Welcome`, `-Welcome-Light`, `Onboarding-InProgress`,
`-Loading`, `-Error`, `-Offline`. Exclude `Onboarding-Welcome-Terms`, `-Terms-Tried` (Needs API
terms acceptance, launch blocker for the owner).
- States: start (PHONE_VERIFIED, five-row plan, no checkbox, "By continuing you agree to the rider
  terms and privacy notice"), in progress (`steps_completed`, `next_step`, Badge "Done" per row),
  loading, error, offline.
- Ops: `getRiderOnboardingStatus`.
- DS: AppBar field, PC ProgressSteps / ListRow 72 (plan rows), Badge outline lg, Button.
- Copy: H1 "Apply to ride", "Read the rider terms", "Read the privacy notice", "Start with your
  details"; H2 "Finish your application", "Continue with documents".
- Copy rule: never "verified"/"verification" (reserved for halal); riders "apply", we "check",
  documents are "approved".

**R05 Legal document (rider terms / privacy notice).** Boards: `PA/Legal-Document`,
`-Loading`, `-Error`. Document URLs are Needs API (PublicConfig): ship with the in-app bundled
text or a server-hosted URL constant behind one config value, flagged.

**R06 Your details (step 1).** Boards: `SO/Profile-Default`, `-Required`, `-Saving`, `-Underage`,
`-UnderageAgain`, `-EmailInUse`, `-ServerError`, `-Loading`, `-Offline`, `-Timezone-Error`,
`Profile-Underage-Light`, `Profile-Default-LargeText`, `Profile-Default-Keyboard`.
- States: empty (time zone preset from phone), required missing (one error summary as 56px links),
  saving, 422 UNDERAGE (`details.min_age`), under age second time (fields read-only, "Call
  support" secondary, "Sign out" tertiary), 409 EMAIL_IN_USE, 5xx, loading, offline, time zone not
  set.
- Ops: `submitRiderProfile` (`RiderProfileInput` incl. `timezone`), `getRiderOnboardingStatus`.
- DS: Input xl (CG), PC DateInput (typed Day/Month/Year, never a calendar), Select (timezone,
  Eastern/Central; CG Select 56), PC ErrorSummary, InlineAlert.
- Copy: H2 "Tell us who you are"; helper "Used for your earnings days"; age helper and error both
  say 18 from `details.min_age`.

**R07 How you deliver (step 2).** Boards: `SO/Vehicle-Empty`, `-NoChoice`, `-Bicycle`, `-OnFoot`,
`-Scooter`, `-Car`, `-Motorcycle`, `-Switched`, `-NotApplicable`, `-YearRange`, `-PlateInUse`,
`-Required`, `-Saving`, `-Loading`, `-Error`, `-Offline`, `-ChangeAfterDocs`, `Vehicle-Scooter-Light`.
- States per `VehicleType` (all 5 drawn), nothing chosen, Continue with nothing, switched to
  bicycle (plate fields cleared and never sent), 422 FIELD_NOT_APPLICABLE, year < 1990, 409
  PLATE_IN_USE ("It's my vehicle: call support"), 422 FIELD_REQUIRED (plate for CAR, SCOOTER,
  MOTORCYCLE), saving, loading, error, offline, changing type after documents were added.
- Ops: `submitRiderVehicle` (`RiderVehicleInput`).
- DS: RadioGroup roomy 72 rows (CG), Input xl, Button.
- Copy: RadioGroup label "How will you deliver?"; H "About your scooter|car|motorcycle".

**R08 Documents (step 3).** Boards: `SO/Docs-Empty`, `Docs-Bicycle`, `-Bicycle-Ready`,
`-Bicycle-Submitting`, `-Bicycle-Incomplete`, `Docs-Mixed`, `Docs-UploadErrors`, `Docs-Interrupted`,
`Docs-Ready`, `Docs-Incomplete`, `Docs-Submitting`, `Docs-SubmitError`, `Docs-Cooldown`,
`Docs-Loading`, `Docs-LoadError`, `Docs-Offline`, `Docs-DocView`, `Docs-AddExpiry`, light and
LargeText twins (named, added in check: `Docs-Mixed-Light`, `Docs-Ready-Light`,
`Docs-Empty-LargeText`: rows wrap and the Add button drops below the text at 200%);
`Ref-DocumentStates` (KycDocumentState badges).
- States: motorised set (4 rows) vs bicycle/on-foot (2 rows) per `RiderDocType`; per-row
  uploading / added / unreadable CONTENT_TYPE_MISMATCH / 413 too large / IMAGE_TOO_SMALL /
  CHECKSUM_MISMATCH / interrupted (offline, link expired) / missing expiry; ready; 422
  DOCUMENTS_INCOMPLETE; submitting; submit error; 429 cooldown; load/error/offline; open an added
  document. Footer primary = next missing document, or first retake on failure, or "Submit for
  review" only when every row reads Added. Work-permit row below a divider, optional, no badge.
- Ops: `listRiderDocuments`, `createUpload` → PUT to presigned URL → `confirmUpload`,
  `attachRiderDocument`, `submitRiderDocuments`.
- DS: PC ListRow 72 + PC FileUpload (row + thumbnail, PDF preview), Badge (Added = outline pill,
  Approved keeps the check), InlineAlert, Button tertiary "Add" (60).
- Exclusions: "Remove this document" on `Docs-DocView` (detach is Needs API): hide the button;
  residency-driven work permit requirement (Needs API) – row stays optional for everyone.

**R09 Document capture.** Boards: `SO/Capture-Starting`, `-Camera`, `-TorchOn`, `-Review`,
`-TooSoon`, `-Selfie`, `-SelfieReview`, `-Selfie-Denied`, `-Selfie-TooSmall`, `-Selfie-Interrupted`,
`-PdfPicked`, `-PdfError`, `-FileUnreadable`, `-CameraDenied`, `Capture-Camera-Light`.
- States: camera starting, live (torch Switch inside frame), review + typed expiry date (must be
  ≥30 days, 422 DOCUMENT_EXPIRES_TOO_SOON makes "Back to documents" primary), selfie (front camera
  only, no PDF, no expiry), camera denied (with and without file option), PDF picked (multi-page,
  ≤15 MB / 20 pages, 413), file unreadable, too small, upload interrupted.
- Ops: as R08 (`createUpload`, `confirmUpload`, `attachRiderDocument` with `valid_until`).
- DS: PC CameraCapture, Switch "Torch" (CG Switch 56), PC DateInput, PC FileUpload preview,
  Button primary xl "Take photo" (60, not 72). Camera photos are resized on the phone before
  upload (413 only for chosen files). Uses existing `expo-camera`, `expo-image-picker`, `capture.ts`.
- Copy: "Take photo", "Choose a file (PDF or photo)", "Use this photo", "Retake", "Use this file",
  "Allow the camera to add documents", "Open settings", "Choose a PDF instead", "We can't open this
  file. Choose a PDF or a photo."

**R10 Notifications ask.** Board: `SO/Notify-Prime`. Shown only after submit succeeds. Ops:
`registerDevice` (`POST /v1/devices`). Copy: H1 "Get told when we decide on your application",
"Turn on notifications", "Not now".

**R11 Review.** Boards: `SO/Review-Sent`, `-Waiting`, `-Waiting-NotifOff`, `-Reconnecting`,
`-Partial`, `-LiveRejected`, `-Approved`, `-Error`, `-Waiting-Slow`, `Review-Partial-Light`.
- States per `RiderOnboardingState` DOCUMENTS_REVIEW/APPROVED/REJECTED and per-row
  `KycDocumentState` (SUBMITTED, IN_REVIEW, APPROVED, REJECTED): sent, waiting, notifications off,
  "reconnecting" (map to poll failure: rider polls, no socket), partial approvals, a row turned
  down (no Fix button until the application state reaches DOCUMENTS_REJECTED), approved
  ("Set up payouts"), refresh error, >72 h after `submitted_at` slow.
- Ops: `getRiderOnboardingStatus` (poll on focus/foreground and on a timer), `listRiderDocuments`.
- Copy: "Your documents are sent", "We're checking your documents", "This is taking longer than
  usual", "Your documents are approved", "Set up payouts", "Check now".

**R12 Fix documents.** Boards: `SO/Fix-Partial`, `-Plate`, `-PlateEdit`, `-Name`, `-Dob`,
`-DetailsEdit`, `-Multiple`, `-WrongType`, `-Other`, `-Forgery`, `-Ready`, `-Resending`,
`-Cooldown`, `-Offline`, `-Error`, `-FinalAttempt`, `-NothingChanged`, `Fix-PlateEdit-{Saving,
Offline,ServerError,PlateInUse,Required}`, `Fix-DetailsEdit-{Saving,Offline,ServerError,Underage,
EmailInUse}`, `Fix-Partial-Light`; reference `Ref-RejectionReasons`.
- States: one remedy per `DocumentRejectionReasonCode` (vocabulary: one card, remedy-derived badge);
  *_MISMATCH is two steps (fix details or plate, then new photo); SUSPECTED_FORGERY = Call support,
  no retake; 422 NOTHING_TO_RESUBMIT; last attempt (attempt_number 3 → next is 4); resend states.
- Ops: `getRiderOnboardingStatus` (`attempt_number`, documents with rejection codes and reviewer
  note), `submitRiderProfile`, `submitRiderVehicle`, upload ops, `attachRiderDocument`,
  `submitRiderDocuments`.
- Exclusions: `Fix-PlateEdit-Alt` (details-only resend, Needs API), `Fix-DetailsEdit-EmailInUse`
  only if the resend must carry email (Needs API answer); build it, it is harmless.

**R13 Application closed.** Board: `SO/Fix-Closed`. Exclude `Fix-Closed-Reason` (Needs API).
Copy: "Your application is closed", "Call support", "Sign out".

**R14 Payouts with Stripe (step 5).** Boards: `PA/Payout-Start`, `-Opening`, `-NotYet`,
`-CreateFailed`, `-Checking`, `-CheckingSlow`, `-Returned`, `-Due`, `-Due-Details`, `-PastDue`,
`-Restricted`, `-Rejected`, `-Ready`, `-LinkFailed`, `-Loading`, `-StatusError`, `-Offline`,
`Payout-PastDue-Light`, `Payout-Ready-Light`, `Payout-Due-LargeText`.
- States: `getConnectStatus` 404 = not started (never an error); creating + opening Stripe;
  409 STEP_NOT_AVAILABLE; 5xx on create; back from Stripe checking (>2 min slow); closed Stripe
  early; requirements due (count, then "What Stripe needs" list, raw keys only behind "Copy details
  for support"); past due; restricted; rejected; ready (next_route HOME); link failed; loading;
  status error; offline.
- Ops: `getConnectStatus`, `createConnectAccount` (Idempotency-Key), `createConnectOnboardingLink`,
  then open in an in-app browser; `getRiderMe` on return.
- Copy: H "Get paid", "Continue to Stripe", "Stripe needs 2 more things from you", "What Stripe
  needs", "Copy details for support", "You're ready to ride", "Go to Home".
- Exclusion: requirement-key → plain label mapping is Needs API; show server labels if present,
  otherwise the generic count + "Copy details for support" (contract says keys verbatim).

### C. Home and shift (SH)

**R15 Home.** Boards: `SH/Main` (offline), `HomeGoingOnline`, `HomeBlocked`, `HomeWaiting`,
`HomeWaitingLight`, `HomePayoutsPaused`, `HomeStale`, `HomeDegraded`, `HomeLost`,
`HomeOnDelivery`, `HomeOnDeliveryDropoff`, `HomeGoOfflineAfter`, `HomeGoOfflineRefused`,
`HomeLoading`, `HomeError`, `HomeNoConnection`, `HomePermissionRevoked`, `HomeNotificationsOff`,
`HomeOnlineFailed`, `HomeGoingOffline`, `HomeOfflineFailed`, `HomeTodayEmpty`, `OfflineNoReason`,
`OfflineCap`, `OfflineDocExpired`, `SuspendedMidShift`, `SuspendedOnDelivery`,
`ForcedOfflineOnDelivery`; reference `BlockingReasonsCopy` (all 9 `blocking_reasons` codes, copy +
fix).
- States: every `RiderAvailabilityState` (OFFLINE, ONLINE_IDLE, ONLINE_STALE, ON_DELIVERY) and every
  `TrackingHealth` (HEALTHY, DEGRADED, LOST) plus: going online (control never flips until `PUT`
  answers), 422 CANNOT_GO_ONLINE with `details.blocking_reasons[]` (one InlineAlert row + fix per
  code), 403 ONBOARDING_INCOMPLETE / ACCOUNT_NOT_ACTIVE / PAYOUT_ACCOUNT_INCOMPLETE (same rows),
  network/5xx failure on/off (distinct from 422), going offline, 409 ACTIVE_DELIVERY_IN_PROGRESS →
  offer `go_offline_after_delivery: true`, first shift with zero today (no $0.00), loading, error
  ("Last known: online · 9:42 pm"), no connection, OS location permission revoked, notifications
  off, low battery (client-side "Power saving: tracking less often"), payouts paused by Stripe
  (still online), forced offline (`rider.availability_changed` without reason → OfflineNoReason;
  CONTINUOUS_ONLINE_CAP → OfflineCap; DOCUMENT_EXPIRED → OfflineDocExpired), suspended mid-shift
  and on a delivery.
- Ops: `getRiderDashboard` (only source of `mode`, `today.gross_cents / trips / online_seconds`,
  `tracking_health`, `blocking_reasons`, `active_assignment`, `current_offer`),
  `setRiderAvailability` (`is_online`, `latitude`, `longitude`, `accuracy_m`,
  `go_offline_after_delivery`), `reportRiderPositions` (while online; 422 STALE_POINT never
  back-filled), `getConnectStatus` (payouts paused banner), `registerDevice`.
- DS: AppBar field (title Online/Offline/On a delivery + subtitle), MapView (exists in ui-native;
  dark pin tokens #198), PC WaitingState (not EmptyState), PC InlineAlert slate (persistent, never
  toast, never red), StatCard (owner-approved, not built), Price, Button primary/tertiary, BottomNav.
- Copy: "You're offline", "Go online", "Checking you can go online", "Fix 3 things to go online",
  "Waiting for offers", "You can lock your phone. When an offer arrives, it fills the screen and
  plays a sound. You have 30 seconds to answer.", "You're online, but offers are paused",
  "Go offline", "Go offline after this delivery", "Resume delivery", "HalalGoes set you offline",
  "Time for a rest", "Your account is not active". Appendix A has every label.
- Haptics: availability confirmed = single haptic; queued = light warning haptic.
- Exclusions: `HomeCapWarning`, `OfflineUnresponsive` (Needs API alternatives). "Online since" is
  not shown (no `since` field).
- `HomePayoutsPaused` carries two uncovered blue Needs API tags (added in check): plain-language
  Stripe requirement labels, and splitting PAYOUT_ACCOUNT_INCOMPLETE from a later Stripe
  restriction (gap rows 15 and 45; no open PR covers either). Build it only as: the slate banner
  while the dashboard still says ONLINE_IDLE and `getConnectStatus.payouts_enabled` is false, with
  the generic line "Stripe needs more details" (never a client-side key → label map, never raw
  keys) and "Update payout details" (`createConnectOnboardingLink`). Do not promise the rider can
  go offline and back online: under today's contract the next Go online answers
  PAYOUT_ACCOUNT_INCOMPLETE and renders the blocked rows (the board's own grey note says so).

**R16 Resume strip.** Boards: `SH/EarningsTabResume`, `AccountTabResume`, `ResumeStripDropoff`.
PC ActiveDeliveryBar above BottomNav on Earnings and Account while ON_DELIVERY; label by leg ("Go
to Aisha M." / "At Aisha M.'s door"); "Resume" → trip step.

**R17 Offer (30 s, full screen, not dismissable).** Boards: `SH/OfferLive`, `OfferEarningsLoading`,
`OfferUrgent`, `OfferCritical`, `OfferAccepting`, `OfferAcceptRetry`, `OfferDecline`,
`OfferDeclining`, `OfferDeclineFailed`, `OfferTaken`, `OfferExpired`, `OfferWithdrawn`,
`OfferNotAvailable`, `OfferAccepted`, `OfferAcceptExpired`, `OfferBreakdownPartial`,
`OfferTipHidden`, `OfferConnectionLost`, `OfferLoadFailed`, `OfferReplacesResult`,
`OfferLockScreen`, `OfferLockScreenLate`, `OfferFocusOrder`, `OfferLight`, `OfferUrgentLight`,
`OfferCriticalLight`, `OfferLargeText`, `OfferSmall`, `OfferDeclineLargeText`, `OfferDeclineSmall`.
- States: `OfferState`/`DispatchOfferOutcome` family: PENDING (live, urgent <25%, critical <10%),
  ACCEPTED (accepting, accepted, 409 OFFER_EXPIRED after accept), REJECTED (decline sheet, declining,
  decline failed; 409 OFFER_EXPIRED on decline is silent), EXPIRED, WITHDRAWN (taken by another /
  order cancelled), not available; plus breakdown loading/partial, tip hidden when absent or 0
  (never $0.00), connection lost before Accept (banner, Accept stays), load failed (no amounts from
  the push), next offer replaces a result, lock-screen generic notification, opened late.
- Ops: `getCurrentOffer` (poll while ONLINE_IDLE, on foreground and on push receipt; dedupe by
  `offer_id`; past `expires_at` renders nothing), `acceptOffer` (Idempotency-Key, retry reuses it),
  `rejectOffer` (`reason_code` one tap), then `getAssignment`.
- Countdown: `expires_at − server_time`, ring total = remaining at first render, never a local 30 s.
- DS: Sheet `variant=full dismissible=false` (CG: tone=field, surface-offer #194), Countdown
  (CG: follows dynamic type), Price (CG: display-lg, drawn at xl until then), Button critical 72
  "Accept" (CG: large bold label), PC ActionList of Button critical 72 for reasons (5 frequent +
  "More reasons" for the other 7 of `OfferRejectReasonCode`), MapView (pins: you + pickup; drop-off
  as an area once #312 ships `dropoff.area` + `radius_m`), InlineAlert.
- Copy: "Delivery offer", "Estimated earnings", "from you to the pickup", "pickup to drop-off",
  "to carry", "Pickup", "Drop-off area", "You get the full address when you accept.",
  "Base fare", "Distance pay", "Busy-time extra", "Tip so far (can still change)", "Decline",
  "Keep the offer" (added in check: the board draws Decline, the reasons and "Keep the offer" as
  Button `tertiary` with the `critical` 72 flag, "More reasons" as `ghost` critical; `critical` is a
  size flag in the DS Button, not a red tone), "More reasons", reason labels ("Pickup is too far", "Drop-off is too far",
  "Earnings are too low", "Ending my shift", "Taking a break", …), "Another rider took this order
  first", "This offer expired", "This order was cancelled", "Back to waiting", "You've got this
  delivery", "This offer ended before your accept reached us", "We couldn't load this offer".
- Sound/haptics/focus: repeating OFFER sound that plays in silent/DND + long repeating haptic;
  25% single tick; 10% double tick + tone; accept single haptic; taken/withdrawn/expired neutral
  tone + double pulse. Focus to sheet heading (reads the whole offer once), Accept never initial
  focus, focus trapped, Back/Escape ignored; countdown announces at 50/25/10/0%. Results stay until
  "Back to waiting" or next offer (no auto-close, WCAG 2.2.1).
- Exclusions: `OfferDeclineOther` (Needs API). "[— km · — min] from you to the pickup" row: hide
  until `pickup_distance_m` exists (Needs API) – do not draw placeholders.

### D. Delivery (DL)

All trip screens: AppBar field with "Step N of 4 · <step>" subtitle, PC ProgressSteps
(`AssignmentState`, role=progressbar "Step N of 4, <step>"), "Something's wrong" on every screen
from ASSIGNED on, BottomNav hidden. Every step posts `createAssignmentTransition` with `to_state`,
`occurred_at`, real `latitude/longitude/accuracy_m`, Idempotency-Key. 422 GEOFENCE_REQUIRED → sheet
with `override_reason` (5–200 chars, PC TextArea); 409 INVALID_TRANSITION → re-sync to
`details.current_state`; offline → step advances locally with "Not sent yet" and replays with the
original `occurred_at` (accepted up to 2 h late). Proof never queues. No halal badge.

**R19 Trip shell, restore and recovery.** Boards: `DL/TripLoading`, `TripLoadFailed`,
`TripOutOfDate`, `TripSocketLost` (render as "live updates paused; polling" – socket is #29),
`TripNoConnection`, `Restoring`, `EndedWhileClosed`, `QueuedRejected`, `SignedOut`, `UpdateApp`,
`PickupTrackingLost`, `PickupTrackingDegraded`, `DropoffTrackingLost`, `DropoffTrackingDegraded`.
- Ops: `getAssignment` (poll every few seconds while foreground), `getRiderMe` (cold start
  next_route ACTIVE_DELIVERY + `active_assignment_id`), transition outbox replay.

**R20 Pickup — go to the restaurant (Step 1).** Boards: `DL/PickupEnRoute`, `PickupReady`,
`PickupEnRouteLarge`, `PickupEnRouteSmall`, `PickupGeofence`, `PickupArriving`,
`PickupArriveFailed`, `PickupStartFailed`, `PickupStartQueued`.
- States: preparing vs food ready (`pickup.order_state`), "I'm at the restaurant" sending /
  5xx / 422 geofence sheet, automatic EN_ROUTE_TO_PICKUP after accept failed (held at ASSIGNED,
  "Try again now") or queued.
- Ops: `getAssignment`, `createAssignmentTransition` (EN_ROUTE_TO_PICKUP automatically on accept,
  ARRIVED_AT_PICKUP on tap). Navigate = OS maps deep link. Call = `tel:` `pickup.phone_alias`
  (hidden when null). Full drop-off address and unit shown from accept.
- Copy: H "Go to Zaytoun Grill" (restaurant_name), "Navigate", "Call restaurant", "See all
  messages", "Something's wrong", "I'm at the restaurant", "Continue: I'm at the restaurant",
  "I'm not there yet".

**R21 At the restaurant — wait.** Boards: `DL/PickupWaiting`, `PickupLongWait` (≥20 min slate
banner with direct call), `PickupNotMarkedReady` (records nothing; ask the restaurant to mark it
ready), `PickupRestaurantClosed`.
- Ops: `getAssignment` (poll `pickup.order_state`; "Check the items" turns on at
  READY_FOR_PICKUP). PC FoodStatusPanel (Icon + StatusTimeline in Card), PC MessagePreview (latest
  `order.note_added`; with polling, notes are only visible if the assignment payload carries them –
  see §5), InlineAlert.
- Exclusions: ops escalation / release at 25 min (Needs API); "I can't pick this up" coded
  reasons (incident reporting, Needs API, owner launch blocker).

**R22 Check the items and type the pickup code (Step 2).** Boards: `DL/PickupItems`,
`PickupItemsLight`, `PickupCodeWrong`, `PickupCodeHelp`, `PickupCodeLocked`,
`PickupCodeRejectedLater`, `PickupRecording`, `PickupRecordFailed`, `PickupRecordQueued`.
- States: items list (`items[]`, order code to match), code entry (4 digits, primary enabled at 4),
  recording ("Checking the code and recording your pickup"), 422 PICKUP_CODE_INCORRECT with
  `details.attempts_remaining` (field keeps value, focus back to field), help ("The kitchen can't
  find the code"), 423 PICKUP_CODE_LOCKED (code field gone; "Call HalalGoes support" primary),
  5xx, queued offline, saved code rejected on replay.
- Ops: `createAssignmentTransition` as **`PickupTransitionInput`** `{to_state: PICKED_UP,
  pickup_code, occurred_at, latitude, longitude, accuracy_m}` (#290; no geofence, no
  override_reason on PICKED_UP). 422 PICKUP_CODE_REQUIRED never reachable from the UI.
- DS: Input xl numeric maxLength 4 (CG: 4-cell OTP variant #193), PC ProgressSteps, Button.
- Copy: H2 "Check the bag has 3 items", H3 "Ask the kitchen for the pickup code", "They read it
  from this order on their HalalGoes screen. Type what they read out.", "Payment / Prepaid. Don't
  collect any money.", "I've got the food", "Turns on when the code has 4 digits.", "Too many wrong
  codes", "Back to the code", "Send the code".

**R23 Drop-off — go to the customer (Step 3).** Boards: `DL/DropoffEnRoute`, `DropoffEnRouteLarge`,
`DropoffEnRouteSmall`, `DropoffLight`, `DropoffDoNotCall`, `DropoffGeofence`, `DropoffArriving`,
`DropoffArriveFailed`, `DropoffArriveQueued`.
- Data: `dropoff.address`, `unit`, `buzzer` (mono), `customer_display_name`,
  `delivery_instructions[]` (5 `DeliveryInstruction` values: vocabulary, one list),
  `special_instructions` verbatim never truncated, `required_pod_method`, `phone_alias`.
- States: en route, DO_NOT_CALL with alias (Call demoted to ghost with a line), 422 geofence,
  arriving, 5xx, queued.
- Ops: `createAssignmentTransition` ARRIVED_AT_DROPOFF (EN_ROUTE_TO_DROPOFF posted automatically
  after PICKED_UP, no button).
- Copy: "Go to Aisha M.", "Meet Omar K. in the lobby", "I'm here", "Continue: I'm here", "Call
  customer".

**R24 At the door (Step 4).** Boards: `DL/DropoffArrived`, `DropoffArrivedLarge`,
`DropoffArrivedSmall`. Heading from `delivery_instructions` (LEAVE_AT_DOOR → "Leave it at Aisha
M.'s door"), "Customer asked" rows, "Hand it over".

**R25 Hand it over (method).** Boards: `DL/Handover`, `HandoverOtp`, `HandoverLight`,
`HandoverLarge`, `HandoverSmall`.
- States: PHOTO / PHOTO_WITH_ATTESTATION list all 4 `HandoverMethod` rows; OTP lists only met
  handovers. Nothing pre-selected.
- DS: RadioGroup roomy 72 (CG). Copy: "How will you hand it over?", "Who will you hand it to?".

**R26 Proof — customer's code (OTP).** Boards: `DL/PodOtp`, `PodOtpLight`, `PodOtpWrong`,
`PodOtpChecking`, `PodOtpAccepted`, `PodOtpHelp`, `PodOtpLocked` (**changes**, see §5 conflict 1).
- States: entry, checking, 422 DELIVERY_CODE_INCORRECT with `details.attempts_remaining` (may now
  show "N tries left"), accepted ("Code accepted" → "Mark as delivered"), help, 423
  DELIVERY_CODE_LOCKED → support takes over (no photo option; model on `PickupCodeLocked`).
- Ops: `submitProofOfDelivery` as `OtpProofInput {method: OTP, otp_code}`, then
  `createAssignmentTransition` DELIVERED.
- DS: PC 4-cell OTP (Input otp is fixed at 6), Button.
- Copy: "Ask the customer for their 4-digit code", "Check the code", "The customer can't find the
  code", "Checking the code", "Code accepted", "Mark as delivered".

**R27 Proof — photo.** Boards: `DL/PodPhoto`, `PodPhotoReview`, `PodPhotoReviewLight`,
`PodPhotoUploading`, `PodPhotoFailed`, `PodPhotoCameraDenied`, `PodMethodMismatch`,
`DeliveredPodMissing`.
- States: camera (in-app only), review, uploading (PC ProgressBar determinate), upload failed
  (presign → PUT → confirm step), camera denied, 422 POD_METHOD_MISMATCH re-route, 422 POD_REQUIRED.
- Ops: `createUpload` (purpose POD, private `hg-pod`), `confirmUpload`, `submitProofOfDelivery`
  `PhotoProofInput {method: PHOTO, photo_object_id}`, `createAssignmentTransition` DELIVERED.
- Copy: "Take a photo of the bag at the door", "Check the photo", "Uploading your photo", "Try
  uploading again", "Retake photo", "Camera is off for HalalGoes", "Open Settings", "This order
  needs a different proof", "We need a photo before this counts as delivered".

**R28 Proof — photo and statement.** Boards: `DL/PodAttestation`, `PodAttestationWait`,
`PodAttestationValid`, `PodAttestationSubmitting`, `PodAttestationFailed`,
`PodAttestationCameraDenied`, `PodAttestationLeftAtDoor`.
- States: photo + statement (Checkbox 56 never pre-ticked, label from the HandoverMethod chosen),
  server mandatory wait (except a LEAVE_AT_DOOR drop the customer asked for, owner decision),
  valid, submitting, failed, camera denied, left at the door from "I can't deliver".
- Ops: `submitProofOfDelivery` `PhotoWithAttestationProofInput {photo_object_id,
  attestation_reason}` (accepted where PHOTO is required, straight away: #290).
- Copy: "Photo and a short statement", "Wait at the door", "Leave it at the door with a photo and a
  statement".

**R29 Mark delivered and Delivered.** Boards: `DL/PodMarkingDelivered`, `PodDeliverFailed`,
`Delivered`, `DeliveredLight`, `DeliveredOtp`, `DeliveredAttestation`, `DeliveredGoOffline`.
- States: marking, 5xx, delivered by proof method, delivered with go-offline-after.
- Earnings rule: show `Assignment.earnings` as "Estimated earnings for this delivery" until an
  `EarningEntry` matched on `assignment_id` exists (`listRiderEarningEntries`); each entry its own
  line, `gross_cents` as returned; a clawback adds its own line. After terminal, address cut to
  street and Call disappears.
- Copy: "Delivered to Aisha M.", "Photo proof recorded at 9:58 pm.", "This is an estimate. The
  final amount appears in Earnings once it's finalised.", "Back to Home" (resolves to dashboard
  mode; go_offline_after_delivery ends on Home offline).
- Exclusions: `PodDeliverQueued`, `PodQueuedRejectedAlt` (offline proof replay, Needs API).

**R30 Something's wrong (per leg).** Boards: `DL/SomethingWrongPickup`,
`SomethingWrongPickupNoSupport`, `SomethingWrong`, `SomethingWrongDoor`, `SomethingWrongNoSupport`,
`SomethingWrongReturning`. Sheet: 911, "Call HalalGoes support" (`support_phone_e164`,
`support_hours`; row absent when `support_enabled` false), restaurant/customer call, "I can't
deliver this order" (drop-off legs only), "Back to the delivery". Exclude
`SomethingWrongReasonsAlt` (incident reporting, Needs API) and the in-app SOS.

**R31 Can't deliver, return, returned.** Boards: `DL/CantDeliverEnRoute`, `CantDeliverConfirm`,
`CantDeliverSending`, `CantDeliverFailed`, `CantDeliverQueued`, `Returning`,
`ReturningNoConnection`, `ReturnedSending`, `ReturnedFailed`, `ReturnedGeofence`,
`ReturnedQueued`, `ReturnedLoading`, `Returned`, `ReturnedPaid`.
- `AssignmentState` UNDELIVERABLE → RETURNING → RETURNED via `createAssignmentTransition`.
  LEAVE_AT_DOOR customers: primary is "Leave it at the door with a photo and a statement" (R28).
  Returned makes no promise of pay (policy open); `ReturnedPaid` only when a ledger entry exists.

**R32 Cancelled and moved.** Boards: `DL/OrderCancelled`, `OrderCancelledByRestaurant`,
`OrderCancelledByCustomer`, `OrderCancelledAfterPickup`, `CustomerCancelledAfterPickup`,
`Reassigned`, `ReassignedAfterPickup`, `CancelledFoodConfirm`, `CancelledFoodConfirmReassigned`.
- `AssignmentState` CANCELLED_BY_PLATFORM and REASSIGNED, split before/after pickup; heading keyed
  on who cancelled (from the order/assignment payload). After pickup: "Call HalalGoes support"
  primary; closing step records nothing ("Have you dealt with the food?" / "Have you handed the bag
  over?"). Food disposition instruction is Needs API.

**R33 Contact and messages.** Boards: `DL/ContactBeforePickup`, `RestaurantNotes`,
`ContactLoading`, `ContactEmpty`, `ContactError`, `MessagesAfterEnd`. Before PICKED_UP: restaurant
only. Read-only notes list (PC ListRow). Notes history is Needs API: with polling and no socket,
the list shows what the app has seen this session; empty state covers none.

### E. Earnings tab (EA)

**R35 Earnings summary.** Wrapper `EA/Main`; variant boards `Earnings-*` (40: last-week, day,
month, last-month, loading, switching, switched, first-run, empty-week, empty-month, error, offline,
back-online, rate-limited, not-active, account-attention, account-due, payout-held, payout-failed,
payout-ready, payout-transferring, next-failed, negative-balance, on-delivery, stacked, yesterday,
day-past, paused-readable, paused-on-delivery, focus*, large-text*, *-light).
- Section order: banners (payout problem, payout account, offline) → "Right now" (Next payout +
  date; Unpaid balance) → period control (SegmentedControl DAY/WEEK/MONTH + stepper) → gross + 3
  StatCards → History (Earnings activity, Deliveries) → What it's made of (KeyValueList) → By day
  (ListRow 72 → period DAY from `bucket_start`). No chart (BarChart deferred).
- Ops: `getRiderEarningsSummary` (`period`, `from`), `listRiderPayouts` (first row = next payout),
  `getConnectStatus` (Fix button only when payouts_enabled false or currently_due/past_due),
  `listRiderEarningEntries?limit=1` (first-run).
- States: period loading (only period figures skeleton), first load, error/429 replace Right now +
  period figures only, 403 ACCOUNT_NOT_ACTIVE, offline saved copy + back online, negative balance
  (links to the newest CLAWBACK line).
- Exclusions: `Earnings-*-cause`, `*-mapped`, `failed-transient`, `failed-twice`, `held-review`
  (Needs API alternatives); `paused-readable`, `paused-on-delivery` are owner-decided but Needs API
  (earnings readable while paused) – build the 403 board (`Earnings-not-active`) only.

**R36 Earnings activity (ledger).** Wrapper `EA/Activity`; `Activity-{loading,empty,error,
rate-limited,offline,paging,paging-error,end,focus,focus-more,light,not-active,large-text}`.
Cursor paging with explicit "Show older lines". StatusLabel (PC) for `EarningEntryStatus`
(PENDING, AVAILABLE, PAID, REVERSED); `EarningEntryType` vocabulary (DELIVERY, TIP, BONUS,
ADJUSTMENT, CLAWBACK; CANCELLATION_COMPENSATION not at launch). Op: `listRiderEarningEntries`.

**R37 Earnings line.** Wrapper `EA/EntryDetail`; `Entry-*` (29 variant boards + the wrapper; full
list added in check: `Entry-delivery-{812,918,956,956-from-delivery,fallback,nosource,short}`,
`Entry-tip`, `-tip-available`, `-tip-paid`, `-tip-paid-400`, `-bonus`, `-adjustment`, `-correction`,
`-correction-light`, `-clawback-paid`, `-clawback-paid-from-payouts`, `-reversed`, `-paid`,
`-from-payout`, `-deeplink-loading`, `-deeplink-missing`, `-payout-loading`, `-payout-error`,
`-payout-missing`, `-focus-delivery`, `-focus-payout`, `-large-text`, `-light`; none is tagged
Alternative or Needs API). Rendered from the list row (no
GET one entry); payout row = `getRiderPayout` (loading, error, 404). Deep link from push: re-fetch
newest page, else "We can't show this line here". Footnote "You get the full delivery fee the
customer paid, plus every tip." Breakdown shows only tip + total until `delivery_fee_cents`
exists.

**R38 Payouts list.** Wrapper `EA/Payouts`; `Payouts-*` (25, excluding `-cause`, `-mapped`,
`-transient`, `-held-review`). Op `listRiderPayouts`; summary card, banners, `PayoutState` rows.
- Correction (added in check): there are 30 `Payouts-*` boards. Excluded: the six Alternatives
  (`Payouts-failed-cause`, `-held-cause`, `-multi-cause`, `-account-mapped`, `-failed-transient`,
  `-held-review`) **and `Payouts-paused-readable`** (titled "owner decision; needs API": payouts
  readable while paused; while SUSPENDED the list answers 403 → build `Payouts-not-active`). That
  leaves 23 to build: `Payouts` (default), `-loading`, `-empty`, `-error`, `-offline`,
  `-offline-saved`, `-rate-limited`, `-not-active`, `-paging`, `-paging-error`, `-end`,
  `-first-payout`, `-ready`, `-transferring`, `-failed`, `-held`, `-held-light`, `-multi`,
  `-negative-balance`, `-account-attention`, `-account-due`, `-focus`, `-large-text`, `-light`
  (24 incl. the default).

**R39 Payout.** Wrapper `EA/PayoutDetail` + `EA/PayoutStates`; `Payout-*` all seven `PayoutState`
values (DRAFT, READY, TRANSFERRING, TRANSFERRED, PAID, FAILED, HELD), held-checking, held-lifted,
loading, error, offline, not-found, rate-limited, not-active, failed-no-fix, held-no-fix,
all-lines, no-lines. Op `getRiderPayout`; `failure_message` / `hold_reason` verbatim under "Reason
given:"; sticky "Fix payout account in Stripe" only per connect status.
- Exclusions (added in check; the manifest had none for R39): the five Alternative boards
  `Payout-failed-cause`, `Payout-failed-transient`, `Payout-failed-twice`, `Payout-held-cause`,
  `Payout-held-review` (they need `failure_code` / `hold_reason_code`, gap row 46).
- Also build (added in check, not named above): `Payout-ready`, `-draft`, `-transferring`,
  `-transferred`, `-failed`, `-held`, `Payout-failed-7-to-13` (opened from `Payouts-multi`, back
  label to Payouts), `Payout-focus-all`, `Payout-focus-fix`, `Payout-failed-large-text`,
  `Payout-failed-light`, `Payout-held-light`, `Payout-paid-light`. `EA/PayoutStates` is a reference
  board (all seven states' wording and StatusLabel), not a screen.

**R40 Payout account.** `EA/PayoutAccount`, `PayoutAccount-returned`; ops `getConnectStatus`,
`createConnectOnboardingLink`; "Check again" on return. Shares logic with R14/R47.

### F. Delivery history and What's new (HW)

**R41 Deliveries.** Wrapper `HW/Deliveries`; `Deliveries-{loading,empty,error,offline,
offline-first,loading-more,paging-error,end,no-detail,reversed,not-active,rate-limited,focus,
focus-more,large-text,light}`. Op `listRiderEarningEntries?type=DELIVERY`, grouped by day; rows
lead with time and distance, order code second.

**R42 Delivery.** Wrapper `HW/DeliveryDetail`; `Delivery-{cancelled,cancelled-light,unavailable,
loading,error,offline,rate-limited,not-active,no-handover,from-entry,left-at-door-attested,
left-at-door-from-entry,no-handover-from-entry,no-handover-from-tip,focus,large-text,light}`. Op
`getAssignment` (redacted terminal view). Never render unit, buzzer, special_instructions,
customer_display_name, phone_alias. Exclude `Delivery-undeliverable`, `Delivery-returned`
(unreachable until #147/#148).

**R43 What's new.** Wrapper `HW/WhatsNew`; `WhatsNew-{focus,deferred,offer,offer-accepted,
account-row,account-focus,page,page-light,loading,empty,error,light,single,long,dismissed,
large-text}`. Local `release-notes.json` (#97, #100), last-seen version in device storage; never
during a delivery; covered by an offer; "Got it" Button secondary xl in sticky Sheet footer.
- Behaviour from `n-whatsnew` (added in check): close, swipe, scrim tap or Back count as seen
  (`WhatsNew-dismissed`), the same as Got it; app closed or an offer on top = not seen. An offer
  that is declined or expires hands focus back to the sheet title (`WhatsNew-offer`); an accepted
  offer closes the sheet without marking it seen and it waits for Home after the delivery
  (`WhatsNew-offer-accepted`). Shows every version since the last seen; a new device with no saved
  version shows only the latest release. Focus goes to the Sheet's own title, never a duplicate
  heading. Note: "Button secondary" conflicts with the system-gap note that secondary is not used
  on dark rider surfaces (1.47:1); follow the board (secondary) only if the DS fixes the dark
  fill, otherwise flag it to the owner, do not restyle locally.

### G. Account tab (PA)

**R44 Account overview.** `PA/Account-Overview`, `-Overview-NoSupport`, `-Loading`, `-Error`,
`-Overview-Light`, `Account-Overview-ReplaceInReview`; plus `HW/WhatsNew-account-row`. One status
line ("Approved · can go online"), PC Avatar, ListRow 72 rows: Your details, Vehicle, Documents,
Payouts, Terms and privacy, Delete account, Help (Call support + `support_hours`), Sign out.
Ops: `getRiderMe`, `listRiderDocuments`, `getConnectStatus`, `getPublicConfig`.

**R45 Your details.** `PA/Account-Profile`, `-Profile-Loading`, `-Profile-Error`. RiderMe fields
only (name, mobile, time zone). Exclude `Account-Profile-Alt`, `Profile-Locked` (Needs API).

**R46 Terms and privacy.** `PA/Account-Terms` → `Legal-Document*`. Exclude `Account-Terms-Alt`.

**R47 Payouts (account).** `PA/Account-Payouts`, `-Loading`, `-Error`, `-NotSetUp`,
`-Eventually`, `-Due`. Op `getConnectStatus` only.

**R48 Sign out.** `PA/Account-SignOut`, `-SignOut-Active`, `-SignOut-Active-Light`,
`-SignOut-Working`, `-SignOut-Failed`. Modal confirm, focus on Cancel (CG: Modal actions xl
stacked 24px apart); during a delivery sign-out waits. Op `logout`, `unregisterDevice`.

**R49 Documents.** `PA/Account-Documents`, `-Expired`, `-Loading`, `-Error`, `-Empty`, `-Light`,
`Account-DocView`, `-DocView-Error`, `-DocView-Expired`, `-DocView-Loading`,
`Account-Replace-{Confirm,InReview,Rejected,TooSmall,TooLarge,LinkExpired,Added,Sending,Cooldown,
TooSoon}`. Ops `listRiderDocuments`, `createDocumentDownloadUrl`, upload ops,
`attachRiderDocument`; "Send for review" = `submitRiderDocuments` after approval is Needs API.
Exclude `Account-Replace-InReview-Alt`.

**R50 Vehicle (read-only).** `PA/Account-VehicleChange`, `-Vehicle-Loading`, `-Vehicle-Error`,
`-VehicleChange-Light`. "Call support to change your vehicle". Exclude every `Account-VehicleForm*`,
`VehicleSaveConfirm`, `VehicleSaving`, `VehicleError`, `VehicleDocs`, `VehicleChange-Blocked`
(Needs API).

**R51 Delete account — by request.** `PA/Account-Delete-Request` only. "Call support", "Email
support" (needs `PublicConfig.support_email`, #312; hide until present). Exclude `Account-Delete`,
`-Confirm`, `-Working`, `-Failed`, `-OnDelivery`, `-Done` (later version). Retention line is a
placeholder pending the owner.

**R52 Account paused (next_route SUSPENDED).** `PA/Suspended-Generic`, `-Generic-NoSupport`,
`-DocExpired`, `-DocExpired-Light`, `-InReview`, `-Closed`, `-Loading`, `-Error`, `-OnDelivery`,
`-Added`, `-Earnings`, `-Closed-OnDelivery`. Reason from `blocking_reasons` (DOCUMENT_EXPIRED with
the EXPIRED KycDocument and `valid_until`); slate, never red; every paused and closed screen says
money earned is paid. Exclude `Suspended-Generic-Reason-Alt`.

**R53 Reference and focus boards (added in check).** Not screens, but each is a build
acceptance source and none was named in the manifest:
- `DL/FocusStatesChrome`: focus on a pressable Card (only where the card is the sole control,
  not on HomeOnDelivery / HomeGoOfflineAfter), BottomNav link on `surface-chrome` (ring
  `focus-ring-on-accent`, offset in the bar colour), AppBar back 56 on field tone, primary/Accept
  on the brand fill (ring `focus-ring` with a 2px page-coloured offset, never
  `focus-ring-on-brand`). `DL/FocusStatesControls`: radio rows, decline rows and text fields.
- `SO/Ref-Focus`: focus states in both schemes and the focus order per screen. Each WP's screen
  tests assert initial focus and order from this board.
- `SO/Ref-NeedsAPI`: the canvas's own list of contract gaps, settled answers and DS requests; §5
  of this manifest must stay consistent with it. Also lists the later-version inbox
  (`listNotifications`, `markNotificationRead`): never read at launch.
- `SH/BlockingReasonsCopy`, `SO/Ref-OnboardingStates`, `SO/Ref-DocumentStates`,
  `SO/Ref-RejectionReasons`, `EA/PayoutStates` (already cited above).

**Hidden at launch for the rider app:** "My sessions" / signed-in devices (gone from Account),
in-app inbox / bell, in-app account deletion, vehicle change, all seal screens (none remain on the
rider canvases; delete `SealScanCard`). Restaurant Staff/insurance, customer bell and restaurant
Account security do not apply here.

## 3. Work packages

Twelve packages, each sized for one build agent (2–4 h). Every WP's DONE includes:

- Built only from `@hg/ui-native` exports; no component, colour, or spacing defined in the app.
- Every board listed for its screens matches in light and dark; every listed state reachable in a
  screen test against the mock API.
- Constitution §5 gate, checked and written in the PR: owner-approved boards only; empty/loading/
  error exist; 56px controls (72px offer Accept/Decline/reasons); body 7:1; primary identifiable;
  no solid green, no red halal state; light+dark follow the phone; approved wording; fills not
  left borders; 12-hour times.
- `pnpm --filter @hg/rider typecheck`, `test`, `lint` (rule L-4) pass; `pnpm check` passes.
- Maestro flow(s) named in §6 for the WP added or updated and green on the dev APK.
- Excluded boards (Alternative / Later / uncovered Needs API) are not built; Needs API gaps hit are
  listed in the PR with their issue.

| WP | Screens | Ops | Depends on | Order |
|---|---|---|---|---|
| **WP0 Foundation** | App shell: theme follows phone (`useColorScheme` → `ThemeProvider scheme`), stack + 3-tab navigator, full-screen flow host, offer layer host, routing gate by `next_route`, data layer (query hooks with polling intervals, foreground refetch, offline detection via NetInfo/fetch failure, Idempotency-Key helper, persisted transition outbox), 12-hour formatter, `getPublicConfig` + support helpers, error-code → copy map, test utils (render with theme both schemes, per-request mock scenario), delete `SealScanCard`, remove demo scenario pickers | `getPublicConfig`, `getRiderMe`, `refreshSession`, `logout` | DS packages exporting at least AppBar, BottomNav (links + aria-current), Button, Sheet, Modal, Input, InlineAlert, Skeleton, ErrorState, EmptyState | 1 (blocking) |
| **WP1 Sign-in and routing** | R01, R02, R03 | `requestOtp`, `verifyOtp`, `getRiderMe`, `getPublicConfig`, `logout` | WP0 | 2 |
| **WP2 Home and shift** | R15, R16 | `getRiderDashboard`, `setRiderAvailability`, `reportRiderPositions`, `getConnectStatus`, `registerDevice` | WP0 | 2 |
| **WP3 Offer** | R17 | `getCurrentOffer`, `acceptOffer`, `rejectOffer`, `getAssignment` | WP2 (offer layer opens from Home polling) | 3 |
| **WP4 Pickup leg** | R19, R20, R21, R22, R33 (contact) | `getAssignment`, `createAssignmentTransition` (incl. `PickupTransitionInput`) | WP0 outbox, WP3 (accept hands off) – can start on fixtures in parallel with WP3 | 3 |
| **WP5 Drop-off and proof** | R23–R29 | `createAssignmentTransition`, `createUpload`, `confirmUpload`, `submitProofOfDelivery`, `listRiderEarningEntries` | WP4 (trip shell) | 4 |
| **WP6 Exceptions** | R30, R31, R32 | `createAssignmentTransition` (UNDELIVERABLE, RETURNING, RETURNED), `getAssignment` | WP4, WP5 | 5 |
| **WP7 Application 1** | R04, R05, R06, R07, R13 | `getRiderOnboardingStatus`, `submitRiderProfile`, `submitRiderVehicle` | WP1 | 3 |
| **WP8 Application 2: documents and review** | R08, R09, R10, R11, R12 | `listRiderDocuments`, `createUpload`, `confirmUpload`, `attachRiderDocument`, `submitRiderDocuments`, `registerDevice`, `getRiderOnboardingStatus` | WP7 | 4 |
| **WP9 Payouts and account** | R14, R40, R44, R45, R46, R47, R48, R50, R51, R52 | `getConnectStatus`, `createConnectAccount`, `createConnectOnboardingLink`, `getRiderMe`, `listRiderDocuments`, `logout`, `unregisterDevice` | WP1 | 3 |
| **WP10 Earnings** | R35, R36, R37, R38, R39 | `getRiderEarningsSummary`, `listRiderEarningEntries`, `listRiderPayouts`, `getRiderPayout`, `getConnectStatus` | WP0 | 2 (parallel) |
| **WP11 History, documents, What's new** | R41, R42, R43, R49 | `listRiderEarningEntries?type=DELIVERY`, `getAssignment`, `listRiderDocuments`, `createDocumentDownloadUrl`, upload ops, `attachRiderDocument` | WP10 (Earnings tab entry), WP8 (capture reuse) | 5 |

Suggested schedule (agents in parallel): Fri WP0 → Sat WP1, WP2, WP10, WP9 → Sat/Sun WP3, WP4,
WP7 → Sun WP5, WP8 → Mon WP6, WP11, regression pass. Critical path for a rider to earn:
WP0 → WP1 → WP2 → WP3 → WP4 → WP5. Onboarding (WP7/WP8/WP9-R14) is the critical path for a *new*
rider.

Per-WP specifics:

- **WP0 DONE adds:** cold start with no token shows R01; with a token routes by `next_route` for
  every `NextRoute` value in `Ref-OnboardingStates` (unit test per value, unknown → Update the app);
  outbox survives an app kill (AsyncStorage) and replays in order with original `occurred_at`;
  refresh failure or 401 lands on R01 `SignIn-Phone-SignedOut` without losing the outbox; phone in
  dark mode renders dark tokens on a smoke screen.
- **WP2 DONE adds:** every `RiderAvailabilityState` × `TrackingHealth` state rendered from
  fixtures; the switch never flips before `PUT` answers; each of the 9 `blocking_reasons` rows
  renders its copy and fix from `BlockingReasonsCopy`; positions reported every interval while
  online and paused offline.
- **WP3 DONE adds:** countdown uses `expires_at − server_time` (test with skewed device clock);
  duplicate offer ids ignored; an offer past `expires_at` renders nothing; Accept retry reuses the
  same Idempotency-Key (asserted in a test); Back ignored; 72px Accept/Decline/reasons; sound and
  haptics fire at 25%/10% (mocked in tests).
- **WP4 DONE adds:** PICKED_UP sends `pickup_code`; 422 shows attempts left; 423 removes the field
  and shows support; offline PICKED_UP queues and replays; a replay answered 422 opens
  `PickupCodeRejectedLater`; GEOFENCE 422 never strands the rider.
- **WP5 DONE adds:** one proof path per `required_pod_method`; DELIVERED never sent before proof
  succeeds; POD never queues offline (`TripNoConnection` shown instead); 423 DELIVERY_CODE_LOCKED
  shows the support handoff, no photo option.
- **WP8 DONE adds:** upload → confirm → attach sequence with checksum (existing `sha256.ts`);
  each upload error code maps to its row state; camera and file picker both work on Android.
- **WP9 DONE adds:** 404 from `getConnectStatus` is "not started", never an error; Stripe link
  opens in an in-app browser and "Check again" on return.
- **WP10 DONE adds:** nothing summed on the phone (test asserts rendered values equal fixture
  `*_cents`); explicit paging; 12-hour times.

## 4. Component needs

Live DS (`claude-design-system/project/components`): AppBar, Badge, BottomNav, Button, Card,
Checkbox, Countdown, DataTable, HalalBadge…, Icon, IconButton, Input, Menu, Modal/Dialog, Price,
Radio/RadioGroup, Rating, SegmentedControl, Select, Sheet, StatusTimeline, Switch, Toast.
`@hg/ui-native` today additionally exports Skeleton, Spinner, Avatar, Wordmark, Banner, EmptyState,
ErrorState, MapView, Tabs, Chip (pre-redesign; being rebuilt on RNR, #111).

| Component | Used by | In live DS? | Status / issue |
|---|---|---|---|
| AppBar `tone=field` | every screen | yes | CG: back IconButton 56 (#194), title/subtitle wrap at 200% (#194) |
| BottomNav (3 items) | tabs | yes | CG: nav links + `aria-current` not tablist (#194); Icon `wallet` missing (#198, stand-in "orders") |
| Button primary/secondary/tertiary/ghost xl, critical 72 | all | yes | CG: label wraps at 200% (#194); critical "Accept" large bold label (#194); secondary not used on dark rider surfaces (contrast) |
| Input xl (tel, numeric, otp 6) | R01, R02, R06, R07, R22 | yes | CG: 56 field size (#194); helper/error text field colours (#194) |
| 4-cell OTP / code entry | R22, R26 | no | Proposed variant (#193 "4-cell OTP input variant") |
| Select 56 | R06 timezone | yes | CG 56 (#194) |
| RadioGroup roomy 72 | R07, R25 | yes | CG roomy 72 rows (#194) |
| Checkbox / Switch 56 rows | R09 torch, R28 statement | yes | CG 56 rows (#194) |
| SegmentedControl 56 | R35 | yes | CG 56 (#194) |
| Sheet full non-dismissable, field tone | R17, R30, R43 | yes | CG: tone=field / `surface-offer` (#194), focusable title + footer slot (#194), close 56 (#194) |
| Modal | R48 | yes | CG: actions xl stacked 24px apart (#194) |
| Countdown | R17 | yes | CG: follows dynamic type (#194) |
| Price | R15, R17, R29, R35–R39 | yes | CG: `display-lg`, negative amounts, "not counted" announce (#195) |
| Badge lg | R04, R08, R11 | yes | CG: field size + theme (#191); StatusLabel stands in on EA/HW |
| Card, StatusTimeline, Icon, IconButton | various | yes | Icons missing: wallet, undo, external link, hourglass, hand-money, stars, camera, phone, download, document (#198) |
| MapView | R15, R17, R20, R23 | no (ui-native only) | dark-mode pin tokens (#198); Proposed component on canvases |
| Skeleton | every loading state | no (ui-native only) | #191 |
| EmptyState / ErrorState | every list/screen | no (ui-native only) | rider variant: action in bottom third, role=alert on heading+message (#191) |
| InlineAlert (slate/info/warning, persistent) | nearly every screen | **no** | Proposed component (#191); neutral slate tone (#191) |
| WaitingState | R15 | **no** | Proposed (#191) |
| StatusPanel (slate ErrorState/InlineAlert) | R15, R19, R22 | **no** | Proposed (folds into #191 InlineAlert/ErrorState) |
| ListRow 56/72 | R04, R08, R33, R35–R44 | **no** | Proposed (#195) |
| KeyValueList | R35, R37, R39, R42 | **no** | owner-approved, not built (#195) |
| StatCard | R15, R35 | **no** | owner-approved, not built (#195) |
| StatusLabel (Icon + 17px word) | R36–R42 | **no** | Proposed (#191) |
| Avatar | R44 | ui-native only | #195 |
| ProgressSteps (Step N of 4) | onboarding, trip | **no** | Proposed (#197) + fill token (#197) |
| ActiveDeliveryBar / ActiveJobBar | R16, R35 | **no** | Proposed (#197) |
| QueuedStepRow | R19–R31 | **no** | Proposed (#197) |
| MessagePreview | R20–R24 | **no** | Proposed (#197) |
| FoodStatusPanel | R21 | **no** | Proposed (#197) |
| ActionList (decline reasons, Button critical 72, 8px) | R17 | **no** | Proposed (#194 "decline-reason action list") |
| DateInput (typed D/M/Y) | R06, R09, R49 | **no** | Proposed (#193); CG sub-field invalid |
| ErrorSummary | R06, R07 | **no** | Proposed (#193) |
| FileUpload (row + thumbnail + PDF preview) | R08, R09, R27, R49 | **no** | Proposed (#193) |
| CameraCapture (incl. permission denied) | R09, R27, R28 | **no** | Proposed (#193) |
| ProgressBar determinate | R27 | **no** | Proposed (#191) |
| TextArea with counter (500) | geofence override, R28 statement | **no** | Proposed (#193) |
| Disclosure (Collapsible) | R14 "For support" | **no** | Proposed (#195 family) |
| Text-scale mode / Dynamic Type tokens | all 200% boards | **no** | #194 |
| FieldText error on dark: danger text role (added in check) | every field error (R01, R02, R06, R07, R12, R22, R26) | **no** | CG (Ref-NeedsAPI): error caption is danger-600 at 2.32:1 on #171717; needs a dark danger text role (danger-100 gives 12.55:1). Field errors are not halal states, so danger is allowed here |
| FieldText helper: body-md text-secondary (added in check) | every field helper | **no** | CG: caption text-tertiary is 4.89:1 dark / 4.18:1 light, below the rider 7:1 |
| Input `errorText` announce off when an ErrorSummary is shown (added in check) | R06, R07, R12 | **no** | CG: every errorText is role=alert today, so one submit fires several announcements |
| Button tertiary inside Card (added in check) | banners, cards | yes | CG: `--border-interactive` is 2.85:1 on surface-raised; boards keep tertiary buttons out of Cards or use primary there. Follow the board placement exactly |
| Links on light rider surfaces (added in check) | all | n/a | `text.link` (info-600 on cream) is 6.42:1, below 7:1: use Button tertiary, never inline link text |
| Sheet `surface-offer` / tone=field role (added in check) | R17 | **no** | until approved the offer uses library Sheet variant=full with its own surface, no local override |
| Icon glyphs to register in solar-icon-map.json (added in check) | all | partial | chevron-right, chevron-down, info, warning, error, lock, refresh, clock, bell, check, plus (Ref-NeedsAPI), besides the #198 list |

Implication: ~20 composites the rider canvases draw are not in the live DS. The constitution
forbids the app from defining them, so **the DS wave (#191, #193, #194, #195, #197, #198 in
`@hg/ui-native`) gates every WP**. WP0 must start by listing which exports exist; each WP may only
consume them. If the DS wave cannot land them by Sat, the owner must decide whether to (a) ship
with the nearest existing ui-native component (Banner for InlineAlert, Card + Text for ListRow),
or (b) allow the composites to be built inside `@hg/ui-native` by the rider agents under the DS
issues (recommended: (b), still in the package, still one PR per component).

## 5. API gaps

### Conflicts (contract wins; boards to adjust)

1. **`DL/PodOtpLocked`** draws "Take a photo instead" after five wrong codes. #290 removes that
   fallback: 423 `DELIVERY_CODE_LOCKED` hands the order to support (`overrideHandoverCode`). Build
   the support handoff (same pattern as `PickupCodeLocked`: "Call HalalGoes support" primary, no
   photo) and ask the owner to approve the redrawn board.
2. **`DL/PickupCodeLocked`/`PickupCodeWrong`** say nothing checks the code: under #290/#315 the
   server checks it, returns `attempts_remaining`, locks at 5. Copy may add "N tries left"; confirm
   with owner (otherwise keep the board's copy).
3. **Offer drop-off** boards draw an area without a centre; #312 sends `dropoff.area` plus a cell
   centre and `radius_m`. Draw a circle of `radius_m`, no pin.
   (added in check) `radius_m` is nullable in #312: fixture `offer_pending_area_without_radius`
   shows the area name and the direction from the area's centre and draws **no circle**; never a
   street or a pin on a house. Handle both shapes.
4. **`TripSocketLost` / `Review-Reconnecting`** assume a socket; the app polls (#29). Render the
   polling equivalent ("updates may be delayed").

### Every "Needs API" / "Contract to confirm" item

| # | Item (board/note) | Covered by | Build action |
|---|---|---|---|
| 1 | Pickup code on PICKED_UP, wrong-code answer, try limit, lock error, support release (DL notes, PickupItems/Code*) | **#290** contract (`PickupTransitionInput.pickup_code`, 422 PICKUP_CODE_INCORRECT + `attempts_remaining`, 423 PICKUP_CODE_LOCKED, `overrideHandoverCode`), **#315** backend; app task #311 | Build R22 to #290; mock scenarios `error_pickup_code_incorrect`, `error_pickup_code_locked` from #290 |
| 2 | What a replayed PICKED_UP with a wrong code returns | #290 (same 422/423; no geofence on PICKED_UP so the code can be resent away from the counter) | `PickupCodeRejectedLater` |
| 3 | Pickup code shown on the restaurant's order | #290 (`OrderRestaurantView.pickup_code`) | restaurant app |
| 4 | Customer's delivery code on order/tracking + arrival push | #290 (`delivery_code` on `OrderCustomerView`, `OrderTracking`); arrival push text in #280 (not in this list) | customer app; rider unaffected |
| 5 | Remaining OTP attempts | #290 (`details.attempts_remaining` on DELIVERY_CODE_INCORRECT) | show tries left |
| 6 | POD accepts PHOTO_WITH_ATTESTATION where PHOTO required; no wait for a leave-at-door drop the customer chose | #290 ("accepted too, straight away") | R28 `PodAttestationLeftAtDoor` |
| 7 | OTP locked → attestation fallback | **removed** by #290 (conflict 1) | support handoff |
| 8 | Approximate drop-off area on DispatchOffer / `dispatch.offer` | **#312** (`dropoff.area`, cell centre, `radius_m`) | R17 area; full address after accept |
| 9 | Support email in PublicConfig (Delete by request "Email support") | **#312** (`PublicConfig.support_email`) | show "Email support" only when present |
| 10 | Map address search | #300 (customer only; rider does not need it) | none |
| 11 | Cart multi-variant (#644), staff 2FA opt-in (#623) | not rider | none |
| 12 | Distance/time from rider to pickup (`pickup_distance_m`, `pickup_duration_s`) | **missing** | hide the row |
| 13 | `offered_at` / `window_seconds` on DispatchOffer | **missing** | ring total = remaining at first render |
| 14 | Offer push payload (amount, restaurant, area, expires_at) | **missing** | generic lock-screen copy, fetch on open |
| 15 | Split PAYOUT_ACCOUNT_INCOMPLETE (never set up vs later restricted) so a restricted rider can go online | **missing** (decision row says contract changes; tracked under #183) | ship current behaviour: blocked rows on Home |
| 16 | Notification/sound permission on the heartbeat | **missing** | client-side banner only |
| 17 | OTHER decline note optional; expiry during decline not counted toward UNRESPONSIVE | **missing** | `OfferDeclineOther` not built |
| 18 | Whether 409 OFFER_EXPIRED accept counts toward UNRESPONSIVE | **missing** | copy makes no promise |
| 19 | Reason on `rider.availability_changed` (UNRESPONSIVE) | **missing** | OfflineNoReason |
| 20 | Continuous online/cap time; rest-ends-at | **missing** | OfflineCap without a time; no cap warning |
| 21 | Suspension reason + appeal; event for paused/closed mid-delivery; transitions allowed for the in-flight assignment while paused/closed | **missing** | facts-only paused screens; detect on next 403 / refetch |
| 22 | Order notes history (`GET …/assignments/{id}/notes`) | **missing** (notes only via WS `order.note_added`, and the app polls) | notes effectively unavailable until #29 + history; MessagePreview hidden when none |
| 23 | Contact templates, restaurant issue codes, chat | **missing** (later) | call only |
| 24 | Food disposition after cancel/reassign; hand-back step | **missing** | closing step records nothing |
| 25 | Rider incident reporting (exception endpoint, coded reasons, evidence, call-attempt count) | **missing — owner LAUNCH BLOCKER** | only exit before pickup is ops reassigning |
| 26 | Long-wait escalation (LONG_WAIT) and release at 25 min | **missing** | banner at 20 min, direct call |
| 27 | Pickup before the restaurant marks ready | **missing** | `PickupNotMarkedReady` records nothing |
| 28 | Measured distance in 422 GEOFENCE details | **missing** | generic copy |
| 29 | Remaining server wait seconds for attestation | **missing** | indeterminate wait copy |
| 30 | Offline proof + DELIVERED replay | **missing** (alternative) | proof never queues |
| 31 | In-app SOS | **missing** (open safety decision) | 911 row only |
| 32 | OTP delivery channel on OtpChallenge | **missing** | neutral "code" wording |
| 33 | Residency status → work permit requirement | **missing** | optional row for all |
| 34 | `min_age` in PublicConfig | **missing** | 422 `details.min_age` is the authority; helper text says 18 |
| 35 | Rider terms / privacy URLs in PublicConfig | **missing** | bundled text or config constant |
| 36 | POST rider terms acceptance `{terms_version}` | **missing — owner launch blocker** | no checkbox board (as drawn) |
| 37 | GET rider profile (date_of_birth, email); fields accepted after approval | **missing** | RiderMe fields only; no Profile-Locked |
| 38 | Detach a rider document before submit | **missing** | hide "Remove this document" |
| 39 | Deactivation reason and decided_at | **missing** | facts-only closed |
| 40 | Does submitRiderProfile keep omitted optional fields | **contract to confirm** | build EmailInUse board |
| 41 | Resend unchanged document after a details fix | **missing** | two-step *_MISMATCH |
| 42 | submitRiderDocuments after approval (ACTIVE/SUSPENDED); supersede-on-approval; documents outside the new set | **missing** | replacement reads Added; "Send for review" disabled with support line |
| 43 | Change vehicle after approval | **missing** | read-only vehicle |
| 44 | Account deletion; retention period | later version; owner decision | by-request screen |
| 45 | Plain-language labels for Stripe requirement keys | **missing** (contract says verbatim) | count + keys only in "Copy details for support" |
| 46 | Earnings: `pending_cents`; `delivery_fee_cents` on EarningEntry; `scheduled_for`; GET one entry; corrected entry id + status (#147); `failure_code`/`hold_reason_code`; `returned_from_payout_id`; `rider.payout_updated`; earnings readable while paused; from/to on entries; bucket granularity; lifetime trip count; CLAWBACK inside `adjustment_cents`?; payout statement download; hold clock start | **missing** (#147, #152 for some) | build to the current-contract boards only |
| 47 | History: restaurant_name/dropoff_area on rows, cancelled/returned jobs, search (#148); left-at-door photo+statement on the record; support ticket from a delivery | **missing** | time/distance rows; placeholders as drawn |
| 48 | release-notes.json shape | #97 / #100 (not contract) | sample until #97 |

## 6. Dev harness and E2E plan

### Harness facts

- Mock: `pnpm mock` (`tools/mock-server`, :4010). Scenario by `?scenario=`, `X-Mock-Scenario`
  header (client `mockScenario`), or cookie; **one scenario per request**, default otherwise.
  Screen tests must set the scenario per operation (WP0 test util: a fetch shim mapping
  operationId → scenario), not one header for the whole app.
- Devworld: `cd services/hg && make dev-reset` (personas), `make dev-scenario s=<name>`,
  `make dev-journey route=short|long|early-rider speed=1x|4x|max auto=none|restaurant|all`
  (`--manual=rider` leaves the rider to the app). Local sign-in codes are fixed for
  +1 555 010 0100–0199 (`auth.TestSignInCode`).
- Rider personas: `rider-sim` +15550100151 (ACTIVE, OFFLINE, payouts set up), `rider-docs`
  +15550100152 (DOCUMENTS_REVIEW), `rider-rejected` +15550100153 (DOCUMENTS_REJECTED),
  `rider-registered` +15550100154 (REGISTERED). Scenario `onboard-rider` takes a fresh number from
  sign-up to online; `order-ready` makes an order dispatchable; `docs-approve` / `docs-reject`
  decide `rider-docs`.
- E2E (`tools/e2e`): Maestro on an x86_64 emulator against the real API (`HG_ENV=local`), seed
  `tools/e2e/seed/world.sql` rider Bilal +1 416 555 0161; OTP read from the API log
  (`node tools/e2e/lib/otp.mjs`). Existing rider flows use pre-redesign copy and must be rewritten.

### Per WP

| WP | (a) Screen tests vs mocked API (fixture scenario per op) | (b) Real-API journeys on the dev APK (Maestro / mobile-mcp) | Devworld / seed |
|---|---|---|---|
| WP0 | Router: every `NextRoute` (`session_next_route_*`, `rider_me`); outbox persistence and replay; theme both schemes | App cold start → R01; kill/relaunch with token → routed screen | dev-reset |
| WP1 | R01/R02 each state: `otp_challenge`, `error_otp_incorrect`, `error_rate_limited`, `error_validation_failed`, offline (fetch reject), 503 | `1-sign-in.yaml`: phone → code from log → Home; wrong code ×1 shows attempts left; airplane mode on Send code | rider-sim; rider-registered |
| WP2 | `rider_dashboard_active`, `rider_dashboard_zero_earnings`, `rider_availability_{offline,online_idle,online_stale,on_delivery}`, blocking reasons (missing), 409 (missing) | `2-go-online.yaml`: `setLocation` at Bismillah, Go online, Waiting; revoke location permission via adb → banner; `setAirplaneMode` → no-connection; go offline | rider-sim, `make dev-scenario s=order-ready` |
| WP3 | `offer_pending`, `offer_none`, `offer_expired`, `offer_taken_by_another`, `offer_withdrawn`, `offer_rejected`, `offer_zero_tip_low_value`, `error_offer_expired`, `error_offer_already_taken`; clock-skew test | `3-offer.yaml`: online → order-ready → offer → Accept; variant: let it expire (wait 30 s) → "This offer expired"; Decline with one reason. Push: lock the screen (`adb shell input keyevent 26`) and assert notification (needs FCM on a Google APIs image; else foreground poll only) | rider-sim + order-ready; second customer for a second offer |
| WP4 | `assignment_{assigned,en_route_to_pickup,arrived_at_pickup,picked_up}`, `dispatch_at_restaurant`, #290 `error_pickup_code_incorrect`, `error_pickup_code_locked`; geofence 422 (missing); 409 (missing) | `4-pickup.yaml`: accept → `travel` (Maestro GPS route from rider to restaurant) → I'm at the restaurant → wait → restaurant marks ready (Playwright or `dev-scenario`) → type pickup code read from `getRestaurantOrder` via API helper → I've got the food. Variants: wrong code ×2; offline PICKED_UP (airplane on, tap, airplane off → replay) | `dev-journey route=short auto=restaurant --manual=rider`; needs #315 merged |
| WP5 | `assignment_{en_route_to_dropoff,arrived_at_dropoff,delivered,otp_pod_required,no_instructions_no_unit}`, `error_pod_method_mismatch`; photo upload `presigned_upload`, `stored_object_ready` | `5-dropoff-photo.yaml`: `travel` route to Amina → I'm here → Hand it over → photo (emulator virtual camera scene) → Mark as delivered → Delivered → Back to Home. `5b-dropoff-otp.yaml`: customer meets → read `delivery_code` via customer API → type → delivered. Airplane mode at the door → TripNoConnection | dev-journey; customer with MEET_AT_DOOR instruction (missing seed) |
| WP6 | `assignment_{undeliverable,returning,returned,cancelled_by_platform,reassigned}`, `realtime_rider_reassigned` (data only) | `6-cancel.yaml`: during pickup run `make dev-scenario s=customer-cancels` → Cancelled before pickup; after pickup, admin cancels (API helper) → CancelledFoodConfirm. `6b-cant-deliver.yaml`: Something's wrong → I can't deliver → Return → I've returned it | customer-cancels; admin cancel helper (missing); reassign helper (missing) |
| WP7 | `rider_onboarding_{phone_verified,profile_pending,vehicle_pending}`, `rider_profile`, `rider_vehicle_{scooter,on_foot}`, `error_rider_under_18`, plate/email in use (missing) | `7-apply.yaml`: fresh number (onboarding range) → Apply → details (DOB typed) → vehicle scooter with plate → Documents screen reached | `onboard-rider` range numbers |
| WP8 | `rider_document_pack_{complete,rejected}`, `document_*` (all states and rejection codes), `presigned_upload`, `error_documents_incomplete`, upload error codes (missing) | `8-documents.yaml`: add 4 documents (camera virtual scene + file picked from `adb push` PDF) → submit → Notify prime → Review; then `make dev-scenario s=docs-reject` → Fix → retake → resend; `docs-approve` → Approved | rider-docs, rider-rejected |
| WP9 | `connect_status_complete`, `connect_status_requirements_due`, 404 (missing), restricted/past-due/rejected (missing), `session_next_route_suspended`, `rider_me` | `9-payouts.yaml`: approved rider → Continue to Stripe (test-mode link opens; HG_ENV=local fake) → back → Check again; Account → Sign out → R01 | rider at PAYOUT_PENDING (missing persona); suspended rider (missing) |
| WP10 | `earnings_summary_week`, `earnings_summary_zero`, `earning_entries_{mixed,empty}`, `payout_{draft,ready,transferring,transferred,paid,failed,held}`, `payout_detail_paid`, `payout_list_empty`, `error_rate_limited`, `error_forbidden` | `10-earnings.yaml`: after WP5 delivery → Earnings shows the line → open it → Payouts | rider with a ledger history (missing seed) |
| WP11 | Deliveries from `earning_entries_mixed` (type DELIVERY), `assignment_delivered`, `assignment_cancelled_by_platform`; What's new local JSON | `11-history.yaml`: Earnings → Deliveries → the delivered order; relaunch with a bumped version → What's new sheet → Got it; Account → Documents → open | after a delivery |

Reality simulation on the real Android dev APK: GPS route with Maestro `travel` (points from
`services/hg/internal/devworld/route.go` short/long routes) or `adb emu geo fix`; network loss with
`setAirplaneMode` / `adb shell svc data|wifi disable`; push via a Google APIs emulator image with
FCM test credentials (otherwise assert foreground polling only); camera via the emulator's virtual
scene and gallery files pushed with `adb push`; background/lock with `adb shell input keyevent 26`;
dark mode with `adb shell cmd uimode night yes`; 200% text with `adb shell settings put system
font_scale 2.0`. mobile-mcp can drive the same APK for exploratory screenshots of each board.

### Missing fixtures and seed data

Fixtures (add under `contracts/fixtures/` with scenario names; most are errors the rider screens
must render):

- Errors: `error_geofence_required`, `error_invalid_transition` (with `details.current_state`),
  `error_pod_required`, `error_cannot_go_online` (with all 9 `blocking_reasons`, and one per code),
  `error_active_delivery_in_progress`, `error_onboarding_incomplete`, `error_account_not_active`,
  `error_payout_account_incomplete`, `error_plate_in_use`, `error_email_in_use` (rider),
  `error_field_required`, `error_field_not_applicable`, `error_document_expires_too_soon`,
  `error_image_too_small`, `error_content_type_mismatch`, `error_checksum_mismatch`,
  `error_payload_too_large`, `error_nothing_to_resubmit`, `error_otp_invalid_or_expired`,
  `error_step_not_available`, `error_service_unavailable` (503 OTP), `error_stale_point`.
  #290 adds `error_pickup_code_incorrect`, `error_pickup_code_locked` and the delivery-code pair.
- Rider data: `rider_dashboard_offline_blocked` (blocking_reasons), `rider_dashboard_tracking_degraded`,
  `rider_dashboard_tracking_lost`, `rider_dashboard_on_delivery_dropoff`, `rider_dashboard_payouts_paused`;
  `rider_me_suspended`, `rider_me_deactivated`, `rider_me_deactivated_on_delivery`;
  `connect_status_not_found` (404), `connect_status_restricted`, `connect_status_past_due`,
  `connect_status_rejected`, `connect_status_eventually_due`;
  `assignment_pickup_ready` (`pickup.order_state` READY_FOR_PICKUP), `assignment_photo_with_attestation_pod`,
  `assignment_leave_at_door`, `assignment_do_not_call`, `assignment_meet_in_lobby`,
  `assignment_tracking_degraded`, `assignment_tracking_lost`, `assignment_cancelled_after_pickup`,
  `assignment_reassigned_after_pickup`; `offer_breakdown_partial` (null breakdown fields),
  `offer_pending_with_area` (#312 shape);
  `earnings_summary_day`, `earnings_summary_month`, `earnings_summary_negative_balance`,
  `earning_entries_paging` (with `meta.next`), `earning_entries_pending`, `earning_entries_clawback`,
  `payout_list_multi_problem`, `payout_detail_failed`, `payout_detail_held`;
  `rider_onboarding_status_with_attempt_3`, `rider_document_pack_mixed_rejections` (one per
  rejection code).
- Already supplied by open PRs, do not re-create (added in check): #312 adds
  `offer_pending_area_without_radius` (null `radius_m`), the `offer_pending` area shape,
  `public_config_without_support_email` (`support_email: null` → no email row, never a hardcoded
  address) and `public_config_phone_support_off` (→ the `*-NoSupport` boards); #290 adds
  `error_pickup_code_incorrect`, `error_pickup_code_locked`, `error_delivery_code_incorrect`,
  `error_delivery_code_locked`. Use them once those PRs merge.
- Devworld personas and scenarios (`services/hg/internal/devworld`): `rider-payout` (ONBOARDING_PAYOUT),
  `rider-suspended` (DOCUMENT_EXPIRED insurance), `rider-deactivated`, `rider-history` (ACTIVE with a
  ledger across all entry types incl. a CLAWBACK and payouts in all seven states), `rider-expiring-doc`
  (expires within 30 days), customer address with MEET_AT_DOOR / DO_NOT_CALL / LEAVE_AT_DOOR
  instructions; scenarios `offer-to-rider` (ready order beside rider-sim), `cancel-after-pickup`,
  `reassign-rider`, `pickup-code-lock`, `payout-restrict`, `suspend-rider`. Note `dev-journey`
  still records seal refusals; it must type the pickup code once #315 lands.
- E2E seed (`tools/e2e/seed/world.sql`): a second rider for the reassign flow; Bilal's ledger rows
  for the earnings flow.

## 7. Risks, open questions, cut list

### Top risks

1. **Design-system gate.** ~20 rider composites (InlineAlert, ListRow, ProgressSteps, KeyValueList,
   StatCard, StatusLabel, ActiveDeliveryBar, QueuedStepRow, DateInput, FileUpload, CameraCapture,
   4-cell code entry, ActionList, WaitingState, MessagePreview, FoodStatusPanel, TextArea,
   ProgressBar, ErrorSummary) and the 56px field sizes are not in the live DS, and `@hg/ui-native`
   is mid-rebuild on RNR (#111). Without them no WP can pass gate item 1 by Monday.
2. **Pickup code chain not merged.** #290 (contract) and #315 (backend) are open; until they merge,
   real-API pickup fails (the backend still requires the seal scan) and generated client types lack
   `PickupTransitionInput`. WP4/WP5 E2E depend on it.
3. **Offer reliability without a socket or push payload.** Polling `getCurrentOffer` must catch a
   30 s offer; full-screen intent, sound in DND and lock-screen delivery need native notification
   channel work Expo does not give for free; FCM on CI emulators is not configured.
4. **Owner launch blockers unresolved:** rider incident reporting (no exit before pickup but ops
   reassigning) and rider terms acceptance (no record of consent).
5. **Scale of the surface:** ~600 boards to match across 52 screens in three days; parallel agents
   colliding on the nav/data layer unless WP0 lands first and freezes its interfaces.

### Open questions for the owner

1. Approve the redrawn `PodOtpLocked` (support handoff, no photo) required by #290.
2. Show "N tries left" on pickup and delivery codes now that `attempts_remaining` exists? Is five
   the right limit (#290's open question)?
3. Until the DS composites land, may rider agents build them inside `@hg/ui-native` under
   #191/#193/#194/#195/#197, or ship with the nearest existing component?
4. Rider terms and privacy text: bundled in the app or a hosted URL, until PublicConfig carries them?
5. Launch with polling only (#29 later), accepting slower offers and no live notes?
6. Incident reporting and terms acceptance: confirm they are accepted as post-launch risks or move
   them into the contract now.
7. Undelivered-food pay policy for Returned (still open).
8. Account deletion retention period (placeholder line).

### Cut first if time runs out before Mon 12 Oct (in this order)

1. What's new sheet and page (R43) — needs #97 anyway.
2. Delivery history detail (R42), then the Deliveries list (R41).
3. Account documents replace flow (R49 replace states) — keep list and view.
4. Earnings line and payout detail variants beyond the current-contract main states (R37, R39
   focus/large-text boards).
5. Payout account page in Earnings (R40) — Account › Payouts covers it.
6. 360×640 and 200% fit polish (keep working, accept wrapping gaps the DS has not fixed).
7. Never cut: sign-in, routing, Home, Offer, pickup with code, drop-off with every proof method,
   cancellation/reassign screens, onboarding steps 1–5, Account sign-out, every empty/loading/error
   state on the screens that ship, light and dark.

---

## Appendix A. Copy index per board

Format: `Board :: AppBar title/subtitle :: H=headings :: B=button label(variant)`. `prim` primary,
`seco` secondary, `tert` tertiary, `ghos` ghost. `{{…}}` = data-driven label: open the board.
EA and HW wrappers carry their variant copy in the wrapper's data block (`EA/Main`, `EA/Activity`,
`EA/EntryDetail`, `EA/Payouts`, `EA/PayoutDetail`, `HW/Deliveries`, `HW/DeliveryDetail`,
`HW/WhatsNew`).

### SO (sign-in-onboarding)

```text
App-UpdateRequired ::  :: H=Update the app to continue :: B=Open the app store(prim)
Capture-Camera-Light :: "Driver's licence" :: H= :: B=Take photo(prim) | Choose a file (PDF or photo)(ghos)
Capture-Camera :: "Driver's licence" :: H= :: B=Take photo(prim) | Choose a file (PDF or photo)(ghos)
Capture-CameraDenied :: "Driver's licence" :: H=Allow the camera to add documents :: B=Open settings(prim) | Choose a PDF instead(tert)
Capture-FileUnreadable :: "Driver's licence" :: H= :: B=Choose a different file(prim) | Take a photo instead(tert)
Capture-PdfError :: "Driver's licence" :: H= :: B=Choose a different file(prim) | Take a photo instead(tert)
Capture-PdfPicked :: "Driver's licence" :: H= :: B=Use this file(prim) | Choose a different file(tert)
Capture-Review :: "Driver's licence" :: H= :: B=Use this photo(prim) | Retake(tert)
Capture-Selfie-Denied :: 'Photo of you' :: H=Allow the camera to take your photo :: B=Open settings(prim) | Back to documents(tert)
Capture-Selfie-Interrupted :: 'Photo of you' :: H= :: B=Try again(prim) | Retake(tert)
Capture-Selfie-TooSmall :: 'Photo of you' :: H= :: B=Retake(prim)
Capture-Selfie :: 'Photo of you' :: H= :: B=Take photo(prim)
Capture-SelfieReview :: 'Photo of you' :: H= :: B=Use this photo(prim) | Retake(tert)
Capture-Starting :: "Driver's licence" :: H= :: B=Take photo(prim) | Choose a PDF instead(ghos)
Capture-TooSoon :: "Driver's licence" :: H= :: B=Back to documents(prim) | Change the date(tert)
Capture-TorchOn :: "Driver's licence" :: H= :: B=Take photo(prim) | Choose a file (PDF or photo)(ghos)
Docs-AddExpiry :: "Driver's licence" :: H=Add the expiry date :: B=Save expiry date(prim) | Take a new photo instead(tert)
Docs-Bicycle-Incomplete :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Add photo of you(prim) | Call support(ghos)
Docs-Bicycle-Ready :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-Bicycle-Submitting :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-Bicycle :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Add government ID(prim) | Call support(ghos)
Docs-Cooldown :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-DocView :: "Driver's licence" :: H= :: B=Take a new photo(seco) | Remove this document(tert)
Docs-Empty-LargeText :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Add driver's licence(prim) | Call support(ghos)
Docs-Empty :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Add driver's licence(prim) | Call support(ghos)
Docs-Incomplete :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Add vehicle insurance(prim) | Call support(ghos)
Docs-Interrupted :: 'Your application', 'Documents' :: H= :: B=Try again(tert) | Add(tert) | Add photo of you(prim) | Call support(ghos)
Docs-LoadError :: 'Your application', 'Documents' :: H=We couldn't load your documents :: B=Try again(prim) | Call support(ghos)
Docs-Loading :: 'Your application', 'Documents' :: H= :: B=
Docs-Mixed-Light :: 'Your application', 'Documents' :: H= :: B=Take a photo(tert) | Choose another file(tert) | Cancel upload(tert) | Add(tert) | Replace vehicle registration(prim) | Call support(ghos)
Docs-Mixed :: 'Your application', 'Documents' :: H= :: B=Take a photo(tert) | Choose another file(tert) | Cancel upload(tert) | Add(tert) | Replace vehicle registration(prim) | Call support(ghos)
Docs-Offline :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-Ready-Light :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-Ready :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-SubmitError :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Try again(prim) | Call support(ghos)
Docs-Submitting :: 'Your application', 'Documents' :: H= :: B=Add(tert) | Submit for review(prim) | Call support(ghos)
Docs-UploadErrors :: 'Your application', 'Documents' :: H= :: B=Retake(tert) | Try again(tert) | Add(tert) | Retake vehicle registration(prim) | Call support(ghos)
Fix-Closed-Reason :: 'Your application' :: H=Your application is closed :: B=Call support(seco) | Sign out(tert)
Fix-Closed :: 'Your application' :: H=Your application is closed :: B=Call support(seco) | Sign out(tert)
Fix-Cooldown :: 'Your application', 'Fix documents' :: H=Fix 1 document :: B=Send for review again(prim) | Call support(ghos)
Fix-DetailsEdit-EmailInUse :: 'Your details' :: H= :: B=Call support(seco) | Try again(tert)
Fix-DetailsEdit-Offline :: 'Your details' :: H= :: B=Try again(prim) | Call support(ghos)
Fix-DetailsEdit-Saving :: 'Your details' :: H= :: B=Save and take a new photo(prim) | Call support(ghos)
Fix-DetailsEdit-ServerError :: 'Your details' :: H= :: B=Try again(prim) | Call support(ghos)
Fix-DetailsEdit-Underage :: 'Your details' :: H= :: B=Save and take a new photo(prim) | Call support(ghos)
Fix-DetailsEdit :: 'Your details' :: H= :: B=Save and take a new photo(prim) | Call support(ghos)
Fix-Dob :: 'Your application', 'Fix documents' :: H=Fix 1 document / Driver's licence :: B=Fix your details, then take a new photo(prim) | Call support(ghos)
Fix-Error :: 'Your application', 'Fix documents' :: H=Fix 1 document :: B=Try again(prim) | Call support(ghos)
Fix-FinalAttempt :: 'Your application', 'Fix documents' :: H=Fix 1 document / Driver's licence :: B=Take a new photo(prim) | Call support(ghos)
Fix-Forgery :: 'Your application', 'Fix documents' :: H=Fix 1 document / Driver's licence :: B=Call support(prim)
Fix-Multiple :: 'Your application', 'Fix documents' :: H=Fix 2 documents / Vehicle registration / Vehicle insurance :: B=Take a new photo of vehicle registration(seco) | Take a new photo of vehicle insurance(seco) | Take a new photo of vehicle registration(prim) | Call support(ghos)
Fix-Name :: 'Your application', 'Fix documents' :: H=Fix 1 document / Driver's licence :: B=Fix your details, then take a new photo(prim) | Call support(ghos)
Fix-NothingChanged :: 'Your application', 'Fix documents' :: H=Fix 1 document / Vehicle registration :: B=Take a new photo(prim) | Call support(ghos)
Fix-Offline :: 'Your application', 'Fix documents' :: H=Fix 1 document :: B=Send for review again(prim) | Call support(ghos)
Fix-Other :: 'Your application', 'Fix documents' :: H=Fix 1 document / Photo of you :: B=Take a new photo(prim) | Call support(ghos)
Fix-Partial-Light :: 'Your application', 'Fix documents' :: H=Fix 1 document / Vehicle registration :: B=Take a new photo(prim) | Call support(ghos)
Fix-Partial :: 'Your application', 'Fix documents' :: H=Fix 1 document / Vehicle registration :: B=Take a new photo(prim) | Call support(ghos)
Fix-Plate :: 'Your application', 'Fix documents' :: H=Fix 1 document / Vehicle registration :: B=Fix your plate, then take a new photo(prim) | Call support(ghos)
Fix-PlateEdit-Alt :: 'Your vehicle' :: H=About your scooter :: B=Save plate(prim) | Call support(ghos)
Fix-PlateEdit-Offline :: 'Your vehicle' :: H=About your scooter :: B=Try again(prim) | Call support(ghos)
Fix-PlateEdit-PlateInUse :: 'Your vehicle' :: H=About your scooter :: B=It's my vehicle: call support(tert) | Save and take a new photo(prim) | Call support(ghos)
Fix-PlateEdit-Required :: 'Your vehicle' :: H=About your scooter :: B=Save and take a new photo(prim) | Call support(ghos)
Fix-PlateEdit-Saving :: 'Your vehicle' :: H=About your scooter :: B=Save and take a new photo(prim) | Call support(ghos)
Fix-PlateEdit-ServerError :: 'Your vehicle' :: H=About your scooter :: B=Try again(prim) | Call support(ghos)
Fix-PlateEdit :: 'Your vehicle' :: H=About your scooter :: B=Save and take a new photo(prim) | Call support(ghos)
Fix-Ready :: 'Your application', 'Fix documents' :: H=Fix 1 document :: B=Send for review again(prim) | Call support(ghos)
Fix-Resending :: 'Your application', 'Fix documents' :: H=Fix 1 document :: B=Send for review again(prim) | Call support(ghos)
Fix-WrongType :: 'Your application', 'Fix documents' :: H=Fix 1 document / Vehicle insurance :: B=Take a photo of the right document(prim) | Choose a PDF instead(tert) | Call support(ghos)
Main-Keyboard ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
Main-LargeText ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
Main ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
Notify-Prime :: 'Your application' :: H=Get told when we decide on your application :: B=Turn on notifications(prim) | Not now(tert) | Call support(ghos)
Onboarding-Error :: 'Your application' :: H=We couldn't load your application :: B=Try again(prim) | Call support(ghos)
Onboarding-InProgress :: 'Your application' :: H=Finish your application :: B=Continue with documents(prim) | Call support(ghos)
Onboarding-Loading :: 'Your application' :: H= :: B=
Onboarding-Offline :: 'Your application' :: H=Finish your application :: B=Continue with documents(prim) | Call support(ghos)
Onboarding-Welcome-Light :: 'Your application' :: H=Apply to ride :: B=Read the rider terms(tert) | Read the privacy notice(tert) | Start with your details(prim) | Call support(ghos)
Onboarding-Welcome-Terms-Tried :: 'Your application' :: H=Apply to ride :: B=Read the rider terms(tert) | Read the privacy notice(tert) | Start with your details(prim) | Call support(ghos)
Onboarding-Welcome-Terms :: 'Your application' :: H=Apply to ride :: B=Read the rider terms(tert) | Read the privacy notice(tert) | Start with your details(prim) | Call support(ghos)
Onboarding-Welcome :: 'Your application' :: H=Apply to ride :: B=Read the rider terms(tert) | Read the privacy notice(tert) | Start with your details(prim) | Call support(ghos)
Profile-Default-Keyboard :: 'Your application', 'Your details' :: H= :: B=Continue(prim)
Profile-Default-LargeText :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-Default :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-EmailInUse :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-Loading :: 'Your application', 'Your details' :: H= :: B=
Profile-Offline :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-Required :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-Saving :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-ServerError :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Try again(prim) | Call support(ghos)
Profile-Timezone-Error :: 'Your application', 'Your details' :: H= :: B=Continue(prim) | Call support(ghos)
Profile-Underage-Light :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-Underage :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Continue(prim) | Call support(ghos)
Profile-UnderageAgain :: 'Your application', 'Your details' :: H=Tell us who you are :: B=Call support(seco) | Sign out(tert)
Ref-DocumentStates ::  :: H=KycDocumentState badges :: B=
Ref-Focus ::  :: H=Focus: one indicator, in the theme colour / Dark (field) / Light (phone set to light) :: B=Send code(prim) | Use a different number(tert)
Ref-NeedsAPI ::  :: H=Needs API: contract proposals to file / Settled by the contract (no proposal needed) / Later version (not in the launch build) / Design system requests :: B=
Ref-OnboardingStates ::  :: H=next_route decides the screen :: B=
Ref-RejectionReasons ::  :: H=Why a document was turned down, and what the rider does next / Badge on the Fix card: derived from the remedy :: B=
Review-Approved :: 'Your application', 'Review' :: H=Your documents are approved :: B=Set up payouts(prim) | Call support(ghos)
Review-Error :: 'Your application', 'Review' :: H=We couldn't check for updates :: B=Try again(prim) | Call support(ghos)
Review-LiveRejected :: 'Your application', 'Review' :: H=We're checking your documents :: B=Call support(ghos)
Review-Partial-Light :: 'Your application', 'Review' :: H=We're checking your documents :: B=Call support(ghos)
Review-Partial :: 'Your application', 'Review' :: H=We're checking your documents :: B=Call support(ghos)
Review-Reconnecting :: 'Your application', 'Review' :: H=We're checking your documents :: B=Check now(tert) | Call support(ghos)
Review-Sent :: 'Your application', 'Review' :: H=Your documents are sent :: B=Call support(ghos)
Review-Waiting-NotifOff :: 'Your application', 'Review' :: H=We're checking your documents :: B=Open settings(seco) | Call support(ghos)
Review-Waiting-Slow :: 'Your application', 'Review' :: H=This is taking longer than usual :: B=Call support(seco)
Review-Waiting :: 'Your application', 'Review' :: H=We're checking your documents :: B=Call support(ghos)
Route-Error ::  :: H=We couldn't open your account :: B=Try again(prim) | Sign out(tert) | Call support(ghos)
Route-Splash ::  :: H= :: B=
Route-Timeout ::  :: H=This is taking longer than usual :: B=Try again(prim) | Sign out(tert)
Route-WrongRole-NoSupport ::  :: H=Something is wrong with your account setup :: B=Sign out(tert)
Route-WrongRole ::  :: H=Something is wrong with your account setup :: B=Call support(seco) | Sign out(tert)
SignIn-Code-Expired :: 'Sign in' :: H=Enter your code :: B=Send a new code(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Incorrect-Light :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Incorrect :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Keyboard :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Locked :: 'Sign in' :: H=Enter your code :: B=Use a different number(tert) | Call support(ghos)
SignIn-Code-Offline :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Pasted :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Resend :: 'Sign in' :: H=Enter your code :: B=Send the code again(tert) | Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-ResendLimit :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-TriesUsed :: 'Sign in' :: H=Enter your code :: B=Send a new code(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code-Verifying :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Code :: 'Sign in' :: H=Enter your code :: B=Verify(prim) | Use a different number(tert) | Call support(ghos)
SignIn-Deactivated-NoSupport ::  :: H=This rider account is closed :: B=Back to sign in(tert)
SignIn-Deactivated ::  :: H=This rider account is closed :: B=Call support(seco) | Back to sign in(tert)
SignIn-Phone-Invalid ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-Light ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-Offline ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-Sending ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-SignedOut ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-TooMany-Light ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-TooMany ::  :: H=Sign in or apply to ride :: B=Send code(prim) | Call support(ghos)
SignIn-Phone-Unavailable ::  :: H=Sign in or apply to ride :: B=Try again(prim) | Call support(ghos)
Vehicle-Bicycle :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-Car :: 'Your application', 'How you deliver' :: H=About your car :: B=Continue(prim) | Call support(ghos)
Vehicle-ChangeAfterDocs :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-Empty :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-Error :: 'Your application', 'How you deliver' :: H= :: B=Try again(prim) | Call support(ghos)
Vehicle-Loading :: 'Your application', 'How you deliver' :: H= :: B=
Vehicle-Motorcycle :: 'Your application', 'How you deliver' :: H=About your motorcycle :: B=Continue(prim) | Call support(ghos)
Vehicle-NoChoice :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-NotApplicable :: 'Your application', 'How you deliver' :: H= :: B=Try again(prim) | Call support(ghos)
Vehicle-Offline :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-OnFoot :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-PlateInUse :: 'Your application', 'How you deliver' :: H=About your scooter :: B=It's my vehicle: call support(tert) | Continue(prim) | Call support(ghos)
Vehicle-Required :: 'Your application', 'How you deliver' :: H=About your scooter :: B=Continue(prim) | Call support(ghos)
Vehicle-Saving :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-Scooter-Light :: 'Your application', 'How you deliver' :: H=About your scooter :: B=Continue(prim) | Call support(ghos)
Vehicle-Scooter :: 'Your application', 'How you deliver' :: H=About your scooter :: B=Continue(prim) | Call support(ghos)
Vehicle-Switched :: 'Your application', 'How you deliver' :: H= :: B=Continue(prim) | Call support(ghos)
Vehicle-YearRange :: 'Your application', 'How you deliver' :: H=About your scooter :: B=Continue(prim) | Call support(ghos)
```

### SH (shift-offers)

```text
AccountTabResume :: 'Account', 'On a delivery' :: H= :: B=Resume(prim)
BlockingReasonsCopy ::  :: H=Why you can't go online: one row per code :: B=
EarningsTabResume :: 'Earnings', 'On a delivery' :: H= :: B=Resume(prim)
ForcedOfflineOnDelivery :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
HomeBlocked :: 'Offline', "You can't go online yet" :: H=Fix 3 things to go online :: B=Open location settings(tert) | Upload a new document(tert) | Finish payout setup(tert) | Check again(tert)
HomeCapWarning :: 'Online', 'Waiting for offers' :: H=Waiting for offers :: B=Go offline(tert)
HomeDegraded :: 'Online', 'Waiting for offers' :: H=Waiting for offers :: B=Turn on precise location(tert) | Go offline(tert)
HomeError :: 'Home', 'Last known: online · 9:42 pm' :: H=We couldn't load Home :: B=Try again(prim) | Go offline(tert)
HomeGoOfflineAfter :: 'On a delivery', 'Going offline after this one' :: H= :: B=Stay online after this delivery(tert) | Resume delivery(prim)
HomeGoOfflineRefused :: 'On a delivery', 'No new offers until you finish' :: H= :: B=Go offline after this delivery(prim) | Resume delivery(tert)
HomeGoingOffline :: 'Online', 'Going offline…' :: H=Setting you offline :: B=Going offline(tert)
HomeGoingOnline :: 'Offline', 'Going online…' :: H=Checking you can go online :: B=Going online(prim)
HomeLoading :: 'Home' :: H= :: B=
HomeLost :: 'Online', 'Not getting offers' :: H=You're online, but offers are paused :: B=Open location settings(tert) | Go offline(tert)
HomeNoConnection :: 'Home', 'Last known: online · 9:42 pm' :: H=Last known status: online :: B=Try to reconnect(tert)
HomeNotificationsOff :: 'Online', 'You may miss offers' :: H=Waiting for offers :: B=Open Settings(tert) | Go offline(tert)
HomeOfflineFailed :: 'Online', 'Waiting for offers' :: H= :: B=Try going offline again(tert)
HomeOnDelivery :: 'On a delivery', 'No new offers until you finish' :: H= :: B=Resume delivery(prim) | Go offline after this delivery(ghos)
HomeOnDeliveryDropoff :: 'On a delivery', 'No new offers until you finish' :: H= :: B=Resume delivery(prim) | Go offline after this delivery(ghos)
HomeOnlineFailed :: 'Offline', "You won't get offers" :: H=You're offline :: B=Try going online again(prim)
HomePayoutsPaused :: 'Online', 'Waiting for offers' :: H=Waiting for offers :: B=Update payout details(tert) | Go offline(tert)
HomePermissionRevoked :: 'Online', 'Offers may stop' :: H=Waiting for offers :: B=Open Settings(tert) | Go offline(tert)
HomeStale :: 'Online', 'Not getting offers' :: H=You're online, but offers are paused :: B=Open location settings(tert) | Go offline(tert)
HomeTodayEmpty :: 'Online', 'Waiting for offers' :: H=Waiting for offers :: B=Go offline(tert)
HomeWaiting :: 'Online', 'Waiting for offers' :: H=Waiting for offers :: B=Go offline(tert)
HomeWaitingLight :: 'Online', 'Waiting for offers' :: H=Waiting for offers :: B=Go offline(tert)
Main :: 'Offline', "You won't get offers" :: H=You're offline :: B=Go online(prim)
OfferAcceptExpired ::  :: H=This offer ended before your accept reached us :: B=
OfferAcceptRetry ::  :: H= :: B=Decline(tert)
OfferAccepted ::  :: H=You've got this delivery :: B=
OfferAccepting ::  :: H= :: B=Decline(tert)
OfferBreakdownPartial ::  :: H= :: B=Decline(tert)
OfferConnectionLost ::  :: H= :: B=Decline(tert)
OfferCritical ::  :: H= :: B=Decline(tert)
OfferCriticalLight ::  :: H= :: B=Decline(tert)
OfferDecline ::  :: H= :: B=Decline(tert) | Keep the offer(tert) | {{r.label}}(tert) | More reasons(ghos)
OfferDeclineFailed ::  :: H= :: B=Decline(tert) | Keep the offer(tert) | Pickup is too far(tert) | Drop-off is too far(tert) | Earnings are too low(tert) | Ending my shift(tert) | Taking a break(tert)
OfferDeclineLargeText ::  :: H= :: B=Decline(tert) | Keep the offer(tert) | {{r.label}}(tert) | More reasons(ghos)
OfferDeclineOther ::  :: H= :: B=Decline(tert) | Keep the offer(tert) | Decline(seco)
OfferDeclineSmall ::  :: H= :: B=Decline(tert) | Keep the offer(tert) | {{r.label}}(tert) | More reasons(ghos)
OfferDeclining ::  :: H= :: B=Decline(tert) | Keep the offer(tert) | Pickup is too far(tert) | Drop-off is too far(tert) | Earnings are too low(tert) | Ending my shift(tert) | Taking a break(tert)
OfferEarningsLoading ::  :: H= :: B=Decline(tert)
OfferExpired ::  :: H=This offer expired :: B=Back to waiting(seco)
OfferFocusOrder ::  :: H= :: B=Decline(tert)
OfferLargeText ::  :: H= :: B=Decline(tert)
OfferLight ::  :: H= :: B=Decline(tert)
OfferLive ::  :: H= :: B=Decline(tert)
OfferLoadFailed ::  :: H=We couldn't load this offer :: B=Try again(prim)
OfferLockScreen ::  :: H= :: B=Open the offer(prim)
OfferLockScreenLate ::  :: H=That offer has ended :: B=Back to waiting(seco)
OfferNotAvailable ::  :: H=You can't take this offer :: B=Back to Home(seco)
OfferReplacesResult ::  :: H= :: B=Decline(tert)
OfferSmall ::  :: H= :: B=Decline(tert)
OfferTaken ::  :: H=Another rider took this order first :: B=Back to waiting(seco)
OfferTipHidden ::  :: H= :: B=Decline(tert)
OfferUrgent ::  :: H= :: B=Decline(tert)
OfferUrgentLight ::  :: H= :: B=Decline(tert)
OfferWithdrawn ::  :: H=This order was cancelled :: B=Back to waiting(seco)
OfflineCap :: 'Offline', 'Rest time' :: H=Time for a rest :: B=
OfflineDocExpired :: 'Offline', 'Set offline by HalalGoes' :: H=Your vehicle insurance has expired :: B=Upload a new document(prim)
OfflineNoReason :: 'Offline', 'Set offline by HalalGoes' :: H=HalalGoes set you offline :: B=Go online(prim)
OfflineUnresponsive :: 'Offline', 'Set offline by HalalGoes' :: H=We set you offline :: B=Check notification settings(tert) | Go online(prim)
ResumeStripDropoff :: 'Earnings', 'On a delivery' :: H= :: B=Resume(prim)
SuspendedMidShift :: 'Offline', 'Account not active' :: H=Your account is not active :: B=See account status(prim) | Call HalalGoes support(tert)
SuspendedOnDelivery :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
```

### DL (delivery)

```text
CancelledFoodConfirm :: 'Order cancelled', 'Order HG-4K2M-9T' :: H=Don't deliver it :: B=I've dealt with the food(prim) | Go offline(tert)
CancelledFoodConfirmReassigned :: 'Delivery moved', 'Order HG-4K2M-9T' :: H=This delivery went to another rider :: B=I've handed it over(prim) | Go offline(tert)
CantDeliverConfirm :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Go to Aisha M. :: B=Call HalalGoes support(tert) | Leave it at the door with a photo and a statement(prim) | Return it to the restaurant(tert) | Keep trying(ghos)
CantDeliverEnRoute :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Call HalalGoes support(tert) | Return it to the restaurant(prim) | Keep going(ghos)
CantDeliverFailed :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H= :: B=Call Aisha M.(tert) | Try again(prim) | Something's wrong(ghos)
CantDeliverQueued :: 'Return the food', 'Order HG-4K2M-9T' :: H=Take the food back to Zaytoun Grill :: B=Navigate(tert) | Call restaurant(tert) | Something's wrong(ghos) | I've returned it(prim)
CantDeliverSending :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Recording that you can't deliver :: B=Return it to the restaurant(prim)
ContactBeforePickup :: 'Contact', 'Before pickup · HG-4K2M-9T' :: H= :: B=Call Zaytoun Grill(tert)
ContactEmpty :: 'Contact', 'Order HG-4K2M-9T' :: H= :: B=Something's wrong(ghos)
ContactError :: 'Contact', 'Order HG-4K2M-9T' :: H=We couldn't load the contact details :: B=Something's wrong(ghos) | Try again(prim)
ContactLoading :: 'Contact', 'Order HG-4K2M-9T' :: H= :: B=Something's wrong(ghos)
CustomerCancelledAfterPickup :: 'Order cancelled', 'Order HG-4K2M-9T' :: H=The customer's order was cancelled :: B=Call HalalGoes support(prim) | Done — I've dealt with the food(tert) | Go offline(tert) | Call Zaytoun Grill(ghos)
Delivered :: 'Delivered', 'Order HG-4K2M-9T' :: H=Delivered to Aisha M. :: B=Back to Home(prim)
DeliveredAttestation :: 'Delivered', 'Order HG-7Q3F-2R' :: H=Delivered to Omar K. :: B=Back to Home(prim)
DeliveredGoOffline :: 'Delivered', 'Order HG-4K2M-9T' :: H=Delivered to Aisha M. :: B=Back to Home(prim) | Go online(tert)
DeliveredLight :: 'Delivered', 'Order HG-4K2M-9T' :: H=Delivered to Aisha M. :: B=Back to Home(prim)
DeliveredOtp :: 'Delivered', 'Order HG-7Q3F-2R' :: H=Delivered to Omar K. :: B=Back to Home(prim)
DeliveredPodMissing :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=We need a photo before this counts as delivered :: B=Take the photo(prim)
DropoffArriveFailed :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
DropoffArriveQueued :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Keep the bag until you're back online :: B=Call Aisha M.(tert) | Hand it over(prim) | Something's wrong(ghos)
DropoffArrived :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Leave it at Aisha M.'s door :: B=See all messages(ghos) | Call customer(tert) | Something's wrong(ghos) | Hand it over(prim)
DropoffArrivedLarge :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Leave it at Aisha M.'s door :: B=See all messages(ghos) | Call customer(tert) | Something's wrong(ghos) | Hand it over(prim)
DropoffArrivedSmall :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Leave it at Aisha M.'s door :: B=See all messages(ghos) | Call customer(tert) | Something's wrong(ghos) | Hand it over(prim)
DropoffArriving :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Recording that you're here :: B=I'm here(prim)
DropoffDoNotCall :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Meet Omar K. in the lobby :: B=Navigate(tert) | Something's wrong(ghos) | Call Omar K.(ghos) | I'm here(prim)
DropoffEnRoute :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | See all messages(ghos) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
DropoffEnRouteLarge :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | See all messages(ghos) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
DropoffEnRouteSmall :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | See all messages(ghos) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
DropoffGeofence :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Something's wrong(ghos) | Continue: I'm here(prim) | I'm not there yet(tert)
DropoffLight :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
DropoffTrackingDegraded :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
DropoffTrackingLost :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Omar K. :: B=Open location settings(tert) | Navigate(tert) | Something's wrong(ghos) | I'm here(prim)
EndedWhileClosed :: 'Delivery ended', 'Order HG-4K2M-9T' :: H=While the app was closed, this delivery ended :: B=OK, go to Home(prim)
FocusStatesChrome ::  :: H=Focus — card, nav, app bar, primary button :: B=Accept(prim)
FocusStatesControls ::  :: H=Focus — rows and fields (docs/decisions/focus-indicator.md) :: B=Pickup is too far(tert)
Handover :: 'Hand it over', 'Step 4 of 4 · HG-4K2M-9T' :: H=How will you hand it over? :: B=Something's wrong(ghos) | {{nextLabel}}(prim)
HandoverLarge :: 'Hand it over', 'Step 4 of 4 · HG-4K2M-9T' :: H=How will you hand it over? :: B=Something's wrong(ghos) | {{nextLabel}}(prim)
HandoverLight :: 'Hand it over', 'Step 4 of 4 · HG-4K2M-9T' :: H=How will you hand it over? :: B=Something's wrong(ghos) | {{nextLabel}}(prim)
HandoverOtp :: 'Hand it over', 'Step 4 of 4 · HG-7Q3F-2R' :: H=Who will you hand it to? :: B=Something's wrong(ghos) | {{nextLabel}}(prim)
HandoverSmall :: 'Hand it over', 'Step 4 of 4 · HG-4K2M-9T' :: H=How will you hand it over? :: B=Something's wrong(ghos) | {{nextLabel}}(prim)
MessagesAfterEnd :: 'Messages', "Order HG-4K2M-9T · you're off this order" :: H= :: B=
OrderCancelled :: 'Order cancelled', 'Order HG-4K2M-9T' :: H=HalalGoes cancelled this order :: B=See messages about this order(tert) | Back to Home(prim)
OrderCancelledAfterPickup :: 'Order cancelled', 'Order HG-4K2M-9T' :: H=HalalGoes cancelled this order :: B=Call HalalGoes support(prim) | Done — I've dealt with the food(tert) | Go offline(tert) | Call Zaytoun Grill(ghos)
OrderCancelledByCustomer :: 'Order cancelled', 'Order HG-4K2M-9T' :: H=The customer's order was cancelled :: B=See messages about this order(tert) | Back to Home(prim)
OrderCancelledByRestaurant :: 'Order cancelled', 'Order HG-4K2M-9T' :: H=Zaytoun Grill cancelled this order :: B=See messages about this order(tert) | Back to Home(prim)
PickupArriveFailed :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Call restaurant(tert) | Something's wrong(ghos) | Try again(prim)
PickupArriving :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=I'm at the restaurant(prim)
PickupCodeHelp :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Ask the kitchen for the pickup code :: B=Call HalalGoes support(tert) | Something's wrong(ghos) | Back to the code(prim)
PickupCodeLocked :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Too many wrong codes :: B=Call Zaytoun Grill(tert) | Something's wrong(ghos) | Call HalalGoes support(prim)
PickupCodeRejectedLater :: 'Pickup', 'Order HG-4K2M-9T' :: H=The pickup code you saved wasn't accepted :: B=Call Zaytoun Grill(tert) | Call HalalGoes support(tert) | Send the code(prim)
PickupCodeWrong :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Check the bag has 3 items :: B=The kitchen can't find the code(tert) | Call restaurant(tert) | Something's wrong(ghos) | I've got the food(prim)
PickupEnRoute :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Navigate(tert) | See all messages(ghos) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupEnRouteLarge :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Navigate(tert) | See all messages(ghos) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupEnRouteSmall :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Navigate(tert) | See all messages(ghos) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupGeofence :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Something's wrong(ghos) | Continue: I'm at the restaurant(prim) | I'm not there yet(tert)
PickupItems :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Check the bag has 3 items :: B=The kitchen can't find the code(tert) | Call restaurant(tert) | Something's wrong(ghos) | I've got the food(prim)
PickupItemsLight :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Check the bag has 3 items :: B=The kitchen can't find the code(tert) | Call restaurant(tert) | Something's wrong(ghos) | I've got the food(prim)
PickupLongWait :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H= :: B=Call Zaytoun Grill(tert) | Something's wrong(ghos) | Check the items(prim) | They've handed it over, but it isn't marked ready(ghos)
PickupNotMarkedReady :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Wait for the food :: B=Call Zaytoun Grill(prim) | Call HalalGoes support(seco) | Keep waiting(tert)
PickupReady :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Navigate(tert) | See all messages(ghos) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupRecordFailed :: 'Pickup', 'Step 2 of 4 · Check the bag' :: H= :: B=Call restaurant(tert) | Something's wrong(ghos) | Try again(prim)
PickupRecordQueued :: 'Pickup', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Something's wrong(ghos) | Go to the customer(prim)
PickupRecording :: 'Pickup', 'Step 2 of 4 · Check the bag' :: H=Checking the code and recording your pickup :: B=I've got the food(prim)
PickupRestaurantClosed :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Zaytoun Grill looks closed :: B=Call HalalGoes support(prim) | Call Zaytoun Grill(tert) | Something's wrong(ghos)
PickupStartFailed :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim) | Navigate(tert) | Try again now(ghos)
PickupStartQueued :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Navigate(tert) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupTrackingDegraded :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Navigate(tert) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupTrackingLost :: 'Pickup', 'Step 1 of 4 · Go to the restaurant' :: H=Go to Zaytoun Grill :: B=Open location settings(tert) | Navigate(tert) | Call restaurant(tert) | Something's wrong(ghos) | I'm at the restaurant(prim)
PickupWaiting :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Wait for the food :: B=See all messages(ghos) | Call restaurant(tert) | Something's wrong(ghos) | Check the items(prim) | They've handed it over, but it isn't marked ready(ghos)
PodAttestation :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Photo and a short statement :: B=Retake(tert) | Something's wrong(ghos) | {{submitLabel}}(prim)
PodAttestationCameraDenied :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Camera is off for HalalGoes :: B=Something's wrong(ghos) | Open Settings(prim)
PodAttestationFailed :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Photo and a short statement :: B=Retake(tert) | Try again(prim) | Something's wrong(ghos)
PodAttestationLeftAtDoor :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Leave it at the door with a photo and a statement :: B=Retake(tert) | Something's wrong(ghos) | {{submitLabel}}(prim)
PodAttestationSubmitting :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Photo and a short statement :: B=Retake(tert) | {{submitLabel}}(prim)
PodAttestationValid :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Photo and a short statement :: B=Retake(tert) | {{submitLabel}}(prim)
PodAttestationWait :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Wait at the door :: B=Something's wrong(ghos) | {{submitLabel}}(prim) | Call Omar K.(tert)
PodDeliverFailed :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H= :: B=Try again(prim) | Something's wrong(ghos)
PodDeliverQueued :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H= :: B=Something's wrong(ghos)
PodMarkingDelivered :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=Marking as delivered :: B=Mark as delivered(prim)
PodMethodMismatch :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=This order needs a different proof :: B=Something's wrong(ghos) | Enter the customer's code(prim)
PodOtp :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Ask the customer for their 4-digit code :: B=Something's wrong(ghos) | Check the code(prim) | The customer can't find the code(tert)
PodOtpAccepted :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Code accepted :: B=Mark as delivered(prim)
PodOtpChecking :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Ask the customer for their 4-digit code :: B=Checking the code(prim)
PodOtpHelp :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Ask the customer for their 4-digit code :: B=Something's wrong(ghos) | Back to the code(prim)
PodOtpLight :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Ask the customer for their 4-digit code :: B=Something's wrong(ghos) | Check the code(prim) | The customer can't find the code(tert)
PodOtpLocked :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=The code is locked after 5 tries :: B=Something's wrong(ghos) | Take a photo instead(prim)
PodOtpWrong :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-7Q3F-2R' :: H=Ask the customer for their 4-digit code :: B=Something's wrong(ghos) | Check the code(prim) | The customer can't find the code(tert)
PodPhoto :: 'Proof of delivery', 'Step 4 of 4' :: H=Take a photo of the bag at the door :: B=Something's wrong(ghos) | Take photo(prim)
PodPhotoCameraDenied :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=Camera is off for HalalGoes :: B=Something's wrong(ghos) | Open Settings(prim)
PodPhotoFailed :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H= :: B=Retake photo(tert) | Try uploading again(prim)
PodPhotoReview :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=Check the photo :: B=Something's wrong(ghos) | Mark as delivered(prim) | Retake(tert)
PodPhotoReviewLight :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=Check the photo :: B=Something's wrong(ghos) | Mark as delivered(prim) | Retake(tert)
PodPhotoUploading :: 'Proof of delivery', 'Step 4 of 4 · Proof · HG-4K2M-9T' :: H=Uploading your photo :: B=Uploading photo(prim) | Retake(tert)
PodQueuedRejectedAlt :: 'Delivery', 'Order HG-4K2M-9T' :: H=Your saved delivery wasn't accepted :: B=Call Zaytoun Grill(tert) | Back to Home(prim)
QueuedRejected :: 'Delivery', 'Order HG-4K2M-9T' :: H=A step you saved offline wasn't accepted :: B=Continue from here(prim)
Reassigned :: 'Delivery moved', 'Order HG-4K2M-9T' :: H=This delivery went to another rider :: B=See messages about this order(tert) | Back to Home(prim)
ReassignedAfterPickup :: 'Delivery moved', 'Order HG-4K2M-9T' :: H=This delivery went to another rider :: B=See messages about this order(tert) | Call HalalGoes support(prim) | Done — I've handed the bag over(tert) | Call Zaytoun Grill(ghos)
RestaurantNotes :: 'Contact', 'After pickup · HG-4K2M-9T' :: H= :: B=Call Zaytoun Grill(tert) | Call Aisha M.(tert)
Restoring :: 'Delivery' :: H=Picking up where you left off :: B=
Returned :: 'Food returned', 'Order HG-4K2M-9T' :: H=Returned to Zaytoun Grill :: B=Back to Home(prim)
ReturnedFailed :: 'Return the food', 'Order HG-4K2M-9T' :: H= :: B=Call restaurant(tert) | Something's wrong(ghos) | Try again(prim)
ReturnedGeofence :: 'Return the food', 'Order HG-4K2M-9T' :: H=Take the food back to Zaytoun Grill :: B=Confirm: I've returned it(prim) | Keep going to the restaurant(tert)
ReturnedLoading :: 'Food returned', 'Order HG-4K2M-9T' :: H= :: B=
ReturnedPaid :: 'Food returned', 'Order HG-4K2M-9T' :: H=Returned to Zaytoun Grill :: B=Back to Home(prim)
ReturnedQueued :: 'Return the food', 'Order HG-4K2M-9T' :: H= :: B=Something's wrong(ghos) | Back to Home(prim)
ReturnedSending :: 'Return the food', 'Order HG-4K2M-9T' :: H=Recording the return :: B=I've returned it(prim)
Returning :: 'Return the food', 'Order HG-4K2M-9T' :: H=Take the food back to Zaytoun Grill :: B=Navigate(tert) | Call restaurant(tert) | Something's wrong(ghos) | I've returned it(prim)
ReturningNoConnection :: 'Return the food', 'Order HG-4K2M-9T' :: H=Take the food back to Zaytoun Grill :: B=Navigate(tert) | Call restaurant(tert) | Something's wrong(ghos) | I've returned it(prim)
SignedOut ::  :: H=Sign in with your phone :: B=Send code(prim)
SomethingWrong :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H= :: B=Call HalalGoes support(tert) | Call Aisha M.(tert) | I can't deliver this order(tert) | Back to the delivery(prim)
SomethingWrongDoor :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H= :: B=Call HalalGoes support(tert) | Call Aisha M.(tert) | I can't deliver this order(tert) | Back to the delivery(prim)
SomethingWrongNoSupport :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H= :: B=Call Aisha M.(tert) | I can't deliver this order(tert) | Back to the delivery(prim)
SomethingWrongPickup :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H= :: B=Call HalalGoes support(tert) | Call Zaytoun Grill(tert) | Back to the delivery(prim)
SomethingWrongPickupNoSupport :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H= :: B=Call Zaytoun Grill(tert) | Back to the delivery(prim)
SomethingWrongReasonsAlt :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H= :: B=Tell HalalGoes(prim) | Back to the delivery(tert)
SomethingWrongReturning :: 'Return the food', 'Order HG-4K2M-9T' :: H= :: B=Call HalalGoes support(tert) | Call Zaytoun Grill(tert) | Back to the return(prim)
TripLoadFailed :: 'Delivery', 'Order details' :: H=We couldn't load this delivery :: B=Try again(prim) | Something's wrong(ghos) | Call HalalGoes support(tert)
TripLoading :: 'Delivery' :: H= :: B=
TripNoConnection :: 'Drop-off', 'Step 4 of 4 · Hand it over' :: H=Keep the bag until you're back online :: B=Call Aisha M.(tert) | Hand it over(prim) | Something's wrong(ghos)
TripOutOfDate :: 'Drop-off', 'Step 3 of 4 · Go to the customer' :: H=Go to Aisha M. :: B=Navigate(tert) | Call customer(tert) | Something's wrong(ghos) | I'm here(prim)
TripSocketLost :: 'Pickup', 'Step 2 of 4 · At the restaurant' :: H=Wait for the food :: B=Call restaurant(tert) | Something's wrong(ghos) | Check the items(prim)
UpdateApp ::  :: H=Update HalalGoes to keep delivering :: B=Update the app(prim)
```

### PA (payouts-account)

```text
Account-Delete-Confirm :: 'Delete account' :: H=Delete your account / What happens :: B=Delete my account(tert) | Call support(ghos)
Account-Delete-Done ::  :: H=Your account is deleted :: B=Back to sign in(tert)
Account-Delete-Failed :: 'Delete account' :: H=Delete your account / What happens :: B=Try again(tert) | Call support(ghos)
Account-Delete-OnDelivery :: 'Delete account' :: H=Delete your account / What happens :: B=Delete my account(tert) | Call support(ghos)
Account-Delete-Request :: 'Delete account' :: H=Delete your account / What happens :: B=Call support(tert) | Email support(tert)
Account-Delete-Working :: 'Delete account' :: H=Delete your account / What happens :: B=Delete my account(tert) | Call support(ghos)
Account-Delete :: 'Delete account' :: H=Delete your account / What happens :: B=Delete my account(tert) | Call support(ghos)
Account-DocView-Error :: "Driver's licence" :: H= :: B=Try again(tert)
Account-DocView-Expired :: "Driver's licence" :: H= :: B=Get a new link(seco)
Account-DocView-Loading :: "Driver's licence" :: H= :: B=
Account-DocView :: "Driver's licence" :: H= :: B=Download a copy(seco) | Replace this document(tert)
Account-Documents-Empty :: 'Documents' :: H=No documents on file :: B=Call support(ghos)
Account-Documents-Error :: 'Documents' :: H=We couldn't load your documents :: B=Try again(prim)
Account-Documents-Expired :: 'Documents' :: H= :: B=
Account-Documents-Light :: 'Documents' :: H= :: B=Add new insurance(seco)
Account-Documents-Loading :: 'Documents' :: H= :: B=
Account-Documents :: 'Documents' :: H= :: B=Add new insurance(seco)
Account-Error :: 'Account' :: H=We couldn't load your account :: B=Try again(prim)
Account-Loading :: 'Account' :: H= :: B=
Account-Overview-Light :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-Overview-NoSupport :: 'Account' :: H=Yusuf Ahmed :: B=Sign out(tert)
Account-Overview-ReplaceInReview :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-Overview :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-Payouts-Due :: 'Payouts' :: H=Stripe needs 1 thing by Friday 2 October 2026 / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Account-Payouts-Error :: 'Payouts' :: H=We couldn't check your payouts :: B=Try again(prim)
Account-Payouts-Eventually :: 'Payouts' :: H=Stripe will need 1 more thing later :: B=Add it now with Stripe(tert) | Copy details for support(tert)
Account-Payouts-Loading :: 'Payouts' :: H= :: B=
Account-Payouts-NotSetUp :: 'Payouts' :: H=Payouts are not set up :: B=Set up payouts with Stripe(prim)
Account-Payouts :: 'Payouts' :: H= :: B=Change bank details with Stripe(tert)
Account-Profile-Alt :: 'Your details' :: H= :: B=Call support(ghos)
Account-Profile-Error :: 'Your details' :: H=We couldn't load your details :: B=Try again(prim)
Account-Profile-Loading :: 'Your details' :: H= :: B=
Account-Profile :: 'Your details' :: H= :: B=Call support(ghos)
Account-Replace-Added :: 'Documents' :: H=Send your new insurance :: B=Send for review(prim) | Take a new photo(tert)
Account-Replace-Confirm :: 'Documents' :: H= :: B=
Account-Replace-Cooldown :: 'Documents' :: H= :: B=Send for review(prim) | Take a new photo(tert)
Account-Replace-InReview-Alt :: 'Documents' :: H= :: B=
Account-Replace-InReview :: 'Documents' :: H= :: B=
Account-Replace-LinkExpired :: 'Documents' :: H= :: B=Try again(tert)
Account-Replace-Rejected :: 'Documents' :: H=Vehicle insurance (new) :: B=Take a new photo(prim) | Choose a PDF instead(tert) | Call support(ghos)
Account-Replace-Sending :: 'Documents' :: H=Send your new insurance :: B=Send for review(prim) | Take a new photo(tert)
Account-Replace-TooLarge :: 'Documents' :: H= :: B=Take a photo(tert)
Account-Replace-TooSmall :: 'Documents' :: H= :: B=Retake(tert)
Account-Replace-TooSoon :: 'Vehicle insurance' :: H= :: B=Back to documents(prim) | Change the date(tert)
Account-SignOut-Active-Light :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-SignOut-Active :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-SignOut-Failed :: 'Account' :: H=Yusuf Ahmed :: B=Try again(tert) | Call support(ghos) | Sign out(tert)
Account-SignOut-Working :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-SignOut :: 'Account' :: H=Yusuf Ahmed :: B=Call support(ghos) | Sign out(tert)
Account-Terms-Alt :: 'Terms and privacy' :: H= :: B=Read the rider terms(tert) | Read the privacy notice(tert)
Account-Terms :: 'Terms and privacy' :: H= :: B=Read the rider terms(tert) | Read the privacy notice(tert)
Account-Vehicle-Error :: 'Vehicle' :: H=We couldn't load your vehicle :: B=Try again(prim)
Account-Vehicle-Loading :: 'Vehicle' :: H= :: B=
Account-VehicleChange-Blocked :: 'Change vehicle' :: H= :: B=Save vehicle(prim)
Account-VehicleChange-Light :: 'Vehicle' :: H=Your vehicle :: B=Call support to change your vehicle(seco)
Account-VehicleChange :: 'Vehicle' :: H=Your vehicle :: B=Call support to change your vehicle(seco)
Account-VehicleDocs :: 'Documents' :: H= :: B=Add(tert) | Add government ID(prim)
Account-VehicleError :: 'Change vehicle' :: H= :: B=Try again(prim)
Account-VehicleForm-Motor :: 'Change vehicle' :: H=About your car :: B=Save vehicle(prim)
Account-VehicleForm-PlateInUse :: 'Change vehicle' :: H=About your car :: B=It's my vehicle: call support(tert) | Save vehicle(prim)
Account-VehicleForm-Required :: 'Change vehicle' :: H=About your car :: B=Save vehicle(prim)
Account-VehicleForm-YearRange :: 'Change vehicle' :: H=About your car :: B=Save vehicle(prim)
Account-VehicleForm :: 'Change vehicle' :: H= :: B=Save vehicle(prim)
Account-VehicleSaveConfirm :: 'Change vehicle' :: H= :: B=Save vehicle(prim)
Account-VehicleSaving :: 'Change vehicle' :: H= :: B=Save vehicle(prim)
Legal-Document-Error :: 'Rider terms' :: H=We couldn't open the rider terms :: B=Try again(seco) | Call support(ghos)
Legal-Document-Loading :: 'Rider terms' :: H= :: B=Call support(ghos)
Legal-Document :: 'Rider terms' :: H=Rider terms :: B=Call support(ghos)
Payout-Checking :: 'Your application', 'Payouts' :: H=Checking with Stripe :: B=Check again(tert) | Call support(ghos)
Payout-CheckingSlow :: 'Your application', 'Payouts' :: H=Stripe is still checking your details :: B=Check again(seco) | Call support(ghos)
Payout-CreateFailed :: 'Your application', 'Payouts' :: H=Get paid :: B=Try again(prim) | Call support(ghos)
Payout-Due-Details :: 'Your application', 'Payouts' :: H=Stripe needs 2 more things from you / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Payout-Due-LargeText :: 'Your application', 'Payouts' :: H=Stripe needs 2 more things from you / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Payout-Due :: 'Your application', 'Payouts' :: H=Stripe needs 2 more things from you / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Payout-LinkFailed :: 'Your application', 'Payouts' :: H=Get paid :: B=Try again(prim) | Call support(ghos)
Payout-Loading :: 'Your application', 'Payouts' :: H= :: B=
Payout-NotYet :: 'Your application', 'Payouts' :: H=Get paid :: B=Back to review(tert) | Call support(ghos)
Payout-Offline :: 'Your application', 'Payouts' :: H=Get paid :: B=Continue to Stripe(prim) | Call support(ghos)
Payout-Opening :: 'Your application', 'Payouts' :: H=Get paid :: B=Continue to Stripe(prim) | Call support(ghos)
Payout-PastDue-Light :: 'Your application', 'Payouts' :: H=Stripe needs 1 thing from you now / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Payout-PastDue :: 'Your application', 'Payouts' :: H=Stripe needs 1 thing from you now / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Payout-Ready-Light :: 'Your application' :: H=You're ready to ride :: B=Go to Home(prim) | Call support(ghos)
Payout-Ready :: 'Your application' :: H=You're ready to ride :: B=Go to Home(prim) | Call support(ghos)
Payout-Rejected :: 'Your application', 'Payouts' :: H=Stripe can't pay out to this account :: B=Call support(seco) | Copy details for support(tert)
Payout-Restricted :: 'Payouts' :: H=Stripe has paused your payouts / What Stripe needs :: B=Copy details for support(tert) | Continue to Stripe(prim) | Call support(ghos)
Payout-Returned :: 'Your application', 'Payouts' :: H=Stripe isn't finished yet :: B=Continue with Stripe(prim) | Call support(ghos)
Payout-Start :: 'Your application', 'Payouts' :: H=Get paid :: B=Continue to Stripe(prim) | Call support(ghos)
Payout-StatusError :: 'Your application', 'Payouts' :: H=We couldn't check your payouts :: B=Try again(prim) | Call support(ghos)
Profile-Locked :: 'Your details' :: H= :: B=Call support(ghos)
Suspended-Added :: 'Account paused' :: H=Send your new insurance :: B=Send for review(prim) | Take a new photo(tert) | Call support(ghos)
Suspended-Closed-OnDelivery :: 'Delivery' :: H= :: B=
Suspended-Closed :: 'Account paused' :: H=You can't go online right now :: B=
Suspended-DocExpired-Light :: 'Account paused' :: H=You can't go online right now :: B=Add new insurance(prim) | Call support(ghos)
Suspended-DocExpired :: 'Account paused' :: H=You can't go online right now :: B=Add new insurance(prim) | Call support(ghos)
Suspended-Earnings :: 'Earnings' :: H=Earnings aren't available while your account is paused :: B=Call support(seco)
Suspended-Error :: 'Account paused' :: H=We couldn't load your account :: B=Try again(prim) | Call support(ghos)
Suspended-Generic-NoSupport :: 'Account paused' :: H=You can't go online right now :: B=Sign out(tert)
Suspended-Generic-Reason-Alt :: 'Account paused' :: H=You can't go online right now :: B=Call support(seco) | Sign out(tert)
Suspended-Generic :: 'Account paused' :: H=You can't go online right now :: B=Call support(seco) | Sign out(tert)
Suspended-InReview :: 'Account paused' :: H=You can't go online right now :: B=Call support(ghos)
Suspended-Loading :: 'Account paused' :: H= :: B=
Suspended-OnDelivery :: 'Delivery' :: H= :: B=
```
