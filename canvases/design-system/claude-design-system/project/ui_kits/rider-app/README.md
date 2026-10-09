# Rider app (Expo / React Native, dark scheme)

The HalalGoes rider kit. It runs under the design system's dark scheme (`data-theme="dark"`):
surfaces, text and borders come from the dark tokens, and the app bar and bottom nav use their
`field` tone. There are no raw `rgba()` or hex values in the kit. Primary actions use the `xl` (60px)
Button, and the one critical action (Accept) uses `critical` (72px). Icons are Solar only; where Solar
has no glyph (bike, wallet, phone, camera, store…) the control carries text instead.

The offer is the DS `Sheet` with `variant="full"` and `dismissible={false}` (no close button, no
Escape, no scrim tap), timed by `Countdown` (`expiresAt`, `serverNow`, `windowSeconds={30}`).
The trip progress strip is `StatusTimeline audience="rider"` fed with the order state the
Assignment carries (`pickup.order_state`); the AssignmentState itself is the artboard variant, since
StatusTimeline draws OrderState only.

Contrast (dark token values from the new `tokens.json`, unchanged for these roles): `text-primary` #f6efdd is 15.6:1 on `surface-base`
#171717 and 10.8:1 on `surface-raised` #33352f, so every instruction and body line uses it.
`text-secondary` (8.4:1 on base, 5.8:1 on raised) and `text-tertiary` (4.9:1 / 3.4:1) are kept to
metadata. The dark tokens do not reach 7:1 for secondary text on raised surfaces. That is a token fix,
not a kit fix.

Open the preview and pick a **Screen**, a **Variant** (the contract state being drawn) and a
**State** (Populated / Loading / Empty / Error). "Show component gaps" outlines each placeholder
that stands in for a component the system does not have yet (#109).

## Screens
| File | Screen | Variants |
|---|---|---|
| `SignInScreen.jsx` | Phone OTP sign-in | phone, code, wrong code, too many attempts |
| `OnboardingScreen.jsx` | Onboarding (`RiderOnboardingState`) | profile, vehicle (`VehicleType`), documents (`RiderDocType` per vehicle), review, fix documents (`DOCUMENTS_REJECTED` + `DocumentRejectionReasonCode`), payouts |
| `OnlineScreen.jsx` | Home / availability (`RiderDashboard`) | `ONLINE_IDLE` (waiting for an offer), `OFFLINE`, `ONLINE_STALE`, tracking `DEGRADED`, `blocking_reasons`, on a delivery |
| `OfferScreen.jsx` | Offer (`current_offer`) | live, decline reason picker (`OfferRejectReasonCode`), expired, withdrawn, already taken (409) |
| `ActiveScreen.jsx` | Active trip | one per `AssignmentState`, plus pickup/delivery seal scans, proof of delivery (OTP / PHOTO / PHOTO_WITH_ATTESTATION) and the exception path |
| `EarningsScreen.jsx` | Earnings (`EarningsSummary`) and Payout detail (`Payout`) | all paid, `HELD`, `FAILED`; detail: `PAID`, `TRANSFERRING`, `HELD`, `FAILED` |
| `HistoryScreen.jsx` | Delivery history and Profile | — |
| `Data.jsx` | Sample payloads (UUIDv7 ids, `order_code`) | — |
| `RiderUi.jsx` | Layout, seal scan, items list, masked contact | — |
| `Kit.jsx` | Shared artboard frame and component-gap placeholders | — |
| `RiderApp.jsx` | Entry: the artboard list | — |

## Rules the kit follows
- **One offer at a time.** There is no list of nearby offers and no offer count. The rider waits, and
  `current_offer` arrives full-screen.
- **30-second offer.** The countdown is `expires_at − server_time` from the server (`dispatch.offer_ttl_seconds` = 30), never a local constant.
- **Before accepting, the rider sees only `dropoff.area`.** The unit, buzzer and instructions come
  in the Assignment payload after accepting.
- **Money is never worked out on the phone.** The offer shows "Estimated $X · tip so far $Y" from
  `OfferEarningsEstimate`. Earnings, the unpaid balance and payouts are server values. Payouts go
  out weekly, on Monday.
- **The rider records the seal condition deliberately.** Nothing is pre-selected. A broken seal does
  not block the handoff. Tamper reports are filed by the customer, not the rider.
- **No auto-accept, no acceptance rate, no review count.**

## Source
`contracts/openapi.yaml` (RiderDashboard, DispatchOffer, Assignment, EarningsSummary, Payout,
KycDocument), `docs/spec/04-rider.md`, `apps/rider/src/screens/*` and `components/SealScanCard.tsx`.
