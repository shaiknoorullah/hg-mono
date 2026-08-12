# Halal Goes — Gap & Contract Verification Report

Follow-up fleet analysis resolving 10 open questions/contradictions against the hg-api source
(`/home/user/hg-api/api/src`), the Prisma schema (`/home/user/hg-api/api/prisma/schema.prisma`),
both docker-compose stacks, and the frontend consumers in `/home/user/halal-goes/apps`.

All line numbers refer to files as they exist on disk today (2026-08-09).

---

## Q1. Response shape of `GET /users/:id/addresses`

**Verdict: The endpoint returns a BARE JSON ARRAY of DeliveryAddress rows — no `{data:[...]}` envelope, no wrapper of any kind.**

### Evidence

`/home/user/hg-api/api/src/services/users/users.controller.ts:57-60`:

```ts
@Get(':id/addresses')
async getUserAddresses(@Param('id') userId: string) {
  return await this.usersService.getUserAddresses(userId);
}
```

`/home/user/hg-api/api/src/services/users/users.service.ts:87-91`:

```ts
public async getUserAddresses(userId: string) {
  return await this.prisma.deliveryAddress.findMany({
    where: { belongs_to_user_id: userId, is_deleted: false },
  });
}
```

`prisma.deliveryAddress.findMany` returns `DeliveryAddress[]`, which NestJS serializes as a top-level
JSON array. There is no global transform interceptor: `main.ts` registers nothing
(`/home/user/hg-api/api/src/main.ts:14-59` — only Swagger/Scalar, WsAdapter, shutdown hooks) and
`app.module.ts` has no `APP_INTERCEPTOR` provider (`/home/user/hg-api/api/src/app.module.ts:99-105`).
The only interceptor on the controller is `CacheInterceptor` (`users.controller.ts:20`), which does not
reshape responses.

### Downstream impact

The mobile API wrapper already unwraps axios (`/home/user/halal-goes/apps/users/lib/apis/address/getUserAddress.ts:6-9`
returns `response.data`, i.e. the bare array). So:

- **Correct consumers** (treat result as array): `app/saved-addresses.tsx:60,256` (`addresses?.find(...)`, `addresses?.map(...)`), `components/SelectLocation/index.jsx:33-35`, `hooks/cart.ts:55` (`userAddresses[0].id`), `app/checkout.tsx` (`addresses?.[0]`).
- **Broken consumer**: `/home/user/halal-goes/apps/users/components/LocationSelector.tsx:47` —
  `const addresses = addressesResponse?.data || [];` double-unwraps. Since the response is a bare array,
  `array.data` is `undefined`, so `EnhancedLocationSelector` **always sees an empty address list** and its
  auto-select-first-address effect (lines 50-53) never fires. This is a live frontend bug, not a backend ambiguity.

---

## Q2. Cart update contract for `PUT /carts/:userId`

**Verdict: The Hoppscotch collection is correct; the hg-docker ORDERS_API_INTEGRATION_GUIDE.md is wrong. The code parses `{delivery_address_id, cart_items:[{food_item_id, quantity, selected_variant_id?, selected_addon_ids?}], coupon_codes?}`. Unknown fields are silently carried through and ignored (no validation pipe); the guide's payload (`items`, `restaurant_id`, `variant_id`) would leave `cart_items`/`delivery_address_id` undefined and make the workflow return a 200 with `{success:false, ...}`.**

### Evidence

Controller — `/home/user/hg-api/api/src/services/carts/carts.controller.ts:20-29`:

```ts
@Put(':userId')
async manageCartItems(
  @Param('userId') userId: string,
  @Body() cartUpdateData: Omit<UpdateCartData, 'user_id'>,
) {
  return await this.cartService.manageCartItems({
    ...cartUpdateData,
    user_id: userId,
  });
}
```

The authoritative shape — `/home/user/hg-api/api/src/services/carts/workflows/cart-management.workflow.ts:13-25`
(duplicated verbatim in `activities/cart.activities.ts:12-24`):

```ts
export interface CartItemInput {
  food_item_id: string;
  quantity: number;
  selected_variant_id?: string;
  selected_addon_ids?: string[];
}
export interface UpdateCartData {
  user_id: string;
  delivery_address_id: string;
  cart_items: CartItemInput[];
  coupon_codes?: string[];
}
```

The activity consumes exactly those keys: `cart.activities.ts:38-44` (`cartData.delivery_address_id` in the
address lookup), `:51` (`for (const item of cartData.cart_items)`), `:194` (`cartData.coupon_codes`),
`:255-261` (`item.selected_variant_id`, `item.selected_addon_ids` persisted to `cartFoodItems`).
`restaurant_id` is never read from the body — the restaurant is derived from the food items
(`cart.activities.ts:120-127`).

**No runtime validation exists**: `CartsController` has no `@UsePipes(ZodValidationPipe)` (contrast with
`UsersController` at `users.controller.ts:19`), and there are no cart DTO classes — only TS interfaces, which
are erased at runtime. Consequences:

- Unknown/extra fields (`items`, `restaurant_id`, `variant_id`) are spread into the workflow args untouched
  and simply never read — silently ignored.
- With the guide's payload, `cartData.cart_items` is `undefined`, so `cart.activities.ts:51` throws
  `TypeError: cartData.cart_items is not iterable`; the workflow's catch block
  (`cart-management.workflow.ts:48-54`) swallows it and the endpoint returns **HTTP 200** with
  `{ success: false, error: '...', cartId: null }`.

The wrong doc — `/home/user/hg-docker/ORDERS_API_INTEGRATION_GUIDE.md:144-163` shows
`{"items":[{"food_item_id","quantity","variant_id"}],"restaurant_id"}` and a fabricated response
`{"success":true,"cart_id",...}`; the real success response is
`{success, cartId, cartValue, itemCount, cart}` (`cart-management.workflow.ts:41-47`).

### Downstream impact

The users mobile app already sends the correct shape (`/home/user/halal-goes/apps/users/hooks/cart.ts:54-60`:
`delivery_address_id`, `cart_items` with `selected_variant_id`/`selected_addon_ids`). Any integrator who
follows the hg-docker guide will get non-failing 200 responses whose `success:false` payloads are easy to
mistake for success — the guide should be treated as unreliable for this endpoint.

---

## Q3. Delivery instructions: lowercase `'door'/'meet'/'lobby'` vs enum `DO_NOT_CALL/DO_NOT_RING_BELL/LEAVE_AT_DOOR`

**Verdict: Delivery instructions do not flow through the carts service at all — they only travel in the checkout request (`PUT /orders/checkout/:cartId` → `metadata.delivery_instructions`) and are persisted RAW, with no runtime validation, into the Prisma enum-array column at order creation. Lowercase values are neither rejected at the API boundary nor dropped; they pass through until the Prisma client rejects them at order-create time, failing the checkout saga's order step.**

### Evidence

Enum definition — `/home/user/hg-api/api/prisma/schema.prisma:29-34` and `:352`:

```prisma
enum DeliveryInstructions {
  DO_NOT_CALL
  DO_NOT_RING_BELL
  LEAVE_AT_DOOR
  @@map("delivery_instructions")
}
...
delivery_instructions DeliveryInstructions[]   // on model Order, line 352
```

Carts: `UpdateCartData` has no `delivery_instructions` field (`cart-management.workflow.ts:20-25`); a grep for
`delivery_instruction` across `src/services/carts/` returns nothing. So "validated/persisted in the carts
service" is false — carts never see it.

Where it is typed (compile-time only) — `/home/user/hg-api/api/src/common/types/checkout.types.ts:36-38`:

```ts
metadata?: Record<string, any> & {
  delivery_instructions: DeliveryInstructions[];
};
```

Where it is persisted raw — `/home/user/hg-api/api/src/services/orders/activities/order.activities.ts:117`:

```ts
delivery_instructions: metadata ? metadata.delivery_instructions : [],
```

The checkout endpoint (`orders.controller.ts:38-48`) has no validation pipe, so lowercase strings arrive
intact. At `order.create` the Prisma client validates enum members and throws
`PrismaClientValidationError` (invalid value for enum `DeliveryInstructions`) — i.e. the order-creation
activity inside the checkout saga fails whenever a lowercase id is present; with no instructions selected
(`[]`) checkout works.

### Downstream impact (the frontend bug is real and lives in the users app)

- The store is typed correctly: `/home/user/halal-goes/apps/users/stores/useDeliveryInstructionsStore.ts:5`
  — `type DeliveryInstructionCode = 'DO_NOT_CALL' | 'DO_NOT_RING_BELL' | 'LEAVE_AT_DOOR'`, and
  `getMetadata()` (lines 55-63) forwards `selectedInstructions` verbatim into the checkout payload
  (`hooks/checkoutPayload.ts:29` → `metadata`).
- But the UI feeds it lowercase ids: `/home/user/halal-goes/apps/users/utils/utils.shared.ts:419-423` —
  `instructionOptions = [{ id: 'door', ... }, { id: 'meet', ... }, { id: 'lobby', ... }]` — and
  `app/checkout.tsx:373` calls `onPress={() => handleInstructionSelect(option.id)}` →
  `toggleInstruction(instructionCode)` (checkout.tsx:147-149), bypassing the type via loose typing.
- Net effect: any user who taps a delivery-instruction chip will submit `['door', ...]`, and the backend
  order-creation step of the checkout saga will throw on the enum write. Nothing rejects it earlier and
  nothing drops it. Additionally, `'meet'`/`'lobby'` have no enum counterpart at all, so this is a semantic
  mismatch as well as a casing one.

---

## Q4. `/health` endpoint vs the Docker healthcheck

**Verdict: `GET /health` does not exist anywhere in the API. The Dockerfile HEALTHCHECK can never pass — the container is permanently marked `unhealthy` — but nothing in either compose file gates on the api service's health, so the stack still comes up; the damage is cosmetic/monitoring-level (and a trap for anyone adding `condition: service_healthy` on `api` or deploying to an orchestrator that kills unhealthy containers).**

### Evidence

- No health controller/route: grep for `health` (case-insensitive) across `/home/user/hg-api/api/src` matches
  only the WebSocket gateway — `core/notifications/notifications.gateway.ts:128-132`
  (`@SubscribeMessage('health_check')`, a WS message handler, not an HTTP route) and
  `core/notifications/services/websocket-status.service.ts`. No controller declares `@Get('health')`; there is
  no root `AppController` at all (`app.module.ts:98` — `controllers: [CartsController]` only), and `main.ts`
  registers no extra route besides `/api/docs`.
- The failing check — `/home/user/hg-api/api/Dockerfile:85-86`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3456/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
```

  NestJS returns 404 for `/health`, so the probe exits 1 every time → status `unhealthy` after 3 retries.
- Compose gating: in `/home/user/hg-api/docker-compose.yml` the `api` service (lines 320-350) uses only
  short-form `depends_on: [temporal, postgres, redis-master, minio]` (no `condition:`), and **no other
  service depends on `api` at all**. Every `condition: service_healthy` in the file targets `postgres` or
  `redis-master`. Identical situation in `/home/user/hg-docker/docker-compose.yml` (api service lines 322-349,
  image `devsupreme0/halalgoes-api`, same depends_on list, no healthcheck override, nothing depends on api).
- `restart: unless-stopped` does not restart on unhealthy (Docker only restarts on exit), so the container
  keeps running while flagged unhealthy.

### Downstream impact

`docker ps` / portainer / any monitoring shows the API as unhealthy forever, which will send operators
chasing a non-existent outage. Deploying the same image to Swarm/Nomad/K8s-with-docker-healthcheck semantics
would cause restart loops. Fix is a one-line health controller or removing the HEALTHCHECK.

---

## Q5. `POST /admin` body handling

**Verdict: `POST /admin` accepts and reads NO body whatsoever and persists an empty Admin row (`prisma.admin.create({ data: {} })`). No role, email, password, or `is_super_admin` concept exists anywhere server-side; the Admin model is only `id + restaurants_approved relation + timestamps`.**

### Evidence

`/home/user/hg-api/api/src/services/admin/admin.controller.ts:94-97`:

```ts
@Post('')
async createAdmin() {
  return await this.adminService.createAdmin();
}
```

(no `@Body()` parameter at all — the request body is discarded before it reaches any code).

`/home/user/hg-api/api/src/services/admin/admin.service.ts:178-182`:

```ts
async createAdmin() {
  return await this.prisma.admin.create({
    data: {},
  });
}
```

`/home/user/hg-api/api/prisma/schema.prisma:825-834`:

```prisma
model Admin {
  id String @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  restaurants_approved Restaurant[]
  created_at    DateTime @default(now()) @db.Timestamp()
  last_modified DateTime @updatedAt @db.Timestamp()
  @@map("admin")
}
```

Grep for `is_super_admin` across `/home/user/hg-api/api` returns zero hits.

### Downstream impact

admin-web (`/home/user/halal-goes/apps/admin-web/src/app/admins/page.tsx:53-56, 98-101`) collects
`{email, password, confirmPassword, is_super_admin}` and its `AdminUser` interface (lines 66-71) expects
`email`/`is_super_admin`/`created_at` back. Against this backend the create call "succeeds" but every
submitted field is thrown away, the returned row has no email or role, and the admin list UI will render
undefined emails/roles. There is also no admin auth of any kind server-side — the entire admin identity/role
model in admin-web is aspirational.

---

## Q6. `GET /admin/restaurants/:id`

**Verdict: Does not exist. `AdminController` has no `GET restaurants/:id` route — admin-web's `restaurantsApi.getById` will always 404. The only restaurant-by-id endpoint is `GET /restaurants/:id` in `RestaurantsController`.**

### Evidence

`AdminController` restaurant routes are exactly: `@Post('restaurants/:id/approve')`
(`admin.controller.ts:18-27`) and `@Get('restaurants')` (list, `admin.controller.ts:48-57`). No parameterized
GET exists (full controller is 99 lines; see Q5 quote for the tail).

The working route — `/home/user/hg-api/api/src/services/restaurants/restaurants.controller.ts:36-39`:

```ts
@Get(':id')
async getRestaurant(@Param('id') restaurantId: string) {
  return await this.restaurantsService.getRestaurantById(restaurantId);
}
```

### Downstream impact

`/home/user/halal-goes/apps/admin-web/src/lib/api/endpoints/restaurants.ts:62-64`
(`apiClient.get(`/admin/restaurants/${restaurantId}`)`) and its consumer `useRestaurant`
(`src/lib/hooks/useRestaurants.ts:19-25`) will 404 on every restaurant-detail page. Same family of gaps:
admin-web also calls `/admin/restaurants/pending-review`, `/admin/restaurants/:id/status`,
`/admin/restaurants/:id/reject`, `/admin/refunds/*`, `/admin/users/:id` — none of which exist in
`admin.controller.ts`. The frontend fix is to point getById at `/restaurants/:id`.

---

## Q7. toggle-accepting payload key

**Verdict: The backend destructures camelCase `isAccepting`. restaurant-web sends snake_case `is_accepting`, so the server receives `undefined` and writes `is_accepting_orders: undefined` — Prisma treats undefined as "don't change this field", so the toggle is a SILENT NO-OP (returns the unchanged restaurant row, HTTP 200).**

### Evidence

`/home/user/hg-api/api/src/services/restaurants/restaurants.controller.ts:76-85`:

```ts
@Put(':id/toggle-accepting')
async toggleAcceptingOrders(
  @Param('id') restaurantId: string,
  @Body() { isAccepting }: { isAccepting: boolean },   // <-- line 79: camelCase key
) {
  return await this.restaurantsService.toggleAcceptingOrders(
    restaurantId,
    isAccepting,
  );
}
```

`/home/user/hg-api/api/src/services/restaurants/restaurants.service.ts:253-258`:

```ts
async toggleAcceptingOrders(restaurantId: string, isAccepting: boolean) {
  return await this.prisma.restaurant.update({
    where: { id: restaurantId },
    data: { is_accepting_orders: isAccepting },   // undefined => field skipped by Prisma
  });
}
```

Frontend sender — `/home/user/halal-goes/apps/restaurant-web/src/app/orders/page.tsx:262-264`:

```ts
`/api/restaurants/${restaurantId}/toggle-accepting`,
{ is_accepting: newState }   // snake_case — never read by the controller
```

### Downstream impact

The restaurant dashboard's accepting-orders switch does nothing: the update returns the current row, and
page.tsx line 268 reads `data.is_accepting_orders` from that unchanged row, so the UI even snaps back to the
old state (an honest symptom, at least). Riders/carts keep seeing the stale `is_accepting_orders`. One-line
fix on either side (`is_accepting` → `isAccepting` or vice versa).

---

## Q8. Pricing flow: `GET /pricing/:cartId` and the origin of `cartPricing` in checkout

**Verdict: Bug confirmed. `GET /pricing/:cartId` pipes the cartId into `prisma.order.findUnique({ where: { id: orderId } })` — an Order lookup — so it can NEVER succeed for a real cart id (carts and orders have distinct UUIDs). The users app populates `cartPricing` EXCLUSIVELY from this endpoint, so against this backend the query fails/hangs, `cartPricing` stays at its all-zero default, and the pricing block sent in `PUT /orders/checkout/:cartId` is client-fabricated zeros that the server persists verbatim into the order. The checkout demo cannot produce correctly-priced orders end-to-end.**

### Evidence — backend

Chain: `pricing.controller.ts:8-11` (`@Get(':cartId')` → `calculatePricing(cartId)`) →
`pricing.service.ts:18-24` (starts `pricingCalculationWorkflow` with `args: [cartId]`) →
`pricing-calculation.workflow.ts:8-16` (`calculateOrderTotal(cartId)`) →
`/home/user/hg-api/api/src/services/pricing/activities/pricing.activities.ts:91-125`:

```ts
@Activity()
async calculateOrderTotal(orderId: string): Promise<{...}> {
  const order = await this.prisma.order.findUnique({
    where: { id: orderId },            // line 99-100: cartId used as an Order id
    include: { customer: true, restaurant: true, order_food_items: {...}, delivery_to_address: true },
  });
  const coupon = await this.prisma.couponCode.findUnique({
    where: { name: order?.coupon_codes[0] },   // line 118-122: undefined when order is null
  });
  if (!order) { throw new Error('Order not found'); }   // line 124-126
```

With a cart id, `order` is `null`; the `couponCode.findUnique({ where: { name: undefined } })` throws a
PrismaClientValidationError (or, past that, line 125 throws `'Order not found'`). The workflow's
`proxyActivities` (`pricing-calculation.workflow.ts:4-6`) sets only `startToCloseTimeout: '1 minute'` — no
`maximumAttempts` — so Temporal's default unlimited retry policy retries the failing activity forever and
`handle.result()` in `pricing.service.ts:24` never resolves: the HTTP request hangs until the client gives up.
(Note the workflow id even says `pricing-${cartId}-...`, `pricing.service.ts:21` — the parameter really is a
cart id by intent; only the activity was written against orders. It also secondarily depends on
`calculateDeliveryFee` (`pricing.activities.ts:24-33`) joining `delivery_address.location <-> restaurant_address.location`.)

### Evidence — users app

- Sole fetcher: `/home/user/halal-goes/apps/users/lib/apis/cart/getCartPricing.ts:6-8` — `GET /pricing/${cartId}`.
- Sole populator: `/home/user/halal-goes/apps/users/app/cart.tsx:25-34` — `useQuery({queryKey:['cart-pricing', cartId], queryFn: () => getCartPricing(cartId)})`, then `updateCartPricing(data)` on success. `hooks/cart.ts:26-28` only invalidates that same query after cart updates. No other writer of `cartPricing` exists except `clearCart` resetting it to zeros (`stores/useCartStore.ts:296-302`); its initial value is all zeros (`useCartStore.ts:185-191`).
- Checkout payload: `/home/user/halal-goes/apps/users/hooks/checkoutPayload.ts:22-28` copies
  `cartPricing.item_total/delivery_fee/platform_fee/discount_amount/amount_to_pay` into `pricing`, sent by
  `processCartPayments` → `PUT /orders/checkout/${cartId}`
  (`lib/apis/payments/processCartPayments.ts:11-14`, invoked from `app/payments/select-payment.tsx:147,172`).
- The cart/checkout screens don't even trust it for display: `app/cart.tsx:212-237` has the
  `cartPricing.*` renders commented out in favor of locally computed subtotal/fees, and `app/checkout.tsx:117-125`
  hardcodes `deliveryFee = 5.0; platformFee = 2.0` client-side for the total shown to the user (these
  hardcoded numbers are NOT what is sent to the server — the store zeros are).

### Evidence — server trusts client pricing

`order.activities.ts:119-125` writes the request's pricing straight into the order:
`item_total: pricing.item_total, total_order_value: pricing.amount_to_pay, tov_after_discount: ..., delivery_fee: ..., platform_fee: ..., coupon_codes: pricing.coupons_applied` — no server-side recomputation in the checkout saga.

### Downstream impact

End-to-end: cart works, pricing GET hangs/fails (and its unlimited-retry workflow leaks on the Temporal
pricing-queue for every attempt), `cartPricing` stays zero, checkout creates an order whose monetary fields
are all 0 (and `coupon_codes: undefined` since the app never sends `coupons_applied`). The demo "works" only
in the sense that an order row appears; every financial figure on it is client-fabricated (zeros). Fixing it
requires a real cart-based pricing activity (cart lookup + `calculateDeliveryFee`), or checkout-side
recomputation.

---

## Q9. Legacy `location` POINT vs `coords` geometry columns — is a POST-created restaurant discoverable?

**Verdict: Split-brain, but in the restaurant's favor for discovery: `POST /restaurants` writes only the legacy `location` POINT on restaurant_address, and both feed discovery and pricing distance read `location` — so a newly created restaurant IS discoverable in the feed and priceable. However, rider assignment reads only `coords` (NULL until someone calls `PUT /restaurants/:id/location`), so orders for that restaurant can never find its location for rider dispatch. Rider-side geo uses `coords` exclusively (written by rider location updates), while the rider table's legacy `location` column is dead.**

### Evidence — schema (both columns exist on both tables)

`/home/user/hg-api/api/prisma/schema.prisma`:
- RestaurantAddress (756-778): `location Unsupported("POINT")?` (767) AND `coords Unsupported("geometry(Point, 4326)")?` (769), each indexed (773, 776).
- Rider (423-453): `location Unsupported("POINT")?` (438) AND `coords Unsupported("geometry(Point, 4326)")?` (439).
- DeliveryAddress (146+): only `location Unsupported("POINT")?` (162) — no coords.

### Evidence — writers

- Restaurant create writes **location** — `/home/user/hg-api/api/src/services/restaurants/restaurants.service.ts:41-45`:
  ```sql
  UPDATE restaurant_address SET location = POINT(${coords.lng}, ${coords.lat}) WHERE id = ...
  ```
- `PUT /restaurants/:id/location` writes **coords** — `restaurants.service.ts:365-370`:
  ```sql
  UPDATE restaurant_address SET coords = ST_SetSRID(ST_MakePoint(...), 4326), ...
  ```
- Rider location updates write **coords** — `/home/user/hg-api/api/src/services/riders/activities/rider.activities.ts:133-138` (`SET coords = ST_SetSRID(ST_MakePoint(...), 4326)`).
- User delivery-address create writes **location** — `users.service.ts:67-72` (`SET location = POINT(...)`).

### Evidence — readers

- Feed discovery reads restaurant **location** — `/home/user/hg-api/api/src/services/feed/activities/feed.activities.ts:536-549`:
  `ra.location[0]`, `ra.location[1]`, `ra.location <-> POINT(lng,lat) < radius/111` on `restaurant_address ra`.
- Pricing delivery fee reads **location** on both sides — `pricing.activities.ts:24-33`:
  `da.location <-> ra.location as distance` (delivery_address ⋈ restaurant_address).
- Order-assignment restaurant lookup reads **coords** — `/home/user/hg-api/api/src/services/orders/activities/order-assignment.activities.ts:419-427`:
  `SELECT ST_Y(coords), ST_X(coords) FROM restaurant_address WHERE restaurant_id=... AND coords IS NOT NULL`
  → returns `{success:false, error:'Restaurant location not found'}` (439-442) when only `location` is set.
- Rider discovery reads rider **coords** — `rider.activities.ts:75-92`:
  `ST_Distance(coords, ...)`, `WHERE ... AND coords IS NOT NULL AND ST_DWithin(coords, ..., radius)`.
  (Also rider read-back `ST_Y(coords)/ST_X(coords)` at 231-235, and `restaurants.service.ts:103-111` `getRestaurantLocation` reads coords.)

### Downstream impact

A restaurant onboarded purely through `POST /restaurants` appears in the users app feed and prices correctly,
but every checkout for it dies at rider assignment ("Restaurant location not found") until
`PUT /restaurants/:id/location` back-fills `coords`. The GIST index on rider `location` (schema line 452) indexes
a column nothing writes. Frontends see this as: feed fine, checkout stuck at the rider step.

---

## Q10. Does `GET /riders/:id/orders/:orderId` ignore `orderId`?

**Verdict: Yes — completely. The handler accepts `orderId` (and a `status` query param) and then calls the plain list method with only `riderId`, returning ALL of the rider's orders instead of the requested one. The `status` param is dropped too (the service supports it but the controller doesn't pass it).**

### Evidence

`/home/user/hg-api/api/src/services/riders/riders.controller.ts:103-110`:

```ts
@Get(':id/orders/:orderId')
async getRiderOrder(
  @Param('id') riderId: uuid,
  @Param('orderId') orderId: uuid,
  @Query('status') status: OrderStatus,
) {
  return await this.ridersService.getRiderOrders(riderId);   // orderId & status unused
}
```

`/home/user/hg-api/api/src/services/riders/riders.service.ts:112-134` — `getRiderOrders(riderId, status?)`
does `order.findMany({ where: { delivery_partner_id: riderId, ...status } , orderBy: created_at desc })`;
the second parameter is never supplied by this route.

Note the ambient `CacheInterceptor` on the whole controller (`riders.controller.ts:24`) makes this worse:
distinct orderIds are at least distinct cache keys, but every one of them caches the same full list.

### Downstream impact

The rider app's order-detail fetch receives an array of every order the rider ever had rather than a single
order object. Any client doing `response.id` / `response.status` gets `undefined`; clients that "work" are
doing `response.find(o => o.id === orderId)` client-side. It also inflates payloads (full include of
restaurant, customer, address, food items for every historical order per detail-screen visit).

---

## Cross-cutting observations

1. **Validation is almost entirely compile-time.** Only `UsersController` mounts `ZodValidationPipe`
   (`users.controller.ts:19`) — and even there the DTOs are `Prisma.*Input` types, not Zod classes, so
   nothing is actually validated. Carts, orders/checkout, restaurants, riders, admin all accept raw JSON
   shaped only by erased TypeScript interfaces. Every contract mismatch in this report survives to runtime.
2. **Workflows convert exceptions into `{success:false}` 200s** (carts) or **hang forever on default retry
   policies** (pricing), which hides all of the above from HTTP status monitoring.
3. **The hg-docker integration guide is generated from an imagined API** — its cart body, cart response, and
   the mandatory-pricing-call flow do not match the code (the pricing call it mandates is the broken one).
