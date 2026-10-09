---
covers:
  - services/hg/cmd/devworld/**
  - services/hg/internal/devworld/**
  - services/hg/migrations/devworld/**
  - docs/playbooks/**
reviewed: 2026-10-09
---

# Dev world coverage map

For every journey in the four apps and every feature in the [specification](spec/00-overview.md), this page says whether a developer can reproduce it on a laptop with the [dev world](superpowers/specs/2026-09-28-devworld-harness-design.md), and how. Each gap that can be built locally has its own issue, labelled `harness`.

Checked against `main` on 9 October 2026. Two open pull requests change what is covered: PR [#622](https://github.com/shaiknoorullah/hg-mono/pull/622) adds the `onboard-admin` scenario, and PR [#654](https://github.com/shaiknoorullah/hg-mono/pull/654) dates the persona certificates from Toronto's day. Their rows say "in PR".

## How to read it

Commands run from `services/hg`, against a local stack (`make up`, `make migrate`, `make run`) after `make dev-reset`.

- **Scenario**: `make dev-scenario s=<name>`; `go run ./cmd/devworld scenario list` prints the names. A scenario signs in as personas and calls the API; it writes no row.
- **Journey**: `make dev-journey`, one live order (`route=`, `speed=`, `auto=none|restaurant|all`, `manual=rider`). See the [journey](superpowers/specs/2026-09-28-devworld-harness-design.md#63-journey).
- **Persona**: a seeded account in a fixed state, from `services/hg/migrations/devworld/001_personas.sql` and the [Toronto catalogue](superpowers/specs/2026-09-28-devworld-harness-design.md#51a-toronto-catalogue). `go run ./cmd/devworld list` prints them.
- **Playbook**: the manual steps in [`docs/playbooks`](playbooks/README.md).

| Status | Meaning |
|---|---|
| Covered | Reproducible today with the command or login given. "Wait" means real time passes; nothing forges a deadline. |
| Partial | Some of the journey's states are reproducible; the gap issue covers the rest. |
| Missing | Not reproducible. Either a dev world gap (it has an issue) or no operation in the API yet (the product issue is linked, or none exists). |
| Not in V1 | The spec marks it V2 or V3, or the [release 1.0 scope](https://github.com/shaiknoorullah/hg-mono/issues/103) moved it after launch. |
| Blocked by external | Needs an outside service the dev world cannot stand in for. Not filed as a dev world issue. |

### Logins

| Persona | Signs in as | Where |
|---|---|---|
| `amina`, `nour` | `+15550100101`, `+15550100102`, code `000000` | customer app |
| `rider-sim`, `rider-docs`, `rider-rejected`, `rider-registered` | `+15550100151` to `+15550100154`, code `000000` | rider app |
| Restaurant personas and catalogue owners | `<slug>@seed.hg`, password `Seed!2026` | restaurant console, `http://localhost:5183` |
| `admin-seed` | `admin-seed@seed.hg`, `Seed!2026`, and the code from `make dev-totp` | admin console |
| `support-seed` | cannot sign in yet ([#677](https://github.com/shaiknoorullah/hg-mono/issues/677)) | admin console |

The fixed code works only for `+15550100100` to `+15550100199` and only when `HG_ENV` is `local` or `staging` ([scenario sign-in](superpowers/specs/2026-09-28-devworld-harness-design.md#64-scenario-sign-in)). The admin code needs `HG_APP_DATA_KEY` set before `make dev-reset`.

## Summary

| Table | Covered | Partial | Missing | Not in V1 | Blocked by external |
|---|---:|---:|---:|---:|---:|
| Customer app | 16 | 7 | 0 | 13 | 4 |
| Restaurant portal | 21 | 7 | 3 | 5 | 0 |
| Rider app | 21 | 6 | 4 | 1 | 3 |
| Admin console | 6 | 9 | 12 | 15 | 0 |
| Platform | 26 | 10 | 0 | 0 | 3 |

## Customer app

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [C-01](spec/02-customer.md#c-01--registration--phone-otp-verification) | Sign up with a new phone number and a code | Customer app: an unused number from `+15550100100` to `+15550100159`, code `000000`; the profile step follows | Covered | — |
| [C-02](spec/02-customer.md#c-02--login-logout-session-lifecycle) | Sign in, stay signed in, sign out | `amina` | Covered | — |
| [C-03](spec/02-customer.md#c-03--profile-management-personal-information) | Edit name and email | `amina` (Amina Rahman) | Covered | — |
| [C-04](spec/02-customer.md#c-04--preferences) | Preferences | — | Not in V1 | — |
| [C-05](spec/02-customer.md#c-05--account-deletion) | Delete my account | No operation yet | Not in V1 | [#187](https://github.com/shaiknoorullah/hg-mono/issues/187) |
| [C-06](spec/02-customer.md#c-06--help-centre--faq) | Help centre and FAQ | No operation yet; support is a phone line | Not in V1 | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [C-07](spec/02-customer.md#c-07--call-support) | Call support | Any customer; the number comes from the public config | Covered | — |
| [C-08](spec/02-customer.md#c-08--customer-support-message-thread-live-chat) | Message support | — | Not in V1 | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [C-09](spec/02-customer.md#c-09--home-feed) | Home feed | `amina` after `make dev-reset`: the 14 restaurants of the [Toronto catalogue](superpowers/specs/2026-09-28-devworld-harness-design.md#51a-toronto-catalogue) | Covered | — |
| [C-10](spec/02-customer.md#c-10--search-restaurants-and-dishes) | Search restaurants and dishes | `amina`, the Toronto catalogue | Covered | — |
| [C-11](spec/02-customer.md#c-11--filters-and-sort-advanced-filters) | Advanced filters and sort | — | Not in V1 | — |
| [C-12](spec/02-customer.md#c-12--halal-certification-display-and-verification--critical) | See the halal badge and the certification panel | `amina`: Bismillah Grill is certified, Bamyan Kebab House (`expiring-halal`) is expiring; `expired-halal` and the onboarding restaurants are never listed. The certificate file does not open | Partial | [#686](https://github.com/shaiknoorullah/hg-mono/issues/686) |
| [C-13](spec/02-customer.md#c-13--restaurant-detail-page) | Restaurant page | `amina`, any catalogue restaurant | Covered | — |
| [C-14](spec/02-customer.md#c-14--restaurant-availability--serviceability-gating) | Closed, paused or out-of-range restaurant | `amina`: Galata Pide & Grill (`paused`), `padma-river-kitchen` (no hours on the reset day), the ordering pause in the admin console. No saved address is out of range | Partial | [#681](https://github.com/shaiknoorullah/hg-mono/issues/681) |
| [C-15](spec/02-customer.md#c-15--food-item-detail) | Dish detail | `amina`, any catalogue dish | Covered | — |
| [C-16](spec/02-customer.md#c-16--variant-and-add-on-selection) | Choose a size and add-ons | `amina`: catalogue dishes with a size group, required and optional add-ons, and sold-out options | Covered | — |
| [C-17](spec/02-customer.md#c-17--favourite-restaurants) | Favourite restaurants | — | Not in V1 | — |
| [C-18](spec/02-customer.md#c-18--reviews-and-ratings-display-read-side) | Read reviews and ratings | — | Not in V1 | — |
| [C-19](spec/02-customer.md#c-19--cart-management) | Cart | `amina` | Covered | — |
| [C-20](spec/02-customer.md#c-20--single-restaurant-cart-constraint) | One restaurant per cart | `amina`: add dishes from two restaurants | Covered | — |
| [C-21](spec/02-customer.md#c-21--coupons-promo-codes-and-discounts) | Promo codes | — | Not in V1 | — |
| [C-22](spec/02-customer.md#c-22--price-breakdown-pricing-authority) | Price breakdown from the server | `amina` at checkout | Covered | — |
| [C-23](spec/02-customer.md#c-23--order-placement-checkout) | Place an order | `amina` at checkout, or `make dev-scenario s=new-order`. With no `HG_STRIPE_SECRET_KEY` the local fake gateway authorises at once | Covered | — |
| [C-24](spec/02-customer.md#c-24--payment-methods) | Saved cards | Stripe test keys and the [card payments playbook](playbooks/customer/card-payments.md) | Blocked by external (Stripe test keys) | — |
| [C-25](spec/02-customer.md#c-25--payment-execution-and-3ds) | Pay, a declined card, 3-D Secure | Paying works on the fake gateway. A decline or a challenge needs Stripe test keys and the [card payments playbook](playbooks/customer/card-payments.md) | Partial | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [C-26](spec/02-customer.md#c-26--order-history-and-active-order-resume) | Order history, and resume an active order | Run `s=customer-cancels`, `s=restaurant-rejected` and `make dev-journey auto=all speed=max` in turn; resume: `s=order-preparing`, then reopen the app | Partial | [#682](https://github.com/shaiknoorullah/hg-mono/issues/682) |
| [C-27](spec/02-customer.md#c-27--order-receipts) | Receipt | `amina` after `make dev-journey auto=all speed=max` (the journey reads it) | Covered | — |
| [C-28](spec/02-customer.md#c-28--reorder) | Reorder | — | Not in V1 | [#187](https://github.com/shaiknoorullah/hg-mono/issues/187) |
| [C-29](spec/02-customer.md#c-29--order-cancellation-by-the-customer) | Cancel before the restaurant accepts | `make dev-scenario s=customer-cancels`, or cancel in the app after `s=new-order` | Covered | — |
| [C-30](spec/02-customer.md#c-30--delivery-address-management) | Saved delivery addresses | `amina` has one (Home); `nour` has none until a scenario adds one | Partial | [#681](https://github.com/shaiknoorullah/hg-mono/issues/681) |
| [C-31](spec/02-customer.md#c-31--address-entry-autocomplete-geocoding-and-map-pin) | Address search and map pin | Needs a Mapbox token; without one, type the address | Blocked by external (Mapbox token) | [#57](https://github.com/shaiknoorullah/hg-mono/issues/57) |
| [C-32](spec/02-customer.md#c-32--live-order-tracking) | Live tracking | `amina` in the app during `make dev-journey auto=all speed=1x` | Covered | — |
| [C-33](spec/02-customer.md#c-33--delivery-instructions) | Delivery instructions | None seeded; type them at checkout | Partial | [#681](https://github.com/shaiknoorullah/hg-mono/issues/681) |
| [C-34](spec/02-customer.md#c-34--contacting-the-rider) | Call or message the rider | Masked calling goes through Twilio | Blocked by external (Twilio) | [#181](https://github.com/shaiknoorullah/hg-mono/issues/181) |
| [C-35](spec/02-customer.md#c-35--contacting-the-restaurant) | Contact the restaurant | — | Not in V1 | — |
| [C-36](spec/02-customer.md#c-36--tipping-the-rider) | Tip the rider | — | Not in V1 | — |
| [C-37](spec/02-customer.md#c-37--refund-requests-and-refund-tracking) | Ask for a refund and follow it | The journey ends with a full refund request; no staff decision follows | Partial | [#679](https://github.com/shaiknoorullah/hg-mono/issues/679) |
| [C-38](spec/02-customer.md#c-38--reviews-and-ratings-submission-restaurant-food-rider) | Rate the food and the rider | The journey submits both ratings | Not in V1 | [#185](https://github.com/shaiknoorullah/hg-mono/issues/185) |
| [C-39](spec/02-customer.md#c-39--grievances-and-dispute-escalation) | Grievances and disputes | — | Not in V1 | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [C-40](spec/02-customer.md#c-40--notifications-push-in-app-inbox-and-alerts) | Notifications | In-app rows are written during the journey; emails go to the API log; push needs a device and Expo | Blocked by external (push) | [#58](https://github.com/shaiknoorullah/hg-mono/issues/58) |

## Restaurant portal

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [R-01](spec/03-restaurant.md#r-01--restaurant-account-signup) | Sign up | `make dev-scenario s=onboard-restaurant`, or sign up in the console and open the link from the API log | Covered | — |
| [R-02](spec/03-restaurant.md#r-02--email-verification-and-account-activation) | Confirm the email | `fresh` (email not confirmed); ask for a new link and open it from the API log | Covered | — |
| [R-03](spec/03-restaurant.md#r-03--login-session-and-token-lifecycle) | Sign in, sessions, password reset | Any owner, e.g. `bismillah-grill`; the reset link is in the API log | Covered | — |
| [R-04](spec/03-restaurant.md#r-04--onboarding-state-machine-and-progress-tracking) | Onboarding progress | One persona per step: `fresh`, `profile`, `docs-todo`, `docs-review`, `docs-rejected`, `payout`, `menu`, `bismillah-grill`. [Playbook](playbooks/restaurant/onboarding-personas.md) | Covered | — |
| [R-05](spec/03-restaurant.md#r-05--business-profile-submission-onboarding-step-1) | Business profile | `profile` | Covered | — |
| [R-06](spec/03-restaurant.md#r-06--operating-hours-holidays-and-temporary-closure) | Hours, holidays, temporary closure | Weekly hours: `bismillah-grill`; pause: `paused`. No holiday or late-opening override is seeded | Partial | [#683](https://github.com/shaiknoorullah/hg-mono/issues/683) |
| [R-07](spec/03-restaurant.md#r-07--compliance-document-upload) | Upload documents | `docs-todo` | Covered | — |
| [R-08](spec/03-restaurant.md#r-08--document-pack-submission-and-admin-verification-review) | Submit the pack; admin reviews it | `docs-review`, then `make dev-scenario s=docs-approve` or `s=docs-reject` | Covered | — |
| [R-09](spec/03-restaurant.md#r-09--verification-status-tracking-real-time) | Follow the review as it happens | The personas show each state; a decision does not arrive live | Partial | [#376](https://github.com/shaiknoorullah/hg-mono/issues/376) |
| [R-10](spec/03-restaurant.md#r-10--document-expiry-renewal-and-compliance-suspension) | Certificate expiry and renewal | `expiring-halal` and `expired-halal` are seeded in their states; nothing lapses or renews while you watch | Partial | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) |
| [R-11](spec/03-restaurant.md#r-11--payout-account-add-and-verify-bank-details) | Payout account | `payout`. The fake gateway makes it ready at once; with a test key Stripe hosts the step ([Stripe test mode](playbooks/restaurant/onboarding.md#stripe-test-mode)) | Covered | — |
| [R-12](spec/03-restaurant.md#r-12--profile-management-after-activation) | Edit the profile once live | `bismillah-grill` | Covered | — |
| [R-13](spec/03-restaurant.md#r-13--restaurant-imagery-logo-cover-gallery) | Logo and cover pictures | Catalogue restaurants have them; upload one as `bismillah-grill` | Covered | — |
| [R-14](spec/03-restaurant.md#r-14--menu-and-category-management) | Menu and categories | `bismillah-grill`. [Playbook](playbooks/restaurant/menu-review.md) | Covered | — |
| [R-15](spec/03-restaurant.md#r-15--menu-item-authoring) | Write a dish | `bismillah-grill` | Covered | — |
| [R-16](spec/03-restaurant.md#r-16--menu-item-images) | Dish photos | Catalogue photos; upload one as `bismillah-grill` | Covered | — |
| [R-17](spec/03-restaurant.md#r-17--menu-change-approval-workflow-admin) | Menu changes wait for review | `menu`, then `make dev-scenario s=menu-approve` or `s=menu-reject` (two per reset) | Covered | — |
| [R-18](spec/03-restaurant.md#r-18--item-availability-and-out-of-stock-management) | Mark a dish out of stock | Catalogue dishes already out of stock; toggle one as `bismillah-grill` | Covered | — |
| [R-19](spec/03-restaurant.md#r-19--out-of-stock-interaction-with-active-carts-and-checkout) | Out of stock while in a cart | `amina` adds Chicken Karahi; `bismillah-grill` marks it out of stock; the quote is refused | Covered | — |
| [R-20](spec/03-restaurant.md#r-20--variants-and-modifier-groups) | Sizes and add-on groups | The catalogue has them | Not in V1 | — |
| [R-21](spec/03-restaurant.md#r-21--special-offers-discounts-and-combos) | Offers and combos | — | Not in V1 | — |
| [R-22](spec/03-restaurant.md#r-22--store-availability-accepting-orders-toggle-and-auto-offline) | Accepting-orders switch and going offline on its own | Switch: `bismillah-grill`. Going offline: start the API with `HG_DEVWORLD_TABLETS=off`, close the console and wait five minutes | Covered | — |
| [R-23](spec/03-restaurant.md#r-23--live-order-dashboard) | Live orders | `make dev-scenario s=new-order` or `s=rush`, or `make dev-journey`. [Playbook](playbooks/restaurant/journey.md) | Covered | — |
| [R-24](spec/03-restaurant.md#r-24--order-acceptance-rejection-and-response-timeout) | Accept, reject, or let it time out | `s=new-order`, then **Accept** or **Reject**, or wait 180 seconds | Covered | — |
| [R-25](spec/03-restaurant.md#r-25--preparation-status-updates) | Preparing, then ready | `s=order-preparing`, `s=order-ready` | Covered | — |
| [R-26](spec/03-restaurant.md#r-26--delay-handling-and-rider-communication) | Report a delay | `s=order-preparing`, then report a delay | Covered | — |
| [R-27](spec/03-restaurant.md#r-27--order-history-search-and-export) | Order history | Only the orders made since the reset; the list ignores its state filter ([#601](https://github.com/shaiknoorullah/hg-mono/issues/601)) | Partial | [#682](https://github.com/shaiknoorullah/hg-mono/issues/682) |
| [R-28](spec/03-restaurant.md#r-28--restaurant-initiated-cancellation-after-acceptance) | Cancel after accepting | No operation yet | Missing | — |
| [R-29](spec/03-restaurant.md#r-29--sales-dashboard-and-analytics) | Sales dashboard | — | Not in V1 | [#146](https://github.com/shaiknoorullah/hg-mono/issues/146) |
| [R-30](spec/03-restaurant.md#r-30--performance-reports) | Performance reports | — | Not in V1 | — |
| [R-31](spec/03-restaurant.md#r-31--earnings-ledger-statements-and-payment-history) | Earnings ledger | No operation yet; only the payouts list | Missing | [#147](https://github.com/shaiknoorullah/hg-mono/issues/147) |
| [R-32](spec/03-restaurant.md#r-32--payout-schedule-preferences-and-payout-requests) | Weekly payouts | `payout` and new restaurants show the empty state; no history until a payout run | Missing | [#676](https://github.com/shaiknoorullah/hg-mono/issues/676) |
| [R-33](spec/03-restaurant.md#r-33--escalations-and-disputes) | Escalations and disputes | — | Not in V1 | — |
| [R-34](spec/03-restaurant.md#r-34--notifications-and-alerts) | Notifications | In-app rows and emails in the API log; the inbox comes after launch | Partial | [#185](https://github.com/shaiknoorullah/hg-mono/issues/185) |
| [R-35](spec/03-restaurant.md#r-35--support-and-help) | Support and help | Phone line from the public config; tickets come after launch | Partial | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [R-36](spec/03-restaurant.md#r-36--account-status-suspension-reinstatement-and-in-flight-orders) | Suspended, and back again | `suspended` shows a suspended restaurant; no operation suspends or reinstates | Partial | [#253](https://github.com/shaiknoorullah/hg-mono/issues/253) |

## Rider app

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [D-01](spec/04-rider.md#d-01--rider-signup-phone-entry--otp--account-creation) | Sign up with a phone number | Rider app: an unused number from `+15550100160` to `+15550100199`, code `000000`; or `make dev-scenario s=onboard-rider`. [Playbook](playbooks/rider/onboarding.md) | Covered | — |
| [D-02](spec/04-rider.md#d-02--login-session-logout) | Sign in and out | `rider-sim` | Covered | — |
| [D-03](spec/04-rider.md#d-03--rider-profile--age-verification) | Profile and age check | `rider-registered` | Covered | — |
| [D-04](spec/04-rider.md#d-04--vehicle-registration-record) | Vehicle | `rider-registered`, or `s=onboard-rider` (bicycle) | Covered | — |
| [D-05](spec/04-rider.md#d-05--document-upload-licence-vehicle-registration-insurance-profile-photo) | Upload documents | `rider-registered` | Covered | — |
| [D-06](spec/04-rider.md#d-06--verification-status-tracking--notifications) | Follow the review | `rider-docs` (in review), `rider-rejected` | Covered | — |
| [D-07](spec/04-rider.md#d-07--re-verification-request--document-resubmission) | Resubmit a rejected document | `rider-rejected` | Covered | — |
| [D-08](spec/04-rider.md#d-08--payout-account-onboarding-stripe-connect) | Payout account | `s=onboard-rider`; the fake gateway makes it ready at once | Covered | — |
| [D-09](spec/04-rider.md#d-09--profile-management-personal-info-photo-documents-settings) | Edit the profile | `rider-sim` | Covered | — |
| [D-10](spec/04-rider.md#d-10--availability-online--offline) | Go online and offline | `rider-sim` | Covered | — |
| [D-11](spec/04-rider.md#d-11--foreground-location-streaming-idle) | Share location while idle | The journey posts positions as `rider-sim`; a person in the web app reports one fixed position | Partial | [#25](https://github.com/shaiknoorullah/hg-mono/issues/25) |
| [D-12](spec/04-rider.md#d-12--background-location-during-an-active-delivery) | Location in the background while delivering | Needs a device build; the web app cannot | Partial | [#25](https://github.com/shaiknoorullah/hg-mono/issues/25) |
| [D-13](spec/04-rider.md#d-13--dispatch-candidate-selection-ranking-and-offer-waves) | Dispatch picks a rider | `make dev-journey auto=all` | Covered | — |
| [D-14](spec/04-rider.md#d-14--receiving-an-offer-on-the-device) | Receive an offer | `rider-sim` in the app during `make dev-journey auto=all manual=rider`; push needs Expo | Covered | — |
| [D-15](spec/04-rider.md#d-15--offer-expiry-wave-escalation-and-the-no-rider-found-path) | An offer expires; nobody takes the order | Not produced | Missing | [#684](https://github.com/shaiknoorullah/hg-mono/issues/684) |
| [D-16](spec/04-rider.md#d-16--accepting-an-offer-single-winner-concurrency) | Two riders accept; one wins | Only one active rider | Missing | [#684](https://github.com/shaiknoorullah/hg-mono/issues/684) |
| [D-17](spec/04-rider.md#d-17--rejecting-or-ignoring-an-offer) | Reject or ignore an offer | Reject in the app after `manual=rider`; no second rider gets it | Partial | [#684](https://github.com/shaiknoorullah/hg-mono/issues/684) |
| [D-18](spec/04-rider.md#d-18--order-dashboard-active-work--resume) | Active delivery screen | `rider-sim` during `make dev-journey auto=all manual=rider` | Covered | — |
| [D-19](spec/04-rider.md#d-19--order-details) | Order details | As above | Covered | — |
| [D-20](spec/04-rider.md#d-20--delivery-status-updates-arrived--picked-up--in-transit--delivered) | Arrived, picked up, delivered | `make dev-journey auto=all`, or by hand with `manual=rider` | Covered | — |
| [D-21](spec/04-rider.md#d-21--proof-of-delivery) | Proof of delivery | The journey uploads a photo; the delivery code check fails ([#259](https://github.com/shaiknoorullah/hg-mono/issues/259)) | Covered | — |
| [D-22](spec/04-rider.md#d-22--navigation--maps) | Navigation and maps | A straight line without a token; maps and directions need Mapbox | Blocked by external (Mapbox token) | [#57](https://github.com/shaiknoorullah/hg-mono/issues/57) |
| [D-23](spec/04-rider.md#d-23--distance-tracking-for-payment) | Distance for pay | `rider-sim` after `make dev-journey auto=all` | Covered | — |
| [D-24](spec/04-rider.md#d-24--customer-communication) | Contact the customer | Masked calling goes through Twilio | Blocked by external (Twilio) | [#181](https://github.com/shaiknoorullah/hg-mono/issues/181) |
| [D-24b](spec/04-rider.md#d-24b--two-way-free-text-chat-with-customer-and-restaurant) | Chat | — | Not in V1 | — |
| [D-25](spec/04-rider.md#d-25--restaurant-communication) | Contact the restaurant | The arrival shows during the journey; issue codes come after launch; calls need Twilio | Partial | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [D-26](spec/04-rider.md#d-26--earnings-formula-and-per-delivery-ledger) | Earnings per delivery | `rider-sim` after `make dev-journey auto=all` | Covered | — |
| [D-27](spec/04-rider.md#d-27--earnings-dashboard-daily--weekly--monthly) | Earnings by day and week | One day's lines only, and the summary reads zero ([#590](https://github.com/shaiknoorullah/hg-mono/issues/590)) | Partial | [#590](https://github.com/shaiknoorullah/hg-mono/issues/590) |
| [D-28](spec/04-rider.md#d-28--payouts) | Payouts | No payout run | Missing | [#676](https://github.com/shaiknoorullah/hg-mono/issues/676) |
| [D-29](spec/04-rider.md#d-29--performance-metrics) | Performance figures | `rider-sim` after a few journeys | Covered | — |
| [D-30](spec/04-rider.md#d-30--delivery-history) | Delivery history | `rider-sim` after `make dev-journey auto=all` | Covered | — |
| [D-31](spec/04-rider.md#d-31--ratings-received-from-customers) | Ratings received | The journey rates `rider-sim` five | Covered | — |
| [D-32](spec/04-rider.md#d-32--incident-reporting--mid-delivery-exceptions) | Report an incident | No operation yet | Missing | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [D-33](spec/04-rider.md#d-33--notifications--alerts) | Notifications | Push needs a device and Expo | Blocked by external (push) | [#58](https://github.com/shaiknoorullah/hg-mono/issues/58) |
| [D-34](spec/04-rider.md#d-34--support--help) | Support and help | Phone line; tickets come after launch | Partial | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |

## Admin console

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [A-01](spec/05-admin.md#a-01--staff-account-provisioning) | Invite a staff member | In the console as `admin-seed`; the invitation-to-sign-in scenario `onboard-admin` is in PR [#622](https://github.com/shaiknoorullah/hg-mono/pull/622) | Partial | in PR [#622](https://github.com/shaiknoorullah/hg-mono/pull/622) |
| [A-02](spec/05-admin.md#a-02--role-based-access-control-model) | Roles: what each staff role may do | Only `admin-seed` can sign in; `support-seed` has no authenticator, and no plain admin exists | Partial | [#677](https://github.com/shaiknoorullah/hg-mono/issues/677) |
| [A-03](spec/05-admin.md#a-03--staff-authentication-mfa-and-session-policy) | Staff sign-in with a code | `admin-seed`, `make dev-totp`; or `make dev-admin` | Covered | in PR [#622](https://github.com/shaiknoorullah/hg-mono/pull/622) |
| [A-04](spec/05-admin.md#a-04--audit-log-append-only-hash-chained) | Audit trail is written | Every admin scenario writes rows; read them in the database | Covered | — |
| [A-05](spec/05-admin.md#a-05--audit-log-viewer-and-export) | Read and export the audit trail | No operation yet | Missing | [#327](https://github.com/shaiknoorullah/hg-mono/issues/327) |
| [A-06](spec/05-admin.md#a-06--global-platform-settings) | Platform settings | Only the ordering pause (`/v1/admin/ordering-pause`) | Partial | — |
| [A-07](spec/05-admin.md#a-07--promotions-and-campaigns) | Promotions | — | Not in V1 | — |
| [A-08](spec/05-admin.md#a-08--content-management-faq-terms-privacy-policy) | FAQ, terms and privacy content | — | Not in V1 | — |
| [A-09](spec/05-admin.md#a-09--platform-kpi-dashboard) | KPI dashboard | No operation yet | Missing | [#117](https://github.com/shaiknoorullah/hg-mono/issues/117) |
| [A-10](spec/05-admin.md#a-10--scheduled-reports-and-data-export) | Scheduled reports | — | Not in V1 | — |
| [A-11](spec/05-admin.md#a-11--support-team-oversight) | Support team oversight | — | Not in V1 | — |
| [A-12](spec/05-admin.md#a-12--escalation-routing-and-tiering) | Escalation routing | No case operations yet | Missing | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [A-13](spec/05-admin.md#a-13--restaurant-onboarding-review-queue) | Restaurant onboarding queue | `docs-review` and `docs-rejected`; no full application waits | Partial | [#678](https://github.com/shaiknoorullah/hg-mono/issues/678) |
| [A-14](spec/05-admin.md#a-14--kyc-document-review-non-halal-documents) | Review a document | `make dev-scenario s=docs-approve` or `s=docs-reject`; the seeded file does not open | Partial | [#686](https://github.com/shaiknoorullah/hg-mono/issues/686) |
| [A-15](spec/05-admin.md#a-15--halal-certification-verification--core-product-function) | Halal seven-check verification | Only inside `s=onboard-restaurant`; no certificate waits for checks after a reset | Partial | [#678](https://github.com/shaiknoorullah/hg-mono/issues/678) |
| [A-16](spec/05-admin.md#a-16--halal-issuing-body-registry) | Issuing bodies | `admin-seed`; the reference seed has accepted bodies | Covered | — |
| [A-17](spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling) | Certificate expiry and lapse | `expiring-halal`, `expired-halal`; nothing lapses while you watch | Partial | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) |
| [A-18](spec/05-admin.md#a-18--restaurant-approval--rejection-decision) | Approve or reject a restaurant | Approval inside `s=onboard-restaurant`; a rejection only seeded (`docs-rejected`) | Partial | [#678](https://github.com/shaiknoorullah/hg-mono/issues/678) |
| [A-19](spec/05-admin.md#a-19--menu-approval-queue) | Menu review queue | `menu`, then `s=menu-approve` or `s=menu-reject` | Covered | — |
| [A-20](spec/05-admin.md#a-20--restaurant-compliance-monitoring-violations-register) | Violations register | — | Not in V1 | — |
| [A-21](spec/05-admin.md#a-21--restaurant-performance-monitoring) | Restaurant performance | — | Not in V1 | — |
| [A-22](spec/05-admin.md#a-22--restaurant-account-state-actions-suspend--ban--deactivate--reinstate--delist) | Suspend, delist or reinstate a restaurant | `suspended`, `expired-halal` (delisted) and `paused` are seeded; no operation changes them | Missing | [#253](https://github.com/shaiknoorullah/hg-mono/issues/253) |
| [A-23](spec/05-admin.md#a-23--rider-onboarding-review-and-approval) | Rider onboarding review | `rider-docs`, `rider-rejected`, `make dev-scenario s=onboard-rider` | Covered | — |
| [A-24](spec/05-admin.md#a-24--rider-document-expiry-monitoring) | Rider document expiry | No expiry job for rider documents yet | Missing | — |
| [A-25](spec/05-admin.md#a-25--rider-performance-monitoring) | Rider performance | — | Not in V1 | — |
| [A-26](spec/05-admin.md#a-26--rider-incident-handling) | Rider incidents | — | Not in V1 | — |
| [A-27](spec/05-admin.md#a-27--rider-account-state-actions) | Suspend or reinstate a rider | No operation yet | Missing | [#253](https://github.com/shaiknoorullah/hg-mono/issues/253) |
| [A-28](spec/05-admin.md#a-28--customer-account-state-actions) | Suspend or reinstate a customer | No operation yet | Missing | [#253](https://github.com/shaiknoorullah/hg-mono/issues/253) |
| [A-29](spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change) | Orders in flight when an account changes | Waits on the account operations | Missing | [#253](https://github.com/shaiknoorullah/hg-mono/issues/253) |
| [A-30](spec/05-admin.md#a-30--review-moderation) | Review moderation | — | Not in V1 | — |
| [A-31](spec/05-admin.md#a-31--abuse-and-fraud-report-handling) | Abuse and fraud reports | — | Not in V1 | — |
| [A-32](spec/05-admin.md#a-32--feedback-and-ratings-review) | Feedback and ratings review | — | Not in V1 | — |
| [A-33](spec/05-admin.md#a-33--refund-issuance-and-authority-limits) | Approve, decline or issue a refund | The journey leaves one refund request; decide it by hand | Partial | [#679](https://github.com/shaiknoorullah/hg-mono/issues/679) |
| [A-34](spec/05-admin.md#a-34--goodwill-credit-issuance) | Goodwill credit | — | Not in V1 | — |
| [A-35](spec/05-admin.md#a-35--dispute-case-management) | Dispute cases | — | Not in V1 | [#186](https://github.com/shaiknoorullah/hg-mono/issues/186) |
| [A-36](spec/05-admin.md#a-36--rider-earnings-and-payout-dispute-assistance) | Rider pay disputes | — | Not in V1 | — |
| [A-37](spec/05-admin.md#a-37--case-model-queue-and-assignment) | Case queue | No operation yet | Missing | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [A-38](spec/05-admin.md#a-38--order-lookup-and-admin-order-intervention) | Find an order; cancel it as staff | Any scenario order; staff cancel: `s=order-preparing`, then cancel in the console | Covered | — |
| [A-39](spec/05-admin.md#a-39--restaurant-and-rider-document-upload-assistance) | Upload a document for a partner | No operation yet | Missing | — |
| [A-40](spec/05-admin.md#a-40--customer-account-assistance) | Help a customer with their account | No operation yet | Missing | — |
| [A-41](spec/05-admin.md#a-41--delivery-issue-resolution) | Delivery issue resolution | — | Not in V1 | — |
| [A-42](spec/05-admin.md#a-42--global-entity-search-pii-masking-and-access-justification) | Search everything, with personal data masked | No operation yet | Missing | [#171](https://github.com/shaiknoorullah/hg-mono/issues/171) |

## Cross-cutting journeys

### Money

All local money runs on the fake payment gateway, which the API uses when `HG_ENV` is `local` and `HG_STRIPE_SECRET_KEY` is unset. It authorises, captures, voids and refunds at once and never fails.

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | Capture when the restaurant accepts | `make dev-scenario s=order-preparing`; with a test key the payment turns from Uncaptured to Succeeded ([card payments playbook](playbooks/customer/card-payments.md)) | Covered | — |
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | Void when the restaurant rejects | `s=restaurant-rejected` | Covered | — |
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | Void when the restaurant lets it time out | `s=new-order`, then wait 180 seconds | Covered | — |
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | Void when the customer cancels | `s=customer-cancels` | Covered | — |
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | A card is declined, or never paid | Only with Stripe test keys | Partial | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | The capture fails at acceptance | Not produced | Missing | [#676](https://github.com/shaiknoorullah/hg-mono/issues/676) |
| [P-18](spec/01-platform.md#p-18--refunds-cancellations-and-compensation) | The customer asks for a refund | `make dev-journey auto=all speed=max` (last step) | Covered | — |
| [P-18](spec/01-platform.md#p-18--refunds-cancellations-and-compensation) | Staff approve, decline or issue a refund | By hand in the admin console | Missing | [#679](https://github.com/shaiknoorullah/hg-mono/issues/679) |
| [P-17](spec/01-platform.md#p-17--webhooks-idempotency-and-reconciliation) | A card dispute (chargeback) | Stripe test mode, its dispute test card and `stripe listen` ([card payments playbook](playbooks/customer/card-payments.md)) | Blocked by external (Stripe test keys) | — |
| [P-19](spec/01-platform.md#p-19--stripe-connect-onboarding-and-payouts-canada) | Weekly payouts to restaurants and riders | No payout run; the fake gateway would leave a payout transferred | Missing | [#676](https://github.com/shaiknoorullah/hg-mono/issues/676) |
| [P-13](spec/01-platform.md#p-13--the-ledger-and-the-zero-residual-invariant) | Every order nets to zero in the ledger | After `make dev-journey auto=all`, sum the order's ledger lines in the database | Covered | — |
| [D-26](spec/04-rider.md#d-26--earnings-formula-and-per-delivery-ledger) | The rider is paid on delivery | `rider-sim` earnings after the journey | Covered | — |

### Order states and deadlines

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `CREATED`: waiting for the card | With Stripe test keys, leave the card form open ([card payments playbook](playbooks/customer/card-payments.md)) | Blocked by external (Stripe test keys) | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `AUTHORIZED` | Passes inside the order request on the fake gateway; not visible | Partial | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `RESTAURANT_PENDING` | `make dev-scenario s=new-order` | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `PREPARING` | `s=order-preparing` | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `READY_FOR_PICKUP` | `s=order-ready` | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `PICKED_UP` | `make dev-journey auto=all speed=1x` | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `ARRIVED` | As above | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `DELIVERED` | As above, for about two minutes | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `COMPLETED` | As above | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `CANCELLED` | `s=customer-cancels`, or the 180-second timeout | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `REJECTED` | `s=restaurant-rejected` | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `FAILED` | Not produced: the fake gateway never fails | Missing | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `DISPUTED` | Only a customer report of a tampered seal reaches it; the QR seal screens are out of release 1.0 ([#68](https://github.com/shaiknoorullah/hg-mono/issues/68)) and the dev world issues no seals | Not in V1 | [#68](https://github.com/shaiknoorullah/hg-mono/issues/68) |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | `RESOLVED` | No staff operation resolves a dispute yet | Not in V1 | [#186](https://github.com/shaiknoorullah/hg-mono/issues/186) |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Restaurant deadline (180 seconds) | `s=new-order`, then wait | Covered | — |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Unpaid deadline (15 minutes) | With Stripe test keys, leave an order unpaid | Blocked by external (Stripe test keys) | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Preparation deadline (prep time plus 10 minutes) | `s=order-preparing` (20-minute prep), then wait 30 minutes | Covered | — |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Pickup deadline (15 minutes) | `s=order-ready` with no rider online, then wait | Covered | — |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Delivery deadline (75 minutes) | `make dev-journey auto=all manual=rider`, pick up in the app, then wait | Covered | — |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Delivered to completed (two minutes) | `make dev-journey auto=all` | Covered | — |

### Halal states

The four states a customer can see a restaurant in. A restaurant that is not `CERTIFIED` or `EXPIRING_SOON` is never shown to customers, and no halal state is ever red ([never red for a halal state (invariant 9)](../AGENTS.md#3-non-negotiable-invariants)).

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [C-12](spec/02-customer.md#c-12--halal-certification-display-and-verification--critical) | `CERTIFIED` | `bismillah-grill` and the 11 other catalogue restaurants | Covered | — |
| [C-12](spec/02-customer.md#c-12--halal-certification-display-and-verification--critical) | `EXPIRING_SOON` | `expiring-halal` (Bamyan Kebab House) | Covered | in PR [#654](https://github.com/shaiknoorullah/hg-mono/pull/654) |
| [C-12](spec/02-customer.md#c-12--halal-certification-display-and-verification--critical) | `EXPIRED` | `expired-halal`, delisted and hidden from customers. Between midnight UTC and midnight in Toronto it reads expiring ([#653](https://github.com/shaiknoorullah/hg-mono/issues/653)) | Covered | in PR [#654](https://github.com/shaiknoorullah/hg-mono/pull/654) |
| [C-12](spec/02-customer.md#c-12--halal-certification-display-and-verification--critical) | `UNVERIFIED` | `fresh`, `profile`, `docs-todo`, `docs-review`, `docs-rejected`; never listed | Covered | — |
| [A-17](spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling) | A certificate lapses as the days pass | Not produced without waiting a day | Missing | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) |
| [A-17](spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling) | Renewal reminders (30, 14, 7 and 1 days) | Not produced | Missing | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) |
| [R-10](spec/03-restaurant.md#r-10--document-expiry-renewal-and-compliance-suspension) | A renewed certificate relists the restaurant | Not produced | Missing | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) |
| [C-12](spec/02-customer.md#c-12--halal-certification-display-and-verification--critical) | Open the certificate | The seeded file is missing from storage | Partial | [#686](https://github.com/shaiknoorullah/hg-mono/issues/686) |

### Realtime

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [P-20](spec/01-platform.md#p-20--websocket-connection-authentication) | Sign the socket in with a one-time ticket | Any app signed in as a persona | Covered | — |
| [P-22](spec/01-platform.md#p-22--event-catalogue-and-envelope) | Order state changes arrive live | `make dev-journey`; the restaurant queue updates by itself ([playbook](playbooks/restaurant/journey.md)) | Covered | — |
| [P-22](spec/01-platform.md#p-22--event-catalogue-and-envelope) | Rider position arrives live | `make dev-journey auto=all speed=1x` | Covered | — |
| [P-22](spec/01-platform.md#p-22--event-catalogue-and-envelope) | Refund, onboarding, payout and account events | Not sent yet | Partial | [#376](https://github.com/shaiknoorullah/hg-mono/issues/376) |
| [P-23](spec/01-platform.md#p-23--delivery-guarantees-replay-and-multi-replica-fan-out) | Catch up after a reconnect | Restart the API mid-journey | Covered | — |

### Notifications

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [P-24](spec/01-platform.md#p-24--notification-router-which-event-which-role-which-channel) | In-app notification rows | `amina` and `bismillah-grill` after the journey (`GET /v1/notifications`) | Covered | — |
| [P-26](spec/01-platform.md#p-26--sms-and-email) | Emails | Written to the API log, links included; no email leaves a local API without a Resend key | Covered | — |
| [P-26](spec/01-platform.md#p-26--sms-and-email) | Text messages | Fake sender | Blocked by external (Twilio) | [#59](https://github.com/shaiknoorullah/hg-mono/issues/59) |
| [P-25](spec/01-platform.md#p-25--push-notifications-expo) | Push to a phone | Needs a device and Expo push | Blocked by external (push) | [#58](https://github.com/shaiknoorullah/hg-mono/issues/58) |
| [P-02](spec/01-platform.md#p-02--phone-otp-authentication-customers-riders) | Sign-in codes | Fixed code `000000` for `+15550100100` to `+15550100199` when `HG_ENV` is `local`; real codes need Twilio Verify | Covered | — |

### Support

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [C-07](spec/02-customer.md#c-07--call-support) | Call support | The phone number in the public config | Covered | — |
| [C-06](spec/02-customer.md#c-06--help-centre--faq) | Help centre, tickets, chat, appeals | No operation yet | Not in V1 | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |
| [A-37](spec/05-admin.md#a-37--case-model-queue-and-assignment) | Staff case queue and escalations | No operation yet | Missing | [#190](https://github.com/shaiknoorullah/hg-mono/issues/190) |

### Platform

Every platform feature, for completeness. Most are exercised by any journey above.

| Feature | Journey | How to reach it | Status | Gap |
|---|---|---|---|---|
| [P-01](spec/01-platform.md#p-01--account-model-one-table-many-roles) | One account, many roles | The personas cover every role but plain admin, restaurant manager and restaurant staff | Partial | [#677](https://github.com/shaiknoorullah/hg-mono/issues/677) |
| [P-02](spec/01-platform.md#p-02--phone-otp-authentication-customers-riders) | Phone sign-in | `amina`, `rider-sim` | Covered | — |
| [P-03](spec/01-platform.md#p-03--email--password-authentication-restaurants-admins-support) | Email and password sign-in | Any `@seed.hg` persona | Covered | — |
| [P-04](spec/01-platform.md#p-04--sessions-token-format-lifetime-refresh-revocation) | Sessions and refresh | Any persona | Covered | — |
| [P-05](spec/01-platform.md#p-05--role-scope-and-permission-model) | Roles, scopes, permissions | Owner and super admin only | Partial | [#683](https://github.com/shaiknoorullah/hg-mono/issues/683) |
| [P-06](spec/01-platform.md#p-06--deny-by-default-routing-and-the-middleware-chain) | Deny by default | Any persona against another app's routes | Covered | — |
| [P-07](spec/01-platform.md#p-07--ownership-checks-the-idor-fix) | Ownership checks | `nour` reading `amina`'s order | Covered | — |
| [P-08](spec/01-platform.md#p-08--currency-representation) | Money in cents | Every quote | Covered | — |
| [P-09](spec/01-platform.md#p-09--canonical-price-computation-the-quote) | The server prices the order | `amina` at checkout | Covered | — |
| [P-10](spec/01-platform.md#p-10--fee-breakdown-presented-to-the-customer) | Fee breakdown | `amina` at checkout | Covered | — |
| [P-11](spec/01-platform.md#p-11--canadian-sales-tax-gst--hst--qst--pst) | Canadian sales tax | Ontario, every quote | Covered | — |
| [P-12](spec/01-platform.md#p-12--rounding-and-allocation) | Rounding and allocation | Every quote | Covered | — |
| [P-13](spec/01-platform.md#p-13--the-ledger-and-the-zero-residual-invariant) | Ledger | See [money](#money) | Covered | — |
| [P-14](spec/01-platform.md#p-14--order-lifecycle-states-and-transitions) | Order states | See [order states and deadlines](#order-states-and-deadlines) | Partial | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [P-15](spec/01-platform.md#p-15--deadlines-and-timeout-actions-waits-forever-is-unrepresentable) | Deadlines | See [order states and deadlines](#order-states-and-deadlines) | Covered | — |
| [P-16](spec/01-platform.md#p-16--paymentintent-lifecycle-and-capture-timing) | Payment authorise and capture | See [money](#money) | Partial | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) |
| [P-17](spec/01-platform.md#p-17--webhooks-idempotency-and-reconciliation) | Stripe webhooks | Stripe test keys and `stripe listen` ([card payments playbook](playbooks/customer/card-payments.md)) | Blocked by external (Stripe test keys) | — |
| [P-18](spec/01-platform.md#p-18--refunds-cancellations-and-compensation) | Refunds and cancellations | See [money](#money) | Partial | [#679](https://github.com/shaiknoorullah/hg-mono/issues/679) |
| [P-19](spec/01-platform.md#p-19--stripe-connect-onboarding-and-payouts-canada) | Connect accounts and payouts | Accounts: `payout`, `s=onboard-rider`. Payouts: none | Partial | [#676](https://github.com/shaiknoorullah/hg-mono/issues/676) |
| [P-20](spec/01-platform.md#p-20--websocket-connection-authentication) | Socket sign-in | See [realtime](#realtime) | Covered | — |
| [P-21](spec/01-platform.md#p-21--channels-and-subscriptions) | Channels | See [realtime](#realtime) | Covered | — |
| [P-22](spec/01-platform.md#p-22--event-catalogue-and-envelope) | Event catalogue | See [realtime](#realtime) | Partial | [#376](https://github.com/shaiknoorullah/hg-mono/issues/376) |
| [P-23](spec/01-platform.md#p-23--delivery-guarantees-replay-and-multi-replica-fan-out) | Delivery and replay | See [realtime](#realtime) | Covered | — |
| [P-24](spec/01-platform.md#p-24--notification-router-which-event-which-role-which-channel) | Notification router | See [notifications](#notifications) | Covered | — |
| [P-25](spec/01-platform.md#p-25--push-notifications-expo) | Push | See [notifications](#notifications) | Blocked by external (push) | [#58](https://github.com/shaiknoorullah/hg-mono/issues/58) |
| [P-26](spec/01-platform.md#p-26--sms-and-email) | Text and email | See [notifications](#notifications) | Blocked by external (Twilio) | [#59](https://github.com/shaiknoorullah/hg-mono/issues/59) |
| [P-27](spec/01-platform.md#p-27--bucket-layout-and-private-by-default) | Private buckets | Local storage from `make up` | Covered | — |
| [P-28](spec/01-platform.md#p-28--presigned-upload-and-download) | Signed upload and download | Uploads: the onboarding scenarios and the journey photo. Downloads of seeded files fail | Partial | [#686](https://github.com/shaiknoorullah/hg-mono/issues/686) |
| [P-29](spec/01-platform.md#p-29--document-lifecycle-review-and-retention) | Document lifecycle | The restaurant and rider onboarding personas | Covered | — |
| [P-30](spec/01-platform.md#p-30--canonical-geography-schema-one-column-no-split-brain) | Locations | The catalogue around Danforth and downtown Toronto | Covered | — |
| [P-31](spec/01-platform.md#p-31--distance-duration-and-eta) | Distance and arrival times | The journey | Covered | — |
| [P-32](spec/01-platform.md#p-32--rider-search-and-offer) | Find a rider and offer | One rider only | Partial | [#684](https://github.com/shaiknoorullah/hg-mono/issues/684) |
| [P-33](spec/01-platform.md#p-33--restaurant-and-dish-search) | Restaurant and dish search | The catalogue | Covered | — |
| [P-34](spec/01-platform.md#p-34--filters-and-halal-certification) | Halal filters | See [halal states](#halal-states) | Covered | — |
| [P-35](spec/01-platform.md#p-35--append-only-audit-trail) | Audit trail | Every admin scenario | Covered | — |
| [P-36](spec/01-platform.md#p-36--request-validation-and-the-response-envelope) | Validation and the response envelope | Any request | Covered | — |
| [P-37](spec/01-platform.md#p-37--idempotency-keys) | Retry-safe requests | Every scenario sends a retry key | Covered | — |
| [P-38](spec/01-platform.md#p-38--rate-limiting) | Rate limits | Ask for a sign-in code four times | Covered | — |
| [P-39](spec/01-platform.md#p-39--background-runtime-deadline-runner-outbox-relay-schedulers) | Background jobs | Deadlines and the outbox run under `make run`; the expiry and payout jobs only on their own clock | Partial | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) |

## Blocked by external services

Not filed as dev world issues:

- **Stripe test keys**: saved cards, 3-D Secure, an order left unpaid, webhooks and card disputes. The [card payments playbook](playbooks/customer/card-payments.md) runs them with a test account. Live keys are never used locally.
- **Twilio**: real sign-in codes, text messages and masked calls between customer, rider and restaurant.
- **Push (Expo)**: every push notification, including the rider's offer alert.
- **Mapbox token**: address search, map tiles and directions. Without one the journey drives a straight line.

## Gap issues

| Area | Issue | Proposed |
|---|---|---|
| Admin | [#677](https://github.com/shaiknoorullah/hg-mono/issues/677) support agent and admin staff who can sign in | personas `support-seed` (enrolled), `ops-admin` |
| Admin | [#678](https://github.com/shaiknoorullah/hg-mono/issues/678) a restaurant application waiting for halal verification | `application-in-review`, `application-reject` |
| Money | [#679](https://github.com/shaiknoorullah/hg-mono/issues/679) staff refund decisions | `refund-decisions` |
| Money | [#680](https://github.com/shaiknoorullah/hg-mono/issues/680) a declined card and an unpaid order without Stripe keys | `payment-failed`, `payment-unpaid` |
| Money | [#676](https://github.com/shaiknoorullah/hg-mono/issues/676), already filed: payout run, capture failure | `payout-run`, `capture-fails` |
| Customer account | [#681](https://github.com/shaiknoorullah/hg-mono/issues/681) an address book with an address out of range | personas: three addresses for `amina`, none for `nour` |
| Customer account | [#682](https://github.com/shaiknoorullah/hg-mono/issues/682) order history in every end state | `order-history` |
| Restaurant | [#683](https://github.com/shaiknoorullah/hg-mono/issues/683) manager and staff logins, hours overrides | personas `bismillah-manager`, `bismillah-staff` |
| Rider | [#684](https://github.com/shaiknoorullah/hg-mono/issues/684) offers rejected, ignored, raced, and no rider found | `offer-reject`, `offer-ignored`, `offer-race`, `no-rider`; persona `rider-sim-2` |
| Time passing | [#685](https://github.com/shaiknoorullah/hg-mono/issues/685) a certificate lapses and is renewed | `halal-lapse`, `halal-renew` |
| Other | [#686](https://github.com/shaiknoorullah/hg-mono/issues/686) seeded documents and certificates open as files | part of `make dev-reset` |
| Other | [#687](https://github.com/shaiknoorullah/hg-mono/issues/687) restaurant playbooks name personas and commands that exist | playbook fixes |

Order deadlines are reached by waiting, by design: the [harness design's non-goals](superpowers/specs/2026-09-28-devworld-harness-design.md#2-goals-and-non-goals) rule out a dev clock that moves `deadline_at` ([every non-terminal order state carries a deadline (invariant 4)](../AGENTS.md#3-non-negotiable-invariants)). A shorter local response window is asked for in [#676](https://github.com/shaiknoorullah/hg-mono/issues/676).
