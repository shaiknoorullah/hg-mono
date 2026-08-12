# hg-api — Commerce Services Deep Analysis
**Scope:** `/home/user/hg-api/api/src/services/{carts, checkout, orders, payments, pricing, feed, ratings}` and `/home/user/hg-api/api/src/features/carts`
**Repo:** `/home/user/hg-api` (NestJS + Prisma/Postgres(PostGIS) + Redis(ioredis, sentinel-capable) + Temporal via `nestjs-temporal`)

---

## 1. Purpose & Role in the Platform

These services form the **entire commerce spine** of the Halal Goes food-delivery platform: browsing/discovery (feed), cart building (carts), price computation (pricing), the checkout saga (checkout), payment ledger (payments), order lifecycle + rider assignment + live tracking (orders), and post-delivery ratings (ratings).

The dominant architectural pattern is **"everything is a Temporal workflow"**: even trivial DB reads (get cart, feed generation) round-trip through a Temporal workflow started on a per-module task queue. The checkout is a **saga orchestration**: an in-process event (`orders.checkout.initiated` via `@nestjs/event-emitter`) starts `initiateCheckoutWorkflow` on `checkouts-queue`, which coordinates payment → order creation → restaurant acceptance → rider assignment → live tracking → cart clearing, with signal-based responses from child workflows and from external actors (restaurant-web/rider apps hitting REST endpoints that translate to Temporal signals, correlated via short-lived Redis mapping keys).

Every commerce module (except ratings) registers **its own Temporal worker inside the API process** via `TemporalModule.registerWorkerAsync`, each bundling the workflow code from its local `./workflows` directory at boot (`bundleWorkflowCode`). So a single NestJS process runs at least 6 workers (cart-queue, checkouts-queue, orders-queue, payments-queue, pricing-queue, feed-queue) plus workers registered by riders/restaurants/users/notifications modules. `src/workflows.ts` also re-exports all workflows centrally "for Temporal discovery."

---

## 2. Complete Inventory

### 2.1 HTTP Endpoints (all unauthenticated — no guards anywhere in scope)

| Method & Path | Handler | Notes |
|---|---|---|
| `GET /carts/:userId` | `CartsController.getCart` | Starts `getUserCartWorkflow` on `cart-queue`, awaits result |
| `PUT /carts/:userId` | `CartsController.manageCartItems` | Full-replacement cart update via `cartManagementWorkflow` |
| `GET /orders/:id` | `OrdersController.getOrder` | Direct Prisma read w/ relations |
| `GET /orders/user/:user_id` | `getUserOrders` | Customer order history |
| `GET /orders/restaurant/:restaurant_id` | `getRestaurantOrders` | Restaurant order list |
| `PUT /orders/:id/status` | `updateOrderStatus` | **Raw status cast `as any`, no transition validation** |
| `PUT /orders/checkout/:cart_id` | `orderCheckout` | Entry point of the checkout saga; body = `CheckoutDataRequest` minus cart_id |
| `GET /orders/:id/tracking` | `trackOrder` | Status + rider name/phone snapshot |
| `GET /orders/analytics/user/:userId` | `getOrdersAnalytics` | Aggregate count/sum/groupBy |
| `GET /payments/:id` | `PaymentsController.getUniquePayment` | PaymentLog read |
| `POST /payments/users/:userId/method/` | `createUerPaymentMethod` (sic) | Adds `CREDIT_CARD|DEBIT_CARD|ONLINE` method |
| `PUT /payments/orders/:orderId` | `processPayment` | **Broken legacy path** — arg mismatch with workflow (see §8) |
| `POST /payments/:id/refund` | `refundPayment` | Flips PaymentLog status to `REFUND_COMPLETED` |
| `GET /payments/analytics/user/:userId` | `getPaymentsAnalytics` | Aggregates by actor_id |
| `GET /pricing/:cartId` | `PricingController.calculatePricing` | **Broken** — workflow feeds cartId into an activity expecting orderId |
| `GET /feed/:userId?lat&lng` | `FeedController.searchRestaurants` | Personalized feed via `feedGenerationWorkflow` |
| `GET /feed/:userId/search?q&limit&page` | `searchFood` | Full-text search via `feedSearchWorkflow`, Redis-cached 300 s |
| `POST /ratings/riders/:riderId` | `RatingsController.rateRider` | Creates review + recomputes `rider.rating_avg` |
| `POST /ratings/food-items/:foodItemId` | `rateFoodItem` | Same for food items |
| `GET /ratings/riders/:riderId?limit&offset` | `getRiderRatings` | Paginated list + avg |
| `GET /ratings/food-items/:foodItemId?limit&offset` | `getFoodItemRatings` | Paginated list + avg |

Note: `CheckoutModule` has **no controller**; checkout is only reachable through `PUT /orders/checkout/:cart_id` → EventEmitter → listener.

### 2.2 Temporal Workflows in scope

| Workflow | File | Task queue | Timeouts / retry |
|---|---|---|---|
| `cartManagementWorkflow` | carts/workflows/cart-management.workflow.ts | cart-queue | activity 30 s, 3 attempts |
| `getUserCartWorkflow` | same file | cart-queue | same |
| `initiateCheckoutWorkflow` | checkout/workflows/checkout-saga.workflow.ts | checkouts-queue | exec+run timeout 15 m, no wf retries |
| `createOrUpdateOrderWorkflow` | orders/workflows/order-processing.workflow.ts | orders-queue | activity 2 m, 5 attempts, nonRetryable: InvalidPayment/InvalidCart/ValidationError |
| `orderAssignmentWorkflow` | orders/workflows/order-assignment.workflow.ts | orders-queue | started with 15 m exec timeout; activities 2 m/3 attempts |
| `orderTrackingWorkflow` | orders/workflows/order-tracking.workflow.ts | orders-queue | 5 h exec timeout; broadcast activity has aggressive retry (10 attempts) |
| `paymentProcessingWorkflow` | payments/workflows/payment-processing.workflow.ts | payments-queue | child of saga, 5 m exec; activities 3 m/3 attempts, nonRetryable InvalidPaymentMethod/InsufficientFunds |
| `pricingCalculationWorkflow` | pricing/workflows/pricing-calculation.workflow.ts | pricing-queue | activity 1 m |
| `feedGenerationWorkflow`, `feedSearchWorkflow` | feed/workflows/feed-generation.workflow.ts | feed-queue | activity 30 s |

Referenced external workflows (out of scope but invoked from here): `sendRiderOrderRequestWorkflow` & `invalidateOrderForRidersWorkflow` (notifications-queue), `findRidersForOrderWorkflow` (riders-queue), `orderUpdatesWorkflow` (orders-queue, started by `CheckoutActivities.createOrderChannel` — an apparently legacy path).

### 2.3 Activity classes

| Class | File | Key activities |
|---|---|---|
| `CartActivities` | carts/activities/cart.activities.ts | `updateCart` (full transactional replacement + validation), `getUserCart`; private `calculateCartValue`, `clearUserCart` |
| `CheckoutActivities` | checkout/activities/checkout.activities.ts | `runWithStatus`, `updateAndNotify` (WS notify), `processPayment`, `createOrder`, `notifyRestaurant`, `assignRider`, `createOrderChannel`, `clearCart`, `refundPayment`, `cancelOrder`, `notifyCustomerOrderCancelled` (no-op body), `startOrderTrackingWorkflow` (actually starts **orderAssignmentWorkflow**) |
| `OrderActivities` | orders/activities/order.activities.ts | `createInitialOrderAfterPayment`, `findNearbyRiders` (Redis GEORADIUS on `riders:active`), `assignRider`, `updateOrderStatus`, `sendOrderNotification` (console stub), `sendOrderUpdate` (console stub, TODO), `checkOrderStatus` (raw PostGIS rider location), `notifyOrderDelivered` (console stub, TODO), `cancelOrderCompensation` |
| `OrderAssignmentActivities` | orders/activities/order-assignment.activities.ts | `createOrderChannel` (via RedisUtils), `notifyClientsToJoinChannel` (WS `CHANNEL_JOIN`), `findNearbyRiders` (executes `findRidersForOrderWorkflow` on riders-queue!), `updateOrderChannel` (broadcast to order room), `getOrderDetails`, `assignRiderToOrder` (DB + `setRiderUnavailable` + `markOrderAsAccepted`), `cancelOrderAndRefund` (**refund is a TODO log only**), `addRiderToOrderChannel`, `getRestaurantLocation` (raw `ST_X/ST_Y` on `restaurant_address.coords`), `storeNotificationWorkflowId` |
| `OrderTrackingActivities` | orders/activities/order-tracking.activities.ts | `getOrderChannelName` (`order:{orderId}`), `cancelOrderAndRefund` (TODO refund), `updateOrderChannel`, `validateOrderStatusTransition` (state machine table), `updateOrderStatus`, `broadcastOrderUpdate` |
| `PaymentActivities` | payments/activities/payment.activities.ts | `processPayment` (creates PaymentLog with **fake** `stripe_${nanoid()}`), `confirmPayment`, `refundPayment` (creates REFUND-type PaymentLog row), `sendPaymentNotification` (WS) |
| `PricingActivities` | pricing/activities/pricing.activities.ts | `calculateOrderTotal`; private `calculateDeliveryFee`, `validateCoupon`, `applyCouponDiscount`, `roundPrice` |
| `FeedActivities` | feed/activities/feed.activities.ts | `searchFoodAndRestaurants` (Prisma full-text `search:`/`_relevance`), `getFeedContent`; private `getNearbyRestaurants` (raw PostGIS `<->`), `getTrendingInArea` |
| `CartActivity` (features/) | features/carts/activities/cart.activity.ts | **Dead scaffold** — 5 stub activities returning placeholder strings; not registered in any module |

### 2.4 Signals & Updates

| Name | Defined in | Sent by |
|---|---|---|
| `paymentResponse` | checkout saga | `paymentProcessingWorkflow` via `getExternalWorkflowHandle(checkout_id)` |
| `orderResponse` | checkout saga | `createOrUpdateOrderWorkflow` (same mechanism) |
| `restaurantResponse` | checkout saga | `PUT /restaurants/:restaurantId/orders/:orderId?action=accept|reject` (restaurants.controller), correlated via Redis key `order_checkout_mapping:{orderId}:{restaurantId}` |
| `riderResponse` | checkout saga | `PUT /riders/:riderId/orders/:orderId?action=...` via `order_rider_checkout_mapping:{orderId}:{riderId}` (handler registered but **never awaited** by saga — dead in current flow) |
| `riderAcceptance` | orderAssignmentWorkflow | rider notification workflow / rider response path |
| `notificationWorkflowResponse` | orderAssignmentWorkflow | `sendRiderOrderRequestWorkflow` child |
| Update `orderStatusUpdate` (`{status, source: 'restaurant'|'rider'}`) | orderTrackingWorkflow | restaurant/rider status endpoints |
| Update `riderLocationUpdate` (`{latitude, longitude}`) | orderTrackingWorkflow | rider location pings |

### 2.5 In-process events (`@nestjs/event-emitter`, wildcard enabled, delimiter `.`)

| Event key | Emitter | Listener |
|---|---|---|
| `user.*.cart.updated` (`cart_events.user.cart.updated`) | `CartActivities.updateCart` | `CartUpdatedListener` — just `console.log(event)` |
| `orders.checkout.initiated` | `OrdersService.initiateCheckoutWorkflow` | `CheckoutsEventListener` → starts saga and **awaits `handle.result()` inside the listener** (blocks up to 15 m) |
| `pricing.updated` | `PricingActivities.calculateOrderTotal` | none found (fire-and-forget) |
| `payment.{id}.processing/success/failed/refunded` (`payment_events`) | defined, never emitted | none |
| `order.created/updated/restaurant.accepted/...` (`order_events`) | mostly unused; only `order_events.checkout.initiated` used | `OrdersEventListener` is fully commented out |

---

## 3. Data Models (Prisma, mapped to snake_case tables)

- **CartItems** (`cart_items`): id uuid, user_id (FK cascade), delivery_address_id, `delivery_location Unsupported("POINT")?` (skipped in code "due to Prisma limitations"), delivery_postal_code varchar(10), `cart_value Money` default 0, relations `cart_food_items[]`, `cart_coupons[]`. Indexes: hash(user_id), gist(delivery_location), hash(postal_code).
- **CartFoodItems**: cart_id, food_item_id, quantity default 1, selected_variant_id?, `selected_addon_ids String[] @db.Uuid` (GIN idx). Unique `(cart_id, food_item_id, selected_variant_id)`.
- **CartCoupons**: explicit junction cart_id × coupon_code_id, unique pair.
- **CouponCode**: name unique varchar(50), `discount_percent Decimal(5,2)` default 10.0, expiry, soft-delete fields, created_by.
- **CheckoutLog** (`checkout_log`): checkout_id unique, current_step, steps_completed[], order_id? — **defined in schema, never referenced by any code**.
- **Order**: status `OrderStatus` default PENDING_PAYMENT; money fields `delivery_partner_tip`, `item_total`, `delivery_fee` (default **9.99**), `platform_fee` (default **4.99**), `total_order_value`, `tov_after_discount`; timestamps payment_confirmed_at/order_dispatched_at/order_delivered_at; `delivery_instructions DeliveryInstructions[]` enum array (`DO_NOT_CALL|DO_NOT_RING_BELL|LEAVE_AT_DOOR`); `coupon_codes String[]`; FKs restaurant, customer, delivery_to_address, delivery_partner (Rider?), payments_log[].
- **OrderFoodItems**: order_id, food_item_id, quantity, `unit_price Money`; unique `(order_id, food_item_id)` — **no variant column**, so a cart holding the same item in two variants breaks order creation (unique violation) and variant identity is lost.
- **PaymentLog**: amount Money, status `PaymentStatus` (`PENDING PROCESSING REJECTED COMPLETED CANCELLED REFUND_REQUESTED REFUND_COMPLETED`), stripe_payment_id unique?, payment_timestamp, transaction_type (`CREDIT DEBIT REFUND`), actor (User), order?, payment_method (UserPaymentMethod), is_transaction_successful.
- **UserPaymentMethod**: user FK, `payment_method PaymentMethodType` (`CREDIT_CARD DEBIT_CARD ONLINE`), soft delete. No card data stored (no PAN/tokens).
- **OrderStatus** enum: `PENDING_PAYMENT PLACED CONFIRMED PREPARING RIDER_ASSIGNED PICKED_UP ON_THE_WAY DELIVERED DISPUTED CANCELLED REJECTED`.
- **RiderRatingReview / FoodItemRatingReview**: rating `Decimal(2,1)`, review Citext, images[]; parents cache `rating_avg Decimal(2,1)`.

### Shared TS types (`src/common/types/checkout.types.ts`)
`OperationStatus {processing, completed, success}`; `BaseResponse<T>`; `PricingSnapshot {item_total, delivery_fee, platform_fee, discount_amount, amount_to_pay, coupons_applied: uuid[]}`; `CheckoutDataRequest {user_id, cart_id, delivery_address_id, payment_method_id, pricing, metadata?{delivery_instructions}}`; `CheckoutData = + checkout_id`; response/signal aliases for Payment/Order/Restaurant/Rider. `uuid` is `z.uuidv4()` inferred type (just `string`).
`CheckoutStep` enum (27 steps) in `src/common/events/checkout.events.ts`.
`WorkflowIds` (`src/common/constants/workflow-ids.constants.ts`): `checkout_${genRandomId()}`, `order_${checkoutId}`, `payment_for_${checkoutId}`, `payment_user_{userId}_{ts}`, `rider_assignment_{orderId}`, `order_updates_{orderId}`, etc.

---

## 4. The Checkout Saga — actual control flow

1. `PUT /orders/checkout/:cart_id` → `OrdersService.initiateCheckoutWorkflow`: validates cart exists & payment method belongs to user, then emits `orders.checkout.initiated`. **The `pricing` snapshot (including `amount_to_pay`) comes straight from the client request body and is never recomputed server-side.**
2. `CheckoutsEventListener` starts `initiateCheckoutWorkflow` (workflowId `checkout_<nanoid>`, 15 m timeout, no retry) and awaits its result.
3. Saga: `updateAndNotify` (WebSocket `checkout_update` to user) at every step; starts child `paymentProcessingWorkflow` on payments-queue (`payment_${checkout_id}`, 5 m), then `await condition(paymentResponse.completed)`.
4. Payment workflow: `processPayment` creates PaymentLog (status PROCESSING, `stripe_payment_id: stripe_<nanoid>` — **no real gateway**), `confirmPayment` → COMPLETED, sends WS notification (item_total/fees hardcoded 0 in payload), signals `paymentResponse` back to parent via `getExternalWorkflowHandle(checkout_id)`. Compensates via `refundPayment` (creates a REFUND PaymentLog row) on failure; never throws — always completes and signals.
5. On payment success: child `createOrUpdateOrderWorkflow` on orders-queue (3 m). `createInitialOrderAfterPayment` loads cart, validates PaymentLog, derives restaurant from first cart item, creates Order (status `CONFIRMED` because payment_id exists — before restaurant ever accepts) + OrderFoodItems (unit_price = variant price if selected else base price; **addons ignored**), signals `orderResponse`. On failure: compensates with `cancelOrderCompensation`, signals failure; saga additionally calls `refundPayment`.
6. `notifyRestaurant` activity: loads order, calls `notificationsService.sendRestaurantOrderRequest` (orderNumber = last 6 chars of id, `estimatedPrepTime: 25` hardcoded), stores Redis `order_checkout_mapping:{orderId}:{restaurantId}` → checkoutId, TTL **1800 s**.
7. Saga waits on `restaurantResponse` (no explicit timeout — relies on the 15 m workflow timeout). Restaurant app answers via `PUT /restaurants/:rid/orders/:oid?action=accept|reject`, which resolves the Redis mapping, signals the saga, and deletes the key.
8. On rejection: `cancelOrder` + `refundPayment`; **only if both succeed** does it notify + return failure — if either returns false, control falls through and the saga continues to rider assignment as if accepted (bug).
9. `startOrderTrackingWorkflow` activity (misnomer) starts `orderAssignmentWorkflow` on orders-queue (workflowId `order_assignment_<nanoid>` via `genId`, 15 m). The saga's own `assignRider`/`createOrderChannel` activities and the `riderResponse` signal wait are **legacy/dead** in this path.
10. `orderAssignmentWorkflow`: `getOrderDetails` → `getRestaurantLocation` (raw PostGIS) → `createOrderChannel` (RedisUtils + WS `CHANNEL_JOIN` to user/restaurant) → expanding radius search **[5, 10, 15, 20] km** calling `findRidersForOrderWorkflow` on riders-queue → child `sendRiderOrderRequestWorkflow` on notifications-queue (5 m) → stores `notification_workflow:{orderId}` in Redis (1800 s) → waits `notificationWorkflowResponse` then `riderAcceptance` signals → `assignRiderToOrder` (status RIDER_ASSIGNED, marks rider unavailable in Redis sets) → `addRiderToOrderChannel` → child `invalidateOrderForRidersWorkflow` (1 m) → starts child `orderTrackingWorkflow` (`order-tracking-{orderId}`, ABANDON policy, **5 h** timeout). No-riders/no-acceptance paths call `cancelOrderAndRefund` (refund is a TODO log).
11. `orderTrackingWorkflow`: holds a status state machine starting at RIDER_ASSIGNED; handles `orderStatusUpdate` updates (validates transitions via activity table, persists, broadcasts to `order:{orderId}` room) and `riderLocationUpdate` (broadcast only); terminal on DELIVERED/CANCELLED/DISPUTED; 5 h timeout triggers cancel+refund compensation.
12. Back in the saga: `clearCart` (via `CartsService.clearCart` → cartManagementWorkflow with empty items) and final COMPLETED notification.

Status-transition table (order-tracking.activities.ts): PENDING_PAYMENT→[PLACED,CANCELLED]; PLACED→[CONFIRMED,REJECTED,CANCELLED]; CONFIRMED→[PREPARING,CANCELLED]; PREPARING→[RIDER_ASSIGNED,CANCELLED]; RIDER_ASSIGNED→[PICKED_UP,CANCELLED]; PICKED_UP→[ON_THE_WAY,CANCELLED]; ON_THE_WAY→[DELIVERED,DISPUTED,CANCELLED]; DELIVERED→[DISPUTED]; DISPUTED→[DELIVERED,CANCELLED]; CANCELLED/REJECTED→[]. Note: tracking starts at RIDER_ASSIGNED, so restaurant statuses CONFIRMED/PREPARING can never be applied through the tracking update path.

---

## 5. Caching, Redis keys, queues, channels

| Mechanism | Key/name | TTL | Producer → Consumer |
|---|---|---|---|
| Redis string | `order_checkout_mapping:{orderId}:{restaurantId}` | 1800 s | CheckoutActivities.notifyRestaurant → restaurants.controller (deleted after signal) |
| Redis string | `order_rider_checkout_mapping:{orderId}:{riderId}` | 1800 s | CheckoutActivities.assignRider (legacy) + notifications websocket-utils → riders.controller |
| Redis string | `notification_workflow:{orderId}` | 1800 s | OrderAssignmentActivities.storeNotificationWorkflowId → riders.controller (signals notification wf) |
| Redis string | `search:{query_lowercased_first_space_underscored}` | 300 s | FeedService.search cache (see bugs: not JSON-serialized, ignores userId/page/limit, only first space replaced) |
| Redis geo set | `riders:active` | — | riders service → `OrderActivities.findNearbyRiders` (GEORADIUS) |
| Redis sets (via RedisUtils/NOTIFICATION_REDIS_KEYS) | riders available/unavailable, rider assignment hash, order channels | 7200 s | assignRiderToOrder, createOrderChannel, addRiderToOrderChannel |
| WS rooms | `order:{orderId}` (also written as `order_channel_{orderId}` in the legacy CheckoutActivities.createOrderChannel) | — | NotificationsGateway.broadcastToOrderRoom |
| Raw SQL table | `user_channels(user_id, channel_id, user_type)` | — | CheckoutActivities.createOrderChannel `$executeRaw` inserts with `ON CONFLICT DO NOTHING` (table not in Prisma schema as a model used here) |
| Temporal task queues | `cart-queue`, `checkouts-queue`, `orders-queue`, `payments-queue`, `pricing-queue`, `feed-queue`; external: `riders-queue`, `notifications-queue` | — | one worker per module in the same process |

---

## 6. Pricing model & magic values

- `calculateOrderTotal(orderId)`: item_total from Order row; **platform fee hardcoded `4.99`**; delivery fee = `2.99 + distanceKm * 1.5` where distance = Postgres `POINT <-> POINT` (degrees) × **111** km/degree — computed against the **user's primary address**, not the order's delivery address; coupon = first entry of `order.coupon_codes` looked up by name.
- `roundPrice(amount, roundTo: 5|10 = 5)`: rounds to 2 dp then to nearest 5 cents.
- Cart-side item math (`CartActivities.calculateCartValue`): `(base_price + variant_price + Σ addon_prices) × quantity` — variant price is **added** to base.
- Order-side item math (`createInitialOrderAfterPayment`): unit_price = variant price **instead of** base price when a variant is selected, and **addons are dropped entirely** — three inconsistent price definitions (cart vs order vs pricing service), and the amount actually charged is a fourth (client-supplied `pricing.amount_to_pay`).
- Rider search radii `[5,10,15,20]` km; feed nearby radius 10 km (`radiusKm/111.0` degrees), limit 20; trending window 3 months / 200 orders / top 8; recent orders window 6 months / 30; popular items `rating_avg >= 4.0` top 10; order-again top 6.

---

## 7. Configuration & Environment Variables

| Var | Default | Used by |
|---|---|---|
| `TEMPORAL_ADDRESS` | `localhost:7233` | every module's worker factory + app-level client |
| `TEMPORAL_NAMESPACE` | `default` | Temporal client (app.module) |
| `DATABASE_URL`, `DB_DIRECT_URL` | — | Prisma datasource |
| `REDIS_USE_SENTINEL` | false | RedisService mode switch |
| `REDIS_SENTINELS` | `redis-sentinel-1:26379` (CSV) | sentinel mode |
| `REDIS_MASTER_NAME` | `mymaster` | sentinel mode |
| `REDIS_HOST`/`REDIS_PORT`/`REDIS_DB`/`REDIS_PASSWORD` | localhost/6379/0/none | direct mode |
| `PORT` | 3456 | main.ts |
| `NODE_ENV` | — | enables pino logger in production |

MinIO config block in app.module is fully commented out. Swagger/Scalar docs served at `/api/docs`. No global API prefix; no CORS config seen; WsAdapter for websockets.

---

## 8. Auth / Security Model

**There is effectively none in this area.**
- No `@UseGuards`, JWT checks, or session validation on any commerce controller. Any caller can read any user's cart (`GET /carts/:userId`), mutate carts, read any order, flip any order's status (`PUT /orders/:id/status` casts unvalidated string `as any`), initiate refunds (`POST /payments/:id/refund`), add payment methods to any user, or submit ratings as any `user_id` (taken from the request body).
- **Client-supplied pricing**: the checkout request body contains the full `PricingSnapshot`; `paymentProcessingWorkflow` charges `pricing.amount_to_pay` verbatim. A client can pay $0.01 for any cart. The server-side pricing endpoint is broken anyway (below), so no recomputation is even possible currently.
- Restaurant/rider response endpoints authenticate nothing — anyone who knows an orderId+restaurantId within the 30-min Redis TTL can accept/reject orders and signal the saga.
- Payments are simulated (fake `stripe_*` ids); no secrets in scope; no PCI data stored.

---

## 9. Code-Quality Observations, Bugs, Dead Code, TODOs

### High-severity logic bugs
1. **Coupon discount inversion** (pricing.activities.ts `calculateOrderTotal`): `applyCouponDiscount` returns the *discount amount*, but the caller treats it as *amount after discount*: `discountAmount = totalBeforeDiscount - amountAfterDiscount; finalAmount = amountAfterDiscount`. With a 10% coupon on $50, customer would be charged $5 + platform fee, and "discount" reported as $45.
2. **`GET /pricing/:cartId` is broken end-to-end**: `pricingCalculationWorkflow(cartId)` passes the cart id into `calculateOrderTotal(orderId)`, which looks up an **Order** — always "Order not found" for real carts.
3. **Restaurant-rejection fall-through** (checkout saga ~line 348): if `cancelOrder` or `refundPayment` returns false after rejection, the saga does not return — it proceeds to rider assignment and completes checkout for a rejected order.
4. **Refunds are not real anywhere in the assignment/tracking path**: `cancelOrderAndRefund` in both `OrderAssignmentActivities` and `OrderTrackingActivities` only logs "Payment refund would be initiated here" (explicit TODO). `PaymentsService.refundPayment` mutates the original row to REFUND_COMPLETED, while `PaymentActivities.refundPayment` creates a separate REFUND row — two conflicting refund semantics.
5. **Legacy `PUT /payments/orders/:orderId` arg mismatch**: controller starts `paymentProcessingWorkflow` with `[user_id, order_id, payment_method_id]` but the signature is `(user_id, payment_method_id, checkout_id, amount_to_pay)` — order_id becomes payment_method_id, checkout_id undefined (external-handle signal will fail), amount undefined.
6. **Feed search cache corruption**: `FeedService.search` stores a JS object via `redis.set(key, value: string)` (implicit `[object Object]` coercion) and returns the raw cached string on hit; cache key ignores `userId`, `page`, `limit`, and `.replace(' ', '_')` only replaces the first space — cross-user/cross-page collisions.
7. **Order line-items lose addons & variants**: OrderFoodItems has no variant/addon columns; addon prices charged in cart are dropped from the order; two cart rows of the same food item with different variants violate unique `(order_id, food_item_id)` and abort order creation.
8. **Order status set to CONFIRMED at creation** (before restaurant acceptance), and the tracking state machine starts at RIDER_ASSIGNED — CONFIRMED/PREPARING transitions from restaurants are unreachable via the tracking update handler.
9. **`clearCart` breaks for users without a primary address**: passes `delivery_address_id: ''` which fails `updateCart`'s address validation — post-checkout cart clearing can fail.
10. **Delivery fee uses the wrong address** (user's primary, not the order's delivery address) and a crude degrees×111 distance conversion; likewise feed proximity uses non-geodesic `POINT <->` math on legacy `location POINT` columns while riders use `coords geometry(Point,4326)`.

### Dead / vestigial code
- `src/features/carts/**` — stub `CartActivity` (returns strings like "Add item to cart activity run ..") + `ICartActivity`; unregistered anywhere.
- `checkout.service.ts` — empty injectable shell (constructor only).
- `OrdersEventListener` — entire handler commented out; `CartUpdatedListener` just `console.log`s.
- Saga's `riderResponse` signal + `CheckoutActivities.assignRider`/`createOrderChannel` (with `order_channel_{orderId}` naming and `orderUpdatesWorkflow` start) are a superseded assignment path that still ships; `assignRider` uses `getAllActiveRiders()` ("simplified"), hardcodes distance 5, prep 25, lat/lng 0.
- `payment_events`, most of `order_events`, `pricing.updated` — emitted or defined with no listeners; `OrderPaymentProcessingEvent`/`PricingUpdatedEvent` use bizarre comma-operator constructor bodies.
- `CheckoutLog` Prisma model never used. `CartCreatedEvent` never emitted. Unused `import { check } from 'zod'` in payments.service.ts. `CartUpdatedEvent.cart_data` never populated. `OrdersService.trackOrder` is an empty method. `acceptOrder`/`riderAssignmentWorkflow` start commented out.
- `orderResponseSignal` handler in the saga updates state before child even starts; `var paymentId` / `var orderId` (function-scoped `var` in TS) used to escape try blocks.

### Explicit TODOs / hardcoded values
- "TODO: Implement channel broadcasting via NotificationsGateway" (order.activities `sendOrderUpdate`), "TODO: Implement actual delivery notification sending", "TODO: Implement actual payment refund logic" (order-tracking.activities), "TODO: Get from restaurant address relation" (`restaurantAddress: 'Restaurant Address'` placeholder sent to riders), "need to implement circuit breaker here" (saga header comment), "Skip delivery_location for now due to Prisma limitations" (cart), rider-mapping cleanup pattern noted as "simplified" (riders.controller).
- Hardcoded: platform fee 4.99, delivery base 2.99 + 1.5/km, prep time 25 min, search radii [5,10,15,20], TTLs 1800/300/3600/7200, quantity cap 99, saga timeout 15 m, tracking timeout 5 h, `trackingWorkflowId` typo `` `order-tracking-${orderId}}` `` (extra `}`) in the saga — cosmetic since the activity ignores the parameter and generates its own id.

### Design smells
- Temporal used as an RPC wrapper for plain DB reads (getCart, feed) — non-deterministic workflowIds (`Date.now()`), await-result-in-HTTP-request patterns; the checkout event listener blocking for up to 15 minutes.
- 6+ Temporal workers + `bundleWorkflowCode` per module at boot in one process (slow startup, high memory).
- `CartsController`/`CartsService` registered in both `CartsModule` and root `AppModule` (duplicate providers/routes); `PricingActivities` provided by three modules (pricing, payments, checkout).
- Cart update is full-replacement (client sends complete cart every time) — okay as a design but combined with unique `(cart_id, food_item_id, selected_variant_id)` two identical items with different addon sets collide.
- Ratings accept any `rating` number (no 1–5 clamp; DB `Decimal(2,1)` will reject >9.9), no verification the user actually ordered the item, and `user_id` is caller-supplied.
- Feed search validation: message says "greater than 3 characters" while check is `query.length <= 3`; `limit`/`page` NaN when omitted silently pass validation; food takes `ceil(limit/2)`, restaurants `floor(limit/2)` with a shared `skip` — pagination metadata (`total_pages` over combined counts) is inconsistent with page contents; the in-memory "remove duplicates" filters are no-ops on single queries.
- `feed.service.ts` comment contradiction: "For MVP, direct database search is faster than workflow" — then starts a workflow anyway.
- Money handled as JS floats (`Number(Decimal)` everywhere) despite `@db.Money` columns.
