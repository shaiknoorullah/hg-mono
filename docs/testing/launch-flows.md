---
covers: []
reviewed: 2026-10-05
---

# Launch flows

Every flow a real person must be able to complete on launch day (6 October 2026), per app. Each
flow has its steps, the expected result, the spec section that defines it, how to set it up, and
the automated test that covers it. The test passes link here
([#76](https://github.com/shaiknoorullah/hg-mono/issues/76)).

**Scope** is [release 1.0](https://github.com/shaiknoorullah/hg-mono/issues/103): the one paid
order from the [spec overview](../spec/00-overview.md#v0--the-43), plus what release 1.0 adds:
live updates for the restaurant queue, customer tracking and rider offers; real notifications;
receipts; and an in-app "What's new" in every app. Out of scope here: the app-store release,
live updates in the admin app, text-message sender registration, growth and telemetry work, and
the QR seal screens.

## How to read this

| Marker | Meaning |
|---|---|
| **Covered** | An automated test drives this flow, or the part named. |
| **Partly covered** | A test pins part of the flow; the line says which part has no test. |
| **Not covered** | No automated test drives this flow. A person tests it by hand. |

Where the tests run:

- **e2e**: the [end-to-end flows](../../tools/e2e/README.md#the-flows) (Maestro on an Android
  emulator, Playwright in Chromium). Nightly, and on a pull request with the `e2e` or `e2e-full` label.
- **App tests**: each app's own suite (`pnpm -r test`), run by CI on every pull request. They
  render one screen against a mocked API.
- **Go tests**: `services/hg/internal/**/*_test.go`, run by CI on every pull request (`make test`).
- **API journey**: the [API journey runner](../../tools/e2e/api/README.md), run by hand against a
  local or staging API. It drives the whole launch path through the API, with no app screens.

The Playwright scripts in [`tools/verify/`](../../tools/verify/) are drivers a person runs by
hand to take screenshots. They assert little and run in no CI, so they do not count as cover.

### Setting a flow up

Two seeded worlds exist. Use the one the flow names.

| World | How | Who is in it |
|---|---|---|
| **e2e world** | `bash tools/e2e/seed/seed.sh` after `bash tools/e2e/stack/up.sh` ([the world](../../tools/e2e/README.md#the-world)) | Bismillah Grill (certified), Crescent Kitchen (certificate expired), customers Amina and Omar, rider Bilal, one admin |
| **Dev world** | `make dev-reset` in `services/hg` ([personas](../superpowers/specs/2026-09-28-devworld-harness-design.md#5-personas-and-coverage)) | A restaurant at every onboarding step, `bismillah-grill` live, `expiring-halal`, `expired-halal`, `paused`, `suspended`; customers `amina` and `nour`; riders `rider-sim`, `rider-docs`, `rider-rejected`, `rider-registered`; `admin-seed` |

Dev world sign-in: email personas use `<persona>@seed.hg` and the shared persona password; phone
personas use their `+1555010…` number and code `000000`, which only a local or staging API
accepts ([scenario sign-in](../superpowers/specs/2026-09-28-devworld-harness-design.md#64-scenario-sign-in)).
The admin's authenticator code is `make dev-totp`.

Dev world orders come from the API, not from SQL:

- `make dev-scenario s=<name>` puts an order or a decision in a state:
  `new-order`, `rush`, `order-preparing`, `order-ready`, `customer-cancels`,
  `restaurant-rejected`, `docs-approve`, `docs-reject`, `menu-approve`, `menu-reject`
  ([catalogue](../superpowers/specs/2026-09-28-devworld-harness-design.md#61-catalogue)).
- `make dev-journey` drives one live order from checkout to delivered, receipt, rating and refund.
  `auto=restaurant` or `auto=all` lets it play the restaurant or the rider, and `manual=rider`
  leaves the rider to a person ([journey](../superpowers/specs/2026-09-28-devworld-harness-design.md#63-journey)).

## The one order, across all four apps

The spine every other flow hangs off. Customer orders, restaurant accepts and marks ready, rider
receives the offer, picks up and delivers, admin finds the order.

| Part | Test | Status |
|---|---|---|
| Customer signs in, orders; restaurant accepts and marks ready; rider receives the offer | e2e flows 2 to 4 ([the flows](../../tools/e2e/README.md#the-flows)) | **Covered** up to the offer screen |
| Rider accepts, picks up, delivers | [`internal/invariants/smoke_test.go`](../../services/hg/internal/invariants/smoke_test.go) `TestSmoke_QuoteToOrderToDelivered` (server only) | **Partly covered**: no app screen |
| Every step through the API, with a refund at the end | API journey | By hand |

Set up: e2e world, or dev world with `make dev-journey auto=all`.

## Customer app (`apps/customer`)

### 1. Sign in with a phone code

Spec: [customer sign-in by phone code (C-01)](../spec/02-customer.md#c-01--registration--phone-otp-verification),
[phone code sign-in (P-02)](../spec/01-platform.md#p-02--phone-otp-authentication-customers-riders)

1. Open the app, type a phone number, tap **Send code**.
2. Type the code, tap **Verify**.

Expected: the app opens on Discover. A wrong code is refused and nothing behind the gate shows.

Set up: e2e world, Amina; dev world, `amina`.

Tests: **Covered.**
e2e [`native/customer/1-ask-for-code.yaml`](../../tools/e2e/native/customer/1-ask-for-code.yaml) and
[`2-sign-in-and-order.yaml`](../../tools/e2e/native/customer/2-sign-in-and-order.yaml);
[`LoginGate.test.tsx`](../../apps/customer/src/screens/__tests__/LoginGate.test.tsx);
[`internal/auth/store_integration_test.go`](../../services/hg/internal/auth/store_integration_test.go) `TestIntegrationOTPChallengeLifecycle`.
A real text message to a real phone has no test.

### 2. Add a delivery address

Spec: [delivery addresses (C-30)](../spec/02-customer.md#c-30--delivery-address-management),
[address search and map pin (C-31)](../spec/02-customer.md#c-31--address-entry-autocomplete-geocoding-and-map-pin)

1. Profile → Addresses → add one: search the street, check the pin, add unit and buzzer.
2. Save it and make it the default.

Expected: Discover lists the restaurants that deliver to it; the cart and checkout use it.

Set up: dev world, `amina` (three saved addresses already); e2e world, Amina (home seeded).

Tests: **Partly covered.** Server:
[`internal/addresses/integration_test.go`](../../services/hg/internal/addresses/integration_test.go).
App: [`geocode.test.ts`](../../apps/customer/src/api/__tests__/geocode.test.ts) checks only how a
search result maps to the form. **Not covered:** the address screens.

### 3. Find a certified restaurant

Spec: [home feed (C-09)](../spec/02-customer.md#c-09--home-feed),
[halal certification display (C-12)](../spec/02-customer.md#c-12--halal-certification-display-and-verification--critical),
[filters and halal certification (P-34)](../spec/01-platform.md#p-34--filters-and-halal-certification)

1. Open Discover.
2. Open a restaurant's halal badge to read its certification panel: issuing body, certificate
   number, expiry.

Expected: only restaurants with a current certificate are listed. A restaurant whose certificate
expired is not listed at all. No badge is shown when a halal field is missing, and no halal state
is ever red ([a missing halal field shows no badge, and never red for a halal state](../../AGENTS.md#3-non-negotiable-invariants)).

Set up: e2e world, Bismillah Grill and Crescent Kitchen; dev world, `bismillah-grill`,
`expiring-halal`, `expired-halal`.

Tests: **Partly covered.**
e2e customer flow asserts the expired restaurant never shows;
[`DiscoveryScreen.test.tsx`](../../apps/customer/src/screens/__tests__/DiscoveryScreen.test.tsx) (loading, empty, error, cards);
[`internal/catalog/halal_test.go`](../../services/hg/internal/catalog/halal_test.go);
[`internal/orders/orderable_test.go`](../../services/hg/internal/orders/orderable_test.go)
`TestIntegrationOrderRefusesRestaurantItCannotVouchFor`.
**Not covered:** opening the certification panel, and the expiring-soon state on screen.

### 4. Build a cart

Spec: [restaurant page (C-13)](../spec/02-customer.md#c-13--restaurant-detail-page),
[variants and add-ons (C-16)](../spec/02-customer.md#c-16--variant-and-add-on-selection),
[cart (C-19)](../spec/02-customer.md#c-19--cart-management),
[one restaurant per cart (C-20)](../spec/02-customer.md#c-20--single-restaurant-cart-constraint)

1. Open a restaurant, add a dish; pick a variant and add-ons where it has them.
2. Open the cart, change a quantity.
3. Try to add a dish from a second restaurant.

Expected: the **View cart** bar shows the count; the cart shows server prices; adding from a
second restaurant asks "Start a new cart" or "Keep my cart", and never mixes the two.

Set up: e2e world, Bismillah Grill; dev world, `bismillah-grill` (has an item with variants and add-ons).

Tests: **Partly covered.**
e2e customer flow (add a dish, open the cart);
[`RestaurantScreen.test.tsx`](../../apps/customer/src/screens/__tests__/RestaurantScreen.test.tsx);
[`internal/orders/integration_test.go`](../../services/hg/internal/orders/integration_test.go) `TestIntegrationCartQuoteOrderFlow`.
**Not covered:** variants and add-ons on screen, the second-restaurant prompt.

### 5. Check out and pay

Spec: [price breakdown (C-22)](../spec/02-customer.md#c-22--price-breakdown-pricing-authority),
[checkout (C-23)](../spec/02-customer.md#c-23--order-placement-checkout),
[payment and card checks (C-25)](../spec/02-customer.md#c-25--payment-execution-and-3ds),
[authorise, then capture (P-16)](../spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing)

1. From the cart, **Continue to checkout**; read the breakdown (items, fees, tax, tip, total).
2. Pay with a card; **Place order**.

Expected: the order shows its code and "Sent to restaurant". The card is authorised, not charged,
until the restaurant accepts. The server sets every price
([the server prices every order](../../AGENTS.md#3-non-negotiable-invariants)).

Set up: e2e world, Amina; dev world, `amina`, or `make dev-scenario s=new-order`.

Tests: **Partly covered.**
e2e customer flow places the order, paid by the API's fake payment client;
[`CartScreen.test.tsx`](../../apps/customer/src/screens/__tests__/CartScreen.test.tsx) (ordering paused);
[`internal/invariants/price_test.go`](../../services/hg/internal/invariants/price_test.go),
[`capture_test.go`](../../services/hg/internal/invariants/capture_test.go),
[`ledger_test.go`](../../services/hg/internal/invariants/ledger_test.go).
**Not covered:** paying with a Stripe test card in the app
([#63](https://github.com/shaiknoorullah/hg-mono/issues/63)).

### 6. Track the order live

Spec: [live order tracking (C-32)](../spec/02-customer.md#c-32--live-order-tracking),
[delivery guarantees and replay (P-23)](../spec/01-platform.md#p-23--delivery-guarantees-replay-and-multi-replica-fan-out)

1. After placing the order, stay on its screen.
2. Watch it move: accepted, preparing, ready, picked up, arriving, delivered.

Expected: each state shows without a refresh; once picked up, the rider moves on the map. When the
socket drops, the screen polls and says how old the rider's position is.

Set up: dev world, `make dev-journey auto=all`.

Tests: **Partly covered.**
[`trackingFeed.test.ts`](../../apps/customer/src/tracking/__tests__/trackingFeed.test.ts),
[`orderSocket.test.ts`](../../apps/customer/src/realtime/__tests__/orderSocket.test.ts),
[`TrackingMap.test.tsx`](../../apps/customer/src/components/__tests__/TrackingMap.test.tsx);
[`internal/orders/ordersread_test.go`](../../services/hg/internal/orders/ordersread_test.go) (tracking),
[`internal/realtime/delivery_integration_test.go`](../../services/hg/internal/realtime/delivery_integration_test.go),
[`internal/invariants/realtime_test.go`](../../services/hg/internal/invariants/realtime_test.go).
**Not covered:** a live order tracked on a device from start to end
([#28](https://github.com/shaiknoorullah/hg-mono/issues/28)).

### 7. Cancel before the restaurant accepts

Spec: [customer cancellation (C-29)](../spec/02-customer.md#c-29--order-cancellation-by-the-customer),
[refunds and cancellations (P-18)](../spec/01-platform.md#p-18--refunds-cancellations-and-compensation)

1. Place an order; cancel it while it waits for the restaurant.

Expected: the order is cancelled, the card authorisation is voided (no charge), and the order
leaves the restaurant's queue.

Set up: dev world, `make dev-scenario s=customer-cancels`.

Tests: **Partly covered.** Server:
[`internal/orders/integration_test.go`](../../services/hg/internal/orders/integration_test.go) `TestIntegrationCartQuoteOrderFlow` (cancels a new order),
[`internal/orders/realtime_integration_test.go`](../../services/hg/internal/orders/realtime_integration_test.go) (the cancel event).
**Not covered:** the customer app has no cancel button on `main`.

### 8. Order history and receipt

Spec: [order history (C-26)](../spec/02-customer.md#c-26--order-history-and-active-order-resume),
[receipts (C-27)](../spec/02-customer.md#c-27--order-receipts)

1. Open Orders; open a delivered order.
2. Read its receipt.

Expected: an active order resumes tracking; a delivered order shows a receipt whose lines add up
to the total charged, with the tax line.

Set up: dev world, `make dev-journey auto=all` (ends with a delivered order).

Tests: **Partly covered.** Server:
[`internal/orders/ordersread_test.go`](../../services/hg/internal/orders/ordersread_test.go) (receipt tests),
[`ordersread_boundary_test.go`](../../services/hg/internal/orders/ordersread_boundary_test.go).
**Not covered:** the Orders and receipt screens. The receipt snapshot behind the tax line is
[#60](https://github.com/shaiknoorullah/hg-mono/issues/60).

### 9. Get order notifications

Spec: [customer notifications (C-40)](../spec/02-customer.md#c-40--notifications-push-in-app-inbox-and-alerts),
[notification router (P-24)](../spec/01-platform.md#p-24--notification-router-which-event-which-role-which-channel),
[push notifications (P-25)](../spec/01-platform.md#p-25--push-notifications-expo)

1. Place an order and leave the app.
2. Let the order move through accepted, rider assigned, delivered.
3. Open the in-app notifications.

Expected: a push for each change; the same messages in the in-app list.

Set up: dev world, `make dev-journey auto=all`.

Tests: **Partly covered.** Server:
[`internal/notify/notify_test.go`](../../services/hg/internal/notify/notify_test.go),
[`worker_test.go`](../../services/hg/internal/notify/worker_test.go),
[`internal/invariants/notify_atomic_test.go`](../../services/hg/internal/invariants/notify_atomic_test.go).
**Not covered:** a real push reaching a phone
([#58](https://github.com/shaiknoorullah/hg-mono/issues/58)).

### 10. See "What's new"

Spec: [#99](https://github.com/shaiknoorullah/hg-mono/issues/99) (no spec section).

1. Update the app; open it.

Expected: the release notes since the last version this person saw, once.

Tests: **Not covered.** Not built on `main`.

## Restaurant web app (`apps/restaurant`)

### 1. Register and verify the email

Spec: [restaurant signup (R-01)](../spec/03-restaurant.md#r-01--restaurant-account-signup),
[email verification (R-02)](../spec/03-restaurant.md#r-02--email-verification-and-account-activation)

1. Open `/register`; fill business name, email, password; **Create account**.
2. Open the emailed link.

Expected: the email is confirmed and the owner is sent to sign in, then to onboarding.

Set up: dev world, `fresh` (registered, email not yet verified).

Tests: **Partly covered.**
[`verify-email.test.tsx`](../../apps/restaurant/smoke/verify-email.test.tsx); API journey.
**Not covered:** registering through the app. The e2e restaurant journey stops at the form and
expects the "terms version is out of date" error
([`web/restaurant.spec.ts`](../../tools/e2e/web/restaurant.spec.ts), step `02-register-submit-terms-version-bug`).

### 2. Sign in

Spec: [restaurant sign-in (R-03)](../spec/03-restaurant.md#r-03--login-session-and-token-lifecycle),
[email and password sign-in (P-03)](../spec/01-platform.md#p-03--email--password-authentication-restaurants-admins-support)

1. Open `/login`; email and password; the authenticator code when asked.
2. Forgot the password: **Reset**, open the emailed link, set a new one.

Expected: the live order queue opens. A reset sends a link without saying whether the account exists.

Set up: e2e world, the Bismillah Grill owner; dev world, `bismillah-grill` (also its manager and staff).

Tests: **Covered.**
e2e [`web/restaurant.spec.ts`](../../tools/e2e/web/restaurant.spec.ts) (every test signs in);
[`login-gate.test.tsx`](../../apps/restaurant/smoke/login-gate.test.tsx),
[`reset-password.test.tsx`](../../apps/restaurant/smoke/reset-password.test.tsx).

### 3. Onboard: profile, hours, documents

Spec: [onboarding steps (R-04)](../spec/03-restaurant.md#r-04--onboarding-state-machine-and-progress-tracking),
[business profile (R-05)](../spec/03-restaurant.md#r-05--business-profile-submission-onboarding-step-1),
[document upload (R-07)](../spec/03-restaurant.md#r-07--compliance-document-upload),
[document review (R-08)](../spec/03-restaurant.md#r-08--document-pack-submission-and-admin-verification-review),
[verification status (R-09)](../spec/03-restaurant.md#r-09--verification-status-tracking-real-time)

1. Fill the profile (legal name, address, cuisine, preparation time).
2. Upload the business licence, food safety certificate, owner ID and halal certificate; submit.
3. Wait for review; on a rejection, read the reason and upload again.

Expected: each step unlocks the next; an incomplete pack cannot be submitted; the status follows
the admin's decision.

Set up: dev world, `profile`, `docs-todo`, `docs-review`, `docs-rejected`; then
`make dev-scenario s=docs-approve` or `s=docs-reject`. Steps by persona:
[onboarding personas playbook](../playbooks/restaurant/onboarding-personas.md).

Tests: **Partly covered.** Server:
[`internal/restaurant/integration_test.go`](../../services/hg/internal/restaurant/integration_test.go)
(`TestIntegration_SubmitProfile_HappyPath`, `TestIntegration_SubmitDocuments_IncompletePack_422`,
`TestIntegration_MenuItemAndHours_AdvanceOnboarding`); API journey.
**Not covered:** the onboarding screens.

### 4. Set up payouts

Spec: [payout account (R-11)](../spec/03-restaurant.md#r-11--payout-account-add-and-verify-bank-details),
[Stripe Connect (P-19)](../spec/01-platform.md#p-19--stripe-connect-onboarding-and-payouts-canada)

1. Payouts → set up the payout account in Stripe; come back.

Expected: the account reads as ready and onboarding moves to the menu step.

Set up: dev world, `payout`.

Tests: **Partly covered.** e2e restaurant journey opens `/payouts` and reads the schedule
(step `11-payouts-overview`); API journey opens Connect in test mode.
**Not covered:** completing Stripe's setup from the app.

### 5. Build and edit the menu

Spec: [menu and categories (R-14)](../spec/03-restaurant.md#r-14--menu-and-category-management),
[menu items (R-15)](../spec/03-restaurant.md#r-15--menu-item-authoring),
[menu change review (R-17)](../spec/03-restaurant.md#r-17--menu-change-approval-workflow-admin),
[item availability (R-18)](../spec/03-restaurant.md#r-18--item-availability-and-out-of-stock-management);
every save is reviewed ([launch scope and menu editing](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01))

1. Menu → **Add item**: new category, name, price; save.
2. Edit the item's price; save.
3. Mark an item out of stock.

Expected: each save waits for review and the live menu keeps the approved version until then.
Nothing is approved automatically.

Set up: dev world, `menu` (empty menu) or `bismillah-grill` (an item in each review state).

Tests: **Partly covered.**
e2e restaurant journey, steps `04` to `08`;
[`menu-locked.test.tsx`](../../apps/restaurant/smoke/menu-locked.test.tsx) (suspended restaurant);
[`internal/restaurant/integration_test.go`](../../services/hg/internal/restaurant/integration_test.go)
`TestIntegration_CreateMenuItem_HalalGate_NeverAutoApproved`.
**Not covered:** the "waiting for review" state on screen.

### 6. Open, close and set hours

Spec: [operating hours (R-06)](../spec/03-restaurant.md#r-06--operating-hours-holidays-and-temporary-closure),
[accepting-orders toggle (R-22)](../spec/03-restaurant.md#r-22--store-availability-accepting-orders-toggle-and-auto-offline)

1. Hours → turn **Accepting orders** off, then on; change a day's hours.

Expected: while off, customers see the restaurant closed and cannot order.

Set up: dev world, `bismillah-grill`, `paused`.

Tests: **Partly covered.** e2e restaurant journey, steps `09` and `10` (the toggle);
[`internal/restaurant/integration_test.go`](../../services/hg/internal/restaurant/integration_test.go) `TestIntegration_SetHours_HappyPath`.
**Not covered:** that customers then see it closed.

### 7. See new orders arrive live

Spec: [live order dashboard (R-23)](../spec/03-restaurant.md#r-23--live-order-dashboard)

1. Keep the order queue open.
2. A customer orders.

Expected: the card appears without a refresh, with a sound and a 180-second clock.

Set up: dev world, `make dev-scenario s=new-order` or `s=rush` (a busy queue).

Tests: **Partly covered.**
[`order-queue-states.test.tsx`](../../apps/restaurant/smoke/order-queue-states.test.tsx) (loading, empty, error, cards);
[`internal/orders/realtime_integration_test.go`](../../services/hg/internal/orders/realtime_integration_test.go).
**Not covered:** a card arriving live. The e2e test clicks **Refresh** until the order shows
([#27](https://github.com/shaiknoorullah/hg-mono/issues/27)).

### 8. Accept or reject in time

Spec: [accept, reject and timeout (R-24)](../spec/03-restaurant.md#r-24--order-acceptance-rejection-and-response-timeout),
[deadlines and timeouts (P-15)](../spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable)

1. **Accept** a new order within 180 seconds.
2. **Reject** another, with a reason.
3. Leave a third alone.

Expected: accept captures the payment and the order moves to Preparing; reject voids the card
authorisation; the ignored one times out and is voided too
([authorise then capture](../../AGENTS.md#3-non-negotiable-invariants)).

Set up: dev world, `make dev-scenario s=new-order`, and `s=restaurant-rejected`; e2e world, Omar's API order.

Tests: **Partly covered.**
e2e flows 1 and 3 (accept);
[`accept-order.test.tsx`](../../apps/restaurant/smoke/accept-order.test.tsx);
[`internal/restaurant/transition_integration_test.go`](../../services/hg/internal/restaurant/transition_integration_test.go)
(`TestRestaurantSteps_AcceptAndReadyGoThroughTransition`, `TestRestaurantSteps_RejectGoesThroughTransitionAndVoids`),
[`internal/invariants/capture_test.go`](../../services/hg/internal/invariants/capture_test.go),
[`internal/orders/integration_test.go`](../../services/hg/internal/orders/integration_test.go) `TestIntegrationDeadlineRunnerExpiresCreatedOrder`.
**Not covered:** rejecting through the app.

### 9. Mark ready and hand over

Spec: [preparation status (R-25)](../spec/03-restaurant.md#r-25--preparation-status-updates)

1. On a preparing order, **Mark ready for pickup**.
2. Watch the rider approach on the order's map.

Expected: the order is offered to riders; the map shows the rider's rough position and "Rider arrived".

Set up: dev world, `make dev-scenario s=order-preparing`, or `make dev-journey auto=all` for the rider.

Tests: **Partly covered.**
e2e flow 4 (mark ready);
[`rider-approach-map.test.tsx`](../../apps/restaurant/smoke/rider-approach-map.test.tsx).
**Not covered:** a real rider's position reaching the map end to end.

### 10. See "What's new"

Spec: [#101](https://github.com/shaiknoorullah/hg-mono/issues/101) (no spec section).

Tests: **Not covered.** Not built on `main`.

## Rider app (`apps/rider`)

### 1. Sign in with a phone code

Spec: [rider signup (D-01)](../spec/04-rider.md#d-01--rider-signup-phone-entry--otp--account-creation),
[rider sign-in (D-02)](../spec/04-rider.md#d-02--login-session-logout)

1. Open the app, type the phone number, **Send code**; type the code, **Verify**.

Expected: the app opens on "Your shift".

Set up: e2e world, Bilal; dev world, `rider-sim`.

Tests: **Covered.**
e2e [`native/rider/1-ask-for-code.yaml`](../../tools/e2e/native/rider/1-ask-for-code.yaml) and
[`2-go-online-and-get-offer.yaml`](../../tools/e2e/native/rider/2-go-online-and-get-offer.yaml);
[`LoginGate.test.tsx`](../../apps/rider/src/screens/__tests__/LoginGate.test.tsx).

### 2. Onboard: profile, vehicle, documents, payouts

Spec: [profile and age (D-03)](../spec/04-rider.md#d-03--rider-profile--age-verification),
[vehicle (D-04)](../spec/04-rider.md#d-04--vehicle-registration-record),
[documents (D-05)](../spec/04-rider.md#d-05--document-upload-licence-vehicle-registration-insurance-profile-photo),
[verification status (D-06)](../spec/04-rider.md#d-06--verification-status-tracking--notifications),
[payout account (D-08)](../spec/04-rider.md#d-08--payout-account-onboarding-stripe-connect)

1. Enter name and date of birth; pick a vehicle.
2. Upload licence, insurance and photo as the vehicle needs; submit.
3. Set up payouts in Stripe; wait for approval.

Expected: an under-age rider is refused; after an admin approves, the rider can go online.

Set up: dev world, `rider-registered` (new), `rider-docs` (waiting for review), `rider-rejected`.

Tests: **Partly covered.** Server:
[`internal/rider/rider_test.go`](../../services/hg/internal/rider/rider_test.go)
(`TestSubmitRiderProfile_Underage`, `TestSubmitRiderDocuments_Happy_BICYCLE`);
[`internal/dispatch/rider_activation_integration_test.go`](../../services/hg/internal/dispatch/rider_activation_integration_test.go); API journey.
**Not covered:** the onboarding screens.

### 3. Go online

Spec: [online and offline (D-10)](../spec/04-rider.md#d-10--availability-online--offline),
[location while idle (D-11)](../spec/04-rider.md#d-11--foreground-location-streaming-idle)

1. Availability → turn the switch on; allow location.

Expected: "You're online"; the position is sent every 20 seconds while idle, every 5 seconds on a delivery.

Set up: e2e world, Bilal; dev world, `rider-sim`.

Tests: **Covered.**
e2e rider flow;
[`AvailabilityScreen.test.tsx`](../../apps/rider/src/screens/__tests__/AvailabilityScreen.test.tsx),
[`location.test.tsx`](../../apps/rider/src/__tests__/location.test.tsx).

### 4. Receive an offer and accept it

Spec: [receiving an offer (D-14)](../spec/04-rider.md#d-14--receiving-an-offer-on-the-device),
[offer expiry and the next wave (D-15)](../spec/04-rider.md#d-15--offer-expiry-wave-escalation-and-the-no-rider-found-path),
[accepting an offer (D-16)](../spec/04-rider.md#d-16--accepting-an-offer-single-winner-concurrency)

1. Stay online near the restaurant while it marks an order ready.
2. The offer appears with pay, distance and a countdown; **Accept offer**.

Expected: the offer arrives by push without a tap; one rider wins it; a missed offer goes to the
next rider.

Set up: e2e world, Bilal with the cross-app order; dev world, `make dev-journey manual=rider`.

Tests: **Partly covered.**
e2e rider flow reaches the offer screen (it taps **Check again** until the offer shows; it does not accept);
[`OfferScreen.test.tsx`](../../apps/rider/src/screens/__tests__/OfferScreen.test.tsx) (loading, empty, error);
[`internal/dispatch/integration_test.go`](../../services/hg/internal/dispatch/integration_test.go) `TestAcceptIsRaceFree`,
[`lifecycle_test.go`](../../services/hg/internal/dispatch/lifecycle_test.go) `TestRunWaveCreatesOffersForReadyOrder`,
[`escalation_integration_test.go`](../../services/hg/internal/dispatch/escalation_integration_test.go).
**Not covered:** the offer arriving by push, and accepting it in the app
([#29](https://github.com/shaiknoorullah/hg-mono/issues/29)).

### 5. Pick up and deliver

Spec: [delivery status updates (D-20)](../spec/04-rider.md#d-20--delivery-status-updates-arrived--picked-up--in-transit--delivered),
[proof of delivery (D-21)](../spec/04-rider.md#d-21--proof-of-delivery),
[navigation (D-22)](../spec/04-rider.md#d-22--navigation--maps)

1. Navigate to the restaurant; **Arrived**; **Picked up**.
2. Navigate to the customer; **Arrived**; take the proof-of-delivery photo; **Delivered**.

Expected: each step moves the customer's tracking; the order completes and pay is recorded.

Set up: dev world, `make dev-journey manual=rider`.

Tests: **Partly covered.** Server:
[`internal/dispatch/lifecycle_real_test.go`](../../services/hg/internal/dispatch/lifecycle_real_test.go),
[`pod_photo_owner_test.go`](../../services/hg/internal/dispatch/pod_photo_owner_test.go),
[`internal/invariants/smoke_test.go`](../../services/hg/internal/invariants/smoke_test.go);
[`DeliveryMap.test.tsx`](../../apps/rider/src/map/__tests__/DeliveryMap.test.tsx),
[`navigate.test.ts`](../../apps/rider/src/__tests__/navigate.test.ts); API journey.
**Not covered:** the delivery screens. Known bug: the delivery-code check always fails
([#259](https://github.com/shaiknoorullah/hg-mono/issues/259)).

### 6. See earnings

Spec: [earnings per delivery (D-26)](../spec/04-rider.md#d-26--earnings-formula-and-per-delivery-ledger),
[earnings dashboard (D-27)](../spec/04-rider.md#d-27--earnings-dashboard-daily--weekly--monthly)

1. After a delivery, open Earnings.

Expected: the delivery's pay and tip, and today's total.

Set up: dev world, `rider-sim` after `make dev-journey auto=all`.

Tests: **Partly covered.** Server:
[`internal/payments/rider_earnings_integration_test.go`](../../services/hg/internal/payments/rider_earnings_integration_test.go),
[`internal/rider/rider_test.go`](../../services/hg/internal/rider/rider_test.go) `TestGetRiderDashboard_ReportsTodaysEarnings`.
**Not covered:** the Earnings screen.

### 7. See "What's new"

Spec: [#100](https://github.com/shaiknoorullah/hg-mono/issues/100) (no spec section).

Tests: **Not covered.** Not built on `main`.

## Admin web app (`apps/admin`)

### 1. Sign in with an authenticator

Spec: [staff sign-in and two-step codes (A-03)](../spec/05-admin.md#a-03--staff-authentication-mfa-and-session-policy),
[staff accounts (A-01)](../spec/05-admin.md#a-01--staff-account-provisioning)

1. A new staff member opens the invite link and sets a password.
2. Sign in: email, password, the six-digit authenticator code.
3. Sign out.

Expected: nothing behind the gate shows before sign-in or after sign-out.

Set up: e2e world, the admin; dev world, `admin-seed@seed.hg` with `make dev-totp`, or `make dev-admin`.

Tests: **Covered.**
e2e [`web/admin.spec.ts`](../../tools/e2e/web/admin.spec.ts), steps `01` to `03`, `10` and `11`;
[`login-gate.test.tsx`](../../apps/admin/smoke/login-gate.test.tsx),
[`accept-invite.test.tsx`](../../apps/admin/smoke/accept-invite.test.tsx);
[`internal/auth/handlers_totp_test.go`](../../services/hg/internal/auth/handlers_totp_test.go).

### 2. Review a restaurant's documents

Spec: [onboarding review queue (A-13)](../spec/05-admin.md#a-13--restaurant-onboarding-review-queue),
[document review (A-14)](../spec/05-admin.md#a-14--kyc-document-review-non-halal-documents)

1. Open the queue; open an application.
2. Open each document; approve it, or reject it with a reason.

Expected: the restaurant sees the decision and, on a rejection, the reason.

Set up: dev world, `docs-review`; `make dev-scenario s=docs-approve` shows the result.

Tests: **Partly covered.**
[`smoke.test.tsx`](../../apps/admin/smoke/smoke.test.tsx) (the queue renders);
[`internal/admin/decision_test.go`](../../services/hg/internal/admin/decision_test.go) `TestDecideRestaurantApplication`; API journey.
**Not covered:** deciding a document through the app.

### 3. Verify a halal certificate

Spec: [halal certification verification (A-15)](../spec/05-admin.md#a-15--halal-certification-verification--core-product-function),
[issuing bodies (A-16)](../spec/05-admin.md#a-16--halal-issuing-body-registry)

1. From the application, open the halal certificate.
2. Transcribe it; work through the seven checks.
3. Approve once all seven pass, or reject.

Expected: approve stays unavailable until all seven checks pass; a duplicate certificate fails its check.

Set up: dev world, `docs-review`; e2e world, both restaurants' certificates.

Tests: **Partly covered.**
e2e admin steps `04` and `05` open the verification screen for a current and an expired certificate;
[`halal-decision-bar.test.tsx`](../../apps/admin/smoke/halal-decision-bar.test.tsx);
[`internal/admin/integration_test.go`](../../services/hg/internal/admin/integration_test.go)
(`TestHalalApprovalRequiresSevenChecks`, `TestHalalDuplicateFailsH7`),
[`internal/admin/halal_test.go`](../../services/hg/internal/admin/halal_test.go).
**Not covered:** running the checks and approving through the app.

### 4. Approve a restaurant to go live

Spec: [approve or reject a restaurant (A-18)](../spec/05-admin.md#a-18--restaurant-approval--rejection-decision)

1. With documents and certificate approved, approve the application.

Expected: once its payouts, menu and hours are set, the restaurant goes live and customers see it.

Set up: dev world, `docs-review` then `payout` and `menu`.

Tests: **Partly covered.** Server:
[`internal/admin/decision_test.go`](../../services/hg/internal/admin/decision_test.go),
[`internal/restaurant/onboarding_state_integration_test.go`](../../services/hg/internal/restaurant/onboarding_state_integration_test.go) `TestRecomputeOnboarding_GoLive`; API journey.
**Not covered:** through the app.

### 5. Approve a rider

Spec: [rider review and approval (A-23)](../spec/05-admin.md#a-23--rider-onboarding-review-and-approval)

1. Riders → open an application; check documents; approve or reject.

Expected: an approved rider can go online.

Set up: dev world, `rider-docs`.

Tests: **Partly covered.** Server:
[`internal/admin/decision_test.go`](../../services/hg/internal/admin/decision_test.go) `TestDecideRiderApplication`,
[`internal/dispatch/rider_activation_integration_test.go`](../../services/hg/internal/dispatch/rider_activation_integration_test.go); API journey.
**Not covered:** through the app.

### 6. Review menu changes

Spec: [menu approval queue (A-19)](../spec/05-admin.md#a-19--menu-approval-queue)

1. Open the menu review queue; approve one change; reject one with a reason.

Expected: an approved change goes live; a rejected one shows its reason to the restaurant.

Set up: dev world, `bismillah-grill` (a pending item); `make dev-scenario s=menu-approve` or `s=menu-reject`.

Tests: **Partly covered.** Server:
[`internal/admin/handler_menu_test.go`](../../services/hg/internal/admin/handler_menu_test.go) (`TestListMenuReviewQueue_*`),
[`menu_edit_test.go`](../../services/hg/internal/admin/menu_edit_test.go); API journey approves the menu.
**Not covered:** the admin app has no menu review screen on `main`.

### 7. Find an order

Spec: [order lookup (A-38)](../spec/05-admin.md#a-38--order-lookup-and-admin-order-intervention)

1. Orders → search by order code; open it.

Expected: its timeline, the money breakdown, the restaurant, rider and customer.

Set up: e2e world (the admin test places one through the API); dev world, any scenario order.

Tests: **Covered.**
e2e admin steps `06` and `07`;
[`internal/admin/handler_orders_test.go`](../../services/hg/internal/admin/handler_orders_test.go).

### 8. Cancel an order or refund it

Spec: [refunds and limits (A-33)](../spec/05-admin.md#a-33--refund-issuance-and-authority-limits),
[order intervention (A-38)](../spec/05-admin.md#a-38--order-lookup-and-admin-order-intervention)

1. From an order, cancel it with a reason; or issue a full or partial refund.
2. A support agent's refund over their limit waits for an admin.

Expected: the money is returned and the ledger still sums to zero; a refund cannot exceed what was
captured; nobody approves their own request.

Set up: dev world, `make dev-journey auto=all` (ends with a refund request).

Tests: **Partly covered.**
e2e admin step `08` opens Refunds and disputes;
[`internal/payments/admin_refund_integration_test.go`](../../services/hg/internal/payments/admin_refund_integration_test.go),
[`refund_review_integration_test.go`](../../services/hg/internal/payments/refund_review_integration_test.go),
[`internal/admin/handler_orders_test.go`](../../services/hg/internal/admin/handler_orders_test.go) (`TestCancelOrderAdmin_*`).
**Not covered:** cancelling or refunding through the app.

### 9. See "What's new"

Spec: [#102](https://github.com/shaiknoorullah/hg-mono/issues/102) (no spec section).

Tests: **Not covered.** Not built on `main`.

## Sources

[Spec overview](../spec/00-overview.md), [feature matrix](../reports/feature-matrix.json),
[v0 launch checklist](../planning/v0-launch-checklist.md), [end-to-end flows](../../tools/e2e/README.md),
[dev world harness design](../superpowers/specs/2026-09-28-devworld-harness-design.md).
