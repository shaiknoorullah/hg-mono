# Cross-Cutting Analysis: Order Lifecycle & Realtime Data Flow — HalalGoes

Repos analyzed: `/home/user/hg-api` (NestJS + Prisma + Temporal + Redis backend, v1.2.26), `/home/user/halal-goes` (Turborepo: Expo `users`/`rider`/`restaurant` apps; Next.js `restaurant-web`/`admin-web`), `/home/user/hg-docker` (standalone infra compose + integration guide v1.2.25).

---

## 1. Purpose & Role

This area is the platform's spine: it traces one food order from cart edit → pricing → checkout → payment → order creation → restaurant acceptance → rider discovery/assignment → live delivery tracking → delivery → (rating). It is implemented as a **Temporal saga** (`initiateCheckoutWorkflow`) orchestrating child workflows over per-domain task queues, with Redis holding all realtime state (connections, geo, channel membership, checkout↔order↔party mappings) and a raw-`ws` WebSocket gateway on port **9080** fanning updates out to the three client apps.

### End-to-end sequence (as actually implemented)

1. **Cart** — `PUT /carts/:userId` → `CartsService.manageCartItems` → `cartManagementWorkflow` (`cart-queue`) → `updateCart` activity (full-replacement transaction, single-restaurant validation, coupon validation, cart_value calc). `GET /carts/:userId` → `getUserCartWorkflow`.
2. **Pricing** — `GET /pricing/:cartId` → `pricingCalculationWorkflow` (`pricing-queue`) → `calculateOrderTotal` activity. Client must echo this pricing snapshot at checkout (server does NOT recompute).
3. **Checkout initiation** — `PUT /orders/checkout/:cart_id` → `OrdersService.initiateCheckoutWorkflow` validates cart + payment method, emits EventEmitter2 event `orders.checkout.initiated` → `CheckoutsEventListener` starts Temporal `initiateCheckoutWorkflow` on `checkouts-queue`, workflowId = `checkout_<nanoid>` (this workflowId *is* the `checkout_id`), 15m execution timeout.
4. **Payment** — saga child `paymentProcessingWorkflow` (`payments-queue`, workflowId `payment_${checkout_id}`, 5m timeout). Activities: `processPayment` (creates `PaymentLog` PROCESSING with fake `stripe_payment_id = stripe_<nanoid>`), `confirmPayment` (COMPLETED), `sendPaymentNotification` (WS `checkout_update`). Child signals parent via `paymentResponse` signal. Payment is **mocked** — no real Stripe call.
5. **Order creation** — saga child `createOrUpdateOrderWorkflow` (`orders-queue`, workflowId `order-create-${checkout_id}-${Date.now()}`, 3m). Activity `createInitialOrderAfterPayment` snapshots cart→`Order` + `OrderFoodItems` in one transaction; status set to **CONFIRMED** if payment_id present (`PLACED` is never used). Signals parent via `orderResponse`.
6. **Restaurant notification** — saga activity `notifyRestaurant` → `NotificationsService.sendRestaurantOrderRequest` → `sendRestaurantOrderRequestWorkflow` (`notifications-queue`), sends WS event `order_request` to the restaurant socket (queues to Redis if offline; notification expires in **1 minute**). Stores Redis mapping `order_checkout_mapping:{orderId}:{restaurantId} → checkoutId` (TTL 1800s).
7. **Restaurant decision** — restaurant app calls `PUT /restaurants/:restaurantId/orders/:orderId?action=accept|reject`. Controller looks up the Redis mapping, updates DB (CONFIRMED / REJECTED), signals the checkout workflow's `restaurantResponse` signal, deletes the mapping. Saga waits on `condition(() => restaurantResponse.status.completed)` — **no explicit acceptance timeout**; relies on the 15m workflow timeout.
8. **Rider assignment** — saga activity `startOrderTrackingWorkflow` actually starts `orderAssignmentWorkflow` (`orders-queue`, workflowId `order_assignment_<nanoid>`, 15m). That workflow: gets order + restaurant PostGIS coords → creates order channel `order:{orderId}` (Redis `subscriptions:` set + WS `CHANNEL_JOIN` pushes to user & restaurant) → expanding radius search 5/10/15/20 km via child `findRidersForOrderWorkflow` (`riders-queue`, PostGIS `ST_DWithin` on `rider.coords`, `is_accepting_orders=true`, LIMIT 15) → child `sendRiderOrderRequestWorkflow` (`notifications-queue`) pushes WS `order_request` to each connected rider (10-min expiry) and writes `order_rider_checkout_mapping:{orderId}:{riderId} → checkoutId` per rider; workflow id stored at `notification_workflow:{orderId}` (TTL 1800s).
9. **Rider decision** — rider app calls `PUT /riders/:riderId/orders/:orderId?action=accept|reject`. Controller: reads `order_rider_checkout_mapping`, on accept persists `delivery_partner_id` + status RIDER_ASSIGNED (`RidersService.acceptOrder`, also `ZREM riders:active`), signals BOTH the checkout saga (`riderResponse` — saga no longer waits on it, harmless) and the rider notification workflow (`riderResponse` signal), which relays `notificationWorkflowResponse` + `riderAcceptance` signals to `orderAssignmentWorkflow`. Assignment workflow then `assignRiderToOrder` (idempotent re-update + Redis `riders:available:online`/`riders:unavailable:order-assigned` sets + `rider:{id}:assignment` hash + `order:{orderId}:accepted` JSON), adds rider to order channel, starts child `invalidateOrderForRidersWorkflow` (WS invalidation to other riders), then starts **`orderTrackingWorkflow`** (`orders-queue`, workflowId `order-tracking-${orderId}`, ABANDON parent policy, 5h timeout).
10. **Delivery tracking** — `orderTrackingWorkflow` exposes two Temporal **updates**: `orderStatusUpdate({status, source})` and `riderLocationUpdate({lat,lng})`. REST endpoints call `temporal.getHandle('order-tracking-'+orderId).executeUpdate(...)`:
    - Restaurant: `PUT /restaurants/orders/:orderId/status` (`PREPARING`, source 'restaurant')
    - Rider: `PUT /riders/:riderId/orders/:orderId/status?status=…` and `PUT /riders/orders/:orderId/status` (PICKED_UP → ON_THE_WAY → DELIVERED, source 'rider')
    - Rider location: `PUT /riders/:id/location` `{latitude, longitude, orderId?}` — DB `rider.coords` update + Redis `GEOADD riders:active` + forwards to tracking workflow when orderId given.
    Each status update is validated against a transition table, written to DB, and broadcast via `broadcastOrderUpdate` → `NotificationsGateway.broadcastToOrderRoom(orderId)` → WS event `order_update` to all members of `subscriptions:order:{orderId}`. Terminal statuses (DELIVERED/CANCELLED/DISPUTED) complete the workflow; else 5h timeout → cancel + refund (refund is a TODO log only in tracking/assignment activities).
11. **Post-checkout** — saga clears cart (`clearCart` → `cartManagementWorkflow` with empty items), emits `CART_CLEARED` and `COMPLETED` checkout_update steps.
12. **Rating** — backend `POST /ratings/riders/:riderId` and `POST /ratings/food-items/:foodItemId` (transactional avg recompute onto `rider.rating_avg` / `food_item.rating_avg`); GET endpoints paginated. **The user app never calls them** — `order-complete.tsx` has `// TODO: Send ratings and feedback to backend` and only shows a success alert.

---

## 2. Complete Inventory

### 2.1 Backend HTTP endpoints in the lifecycle (all unauthenticated)

| Endpoint | File | Role |
|---|---|---|
| `GET/PUT /carts/:userId` | `api/src/services/carts/carts.controller.ts` | cart read / full-replace update |
| `GET /pricing/:cartId` | `services/pricing/pricing.controller.ts` | pricing snapshot |
| `PUT /orders/checkout/:cart_id` | `services/orders/orders.controller.ts:38` | start checkout saga |
| `GET /orders/:id`, `GET /orders/user/:user_id`, `GET /orders/restaurant/:restaurant_id` | orders.controller | order queries |
| `PUT /orders/:id/status` | orders.controller:30 | raw DB status write (bypasses tracking workflow + validation) |
| `GET /orders/:id/tracking`, `GET /orders/analytics/user/:userId` | orders.controller | tracking snapshot / analytics |
| `PUT /restaurants/:restaurantId/orders/:orderId?action=` | `services/restaurants/restaurants.controller.ts:97` | restaurant accept/reject → checkout signal |
| `PUT /restaurants/orders/:orderId/status` | restaurants.controller:199 | PREPARING via tracking-workflow update |
| `GET /restaurants/:id/orders`, `/stats`, `/analytics`, `PUT /:id/toggle-accepting` | restaurants.controller | restaurant ops |
| `PUT /riders/:riderId/orders/:orderId?action=` | `services/riders/riders.controller.ts:145` | rider accept/reject → signals |
| `PUT /riders/:id/orders/:orderId/status`, `PUT /riders/orders/:orderId/status` | riders.controller:112,286 | delivery status via workflow update |
| `PUT /riders/:id/location` | riders.controller:54 | location → DB + Redis + workflow update |
| `PUT /riders/:id/availability` | riders.controller:86 | toggle `is_accepting_orders` + `riders:active` GEOADD |
| `GET /riders/nearby/search`, `GET /riders/active/all`, `/stats`, `/analytics`, `/:id/orders` | riders.controller | discovery/queries |
| `POST/GET /ratings/riders/:riderId`, `/ratings/food-items/:foodItemId` | `services/ratings/ratings.controller.ts` | ratings (unused by frontends) |
| `GET /admin/orders` (+ users/restaurants/riders/analytics, approve routes) | `services/admin/admin.controller.ts` | admin views |

### 2.2 Temporal workflows & task queues

| Workflow | Queue | Started by | File |
|---|---|---|---|
| `cartManagementWorkflow`, `getUserCartWorkflow` | cart-queue | CartsService | `carts/workflows/cart-management.workflow.ts` |
| `pricingCalculationWorkflow` | pricing-queue | PricingService | `pricing/workflows/pricing-calculation.workflow.ts` |
| `initiateCheckoutWorkflow` (saga) | checkouts-queue | CheckoutsEventListener | `checkout/workflows/checkout-saga.workflow.ts` |
| `paymentProcessingWorkflow` | payments-queue | saga child + PaymentsService | `payments/workflows/payment-processing.workflow.ts` |
| `createOrUpdateOrderWorkflow` | orders-queue | saga child + OrdersService | `orders/workflows/order-processing.workflow.ts` |
| `orderAssignmentWorkflow` | orders-queue | checkout activity `startOrderTrackingWorkflow` | `orders/workflows/order-assignment.workflow.ts` |
| `orderTrackingWorkflow` | orders-queue | orderAssignmentWorkflow child | `orders/workflows/order-tracking.workflow.ts` |
| `findRidersForOrderWorkflow` | riders-queue | OrderAssignmentActivities.findNearbyRiders | `riders/workflows/rider-discovery.workflow.ts` |
| `riderLocationTrackingWorkflow` | riders-queue | (nothing — dead) | `riders/workflows/rider-tracking.workflow.ts` |
| `sendRestaurantOrderRequestWorkflow` | notifications-queue | NotificationsService | `core/notifications/workflows/user-types/restaurant-order-request.workflow.ts` |
| `sendRiderOrderRequestWorkflow`, `invalidateOrderForRidersWorkflow` | notifications-queue | orderAssignmentWorkflow / riders controller | `.../rider-order-request.workflow.ts` |
| `sendWebSocketNotificationWorkflow`, `removeNotificationFromQueuesWorkflow`, `markNotificationAsReadWorkflow`, `sendNotificationWorkflow` | notifications-queue | NotificationsService | `.../delivery-channels/websocket/websocket-notification.workflow.ts` |
| email/push/sms notification workflows | — | scaffolding only | `.../delivery-channels/{email,push,sms}` |

Worker registration: **per-module** `TemporalModule.registerWorkerAsync` with `bundleWorkflowCode({workflowsPath: __dirname/./workflows})` — 9 workers/queues in one Nest process (orders, notifications, checkouts, carts, payments, pricing, riders, restaurants, users, feed). `core/temporal/temporal-worker.service.ts` and `temporal.module.ts` are **empty stubs**; the top-level `src/workflows.ts` barrel is unused by workers (each worker bundles only its own dir). CHANGELOG 1.2.26: "fixes checkouts worker not being registered".

### 2.3 Temporal signals & updates

| Name | Direction | Defined in |
|---|---|---|
| `paymentResponse`, `orderResponse`, `restaurantResponse`, `riderResponse` | children/controllers → checkout saga | checkout-saga.workflow.ts |
| `riderAcceptance`, `notificationWorkflowResponse` | rider notif workflow → orderAssignmentWorkflow | order-assignment.workflow.ts |
| `riderResponse` (second definition!) | riders controller → sendRiderOrderRequestWorkflow | rider-order-request.workflow.ts |
| updates `orderStatusUpdate`, `riderLocationUpdate` | REST controllers → orderTrackingWorkflow | order-tracking.workflow.ts |

### 2.4 Frontend consumers per stage

| Stage | Screen/hook | File |
|---|---|---|
| Cart | `users/app/cart.tsx`, `hooks/cart.ts`, `lib/apis/cart/updateCart.ts` (PUT /carts), `getCartPricing.ts` (GET /pricing) | users app |
| Checkout | `users/app/checkout.tsx` (connects WS; **local hardcoded fees $5/$2 for display**), `payments/select-payment.tsx` → `processCartPayments` (PUT /orders/checkout/:cartId), `hooks/checkoutPayload.ts` | users app |
| Checkout progress | `hooks/orderWebSocket.ts` consumes `notification/checkout_update` steps; `payments/success.tsx` → `restaurant-waiting.tsx` | users app |
| Restaurant acceptance wait | `users/app/restaurant-waiting.tsx` (routes on CONFIRMED→`/delivery-tracking`, REJECTED/FAILED→`/reject-order`) | users app |
| Delivery tracking | `users/app/delivery-tracking/index.tsx` (map + `RIDER_LOCATION_UPDATE`, `GET /orders/:id`, `GET /riders/:id`), chats screens (mock) | users app |
| Completion/rating | `users/app/order-complete.tsx` (rating UI, **backend call TODO**) | users app |
| Restaurant order intake | `restaurant-web/src/hooks/orderWebSocket.ts` (`order_request`, `order_update`), `components/OrderNotificationDialog.tsx`, `app/orders/page.tsx` (accept/reject via `PUT /api/restaurants/...?action=`), `app/orders/[id]/page.tsx` (status→PREPARING) | restaurant-web |
| Rider intake/delivery | `rider/app/rider-home.tsx` + `hooks/useRiderWebSocket.ts` + `components/rider/OrderRequestDrawer.tsx` (`acceptOrder`/`rejectOrder` APIs), `hooks/useToggleRiderAvailability.ts`, `hooks/useLocationUpdates.ts` (10s watch + 15s interval `PUT /riders/:id/location` with orderId), `order-processing/index.tsx` (PICKED_UP), `restaurant-pickup.tsx` (ON_THE_WAY), `delivery-completion.tsx` (DELIVERED), `delivery-success.tsx`, `earnings.tsx` | rider app |
| Admin | `admin-web/src/app/orders/{page,active,completed}.tsx` via `ordersApi.listAll` → `GET /admin/orders` | admin-web |

WS stores: `users/stores/useWebSocketStore.ts` (`EXPO_PUBLIC_WEBSOCKET`), `rider/store/useWebSocketStore.ts` (`EXPO_PUBLIC_WEBSOCKET_URL` default `ws://localhost:9080` — **var missing from rider .env.example**), `restaurant-web/src/store/useWebSocketStore.ts` (`NEXT_PUBLIC_WEBSOCKET_URL`, userType 'restaurant'). All send `connect_user` then `join_channel`; auto-reconnect on AppState/close.

---

## 3. Data Model (prisma/schema.prisma)

- **OrderStatus enum**: `PENDING_PAYMENT, PLACED, CONFIRMED, PREPARING, RIDER_ASSIGNED, PICKED_UP, ON_THE_WAY, DELIVERED, DISPUTED, CANCELLED, REJECTED`. Default `PENDING_PAYMENT`.
- **Order**: restaurant_id, customer_id, delivery_to_address_id, delivery_partner_id? (Rider), money fields `item_total`, `delivery_fee` (default **9.99**), `platform_fee` (default **4.99**), `total_order_value`, `tov_after_discount`, `delivery_partner_tip`; timestamps `payment_confirmed_at/order_dispatched_at/order_delivered_at`; `delivery_instructions DeliveryInstructions[]` (`DO_NOT_CALL|DO_NOT_RING_BELL|LEAVE_AT_DOOR`); `coupon_codes String[]`; `estimated_delivery_time Int?`. Composite idx on (customer,status), (restaurant,status), (rider,status).
- **OrderFoodItems**: order_id+food_item_id unique, quantity, unit_price (variant price if selected — note: variant price *replaces* base at order time but is *added* to base in cart valuation → inconsistency).
- **CartItems** (one per user in practice), **CartFoodItems** (unique cart+item+variant, `selected_addon_ids uuid[]`), **CartCoupons**, **CouponCode** (discount_percent, expiry).
- **CheckoutLog** model (checkout_id unique, current_step, steps_completed[], order_id?) — **never written or read by any service code** (migration 20250928 exists; dead model).
- **PaymentLog**: status enum `PENDING, PROCESSING, REJECTED, COMPLETED, CANCELLED, REFUND_REQUESTED, REFUND_COMPLETED`; transaction_type `CREDIT|DEBIT|REFUND`; `stripe_payment_id` unique (mock values); actor(User), order?, payment_method(UserPaymentMethod: CREDIT_CARD|DEBIT_CARD|ONLINE).
- **Rider**: `is_accepting_orders`, `total_earnings`, `total_orders_delivered`, `rating_avg Decimal(2,1)`, legacy `location POINT` + new `coords geometry(Point,4326)` (GiST). **RiderRatingReview**, **FoodItemRatingReview** feed avg columns.
- **Restaurant / RestaurantAddress** (also dual `location POINT` + `coords geometry`), RestaurantMenu → FoodItem (variants, addons, offers, cuisines/categories).
- Postgres extensions: postgis (+tiger, topology), pg_trgm, citext, btree_gin, bloom, uuid-ossp, etc. via `postgis/postgis:17-3.6-alpine`.

### Order-status state machine (order-tracking.activities.ts `validateOrderStatusTransition`)
```
PENDING_PAYMENT → PLACED|CANCELLED
PLACED → CONFIRMED|REJECTED|CANCELLED
CONFIRMED → PREPARING|CANCELLED
PREPARING → RIDER_ASSIGNED|CANCELLED
RIDER_ASSIGNED → PICKED_UP|CANCELLED
PICKED_UP → ON_THE_WAY|CANCELLED
ON_THE_WAY → DELIVERED|DISPUTED|CANCELLED
DELIVERED → DISPUTED ; DISPUTED → DELIVERED|CANCELLED ; CANCELLED/REJECTED terminal
```
Validation applies **only** to updates routed through the tracking workflow, and it validates against the workflow's in-memory `currentStatus` (starts at RIDER_ASSIGNED), not the DB. Direct endpoints (`PUT /orders/:id/status`, restaurant accept, assignment) write statuses unvalidated. Notably the *real* flow (CONFIRMED at creation → RIDER_ASSIGNED on acceptance) itself violates this table (skips PREPARING), which only works because assignment writes status directly.

---

## 4. Realtime mechanisms — Redis & WebSocket

### 4.1 WebSocket gateway (`core/notifications/notifications.gateway.ts`)
- Raw `ws` on port **9080** (`@WebSocketGateway(9080, {cors:'*'})`, `WsAdapter` in main.ts). Ping/pong every 30s; stale sockets terminated with Redis cleanup.
- Client→server events: `connect_user {userId,userType}` (no credential — **identity is client-asserted**), `join_channel {channelName,...}` ("MVP mode" auto-authenticates from message body if not connected), `heartbeat`, `status`, `health_check`.
- Server→client events: `connection_confirmed` (+queued notification replay), `channel_joined`, `channel_error`, `connection_error`, `notification` (to users; also carries `checkout_update` and `CHANNEL_JOIN`), `order_request` (to riders & restaurants — note `sendToRider`/`sendToRestaurant` always wrap payloads under event `order_request`, even CHANNEL_JOIN pushes), `order_update` (order-room broadcast).
- `broadcastToOrderRoom(orderId)` reads members of `subscriptions:order:{orderId}` and unicasts to each open socket.

### 4.2 Actual Redis keys used in the live order flow
| Key | Type | Writer / Reader |
|---|---|---|
| `connections:{userType}:{userId}` | string JSON (TTL 1h) | gateway ↔ redis-utils (`isUserConnected` requires lastSeen <5min) |
| `users:online` | set (TTL 2h) | gateway |
| `riders:active` | **geo set** | RidersService (location update, availability toggle, ZREM on accept), read by OrderActivities.findNearbyRiders + `GET /riders/nearby/search` |
| `rider:{riderId}:location` | geo set (member = timestamp!) | RidersService/RiderActivities (odd modeling; one arg-order bug, see §7) |
| `subscriptions:{channelName}` e.g. `subscriptions:order:{orderId}` | set of `userType:userId` (TTL 24h; checkout channels 30m) | redis-utils create/join; gateway broadcast |
| `order_checkout_mapping:{orderId}:{restaurantId}` | string=checkoutId TTL 1800 | checkout activity → restaurants controller |
| `order_rider_checkout_mapping:{orderId}:{riderId}` | string=checkoutId TTL 1800 | WebSocketActivities.sendNotificationToRider + checkout assignRider (dead) → riders controller |
| `notification_workflow:{orderId}` | string TTL 1800 | OrderAssignmentActivities → riders controller (to signal notif workflow) |
| `order:{orderId}:accepted` | JSON TTL 1h | markOrderAsAccepted |
| `rider:{riderId}:assignment` | hash {orderId} | setRiderUnavailable |
| `riders:available:online` / `riders:unavailable:order-assigned` | sets TTL 2h | setRiderAvailable/Unavailable (only truly exercised on assignment) |
| `notification:{id}`, `queue:{userType}:{userId}` (zset priority), `notifications:priority:{...}`, `notifications:group:{group}`, `failed_notifications:{...}` (list), `read:{userId}` | notification metadata & offline queues (TTL 7–30d) | websocket-notif activities; queue drained on `connect_user` |
| `restaurants:accepting`, `restaurants:locations`, `restaurant:{id}:location`, `riders:available:locations`, `riders:unavailable:locations` | sets/geo | **written only via `NotificationsRedisStore.setRiderLocation`/`updateRestaurantLocation`, which the live flow never calls** — effectively documented-but-dormant |
| Priority scores: urgent 1000 / high 500 / normal 100 / low 10 (default 50). |

### 4.3 Event emitter (in-process)
`orders.checkout.initiated` (OrdersService → CheckoutsEventListener) is the only live EventEmitter2 hop in the lifecycle. `cart_events.user.cart.updated` is emitted by CartActivities but its consumer in OrdersEventListener is fully commented out. `pricing_events.updated` emitted with no listener.

---

## 5. Configuration & Environment

Backend (`hg-api/.env.example` + docker-compose): `HG_DB/HG_DB_USER/HG_DB_PASS`, `DATABASE_URL`/`DB_DIRECT_URL` (compose points **directly at postgres:5432**, not PgBouncer 6432 despite PgBouncer being provisioned), `REDIS_HOST/PORT/DB/PASSWORD`, `REDIS_USE_SENTINEL` (+`REDIS_SENTINELS` default `redis-sentinel-1:26379`, `REDIS_MASTER_NAME` default `mymaster`) — **compose does not enable sentinel mode for the API** (`REDIS_HOST: redis-master`), `REDIS_KEYSPACE_NOTIFICATIONS=Ex` (set but unused in code), `TEMPORAL_ADDRESS` (default localhost:7233)/`TEMPORAL_NAMESPACE` (default `default`; PLAN.md says `halalgoes` — mismatch), `API_PORT=3456`, `WS_PORT=9080`, MinIO vars (FilesModule registration is commented out in app.module). Infra: postgres+postgis, pgbouncer, pgadmin, redis master + 2 replicas + 2 sentinels (quorum 2, monitoring `${HOST_IP}:6379`, down-after 10000ms inline in compose — the checked-in `sentinel.conf` monitors `redis-master` with down-after 5000ms and is **not mounted**), redisinsight, minio, temporal auto-setup + admin-tools + UI (8080). hg-docker compose is identical except API is pulled from `devsupreme0/halalgoes-api:${API_VERSION}` instead of built locally.

Frontends: users app `EXPO_PUBLIC_BASE_API_URL` (example: `https://api.halalgoes.com`, commented `http://98.130.76.223:3456`), `EXPO_PUBLIC_WEBSOCKET` (`ws://98.130.76.223:9080` — plaintext WS to a hardcoded public IP committed to the repo), `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, Supabase keys. rider app: `EXPO_PUBLIC_BASE_API_URL` (+missing WS var). restaurant-web: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WEBSOCKET_URL`, `NEXT_PUBLIC_TEMPORAL_UI`; **but** `src/lib/api/config.ts` hardcodes `BASE_URL: 'https://api.halalgoes.com'` and prefixes lifecycle routes with `/api/...` plus `/auth/restaurant/*` endpoints — neither the `/api` prefix nor any `/auth` routes exist in hg-api (`main.ts` sets no global prefix) ⇒ restaurant-web targets a different/newer production gateway than this backend repo. admin-web `NEXT_PUBLIC_API_URL` etc.

---

## 6. Auth / Security model

- **No authentication or authorization anywhere in hg-api**: no guards, no JWT verification, no ownership checks. Anyone can accept/reject any order for any restaurant/rider, mutate any cart, or set any order status. `better-auth` is a dependency but unused.
- Frontends attach Supabase-issued Bearer tokens via axios interceptors (`users/lib/apis/axiosInstance.ts`, rider equivalent) and restaurant-web has an elaborate refresh-token client — tokens are simply ignored by this backend.
- WebSocket "MVP mode": identity is whatever `userId/userType` the client sends; `join_channel` even auto-registers unauthenticated sockets from message data. Any client can join any `order:{id}` channel and receive customer PII (name, address, phone).
- CORS `origin: '*'` on the gateway; Swagger/Scalar docs exposed at `/api/docs`.
- Committed infra IP `98.130.76.223` and Docker Hub repo names in env examples; no secrets committed beyond placeholders.

---

## 7. Docs-vs-code disagreements & notable findings

1. **REDIS_DATA_STRUCTURE.md describes the notification-module design, not the live flow.** The geo keys `riders:available:locations`/`riders:unavailable:locations`, `restaurants:accepting`, `restaurants:locations`, and per-key TTLs it lists are only populated via `NotificationsRedisStore.setRiderLocation`, which nothing in the request path invokes. The live geo pool is **`riders:active`** (written by `RidersService.updateRiderLocation`/`toggleAvailability`) — a key the doc never mentions. The doc itself flags `online:riders` as "MISSING in redis-utils.ts" (it exists as `ONLINE_RIDERS` const, read-only via `getOnlineRidersFromHash`, never written). Consequence: `sendRiderOrderRequestWorkflow`'s fallback paths (`activities.findNearbyRiders` → `riders:available:locations`; `getAvailableRiders` → `riders:available:online`) will find nobody unless assignment already populated the sets — pre-discovered `foundRiders` from PostGIS is the only reliable path.
2. **Rider discovery is PostGIS, not Redis geo,** in the real assignment path (`findRidersForOrderWorkflow` → `rider.activities.findNearbyRiders` raw SQL on `rider.coords`); docs (integration guide "Redis active pool") imply Redis.
3. **ORDERS_API_INTEGRATION_GUIDE.md status flow says orders start at `PLACED` after payment**; code creates orders directly as `CONFIRMED` (`order.activities.ts:118` `status: payment_id ? 'CONFIRMED' : 'PENDING_PAYMENT'`), and `PLACED` is unreachable. Guide's transition table also says PREPARING→RIDER_ASSIGNED is automatic; code assigns rider regardless of PREPARING.
4. **Guide says restaurant acceptance timeout ~2 min with auto-cancel**; code has **no restaurant timeout** other than the 15-minute checkout workflow timeout, and on that timeout the workflow dies without running the compensation code path (the saga catch block sends a FAILED notification only if the workflow is still running; a hard workflow-timeout kill won't refund).
5. **`pricingCalculationWorkflow(cartId)` calls `calculateOrderTotal(orderId)`** — the pricing activity looks up an **Order** by the *cart* id (`pricing.activities.ts:99`). `GET /pricing/:cartId` therefore throws "Order not found" for a genuine cart id. Yet the whole checkout contract (docs + user app) requires this endpoint. Either production runs different code or pricing is broken; the user app additionally displays hardcoded $5.00/$2.00 fees in `checkout.tsx` while sending `cartPricing` from the store.
6. **Checkout saga restaurant-rejection bug** (`checkout-saga.workflow.ts:348-371`): the failure return is nested inside `if (orderCancelled && paymentRefunded)`. If either compensation returns false, the saga **continues to rider assignment on a rejected order**.
7. **`refundPayment` semantics differ by path**: PaymentsService.refundPayment flips the original PaymentLog to REFUND_COMPLETED; PaymentActivities.refundPayment creates a new REFUND row; OrderAssignment/Tracking `cancelOrderAndRefund` only *logs* "Payment refund would be initiated here" (TODO) — no-rider/timeout cancellations never actually refund.
8. **Dead/broken code**: `CheckoutActivities.assignRider`/`createOrderChannel` are never invoked by the saga (rider assignment moved to orderAssignmentWorkflow); `createOrderChannel` raw-inserts into a **nonexistent `user_channels` table** and starts a nonexistent workflow **`orderUpdatesWorkflow`** (WorkflowIds.orderUpdates). `riderLocationTrackingWorkflow`, `sendNotificationWorkflow`, email/push/sms workflow scaffolding, `CheckoutService` (empty), `TemporalWorkerService`/`TemporalCoreModule`/`RedisStreamsService` (empty), `notification-sent.listener.ts`/`event.ts` (0 bytes), `CheckoutLog` model, `trackOrder()` no-op, commented FilesModule/MinIO registration, commented `riderAssignmentWorkflow` start in `OrdersService.acceptOrder`.
9. **`RiderActivities.updateRiderLocation` geoadds with swapped args** (`latitude, longitude` passed into `(longitude, latitude)` params) for `rider:{id}:location`; RidersService version is correct. Both use timestamps as geo members so the key accumulates a point per ping.
10. **workflowId typo**: saga computes `order-tracking-${orderId}}` (double brace, checkout-saga.workflow.ts:381) — harmless because the activity ignores it and the real tracking workflow is started by assignment as `order-tracking-${orderId}`, which the REST controllers correctly target.
11. **restaurant-web toggle mismatch**: sends body `{is_accepting}` to `PUT /:id/toggle-accepting` but backend reads `{isAccepting}` ⇒ against this backend the toggle would write `undefined`. Also all restaurant-web lifecycle calls use `/api/...` prefix + `https://api.halalgoes.com` (see §5) — this frontend is built against a newer/production API surface (v1.2.25+ guide's `/auth/*`, Stripe onboarding, disputes) that this hg-api repo does not contain.
12. **Two channel-membership systems** exist (`subscriptions:{channel}` in redis-utils vs `channel:order:{id}:members` in redis-store); only the former is used by broadcasts. The `NOTIFICATION_CHANNELS`/`NOTIFICATION_EVENTS` constants files are entirely unused by the flow.
13. **Duplicate signal name `riderResponse`** on two different workflows (checkout saga & rider notif workflow) — riders controller deliberately signals both; confusing but functional.
14. **Restaurant notification expiry is 1 minute** (`expiresAt: Date.now() + 60_000`) but the Redis checkout mapping lives 30 min and nothing enforces expiry server-side; restaurant-web dialog counts down from `expiresAt`.
15. **User app cart-clearing races**: backend saga clears cart *and* `restaurant-waiting.tsx` clears local cart; `select-payment.tsx` navigates to success **before** the checkout request resolves ("Navigate to success FIRST" pattern), so failures rely entirely on the later WS FAILED step.
16. **Order channel joins**: gateway pushes `CHANNEL_JOIN` to user via event `notification` but to restaurant/rider via event `order_request` — each frontend hook special-cases accordingly (users store listens on `notification`/`CHANNEL_JOIN`; restaurant & rider hooks on `order_request`/`CHANNEL_JOIN`). Users store `joinChannel` sends `user_id` (snake_case) rather than `userId`, tolerated only because the socket is already authenticated by `connect_user`.
17. **`estimatedPrepTime` from restaurant accept is dropped** (signal carries it; nothing persists it to `estimated_delivery_time`); `distance`/ETA sent to riders are hardcoded (5km/25min or 0). `sendOrderUpdate`, `notifyOrderDelivered`, `sendOrderNotification` order activities are console-log stubs. Rider earnings (`total_earnings`) never incremented (only `total_orders_delivered` on the unused `updateDeliveryStatus` service path — the actual DELIVERED transition via tracking workflow updates the order only, so rider stats/availability restoration also never run).
18. **Tracking timeout race**: `orderTrackingWorkflow`'s 5h timeout uses `Promise.race` with `condition(() => false, '5h')` inside a CancellationScope that is never cancelled on completion; benign in Temporal but sloppy. `PENDING_PAYMENT→PLACED` states and `DISPUTED` handling exist in the validator/UI but have no producer.
19. **COMPREHENSIVE_ORDER_FLOW_DOCUMENTATION.md** (1,950 lines, generated 2025-10-05) matches the code closely (it even documents `riderResponseSignal` as "unused after refactor") — it is the accurate doc; the hg-docker guide diverges on the points above.
20. **Redis sentinel HA is provisioned but unused by the app** (API pinned to `redis-master`; `REDIS_USE_SENTINEL` never set in compose). A failover would leave the API pointed at a demoted/absent master.

---

## 8. Code-quality observations (summary)

- Massive console.log/emoji debug logging in all frontend WS stores/hooks (every message dumped, PII included).
- Defensive triple-fallback payload parsing in `useRiderWebSocket` (4 near-identical 80-line transformers) — indicates unstable message contract.
- `updateOrderStatus(status as any)` casts everywhere; unvalidated `PUT /orders/:id/status` escape hatch.
- Cart value: variant price **added** to base price (cart.activities.ts:356-361) vs order creation using variant price **instead of** base (order.activities.ts:130-134) — totals can disagree between cart, pricing, and order.
- `.swp` vim files committed in users app; `useMockWebSocket.ts` & `data/mockOrders.ts` leftovers in rider app; `apps/web`/`apps/docs` are untouched Turborepo starters.
- `runWithStatus` exists twice (workflow util + activity method) with different semantics; checkout activities call `updateAndNotify('system', ...)` sending WS notifications to literal userId "system".
- Money handled as JS floats through pricing/payment (Postgres Money in DB); `roundPrice` rounds to nearest 5¢.
- Restaurant/user/rider ID doubles as WS identity and Prisma UUID; `Admin` model is an empty shell (id+timestamps).
