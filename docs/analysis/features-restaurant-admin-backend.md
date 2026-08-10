# Halal Goes — Feature Inventory: Restaurant App, Admin Dashboard, Backend

Scope: everything that exists today (working or not) across the restaurant-facing apps, the admin
dashboard, and the backend. Built for scoping a from-scratch rebuild as a single Go binary.
Nothing invented, nothing omitted.

**Sources**: `fleet/hg-fe-restaurant-apps.md`, `fleet/hg-fe-admin-web.md`,
`fleet/hg-api-commerce-services.md`, `fleet/hg-api-identity-services.md`, plus
`fleet/hg-api-core.md` and `fleet/gap-contract-verification.md` / `fleet/gap-git-history.md` for
auth, storage, notifications and contract facts the four primaries do not cover.
Cross-checked against live code at `/home/user/halal-goes/apps/restaurant-web`,
`/home/user/halal-goes/apps/admin-web`, `/home/user/hg-api/api/src` (2026-08-10).

---

## THE ONE FACT THAT REFRAMES THE WHOLE REBUILD

**The backend source we have is not the backend that is deployed.**

`hg-api` HEAD is 2025-10-11. The frontends were built against `https://api.halalgoes.com` until
2026-02-04 — 116 days later. Verified directly on disk today:

- `grep "@Controller("` across `/home/user/hg-api/api/src` returns exactly **10 controllers**:
  admin, users, carts, orders, riders, restaurants, payments, ratings, feed, pricing.
- There is **no auth controller, no onboarding controller, no Stripe code, no document-storage
  endpoint** anywhere in the repository. `grep -rin "onboarding|stripe|@UseGuards|JwtService|bcrypt|argon"`
  matches only a dead user-onboarding Temporal workflow and the fake `stripe_${nanoid()}` string.
- `git log --all -S "AuthModule" / -S "auth.controller" / -S "auth/otp"` → **zero commits ever**.
  Auth was declared as a future task in `PLAN.md §13.2`; `better-auth` is an installed dependency
  that is never imported.
- The `Admin` Prisma model is `id + timestamps + restaurants_approved` — **no email, no password,
  no role**. `POST /admin` takes no `@Body()` at all and runs `prisma.admin.create({ data: {} })`.

Yet restaurant-web calls `/auth/restaurant/{register,login,verify-email,refresh}` and
`/auth/onboarding/restaurants/{status,profile,documents/*,stripe/*}`; admin-web calls
`/auth/admin/{login,refresh}`, `/admin/restaurants/pending-review`, `/admin/restaurants/{id}/status`,
`/admin/restaurants/{id}/documents/{docId}`, `/admin/riders/pending-review`, and a whole
`/admin/{refunds,disputes,settlements,email-templates,transfer-audit}` surface.

**Consequence for the Go rebuild**: every auth, onboarding, KYC-document, Stripe Connect, and
admin-moderation capability is marked **MISSING** below — not because the product lacks it, but
because *there is no source to port*. Its only surviving specification is the set of HTTP calls the
two Next.js frontends make. Those calls are the contract; treat the frontends as the spec.

**Legend**

- **Status**: `WORKING` · `MOCK` (UI/stub only) · `BROKEN` (defect named) · `MISSING`
- **†** = the frontend feature works against the deployed private API, but **no backend source
  exists anywhere** to port. For the rebuild these are full greenfield backend builds.
- **Size**: `S` under an hour of agent work · `M` a few hours · `L` a day or more

---

## 1. RESTAURANT

Two generations ship side by side: `apps/restaurant` (Expo, onboarding-only, Supabase + Payload CMS)
and `apps/restaurant-web` (Next.js 15, the live operational portal against hg-api).

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **R1** | Phone OTP login (mobile) | Restaurant owner signs in with a phone number and a 4-digit SMS code via Supabase | BROKEN — UI shows Canada `+1` but `DEFAULT_AUTH_CONFIG` formats to `+91`, so OTPs go to the wrong country | M |
| **R2** | Splash + resume routing (mobile) | On launch, sends the owner to review screen / wizard / phone entry based on saved state | WORKING | S |
| **R3** | Social login buttons (mobile) | Apple/Google/Facebook buttons on the phone screen | MOCK — decorative, no handlers attached | S |
| **R4** | Registration wizard step 1 — basic info (mobile) | Collects restaurant name, owner name, email | WORKING | S |
| **R5** | Registration wizard step 2 — business info (mobile) | Collects address, business registration number, optional Indian GSTIN, halal/FSSAI certificate photo | WORKING (India-shaped fields) | M |
| **R6** | Map location picker (mobile) | Owner taps a Google map to set the restaurant's coordinates | BROKEN — `app.json` embeds the literal string `"process.env.GOOGLE_MAPS_API_KEY"`, so the Android Maps key is never injected; default centre is Dubai | M |
| **R7** | Registration wizard step 3 — cuisine + hours + prep time (mobile) | Picks one of 16 cuisines, sets open/close times, types average preparation time | WORKING | M |
| **R8** | Registration wizard step 4 — KYC documents (mobile) | Uploads food license, restaurant logo, sample menu, and 1–10 kitchen photos with progress bars | BROKEN — 10th kitchen photo always sent empty (`imageUrls.kitchenPhoto10` key does not exist); crashes if `kitchenPhotos` is undefined | M |
| **R9** | Document image upload (mobile) | Pushes each photo into a Supabase Storage bucket and keeps the public URL | BROKEN by design — bucket is **public**, so KYC licences/certificates are world-readable; advertised 1 MB limit never enforced; content-type hardcoded `image/jpeg` | M |
| **R10** | Application submission (mobile) | Posts the whole application to a Payload CMS form endpoint | BROKEN — unauthenticated `POST https://halalgoes.com/api/form-submissions` form id `4`; anyone can submit; real submission id is discarded and the literal string `'submitted'` stored instead | M |
| **R11** | "In Review" terminal screen (mobile) | Permanent post-submission screen with double-back-to-exit | WORKING | S |
| **R12** | Change phone number / logout (mobile) | Clears the session so a different number can register | WORKING | S |
| **R13** | Orders / menu / dashboard (mobile) | — | MISSING — the mobile app is purely a lead-capture funnel; it never talks to hg-api | L |
| **R14** | Email + password registration (web) | Creates the restaurant account with business name, email, 12+ char password, terms version | WORKING † — `POST /auth/restaurant/register`, no backend source | M |
| **R15** | Email verification (web) | Clicking the emailed link activates the account and issues tokens | WORKING † — `POST /auth/restaurant/verify-email` | M |
| **R16** | Login + onboarding-state routing (web) | Signs in and lands the owner on dashboard / pending-approval / the right wizard step | WORKING † — `POST /auth/restaurant/login` | M |
| **R17** | Session + token refresh (web) | Keeps the owner signed in, auto-refreshing the access token on any 401 | BROKEN (security) — access + refresh JWTs in `localStorage` **and** in non-HttpOnly, non-Secure cookies; readable by any XSS | M |
| **R18** | Route guard (web) | Blocks unauthenticated access to dashboard/menu/orders pages | BROKEN — middleware checks cookie *presence* only, never verifies; `/payments` and `/disputes` are in no protected list | S |
| **R19** | Onboarding step 1 — profile (web) | Owner name/phone/description, opening + closing time, address, and map-picked coordinates | WORKING † — `POST /auth/onboarding/restaurants/profile`; Google Maps key `AIzaSy…nveSU` is **hardcoded in source** | L |
| **R20** | Onboarding step 2 — KYC documents (web) | Uploads business licence, halal certificate, food safety cert, owner ID via presigned URLs | WORKING † — 3-call flow `documents/upload-url` → `PUT` to S3/MinIO → `documents/confirm`, then `documents/submit`; 10 MB cap, image/pdf | L |
| **R21** | Pending-approval screen (web) | Polls every 10s while an admin reviews the documents, advances automatically | WORKING † — `GET /auth/onboarding/restaurants/status` | S |
| **R22** | Onboarding step 3 — Stripe Connect (web) | Creates a Stripe Connect onboarding session and redirects the owner to Stripe to add payout details | WORKING † — `POST .../stripe/connect` with return/refresh URLs | L |
| **R23** | Stripe return + refresh handlers (web) | Handles coming back from Stripe, checks `details_submitted && charges_enabled`, restarts an expired session | BROKEN — the error path redirects to `/auth/login`, a route that does not exist in this app | S |
| **R24** | Dashboard (web) | Revenue chart, category breakdown, recent orders, trending items | MOCK — 100% hardcoded recharts demo ("Hello Orlando", $215,860); makes no API calls at all | L |
| **R25** | Receiving orders — WebSocket (web) | Live socket to the notifications gateway; identifies as `restaurant` and joins per-order channels | BROKEN — **no reconnect on close** (only lazy reconnect on a failed send); `joinedChannels` mutated outside `set()` so it is not reactive; `leaveChannel` never tells the server | M |
| **R26** | New-order popup with countdown (web) | Full-screen dialog with customer, items, total and a timer to `expiresAt` (default 60s) | BROKEN — expiry **auto-rejects** the order, and merely closing the dialog also rejects it; an accidental dismissal loses a paid order | M |
| **R27** | Accept order (web) | Confirms the order, which signals the checkout saga to proceed to rider assignment | WORKING — `PUT /api/restaurants/{id}/orders/{orderId}?action=accept`; hardcoded 1.5s wait "for WebSocket updates" before navigating | S |
| **R28** | Reject order (web) | Declines the order, which should trigger cancel + refund | BROKEN — backend returns success even when the Temporal signal fails, and the saga falls through to rider assignment if cancel/refund returns false | M |
| **R29** | Order queue / list (web) | Table of the restaurant's orders with status badges | WORKING — `GET /api/restaurants/{id}/orders`; no pagination, no date filter | M |
| **R30** | Order detail + rider-search progress (web) | Per-order page showing a live checklist of rider search steps driven by WebSocket events | WORKING | M |
| **R31** | Mark preparing / mark ready (web) | Restaurant advances the order through preparing → ready for pickup | MISSING — `updateStatus()` is defined at `orders/[id]/page.tsx:216` and **never called**; the UI only *displays* PREPARING/READY_FOR_PICKUP as backend-driven states | M |
| **R32** | Accepting-orders toggle (web) | Master switch for whether the restaurant takes new orders | BROKEN — frontend sends `{is_accepting}`, backend destructures `{isAccepting}` → Prisma sees `undefined`, skips the field, returns the unchanged row; the switch visibly snaps back | S |
| **R33** | Open/closed hours (web) | Sets the restaurant's opening and closing time | BROKEN (half-built) — captured once in onboarding step 1, then **no edit UI anywhere** and no backend enforcement of the window | M |
| **R34** | Restaurant location update (web) | Keeps the restaurant's map coordinates current | BROKEN — `PUT /api/restaurants/{id}/location` issued as a *relative* fetch to the Next.js origin where no such route exists; fails silently forever; effect deps omit lat/lng | S |
| **R35** | Menu auto-creation (web) | Creates a "Main Menu" on first visit if the restaurant has none | BROKEN — posts to `/restaurants/menus`, an endpoint that **does not exist** in the backend | S |
| **R36** | Menu item list (web) | Shows all items on the active menu with badges | WORKING — `GET /restaurants/{id}/menu` | S |
| **R37** | Menu item create (web) | Adds a dish with name, description, price, category, cuisine, veg/non-veg | WORKING — `POST /restaurants/{id}/menu/items` | M |
| **R38** | Menu item edit (web) | Updates any field of an existing dish | WORKING — `PUT /restaurants/menu-items/{itemId}` | S |
| **R39** | Menu item delete (web) | Removes a dish from the menu | BROKEN — calls `DELETE /restaurants/menu-items/{id}`, which **does not exist** in the backend controller | S |
| **R40** | Menu item images (web) | Uploads a photo per dish through presigned storage URLs | BROKEN † — 3-step flow (`images/upload-url` → PUT → `images/confirm`) has no backend source; the page also carries a `fixImageUrl()` hack stripping malformed `host:0/path` URLs the backend returns | M |
| **R41** | Item availability toggle (web) | Marks an individual dish in or out of stock | WORKING — `is_currently_available` on the item form | S |
| **R42** | Variants (size/quantity) (web) | Lets a dish have priced variants | MISSING in UI — `MenuItemVariant` types exist in the API SDK, zero variant UI in the menu page; the backend also writes `variant_type: {}` | L |
| **R43** | Add-ons / modifiers (web) | Lets a dish have priced add-ons | MISSING in UI — `MenuItemAddon` type exists, no UI; backend drops addon prices entirely at order creation | L |
| **R44** | Categories management (web) | Create/edit/delete menu categories | MOCK — local-state CRUD over `src/data/data.ts` fixtures; the real `/api/categories` fetch is commented out inside `categorySheet.tsx`; several fixture UUIDs are invalid hex | M |
| **R45** | Order history (web) | Past orders with filtering and search | MISSING — the orders table is a live list only; no history view, date range, status filter or pagination | M |
| **R46** | Earnings / payouts / settlements (web) | Shows what the restaurant has earned and when it gets paid | MOCK — `/payments` renders the shared "Upcoming…" placeholder | L |
| **R47** | Disputes / escalations (web) | Handles customer complaints against the restaurant | MOCK — `/disputes` renders "Upcoming…" | L |
| **R48** | Restaurant analytics (web) | Order counts, revenue, averages over time | MISSING — backend `GET /restaurants/{id}/stats` and `/analytics` exist and are **never called**; the dashboard shows fake numbers instead | M |
| **R49** | Legacy document-review page (web) | Old "under review" page with logout, still routable and still protected | BROKEN (dead) — `/docSubmit` superseded by `/onboarding/pending-approval` | S |
| **R50** | Sidebar + layout shell (web) | Fixed 264px nav: Dashboard, Categories, Menu Items, Orders, Payments, Disputes | WORKING | S |
| **R51** | TanStack Query data layer (web) | Cached/retrying data fetching configured in `query-client.ts` | BROKEN (dead) — **no `QueryClientProvider` is ever mounted** in `layout.tsx`, so the whole `use-menu-items.ts` hook layer is unusable | S |

**Restaurant totals** — WORKING 21 · MOCK 5 · BROKEN 19 · MISSING 6 · **51 features**
(8 rows are marked † — 7 of them WORKING — meaning no backend source exists to port)

---

## 2. ADMIN

`apps/admin-web` — Next.js 15 on port 3003, browser-direct REST to the backend, no Next API routes.

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **A1** | Admin login | Email + password sign-in issuing access and refresh JWTs | WORKING † — `POST /auth/admin/login`; the login page is confusingly routed at **`/signup`** | M |
| **A2** | Token refresh | Single-flight refresh on any 401, retried once with `X-Retry` | BROKEN — on retry `...options.headers` is spread *after* `Authorization`, so a caller-supplied stale token clobbers the refreshed one | S |
| **A3** | Logout | Ends the session and clears stored tokens | WORKING — `POST /auth/logout`, best-effort | S |
| **A4** | Session storage | Keeps the admin signed in across reloads | BROKEN (security) — both tokens in `localStorage`, XSS-exfiltratable; no HttpOnly cookies | M |
| **A5** | Route protection | Prevents unauthenticated access to admin pages | BROKEN — `middleware.ts` computes public vs protected then **always returns `NextResponse.next()`**; enforcement is per-page client checks plus backend 401s | M |
| **A6** | Redirect-on-auth-failure | Sends signed-out admins back to the login screen | BROKEN — users page, admins page and the API client all redirect to `/login`, **a route with no page** → users land on the 404 | S |
| **A7** | Role model (super admin) | Distinguishes super admins from regular admins | MOCK — `is_super_admin` exists on the object and the create form, but **no UI anywhere gates on it**, and the backend has no role concept at all | M |
| **A8** | Platform KPI dashboard | Cards for total users / restaurants / riders / orders / revenue plus pending approvals | WORKING — `GET /admin/analytics`; revenue rendered USD from cents | M |
| **A9** | Restaurants list (All / Pending / Approved tabs) | Tabbed table fetching all restaurants and the pending-review queue in parallel | BROKEN † — `/admin/restaurants/pending-review` has no backend source; `filteredAllRestaurants` filters on `restaurant.name` while pending objects carry `business_name`; the "Total Restaurants" card shows the *filtered* count | M |
| **A10** | Restaurant detail sheet | Side panel with the full restaurant record | BROKEN † — `restaurantsApi.getById` hits `GET /admin/restaurants/{id}`, which **does not exist**; only `GET /restaurants/{id}` does → 404 on every detail open | S |
| **A11** | View KYC documents | Renders each uploaded verification document from a presigned MinIO URL | WORKING † — `GET /admin/restaurants/{id}/documents/{docId}` returns `{download_url, filename, type}`; no backend source | L |
| **A12** | Approve restaurant | Marks the application verified, unlocking Stripe onboarding | WORKING † — `POST /admin/restaurants/{id}/status {action:'verify'}` | M |
| **A13** | Reject restaurant | Declines the application with a reason | WORKING † — same endpoint, `action:'reject'`; reason collected via browser `prompt()` | M |
| **A14** | Suspend restaurant | Temporarily stops an approved restaurant from trading | WORKING † — `action:'suspend'` from the Approved tab | S |
| **A15** | Reinstate restaurant | Restores a rejected or suspended restaurant | WORKING † — `action:'reinstate'` from the Rejected tab | S |
| **A16** | Ban restaurant | Permanently bars a restaurant | MISSING — `'ban'` is in the action union in `restaurants.ts` but **no UI button triggers it** | S |
| **A17** | Riders list (Inactive / Active tabs) | Tabs split by `is_accepting_orders` | WORKING — `GET /admin/riders` | S |
| **A18** | Riders pending review | Queue of rider applications showing which of the 4 documents are uploaded | WORKING † — `GET /admin/riders/pending-review` (drivers licence, vehicle registration, insurance, profile photo); no backend source | M |
| **A19** | Approve rider | Approves the rider and returns a Stripe Connect onboarding URL for them | WORKING † — `POST /admin/riders/{id}/approve`; the source-visible backend version merely flips `email_verified`/`phone_verified` and ignores the admin id | M |
| **A20** | Reject rider | Declines a rider application with a reason | WORKING † — `POST /admin/riders/{id}/reject`, reason via `prompt()` | S |
| **A21** | Riders approved page | Should list approved riders | BROKEN — lists **all** riders with no filter; the source comment admits it | S |
| **A22** | Riders rejected page | Should list rejected riders | BROKEN — fetches `/admin/riders` then unconditionally `setRiders([])`; always empty ("no rejection status in the API") | S |
| **A23** | View rider KYC documents | Open a rider's uploaded licence/insurance/registration | MISSING — only upload *state* flags are shown; there is no rider equivalent of the restaurant document viewer, and the sidebar's `/documents/rider-documents` link 404s | M |
| **A24** | Users list | Paginated platform user list | WORKING — `GET /admin/users` via react-query | S |
| **A25** | User detail sheet | Side panel with a user's record | BROKEN † — `GET /admin/users/{id}` has no backend route | S |
| **A26** | Delete user | Soft-deletes a platform user | WORKING — `DELETE /admin/users/{id}` with `{admin_id}` in the body (the backend should read the admin from the JWT instead) | S |
| **A27** | Create admin account | Form for email, password and super-admin flag | BROKEN — `POST /admin` takes **no `@Body()`** and runs `prisma.admin.create({data:{}})`; every submitted field is silently discarded and an empty row is created | M |
| **A28** | Admin account list | Shows existing admins | MOCK — local state only (the logged-in admin plus any created this session); no GET endpoint exists; resets on reload; created entries hardcode `is_super_admin: false` even for super admins | M |
| **A29** | Order list | Browse all platform orders with filters | MOCK — the entire page runs off `mockOrders` in `orders/utils.ts` while `ordersApi.listAll` sits unused; currency shown in PKR/RS against a USD dashboard | L |
| **A30** | Order detail | Full order view: customer, restaurant, rider, payment, rating | MOCK — same fixture data, no API call | M |
| **A31** | Order status transitions | Admin moves an order pending → … → delivered, or cancels it | MOCK — mutates local component state only | M |
| **A32** | Orders active / completed pages | Filtered order views | MOCK — "Upcoming…" placeholder | S |
| **A33** | Refunds | List refunds, view one, issue a refund against a payment, refund analytics | MISSING — `refunds.ts` client exists (`/admin/refunds`, `/admin/payments/{id}/refund`, `/admin/refunds/analytics`) with **no UI and no backend source** | L |
| **A34** | Disputes | List/inspect disputes, change status, resolve with refund + coupon amounts | MISSING — `disputes.ts` client exists (`/admin/disputes/*`) with **no UI and no backend source**; enums OPEN/UNDER_REVIEW/RESOLVED/REJECTED and 6 reasons defined | L |
| **A35** | Settlements | List settlements, retry a failed one, manage settlement config | MISSING — `settlements.ts` client exists (`/admin/settlements/*`, `/admin/settlement-config/*`) with **no UI and no backend source** | L |
| **A36** | Transfer audit | Audit trail of money movements | MISSING — `/admin/transfer-audit` in the endpoint catalog only | M |
| **A37** | Email templates | Manage transactional email content | MISSING — `/admin/email-templates`, `/admin/email-templates/{key}` in the catalog only | M |
| **A38** | Menu creation on behalf of restaurants | Admin builds or edits a restaurant's menu for them | MISSING — nothing anywhere in admin-web touches menus | L |
| **A39** | Platform analytics / reports | Sales, performance and analytics reporting | MOCK — `/reports`, `/reports/analytics`, `/reports/sales`, `/reports/performance` are all "Upcoming…"; the dashboard's "View Reports" button pushes `/analytics`, which does not exist | L |
| **A40** | Settings | Platform configuration | MOCK — "Upcoming…" | M |
| **A41** | Documents hub | `/documents` and `/documents/rider-documents` linked from the sidebar | MISSING — no pages exist; both 404 | M |
| **A42** | Legacy restaurant-documents page | Older document review screen | BROKEN — `/documents/restaurant-documents` uses relative `/api/admin/*` routes that do not exist in this app plus a hardcoded `http://localhost:3456/admin` fallback | S |
| **A43** | Real-time admin updates | Live order/approval feed | MISSING — `WEBSOCKET_URL` and `TEMPORAL_UI` are defined in config and **never used**; no websocket, SSE or polling anywhere | M |
| **A44** | 404 page | Error page with "Back Home" | WORKING | S |

**Admin totals** — WORKING 15 · MOCK 8 · BROKEN 11 · MISSING 10 · **44 features**
(12 rows are marked † — 9 of them WORKING — meaning no backend source exists to port)

---

## 3. BACKEND

Every domain capability. "Rebuild?" judgement is embedded in the status text; the defects cited are
from the reports and verified on disk.

### 3.1 Auth, sessions, identity

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B1** | Restaurant auth (register / verify email / login / refresh) | Lets a restaurant create an account and stay signed in | MISSING — no source in any commit; **rebuild from the frontend contract** | L |
| **B2** | Admin auth (login / refresh / logout) | Signs an operations admin in | MISSING — no source; the `Admin` model has no email or password column at all | L |
| **B3** | Customer + rider auth (OTP request / verify / register / refresh / logout) | Phone-OTP sign-in for the consumer and rider apps | MISSING — no source; frontends call `/auth/otp/*` and `/auth/rider/*` | L |
| **B4** | Password hashing & credential storage | Stores credentials safely | MISSING — no bcrypt/argon/scrypt anywhere; no credential columns exist | M |
| **B5** | JWT issuing, verification and rotation | Proves who is calling every endpoint | MISSING — zero `@UseGuards` in the entire `src/`; `better-auth` installed, never imported | L |
| **B6** | Authorization / RBAC / ownership checks | Ensures a restaurant only touches its own orders and menu | MISSING — total IDOR: any caller can read any cart, order, address or analytics by id | L |
| **B7** | Session revocation / logout everywhere | Kills stolen or stale sessions | MISSING | M |
| **B8** | Rate limiting, CORS policy, security headers | Basic abuse and browser-security controls | MISSING — no helmet, no throttler, no CORS config; WebSocket gateway is `origin: '*'` | M |
| **B9** | Request validation | Rejects malformed or hostile request bodies | BROKEN — `ZodValidationPipe` is mounted only on `UsersController` and is **inert** because handlers type bodies as `Prisma.*Input` (erased TS interfaces); every controller accepts raw JSON | L |
| **B10** | Mass-assignment protection | Stops clients writing fields they shouldn't | BROKEN — raw `Prisma.*Input` passthrough lets a client set `is_approved`, `total_earnings`, or the soft-delete columns via PUT | M |

### 3.2 Users, addresses

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B11** | User CRUD | Create, read and update customer profiles | WORKING — but unauthenticated and un-validated (see B6/B9/B10); rebuild with guards | M |
| **B12** | Delivery address create + list | Saves customer addresses with a geographic point | WORKING — transaction + raw `UPDATE delivery_address SET location = POINT(lng,lat)`; **returns a bare JSON array**, no envelope | M |
| **B13** | Delivery address update / delete / set-primary | Edit or remove a saved address | MISSING — only create and list endpoints exist | S |
| **B14** | User analytics | Order count, total spent, average order value, favourite restaurant, last order | WORKING | S |
| **B15** | User onboarding workflow | Temporal workflow creating a user and sending a welcome notification | BROKEN (dead) — **no caller anywhere**; duplicated as both `createUser` and `userOnboardingWorkflow`; its retry `initialInterval 10s` exceeds `scheduleToClose 10s` so retries can never fire; the welcome notification is a `console.log` | S |

### 3.3 Restaurants, menus, catalog

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B16** | Restaurant create / read / update | Registers a restaurant with address, coordinates and a default menu | BROKEN — **geo split-brain**: create writes the legacy `location` POINT, while rider dispatch reads only PostGIS `coords`, so a POST-created restaurant is discoverable in the feed but **every checkout for it dies at rider assignment** with "Restaurant location not found" until `PUT /:id/location` back-fills `coords` | L |
| **B17** | Restaurant onboarding state machine | Drives REGISTERED → EMAIL_VERIFIED → PROFILE_PENDING → DOCUMENTS_PENDING → DOCUMENTS_REVIEW → STRIPE_PENDING → ACTIVE/COMPLETED | MISSING — no source; the states are known only from restaurant-web's store | L |
| **B18** | Restaurant location update | Sets the PostGIS coordinate used by rider dispatch | WORKING — raw `ST_SetSRID(ST_MakePoint(lng,lat),4326)` | S |
| **B19** | Menu read | Returns the active menu with available, non-deleted items | WORKING | S |
| **B20** | Menu create (`POST /restaurants/menus`) | Creates a menu for a restaurant | MISSING — restaurant-web calls it; **no such route exists** | S |
| **B21** | Menu item bulk create | Adds dishes, upserting cuisine and category by name | BROKEN — writes `variant_type: {}` instead of the SIZE/WEIGHT/QUANTITY enum; sequential awaits inside the transaction (N+1); category/cuisine dedup key is a slug stored as the display name | M |
| **B22** | Menu item update | Field-by-field dish update | WORKING | S |
| **B23** | Menu item delete | Removes a dish | MISSING — restaurant-web calls `DELETE /restaurants/menu-items/{id}`; no such route | S |
| **B24** | Menu item image upload (presigned URL + confirm) | Gives the restaurant a URL to upload a dish photo to, then records it | MISSING — no source; the deployed API also returns malformed `host:0/path` URLs the frontend patches around | M |
| **B25** | Item variants | Priced size/quantity options on a dish | BROKEN — variants are created and priced in the cart, but `OrderFoodItems` has **no variant column**, so variant identity is lost at order creation and two variants of one dish violate the unique `(order_id, food_item_id)` constraint and abort the order | L |
| **B26** | Item add-ons | Priced extras on a dish | BROKEN — add-on prices are charged in the cart and then **dropped entirely** when the order is created; the customer is billed one number and the order records another | L |
| **B27** | Accepting-orders toggle | Master on/off switch for a restaurant taking orders | BROKEN — controller destructures `isAccepting`, frontend sends `is_accepting` → Prisma skips the field; silent no-op returning HTTP 200 | S |
| **B28** | Opening / closing hours | Stores and enforces trading hours | BROKEN (half-built) — `opening_time`/`closing_time` columns exist and are stored; **nothing anywhere enforces them** — orders can be placed at any hour | M |
| **B29** | Restaurant stats + analytics | Totals, today's orders, revenue, this-month averages | WORKING — no frontend calls them | S |
| **B30** | Restaurant approval workflow | Temporal workflow to approve and notify a restaurant | BROKEN (dead) — **no caller**; admin approves via direct Prisma write instead; `notifyRestaurantApproval` is a `console.log`; `createRestaurant` activity reads camelCase `openingTime` against snake_case input | S |
| **B31** | Feed / discovery | Personalised feed: nearby, trending, recent orders, popular items, order-again | WORKING with defects — non-geodesic `POINT <-> POINT` distance with a crude ÷111 degrees-to-km conversion; radii and windows hardcoded (10 km, 3 months, top 8/10/6) | L |
| **B32** | Full-text search | Search dishes and restaurants by keyword | BROKEN — cache writes a JS object through `redis.set(key, value: string)` so it stores the literal `[object Object]` and returns that raw string on a hit; the cache key ignores `userId`, `page` and `limit`, and `.replace(' ','_')` only replaces the **first** space → cross-user and cross-page collisions; the validation message says "greater than 3 characters" while the check is `<= 3`; NaN limit/page pass silently | M |

### 3.4 Cart, pricing, checkout

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B33** | Cart read | Returns a user's cart | WORKING — but routed through a Temporal workflow for a plain DB read, and readable by **any** caller for **any** user id | M |
| **B34** | Cart update | Full-replacement cart write with validation and value recalculation | BROKEN — two identical dishes with different add-on sets collide on the unique `(cart_id, food_item_id, selected_variant_id)` constraint; failures are swallowed into an HTTP **200** carrying `{success:false}` | M |
| **B35** | Coupons | Percentage-discount codes applied to a cart or order | BROKEN — **discount inversion**: `applyCouponDiscount` returns the *discount amount* but the caller treats it as the *amount after discount*; a 10% coupon on $50 charges the customer **$5** and reports a $45 discount | M |
| **B36** | Server-side pricing endpoint | Computes item total, delivery fee, platform fee, discount and amount to pay | BROKEN end-to-end — `GET /pricing/:cartId` feeds a **cart** id into `calculateOrderTotal(orderId)`, which looks up an **Order**; it can never succeed, and because the workflow sets no `maximumAttempts` Temporal retries the failing activity **forever**, so the HTTP request hangs and leaks a workflow per attempt | L |
| **B37** | Pricing as the source of truth | The server decides what the customer is charged | MISSING — **the client sends the full `PricingSnapshot` and `paymentProcessingWorkflow` charges `pricing.amount_to_pay` verbatim**; a client can pay $0.01 for any cart. In practice the users app's pricing call fails, so `cartPricing` stays at its all-zero default and orders are created with **every monetary field = 0** | L |
| **B38** | Delivery fee calculation | Distance-based delivery charge | BROKEN — `2.99 + km × 1.5` where distance comes from a non-geodesic `POINT <-> POINT` × 111, measured against the user's **primary** address rather than the order's delivery address; platform fee hardcoded `4.99` | M |
| **B39** | Price consistency | One agreed definition of what a line item costs | BROKEN — **four** competing definitions: cart adds variant price *to* base plus add-ons; order uses variant price *instead of* base and drops add-ons; pricing service recomputes from the Order row; and the amount actually charged is the client-supplied number | L |
| **B40** | Checkout saga orchestration | Coordinates payment → order → restaurant acceptance → rider assignment → tracking → cart clear | BROKEN — works on the happy path, but: the HTTP request emits an in-process event whose listener **blocks awaiting the workflow result for up to 15 minutes**; on restaurant rejection, if `cancelOrder` or `refundPayment` returns false the saga **does not return** and proceeds to rider assignment as though the order were accepted; `clearCart` fails for any user without a primary address (passes `delivery_address_id: ''`) | L |
| **B41** | Checkout idempotency | Stops a retried or double-submitted checkout charging twice | MISSING — no idempotency keys anywhere | M |
| **B42** | Delivery instructions | Customer notes such as "leave at door" | BROKEN — persisted **raw** into a Prisma enum array with no validation; the users app sends lowercase `'door'/'meet'/'lobby'` which have no enum counterpart, so the order-creation step of the saga throws whenever a chip is tapped | S |

### 3.5 Payments, refunds, money

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B43** | Card payment capture (Stripe) | Actually takes the customer's money | MISSING — `processPayment` writes a PaymentLog row with a **fabricated** `stripe_${nanoid()}` id; there is no Stripe SDK, no PaymentIntent, no client secret, no 3-D Secure | L |
| **B44** | Stripe webhooks | Reconciles asynchronous payment outcomes | MISSING — no webhook endpoint, no signature verification | L |
| **B45** | Stripe Connect (restaurant + rider accounts) | Onboards partners so they can be paid out | MISSING — no source; restaurant-web and the rider approval response both depend on it | L |
| **B46** | Payment method storage | Records which payment method a user chose | WORKING — stores only a `CREDIT_CARD|DEBIT_CARD|ONLINE` enum; **no tokenization, no PAN, no Stripe customer id** — nothing that can actually be charged | M |
| **B47** | Payment ledger | Records every payment attempt and outcome | WORKING as a ledger shape (`PaymentLog` with PENDING…REFUND_COMPLETED, CREDIT/DEBIT/REFUND); money handled as **JS floats** despite `@db.Money` columns | M |
| **B48** | Refunds | Returns money to the customer | BROKEN — three incompatible implementations: `PaymentsService.refundPayment` **mutates** the original row to REFUND_COMPLETED; `PaymentActivities.refundPayment` **creates a separate** REFUND row; and both `cancelOrderAndRefund` paths (assignment and tracking) only log *"Payment refund would be initiated here"* — an explicit TODO. **No money ever moves.** | L |
| **B49** | Legacy payment endpoint | `PUT /payments/orders/:orderId` | BROKEN — starts `paymentProcessingWorkflow` with `[user_id, order_id, payment_method_id]` against a signature of `(user_id, payment_method_id, checkout_id, amount_to_pay)`; the order id lands in the payment-method slot, checkout id is undefined so the signal back to the saga fails, and the amount is undefined | S |
| **B50** | Payment analytics | Aggregates by actor | WORKING | S |
| **B51** | Restaurant settlements / payouts | Pays restaurants their share on a schedule | MISSING — admin-web has a full client (`/admin/settlements`, `/admin/settlement-config`) with no backend source and no UI | L |
| **B52** | Rider earnings | Tracks what a rider has earned | BROKEN — `total_earnings` exists but DELIVERED-order earnings count **only `delivery_partner_tip`**, ignoring any delivery fee share; the re-add-to-pool query reads the dead legacy `location` column and omits a `::uuid` cast on the id, so it errors or returns nothing | M |
| **B53** | Rider payouts / transfers | Actually pays riders out | MISSING — no transfer code, no payout schedule; `/admin/transfer-audit` exists in the frontend catalog only | L |
| **B54** | Refund / dispute / chargeback records | Persisted refund and dispute entities | MISSING — admin-web defines `RefundStatus`, `RefundReason`, `DisputeStatus`, `DisputeReason` enums; the backend has **no Refund or Dispute model at all**, only an `OrderStatus.DISPUTED` value | L |
| **B55** | Money as exact decimal | Avoids floating-point drift on currency | BROKEN — `Number(Decimal)` conversions throughout; `roundPrice` rounds to the nearest 5 cents | M |

### 3.6 Order lifecycle

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B56** | Order creation | Turns a paid cart into an order with line items | BROKEN — the order is written as **`CONFIRMED` at creation because a payment id exists**, before the restaurant has ever seen it; restaurant is derived from the first cart item (no multi-restaurant guard); add-ons dropped, variants collide (B25/B26) | L |
| **B57** | Order status update endpoint | Changes an order's status | BROKEN — `PUT /orders/:id/status` casts the incoming string `as any` with **no transition validation and no auth**; anyone can mark any order DELIVERED | S |
| **B58** | Order state machine | Enforces legal status transitions | BROKEN — a valid transition table exists in `order-tracking.activities.ts`, but the tracking workflow **starts at RIDER_ASSIGNED**, so the restaurant-side CONFIRMED and PREPARING transitions can never be applied through it; B57 bypasses the table entirely | L |
| **B59** | Order read / user history / restaurant list | Fetches orders for a customer, restaurant or rider | WORKING — but exposes customer phone numbers to partners and has no pagination | M |
| **B60** | Order tracking | Live status and rider snapshot for a customer | WORKING — `GET /orders/:id/tracking`; note `OrdersService.trackOrder` is an empty method | S |
| **B61** | Order analytics | Aggregate counts and sums per user | WORKING | S |
| **B62** | Restaurant accept/reject → saga signal | Delivers the restaurant's decision into the waiting checkout saga | BROKEN — correlated through a 30-minute Redis key with **no authentication**, so anyone who knows an orderId + restaurantId can accept or reject; the handler **returns success even when the Temporal signal fails**, leaving the order CONFIRMED in the DB while the saga times out | M |
| **B63** | Restaurant acceptance timeout | Auto-cancels if the restaurant never answers | BROKEN — no explicit timeout; it relies on the saga's 15-minute execution timeout, which surfaces as a workflow failure rather than a clean cancel-and-refund | M |
| **B64** | Customer order cancellation | Lets a customer cancel | MISSING — no endpoint; `notifyCustomerOrderCancelled` is a **no-op body** | M |
| **B65** | Order timeout compensation | Cancels and refunds an order stuck too long | BROKEN — the 5-hour tracking timeout fires and calls `cancelOrderAndRefund`, whose refund is a TODO log (B48) | M |
| **B66** | Checkout audit log | Records which saga step an order reached | MISSING (dead) — a `CheckoutLog` Prisma model exists and is **referenced by no code at all** | S |

### 3.7 Rider dispatch & geo

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B67** | Rider CRUD | Create, read and update delivery partners | WORKING — unauthenticated; `GET /riders/active/all` dumps **every** active rider row unpaginated | M |
| **B68** | Rider location updates | Records where a rider is, in Postgres and Redis | BROKEN — `RiderActivities.updateRiderLocation` calls `geoadd(key, latitude, longitude, member)` with the arguments **swapped** (GEOADD is longitude-first); `RedisUtils` writes `rider:{id}:location` with GEOADD but `getRiderLocation` reads it with `GET`+`JSON.parse` → WRONGTYPE | M |
| **B69** | Rider availability toggle | Rider goes on or off shift | BROKEN — going **offline** never removes the rider from the `riders:active` GEO pool; the `zrem` is commented out, so offline riders keep receiving dispatch | S |
| **B70** | Expanding-radius rider discovery | Searches 5 → 10 → 15 → 20 km for available riders | WORKING — Redis GEORADIUS with a PostGIS `ST_DWithin` fallback; degraded by B69's stale pool and by restaurants with NULL `coords` (B16) | M |
| **B71** | Rider order offer + acceptance | Offers an order to nearby riders and takes the first acceptance | WORKING with defects — fan-out loops riders **sequentially**; the accept path signals both the checkout saga and the notification workflow; `await condition(...)` has **no timeout**, bounded only by the caller's 2-minute execution timeout, which surfaces as a failure rather than a clean "nobody accepted" | L |
| **B72** | Rider order invalidation | Tells the other riders the order is gone | WORKING | S |
| **B73** | Rider rejection record | Records that a rider declined | MISSING — `rejectOrder` (rider) **only logs**; nothing is persisted, so a rider can be re-offered the same order | S |
| **B74** | Rider order detail | Fetch one specific order for a rider | BROKEN — `GET /riders/:id/orders/:orderId` **ignores both `orderId` and `status`** and returns the rider's entire order history, with a `CacheInterceptor` caching that same full list under every distinct orderId | S |
| **B75** | Rider stats + analytics | Totals, today/week counts, monthly earnings | BROKEN — earnings count tips only (B52) | S |
| **B76** | Rider location tracking workflow | Temporal workflow for rider tracking | BROKEN (dead) — an MVP stub that only sets availability to true; **no caller** | S |

### 3.8 Realtime, notifications

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B77** | WebSocket gateway | Live socket on port 9080 for users, riders, restaurants and admins | BROKEN (security) — hardcoded port, CORS `origin:'*'`, and **`connect_user` trusts whatever userId and userType the client claims**; `join_channel` explicitly documents "MVP: Allow joining channels without prior authentication". Any client can impersonate any restaurant, join any `order:{id}` channel, and **drain another user's queued notifications** (the queue is deleted on read) | L |
| **B78** | Connection presence + heartbeat | 30s ping/pong, terminates dead sockets, tracks who is online | WORKING — connection metadata in Redis with a 1h TTL; "connected" means last-seen within 5 minutes | M |
| **B79** | Channel / room subscriptions | Puts the customer, restaurant and rider into a shared per-order room | WORKING — but **two parallel schemes** are maintained side by side (`subscriptions:<name>` and legacy `channel:*:members`) | M |
| **B80** | Order update broadcast | Pushes status changes to everyone in the order room | WORKING | M |
| **B81** | Restaurant order-request notification | Pings the restaurant with a new order and a 1-minute expiry | WORKING — queues to a failed-notifications list if the restaurant is offline; `WorkflowIds.restaurantNotification` **ignores the orderId** and returns a random id, defeating Temporal's id-based dedup | M |
| **B82** | Rider order-request notification | Fans an order out to nearby riders with a 10-minute expiry | WORKING with defects — sequential loop; the `queued` counter is declared and **never incremented**; console.log inside workflow code | M |
| **B83** | Offline notification queue | Holds notifications for users who are not connected | BROKEN — the drain is **destructive** (`zrevrange` then `DEL`), so a reconnect from an impersonated socket permanently consumes another user's notifications; `'medium'` priority is unmapped and silently scores 50; **three** overlapping queue mechanisms coexist | M |
| **B84** | Push notifications | Native mobile push | MISSING — `sendPushNotificationWorkflow` exists as a shell; **the activity implementation does not exist**, so the workflow would fail if ever started, and nothing starts it. No FCM/APNs, no device-token storage | L |
| **B85** | Email notifications | Transactional email (verification, receipts, approvals) | MISSING — same: workflow shell, no activity, no provider, no templates | L |
| **B86** | SMS / OTP delivery | Sends the OTP codes the auth flow depends on | MISSING — same: workflow shell, no activity, no provider | L |
| **B87** | Admin notifications | System, fraud, demand and rider-shortage alerts | MISSING — `AdminNotificationActivities.sendToAdmin`/`broadcastToAllAdmins` are **TODO stubs returning false/0**, so every alert type silently no-ops | M |
| **B88** | Notification read state / grouping | Marks notifications read, removes a whole group when an order is taken | WORKING | S |
| **B89** | Redis scan hygiene | How the notification store enumerates keys | BROKEN — `KEYS connections:*`, `KEYS queue:*`, `KEYS notification:*` and `rehydrateChannels` all use blocking O(N) `KEYS` on production Redis | S |

### 3.9 Ratings, storage, admin ops, platform

| # | Feature | What it does (one line, plain language) | Status today | Size |
|---|---|---|---|---|
| **B90** | Rider ratings | Customer rates the rider; the average is recomputed | BROKEN — accepts **any** number (no 1–5 clamp; `Decimal(2,1)` rejects >9.9 at the DB), takes `user_id` from the request body, and never verifies the rater actually had that delivery | M |
| **B91** | Food item ratings | Customer rates a dish | BROKEN — same defects | M |
| **B92** | Restaurant ratings | Customer rates the restaurant | MISSING — no model, no endpoint; only rider and food-item reviews exist | M |
| **B93** | Object storage (MinIO/S3) | Stores KYC documents and menu images | MISSING — `FilesModule` is fully implemented but its **only registration is commented out** in `app.module.ts`, so MinIO is unavailable via DI; compose passes `MINIO_ACCESS_SECRET` while the code reads `MINIO_SECRET_KEY` — it would not connect even if uncommented | L |
| **B94** | Presigned upload/download URLs | Lets clients upload documents and admins view them without proxying bytes | MISSING — no source; both restaurant-web and admin-web depend on it | L |
| **B95** | Document review workflow (submit → review → approve/reject) | Moves a restaurant's KYC pack through review | MISSING — no source; `/admin/restaurants/pending-review` and `/{id}/status` do not exist in this codebase | L |
| **B96** | Admin approve restaurant | Marks a restaurant approved | BROKEN — `POST /admin/restaurants/:id/approve` exists but takes `admin_id` **from the request body with no authentication**; the admin-web UI calls the newer `/status` endpoint, which does not exist here | M |
| **B97** | Admin approve rider | Approves a delivery partner | BROKEN — ignores `adminId` entirely and simply flips `email_verified` and `phone_verified` to true; there is **no `is_approved` column on Rider**, so approval is not actually representable | M |
| **B98** | Admin restaurant status actions (verify/reject/suspend/ban/reinstate) | Full moderation lifecycle | MISSING — no source; only the deprecated approve/reject pair exists | M |
| **B99** | Admin listings (users, restaurants, riders, orders) | Paginated back-office lists | WORKING — orders list has **no soft-delete filter** | S |
| **B100** | Platform analytics | Counts, revenue, average order value, active and today's orders | WORKING | M |
| **B101** | Admin soft-delete user | Removes a user, retaining the record | WORKING — `admin_id` comes from the request body rather than a verified session | S |
| **B102** | Create admin | Provisions a new back-office account | BROKEN — no `@Body()` parameter at all; `prisma.admin.create({data:{}})` creates an **empty row** with no email, password or role | M |
| **B103** | Admin audit trail | Records who approved, rejected or deleted what | MISSING — only `approved_by_admin_id` and `deleted_by` columns; no audit log entity | M |
| **B104** | Health endpoint | Lets orchestrators know the service is alive | MISSING — `GET /health` does not exist; the Dockerfile HEALTHCHECK probes it every 30s and the container is therefore **permanently marked unhealthy** | S |
| **B105** | API documentation | Swagger/Scalar reference | WORKING — Scalar at `/api/docs` | S |
| **B106** | Structured logging | Production-grade logs | BROKEN — pino is configured but only enabled when `NODE_ENV=production`; controllers and services use `console.log` throughout; **Prisma logs every query unconditionally**, leaking PII in production | M |
| **B107** | Orchestration architecture | How work is coordinated | BROKEN (design) — **10 Temporal workers bundled in one process at boot**, each re-bundling workflow code; Temporal used as an RPC wrapper even for plain DB reads (get cart, feed); non-deterministic workflow ids built from `Date.now()`; `RedisService` and `CartsService`/`CartsController` are **registered twice** (root + module), yielding duplicate Redis connections and duplicate route registration | L |
| **B108** | Cache layer | HTTP response caching | BROKEN — `CacheModule` hardcodes `redis://localhost:6379`, ignoring every `REDIS_*` env var, so inside Docker (Redis at `redis-master`) it silently cannot reach Redis; a `CacheInterceptor` also sits on the **write-heavy riders controller**, serving stale location data | S |

**Backend totals** — WORKING 29 · MOCK 0 · BROKEN 44 · MISSING 35 · **108 capabilities**
(of the 29 WORKING, every single one is unauthenticated and unvalidated — see B5/B6/B9)

**Grand total across all three areas: 203 features.**

---

## 4. BACKEND CAPABILITIES THAT MUST EXIST FOR REAL PAID ORDERS BUT ARE ABSENT OR BROKEN TODAY

The true build list. Nothing here is optional if the platform is to take a single real payment.

### 4.1 Nothing is authenticated — the whole identity layer must be built (B1–B10, B77)

There is not one guard, JWT check or session validation in the entire API. Every consequence is
live today: any caller can read any user's cart and addresses, flip any order to DELIVERED, issue a
refund, add a payment method to any account, approve any restaurant, soft-delete any user, and — on
the WebSocket — impersonate any restaurant, join any order channel, and consume another user's
queued notifications. The `Admin` model cannot even represent a credential. This is a from-scratch
build of registration, OTP and password auth, JWT issue/verify/rotate, ownership checks on every
resource, and an authenticated WebSocket handshake.

### 4.2 No money actually moves (B43, B44, B45, B48, B51, B53)

Payments are simulated: `processPayment` writes a PaymentLog row stamped with a fabricated
`stripe_${nanoid()}` id. There is no Stripe SDK, no PaymentIntent, no webhook, no stored card token
or customer id — `UserPaymentMethod` holds only an enum naming a *category* of payment method.
Refunds are worse: three mutually contradictory implementations, and the two that the cancellation
paths actually invoke only log *"Payment refund would be initiated here"*. Every "cancel and refund"
branch in the assignment and tracking workflows is a no-op. Nothing pays restaurants or riders out.

### 4.3 The customer sets their own price (B36, B37, B38, B39)

The checkout request body carries the full `PricingSnapshot`, and the payment workflow charges
`pricing.amount_to_pay` verbatim with **no server-side recomputation**. A client can pay $0.01 for
any cart. Server-side recomputation is not merely absent — it is impossible today, because
`GET /pricing/:cartId` feeds a cart id into an Order lookup, fails permanently, and (having no
`maximumAttempts`) retries forever while the HTTP request hangs. In practice the users app's
pricing call never resolves, so orders are written with **every monetary field equal to zero**.
Layered on top: a coupon discount inversion that would charge $5 for a $50 order, a delivery fee
measured to the wrong address with degrees×111 arithmetic, four incompatible definitions of what a
line item costs, and floats used for currency.

### 4.4 The order does not faithfully record what was bought (B25, B26, B56)

`OrderFoodItems` has no variant and no add-on columns. Add-on prices charged in the cart vanish at
order creation; variant identity is lost; and two variants of the same dish violate the unique
`(order_id, food_item_id)` constraint and abort order creation outright. The restaurant is handed a
line item that is not what the customer paid for.

### 4.5 The order state machine does not govern the order (B57, B58, B31 restaurant-side)

Orders are written as `CONFIRMED` the moment a payment id exists — before the restaurant has seen
them. The tracking workflow that owns the transition table starts at `RIDER_ASSIGNED`, so the
restaurant's own CONFIRMED and PREPARING transitions can never flow through it — which is exactly
why restaurant-web has no working "mark preparing / mark ready" (R31). And `PUT /orders/:id/status`
bypasses the table entirely with an unvalidated `as any` cast and no auth.

### 4.6 Failure paths silently succeed (B40, B62, B63, B34, B36)

The saga's restaurant-rejection branch falls through to rider assignment when cancel or refund
returns false, completing checkout for a rejected order. `respondToOrder` returns success even when
the Temporal signal fails, leaving the DB and the saga permanently disagreeing. Cart failures come
back as HTTP 200 with `{success:false}`. Pricing failures hang instead of erroring. There is no
restaurant-acceptance timeout, only a 15-minute workflow expiry that surfaces as a crash. Nothing in
this system can be monitored by HTTP status code.

### 4.7 No document storage, so no KYC and no compliance (B93, B94, B95)

`FilesModule` exists but its only registration is commented out, and the env var names do not even
match compose. There is no presigned upload, no presigned download, no document-review lifecycle.
Meanwhile the *legacy* mobile path uploads restaurant licences and halal certificates to a **public**
Supabase bucket via an unauthenticated Payload CMS form (R9, R10). Both halves of the platform's
compliance story are missing or actively unsafe.

### 4.8 Transactional messaging does not exist (B84, B85, B86)

Push, email and SMS all exist as Temporal workflow shells with **no activity implementations** —
no provider, no templates, no device-token storage. This blocks OTP login (which the customer and
rider apps depend on), email verification (which restaurant onboarding depends on), order receipts,
and every partner notification that is not a live WebSocket frame.

### 4.9 Restaurants are undiscoverable to dispatch (B16, B69, B68)

`POST /restaurants` writes the legacy `location` POINT; rider assignment reads only PostGIS
`coords`. A restaurant onboarded through the normal path appears in the customer feed and prices
fine, but **every checkout for it dies at rider assignment** with "Restaurant location not found"
until someone manually calls `PUT /:id/location`. Compounding it, riders going offline are never
removed from the `riders:active` GEO pool (the `zrem` is commented out), so dispatch offers orders
to riders who are not working, and one location-writing activity swaps its lat/lng arguments.

### 4.10 No operational safety rails (B8, B9, B41, B103, B104, B107, B108)

No rate limiting, no CORS policy, no security headers. Validation is compile-time only — every
controller accepts raw JSON shaped by erased TypeScript interfaces, so every contract mismatch in
this document survives to runtime as silent data corruption. No idempotency keys, so a retried
checkout charges twice. No audit trail of admin actions. No health endpoint (the container reports
unhealthy forever). Ten Temporal workers in one process, duplicate Redis connections, duplicate
route registration, and a cache pinned to `localhost` that cannot reach Redis inside Docker.

---

### The 10 non-negotiables for taking real paid orders

| # | Capability | Why it blocks revenue |
|---|---|---|
| 1 | **Authentication + sessions** (JWT/OTP/password, all four actor types) | Every endpoint is open; there is no notion of "who is calling" |
| 2 | **Authorization + ownership checks on every resource** | Total IDOR — any caller can read or mutate any account's data |
| 3 | **Server-authoritative pricing** (cart → recomputed total, one price definition) | The client currently names its own price and orders are written with zeroes |
| 4 | **Real Stripe payment capture + webhook reconciliation** | No money is taken today; payment ids are fabricated strings |
| 5 | **Real refunds + cancellation compensation** | Every cancel-and-refund path is a TODO log; failed orders keep the customer's money |
| 6 | **Order integrity: variants + add-ons on line items** | The order does not record what the customer bought or paid for |
| 7 | **Enforced order state machine covering restaurant transitions** | Orders are CONFIRMED before acceptance; preparing/ready is unreachable |
| 8 | **Document storage with presigned upload/download + review lifecycle** | No KYC, no compliance; the legacy path publishes licences publicly |
| 9 | **Transactional email/SMS/push delivery** | Blocks OTP login, email verification, receipts and partner alerts |
| 10 | **Request validation + idempotency + rate limiting** | Malformed and replayed requests corrupt data and double-charge |
