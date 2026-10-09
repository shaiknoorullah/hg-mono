# Admin web (desktop, 1440)

HalalGoes operations. The densest surface in the system: `density.compact` (44px rows), mono
UUIDv7 ids shown as `head…tail` with a copy action, tabular money, and the seven-check halal
verification console. The content area sets `data-density="compact"`.

The kit mirrors the routes in `apps/admin/src/App.tsx` and shows only fields the contract
(`contracts/openapi.yaml`) returns. There is no dashboard: its numbers have no API behind them
and are proposed separately (issue #117). There are no Restaurants or Riders list screens, no
Export and no Alerts bell, because the contract has no operation for any of them.

## Screens (artboards in the preview)
Every screen has Populated, Loading, Empty and Error states; queues also have a filtered-to-nothing variant.

| File | Screen | Contract |
|---|---|---|
| `SignInScreen.jsx` | Sign in: email + password, TOTP code, TOTP enrolment | `mfa_enrolled` is mandatory for staff roles, no grace period |
| `QueueScreens.jsx` | Restaurant queue (`/`), Rider queue, Menu reviews | `RestaurantApplicationSummary`, `RiderApplicationSummary`, `MenuItemVersion`; take-next claims with a visible lock owner and `review_lock_expires_at` |
| `ApplicationScreens.jsx` | Application detail, Rider application detail | `RestaurantApplication` / `RiderApplication`: documents (`KycDocumentState`), blockers, decision |
| `VerificationScreen.jsx` | Halal verification (`/certificates/:id`) | Document viewer beside the transcription form, then the DS `HalalChecklist` fed the `HalalCertificate` payload: it owns the H5/H7 server-computed lock, the all-seven-PASS approve gate and the `HalalRejectionReasonCode` reject; confirm `Modal`s for the decision |
| `OrderScreens.jsx` | Orders, Order detail, Refunds & disputes | `OrderSummary` (all 14 `OrderState`s mapped), `OrderAdminView`, `RefundState` in its own column, `AdminRefundInput` |
| `SystemScreens.jsx` | Issuing-body registry, Staff, System | `HalalIssuingBody`, `StaffUser`, `DependencyReport` |
| `AdminShell.jsx` | Chrome | Forest chrome sidebar (`GapSideNav`), HalalGoes wordmark, signed-in staff member |
| `Data.jsx` | Sample data and state→badge mappings | UUIDv7-shaped ids; `OrderSummary.code` is the human reference; certificate numbers are sample free text |
| `AdminApp.jsx` | Entry: the artboard list for `KitFrame` | |
| `Kit.jsx` | Shared kit frame + component-gap placeholders | Same file in every kit |

## Rules this kit follows
- Never red for a halal state; solid green only in the halal seal. Registry and document states use neutral, accent, info or warning tints.
- A halal badge renders only from a real `HalalDisplayState`.
- Money is rendered as the server froze it (`OrderMoney`); the kit does no arithmetic.
- Built against the new component APIs (Solar icons only, `Modal`, `DataTable` with caption/row actions/empty/filtered/loading/error states, `HalalBadge` with the contract enum on the `operational` surface, `StatusTimeline audience="admin"`).
- Placeholders marked `data-gap` stand in for components the system does not have yet (#109); switch on "Show component gaps" in the preview to see them.
