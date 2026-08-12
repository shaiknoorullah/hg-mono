# Halal Goes — Restaurant Mobile App (`apps/restaurant`) + Restaurant Web (`apps/restaurant-web`)

Analysis scope: `/home/user/halal-goes/apps/restaurant` (Expo/React Native app) and `/home/user/halal-goes/apps/restaurant-web` (Next.js 15 App Router web portal). Every source/config file in scope was read.

---

## 1. Purpose & Role in the Platform

These are the two **restaurant-facing frontends** of the Halal Goes food-delivery platform:

- **`apps/restaurant` (mobile, Expo SDK 52)** — a *registration/onboarding-only* app. A restaurant owner authenticates via phone OTP (Supabase), fills a 4-step registration wizard (basic info → business details → menu & operations → document uploads), uploads images to a Supabase Storage bucket, and submits the collected data to a **Payload CMS form endpoint** (`https://halalgoes.com/api/form-submissions`, form id `4`). After submission the app permanently shows an "In Review" screen. There is **no order management, no menu management, no dashboard** in the mobile app — it is purely a lead-capture / KYC funnel. Notably, it does **not** talk to the `hg-api` backend at all (except indirectly via the shared `@halal-goes/auth` package, whose axios-based OTP endpoints it does not actually use — see §8).

- **`apps/restaurant-web` (web, Next.js 15.5.7 / React 19)** — the *operational restaurant portal*. It implements a much newer and completely different onboarding flow against the **hg-api backend** (`https://api.halalgoes.com`): email/password registration → email verification → 3-step onboarding (profile, 4 KYC documents via S3/MinIO presigned URLs, Stripe Connect) → dashboard. Post-onboarding it provides live **order management** (accept/reject with countdown dialog, rider-assignment progress via WebSocket), **menu-item CRUD** (with presigned-URL image upload), and stub pages for categories (mock data), payments, and disputes.

The two apps represent **two generations of the restaurant onboarding product**: the mobile app is the older Payload-CMS/Supabase generation (Canada +1 UI, India-style GST/FSSAI fields); restaurant-web is the current hg-api generation (Malaysia-default addresses, Stripe Connect, backend state machine `REGISTERED → EMAIL_VERIFIED → PROFILE_PENDING → DOCUMENTS_PENDING → DOCUMENTS_REVIEW → STRIPE_PENDING → ACTIVE/COMPLETED`).

---

## 2. Restaurant Mobile App (`/home/user/halal-goes/apps/restaurant`)

### 2.1 Tech stack & configuration

| Item | Value |
|---|---|
| Framework | Expo `~52.0.47`, React Native `0.76.9`, React `18.3.1`, `newArchEnabled: true` |
| Routing | `expo-router ~4.0.21` (file-based, entry `expo-router/entry`) |
| Styling | NativeWind `~4.1.23` + Tailwind 3 preset from `@halal-goes/tailwind-config`; custom colors `primary #045D56`, `secondary #34A853`, `background #F1FFE7`, `lightGreen #EDFDD5` (largely unused — screens hardcode orange `#FF6B35`/`bg-orange-500` and green `#1B4D3E`) |
| State | Zustand 5 (4 stores + 1 leftover demo store) |
| Forms | react-hook-form 7 + zod 4 (`@hookform/resolvers`) |
| Auth | Supabase (`@supabase/supabase-js ^2.55`) phone OTP via shared `@halal-goes/auth` workspace package; sessions in `expo-secure-store` |
| Maps | `react-native-maps 1.18.0` (PROVIDER_GOOGLE) + `@react-native-community/geolocation` |
| App identity | name "HalalGoes Restaurant", slug `restaurant`, scheme `restaurant-app`, iOS/Android id `com.aaqeb11.restaurant`, EAS projectId `f6095101-5a02-4a1d-b07d-ade80a7bf18d` |
| Android permissions | FINE/COARSE location, CAMERA, RECORD_AUDIO |
| EAS | dev (dev-client, internal), preview (internal), production; `appVersionSource: remote`, autoIncrement everywhere |
| Tests | jest-expo preset; single boilerplate snapshot test `components/__tests__/ThemedText-test.tsx` |

**Env vars (`.env.example`)**
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `EXPO_PUBLIC_SUPABASE_URL` — Supabase auth+storage project
- `EXPO_PUBLIC_FORM_ID = 4` — Payload CMS form id (but the service **hardcodes `form: '4'`** in the POST body and only uses the env var for a member that is otherwise unused)
- `EXPO_PUBLIC_PAYLOD_URL = https://halalgoes.com` (typo "PAYLOD") — Payload CMS base URL, default fallback `https://halalgoes.com`
- `GOOGLE_MAPS_API_KEY` — referenced in `app.json` as the **literal string** `"process.env.GOOGLE_MAPS_API_KEY"`, which is *not* interpolated in a static `app.json` (bug: Android Google Maps key never actually injected; would need `app.config.js`).

### 2.2 Screen/route inventory (expo-router)

| Route | File | Purpose |
|---|---|---|
| `/` | `app/index.tsx` | Animated splash (3s scale animation of `SplashImage.png`); routes by auth + `SubmissionStateManager.hasUserSubmitted()` → `/InReviewDocs`, `/GetRestaurantInfoScreens`, or `/inputNo` |
| `/inputNo` | `app/inputNo.tsx` | Phone entry; Canada flag + fixed `+1`; 10-digit validation; sends OTP via authStore; **decorative** Apple/Google/Facebook buttons (no handlers) |
| `/inputOtp` | `app/inputOtp.tsx` | 4-digit OTP entry (paste-aware, auto-advance, backspace nav); verifies via authStore; routes to InReviewDocs or wizard |
| `/InReviewDocs` | `app/InReviewDocs.tsx` | Terminal "We're Reviewing Your Documents" screen; double-back-press-to-exit (2s window, ToastAndroid/Alert) |
| `/GetRestaurantInfoScreens` | `.../index.tsx` | "Let's Get You Set Up" — start registration or logout ("Change phone number") |
| `.../basicInfo` | `basicInfo.tsx` | Step 1 (ProgressBar step 0): restaurantName, ownerName, email (zod `basicInfoSchema`) |
| `.../businessInfo` | `businessInfo.tsx` | Step 2: address (lat/lng string from map), businessRegistrationNumber, optional GST (Indian 15-char GST regex), FSSAI/Halal certificate photo (gallery/camera, quality 0.8) |
| `.../MapPickerScreen` | `MapPickerScreen.tsx` | Google map, geolocation autolocate (`enableHighAccuracy`, timeout 15s, maxAge 10s), tap-to-pick; writes to `useBusinessFormStore` (default center **Dubai 25.2048, 55.2708**) |
| `.../menuOperations` | `menuOperations.tsx` | Step 3: cuisineType (modal, 16 options ending "Other"), operating hours via twin `TimePicker`s (hours 1-12, minutes 00/15/30/45, AM/PM), avgPreparationTime (regex `^[0-9]+\s*(minutes?|mins?|hours?|hrs?)$`) |
| `.../certificateUpload` | `certificateUpload.tsx` | Alternate certificate-picker screen (gallery/camera/options) → `confirmPhoto`; **orphaned** — nothing routes to it (businessInfo has its own inline upload) |
| `.../confirmPhoto` | `confirmPhoto.tsx` | Certificate photo review; Done → `businessInfo` (only reachable from orphaned certificateUpload) |
| `.../uploadDocScreens` (index) | `uploadDocScreens/index.tsx` | Step 4: 4-document checklist with animated per-doc progress bars; Submit → `useRestaurantSubmission.submitToPayload()`; on success stores submission state in SecureStore and replaces to `/InReviewDocs` |
| `.../uploadDocScreens/foodLicense` | thin wrapper over `BaseRestaurantDocumentScreen` (`documentType='food-license'`) |
| `.../uploadDocScreens/restaurantLogo` | same, `restaurant-logo` |
| `.../uploadDocScreens/sampleMenu` | same, `sample-menu` |
| `.../uploadDocScreens/kitchenPhotos` | `kitchenPhotos.tsx` | Multi-photo (1–10) grid with remove; zod `kitchenPhotosSchema` |
| `+not-found` | boilerplate 404 |

Auth guard: `app/_layout.tsx` runs `checkAuthStatus()` once, then redirects unauthenticated users out of `GetRestaurantInfoScreens`/`InReviewDocs` to `/inputNo`. (`segments` appears twice in the effect dep array — harmless dup.)

### 2.3 State management (Zustand stores)

| Store | File | Shape / notes |
|---|---|---|
| `authStore` (default export) | `store/auth/useAuthStore.tsx` → re-export of `lib/auth.ts` → `createAppAuth()` from **`@halal-goes/auth`** | `{isAuthenticated, userPhone, user, session, isLoading}` + `checkAuthStatus/sendOtp/verifyOtp/logout`. Phone formatted via shared `formatPhoneNumber` with `DEFAULT_AUTH_CONFIG.defaultCountryCode = '+91'` — **the UI shows +1 (Canada) but OTPs are actually sent to +91-prefixed numbers** unless env overrides (it doesn't; constant is hardcoded in the package). |
| `useRestaurantStore` | `store/useRestaurantStore.ts` | `RestaurantData` = {restaurantName, ownerName, email, address, businessRegistrationNumber, gstNumber, halalCertificate{uri,fileName,isUploaded}, cuisineType, operatingHours, avgPreparationTime, documentsUploaded} + `currentStep` (1–5); update helpers per wizard step; `getEffectiveCurrentStep()` bumps 4→5 when docs done. Not persisted — app kill loses wizard progress (only *submission completed* flag persists). |
| `useRestaurantDocsStore` | `store/useRestaurantDocsStore.ts` | `documents: DocumentItem[]` — fixed 4 docs (`food-license`, `restaurant-logo`, `sample-menu`, `kitchen-photos`) with `status: 'pending'|'uploaded'|'verified'`, `photoUri`, `photos[]` for kitchen, `uploadedAt`, icon/color config; `getCompletedCount`, `isAllDocumentsUploaded`, add/removeKitchenPhoto. |
| `useBusinessFormStore` | `store/useBusinessFormStore.ts` | Map coords `{latitude, longitude, latitudeDelta, longitudeDelta}` (default Dubai), `businessRegNo`, `gstNumber`, `isLocationSelected`; contains commented-out `RestaurantData` interface (dead). |
| `useStore` | `useStore.js` (repo root of app) | **Dead code** — counter demo store, imported nowhere. |

Persistence: `utils/submissionState.ts` (`SubmissionStateManager`) writes `restaurant_submission_status` JSON (`{hasSubmitted, submissionId, submittedAt}`) to **expo-secure-store**; `utils/storage.ts` re-exports `authStorage` from `@halal-goes/auth`.

### 2.4 Submission pipeline (the app's only backend integration)

`hooks/useRestaurantSubmission.ts` merges both stores into `RestaurantFormData` and calls `services/payloadFormService.ts` (`PayloadFormService` singleton):

1. **Image upload** — each image (`halalCertificate`, per-document `photoUri`, each kitchen photo) is `fetch()`ed from its local URI, converted to ArrayBuffer, and uploaded to **Supabase Storage bucket `restaurant-documents`** at path `uploads/${Date.now()}_${fileName}` with `contentType: 'image/jpeg'` (hardcoded), `upsert: true`; the **public URL** is retained.
2. **Form submission** — `POST {EXPO_PUBLIC_PAYLOD_URL}/api/form-submissions` with body `{form: '4', submissionData: [{field, value}, ...]}` mapping: restaurantName, ownerName, email, address, businessRegistrationNumber, gstNumber, cuisineType, operatingHours, avgPreparationTime, halalCertificate, foodLicense, restaurantLogo, sampleMenu, kitchenPhoto1..kitchenPhoto10. **No auth headers** — the Payload form endpoint is called anonymously.
3. Result parsed for `doc.id` / `id`; success stored via SubmissionStateManager (called with literal `'submitted'` as the "submissionId" from the screen, discarding the real id).

**Bugs in `submitRestaurantForm`:**
- `imageUrls.kitchenPhotos[0]`… will **throw** if `kitchenPhotos` is undefined (it's typed `string | string[]` and indexed without a guard — TS is silenced by loose typing; kitchen photos are mandatory in UI so it "works" only on the happy path).
- `kitchenPhoto10` reads `imageUrls.kitchenPhoto10` (nonexistent key) instead of `imageUrls.kitchenPhotos[9]` — 10th photo is always sent as `''`.
- `uploadImage`'s `onProgress` param is never used; per-file 1MB limit advertised in the UI ("JPG, JPEG, PNG less than 1MB") is **never enforced** (`validateFileSize` exists in `utils/documentUtils.ts` but is uncalled).

### 2.5 Validation schemas (`schema/`)

- `PhoneOtpValidation.ts` — 10-digit phone (transform strips non-digits), 4× single-digit OTP; helpers `validatePhoneNumber`, `validateOtp`, `formatPhoneForDisplay` ("(xxx) xxx-xxxx"), `formatPhoneForAPI` (prefixes `+1` — unused; the store's +91 formatter wins).
- `RestaurantValidation.ts` — basicInfo (name regexes, email), businessInfo (address required; regNo 5–50 chars `[A-Za-z0-9-/]`, uppercased; optional GST with full Indian GSTIN regex `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$`), menuOperations (operatingHours regex `H:MM AM - H:MM PM`, avgPreparationTime).
- `documentValidation.ts` — `documentUploadSchema` (photoUri must start `file://`/`content://`/`http`), `kitchenPhotosSchema` (1–10 photos), plus two schemas (`documentValidationSchema`, `uploadDocumentsSchema`) that are **defined but never imported** (dead).

### 2.6 Shared components & utils

- `components/restaurant-docs/BaseRestaurantDocumentScreen.tsx` — generic capture screen with 3 states (`instructions` / `confirmation` / `retake-prompt`, retake driven by `isRetake` route param); `DOCUMENT_KEY_MAP` maps camelCase and kebab-case ids; fallback config with `console.warn` for unknown types.
- `components/restaurant-docs/common.tsx` — `DocumentHeader`, `DocumentPreview`, `DocumentInstructions`, `ActionButtons`, and `RESTAURANT_DOCUMENT_CONFIGS` (title/instructions/icon/bg per doc type).
- `CuisineModal` (16 cuisines from `utils/restaurantUtils.ts` — note *no Halal-specific options*, unlike restaurant-web's list), `TimePicker`, `ProgressBar` (4 segments).
- Expo-template leftovers (**dead code in an onboarding-only app**): `Collapsible`, `ExternalLink`, `HapticTab`, `HelloWave`, `ParallaxScrollView`, `ThemedText/ThemedView`, `ui/IconSymbol*`, `ui/TabBarBackground*`, `constants/Colors.ts`, `hooks/useColorScheme*`, `useThemeColor`.
- `utils/inputOtp.ts` and `utils/inputUtitls.ts` (typo'd filename) — **near-duplicate** hook modules; `inputOtp.ts` contains an entire parallel unused OTP flow (`useOtpScreen.handleVerify` navigates even on empty OTP as "Default fallback -> go to rider-home" — copy-pasted from the rider app) and `usePhoneAuth` (unused).
- `utils/documentUtils.ts` — URI/type validators; `validateImageFile`, `validateFileSize`, `validatePhotoCount` unused.

### 2.7 The shared `@halal-goes/auth` package (context)

`lib/auth.ts` calls `createAppAuth()` → `createAuth({supabaseUrl, supabaseAnonKey, config: DEFAULT_AUTH_CONFIG})`. Key facts:
- `DEFAULT_AUTH_CONFIG = { defaultCountryCode: '+91', phoneNumberLength: 10 }`.
- The package also contains axios API clients hitting `${EXPO_PUBLIC_BASE_API_URL}/auth/otp/request` etc. for `user`/`rider` types (the hg-api backend), but the **store used by this app** goes through the Supabase-native `verifyOtp(phone, token, type:'sms')` path.
- `lib/supabase.ts` (app-local duplicate client, used only by `payloadFormService` and `services/authService.ts`): SecureStore-backed session storage on native, `autoRefreshToken`, `persistSession`, `processLock`, and AppState listener to start/stop auto-refresh. So the app instantiates **two Supabase clients** (one via the package, one local).
- `services/authService.ts` builds a second `createAuthService({supabase})` that is **never imported by any screen** (dead).

---

## 3. Restaurant Web (`/home/user/halal-goes/apps/restaurant-web`)

### 3.1 Tech stack & configuration

| Item | Value |
|---|---|
| Framework | Next.js `15.5.7` (App Router, `--turbopack` dev+build), React `19.1.2`, `reactStrictMode: false` |
| UI | Tailwind CSS v4 (`@tailwindcss/postcss`), shadcn/ui "new-york" (16 `src/components/ui/*` primitives: avatar, badge, button, card, checkbox, dialog, dropdown-menu, input, label, select, separator, sheet, switch, table, textarea), lucide-react, heroicons, `tw-animate-css`, oklch theme tokens w/ dark variant, Geist fonts |
| Data | TanStack Query 5 (configured `query-client.ts`: staleTime 5m, gcTime 30m, no retry on 4xx, ≤3 retries otherwise, `refetchOnWindowFocus: false` — **but a QueryClientProvider is never mounted in `layout.tsx`**, so `use-menu-items.ts` hooks are unusable/dead), Zustand 5 with `persist` |
| Charts | recharts 3 (dashboard) |
| Maps | Google Maps JS API (onboarding) + leaflet 1.9.4/OSM (`LocationPicker`, unused) |
| Server deps | `@temporalio/client 1.13.1`, `pg 8.16.3` (pg is **never imported** — dead dependency) |
| Lint | eslint 9 flat config; `@typescript-eslint/no-explicit-any` disabled |

**Env vars (`.env.example`)**

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL=http://98.130.76.223:3456` | hg-api base (example points to a raw **public IP**; the code actually hardcodes `https://api.halalgoes.com` and never reads this var) |
| `NEXT_PUBLIC_WEBSOCKET_URL=ws://98.130.76.223:9080` | hg-api notifications gateway (port 9080 — matches `notifications.gateway.ts` in hg-api); **used** by `useWebSocketStore` |
| `NEXT_PUBLIC_TEMPORAL_UI=http://98.130.76.223:8080` | Temporal UI (unused in code) |
| `TEMPORAL_ADDRESS` (default `localhost:7233`) | used by `src/lib/temporal.ts` (dead module) |
| `NEXT_PUBLIC_SUPABASE_URL_AUTH` / `NEXT_PUBLIC_SUPABASE_ANON_KEY_AUTH` | Supabase "auth" project (`utils/supabase/auth/*` — client/server helpers exist but are unused; middleware does cookie checks only) |
| `NEXT_PUBLIC_SUPABASE_REGISTRATION_URL` / `..._ANON_KEY` | second Supabase project for storage (`utils/supabase/storage/*` — unused) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | third pair, referenced by nothing found |
| `EXPO_PUBLIC_FORM_ID = 5` / `EXPO_PUBLIC_PAYLOD_URL` | leftover from the old Payload flow (form id **5** here vs **4** in mobile) — unused |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_API_KEY` | defined but the onboarding page **hardcodes** the key instead (see §5) |

### 3.2 Route inventory

| Route | File | Status | Purpose |
|---|---|---|---|
| `/` | `app/page.tsx` | live | `redirect('/dashboard')` |
| `/signup` | `app/signup/page.tsx` | live | Register: businessName/email/password (12+ chars, upper+lower+digit) + confirm + terms; `POST /auth/restaurant/register` with `terms_version: '1.0.0'`; success → "Check Your Email" panel |
| `/verify-email?token=` | `app/verify-email/page.tsx` | live | Auto `POST /auth/restaurant/verify-email`; stores tokens; routes by `onboarding_state` |
| `/login` | `app/login/page.tsx` | live | `POST /auth/restaurant/login`; routes: COMPLETED/100% → `/dashboard`, DOCUMENTS_REVIEW → `/onboarding/pending-approval`, else `/onboarding?step=1` |
| `/onboarding` | `app/onboarding/page.tsx` (1278 lines) | live | 3-step wizard (Profile / Documents / Stripe) — see §3.4 |
| `/onboarding/pending-approval` | `pending-approval/page.tsx` | live | Polls `GET /auth/onboarding/restaurants/status` every 10s; COMPLETED → dashboard, STRIPE_PENDING → step 3 |
| `/onboarding/stripe/complete` | `stripe/complete/page.tsx` | live | Stripe return URL; waits ≤5s for zustand hydration, refreshes tokens, checks stripe status (`details_submitted && charges_enabled` = can accept payments); note error path redirects to `/auth/login?...` — a **route that doesn't exist** (should be `/login`) |
| `/onboarding/stripe/refresh` | `stripe/refresh/page.tsx` | live | Stripe refresh URL; auto-creates a new Connect session and redirects |
| `/dashboard` | `app/dashboard/page.tsx` | **mock** | Entirely hardcoded recharts demo ("Hello Orlando", $215,860 revenue, fake categories/orders/trending) — no API calls except redirect-if-no-restaurantId |
| `/orders` | `app/orders/page.tsx` | live | Order list + accepting-orders toggle + WebSocket + `OrderNotificationDialog` — see §3.5 |
| `/orders/[id]` | `app/orders/[id]/page.tsx` | live | Order detail with rider-search progress checklist driven by WS statuses |
| `/menu-items` | `app/menu-items/page.tsx` (849 lines) | live | Menu CRUD; auto-creates "Main Menu" if none; 3-step presigned image upload; `fixImageUrl()` hack strips `:0` ports from malformed backend URLs |
| `/categories` | `app/categories/page.tsx` | **mock** | Local-state CRUD over `src/data/data.ts` fixtures; backend fetch code is commented out inside `categorySheet.tsx` (`/api/categories`) |
| `/payments`, `/disputes` | stub | "Upcoming..." placeholder (`Upcoming.tsx`) |
| `/docSubmit` | `app/docSubmit/page.tsx` | legacy | Old "under review" page w/ logout; still protected in middleware |
| `not-found` | boilerplate 404 ("ErrorSection7") |

`LayoutWrapper` hides the fixed 264px `RestaurantSidebar` on `/signup`, `/login`, `/onboarding*`. Sidebar nav: Dashboard, Menu Management (Categories, Menu Items), Order Management, Payments & Transactions, Escalations & Disputes.

### 3.3 API layer (`src/lib/api/`)

- **`config.ts`** — `BASE_URL: 'https://api.halalgoes.com'` (hardcoded; not env-driven). Endpoint map: auth (`/auth/restaurant/{register,login,verify-email,refresh}`), onboarding (`/auth/onboarding/restaurants/{status,profile,documents/upload-url,documents/confirm,documents/submit,documents,stripe/connect,stripe/status}`), plus `/api/{users,restaurants/,riders,carts,feed,payments,pricing,orders,menu-items}`. `TIMEOUT: 30000`. `QUERY_KEYS` for TanStack.
- **`client.ts`** — hand-rolled `APIClient` singleton over `fetch`: AbortController timeout; `credentials: 'include'`; automatic **401 → token refresh → single retry** with a singleton refresh promise; refresh via injected callback or direct `POST /auth/restaurant/refresh` reading `refreshToken` out of `localStorage['auth-store']`; auth-failure callback → signOut + redirect `/login`. `setAuthToken` mutates default headers with `Authorization: Bearer`. Methods: get (query-param builder incl. arrays), post/put/patch/delete, `upload` (multipart, no auth-refresh logic).
- **`endpoints/index.ts`** — typed endpoint groups: `authEndpoints`, `userEndpoints`, `restaurantEndpoints` (create/getById/update/getMenu/addMenuItems/updateMenuItem/toggleAcceptingOrders/getOrders/getStats), `cartEndpoints`, `feedEndpoints`, `paymentEndpoints`, `pricingEndpoints`, `riderEndpoints`, `onboardingEndpoints`. Many of these (carts, feed, payments, pricing, riders, users) are **imported nowhere in this app** — the module doubles as a platform-wide API SDK copy. Note `RESTAURANTS: '/api/restaurants/'` has a trailing slash producing double-slash URLs like `/api/restaurants//${id}` in the typed endpoints (pages avoid this by building URLs by hand).
- **`types/index.ts`** (589 lines) — full platform DTOs: `BaseEntity` (soft-delete fields), Restaurant/RestaurantAddress/RestaurantMenu/MenuItem (+ `MenuItemVariant` `SIZE|QUANTITY`, `MenuItemAddon`), Cart/CartFoodItem/CartCoupon, PricingResponse (item_total/delivery_fee/platform_fee/discount_amount/amount_to_pay), Payment (`PENDING|COMPLETED|FAILED|CANCELLED`; methods `CREDIT_CARD|DEBIT_CARD|UPI|WALLET|CASH_ON_DELIVERY`), Feed responses, Rider, and the entire onboarding contract (states, document types `business_license|halal_certificate|food_safety|owner_id`, presigned upload req/resp, Stripe connect/status).
- **`menu-items.ts` + `use-menu-items.ts`** — TanStack wrappers around the typed endpoints (query key `[RESTAURANTS, id, 'menu-items']`); **dead** (menu-items page uses `apiClient` directly, and no QueryClientProvider exists).

### 3.4 Onboarding flow (against hg-api)

`onboarding/page.tsx` + `onboarding-store.ts`:

1. **Profile (step 1)** — zod `profileSchema` (first/last name, phone ≥10, description ≥20, HH:MM times, address fields, lat∈[-90,90], lng∈[-180,180]); defaults country `MY`, coords **Kuala Lumpur 3.1478, 101.7128**; Google-Maps modal with draggable marker (script injected with **hardcoded API key `AIzaSyD614SHSgC6FnrGsIj00_8SZJF5WznveSU`** — committed secret); `POST .../profile` → state `DOCUMENTS_PENDING`.
2. **Documents (step 2)** — 4 required docs; per-file ≤10MB, `image/*,.pdf`; upload via `restaurantDocumentService.uploadDocument`: `POST .../documents/upload-url` → `PUT` file to S3/MinIO presigned URL → `POST .../documents/confirm` (with size_bytes); then `POST .../documents/submit` with the four `*_id`s → state `DOCUMENTS_REVIEW`.
3. **Stripe (step 3)** — banner while under review; once `steps_completed.documents_approved`, `POST .../stripe/connect` `{refresh_url: origin+'/onboarding/stripe/refresh', return_url: origin+'/onboarding/stripe/complete'}` → redirect to Stripe onboarding URL; status via `GET .../stripe/status`. On `stripe_complete` → `router.push('/menu-items')`.

`onboarding-store` maps backend states to steps (`getStepFromStatus`), persists `{currentStep, profileData, uploadedDocuments}` in localStorage `onboarding-store`. Each mutating call re-injects the token via `ensureAuthToken()` (re-reads localStorage `auth-store` — a workaround for the apiClient singleton losing headers across reloads).

A dev-only debug panel prints backend state/progress (`NODE_ENV === 'development'`).

### 3.5 Order management & real-time (WebSocket)

- **`useWebSocketStore`** (`store/useWebSocketStore.ts`): raw `WebSocket` to `NEXT_PUBLIC_WEBSOCKET_URL`; global dedupe via `window.__wsConnection`; on open sends `{event: 'connect_user', data: {userId: restaurantId, userType: 'restaurant'}}`; handles server `notification`/`CHANNEL_JOIN` instructions by sending `{event: 'join_channel', data: {channelName, userId, userType: 'restaurant'}}`; module-level `subscribers` Set fan-out; `joinedChannels` Set (note: mutated in place, not via `set()`, so not reactive; `leaveChannel` never sends a message to the server). **No automatic reconnect on close** (only lazy reconnect on send-failure). Extremely chatty console logging.
- **`useRestaurantOrderWebSocket`** (`hooks/orderWebSocket.ts`): consumes messages; events: `order_request` (`type: 'order_request'` → order payload incl. orderNumber/customerName/totalAmount/items/deliveryAddress/estimatedPrepTime/orderDetails/checkoutId + `expiresAt`; `type: 'CHANNEL_JOIN'` → joins `order:{orderId}` channel) and `order_update` with types: ASSIGNMENT_STARTED, SEARCHING_RIDERS (radius), RIDERS_FOUND (ridersCount), NO_RIDERS_FOUND, NOTIFICATION_WORKFLOW_STARTED, NOTIFICATIONS_SENT (ridersNotified), RIDER_ACCEPTING, RIDER_ASSIGNED (riderId), CONFIRMED/RESTAURANT_ACCEPTED, PREPARING, READY_FOR_PICKUP, PICKED_UP, ON_THE_WAY, DELIVERED, REJECTED/RESTAURANT_REJECTED, CANCELED/ORDER_CANCELED/CANCELLED, FAILED. Maintains `activeOrders` Map.
- **Orders page** — REST calls built by string interpolation: `GET /api/restaurants/{id}/orders`, `GET /api/restaurants/{id}` (reads `is_accepting_orders`), `PUT /api/restaurants/{id}/toggle-accepting {is_accepting}`, `PUT /api/restaurants/{id}/orders/{orderId}?action=accept|reject`, and a **relative** `PUT /api/restaurants/{id}/location` via raw `fetch` (hits the *Next.js origin*, where no such API route exists → always fails silently; also `useEffect` dep array omits lat/lng). New order → `OrderNotificationDialog` with countdown to `expiresAt` (default now+60s) that **auto-rejects on expiry** and on dialog close. Accept waits 1.5s "for WebSocket updates" before navigating to `/orders/{id}`.
- **Order detail page** — joins `order:{orderId}` channel; renders rider-search progress checklist; `updateStatus()` helper (`PUT /api/orders/{id}/status`) is defined but no UI button calls it (auto-progression is backend-driven).
- **`src/lib/temporal.ts`** — server-side Temporal client (`TEMPORAL_ADDRESS`, namespace `default`): `isWorkflowRunning`, `findWorkflowForOrder` (tries `checkout_{checkoutId}`, `order-tracking-{orderId}`, then lists `WorkflowType='initiateCheckoutWorkflow' AND ExecutionStatus='Running'` and **greps fetched workflow histories for the orderId** — expensive brute force), `signalTemporalWorkflow`. **Dead code**: imported nowhere, and there are no server routes/actions in this app to host it. It documents the platform's Temporal workflow-id conventions though.

### 3.6 Auth model (restaurant-web)

- Backend-issued JWTs: access (1h) + refresh (7d) from hg-api restaurant auth.
- **Triple storage**: zustand-persist localStorage `auth-store` (user, both tokens, restaurantId), cookies (`access_token` max-age 3600, `refresh_token` 604800, `restaurant_id` 31536000; `SameSite=Lax`, **no Secure/HttpOnly — JS-set, XSS-readable**), plus bare localStorage `restaurant_id`.
- `middleware.ts` → `utils/supabase/auth/middleware.ts` `updateSession`: despite the name, no Supabase — pure cookie gate. Public: `/login,/signup,/verify-email`; auth-only: `/onboarding`; auth+restaurant_id: `/`, `/dashboard,/restaurant,/settings,/docSubmit,/menu-items,/categories,/orders`. Redirect rules to `/login`, `/onboarding?step=1`, `/dashboard`. **`/payments` and `/disputes` are not in any protected list** (accessible unauthenticated, though they're stubs).
- On zustand rehydrate: re-inject Bearer token, register refresh + auth-failure callbacks on apiClient.
- Middleware trusts the presence of a cookie without verification (no signature check client-side — fine, backend verifies, but the gate itself is spoofable for page access).

### 3.7 Mock/demo data

- `src/data/data.ts` (595 lines): 10 categories + 15 menu items fixtures. Several category UUIDs are **invalid hex** (contain letters g–k, e.g. `d9876db2-gbga-...`).
- `src/data/orderData.ts` (608 lines): full mock order graph (orders, users, riders, payments, `generateMoreOrders()`, `getOrderStats()`); its `Order.order_status` enum (`PENDING/.../OUT_FOR_DELIVERY`) differs from the live pages' status vocabulary (`PLACED/.../ON_THE_WAY`). Used only by mock categories page + unused `orderSheet`.

---

## 4. Integration points summary (both apps)

| From | Protocol | Target | Detail |
|---|---|---|---|
| mobile | Supabase JS | `EXPO_PUBLIC_SUPABASE_URL` | phone OTP auth (SMS), session in SecureStore |
| mobile | Supabase Storage | bucket `restaurant-documents` | public-URL image uploads `uploads/{ts}_{name}` |
| mobile | HTTPS POST | `{EXPO_PUBLIC_PAYLOD_URL}/api/form-submissions` | Payload CMS form `'4'`, unauthenticated |
| web | HTTPS | `https://api.halalgoes.com` (hardcoded) | all auth/onboarding/orders/menu REST |
| web | HTTPS PUT | S3/MinIO presigned URLs (from hg-api) | onboarding docs + menu-item images |
| web | WebSocket | `NEXT_PUBLIC_WEBSOCKET_URL` (ws://…:9080) | hg-api notifications gateway; events `connect_user`, `join_channel`; channels `order:{orderId}`; userType `restaurant` |
| web | HTTPS redirect | Stripe Connect onboarding URL | refresh/return URLs on own origin |
| web (dead) | gRPC | `TEMPORAL_ADDRESS` | Temporal workflows `checkout_{checkoutId}`, `order-tracking-{orderId}`, type `initiateCheckoutWorkflow` |
| web (dead) | HTTPS | nominatim.openstreetmap.org | geocode.ts (User-Agent `HalalGoes-Restaurant-App/1.0`, `countrycodes=in`, Hyderabad fallback) |

---

## 5. Security findings

1. **Committed Google Maps API key** — `GOOGLE_MAPS_API_KEY = 'AIzaSyD614SHSgC6FnrGsIj00_8SZJF5WznveSU'` hardcoded in `restaurant-web/src/app/onboarding/page.tsx:38` (env var exists but is ignored).
2. **Tokens in localStorage + non-HttpOnly cookies** (restaurant-web) — access/refresh JWTs readable by any XSS; refresh token also duplicated in cookie.
3. **Unauthenticated Payload form endpoint** (mobile) — anyone can POST arbitrary registrations to `https://halalgoes.com/api/form-submissions` form 4; uploaded docs land in a **public** Supabase bucket (public URLs for KYC documents: licenses, certificates).
4. **Example env leaks infra IP** — `98.130.76.223` (API :3456, WS :9080, Temporal UI :8080) in `.env.example`.
5. Middleware gate is cookie-presence-only; `/payments` & `/disputes` unprotected (stubs).
6. Massive `console.log` surface in production paths (tokens not logged, but full order/customer payloads and auth-state transitions are).

## 6. Bug-level findings

**Mobile**
- Country-code mismatch: UI advertises **+1** while shared auth formats to **+91** (`DEFAULT_AUTH_CONFIG`), so OTP delivery for Canadian numbers is broken unless Supabase-side config compensates.
- `app.json` Google Maps key is the literal string `"process.env.GOOGLE_MAPS_API_KEY"` (never interpolated).
- `kitchenPhoto10` field bug + potential crash on undefined `imageUrls.kitchenPhotos` (§2.4).
- 1MB file-size limit advertised, never enforced; content-type always `image/jpeg` even for PNGs.
- Submission stores literal string `'submitted'` instead of the real submission id.
- `certificateUpload`/`confirmPhoto` orphaned route pair; duplicated permission/picker code across 4 files.

**Web**
- `PUT /api/restaurants/{id}/location` uses relative fetch to the Next origin (no such route) → location never updates; effect deps missing lat/lng.
- `menu-items` page calls `/restaurants/...` paths (no `/api` prefix) while orders pages call `/api/restaurants/...` — if only one prefix is correct on the backend, one page's endpoints 404 (`createNewMenu` posts to `/restaurants/menus`).
- Stripe complete page error-redirects to nonexistent `/auth/login`.
- QueryClient configured but no provider mounted; entire TanStack layer dead.
- `fixImageUrl` hack indicates backend returns malformed image URLs (`host:0/path`).
- WebSocket: no reconnect-on-close; `joinedChannels` non-reactive; `leaveChannel` never informs server; auto-reject on dialog dismiss may reject an order the user merely closed accidentally.
- `API_CONFIG.BASE_URL` hardcoded → `NEXT_PUBLIC_API_BASE_URL` env is dead.
- Trailing slash in `RESTAURANTS` endpoint → `//` in typed-endpoint URLs.
- Dashboard & categories are 100% mock data presented as real UI.
- MenuItemSheet hardcodes `menu_id: '0ba343f1-4ace-400f-9296-88ee6c197370'` (dead component, but a real-looking UUID fixture).
- README states password rule "12+ chars, uppercase+lowercase+number" and cookie/token lifetimes — matches code; README documents the whole flow accurately (best doc in the area).

## 7. Dead code inventory (quick list)

- mobile: `useStore.js`, `services/authService.ts`, `utils/inputOtp.ts` (most of), `utils/inputUtitls.ts` duplication, Expo template components (`HelloWave`, `ParallaxScrollView`, `Collapsible`, `IconSymbol`, `TabBarBackground`, `HapticTab`, `ExternalLink`), 2 unused zod schemas, `validateImageFile`/`validateFileSize`/`validatePhotoCount`, `formatPhoneForAPI`, `getEffectiveCurrentStep` (never called by UI), orphan routes `certificateUpload`/`confirmPhoto`.
- web: `src/lib/temporal.ts`, `src/lib/geocode.ts`, `src/lib/validations.ts` (old Payload-era schemas incl. `INDIAN_STATES`, `CUISINE_TYPES` with halal options), `src/lib/api/menu-items.ts` + `use-menu-items.ts`, `query-client.ts` (unmounted), `store/restaurant-document-store.ts` (old doc-type taxonomy `halal-certificate|food-license|restaurant-logo|sample-menu|kitchen-photos` — mirrors the *mobile* flow, superseded by the 4-doc backend flow), `components/{LocationPicker,menuItemSheet,orderSheet}.tsx`, `types/restaurantDocumentTypes.ts`, `utils/supabase/{auth,storage}/{client,server}.ts` (helpers unused; only the cookie middleware runs), `src/data/orderData.ts` (mostly), `pg` dependency, unused endpoint groups (carts/feed/payments/pricing/riders/users), `EXPO_PUBLIC_*` env leftovers.

## 8. Geography confusion (worth flagging platform-wide)

The area encodes at least four regions simultaneously: mobile UI Canada (+1, `(500) 505-0000`), shared auth India (+91, GSTIN, FSSAI), map default Dubai (25.2048, 55.2708), web onboarding Malaysia (MY default country, KL coords, `+60123456789` placeholder, country picker MY/SG/IN), dead geocode/LocationPicker India (Hyderabad, `countrycodes=in`, 6-digit postal codes). This suggests iterative market pivots without cleanup; the *current* target market (per the live web flow) appears to be **Malaysia**.
