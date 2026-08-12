# Real-Time Rider Dispatch — Seam Resolution Report

Fleet follow-up agent. Scope: resolve the Redis-GEO vs PostGIS contradiction in rider dispatch, and verify rider/restaurant WebSocket client subscriptions against server-side delivery logic. All findings are from source; file:line references are to `/home/user/hg-api` (API) and `/home/user/halal-goes` (clients).

---

## 0. Contradiction verdict

**Agent B is correct. Agent A's description is of dead fallback code.**

- Real rider discovery for dispatch is **PostGIS `ST_DWithin` on `rider.coords` where `is_accepting_orders = true`**, executed by `findRidersForOrderWorkflow` on the **riders-queue** (`api/src/services/riders/activities/rider.activities.ts:64-124`), invoked from `orderAssignmentWorkflow`'s `findNearbyRiders` activity (`api/src/services/orders/activities/order-assignment.activities.ts:126-173`, which does `this.temporal.execute('findRidersForOrderWorkflow', { taskQueue: 'riders-queue', ... })`).
- The notification module's Redis GEO fallbacks (`RedisUtils.findNearbyRiders` GEORADIUS on `riders:available:locations`, `getAvailableRiders` SMEMBERS on `riders:available:online`) **exist but are unreachable-in-effect**: the notification workflow only uses them when `request.foundRiders` is empty (`rider-order-request.workflow.ts:103-143`), and **nothing in any live code path ever populates `riders:available:locations` or `riders:available:online`**:
  - The only writers are `RedisUtils.updateRiderLocation`/`setRiderAvailable` (`redis-utils.ts:65-69, 123-164`), called solely from `NotificationsRedisStore.setRiderLocation` (`redis-store.ts:49-68`), called solely from `RiderNotificationsActivities.setRiderLocation` (`activities/in-app/rider-notifications.activities.ts:48-56`) — a Temporal activity that **no workflow invokes** (grep across `api/src` finds no caller).
  - The gateway's `connect_user` handler (`notifications.gateway.ts:246-365`) stores only `connections:rider:{id}` metadata and `users:online` — it never calls `setRiderAvailable` or geoadds anything, for any userType.
  - The rider availability REST toggle (`riders.service.ts:85-110`) writes a **different** geo set, `riders:active`, which the notification module never reads.
  - So Agent B's claim that the fallbacks "would find nobody" is **CONFIRMED**: GEORADIUS on an empty key returns `[]`, SMEMBERS on the empty set returns `[]`, and the workflow would return `error: 'No available riders found'`.
- In practice the fallback is also never entered on the main path, because `orderAssignmentWorkflow` always passes `foundRiders` (PostGIS results) into the notification workflow — see §1.

The only path that reaches Redis-set-based rider selection is the **legacy checkout activity `assignRider`** (`checkout.activities.ts:288+`), which uses `ridersService.getAllActiveRiders()` (a Prisma query on `is_accepting_orders`, not Redis) — and that activity is itself **dead**: declared in the saga's activity interface (`checkout-saga.workflow.ts:33`) but never invoked by the saga body.

---

## 1. Where sendRiderOrderRequestWorkflow gets its rider list

**Passed in from orderAssignmentWorkflow (PostGIS results).** Parameter flow, with quotes:

1. `orderAssignmentWorkflow` (`order-assignment.workflow.ts:230-273`) loops `searchRadiuses = [5, 10, 15, 20]`, calling the `findNearbyRiders` activity each round; on success `foundRiders = ridersResult.riders`.
2. That activity (`order-assignment.activities.ts:137-141`):
   ```ts
   const result = await this.temporal.execute('findRidersForOrderWorkflow', {
     args: [restaurantLatitude, restaurantLongitude, [radiusKm]],
     taskQueue: 'riders-queue', ...
   ```
3. `findRidersForOrderWorkflow` (`rider-discovery.workflow.ts:25-94`) loops its radii (here a single-element array per call) and calls the `findNearbyRiders` **rider activity**, which is pure PostGIS (`rider.activities.ts:75-92`):
   ```sql
   FROM rider
   WHERE is_accepting_orders = true
     AND coords IS NOT NULL
     AND ST_DWithin(coords, ST_SetSRID(ST_MakePoint(...), 4326)::geography, ${radiusKm * 1000})
   ORDER BY distance_km
   LIMIT 15
   ```
4. Back in the parent (`order-assignment.workflow.ts:322-345`):
   ```ts
   const riderRequestData: RiderOrderRequestData = {
     ...,
     checkoutId,
     foundRiders, // Pass the discovered riders
     parentWorkflowId,
   };
   ```
   then `startChild('sendRiderOrderRequestWorkflow', { taskQueue: 'notifications-queue', args: [riderRequestData], workflowExecutionTimeout: '5m', ... })` (lines 350-362).
5. In the child (`rider-order-request.workflow.ts:102-107`):
   ```ts
   if (request.foundRiders && request.foundRiders.length > 0) {
     targetRiders = request.foundRiders;
     console.log(`Using ${targetRiders.length} pre-discovered riders from order assignment`);
   ```
   The `else` branch (lines 108-143: `activities.findNearbyRiders` → GEORADIUS `riders:available:locations` 5km; then `activities.getAvailableRiders()` → SMEMBERS `riders:available:online`) executes only if `foundRiders` is absent/empty — but the parent returns early with `NO_RIDERS_FOUND` + `cancelOrderAndRefund` before starting the child if `foundRiders.length === 0` (lines 275-310), so on the assignment path the fallback is unreachable. It IS reachable via `NotificationsService.sendRiderOrderRequest` (`notifications.service.ts:103-139`) callers that omit `foundRiders` — i.e., the dead checkout `assignRider` activity and the `sendTestRiderOrder` test helper — where it finds nobody, per §0.

**Reads of `riders:available:locations`:** only `RedisUtils.findNearbyRiders` (`redis-utils.ts:196-211`) via `WebSocketActivities.findNearbyRiders` (`websocket-utils.ts:241-256`) and `rider-notifications.activities.ts:34`. **Writes:** only `RedisUtils.updateRiderLocation` (`redis-utils.ts:133-139`, guarded by membership in `riders:available:online`), reachable only through the never-invoked `RiderNotificationsActivities.setRiderLocation`. Neither the gateway `connect_user` (any userType), nor the rider availability toggle, nor the rider location PUT (`riders.controller.ts:54-84` → `riders.service.ts:55-83`, which writes PostGIS `coords` + Redis `riders:active`) ever touches it. **It is a permanently empty key.**

---

## 2. How order_request reaches a rider; client channel joins

**Delivery is a direct, in-memory socket scan by userId+userType — not a channel broadcast, and (for riders) not queue-if-offline.**

Per-rider, the workflow does (`rider-order-request.workflow.ts:146-179`):
1. `activities.checkUserConnection(riderId, 'rider')` → `RedisUtils.getUserConnection` existence check on **`connections:rider:{id}`** (`websocket-utils.ts:190-204`, `redis-utils.ts:21-28`; key written by `connect_user` with 3600s TTL). Note it checks bare existence, not the 5-minute `lastSeen` recency that `isUserConnected` (`redis-utils.ts:415-423`) would enforce.
2. If "connected": `activities.sendNotificationToRider` (`websocket-utils.ts:74-135`) → `NotificationsGateway.sendToRider` (`notifications.gateway.ts:401-435`):
   ```ts
   const targetClient = Array.from(this.server.clients).find(
     (client: WebSocketClient) =>
       client.userId === riderId && client.userType === 'rider' &&
       client.readyState === WebSocket.OPEN,
   );
   ...
   const message = JSON.stringify({ event: 'order_request', data: notification, ... });
   targetClient.send(message);
   ```
3. If offline: `console.log('Rider ... is offline, skipping')` — **riders' offers are never queued** (unlike restaurants). If the send fails, it just warns; no queue, no retry.
4. On successful send, if `notification.data.checkoutId` exists, the activity writes `order_rider_checkout_mapping:{orderId}:{riderId} -> checkoutId` (TTL 1800s) (`websocket-utils.ts:104-120`, `redis-utils.ts:732-740`) — this is the key the accept endpoint later requires.

**Rider app's three guessed channel joins** (`apps/rider/app/rider-home.tsx:155-166`: `'riders'`, `` `rider:${riderId}` ``, `` `notifications:${riderId}` ``): **all three are pure cargo cult.** The server has no broadcast that reads `subscriptions:riders`, `subscriptions:rider:{id}`, or `subscriptions:notifications:{id}` — the only channel reader is `broadcastToOrderRoom`, hardcoded to `` `order:${orderId}` `` (`notifications.gateway.ts:480-484`). The joins are harmless (they just create sets in Redis via `join_channel` → `addUserToChannel`, `notifications.gateway.ts:136-244`, `redis-utils.ts:214-231`) and have one accidental benefit: in "MVP mode" `join_channel` also auto-registers `connections:rider:{id}` + `users:online` if `connect_user` was missed (`gateway.ts:152-169`).

**Joining `order:{orderId}` after accept: correct and necessary.** Client sends `join_channel` with `{channelName: 'order:'+orderId, userId, userType: 'rider'}` (`rider-home.tsx:227`, store `useWebSocketStore.ts:250-274`); server stores member `` `rider:${riderId}` `` in `subscriptions:order:{orderId}` (`redis-utils.ts:214-231`, member format `${userType}:${userId}`); `broadcastToOrderRoom` reads exactly that set and splits `userType:userId` back out (`redis-utils.ts:262-272`, `gateway.ts:480-526`), then does the same per-client socket scan. The server also subscribes the rider itself via the `addRiderToOrderChannel` activity (`order-assignment.activities.ts:372-408` → `redis-utils.ts:315-321`) and sends a `CHANNEL_JOIN` push, which `useRiderWebSocket.ts:340-349` also handles — so the rider ends up in the set twice-idempotently. Either path alone suffices; the client-side join is a correct belt-and-braces.

---

## 3. Restaurants: delivery, offline queue, expiry numbers

**Online path:** `sendRestaurantOrderRequestWorkflow` (`restaurant-order-request.workflow.ts:25-132`) → `checkUserConnection(restaurantId,'restaurant')` → `sendNotificationToRestaurant` (`websocket-utils.ts:138-185`) → `NotificationsGateway.sendToRestaurant` (`gateway.ts:437-478`) — same direct socket scan, event name `'order_request'`. Client store connects with `connect_user {userType:'restaurant'}` (`apps/restaurant-web/src/store/useWebSocketStore.ts:78-79`) and the hook matches `event==='order_request' && data.type==='order_request'` (`orderWebSocket.ts:79-107`). Consistent.

**Offline path (BROKEN):** if not connected, the workflow calls `queueFailedNotification` (`restaurant-order-request.workflow.ts:86-104`) which `LPUSH`es into **`failed_notifications:restaurant:{id}`** with 7-day TTL (`redis-utils.ts:325-339`) and returns `queued: true, success: true`. But the reconnect delivery in `connect_user` reads a **different key**: `getQueuedNotifications` drains the zset **`queue:restaurant:{id}`** (`gateway.ts:293-333`, `redis-utils.ts:483-496`), which is only written by `queueNotificationForUser` (used by the generic `sendWebSocketNotificationWorkflow` path, `websocket-notif.activities.ts:46-61`). Grep confirms `failed_notifications:*` has **no reader anywhere** — it is a write-only dead-letter. An offline restaurant therefore never receives the queued order_request, while the checkout saga believes queuing "succeeded" and proceeds to wait forever on `restaurantResponse` (`checkout-saga.workflow.ts:346`) until the saga-level timeout kills it.

**Expiry agreement:** server sets `expiresAt: Date.now() + 1 * 60 * 1000, // 1 minute expiry` (`restaurant-order-request.workflow.ts:60`). Restaurant-web's dialog counts down from that exact server timestamp and auto-rejects at 0 (`OrderNotificationDialog.tsx:44-74`: `onReject(orderData.orderId); // Auto-reject when time expires`), with a `Date.now() + 60000` fallback only if `expiresAt` is missing (`app/orders/page.tsx:181`). **The 60s countdown and the server's 1-minute expiresAt agree.**

**Rider expiry numbers reconciled — they are three different, uncoordinated layers, all real:**
- **7s** — client-only UI: the offer drawer auto-*dismisses* (`useOrderRequestDrawer.tsx:79-88`, `duration: 7000` + `setTimeout(handleClose, 7000)`). Note it calls `handleClose`/`onClose`, **not** the reject API — the server is never told; the offer silently evaporates for that rider while the workflow keeps waiting.
- **5 min** — the child notification workflow's `workflowExecutionTimeout: '5m'` set by `orderAssignmentWorkflow` (`order-assignment.workflow.ts:357-358`), and echoed by the client's fallback `expiresAt || Date.now() + 300000` (`useRiderWebSocket.ts:215,320,447`). This is the effective hard cap on how long riders can respond. (When invoked via `NotificationsService.sendRiderOrderRequest` instead, the cap is 2 minutes — `notifications.service.ts:119`.)
- **10 min** — the notification payload's advisory `expiresAt: Date.now() + 10 * 60 * 1000` (`rider-order-request.workflow.ts:92`). Nothing server-side enforces it; the workflow's `condition()` at line 198 has no timer and relies entirely on the 5m execution timeout. So the payload advertises 10 minutes of validity that the workflow cannot actually honor.

---

## 4. Acceptance signal chain (verified end-to-end)

Rider taps Accept → client `acceptOrder(riderId, orderId)` (`rider-home.tsx:216-218`) → **`PUT /riders/:riderId/orders/:orderId?action=accept`** (`riders.controller.ts:145-284`). The controller then:

1. **Redis key #1 (gate):** `order_rider_checkout_mapping:{orderId}:{riderId}` → checkoutId (`riders.controller.ts:154-163`). Missing ⇒ hard fail `'Order checkout session expired or not found'` — accept is impossible if the offer wasn't delivered over WS with a `checkoutId` (the mapping is written at send time, §2 step 4; the dead legacy `assignRider` checkout activity also wrote it for all active riders, `checkout.activities.ts:376-384`).
2. DB write: `ridersService.acceptOrder` sets `delivery_partner_id` + `status:'RIDER_ASSIGNED'` and `zrem('riders:active', riderId)` (`riders.service.ts:136-151`).
3. **Signal A — `riderResponse` on the checkout saga** (`riders.controller.ts:206-207`: `this.temporal.getHandle(checkoutId); handle.signal(riderResponseSignal, signalData)` — signal defined at `checkout-saga.workflow.ts:78-79`). **This signal is vestigial:** the saga sets a handler (`:118-119`) but never `condition()`s on `riderResponse` — after restaurant acceptance it starts `orderAssignmentWorkflow` (via `startOrderTrackingWorkflow` activity, `checkout.activities.ts:561`) and runs to completion. The signal lands in a usually-already-completed workflow; harmless no-op.
4. **Signal B — `riderResponse` on the notification workflow** (the live one): **Redis key #2** `notification_workflow:{orderId}` → notificationWorkflowId (written by the `storeNotificationWorkflowId` activity right after `startChild`, `order-assignment.workflow.ts:364-365`, `order-assignment.activities.ts:456-483`, TTL 1800s). Controller signals `notificationRiderResponseSignal` = `'riderResponse'` defined in `rider-order-request.workflow.ts:28-31` with `{riderId, accepted, orderId, timestamp}` (`riders.controller.ts:217-233`).
5. **Who signals `riderAcceptance`: the notification workflow itself, not the controller.** `sendRiderOrderRequestWorkflow` wakes from `condition(() => riderResponse.completed)` (`:197-199`), then via `getExternalWorkflowHandle(request.parentWorkflowId)` sends **two** signals to `orderAssignmentWorkflow` (`:218-249`): first `notificationWorkflowResponseSignal` (result summary), then `riderAcceptanceSignal` with `{status:{...accepted}, orderId, riderId, timestamp}` (`:244`). Both signals are defined in `order-assignment.workflow.ts:107-112` and handled at `:143-162`; the parent proceeds past `condition(() => riderAcceptance.status.completed)` (`:409`), then `assignRiderToOrder` (DB again + `setRiderUnavailable` on the notification-side sets, `order-assignment.activities.ts:264-299`), `addRiderToOrderChannel`, `invalidateOrderForRidersWorkflow`, and starts `orderTrackingWorkflow`.

**Gaps in the chain:**
- **The whole chain hangs off two 30-min-TTL Redis strings.** If `order_rider_checkout_mapping` is gone (rider was notified via a path without checkoutId, Redis restart, >30min), accept 500s at step 1 even though the DB order is fine. If `notification_workflow:{orderId}` is gone, the controller logs `'No notification workflow found'` and **`riderAcceptance` is never signaled** — the DB already says RIDER_ASSIGNED (step 2 ran) but `orderAssignmentWorkflow` waits at `:409` until its 15m execution timeout kills it *without* running the catch-block cancel/refund (execution timeouts don't run workflow code). Split-brain: order assigned in DB, assignment workflow dead, no tracking workflow.
- The `parentWorkflowId` signal-back is best-effort (`rider-order-request.workflow.ts:250-252` swallows errors); same split-brain if it fails.
- Rejects: a single rider's reject signals `riderResponse{accepted:false}` which **completes** the notification workflow and propagates `riderAcceptance{accepted:false}` → parent cancels the whole order and refunds (`order-assignment.workflow.ts:411-446`) even if 14 other riders are still looking at the offer. First responder wins in both directions.
- The 7s client auto-dismiss never sends a reject, so an ignored offer leaves the workflow waiting for someone else (or timeout) — see §3.

---

## 5. Availability lifecycle: offline riders, disconnects, post-DELIVERED

- **Toggle offline does NOT remove from `riders:active`:** the zrem is commented out (`riders.service.ts:104-107`: `// await this.redis.hdel('riders:active', riderId);`). But dispatch discovery ignores `riders:active` entirely (it's PostGIS on `is_accepting_orders`, which the toggle *does* flip at `:90-93`), so a toggled-offline rider is correctly excluded from **dispatch**. The stale `riders:active` entry only pollutes the REST `GET /riders/nearby/search` (`riders.service.ts:218-235`, Redis-first) and the legacy `order.activities.ts:172-186` `findNearbyRiders` (georadius `riders:active`) — those can return offline riders indefinitely (the key has no TTL).
- **A rider on an active delivery CAN still receive new offers.** Nothing flips DB `is_accepting_orders=false` on accept: `acceptOrder` only zrems `riders:active` (`riders.service.ts:147`), and `assignRiderToOrder` only touches the notification-side sets `riders:available:online`/`riders:unavailable:order-assigned` (`order-assignment.activities.ts:278`) — which PostGIS discovery never consults. The rider app merely sets local UI state offline after accept (`rider-home.tsx:235` `setOnline(false)`) without calling the availability API, and stays WS-connected. So PostGIS still returns them and `checkUserConnection` still passes ⇒ concurrent offers are possible by construction.
- **A rider who merely disconnects (app killed):** stays `is_accepting_orders=true` in DB ⇒ still *discovered* by PostGIS, but delivery is gated by `connections:rider:{id}`. That key is deleted on clean `handleDisconnect` and by the 30s ping/pong stale-sweep (`gateway.ts:55-113`), otherwise expires after 1h. In the up-to-~60s window before the sweep, `checkUserConnection` passes but the socket scan fails ⇒ offer counted as failed send, not queued (riders have no offline queue). Not "receives offers while offline," but "burns offers into the void" during the window.
- **Availability after DELIVERED is never restored by any live code path.** The only restoration code is `RidersService.updateDeliveryStatus` (`riders.service.ts:163-216`: sets `is_accepting_orders: true` and re-geoadds `riders:active`), but **no route calls it** — the controller's `updateDeliveryStatus`/`updateRiderOrderStatus` endpoints (`riders.controller.ts:112-143, 286-316`) route to the tracking workflow's `orderStatusUpdate` update, whose `updateOrderStatus` activity only writes `order.status` (`order-tracking.activities.ts:195-225`); the tracking workflow just sets `orderCompleted=true` on DELIVERED (`order-tracking.workflow.ts:101-103`). Even if the dead service method were called, its location query is doubly broken: it selects `ST_Y(location)` from a nonexistent `location` column (the column is `coords`) and compares `id = ${riderId}` without a `::uuid` cast (`riders.service.ts:190-197`). Saving grace: because accept never set `is_accepting_orders=false` (previous bullet), the rider never left the PostGIS pool, so "restoration" is accidentally unnecessary — the flag only goes false via the manual toggle. The notification-side `setRiderUnavailable` marking from `assignRiderToOrder` is likewise never reversed (no `setRiderAvailable` caller), permanently accumulating riders in `riders:unavailable:order-assigned` (7200s TTL is its only cleanup).

---

## 6. Step-by-step trace of one order's dispatch

1. Checkout saga: restaurant accepted ⇒ `startOrderTrackingWorkflow` activity (`checkout-saga.workflow.ts:373-382`) ⇒ `temporal.start('orderAssignmentWorkflow', {args:[orderId, checkoutId], taskQueue:'orders-queue', workflowExecutionTimeout:'15m'})` (`checkout.activities.ts:561-570`).
2. `orderAssignmentWorkflow`: `getOrderDetails` (Prisma, `order-assignment.activities.ts:204`), `getRestaurantLocation` (PostGIS `restaurant_address.coords`, `:410-454`), `createOrderChannel` ⇒ `subscriptions:order:{id}` gets `user:{customerId}`, `restaurant:{restaurantId}` (`redis-utils.ts:279-298`) + `CHANNEL_JOIN` pushes to both (`order-assignment.activities.ts:67-123`).
3. Radius loop 5→10→15→20 km (`order-assignment.workflow.ts:230-273`): each round `findNearbyRiders` activity ⇒ child `findRidersForOrderWorkflow` on riders-queue ⇒ PostGIS `ST_DWithin` on `rider.coords`, `is_accepting_orders=true`, LIMIT 15 (`rider.activities.ts:75-92`). Zero riders at 20km ⇒ `cancelOrderAndRefund` + `NO_RIDERS_FOUND`/`ORDER_CANCELLED` broadcasts (`:275-310`).
4. `startChild('sendRiderOrderRequestWorkflow', {taskQueue:'notifications-queue', workflowExecutionTimeout:'5m', args:[{...foundRiders, checkoutId, parentWorkflowId}]})` (`:350-362`) then `storeNotificationWorkflowId` writes `notification_workflow:{orderId}` (`:365`).
5. Child uses `foundRiders` verbatim (`rider-order-request.workflow.ts:103-107`); per rider: `checkUserConnection` on `connections:rider:{id}` ⇒ `sendToRider` direct socket scan, event `order_request`, payload `expiresAt=+10min` (`:92, :146-179`; `gateway.ts:401-435`); on success writes `order_rider_checkout_mapping:{orderId}:{riderId}` TTL 30m (`websocket-utils.ts:104-120`). Offline riders skipped, never queued.
6. Rider app (connected via `connect_user {userType:'rider'}`, `useWebSocketStore.ts:55-64`) receives `order_request` (`useRiderWebSocket.ts:221-338`), shows drawer; drawer auto-closes at 7s without telling the server (`useOrderRequestDrawer.tsx:79-88`).
7. Accept: `PUT /riders/:riderId/orders/:orderId?action=accept` ⇒ mapping lookup ⇒ DB `RIDER_ASSIGNED` + zrem `riders:active` ⇒ signal `riderResponse` to checkout saga (no-op) and to notification workflow (live) (`riders.controller.ts:145-260`).
8. Notification workflow wakes (`:197-199`), signals parent `notificationWorkflowResponse` then `riderAcceptance` (`:218-249`).
9. Parent: `assignRiderToOrder` (DB again + notification-side unavailable marks, `order-assignment.activities.ts:264-299`), `addRiderToOrderChannel` (adds `rider:{id}` to `subscriptions:order:{id}` + `CHANNEL_JOIN` push, `:372-408`); client independently joins `order:{orderId}` (`rider-home.tsx:227`). `invalidateOrderForRidersWorkflow` notifies "other riders" — but iterates the empty `riders:available:online` set (`websocket-utils.ts:259-313`), so **invalidation reaches nobody**; the controller-side `invalidateOrderForOtherRiders` call (`riders.controller.ts:182`) has the same empty-set problem.
10. `orderTrackingWorkflow` starts (`order-assignment.workflow.ts:534-544`); subsequent `order_update`s flow via `broadcastToOrderRoom` to the `subscriptions:order:{id}` members (`gateway.ts:480-526`).

---

## 7. Client subscription vs server delivery — verdict table

| Client action / subscription | Server-side mechanism | Verdict |
|---|---|---|
| Rider `connect_user {userId, userType:'rider'}` (`useWebSocketStore.ts:55-64`) | Sets `client.userId/userType` used by `sendToRider` socket scan; writes `connections:rider:{id}` (TTL 1h) + `users:online`; drains `queue:rider:{id}` (`gateway.ts:246-365`) | **Used — this is the only thing that makes offer delivery possible** |
| Rider joins `'riders'` (`rider-home.tsx:158`) | No server code reads `subscriptions:riders` | **Ignored (cargo cult)** |
| Rider joins `` `rider:${id}` `` (`rider-home.tsx:159`) | No reader | **Ignored (cargo cult)** |
| Rider joins `` `notifications:${id}` `` (`rider-home.tsx:160`) | No reader | **Ignored (cargo cult; side-effect: MVP auto-auth in join_channel if connect_user missed)** |
| Rider receives `order_request` event | `sendToRider` direct scan by `userId+userType='rider'`, event `'order_request'` (`gateway.ts:401-435`) | **Used — matches client handler** (`useRiderWebSocket.ts:221`) |
| Rider joins `` `order:${orderId}` `` after accept (`rider-home.tsx:227`) | `broadcastToOrderRoom` reads `subscriptions:order:{id}` members `userType:userId` (`gateway.ts:480-526`; join stores `rider:{id}` per `redis-utils.ts:220`) | **Used & format-correct** (redundant with server's own `addRiderToOrderChannel`, harmlessly idempotent) |
| Rider `CHANNEL_JOIN` push handling (`useRiderWebSocket.ts:340-349`) | Sent by `notifyClientsToJoinChannel`/`addRiderToOrderChannel` (`order-assignment.activities.ts:67-123, 372-408`) | **Used** |
| Rider offline offer queueing (client expects queued notifications on reconnect, `useRiderWebSocket.ts:592`) | Rider path never queues offers (skip on offline, `rider-order-request.workflow.ts:173-175`); only generic `sendWebSocketNotificationWorkflow` queues to `queue:rider:{id}` | **Broken expectation for offers (works only for generic notifications)** |
| Rider 7s drawer auto-dismiss (`useOrderRequestDrawer.tsx:86-88`) | Server waits up to 5m (child execution timeout); no reject sent on dismiss | **Mismatch — offer silently abandoned client-side** |
| Restaurant `connect_user {userType:'restaurant'}` (`restaurant-web useWebSocketStore.ts:78-79`) | Same scan basis for `sendToRestaurant`; drains `queue:restaurant:{id}` | **Used** |
| Restaurant receives `order_request` (`orderWebSocket.ts:79-107`) | `sendToRestaurant` direct scan, event `'order_request'` (`gateway.ts:437-478`) | **Used** |
| Restaurant offline → queued offer redelivery on reconnect | Workflow queues to `failed_notifications:restaurant:{id}` (`redis-utils.ts:325-339`); reconnect drains **`queue:restaurant:{id}`** — key mismatch, `failed_notifications` has zero readers | **Broken — queued restaurant offers are never delivered** |
| Restaurant 60s auto-reject countdown (`OrderNotificationDialog.tsx:62-70`) | Server `expiresAt = +1 minute` (`restaurant-order-request.workflow.ts:60`) | **Used — agree** |
| Restaurant joins `order:{id}` on `CHANNEL_JOIN` (`orderWebSocket.ts:110-128`) | Server already subscribed restaurant in `createOrderChannel`; broadcast reads the set | **Used (idempotent)** |
| (Server) rider fallback discovery: GEORADIUS `riders:available:locations`, SMEMBERS `riders:available:online` (`rider-order-request.workflow.ts:108-143`) | No writer anywhere populates either key | **Broken/dead — would always find nobody** |
| (Server) `invalidateOrderForRidersWorkflow` "notify other riders" | Iterates empty `riders:available:online` (`websocket-utils.ts:269`) | **Broken — invalidations reach no one** |

---

## 8. Broken links summary (dispatch chain)

1. **`riders:available:locations` / `riders:available:online` are write-orphaned** — every notification-module fallback and the accepted-order invalidation fan-out read empty sets. (Contradiction resolver.)
2. **Restaurant offline queue key mismatch** — `failed_notifications:restaurant:{id}` (written) vs `queue:restaurant:{id}` (drained on reconnect); queued offers vanish while the saga is told `queued:true`.
3. **Accept path is Redis-fragile** — requires both `order_rider_checkout_mapping:{orderId}:{riderId}` (30m TTL, written only on successful WS send with checkoutId) and `notification_workflow:{orderId}` (30m TTL); loss of the second yields DB-assigned order + permanently hung `orderAssignmentWorkflow` (15m execution timeout, no cancel/refund executes on execution timeout).
4. **Riders never receive offline/queued offers**, and the 7s client auto-dismiss never rejects — the server can spend up to 5m waiting on offers no one can see.
5. **Rider availability is never flipped off in the dispatch source of truth on accept** (`is_accepting_orders` stays true) ⇒ concurrent offers to a busy rider; conversely the DELIVERED restoration code (`riders.service.ts:163-216`) is dead code and internally broken (`location` column doesn't exist; missing `::uuid` cast).
6. **`riders:active` offline zrem commented out** (`riders.service.ts:106`) — stale entries poison the Redis-first REST nearby search (no TTL), though not workflow dispatch.
7. Expiry numbers are three uncoordinated layers: 7s (client UI dismiss) < 5m (real cap: child workflow execution timeout) < 10m (advertised payload `expiresAt`, unenforced).
