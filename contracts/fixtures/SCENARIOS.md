# The scenario vocabulary

**Generated** by `contracts/fixtures/_build/vocabulary.py` (`pnpm fixtures:build`). Edit the
builder, not this file.

One set of words for both test layers of the redesign (master plan section 5.1):

| Layer | Runs against | You name a state with |
|---|---|---|
| **A. Mock** (screen tests, Playwright on `pnpm mock`) | `contracts/fixtures/**` through `tools/mock-server` | a **fixture scenario**, per operation |
| **B. Real API** (Playwright, Maestro on the compose stack) | `services/hg` with the dev world | `make dev-reset`, a **persona**, `make dev-scenario s=<name>`, `make dev-journey` |

A test that checks "the order is ready for pickup" uses `order_ready_for_pickup` in layer A and
`make dev-scenario s=order-ready` in layer B. The tables below say which is which. The full
fixture catalogue is [`README.md`](README.md); the machine-readable one is `index.json`.

## 1. Naming rules

These are the rules the existing names already follow; new fixtures follow them too.

1. **`snake_case`, globally unique.** The name is the scenario you pass; the folder is only
   filing.
2. **`<subject>_<state>`.** The subject is the thing the screen reads, in the projection it
   reads it (`order_` customer, `restaurant_order_` restaurant, `order_admin_view_` staff,
   `tracking_`, `assignment_`). The state is the **contract enum value, lower-cased**
   (`READY_FOR_PICKUP` becomes `order_ready_for_pickup`; `SUSPENDED` becomes
   `restaurant_profile_account_suspended`). Never a synonym for an enum value.
3. **Two dimensions get a word each:** `restaurant_profile_account_<state>` and
   `restaurant_profile_halal_<display_state>`. A missing object is `_missing`
   (`restaurant_profile_halal_missing`: no badge, never an optimistic one).
4. **Collections:** `<subject>_list_<variant>` or `<subject>_queue[_<variant>]`; zero rows is
   `_empty`; a second page is `_page_2`.
5. **Errors:** `error_<code>` lower-cased is the code's plain meaning (`error_quote_stale`).
   When one code means different things in different places, the context goes first
   (`error_menu_locked_banned`, `error_refund_mfa_required`, `error_rider_email_in_use`). The
   HTTP status and `error.code` are in the fixture; clients branch on the code, never on the
   name or the message.
6. **Realtime:** `realtime_<area>_<story>`. A realtime fixture is a whole **script** played
   over one WebSocket connection, not one frame. Areas are `order`, `payment`, `rider`,
   `restaurant` and `admin_ops`.
7. **Request bodies** (fixtures of what a client sends) end in `_input_<variant>`
   (`restaurant_decision_input_reject`).
8. **Contract-only states.** When the contract defines a value `services/hg` does not produce
   yet, the fixture exists (apps handle every contract value) and its `describes` starts the
   sentence with "Contract-only:". Layer B cannot reach it.

### Families in the set today

| Prefix | Fixtures | The suffix names | Example |
|---|---:|---|---|
| `error_` | 108 | `error_<code>` for a code's plain meaning; `error_<context>_<situation>` when one code means several things (`error_menu_locked_banned`, `error_staff_email_in_use`). Status and code live in the fixture, never only in the name. | `error_quote_stale` |
| `realtime_` | 21 | `realtime_<area>_<story>`: a whole WebSocket script, played over one connection. Areas: `order`, `payment`, `rider`, `restaurant`, `admin_ops`, plus the transport stories `gap_and_resume` and `control_frames`. | `realtime_restaurant_offer_burst` |
| `realtime_ticket` | 1 | Not a script: the single-use ticket `createRealtimeTicket` returns. | `realtime_ticket` |
| `order_admin_view_` | 3 | An `OrderState` (lower case) as the staff projection shows it. | `order_admin_view_disputed` |
| `order_list_` | 5 | A list variant: `active`, `past`, `empty`. | `order_list_active` |
| `order_rating_` | 3 | A rating state. | `order_rating_unrated` |
| `order_` | 19 | An `OrderState`, lower case, in the customer projection (`order_ready_for_pickup`), or a money or shape edge (`order_zero_tip`). | `order_arrived` |
| `restaurant_order_` | 16 | An `OrderState` in the restaurant projection, or the queue (`_queue_busy`, `_queue_empty`). | `restaurant_order_preparing` |
| `tracking_` | 6 | An `OrderState` (or a degraded signal) in the tracking projection. | `tracking_picked_up` |
| `assignment_` | 14 | An `AssignmentState`, lower case, or a drop-off instruction edge. | `assignment_arrived_at_pickup` |
| `dispatch_` | 10 | A `DispatchState`, lower case. | `dispatch_searching` |
| `offer_` | 7 | A rider offer outcome. | `offer_pending` |
| `payment_` | 11 | A `PaymentState`, lower case, or saved methods. | `payment_requires_action` |
| `refund_` | 15 | A `RefundState` in the customer view. | `refund_settled` |
| `admin_refund_` | 13 | A `RefundState` or queue in the staff view. | `admin_refund_queue` |
| `chargeback_` | 12 | A chargeback state or list. | `chargeback_needs_response` |
| `halal_badge_` | 4 | A `HalalDisplayState`, lower case. | `halal_badge_expiring_soon` |
| `certification_panel_` | 6 | A `HalalDisplayState` in the customer certification panel. | `certification_panel_certified` |
| `halal_certificate_` | 10 | A certificate status or expiry edge (staff view). | `halal_certificate_status_pending` |
| `halal_issuing_bod` | 7 | An issuing-body status or list. | `halal_issuing_body_suspended` |
| `restaurant_detail_` | 9 | A `HalalDisplayState` or availability edge on the customer restaurant page. | `restaurant_detail_expiring_soon` |
| `restaurant_availability_` | 5 | The customer availability answer. | `restaurant_availability_paused` |
| `restaurant_open_state_` | 9 | A `RestaurantOpenState`, lower case. | `restaurant_open_state_closed_suspended` |
| `restaurant_profile_account_` | 7 | A `RestaurantAccountState`, lower case. | `restaurant_profile_account_suspended` |
| `restaurant_profile_halal_` | 5 | A `HalalDisplayState`, lower case, or `missing` (no `halal` object). | `restaurant_profile_halal_missing` |
| `restaurant_onboarding_` | 11 | A `RestaurantOnboardingState`, lower case. | `restaurant_onboarding_documents_review` |
| `rider_onboarding_` | 10 | A `RiderOnboardingState`, lower case. | `rider_onboarding_vehicle_pending` |
| `restaurant_application_` | 5 | An application in the staff review queue. | `restaurant_application_pending_review` |
| `rider_application_` | 5 | An application in the staff review queue. | `rider_application_pending_review` |
| `document_` | 12 | A `KycDocumentState` or rejection reason. | `document_rejected_illegible` |
| `session_next_route_` | 10 | A `NextRoute`, lower case. | `session_next_route_suspended` |
| `session_grant_` | 3 | Who was signed in. | `session_grant_staff` |
| `principal_` | 6 | The signed-in principal, by role (`principal_<role>`). | `principal_support_agent` |
| `menu_` | 28 | A menu, item, category or version state. | `menu_version_pending_review` |
| `rider_availability_` | 5 | A `RiderAvailabilityState`, lower case. | `rider_availability_online_idle` |
| `payout_` | 24 | A `PayoutState`, lower case, or a payout run. | `payout_held` |
| (other) | 151 | One-off subjects named for what they are (`public_config`, `cart_many_lines`, `quote_standard`). | `public_config` |

## 2. How one scenario is chosen per operation (the mock server)

Every request is matched to one contract operation (`operationId`), then to one fixture:

1. **You name one.** In precedence order: the `?scenario=` query parameter, the
   `X-Mock-Scenario` header (the generated client's `mockScenario` option sends it), the
   `mock_scenario` cookie.
2. **The value is either one name or a per-operation map.**
   * One name, `order_arrived`: served for **every** request that carries it, even an
     operation it is not registered for (with an `X-Mock-Warning`). Fine for one request;
     wrong for a whole screen that calls several operations.
   * A map, `getCurrentPrincipal=principal_admin,listRestaurantOrders=restaurant_order_queue_busy`:
     each operation gets its own fixture; an operation the map does not name gets the
     bare name in the list that is registered for it, or else its **default**. This is how a
     screen test sets one scenario per operation with a single header or cookie.
3. **Nothing named:** the operation's **default** from `index.json` (`defaults`), the plainest
   healthy shape. An error is never a default.
4. A name that does not exist answers with `X-Mock-Warning: unknown scenario ...`; the
   `X-Mock-Scenario` response header always says which fixture was served.
5. An `ErrorEnvelope` fixture is served as-is with its own status (`error_session_revoked` is a
   401).

**Realtime.** One script per connection:
`ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_restaurant_offer_burst` (add
`&autoplay=1` to start without a `subscribe`). The mock re-stamps every timestamp in each
frame, `ts` and the ones inside `data` such as `expires_at`, to wall clock when it plays, so a
countdown in the client is live. `MOCK_WS_SPEED=0.2` plays five times faster.

## 3. Devworld scenarios and the fixtures that show the same state

`make dev-reset`, then `make dev-scenario s=<name>` (in `services/hg`). The fixtures are what the same screen shows in layer A. Several rows for one operation are the states the scenario passes through. A scenario missing here has no mock fixture mapped yet; `go run ./cmd/devworld scenario list` prints them all.

| `s=` | Leaves the world with | Same state in the mock | Note |
|---|---|---|---|
| `new-order` | amina's order at `bismillah-grill` waiting for the restaurant (`RESTAURANT_PENDING`). | `getActiveOrder` → `order_restaurant_pending`<br>`getRestaurantOrder` → `restaurant_order_restaurant_pending`<br>`listRestaurantOrders` → `restaurant_order_restaurant_pending`<br>WebSocket → `realtime_restaurant_offer_one` |  |
| `rush` | Two orders waiting (amina and nour); a third from amina refused with `ACTIVE_ORDER_EXISTS`. | `listRestaurantOrders` → `restaurant_order_queue_busy`<br>`createOrder` → `error_active_order_exists`<br>WebSocket → `realtime_restaurant_offer_burst` | The burst script rings four offers; devworld places two. |
| `order-preparing` | The restaurant accepted: `PREPARING`, payment captured. | `getOrder` → `order_preparing`<br>`getOrderTracking` → `tracking_preparing`<br>`getRestaurantOrder` → `restaurant_order_preparing` |  |
| `order-ready` | Marked ready: `READY_FOR_PICKUP`. | `getOrder` → `order_ready_for_pickup`<br>`getOrderTracking` → `tracking_ready_for_pickup`<br>`getRestaurantOrder` → `restaurant_order_ready_for_pickup` |  |
| `customer-cancels` | amina cancels before acceptance: `CANCELLED`, the authorisation voided. | `cancelOrder` → `order_cancelled`<br>`getOrder` → `order_cancelled`<br>WebSocket → `realtime_restaurant_offer_withdrawn` |  |
| `restaurant-rejected` | `bismillah-grill` declines the waiting order: `REJECTED`, the authorisation voided. | `getOrder` → `order_rejected`<br>`rejectOrder` → `restaurant_order_rejected`<br>WebSocket → `realtime_order_restaurant_rejects` |  |
| `docs-approve` | The admin approves the document waiting in review for `docs-review`. | `reviewRestaurantDocument` → `document_approved`<br>`getRestaurantOnboardingStatus` → `restaurant_onboarding_documents_review` | The onboarding state moves on only when every document is approved (`restaurant_onboarding_documents_approved`). |
| `docs-reject` | The admin rejects that document as `ILLEGIBLE`. | `reviewRestaurantDocument` → `document_rejected_illegible`<br>`getRestaurantOnboardingStatus` → `restaurant_onboarding_documents_rejected` |  |
| `menu-approve` | The admin approves the oldest menu version waiting for review (persona `menu`). | `listMenuReviewQueue` → `menu_review_queue`<br>`decideMenuVersion` → `menu_version_approved` |  |
| `menu-reject` | The admin rejects it as `MISLEADING_DESCRIPTION`. | `listMenuReviewQueue` → `menu_review_queue`<br>`decideMenuVersion` → `menu_version_rejected` |  |
| `onboard-restaurant` | A new restaurant from sign-up to live: every `RestaurantOnboardingState` in turn, ending `ACTIVE`. | `getRestaurantOnboardingStatus` → `restaurant_onboarding_registered`<br>`getRestaurantOnboardingStatus` → `restaurant_onboarding_profile_pending`<br>`getRestaurantOnboardingStatus` → `restaurant_onboarding_documents_review`<br>`getRestaurantOnboardingStatus` → `restaurant_onboarding_payout_pending`<br>`getRestaurantOnboardingStatus` → `restaurant_onboarding_active` |  |
| `onboard-rider` | A new rider from first sign-in to online, ending `ACTIVE` and `ONLINE_IDLE`. | `getRiderOnboardingStatus` → `rider_onboarding_phone_verified`<br>`getRiderOnboardingStatus` → `rider_onboarding_vehicle_pending`<br>`getRiderOnboardingStatus` → `rider_onboarding_documents_review`<br>`getRiderOnboardingStatus` → `rider_onboarding_payout_pending`<br>`getRiderOnboardingStatus` → `rider_onboarding_active`<br>`setRiderAvailability` → `rider_availability_online_idle` |  |
| `dev-journey` | `make dev-journey route= speed= auto=`: a rider takes the order from offer to delivery. | `getCurrentOffer` → `offer_pending`<br>`getAssignment` → `assignment_en_route_to_pickup`<br>`getAssignment` → `assignment_picked_up`<br>`getOrderTracking` → `tracking_picked_up`<br>`getOrderTracking` → `tracking_arrived`<br>`getOrderTracking` → `tracking_delivered`<br>WebSocket → `realtime_order_happy_path` | |

## 4. Devworld personas and their fixtures

| Persona | Same state in the mock |
|---|---|
| `admin-seed` | `getCurrentPrincipal` → `principal_super_admin` |
| `support-seed` | `getCurrentPrincipal` → `principal_support_agent` |
| `amina` | `getCurrentPrincipal` → `principal_customer` |
| `nour` | `getCurrentPrincipal` → `principal_customer` |
| `rider-sim` | `getRiderOnboardingStatus` → `rider_onboarding_active`<br>`setRiderAvailability` → `rider_availability_offline` |
| `rider-docs` | `getRiderOnboardingStatus` → `rider_onboarding_documents_review` |
| `rider-rejected` | `getRiderOnboardingStatus` → `rider_onboarding_documents_rejected` |
| `rider-registered` | `getRiderOnboardingStatus` → `rider_onboarding_registered` |
| `fresh` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_registered`<br>`getRestaurantProfile` → `restaurant_profile_account_pending` |
| `profile` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_profile_pending` |
| `docs-todo` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_documents_pending` |
| `docs-review` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_documents_review`<br>`getRestaurantProfile` → `restaurant_profile_account_pending` |
| `docs-rejected` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_documents_rejected` |
| `payout` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_payout_pending`<br>`getConnectStatus` → `connect_status_requirements_due` |
| `menu` | `getRestaurantOnboardingStatus` → `restaurant_onboarding_menu_pending`<br>`listMenuReviewQueue` → `menu_review_queue` |
| `bismillah-grill` | `getRestaurantProfile` → `restaurant_profile_account_live`<br>`getRestaurant` → `restaurant_detail_certified`<br>`getRestaurantAvailability` → `restaurant_open_state_open` |
| `expiring-halal` | `getRestaurantProfile` → `restaurant_profile_halal_expiring_soon`<br>`getRestaurant` → `restaurant_detail_expiring_soon`<br>`getRestaurantCertification` → `certification_panel_expiring_soon` |
| `expired-halal` | `getRestaurantProfile` → `restaurant_profile_halal_expired`<br>`getRestaurantProfile` → `restaurant_profile_account_delisted`<br>`getRestaurant` → `restaurant_detail_expired` |
| `paused` | `getRestaurantAvailability` → `restaurant_open_state_paused` |
| `suspended` | `getRestaurantProfile` → `restaurant_profile_account_suspended`<br>`getRestaurantAvailability` → `restaurant_open_state_closed_suspended`<br>`updateMenuItem` → `error_menu_locked` |

## 5. States only the mock can show today

Fixtures whose `describes` says "Contract-only:": `services/hg` cannot produce them, so they have no layer B journey yet.

- `error_account_banned`
- `error_account_suspended`
- `error_active_delivery_in_progress`
- `error_address_in_use`
- `error_cannot_go_online_account_not_active`
- `error_cannot_go_online_all_reasons`
- `error_cannot_go_online_background_location_permission`
- `error_cannot_go_online_continuous_online_cap`
- `error_cannot_go_online_document_expired`
- `error_cannot_go_online_foreground_location_permission`
- `error_cannot_go_online_notification_permission`
- `error_cannot_go_online_onboarding_incomplete`
- `error_cannot_go_online_payout_account_incomplete`
- `error_connect_status_not_found`
- `error_nothing_to_resubmit`
- `error_otp_rate_limited_with_retry`
- `error_profile_incomplete`
- `error_unsupported_country`
- `realtime_admin_ops_queue_depth`
- `realtime_admin_ops_reconciliation_exception`
- `realtime_restaurant_auto_off`
- `restaurant_open_state_closed_toggle_auto_off`
- `rider_dashboard_offline_blocked`
- `rider_dashboard_offline_blocked_account_not_active`
- `rider_dashboard_offline_blocked_background_location_permission`
- `rider_dashboard_offline_blocked_continuous_online_cap`
- `rider_dashboard_offline_blocked_document_expired`
- `rider_dashboard_offline_blocked_foreground_location_permission`
- `rider_dashboard_offline_blocked_notification_permission`
- `rider_dashboard_offline_blocked_onboarding_incomplete`
- `rider_dashboard_offline_blocked_payout_account_incomplete`
- `rider_dashboard_offline_blocked_stale_location_fix`
- `rider_dashboard_on_delivery_dropoff`
- `rider_dashboard_on_delivery_pickup`
- `rider_dashboard_online_stale`
- `rider_dashboard_tracking_degraded`
- `rider_dashboard_tracking_lost`
- `session_next_route_suspended_banned`
- `session_next_route_suspended_deleted`
