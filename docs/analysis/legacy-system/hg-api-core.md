# hg-api — Core Infrastructure Layer (Exhaustive Analysis)

Scope: `/home/user/hg-api/api/src/core` (cache, files, notifications, prisma, redis, redis-streams, temporal), `/home/user/hg-api/api/src/common` (constants, events, types, utils), and `/home/user/hg-api/api/src` root files (`main.ts`, `app.module.ts`, `workflows.ts`).

API package: `@hg/api` v1.2.26 (NestJS 11, Prisma 6.16, ioredis 5.7, Temporal SDK 1.13, minio 8.0.6, ws 8.18, zod 4, nestjs-temporal 2.0.1, nestjs-pino, better-auth 1.3.13 [declared but unused], socket.io 4.8.1 [declared but the app uses the plain `ws` adapter]).

---

## 1. Purpose & Role

This layer is the plumbing for the whole HalalGoes backend:

- **Bootstrap** (`main.ts`, `app.module.ts`): Nest app creation, Swagger/Scalar docs, WebSocket adapter, Temporal client connection, global config/event-emitter/logger, module wiring.
- **Prisma** (`core/prisma`): the single PostgreSQL access point used by every feature service.
- **Redis** (`core/redis`): a thick ioredis wrapper (strings, hashes, sets, zsets, geo, lists, keys/expire) with optional Sentinel HA mode; this is the real-time state store of the platform (presence, rider geolocation, notification queues, channel membership).
- **Cache** (`core/cache`): Nest cache-manager + Keyv/Redis global cache (separate connection from `RedisService`).
- **Files** (`core/files`): a dynamic-module wrapper around the MinIO client for object storage (currently **not wired up** — registration commented out).
- **Notifications** (`core/notifications`): the largest core module — a WebSocket gateway (port 9080), Redis-backed presence/queue/geo utilities exposed as Temporal **activities**, and Temporal **workflows** for websocket/push/email/sms delivery plus restaurant/rider order-request fan-out. It also registers the Temporal **worker** for the `notifications-queue` task queue.
- **Temporal & Redis-Streams stubs** (`core/temporal`, `core/redis-streams`): empty placeholder services/modules.
- **Common** (`src/common`): shared checkout saga types/events, workflow-ID generators, uuid type, nanoid helper.
- **`workflows.ts`**: central re-export of every feature service's Temporal workflows "for Temporal discovery".

---

## 2. Bootstrap & Root Files

### 2.1 `src/main.ts`
- `Runtime.install({})` from `@temporalio/worker` is executed **once at module load, globally**, before Nest bootstraps (comment: "Install Temporal Runtime once globally").
- `NestFactory.create(AppModule, { bufferLogs: true })`.
- Pino logger (`nestjs-pino`) is used **only when `NODE_ENV` is `production`** (`process.env.NODE_ENV?.toLowerCase() === 'production'`); otherwise default Nest logger.
- Swagger: `DocumentBuilder` title "HalalGoes API", description "HalalGoes API docs", version `1.0.0`; `patchNestjsSwagger()` from `@anatine/zod-nestjs` for zod DTOs.
- Docs UI: **Scalar** (`@scalar/nestjs-api-reference`) mounted at **`/api/docs`**, theme `deepSpace`, default HTTP client node/axios, favicon `/favicon.svg`.
- `app.enableShutdownHooks()` — noted "For prisma".
- `app.useWebSocketAdapter(new WsAdapter(app))` — plain **ws** (not socket.io) despite socket.io being in package.json.
- HTTP port: `process.env.PORT || 3456`.
- No global pipes, no global guards, no CORS config, no helmet, no validation pipe at bootstrap.

### 2.2 `src/app.module.ts`
Imports (all global-ish):
- `ConfigModule.forRoot({ isGlobal: true })`.
- `LoggerModule.forRoot({})` (nestjs-pino, default config).
- `EventEmitterModule.forRoot({ delimiter: '.', maxListeners: 10, verboseMemoryLeak: true, wildcard: true, global: true })`.
- `TemporalModule.registerClientAsync` (nestjs-temporal): connects `Connection.connect({ address: TEMPORAL_ADDRESS || 'localhost:7233' })`, namespace `TEMPORAL_NAMESPACE || 'default'`.
- **Commented-out** `FilesModule.registerAsync` block reading `MINIO_ENDPOINT` (default `localhost`), `MINIO_PORT` (9000), `MINIO_USE_SSL` (false), `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `pathStyle: true`. Because it's commented out and `FilesModule` is not in the imports array, **MinIO is never available via DI**.
- Feature modules: Feed, Prisma, Users, Cache, Orders, Riders, Restaurants, Pricing, Payments, Admin, Redis, RedisStreams, Temporal (nestjs-temporal module class itself — likely a mistake, see §9), Notifications, Carts, Checkout, Ratings.
- `controllers: [CartsController]` — a feature controller registered at root (also registered in CartsModule → duplicate route registration risk).
- `providers: [RedisService, RedisStreamsService, TemporalService, TemporalWorkerService, CartsService]` — RedisService is *also* provided by RedisModule, meaning **two separate RedisService instances / connections** can exist (root injector vs RedisModule consumers).
- Unused import: `KeyvRedis` from `@keyv/redis`.

### 2.3 `src/workflows.ts`
Central barrel that re-exports workflows from all nine feature services (payments, orders, checkout, carts, feed, pricing, restaurants, riders, users) — used for Temporal workflow discovery/bundling. Notifications workflows are *not* exported here; they are bundled separately by `NotificationsModule` (`bundleWorkflowCode({ workflowsPath: __dirname/core/notifications/workflows })`).

### 2.4 Guards / middleware
**There are none.** `grep` for `Guard`/`Middleware` across `src/` returns zero hits. No auth guard, no rate limiting, no request validation middleware exists anywhere in the API. `better-auth` is a dependency but is referenced nowhere in `src/`.

---

## 3. Complete Inventory

| Unit | Kind | File |
|---|---|---|
| bootstrap | entrypoint | `api/src/main.ts` |
| AppModule | root module | `api/src/app.module.ts` |
| workflow barrel | export hub | `api/src/workflows.ts` |
| PrismaModule / PrismaService | DB access | `api/src/core/prisma/*` |
| CacheModule / CacheService | keyv-redis cache | `api/src/core/cache/*` |
| RedisModule / RedisService | ioredis wrapper (+Sentinel) | `api/src/core/redis/*` |
| RedisStreamsModule / RedisStreamsService | **empty stub** | `api/src/core/redis-streams/*` |
| TemporalCoreModule / TemporalService / TemporalWorkerService | **empty stubs** | `api/src/core/temporal/*` |
| FilesModule / FilesService / MINIO_OPTIONS | MinIO dyn. module (unwired) | `api/src/core/files/*` |
| NotificationsModule | worker + gateway module | `core/notifications/notifications.module.ts` |
| NotificationsService | workflow launcher facade | `core/notifications/notifications.service.ts` |
| NotificationsGateway | WS gateway @ port 9080 | `core/notifications/notifications.gateway.ts` |
| WebSocketStatusService | uptime/health helper | `core/notifications/services/websocket-status.service.ts` |
| RedisUtils | Redis activities (presence/geo/queues/channels) | `core/notifications/activities/redis-utils.ts` |
| NotificationsRedisStore | legacy delegation wrapper | `core/notifications/activities/redis-store.ts` |
| WebSocketNotificationUtilitiesImpl | WS delivery activities | `core/notifications/activities/websocket-notif.activities.ts` |
| WebSocketActivities | WS send/find-rider activities | `core/notifications/activities/websocket-utils.ts` |
| UserNotificationActivities | user in-app activities | `activities/in-app/user-notifications.activities.ts` |
| RiderNotificationActivities | rider in-app activities | `activities/in-app/rider-notifications.activities.ts` |
| RestaurantNotificationActivities | restaurant in-app activities | `activities/in-app/restaurant-notifications.activities.ts` |
| AdminNotificationActivities | admin activities (all TODO) | `activities/in-app/admin-notifications.activities.ts` |
| OrderChannelNotificationActivities | **dead code** (unregistered, send logic commented out) | `activities/channels/order-notifs.activities.ts` |
| checkout-notifs.activities.ts | **empty file** | `activities/channels/checkout-notifs.activities.ts` |
| notification-sent.event.ts / .listener.ts | **empty files** | `core/notifications/events`, `.../listeners` |
| sendWebSocketNotificationWorkflow, removeNotificationFromQueuesWorkflow, markNotificationAsReadWorkflow, sendNotificationWorkflow | Temporal workflows | `workflows/delivery-channels/websocket/websocket-notification.workflow.ts` |
| sendPushNotificationWorkflow | Temporal workflow (activity impl missing) | `workflows/delivery-channels/push/...` |
| sendEmailNotificationWorkflow | Temporal workflow (activity impl missing) | `workflows/delivery-channels/email/...` |
| sendSmsNotificationWorkflow | Temporal workflow (activity impl missing) | `workflows/delivery-channels/sms/...` |
| sendRestaurantOrderRequestWorkflow | Temporal workflow | `workflows/user-types/restaurant-order-request.workflow.ts` |
| sendRiderOrderRequestWorkflow, invalidateOrderForRidersWorkflow, riderResponseSignal | Temporal workflow + signal | `workflows/user-types/rider-order-request.workflow.ts` |
| NOTIFICATION_REDIS_KEYS | Redis key registry | `constants/redis-keys.ts` |
| NOTIFICATION_CHANNELS | channel-name registry | `constants/channels.ts` |
| NOTIFICATION_EVENTS | event-name registry (unused in scope) | `constants/events.ts` |
| genId | nanoid id helper (`prefix_` + 12-char) | `constants/ids.ts` |
| WorkflowIds | workflow-ID generators | `common/constants/workflow-ids.constants.ts` |
| CheckoutStep, CheckoutSagaEvent, CheckoutInitiatedEvent | saga steps/events | `common/events/checkout.events.ts` |
| checkout.types.ts | saga DTOs (BaseResponse, PricingSnapshot, CheckoutData…) | `common/types/checkout.types.ts` |
| uuid type | zod uuidv4-derived type alias | `common/types/uuid.types.ts` |
| genRandomId | nanoid custom alphabet (12) | `common/utils/gen-workflow-id.ts` |
| ~15 type files | notification type system | `core/notifications/types/**` |

---

## 4. Prisma, Cache, Redis, Files — Details

### 4.1 PrismaService (`core/prisma/prisma.service.ts`)
- Extends `PrismaClient`; `log: ['query','info','warn','error']` and `errorFormat: 'pretty'` **always on** (query logging even in production).
- `$connect` on module init, `$disconnect` on destroy.
- `getClient(options?)` mints brand-new `PrismaClient` instances (merged with the same defaults) — connection-pool multiplication hazard if used carelessly.
- `DATABASE_URL` / `DB_DIRECT_URL` come from env (docker-compose points both directly at `postgres-halalgoes:5432`, **bypassing the PgBouncer** container the compose file provisions).

### 4.2 CacheModule / CacheService (`core/cache`)
- `NestCacheModule.registerAsync({ isGlobal: true, useFactory: () => ({ stores: [createKeyv('redis://localhost:6379')], ttl: 5000 }) })`.
- **Hardcoded** `redis://localhost:6379` — ignores `REDIS_HOST`/`REDIS_PORT`; inside the docker network (Redis at `redis-master`) this cache silently cannot reach Redis. Default TTL 5000 ms.
- `CacheService` is a minimal typed wrapper: `get<T>`, `set<T>(key, value, ttl?)`, `delete`. Only consumer in `src/`: `services/users/users.controller.ts`.

### 4.3 RedisService (`core/redis/redis.service.ts`)
- File's own header comment wrongly says `src/core/notifications/redis.service.ts`.
- **Sentinel mode** if `REDIS_USE_SENTINEL=true`: parses `REDIS_SENTINELS` CSV (default `redis-sentinel-1:26379`), master name `REDIS_MASTER_NAME` (default `mymaster`), plus `REDIS_PASSWORD`, `REDIS_DB` (default 0).
- **Standalone mode** (default): `REDIS_HOST` (default `localhost`), `REDIS_PORT` (6379), `REDIS_DB` (0), `REDIS_PASSWORD`, `lazyConnect: true`.
- Common options: `maxRetriesPerRequest: null`, exponential backoff retryStrategy capped at 30 s + 0–1 s jitter (`min(30000, 50*2^times)+jitter`), `reconnectOnError` only on messages containing `READONLY` (Sentinel failover case).
- Lifecycle: connect in `onModuleInit` (errors swallowed so app still boots), `quit()` then forced `disconnect()` on destroy. Logs connect/ready/reconnecting/error/end events.
- Operation surface: get/set(EX)/del/exists; hkeys/hset/hget/hgetall/hdel; sadd/srem/smembers/sismember; setJson (SETEX+JSON)/getJson; geoadd/georadius(WITHDIST,ASC,km)/geodist; lpush/lrange; zadd/zrem/zrange/zrevrange/zrangebyscore/zcard/zscore; `keys(pattern)` (KEYS — O(N) production smell); expire/ttl; `getClient()` escape hatch; `rehydrateChannels(prefix='channel:*:members')` which KEYS+SMEMBERS all channel member sets.

### 4.4 FilesModule / FilesService (`core/files`)
- `FilesService<T extends ClientOptions>` **extends the MinIO `Client`** directly and injects options via `MINIO_OPTIONS` symbol.
- Dynamic module with `register(options)` and `registerAsync({useFactory|useValue|useExisting, imports})`; throws `'FilesModule registerAsync options require a provider'` if none given.
- Base `@Module` decorator also lists `FilesService` in providers/exports — if imported statically (it isn't), DI would fail for lack of `MINIO_OPTIONS`.
- **Currently dead**: the only registration site is commented out in `app.module.ts`. Docker-compose still passes `MINIO_ACCESS_KEY` / `MINIO_ACCESS_SECRET` env (note the *code* expected `MINIO_SECRET_KEY`, compose provides `MINIO_ACCESS_SECRET` — mismatched names had it ever been enabled).

### 4.5 Stubs
- `RedisStreamsModule` = empty `@Module({})`; `RedisStreamsService` = empty `@Injectable()`. Both are imported/provided in AppModule anyway.
- `TemporalCoreModule` (empty, has unused imports of ConfigModule/TemporalModule/Connection), `TemporalService` (empty), `TemporalWorkerService` (empty) — all placeholders; real Temporal wiring is done by `nestjs-temporal` in AppModule (client) and per-feature modules (workers).

---

## 5. Notifications Subsystem

### 5.1 Module & Temporal worker (`notifications.module.ts`)
- Registers a Temporal worker via `TemporalModule.registerWorkerAsync`:
  - `NativeConnection.connect({ address: TEMPORAL_ADDRESS || 'localhost:7233' })`
  - `taskQueue: 'notifications-queue'`
  - `workflowBundle = bundleWorkflowCode({ workflowsPath: __dirname + '/workflows' })` — bundles only the notifications workflows (which nonetheless import signal definitions from `src/services/orders/workflows/order-assignment.workflow`).
  - `activityClasses`: RedisUtils, User/Rider/Restaurant/Admin NotificationActivities, WebSocketNotificationUtilitiesImpl, WebSocketActivities. (`OrderChannelNotificationActivities` and the empty checkout activities are **not** registered.)
- Providers additionally include `NotificationsRedisStore` and `WebSocketStatusService`; exports `NotificationsGateway` + `NotificationsService`.
- Platform-wide there are 10 `registerWorkerAsync` call sites (one per feature module + this one); task queues observed across the codebase: `notifications-queue`(9 refs), `orders-queue`(8), `payments-queue`(5), `feed-queue`(3), `cart-queue`(3), `riders-queue`(2), `pricing-queue`(2), `checkouts-queue`(2), `users-queue`(1), `restaurants-queue`(1).

### 5.2 NotificationsGateway (`notifications.gateway.ts`)
- `@WebSocketGateway(9080, { cors: { origin: '*' } })` — **hardcoded port 9080**, wide-open CORS, raw `ws` server.
- Heartbeat: every 30 s iterates clients, terminates those that missed pong (`isAlive=false`), cleaning their Redis connection + online status first. Pong sets `isAlive=true`.
- Message handlers (`@SubscribeMessage`):
  - `heartbeat` → `WebSocketStatusService.handleHeartbeat` (replies `heartbeat_response` with uptime).
  - `status` → `status_response` (uptime, total/active connections, per-userType breakdown).
  - `health_check` → `health_check_response` (`healthy` | `degraded` when active < 80% of total | `unhealthy` when active=0 with connections>0).
  - `connect_user` — payload `{userId, userType}` (userType ∈ user|rider|restaurant|admin). **No authentication**: whatever id the client claims is trusted. Stores `ConnectionMetadata` in Redis (1 h TTL), adds to `users:online`, then drains and delivers the user's queued notifications (zrevrange by priority, queue deleted after read, each marked delivered), replies `connection_confirmed` with `queuedNotificationsDelivered` count. Errors → `connection_error`.
  - `join_channel` — "**MVP: Allow joining channels without prior authentication**": if the socket has no identity, it auto-connects using `userId`/`userType` from the message body. Channel name accepted as `data.channelName`, `data.data.channelName`, or the raw string. Adds member to `subscriptions:<channel>` and to the connection's channel list; replies `channel_joined` / `channel_error`.
- Delivery methods (used by activities): `sendToUser` (event `notification`), `sendToRider` (event `order_request`), `sendToRestaurant` (event `order_request`) — each scans `server.clients` linearly for a matching `userId`+`userType` with `readyState === OPEN`, sends JSON `{event, data, timestamp}`, updates last-seen. `broadcastToOrderRoom(orderId)` resolves subscribers of `order:<orderId>` from Redis and sends `order_update` to each connected one.
- `handleDisconnect` removes connection + sets user offline; `handleConnection` just marks alive & registers pong handler (no identity until `connect_user`/`join_channel`).

### 5.3 NotificationsService (workflow launcher facade)
All methods start workflows on **`notifications-queue`** via injected `WorkflowClient` and swallow errors into failure-shaped results:

| Method | Workflow | workflowId pattern | Timeout |
|---|---|---|---|
| `sendRestaurantOrderRequest` | `sendRestaurantOrderRequestWorkflow` | `WorkflowIds.restaurantNotification('rest_order_notif', orderId)` → `rest_order_notif_<random12>` (orderId ignored!) | 2 m |
| `sendRiderOrderRequest` | `sendRiderOrderRequestWorkflow` | `rider-order-request-<orderId>-<Date.now()>` | 2 m |
| `invalidateOrderForOtherRiders` | `invalidateOrderForRidersWorkflow` | `invalidate-order-<orderId>-<riderId>-<ts>` | 1 m |
| `sendWebSocketNotification` | `'sendWebSocketNotificationWorkflow'` (string name, `start`+`result`) | `ws_<notifId>` where notifId=`genId('notif')` | 1 m |
| `removeNotificationsFromGroup` | `removeNotificationFromQueuesWorkflow` | `remove-notifications-<group>-<ts>` | 30 s |
| `markNotificationAsRead` | `markNotificationAsReadWorkflow` | `mark-read-<notifId>-<userId>` | 30 s |

- `SendNotificationRequest.type ∈ order_update | checkout_update | personalized | order_request | order_acceptance`; userType ∈ user|rider|restaurant|admin; default titles/messages generated per type.
- Utility passthroughs to RedisUtils: `getConnectionStats`, `cleanupExpiredConnections`, `getNotificationStats`.
- Test helpers `sendTestRestaurantOrder` / `sendTestRiderOrder` fabricate full order payloads (Test Pizza Palace, hardcoded NYC lat/lngs 40.7128/-74.006 etc.).

### 5.4 RedisUtils — the Redis state machine (activities)
Key TTLs and semantics (all keys in §6):
- Connections: `connections:<userType>:<userId>` JSON, TTL 3600 s; `updateLastSeen` refreshes; `isUserConnected` = metadata exists AND lastSeen within **5 minutes**.
- Presence sets: `users:online` (TTL 7200 refreshed on add), `riders:available:online` / `riders:unavailable:order-assigned` (7200), `restaurants:accepting` (7200). `setRiderUnavailable(riderId, orderId?)` also writes hash `rider:<riderId>:assignment` field `orderId`.
- Geo: `riders:available:locations` and `riders:unavailable:locations` GEO sets (TTL 7200); per-rider `rider:<id>:location` written with **GEOADD using the timestamp as member** (see bug in §9); restaurants in `restaurants:locations` GEO set + per-restaurant JSON `restaurant:<id>:location` (both TTL 30 days). `findNearbyRiders(lat, lng, radiusKm=5)` → GEORADIUS WITHDIST ASC.
- Channels: `subscriptions:<channelName>` set of `"<userType>:<userId>"` strings, TTL 86400 (order channels 24 h, checkout channels 1800 s); membership mirrored into the connection metadata's `channels` array. `createOrderChannel(orderId,userId,restaurantId,riderId?)` subscribes all parties to `order:<orderId>`; `createCheckoutChannel` subscribes user to `checkout:<checkoutId>`.
- Notification lifecycle: metadata JSON at `notification:<id>` (TTL 7 d, status pending→queued/delivered/read/removed with `updatedAt`); per-user priority index zset `notifications:priority:<userType>:<userId>` (7 d); offline queue zset `queue:<userType>:<userId>` scored by priority (urgent 1000, high 500, normal 100, low 10, default 50 — note **'medium' is not mapped** and falls to 50); group index set `notifications:group:<group>` (7 d); read set `read:<userId>` (30 d); legacy failed queue list `failed_notifications:<userType>:<userId>` (7 d, lpush with `retryCount: 0`).
- `getQueuedNotifications` = zrevrange whole queue then **DEL** (destructive drain).
- `removeNotificationsByGroup(group, excludeUserId?)` walks the group set, removes matching items from each user's queue zset + priority zset, marks status `removed`, deletes group key.
- `markOrderAsAccepted(orderId, riderId)` → JSON at `order:<orderId>:accepted` (1 h).
- `setOrderRiderCheckoutMapping(orderId, riderId, checkoutId, ttl=1800)` → `order_rider_checkout_mapping:<orderId>:<riderId>` = checkoutId.
- `getAllConnections`/`getConnectionStats`/`cleanupExpiredConnections` use `KEYS connections:*:*` scans; cleanup threshold 2 h stale lastSeen.
- `getOnlineRidersFromHash` reads HKEYS of `online:riders` — **no writer for that hash exists anywhere in `src/`** (presumably legacy).
- `getNotificationStats` global path does `KEYS queue:*` per userType and `KEYS notification:*` then GETs each — explicitly commented as expensive.

### 5.5 NotificationsRedisStore (legacy adapter)
Wraps RedisUtils for older call sites: `setUserOnline(userId, payload)` (defaults userType 'user'), `setRiderLocation(riderId, lng, lat, available=true)` (updates geo + availability), `removeRiderFromAll`, `setRestaurantAccepting/unset`, and raw channel-set helpers on `channel:order:<orderId>:members` / `channel:checkout:<checkoutId>:members` keys (`createChannel` does the `sadd '__created'` + `srem` trick to instantiate an empty set). Used by the in-app activity classes.

### 5.6 Activity classes
- **WebSocketNotificationUtilitiesImpl** (`@Activities()`): `sendWebSocketNotification(data)` — stores metadata, checks connectivity, queues if offline or delivery fails, else delivers via gateway and marks delivered. Returns `{notificationId, success, delivered, queued, userConnected, deliveredAt?}` — but `notificationId` is a **freshly generated id**, not `data.id` that everything is stored under. `removeNotificationsFromQueues`, `markNotificationAsRead`. `deliverViaWebSocket` is a **private method yet decorated `@Activity()`**; admin delivery is a TODO returning false.
- **WebSocketActivities** (`@Activities()`): `sendNotificationToUser/Rider/Restaurant` (connection check → gateway send; the rider variant creates the order-rider-checkout mapping when `notification.data.checkoutId` exists), `checkUserConnection`, `queueFailedNotification`, `getAvailableRiders`, `findNearbyRiders`, `invalidateOrderForOtherRiders` (sends an `order_request` "Order No Longer Available" notification, 5 min expiry, to every available rider except the acceptor).
- **UserNotificationActivities**: sendToUser, setUserOnline/Offline, getAllOnlineUsers, add/remove user to order/checkout channels (legacy `channel:*:members` keys), broadcastToOrderRoom, broadcastToAllUsers (sequential loop), sendOrderUpdate / sendCheckoutUpdate / sendPersonalizedNotification (compose `UserNotification` with ids like `order_update_<userId>_<ts>` and immediately send).
- **RiderNotificationActivities**: sendToRider, getOnlineRiders (dead hash), getRidersNearLocation, markOrderAsTaken, setRiderLocation, setRiderOffline, broadcastToNearbyRiders.
- **RestaurantNotificationActivities**: sendToRestaurant, setRestaurantAccepting/NotAccepting, add/removeRestaurantToOrderChannel, broadcastToAcceptingRestaurants, `broadcastToRestaurantsInRegion` (**placeholder returning 0**), notifyRestaurantOfNewOrder, notifyRestaurantOfRiderArrival.
- **AdminNotificationActivities**: `sendToAdmin`/`broadcastToAllAdmins` are **TODO stubs returning false/0**, so sendSystemAlert / sendHighDemandAlert / sendRiderShortageAlert / sendPaymentIssueAlert / sendFraudDetectionAlert all no-op (priorities labeled medium/high/critical).
- **OrderChannelNotificationActivities**: not registered anywhere; its per-subscriber send switch is fully commented out so `success` is always false → returns 0. Dead code.

### 5.7 Workflows (run on `notifications-queue`)
- **sendWebSocketNotificationWorkflow(data)** — single activity call (30 s STC timeout, 3 attempts, backoff 1s→10s ×2). Always returns `success: true` if the activity resolves (even when the activity itself reported failure/queued).
- **removeNotificationFromQueuesWorkflow(group, excludeUserId?)**, **markNotificationAsReadWorkflow(id, userId)** — thin wrappers.
- **sendNotificationWorkflow(request)** — legacy/general: creates order_update/checkout_update/personalized notifications via activities, queues to `failed_notifications` if no connection; `proxyActivities` is called **inside the workflow function body** (2 min timeout, 3 attempts).
- **push / email / sms notification workflows** — identical shells calling `sendPushNotification` / `sendEmailNotification` / `sendSmsNotification` activities with retry (30–60 s timeouts) — **no activity implementations exist anywhere**, so these workflows would fail if ever started; nothing starts them.
- **sendRestaurantOrderRequestWorkflow(request)** — validates restaurantId (`ApplicationFailure` type `InvalidRestaurant`, non-retryable), checks restaurant connection; offline ⇒ queue to failed notifications and return `success: true, queued: true`; online ⇒ send (failure ⇒ retryable `NotificationSendFailed`). Runs in a `CancellationScope.cancellable`; on error classifies cancellation/ApplicationFailure, optionally queues, returns deterministic failure result (never throws). Notification: priority `high`, **expiresAt = now + 1 minute**, carries checkoutId for signaling back. Retry: 3 attempts, 1s→5s, nonRetryable types `['RestaurantOffline','InvalidRestaurant']`.
- **sendRiderOrderRequestWorkflow(request)** — defines/handles `riderResponseSignal` (`{riderId, accepted, orderId, timestamp}` — only accepted if orderId matches). Rider selection: `request.foundRiders` (pre-discovered) → else `findNearbyRiders` within **5 km** of restaurant → else all available riders → else fail `'No available riders found'`. Loops riders sequentially: checkUserConnection → sendNotificationToRider (counts ridersConnected/ridersNotified; `queued` counter is declared but **never incremented**). Zero notified ⇒ `'Could not find any riders nearby'`. Then `await condition(() => riderResponse.completed === true)` — **no timeout on the condition**; only the 2-minute `workflowExecutionTimeout` set by the caller bounds it. On response, signals the parent workflow (`request.parentWorkflowId`) with `notificationWorkflowResponseSignal` and `riderAcceptanceSignal` **imported from `src/services/orders/workflows/order-assignment.workflow`** (cross-module coupling into the bundled code). Notification: priority high, **expiresAt = now + 10 minutes**. Retry: 5 attempts, 2s→10s. Uses `console.log/warn` inside workflow code.
- **invalidateOrderForRidersWorkflow(orderId, acceptedRiderId)** — wraps the invalidation activity (30 s, 3 attempts).

### 5.8 Type system (`core/notifications/types/**`)
- `common/base.types.ts`: `DeliveryChannel = push|in_app|email|sms|webhook`; `NotificationPriority = low|medium|high|urgent`; `UserType = user|rider|restaurant|admin`; `DeliveryChannelConfig`, `NotificationTemplate`.
- `common/notifications.types.ts`: `BaseNotification`, `NotificationDeliveryResult`, `NotificationMetrics`.
- `common/channels.types.ts`: `ChannelSubscription`, `ChannelMetadata` (type: personal|order|checkout|broadcast|system, `requiresAuth?`, `permissions?` — aspirational, unenforced), `SubscriptionStats`.
- `delivery-channels/`: rich Email (attachments, templates, provider w/ apiKey, stats incl. opened/clicked/bounced), Push (device tokens ios|android|web, actions, collapseKey), SMS (provider, cost fields), WebSocket (`WebSocketNotificationData/Result/ConnectionInfo/Queue/BroadcastData` — note `WebSocketNotificationQueue.userType: uuid` is a wrong type). Email/Push/SMS types are entirely speculative — no implementations.
- `activities/`: `ConnectionMetadata`, `LocationData`, and interface contracts (`RedisUtilsActivities` lists `isOrderAccepted`/`getOrderAcceptedBy` that RedisUtils never implements).
- `user-types/`: user prefs/order/promotion/checkout notifications; rider metrics/location/delivery-request/availability; restaurant order/rider/inventory/promotion/performance; admin system/demand/rider-shortage/payment/fraud/ops-metrics alerts. Mostly unreferenced by runtime code.
- `workflows/`: request/result contracts for each workflow; `restaurant-order-workflow.types` and `rider-order-workflow.types` include the exact request payload shapes documented above.
- `UserNotification.priority` union is `low|medium|high|critical` while base `NotificationPriority` is `low|medium|high|urgent` — inconsistent scales; `OrderRequestNotification.priority` is `low|medium|high|urgent`.

---

## 6. Redis Key & Channel Registry (authoritative names)

From `constants/redis-keys.ts` (all under DB `REDIS_DB` default 0):

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `connections:<userType>:<userId>` | string(JSON) | 1 h | WS connection metadata |
| `users:online` | set | 2 h | online user ids |
| `online:riders` | hash | — | legacy, read-only in code |
| `riders:available:online` | set | 2 h | available riders |
| `riders:unavailable:order-assigned` | set | 2 h | riders on a job |
| `restaurants:accepting` | set | 2 h | accepting restaurants |
| `riders:available:locations` / `riders:unavailable:locations` | geo zset | 2 h | rider geopositions |
| `rider:<id>:location` | geo zset (written) / JSON (read!) | — | per-rider location (type mismatch bug) |
| `restaurants:locations` | geo zset | 30 d | restaurant geopositions |
| `restaurant:<id>:location` | string(JSON) | 30 d | per-restaurant location |
| `rider:<id>:assignment` | hash | — | field `orderId` |
| `subscriptions:<channelName>` | set of `type:id` | 24 h (checkout 30 m) | channel membership |
| `channel:order:<orderId>:members` / `channel:checkout:<checkoutId>:members` | set | — | legacy channel membership |
| `queue:<userType>:<userId>` | zset (priority-scored JSON) | 7 d | offline notification queue |
| `notifications:priority:<userType>:<userId>` | zset of ids | 7 d | priority index |
| `failed_notifications:<userType>:<userId>` | list | 7 d | legacy failed queue |
| `notification:<id>` | string(JSON) | 7 d | notification metadata/status |
| `notifications:group:<group>` | set of ids | 7 d | group index (order fan-outs) |
| `read:<userId>` | set | 30 d | read notification ids |
| `order:<orderId>:accepted` | string(JSON) | 1 h | accepted rider record |
| `order_rider_checkout_mapping:<orderId>:<riderId>` | string | 30 m | checkout id for signaling |

Channel names (`constants/channels.ts`): `user:<id>`, `user:<id>:orders`, `user:<id>:promotions`; `rider:<id>`, `rider:<id>:delivery`, `rider:<id>:earnings`, `rider:<id>:location`; `restaurant:<id>`, `restaurant:<id>:orders`, `restaurant:<id>:ops`; `admin:<id>`, `admin:system:alerts`, `admin:operations`, `admin:analytics`; `order:<id>`, `order:<id>:tracking`; `checkout:<id>`; broadcasts `broadcast:users|riders|restaurants|system`, `broadcast:region:<id>`. (Only `order:<id>` and `checkout:<id>` are actively used by in-scope code.)

Event-name registry (`constants/events.ts`): dotted hierarchical names for user/rider/restaurant/admin/system events (e.g. `user.order.confirmed:<orderId>`, `rider.delivery.request:<orderId>:<riderId>`, `system.notification.sent:<id>`) — **not referenced by any in-scope runtime code**; the EventEmitterModule wildcard config in AppModule matches this style but the notification listener file is empty.

---

## 7. Common Layer (`src/common`)

- **WorkflowIds** — canonical workflow-ID factory: `checkout()` → `checkout_<rand12>`; `orderForCheckout(prefix, checkoutId)` → `<prefix>_<checkoutId>`; `paymentForCheckout(prefix='payment_for', checkoutId)`; `order(prefix='order')` → random; `payment(userId, ts)`; `riderAssignment(orderId)` → `rider_assignment_<orderId>`; `refund(paymentId, ts)`; `restaurantNotification(prefix, orderId)` → `<prefix>_<rand12>` (**ignores orderId despite doc "Deterministic"**); `riderNotification(orderId, riderId)`; `orderUpdates(orderId)`.
- **gen-workflow-id.ts** — `genRandomId` = nanoid customAlphabet `'0123456789abcdefghjkmnopqrstwxyz'` (no i,l,u,v), length 12.
- **checkout.events.ts** — `CheckoutStep` enum, the checkout saga's 28-step state machine: initiated → payment_processing/completed/failed → order_creating/created/failed → restaurant_notifying/notified → waiting_restaurant_acceptance → restaurant_accepted/rejected/timeout → rider_assignment → waiting_rider_acceptance → rider_accepted/rejected → order_channel_creating/created → order_updates_starting → cart_clearing/cleared → completed | failed | compensating | compensated. Plus `CheckoutSagaEvent` and `CheckoutInitiatedEvent` class.
- **checkout.types.ts** — `OperationStatus {processing, completed, success}`; generic `BaseResponse<T> {status, data?, error?, type?, retryable?}`; `PricingSnapshot {item_total, delivery_fee, platform_fee, discount_amount, amount_to_pay, coupons_applied: uuid[]}`; `CheckoutDataRequest {user_id, cart_id, delivery_address_id, payment_method_id, pricing, metadata?{delivery_instructions: DeliveryInstructions[] (Prisma enum)}}`; `CheckoutData` adds `checkout_id`; Payment/Order/Restaurant/Rider response+signal aliases (`RestaurantDecision {accepted, reason?, estimatedPrepTime?}`, `RiderDecision {accepted, riderId, reason?, estimatedPickupTime?}`); `StatusUpdatePayload {checkout_id, step, message, data?, error?}`.
- **uuid.types.ts** — `type uuid = z.infer<typeof z.uuidv4()>` → effectively `string` (documentation-only typing).

---

## 8. Configuration & Environment Variables

Read by in-scope code:

| Var | Default | Used in |
|---|---|---|
| `NODE_ENV` | — | main.ts (pino only in production); compose sets `production` |
| `PORT` | 3456 | main.ts HTTP port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | app.module client, notifications worker (compose: `temporal:7233`) |
| `TEMPORAL_NAMESPACE` | `default` | app.module client |
| `REDIS_USE_SENTINEL` | false | RedisService mode switch |
| `REDIS_SENTINELS` | `redis-sentinel-1:26379` | sentinel CSV list |
| `REDIS_MASTER_NAME` | `mymaster` | sentinel master name |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` / `REDIS_PASSWORD` | localhost / 6379 / 0 / none | standalone Redis (compose: `redis-master:6379` db 0) |
| `MINIO_ENDPOINT/PORT/USE_SSL/ACCESS_KEY/SECRET_KEY` | localhost/9000/false/—/— | **commented-out** FilesModule registration only |

Provided by docker-compose to the API container but unused by in-scope code: `DATABASE_URL`, `DB_DIRECT_URL` (Prisma reads via schema), `REDIS_KEYSPACE_NOTIFICATIONS: Ex` (never read in `src/`), `MINIO_ACCESS_KEY`/`MINIO_ACCESS_SECRET` (name mismatch vs code's `MINIO_SECRET_KEY`). Ports exposed: 3456 (HTTP) and 9080 (WS). `.env.example` documents the infra stack (Postgres/PgAdmin/PgBouncer/Redis Sentinel ports, MinIO, Temporal 7233/UI 8080, `HOST_IP` for Sentinel announce).

Hardcoded values worth flagging: cache Redis URL `redis://localhost:6379`; WS gateway port 9080; 5 km default rider search radius; 30 s WS ping interval; 5-minute "connected" freshness; priority scores 1000/500/100/10/50; all the TTLs in §6.

---

## 9. Auth / Security Model

- **No authentication or authorization anywhere in this layer** (and no guards/middleware in the whole API src). `better-auth` is installed but never imported.
- WebSocket gateway: CORS `origin: '*'`; clients self-declare `userId`/`userType` in `connect_user`; `join_channel` explicitly documents "MVP mode" auto-connect without prior auth. Consequences: any client can impersonate any user/rider/restaurant/admin, join any `order:<id>`/`checkout:<id>` channel, and drain another user's queued notifications (the queue is deleted upon delivery in `connect_user`).
- Channel metadata types define `requiresAuth`/`permissions` fields but nothing enforces them.
- Redis and Temporal connections are unauthenticated by default (`REDIS_PASSWORD` optional, compose doesn't set one; Temporal namespace `default` with no TLS/mTLS options).
- Prisma logs every query (`log: ['query',...]`) even in production — potential PII leakage into logs.
- No hardcoded secrets found in scope (secrets flow through env; `.env.example` uses placeholders).

## 10. Integration Points (how core talks to the rest)

- **Feature services → NotificationsService/Gateway**: checkout, orders, riders, restaurants, feed, payments, pricing activities and controllers inject `NotificationsService`, `NotificationsGateway`, `RedisUtils`, or `RedisService` directly (files listed under `src/services/**` in grep: checkout.activities, feed.activities/service, order-assignment/order-tracking/order activities, payment.activities, pricing.activities, restaurants controller/service, rider activities/controller/service).
- **Temporal**: client from AppModule (address `TEMPORAL_ADDRESS`); notifications worker polls `notifications-queue`; rider workflow signals parents via `notificationWorkflowResponseSignal` / `riderAcceptanceSignal` defined in `services/orders/workflows/order-assignment.workflow` (cross-boundary import into the workflow bundle); checkout saga steps in `common` are shared vocabulary between checkout/payments/orders services and clients.
- **Clients (Expo apps / Next webs)**: connect to `ws://host:9080`, speak the `connect_user` / `join_channel` / `heartbeat` / `status` / `health_check` protocol; receive `notification`, `order_request`, `order_update`, `connection_confirmed`, `channel_joined`, `*_error`, `heartbeat_response` events.
- **Redis topology** (hg-docker/docker-compose): master + replicas + 2 sentinels; RedisService supports both modes; `reconnectOnError(READONLY)` exists precisely for failover-to-replica scenarios.
- **HTTP docs**: `/api/docs` (Scalar) on port 3456.

---

## 11. Code-Quality Observations (bugs, dead code, TODOs, inconsistencies)

**Likely bugs**
1. `CacheModule` hardcodes `redis://localhost:6379` — broken inside docker (Redis is `redis-master`); ignores all REDIS_* env vars.
2. `RedisUtils.updateRiderLocation` writes `rider:<id>:location` with **GEOADD** (member = timestamp string) but `getRiderLocation` reads the same key with **GET/JSON.parse** → WRONGTYPE/garbage; the two halves of the API disagree on the data type.
3. `WorkflowIds.restaurantNotification(prefix, orderId)` ignores `orderId` and returns a random id, contradicting its "Deterministic" doc and defeating Temporal id-based dedup for restaurant notifications.
4. Priority mismatch: notifications are created with priority `'medium'` (default in NotificationsService) but `getPriorityScore` maps only `urgent/high/normal/low` — `medium` silently gets the fallback score 50.
5. `WebSocketNotificationUtilitiesImpl.sendWebSocketNotification` returns a **newly generated** `notificationId` unrelated to the stored `data.id`; `sendWebSocketNotificationWorkflow` then reports `success: true` regardless of the activity's own `success:false` (queued/offline cases look successful to callers except via `delivered/queued` flags).
6. `deliverViaWebSocket` is `private` but decorated `@Activity()` — decorator on a non-activity-callable method.
7. AppModule provides `RedisService` at root **and** via RedisModule → two ioredis connections/instances; same duplicated-provider pattern for CartsService/CartsController (double route registration risk).
8. `sendRiderOrderRequestWorkflow` awaits `condition(...)` with **no timeout**; only the caller-supplied 2-minute `workflowExecutionTimeout` prevents an eternal wait, and timeout then surfaces as a workflow failure rather than the graceful "no rider accepted" path. Its `queued` counter is never incremented.
9. In-app activity classes are registered as both Nest providers and Temporal `activityClasses` — the gateway (`server.clients`) is only meaningful in the API process; this only works because worker and API share one process. Any move to a separate worker silently breaks WS delivery.

**Dead / vestigial code**
- `RedisStreamsModule/Service`, `TemporalService`, `TemporalWorkerService`, `TemporalCoreModule` — empty stubs, some still registered in AppModule.
- `FilesModule` — fully implemented but its only registration is commented out; MinIO unusable via DI. Env-name mismatch (`MINIO_SECRET_KEY` in code vs `MINIO_ACCESS_SECRET` in compose) if revived.
- `OrderChannelNotificationActivities` — unregistered; per-user send switch commented out (always 0 successes).
- Empty files: `activities/channels/checkout-notifs.activities.ts`, `events/notification-sent.event.ts`, `listeners/notification-sent.listener.ts`.
- `NOTIFICATION_EVENTS` registry and most of the elaborate type system (email/push/sms channels, admin alert payloads, user preference types) have no runtime counterpart; push/email/sms workflows exist without activity implementations.
- `online:riders` hash is read (`getOnlineRidersFromHash`) but never written.
- `sendNotificationWorkflow` (legacy general workflow) is exported/imported but only reachable via imports — NotificationsService uses the newer `sendWebSocketNotificationWorkflow`.
- Unused imports: `KeyvRedis` in app.module; `sleep`, `getExternalWorkflowHandle` (restaurant workflow), `Activity` in redis-utils import line; `NotificationsGateway` injected into NotificationsService but never used.
- `better-auth` and `socket.io`/`@nestjs/platform-socket.io` dependencies unused.

**TODOs (verbatim)**
- `websocket-notif.activities.ts`: "TODO: Implement admin notifications".
- `admin-notifications.activities.ts`: "TODO: Implement admin WebSocket notifications in the gateway"; "TODO: Implement when admin user management is available".
- `restaurant-notifications.activities.ts`: `broadcastToRestaurantsInRegion` placeholder ("would need to be implemented based on your region/restaurant mapping").
- Gateway: "MVP: Allow joining channels without prior authentication".

**Consistency / hygiene**
- Two id generators with different alphabets (`genRandomId` includes `0`, `genId`'s starts at `1`) and near-duplicate purpose.
- Two parallel channel-membership schemes (`subscriptions:<name>` vs legacy `channel:*:members`) maintained side by side.
- Three overlapping queue mechanisms (`queue:*` zset, `failed_notifications:*` list, `notifications:priority:*` zset).
- Priority unions differ across types (`critical` vs `urgent`).
- `KEYS` used for scans (connections, queues, notifications, rehydrateChannels) — O(N) blocking on production Redis.
- Workflow code mixes `log` (restaurant) and `console.log` (rider); rider workflow's linear sequential rider loop is slow for large fan-outs.
- Prisma `log: ['query', ...]` unconditionally; docker DATABASE_URL bypasses the provisioned PgBouncer.
- `RedisUtilsActivities` interface declares `isOrderAccepted`/`getOrderAcceptedBy` that are unimplemented; `WebSocketNotificationQueue.userType: uuid` typo'd type.
- `redis.service.ts` header comment carries a wrong path; `zrange` used in removeNotificationsByGroup exists on the wrapper, fine.
