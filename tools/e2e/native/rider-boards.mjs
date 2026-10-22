// Which rider design boards no native flow can be captured against, and why.
//
// A rider board is a file canvases/rider/<area>/project/<Board>.dc.html on the branch
// origin/claude/redesign-canvases (652 of them, in six areas). A board is covered one of two ways:
//
//   paired      a flow under native/rider/redesign/ captures it with the design-capture subflow,
//               `SHOT: design--<area>--<Board>` (tools/e2e/README.md, "Design captures"). Not listed here:
//               check-boards.mjs reads the flows.
//   unpairable  listed below, with the reason. The diff never sees a capture for it, so it is not
//               scored; a board with no capture and no reason here fails check-boards.mjs.
//
// Each entry is [pattern, reason]. The pattern is tested against "<area>/<Board>"; the first entry that
// matches a board gives its reason, so the specific entries come before the general ones. An entry that
// matches no board is stale and fails the check, so a renamed or removed board cannot hide in here.
// The same rules as customer-boards.mjs, which this follows.
//
// How these were decided (22 October 2026, from the boards' text and the flows, not from names):
//   - The rider boards are drawn in the DARK theme unless the name or title says light, and at 390 dp
//     wide and 100 % text unless it says 360, 200 % or Large. The CI run (tools/e2e/run.sh) now puts the
//     phone in the dark theme for the rider's redesign flows, and the device-lab rider missions set it
//     too, so a dark board is a pairing and a light one is not.
//   - Many boards are wrappers (dc-import name="Main" variant="firstrun" theme="dark"...) around a
//     template the area imports; opened on its own, a template is drawn at 200 % text from its defaults.
//   - A board counts as reachable only if a flow shows that screen in that state. Where the screen's
//     own text names the state, the flow captures it only when the screen says so (runFlow `when`).
//   - The states the flows cannot reach split three ways, named in the reasons: a request in flight or
//     a refusal the dev world never answers; a state that needs a persona or a scenario the dev world
//     lacks (https://github.com/shaiknoorullah/hg-mono/issues/708, https://github.com/shaiknoorullah/hg-mono/issues/1030);
//     a screen no flow opens yet.
//   - Nothing here was measured on a device: no emulator was available.

const PHONE_FLOWS = 'The rider flows run on a 390 dp wide phone with the system font size at 100 % and the phone in the dark theme (tools/e2e/run.sh in CI, the mission in the device lab)';
const LIGHT = 'Drawn in the light theme. The rider flows run with the phone in the dark theme, which is what the other boards of the screen are drawn in; none sets light before it captures.';
const NO_DEVWORLD = 'CI has no dev world to put a rider in this state (https://github.com/shaiknoorullah/hg-mono/issues/1030), and the rider personas it needs do not exist yet (https://github.com/shaiknoorullah/hg-mono/issues/708).';
const IN_FLIGHT = 'A request still in flight or a page still loading. The flows wait for the answer before they capture, so none holds this moment.';
const REFUSED = 'A refusal or a failure (5xx, 403, 409, 422, 429, no connection) the dev world never answers at this step. No flow provokes it; the flows that cut the network do it on Home, at pickup, at the door and on the way back, not here.';
const NO_FLOW = 'No flow opens this screen.';

export const UNPAIRABLE = [
  [/^shift-offers\/BlockingReasonsCopy$|^delivery\/FocusStates(Chrome|Controls)$|^sign-in-onboarding\/Ref-|^earnings\/PayoutStates$/, 'A reference board (a table of copy, a specimen of every control focused, or a reference of states), 800 dp wide or several states on one board. No single screenshot is that picture.'],
  [/^(earnings\/(Main|Activity|Payouts|EntryDetail|PayoutDetail)|history-whats-new\/(Deliveries|DeliveryDetail|WhatsNew))$/, 'The template the area imports; the other boards of the area are wrappers around it (state, theme). Opened on its own it is drawn at 200 % text from its defaults, not the screen at normal size.'],


  // --- a condition the flows never set --------------------------------------------------------------
  [/^[^/]+\/[^/]*([Ll]ight)$|^[^/]+\/[^/]*-[Ll]ight-/, LIGHT],
  [/^[^/]+\/[^/]*Small$/, '360 dp wide and 640 dp tall (a fit check). ' + PHONE_FLOWS + ' on the 390 x 844 dp design AVD; the 360 dp one (tools/design-diff/android/create-avd.sh design-360) runs no flow.'],
  [/^[^/]+\/[^/]*([Ll]arge-?[Tt]ext|-large-text|Large)(-[a-z]+)?$|^[^/]+\/[^/]*-large$/, 'Drawn with the system font enlarged to 200 %. ' + PHONE_FLOWS + '.'],
  [/^[^/]+\/[^/]*Keyboard$/, 'Drawn with the on-screen keyboard open. Every flow hides the keyboard before it captures, so no capture shows it.'],
  [/^[^/]+\/.*[Ff]ocus/, 'A focus-ring or screen-reader reading-order state (a control focused by keyboard or TalkBack). Maestro cannot place that focus before it captures.'],

  // --- shift and offers ----------------------------------------------------------------------------
  [/^shift-offers\/(HomeGoingOnline|HomeGoingOffline|HomeLoading|OfferAccepting|OfferDeclining|OfferEarningsLoading)$/, IN_FLIGHT],
  [/^shift-offers\/(HomeError|HomeOnlineFailed|HomeOfflineFailed|OfferAcceptRetry|OfferDeclineFailed|OfferLoadFailed|OfferAcceptExpired|OfferConnectionLost)$/, REFUSED],
  [/^shift-offers\/(HomeDegraded|HomeLost|HomeStale|HomePermissionRevoked|HomeNotificationsOff)$/, 'Tracking or a phone permission goes wrong mid-shift (weak or lost location, location or notifications turned off). The flows grant the permissions and set one fixed location; none degrades them.'],
  [/^shift-offers\/(HomeOnDelivery|HomeOnDeliveryDropoff|HomeGoOfflineAfter|HomeGoOfflineRefused|ForcedOfflineOnDelivery|AccountTabResume|EarningsTabResume|ResumeStripDropoff|SuspendedOnDelivery)$/, 'Needs a delivery under way with the rider on Home or another tab. The trip flows stay on the trip screens, and CI cannot accept an offer: the backend still asks for a seal scan at pickup until https://github.com/shaiknoorullah/hg-mono/issues/315, which would strand the rider.'],
  [/^shift-offers\/(OfferCritical|OfferUrgent)$/, 'The offer with under 25 % or under 10 % of its 30 seconds left. The flows capture the offer as soon as it shows; Maestro cannot capture at a chosen second of a countdown.'],
  [/^shift-offers\/(OfferTaken|OfferWithdrawn|OfferNotAvailable|OfferReplacesResult|OfferLockScreen|OfferLockScreenLate)$/, 'An offer outcome the server pushes (taken by another rider, withdrawn, the rider no longer available), or the phone locked or the app in the background. The order-ready scenario offers one order to one rider, and no flow locks the phone.'],
  [/^shift-offers\/(OfferBreakdownPartial|OfferTipHidden)$/, 'The offer with breakdown rows hidden (fields missing, no tip yet). Which rows show follows the offer the dev world sends, not the flow.'],
  [/^shift-offers\/(OfferDeclineOther|HomeCapWarning|OfflineUnresponsive)$/, 'An alternative drawn for a contract field that does not exist yet (the board is marked Needs API), so the app cannot draw it.'],
  [/^shift-offers\/(OfflineCap|OfflineDocExpired|OfflineNoReason|SuspendedMidShift|HomeBlocked|HomePayoutsPaused)$/, 'The server sets the rider offline or blocks going online (12 hours online, an expired document, a suspended account, payouts paused by Stripe). ' + NO_DEVWORLD],
  [/^shift-offers\/HomeTodayEmpty$/, 'Home on a first shift with nothing earned today. The flow captures Home offline as shift-offers/Main; which of the two the rider sees depends on trips the rider has made today, which no flow sets.'],

  // --- delivery ------------------------------------------------------------------------------------
  [/^delivery\/(PickupArriving|PickupRecording|DropoffArriving|CantDeliverSending|ReturnedSending|ReturnedLoading|PodAttestationSubmitting|PodMarkingDelivered|PodOtpChecking|PodPhotoUploading|TripLoading|Restoring|ContactLoading)$/, IN_FLIGHT],
  [/^delivery\/(PickupArriveFailed|PickupRecordFailed|PickupStartFailed|DropoffArriveFailed|CantDeliverFailed|ReturnedFailed|ReturnedGeofence|PodDeliverFailed|PodAttestationFailed|PodMethodMismatch|TripLoadFailed|TripOutOfDate|TripSocketLost|ContactError|QueuedRejected|PickupCodeRejectedLater|PodQueuedRejectedAlt)$/, REFUSED],
  [/^delivery\/(PickupStartQueued|DropoffArriveQueued|CantDeliverQueued|PodDeliverQueued|ReturningNoConnection)$/, 'A step saved on the phone because the network was cut at that very step. The flows cut it at the pickup code (captured), at the door and on the way back (captured), not at these steps.'],
  [/^delivery\/(PickupTrackingDegraded|PickupTrackingLost|DropoffTrackingDegraded|DropoffTrackingLost)$/, 'Weak or lost location tracking on the trip. The flows give the app a clean route and never degrade it.'],
  [/^delivery\/(PickupLongWait|PickupNotMarkedReady|PickupRestaurantClosed|PickupCodeHelp|PickupCodeLocked)$/, 'A pickup that goes wrong (waiting 20 minutes, handed over before it was marked ready, the restaurant closed, the kitchen without the code, three wrong codes). The flow sends two wrong codes at most, in a world where the restaurant is ready; the server checks the code only once https://github.com/shaiknoorullah/hg-mono/issues/315 lands.'],
  [/^delivery\/(PodAttestation|PodAttestationCameraDenied|PodAttestationLeftAtDoor|PodAttestationValid|PodAttestationWait|DeliveredAttestation|PodOtpHelp|PodOtpLocked|DeliveredPodMissing|DropoffDoNotCall|DeliveredGoOffline)$/, 'A proof or hand-over branch the flows do not take: photo with a statement, the customer who cannot find the code, three wrong codes, a delivery asked not to be called, going offline after it. The flows prove by one photo or by the customer\'s code.'],
  [/^delivery\/PodPhotoCameraDenied$/, 'The camera refused for the proof photo. The flows that deny the camera do it for the application\'s documents (lab/8d-camera-denied.yaml), not for the delivery\'s proof.'],
  [/^delivery\/(OrderCancelledAfterPickup|OrderCancelledByCustomer|OrderCancelledByRestaurant|CustomerCancelledAfterPickup|CancelledFoodConfirm|CancelledFoodConfirmReassigned|Reassigned|ReassignedAfterPickup|EndedWhileClosed|SignedOut)$/, 'A delivery that ends in a way the flows do not cause: cancelled after pickup, by the customer or the restaurant, moved to another rider, ended while the app was closed, the rider signed out. lab/6-cancel.yaml waits for a HalalGoes cancel before pickup, which is delivery/OrderCancelled. ' + NO_DEVWORLD],
  [/^delivery\/(ContactBeforePickup|ContactEmpty|RestaurantNotes|MessagesAfterEnd)$/, NO_FLOW + ' It is Contact or Messages, reached from the trip screen.'],
  [/^delivery\/(SomethingWrong|SomethingWrongNoSupport|SomethingWrongPickup|SomethingWrongPickupNoSupport|SomethingWrongReturning)$/, 'The "Something\'s wrong" sheet on another leg than the door (drop-off, pickup, returning) or with support switched off. The flow opens it at the door (delivery/SomethingWrongDoor), with support on.'],
  [/^delivery\/SomethingWrongReasonsAlt$/, 'An alternative drawn for a contract operation that does not exist yet (coded reasons, Tell HalalGoes); the board says Needs API.'],
  [/^delivery\/(CantDeliverEnRoute|ReturnedPaid)$/, 'The return trip as the board draws it (en route with the return only; a ledger entry exists). The flow shows the return screen once, then the saved return, then the returned screen; the ledger entry needs a payout run.'],
  [/^delivery\/UpdateApp$/, 'A forced update screen, shown only when the server refuses the app\'s version. The dev build is never refused.'],

  // --- earnings and payouts ------------------------------------------------------------------------
  [/^earnings\/(Activity-(empty|end|error|loading|not-active|offline|paging|paging-error|rate-limited)|Earnings-(error|loading|not-active|rate-limited|offline|back-online|switching|switched|next-failed)|Payouts-(error|loading|not-active|rate-limited|offline|offline-saved|paging|paging-error)|Payout-(error|loading|not-active|rate-limited|offline|not-found)|Entry-(deeplink-loading|deeplink-missing|payout-error|payout-loading|payout-missing))$/, 'A page that is still loading or has failed, an account paused (403), too many tries (429), no connection, or a stepper moment. The flows wait for each page to load for an active rider with a connection, and no flow opens one from a push.'],
  [/^earnings\/Earnings-(day-past|last-month|last-week)$/, 'A period the flow does not step to. It steps to today, yesterday and this month; a past day is opened from a By-day row of last week, and last week and last month are not stepped to.'],
  [/^earnings\/Earnings-(empty-month|empty-week)$/, 'An empty period of a rider who has earned. The e2e world\'s rider has never earned (the first-run screen is captured instead), and the dev world\'s rider-sim has earned in the periods the flow steps to.'],
  [/^earnings\/(Earnings-(account-attention|account-due|account-due-mapped|account-mapped|failed-cause|failed-transient|failed-twice|held-cause|held-review|negative-balance|paused-on-delivery|paused-readable|payout-failed|payout-held|payout-ready|payout-transferring|stacked|on-delivery)|Payouts-(account-attention|account-due|account-mapped|end|failed|failed-cause|failed-transient|held|held-cause|held-review|multi|multi-cause|negative-balance|paused-readable|ready|transferring|empty)|Payout-(all-lines|draft|failed|failed-7-to-13|failed-cause|failed-no-fix|failed-transient|failed-twice|held|held-cause|held-checking|held-lifted|held-no-fix|held-review|no-lines|ready|transferred|transferring))$/, 'A payout in a state (ready, sending, held, failed, a Stripe requirement due, a balance below zero) or Payouts with rows. It needs a payout run and a Stripe account, and devworld has no payout scenario. ' + NO_DEVWORLD],
  [/^earnings\/Entry-/, 'A ledger line of one kind (a delivery with its amount, a tip, a bonus, an adjustment, a correction, a reversal, paid or not, opened from the list or from a payout). The flow opens the first Delivery line the dev world has; which of these boards that is depends on its amount and payout, which no flow sets.'],
  [/^earnings\/PayoutAccount(-returned)?$/, 'The hand-off to Stripe and the return from it. Stripe\'s page opens outside the app, and a flow cannot complete it.'],

  // --- sign-in and onboarding ----------------------------------------------------------------------
  [/^sign-in-onboarding\/SignIn-Code-(Expired|Locked|TriesUsed)$/, 'The server refuses the code (expired, rate limited, tries used up). The flows type one wrong code, then the right one; it is never refused for age or for tries.'],
  [/^sign-in-onboarding\/SignIn-Code-(Offline|Verifying|Pasted|Resend|ResendLimit)$/, 'A moment that passes or a path the flows do not take: the network cut at the code step, the sixth digit being checked, a code pasted, the resend timer running out or the resend limit. The flows type the digits and wait.'],
  [/^sign-in-onboarding\/SignIn-Phone-(Invalid|Sending|TooMany|Unavailable)$/, 'A refused or pending Send code (number not valid, request in flight, too many codes, codes unavailable). The flows send a valid number once and are never refused.'],
  [/^sign-in-onboarding\/SignIn-Phone-SignedOut$/, 'Sign in after the session ended. The flow that signs out (9-account) signs out on purpose and lands on the plain sign-in screen, which it asserts says nothing about a lost session.'],
  [/^sign-in-onboarding\/(SignIn-Deactivated|SignIn-Deactivated-NoSupport|Fix-Closed|Fix-Closed-Reason|Route-.*|App-UpdateRequired)$/, 'A forced-session or forced-route screen (account closed, an account setup problem, opening that fails or times out, an update required). Reached only when the server forces it; no flow or scenario does. ' + NO_DEVWORLD],
  [/^sign-in-onboarding\/Onboarding-(Error|Loading|Offline|Welcome-Terms-Tried)$/, 'The application hub loading, failing or offline, or the unticked-terms alternative the board marks Needs API. ' + REFUSED],
  [/^sign-in-onboarding\/Profile-(EmailInUse|Loading|Offline|Saving|ServerError|Timezone-Error|Underage|UnderageAgain)$/, 'Your details refused or pending on save (email in use, under age, a 5xx, offline, saving) or the time zone not set. The flow saves valid details once, and the phone\'s time zone is in the list.'],
  [/^sign-in-onboarding\/Vehicle-(Bicycle|Car|ChangeAfterDocs|Motorcycle|OnFoot|Switched)$/, 'A vehicle type the flow does not choose (it chooses a scooter), or a type changed after documents were added.'],
  [/^sign-in-onboarding\/Vehicle-(Error|Loading|NoChoice|NotApplicable|Offline|PlateInUse|Required|Saving|YearRange)$/, 'The vehicle step refused or pending (plate in use, plate required, year out of range, a 5xx, offline, saving) or Continue with nothing chosen. The flow fills a valid scooter once.'],
  [/^sign-in-onboarding\/Docs-(Bicycle|Bicycle-Incomplete|Bicycle-Ready|Bicycle-Submitting)$/, 'The documents step for a bicycle or on foot (two documents). The flows apply on a scooter (four documents).'],
  [/^sign-in-onboarding\/Docs-(AddExpiry|Cooldown|DocView|Interrupted|LoadError|Loading|Mixed|Offline|SubmitError|Submitting|UploadErrors)$/, 'The documents step refused, pending or mixed (upload interrupted, unreadable or too small file, send limit, couldn\'t send, loading, an added document opened). The flow adds each document once and it lands.'],
  [/^sign-in-onboarding\/Capture-(FileUnreadable|PdfError|PdfPicked|Selfie-Interrupted|Selfie-TooSmall|Starting|TooSoon|TorchOn)$/, 'The camera or the file choice in a path the flows do not take: a PDF chosen, a file that cannot be read or is too large, the camera still starting, the torch on, an expiry too soon, an upload interrupted. The flow takes the emulator camera\'s photo and types a valid expiry.'],
  [/^sign-in-onboarding\/Fix-(?!Ready$)/, 'Fix your documents for a particular rejection (illegible, wrong type, name, birth date or plate mismatch, forgery, two rejected, last resend) or its edit forms and refusals. The persona the fix flow signs in as has one rejected Government ID, and its reviewer\'s reason and note are not those of any board; the board for the screen once the new photo is in, fix-ready, is captured.'],
  [/^sign-in-onboarding\/Review-(Approved|Error|LiveRejected|Partial|Reconnecting|Waiting-NotifOff|Waiting-Slow)$/, 'The review screen in a state the server moves it to (approved or turned down live, partly approved, reconnecting, notifications off, taking more than 72 hours). Approval is an admin action no flow takes, and notifications are allowed on every flow\'s first launch.'],

  // --- payouts and account -------------------------------------------------------------------------
  [/^payouts-account\/(Account-(Error|Loading|Profile-Error|Profile-Loading|Vehicle-Error|Vehicle-Loading|DocView-Error|DocView-Loading|DocView-Expired|Documents-Error|Documents-Loading|Payouts-Error|Payouts-Loading|SignOut-Working|SignOut-Failed|Replace-Sending|Replace-LinkExpired|Replace-Cooldown|VehicleSaving|VehicleError)|Legal-Document-(Error|Loading)|Payout-(Loading|StatusError|Offline|CreateFailed|LinkFailed|NotYet|Opening|Checking|CheckingSlow|Returned)|Suspended-(Loading|Error))$/, IN_FLIGHT + ' Or ' + REFUSED.charAt(0).toLowerCase() + REFUSED.slice(1)],
  [/^payouts-account\/Account-Delete/, 'Delete account. The flow does not open it, and at launch it is only a request to HalalGoes (Account-Delete-Request); the other boards are a later version.'],
  [/^payouts-account\/(Account-Vehicle|Account-VehicleChange|Account-VehicleDocs|Account-VehicleForm|Account-VehicleSaveConfirm)/, NO_FLOW + ' Your vehicle is read-only, and the change-vehicle form needs an API that does not exist yet (the boards are marked Needs API).'],
  [/^payouts-account\/(Account-Profile|Account-Profile-Alt|Profile-Locked)$/, NO_FLOW + ' Your details is reached from Account; the alternative needs a rider profile call the contract lacks.'],
  [/^payouts-account\/(Account-Terms|Account-Terms-Alt|Legal-Document)$/, NO_FLOW + ' Terms and privacy is reached from Account; the notice\'s address is Needs API.'],
  [/^payouts-account\/(Account-Documents|Account-Documents-Expired|Account-Replace-Added|Account-Replace-Confirm|Account-Replace-InReview|Account-Replace-InReview-Alt|Account-Replace-Rejected|Account-Replace-TooSoon|Account-Overview-NoSupport|Account-Overview-ReplaceInReview)$/, 'Documents or Account for a rider whose documents are expiring, expired or being replaced, or with support switched off. Which documents the dev world holds and when they expire is its data, not a flow\'s; the flow captures the empty list only. ' + NO_DEVWORLD],
  [/^payouts-account\/Account-SignOut-Active$/, 'Sign out during a delivery. It needs a delivery under way with the rider on Account, which no flow gets to (https://github.com/shaiknoorullah/hg-mono/issues/315).'],
  [/^payouts-account\/Account-Payouts(-Due|-Eventually)?$/, 'The payout account in a state Stripe decides (healthy, a requirement due, a requirement later). The flow accepts whichever the world has, so it captures the one state its own world shows (not set up) and names nothing else. ' + NO_DEVWORLD],
  [/^payouts-account\/Payout-/, 'The Payouts step of the application (after the documents are approved: not started, due, past due, rejected, ready). Approval is an admin action no flow takes, so no flow gets this far. ' + NO_DEVWORLD],
  [/^payouts-account\/Suspended-/, 'A paused or closed account (document expired, insurance added or in review, closed, closed on a delivery). ' + NO_DEVWORLD],

  // --- history and what's new ----------------------------------------------------------------------
  [/^history-whats-new\/(Deliveries-(error|loading|loading-more|not-active|offline|offline-first|paging-error|rate-limited)|Delivery-(error|loading|not-active|offline|rate-limited|unavailable)|WhatsNew-(error|loading))$/, 'A list or a delivery that is still loading or has failed, an account paused (403), too many tries (429), no connection, or a delivery no longer there. The flow waits for the page to load for an active rider with a connection.'],
  [/^history-whats-new\/Deliveries-(end|no-detail|reversed)$/, 'The deliveries list with rows (every row loaded, a row with no assignment, a reversed row). The list with rows has no board of its own that fits (its template is drawn at 200 % text), and which rows the dev world holds is its data.'],
  [/^history-whats-new\/Delivery-(cancelled|from-entry|left-at-door-attested|left-at-door-from-entry|no-handover|no-handover-from-entry|no-handover-from-tip|returned|undeliverable)$/, 'A delivery\'s detail of one outcome or handover (cancelled before pickup, returned, left at the door with a statement) or reached from a ledger line. The flow opens the first delivery of the dev world, which is delivered by photo; its detail is the template delivery, drawn at 200 % text.'],
  [/^history-whats-new\/WhatsNew-(account-row|deferred|dismissed|empty|long|offer|offer-accepted|single)$/, 'The What\'s new sheet shown once after an update, or the notes in a state (empty, long, dismissed, waiting during a delivery, covered by an offer). The sheet needs a stored last-seen version and the dev build is version 0.0.0; the flow opens the page from Account (history-whats-new/WhatsNew-page).'],
];
