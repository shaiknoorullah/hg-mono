# `contracts/fixtures/` — the scenario menu

**Every file in this directory is generated.** Do not hand-edit one; edit
`contracts/fixtures/_build/` and run `pnpm fixtures:build`. CI runs the builder and then
`git diff --exit-code`, so a hand edit fails the build.

```bash
pnpm fixtures:build        # regenerate from contracts/openapi.yaml
pnpm validate:fixtures     # assert every fixture against its schema
pnpm mock                  # serve them all at http://localhost:4010
```

---

## What a fixture is

One JSON file per scenario, under `<domain>/<scenario>.json`:

```jsonc
{
  "scenario":   "order_arrived",            // globally unique; this is the name you pass
  "domain":     "orders",
  "schema":     "OrderCustomerView",        // the component schema it validates against
  "describes":  "Rider is at the drop-off, proof of delivery not yet recorded.",
  "operations": ["getOrder", "getActiveOrder", "cancelOrder"],
  "status":     200,
  "tags":       ["order-state-matrix"],
  "meta":       { "next_cursor": null, "has_more": false, "total": 1 },  // collections only
  "payload":    { }                         // the `data` member of the envelope
}
```

`payload` is the **`data` value**, not the envelope. The mock server wraps it as
`{"data": payload}` (plus `{"meta": …}` for collections); an `ErrorEnvelope` fixture is
served as-is with its own status. `contracts/fixtures/index.json` is the machine-readable
manifest: counts, the `operationId → scenarios` index, and the default scenario per
operation.

## How to use one

| Where | How |
|---|---|
| Mock server, one request | `GET /v1/orders/any?scenario=order_arrived` |
| Mock server, whole session | header `X-Mock-Scenario: order_arrived`, or cookie `mock_scenario=` |
| Generated client | `createHgClient({ baseUrl, mockScenario: 'order_arrived' })` |
| MSW / unit test | `import fixture from 'contracts/fixtures/orders/order_arrived.json'` |
| Realtime | `ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_order_happy_path` |

A scenario name that does not exist comes back with `X-Mock-Warning` rather than silently
falling through, so a typo is visible immediately.

## Conventions every fixture obeys

* **Money is integer cents.** Never a float, never a string. Order totals are *derived* from
  their lines — `subtotal + fees − discounts + HST(13%) + tip` genuinely equals `total_cents`,
  so an app can assert on the arithmetic.
* **Ontario.** Real Toronto / Mississauga / Scarborough / Brampton / Ottawa / Kitchener /
  Hamilton streets, postal codes that satisfy the contract's FSA/LDU pattern, `+1` numbers in
  the 555 reserved range, `America/Toronto`, CAD.
* **A frozen clock.** Every timestamp is relative to **2026-08-10T18:42:11.412Z**, so the
  build is reproducible. Countdowns are therefore in the past unless you run the mock, which
  re-stamps realtime frames to wall clock.
* **Stable ids.** `uuid_for("restaurant:karachi-kitchen")` is the same value in every
  fixture, so `order_preparing.restaurant.id` really is `restaurant_detail_certified.id`.
* **Enum values are never invented.** Every one comes from the contract.

---

## Scenarios by domain

**380 scenarios** across 15 domains.

| Domain | Scenarios | What it covers |
|---|---:|---|
| [`admin`](#admin) | 32 | Review queues, applications, staff, the menu-review workflow and payout runs. |
| [`cart`](#cart) | 12 | Cart and quote — every blocking reason, the quantity cap, and the money edges. |
| [`catalogue`](#catalogue) | 41 | Discovery, restaurant detail, hours and menus. |
| [`dispatch`](#dispatch) | 31 | Dispatch states, rider offers and assignments. |
| [`documents`](#documents) | 23 | KYC uploads, review states and every rejection reason. |
| [`errors`](#errors) | 43 | `{error}` envelopes for the codes an app actually branches on. |
| [`halal`](#halal) | 25 | Badges, certificates, checks and issuing bodies — the platform's core promise. |
| [`handoff`](#handoff) | 13 | The package-seal chain of custody — every `PackageSeal` status, `HandoffEvent` type, and the bind/pickup-scan/delivery-scan/tamper-report results. |
| [`onboarding`](#onboarding) | 35 | Restaurant and rider onboarding, profiles, vehicles and trading state. |
| [`orders`](#orders) | 44 | The 14 `OrderState` values, per-audience projections, tracking and receipts. |
| [`payments`](#payments) | 12 | The 8 `PaymentState` values, saved cards and setup intents. |
| [`platform`](#platform) | 25 | Auth, config, addresses, notifications, Connect and health. |
| [`realtime`](#realtime) | 8 | Scripted WebSocket sequences that drive a screen through a whole lifecycle. |
| [`refunds`](#refunds) | 14 | The 10 `RefundState` values, liability splits and approval requests. |
| [`rider`](#rider) | 22 | Availability, dashboard, earnings and payouts. |

### admin

Review queues, applications, staff, the menu-review workflow and payout runs. — 32 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `menu_review_queue` | `array&lt;MenuItemVersion&gt;` | 200 | Three edits waiting, oldest first, from two restaurants. Only the words, the photo and the dietary and allergen tags wait here; price and availability went live on save. Nothing here is ever approved by waiting. |
| `menu_review_queue_empty` | `array&lt;MenuItemVersion&gt;` | 200 | Nothing queued. A stalled queue must never freeze a restaurant's trading, which is why price and availability bypass review entirely. |
| `menu_version_approved` | `MenuItemVersion` | 200 | `APPROVED`. Live to customers. |
| `menu_version_draft` | `MenuItemVersion` | 200 | `DRAFT`. The owner is still editing. |
| `menu_version_pending_review` | `MenuItemVersion` | 200 | `PENDING_REVIEW`. Claim-bearing fields queued. **Never auto-approved** (decision R-05). |
| `menu_version_rejected` | `MenuItemVersion` | 200 | `REJECTED`. Refused with `UNSUBSTANTIATED_HALAL_CLAIM`. |
| `menu_version_superseded` | `MenuItemVersion` | 200 | `SUPERSEDED`. A newer version replaced it in the queue. |
| `menu_version_withdrawn` | `MenuItemVersion` | 200 | `WITHDRAWN`. Pulled by the owner before review. |
| `payout_run_detail_every_outcome` | `PayoutRunDetail` | 200 | A run's audit trail with one line for every outcome a run can record. |
| `payout_run_failed` | `PayoutRun` | 200 | One transfer failed. The payout stays owed and the next run tries it again. |
| `payout_run_list_empty` | `array&lt;PayoutRun&gt;` | 200 | No payout run has happened yet. |
| `payout_run_queued` | `PayoutRun` | 202 | An admin asked to run the payout now; the worker picks it up within seconds. |
| `payout_run_running` | `PayoutRun` | 200 | The Monday run is paying partners. A worker that stops mid-run is relieved by the next. |
| `payout_run_succeeded` | `PayoutRun` | 200 | The Monday run paid everyone it could; holds and carried balances are not failures. |
| `restaurant_application_approved` | `RestaurantApplication` | 200 | `decideRestaurantApplication` with `restaurant_decision_input_approve`: approved and moved to `PAYOUT_PENDING`. **Approval does not make the restaurant live**: `account_state` stays `PENDING` until payouts are enabled and a menu is approved. |
| `restaurant_application_none_to_take` | `RestaurantApplication|null` | 200 | `takeNextRestaurantApplication` with an empty queue — null, not an error. |
| `restaurant_application_pending_review` | `RestaurantApplication` | 200 | A complete application sitting in the queue: five documents, a halal certificate awaiting the seven checks, and no decision yet. |
| `restaurant_application_queue` | `array&lt;RestaurantApplicationSummary&gt;` | 200 | Four applications waiting, oldest first. |
| `restaurant_application_queue_empty` | `array&lt;RestaurantApplicationSummary&gt;` | 200 | Queue drained. `takeNextRestaurantApplication` returns **null data**, not 404. |
| `restaurant_decision_input_approve` | `RestaurantDecisionInput` | 200 | Request body for `decideRestaurantApplication`. APPROVE: an approval reason; `internal_note` stays with staff. |
| `restaurant_decision_input_reject` | `RestaurantDecisionInput` | 200 | Request body for `decideRestaurantApplication`. REJECT: a rejection reason. Final for this application. |
| `restaurant_decision_input_request_changes` | `RestaurantDecisionInput` | 200 | Request body for `decideRestaurantApplication`. REQUEST_CHANGES: a rejection reason and exactly which documents to redo. |
| `rider_application_approved` | `RiderApplication` | 200 | `decideRiderApplication` with `rider_decision_input_approve`: the rider moves to `PAYOUT_PENDING`, not straight to dispatchable. They are offered orders only once Stripe reports payouts enabled. |
| `rider_application_changes_requested` | `RiderApplication` | 200 | `decideRiderApplication` with `rider_decision_input_request_changes`: the licence is rejected with its reason and the rider redoes exactly that document. |
| `rider_application_none_to_take` | `RiderApplication|null` | 200 | Empty rider queue — null data. |
| `rider_application_pending_review` | `RiderApplication` | 200 | A rider application with six documents and a vehicle on file. |
| `rider_application_queue` | `array&lt;RiderApplicationSummary&gt;` | 200 | Nine rider applications waiting. |
| `rider_decision_input_approve` | `RiderDecisionInput` | 200 | Request body for `decideRiderApplication`. APPROVE: an approval reason, never a rejection reason. The text reaches the rider. |
| `rider_decision_input_reject` | `RiderDecisionInput` | 200 | Request body for `decideRiderApplication`. REJECT: a document rejection reason and the sentence the rider reads. |
| `rider_decision_input_request_changes` | `RiderDecisionInput` | 200 | Request body for `decideRiderApplication`. REQUEST_CHANGES: a document rejection reason and exactly which documents to redo. |
| `staff_list` | `array&lt;StaffUser&gt;` | 200 | Platform staff across every `StaffStatus`. The invitee has never signed in and has no two-step sign-in yet. |
| `staff_user_invited` | `StaffUser` | 200 | What `createStaffUser` returns: a new account in `INVITED`. The super admin set no password; it becomes `ACTIVE` once the invitee sets one and enrols two-step sign-in. |

### cart

Cart and quote — every blocking reason, the quantity cap, and the money edges. — 12 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `cart_at_quantity_cap` | `Cart` | 200 | A line at the hard cap of **20** (contradiction log #21 — the customer spec's 1–20 wins over P-36's passing mention of 99). The stepper's `+` must be disabled. |
| `cart_empty` | `Cart` | 200 | No lines, no restaurant pinned. `is_quotable: false` with an empty `blocking_reasons` — nothing is wrong, there is simply nothing in it. |
| `cart_has_unavailable_items` | `Cart` | 200 | Three lines: one fine, one 86'd, one repriced upward since it was added. `blocking_reasons: [CART_HAS_UNAVAILABLE_ITEMS, PRICE_CHANGED]` and `is_quotable: false`. This is the error code that used to be spelled `cart_has_unavailable_items` before the normalisation. |
| `cart_many_lines` | `Cart` | 200 | Six lines including a family platter with a variant, three add-on groups and a special request. Tests the cart's densest row and the sticky total bar. |
| `cart_single_line` | `Cart` | 200 | Exactly one line, quantity 1, below the $15.00 minimum order — `blocking_reasons: [BELOW_MINIMUM_ORDER]`. |
| `quote_expired` | `Quote` | 200 | `expires_at` is 40 seconds in the past. Checking out with it is `409 QUOTE_EXPIRED`; see the `error_quote_stale` fixture for the re-quote path. |
| `quote_large_tip` | `Quote` | 200 | A CAD 100.00 tip on a CAD 60 order — larger than the subtotal. Catches tip percentage displays that assume tip < total and currency fields sized for two digits. |
| `quote_pickup` | `Quote` | 200 | `fulfilment: PICKUP` — delivery fee is 0, there is no delivery address, and `billable_km` is 0. The delivery-fee row must disappear, not render as $0.00. |
| `quote_single_line_minimum` | `Quote` | 200 | Exactly one line at the cheapest item on the menu, tip 0 — the smallest legal order. Every money row is at its minimum. |
| `quote_standard` | `Quote` | 200 | Three lines, 15% tip, Ontario HST at 13% on items + delivery + service. Every number is derived, so the total genuinely equals the sum of the parts. |
| `quote_with_discount` | `Quote` | 200 | A restaurant-funded CAD 5.00 item discount (contradiction log #14). `funded_by` and `reimbursable` are separate fields because they answer different questions. |
| `quote_zero_tip` | `Quote` | 200 | `tip_cents: 0`. The one customer-chosen monetary input at its floor — the tip row must still render, and rider earnings must not go negative. |

### catalogue

Discovery, restaurant detail, hours and menus. — 41 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `feed_empty` | `array&lt;FeedSection&gt;` | 200 | No rails — a brand-new service area with nothing to merchandise yet. |
| `feed_sections` | `array&lt;FeedSection&gt;` | 200 | The home feed's merchandised rails. |
| `menu_category_created` | `MenuCategory` | 200 | A new, empty category. Categories carry no halal claim, so they are live at once and never reviewed. |
| `menu_category_updated` | `MenuCategory` | 200 | `updateMenuCategory`: renamed and deactivated in one save, live at once with no review. Customers no longer see the category or its three items; the restaurant still does, flagged `is_active: false`, and each item keeps its own state for when the category is switched back on. |
| `menu_empty` | `Menu` | 200 | A restaurant with **no menu at all** — approved, live, zero categories. Pair with `restaurant_detail_no_menu`. |
| `menu_full` | `Menu` | 200 | Three categories, twelve items, one out-of-stock dessert and the many-variant/many-addon platter. The default menu for every app. |
| `menu_item_available` | `MenuItem` | 200 | `availability_state = AVAILABLE`. Orderable now. |
| `menu_item_blocked` | `MenuItem` | 200 | `availability_state = BLOCKED`. Blocked by an admin after a menu review. The owner cannot un-block it. |
| `menu_item_created_by_admin` | `MenuItemOwnerView` | 200 | `createMenuItemOnBehalf`: approved on creation, because the reviewer and the author are the same accountable person. Live at once; the note says who added it. |
| `menu_item_created_pending_review` | `MenuItemOwnerView` | 200 | `createMenuItem`: the dish exists, version 1 waits for review, and customers see nothing yet (`live_version` is null). Price is set but cannot be ordered until approval. |
| `menu_item_edit_pending_review` | `MenuItemOwnerView` | 200 | `updateMenuItem` changed the description: version 4 waits for review while customers keep seeing version 3. A changed word can carry a halal claim, so it is never live before a person has read it. |
| `menu_item_edit_price_only` | `MenuItemOwnerView` | 200 | Only the price changed ($21.45 to $22.95): live at once, no review, no new version. Orders already placed keep the price they were placed at. |
| `menu_item_edited_by_admin` | `MenuItemOwnerView` | 200 | `updateMenuItemOnBehalf` renamed the dish: version 4 is approved on save and is already what customers see. The note records that HalalGoes made the change. |
| `menu_item_hidden` | `MenuItem` | 200 | `availability_state = HIDDEN`. Owner-hidden. Absent from customer reads; visible in the owner's menu editor. |
| `menu_item_long_name_no_image` | `MenuItem` | 200 | A 150-character dish name, a six-line description and **no image**. The item row, the item sheet and the cart line all have to survive it. |
| `menu_item_many_variants_and_addons` | `MenuItem` | 200 | Three required variant groups (16 variants, one unavailable) and four add-on groups (16 add-ons, two unavailable, one group with `min_select: 1`). The item sheet's hardest case. |
| `menu_item_marked_available` | `MenuItemOwnerView` | 200 | `setMenuItemAvailability` → `AVAILABLE`. Back on: orderable again at once. Accepted orders and customers' carts are never changed by it. |
| `menu_item_marked_out_of_stock_indefinitely` | `MenuItemOwnerView` | 200 | `setMenuItemAvailability` → `OUT_OF_STOCK`. Sold out until someone marks it available again. It shows in the weekly reminder of items left out of stock. Accepted orders and customers' carts are never changed by it. |
| `menu_item_marked_out_of_stock_until` | `MenuItemOwnerView` | 200 | `setMenuItemAvailability` → `OUT_OF_STOCK`. Sold out for an hour; it comes back by itself at the time shown. Accepted orders and customers' carts are never changed by it. |
| `menu_item_out_of_stock` | `MenuItem` | 200 | `availability_state = OUT_OF_STOCK`. 86'd until 22:42 local; still rendered, marked unavailable, never hidden (R-19). |
| `menu_single_item` | `Menu` | 200 | Exactly one category holding exactly one item. Catches carousels that need at least two children and 'N items' copy that pluralises wrongly. |
| `owned_menu_with_pending_version` | `OwnedMenu` | 200 | The restaurant's own menu. One item carries a `pending_version` — a claim-bearing field (description) was edited and is queued for review, while price and availability already went live unreviewed (decision R-05). |
| `restaurant_availability_closed_hours` | `RestaurantAvailabilityInfo` | 200 | Outside trading hours — `opens_at` is tomorrow 11:00 local, no ETA. |
| `restaurant_availability_no_address` | `RestaurantAvailabilityInfo` | 200 | Customer has no address yet, so nothing distance-derived can be computed. |
| `restaurant_availability_open` | `RestaurantAvailabilityInfo` | 200 | Open and accepting, with a live ETA band. |
| `restaurant_availability_out_of_range` | `RestaurantAvailabilityInfo` | 200 | 21.4 km from the saved address; carries `out_of_range_reason` copy. |
| `restaurant_availability_paused` | `RestaurantAvailabilityInfo` | 200 | Kitchen paused itself (R-22 short pause). Still listed, cannot be ordered from. |
| `restaurant_detail_certified` | `RestaurantDetail` | 200 | Restaurant detail with `halal.display_state = CERTIFIED`. Full badge, certificate viewable, 211 days of validity left. |
| `restaurant_detail_closed` | `RestaurantDetail` | 200 | Detail page for a kitchen that is closed right now. Ordering is blocked; the hours table and the 'opens at' line are the whole screen. |
| `restaurant_detail_expired` | `RestaurantDetail` | 200 | Restaurant detail with `halal.display_state = EXPIRED`. Expired 9 days ago. **Customer read paths 404 this restaurant** (contradiction log #19) — the fixture exists for the admin and owner surfaces. |
| `restaurant_detail_expiring_soon` | `RestaurantDetail` | 200 | Restaurant detail with `halal.display_state = EXPIRING_SOON`. Certificate expires in 18 days — badge shows the countdown, the restaurant keeps trading. |
| `restaurant_detail_no_menu` | `RestaurantDetail` | 200 | An approved restaurant that has not published a single menu item. Pair with `menu_empty`. The detail screen must not assume a menu exists. |
| `restaurant_detail_unverified` | `RestaurantDetail` | 200 | Restaurant detail with `halal.display_state = UNVERIFIED`. No accepted certificate on file. Never customer-visible; `SELF_DECLARED` does not exist in this contract (decision O-06). |
| `restaurant_hours_standard` | `RestaurantHours` | 200 | Mon–Thu 11:00–22:00, Fri–Sat 11:00–01:00 (crosses midnight), Sun 12:00–21:00, plus one closed-for-Eid override. |
| `restaurant_list_empty` | `array&lt;RestaurantCard&gt;` | 200 | Zero results — no halal kitchen serves this postal code yet. The empty state, not an error. |
| `restaurant_list_long_names` | `array&lt;RestaurantCard&gt;` | 200 | Names and cuisine lists that overflow one line at every breakpoint. Truncation, wrapping and the accessible full name all have to survive this. |
| `restaurant_list_missing_images` | `array&lt;RestaurantCard&gt;` | 200 | No hero, no logo, and on the first card no rating and no price band either — a kitchen that went live this morning. Every image slot must have a placeholder. |
| `restaurant_list_populated` | `array&lt;RestaurantCard&gt;` | 200 | Twelve open, certified Ontario restaurants — the default browse screen. One card (index 3) is EXPIRING_SOON so the badge variant is always on screen. |
| `restaurant_list_single` | `array&lt;RestaurantCard&gt;` | 200 | Exactly one result. Catches layouts that only look right with a full grid, and 'showing 1 of 1' copy that pluralises wrongly. |
| `search_results_empty` | `SearchResults` | 200 | No hits at all — the 'nothing matched' state, distinct from an error and from an unserved postal code. |
| `search_results_populated` | `SearchResults` | 200 | Restaurant and dish hits for the query 'biryani'. |

### dispatch

Dispatch states, rider offers and assignments. — 31 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `assignment_arrived_at_dropoff` | `Assignment` | 200 | At the door; proof of delivery is required to proceed. |
| `assignment_arrived_at_pickup` | `Assignment` | 200 | At the restaurant; the wait timer is running. |
| `assignment_assigned` | `Assignment` | 200 | Accepted, not yet moving. |
| `assignment_cancelled_by_platform` | `Assignment` | 200 | Support pulled the assignment mid-delivery. |
| `assignment_delivered` | `Assignment` | 200 | POD recorded. Terminal, happy. |
| `assignment_en_route_to_dropoff` | `Assignment` | 200 | Navigating to the customer. |
| `assignment_en_route_to_pickup` | `Assignment` | 200 | Navigating to the restaurant. |
| `assignment_no_instructions_no_unit` | `Assignment` | 200 | A house, not a condo: no unit, no buzzer, no instructions, no special request, no pickup notes. Every optional row on the rider card is absent at once. |
| `assignment_otp_pod_required` | `Assignment` | 200 | `MEET_AT_DOOR` maps to **OTP** proof of delivery (contradiction log #6), not a photo. The rider must be shown a code entry, and a photo must not satisfy it (`POD_METHOD_MISMATCH`). |
| `assignment_picked_up` | `Assignment` | 200 | Bag in hand. **The full customer address and unit appear only now** (§5). |
| `assignment_reassigned` | `Assignment` | 200 | Moved to another rider. Terminal for this rider. |
| `assignment_returned` | `Assignment` | 200 | Handed back at the restaurant. Terminal. |
| `assignment_returning` | `Assignment` | 200 | Taking the food back to the restaurant. |
| `assignment_undeliverable` | `Assignment` | 200 | Nobody home, no safe drop. Awaiting a support decision. |
| `dispatch_assigned` | `OrderCustomerView` | 200 | `dispatch_state = ASSIGNED` on an order in `READY_FOR_PICKUP`. A rider accepted. `dispatch.assigned` has fired to the customer. |
| `dispatch_at_customer` | `OrderCustomerView` | 200 | `dispatch_state = AT_CUSTOMER` on an order in `ARRIVED`. Rider is at the drop-off; proof of delivery is next. |
| `dispatch_at_restaurant` | `OrderCustomerView` | 200 | `dispatch_state = AT_RESTAURANT` on an order in `READY_FOR_PICKUP`. Rider is at the pickup, waiting on the pass. |
| `dispatch_carrying` | `OrderCustomerView` | 200 | `dispatch_state = CARRYING` on an order in `PICKED_UP`. Bag collected; `rider.location` is publishing at most once per 5 s. |
| `dispatch_completed` | `OrderCustomerView` | 200 | `dispatch_state = COMPLETED` on an order in `DELIVERED`. Handover recorded. Terminal, happy. |
| `dispatch_no_rider_found` | `OrderCustomerView` | 200 | `dispatch_state = NO_RIDER_FOUND` on an order in `FAILED`. Every wave exhausted. Terminal — the order fails and is refunded. |
| `dispatch_offered` | `OrderCustomerView` | 200 | `dispatch_state = OFFERED` on an order in `PREPARING`. One or more riders are looking at a live offer with a running countdown. |
| `dispatch_pending` | `OrderCustomerView` | 200 | `dispatch_state = PENDING` on an order in `RESTAURANT_PENDING`. Dispatch has the order but has not started searching — the restaurant has not accepted yet. |
| `dispatch_searching` | `OrderCustomerView` | 200 | `dispatch_state = SEARCHING` on an order in `PREPARING`. A wave is open; no rider has been offered this order in this wave yet. |
| `dispatch_unassigned` | `OrderCustomerView` | 200 | `dispatch_state = UNASSIGNED` on an order in `PREPARING`. The assigned rider dropped it or was removed; dispatch will re-search. The old rider is force-unsubscribed from `order:{id}` within 2 seconds. |
| `offer_expired` | `DispatchOffer` | 200 | `expires_at` is in the past. Accepting is `409 OFFER_EXPIRED` — one of the three codes that collided during the SCREAMING_SNAKE normalisation. |
| `offer_none` | `DispatchOffer|null` | 200 | No live offer. `getCurrentOffer` returns **null data**, not 404 — an online idle rider polls this and gets null all day. |
| `offer_pending` | `DispatchOffer` | 200 | A live offer with 28 seconds left. The countdown is `expires_at - server_time`, corrected for device clock skew — a phone whose clock is ten minutes fast must still show ~28 s. |
| `offer_rejected` | `DispatchOffer` | 200 | This rider declined it (`EARNINGS_TOO_LOW`). Kept so the rejection reason sheet has something to render against. |
| `offer_taken_by_another` | `DispatchOffer` | 200 | Another rider accepted first. Accepting is `409 OFFER_ALREADY_TAKEN`. |
| `offer_withdrawn` | `DispatchOffer` | 200 | Withdrawn because the customer cancelled. The card must dismiss itself rather than wait for the rider to tap. |
| `offer_zero_tip_low_value` | `DispatchOffer` | 200 | A 12 km trip with no tip so far — CAD 4.49 estimated. Under pure pass-through earnings (decision R-02) there is no rate-card floor, so this is what the rider sees. The screen must not imply a guarantee. |

### documents

KYC uploads, review states and every rejection reason. — 23 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `document_approved` | `KycDocument` | 200 | Cleared. |
| `document_expired` | `KycDocument` | 200 | Was approved; the expiry date has since passed. Trading may continue for some doc types and not others. |
| `document_in_review` | `KycDocument` | 200 | A reviewer holds the lock. Locked to the applicant (`DOCUMENT_LOCKED_FOR_REVIEW`). |
| `document_rejected` | `KycDocument` | 200 | **Rejected with a machine-readable reason code and free text.** `INCOMPLETE_PAGES` here — the applicant resubmits exactly this document. |
| `document_rejected_expired` | `KycDocument` | 200 | Rejected with `EXPIRED`. Every rejection carries a code **and** the reviewer's sentence — the applicant must never see a bare code. |
| `document_rejected_illegible` | `KycDocument` | 200 | Rejected with `ILLEGIBLE`. Every rejection carries a code **and** the reviewer's sentence — the applicant must never see a bare code. |
| `document_rejected_name_mismatch` | `KycDocument` | 200 | Rejected with `NAME_MISMATCH`. Every rejection carries a code **and** the reviewer's sentence — the applicant must never see a bare code. |
| `document_rejected_plate_mismatch` | `KycDocument` | 200 | Rejected with `PLATE_MISMATCH`. Every rejection carries a code **and** the reviewer's sentence — the applicant must never see a bare code. |
| `document_rejected_suspected_forgery` | `KycDocument` | 200 | Rejected with `SUSPECTED_FORGERY`. Every rejection carries a code **and** the reviewer's sentence — the applicant must never see a bare code. |
| `document_rejected_wrong_document_type` | `KycDocument` | 200 | Rejected with `WRONG_DOCUMENT_TYPE`. Every rejection carries a code **and** the reviewer's sentence — the applicant must never see a bare code. |
| `document_submitted` | `KycDocument` | 200 | Uploaded and queued. Editable until the pack is submitted. |
| `document_superseded` | `KycDocument` | 200 | Replaced by a newer upload of the same `doc_type`; kept for audit. |
| `presigned_download` | `PresignedDownload` | 200 | A short-lived GET for viewing a certificate or a document. |
| `presigned_upload` | `PresignedUpload` | 201 | A one-hour presigned PUT plus the `PENDING` stored object it will fill. |
| `restaurant_document_pack_complete` | `array&lt;KycDocument&gt;` | 200 | All five restaurant document types present and APPROVED. Note `VOID_CHEQUE_OR_BANK_LETTER` is absent by design — Stripe Connect supersedes it and the platform stores no bank details (contradiction log #20). |
| `restaurant_document_pack_empty` | `array&lt;KycDocument&gt;` | 200 | Nothing uploaded yet — the first thing a new partner sees. |
| `restaurant_document_pack_incomplete` | `array&lt;KycDocument&gt;` | 200 | Two of five uploaded, one rejected, two never attached. Submitting is `422 INCOMPLETE_DOCUMENT_PACK`. |
| `rider_document_pack_complete` | `array&lt;KycDocument&gt;` | 200 | All six rider document types APPROVED, including `WORK_ELIGIBILITY` (retained per contradiction log #20). |
| `rider_document_pack_rejected` | `array&lt;KycDocument&gt;` | 200 | The licence was rejected for cropping and the insurance has expired. The rider resubmits exactly two documents, not the whole pack. |
| `stored_object_deleted` | `StoredObject` | 200 | Purged. Attaching it is `404 UPLOAD_NOT_FOUND`. |
| `stored_object_pending` | `StoredObject` | 200 | Slot reserved, nothing uploaded yet. Expires in an hour. |
| `stored_object_ready` | `StoredObject` | 200 | Uploaded and checksum-verified. Only a READY object may be attached. |
| `stored_object_rejected` | `StoredObject` | 200 | Failed the content-type or checksum gate at confirm time. |

### errors

`{error}` envelopes for the codes an app actually branches on. — 43 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `error_active_order_exists` | `ErrorEnvelope` | 409 | `409` · `ACTIVE_ORDER_EXISTS`. One active order per customer (contradiction log #24). `getActiveOrder` returns zero or one — see `order_no_active`. |
| `error_application_already_decided` | `ErrorEnvelope` | 409 | `409` · `ALREADY_DECIDED`. A second decision on a decided application is refused, never applied over the first. |
| `error_authentication_required` | `ErrorEnvelope` | 401 | `401` · `AUTHENTICATION_REQUIRED`. Was `authentication_required`. Triggers the client's refresh-then-retry-once path. |
| `error_below_minimum_order` | `ErrorEnvelope` | 422 | `422` · `BELOW_MINIMUM_ORDER`. Pairs with `cart_single_line`. The amount is server-computed — the client renders the sentence, it does not do the subtraction. |
| `error_breached_password` | `ErrorEnvelope` | 422 | `422` · `BREACHED_PASSWORD`. The new password is on the breached-password list. Same body on reset and change. |
| `error_capture_failed` | `ErrorEnvelope` | 409 | `409` · `CAPTURE_FAILED`. Was `capture_failed`. The order is cancelled; nothing is owed. Pairs with `payment_failed`. |
| `error_cart_has_unavailable_items` | `ErrorEnvelope` | 409 | `409` · `CART_HAS_UNAVAILABLE_ITEMS`. Was `cart_has_unavailable_items`. Pairs with the `cart_has_unavailable_items` fixture. |
| `error_category_name_taken` | `ErrorEnvelope` | 409 | `409` · `CATEGORY_NAME_TAKEN`. Category names are unique per restaurant, ignoring case, on create and on rename. |
| `error_current_password_incorrect` | `ErrorEnvelope` | 422 | `422` · `INVALID_CREDENTIALS`. `changePassword` with the wrong current password. Nothing changed and no session was revoked. A 422, not a 401: the session is fine, and the client treats every 401 as an expired session to refresh and retry. |
| `error_decision_approval_reason_required` | `ErrorEnvelope` | 422 | `422` · `VALIDATION_FAILED`. An approval sent with a rejection reason (or none). An approval carries `ALL_CHECKS_PASSED` or `APPROVED_WITH_NOTES`; nothing changed. |
| `error_decision_rejection_reason_required` | `ErrorEnvelope` | 422 | `422` · `VALIDATION_FAILED`. A rejection or a request for changes without a rejection reason. Every decision is reasoned and audited; nothing changed. |
| `error_documents_incomplete` | `ErrorEnvelope` | 422 | `422` · `INCOMPLETE_DOCUMENT_PACK`. Was `incomplete_document_pack`. Pairs with `restaurant_document_pack_incomplete`. |
| `error_forbidden` | `ErrorEnvelope` | 403 | `403` · `FORBIDDEN`. Was `forbidden`. Note the English word 'forbidden' in prose was **not** rewritten by the normalisation — only code tokens were. |
| `error_halal_tag_not_writable` | `ErrorEnvelope` | 403 | `403` · `FIELD_NOT_WRITABLE`. Nobody types the halal claim onto a dish, not even an admin: it comes from the restaurant's approved certificate. A missing claim shows no badge, never an optimistic one. |
| `error_idempotency_key_reuse` | `ErrorEnvelope` | 409 | `409` · `IDEMPOTENCY_KEY_REUSE`. Never a silent replay of the wrong result. Was `idempotency_key_reuse`. |
| `error_internal_error` | `ErrorEnvelope` | 500 | `500` · `INTERNAL_ERROR`. Was `internal_error`. The only correct client behaviour is retry-with-backoff and show `request_id` in the support sheet. |
| `error_item_blocked_by_admin` | `ErrorEnvelope` | 403 | `403` · `ITEM_BLOCKED_BY_ADMIN`. `setMenuItemAvailability` on a `BLOCKED` item. The kitchen cannot un-block it; the message carries the admin's reason. |
| `error_menu_locked` | `ErrorEnvelope` | 403 | `403` · `MENU_LOCKED`. A menu change while the restaurant is suspended, by its own staff or by an admin on its behalf. The menu still reads normally; every edit control shows the locked-menu state. Opening hours stay editable. Nothing was written. |
| `error_menu_locked_banned` | `ErrorEnvelope` | 403 | `403` · `MENU_LOCKED`. An admin changing a banned restaurant's menu, or deciding one of its versions waiting for review. A banned restaurant's own staff cannot sign in, so only admins meet this one. |
| `error_menu_version_already_decided` | `ErrorEnvelope` | 409 | `409` · `ALREADY_DECIDED`. Two reviewers on one version: the second decision is refused, never applied twice. |
| `error_menu_version_item_deleted` | `ErrorEnvelope` | 409 | `409` · `ITEM_DELETED`. The item was removed (`deleteMenuItemOnBehalf`) while its version waited for review. |
| `error_menu_version_pending` | `ErrorEnvelope` | 409 | `409` · `MENU_VERSION_PENDING`. `updateMenuItemOnBehalf` with a claim-bearing field while the restaurant's own edit is in the review queue. A restaurant's edit is never silently discarded. |
| `error_not_found` | `ErrorEnvelope` | 404 | `404` · `NOT_FOUND`. A principal with **no relationship** to a subject gets 404 — existence is never leaked. 403 means 'you can see this but may not do that'. |
| `error_offer_already_taken` | `ErrorEnvelope` | 409 | `409` · `OFFER_ALREADY_TAKEN`. Already SCREAMING_SNAKE before the normalisation — the rider spec's spelling. |
| `error_offer_expired` | `ErrorEnvelope` | 409 | `409` · `OFFER_EXPIRED`. **A collision case**: `offer_expired` (platform) and `OFFER_EXPIRED` (rider) were two members of one enum. They are now one. |
| `error_otp_incorrect` | `ErrorEnvelope` | 401 | `401` · `OTP_INCORRECT`. **A collision case**: the auth `otp_incorrect` and the proof-of-delivery `OTP_INCORRECT` collapsed into one member. Disambiguate by endpoint, not by code. |
| `error_pod_method_mismatch` | `ErrorEnvelope` | 422 | `422` · `POD_METHOD_MISMATCH`. `MEET_AT_DOOR`/`MEET_IN_LOBBY` map to OTP proof of delivery; the rest map to photo (contradiction log #6). Pairs with `assignment_otp_pod_required`. |
| `error_price_out_of_range` | `ErrorEnvelope` | 422 | `422` · `PRICE_OUT_OF_RANGE`. The catalogue price band. The restaurant sets its own price; it is still never a price a client sends for an order. |
| `error_prohibited_ingredient` | `ErrorEnvelope` | 422 | `422` · `PROHIBITED_INGREDIENT`. Rejected outright, before review. The same check runs for restaurants and for admins editing on their behalf. |
| `error_province_not_served` | `ErrorEnvelope` | 422 | `422` · `PROVINCE_NOT_SERVED`. **A collision case**: `province_not_served` (pricing) and `PROVINCE_NOT_SERVED` (address) merged. Gated by `getPublicConfig.served_provinces` (O-05). |
| `error_quote_expired` | `ErrorEnvelope` | 409 | `409` · `QUOTE_EXPIRED`. Was `quote_expired`. Pairs with the `quote_expired` fixture. |
| `error_quote_stale` | `ErrorEnvelope` | 409 | `409` · `QUOTE_STALE`. **Was `quote_stale` before the normalisation.** The server re-executes `Quote()` on `createOrder` and returns this with the new quote embedded in `details`; nothing server-signed is ever echoed back by the client (contradiction log #17). |
| `error_rate_limited` | `ErrorEnvelope` | 429 | `429` · `RATE_LIMITED`. Was `rate_limited`. Also the code on the realtime `error` control frame at the 20 frames/second soft limit. |
| `error_register_restaurant_rate_limited` | `ErrorEnvelope` | 429 | `429` · `RATE_LIMITED` from `registerRestaurant`: more than 5 restaurant sign-ups from one client address in an hour (docs/spec/03-restaurant.md, "R-01 — Restaurant account signup"). Checked before the password is hashed, so nothing was created; the response carries `Retry-After` in seconds. |
| `error_reset_token_not_valid` | `ErrorEnvelope` | 400 | `400` · `TOKEN_CONSUMED`. `resetPassword` with a token that expired (30 minutes), was already used, or never existed. One body for all three, so a link cannot be probed. The app offers "Send a new link" (`requestPasswordReset`). |
| `error_restaurant_closed` | `ErrorEnvelope` | 409 | `409` · `RESTAURANT_CLOSED`. Was `restaurant_closed`. Pairs with `restaurant_availability_closed_hours`. |
| `error_review_edit_window_closed` | `ErrorEnvelope` | 409 | `409` · `REVIEW_EDIT_WINDOW_CLOSED`. C-38 rule 2: a rating is editable for 24 h from its own `created_at`, then frozen — replacing it past that window is rejected rather than silently overwritten. |
| `error_review_window_closed` | `ErrorEnvelope` | 409 | `409` · `REVIEW_WINDOW_CLOSED`. C-38 rule 4 (scoped): `submitOrderRating` on an order that is not DELIVERED/COMPLETED, has no rider assigned for the rider half, or is more than 14 days past `delivered_at`. |
| `error_rider_under_18` | `ErrorEnvelope` | 422 | `422` · `AGE_REQUIREMENT_NOT_MET`. Approving a rider whose date of birth makes them under 18. No role can override it, and the application stays in review. |
| `error_staff_email_in_use` | `ErrorEnvelope` | 409 | `409` · `EMAIL_IN_USE`. `createStaffUser` for an email that already has a live account. No invite is sent. |
| `error_totp_code_incorrect` | `ErrorEnvelope` | 422 | `422` · `INVALID_CREDENTIALS`. `verifyTotpEnrolment` with a code that does not match the authenticator. Enrolment stays open: the person types the next code, they do not start again. |
| `error_unknown_field` | `ErrorEnvelope` | 422 | `422` · `UNKNOWN_FIELD`. The decoder runs with `DisallowUnknownFields`. `is_accepting` against `is_accepting_orders` is a 422 at the boundary, not a cheerful 200 over an unchanged row — the exact bug this contract exists to kill. |
| `error_validation_failed` | `ErrorEnvelope` | 422 | `422` · `VALIDATION_FAILED`. Per-field detail lives in `error.details` as `FieldError[]` (contradiction log #2). Note the enum message: `CALL_ON_ARRIVAL` was dropped in favour of the platform's five values (contradiction log #6). |

### halal

Badges, certificates, checks and issuing bodies — the platform's core promise. — 25 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `certification_panel_certified` | `CertificationPanel` | 200 | The customer-facing certification panel in `CERTIFIED`. |
| `certification_panel_expired` | `CertificationPanel` | 200 | The customer-facing certification panel in `EXPIRED`. |
| `certification_panel_expiring_soon` | `CertificationPanel` | 200 | The customer-facing certification panel in `EXPIRING_SOON`. |
| `certification_panel_unverified` | `CertificationPanel` | 200 | The customer-facing certification panel in `UNVERIFIED`. |
| `halal_badge_certified` | `HalalBadge` | 200 | The green badge. Certifying body and expiry both present. |
| `halal_badge_expired` | `HalalBadge` | 200 | Red. Never rendered on a customer surface — the restaurant 404s. |
| `halal_badge_expiring_soon` | `HalalBadge` | 200 | Amber. 18 days left; body and expiry present. |
| `halal_badge_unverified` | `HalalBadge` | 200 | No body, no expiry. Never rendered on a customer surface. |
| `halal_certificate_expired` | `HalalCertificate` | 200 | **Expired** nine days ago. The restaurant 404s from every customer read path; the admin and owner surfaces still show this. |
| `halal_certificate_expiring_tomorrow` | `HalalCertificate` | 200 | The tightest boundary: expires **tomorrow**. Any 'days remaining' arithmetic that is off by one shows up here. |
| `halal_certificate_expiring_within_30_days` | `HalalCertificate` | 200 | **Expiring within 30 days** — expires in 18 days. Drives `EXPIRING_SOON` on the customer badge; the restaurant keeps trading (contradiction log #19). |
| `halal_certificate_status_approved` | `HalalCertificate` | 200 | `status = APPROVED`. Decided in favour. Same as `halal_certificate_valid`. |
| `halal_certificate_status_expired` | `HalalCertificate` | 200 | `status = EXPIRED`. Lapsed on its own expiry date. |
| `halal_certificate_status_pending` | `HalalCertificate` | 200 | `status = PENDING`. Uploaded, transcribed, not yet decided. `checks` are NOT_ASSESSED. |
| `halal_certificate_status_rejected` | `HalalCertificate` | 200 | `status = REJECTED`. Refused with `ISSUER_NOT_ACCEPTED` — the issuer is not on the O-02 list, so `H2_ISSUER_ACCEPTED` fails. **Until the client seeds that list, no restaurant can be certified.** |
| `halal_certificate_status_revoked` | `HalalCertificate` | 200 | `status = REVOKED`. Withdrawn by the issuer or by us after the fact. |
| `halal_certificate_status_superseded` | `HalalCertificate` | 200 | `status = SUPERSEDED`. Replaced by a renewal. Kept for audit. |
| `halal_certificate_valid` | `HalalCertificate` | 200 | **Valid**: approved, all seven H-checks PASS, 211 days of validity remaining. |
| `halal_issuing_bodies_empty` | `array&lt;HalalIssuingBody&gt;` | 200 | **The list is empty.** Not launch-day reality any more — O-02 is answered (S-11) and three bodies are seeded — but kept as the degenerate case: with no accepted issuer, `H2_ISSUER_ACCEPTED` fails for every certificate and no restaurant can be certified. A client must render this without implying the platform is broken. |
| `halal_issuing_bodies_seed` | `array&lt;HalalIssuingBody&gt;` | 200 | **The launch allowlist** (decision S-11). A certificate from ANY ONE of these satisfies `H2_ISSUER_ACCEPTED`. Extensible at runtime by a super admin, so this is a starting registry, not a closed set. |
| `halal_issuing_body_accepted` | `HalalIssuingBody` | 200 | `status = ACCEPTED`. On the list. Promotion to this state is gated to a super admin (O-02). |
| `halal_issuing_body_proposed` | `HalalIssuingBody` | 200 | `status = PROPOSED`. Suggested by a reviewer; **not yet usable**. `H2_ISSUER_ACCEPTED` fails against it. |
| `halal_issuing_body_rejected` | `HalalIssuingBody` | 200 | `status = REJECTED`. Considered and refused. |
| `halal_issuing_body_retired` | `HalalIssuingBody` | 200 | `status = RETIRED`. No longer issuing; existing certificates stand until expiry. |
| `halal_issuing_body_suspended` | `HalalIssuingBody` | 200 | `status = SUSPENDED`. Temporarily not accepted, pending an investigation. |

### handoff

The package-seal chain of custody — every `PackageSeal` status, `HandoffEvent` type, and the bind/pickup-scan/delivery-scan/tamper-report results. — 13 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `handoff_event_delivery` | `HandoffEvent` | 200 | The rider's delivery scan, with an optional POD photo attached. |
| `handoff_event_delivery_tamper_flagged` | `HandoffEvent` | 200 | `seal_intact:false` at the rider's own scan — identity still held (this really is the assigned rider, at the door), so the delivery is still recorded; the integrity flag is evidence, not a block. |
| `handoff_event_pickup` | `HandoffEvent` | 200 | The rider's pickup scan — identity and integrity both held. |
| `handoff_event_seal` | `HandoffEvent` | 200 | The bind: restaurant staff scanned the physical label and the token was minted. |
| `handoff_event_tamper_report` | `HandoffEvent` | 200 | Filed by the customer after delivery. No nonce (not a QR proof) — opens the dispute flow (A-33/A-35). |
| `handoff_scan_delivery` | `HandoffScanResult` | 200 | scanDelivery's 200: PICKED_UP → DELIVERED, gated on the same physical token scoped to the DELIVERY proof. |
| `handoff_scan_pickup` | `HandoffScanResult` | 200 | scanPickup's 200: the proof and its effect together — the order has already advanced to PICKED_UP. |
| `handoff_tamper_report` | `HandoffScanResult` | 200 | reportTamper's 200: DELIVERED → DISPUTED. Never a money decision by itself — it hands the scan-and-photo trail to the dispute flow (A-33/A-35). |
| `seal_bound` | `PackageSeal` | 200 | Bound at packing; `qr_token` is what the restaurant renders as the QR affixed to the package. |
| `seal_delivery_verified` | `PackageSeal` | 200 | Both proofs cleared: identity held at pickup and at the door. |
| `seal_issued` | `PackageSeal` | 200 | Platform-known stock, not yet bound to an order. The only status where `order_id` and `qr_token` are null. |
| `seal_pickup_verified` | `PackageSeal` | 200 | The rider's pickup scan verified the signature, order binding and single-use nonce. |
| `seal_tamper_reported` | `PackageSeal` | 200 | A scan (`seal_intact:false`) or the customer's own tamper report flagged this seal. The identity checks still passed — this is an integrity signal, not an identity failure — and never auto-fails the order. |

### onboarding

Restaurant and rider onboarding, profiles, vehicles and trading state. — 35 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `restaurant_heartbeat` | `RestaurantHeartbeat` | 200 | The tablet's liveness ping response. |
| `restaurant_onboarding_active` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = ACTIVE`. Live and trading. Terminal, happy. |
| `restaurant_onboarding_documents_approved` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_APPROVED`. Documents cleared; Stripe Connect is next. |
| `restaurant_onboarding_documents_pending` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_PENDING`. Profile accepted; the five-document pack is outstanding. |
| `restaurant_onboarding_documents_rejected` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_REJECTED`. **At least one document was rejected with a reason.** The applicant must resubmit exactly the failed documents. |
| `restaurant_onboarding_documents_review` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_REVIEW`. Pack submitted and locked. The applicant can only wait. |
| `restaurant_onboarding_email_verified` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = EMAIL_VERIFIED`. Email confirmed; the profile form is next. |
| `restaurant_onboarding_menu_pending` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = MENU_PENDING`. Payouts enabled; the first menu must exist before going live. |
| `restaurant_onboarding_payout_pending` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = PAYOUT_PENDING`. Connect onboarding started but `currently_due` is non-empty. |
| `restaurant_onboarding_profile_pending` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = PROFILE_PENDING`. Profile form open — legal name, address, GST/HST number. |
| `restaurant_onboarding_registered` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = REGISTERED`. Account created, email not yet verified. Nothing else is reachable. |
| `restaurant_onboarding_withdrawn` | `RestaurantOnboardingStatus` | 200 | `onboarding_state = WITHDRAWN`. The applicant withdrew. Terminal. |
| `restaurant_open_state_closed_holiday` | `RestaurantAvailability` | 200 | `open_state = CLOSED_HOLIDAY`. An hours override closed today. R-22 evaluates these in strict precedence. |
| `restaurant_open_state_closed_hours` | `RestaurantAvailability` | 200 | `open_state = CLOSED_HOURS`. Outside the trading calendar. R-22 evaluates these in strict precedence. |
| `restaurant_open_state_closed_offline` | `RestaurantAvailability` | 200 | `open_state = CLOSED_OFFLINE`. No tablet heartbeat within the window; the kitchen is presumed away. R-22 evaluates these in strict precedence. |
| `restaurant_open_state_closed_suspended` | `RestaurantAvailability` | 200 | `open_state = CLOSED_SUSPENDED`. Admin suspension. The owner cannot reopen. R-22 evaluates these in strict precedence. |
| `restaurant_open_state_closed_toggle` | `RestaurantAvailability` | 200 | `open_state = CLOSED_TOGGLE`. `is_accepting_orders: false` — the explicit switch. R-22 evaluates these in strict precedence. |
| `restaurant_open_state_open` | `RestaurantAvailability` | 200 | `open_state = OPEN`. Trading. R-22 evaluates these in strict precedence. |
| `restaurant_open_state_paused` | `RestaurantAvailability` | 200 | `open_state = PAUSED`. Owner pressed pause; `is_accepting_orders` is untouched underneath. R-22 evaluates these in strict precedence. |
| `restaurant_profile` | `RestaurantProfile` | 200 | A submitted restaurant profile: Ontario address, CRA-form GST/HST number, America/Toronto. Server-controlled fields (`is_approved`, `account_state`, `commission_rate_bps`, anything `_cents`) do not exist on this DTO at all. |
| `restaurant_registration` | `RestaurantRegistration` | 201 | The response to `registerRestaurant` — the only public write that creates a partner account. |
| `restaurant_staff_list` | `array&lt;RestaurantStaffUser&gt;` | 200 | A restaurant's own staff roster (`listRestaurantStaff`), scoped to the caller's restaurant — never platform staff and never another restaurant's accounts. Restaurant-scoped counterpart to admin's platform-role-only `/v1/admin/staff`. |
| `rider_onboarding_active` | `RiderOnboardingStatus` | 200 | `onboarding_state = ACTIVE`. Approved and able to go online. Terminal, happy. |
| `rider_onboarding_documents_approved` | `RiderOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_APPROVED`. Documents cleared; payout setup is next. |
| `rider_onboarding_documents_pending` | `RiderOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_PENDING`. Six document types outstanding. |
| `rider_onboarding_documents_rejected` | `RiderOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_REJECTED`. **Rejected with a reason** — e.g. the licence photo is cropped. |
| `rider_onboarding_documents_review` | `RiderOnboardingStatus` | 200 | `onboarding_state = DOCUMENTS_REVIEW`. Pack submitted and locked. |
| `rider_onboarding_payout_pending` | `RiderOnboardingStatus` | 200 | `onboarding_state = PAYOUT_PENDING`. Connect started, requirements outstanding. |
| `rider_onboarding_phone_verified` | `RiderOnboardingStatus` | 200 | `onboarding_state = PHONE_VERIFIED`. OTP verified; identity capture is next. |
| `rider_onboarding_profile_pending` | `RiderOnboardingStatus` | 200 | `onboarding_state = PROFILE_PENDING`. Name, date of birth, address. Under 18 is `UNDERAGE`. |
| `rider_onboarding_registered` | `RiderOnboardingStatus` | 200 | `onboarding_state = REGISTERED`. Phone entered, OTP not yet verified. |
| `rider_onboarding_vehicle_pending` | `RiderOnboardingStatus` | 200 | `onboarding_state = VEHICLE_PENDING`. Vehicle type and plate. `ON_FOOT` skips plate and insurance. |
| `rider_profile` | `RiderProfile` | 200 | A submitted rider profile with an Ontario address and a 1994 date of birth. |
| `rider_vehicle_on_foot` | `RiderVehicle` | 200 | `ON_FOOT`: no plate, no make, no model, no insurance requirement. Every vehicle-shaped field is null at once (`FIELD_NOT_APPLICABLE`). |
| `rider_vehicle_scooter` | `RiderVehicle` | 200 | A scooter with a plate and insurance on file. |

### orders

The 14 `OrderState` values, per-audience projections, tracking and receipts. — 44 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `order_admin_view_completed` | `OrderAdminView` | 200 | The full admin projection: timeline, dispatch history across two waves, payment, the ledger decomposition and `pii_revealed: false` (unmasking needs a recorded justification). |
| `order_admin_view_disputed` | `OrderAdminView` | 200 | A delivered order in dispute with a partial refund awaiting approval and a liability split that puts the whole amount on the restaurant (O-04 is open; the split is computed at authorisation and stored). |
| `order_admin_view_failed_no_rider` | `OrderAdminView` | 200 | Three dispatch waves, eight riders offered, nobody accepted. The order failed and was fully refunded — the case `admin.dispatch_failure` fires on. |
| `order_arrived` | `OrderCustomerView` | 200 | Rider is at the drop-off, proof of delivery not yet recorded. |
| `order_authorized` | `OrderCustomerView` | 200 | Card authorised, not captured. The restaurant has not been asked yet. Cancellation is still free. |
| `order_cancelled` | `OrderCustomerView` | 200 | Terminal. Cancelled by the customer before acceptance, so the authorisation was voided rather than captured and refunded. |
| `order_completed` | `OrderCustomerView` | 200 | Terminal, happy. Receipt available, rating prompt allowed, refund window open. |
| `order_created` | `OrderCustomerView` | 200 | Order exists, payment not yet authorised. 3-D Secure lives here — the order stays CREATED under its 15-minute deadline while `payment.action_required` is outstanding. |
| `order_delivered` | `OrderCustomerView` | 200 | Proof of delivery recorded. Not yet financially settled. |
| `order_disputed` | `OrderCustomerView` | 200 | Delivered, then disputed by the customer. Support owns it; a refund is in flight. |
| `order_failed` | `OrderCustomerView` | 200 | Terminal. Dispatch exhausted every wave and found no rider (`cancel_reason: NO_RIDER_FOUND`). Fully refunded. |
| `order_large_tip` | `OrderCustomerView` | 200 | A CAD 100.00 tip — larger than the food. Catches percentage displays and fixed-width currency columns. |
| `order_list_active` | `array&lt;OrderSummary&gt;` | 200 | The one order a customer may have in flight (`status_group=ACTIVE`). |
| `order_list_empty` | `array&lt;OrderSummary&gt;` | 200 | A customer who has never ordered. First-run empty state. |
| `order_list_past` | `array&lt;OrderSummary&gt;` | 200 | Order history: completed, cancelled, rejected and resolved side by side, so the history row's state chip is exercised across colours. |
| `order_no_active` | `OrderCustomerView|null` | 200 | `getActiveOrder` with nothing in flight. The contract returns **null data**, not 404 and not an empty array — one active order per customer (contradiction log #24). |
| `order_picked_up` | `OrderCustomerView` | 200 | Rider has the bag. This is when `rider.location` starts publishing to the customer and the map goes live. |
| `order_pickup_no_address` | `OrderCustomerView` | 200 | A PICKUP order: `delivery_address` is null, `rider` is null, `dispatch_state` is null, delivery fee is 0. Every delivery-shaped affordance must disappear. |
| `order_preparing` | `OrderCustomerView` | 200 | Accepted and captured; the kitchen is cooking and dispatch is searching for a rider. Cancellation is no longer free. |
| `order_rating_food_and_rider` | `OrderRating` | 200 | Both targets rated in one `submitOrderRating` call — a 4-star food review with tags and a 5-star rider rating with tags, both `PUBLISHED` (no PII/profanity trip). |
| `order_rating_food_pending_moderation` | `OrderRating` | 200 | The food review's free text matched the auto-moderation rules (C-38 rule 6: contains an email/phone/URL, or the customer has had 2+ reviews removed in 90 days) — `PENDING_MODERATION` and excluded from `restaurants.rating_avg` until a moderator acts. |
| `order_rating_unrated` | `OrderRating` | 200 | The customer has not rated this order yet. Neither half is an error state — C-38: skipping the post-delivery prompt is a first-class outcome, not a defect. |
| `order_ready_for_pickup` | `OrderCustomerView` | 200 | Food is on the pass, a rider is assigned and en route to the restaurant. |
| `order_rejected` | `OrderCustomerView` | 200 | Terminal. The restaurant rejected it — `reject_reason: ITEM_UNAVAILABLE`. The authorisation is voided; no money ever moved. |
| `order_resolved` | `OrderCustomerView` | 200 | Terminal. The dispute was settled with a partial refund and the case closed. |
| `order_restaurant_pending` | `OrderCustomerView` | 200 | The 180-second acceptance window is running (decision R-04). `deadline_at` is the only source of the countdown — never a local constant. |
| `order_single_line` | `OrderCustomerView` | 200 | One line, quantity 1, no variant, no add-ons, no special instructions, no delivery notes — the sparsest legal order. |
| `order_zero_tip` | `OrderCustomerView` | 200 | A delivered order with **no tip**. The tip row still renders at $0.00, and the rider's earnings for this delivery are the delivery fee alone. |
| `receipt_pickup_zero_tip` | `Receipt` | 200 | Pickup, no tip, no delivery address. Two whole money rows are absent rather than zeroed. |
| `receipt_standard` | `Receipt` | 200 | A completed delivery's receipt. Carries **both** tax registration numbers so either answer to O-01 (who is the supplier of record) renders without a schema change. |
| `receipt_with_refund` | `Receipt` | 200 | The same receipt after a settled partial refund. Both spellings of the reason code exist in the enum (`ITEM_MISSING` and `MISSING_ITEMS`) — contradiction log #8 is still OPEN and this fixture uses the customer-spec spelling. |
| `restaurant_order_picked_up` | `OrderRestaurantView` | 200 | Collected. The tablet's job is done. |
| `restaurant_order_preparing` | `OrderRestaurantView` | 200 | Accepted and overdue (`is_late: true`). The address is now present. |
| `restaurant_order_queue_busy` | `array&lt;OrderRestaurantView&gt;` | 200 | Friday 19:00: two pending, three preparing, one late, one ready. Sorted with RESTAURANT_PENDING first by `deadline_at` ascending, per R-23. |
| `restaurant_order_queue_empty` | `array&lt;OrderRestaurantView&gt;` | 200 | A quiet kitchen — no orders in any state. The tablet's idle screen. |
| `restaurant_order_ready_for_pickup` | `OrderRestaurantView` | 200 | On the pass, rider assigned with an ETA to the restaurant. |
| `restaurant_order_rejected` | `OrderRestaurantView` | 200 | Rejected by the kitchen for ITEM_UNAVAILABLE. |
| `restaurant_order_restaurant_pending` | `OrderRestaurantView` | 200 | The incoming-order card with 80 s left on the 180 s window. **No delivery address yet** — §5 withholds it until acceptance. |
| `tracking_arrived` | `OrderTracking` | 200 | Rider at the door; the countdown is to handover. |
| `tracking_degraded_gps` | `OrderTracking` | 200 | The rider's phone has not reported for 90 seconds — `accuracy_m` is 180 m and the position is stale. The map must degrade honestly, not interpolate. |
| `tracking_delivered` | `OrderTracking` | 200 | Handover done; the map freezes at the last position. |
| `tracking_picked_up` | `OrderTracking` | 200 | Live rider position, precise (the customer projection). |
| `tracking_preparing` | `OrderTracking` | 200 | Kitchen cooking, no rider yet — the map shows the restaurant only. |
| `tracking_ready_for_pickup` | `OrderTracking` | 200 | Rider assigned and approaching the restaurant. |

### payments

The 8 `PaymentState` values, saved cards and setup intents. — 12 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `payment_canceled` | `OrderPayment` | 200 | The authorisation was voided — restaurant rejected or the customer cancelled in time. **No money ever moved.** |
| `payment_failed` | `OrderPayment` | 200 | The card was declined at capture (`capture_failed` / `card_declined`). The order is cancelled and nothing is owed. |
| `payment_methods_at_limit` | `array&lt;PaymentMethod&gt;` | 200 | Ten saved cards — the cap. Adding an eleventh is `409 PAYMENT_METHOD_LIMIT`. |
| `payment_methods_empty` | `array&lt;PaymentMethod&gt;` | 200 | No card on file. Checkout must route to the add-card sheet rather than failing. |
| `payment_methods_list` | `array&lt;PaymentMethod&gt;` | 200 | Three saved cards, one default. |
| `payment_processing` | `OrderPayment` | 200 | Submitted to the PSP, outcome unknown. The UI must not claim success. |
| `payment_requires_action` | `OrderPayment` | 200 | **3-D Secure challenge outstanding.** This is a normal path, not an error: the order stays CREATED under its 15-minute deadline and `client_secret` is present for the Stripe SDK. |
| `payment_requires_capture` | `OrderPayment` | 200 | Authorised, not captured. Capture happens only when the restaurant accepts; a rejection or timeout voids it. |
| `payment_requires_confirmation` | `OrderPayment` | 200 | Card attached, waiting on `confirm`. A brief transient state. |
| `payment_requires_payment_method` | `OrderPayment` | 200 | No card attached yet. Checkout has not been attempted. |
| `payment_succeeded` | `OrderPayment` | 200 | Captured. The happy terminal state. |
| `setup_intent` | `SetupIntent` | 200 | The client secret for attaching a new card. The card never touches our servers. |

### platform

Auth, config, addresses, notifications, Connect and health. — 25 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `addresses_empty` | `array&lt;Address&gt;` | 200 | No address yet — the state that makes every distance and ETA uncomputable (`NO_ADDRESS` availability). |
| `addresses_list` | `array&lt;Address&gt;` | 200 | Three saved addresses, one default, one with no unit or buzzer. |
| `connect_status_complete` | `ConnectStatus` | 200 | Stripe Connect fully onboarded: payouts enabled, nothing due. |
| `connect_status_requirements_due` | `ConnectStatus` | 200 | Payouts disabled with `currently_due` and `past_due` surfaced **verbatim** from Stripe — we do not paraphrase requirement ids. |
| `customer_profile` | `CustomerProfile` | 200 | C-03: `first_name`/`last_name`, never a single `name`. `phone_e164` is read-only here — sending it is `422 UNKNOWN_FIELD`. |
| `dependency_report` | `DependencyReport` | 200 | Per-dependency detail for the internal status page. |
| `health_ok` | `HealthStatus` | 200 | Liveness. Never touches a dependency. |
| `notifications_empty` | `array&lt;Notification&gt;` | 200 | Nothing to show. The bell must not render a zero badge. |
| `notifications_list` | `array&lt;Notification&gt;` | 200 | Mixed read and unread notifications across channels and priorities. |
| `otp_challenge` | `OtpChallenge` | 200 | The OTP request response. The wire carries `resend_after_s` and `expires_at` and the client renders the **server's** cooldown — rate limits are not contract constants (contradiction log #23). |
| `principal_customer` | `Principal` | 200 | `GET /v1/auth/me` for a customer — one account, one role, no restaurant scope. |
| `public_config` | `PublicConfig` | 200 | Client bootstrap. Deliberately exposes **no fee parameter** — no client can compute a price (contradiction log #22). `restaurant_response_window_seconds` is 180 (decision R-04) and `served_provinces` gates ordering (O-05). |
| `readiness_ok` | `ReadinessStatus` | 200 | Every dependency reachable. |
| `realtime_ticket` | `RealtimeTicket` | 200 | A single-use 30-second ticket plus the channels this principal may subscribe to. Mint a fresh one per connection attempt; never cache or reuse. |
| `session_grant_customer` | `SessionGrant` | 200 | A customer session issued by phone OTP, with `next_route` telling the app where to land — the client contains no branching tree of its own (P-04). |
| `session_grant_password_changed` | `SessionGrant` | 200 | `changePassword` from the admin console: every other session was revoked and this one re-issued. Web, so the refresh token is in the `hg_rt` cookie and null here. |
| `session_next_route_active_delivery` | `SessionGrant` | 200 | `next_route = ACTIVE_DELIVERY`. A rider with a delivery in progress resumes it, wherever they were. |
| `session_next_route_app_update_required` | `SessionGrant` | 200 | `next_route = APP_UPDATE_REQUIRED`. Below `min_supported_version`. A hard stop. |
| `session_next_route_home` | `SessionGrant` | 200 | `next_route = HOME`. Fully onboarded; go to the main surface. |
| `session_next_route_onboarding_documents` | `SessionGrant` | 200 | `next_route = ONBOARDING_DOCUMENTS`. Mid-onboarding; documents outstanding. |
| `session_next_route_onboarding_rejected` | `SessionGrant` | 200 | `next_route = ONBOARDING_REJECTED`. A document was rejected; the app must land on the reason. |
| `session_next_route_order_tracking` | `SessionGrant` | 200 | `next_route = ORDER_TRACKING`. A customer with a live order lands on tracking. |
| `session_next_route_profile_capture` | `SessionGrant` | 200 | `next_route = PROFILE_CAPTURE`. First sign-in — we have a phone and nothing else. |
| `session_next_route_suspended` | `SessionGrant` | 200 | `next_route = SUSPENDED`. Account suspended; a dead end with an explanation. |
| `totp_enrolment` | `TotpEnrolment` | 200 | Two-step sign-in enrolment, step one: the authenticator URI and ten recovery codes, shown **once**. Step two is `verifyTotpEnrolment` with a live code. |

### realtime

Scripted WebSocket sequences that drive a screen through a whole lifecycle. — 8 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `realtime_control_frames` | `RealtimeEvent[]` | 200 | Every control frame, `seq: 0` and no channel: `hello`, `subscribed`, `ping`, `subscribe_error` (`not_found` for someone else's order — never `forbidden`), `unsubscribed`, `resume_complete` with `truncated: true`, `reauth_required` and an `error`. |
| `realtime_gap_and_resume` | `RealtimeEvent[]` | 200 | A deliberate **seq gap** (3 → 7). A conforming client detects `seq > last_seq + 1`, sends `resume {channel, after_seq: 3}`, and receives the missing events followed by `resume_complete`. Use this to prove the gap-detection path before shipping. |
| `realtime_order_happy_path` | `RealtimeEvent[]` | 200 | **The whole order lifecycle in 58 seconds of wall clock**, 24 events across the order, restaurant and rider channels: created → authorized → restaurant offered → accepted → captured → dispatch searching → offered → assigned → ready → picked up → three location pings → arrived → delivered → completed. Drive a tracking screen end to end with `?scenario=realtime_order_happy_path`. |
| `realtime_order_restaurant_rejects` | `RealtimeEvent[]` | 200 | The restaurant rejects at 14 s. The authorisation is **voided**, not captured and refunded — no money ever moved. |
| `realtime_order_timeout_no_rider` | `RealtimeEvent[]` | 200 | Three dispatch waves, nobody accepts, the order fails and is fully refunded. Ends with `admin.dispatch_failure` on `admin:ops`. |
| `realtime_payment_action_required` | `RealtimeEvent[]` | 200 | 3-D Secure is a **normal** path: `payment.action_required` fires, the order stays `CREATED` under its 15-minute deadline, then authorises and proceeds. |
| `realtime_payment_failed` | `RealtimeEvent[]` | 200 | The card is declined at capture. The order cancels and the customer owes nothing. |
| `realtime_rider_reassigned` | `RealtimeEvent[]` | 200 | The assigned rider drops out mid-delivery. The customer sees `dispatch.unassigned` then a second `dispatch.assigned`; the old rider is force-unsubscribed from the order channel within 2 seconds. |

### refunds

The 10 `RefundState` values, liability splits and approval requests. — 14 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `refund_approval_request_pending` | `RefundApprovalRequest` | 202 | A refund over the agent's cap: `202 Accepted` with the approval request, not a `201` refund. The two-response shape of `issueRefund`. |
| `refund_approved` | `Refund` | 200 | Approved, not yet sent to the PSP. |
| `refund_authorised` | `Refund` | 200 | Authorised against the captured payment; the ledger entry exists. |
| `refund_cancelled` | `Refund` | 200 | Withdrawn before authorisation — no money moved. |
| `refund_declined` | `Refund` | 200 | A human declined the request, with a reason. |
| `refund_failed` | `Refund` | 200 | The PSP rejected the refund. Carries `failure_message`; support must intervene, and the customer must never be told they were refunded. |
| `refund_full_never_delivered` | `Refund` | 200 | A full refund for an order that never arrived. Note both spellings survive in the enum (`NEVER_DELIVERED` / `ORDER_NEVER_ARRIVED`) — contradiction log #8 is OPEN. |
| `refund_goodwill_admin` | `Refund` | 200 | Admin goodwill — the only refund carrying a client-supplied `amount_cents`, capped and dual-approved (one of exactly three money-in-request allowlist entries). |
| `refund_list_empty` | `array&lt;Refund&gt;` | 200 | No refunds on this account — the common case. |
| `refund_pending_approval` | `Refund` | 200 | Above the agent's cap, waiting on a second approver (`SELF_APPROVAL_FORBIDDEN` blocks the requester from approving their own). |
| `refund_requested` | `Refund` | 200 | Customer asked; nothing has been decided or authorised. |
| `refund_settled` | `Refund` | 200 | Funds are back on the card. The only state that may say 'refunded'. |
| `refund_submitted` | `Refund` | 200 | Sent to Stripe, awaiting acknowledgement. |
| `refund_succeeded` | `Refund` | 200 | Stripe accepted it. **Customer copy still reads 'refund in progress'** until SETTLED — money has not reached the card yet. |

### rider

Availability, dashboard, earnings and payouts. — 22 scenarios.

| Scenario | Schema | Status | Represents |
|---|---|---:|---|
| `earning_entries_empty` | `array&lt;EarningEntry&gt;` | 200 | No entries at all — pairs with `earnings_summary_zero`. |
| `earning_entries_mixed` | `array&lt;EarningEntry&gt;` | 200 | One of every `EarningEntryType` and `EarningEntryStatus`, including a **negative** clawback. Ledger rows must handle a minus sign. |
| `earnings_summary_week` | `EarningsSummary` | 200 | A full week: 14 deliveries, delivery fees plus 100% of tips. The rate-card component fields (`base_cents`, `distance_cents`, `wait_cents`, `guarantee_topup_cents`) are present but zero — pure pass-through at launch (contradiction log #7). |
| `earnings_summary_zero` | `EarningsSummary` | 200 | **Zero earnings across every bucket.** A rider who went online and got no offers. Charts must render an axis, not collapse. |
| `payout_detail_paid` | `PayoutDetail` | 200 | A paid weekly payout expanded into its constituent earning entries. |
| `payout_draft` | `Payout` | 200 | The week is still accruing. Nothing is owed yet. |
| `payout_failed` | `Payout` | 200 | The transfer bounced — usually a Connect requirement went `past_due`. |
| `payout_held` | `Payout` | 200 | Held by compliance pending a review. The partner sees the hold, not the reason. |
| `payout_list_empty` | `array&lt;Payout&gt;` | 200 | No payout has ever run for this partner. |
| `payout_paid` | `Payout` | 200 | Landed. **No minimum** for either partner type (contradiction log #16). |
| `payout_ready` | `Payout` | 200 | Week closed, amount final, waiting for Monday's run. |
| `payout_transferred` | `Payout` | 200 | Stripe accepted the transfer; not yet in the bank. |
| `payout_transferring` | `Payout` | 200 | Submitted to Stripe Connect. |
| `restaurant_payout_history` | `array&lt;Payout&gt;` | 200 | A restaurant's payout history, newest first: this week still accruing, last week mid-transfer on Monday's run, three paid weeks before it. Weekly, automatic, no minimum. |
| `rider_availability_offline` | `RiderAvailability` | 200 | Rider is off shift. No offers will be sent. |
| `rider_availability_on_delivery` | `RiderAvailability` | 200 | Carrying an order. Only one active delivery at a time (`ACTIVE_DELIVERY_IN_PROGRESS`). |
| `rider_availability_online_idle` | `RiderAvailability` | 200 | Online, no assignment, waiting for an offer. |
| `rider_availability_online_stale` | `RiderAvailability` | 200 | Online but the phone has not reported a position recently — offers are suppressed until it does. |
| `rider_dashboard_active` | `RiderDashboard` | 200 | A rider mid-shift with an assignment in progress and earnings accrued today. |
| `rider_dashboard_zero_earnings` | `RiderDashboard` | 200 | **A rider with zero earnings** — approved this morning, no deliveries yet. Every money field is 0 and every count is 0. The dashboard must read as 'not started', never as an error or a blank screen. |
| `rider_me` | `RiderMe` | 200 | The rider's own bootstrap payload — identity, onboarding state, availability and what screen to land on. |
| `rider_position_ack` | `RiderPositionAck` | 202 | Acknowledgement of a batched position upload. Points older than the server's tolerance come back rejected (`STALE_POINT`) rather than silently dropped. |

## Tags

Filter with `GET /__mock/scenarios?tag=edge`.

| Tag | Count | Meaning |
|---|---:|---|
| `state-matrix` | 65 | One fixture per member of a closed enum. |
| `edge` | 52 | A shape that breaks naive layouts — empty, overflowing, at a boundary. |
| `rider` | 51 | Rider-facing surface. |
| `error-envelope` | 43 | A `{error}` body with a real `ErrorCode`. |
| `restaurant` | 41 | Restaurant-facing surface. |
| `admin` | 39 | Admin/support-facing surface. |
| `money` | 31 | Exercises the money path specifically. |
| `halal` | 29 | Touches the halal claim surface. |
| `empty` | 25 | Zero items. The empty state, never an error. |
| `platform` | 25 | Cross-cutting platform surface. |
| `order-state-matrix` | 24 | One per `OrderState` (all 14). |
| `error-path` | 21 | The unhappy branch a client must handle. |
| `onboarding-state-matrix` | 21 | One per onboarding state, restaurant and rider. |
| `auth` | 13 | Session and identity. |
| `review-queue` | 13 | An admin review queue item. |
| `assignment-state-matrix` | 12 | One per `AssignmentState` (all 12). |
| `document-state-matrix` | 12 | One per `KycDocumentState`, plus rejection reasons. |
| `dispatch-state-matrix` | 10 | One per `DispatchState` (all 10). |
| `menu-editing` | 10 |  |
| `refund-state-matrix` | 10 | One per `RefundState` (all 10). |
| `boundary` | 9 | At an exact limit (quantity cap, expiry tomorrow, zero, the maximum). |
| `documents` | 9 | KYC document surface. |
| `realtime` | 9 | WebSocket, not HTTP. |
| `payment-state-matrix` | 8 | One per `PaymentState` (all 8). |
| `script` | 8 | A realtime event sequence, not a response body. |
| `payout-state-matrix` | 7 | One per `PayoutState` (all 7). |
| `certificate-status-matrix` | 6 | One per `HalalCertificateStatus` (all 6). |
| `request-body` | 6 | A request body a client sends, not a response. Registered against no operation, so the mock never serves it. |
| `tracking` | 6 | The live order-tracking screen. |
| `handoff-event-matrix` | 5 |  |
| `offer-state-matrix` | 5 | One per `OfferState` (all 5). |
| `seal-state-matrix` | 5 |  |
| `certificate` | 4 | A `HalalCertificate` at a specific point in its life. |
| `payout-run-state-matrix` | 4 | One per `PayoutRunState` (all 4). |
| `dense` | 3 | Deliberately busy — the worst case for a list or a card. |
| `ratings` | 3 |  |
| `missing-media` | 2 | No image where one is normally present. |
| `overflow` | 2 | Text long enough to break one-line layouts. |
| `blocking-decision` | 1 | Encodes an OPEN decision from `docs/decisions/README.md`. |
| `control` | 1 | Realtime control frames. |
| `degraded` | 1 | A partially-broken real-world condition (stale GPS, lost tracking). |
| `launch-critical` | 1 |  |
| `seed` | 1 |  |

## Operation coverage

137 of the contract's operations have at least one fixture registered against them; the rest are `204 No Content` or write-only operations the mock answers from the response schema. The full map lives in `index.json` under `by_operation`, and `GET /__mock/operations` serves it live.

| Operation | Default scenario | Also available |
|---|---|---|
| `acceptOffer` | `assignment_assigned` | `assignment_arrived_at_dropoff`, `assignment_arrived_at_pickup`, `assignment_cancelled_by_platform`, `assignment_delivered`, `assignment_en_route_to_dropoff`, `assignment_en_route_to_pickup`, `assignment_picked_up`, `assignment_reassigned`, `assignment_returned`, `assignment_returning`, `assignment_undeliverable` |
| `acceptOrder` | `restaurant_order_preparing` | `restaurant_order_picked_up`, `restaurant_order_ready_for_pickup`, `restaurant_order_rejected`, `restaurant_order_restaurant_pending` |
| `addCartLine` | `cart_single_line` | — |
| `attachRestaurantDocument` | `document_submitted` | `document_approved`, `document_expired`, `document_in_review`, `document_rejected`, `document_superseded` |
| `bindPackageSeal` | `seal_bound` | — |
| `cancelOrder` | `order_cancelled` | `order_arrived`, `order_authorized`, `order_completed`, `order_created`, `order_delivered`, `order_disputed`, `order_failed`, `order_picked_up`, `order_preparing`, `order_ready_for_pickup`, `order_rejected`, `order_resolved`, `order_restaurant_pending` |
| `cancelOrderAdmin` | `order_admin_view_completed` | — |
| `changePassword` | `session_grant_password_changed` | `error_breached_password`, `error_current_password_incorrect` |
| `clearCart` | `cart_empty` | — |
| `confirmUpload` | `stored_object_ready` | `stored_object_deleted`, `stored_object_pending`, `stored_object_rejected` |
| `createAddress` | `addresses_list` | — |
| `createAssignmentTransition` | `assignment_picked_up` | `assignment_arrived_at_dropoff`, `assignment_arrived_at_pickup`, `assignment_assigned`, `assignment_cancelled_by_platform`, `assignment_delivered`, `assignment_en_route_to_dropoff`, `assignment_en_route_to_pickup`, `assignment_reassigned`, `assignment_returned`, `assignment_returning`, `assignment_undeliverable` |
| `createCertificateViewUrl` | `presigned_download` | — |
| `createConnectAccount` | `connect_status_complete` | — |
| `createDocumentDownloadUrl` | `presigned_download` | — |
| `createMenuCategory` | `menu_category_created` | `error_category_name_taken`, `error_menu_locked` |
| `createMenuCategoryOnBehalf` | `menu_category_created` | `error_category_name_taken`, `error_menu_locked`, `error_menu_locked_banned` |
| `createMenuItem` | `menu_item_created_pending_review` | `error_halal_tag_not_writable`, `error_menu_locked`, `error_price_out_of_range`, `error_prohibited_ingredient` |
| `createMenuItemOnBehalf` | `menu_item_created_by_admin` | `error_halal_tag_not_writable`, `error_menu_locked`, `error_menu_locked_banned`, `error_price_out_of_range`, `error_prohibited_ingredient` |
| `createPaymentMethodSetupIntent` | `setup_intent` | — |
| `createPayoutRun` | `payout_run_queued` | — |
| `createQuote` | `quote_standard` | `quote_large_tip`, `quote_pickup`, `quote_single_line_minimum`, `quote_with_discount`, `quote_zero_tip` |
| `createRealtimeTicket` | `realtime_ticket` | — |
| `createRefund` | `refund_requested` | `refund_approved`, `refund_authorised`, `refund_cancelled`, `refund_declined`, `refund_failed`, `refund_pending_approval`, `refund_settled`, `refund_submitted`, `refund_succeeded` |
| `createRestaurantStaffUser` | `restaurant_staff_list` | — |
| `createStaffUser` | `staff_user_invited` | `error_staff_email_in_use` |
| `createUpload` | `presigned_upload` | — |
| `decideHalalCertificate` | `halal_certificate_status_approved` | `halal_certificate_status_expired`, `halal_certificate_status_pending`, `halal_certificate_status_rejected`, `halal_certificate_status_revoked`, `halal_certificate_status_superseded` |
| `decideMenuVersion` | `menu_version_approved` | `error_menu_locked`, `error_menu_locked_banned`, `error_menu_version_already_decided`, `error_menu_version_item_deleted`, `menu_version_draft`, `menu_version_pending_review`, `menu_version_rejected`, `menu_version_superseded`, `menu_version_withdrawn` |
| `decideRestaurantApplication` | `restaurant_application_approved` | `error_application_already_decided`, `error_decision_approval_reason_required`, `error_decision_rejection_reason_required` |
| `decideRiderApplication` | `rider_application_approved` | `error_application_already_decided`, `error_decision_approval_reason_required`, `error_decision_rejection_reason_required`, `error_rider_under_18`, `rider_application_changes_requested` |
| `delayOrder` | `restaurant_order_preparing` | `restaurant_order_picked_up`, `restaurant_order_ready_for_pickup`, `restaurant_order_rejected`, `restaurant_order_restaurant_pending` |
| `deleteMenuItemOnBehalf` | `error_menu_locked` | `error_menu_locked_banned` |
| `enrollTotp` | `totp_enrolment` | — |
| `getActiveOrder` | `order_preparing` | `dispatch_assigned`, `dispatch_at_customer`, `dispatch_at_restaurant`, `dispatch_carrying`, `dispatch_completed`, `dispatch_no_rider_found`, `dispatch_offered`, `dispatch_pending`, `dispatch_searching`, `dispatch_unassigned`, `order_arrived`, `order_authorized`, `order_cancelled`, `order_completed`, `order_created`, `order_delivered`, `order_disputed`, `order_failed`, `order_no_active`, `order_picked_up`, `order_ready_for_pickup`, `order_rejected`, `order_resolved`, `order_restaurant_pending` |
| `getAddress` | `addresses_list` | — |
| `getAssignment` | `assignment_en_route_to_dropoff` | `assignment_arrived_at_dropoff`, `assignment_arrived_at_pickup`, `assignment_assigned`, `assignment_cancelled_by_platform`, `assignment_delivered`, `assignment_en_route_to_pickup`, `assignment_no_instructions_no_unit`, `assignment_otp_pod_required`, `assignment_picked_up`, `assignment_reassigned`, `assignment_returned`, `assignment_returning`, `assignment_undeliverable` |
| `getCart` | `cart_many_lines` | `cart_at_quantity_cap`, `cart_empty`, `cart_has_unavailable_items`, `cart_single_line` |
| `getConnectStatus` | `connect_status_complete` | `connect_status_requirements_due` |
| `getCurrentOffer` | `offer_pending` | `offer_expired`, `offer_none`, `offer_rejected`, `offer_taken_by_another`, `offer_withdrawn`, `offer_zero_tip_low_value` |
| `getCurrentPrincipal` | `principal_customer` | — |
| `getCustomerProfile` | `customer_profile` | — |
| `getDependencyStatus` | `dependency_report` | — |
| `getHalalCertificate` | `halal_certificate_valid` | `halal_certificate_expired`, `halal_certificate_expiring_tomorrow`, `halal_certificate_expiring_within_30_days`, `halal_certificate_status_approved`, `halal_certificate_status_expired`, `halal_certificate_status_pending`, `halal_certificate_status_rejected`, `halal_certificate_status_revoked`, `halal_certificate_status_superseded` |
| `getHealth` | `health_ok` | — |
| `getHomeFeed` | `feed_sections` | `feed_empty` |
| `getOrder` | `order_preparing` | `dispatch_assigned`, `dispatch_at_customer`, `dispatch_at_restaurant`, `dispatch_carrying`, `dispatch_completed`, `dispatch_no_rider_found`, `dispatch_offered`, `dispatch_pending`, `dispatch_searching`, `dispatch_unassigned`, `order_arrived`, `order_authorized`, `order_cancelled`, `order_completed`, `order_created`, `order_delivered`, `order_disputed`, `order_failed`, `order_large_tip`, `order_picked_up`, `order_pickup_no_address`, `order_ready_for_pickup`, `order_rejected`, `order_resolved`, `order_restaurant_pending`, `order_single_line`, `order_zero_tip` |
| `getOrderAdmin` | `order_admin_view_completed` | `order_admin_view_disputed`, `order_admin_view_failed_no_rider` |
| `getOrderPayment` | `payment_succeeded` | `payment_canceled`, `payment_failed`, `payment_processing`, `payment_requires_action`, `payment_requires_capture`, `payment_requires_confirmation`, `payment_requires_payment_method` |
| `getOrderRating` | `order_rating_food_and_rider` | `order_rating_food_pending_moderation`, `order_rating_unrated` |
| `getOrderReceipt` | `receipt_standard` | `receipt_pickup_zero_tip`, `receipt_with_refund` |
| `getOrderTracking` | `tracking_picked_up` | `tracking_arrived`, `tracking_degraded_gps`, `tracking_delivered`, `tracking_preparing`, `tracking_ready_for_pickup` |
| `getOwnMenu` | `owned_menu_with_pending_version` | — |
| `getPayoutRun` | `payout_run_detail_every_outcome` | — |
| `getPublicConfig` | `public_config` | — |
| `getQuote` | `quote_standard` | `quote_expired`, `quote_large_tip`, `quote_pickup`, `quote_with_discount`, `quote_zero_tip` |
| `getReadiness` | `readiness_ok` | — |
| `getRefund` | `refund_settled` | `refund_approved`, `refund_authorised`, `refund_cancelled`, `refund_declined`, `refund_failed`, `refund_full_never_delivered`, `refund_pending_approval`, `refund_requested`, `refund_submitted`, `refund_succeeded` |
| `getRestaurant` | `restaurant_detail_certified` | `restaurant_detail_closed`, `restaurant_detail_expired`, `restaurant_detail_expiring_soon`, `restaurant_detail_no_menu`, `restaurant_detail_unverified` |
| `getRestaurantApplication` | `restaurant_application_pending_review` | `restaurant_application_approved` |
| `getRestaurantAvailability` | `restaurant_open_state_open` | `restaurant_open_state_closed_holiday`, `restaurant_open_state_closed_hours`, `restaurant_open_state_closed_offline`, `restaurant_open_state_closed_suspended`, `restaurant_open_state_closed_toggle`, `restaurant_open_state_paused` |
| `getRestaurantCertification` | `certification_panel_certified` | `certification_panel_expired`, `certification_panel_expiring_soon`, `certification_panel_unverified` |
| `getRestaurantHours` | `restaurant_hours_standard` | — |
| `getRestaurantMenu` | `menu_full` | `menu_empty`, `menu_single_item` |
| `getRestaurantOnboardingStatus` | `restaurant_onboarding_active` | `restaurant_onboarding_documents_approved`, `restaurant_onboarding_documents_pending`, `restaurant_onboarding_documents_rejected`, `restaurant_onboarding_documents_review`, `restaurant_onboarding_email_verified`, `restaurant_onboarding_menu_pending`, `restaurant_onboarding_payout_pending`, `restaurant_onboarding_profile_pending`, `restaurant_onboarding_registered`, `restaurant_onboarding_withdrawn` |
| `getRestaurantOrder` | `restaurant_order_preparing` | `restaurant_order_picked_up`, `restaurant_order_ready_for_pickup`, `restaurant_order_rejected`, `restaurant_order_restaurant_pending` |
| `getRestaurantProfile` | `restaurant_profile` | — |
| `getRiderApplication` | `rider_application_pending_review` | `rider_application_approved`, `rider_application_changes_requested` |
| `getRiderDashboard` | `rider_dashboard_active` | `rider_dashboard_zero_earnings` |
| `getRiderEarningsSummary` | `earnings_summary_week` | `earnings_summary_zero` |
| `getRiderMe` | `rider_me` | — |
| `getRiderOnboardingStatus` | `rider_onboarding_active` | `rider_onboarding_documents_approved`, `rider_onboarding_documents_pending`, `rider_onboarding_documents_rejected`, `rider_onboarding_documents_review`, `rider_onboarding_payout_pending`, `rider_onboarding_phone_verified`, `rider_onboarding_profile_pending`, `rider_onboarding_registered`, `rider_onboarding_vehicle_pending` |
| `getRiderPayout` | `payout_detail_paid` | — |
| `issueRefund` | `refund_goodwill_admin` | `refund_approval_request_pending`, `refund_approved`, `refund_authorised`, `refund_cancelled`, `refund_declined`, `refund_failed`, `refund_pending_approval`, `refund_requested`, `refund_settled`, `refund_submitted`, `refund_succeeded` |
| `listAddresses` | `addresses_list` | `addresses_empty` |
| `listHalalIssuingBodies` | `halal_issuing_body_accepted` | `halal_issuing_bodies_empty`, `halal_issuing_bodies_seed`, `halal_issuing_body_proposed`, `halal_issuing_body_rejected`, `halal_issuing_body_retired`, `halal_issuing_body_suspended` |
| `listMenuReviewQueue` | `menu_review_queue` | `menu_review_queue_empty`, `menu_version_approved`, `menu_version_draft`, `menu_version_pending_review`, `menu_version_rejected`, `menu_version_superseded`, `menu_version_withdrawn` |
| `listNotifications` | `notifications_list` | `notifications_empty` |
| `listOrders` | `order_list_active` | `order_list_empty`, `order_list_past` |
| `listOrdersAdmin` | `order_list_past` | `order_list_active` |
| `listPaymentMethods` | `payment_methods_list` | `payment_methods_at_limit`, `payment_methods_empty` |
| `listPayoutRuns` | `payout_run_succeeded` | `payout_run_failed`, `payout_run_list_empty`, `payout_run_running` |
| `listRefunds` | `refund_list_empty` | `refund_approved`, `refund_authorised`, `refund_cancelled`, `refund_declined`, `refund_failed`, `refund_pending_approval`, `refund_requested`, `refund_settled`, `refund_submitted`, `refund_succeeded` |
| `listRestaurantApplications` | `restaurant_application_queue` | `restaurant_application_queue_empty` |
| `listRestaurantDocuments` | `restaurant_document_pack_complete` | `restaurant_document_pack_empty`, `restaurant_document_pack_incomplete` |
| `listRestaurantOrders` | `restaurant_order_queue_busy` | `restaurant_order_picked_up`, `restaurant_order_preparing`, `restaurant_order_queue_empty`, `restaurant_order_ready_for_pickup`, `restaurant_order_rejected`, `restaurant_order_restaurant_pending` |
| `listRestaurantPayouts` | `restaurant_payout_history` | `payout_draft`, `payout_failed`, `payout_held`, `payout_list_empty`, `payout_paid`, `payout_ready`, `payout_transferred`, `payout_transferring` |
| `listRestaurantStaff` | `restaurant_staff_list` | — |
| `listRestaurants` | `restaurant_list_populated` | `restaurant_list_empty`, `restaurant_list_long_names`, `restaurant_list_missing_images`, `restaurant_list_single` |
| `listRiderApplications` | `rider_application_queue` | — |
| `listRiderDocuments` | `rider_document_pack_complete` | `rider_document_pack_rejected` |
| `listRiderEarningEntries` | `earning_entries_mixed` | `earning_entries_empty` |
| `listRiderPayouts` | `payout_paid` | `payout_draft`, `payout_failed`, `payout_held`, `payout_list_empty`, `payout_ready`, `payout_transferred`, `payout_transferring` |
| `listStaff` | `staff_list` | — |
| `login` | `session_grant_customer` | `session_next_route_active_delivery`, `session_next_route_app_update_required`, `session_next_route_home`, `session_next_route_onboarding_documents`, `session_next_route_onboarding_rejected`, `session_next_route_order_tracking`, `session_next_route_profile_capture`, `session_next_route_suspended` |
| `markOrderReady` | `restaurant_order_ready_for_pickup` | `restaurant_order_picked_up`, `restaurant_order_preparing`, `restaurant_order_rejected`, `restaurant_order_restaurant_pending` |
| `proposeHalalIssuingBody` | `halal_issuing_body_accepted` | `halal_issuing_body_proposed`, `halal_issuing_body_rejected`, `halal_issuing_body_retired`, `halal_issuing_body_suspended` |
| `recordHalalChecks` | `halal_certificate_status_approved` | `halal_certificate_status_expired`, `halal_certificate_status_pending`, `halal_certificate_status_rejected`, `halal_certificate_status_revoked`, `halal_certificate_status_superseded` |
| `refreshSession` | `session_grant_customer` | `session_next_route_active_delivery`, `session_next_route_app_update_required`, `session_next_route_home`, `session_next_route_onboarding_documents`, `session_next_route_onboarding_rejected`, `session_next_route_order_tracking`, `session_next_route_profile_capture`, `session_next_route_suspended` |
| `registerRestaurant` | `restaurant_registration` | `error_register_restaurant_rate_limited` |
| `rejectOrder` | `restaurant_order_rejected` | `restaurant_order_picked_up`, `restaurant_order_preparing`, `restaurant_order_ready_for_pickup`, `restaurant_order_restaurant_pending` |
| `reportRiderPositions` | `rider_position_ack` | — |
| `reportTamper` | `handoff_tamper_report` | — |
| `requestOtp` | `otp_challenge` | — |
| `resetPassword` | `error_breached_password` | `error_reset_token_not_valid` |
| `reviewRestaurantDocument` | `document_approved` | `document_expired`, `document_in_review`, `document_rejected`, `document_rejected_expired`, `document_rejected_illegible`, `document_rejected_name_mismatch`, `document_rejected_plate_mismatch`, `document_rejected_suspected_forgery`, `document_rejected_wrong_document_type`, `document_submitted`, `document_superseded` |
| `reviewRiderDocument` | `document_approved` | `document_expired`, `document_in_review`, `document_rejected`, `document_submitted`, `document_superseded` |
| `scanDelivery` | `handoff_scan_delivery` | — |
| `scanPickup` | `handoff_scan_pickup` | — |
| `search` | `search_results_populated` | `search_results_empty` |
| `sendRestaurantHeartbeat` | `restaurant_heartbeat` | — |
| `setDefaultAddress` | `addresses_list` | — |
| `setDefaultPaymentMethod` | `payment_methods_list` | — |
| `setHalalIssuingBodyStatus` | `halal_issuing_body_accepted` | `halal_issuing_body_proposed`, `halal_issuing_body_rejected`, `halal_issuing_body_retired`, `halal_issuing_body_suspended` |
| `setMenuItemAvailability` | `menu_item_marked_out_of_stock_until` | `error_item_blocked_by_admin`, `error_menu_locked`, `menu_item_marked_available`, `menu_item_marked_out_of_stock_indefinitely` |
| `setRestaurantAcceptingOrders` | `restaurant_open_state_open` | `restaurant_open_state_closed_holiday`, `restaurant_open_state_closed_hours`, `restaurant_open_state_closed_offline`, `restaurant_open_state_closed_suspended`, `restaurant_open_state_closed_toggle`, `restaurant_open_state_paused` |
| `setRestaurantHours` | `restaurant_hours_standard` | — |
| `setRiderAvailability` | `rider_availability_online_idle` | `rider_availability_offline`, `rider_availability_on_delivery`, `rider_availability_online_stale` |
| `submitOrderRating` | `order_rating_food_and_rider` | — |
| `submitProofOfDelivery` | `assignment_delivered` | `assignment_arrived_at_dropoff`, `assignment_arrived_at_pickup`, `assignment_assigned`, `assignment_cancelled_by_platform`, `assignment_en_route_to_dropoff`, `assignment_en_route_to_pickup`, `assignment_otp_pod_required`, `assignment_picked_up`, `assignment_reassigned`, `assignment_returned`, `assignment_returning`, `assignment_undeliverable` |
| `submitRestaurantDocuments` | `restaurant_onboarding_documents_review` | `restaurant_onboarding_active`, `restaurant_onboarding_documents_approved`, `restaurant_onboarding_documents_pending`, `restaurant_onboarding_documents_rejected`, `restaurant_onboarding_email_verified`, `restaurant_onboarding_menu_pending`, `restaurant_onboarding_payout_pending`, `restaurant_onboarding_profile_pending`, `restaurant_onboarding_registered`, `restaurant_onboarding_withdrawn` |
| `submitRestaurantProfile` | `restaurant_profile` | — |
| `submitRiderDocuments` | `rider_onboarding_documents_review` | `rider_onboarding_active`, `rider_onboarding_documents_approved`, `rider_onboarding_documents_pending`, `rider_onboarding_documents_rejected`, `rider_onboarding_payout_pending`, `rider_onboarding_phone_verified`, `rider_onboarding_profile_pending`, `rider_onboarding_registered`, `rider_onboarding_vehicle_pending` |
| `submitRiderProfile` | `rider_profile` | — |
| `submitRiderVehicle` | `rider_vehicle_scooter` | `rider_vehicle_on_foot` |
| `takeNextRestaurantApplication` | `restaurant_application_pending_review` | `restaurant_application_none_to_take` |
| `takeNextRiderApplication` | `rider_application_pending_review` | `rider_application_none_to_take` |
| `transcribeHalalCertificate` | `halal_certificate_status_pending` | `halal_certificate_status_approved`, `halal_certificate_status_expired`, `halal_certificate_status_rejected`, `halal_certificate_status_revoked`, `halal_certificate_status_superseded` |
| `updateAddress` | `addresses_list` | — |
| `updateCartLine` | `cart_at_quantity_cap` | — |
| `updateCustomerProfile` | `customer_profile` | — |
| `updateMenuCategory` | `menu_category_updated` | `error_category_name_taken`, `error_menu_locked` |
| `updateMenuItem` | `menu_item_edit_pending_review` | `error_halal_tag_not_writable`, `error_menu_locked`, `error_price_out_of_range`, `error_prohibited_ingredient`, `menu_item_edit_price_only` |
| `updateMenuItemOnBehalf` | `menu_item_edited_by_admin` | `error_halal_tag_not_writable`, `error_menu_locked`, `error_menu_locked_banned`, `error_menu_version_pending`, `error_price_out_of_range`, `error_prohibited_ingredient`, `menu_item_edit_price_only` |
| `verifyEmail` | `session_grant_customer` | — |
| `verifyOtp` | `session_grant_customer` | `session_next_route_active_delivery`, `session_next_route_app_update_required`, `session_next_route_home`, `session_next_route_onboarding_documents`, `session_next_route_onboarding_rejected`, `session_next_route_order_tracking`, `session_next_route_profile_capture`, `session_next_route_suspended` |
| `verifyTotpEnrolment` | `error_totp_code_incorrect` | — |

---

## Coverage this set guarantees

| Requirement | Where |
|---|---|
| All 14 `OrderState` values, complete order objects | `orders/order_*` |
| All 10 `DispatchState` values | `dispatch/dispatch_*` |
| All 12 `AssignmentState` values | `dispatch/assignment_*` |
| All 4 `HalalDisplayState` values | `halal/halal_badge_*`, `catalogue/restaurant_detail_*` |
| Certificate valid / expiring within 30 days / expired | `halal/halal_certificate_valid`, `…_expiring_within_30_days`, `…_expiring_tomorrow`, `…_expired` |
| All 6 `HalalCertificateStatus` values | `halal/halal_certificate_status_*` |
| All 11 restaurant onboarding states | `onboarding/restaurant_onboarding_*` |
| All 10 rider onboarding states | `onboarding/rider_onboarding_*` |
| All 6 `KycDocumentState` values | `documents/document_*` |
| Rejected-with-reason, six distinct reason codes | `documents/document_rejected_*` |
| All 8 `PaymentState` values incl. `REQUIRES_ACTION` and `FAILED` | `payments/payment_*` |
| All 10 `RefundState` values | `refunds/refund_*` |
| All 7 `PayoutState` values | `rider/payout_*` |
| All 4 `PayoutRunState` values, and a run with every `PayoutRunOutcome` | `admin/payout_run_*` |
| All 7 `RestaurantOpenState` values | `onboarding/restaurant_open_state_*` |
| Empty lists | every `*_empty` scenario (tag `empty`) |
| Exactly-one-item lists | `restaurant_list_single`, `menu_single_item`, `cart_single_line`, `order_list_active` |
| Names that overflow | `restaurant_list_long_names`, `menu_item_long_name_no_image` |
| Missing images | `restaurant_list_missing_images`, `menu_item_long_name_no_image` |
| A restaurant with no menu | `catalogue/menu_empty` + `catalogue/restaurant_detail_no_menu` |
| An item with many variants and add-ons | `catalogue/menu_item_many_variants_and_addons` (16 variants, 16 add-ons) |
| A cart at the quantity cap | `cart/cart_at_quantity_cap` (20 — contradiction log #21) |
| A large tip and a zero tip | `orders/order_large_tip`, `orders/order_zero_tip`, `cart/quote_large_tip`, `cart/quote_zero_tip` |
| A rider with zero earnings | `rider/rider_dashboard_zero_earnings`, `rider/earnings_summary_zero` |

## Realtime scripts

The `realtime/` fixtures are **event sequences**, not response bodies. Each event carries a
`_delay_ms` the mock server uses to pace playback; everything else is the `websocket.md` §2
envelope exactly.

```bash
# drive a tracking screen through the whole lifecycle
ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_order_happy_path

# same, at 5× speed
MOCK_WS_SPEED=0.2 pnpm mock
```

Playback starts on the first `subscribe`, or immediately with `&autoplay=1`.

## Adding a scenario

1. Edit the relevant `contracts/fixtures/_build/dom_*.py`.
2. `pnpm fixtures:build && pnpm validate:fixtures`.
3. If it should be an operation's default, add it to `DEFAULT_SCENARIO` in
   `_build/registry.py`.
4. Commit the builder change **and** the generated JSON together.
