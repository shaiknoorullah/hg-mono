# Restaurant web (desktop, 1280+)

The HalalGoes partner console. Forest-chrome side navigation, white page header, cream canvas.
The preview (`components/Index4/preview.html`) inlines the compiled kit and renders one artboard
at a time: choose the **Screen**, its **Variant** (a state from the contract) and the baseline
state (**Populated / Loading / Empty / Error**). Deep links work too:
`#screen=orders&variant=expired`, `#screen=menu&state=empty`.

Navigation matches `apps/restaurant/src/components/Shell.tsx`: Orders, Menu, Hours, Payouts,
Staff, Settings. There is no Certification page; certificate documents live in Settings →
Documents, upload-only.

## Screens
| File | Screen | Variants and notes |
|---|---|---|
| `AuthScreens.jsx` | Sign in · Register · Onboarding | Email + password, then TOTP. Register, then "check your email". Onboarding steps Profile → Documents → Review → Payouts, with `PROFILE_PENDING`, `DOCUMENTS_PENDING`, `DOCUMENTS_REJECTED` (fix documents), `DOCUMENTS_REVIEW` (awaiting review) and `PAYOUT_PENDING` (Stripe) |
| `RestaurantShell.jsx` | Chrome | Wordmark, side nav, heartbeat status (live / offline / paused), accepting-orders switch, missed-orders notice from `missed_order_count`. No print, no sidebar badge |
| `QueueScreen.jsx` | Orders | Columns by `OrderState`. 180 s accept countdown from `deadline_at` minus server time; Accept is the one 72px action, Decline is small, 24px away and asks for a `RestaurantRejectReasonCode`; seal binding then Mark ready; Add delay (`DelayReasonCode`); Collected is read-only (rider's pickup scan). Variants: live, sound gate, connection lost, accept window ran out, missed orders, paused |
| `MenuScreen.jsx` | Menu | Grouped by menu category. Four-state availability (Available / Out of stock with back-at / Hidden / Blocked by an admin, locked). Review column from `MenuItemVersion`: in review, not approved (reason code + note) |
| `HoursScreen.jsx` | Hours | Weekly trading intervals plus date overrides, in the restaurant's timezone |
| `PayoutsScreen.jsx` | Payouts | Weekly, every Monday. Amount and entry count per period; Held (with `hold_reason`), Failed, On its way. Variant: payouts not enabled, finish Stripe setup |
| `StaffScreen.jsx` | Staff | Managers and staff, invite, status |
| `SettingsScreen.jsx` | Settings | Legal name and address locked (they are halal checks H3/H4): "request a change" re-verifies. Storefront details. Documents: upload-only, one `KycDocumentState` per document. Variant: certificate expiring (the only place the expiry date appears) |
| `Data.jsx` | Sample data | Contract-shaped, UUIDv7-shaped ids, short order codes |
| `RestaurantApp.jsx` | Entry | The artboard list |
| `Kit.jsx` | Shared | KitFrame and the `Gap*` placeholders (same file in every kit) |

`customer-app/Photo.jsx` is the image placeholder (gap: MediaFrame), with a real no-image fallback.

## Rules this kit keeps
- No auto-accept anywhere. Payment is captured when a person accepts.
- The accept window is 180 s and comes from the server's `deadline_at`, never a local timer.
- The restaurant never types certificate details; it uploads, an admin transcribes.
- No downloadable badge: a file cannot expire when the certificate does.
- Never red for a halal state; solid green only in the seal.

## Components used
All components come from the current design system (`window.HalalGoesDesignSystem_d11a47`):
- **Accept and decline.** Accept is a `Button critical`. Decline opens a `Modal` containing a `RadioGroup` of `RestaurantRejectReasonCode`.
- **Countdown.** The accept window uses `Countdown` with `expiresAt={deadline_at}`, `serverNow` and `windowSeconds={180}`.
- **Order progress.** Accepted orders show a compact `StatusTimeline audience="restaurant"`.
- **Tables.** Menu and staff tables use `DataTable` with `rowActions`, which renders the DS `Menu` with its own trigger.
- **Switch.** The accepting-orders control is a `Switch` with a `stateLabel`.
- **Icons.** Icons are Solar only. Where Solar has no glyph (menu, payouts, settings, calendar, bank, upload), the item is text-only.
- **Placeholders.** Onboarding progress is a marked `Stepper` gap (kit-local, in `AuthScreens.jsx`), because `StatusTimeline` is for order states only.
