# Halal Goes — admin-web Dashboard (apps/admin-web) — Exhaustive Analysis

Analyzed: 2026-08-09. Scope: `/home/user/halal-goes/apps/admin-web` (all source/config files; node_modules, lockfiles, binaries excluded).

## 1. Purpose & Role

`admin-web` is the internal **operations/back-office dashboard** for the Halal Goes food-delivery platform. It is a **Next.js 15.5.7 (App Router, React 19.1.2, Turbopack)** web app inside the Turborepo, running on **dev port 3003** (`next dev --turbopack --port 3003`). Admins use it to:

- Log in with email/password against the backend (`/auth/admin/login`) and manage sessions with JWT access/refresh tokens.
- Review and approve/reject/suspend/ban/reinstate **restaurant** onboarding applications (including viewing uploaded verification documents via presigned MinIO URLs).
- Review and approve/reject **rider** applications.
- View/delete platform **users**.
- View platform-wide **analytics** (dashboard KPIs).
- Create additional **admin accounts** (optionally super-admin).
- (Scaffolded but not implemented) orders management, refunds, disputes, settlements, reports, settings.

It talks **directly from the browser** to the backend API (`hg-api`) — there are **no Next.js API routes in this app** — using a bearer-token fetch client. Restaurant document images come from `minio.halalgoes.com` (whitelisted in `next.config.ts` image remotePatterns).

## 2. File Inventory

### 2.1 Root config
| File | Notes |
|---|---|
| `package.json` | name `admin-web` v0.1.0; scripts: dev (port 3003, turbopack), build (turbopack), start, lint, lint:fix, format (eslint+prettier), check-types. Deps: next 15.5.7, react/react-dom 19.1.2, @tanstack/react-query ^5.62.8, zustand ^5.0.8, zod ^4.1.12, react-hook-form ^7.64.0 + @hookform/resolvers ^5.2.2, @supabase/ssr ^0.7.0, @supabase/supabase-js ^2.79.0, Radix UI (avatar/dialog/dropdown-menu/slot/tabs), lucide-react ^0.544.0, @heroicons/react ^2.2.0, class-variance-authority, clsx, tailwind-merge, prettier (as a runtime dep — misplaced). Dev: tailwindcss ^4 (+ @tailwindcss/postcss), tw-animate-css, eslint 9 + eslint-config-next 15.5.3, typescript ~5.8.3. `installConfig.hoistingLimits: workspaces`. |
| `.env.example` | `NEXT_PUBLIC_API_URL=https://api.halalgoes.com`, `BACKEND_URL=https://api.halalgoes.com`, `NEXT_PUBLIC_BACKEND_URL=https://api.halalgoes.com`, `NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`, `GOOGLE_MAPS_API_KEY=...` |
| `next.config.ts` | Only images.remotePatterns: `https://minio.halalgoes.com/**` |
| `middleware.ts` | Delegates to `src/utils/supabase/auth/middleware.ts` `updateSession()`; matcher excludes static/image/favicon/image extensions |
| `tsconfig.json` | strict, bundler resolution, path alias `@/* -> ./src/*` (note: `components/Sidebar.tsx` lives OUTSIDE src, imported by relative path) |
| `eslint.config.mjs` | next/core-web-vitals + next/typescript; `@typescript-eslint/no-explicit-any` disabled globally |
| `components.json` | shadcn/ui, style "new-york", baseColor neutral, cssVariables true, lucide icons |
| `postcss.config.mjs` | `@tailwindcss/postcss` only (Tailwind v4, no tailwind.config file) |
| `.gitignore` | standard Next.js; `.env` ignored |
| `README.md` | untouched create-next-app boilerplate (mentions port 3000, though app runs on 3003) |
| `public/` | default create-next-app SVGs (file, globe, next, vercel, window) — all unused boilerplate |

### 2.2 Routes (App Router pages)
| Route | File | Status | Behavior |
|---|---|---|---|
| `/` | `src/app/page.tsx` | live | Client redirect: `admin.backendAdminId` present → `/restaurants`, else `/signup` |
| `/signup` | `src/app/signup/page.tsx` | live | **Actually the LOGIN page** (email+password, zod validated, min 8 char password); on success → `/restaurants` |
| `/dashboard` | `src/app/dashboard/page.tsx` | live | KPI dashboard from `GET /admin/analytics`; stats cards (users/restaurants/riders/orders/revenue), pending approvals, quick actions. Revenue formatted USD from cents |
| `/restaurants` | `src/app/restaurants/page.tsx` | live | Tabbed table (All / Pending / Approved); fetches `/admin/restaurants` + `/admin/restaurants/pending-review` in parallel; detail Sheet with document viewer (presigned URLs via `/admin/restaurants/{id}/documents/{docId}`); approve via `POST /admin/restaurants/{id}/status {action:'verify'}` |
| `/restaurants/pending` | `src/app/restaurants/pending/page.tsx` | live | List pending-review; approve (`verify`) / reject (`reject` + prompt() reason) via `/status` |
| `/restaurants/approved` | `src/app/restaurants/approved/page.tsx` | live | Filters `verification_status === 'VERIFIED'` client-side; Suspend action (`action:'suspend'`) |
| `/restaurants/rejected` | `src/app/restaurants/rejected/page.tsx` | live | Filters `verification_status === 'REJECTED'`; Reinstate action (`action:'reinstate'`) |
| `/riders` | `src/app/riders/page.tsx` | live | Tabs Inactive/Active by `is_accepting_orders`; approve via `POST /admin/riders/{id}/approve` (react-query hook) |
| `/riders/pending` | `src/app/riders/pending/page.tsx` | live | `GET /admin/riders/pending-review`; shows document upload state (drivers_license/vehicle_registration/vehicle_insurance/profile_photo); approve/reject (prompt reason) |
| `/riders/approved` | `src/app/riders/approved/page.tsx` | live | Lists all riders (no actual approved filter — comment admits it) |
| `/riders/rejected` | `src/app/riders/rejected/page.tsx` | **hollow** | Fetches `/admin/riders` then hard-sets `setRiders([])` — always shows empty ("no rejection status in the API") |
| `/users` | `src/app/users/page.tsx` | live | react-query list `GET /admin/users`; detail sheet; soft-delete `DELETE /admin/users/{id}` with body `{admin_id}`; unauthenticated redirect → `/login` (**route doesn't exist**) |
| `/admins` | `src/app/admins/page.tsx` | partial | Create admin via `POST /admin` (email/password/is_super_admin); list is **local-state only** (logged-in admin + admins created this session; no GET endpoint used). Redirect → `/login` (nonexistent) |
| `/orders` | `src/app/orders/page.tsx` | **mock-only** | Fully featured order management UI (status transitions pending→…→delivered, cancel, detail sheet w/ customer/restaurant/rider/payment/rating) driven entirely by `mockOrders` in `orders/utils.ts`; never calls the API |
| `/orders/active`, `/orders/completed` | stub | "Upcoming..." placeholder (`components/Upcoming.tsx`) |
| `/reports`, `/reports/analytics`, `/reports/sales`, `/reports/performance` | stubs | "Upcoming..." placeholder |
| `/settings` | stub | "Upcoming..." placeholder |
| `/documents/restaurant-documents` | `src/app/documents/restaurant-documents/page.tsx` | **broken legacy** | Uses legacy `adminAPI` (`/api/admin/*` relative routes that don't exist in this app) and hardcoded `http://localhost:3456/admin` fallback for admin creation |
| 404 | `src/app/not-found.tsx` | live | "Error 404" with Back Home → `/dashboard` |

Sidebar also links to `/documents` and `/documents/rider-documents`, which have **no pages** (404). Dashboard "View Reports" quick action pushes `/analytics` — also **nonexistent** (middleware even lists `/analytics` as protected).

### 2.3 Components
| File | Notes |
|---|---|
| `components/Sidebar.tsx` (outside src!) | Fixed 264px sidebar; menu: Dashboard, Riders (All/Pending/Approved/Rejected), Restaurants (same), Documents (All/Rider/Restaurant), Orders (All/Active/Completed), Reports (Analytics→/reports, Sales, Performance), Users, Admins, Settings. Expand/collapse state per group |
| `src/components/LayoutWrapper.tsx` | Hides sidebar on `/signup` and `/login`; else renders `<Sidebar/> + <main class="ml-64">` |
| `src/components/Upcoming.tsx` | Placeholder page body ("Hold on tight, we are working on it") |
| `src/components/ui/*` | 12 stock shadcn/ui (new-york) components: avatar, badge, button, card, checkbox, dialog, dropdown-menu, input, label, sheet, table, tabs — standard Radix wrappers, no customization |

## 3. API Layer (src/lib/api)

### 3.1 Client (`src/lib/api/client.ts`)
- Class `APIClient`, singleton `apiClient`. Base URL = `NEXT_PUBLIC_API_URL` || `https://api.halalgoes.com`. 30s timeout via AbortController. Default headers JSON.
- Bearer token injected from `localStorage['admin_access_token']` (loaded in constructor, i.e., only in browser).
- **401 auto-refresh**: single-flight `refreshPromise`; `POST {base}/auth/admin/refresh` with `{refreshToken}` from `localStorage['admin_refresh_token']`; on success stores both new tokens; on failure clears tokens and hard-redirects `window.location.href = '/login'` (**nonexistent route**). Retry marked with `X-Retry: true` header to avoid loops.
- Methods: get (query-param serializing incl. arrays), post, put, delete (with body), patch, `upload` (FormData POST, own 401/refresh handling, no timeout).
- Verbose emoji console.log of every request/response including parsed JSON (left in production code).
- Subtle bug: on retry, `...options.headers` is spread **after** the new `Authorization`, so a stale caller-supplied Authorization header would override the refreshed token.

### 3.2 Config (`src/lib/api/config.ts`)
`API_CONFIG.ENDPOINTS` — complete backend endpoint catalog (base `https://api.halalgoes.com`):
- AUTH: `/auth/admin/login`, `/auth/admin/refresh`, `/auth/logout`
- ADMIN: `/admin` (create), `/admin/analytics`; restaurants: `/admin/restaurants`, `/admin/restaurants/pending-review`, `/{id}/approve` (deprecated), `/{id}/reject` (deprecated), `/{id}/status`, `/{id}/documents/{docId}`; riders: `/admin/riders`, `/admin/riders/pending-review`, `/{id}/approve`, `/{id}/reject`; users: `/admin/users`, `/admin/users/{id}` (GET/DELETE); orders: `/admin/orders`; refunds: `/admin/refunds`, `/admin/refunds/{id}`, `/admin/payments/{id}/refund`, `/admin/refunds/analytics`; disputes: `/admin/disputes`, `/{id}`, `/{id}/status`, `/{id}/resolve`, `/admin/disputes/analytics`; settlements: `/admin/settlements`, `/{settlementId}`, `/{settlementId}/retry`, `/admin/settlement-config`, `/admin/settlement-config/{id}`; `/admin/transfer-audit`; email templates: `/admin/email-templates`, `/admin/email-templates/{key}`.
- `BACKEND_API_CONFIG`: `WEBSOCKET_URL` = `NEXT_PUBLIC_WEBSOCKET_URL` || `ws://localhost:9080`; `TEMPORAL_UI` = `NEXT_PUBLIC_TEMPORAL_UI` || `http://localhost:8080` — **both defined but never used anywhere**.
- `QUERY_KEYS` constant map — defined but hooks use raw string literals instead.

### 3.3 Endpoint modules (`src/lib/api/endpoints/`)
| Module | Functions | Used by UI? |
|---|---|---|
| `auth.ts` | login, refresh, logout | login duplicated by store's own fetch; logout used by store |
| `admin.ts` | createAdmin (`POST /admin` `{email,password,is_super_admin}`), getAnalytics | /admins page, useAdmin hooks |
| `analytics.ts` | getPlatformAnalytics | /dashboard |
| `restaurants.ts` | listAll, listPending, getById, approve (marked DEPRECATED), reject (DEPRECATED), updateStatus (`action: verify/reject/suspend/ban/reinstate` + reason), getDocument (presigned URL) | restaurants pages (mostly bypassed — pages call `apiClient` directly) |
| `riders.ts` | listAll, listPending, approve (returns `onboarding_url` — Stripe Connect onboarding), reject | riders pages/hooks |
| `users.ts` | listAll, getById, delete (body `{admin_id}`) | /users |
| `orders.ts` | listAll (`GET /admin/orders`, filters page/limit/sort/status/user_id/restaurant_id) | **never used** (orders UI is mock) |
| `refunds.ts` | listAll, getById, processRefund (`POST /admin/payments/{id}/refund`), getAnalytics | **no UI** |
| `disputes.ts` | listAll, getById, updateStatus, resolve (`{refund_amount?, coupon_amount?, notes}` cents), getAnalytics | **no UI** |
| `settlements.ts` | listAll, getById, retry, getConfig, createConfig, updateConfig | **no UI** |
| `index.ts` | re-exports all of the above |

### 3.4 Data models / types
- `src/lib/api/types.ts`: `Admin {id, created_at, last_modified}`; `Restaurant` (full: name, description, opening/closing_time, is_halal_certified, halal_certification_docs[], halal_certification_expiry, approved_by_admin_id, is_approved, approved_at, is_accepting_orders, is_banned, banned_reason, total_orders_processed, soft-delete fields, timestamps); `RestaurantListItem`; `Rider` (first/last name, phone+phone_verified, email+email_verified, identity_docs[], is_accepting_orders, total_earnings:string, total_orders_delivered, rating_avg:string, soft-delete, timestamps); `RiderListItem`; `PaginatedResponse<T>{items,total,limit,offset}`; `ListUsersResponse/ListRestaurantsResponse/ListRidersResponse` (success + data{…, total, limit, offset}).
- Enums (string unions): `RefundStatus` REFUND_REQUESTED/PENDING/COMPLETED/FAILED; `RefundReason` (8 values incl. DISPUTE_RESOLUTION); `DisputeStatus` OPEN/UNDER_REVIEW/RESOLVED/REJECTED; `DisputeReason` WRONG_ORDER/MISSING_ITEMS/POOR_QUALITY/LATE_DELIVERY/NEVER_DELIVERED/OTHER; `SettlementStatus` PENDING/SCHEDULED/PROCESSING/COMPLETED/FAILED. Restaurant status action: `'verify'|'reject'|'suspend'|'ban'|'reinstate'`. Backend `verification_status` values observed in pages: `VERIFIED`, `REJECTED` (else "Pending").
- Pending-review restaurant shape (from `/admin/restaurants/pending-review`): `{id, business_name, email, owner_name, submitted_at, documents:{business_license_id, halal_certificate_id, food_safety_id, owner_id_doc_id}}` — note the pending page instead types it with `restaurant_name`, phone/address/cuisine/GST fields (inconsistent duplication).
- Pending rider shape: `{rider_id, first_name, last_name, phone, vehicle_type, license_plate?, submitted_at, documents:{drivers_license_id, vehicle_registration_id, vehicle_insurance_id, profile_photo_id, *_expiry}}`.
- Legacy types in `src/utils/types/`: `IRestaurant` (flat *_url document fields, is_approved:string), `IRider` (id:number, *_url docs incl. police_verification_url, `is_approved: ApprovalStatus`), `ApprovalStatus = 'pending'|'approved'|'rejected'` — **appear unused by any page** (dead code from an older schema).
- Mock models: `src/app/orders/utils.ts` (Order/OrderItem/Customer/Rider/Restaurant/DeliveryAddress + 7 mock orders, statuses pending→cancelled, PKR/RS currency) and `src/app/restaurants/utils.ts` (mock Restaurant with documents/businessHours + 5 Pakistani mock restaurants) — used only by /orders page (restaurants/utils mock is entirely unused).

## 4. State Management & Caching

- **Zustand** `src/store/auth-store.ts` (`useAdminAuthStore`) — the *current* auth store: `{admin{id, backendAdminId, email, is_super_admin, created_at?}, isAuthenticated, isLoading, error}` + actions login/signOut/clearError/setLoading/initializeAuth. Persisted to `localStorage['admin-auth-storage']` (partialize: admin + isAuthenticated). `onRehydrateStorage` re-syncs token to apiClient and clears state if token missing. Login does its own raw `fetch` (not via authApi), stores `admin_access_token` / `admin_refresh_token` in localStorage, sets `backendAdminId = admin.id`. signOut calls `/auth/logout` (best-effort), clears tokens, redirects to `/signup`.
- **Zustand (legacy, dead)** `src/lib/admin-auth-store.ts` — an older Supabase **phone-OTP** auth store (signInWithOtp/verifyOtp type:'sms'), persists to the SAME localStorage key `admin-auth-storage` (collision hazard if ever imported). Contains **hardcoded Supabase project URL `https://fcjoexxqhequdlazybxi.supabase.co` and anon key JWT** (iat 2025-08-11, exp 2035) committed in source, plus `API_BASE` fallback `http://localhost:3456`. Calls `/api/admin/create` (nonexistent). Not imported by any page (all pages import `@/store/auth-store`).
- **Zustand (legacy)** `src/lib/admin-store.ts` (`useAdminStore`) — restaurants list cache; only used by the broken `/documents/restaurant-documents` page.
- **TanStack Query v5** via `src/lib/providers/query-provider.tsx` in root layout: `staleTime: 60_000`, `refetchOnWindowFocus: false`. Hooks in `src/lib/hooks/`: `useCreateAdmin`, `usePlatformAnalytics` (key `['platform-analytics']`), `useRestaurants` (`['restaurants', params]`), `useRestaurant`, `useApproveRestaurant` (invalidates `['restaurants']`), `useRiders` (`['riders', params]`), `useApproveRider` (invalidates `['riders']`), `useUsers` (`['users', params]`). Only riders + users + admins pages actually use react-query; restaurants/dashboard pages use manual useState/useEffect fetching.
- No websockets, no SSE, no polling — despite `WEBSOCKET_URL` config existing.

## 5. Integration Points

- **hg-api backend**: all data via REST `{NEXT_PUBLIC_API_URL || https://api.halalgoes.com}` — endpoint paths in §3.2. Browser-direct calls (CORS must be open on the API for the admin origin). Auth: `Authorization: Bearer <accessToken>` (admin JWT), refresh rotation via `/auth/admin/refresh`.
- **MinIO** (`minio.halalgoes.com`): restaurant document images rendered through `next/image` from presigned `download_url`s returned by `GET /admin/restaurants/{id}/documents/{docId}` (response `{download_url, filename, type, restaurant_id}`).
- **Stripe Connect** (indirect): rider approve response typed to include `onboarding_url`; restaurant approve description mentions "transition to Stripe onboarding".
- **Supabase**: only in dead/legacy code paths — `src/utils/supabase/auth/{client,server}.ts` create browser/server clients from `NEXT_PUBLIC_SUPABASE_URL_AUTH` / `NEXT_PUBLIC_SUPABASE_ANON_KEY_AUTH` (env names that don't match `.env.example`'s `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`); neither client is imported anywhere. The active middleware imports only `updateSession` which does no Supabase work at all.
- **Temporal**: only the unused `NEXT_PUBLIC_TEMPORAL_UI` link constant (`http://localhost:8080`).
- **Localhost backends referenced**: `http://localhost:3456` (legacy admin create, documents page + dead store), `ws://localhost:9080` (unused ws default).
- No Redis/queues/Temporal task-queue interaction from this app — it is a pure REST consumer.

## 6. Configuration & Environment Variables

| Var | Where used | Default/fallback | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | api client, auth-store login, legacy store | `https://api.halalgoes.com` (client/config, store) / `http://localhost:3456` (legacy store) | primary backend base URL |
| `BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL` | **nowhere in code** | — | dead entries in `.env.example` |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.example` only | — | mismatched: code reads `*_URL_AUTH` / `*_ANON_KEY_AUTH` variants |
| `NEXT_PUBLIC_SUPABASE_URL_AUTH` / `NEXT_PUBLIC_SUPABASE_ANON_KEY_AUTH` | supabase client/server utils (unused) | none (`!` non-null assertion) | would crash if code path ever executed without env |
| `GOOGLE_MAPS_API_KEY` | **nowhere** | — | dead `.env.example` entry |
| `NEXT_PUBLIC_WEBSOCKET_URL` | BACKEND_API_CONFIG (unused) | `ws://localhost:9080` | |
| `NEXT_PUBLIC_TEMPORAL_UI` | BACKEND_API_CONFIG (unused) | `http://localhost:8080` | |

localStorage keys: `admin_access_token`, `admin_refresh_token`, `admin-auth-storage` (zustand persist).

## 7. Auth / Security Model

- **Flow**: `/signup` (login form) → `POST /auth/admin/login {email,password}` → `{accessToken, refreshToken, admin{id,email,is_super_admin}}` → tokens in **localStorage** (XSS-exfiltratable; no httpOnly cookies), profile in persisted zustand. apiClient auto-refreshes on 401 (single-flight) and hard-logouts on refresh failure.
- **Route protection is client-side only.** `middleware.ts`→`updateSession` computes public (`/signup`,`/login`) vs protected (`/restaurants,/riders,/orders,/documents,/settings,/analytics,/dashboard,/reports`, `/`) routes but **always returns `NextResponse.next()`** — an explicit no-op ("Rely on client-side checks... Middleware just handles basic routing"). Each page does `isMounted && !isAuthenticated && !hasToken → router.replace(...)`; real enforcement is backend 401s.
- Redirect-target inconsistency: restaurants/riders/dashboard redirect to `/signup`; users/admins pages and the api client redirect to `/login`, **which has no page** → unauthenticated users on those flows land on the 404 page.
- Role model: `is_super_admin` boolean exists on the admin object and create-admin form, but the UI performs **no role gating** anywhere.
- Sensitive data logging: request/response bodies, tokens presence, admin objects logged to console throughout.
- **Committed secret**: Supabase anon key + project URL hardcoded in `src/lib/admin-auth-store.ts` (legacy but in the repo).

## 8. Code-Quality Observations

**Dead / legacy code**
- `src/lib/admin-auth-store.ts` (Supabase phone-OTP store, hardcoded creds), `src/lib/api-client.ts` (`/api/admin/*` proxy client — no such routes exist), `src/lib/admin-store.ts`, `src/utils/supabase/auth/*` (client/server unused; middleware is a no-op), `src/utils/types/*` (old flat document-URL schema), `src/app/restaurants/utils.ts` (5 detailed mock restaurants, never imported), unused `QUERY_KEYS`, unused `BACKEND_API_CONFIG`, default `public/` SVGs, boilerplate README.
- `/documents/restaurant-documents` page depends on all three legacy pieces (relative `/api/admin` routes + `http://localhost:3456/admin`) — cannot work as deployed; includes commented-out code block about `admin?.phone` not existing.

**Apparent bugs**
- Redirects to nonexistent `/login` (users page, admins page, apiClient 401 handler) and nonexistent `/analytics` (dashboard quick action); sidebar links to nonexistent `/documents` and `/documents/rider-documents`.
- `/riders/rejected` fetches data then unconditionally `setRiders([])`.
- `/restaurants` page: `filteredAllRestaurants` filters on `restaurant.name` while pending-review objects use `business_name`; `verification_status` accessed via `as any` (missing from `RestaurantListItem` type); stats card "Total Restaurants" shows filtered count, not total.
- Orders page is mock-data-only while `ordersApi.listAll` exists — the whole management UI (status transitions, revenue stats in PKR) mutates local state only.
- Currency chaos: dashboard revenue → USD (cents/100); orders mock → `RS`/`PKR`.
- `X-Retry` retry-header spread-order issue in apiClient (caller headers can clobber refreshed Authorization).
- Admins page: created-admin local list hardcodes `is_super_admin: false` even when created as super admin; list resets on reload (no GET /admin list endpoint consumed).
- Two names for the same login route concept: the login page is literally at `/signup`.
- `components/Sidebar.tsx` sits outside `src/` breaking the `@/` alias convention (imported via `../../components/Sidebar`).
- Restaurant delete flow requires `admin_id` in DELETE body — CSRF-ish pattern; user delete passes `admin.id` though backend presumably knows admin from JWT.
- `use client` pages mix paradigms: some react-query, some raw useEffect+useState fetching against the same endpoints.

**Notes / smells**
- prompt()/confirm()/alert() used for approval/rejection UX on several pages.
- Extensive emoji console logging left throughout (client.ts, stores, pages).
- `no-explicit-any` lint rule disabled; heavy `any` usage.
- `restaurantsApi.approve/reject` explicitly marked DEPRECATED in favor of `/status` action endpoint — pages correctly use `/status` (except legacy documents page which uses the old `/approve` with admin_id body).
- No tests of any kind.

## 9. Summary of runtime endpoints actually exercised by live UI
`POST /auth/admin/login`, `POST /auth/admin/refresh`, `POST /auth/logout`, `GET /admin/analytics`, `GET /admin/restaurants`, `GET /admin/restaurants/pending-review`, `POST /admin/restaurants/{id}/status` (verify/reject/suspend/reinstate), `GET /admin/restaurants/{id}/documents/{docId}`, `GET /admin/riders`, `GET /admin/riders/pending-review`, `POST /admin/riders/{id}/approve`, `POST /admin/riders/{id}/reject`, `GET /admin/users`, `DELETE /admin/users/{id}`, `POST /admin`. Everything else in the endpoint catalog (orders, refunds, disputes, settlements, transfer audit, email templates) is wired in the API layer but has no UI yet.
