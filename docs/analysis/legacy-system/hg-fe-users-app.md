# Halal Goes — Users (Customer) Mobile App — Exhaustive Analysis

**Path:** `/home/user/halal-goes/apps/users`
**Type:** Expo (SDK ~53) React Native app, expo-router v5 file-based routing, inside the `halal-goes` Turborepo (yarn workspaces, `installConfig.hoistingLimits: workspaces`).

---

## 1. Purpose & Role in the Platform

This is the **customer-facing food-delivery app** of the Halal Goes platform. It implements the entire consumer journey: onboarding carousel → phone OTP auth → profile completion → personalized restaurant feed → restaurant menu browsing → server-synced cart → checkout (address, delivery instructions, tips, promos) → payment → real-time order lifecycle (restaurant acceptance → rider assignment → live map tracking) → delivery rating. It talks to the `hg-api` backend over REST (`EXPO_PUBLIC_BASE_API_URL`) and to a raw WebSocket gateway (`EXPO_PUBLIC_WEBSOCKET`, port 9080) for order/checkout status pushed from the backend's Temporal-driven order workflows. Auth is phone-OTP based via the shared workspace package `@halal-goes/auth` (which wraps Supabase for OTP sending plus custom backend `/auth/*` endpoints for token issuance).

- App display name: **HalalGoes**, slug `users`, version 1.0.0, EAS project `4694cd1f-a200-4edd-8e7e-33298bbbb580`, owner `aaqeb11`.
- Bundle IDs: iOS `com.aaqeb11.users`, Android `com.aaqeb11.users`.
- Brand colors: deep green `#1B3B31`/`#1B4D3E`/`#065F46` (emerald), accent orange `#E95322`/`#F97316`.

## 2. Tech Stack

| Concern | Choice |
|---|---|
| Framework | Expo ~53.0.0, React 19.0.0, React Native 0.79.6, `newArchEnabled: false` |
| Routing | expo-router ~5.1.10 (entry `expo-router/entry` in package.json `main`) |
| Styling | NativeWind ~4.1.23 + Tailwind 3.4.17 (`global.css`, `tailwind.config.js` with custom `primary` blue palette that is never used) |
| State | Zustand 5.0.8 (8 stores, most persisted to AsyncStorage) + 3 legacy React Contexts (dead) |
| Server state | @tanstack/react-query 5.90.2 (QueryClient created in `app/_layout.tsx`: retry 2, staleTime 0, networkMode 'online'; NetInfo → `onlineManager`, AppState → `focusManager`) |
| Forms | react-hook-form 7.62 + zod 4.1.5 via @hookform/resolvers |
| HTTP | axios 1.12.2 (`lib/apis/axiosInstance.ts` with token interceptor + refresh-on-401) |
| Realtime | Raw `WebSocket` (no lib) in `stores/useWebSocketStore.ts` |
| Maps | react-native-maps 1.20.1 (PROVIDER_GOOGLE), react-native-maps-directions 1.9.0 (excluded from expo-doctor RN-directory check) |
| Location | @react-native-community/geolocation 3.4.0 |
| Auth | @halal-goes/auth workspace package (Supabase + backend JWT), jwt-decode 4.0.0, expo-secure-store (only used by `lib/supabase.ts`) |
| Storage | @react-native-async-storage/async-storage 2.1.2 (tokens + all persisted stores) |
| Misc | expo-image, expo-camera, expo-image-picker, expo-haptics, react-native-reanimated 3.17.4 + reanimated-carousel 4.0.3, react-native-webview, zod, supabase-js 2.55 |

Scaffolded with `create-expo-stack` 2.14.2 (`cesconfig.json`, pnpm 9.15.9, Darwin arm64 — though the monorepo uses yarn).

## 3. Route / Screen Inventory (app/ directory)

All screens registered in `app/_layout.tsx` root `<Stack>` (headerShown false globally). Custom bottom tab bar (`components/CustomTabBar.tsx`) rendered by the root layout only when pathname ∈ {`/home-screen`, `/cart`, `/account`}.

| Route | File | Purpose / key behavior |
|---|---|---|
| `/` (index) | `app/index.tsx` | Real splash + auth bootstrap. Animates logo, calls `initializeAuth()`, then routes by persisted onboarding flag (`@has_onboarded` AsyncStorage) and `userDetails.state` enum: REGISTERED/PHONE_VERIFIED/PROFILE_PENDING → `/user-details`; ACTIVE → `/home-screen` (+ 1s global skeleton); unauthenticated → `/onboarding` or `/inputNo`. |
| `/splash-screen` | `app/splash-screen.tsx` | **Dead/legacy** second splash. Reads `@is_logged_in` (never written anywhere) and navigates to `/(tabs)` and `/(auth)/onboarding` — route groups that do not exist. |
| `/onboarding` | `app/onboarding.tsx` | 3-slide carousel (`slides` in utils/dataUtils), pan-gesture + FlatList paging, sets `@has_onboarded=true`, also grabs geolocation into `useUserStore` (fallback Hyderabad 17.385044/78.486671). |
| `/inputNo` | `app/inputNo.tsx` | Phone entry, zod `phoneSchema` (exactly 10 digits). UI shows Canadian flag +1 (flagcdn.com/w20/ca.png) but code formats to `+91` (India) — inconsistency. Calls `useAuth.sendOtp`. |
| `/inputOtp` | `app/inputOtp.tsx` | 6-box OTP with paste-split & backspace nav, `otpSchema`. `verifyOtp` → new user → `/user-details`, existing → `/home-screen`. Resend supported. |
| `/user-details` | `app/user-details.tsx` | Profile completion: firstName/lastName/email/dateOfBirth (zod `userDetailsSchema`, ≥13 y/o). Mutation → `onboardUser` (`PUT /users/:id/onboarding/profile`), then patches `useAuth` state (sets state:'REGISTERED', hasCompletedProfile:true) and syncs `useUserStore.handleUserCreation`, → `/home-screen`. Note: the alternate `useAuth.updateUserDetails` path (auth-package `/auth/register` with onboarding token) exists in the store but this screen bypasses it. |
| `/home-screen` | `app/home-screen.tsx` | Main feed. Gets GPS (fallback Hyderabad), queries `['home', userId, lat, lng]` → `GET /feed/:userId?lat&lng`. Sections: order_again, your_favourite_restaurants, restaurants_near_you, trending_in_your_area, you_might_like.restaurants, popular_items (FoodItemCard via `normalizeFeedFoodItem`). Static promo/ad carousels (`promotionCards`, `adCards`) & 4 hardcoded categories → every category press routes to `/restaurant/1`. Double-back-to-exit handler. Pull-to-refresh. Dead auto-scroll `flatListRef` effect (ref never attached). |
| `/search` | `app/search.tsx` | Debounced (80 ms) infinite search, min 3 chars: `useInfiniteQuery ['search', userId, q]` → `GET /feed/:userId/search?q&limit=10&page`. Renders Restaurants + Food Items with pagination (`pagination.has_next_page`), popular-search chips. |
| `/all-restaurants` | `app/all-restaurants.tsx` | "See all" list. Re-fetches feed but reads `data?.restaurants_near_you` (missing `.data` wrapper → **always renders nothing**). Local lat/lng state starts 0/0 and query has no `enabled` guard. |
| `/restaurant/[id]` | `app/restaurant/[id].tsx` | Restaurant detail: `GET /restaurants/:id` + `GET /restaurants/:id/menu`. Category tab filter from `menu_items[].category.name`, in-restaurant search overlay (result tap only fires an Alert), veg/non-veg/allergen chips, add-to-cart via `useCart` hook (first variant auto-selected, no addon picker), floating View-cart button. Hero image is a hardcoded local asset (`crescent-cafe1.jpeg`), not the restaurant's image. |
| `/cart` | `app/cart.tsx` | Cart list from `useCartStore`. Queries `['cart-pricing', cartId]` → `GET /pricing/:cartId` and stores into `cartPricing`, **but the rendered totals use hardcoded values** (deliveryFee 5, platformFee 3, discount 0) — the cartPricing render lines are commented out. Clear-cart modal → `removeAllItems` (server sync). |
| `/checkout` | `app/checkout.tsx` | Connects WebSocket (`connect(userId)`). Address picker modal (from `GET /users/:id/addresses`; header shows `addresses?.[0]` not the selected one), hardcoded "Delivering in 45 min", delivery-instruction chips (ids `door`/`meet`/`lobby` — see bugs), special-instructions modal, tip options ($2/$3/$5/custom — **disabled**), promo entry (**disabled**), recommended items (**disabled**, static), summary with hardcoded deliveryFee 5.0 / platformFee 2.0. Pay → `/payments/select-payment?amount=…`. |
| `/payments/select-payment` | `app/payments/select-payment.tsx` | Payment method list from persisted `usePaymentMethodStore`. "Add New Card" → `POST /payments/users/:id/method` `{payment_method:'CREDIT_CARD'}` (no card entry). Proceed → **navigates to `/payments/success` first**, then fires `PUT /orders/checkout/:cartId` with payload from `useCheckoutPayload` (user_id, delivery_address_id, payment_method_id, pricing from cartPricing, metadata delivery instructions). ~100 lines of commented-out ad-hoc WebSocket code incl. `ws://:9080`. |
| `/payments/add-card` | `app/payments/add-card.tsx` | Pure-UI card form (formats number/expiry/cvv, detects visa/mc/amex); "Add Card" just shows an Alert — nothing is stored or sent. |
| `/payments/success` | `app/payments/success.tsx` | "Payment Successful!" + listens to `useOrderWebSocket`; on ORDER_CREATED/RESTAURANT_NOTIFIED/WAITING_RESTAURANT_ACCEPTANCE → `/restaurant-waiting?orderId`; on failure → clearCart → `/reject-order`. Shows `__DEV__` debug panel. |
| `/payments/failed` | `app/payments/failed.tsx` | Static failure screen, "Try again" → router.back(). Only reached from processPayment onError. |
| `/restaurant-waiting` | `app/restaurant-waiting.tsx` | Spinner while restaurant accepts. On CONFIRMED/PREPARING/…/RIDER_ASSIGNED/COMPLETED → clearCart → `/delivery-tracking?orderId`; REJECTED/FAILED/NO_RIDERS_FOUND/ORDER_CANCELED → `/reject-order`. `__DEV__` debug panel. |
| `/delivery-tracking` | `app/delivery-tracking/index.tsx` | Live tracking. `GET /orders/:orderId`, `GET /riders/:riderId` (riderId from WS). 3-step animated timeline (Preparing/Picked Up/Arriving), Google map with rider & user markers + MapViewDirections polyline (uses `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`), rider card w/ call (uses `Linking` **which is never imported — crash**) and chat buttons. DELIVERED → `/order-complete`; canceled → `/reject-order`. Also `import { React, … } from 'react'` (invalid named import, works only due to JSX transform). Help link uses `navigation.navigate('help')`. |
| `/delivery-tracking/chats/rider` | `.../chats/rider.tsx` | **Mock chat** (hardcoded messages, header "Jason Miller", local-state send only; no WS). |
| `/delivery-tracking/chats/restaurant` | `.../chats/restaurant.tsx` | Same mock chat; header hardcoded "Quinoa - The Kitchen". |
| `/order-complete` | `app/order-complete.tsx` | Post-delivery: star ratings + feedback text for food & delivery. Submit only console.logs ("submission not yet implemented in backend") and Alerts. |
| `/reject-order` | `app/reject-order.tsx` | Shows rejection reason, auto-redirects home after 2 s. |
| `/account` | `app/account.tsx` | Profile hub. Merges useAuth → useUserStore → `GET /users/:id`. Sections menu from `utils/utils.shared sections` (many entries have no onPress: Your Orders, Payment Methods, Give Feedback, Rate App, Refer Friends, Become a Rider, Privacy Settings). Logout modal → `useAuth.logout()` + clearCart → `/inputNo`. |
| `/account-settings` | `app/account-settings.tsx` | Edit name/email (phone locked, "Verified" badge; unverified → `/inputNo`). Save → `PUT /users/:id` **but sends `{name, phone, email}` while `UpdateUserPayload` expects `first_name/last_name`** — payload-shape bug. Imports `createAppAuth` unused. |
| `/saved-addresses` | `app/saved-addresses.tsx` | `GET /users/:id/addresses` list with Default badge; Edit → `/add-address?editAddressId=`; **Delete and Set-Default are fake** (success Alert only, API calls commented out). |
| `/add-address` | `app/add-address.tsx` | Add/edit address form (zod `addressSchema`: street/apartment/floor/landmark/suburb/postal_code all required; conditional third-person fields). Coordinates must come from `/map-selector` (stored in useAddressStore). Custom address types supported. Create → `POST /users/:id/addresses`. **Edit mode's update mutation is TODO/commented — Update button does nothing.** |
| `/map-selector` | `app/map-selector.tsx` | Google map picker; current GPS or previous coords; tap to select; fallback location **Dubai** (25.2048, 55.2708). Confirm → `useAddressStore.setCoordinates` → back. |
| `/promotion` | `app/promotion.tsx` | Entirely mock promo engine from `utils/dataUtils`: hardcoded promo cards + codes (SAVE20, FIRST15, DELIVERY5, WEEKEND10, STUDENT25, LOYAL30, all `validUntil` 2024 — expired), local-state application only; discount never reaches checkout. |
| `/notification-screens` | `app/notification-screens.tsx` | Static "No New Notifications" empty state. |
| `/legal` | `app/legal.tsx` | Legal & About menu/detail from `LegalmenuItems` — content still contains `[App Name]` / `[Date]` placeholders. |
| `/refund` | `app/refund.tsx` | Static "No Refunds Yet" (icon is a via.placeholder.com URL). |
| `/help` (+ children) | `app/help/*.tsx` | Help hub + 5 FAQ screens (order-tracking, order-modification, payments, rider-issues incl. local-only issue-report form, other-issues with category grid & search). Static content from `utils/utils.shared`. Layout registers a non-existent `payment` screen alongside `payments`. |
| `+not-found` | `app/+not-found.tsx` | 404 with Home/Back buttons. |

### Dead entry point
`App.tsx` + `index.ts` (registerRootComponent) are a **legacy React Navigation entry** referencing `./navigation/RootNavigator/index` which **does not exist** — never used because package.json `main` is `expo-router/entry`. It wires the three dead Contexts (AddressProvider/CartProvider/UserProvider).

## 4. State Management (Zustand stores)

| Store | File | Persist key | Contents |
|---|---|---|---|
| `useAuth` | `stores/useAuth.tsx` | `user-auth-storage` | isAuthenticated, userDetails {id, phone, firstName…, state: onboardingStatus, hasCompletedProfile}, session {access_token, refresh_token}, isLoading/isInitialized/_hasHydrated. Actions: sendOtp/verifyOtp (via `authService` from @halal-goes/auth, role `'user'`), updateUserDetails (onboarding-token flow), logout, initializeAuth (JWT decode → `GET /users/:id`, granular error handling for refresh failures, userStore fallback), navigateToHome, setAuthenticated. Persists session tokens **in plain AsyncStorage JSON**. |
| `useUserStore` | `stores/useUserStore.ts` | `user-storage` (version 1) | "slave" user copy {id, names, phone, email, profileImage (via.placeholder default), joinDate, lastUpdated, lat, long, state}, isLoggedIn, hasOnboarded, _hasHydrated. setLat/setLong hold last GPS. |
| `useCartStore` | `stores/useCartStore.ts` | `cart-storage` | cartItems (full server CartItem incl. nested food_item→menu→restaurant), cartId, cartValue, itemCount, deliveryAddress, currentRestaurantId/Name, cartPricing {item_total, delivery_fee, platform_fee, discount_amount, amount_to_pay}. `addToCart(cartResponse)` replaces state from server response. Local increase/decrease/remove mutate state optimistically (server sync lives in `hooks/cart.ts`, which calls the API then overwrites via addToCart). `decreaseQuantity`/`removeItem` set `cartId: null` though typed `string`. Unused `resolveImageToUri` helper. |
| `useAddressStore` | `stores/useAddressStore.ts` | `address-storage` (v1) | selectedAddress (AddressResponse), coordinates {lat,lng} (set by map-selector), isAddressSelected, _hasHydrated. Also exports `Address` (request) & `AddressResponse` (server) types. |
| `useDeliveryInstructionStore` | `stores/useDeliveryInstructionsStore.ts` | `delivery-instruction-storage` (v1) | selectedInstructions: `('DO_NOT_CALL'\|'DO_NOT_RING_BELL'\|'LEAVE_AT_DOOR')[]`, specialInstructions; `getMetadata()` → `{delivery_instructions, special_instructions?}` used in checkout payload. |
| `usePaymentMethodStore` | `stores/usePaymentMethodStore.ts` | `payment-method-storage` | paymentMethods (PaymentMethod: payment_method 'CREDIT_CARD'\|'CASH_ON_DELIVERY'\|'DEBIT_CARD' + soft-delete fields), selectedPaymentMethod. |
| `useWebSocketStore` | `stores/useWebSocketStore.ts` | (not persisted) | Raw WebSocket lifecycle — see §6. |
| `useGlobalSkeleton` | `stores/useGlobalSkeleton.tsx` | (not persisted) | shouldShowSkeleton flag + `useSkeletonFromSplash` (auto-hide after 1 s) + `SkeletonBox`/`FullAppSkeleton` shimmer components (store file also contains components). |
| `useUserMapStore` | `stores/map/userStore.ts` | (not persisted) | **Unused** map origin/destination/currentLocation with hardcoded San Francisco coords, routeDistance/Duration, no-op startDelivery/finishDelivery. |

### Legacy React Contexts (all dead — only mounted by dead App.tsx)
- `contexts/AddressContext.tsx` — in-memory address CRUD seeded with 3 Toronto addresses. Used only by dead `components/SelectLocation/index.jsx`.
- `contexts/CartContext.tsx` — in-memory cart with different-restaurant replacement Alert (this UX is **not** present in the live Zustand cart).
- `contexts/UserContext.tsx` — hardcoded "Jason Miller" user.

## 5. API Client Layer (`lib/apis/`)

`axiosInstance.ts`: baseURL `process.env.EXPO_PUBLIC_BASE_API_URL`; request interceptor attaches `Authorization: Bearer <accessToken>` from AsyncStorage; response interceptor on 401 (once, `_retry`) calls `refreshAccessToken()` and retries — **bug: `refreshAccessToken` returns `{success, accessToken}` object, and the interceptor does `Bearer ${newToken}` with the whole object → "Bearer [object Object]"** (retry always fails; `getUserFromToken` uses the return shape correctly).

Every function also redundantly prefixes `EXPO_PUBLIC_BASE_API_URL` onto the already-baseURL'd instance (harmless, but inconsistent).

| Function | Method & Path | Auth | Notes |
|---|---|---|---|
| `fetchFeed` | GET `/feed/:userId?lat&lng` | ✔ instance | home feed |
| `searchFeed` | GET `/feed/:userId/search?q&limit&page` | ✔ | paginated |
| `getRestaurant` | GET `/restaurants/:id` | ✔ | |
| `getRestaurantMenu` | GET `/restaurants/:id/menu` | ✔ | returns `{menu_items}` |
| `updateCart` | PUT `/carts/:userId` | ✔ | body CartPayload {delivery_address_id, cart_items[{food_item_id, quantity, selected_variant_id, selected_addon_ids}], coupon_codes} |
| `getCartPricing` | GET `/pricing/:cartId` | ✔ | |
| `getUserAddress` | GET `/users/:userId/addresses` | ✔ | |
| `createAddress` | POST `/users/:userId/addresses` | ✔ | body Address |
| `getUser` | GET `/users/:userId` | ✔ | returns {success,data,error} wrapper |
| `createUser` | POST `/users` | ✖ raw axios | snake_case body; **appears unused** |
| `onboardUser` | PUT `/users/:userId/onboarding/profile` | ✔ | camelCase UserDetailsFormData incl. Date object |
| `updateUser` | PUT `/users/:userId` | ✔ | UpdateUserPayload (first_name/last_name/email/phone) |
| `getOrder` | GET `/orders/:orderId` | ✔ | |
| `getRider` | GET `/riders/:riderId` | ✖ **raw axios, no auth header** | IRider interface with earnings/ratings |
| `addNewPaymentMethod` | POST `/payments/users/:userId/method` | ✖ **raw axios, no auth** | hardcoded `{payment_method:'CREDIT_CARD'}` |
| `processCartPayments` | PUT `/orders/checkout/:cartId` | ✖ **raw axios, no auth** | the actual order-placement call |
| `refreshAccessToken` | POST `/auth/refresh` `{refreshToken}` | ✖ | stores new access+refresh tokens; extensive emoji logging incl. token previews |

Via `@halal-goes/auth` package (skimmed for context): POST `/auth/otp/request`, `/auth/otp/verify`, `/auth/register` (Bearer onboarding_token), `/auth/logout`; rider variants exist too. Supabase client (`lib/supabase.ts`, duplicated inside the package) uses `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` with SecureStore-backed session storage. Note: **`@halal-goes/auth` is not listed in users/package.json dependencies** — resolves only through workspace hoisting.

## 6. Realtime / WebSocket Order Pipeline

`stores/useWebSocketStore.ts` — singleton raw WebSocket to `process.env.EXPO_PUBLIC_WEBSOCKET` (`ws://98.130.76.223:9080` in .env.example).

Protocol (JSON `{event, data}`):
- On open, client sends `{event:'connect_user', data:{userId, userType:'user'}}`.
- Server pushes `{event:'notification', data:{type:'CHANNEL_JOIN', channelName}}` → client replies `{event:'join_channel', data:{channelName, user_id, userType:'user'}}` (tracked in `joinedChannels` Set; `leaveChannel` only deletes locally, never tells the server).
- Message fan-out to module-level `subscribers` Set; all messages also appended to unbounded `messages` array (memory leak over a long session).
- AppState listener reconnects on foreground (500 ms delay); `sendMessage` attempts reconnect if closed. No retry backoff, no auth on the socket beyond userId.

`hooks/orderWebSocket.ts` (`useOrderWebSocket`) parses two event families:
1. **`notification` / `data.type === 'checkout_update'`** — `status.step` ∈ PAYMENT_PROCESSING, ORDER_CREATING, ORDER_CREATED, RESTAURANT_NOTIFIED, WAITING_RESTAURANT_ACCEPTANCE, COMPLETED, FAILED; captures `checkout_id` and `order_id`. (This mirrors hg-api's Temporal checkout workflow steps.)
2. **`order_update`** — `data.type` ∈ ORDER_STATUS_UPDATE (nested status CONFIRMED/PREPARING/READY_FOR_PICKUP/PICKED_UP/ON_THE_WAY/DELIVERED/CANCELED, tolerating unseparated variants like READYFORPICKUP), ACCEPTED/RESTAURANT_ACCEPTED/CONFIRMED, REJECTED/RESTAURANT_REJECTED, PREPARING, ASSIGNMENT_STARTED, SEARCHING_RIDERS, RIDERS_FOUND, NOTIFICATION_WORKFLOW_STARTED, NO_RIDERS_FOUND, RIDER_ASSIGNED (captures riderId), READY_FOR_PICKUP, PICKED_UP, ON_THE_WAY, DELIVERED, ORDER_CANCELED, RIDER_LOCATION_UPDATE (`data.location {latitude, longitude}`), ESTIMATED_ARRIVAL_UPDATE, TRACKING_STARTED.

Exposes: orderStatus (21-value union), orderId, checkoutId, isProcessing, isFailed, message, riderId, riderLocation, estimatedArrival. Consumed by checkout, payments/success, restaurant-waiting, delivery-tracking. Each consumer screen instantiates its own hook (state resets across navigation; continuity relies on WS re-delivery + orderId param passing).

## 7. Checkout Data Flow (end-to-end)

1. Menu screen `useCart(userAddresses).addItemToCart(item)` → `PUT /carts/:userId` with full desired cart (delivery_address_id = `userAddresses[0].id` — **always the first address, not the selected one**) → response `CartResponse` → `useCartStore.addToCart` (server is source of truth; cartId captured) → invalidate `['cart-pricing', cartId]`.
2. Cart screen fetches `/pricing/:cartId` into `cartPricing` (displayed totals are hardcoded though).
3. Checkout screen opens WS connection; user picks address/instructions/tip.
4. select-payment: `useCheckoutPayload.getPayload()` = `{user_id, delivery_address_id: selectedAddress.id, payment_method_id, pricing: cartPricing (server-derived, NOT the hardcoded UI numbers, and excluding tip), metadata: {delivery_instructions, special_instructions?}}` → `PUT /orders/checkout/:cartId`; success screen shown optimistically before the request resolves.
5. Backend drives checkout via Temporal; progress arrives over WS (`checkout_update` steps) → restaurant-waiting → delivery-tracking (rider location streamed) → order-complete.

## 8. Auth / Security Model

- Phone OTP (Supabase-backed via shared package) → backend issues **onboardingToken** (new user) or **accessToken + refreshToken** (existing). Tokens stored in **plain AsyncStorage** keys `onboardingToken`, `accessToken`, `refreshToken` (SecureStore is available and used only for the Supabase session).
- JWT payload: `sub` = userId, `role`; expiry checked locally in `utils/getUserFromToken.ts`, proactive refresh through `POST /auth/refresh`, differentiated cleanup on refresh failure classes.
- zustand `user-auth-storage` also persists the whole session object (partialize includes `session`).
- Several money-adjacent endpoints called **without** auth header (checkout, payment-method creation, rider lookup) — relies entirely on backend enforcement.
- **Hardcoded Google Maps Android API key in app.json**: `AIzaSyD614SHSgC6FnrGsIj00_8SZJF5WznveSU` (committed). Directions API key comes from `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (public by Expo convention).
- `usesCleartextTraffic: true` on Android (needed for `ws://` and the commented http:// API URL) — weakens transport security.
- Heavy console logging of token previews (first 20 chars) and full WS payloads.

## 9. Configuration & Environment Variables

From `.env.example` and code:

| Var | Example value | Used by |
|---|---|---|
| `EXPO_PUBLIC_BASE_API_URL` | `https://api.halalgoes.com` (commented alt: `http://98.130.76.223:3456`) | axiosInstance + every API file + @halal-goes/auth |
| `EXPO_PUBLIC_WEBSOCKET` | `ws://98.130.76.223:9080` | useWebSocketStore |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | your-key | MapViewDirections (delivery-tracking) |
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | example | lib/supabase.ts + auth package |
| `EXPO_PUBLIC_FORM_ID` | 4 | **not referenced anywhere in this app** |
| `EXPO_PUBLIC_PAYLOD_URL` | `https://halalgoes.com` | **not referenced** (typo of PAYLOAD; likely Payload CMS from web app) |

AsyncStorage keys: `@has_onboarded`, `@is_logged_in` (read-only, never written), `accessToken`, `refreshToken`, `onboardingToken`, `user-auth-storage`, `user-storage`, `cart-storage`, `address-storage`, `delivery-instruction-storage`, `payment-method-storage`.

Build config (`eas.json`): dev (developmentClient, internal), preview (internal), production (autoIncrement, appVersionSource remote). `app.json`: portrait-only, light UI style, splash bg `#1B3B31`, iOS location/camera/mic usage strings, Android permissions FINE/COARSE_LOCATION, CAMERA, RECORD_AUDIO, INTERNET, ACCESS_NETWORK_STATE. `experiments.tsconfigPaths` true (imports like `stores/...`, `lib/...` resolve from baseUrl `.`; tsconfig also defines unused `~/* → src/*`).

## 10. Data Models & Types (types/, shared/)

- `types/user.ts`: `onboardingStatus = 'REGISTERED' | 'PHONE_VERIFIED' | 'ACTIVE' | 'PROFILE_PENDING'`.
- `types/restaurant.ts`: `Restaurant` (halal certification fields — is_halal_certified, halal_certification_docs/expiry, approval & ban fields, opening/closing_time, is_accepting_orders, total_orders_processed, soft-delete triplet, address[], menu[], cuisines[], categories[], `_count`), `FoodItem`, `FeedData`/`FeedResponse` (8 feed sections + search_metadata {personalized, order_history_influenced}).
- `types/menu.ts`: `MenuItem` (item_price & rating_avg as strings; `contains_diary` — API typo acknowledged in comment), `ItemVariant` (variant_type 'SIZE'|'QUANTITY'|'STYLE'|'SPICE_LEVEL', is_default_variant), `Menu`, `MenuResponse`, `GroupedMenuItems`.
- `types/foodItem.ts`: `SearchFoodItem` vs `FeedFoodItem` shapes + `UnifiedFoodItem`, normalized by `utils/foodItemHelpers.ts`.
- `types/restaurantData.ts`: **empty file (0 bytes)**. `shared/index.ts` also **empty**.
- `shared/feedSearch/index.ts`: search-API Restaurant/FoodItem incl. `ItemAddon`, `FoodOffer` (discount_percentage/amount, valid_from/until).
- `shared/shared.types.ts` (492 lines): grab-bag — icon components re-exported **cast to `any`** ("to avoid type errors"), address/UI/chat types (`Message`, `SenderType`), a full React-Navigation `RootStackParamList` + prop types (legacy, unused by expo-router), FAQ/help types.
- `stores/useCartStore.ts` also defines the canonical server cart-response types (CartResponse/CartItem/delivery_address with is_third_person fields).

## 11. Components

| Component | Notes |
|---|---|
| `BackButton` | chevron-back Pressable wrapper, router.back default. |
| `CustomTabBar` | Custom absolute-positioned 3-tab bar (Home/Cart/Profile) with active pill; cart tab shows `cartItems.length` (distinct line count, not quantity total). Uses invalid `activeOpacity` prop on Pressable. |
| `TabLayoutWrapper` | Adds bottom margin for tab bar; swaps in `FullAppSkeleton` for 1 s after splash. |
| `CustomCarousel` | reanimated-carousel wrapper with Pagination.Custom; used for promo & ad cards. |
| `LocationSelector` (`EnhancedLocationSelector`) | Home header address picker; query key `['addresses']` **without userId** (cache collision across accounts); reads `addressesResponse?.data` whereas cart/checkout treat the same endpoint response as a bare array — one of the two shapes is wrong; auto-selects first address; slide-up modal. |
| `Restaurant/RestaurantCard` + `RestaurantListCard` | feed cards; hardcoded '25-35 min' ETA, rating fallback '4.6'. |
| `FoodItem/FoodItemCard` + `FoodItemListCard` | UnifiedFoodItem cards; via.placeholder fallbacks. |
| `EmptyState`, `LogoutModal` (unused — account.tsx has its own inline modal), `SelectLocation/index.jsx` (dead, context-based, .jsx). |

## 12. Code-Quality Observations / Bugs

**Likely runtime bugs**
1. `delivery-tracking/index.tsx`: `Linking.openURL` used but `Linking` never imported → crash on "call rider". Also `import { React, useEffect… } from 'react'` (invalid named `React` import).
2. `axiosInstance` 401-retry sets header to `Bearer [object Object]` (refreshAccessToken returns object, not string).
3. Delivery-instruction chips: `instructionOptions` ids are `'door' | 'meet' | 'lobby'` but store/typing/backend expect `'DO_NOT_CALL' | 'DO_NOT_RING_BELL' | 'LEAVE_AT_DOOR'` — checkout sends lowercase UI ids in `metadata.delivery_instructions`.
4. `all-restaurants.tsx` reads `data?.restaurants_near_you` instead of `data?.data?.restaurants_near_you` → always empty; query fires with lat/lng 0,0.
5. `account-settings` sends `{name, …}` where backend expects `first_name/last_name` (UpdateUserPayload mismatch).
6. `LocationSelector` vs cart/checkout/saved-addresses disagree on `GET /users/:id/addresses` response shape (`.data` array vs bare array); LocationSelector's query key omits userId.
7. Cart/checkout price display hardcoded (delivery 5, platform 3 or 2, discount 0, "Delivering in 45 min", '25-35 min' ETAs) while real server pricing sits unused in `cartPricing`; checkout platformFee (2.0) ≠ cart platformFee (3). Tip is collected in UI but never sent (pricing payload has no tip field) — and tip buttons are `disabled` anyway.
8. select-payment navigates to success **before** payment/checkout API resolves (optimistic, with failure re-route later via WS/isFailed).
9. `useCart.addItemToCart`/`updateCartQuantity` always use `userAddresses[0].id`, ignoring `selectedAddress`; `removeItem` implemented as quantity −999.
10. Phone UX: +1 Canadian flag displayed, `+91` prefix applied in code; `formatPhoneNumberForDisplay` shows `+91`.

**Dead / vestigial code**
- Dead second entry point (App.tsx/index.ts/RootNavigator import of non-existent dir), dead `splash-screen.tsx` (routes to non-existent `/(tabs)`, `/(auth)/onboarding`, reads never-written `@is_logged_in`), 3 dead contexts, dead `SelectLocation/index.jsx`, unused `useUserMapStore` (SF coords), unused `LogoutModal`, unused `createUser` API, unused `mockRestaurant`/`paymentMethods`/`walletMethods`/dummyData files, empty `types/restaurantData.ts` and `shared/index.ts`, ~100 lines of commented-out WebSocket experimentation in select-payment (incl. malformed `ws://:9080`), commented-out `handleAddToCart` in restaurant screen.
- Vim swap files committed: `app/.inputOtp.tsx.swp`, `app/.user-details.tsx.swp`.
- Duplicate helpers: two different `getIconForAddressType` (utils/getIconForAddressType.ts → MaterialIcons names; utils/utils.shared.ts → Ionicons names) used interchangeably across screens; duplicated `formatTime` (utils/formatTime.ts + inline in home-screen); duplicated Restaurant/FeedResponse types in utils/homeUtils vs types/restaurant.ts.
- Home "Explore categories" all route to `/restaurant/1`; home auto-scroll interval targets a ref that is never attached.

**Mock-only features** (UI exists, no backend): promotions/promo codes (all expired 2024 dates), chats (rider/restaurant), add-card form, notifications, refunds, address delete/set-default/update, ratings & feedback submission, tip, recommended items, help issue reporting.

**TODOs found in code**: "Uncomment in production" (createAddress, updateCart), "Implement delivery time from backend", "Implement recommendation logic", "Implement promo code logic", "Implement tip selection logic", "hardcoded, needs to be changed after clarification" (cart fees), "Implement api call after clarification" (account settings), "Implement updateAddressMutation.mutate", "userAddresses doesn't need to be passed as an argument" (hooks/cart), types/menu "typo in API, should be dairy".

**Security-flavored notes**: committed Google Maps key in app.json; tokens in AsyncStorage not SecureStore; unauthenticated checkout/payment/rider API calls; cleartext traffic enabled; verbose PII/token logging; WS trusts client-provided userId with no token.

**Consistency notes**: mixed jQuery-of-currencies — everything displayed in `$` while phone flow is `+91`; map fallbacks span Hyderabad (home/onboarding) and Dubai (map-selector); `@halal-goes/auth` used but not declared in package.json; `expo doctor` exclusion for react-native-maps-directions; `newArchEnabled: false`; tailwind config declares unused custom `primary` blue palette; help layout registers non-existent `payment` route.

## 13. Integration Points Summary

- **hg-api REST** (`EXPO_PUBLIC_BASE_API_URL`): `/auth/otp/request`, `/auth/otp/verify`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/users` (+ `/:id`, `/:id/addresses`, `/:id/onboarding/profile`), `/feed/:userId` (+ `/search`), `/restaurants/:id` (+ `/menu`), `/carts/:userId`, `/pricing/:cartId`, `/orders/:orderId`, `/orders/checkout/:cartId`, `/payments/users/:userId/method`, `/riders/:riderId`.
- **WebSocket gateway** (`EXPO_PUBLIC_WEBSOCKET`, `ws://98.130.76.223:9080`): events `connect_user`, `join_channel` (client→server); `notification` (CHANNEL_JOIN, checkout_update), `order_update` (status machine + RIDER_LOCATION_UPDATE / ESTIMATED_ARRIVAL_UPDATE) (server→client). Mirrors Temporal checkout/order workflow steps in hg-api.
- **Supabase** (OTP/session, via `@halal-goes/auth` and local `lib/supabase.ts`).
- **Google Maps** (native map SDK key in app.json; Directions API via env key).
- **Workspace packages**: `@halal-goes/auth` (undeclared dep), `@repo/eslint-config` (devDep).
- **External URLs baked in**: flagcdn.com (CA flag), via.placeholder.com & picsum.photos & pexels/unsplash placeholders.
