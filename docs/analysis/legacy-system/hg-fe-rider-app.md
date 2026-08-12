# Halal Goes — Rider Mobile App (`halal-goes/apps/rider`) — Exhaustive Analysis

Fleet report: frontend rider (delivery-partner / "Captain") app. All source/config files under
`/home/user/halal-goes/apps/rider` were read in full (≈16,350 LOC across ~90 files, excluding assets/node_modules).

---

## 1. Purpose & Role in the Platform

The rider app is the Expo (React Native) mobile client used by delivery partners ("HalalGoes Captain",
app.json name). It covers:

1. **Rider onboarding**: phone OTP login → email capture → profile (name/DOB) → vehicle info →
   document upload (driver's license, vehicle registration, vehicle insurance, profile photo) via
   presigned URLs (MinIO through the hg-api backend) → admin review → approval.
2. **Delivery operations**: go online/offline (Redis active-rider pool via backend), receive order
   dispatch offers over a raw WebSocket (port 9080 notification service), accept/reject orders,
   navigate (Google Maps deep links + `react-native-maps-directions`), progress the order through
   `PICKED_UP → ON_THE_WAY → DELIVERED`, and stream GPS location to the backend every 10–15 s.
3. **Ancillary**: earnings display, inbox (mock notifications), help/FAQ screens, account settings
   (largely mock), restaurant chat (mock/local only).

It talks to the backend REST API (`EXPO_PUBLIC_BASE_API_URL`, prod `https://api.halalgoes.com`,
dev fallback `http://localhost:3456`), the WebSocket notification server
(`EXPO_PUBLIC_WEBSOCKET_URL`, fallback `ws://localhost:9080`), and (legacy paths) Supabase.

---

## 2. Tech Stack

| Concern | Choice | Version |
|---|---|---|
| Framework | Expo + React Native (new architecture enabled) | expo ~53.0.0, RN 0.79.6, React 19.0.0 |
| Routing | expo-router (file-based) | ~5.1.10 |
| State | Zustand (5 stores, some persisted to AsyncStorage) | ^5.0.7 |
| Server state | @tanstack/react-query (only used in 3 screens) | ^5.90.2 |
| Styling | NativeWind (Tailwind for RN) + shared `@halal-goes/tailwind-config` | nativewind ~4.1.23, tailwindcss ^3.4.17 |
| Forms | react-hook-form + zod (`@hookform/resolvers`) | RHF ^7.62.0, zod ^4.0.15 |
| HTTP | axios (single instance w/ token refresh interceptor) | ^1.12.2 |
| Auth (shared) | `@halal-goes/auth` workspace package (Supabase client + REST OTP APIs) | workspace:* |
| Maps | react-native-maps (PROVIDER_GOOGLE) + react-native-maps-directions | 1.20.1 / ^1.9.0 |
| Location | expo-location (+ @react-native-community/geolocation in legacy MapScreen) | ~18.1.6 |
| Storage | AsyncStorage (tokens, user data) + expo-secure-store (submission flag, Supabase session) | 2.1.2 / ~14.2.4 |
| Supabase | @supabase/supabase-js (two separate clients) | ^2.55.0 |
| Tokens | jwt-decode | ^4.0.0 |
| Build | EAS (cli >= 16.6.2, `appVersionSource: remote`, dev/preview/production profiles, autoIncrement) | — |
| Lint | eslint-config-universe/native + prettier + prettier-plugin-tailwindcss | — |

`package.json` notes: `main: "expo-router/entry"`, `installConfig.hoistingLimits: workspaces`,
expo doctor excludes `react-native-maps-directions` from directory check. Scripts: android/ios/start/
prebuild/web/lint/format, `eas-build-pre-install: corepack enable && yarn install`.
**`expo-file-system` is imported (confirmDocumentUpload.ts) but NOT declared in package.json** —
resolves only via hoisting.

### app.json highlights
- name **"HalalGoes Captain"**, slug `rider`, scheme `rider-app`, portrait, light-only UI style.
- iOS bundle `com.aaqeb11.rider`; Android package `com.aaqeb11.rider`.
- **Hardcoded Android Google Maps API key in app.json: `AIzaSyD614SHSgC6FnrGsIj00_8SZJF5WznveSU`.**
- Permissions: fine/coarse location, camera, record audio; iOS location always+when-in-use strings.
- EAS projectId `bde2f7c9-2bae-4f1b-89c2-d7a8123c07f6`.
- Plugins: expo-router, expo-camera, expo-secure-store (androidBackup + FaceID string), expo-font.

---

## 3. Route / Screen Inventory (expo-router `app/`)

| Route | File | Purpose |
|---|---|---|
| `/` | `app/index.tsx` | Animated splash; runs `initializeAuth()` + `loadApprovalStatus()`; branches into 8-way navigation decision tree |
| `/splash` | `app/splash.tsx` | Second, older splash (10 s animation → `/onboarding`); appears unused/dead |
| `/onboarding` | `app/onboarding.tsx` | 3-slide carousel (utils/_utils.tsx slides), Skip/Next/Get Started → `/inputNo` |
| `/inputNo` | `app/inputNo.tsx` | Phone entry (+1 Canada flag UI but +91 formatting in logic); non-functional Apple/Google/Facebook buttons |
| `/inputOtp` | `app/inputOtp.tsx` | 6-digit OTP verify (react-hook-form); large 9-way post-verify navigation branch |
| `/emailInput` | `app/emailInput.tsx` | New-rider email capture → `updateRiderDetails` (exchanges onboarding token for access/refresh tokens) |
| `/letsSetup` | `app/letsSetup.tsx` | Interstitial "Start Registration" / change phone (logout) |
| `/CompleteProfileScreen` | `app/CompleteProfileScreen.tsx` | First/last name + DOB (zod, ≥18y) → POST onboarding/profile → `/rider-verification` |
| `/vehicleInformation` | `app/vehicleInformation.tsx` | Vehicle type CAR/BIKE/SCOOTER + model/color/plate (BIKE auto-fills "N/A") → POST onboarding/vehicle |
| `/rider-verification` | `app/rider-verification.tsx` | Document checklist (4 docs + 3 expiry dates), presigned-URL flow, final POST onboarding/documents |
| `/documents` (+4 subroutes) | `app/documents/*` | **Legacy** 5-document flow (adds id-proof, police-verification) uploading to Supabase storage; subroutes re-export `DocumentUploadScreen` |
| `/documentReview` | `app/documentReview.tsx` | Polls GET onboarding/status (react-query), navigates by state (ACTIVE / DOCUMENTS_PENDING / DOCUMENTS_REVIEW / STRIPE_PENDING → `/stripe-onboarding` which **does not exist**) |
| `/documentRejection` | `app/documentRejection.tsx` | Static rejection screen with hardcoded example reasons |
| `/rider-home` | `app/rider-home.tsx` | Main map + online/offline switch; WebSocket connect; order-request drawer; accept/reject |
| `/order-processing` | `app/order-processing/index.tsx` | Heading-to-restaurant map w/ directions; "Arrived" → status PICKED_UP |
| `/order-processing/restaurant-pickup` | Pickup checklist, order summary (₹), contact restaurant; "Picked Up" → ON_THE_WAY |
| `/order-processing/delivery-in-progress` | En-route to customer; **fake 4 s countdown to "arrived"**; → completion |
| `/order-processing/delivery-completion` | Handover method (handed/door/security) → DELIVERED |
| `/order-processing/delivery-success` | Confetti-ish success, earnings breakdown w/ **fake** distance bonus ($2/km) + $5 peak bonus, star rating (local only) |
| `/order-processing/earnings` | Static "You Earned $21" demo screen (hardcoded tripData) |
| `/order-processing/MapScreen` | **Legacy/prototype** map screen: SF dummy polyline coords, Dubai coords, DUMMY_ORDERS; multiple bugs (see §10) |
| `/order-processing/RestaurantChatScreen` | Mock chat ("Jason Miller"), local state only, no backend |
| `/inbox` | `app/inbox.tsx` + `utils/useInbox.tsx` | Notifications/Support tabs, seeded mock data persisted in AsyncStorage |
| `/settings` | `app/settings/index.tsx` | Drawer-style settings panel (props-driven `isVisible`, but registered as a route); logout; many links to **non-existent routes** (`/refer-earn`, `/wallet`, `/order-history`, `/app-settings`, `/feedback`, `/legal-about`) |
| `/settings/AccountSettingsScreen` | Edit name/email/phone/profile photo (local only); delete-account flow → fake OTP |
| `/settings/VerifyOtpScreen` | **4-digit OTP that accepts ANY digits** (no backend verification) for email/phone edit + account deletion |
| `/Help` (+5 subscreens) | `app/Help/*` | FAQ accordions: OrderTracking, OrderModification, Payments, RiderIssues, OtherIssues (all static content; some use `@react-navigation` `useNavigation` instead of expo-router) |
| `/connectionLost` | `app/connectionLost.tsx` | Offline screen + `useNetworkStatus` polling `https://www.google.com/favicon.ico` every 5 s; exports NetworkWrapper/withNetworkCheck HOC (unused elsewhere) |
| `+not-found` | 404 screen |

Root `_layout.tsx`: QueryClientProvider (retry 2, staleTime 5 min, networkMode online),
NetInfo→react-query onlineManager, AppState→focusManager, and a **route guard** effect:
approved+authenticated riders are forced onto rider screens; unauthenticated users forced to
`/inputNo`. (Note the guard's allowed-screens lists omit `settings`/`Help`/`documents` etc., so an
approved rider tapping Settings/Help gets bounced back to `/rider-home` — likely the reason the
MapScreen TODO says "there is some issue with the auth".)

---

## 4. State Management (Zustand stores)

### `store/useAuth.ts` — primary auth store (persisted `rider-auth-storage` in AsyncStorage)
State: `isAuthenticated, isInitialized, isLoading, user{id,phone,role}, session{accessToken,refreshToken},
phoneNumber, userDetails{firstName,lastName,email,phone,state,hasCompletedProfile}, riderId`.
Actions:
- `sendOtp(phone)` → `authService.sendOtp(phone,'rider')` (shared package → POST `/auth/rider/otp/request`).
- `verifyOtp(phone,otp)` → POST `/auth/rider/otp/verify`; new rider ⇒ stores `onboardingToken`
  (AsyncStorage) and marks authenticated with onboarding token as accessToken; existing rider ⇒
  stores `accessToken`/`refreshToken` in AsyncStorage, then GET `/riders/:id` for full profile and
  hydrates `useRiderStore`. Phone normalized `+91` prefix.
- `updateRiderDetails(email)` → shared `/auth/rider/register` with `{email, onboarding_token}`;
  swaps onboarding token for access/refresh tokens; removes `onboardingToken`.
- `initializeAuth()` → reads tokens, `getUserFromToken()` (jwt-decode + auto refresh via
  POST `/auth/refresh`), then GET `/riders/:id`; granular token cleanup by error type.
- `logout()` → `authService.signOut()` + `AsyncStorage.multiRemove(['onboardingToken','accessToken','refreshToken'])`.

### `store/useRiderStore.ts` — rider/session/order store (persisted `rider-storage`)
`UserData` model (mirrors backend rider entity, snake_case): id, first/last name, date_of_birth,
email, phone, phone/email_verified, state, onboarding_state, onboarding_progress, is_approved,
is_accepting_orders, profile_photo_id, drivers_license_id(+expiry), vehicle_type/model/color,
license_plate, vehicle_registration_id(+expiry), vehicle_insurance_id(+expiry), identity_docs[],
total_earnings, total_orders_delivered, rating_avg, approved_at/by, rejected_at/reason, timestamps,
is_deleted, documents_submitted.
Also: `isOnline`, `earnings` (**default '20.00'**), `riderId`
(**default hardcoded `'d141a3b3-9768-4292-8176-eb04378caada'` — "Real rider ID from API"**),
`currentLocation` (**default Hyderabad 17.4399/78.4983**), `isAuthenticated` (**default true, "Auto-authenticated for testing"**),
`isVerified` (default true), `activeOrderId`, `activeOrder` (full OrderType), `isApproved`.
`defaultUserData` is a fake "Test Rider" (rider@test.com, +91 9876543210).
Approval persisted in AsyncStorage key `isApproved`; also legacy `checkApprovalStatus(phone)` queries
Supabase table `rider` (`is_approved === 'approved'`) via the *registration* Supabase client.
Duplicate persistence: `updateUserData` writes both AsyncStorage key `userData` and the persist
middleware's `rider-storage`.

### `store/useWebSocketStore.ts` — global WS singleton (not persisted)
`socket, isConnected, isConnecting, currentUserId, joinedChannels:Set, subscribers[], appStateListenerRef`.
- `connect(userId)` → `new WebSocket(EXPO_PUBLIC_WEBSOCKET_URL || 'ws://localhost:9080')`; on open
  sends `{event:'connect_user', data:{userId, userType:'rider'}}`; broadcasts every parsed message to
  subscribers; auto-reconnect after 5 s on abnormal close (code≠1000); AppState listener reconnects on
  foreground.
- `joinChannel(channelName,userId,userType)` sends `{event:'join_channel', data:{channelName,userId,userType}}`;
  tracks `channel_joined` confirmations.
- Extremely verbose console logging of every message.

### `store/documentStore.ts` — legacy document store (persisted **`rider-store`**)
5 documents: `driving-license, vehicle-registration, vehicle-insurance, id-proof, police-verification`,
each `{photo:{uri,timestamp}|null, status:'pending'|'captured'|'verified', attempts}` plus personal
info (firstName…postalCode). Used only by the legacy `/documents` flow + `useRiderSubmission`.

### `store/map/riderStore.ts` — `useRiderMapStore`
origin/destination/currentLocation (`ILocation` with deltas; defaults Hyderabad), routeDistance/Duration;
`startDelivery/finishDelivery` are console.log stubs.

### `store/auth/useAuthStore.tsx` — wrapper around `@halal-goes/auth`'s store
Manual subscribe→setState bridge exposing sendOtp/verifyOtp/logout/checkAuthStatus; plus
`setUserPhone/getUserPhone/syncPhoneNumbers` helpers (verbose defensive logging). Used by
`letsSetup` and `settings/index` for logout only — a **third parallel auth mechanism** alongside
`store/useAuth.ts` and the unused `contexts/AuthContext.tsx` (which uses `@halal-goes/auth` authStorage).

---

## 5. Backend REST Integration (`lib/apis/`)

Axios instance (`lib/apis/axiosInstance.ts`): baseURL `EXPO_PUBLIC_BASE_API_URL`, request
interceptor injects `Authorization: Bearer <accessToken from AsyncStorage>`, response interceptor on
401 does one retry after `refreshAccessToken()` (POST `/auth/refresh` with `{refreshToken}`, expects
`{success, data:{accessToken, refreshToken}}`).

| Function | Method & Path | Notes |
|---|---|---|
| `getRider` | GET `/riders/:riderId` | Redundantly re-adds Bearer header |
| `toggleAvailability` | PUT `/riders/:riderId/availability` body `{lat,lng}` | Backend adds/removes rider from Redis active pool; returns full rider incl. `is_accepting_orders` |
| `updateRiderLocation` | PUT `/riders/:riderId/location` body `{latitude,longitude,orderId?}` | orderId included during active delivery; response logged only 10% of the time |
| `acceptOrder` | PUT `/riders/:riderId/orders/:orderId?action=accept` | Response `{success, action, order{id,status,delivery_partner_id}, signaled, notificationSignaled}` — Temporal workflow signal flags |
| `rejectOrder` | PUT `/riders/:riderId/orders/:orderId?action=reject&reason=...` | reason URL-encoded, default 'Rider declined' |
| `updateOrderStatus` | PUT `/riders/:riderId/orders/:orderId/status?status=PICKED_UP\|ON_THE_WAY\|DELIVERED` | |
| `checkOnboardingStatus` | GET `/riders/:riderId/onboarding/status` | Returns `{rider_id, state, progress, next_step, is_completed, rejection_reason, steps_completed{phone_verified,profile_setup,vehicle_setup,documents_submitted,documents_approved,stripe_onboarded}}` |
| `submitProfile` | POST `/riders/:riderId/onboarding/profile` `{first_name,last_name,date_of_birth}` | |
| `submitVehicle` | POST `/riders/:riderId/onboarding/vehicle` `{vehicle_type,vehicle_model,vehicle_color,license_plate}` | |
| `getDocumentUploadUrl` | POST `/riders/:riderId/onboarding/documents/upload-url` `{document_type,file_name,content_type}` | **URL hardcoded to `https://api.halalgoes.com/...`**, bypassing env var; returns `{upload_url, document_id, object_key}` (MinIO presigned PUT) |
| `uploadFileToPresignedUrl` | PUT to presigned URL (fetch, blob body) | |
| `confirmDocumentUpload` | POST `/riders/:riderId/onboarding/documents/confirm` `{document_id,object_key,document_type,file_name,content_type,size_bytes}` | |
| `submitRiderDocuments` | POST `/riders/:riderId/onboarding/documents` `{4 doc ids + 3 expiry dates}` | |

Shared `@halal-goes/auth` package endpoints (used via authService): POST `/auth/rider/otp/request`,
`/auth/rider/otp/verify`, `/auth/rider/register`, `/auth/logout`, plus user-side equivalents.

Onboarding state machine constants (`ONBOARDING_STATES`): REGISTERED, PHONE_VERIFIED,
PROFILE_PENDING, DOCUMENTS_PENDING, DOCUMENTS_REVIEW, STRIPE_PENDING, ACTIVE.
Document types: `drivers_license | vehicle_registration | vehicle_insurance | profile_photo`.

`services/riderService.ts` is a **duplicate** availability client using plain axios and a different
env var (`EXPO_PUBLIC_API_BASE_URL` — note different name, likely typo'd fork) — apparently unused.

---

## 6. WebSocket / Realtime Protocol

- URL: `EXPO_PUBLIC_WEBSOCKET_URL` (store) fallback `ws://localhost:9080`; the alternative
  `hooks/useWebSocketConnection.ts` hardcodes **`ws://192.168.200.19:9080`** (dev LAN IP) and appears
  to be a legacy/unused parallel implementation.
- Outbound events: `connect_user {userId, userType:'rider'}`, `join_channel {channelName,userId,userType}`, `ping`.
- Inbound events handled in `hooks/useRiderWebSocket.ts` (658 lines):
  - `connection_confirmed` (includes `queuedNotificationsDelivered` count),
  - `channel_joined {channelName}`,
  - `notification` with `data.type ∈ {order_request, rider_order_request}` → new dispatch offer,
  - `order_request` with `data.type='order_request'` (order data nested `data.data`, includes
    `orderDetails.order_food_items[]` transformed to UI items),
  - `order_request` with `data.type='CHANNEL_JOIN'` → instructs client to join `channelName`,
  - legacy bare `order_request`,
  - `order_update` with types `ORDER_DETAILS`, `ORDER_STATUS_UPDATE` (status), `TRACKING_STARTED`,
    `TRACKING_WORKFLOW_STARTED` (carries `trackingWorkflowId` — Temporal), plus
    `location {latitude,longitude}`, `source`, `riderId` fields.
- Channels joined on going online (rider-home, after 1.5 s): **`riders`** (broadcast),
  **`rider:{riderId}`**, **`notifications:{riderId}`** (shotgun approach: "Try multiple possible
  channel patterns"). On accept: **`order:{orderId}`**.
- The message→OrderType transformation is copy-pasted **four times** (~100 lines each) with
  massive `||` fallback chains covering at least 3 different backend payload shapes; default
  `expiresAt = now + 300000` (5 min), `estimatedTime` default 30, status forced `'RIDER_ASSIGNED'`.
- Order offer drawer (`components/rider/OrderRequestDrawer.tsx`) auto-dismisses after **7 s**
  countdown animation (accept-button fill) even though data says 5 min expiry.

## 7. Location Pipeline (`hooks/useLocationUpdates.ts`)

- Foreground permission only (`requestForegroundPermissionsAsync`) — no background tracking despite
  iOS "Always" plist strings.
- `watchPositionAsync` High accuracy, every 10 s or 10 m; plus a 15 s `setInterval` Balanced-accuracy
  backup poll. Both push `updateRiderLocation(riderId, lat, lng, activeOrder?.orderId)` and update
  `currentLocation` in `useRiderStore`.
- Started when going online (rider-home) and on order-processing mount; stopped on going offline/unmount.
- Stale-closure caveat: callbacks capture `riderId`/`activeOrder` at start time.

---

## 8. Onboarding & Document Flows (two generations)

**Current flow** (backend-driven): rider-verification.tsx lists 4 docs; per-doc tap requests a
presigned URL first, then navigates to the shared `DocumentUploadScreen`
(camera via expo-image-picker, or file via expo-document-picker incl. PDF; content-type inference by
extension; HEIC supported). After PUT upload → confirm API → stores returned doc id into
`userData.<field>_id`. Expiry dates required for the 3 non-photo docs (DateTimePicker, min today).
Final submit → POST onboarding/documents → alert → `/documentReview` (or `/rider-home` if ACTIVE).

**Legacy flow** (`app/documents/*`, documentStore, useRiderSubmission, payloadFormService): 5 docs
captured locally then uploaded to **Supabase storage bucket `hg-bucket`** (path `rider/{ts}_{name}`,
public URLs) via `supabaseClientRegistration` (`EXPO_PUBLIC_SUPABASE_REGISTRATION_URL/_ANON_KEY` —
**not in .env.example**), then inserts a row into Supabase table `rider` with document URLs and
`is_approved:'pending'`. The original Payload CMS submission (`{PAYLOD_URL}/form-submissions`,
form '5') is commented out ("SKIPPING PAYLOAD API CALL"). Class still named `PayloadFormService`;
misspelled env var `EXPO_PUBLIC_PAYLOD_URL` (default https://halalgoes.com), `EXPO_PUBLIC_FORM_ID` (default 4).

Submission completion flag stored in SecureStore under key **`restaurant_submission_status`**
(copy-paste from restaurant app; utils/submissionState.ts) — drives splash/OTP routing to `/documentReview`.

---

## 9. Configuration & Environment Variables

| Var | Where | Default/Value | Purpose |
|---|---|---|---|
| `EXPO_PUBLIC_BASE_API_URL` | axiosInstance, all rider APIs, auth package | `.env.example`: `https://api.halalgoes.com`; code fallbacks `http://localhost:3456` | Backend REST |
| `EXPO_PUBLIC_WEBSOCKET_URL` | useWebSocketStore | fallback `ws://localhost:9080` | Notification WS (NOT in .env.example) |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | lib/supabase.ts | 'example' in .env.example | Supabase auth client (SecureStore-backed session, autoRefresh tied to AppState) |
| `EXPO_PUBLIC_SUPABASE_REGISTRATION_URL` / `EXPO_PUBLIC_SUPABASE_REGISTRATION_ANON_KEY` | lib/supabaseRegistration.ts | **undefined — not in .env.example; `!` non-null assertion** | Legacy registration/storage client |
| `EXPO_PUBLIC_PAYLOD_URL` (sic) | payloadFormService | `https://halalgoes.com` | Legacy Payload CMS |
| `EXPO_PUBLIC_FORM_ID` | payloadFormService | 4 (code fallback 'YOUR_FORM_ID') | Legacy form id |
| `EXPO_PUBLIC_API_BASE_URL` | services/riderService.ts | `http://localhost:3456` | Duplicate/typo'd var name in unused service |

Hardcoded values of note:
- **Google Maps Directions API key `AIzaSyBWc3Y20xS1yk5D7ud4zPGkp0PU0MhLHTw`** hardcoded in 3 files
  (order-processing/index.tsx, order-processing/MapScreen.tsx, components/rider/DeliveryMap.tsx).
- **Android Maps key `AIzaSyD614SHSgC6FnrGsIj00_8SZJF5WznveSU`** in app.json.
- Default riderId UUID + Hyderabad coordinates in useRiderStore.
- `https://api.halalgoes.com` hardcoded in documents.ts upload-url call.
- `ws://192.168.200.19:9080` in useWebSocketConnection.ts.
- Connectivity check pings `https://www.google.com/favicon.ico`.
- Country-flag image from `https://flagcdn.com`; fallback avatar from unsplash.com.

AsyncStorage keys: `accessToken`, `refreshToken`, `onboardingToken`, `userData`, `isApproved`,
`isVerified`, `rider-auth-storage`, `rider-storage`, `rider-store`, `@inbox_notifications`,
`@inbox_support_messages`, `@inbox_has_viewed_notifications`.
SecureStore keys: `restaurant_submission_status`, plus Supabase session keys.

---

## 10. Auth / Security Model

- Phone OTP (6-digit) via backend `/auth/rider/otp/*`; new riders get a short-lived
  `onboarding_token`, exchanged for JWT access+refresh tokens at email registration.
- JWTs decoded client-side (`utils/getUserFromToken.ts`: `sub`→id, `role`); expiry checked locally;
  refresh via `/auth/refresh`; layered token-cleanup on specific refresh errors.
- **Tokens stored in AsyncStorage (plaintext), not SecureStore** — SecureStore is used only for the
  submission flag and Supabase session.
- Route guard in `_layout.tsx` (see §3) is the only client-side authorization.
- Approval gate (`isApproved`) is a locally persisted boolean, set from onboarding-status ACTIVE.
- Settings OTP screen (`settings/VerifyOtpScreen`) performs **no real verification** — any 4 digits
  "verify" email/phone changes and account deletion (all local-only actions).
- Two hardcoded Google API keys and a default real rider UUID are shipped in the bundle (secrets hygiene issue).

---

## 11. Code-Quality Observations (dead code, bugs, TODOs, inconsistencies)

**Apparent bugs**
1. `order-processing/MapScreen.tsx`:
   - Uses `router.push('/inbox')` without importing `router` → ReferenceError if invoked.
   - Stray JSX text line `// TODO: Implement settings screen, there is some issue with the auth.`
     outside a `<Text>` — would throw RN "text strings must be rendered within a <Text>".
   - `RiderSettings` imported from `../settings` (a route dir) and commented out; dummy SF/Dubai coords.
2. Root-layout route guard bounces approved riders out of `settings`, `Help`, `documents`,
   `rider-verification`, etc. (not in `inRiderScreens`) — Help works only because it's pushed
   *within* allowed stacks? No — pathname changes; likely broken navigation for approved riders.
3. `inputOtp.tsx` order of checks: `hasSubmitted` (SecureStore) is evaluated **before**
   `userData.is_approved`, so an approved rider with a stale submission flag is sent to
   `/documentReview` instead of home. Fallback comment "9. Fallback - go to home" actually routes to
   `/inputNo`.
4. `delivery-in-progress.tsx` fakes arrival after 4 s regardless of real GPS; `order-processing/index.tsx`
   auto-increments arrival status every 5 s (demo timers left in production flow).
5. `delivery-success.tsx` invents earnings: distance bonus = distance×2, peak bonus fixed $5 —
   inconsistent with backend `total_earnings`; currency flips between `$` and `₹` across screens
   (₹ on restaurant-pickup, $ everywhere else).
6. `settings/AccountSettingsScreen` reads `userData.fullName` / `userData.profileImage` — fields that
   don't exist on the UserData type (TS would flag; store is loosely typed via updates).
7. `confirmDocumentUpload.ts` imports `expo-file-system` which is not a declared dependency.
8. `rider-home` `handleAcceptOrder` sets `setOnline(false)` locally after accepting without calling
   the availability API → client/back-end online-state divergence.
9. OTP screens hardcode `+91` formatting while UI shows `+1` (Canada flag), and
   `formatPhoneNumberForDisplay` renders `+1` — mixed-market leftovers.
10. `useOtpScreen` (utils/inputOtp.ts) is a 4-digit legacy hook while the real screen uses 6 digits;
    both are wired (screen uses hook only for back/format/sourceScreen).
11. documentStore vs backend document-type mismatch: legacy keys (`id-proof`, `police-verification`)
    have no backend equivalents (backend: profile_photo instead).
12. `documentReview` STRIPE_PENDING navigates to `/stripe-onboarding` — route doesn't exist (404).
13. `submissionState` key literally named `restaurant_submission_status` in the rider app.

**Dead / duplicated code**
- Duplicate order-drawer components (`components/rider/OrderRequestDrawer` vs `utils/useOrderRequestDrawer`),
  duplicate reject drawers, triplicate auth stores, duplicate WS layers
  (`useWebSocketStore`+`useRiderWebSocket` vs `useWebSocketConnection` vs `useMockWebSocket`),
  duplicate availability services, duplicate OTP hooks, two splash screens.
- `hooks/useUpdateOrderStatus.ts` is a pure mock (1 s setTimeout) superseded by the real API module.
- `data/mockOrders.ts` (5 Hyderabad orders), `useMockWebSocket`, `fetchRouteCoordinates` (mock),
  `earnings.tsx` (static), `RestaurantChatScreen` (mock), inbox seed data — demo scaffolding.
- `contexts/AuthContext.tsx` and `utils/storage.ts` unused by any screen.
- `components/common` `ActionButtons`, `CameraOverlay`, `BottomIndicator` unused.
- OrderType interface copy-pasted ≥6 times (mockOrders, useRiderStore, useRiderWebSocket, rider-home,
  OrderRequestDrawer, hooks) instead of one shared type.
- The WS message transformer's ~100-line mapping is duplicated 4× inside one hook.

**TODOs found**
- MapScreen: "TODO: To be used when integrated with the backend." (setOrigin), "TODO: Remove hardcoded
  coordinates…", "TODO: Implement settings screen, there is some issue with the auth."
- payloadFormService: "COMMENTED OUT - NOT CALLING PAYLOAD API ANYMORE" + large commented block.
- earnings.tsx: placeholder comment blocks for missing check-mark asset.

**Misc**
- Pervasive emoji console.log/debug logging (including full order payloads and token previews) left in.
- `connectionLost.tsx` asset filename `wifi-icon.png.png` (double extension).
- File-name typo `inputUtitls.ts`; misspelled env `PAYLOD`.
- eslint universe/native; strict TS enabled but many `any` casts (icon components cast to `any`).
- Splash `app/index.tsx` logs a full "Navigation Debug" object each launch.

---

## 12. How It Connects to the Rest of the Platform

- **hg-api backend**: all `/riders/*` + `/auth/rider/*` + `/auth/refresh` endpoints (NestJS-style);
  accept/reject responses expose Temporal signaling (`signaled`, `notificationSignaled`,
  `trackingWorkflowId` in WS updates); availability toggling manages the Redis active-rider pool;
  document upload uses backend-issued MinIO presigned URLs.
- **WS notification service** (`:9080`, hg-api/hg-docker): connect_user/join_channel protocol;
  channels `riders`, `rider:{id}`, `notifications:{id}`, `order:{orderId}`; events
  notification/order_request/order_update/connection_confirmed/channel_joined.
- **Shared packages**: `@halal-goes/auth` (authService/createAppAuth/authStorage/phone schemas),
  `@halal-goes/tailwind-config` (+ ui/eslint/ts-config packages exist in the monorepo).
- **Supabase** (legacy): auth client + registration project (storage bucket `hg-bucket`, table `rider`).
- **Google**: Maps SDK (Android key in app.json), Directions API (hardcoded JS key), Maps deep links
  for turn-by-turn (`https://www.google.com/maps/dir/?api=1...`, fallback `google.navigation:q=`).

## 13. Open Questions
- Which WS channel the backend actually publishes rider offers to (client joins three guesses).
- Whether the legacy Supabase registration path is still reachable in production builds
  (its env vars are absent from .env.example, so it would crash if invoked).
- Whether the `_layout` route guard's screen whitelist is intentionally narrow.
- Stripe onboarding (`STRIPE_PENDING` → `/stripe-onboarding`) is referenced but unimplemented client-side.
