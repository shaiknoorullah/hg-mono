# Cross-Cutting Analysis: Frontend-to-Backend API Contract Map

**Repos analyzed:**
- Backend: `/home/user/hg-api` (NestJS on port 3456 REST + raw-`ws` WebSocket gateway on port 9080)
- Frontend: `/home/user/halal-goes` (Turborepo: Expo apps `users`, `rider`, `restaurant`; Next.js apps `admin-web`, `restaurant-web`, `web`, `docs`; shared `packages/auth`)
- Infra reference: `/home/user/hg-docker` (integration guide, API collections)

---

## 1. Purpose & Role

This document maps every HTTP/WebSocket call each frontend app makes against the routes actually implemented in `/home/user/hg-api/api/src`. The headline finding: **the frontends were written against a substantially newer backend than the one in this repo.** An entire `/auth/*` authentication family (~20 endpoints), rider/user/restaurant onboarding flows, admin refunds/disputes/settlements, and menu-image upload endpoints are called by frontends but do **not exist anywhere** in `hg-api`. Conversely, the backend that does exist has **zero auth guards** — every REST route is unauthenticated, and the Bearer tokens the frontends diligently attach are ignored.

---

## 2. Backend Route Inventory (ground truth)

Source: `main.ts` (no `setGlobalPrefix` — routes are mounted at root; Swagger/Scalar docs at `GET /api/docs`; HTTP port `process.env.PORT || 3456`). WS gateway on fixed port `9080` (`@WebSocketGateway(9080, { cors: origin: '*' })`, `WsAdapter` — raw `ws`, NOT socket.io).

### 2.1 REST controllers

| Method + Path | Handler file | Auth | Notes |
|---|---|---|---|
| POST `/users` | `services/users/users.controller.ts` | **none** | Body: `Prisma.UserCreateInput` |
| GET `/users/:id` | users.controller.ts | none | `CacheInterceptor` on controller |
| PUT `/users/:id` | users.controller.ts | none | |
| POST `/users/:id/addresses` | users.controller.ts | none | body + `latitude`/`longitude` |
| GET `/users/:id/addresses` | users.controller.ts | none | |
| GET `/users/:id/analytics` | users.controller.ts | none | **unused by any frontend** |
| POST `/riders` | `services/riders/riders.controller.ts` | none | |
| GET `/riders/:id` | riders.controller.ts | none | |
| PUT `/riders/:id` | riders.controller.ts | none | |
| PUT `/riders/:id/location` | riders.controller.ts | none | body `{latitude, longitude, orderId?}`; forwards to Temporal `order-tracking-{orderId}` update `riderLocationUpdate` |
| PUT `/riders/:id/availability` | riders.controller.ts | none | body `{lat, lng}` |
| GET `/riders/:id/orders` | riders.controller.ts | none | |
| GET `/riders/:id/orders/:orderId` | riders.controller.ts | none | **bug: ignores `orderId`, returns all rider orders** |
| PUT `/riders/:id/orders/:orderId/status` | riders.controller.ts | none | `?status=` query; Temporal update `orderStatusUpdate` source `rider` |
| PUT `/riders/:riderId/orders/:orderId` | riders.controller.ts | none | `?action=accept\|reject&reason=`; reads Redis `order_rider_checkout_mapping:{orderId}:{riderId}`, signals checkout saga (`riderResponseSignal`) + notification workflow (Redis `notification_workflow:{orderId}`) |
| PUT `/riders/orders/:orderId/status` | riders.controller.ts | none | duplicate of per-rider status route; **unused by frontends** |
| GET `/riders/:id/stats` | riders.controller.ts | none | used only by restaurant-web riderEndpoints (itself unused) |
| GET `/riders/:id/analytics` | riders.controller.ts | none | unused |
| GET `/riders/nearby/search` | riders.controller.ts | none | `?lat&lng&radius=5`; unused by shipped UI |
| GET `/riders/active/all` | riders.controller.ts | none | unused by shipped UI |
| POST `/restaurants` | `services/restaurants/restaurants.controller.ts` | none | body `{data, location, coords:{lat,lng}}` |
| GET `/restaurants/:id` | restaurants.controller.ts | none | |
| PUT `/restaurants/:id` | restaurants.controller.ts | none | |
| GET `/restaurants/:id/menu` | restaurants.controller.ts | none | |
| POST `/restaurants/:id/menu/items` | restaurants.controller.ts | none | body: `any[]` (untyped array) |
| PUT `/restaurants/menu-items/:itemId` | restaurants.controller.ts | none | |
| PUT `/restaurants/:id/toggle-accepting` | restaurants.controller.ts | none | body `{isAccepting: boolean}` |
| GET `/restaurants/:id/orders` | restaurants.controller.ts | none | `?status=` |
| PUT `/restaurants/:restaurantId/orders/:orderId` | restaurants.controller.ts | none | `?action=accept\|reject&estimatedPrepTime&reason`; Redis `order_checkout_mapping:{orderId}:{restaurantId}` → signal `restaurantResponseSignal`; default prep time 25 min |
| PUT `/restaurants/orders/:orderId/status` | restaurants.controller.ts | none | Temporal `orderStatusUpdate` source `restaurant` |
| GET `/restaurants/:id/stats` | restaurants.controller.ts | none | |
| PUT `/restaurants/:id/location` | restaurants.controller.ts | none | body `{latitude, longitude}` |
| GET `/restaurants/:id/analytics` | restaurants.controller.ts | none | unused |
| GET `/carts/:userId` | `services/carts/carts.controller.ts` (registered in AppModule, not its own module's controller list) | none | |
| PUT `/carts/:userId` | carts.controller.ts | none | body: `UpdateCartData` minus user_id |
| GET `/feed/:userId` | `services/feed/feed.controller.ts` | none | `?lat&lng` |
| GET `/feed/:userId/search` | feed.controller.ts | none | `?q&limit&page`; q must be >3 chars, limit/page ≤100 |
| GET `/orders/:id` | `services/orders/orders.controller.ts` | none | |
| GET `/orders/user/:user_id` | orders.controller.ts | none | unused by frontends (users app uses WS + getOrder) |
| GET `/orders/restaurant/:restaurant_id` | orders.controller.ts | none | unused (restaurant-web uses `/restaurants/:id/orders`) |
| PUT `/orders/:id/status` | orders.controller.ts | none | body `{status}`; direct DB update (no workflow) |
| PUT `/orders/checkout/:cart_id` | orders.controller.ts | none | starts Temporal checkout saga; body = `CheckoutDataRequest` minus cart_id |
| GET `/orders/:id/tracking` | orders.controller.ts | none | unused |
| GET `/orders/analytics/user/:userId` | orders.controller.ts | none | unused |
| GET `/payments/:id` | `services/payments/payments.controller.ts` | none | |
| POST `/payments/users/:userId/method/` | payments.controller.ts | none | body `{payment_method: 'CREDIT_CARD'\|'DEBIT_CARD'\|'ONLINE'}` |
| PUT `/payments/orders/:orderId` | payments.controller.ts | none | body `{user_id, payment_method_id}`; unused (checkout saga handles payment) |
| POST `/payments/:id/refund` | payments.controller.ts | none | body `{reason}`; admin-web calls **`/admin/payments/:id/refund`** instead — mismatch |
| GET `/payments/analytics/user/:userId` | payments.controller.ts | none | unused |
| GET `/pricing/:cartId` | `services/pricing/pricing.controller.ts` | none | |
| POST `/ratings/riders/:riderId` | `services/ratings/ratings.controller.ts` | none | body `{user_id, rating, review, images?}` — **entire ratings module unused by all frontends** |
| POST `/ratings/food-items/:foodItemId` | ratings.controller.ts | none | unused |
| GET `/ratings/riders/:riderId` | ratings.controller.ts | none | unused |
| GET `/ratings/food-items/:foodItemId` | ratings.controller.ts | none | unused |
| POST `/admin/restaurants/:id/approve` | `services/admin/admin.controller.ts` | none | body `{admin_id}` |
| POST `/admin/riders/:id/approve` | admin.controller.ts | none | body `{admin_id}` |
| GET `/admin/users` | admin.controller.ts | none | `?limit=20&offset=0` |
| GET `/admin/restaurants` | admin.controller.ts | none | |
| GET `/admin/riders` | admin.controller.ts | none | |
| GET `/admin/orders` | admin.controller.ts | none | `?limit=50` |
| GET `/admin/analytics` | admin.controller.ts | none | |
| DELETE `/admin/users/:id` | admin.controller.ts | none | body `{admin_id}` (soft delete) |
| POST `/admin` | admin.controller.ts | none | `createAdmin()` takes no body — anyone can mint admin IDs |

### 2.2 WebSocket gateway (`core/notifications/notifications.gateway.ts`, port 9080)

Inbound messages (`{event, data}` JSON): `heartbeat`, `status`, `health_check`, `join_channel` (`{channelName}` or bare string; "MVP mode" auto-authenticates from `{userId, userType}` in payload — comment: *"MVP: Allow joining channels without prior authentication"*), `connect_user` (`{userId, userType: 'user'|'rider'|'restaurant'|'admin'}` — no credential check; delivers queued notifications flagged `queued: true`).
Outbound events: `connection_confirmed`, `connection_error`, `channel_joined`, `channel_error`, `notification` (incl. `data.type === 'CHANNEL_JOIN'` instructing clients to join `order:{orderId}`), `order_request` (to riders & restaurants), `order_update` (broadcast to `order:{orderId}` channel subscribers), `status_response`, `health_check_response`. Ping/pong staleness sweep every 30 s.

---

## 3. Per-App Contract Tables

### 3.1 `apps/users` (Expo customer app)

Base URL: `EXPO_PUBLIC_BASE_API_URL` (.env.example: `https://api.halalgoes.com`, commented alt `http://98.130.76.223:3456`). WS: `EXPO_PUBLIC_WEBSOCKET` (= `ws://98.130.76.223:9080` — plaintext hardcoded IP in example). Axios instance (`lib/apis/axiosInstance.ts`) attaches `Bearer` token from AsyncStorage `accessToken`, retries once on 401 via `POST /auth/refresh`. Several call files bypass the instance and use bare `axios` (no token): `createUser`, `getRider`, `addNewPaymentMethod`, `processCartPayments`.

| Call (file in `lib/apis/`) | Method + Path | Backend handler | Status |
|---|---|---|---|
| `user/createUser.ts` | POST `/users` | users.controller ✔ | OK (bare axios, no token) |
| `user/getUser.ts` | GET `/users/:id` | ✔ | OK |
| `user/updateUser.ts` | PUT `/users/:id` | ✔ | OK |
| `user/onboardUser.ts` | PUT `/users/:id/onboarding/profile` | **MISSING** | 404 against this backend |
| `address/createAddress.ts` | POST `/users/:id/addresses` | ✔ | OK |
| `address/getUserAddress.ts` | GET `/users/:id/addresses` | ✔ | OK |
| `restaurant/getRestaurant.ts` | GET `/restaurants/:id` | ✔ | OK |
| `restaurant/getRestaurantMenu.ts` | GET `/restaurants/:id/menu` | ✔ | OK |
| `order/getOrder.ts` | GET `/orders/:id` | ✔ | OK |
| `cart/updateCart.ts` | PUT `/carts/:userId` | ✔ | OK ("TODO: uncomment in production" comment) |
| `cart/getCartPricing.ts` | GET `/pricing/:cartId` | ✔ | OK |
| `rider/getRider.ts` | GET `/riders/:id` | ✔ | OK (bare axios) |
| `payments/addPaymentMethod.ts` | POST `/payments/users/:userId/method` | ✔ (declared with trailing slash) | OK; hardcodes `payment_method: 'CREDIT_CARD'` |
| `payments/processCartPayments.ts` | PUT `/orders/checkout/:cartId` | ✔ | OK; payload from `hooks/checkoutPayload.ts` omits `pricing.coupons_applied` required by `PricingSnapshot` type (no runtime validation, so tolerated) |
| `feed/fetchFeed.ts` | GET `/feed/:userId?lat&lng` | ✔ | OK |
| `feed/searchFeed.ts` | GET `/feed/:userId/search?q&limit&page` | ✔ | OK (client default limit 20/page 1) |
| `refreshToken/index.ts` | POST `/auth/refresh` | **MISSING** | No auth module exists in hg-api |
| via `packages/auth` (`stores/useAuth.tsx`) | POST `/auth/otp/request`, POST `/auth/otp/verify`, POST `/auth/register`, POST `/auth/logout` | **ALL MISSING** | Whole login flow depends on absent endpoints |

WS (`stores/useWebSocketStore.ts`, `hooks/orderWebSocket.ts`): connects, sends `connect_user` (`userType:'user'`), auto-joins channels on `notification`/`CHANNEL_JOIN`, consumes `order_update` and `channel_joined`. Matches gateway contract. Very chatty console logging.

### 3.2 `apps/rider` (Expo rider app)

Base URL: `EXPO_PUBLIC_BASE_API_URL` (fallback `http://localhost:3456` in each API file). **Inconsistency:** `services/riderService.ts` reads `EXPO_PUBLIC_API_BASE_URL` (different name, not in .env.example) — duplicate toggleAvailability implementation. WS: `EXPO_PUBLIC_WEBSOCKET_URL` fallback `ws://localhost:9080` (`store/useWebSocketStore.ts`); dead hook `hooks/useWebSocketConnection.ts` hardcodes `ws://192.168.200.19:9080` (LAN IP), and `useMockWebSocket.ts` exists — neither imported anywhere.

| Call | Method + Path | Backend | Status |
|---|---|---|---|
| `rider/getRider.ts` | GET `/riders/:id` | ✔ | OK (also redundantly re-adds Bearer header) |
| `rider/updateRiderLocation.ts` | PUT `/riders/:id/location` `{latitude, longitude, orderId?}` | ✔ | OK |
| `rider/toggleAvailability.ts` + `services/riderService.ts` | PUT `/riders/:id/availability` `{lat, lng}` | ✔ | OK (two parallel implementations) |
| `rider/acceptOrder.ts` | PUT `/riders/:riderId/orders/:orderId?action=accept` | ✔ | OK |
| `rider/rejectOrder.ts` | PUT `/riders/:riderId/orders/:orderId?action=reject&reason=` | ✔ | OK |
| `rider/updateOrderStatus.ts` | PUT `/riders/:riderId/orders/:orderId/status?status=PICKED_UP\|ON_THE_WAY\|DELIVERED` | ✔ | OK (backend enum also has other states) |
| `onboarding/checkOnboardingStatus.ts` | GET `/riders/:id/onboarding/status` | **MISSING** | Frontend models states REGISTERED…ACTIVE, STRIPE_PENDING |
| `onboarding/submitProfile.ts` | POST `/riders/:id/onboarding/profile` | **MISSING** | |
| `onboarding/submitVehicle.ts` | POST `/riders/:id/onboarding/vehicle` | **MISSING** | |
| `onboarding/documents.ts` | POST `/riders/:id/onboarding/documents/upload-url` | **MISSING** | **hardcodes `https://api.halalgoes.com` ignoring env/baseURL** |
| `onboarding/confirmDocumentUpload.ts` | POST `/riders/:id/onboarding/documents/confirm` | **MISSING** | |
| `onboarding/submitDocuments.ts` | POST `/riders/:id/onboarding/documents` | **MISSING** | |
| `refreshToken/index.ts` | POST `/auth/refresh` | **MISSING** | |
| via `packages/auth` | POST `/auth/rider/otp/request`, `/auth/rider/otp/verify`, `/auth/rider/register`, `/auth/logout` | **ALL MISSING** | |
| `lib/supabaseRegistration.ts` + `services/payloadFormService.ts` | Supabase storage bucket `hg-bucket` (path `rider/{ts}_{name}`), table `rider` insert; Payload CMS `POST {EXPO_PUBLIC_PAYLOD_URL}/form-submissions` commented out ("SKIPPING PAYLOAD API CALL") | external | Legacy parallel registration path |
| `app/connectionLost.tsx` | GET `https://www.google.com/favicon.ico` | external | connectivity probe |

WS store sends `connect_user` (`userType:'rider'`), handles `order_request`, `channel_joined`, joins channels via `join_channel`. Matches gateway.

### 3.3 `apps/restaurant` (Expo restaurant app)

**Makes no hg-api calls at all.** Only: Supabase auth (`EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`), Supabase storage bucket `restaurant-documents` (`uploads/{ts}_{name}`), and Payload CMS `POST {EXPO_PUBLIC_PAYLOD_URL}/api/form-submissions` with `EXPO_PUBLIC_FORM_ID` (default `'YOUR_FORM_ID'`, example value 4; rider example uses form 5 in restaurant-web env). Registration data never reaches the platform DB through this app.

### 3.4 `apps/restaurant-web` (Next.js restaurant portal)

Base URL: **hardcoded** `'https://api.halalgoes.com'` in `src/lib/api/config.ts` (`NEXT_PUBLIC_API_BASE_URL=http://98.130.76.223:3456` in .env.example is **never read**). Client (`src/lib/api/client.ts`): fetch wrapper, Bearer token from zustand `auth-store` in localStorage, single-flight refresh via `/auth/restaurant/refresh`. Two conflicting path conventions: config `ENDPOINTS.*` use an `/api/...` prefix (→ `https://api.halalgoes.com/api/...`), while `menu-items/page.tsx` inline calls omit it. Backend has **no `/api` global prefix**, so every `/api/...`-prefixed call misses this backend.

| Caller | Method + Path (resolved) | Backend | Status |
|---|---|---|---|
| `endpoints/index.ts` authEndpoints | POST `/auth/restaurant/register`, `/auth/restaurant/login`, `/auth/restaurant/verify-email`, `/auth/restaurant/refresh` | **MISSING** | Entire portal login depends on these |
| onboardingEndpoints | GET/POST `/auth/onboarding/restaurants/{status,profile,documents/upload-url,documents/confirm,documents/submit,documents,stripe/connect,stripe/status}` | **ALL MISSING** | Stripe Connect onboarding contract |
| restaurantEndpoints.* | `/api/restaurants/...` (note config value `'/api/restaurants/'` w/ trailing slash → double-slash URLs like `/api/restaurants//{id}`) | path exists only without `/api` | **Prefix mismatch + `//` bug** |
| restaurantEndpoints.toggleAcceptingOrders | PUT `.../toggle-accepting` body `{is_accepting}` | backend expects `{isAccepting}` | **Payload key mismatch** (also in orders/page.tsx) |
| paymentEndpoints.processCartPayment | PUT `/api/payments/carts/:cartId` | **MISSING** (backend: PUT `/payments/orders/:orderId`) | wrong resource entirely |
| user/cart/feed/pricing/rider endpoints | `/api/users`, `/api/carts`, `/api/feed`, `/api/pricing`, `/api/riders` families | exist w/o `/api` | prefix mismatch; most unused in pages |
| `menu-items/page.tsx` | POST `/restaurants/menus` | **MISSING** | menu-container CRUD never implemented |
| 〃 | GET `/restaurants/:id/menu` | ✔ | OK (no `/api` prefix here) |
| 〃 | POST `/restaurants/:id/menu/items` | ✔ | OK |
| 〃 | PUT `/restaurants/menu-items/:id` | ✔ | OK |
| 〃 | DELETE `/restaurants/menu-items/:id` | **MISSING** (no DELETE route) | delete flow broken |
| 〃 | POST `/restaurants/menu-items/:id/images/upload-url`, `.../images/confirm` | **MISSING** | image upload contract absent |
| `orders/page.tsx`, `orders/[id]/page.tsx` | GET `/api/restaurants/:id/orders`; GET `/api/restaurants/:id`; PUT `/api/restaurants/:id/orders/:orderId?action=accept|reject`; PUT `/api/orders/:orderId/status` (body adds `restaurant_id` backend ignores); PUT `/api/restaurants/:id/toggle-accepting`; fetch PUT `/api/restaurants/:id/location` (relative URL → Next 404, no route handlers exist) | routes exist w/o `/api` | prefix mismatch throughout |
| `components/categorySheet.tsx` | POST/PUT `fetch('/api/categories'...)` (relative) | **MISSING** (no Next route handlers, no backend route) | dead feature |
| `src/lib/temporal.ts` | Temporal gRPC `TEMPORAL_ADDRESS` (default `localhost:7233`), queries `WorkflowType='initiateCheckoutWorkflow'`, signals `checkout_{checkoutId}` / `order-tracking-{orderId}` | Temporal directly | **Web app bypasses REST API and talks straight to Temporal**; fetches full workflow histories client-side to find an order's workflow (O(n) scan) |
| `restaurantDocumentService.ts` | onboarding upload-url → PUT presigned URL (S3/MinIO) → confirm | missing backend | |
| WS `store/useWebSocketStore.ts` + `hooks/orderWebSocket.ts` | `NEXT_PUBLIC_WEBSOCKET_URL` (example `ws://98.130.76.223:9080`); `connect_user` userType `restaurant`; consumes `order_request` (incl. nested `data.type==='order_request'` and `CHANNEL_JOIN`), `order_update` | gateway ✔ | OK |

Also: `NEXT_PUBLIC_TEMPORAL_UI` (example `http://98.130.76.223:8080`), Supabase pairs `NEXT_PUBLIC_SUPABASE_URL_AUTH/_ANON_KEY_AUTH` and `_REGISTRATION_` variants, Google Maps keys, `src/utils/supabase/storage/client.ts` uploads.

### 3.5 `apps/admin-web` (Next.js admin portal)

Base URL: `NEXT_PUBLIC_API_URL` fallback `https://api.halalgoes.com` (`src/lib/api/config.ts`). Client: fetch wrapper, `admin_access_token`/`admin_refresh_token` in localStorage, refresh via `POST /auth/admin/refresh`, redirect to `/login` on failure. `.env.example` also declares `BACKEND_URL`/`NEXT_PUBLIC_BACKEND_URL` (unused in code).

| Caller (`src/lib/api/endpoints/`) | Method + Path | Backend | Status |
|---|---|---|---|
| auth.ts | POST `/auth/admin/login`, POST `/auth/admin/refresh`, POST `/auth/logout` | **MISSING** | login page cannot work against this backend |
| admin.ts | POST `/admin` (body `{email,password,name?}` typed) | ✔ but backend `createAdmin()` **ignores body** | shape mismatch |
| admin.ts / analytics.ts | GET `/admin/analytics` | ✔ | OK |
| restaurants.ts | GET `/admin/restaurants` | ✔ | OK |
| restaurants.ts | GET `/admin/restaurants/pending-review` | **MISSING** | |
| restaurants.ts | GET `/admin/restaurants/:id` | **MISSING** (list route only) | |
| restaurants.ts | POST `/admin/restaurants/:id/approve` | ✔ | OK (`{admin_id}`) |
| restaurants.ts | POST `/admin/restaurants/:id/reject`, POST `.../status`, GET `.../documents/:docId` | **MISSING** | |
| riders.ts | GET `/admin/riders` ✔; GET `/admin/riders/pending-review` ✖; POST `/admin/riders/:id/approve` ✔ (but client sends **no body** while backend reads `body.admin_id` → undefined); POST `/admin/riders/:id/reject` ✖ | mixed | |
| users.ts | GET `/admin/users` ✔; GET `/admin/users/:id` ✖; DELETE `/admin/users/:id` ✔ | mixed | |
| orders.ts | GET `/admin/orders` | ✔ | OK |
| refunds.ts | GET `/admin/refunds`, GET `/admin/refunds/:id`, POST `/admin/payments/:id/refund`, GET `/admin/refunds/analytics` | **ALL MISSING** (closest: POST `/payments/:id/refund`) | |
| disputes.ts | GET/PATCH/POST `/admin/disputes*` (list, details, status, resolve, analytics) | **ALL MISSING** | |
| settlements.ts | GET `/admin/settlements*`, POST `.../retry`, GET/POST/PATCH `/admin/settlement-config*` | **ALL MISSING** | |
| config-only (never called) | `/admin/transfer-audit`, `/admin/email-templates*` | MISSING | declared in `API_CONFIG` only |
| `store/auth-store.ts` | POST `{NEXT_PUBLIC_API_URL}/auth/admin/login` | MISSING | |
| **Legacy dead code** `lib/api-client.ts` | GET `/api/admin/restaurants`, POST `/api/admin/restaurants/:id/approve` (relative) | **no Next route handlers exist in admin-web at all** | guaranteed 404 |
| Legacy `lib/admin-auth-store.ts` | Supabase phone-OTP + POST `/api/admin/create` (relative) | 404 | superseded by email/password auth-store |
| `app/documents/restaurant-documents/page.tsx` | GET `/api/admin/restaurants/:id` (relative → 404) and POST **`http://localhost:3456/admin`** (hardcoded localhost) | broken | |
| `middleware.ts` | Supabase session refresh (`utils/supabase/auth/middleware`) using `NEXT_PUBLIC_SUPABASE_URL_AUTH`/`_ANON_KEY_AUTH` | external | Note: `.env.example` documents `NEXT_PUBLIC_SUPABASE_URL` (without `_AUTH`) — name mismatch |
| `next.config.ts` | allows images from `minio.halalgoes.com` | | production MinIO host |

Admin-web also configures `NEXT_PUBLIC_WEBSOCKET_URL` (fallback `ws://localhost:9080`) and `NEXT_PUBLIC_TEMPORAL_UI` (fallback `http://localhost:8080`) in `BACKEND_API_CONFIG` but no WS client code uses them.

### 3.6 `apps/web`, `apps/docs`

Untouched Turborepo starter templates. No API calls.

### 3.7 `packages/auth` (`@halal-goes/auth`, shared by users + rider apps)

- Supabase client (`src/clients/supabase.ts`): `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY`, SecureStore-backed session, `+91` default country code (`config/constants.ts`).
- Backend calls (all `EXPO_PUBLIC_BASE_API_URL`, all **missing** from hg-api): POST `/auth/otp/request`, `/auth/otp/verify`, `/auth/register`, `/auth/rider/otp/request`, `/auth/rider/otp/verify`, `/auth/rider/register`, `/auth/logout`. Responses expected: `{success, data:{accessToken, refreshToken | onboardingToken, user/rider}}`.

---

## 4. Called-but-Missing Endpoint Summary (the drift)

All of the following are invoked by frontend code but have **no handler anywhere in `/home/user/hg-api/api/src`** (verified by grep for `onboarding`, `auth`, controller inventory, and both Yaak API collections `API v1.0.10.json` / `API v1.2.23.json` / hg-docker `API v1.2.25.json`, none of which contain an Auth folder):

- **Auth family (users/rider apps + packages/auth):** `/auth/refresh`, `/auth/logout`, `/auth/register`, `/auth/otp/request`, `/auth/otp/verify`, `/auth/rider/register`, `/auth/rider/otp/request`, `/auth/rider/otp/verify`
- **Admin auth (admin-web):** `/auth/admin/login`, `/auth/admin/refresh`
- **Restaurant auth + onboarding (restaurant-web):** `/auth/restaurant/{register,login,verify-email,refresh}`, `/auth/onboarding/restaurants/{status,profile,documents/upload-url,documents/confirm,documents/submit,documents,stripe/connect,stripe/status}`
- **User onboarding:** PUT `/users/:id/onboarding/profile`
- **Rider onboarding:** GET `/riders/:id/onboarding/status`, POST `/riders/:id/onboarding/{profile,vehicle,documents,documents/upload-url,documents/confirm}`
- **Admin operations:** `/admin/restaurants/pending-review`, `/admin/restaurants/:id` (GET), `/admin/restaurants/:id/{reject,status}`, `/admin/restaurants/:id/documents/:docId`, `/admin/riders/pending-review`, `/admin/riders/:id/reject`, `/admin/users/:id` (GET), `/admin/refunds*`, `/admin/payments/:id/refund`, `/admin/disputes*`, `/admin/settlements*`, `/admin/settlement-config*`, `/admin/transfer-audit`, `/admin/email-templates*`
- **Menu management (restaurant-web):** POST `/restaurants/menus`, DELETE `/restaurants/menu-items/:id`, POST `/restaurants/menu-items/:id/images/{upload-url,confirm}`
- **Payments:** PUT `/payments/carts/:cartId` (restaurant-web)
- **Broken relative URLs** (no Next route handlers exist in either web app): admin-web `/api/admin/*`, restaurant-web `/api/categories*`, restaurant-web fetch `/api/restaurants/:id/location`

Conclusion: production `https://api.halalgoes.com` evidently runs a newer backend (with auth/onboarding/refunds/settlements/Stripe) than the `hg-api` snapshot in this workspace, or those features are simply unbuilt while frontends were written ahead of the backend.

## 5. Exposed-but-Unused Backend Endpoints

`/users/:id/analytics`, `/riders/:id/analytics`, `/riders/orders/:orderId/status`, `/riders/nearby/search`, `/riders/active/all` (only referenced from unused restaurant-web riderEndpoints), `/restaurants/:id/analytics`, `/restaurants/orders/:orderId/status`, `/orders/user/:user_id`, `/orders/restaurant/:restaurant_id`, `/orders/:id/status`, `/orders/:id/tracking`, `/orders/analytics/user/:userId`, `/payments/:id` (declared in restaurant-web endpoints, never invoked from pages), `/payments/orders/:orderId`, `/payments/:id/refund`, `/payments/analytics/user/:userId`, `/carts/:userId` (GET), **the entire `/ratings` controller** (added in API v1.2.23 collection, no frontend caller).

## 6. Payload/Shape Mismatches (routes that exist)

1. PUT `/restaurants/:id/toggle-accepting` — restaurant-web sends `{is_accepting}`, backend destructures `{isAccepting}` → always `undefined` (treated as falsy).
2. POST `/admin/riders/:id/approve` — admin-web `ridersApi.approve(riderId)` sends no body; backend expects `{admin_id}` → `approved_by` recorded undefined.
3. POST `/admin` — admin-web sends `{email, password, name}`; backend `createAdmin()` takes no arguments (ignores credentials entirely).
4. Checkout payload (`users/hooks/checkoutPayload.ts`) omits `pricing.coupons_applied` (required by `PricingSnapshot`); no runtime validation, so silently accepted.
5. PUT `/api/orders/:orderId/status` (restaurant-web) adds `restaurant_id` to body; backend `updateOrderStatus` reads only `status`.
6. restaurant-web config `RESTAURANTS: '/api/restaurants/'` trailing slash produces `//` in every derived URL.
7. GET `/riders/:id/orders/:orderId` backend bug: `orderId` param ignored, returns full order list.

## 7. Env Vars / Base URLs Per App

| App | API base | WS | Other |
|---|---|---|---|
| users | `EXPO_PUBLIC_BASE_API_URL` (ex: https://api.halalgoes.com) | `EXPO_PUBLIC_WEBSOCKET` (ex: ws://98.130.76.223:9080) | `EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_PAYLOD_URL`, `EXPO_PUBLIC_FORM_ID` |
| rider | `EXPO_PUBLIC_BASE_API_URL` (fallback http://localhost:3456) **and** stray `EXPO_PUBLIC_API_BASE_URL` in riderService.ts | `EXPO_PUBLIC_WEBSOCKET_URL` (fallback ws://localhost:9080); dead hook hardcodes ws://192.168.200.19:9080 | Supabase main + `EXPO_PUBLIC_SUPABASE_REGISTRATION_URL/_ANON_KEY`; hardcoded https://api.halalgoes.com in documents.ts |
| restaurant | — (no hg-api usage) | — | Supabase, `EXPO_PUBLIC_PAYLOD_URL` (+ `/api/form-submissions`), `EXPO_PUBLIC_FORM_ID` |
| restaurant-web | **hardcoded** https://api.halalgoes.com (env `NEXT_PUBLIC_API_BASE_URL` declared but unread) | `NEXT_PUBLIC_WEBSOCKET_URL` | `NEXT_PUBLIC_TEMPORAL_UI`, server-side `TEMPORAL_ADDRESS` (gRPC, default localhost:7233), 2× Supabase pairs (`_AUTH`, `_REGISTRATION`), Google Maps |
| admin-web | `NEXT_PUBLIC_API_URL` (fallback https://api.halalgoes.com) | `NEXT_PUBLIC_WEBSOCKET_URL` (fallback ws://localhost:9080, unused) | `NEXT_PUBLIC_TEMPORAL_UI`, `NEXT_PUBLIC_SUPABASE_URL_AUTH/_ANON_KEY_AUTH` (env.example wrongly documents un-suffixed names), unused `BACKEND_URL`/`NEXT_PUBLIC_BACKEND_URL`, GOOGLE_MAPS_API_KEY, minio.halalgoes.com image host |
| backend | `PORT` (3456), `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, Redis/MinIO vars (MinIO module registration commented out in app.module.ts) | fixed 9080 | |

Recurring hardcoded hosts: `98.130.76.223` (:3456 API, :9080 WS, :8080 Temporal UI — a production/staging box leaked into .env.examples), `192.168.200.19` (dev LAN), `localhost:3456` (admin-web documents page), `api.halalgoes.com` (hardcoded in rider documents.ts and restaurant-web config), `minio.halalgoes.com`.

## 8. Auth/Security Model

- **Backend REST: zero authentication.** No guards, no JWT verification, no passport/supabase imports anywhere in `hg-api/api/src` (grep-verified). Every endpoint — including `POST /admin` (create admin), `DELETE /admin/users/:id`, approve/reject flows, and payment refunds — is world-callable. Frontends send `Bearer` tokens the backend never reads.
- **WebSocket: identity is client-asserted.** `connect_user`/`join_channel` accept any `{userId, userType}`; explicit "MVP mode" comment. Anyone can subscribe to any `order:{orderId}` channel or impersonate a restaurant/rider to receive `order_request` payloads (which include customer name/phone/address).
- Token issuance/refresh (`/auth/*`) lives outside this repo; mobile apps mix Supabase SMS-OTP sessions with backend-issued access/refresh tokens (AsyncStorage keys `accessToken`, `refreshToken`, `onboardingToken`; admin-web localStorage `admin_access_token`/`admin_refresh_token`; restaurant-web zustand `auth-store` persisted to localStorage).
- restaurant-web talking gRPC to Temporal from the Next server bypasses the API tier entirely.

## 9. Code-Quality Observations

- **Dead/legacy code:** admin-web `lib/api-client.ts` + `lib/admin-auth-store.ts` (phone-OTP flow superseded by email login), rider `hooks/useWebSocketConnection.ts` / `useMockWebSocket.ts`, restaurant apps' commented-out Payload CMS submission blocks, admin-web `BACKEND_API_CONFIG` WS/Temporal values unused, restaurant-web riderEndpoints/userEndpoints/cartEndpoints/feedEndpoints largely uncalled, apps/web + docs are untouched templates.
- **Duplicated implementations:** rider toggleAvailability exists twice with different env var names; both hg-api and each app re-declare Rider/Restaurant response interfaces by hand (no shared types package for API DTOs).
- **TODOs / MVP markers:** `updateCart.ts` "TODO: uncomment in production"; gateway "MVP: Allow joining channels without prior authentication"; riders.controller comment admitting rider-mapping cleanup is unimplemented (`pattern` variable computed then unused).
- **Logging hygiene:** extensive emoji console logging including token previews (`refreshToken?.substring(0, 20)` logged in both mobile apps) and full parsed API payloads in admin-web client.
- **Backend loosenesses:** `createMenuItem` body typed `any[]`; `respondToOrder` fires two duplicated Redis reads on error path; `PUT /orders/:id/status` bypasses the tracking workflow that the rider/restaurant variants use (three inconsistent status-update paths); `AppModule` registers `CartsController`/`CartsService` at root in addition to `CartsModule`; MinIO `FilesModule.registerAsync` commented out.
- **Version drift artifacts:** `hg-api/API v1.0.10.json` vs `v1.2.23.json` (adds Ratings), `hg-docker/API v1.2.25.json` — none document auth, confirming the auth service lives elsewhere; `REMAINING_ENDPOINTS_PATCH.md` shows analytics/tracking endpoints were patched in by copy-paste instruction file.

## 10. WebSocket + Async Contract (keys/channels referenced by both sides)

- WS events: `connect_user`, `join_channel`, `heartbeat`, `status`, `health_check` (in); `connection_confirmed`, `channel_joined`, `notification` (+`data.type: 'CHANNEL_JOIN'`), `order_request`, `order_update` (out). Channel naming: `order:{orderId}`.
- Redis keys read by controllers: `order_checkout_mapping:{orderId}:{restaurantId}`, `order_rider_checkout_mapping:{orderId}:{riderId}`, `notification_workflow:{orderId}`.
- Temporal: workflow IDs `order-tracking-{orderId}`, `checkout_{checkoutId}`; signals `restaurantResponseSignal`, `riderResponseSignal` (checkout saga) and rider-response signal on notification workflow; updates `orderStatusUpdate` (`source: 'restaurant'|'rider'`), `riderLocationUpdate`. restaurant-web reuses these IDs/signals directly over gRPC.
