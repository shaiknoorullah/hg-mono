# hg-api: Documentation & API Contracts — Exhaustive Analysis

**Scope analyzed (all files read in full):**
- `/home/user/hg-api/CLAUDE.md` (3 lines — placeholder)
- `/home/user/hg-api/PLAN.md` (411 lines)
- `/home/user/hg-api/COMPREHENSIVE_ORDER_FLOW_DOCUMENTATION.md` (1950 lines)
- `/home/user/hg-api/REDIS_DATA_STRUCTURE.md` (246 lines)
- `/home/user/hg-api/REMAINING_ENDPOINTS_PATCH.md` (432 lines)
- `/home/user/hg-api/prompt.md` (33 lines)
- `/home/user/hg-api/API v1.0.10.json` (155 KB)
- `/home/user/hg-api/API v1.2.23.json` (259 KB)

---

## 1. Purpose & Role in the Platform

This documentation set is the **written contract layer** of the HalalGoes backend. It captures:

1. **The build plan** (`PLAN.md`) — the original 14-day implementation roadmap for the NestJS + Temporal + Redis backend.
2. **The as-built architecture** (`COMPREHENSIVE_ORDER_FLOW_DOCUMENTATION.md`, dated 2025-10-05, "Version 1.0, Maintained By: Development Team") — a very detailed cart-to-delivery order-flow reference with workflow signatures, signal/update types, Redis keys, endpoints, retry policies, and 7 Mermaid diagrams.
3. **The Redis contract** (`REDIS_DATA_STRUCTURE.md`) — every Redis key pattern used by the notifications/realtime module with data types, TTLs, and complexity notes.
4. **A pending code patch** (`REMAINING_ENDPOINTS_PATCH.md`) — copy-paste TypeScript for analytics/admin endpoints that were not yet in the codebase at authoring time (partially applied since — see §8).
5. **An LLM prompt** (`prompt.md`) — the spec the developer gave an AI assistant to implement the `order-tracking` Temporal workflow.
6. **Two API client collections** (`API v1.0.10.json`, `API v1.2.23.json`) — **NOT OpenAPI specs**. Both are **Hoppscotch collection exports** (schema `"v": 10`, keys: `_ref_id/auth/folders/headers/id/name/requests/v/variables`). They are the de-facto REST contract + regression suite: every request carries example bodies and **saved real responses** (200/201 with actual payloads). `REMAINING_ENDPOINTS_PATCH.md` explicitly says "Test endpoints with the Hoppscotch collection."

The consuming clients are the three Expo apps and Next.js webs in `/home/user/halal-goes`; the infra described (Redis, Temporal, MinIO) lives in `docker-compose.yml` here and in `/home/user/hg-docker`.

---

## 2. File-by-File Inventory

### 2.1 CLAUDE.md
Literal full content: a blank line, a blank line, and the text `CLAUDE.md file`. **It is an empty placeholder** — the project ships no actual Claude/agent instructions despite the file existing.

### 2.2 PLAN.md — Implementation Plan (5 phases / 14 days)

Header comment `<!-- @format -->` (Prettier marker). Key contents:

**Dependencies to install:** `@temporalio/{client,worker,workflow,activity}`, `ioredis`, `novu` + `@novu/node`, `better-auth`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@nestjs/event-emitter`, `nestjs-zod`, `@anatine/zod-openapi`, `zod`.

**Environment variables it mandates:**

| Var | Value in doc | Controls |
|---|---|---|
| `REDIS_HOST` | `localhost` | Redis connection |
| `REDIS_PORT` | `6379` | Redis connection |
| `REDIS_DB` | `0` | Redis logical DB |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server |
| `TEMPORAL_NAMESPACE` | `halalgoes` | Temporal namespace |
| `REDIS_KEYSPACE_NOTIFICATIONS` | `Ex` | Keyspace expiry events |
| `NOVU_API_KEY` | placeholder | Novu push provider |
| `NOVU_APP_ID` | placeholder | Novu app |

Also mandates Redis started with `redis-server --notify-keyspace-events Ex --appendonly yes`.

**Phases:**
- **Phase 1 (Days 1–3):** Core infra — `src/core/redis` (get/set/del/geoadd/georadius/geodist/hash ops), `src/core/redis-streams` (xadd/xread/xreadgroup, consumer groups, `location-stream.consumer.ts`, `order-events.consumer.ts`), `src/core/temporal` (client + worker service), `src/core/websocket` (Socket.IO gateway, rooms per users/restaurants/riders), `src/core/notifications` (Novu, at-least-once delivery).
- **Phase 2 (Days 4–6):** Feature modules — `user-management`, `restaurant-management`, `rider-management`, `location-tracking`, `search` (PostGIS proximity, veg/non-veg/halal/rating filters), `order-management`.
- **Phase 3 (Days 7–9):** Service orchestration — users/restaurants/riders/orders services + workflow folders (`location-tracking.workflow.ts`, `rider-availability.workflow.ts`, `order-processing.workflow.ts`, `rider-assignment.workflow.ts` and activities like `find-nearby-riders`, `calculate-pricing`, `calculate-eta`, `validate-location`).
- **Phase 4 (Days 10–12):** Real-time — Redis Streams→WebSocket location broadcasting, SSE for order tracking, Temporal workflows with **restaurant acceptance timeout 5 min**, **rider acceptance timeout 2 min**, radius expansion, Novu templates.
- **Phase 5 (Days 13–14):** nestjs-zod on all controllers, Swagger generation, **better-auth integration, route guards, RBAC**, write-through order cache, cache invalidation, rate limiting.

**Notable deltas plan→reality:** the as-built system (per the flow doc) uses the `ws` library rather than Socket.IO, WebSocket-based notifications rather than Novu, Redis GEO rather than PostGIS for proximity, and no visible better-auth/guards/RBAC (collections carry no auth). SSE never appears in the as-built docs.

### 2.3 COMPREHENSIVE_ORDER_FLOW_DOCUMENTATION.md — As-built order flow

**Generated 2025-10-05.** Architecture: NestJS + Temporal.io + PostgreSQL (Prisma) + Redis + WebSockets (`ws` library) + **mock payment service** + WebSocket-based push notifications.

#### Workflow catalogue (6 workflows)

| # | Workflow | File | Task queue | Exec timeout | Key facts |
|---|---|---|---|---|---|
| 1 | `cartManagementWorkflow` | `src/services/carts/workflows/cart-management.workflow.ts:28-55` | (default) | 30 s | activity `updateCart()`; retry 3× backoff 1s→30s |
| 2 | `initiateCheckoutWorkflow` (Saga) | `src/services/checkout/workflows/checkout-saga.workflow.ts:82-450` | — | none explicit | Orchestrates everything; workflowId = `checkout_id` |
| 3 | `paymentProcessingWorkflow` | `src/services/payments/workflows/payment-processing.workflow.ts:41-178` | `payments-queue` | 5 m | workflowId `payment_${checkout_id}`; ParentClosePolicy.TERMINATE; non-retryable: `InvalidPaymentMethod`, `InsufficientFunds` |
| 4 | `createOrUpdateOrderWorkflow` | `src/services/orders/workflows/order-processing.workflow.ts:30-174` | `orders-queue` | 3 m | workflowId `order-create-${checkout_id}-${Date.now()}`; 5 attempts; non-retryable: `InvalidPayment`, `InvalidCart`, `ValidationError` |
| 5 | `orderAssignmentWorkflow` | `src/services/orders/workflows/order-assignment.workflow.ts:114-623` | — | 15 m (doc "Performance" section) | Radius search 5/10/15/20 km; children: `sendRiderOrderRequestWorkflow` (on `notifications-queue`, 5 m), `invalidateOrderForRidersWorkflow` (1 m), `orderTrackingWorkflow` |
| 6 | `orderTrackingWorkflow` | `src/services/orders/workflows/order-tracking.workflow.ts` | `orders-queue` | **5 h** | workflowId `order-tracking-${orderId}`; ParentClosePolicy.**ABANDON**; on 5 h timeout → `cancelOrderAndRefund` |

#### Saga steps (checkout)
INITIATED → payment (child, signal `paymentResponse`) → order creation (child, signal `orderResponse`) → `notifyRestaurant()` (stores Redis `order_checkout_mapping:${orderId}:${restaurantId}` → checkoutId, TTL 30 min) → wait `restaurantResponseSignal` → `startOrderTrackingWorkflow()` (actually starts *assignment*) → `clearCart()`. Compensations: `refundPayment()`, `cancelOrder()`, `notifyCustomerOrderCancelled()`.

#### Signals & updates (exact names)

| Name | Kind | Target workflow | Sent from |
|---|---|---|---|
| `paymentResponse` | signal | checkout saga | payment workflow via `getExternalWorkflowHandle(checkout_id)` |
| `orderResponse` | signal | checkout saga | order-creation workflow |
| `restaurantResponse` | signal | checkout saga | `restaurants.controller.ts:151` |
| `riderResponse` | signal | checkout saga | `riders.controller.ts:210` — **noted "unused after refactor"** |
| `riderAcceptanceSignal` | signal | orderAssignmentWorkflow | riders controller |
| `notificationWorkflowResponseSignal` | signal | orderAssignmentWorkflow | notification child workflow |
| `notificationRiderResponseSignal` | signal | sendRiderOrderRequestWorkflow | riders controller |
| `orderStatusUpdate` | **update** (`defineUpdate<string, [{status, source: 'restaurant'\|'rider'}]>`) | orderTrackingWorkflow | restaurants.controller.ts:209, riders.controller.ts:126 |
| `riderLocationUpdate` | **update** (`defineUpdate<string, [{latitude, longitude}]>`) | orderTrackingWorkflow | riders.controller.ts:75 |

#### Redis keys used by the flow
- `order_checkout_mapping:${orderId}:${restaurantId}` → checkoutId (TTL 30 min; read+deleted by restaurant accept endpoint)
- `order_rider_checkout_mapping:${orderId}:${riderId}` → checkoutId (read+deleted by rider accept endpoint)
- `notification_workflow:${orderId}` → notificationWorkflowId (TTL 30 min implied)
- `subscriptions:order:${orderId}` — set of `userType:userId` channel subscribers (TTL 24 h)
- `riders:available:locations` — GEO index queried by `findNearbyRiders`
- Channel name convention: `order:${orderId}` (e.g. "order:abc123")

#### Endpoints documented (with controller line refs)
- `GET /carts/:userId`; `PUT /carts/:userId` (body: delivery_address_id, cart_items[{food_item_id, quantity, selected_variant_id?, selected_addon_ids?}], coupon_codes?) → triggers cart workflow
- `PUT /orders/checkout/:cart_id` (body: user_id, delivery_address_id, payment_method_id, pricing{item_total, delivery_fee, platform_fee, discount_amount, amount_to_pay}, metadata?) → starts saga, returns `{success, message}`
- `PUT /restaurants/:restaurantId/orders/:orderId?action=accept|reject&estimatedPrepTime=&reason=` → reads Redis mapping, updates DB, signals `restaurantResponse`, deletes mapping
- `PUT /restaurants/orders/:orderId/status` body `{status: "PREPARING"|"READY_FOR_PICKUP"}` → executeUpdate on `order-tracking-${orderId}`
- `PUT /riders/:riderId/orders/:orderId?action=accept|reject&reason=` → dual signal (assignment + notification workflows), invalidates other riders
- `PUT /riders/:riderId/location` body `{latitude, longitude, orderId?}` → DB update + `riderLocationUpdate` executeUpdate
- `PUT /riders/:riderId/orders/:orderId/status?status=PICKED_UP|ON_THE_WAY|DELIVERED` → executeUpdate

#### Activities (35 total, by module, with timeouts)
- **Checkout** (`checkout.activities.ts`, all 30 s): `updateAndNotify`, `processPayment`, `createOrder`, `notifyRestaurant`, `assignRider`, `createOrderChannel`, `clearCart`, `refundPayment`, `cancelOrder`, `notifyCustomerOrderCancelled`, `startOrderTrackingWorkflow` (line refs 78–582).
- **Order** (2 m): `createInitialOrderAfterPayment`, `cancelOrderCompensation`.
- **Assignment** (2 m): `createOrderChannel`, `getOrderDetails`, `getRestaurantLocation`, `findNearbyRiders`, `updateOrderChannel`, `assignRiderToOrder`, `addRiderToOrderChannel`, `cancelOrderAndRefund`, `storeNotificationWorkflowId`.
- **Tracking** (1 m): `getOrderChannelName`, `validateOrderStatusTransition`, `updateOrderStatus`, `broadcastOrderUpdate`, `cancelOrderAndRefund`.
- **Payment** (3 m): `processPayment`, `confirmPayment`, `sendPaymentNotification`, `refundPayment`.
- **Cart** (30 s): `updateCart`, `getUserCart`.

Retry policies (doc §Performance): cart 3×(1s→30s), payment 3×(1s→10s), order 5×(1s→10s), assignment 3×(5s→30s), tracking **10×**(3s→30s).

#### Order status model
`PENDING → PAYMENT_PROCESSING → PAYMENT_CONFIRMED/PAYMENT_FAILED → ORDER_CREATED → RIDER_ASSIGNED → CONFIRMED → PREPARING → READY_FOR_PICKUP → PICKED_UP → ON_THE_WAY → DELIVERED → COMPLETED`, with `CANCELLED` reachable from every active state (timeout/error). Restaurant drives CONFIRMED/PREPARING/READY_FOR_PICKUP; rider drives PICKED_UP/ON_THE_WAY/DELIVERED. Human-readable status messages hardcoded in `getStatusMessage()`.

#### WebSocket event contract
- `checkout_update` `{step, message, data?, error?}` per saga step (steps observed: INITIATED, PAYMENT_PROCESSING, PAYMENT_CONFIRMED/PAYMENT_COMPLETED, ORDER_CREATING, ORDER_CREATED, RESTAURANT_NOTIFYING, WAITING_RESTAURANT_ACCEPTANCE, RESTAURANT_ACCEPTED, CART_CLEARED, COMPLETED, FAILED).
- `order_update` types: `ASSIGNMENT_STARTED`, `SEARCHING_RIDERS`, `RIDERS_FOUND`, `NOTIFICATION_WORKFLOW_STARTED`, `NOTIFICATIONS_SENT`, `RIDER_ACCEPTING`, `RIDER_ASSIGNED`, `TRACKING_WORKFLOW_STARTED`/`TRACKING_STARTED`, `STATUS_UPDATE`, `RIDER_LOCATION`, failures: `NO_RIDERS_FOUND`, `NO_RIDER_ACCEPTED`, `ASSIGNMENT_FAILED`, `ORDER_CANCELLED`.
- `order_request` to restaurant `{orderId, orderNumber, customerName, items…}` and to riders `{orderId, restaurantName, deliveryAddress…}`.

#### Misc facts
- Broadcast mechanism: activity reads `subscriptions:order:*`, matches ws clients on `userId + userType + OPEN`, `send(JSON.stringify(update))`.
- Example flow uses stable seed IDs reused throughout all docs and both collections (user `b5bdc9cc-…`, cart `360f6898-…`, order `33ad65b7-…`, restaurant `2924fc7e-…`, rider `d141a3b3-…`).
- Leaks original dev path: `/home/devsupreme/work/hg/api/src/` in File Structure Summary.
- Gateway file: `src/core/notifications/notifications.gateway.ts:37-527`; Redis helpers in `src/core/notifications/activities/redis-utils.ts`.
- "Future Enhancements" list: surge pricing, rider bidding, multi-restaurant orders, scheduled deliveries, real-time ETA, ratings (since built — see v1.2.23), loyalty, ML matching, route optimization, webhooks.

### 2.4 REDIS_DATA_STRUCTURE.md — Redis contract for notifications module

Complete key inventory (patterns, types, TTLs):

| Category | Key | Type | TTL |
|---|---|---|---|
| Connections | `connections:{userType}:{userId}` (JSON: userId, userType∈user\|rider\|restaurant\|admin, socketId, channels[], connectedAt, lastSeen) | String | 1 h, heartbeat-extended |
| Presence | `users:online` | Set | 2 h |
| Presence | `online:riders` (legacy rider activities) | Hash | — **flagged "MISSING in redis-utils.ts"** |
| Presence | `riders:available:online` / `riders:unavailable:order-assigned` / `restaurants:accepting` | Set | 2 h |
| Geo | `riders:available:locations` / `riders:unavailable:locations` | Geo Set | 2 h |
| Geo | `rider:{riderId}:location` (timestamp as member) | Geo Set | **no TTL (flagged)** |
| Geo | `restaurants:locations`, `restaurant:{restaurantId}:location` | Geo Set / JSON String | 30 d |
| Assignment | `rider:{riderId}:assignment` (hash `{orderId}` only — **no assignedAt**, flagged) | Hash | **no TTL (flagged)** |
| Channels | `subscriptions:{channelName}` | Set | 24 h (order) / 30 min (checkout) |
| Channels | `channel:order:{orderId}:members`, `channel:checkout:{checkoutId}:members` (member format `{userType}:{userId}`) | Set | 24 h / 30 min |
| Queues | `queue:{userType}:{userId}` (sorted set, priority scores) | ZSet | 7 d |
| Queues | `notifications:priority:{userType}:{userId}` | ZSet | 7 d |
| Queues | `failed_notifications:{userType}:{userId}` (legacy FIFO) | List | 7 d |
| Metadata | `notification:{notificationId}` (status ∈ pending\|queued\|delivered\|read\|removed) | String | 7 d |
| Metadata | `notifications:group:{group}` (e.g. group `order-request-123` for bulk removal when one rider accepts) | Set | 7 d |
| Metadata | `read:{userId}` | Set | 30 d |

**Priority scores:** urgent=1000, high=500, normal=100, low=10. Location update cadence "every 30s–2m". Includes 4 Mermaid flow diagrams (connection, delivery, rider location, group removal) and complexity analysis (O(1)/O(log N)/O(N·log M)). Cleanup: TTL + cron jobs + event-driven.

### 2.5 REMAINING_ENDPOINTS_PATCH.md — Pending endpoint patch

Copy-paste implementation for endpoints missing at authoring time; instructions: apply, `pnpm run build`, test with Hoppscotch collection.

1. **`GET /restaurants/:id/analytics`** — total_orders_processed, this_month_orders/revenue, avg_order_value (Prisma aggregate on `order` by `restaurant_id`, month-to-date).
2. **`GET /orders/:id/tracking`** — order_id, status, estimated_delivery_time, rider_name/phone (joins `delivery_partner`, `delivery_to_address`). **Bug: no null check on `order` → NPE for unknown id.**
3. **`GET /orders/analytics/user/:userId`** — total_orders, total_spent, avg_order_value, by_status map.
4. **`GET /payments/analytics/user/:userId`** — aggregates `paymentLog` by `actor_id`; variable named `methodCounts` but actually groups **by `status`** (naming bug).
5. **Admin module (full replacement)** — `POST /admin/restaurants/:id/approve` (sets is_approved, approved_at, approved_by_admin_id), `POST /admin/riders/:id/approve` (comment: "Riders don't have approval fields in schema, just mark as verified" → sets email_verified + phone_verified), `GET /admin/users|restaurants|riders` (limit 20/offset 0), `GET /admin/orders` (limit 50), `GET /admin/analytics` (totals, revenue, active orders where status ∈ PLACED/CONFIRMED/PREPARING/RIDER_ASSIGNED/PICKED_UP/ON_THE_WAY, today counts), `DELETE /admin/users/:id` (soft delete: is_deleted, deleted_at, deleted_by).

**Notable contract details revealed:** Prisma models `user/restaurant/rider/order/paymentLog` with snake_case columns (`total_order_value`, `is_deleted`, `is_accepting_orders`, `total_orders_delivered`, `rating_avg`, `approved_by_admin_id`…). `@ApiTags('admin', 'admin-users', 'managers', 'support')`. **`admin_id` is taken from request body — no auth guard whatsoever**; `DELETE` with a JSON body is also non-standard. Status enum here includes **`PLACED`**, which does not appear in the order-flow doc's state machine (inconsistency: PLACED vs PENDING/ORDER_CREATED).

### 2.6 prompt.md — order-tracking workflow spec (AI prompt)

Developer prompt asking an AI to implement `order-tracking`: started by `order-assignment`; 5-hour overall timeout with full compensation (notify user, cancel, refund); two jobs — (a) fan out order updates via child notification workflows (each notification = one child workflow, retrying activity until delivered or superseded, signalling parent then closing, **no timeouts on child workflows**, deterministic + idempotent), (b) per-minute rider location relay via Temporal **update** calls from the riders controller endpoint. States come from `api/prisma/schema.prisma`; status updates arrive via PUT with status as query param on both restaurant and rider controllers; "follow the code in `checkout-saga.workflow.ts`". Note: prompt says location shared "per minute" while REDIS doc says updates every 30s–2m — minor inconsistency. This prompt is the origin of workflow #6 in §2.3.

---

## 3. The API Collections (contract inventory + version diff)

### 3.1 Format
Both files are **Hoppscotch collection exports** (`"v": 10`), same collection `id` (`cmfuekiug0lrrif1lff1xwrbz`) but different `_ref_id`s (`coll_mfwbenba_…` for v1.0.10, `coll_mgdgann8_…` for v1.2.23 — i.e., two snapshots of the same evolving collection). Collection-level `auth: {authType: "inherit", authActive: true}` with **no credentials anywhere**; no collection headers or variables; no pre-request/test scripts. Base URL hardcoded in every request: **`http://localhost:3456`** (the API's dev port). Nearly every request has a saved response (200/201) with real payloads — the collections double as golden-output fixtures.

### 3.2 v1.0.10 inventory (9 folders, 31 requests)

| Folder | Requests |
|---|---|
| Users (4) | GET /users/:id, PUT /users/:id, POST /users/:id/addresses, GET /users/:id/addresses |
| Riders (9) | POST /riders (with lat/lng), ~~get-rider-by-id~~ (**mislabeled — actually PUT /riders/:id/location**), PUT /riders/:id, PUT /riders/:id/location, PUT /riders/:id/availability (×2 — duplicate), GET /riders/nearby/search?lat&lng&radius, GET /riders/active/all, GET /riders/:id/stats |
| Restaurants (9) | POST /restaurants/, GET /restaurants/:id, PUT /restaurants/:id, GET /restaurants/:id/menu, POST /restaurants/:id/menu/items (bulk array), PUT /restaurants/menu-items/:itemId, PUT /restaurants/:id/toggle-accepting, GET /restaurants/:id/orders, GET /restaurants/:id/stats |
| Carts (3) | GET /carts/:userId (×2 — duplicate), PUT /carts/:userId |
| Feed (2) | GET /feed/:userId/search?q&limit&page, GET /feed/:userId?lat&lng |
| Payments (3) | POST /payments/users/:userId/method, PUT /payments/carts/:cartId, GET /payments/:paymentId |
| Pricing (1) | GET /pricing/:cartId |
| Orders (0) | **empty** |
| Admin (0) | **empty** |

### 3.3 v1.2.23 inventory (10 folders, 56 requests)

| Folder | Requests |
|---|---|
| Users (6) | previous 4 + POST /users (create-user) + a "get-user-analytics"/"get-user-by-id" pair whose **names are swapped** ("get-user-by-id" hits `/users/:id/analytics`; "get-user-analytics" hits `/users/:id`) |
| Riders (12) | fixes get-rider-by-id to a real GET /riders/:id; drops one availability duplicate (keeps the one literally named "toggle-rider-availability - Duplicate"); adds **PUT /riders/:id/orders/:orderId/status?status=PICKED_UP**, **PUT /riders/:id/orders/:orderId?action=accept**, **GET /riders/:id/orders**, **GET /riders/:id/orders/:orderId**; create-rider body no longer includes lat/lng |
| Restaurants (10) | previous 9 + **PUT /restaurants/:id/orders/:orderId?action=accept** (order-accept-reject); update-menu-item example price changed 9.99 → 13.99 |
| Carts (2) | duplicate GET removed; **update-cart has `authType: "none"`** (the only non-inherit request in either file) |
| Feed (2) | unchanged |
| Payments (5) | previous 3 + GET "list-payments" (**wrong URL — identical to get-payment-by-id `/payments/:id`, no list route**) + **POST /payments/:id/refund** (empty body `{}`) |
| Pricing (1) | unchanged |
| Orders (6) | **new:** PUT /orders/checkout/:cartId (initiate-checkout, full pricing body incl. `coupons_applied`), GET /orders/:id/tracking, GET /orders/analytics/user/:userId, GET /orders/:id, GET /orders/user/:userId, GET /orders/restaurant/:restaurantId |
| Admin (8) | **new:** stray request "aprove-restaurant" [sic] pointing at **`https://echo.hoppscotch.io`** (scaffolding leftover), POST /admin (create-admin-account, body `{}`), POST /admin/restaurants/:id/approve, POST /admin/riders/:id/approve (both body `{admin_id}`), GET /admin/users, GET /admin/restaurants, GET /admin/riders (all `?limit=20&offset=0`), GET /admin/analytics |
| Ratings (4) | **new group:** POST /ratings/riders/:riderId, POST /ratings/food-items/:itemId (body: user_id, rating float, review, images[]), GET /ratings/riders/:riderId, GET /ratings/food-items/:itemId (response: ratings[] with joined user first/last name, total, avg_rating, limit=20, offset=0) |

### 3.4 Diff summary v1.0.10 → v1.2.23

**Added (25 net-new requests):** whole Orders group (6: checkout initiation, tracking, per-user analytics, get-by-id, list per user/restaurant); whole Admin group (8: admin account creation, restaurant/rider approval, entity listings, platform analytics); whole Ratings group (4: rate/read rider & food-item ratings); rider order lifecycle (accept/reject, status update, order listing/detail — 4); user creation + user analytics (2); payment refund (1).
**Fixed/cleaned:** get-rider-by-id now a real GET; one duplicated availability request and duplicated get-user-cart removed; rider creation no longer takes coordinates (location now set via the location endpoint / availability toggle).
**Regressions/new defects:** Users get-by-id vs analytics names swapped; "list-payments" duplicates the get-by-id URL; echo.hoppscotch.io placeholder in Admin; update-cart auth switched to `none`.
**Interpretation:** v1.0.10 ≈ pre-order-flow CRUD surface; v1.2.23 ≈ post-Temporal-order-flow + admin + ratings surface, matching COMPREHENSIVE_ORDER_FLOW_DOCUMENTATION.md and a partial application of REMAINING_ENDPOINTS_PATCH.md.

### 3.5 Representative saved-response shapes (v1.2.23)
- `GET /riders/:id/stats` → `{"total_orders_delivered":0,"total_earnings":"0","rating_avg":"0","is_accepting_orders":true,"todayOrders":0,"thisWeekOrders":0,"thisMonthEarnings":0}` (note snake_case + camelCase mix in one payload).
- `GET /orders/:id/tracking` → `{"order_id","status":"DELIVERED","estimated_delivery_time":null,"rider_name":"jhon doe","rider_phone":"+91…"}` (matches the patch's implementation exactly — proof the patch was applied for orders).
- `GET /orders/analytics/user/:id` → `{"total_orders":1,"total_spent":"157.2","avg_order_value":"157.20","by_status":{"DELIVERED":1}}` (Decimal serialized as string).
- `GET /ratings/riders/:id` → paginated `{ratings:[{id, user_id, rider_id, rating:"4.5", review, images[], created_at, last_modified_at, user:{id, first_name, last_name}}], total, avg_rating:"4.5", limit:20, offset:0}`.

---

## 4. Data Models & Types (as expressed in these docs)

- **Prisma models referenced:** `user` (is_deleted, deleted_at, deleted_by, phone_verified), `restaurant` (is_approved, approved_at, approved_by_admin_id, is_accepting_orders, is_halal_certified, halal_certification_expiry, opening_time, closing_time, total_orders_processed), `rider` (email_verified, phone_verified, is_accepting_orders, total_orders_delivered, rating_avg), `order` (customer_id, restaurant_id, delivery_partner_id, status, total_order_value, estimated_delivery_time, delivery_to_address), `paymentLog` (actor_id, amount, status), plus food items (item_name/description/price, is_non_veg, `contains_diary` [sic — misspelling of "dairy" baked into the contract], ingredients[], allergens[], item_images[], category_name, cuisine_name), variants (`type: SIZE|QUANTITY`, name, description, price delta, isDefault), addresses (latitude/longitude, name, street, apartment, floor, suburb, landmark, postal_code, is_primary, is_third_person + third_person_name/phone), payment methods (`payment_method: "CREDIT_CARD"`), ratings (rating decimal-as-string, review, images[]).
- **Checkout pricing contract:** `{coupons_applied[], item_total, delivery_fee, platform_fee, discount_amount, amount_to_pay}` + `metadata.delivery_instructions[]`.
- **Enums:** OrderStatus (§2.3 above; plus `PLACED` only in admin patch); notification priority urgent/high/normal/low; notification status pending/queued/delivered/read/removed; userType user/rider/restaurant/admin; variant type SIZE/QUANTITY; checkout steps (INITIATED…COMPLETED/FAILED).
- **Money** is consistently serialized as **strings** ("157.20") in responses; coordinates as floats (Hyderabad area, lat ~17.3–17.44, lng ~78.42–78.48).

---

## 5. State, Caching, Queues, Events — mechanisms

- **Temporal task queues:** `payments-queue`, `orders-queue`, `notifications-queue` (+ default). Namespace `halalgoes`, server `localhost:7233`.
- **Workflow-ID conventions (API-visible contract):** `checkout_<epoch>`, `payment_${checkout_id}`, `order-create-${checkout_id}-${ts}`, `rider-notifications-${orderId}-${ts}`, `invalidate-riders-${orderId}-${ts}`, **`order-tracking-${orderId}`** (deterministic — controllers reconstruct it to send updates).
- **Redis** is used for: (a) workflow-signal address book (order↔checkout mappings, notification workflow ids), (b) geo indexes for rider search, (c) WS channel membership, (d) offline notification priority queues, (e) presence. Full key list in §2.4.
- **Events:** WS event names `checkout_update`, `order_update`, `order_request`; Redis Streams consumers (`location-stream`, `order-events`) exist only in PLAN.md, not in as-built docs.
- **Keyspace notifications** (`Ex`) planned for expiry-driven cleanup.

## 6. Integration Points

- REST base `http://localhost:3456` (dev). Frontends in `/home/user/halal-goes` are the consumers; `hg-docker` provides Redis master/sentinel + compose.
- Controllers → Temporal via `getHandle`/`executeUpdate`/`signal`; workflows → clients via Redis-subscriber-driven WS broadcast.
- MinIO/image hosting not referenced by these docs (menu images are picsum.photos placeholders; rating images example.com).
- Env vars: see §2.2 table (REDIS_*, TEMPORAL_*, NOVU_*).

## 7. Auth / Security Model

Effectively **absent at the contract level**:
- No auth headers, tokens, or credentials in either collection (all `inherit` from a root that defines none; one request explicitly `none`).
- Admin actions authenticated only by an `admin_id` **in the request body**; `POST /admin` creates an admin account with an empty body.
- User/rider/restaurant identity is whatever UUID is in the URL path (IDOR-by-design in dev).
- PLAN.md's Phase 5 (better-auth, guards, RBAC, rate limiting) is the stated but undelivered security roadmap.
- PII in committed fixtures: real-format Indian phone numbers (+9188…, +9176…), emails (gmail.com, `mfaizan@websleak.com`), and a fully detailed home address in Mehdipatnam, Hyderabad; saved responses contain rider name+phone.

## 8. Cross-Document Consistency & Patch-Application Status

Patch (§2.5) vs v1.2.23 collection:
- **Applied & verified by saved responses:** GET /orders/:id/tracking, GET /orders/analytics/user/:userId, admin approvals, admin listings (users/restaurants/riders), GET /admin/analytics.
- **In patch but NOT in v1.2.23 collection:** GET /restaurants/:id/analytics, GET /payments/analytics/user/:userId, GET /admin/orders, DELETE /admin/users/:id — either unapplied or untested.
- **In collection but in no other doc:** Ratings module, Feed module, Pricing module, POST /admin (create-admin-account), payment refund endpoint, /riders/active/all, /riders/nearby/search, stats endpoints.
- **In flow doc but in no collection:** `PUT /restaurants/orders/:orderId/status` (restaurant status update — the restaurant half of order tracking is untested in Hoppscotch).

## 9. Code-Quality Observations (defects, dead content, inconsistencies)

1. **CLAUDE.md is an empty placeholder** ("CLAUDE.md file") — no real project instructions.
2. **The "OpenAPI specs" are not OpenAPI** — they're Hoppscotch exports; there is no machine-readable schema contract (nestjs-zod/@anatine/zod-openapi from PLAN.md would have produced one, apparently never wired to these files).
3. Collection naming bugs: v1.0.10 "get-rider-by-id" is a PUT to /location; v1.2.23 swaps get-user-by-id ↔ get-user-analytics; "list-payments" URL identical to get-payment-by-id; "toggle-rider-availability - Duplicate" survived while the original was deleted; typo "aprove-restaurant"; "get-restaurand-by-id" typo in both.
4. Dead/leftover content: `https://echo.hoppscotch.io` request in Admin; GET requests carrying JSON bodies (nearby/search, get-orders-for-restaurant, list-orders-for-rider, get-rider-by-id); duplicate get-user-cart in v1.0.10.
5. `contains_diary` misspelling ("dairy") baked into the menu-item contract.
6. Patch bugs: `getOrderTracking` NPE on missing order; `methodCounts` actually status counts; rider "approval" silently redefined as verification ("Riders don't have approval fields in schema"); `DELETE /admin/users/:id` expects a request body.
7. Status-enum drift: `PLACED` (admin patch) vs `PENDING/ORDER_CREATED` (flow doc); `COMPLETED` state appears only in the transition graph, not the state diagram.
8. REDIS doc flags its own gaps: `online:riders` hash "MISSING in redis-utils.ts"; `rider:{id}:location` and `rider:{id}:assignment` have **no TTL**; assignment hash lacks `assignedAt`; legacy `failed_notifications` list still around.
9. Flow-doc self-admissions: `riderResponseSignal` "unused after refactor"; `startOrderTrackingWorkflow()` activity actually starts the *assignment* workflow (misleading name); checkout saga has no execution timeout; tracking loop polls `sleep(1000)` inside `while(true)` (1 s busy-wait in a 5 h workflow); doc's Redis-flow diagram wrongly shows the checkout workflow writing `order_rider_checkout_mapping` (it's the notification workflow).
10. Planned-vs-built drift: Socket.IO→`ws`, Novu→WebSocket-only notifications (Novu env vars likely dead), PostGIS→Redis GEO, SSE never built, no auth/RBAC/rate limiting delivered.
11. Hardcoded values throughout: base URL localhost:3456, seed UUIDs, Hyderabad coordinates, radii `[5,10,15,20]` km, 5 h tracking timeout, 30 min mapping TTL, priority scores 1000/500/100/10.
12. Dev-machine path leak `/home/devsupreme/work/hg/api/` in the flow doc; PII fixtures per §7.
13. Doc versioning is ad-hoc: collection names carry versions (1.0.10, 1.2.23) with no changelog; both files share a collection id so the older file is effectively a stale snapshot kept in the repo root.

## 10. Open Questions

- No changelog explains what happened between v1.0.10 and v1.2.23 or how version numbers map to git history; the diff in §3.4 is reconstructed.
- Whether the four unpatched endpoints (restaurant analytics, payments analytics, admin orders list, admin user delete) exist in `api/src` couldn't be confirmed from docs alone (code-analysis agents should verify).
- Whether Novu/Redis Streams/better-auth were ever wired (PLAN.md-only concepts).
- The relationship between `channel:order:{id}:members` and `subscriptions:order:{id}` (two membership keys for the same concept) is not explained.
- `PUT /payments/carts/:cartId` (standalone payment processing) vs the checkout saga's internal payment child — which one the mobile apps actually call is not documented.
