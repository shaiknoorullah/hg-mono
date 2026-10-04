# hg-api — Identity & Partner Services (users, restaurants, riders, admin)

Fleet analysis report. Scope: `/home/user/hg-api/api/src/services/users`, `/home/user/hg-api/api/src/services/restaurants`, `/home/user/hg-api/api/src/services/riders`, `/home/user/hg-api/api/src/services/admin`, `/home/user/hg-api/api/src/features/users`. Neighbor files (Prisma schema, core Redis/cache/notifications, checkout workflows, app bootstrap) were skimmed only for context.

---

## 1. Purpose & Role in the Platform

These four services are the identity/partner backbone of the HalalGoes food-delivery backend ("HalalGoes API", NestJS + Prisma/PostgreSQL(PostGIS) + Redis + Temporal):

- **Users** — customer profiles, delivery addresses (PostGIS points), per-user analytics, and a Temporal "user onboarding" workflow (create + welcome notification).
- **Restaurants** — restaurant profiles, addresses/geo-coords, menus & food items (with cuisines/categories/variants), order acceptance/rejection (which signals the checkout saga), restaurant stats/analytics, and a Temporal approval workflow.
- **Riders** — delivery-partner profiles, real-time geolocation (PostGIS + Redis GEO sets), availability toggling, order acceptance/rejection (signals both the checkout saga and the notification workflow), rider discovery with expanding-radius search (Temporal workflow consumed by order assignment), stats/analytics.
- **Admin** — back-office: approve restaurants/riders, paginated listings of all entities, platform-wide analytics, soft-delete users, and a bare `createAdmin`.

They sit between the HTTP surface (mobile apps: users, rider, restaurant; admin-web) and the order pipeline (carts → checkout saga → orders → notifications). The restaurant and rider controllers are the *human-in-the-loop* halves of the checkout saga: the saga parks waiting for `restaurantResponse` / `riderResponse` Temporal signals, and these controllers deliver them based on Redis-stored workflow-ID mappings.

---

## 2. Complete Inventory

### 2.1 Files in scope

| File | Kind | Notes |
|---|---|---|
| `api/src/services/users/users.controller.ts` | Controller `@Controller('users')` | 6 endpoints, `ZodValidationPipe` + `CacheInterceptor` |
| `api/src/services/users/users.service.ts` | Service | Prisma CRUD, address tx w/ raw POINT update, analytics |
| `api/src/services/users/users.module.ts` | Module | Registers Temporal worker on `users-queue` |
| `api/src/services/users/dto/users.schema.ts` | Zod DTOs | **Placeholder/dead** — User has `breed` field (dog-like sample), marked `deprecated: true`, unused by controller |
| `api/src/services/users/workflows/index.ts` | Workflow barrel | createUser workflow + 4 **empty** cart workflow stubs |
| `api/src/services/users/workflows/user-onboarding.workflow.ts` | Temporal workflow | `userOnboardingWorkflow` |
| `api/src/features/users/activities/user.activities.ts` | Temporal activities | `createUser`, `sendWelcomeNotification` (console.log stub), `verifyPhoneNumber` |
| `api/src/features/users/types.ts` | Interface | `IUserActivity` |
| `api/src/features/users/index.ts` | Barrel | re-exports types + activities |
| `api/src/services/restaurants/restaurants.controller.ts` | Controller `@Controller('restaurants')` | 12 endpoints incl. order respond + saga signaling |
| `api/src/services/restaurants/restaurants.service.ts` | Service | CRUD, menu mgmt, order accept/reject, stats, PostGIS location |
| `api/src/services/restaurants/restaurants.module.ts` | Module | Temporal worker on `restaurants-queue` |
| `api/src/services/restaurants/activities/restaurant.activities.ts` | Temporal activities | create/approve/notify/validate/get-location/update-location |
| `api/src/services/restaurants/workflows/index.ts` | Barrel | approval workflow only |
| `api/src/services/restaurants/workflows/restaurant-approval.workflow.ts` | Temporal workflow | `restaurantApprovalWorkflow` |
| `api/src/services/riders/riders.controller.ts` | Controller `@Controller('riders')` | 13 endpoints incl. respond-to-order (dual signaling), nearby search |
| `api/src/services/riders/riders.service.ts` | Service | CRUD, geo updates (PostGIS + Redis GEO), discovery queries, stats |
| `api/src/services/riders/riders.module.ts` | Module | Temporal worker on `riders-queue` |
| `api/src/services/riders/dto/riders.schema.ts` | Zod DTOs | `ZRiderModel` (Zod v4 style: `z.e164()`, `z.email()`, `z.json()`); **unused by controller** (imports `CreateRiderResponseDto, TRider` in service but never uses them) |
| `api/src/services/riders/activities/rider.activities.ts` | Temporal activities | 7 activities: create, location updates, availability, findNearbyRiders, getRiderCurrentLocation |
| `api/src/services/riders/workflows/index.ts` | Barrel | tracking + discovery |
| `api/src/services/riders/workflows/rider-discovery.workflow.ts` | Temporal workflow | `findRidersForOrderWorkflow` (expanding radius 5→10→15→20 km) |
| `api/src/services/riders/workflows/rider-tracking.workflow.ts` | Temporal workflow | `riderLocationTrackingWorkflow` — MVP stub, just sets availability true |
| `api/src/services/admin/admin.controller.ts` | Controller `@Controller('admin')` | 9 endpoints, `@ApiTags('admin','admin-users','managers','support')` |
| `api/src/services/admin/admin.service.ts` | Service | approvals, listings, platform analytics, soft delete |
| `api/src/services/admin/admin.module.ts` | Module | Prisma only — no Temporal, no Redis |

### 2.2 HTTP endpoint inventory

Server listens on `PORT` (default **3456**), no global prefix; Swagger/Scalar docs at `/api/docs` (`main.ts`).

**Users (`/users`)**

| Method | Path | Handler | Behavior |
|---|---|---|---|
| POST | `/users` | `createUser` | `prisma.user.create` with raw `Prisma.UserCreateInput` body (no validation despite pipe — Prisma types are interfaces, not DTOs) |
| GET | `/users/:id` | `getUser` | findUnique + `saved_addresses` include |
| PUT | `/users/:id` | `updateUser` | raw `UserUpdateInput` passthrough |
| POST | `/users/:id/addresses` | `addAddress` | tx: create `DeliveryAddress`, then raw SQL `UPDATE delivery_address SET location = POINT(lng,lat)` |
| GET | `/users/:id/addresses` | `getUserAddresses` | non-deleted addresses |
| GET | `/users/:id/analytics` | `getUserAnalytics` | totals: orders, spent, avg order value, favorite-restaurant count, last order date |

**Restaurants (`/restaurants`)**

| Method | Path | Handler | Behavior |
|---|---|---|---|
| POST | `/restaurants` | `createRestaurant` | tx: restaurant + `RestaurantAddress` + raw `POINT` set on `location` + default active `RestaurantMenu` |
| GET | `/restaurants/:id` | `getRestaurant` | includes address, active menu w/ available+non-deleted items (cuisine/category/variants), cuisines, categories |
| PUT | `/restaurants/:id` | `updateRestaurant` | passthrough update (wrapped in pointless single-op tx) |
| GET | `/restaurants/:id/menu` | `getMenu` | active menu, items ordered by `item_name asc` |
| POST | `/restaurants/:id/menu/items` | `createMenuItem` | bulk create; upserts Cuisine/FoodCategory by snake_cased name; creates `FoodItemVariant`s (`variant_type: {}` hardcoded empty object) |
| PUT | `/restaurants/menu-items/:itemId` | `updateMenuItem` | field-by-field FoodItem update |
| PUT | `/restaurants/:id/toggle-accepting` | `toggleAcceptingOrders` | sets `is_accepting_orders` from body `{isAccepting}` |
| GET | `/restaurants/:id/orders` | `getRestaurantOrders` | orders w/ customer, address, rider, items; optional `?status=` |
| PUT | `/restaurants/:restaurantId/orders/:orderId?action=accept\|reject` | `respondToOrder` | reads Redis `order_checkout_mapping:{orderId}:{restaurantId}` → checkout workflowId; accept → `acceptOrder` (status `CONFIRMED`) or reject (status `REJECTED`); signals `restaurantResponse` on checkout saga with `{accepted, estimatedPrepTime (default 25)}`; deletes mapping on success |
| PUT | `/restaurants/orders/:orderId/status` | `updateOrderStatus` | `executeUpdate('orderStatusUpdate', {status, source:'restaurant'})` on workflow `order-tracking-{orderId}` |
| GET | `/restaurants/:id/stats` | `getRestaurantStats` | totalOrders, todayOrders, totalRevenue (DELIVERED sum), isAcceptingOrders |
| PUT | `/restaurants/:id/location` | `updateRestaurantLocation` | raw SQL: `coords = ST_SetSRID(ST_MakePoint(lng,lat),4326)` on `restaurant_address` |
| GET | `/restaurants/:id/analytics` | `getRestaurantAnalytics` | total processed, this-month count/revenue/avg |

**Riders (`/riders`)** — `CacheInterceptor` class-wide

| Method | Path | Handler | Behavior |
|---|---|---|---|
| POST | `/riders` | `createRider` | creates rider (email, names, phone only) |
| GET | `/riders/:id` | `getRider` | findUnique |
| PUT | `/riders/:id` | `updateRider` | passthrough update in tx |
| PUT | `/riders/:id/location` | `updateLocation` | PostGIS `coords` update + Redis `GEOADD riders:active` + `GEOADD rider:{id}:location` (timestamp as member); if body has `orderId`, sends `riderLocationUpdate` Temporal update to `order-tracking-{orderId}` (non-fatal on failure) |
| PUT | `/riders/:id/availability` | `toggleAvailability` | flips `is_accepting_orders`; if now true → `GEOADD riders:active lng lat riderId`; if false → **commented out** removal (stale pool bug) |
| GET | `/riders/:id/orders` | `getRiderOrders` | orders w/ restaurant/customer/address/items |
| GET | `/riders/:id/orders/:orderId` | `getRiderOrder` | **bug**: ignores `orderId`, returns all rider orders |
| PUT | `/riders/:id/orders/:orderId/status` | `updateRiderOrderStatus` | Temporal `executeUpdate('orderStatusUpdate', {status, source:'rider'})` on `order-tracking-{orderId}` |
| PUT | `/riders/:riderId/orders/:orderId?action=accept\|reject` | `respondToOrder` | reads `order_rider_checkout_mapping:{orderId}:{riderId}` → checkoutId; accept → order `RIDER_ASSIGNED`+`delivery_partner_id`, `ZREM riders:active`, `notificationsService.invalidateOrderForOtherRiders`; signals checkout `riderResponse` AND notification workflow (id from `notification_workflow:{orderId}`) with `notificationRiderResponseSignal`; deletes mapping |
| PUT | `/riders/orders/:orderId/status` | `updateDeliveryStatus` | same tracking-workflow update as above (duplicate surface) |
| GET | `/riders/:id/stats` | `getRiderStats` | totals + today/week counts + month tip earnings |
| GET | `/riders/:id/analytics` | `getRiderAnalytics` | totals + this-month deliveries/earnings (tips only) |
| GET | `/riders/nearby/search?lat&lng&radius=5` | `findNearbyRiders` | Redis `GEORADIUS riders:active` first; fallback PostGIS `ST_DWithin` (LIMIT 20) |
| GET | `/riders/active/all` | `getAllActiveRiders` | all riders with `is_accepting_orders=true` (full rows, no pagination) |

**Admin (`/admin`)** — no auth guard of any kind

| Method | Path | Handler | Behavior |
|---|---|---|---|
| POST | `/admin/restaurants/:id/approve` | `approveRestaurant` | sets `is_approved`, `approved_at`, `approved_by_admin_id` (adminId from request body, unauthenticated) |
| POST | `/admin/riders/:id/approve` | `approveRider` | sets `email_verified` + `phone_verified` true (adminId ignored) |
| GET | `/admin/users?limit=20&offset=0` | `listUsers` | paginated, non-deleted, selected fields + total |
| GET | `/admin/restaurants` | `listRestaurants` | same pattern |
| GET | `/admin/riders` | `listRiders` | same pattern |
| GET | `/admin/orders?limit=50` | `listOrders` | no soft-delete filter |
| GET | `/admin/analytics` | `getPlatformAnalytics` | counts users/restaurants/riders/orders, revenue, avg order value, active orders (statuses PLACED..ON_THE_WAY), today's orders/revenue |
| DELETE | `/admin/users/:id` | `deleteUser` | soft delete (`is_deleted`, `deleted_at`, `deleted_by`) |
| POST | `/admin` | `createAdmin` | `prisma.admin.create({data:{}})` — creates empty admin row, no credentials |

### 2.3 Temporal workers, workflows & activities

Each of users/riders/restaurants modules registers its **own Temporal worker** via `TemporalModule.registerWorkerAsync` (connects to `TEMPORAL_ADDRESS`, default `localhost:7233`; bundles `./workflows` dir at boot with `bundleWorkflowCode`). Admin has no worker.

| Task queue | Registered by | Workflows in bundle | Activity classes |
|---|---|---|---|
| `users-queue` | `UsersModule` | `createUser`, `addToCartWorkflow`*, `getCartWorkflow`*, `updateCartWorkflow`*, `removeFromCartWorkflow`* (*empty bodies*), + `userOnboardingWorkflow` | `UserActivities`, `CartActivity` |
| `restaurants-queue` | `RestaurantsModule` | `restaurantApprovalWorkflow` | `RestaurantActivities` |
| `riders-queue` | `RidersModule` | `findRidersForOrderWorkflow`, `riderLocationTrackingWorkflow` | `RiderActivities` |

Workflow details:
- **`createUser` (users/workflows/index.ts)** — createUserActivity → sendWelcomeNotification; throws `ApplicationFailure('User creation failed','UserCreationError')`. Activity options: `startToCloseTimeout 5s`, `scheduleToCloseTimeout 10s`, retry `initialInterval 10s` / `maximumAttempts 5` (note: initialInterval > scheduleToClose, so retries can never occur within schedule window). Also defines unused `cartActivities` (10s/20s) and `longRunningActivity` (10s/20s) option sets, plus empty `compensate()` and `prettyErrorMessage()` stubs.
- **`userOnboardingWorkflow`** — same two activities, `startToCloseTimeout '1 minute'`; returns user id. Duplicates `createUser` workflow. **No caller found anywhere in the codebase** (users.service injects `WorkflowClient` but never uses it).
- **`restaurantApprovalWorkflow(restaurantId, adminId)`** — approveRestaurant + notifyRestaurantApproval, 1-minute timeouts. **No caller** — AdminService approves directly via Prisma instead.
- **`findRidersForOrderWorkflow(lat, lng, expandingRadiuses=[5,10,15,20])`** — loops radii calling `findNearbyRiders` activity (2m startToClose, retry max 3, 5s→30s backoff); returns `{success, riders[], radiusUsed}` or error `No riders found within {max}km radius`. **Called cross-service** by `orders/activities/order-assignment.activities.ts` (`temporal.execute('findRidersForOrderWorkflow', {taskQueue: 'riders-queue', workflowId: 'rider-discovery-{Date.now()}-{Math.random()}', workflowExecutionTimeout: '2m'})` — and passes `[radiusKm]` as single-radius array).
- **`riderLocationTrackingWorkflow(riderId)`** — MVP stub: just `toggleRiderAvailability(riderId, true)`. No caller found.

Activity inventory:

| Class | Activities |
|---|---|
| `UserActivities` (features/users) | `createUser` (prisma create), `sendWelcomeNotification` (console.log only), `verifyPhoneNumber` (sets `phone_verified=true` where id+phone match, always returns true) |
| `RestaurantActivities` | `createRestaurant` (name/desc/opening/closing, `is_approved:false`; **field mismatch**: reads `restaurantData.openingTime` camelCase), `approveRestaurant`, `notifyRestaurantApproval` (console.log), `validateOrderAcceptance` (returns `is_accepting_orders`), `getRestaurantLocation` (raw `ST_Y/ST_X(coords)` from `restaurant_address`), `updateRestaurantLocation` (raw `ST_SetSRID(ST_MakePoint(...),4326)`) |
| `RiderActivities` | `createRider` (camelCase input), `updateRiderLocation` (**bug**: second geoadd passes `(latitude, longitude)` in wrong order — args swapped vs Redis GEOADD lng-first), `toggleRiderAvailability`, `findNearbyRiders` (PostGIS `ST_DWithin` geography, LIMIT 15), `updateRiderLocationWithCoords` (PostGIS + both Redis geo sets, correct order), `setRiderAvailability` (DB + GEOADD/ZREM on `riders:active`), `getRiderCurrentLocation` (raw ST_Y/ST_X) |

---

## 3. Data Models (Prisma, `api/prisma/schema.prisma`)

PostgreSQL with extensions: uuid-ossp, pg_trgm, unaccent, btree_gin, citext, bloom, fuzzystrmatch, plpgsql, **postgis** (+tiger geocoder, topology). Preview features: `postgresqlExtensions`, `fullTextSearchPostgres`. `DATABASE_URL` + `DB_DIRECT_URL` env vars.

### User (`user` table)
- `id` uuid (uuid_generate_v4), `first_name`/`last_name` VarChar(50)?, `email` VarChar(320)? + `email_verified` (default false), `phone` VarChar(15) **unique required** + `phone_verified`, `date_of_birth` Date?
- Relations: `saved_addresses DeliveryAddress[]`, `orders`, `cart CartItems[]`, `payment_methods`, `payment_history`, `food_reviews`, `rider_reviews`, `search_history`, `favorite_foods`, `favorite_restaurants`
- Soft delete trio (`is_deleted`/`deleted_at`/`deleted_by`), `created_at`, `last_modified_at @updatedAt`
- Indexes: Hash on phone/email/is_deleted

### DeliveryAddress (`delivery_address`)
- `name` VC(100), `street` VC(200), `building?`, `floor?`, `apartment?`, `landmark?`, `suburb?`, `postal_code` VC(10)
- Third-person delivery: `is_third_person` (default false), `third_person_name?`, `third_person_phone?`
- `is_primary` (default false), `location Unsupported("POINT")?` (native Postgres POINT, set via raw SQL), FK `belongs_to_user_id` (Cascade), soft-delete trio
- Indexes: btree (user,is_deleted), hash postal_code, **Gist on location**, Brin created_at

### Rider (`rider`)
- `first_name`/`last_name` VC(50) required, `phone` VC(15) unique, `email` VC(320) unique, verified flags, `identity_docs Json[] @db.JsonB`
- `is_accepting_orders` (default false), `total_earnings Decimal @db.Money` (default 0.00), `total_orders_delivered Int`, `rating_avg Decimal(2,1)`
- **Two geo columns**: legacy `location Unsupported("POINT")?` and `coords Unsupported("geometry(Point,4326)")?` (PostGIS; the one actually written by services)
- Relations: `orders`, `rating_review RiderRatingReview[]`; soft-delete trio
- Indexes: Gist on both location & coords, btree (is_accepting_orders,is_deleted), rating_avg btree, Gin identity_docs, Brin created_at

### Restaurant (`restaurant`)
- Halal compliance: `is_halal_certified` (default false), `halal_certification_docs Json[]`, `halal_certification_expiry Date?`
- Approval: `is_approved` (default false), `approved_at?`, `approved_by_admin_id?` → `Admin`
- `name` VC(150), `description Citext`, `opening_time`/`closing_time @db.Time()`
- Ops: `is_accepting_orders` (default false), `is_banned` (default false), `banned_reason Citext?`, `total_orders_processed Int`
- Relations: `address RestaurantAddress[]` (one-to-many!), `menu RestaurantMenu[]`, `offers`, `orders`, `cuisines`/`categories` junctions, `favorite_users`; soft-delete trio
- Indexes incl. SpGist on name, Gin on halal docs, Brin on expiry/created

### RestaurantAddress (`restaurant_address`)
- `street_address` VC(200), `suburb` VC(100), `city` VC(100), `country Char(2)`, `postal_code` VC(10), `location POINT?` **and** `coords geometry(Point,4326)?` — the create path writes `location`, the update/read paths use `coords` (inconsistency, see §8)

### RestaurantMenu / FoodItem / FoodItemVariant (context)
- Menu: `is_active` (default true), optional activation/deactivation times
- FoodItem: `item_name` VC(150), `item_description Citext`, `item_price`, flags `is_currently_available`, `is_non_veg`, `contains_diary` (sic — misspelled "dairy"), `ingredients VarChar(50)[]`, `allergens`, `item_images`, snake_cased `category_name`/`cuisine_name` FKs by name
- Variant: `variant_type` (enum SIZE/WEIGHT/QUANTITY in schema; service writes `{}`), name/description/price, `is_default_variant`

### Admin (`admin`)
- **id + timestamps only** — no email, no password, no role. `restaurants_approved Restaurant[]` backrelation. Authentication is structurally impossible against this model today.

### Supporting enums
`OrderStatus`: PENDING_PAYMENT, PLACED, CONFIRMED, PREPARING, RIDER_ASSIGNED, PICKED_UP, ON_THE_WAY, DELIVERED, DISPUTED, CANCELLED, REJECTED. Also `DeliveryInstructions`, `TransactionType`, `PaymentStatus`, `FoodItemVariantType`, `PaymentMethodType`.

### Zod DTOs (defined but effectively unused)
- `users/dto/users.schema.ts`: `ZUser {name, age, breed}` — sample/scaffold data (a *dog* schema), `deprecated: true`; `UserDto`, `UpdateUserDto`, `GetUsersDto`, `CreateUserResponseDto`, `UpdateUserResponseDto`. None referenced by the controller (which types bodies as `Prisma.UserCreateInput` — no runtime validation).
- `riders/dto/riders.schema.ts`: `ZRiderModel` — realistic (Zod v4 `z.e164()` phone, `z.email()`, `z.json()` identity_docs default `'[]'`, rating 0–5 with OpenAPI annotations, `total_earnings` regex `^\d+(\.\d{1,2})?$` with `>0` refine — which would reject the default 0). `RiderDto`, `CreateRiderRequestDto`, `CreateRiderResponseDto`, `TRider`. Imported in riders.service.ts but never used; controller uses raw Prisma types.

---

## 4. State, Caching, Queues, Events

### Redis keys touched by this area
| Key | Type | Writer | Reader | Purpose |
|---|---|---|---|---|
| `riders:active` | GEO (zset) | riders.service (`updateRiderLocation`, `toggleAvailability`, `acceptOrder` ZREM), RiderActivities | riders.service `getNearbyRiders` (GEORADIUS) | Active rider pool for discovery |
| `rider:{riderId}:location` | GEO (zset, member = ISO timestamp) | riders.service / RiderActivities | (nothing in scope reads it) | Location history/latest cache |
| `order_checkout_mapping:{orderId}:{restaurantId}` | string → checkout workflowId | checkout.activities.ts (out of scope) | restaurants.controller `respondToOrder` (get, del) | Route restaurant response to checkout saga |
| `order_rider_checkout_mapping:{orderId}:{riderId}` | string → checkout workflowId | checkout activities + notifications websocket-utils | riders.controller `respondToOrder` (get, del) | Route rider response to checkout saga |
| `notification_workflow:{orderId}` | string → notification workflowId | orders/order-assignment.activities.ts | riders.controller (signal rider response into notification workflow) | Rider-notification fan-out workflow handle |

RedisService (core, context): supports standalone (`REDIS_HOST`/`REDIS_PORT` default localhost:6379, `REDIS_PASSWORD`, `REDIS_DB` default 0) or Sentinel (`REDIS_USE_SENTINEL`, `REDIS_SENTINELS="host1:26379,host2:26379"`, `REDIS_MASTER_NAME`).

### HTTP response caching
- `CacheInterceptor` on **UsersController and RidersController classes** (not restaurants/admin). Backing store: `CacheModule` → `createKeyv('redis://localhost:6379')` — **hardcoded URL, ignores env config**, TTL 5000 (ms). Caching GETs of rider location-sensitive endpoints (e.g. `/riders/nearby/search`) can serve stale results.

### Temporal signals/updates crossing this area
- Signals sent: `restaurantResponse` and `riderResponse` (defined in `checkout/workflows/checkout-saga.workflow.ts`) with payload `{status:{processing,completed,success}, data:{accepted, estimatedPrepTime|riderId, reason}, error?}`; `riderResponse` (different signal from `core/notifications/workflows/user-types/rider-order-request.workflow.ts`) with `{riderId, accepted, orderId, timestamp}`.
- Updates sent: `orderStatusUpdate` (`{status, source: 'restaurant'|'rider'}`) and `riderLocationUpdate` (`{latitude, longitude}`) via `executeUpdate` on workflowId **`order-tracking-{orderId}`** (owned by orders service).
- Events: `EventEmitterModule` is global in app.module (wildcard, delimiter '.') but **no events are emitted or listened to within this area**.

---

## 5. Integration Points

- **Checkout saga (services/checkout)**: partner controllers signal `restaurantResponse` / `riderResponse` on the checkout workflow whose id is resolved from the Redis mappings above; checkout activities create those mappings when notifying partners. Restaurant default `estimatedPrepTime` = **25 minutes**.
- **Orders service**: `order-assignment.activities.ts` invokes `findRidersForOrderWorkflow` on `riders-queue` by name (string, not import) and stores `notification_workflow:{orderId}`. Rider/restaurant status updates flow into the orders-owned `order-tracking-{orderId}` workflow.
- **Notifications core**: riders.controller calls `notificationsService.invalidateOrderForOtherRiders(orderId, riderId)` which itself executes `invalidateOrderForRidersWorkflow` on `notifications-queue`, and signals the rider-order-request notification workflow.
- **Carts feature**: UsersModule registers `CartActivity` on `users-queue` and its workflow bundle exports 4 empty cart workflows — vestigial coupling.
- **Frontends** (per repo layout): Expo `users`/`rider`/`restaurant` apps and Next.js `admin-web`/`restaurant-web` consume these endpoints directly (no gateway/prefix).
- **`src/workflows.ts`** central barrel re-exports users/riders/restaurants workflows for Temporal discovery.

---

## 6. Configuration & Environment Variables

| Var | Default | Used by |
|---|---|---|
| `TEMPORAL_ADDRESS` | `localhost:7233` | users/restaurants/riders modules (worker `NativeConnection`), app.module client |
| `TEMPORAL_NAMESPACE` | `default` | app.module Temporal client |
| `DATABASE_URL`, `DB_DIRECT_URL` | — | Prisma datasource |
| `REDIS_HOST`/`REDIS_PORT`/`REDIS_DB`/`REDIS_PASSWORD` | localhost/6379/0/none | RedisService (core) |
| `REDIS_USE_SENTINEL`, `REDIS_SENTINELS`, `REDIS_MASTER_NAME` | off | RedisService sentinel mode |
| `PORT` | 3456 | main.ts |
| `NODE_ENV` | — | production → pino logger |
| (hardcoded) `redis://localhost:6379` | — | CacheModule Keyv store — not env-driven |

Magic values: rider discovery radii `[5,10,15,20]` km; nearby-rider DB LIMITs 20 (service) / 15 (activity & assignment path); admin pagination defaults limit 20 (orders 50); prep-time default 25 min; cache TTL 5000; workflow timeouts 5s/10s/30s/1m/2m as listed.

---

## 7. Auth / Security Model

**There is none in this area.** Observations:
- No guards, no JWT, no session, no API key on any controller (grep for guard/jwt/auth across all four services returns nothing).
- Admin endpoints trust a caller-supplied `admin_id` in the request body; anyone can approve restaurants/riders, soft-delete users, or create admin rows (`POST /admin` creates an empty Admin record — the model has no credential fields at all).
- `approveRider` marks email/phone verified without any verification flow; `verifyPhoneNumber` activity sets `phone_verified=true` with no OTP check.
- All user/rider/restaurant CRUD accepts raw `Prisma.*Input` bodies — mass-assignment risk (e.g. a client can set `is_approved`, `total_earnings`, soft-delete fields via PUT), and `ZodValidationPipe` is inert because handlers don't use Zod DTOs.
- Raw SQL uses Prisma tagged templates (parameterized), so no direct SQL injection observed.
- IDOR everywhere: any caller can read any user's addresses/analytics, any rider's stats, etc.

---

## 8. Code-Quality Observations (bugs, dead code, inconsistencies)

**Apparent bugs**
1. `RiderActivities.updateRiderLocation` — second `geoadd(\`rider:{id}:location\`, latitude, longitude, timestamp)` passes lat/lng **swapped** (RedisService.geoadd signature is `(key, longitude, latitude, member)`); `updateRiderLocationWithCoords` and riders.service do it correctly.
2. `riders.controller GET /riders/:id/orders/:orderId` ignores both `orderId` and `status` — returns all orders for the rider.
3. `toggleAvailability` going offline: `zrem('riders:active')` is commented out — riders remain in the active GEO pool after going offline (only DB flag flips; discovery Redis path may return offline riders).
4. `RidersService.updateDeliveryStatus` re-add-to-pool query reads `ST_Y(location)/ST_X(location)` from the legacy `location` POINT column and `WHERE id = ${riderId}` **without `::uuid` cast**, while writes go to `coords` — likely returns nothing/errors; also DELIVERED earnings only counts `delivery_partner_tip`.
5. RestaurantAddress geo split-brain: create writes native `location` POINT; update/read use PostGIS `coords`. A restaurant created via POST has NULL `coords` until `PUT /:id/location`, so rider discovery (which reads `coords`) can't find it.
6. `createUser` workflow activity options: retry `initialInterval 10s` > `scheduleToCloseTimeout 10s` → retries can never run.
7. `RestaurantActivities.createRestaurant` expects camelCase `openingTime/closingTime` on data typed `any`; controller path uses snake_case Prisma input — the activity would insert undefined times if ever wired to the same payload.
8. `AdminService.approveRider` ignores `adminId` and conflates approval with contact verification; there is no `is_approved` on Rider.
9. Riders DTO `total_earnings` refine `parseFloat(val) > 0` rejects the documented default `0.00` (would fail if the DTO were ever enforced).
10. `respondToOrder` (restaurant) returns success even when the checkout signal fails (`signaled:false` with warning) — order can be CONFIRMED in DB while saga times out.

**Dead / vestigial code**
- `users/dto/users.schema.ts` — dog-schema placeholder (`breed`), deprecated, unused.
- Users workflow bundle: 4 empty cart workflows, empty `compensate()`/`prettyErrorMessage()`, unused `cartActivities`/`longRunningActivity` option objects; duplicate user-creation workflows (`createUser` vs `userOnboardingWorkflow`).
- `restaurantApprovalWorkflow`, `riderLocationTrackingWorkflow`, `userOnboardingWorkflow` have **no callers**; admin bypasses the approval workflow with direct Prisma writes.
- `RidersService.findRidersForOrderAssignment` duplicates `RiderActivities.findNearbyRiders` verbatim; `getRestaurantLocation` duplicated between RestaurantsService and RestaurantActivities.
- Unused imports: `CacheService` in users.controller (injected, never used), `NotificationsService` in restaurants.service, `CreateRiderResponseDto`/`TRider`/`Rider` in riders.service, `validateItem` etc. in users workflow, temporal client in users.service.
- riders.controller `respondToOrder` contains an acknowledged-incomplete cleanup: pattern `order_rider_checkout_mapping:{orderId}:*` computed but never used, with a "in production you might want to..." comment.
- `rejectOrder` (rider) only logs — no DB record; `rejectOrder` (restaurant) has comment "You might want to add a rejection_reason field to the schema".

**Inconsistencies / smells**
- Three per-module Temporal workers each re-bundle workflows at boot (slow startup, tripled connections); admin uses none.
- `contains_diary` typo persisted in schema and service.
- Mixed geo representations (`POINT` vs `geometry(Point,4326)`) on both rider and restaurant_address; DeliveryAddress uses raw `POINT(lng,lat)` with Gist index.
- Extensive `console.log`/`console.warn` in controllers/services despite nestjs-pino being configured; activities use proper `Logger`.
- `CacheInterceptor` on write-heavy Riders controller; Keyv store URL hardcoded.
- Cuisine/category dedup by `name.toLowerCase().replaceAll(' ','_')` — slug is stored as the display name.
- Per-item sequential awaits inside menu-item creation transaction (N+1 within tx).
- `getRestaurantOrders`/`getRiderOrders` expose customer phone numbers to partners; `GET /riders/active/all` dumps full rider rows unpaginated.
- `estimatedPrepTime` parsed from query string with `parseInt` and silent default 25; `action` validated after Redis read.

---

## 9. Summary Table — who talks to whom

| From (this area) | Mechanism | To |
|---|---|---|
| restaurants.controller | Temporal signal `restaurantResponse` | checkout saga workflow (id via Redis mapping) |
| riders.controller | Temporal signals `riderResponse` ×2 | checkout saga + rider-notification workflow |
| riders/restaurants controllers | Temporal update `orderStatusUpdate`/`riderLocationUpdate` | orders `order-tracking-{orderId}` workflow |
| riders.controller | method call | NotificationsService → `notifications-queue` workflow |
| riders.service/activities | Redis GEO | `riders:active`, `rider:{id}:location` |
| orders service (inbound) | `temporal.execute` on `riders-queue` | `findRidersForOrderWorkflow` |
| all services | Prisma | PostgreSQL + PostGIS raw SQL |
