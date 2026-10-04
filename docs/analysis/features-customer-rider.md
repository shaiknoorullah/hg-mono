# HalalGoes — Exhaustive Feature Inventory: Customer App & Rider App

**Purpose:** scope input for a from-scratch rebuild. Every user-facing capability that exists today (working or not), plus the gaps.
**Sources:** `/home/user/halal-goes/apps/users`, `/home/user/halal-goes/apps/rider` (read directly), cross-checked against the fleet digests `hg-fe-users-app.md` and `hg-fe-rider-app.md`.
**Date:** 2026-08-10

### Legend

| Field | Values |
|---|---|
| **Status today** | `WORKING` — real, wired to backend · `MOCK` — UI exists, hardcoded / local-state / console.log only · `BROKEN` — exists but has a named defect · `MISSING` — needed for a food-delivery app, absent |
| **Size** | `S` — under an hour of agent work · `M` — a few hours · `L` — a day or more |

Size is judged against a **clean rebuild** of that capability (UI + wiring + edge cases), not against the size of today's code.

---

## A. Customer App (`apps/users`)

Expo SDK 53 + expo-router v5, Zustand (8 stores) + React Query, axios to `hg-api`, raw WebSocket to the `:9080` notification gateway, phone-OTP auth via `@halal-goes/auth`.

### A1. Onboarding & Authentication

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 1 | Splash + auth bootstrap | As a returning user I open the app and land in the right place without logging in again. | WORKING — `app/index.tsx` animates logo, runs `initializeAuth()`, branches on `@has_onboarded` + `userDetails.state` (REGISTERED/PHONE_VERIFIED/PROFILE_PENDING → `/user-details`, ACTIVE → `/home-screen`). | `GET /users/:id`, `POST /auth/refresh`, JWT `sub`/`role` claims | M |
| 2 | Legacy second splash (`/splash-screen`) | — (dead screen, no user value) | BROKEN — reads `@is_logged_in` which is never written; navigates to `/(tabs)` and `/(auth)/onboarding`, route groups that do not exist. Delete on rebuild. | none | S |
| 3 | Onboarding carousel | As a new user I see 3 intro slides explaining the app before I sign up. | WORKING — `app/onboarding.tsx`, pan-gesture + FlatList paging, sets `@has_onboarded=true`. | none (static copy) | S |
| 4 | Location permission + first GPS fix | As a new user the app asks for my location so it can show nearby restaurants. | WORKING — geolocation captured in onboarding into `useUserStore`; falls back to Hyderabad (17.385, 78.487) on denial. | none | S |
| 5 | Phone number entry | As a user I enter my mobile number to sign in. | BROKEN — UI renders a Canadian `+1` flag (flagcdn.com/ca) but `formatPhoneNumberForDisplay` and the submit path both prefix `+91`; zod `phoneSchema` hardcodes exactly 10 digits, so no other country can sign up. | `POST /auth/otp/request` | M |
| 6 | Send OTP | As a user I receive a one-time code by SMS. | WORKING — `useAuth.sendOtp` → `authService` (Supabase-backed OTP send + backend endpoint), role `'user'`. | `POST /auth/otp/request`, SMS provider | M |
| 7 | OTP entry (6 boxes, paste-split, backspace nav) | As a user I type or paste the 6-digit code and it auto-advances. | WORKING — `app/inputOtp.tsx`, zod `otpSchema`; new user → `/user-details`, existing → `/home-screen`. | `POST /auth/otp/verify` | M |
| 8 | Resend OTP | As a user who didn't get the code I can ask for a new one. | WORKING — `handleResendCode`, no cooldown timer or attempt cap. | `POST /auth/otp/request` (rate limit) | S |
| 9 | Profile completion | As a new user I give my name, email and date of birth before I can order. | WORKING — `app/user-details.tsx`, zod `userDetailsSchema` (≥13 years old), mutation → `PUT /users/:id/onboarding/profile`, then patches `useAuth` + `useUserStore`. | `PUT /users/:id/onboarding/profile` | M |
| 10 | Session persistence + silent token refresh | As a user I stay logged in across app restarts. | BROKEN — tokens persisted, but the axios 401 interceptor does `Bearer ${newToken}` where `refreshAccessToken()` returns `{success, accessToken}` → header becomes `Bearer [object Object]`, so every 401 retry fails and the user is silently logged out. Tokens sit in plain AsyncStorage, not SecureStore. | `POST /auth/refresh` | M |
| 11 | Logout | As a user I can sign out and have my cart and data cleared. | WORKING — `account.tsx` modal → `useAuth.logout()` + `clearCart()` → `/inputNo`. | `POST /auth/logout` | S |
| 12 | Delete my account | As a user I can permanently delete my account and data. | MISSING — no screen, no endpoint call (privacy/store-compliance requirement). | `DELETE /users/:id` (+ data erasure job) | M |
| 13 | Email / social / password login | As a user I can sign in with Google/Apple/email instead of SMS. | MISSING — phone OTP is the only path in this app. | OAuth providers, `/auth/*` variants | L |

### A2. Home Feed & Discovery

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 14 | Personalized home feed | As a hungry user I open the app and see restaurants picked for me near my location. | WORKING — `useQuery(['home', userId, lat, lng])` → `GET /feed/:userId?lat&lng`; response carries `search_metadata {personalized, order_history_influenced}`. | `GET /feed/:userId` with geo + personalization | L |
| 15 | "Order again" section | As a repeat customer I can quickly find the places I ordered from before. | WORKING — `order_again` feed section rendered as restaurant cards. | feed section `order_again` (order history) | S |
| 16 | "Your favourite restaurants" section | As a user I see the restaurants I order from most. | WORKING — `your_favourite_restaurants` feed section. | feed section | S |
| 17 | "Restaurants near you" section | As a user I see what's close enough to deliver to me. | WORKING — `restaurants_near_you` feed section (geo-ranked). | feed section + geo index | S |
| 18 | "Trending in your area" section | As a user I see what's popular around me right now. | WORKING — `trending_in_your_area` feed section. | feed section | S |
| 19 | "You might like" section | As a user I get recommendations based on my taste. | WORKING — `you_might_like.restaurants` feed section. | feed recommender | S |
| 20 | "Popular items" section | As a user I can add a popular dish straight from the home screen. | WORKING — `popular_items` rendered via `FoodItemCard` after `normalizeFeedFoodItem`. | feed section | M |
| 21 | Promo / ad carousels on home | As a user I see current offers and campaigns on the home screen. | MOCK — `promotionCards` and `adCards` are static arrays in `utils/dataUtils`; `CustomCarousel` renders them; no campaign API. | campaigns/banners API | M |
| 22 | Category browsing ("Explore categories") | As a user I tap a cuisine/category to browse just that food. | BROKEN — 4 hardcoded categories; **every** category press routes to `/restaurant/1` (a literal id). No category API. | `GET /categories`, `GET /feed?category=` | M |
| 23 | Header address selector | As a user I switch which saved address I'm ordering to, from the home header. | BROKEN — `LocationSelector` uses query key `['addresses']` **without userId** (cache bleeds across accounts) and reads `response.data` while cart/checkout/saved-addresses read the same endpoint as a bare array — one shape is wrong. Auto-selects the first address. | `GET /users/:id/addresses` | M |
| 24 | "See all" restaurants list | As a user I expand a home section into a full list. | BROKEN — `all-restaurants.tsx` reads `data?.restaurants_near_you` instead of `data?.data?.restaurants_near_you` → always renders empty; local lat/lng start at `0,0` and the query has no `enabled` guard so it fires against the null island. | `GET /feed/:userId` (paginated) | M |
| 25 | Pull-to-refresh feed | As a user I pull down to get fresh results. | WORKING — RefreshControl on home. | feed API | S |
| 26 | Double-back-to-exit | As an Android user pressing back twice on home exits instead of going to login. | WORKING — BackHandler on `home-screen`. | none | S |
| 27 | Search restaurants & dishes | As a user I type a dish or restaurant name and see matching results. | WORKING — `app/search.tsx`, 80 ms debounce, min 3 chars, `useInfiniteQuery` → `GET /feed/:userId/search?q&limit=10&page`, paginates on `pagination.has_next_page`, renders Restaurants + Food Items groups. | `GET /feed/:userId/search` | M |
| 28 | Popular / suggested search chips | As a user I tap a suggested term instead of typing. | MOCK — static chip list, no trending-search API. | trending searches endpoint | S |
| 29 | Restaurant detail page | As a user I open a restaurant and see its info and full menu. | WORKING — `GET /restaurants/:id` + `GET /restaurants/:id/menu`. Caveat: hero image is a **hardcoded local asset** (`crescent-cafe1.jpeg`), not the restaurant's own image. | `GET /restaurants/:id`, `/menu` | M |
| 30 | Menu category tabs | As a user I jump between Starters / Mains / Drinks inside a restaurant. | WORKING — tabs derived from `menu_items[].category.name`. | menu categories in `/menu` | S |
| 31 | In-restaurant menu search | As a user I search within one restaurant's menu. | BROKEN — search overlay filters correctly but tapping a result only fires `Alert.alert('Item Selected', item.name)`; it cannot add to cart or scroll to the item. | none (client-side) | S |
| 32 | Veg / non-veg / allergen labelling | As a user with dietary needs I see which items are non-veg and what allergens they contain. | WORKING — `is_non_veg` chip + `allergens[]` chips rendered from the menu payload. Note the API field typo `contains_diary` (should be `dairy`) is carried into `types/menu.ts`. | menu item `is_non_veg`, `allergens[]` | S |
| 33 | Halal certification display | As a Muslim customer I want to see that a restaurant is halal-certified before I order. | MISSING at the UI level — `Restaurant` type carries `is_halal_certified`, `halal_certification_docs`, `halal_certification_expiry`, but no screen renders any of it. This is the product's core differentiator. | restaurant halal fields (already exist) | S |
| 34 | Add item to cart from menu | As a user I tap "+" on a dish and it goes into my cart. | BROKEN — works, but `useCart.addItemToCart` auto-selects `item_variants[0]` with no picker, sends `selected_addon_ids: []` always, and hardcodes `delivery_address_id: userAddresses[0].id` (ignores the selected address). | `PUT /carts/:userId` | M |
| 35 | Variant selection (size / spice level / style) | As a user I choose Large vs Regular, or my spice level, before adding to cart. | MISSING — `ItemVariant` with `variant_type` SIZE/QUANTITY/STYLE/SPICE_LEVEL and `is_default_variant` exists in the types and the cart payload accepts `selected_variant_id`, but no picker UI exists. | menu variants (already in API) | M |
| 36 | Add-on / extras selection | As a user I add extra cheese or a drink to my item. | MISSING — `selected_addon_ids` is in the cart payload and `ItemAddon` is in the search types; no UI. | menu addons (already in API) | M |
| 37 | Item detail sheet | As a user I tap a dish to read the full description and photos before adding it. | MISSING — items are added straight from the list row. | menu item detail (already in `/menu`) | M |
| 38 | Restaurant open/closed & accepting-orders gating | As a user I'm told a restaurant is closed instead of being allowed to order and then rejected. | MISSING — `opening_time`, `closing_time`, `is_accepting_orders` exist on the `Restaurant` type but nothing checks or displays them. | restaurant hours fields (already exist) | M |
| 39 | Floating "View cart" bar | As a user I see a persistent bar to jump to my cart while browsing a menu. | WORKING — floating button on restaurant detail. | cart store | S |
| 40 | Save / favourite a restaurant | As a user I bookmark a restaurant to find it later. | MISSING — the feed has a `your_favourite_restaurants` section but nothing in the app can add to it. | favourites CRUD | M |
| 41 | Filters & sort (cuisine, rating, price, veg-only, delivery time) | As a user I narrow a long list down to what I want. | MISSING — no filter or sort UI anywhere. | feed/search filter params | L |
| 42 | Restaurant reviews & ratings display | As a user I read what other customers said before ordering. | MISSING — only a numeric `rating_avg` (with a hardcoded `'4.6'` fallback in `RestaurantCard`) is shown; no review list. | reviews API | M |

### A3. Cart

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 43 | Cart list, server-synced | As a user my cart survives app restarts and matches what the server thinks I have. | WORKING — every mutation calls `PUT /carts/:userId` with the full desired cart and the server response replaces local state (`useCartStore.addToCart`). | `PUT /carts/:userId` | M |
| 44 | Increase / decrease quantity | As a user I change how many of an item I want. | WORKING (with the address bug from #34) — `updateCartQuantity` rebuilds and PUTs the whole cart. | `PUT /carts/:userId` | S |
| 45 | Remove a single item | As a user I delete one item from my cart. | WORKING but hacky — implemented as `updateCartQuantity(id, -999)` rather than an explicit removal. | `PUT /carts/:userId` | S |
| 46 | Clear cart with confirmation modal | As a user I empty my whole cart in one action, with an "are you sure". | WORKING — modal → `removeAllItems` → `PUT /carts/:userId` with `cart_items: []`. | `PUT /carts/:userId` | S |
| 47 | Cart price breakdown | As a user I see subtotal, fees and discount before I check out. | BROKEN — `GET /pricing/:cartId` **is** fetched and stored into `cartPricing`, but every rendered line is hardcoded (`deliveryFee = 5`, `platformFee = 3`, `discount = 0`) with the real `cartPricing.*` lines commented out inline. Checkout then shows `platformFee = 2` — the two screens disagree. | `GET /pricing/:cartId` | M |
| 48 | Empty-cart state | As a user with nothing in my cart I get a friendly prompt to start browsing. | WORKING — illustration + "Order Now" → home. | none | S |
| 49 | Different-restaurant cart guard | As a user adding from a second restaurant, I'm asked whether to replace my cart. | MISSING in the live app — the logic exists only in the **dead** `contexts/CartContext.tsx` that nothing mounts. Today a second restaurant's items silently join the same cart. | cart restaurant constraint | M |
| 50 | Cart badge on the tab bar | As a user I see how many items are waiting in my cart. | BROKEN — `CustomTabBar` shows `cartItems.length` (number of distinct lines), not the sum of quantities. Also passes an invalid `activeOpacity` prop to `Pressable`. | cart store | S |
| 51 | Coupon applied to cart | As a user my promo discount shows up in the cart total. | MISSING — `CartPayload.coupon_codes` is always sent as `[]`. | coupon validation in `/carts` + `/pricing` | M |

### A4. Checkout

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 52 | Checkout screen + WebSocket connect | As a user I review everything and open a live channel so I get order updates. | WORKING — `connect(userId)` on mount, `useOrderWebSocket()` subscribed. | WS gateway `connect_user` | M |
| 53 | Delivery address picker at checkout | As a user I confirm or change where the order goes. | BROKEN — the modal correctly sets `selectedAddress`, but the header row renders `addresses?.[0]` regardless of selection, so the user sees the wrong address; and the cart PUT still uses `userAddresses[0].id`. | `GET /users/:id/addresses` | M |
| 54 | Delivery-time estimate | As a user I know roughly when my food will arrive. | MOCK — literal string "Delivering in 45 min" with a `// TODO: Implement delivery time from backend` above it. Restaurant cards separately hardcode "25-35 min". | ETA service (prep time + distance) | M |
| 55 | Delivery instruction chips | As a user I tell the rider to leave it at the door / not ring the bell. | BROKEN — `instructionOptions` ids are `'door' \| 'meet' \| 'lobby'` but `useDeliveryInstructionStore` and the backend expect `'DO_NOT_CALL' \| 'DO_NOT_RING_BELL' \| 'LEAVE_AT_DOOR'`; checkout sends the lowercase UI ids in `metadata.delivery_instructions`. Also the three labels shown ("Leave at door / Meet at door / Meet at lobby") don't map onto the three backend codes. | order metadata | S |
| 56 | Special instructions free text | As a user I type a note for the rider. | WORKING — modal → `useDeliveryInstructionStore.specialInstructions` → `metadata.special_instructions`. | order metadata | S |
| 57 | Tip the rider | As a user I add a tip before paying. | BROKEN — the four buttons ($2/$3/$5/Custom) are `disabled` with a `// TODO: Implement tip selection logic`; the custom-tip modal exists and the tip is added to the displayed "To Pay" total, but the checkout payload's `pricing` block has **no tip field**, so any tip would be charged in the UI and never reach the backend or the rider. | tip field in order/pricing, rider payout | M |
| 58 | Promo code at checkout | As a user I apply a discount code before paying. | BROKEN — the whole promo Pressable is `disabled` (`// TODO: Implement promo code logic`); it would route to `/promotion`, which is itself mock (#78). | coupon validation | M |
| 59 | Recommended items upsell | As a user I'm offered a drink or dessert before I pay. | MOCK — 3 hardcoded items from `utils/utils.shared`, all `disabled`, `// TODO: Implement recommendation logic`. | recommendations API | M |
| 60 | Order summary totals | As a user I see the exact amount I'm about to be charged. | BROKEN — hardcoded `deliveryFee = 5.0`, `platformFee = 2.0`; the server-derived `cartPricing` is what actually gets sent in the checkout payload, so **the number the user agrees to is not the number submitted**. | `GET /pricing/:cartId` | M |
| 61 | Minimum-order / delivery-radius enforcement | As a user I'm told when my order is too small or the restaurant is too far. | MISSING — no check anywhere. | min order + radius rules | M |
| 62 | Scheduled / later delivery | As a user I order now for 7pm tonight. | MISSING. | scheduled order support | L |
| 63 | Contactless drop-off photo request | As a user I ask the rider to photograph the drop. | MISSING (rider side has no capture either — see #114). | proof-of-delivery storage | M |

### A5. Payment

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 64 | Saved payment method list | As a user I pick from the cards I've saved. | BROKEN/MOCK — the list is read from the **locally persisted** `usePaymentMethodStore` only; there is no `GET` of the user's payment methods, so it is empty on a fresh install and can drift from the backend. | `GET /payments/users/:id/methods` | M |
| 65 | "Add New Card" (quick add) | As a user I register a card to pay with. | BROKEN — `POST /payments/users/:id/method` with a hardcoded body `{payment_method:'CREDIT_CARD'}` and **no card data at all**, sent via raw axios with **no Authorization header**. | tokenized card vaulting (PSP) | L |
| 66 | Card entry form (`/payments/add-card`) | As a user I type my card number, expiry and CVV. | MOCK — formats the number/expiry/CVV and detects Visa/Mastercard/Amex client-side, then "Add Card" only fires an `Alert`. Nothing is stored or transmitted. **Raw PAN in app memory** — must be replaced by a PSP SDK/iframe on rebuild. | PSP SDK | L |
| 67 | Cash on delivery | As a user I pay the rider in cash. | MISSING — `'CASH_ON_DELIVERY'` exists in the `PaymentMethod` union, but there is no UI to choose it and no rider-side cash collection. | COD flag on order, rider cash reconciliation | M |
| 68 | Place the order | As a user I press Pay and my order is submitted. | BROKEN — `processCartPayments` = `PUT /orders/checkout/:cartId` via **raw axios with no auth header**; and `select-payment` calls `router.push('/payments/success')` **before** the request resolves, so the user sees "Payment Successful!" even if the call fails (recovery only happens later via a WS failure event). | `PUT /orders/checkout/:cartId` (Temporal checkout workflow) | L |
| 69 | Payment success screen + handoff | As a user I get confirmation and then watch the restaurant accept. | WORKING — listens to `useOrderWebSocket`; on ORDER_CREATED / RESTAURANT_NOTIFIED / WAITING_RESTAURANT_ACCEPTANCE → `/restaurant-waiting?orderId`; on failure → `clearCart` → `/reject-order`. Ships a `__DEV__` debug panel. | WS `checkout_update` steps | S |
| 70 | Payment failed screen | As a user whose payment failed I'm told and can retry. | WORKING (static) — "Try again" is just `router.back()`; only reachable from `processPayment.onError`. | none | S |
| 71 | Real payment gateway integration | As a user my money actually moves. | MISSING — there is no Stripe/Adyen/Razorpay SDK anywhere in the app; nothing is ever charged. | PSP integration end-to-end | L |
| 72 | Wallet / stored balance | As a user I pay from an in-app wallet. | MISSING — a dead `walletMethods` fixture exists, nothing else. | wallet ledger | L |

### A6. Order Lifecycle, Tracking & History

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 73 | Waiting-for-restaurant screen | As a user I watch a spinner while the restaurant decides. | WORKING — on CONFIRMED/PREPARING/…/RIDER_ASSIGNED/COMPLETED → `clearCart` → `/delivery-tracking?orderId`; on REJECTED/FAILED/NO_RIDERS_FOUND/ORDER_CANCELED → `/reject-order`. | WS `order_update` | M |
| 74 | Order-rejected screen | As a user whose order was refused I'm told why. | WORKING — shows the rejection reason, auto-redirects home after 2 s (too fast to read; no retry or refund path). | WS rejection payload | S |
| 75 | Realtime order status stream | As a user my screen updates itself as the order moves through its stages. | WORKING — `hooks/orderWebSocket.ts` handles a 21-value status union across two event families (`notification`/`checkout_update` and `order_update`), tolerating unseparated variants like `READYFORPICKUP`. Caveats: the socket authenticates on a client-supplied `userId` with **no token**; every message is appended to an unbounded `messages` array (leak); each screen instantiates its own hook so state resets on navigation; `leaveChannel` never tells the server. | WS gateway + Temporal order workflow | L |
| 76 | 3-step delivery timeline | As a user I see Preparing → Picked Up → Arriving. | WORKING — animated timeline driven by `orderStatus`. | WS status | M |
| 77 | Live map with rider position | As a user I watch my rider move toward me. | WORKING — `react-native-maps` (Google) with rider + user markers, `MapViewDirections` polyline via `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`; recentres on each `RIDER_LOCATION_UPDATE`. | WS `RIDER_LOCATION_UPDATE`, Google Directions | L |
| 78 | ETA display | As a user I see what time my food arrives. | WORKING (conditional) — renders `Arriving at {estimatedArrival}` from the WS `ESTIMATED_ARRIVAL_UPDATE` event, falling back to "Calculating…" whenever the backend doesn't emit it. | WS `ESTIMATED_ARRIVAL_UPDATE` | S |
| 79 | Rider card (name, photo, rating, vehicle) | As a user I know who is bringing my food. | WORKING — `GET /riders/:riderId` (riderId arrives over WS). Caveat: called via **raw axios with no auth header**, and exposes the rider's full record incl. earnings/ratings to the customer app. | `GET /riders/:id` (needs a slimmed public projection) | M |
| 80 | Call the rider | As a user I phone the rider if I can't be found. | BROKEN — `Linking.openURL('tel:…')` is used but `Linking` **is never imported** → ReferenceError crash on tap. The same file also does `import { React, useEffect… } from 'react'` (invalid named import, only survives via the JSX transform). | rider phone in order payload | S |
| 81 | Chat with the rider | As a user I message my rider instead of calling. | MOCK — `delivery-tracking/chats/rider.tsx` is hardcoded messages with the header "Jason Miller"; sending only appends to local state; no WebSocket, no persistence. | chat service (messages, history, delivery receipts) | L |
| 82 | Chat with the restaurant | As a user I message the restaurant about my order. | MOCK — same component, header hardcoded "Quinoa - The Kitchen". | chat service | L |
| 83 | Help link from tracking | As a user with a problem mid-delivery I get help fast. | BROKEN — uses `navigation.navigate('help')` from `@react-navigation` inside an expo-router app. | none | S |
| 84 | Order-delivered + rating screen | As a user I rate the food and the delivery after it arrives. | MOCK — `order-complete.tsx` collects two 5-star ratings and two free-text fields, then only `console.log`s them with `⚠️ Note: Rating and feedback submission not yet implemented in backend` and shows a success Alert. The user is told their feedback was submitted when it was not. | ratings/reviews API | M |
| 85 | Post-delivery tip | As a user who forgot to tip I can add one after delivery. | MISSING. | tip-after-delivery + payout | M |
| 86 | Order history ("Your Orders") | As a user I look back at what I ordered and when. | MISSING — the Account menu entry "Your Orders / Track and manage orders" exists **with no `onPress`**; there is no list endpoint call anywhere (only `GET /orders/:orderId` for the active order). | `GET /users/:id/orders` | M |
| 87 | Active-order resume banner | As a user who backgrounded the app I can get back to my live order. | MISSING — if you leave `/delivery-tracking`, nothing on home tells you an order is in flight. | active order lookup | M |
| 88 | Re-order | As a user I repeat a previous order in one tap. | MISSING — the feed has an `order_again` section but it only links to the restaurant. | order → cart clone | M |
| 89 | Cancel my order | As a user I cancel before the restaurant starts cooking. | MISSING — the Help FAQ *tells* the user to "go to Your Orders and tap Cancel Order", a flow that does not exist. Only the backend can cancel (`ORDER_CANCELED` arrives over WS). | `POST /orders/:id/cancel` + refund | M |
| 90 | Modify order / add items after placing | As a user I add a forgotten drink before cooking starts. | MISSING — again promised in the FAQ copy, absent in the app. | order amendment | L |
| 91 | Order receipt / invoice | As a user I want an itemised receipt I can keep or expense. | MISSING. | receipt generation | M |

### A7. Profile, Addresses & Settings

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 92 | Account hub | As a user I open a profile page with everything about my account. | WORKING — merges `useAuth` → `useUserStore` → `GET /users/:id`; sectioned menu from `utils/utils.shared.sections`; profile-completion prompt. | `GET /users/:id` | M |
| 93 | Edit name & email | As a user I fix my name or email. | BROKEN — sends `PUT /users/:id` with `{name, phone, email}` while `UpdateUserPayload` (and the backend) expect `first_name` / `last_name`. Also imports `createAppAuth` unused. | `PUT /users/:id` | S |
| 94 | Phone shown locked + "Verified" badge | As a user I see my verified number and can re-verify if it isn't. | WORKING — unverified taps route back to `/inputNo`. | user `phone_verified` | S |
| 95 | Change phone number | As a user who switched numbers I move my account. | MISSING — phone is read-only with no change flow. | phone-change + re-OTP | M |
| 96 | Saved addresses list | As a user I see all my delivery addresses with the default marked. | WORKING — `GET /users/:id/addresses`, Default badge, Edit → `/add-address?editAddressId=`. | `GET /users/:id/addresses` | S |
| 97 | Add a new address | As a user I save a new place to deliver to. | WORKING — zod `addressSchema` (street, apartment, floor, landmark, suburb, postal_code all required), custom address types, conditional third-person fields (ordering for someone else) → `POST /users/:id/addresses`. Coordinates must come from the map picker. | `POST /users/:id/addresses` | M |
| 98 | Edit an existing address | As a user I correct a saved address. | BROKEN — edit mode loads the form and the Update button renders, but the update mutation is a commented-out `// TODO: Implement updateAddressMutation.mutate` — the button does nothing. | `PUT /users/:id/addresses/:addressId` | S |
| 99 | Delete an address | As a user I remove an address I no longer use. | MOCK — shows a success Alert; the API call is commented out and the row stays. | `DELETE /users/:id/addresses/:addressId` | S |
| 100 | Set default address | As a user I choose which address is used by default. | MOCK — success Alert only, API call commented out. | `PATCH .../default` | S |
| 101 | Map picker for coordinates | As a user I drop a pin on the map so the rider finds me. | WORKING — `map-selector.tsx`, current GPS or previous coords, tap-to-select → `useAddressStore.setCoordinates`. Fallback location is **Dubai** (25.2048, 55.2708) while the rest of the app falls back to Hyderabad. | none (Google Maps) | M |
| 102 | Address autocomplete / reverse geocoding | As a user I type "221B Baker" and pick it, instead of filling seven fields. | MISSING — the whole address is manual data entry. | Places/geocoding proxy | M |
| 103 | Notifications inbox | As a user I read order and offer notifications in the app. | MOCK — `notification-screens.tsx` is a permanently static "No New Notifications" empty state. | notifications API | M |
| 104 | Push notifications | As a user I get told my order was accepted / a rider is assigned / it's arriving, even with the app closed. | MISSING — no `expo-notifications`, no push token registration, no permission request. Order updates only arrive while the app is foregrounded on a WS connection. | push service (FCM/APNs) + token registry | L |
| 105 | Promotions / promo codes screen | As a user I browse available offers and apply one. | MOCK — `promotion.tsx` is a fully self-contained fake engine: hardcoded promo cards and codes (SAVE20, FIRST15, DELIVERY5, WEEKEND10, STUDENT25, LOYAL30) all with `validUntil` dates in **2024** (expired), applied to local state only; the discount never reaches cart, checkout or the order payload. | campaigns + coupon validation | L |
| 106 | Refund status | As a user I track a refund I'm owed. | MOCK — static "No Refunds Yet"; the empty-state icon is a `via.placeholder.com` remote URL. | refunds API | M |
| 107 | Request a refund | As a user with a wrong or missing order I ask for my money back. | MISSING. | refund request + approval workflow | L |
| 108 | Legal & About | As a user I read the terms, privacy policy and app version. | BROKEN — `legal.tsx` renders `LegalmenuItems`, whose content still contains unreplaced `[App Name]` and `[Date]` placeholders. Ships as-is. | CMS or bundled copy | S |
| 109 | Help hub + FAQ screens | As a user I look up how tracking, modification, payments and rider issues work. | WORKING (static content) — `/help` hub plus 5 sub-screens. Note the FAQ text promises cancel/modify/reschedule flows that don't exist (#89, #90). The help `_layout` also registers a non-existent `payment` screen alongside `payments`. | none | M |
| 110 | Report an issue (rider issues) | As a user I report a problem with my rider. | MOCK — the form submits to local state only. | support ticket API | M |
| 111 | Other issues: category grid + search | As a user I find help by category. | MOCK — static `commonIssues` list, client-side filter only. | help content API | S |
| 112 | Live support chat / contact support | As a user I talk to a human. | MISSING. | support channel | L |
| 113 | Dead account-menu entries | — | MOCK — five menu rows render with **no `onPress`** and silently `console.log` on tap: "Your Orders", "Payment Methods", "Give Feedback", "Rate App", "Refer Friends", "Become a Rider", "Privacy Settings". | various | M |
| 114 | Bottom tab bar (Home / Cart / Profile) | As a user I move between the three main areas. | WORKING — `CustomTabBar`, shown by the root layout only on `/home-screen`, `/cart`, `/account`. | none | S |
| 115 | Global skeleton loader | As a user I see shimmer placeholders instead of a blank screen after splash. | WORKING — `useGlobalSkeleton` + `FullAppSkeleton`, auto-hides after 1 s (time-based, not data-based). | none | S |
| 116 | Offline / no-connection handling | As a user on a bad connection I'm told, rather than staring at an empty screen. | MISSING — NetInfo is wired into React Query's `onlineManager` but there is no offline UI, banner or retry affordance (the rider app has one; the customer app does not). | none | M |
| 117 | Localization / multi-currency | As a user I see prices in my currency and the app in my language. | BROKEN by inconsistency — everything is displayed in `$` while the phone flow forces `+91` (India) and the flag shows Canada; no i18n layer exists. | locale/currency on user + pricing | L |
| 118 | 404 / not-found route | As a user who hits a bad link I get a way back. | WORKING — `+not-found.tsx` with Home/Back. | none | S |

---

## B. Rider App (`apps/rider`)

Expo SDK 53 + expo-router, Zustand (5 stores + a third parallel auth wrapper), React Query in 3 screens, axios to `hg-api`, raw WebSocket to `:9080`, MinIO presigned uploads for KYC.

### B1. Rider Onboarding & KYC

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 1 | Splash + 8-way onboarding routing | As a rider I open the app and land at whatever onboarding step I'd reached. | WORKING — `app/index.tsx` runs `initializeAuth()` + `loadApprovalStatus()`, then branches on approved / submitted / authenticated / email / profile / vehicle / `onboarding_state`. Logs a full "Navigation Debug" object every launch. | `GET /riders/:id`, `GET /riders/:id/onboarding/status` | L |
| 2 | Legacy second splash (`/splash`) | — (dead) | MOCK/dead — 10 s animation → `/onboarding`; unreachable. Delete on rebuild. | none | S |
| 3 | Rider onboarding carousel | As a prospective rider I see 3 slides about earning with HalalGoes. | WORKING — `utils/_utils.tsx` slides, Skip/Next/Get Started → `/inputNo`. | none | S |
| 4 | Phone entry | As a rider I enter my number to sign up or sign in. | BROKEN — same mixed-market defect as the customer app: `+1` Canada flag in the UI, `+91` prefixing in `useAuth.verifyOtp`, and `formatPhoneNumberForDisplay` renders `+1`. | `POST /auth/rider/otp/request` | M |
| 5 | Apple / Google / Facebook sign-in buttons | As a rider I sign in with a social account. | MOCK — the three buttons render on `/inputNo` and do nothing. | OAuth | L |
| 6 | Send / verify OTP (6-digit) | As a rider I confirm my number with a code. | WORKING — react-hook-form; new rider ⇒ `onboardingToken` stored, existing ⇒ access+refresh tokens then `GET /riders/:id` hydrates `useRiderStore`. | `/auth/rider/otp/request`, `/auth/rider/otp/verify` | M |
| 7 | Post-OTP routing (9 branches) | As a rider I resume onboarding at the right step after logging in. | BROKEN — the SecureStore `hasSubmitted` flag is evaluated **before** `userData.is_approved`, so an approved rider with a stale flag is sent to `/documentReview` instead of home; and the branch commented "9. Fallback - go to home" actually routes to `/inputNo`. There is also a 4-digit legacy `useOtpScreen` hook wired alongside the real 6-digit screen. | onboarding status | M |
| 8 | Email capture + token exchange | As a new rider I give my email and get a real session. | WORKING — `/emailInput` → `updateRiderDetails(email)` → `POST /auth/rider/register` with the onboarding token, swapping it for access+refresh tokens. | `POST /auth/rider/register` | M |
| 9 | "Let's set up" interstitial + change phone | As a rider I start registration, or go back and use a different number. | WORKING — "change phone" performs a logout. | `/auth/logout` | S |
| 10 | Complete profile (first/last name, DOB ≥18) | As a rider I give my legal name and date of birth. | WORKING — zod validated → `POST /riders/:id/onboarding/profile` → `/rider-verification`. | `POST /riders/:id/onboarding/profile` | M |
| 11 | Vehicle information | As a rider I register the vehicle I'll deliver on. | WORKING — type CAR/BIKE/SCOOTER + model/colour/plate (BIKE auto-fills "N/A") → `POST /riders/:id/onboarding/vehicle`. | `POST /riders/:id/onboarding/vehicle` | M |
| 12 | Document checklist (4 docs + 3 expiry dates) | As a rider I see exactly which documents I still owe. | WORKING — driver's licence, vehicle registration, vehicle insurance, profile photo; per-document status; expiry required (DateTimePicker, min today) for the three non-photo docs; final submit is blocked with a named list of what's missing. | onboarding document state | L |
| 13 | Capture a document with the camera | As a rider I photograph my licence in the app. | WORKING — `expo-image-picker` camera flow in `DocumentUploadScreen`, permissions requested. | none | M |
| 14 | Pick a document from files (incl. PDF, HEIC) | As a rider I upload a PDF insurance certificate. | WORKING — `expo-document-picker`, content-type inferred from extension. | none | M |
| 15 | Presigned-URL upload + confirm | As a rider my document actually reaches the platform securely. | WORKING — `POST /riders/:id/onboarding/documents/upload-url` → PUT to the MinIO presigned URL → `POST .../documents/confirm`; returned doc id stored on `userData.<field>_id`. **Defect:** the upload-url call hardcodes `https://api.halalgoes.com/...`, bypassing `EXPO_PUBLIC_BASE_API_URL` (so it never works against a dev backend); `expo-file-system` is imported but not a declared dependency. | presigned URLs + MinIO/S3 | L |
| 16 | Submit documents for review | As a rider I send everything off for approval. | WORKING — `POST /riders/:id/onboarding/documents` with the 4 ids + 3 expiry dates → `/documentReview`. | document submission | M |
| 17 | Review-status polling screen | As a rider I watch for my approval decision. | BROKEN — polls `GET /riders/:id/onboarding/status` and routes by state, but `STRIPE_PENDING` navigates to `/stripe-onboarding`, **a route that does not exist** (404 dead end). | onboarding status | M |
| 18 | Rejection screen with reasons | As a rejected rider I learn what to fix and resubmit. | MOCK — `documentRejection.tsx` shows hardcoded example reasons; the real `rejection_reason` from the status API is not rendered and there is no resubmit path. | `rejection_reason` (already returned) | M |
| 19 | Legacy 5-document Supabase flow (`/documents/*`) | — (superseded) | BROKEN — captures 5 docs (adds id-proof, police-verification, which have **no backend equivalent**), uploads to Supabase bucket `hg-bucket` and inserts a `rider` row with `is_approved:'pending'`, using env vars (`EXPO_PUBLIC_SUPABASE_REGISTRATION_*`) that are **absent from `.env.example`** — it would crash if reached. The original Payload CMS submission is commented out but the class is still `PayloadFormService`. Delete on rebuild. | none | S |
| 20 | Stripe / payout account onboarding | As a rider I connect a bank account so I can actually be paid. | MISSING — `STRIPE_PENDING` is a real backend state with no client implementation at all. | Stripe Connect (or equivalent) | L |
| 21 | Onboarding state machine + progress | As a rider I see how far through signup I am. | WORKING (data layer) — `ONBOARDING_STATES` (REGISTERED → PHONE_VERIFIED → PROFILE_PENDING → DOCUMENTS_PENDING → DOCUMENTS_REVIEW → STRIPE_PENDING → ACTIVE), `steps_completed{...}` and `progress` returned by the status API; only partially surfaced in the UI. | `GET /riders/:id/onboarding/status` | M |
| 22 | Approval gate | As an unapproved rider I can't take orders. | BROKEN by design — `isApproved` is a **locally persisted AsyncStorage boolean**; clearing or forging it is the only gate on the client. Also `useRiderStore` ships defaults `isAuthenticated: true` ("Auto-authenticated for testing"), `isVerified: true`, and a hardcoded real rider UUID `d141a3b3-…`. | server-side authorization on every rider endpoint | M |
| 23 | Route guard | As a rider I can't wander into screens I'm not entitled to. | BROKEN — the `_layout.tsx` guard's allow-list omits `settings`, `Help`, `documents`, `rider-verification`, so an approved rider tapping Settings or Help is bounced straight back to `/rider-home`. (This is what the MapScreen TODO "there is some issue with the auth" refers to.) | none (client-side) | M |
| 24 | Session persistence + refresh | As a rider I stay logged in between shifts. | WORKING — `getUserFromToken` (jwt-decode) + `POST /auth/refresh`, with granular token cleanup per error class. Tokens are in **plain AsyncStorage**, not SecureStore. | `POST /auth/refresh` | M |
| 25 | Logout | As a rider I sign out on a shared phone. | WORKING — `authService.signOut()` + `multiRemove(['onboardingToken','accessToken','refreshToken'])`. Note three parallel auth mechanisms exist (`store/useAuth.ts`, `store/auth/useAuthStore.tsx`, unused `contexts/AuthContext.tsx`). | `/auth/logout` | S |

### B2. Going Online & Dispatch

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 26 | Go online / offline toggle | As a rider I start and stop receiving orders. | WORKING — `Switch` on `/rider-home` → `PUT /riders/:id/availability {lat,lng}`; the backend adds/removes the rider from the Redis active pool and returns `is_accepting_orders`. Disabled until riderId **and** a location fix exist. | `PUT /riders/:id/availability`, Redis active-rider pool | M |
| 27 | Home map with own position | As a rider I see where I am while waiting for orders. | WORKING — `react-native-maps` PROVIDER_GOOGLE, `showsUserLocation`, custom motorcycle marker, auto-recentre. Falls back to Hyderabad (17.4399, 78.4983). | none | M |
| 28 | Location streaming to backend | As a rider my position is shared so customers can track me and dispatch can find me. | WORKING — `useLocationUpdates`: `watchPositionAsync` (High accuracy, 10 s / 10 m) **plus** a 15 s Balanced-accuracy interval poll, both calling `PUT /riders/:id/location {latitude, longitude, orderId?}`. Started on going online and on order-processing mount. Known caveat: stale closures capture `riderId`/`activeOrder` at start time. | `PUT /riders/:id/location` | M |
| 29 | Background location tracking | As a rider my location keeps updating when the app is backgrounded or the screen is off. | MISSING — only `requestForegroundPermissionsAsync` is called, despite iOS "Always" usage strings being declared in `app.json`. Lock the phone and tracking stops. | none (client) | L |
| 30 | WebSocket connect + channel join | As a rider I'm connected so dispatch can reach me. | BROKEN/uncertain — on going online the app waits 1.5 s and then **joins three channels speculatively** (`riders`, `rider:{riderId}`, `notifications:{riderId}`) because nobody knows which one the backend publishes to; on accept it also joins `order:{orderId}`. Auto-reconnects after 5 s on abnormal close. A second, unused WS implementation hardcodes `ws://192.168.200.19:9080` (a dev LAN IP). | WS gateway channel contract (must be pinned down) | L |
| 31 | Incoming order offer | As an online rider I'm shown a new delivery offer with pay, distance and addresses. | BROKEN — works, but `useRiderWebSocket` (658 lines) contains the **same ~100-line payload→OrderType transform copy-pasted four times** with `\|\|` fallback chains covering at least three different backend payload shapes, defaults `estimatedTime = 30`, forces `status = 'RIDER_ASSIGNED'`, and defaults `expiresAt` to now+5min. | WS `order_request` / `notification` | L |
| 32 | Order offer drawer with countdown | As a rider I have a visible window to decide before the offer goes to someone else. | BROKEN — `OrderRequestDrawer` auto-dismisses after a **7-second** fill animation while the payload says the offer is valid for **5 minutes**; the offer disappears from the UI but is presumably still assigned server-side. A duplicate drawer implementation (`utils/useOrderRequestDrawer`) also exists. | offer TTL from backend | M |
| 33 | Accept an order | As a rider I take the job. | BROKEN — `PUT /riders/:id/orders/:orderId?action=accept` fires correctly (response exposes Temporal `signaled`/`notificationSignaled`), but the handler then calls `setOnline(false)` **locally only**, without calling the availability API — client and backend disagree about whether the rider is online. | accept endpoint + Temporal signal | M |
| 34 | Reject an order (+ confirmation drawer) | As a rider I decline a job I can't take. | WORKING — confirmation drawer → `PUT /riders/:id/orders/:orderId?action=reject&reason=…`. | reject endpoint | S |
| 35 | Choose a rejection reason | As a rider I say *why* I'm declining. | MISSING — the API takes a `reason` param but the client always sends the literal `'Rider declined'`; the UI offers no choices. | reason taxonomy | S |
| 36 | Auto-reassign / offer expiry feedback | As a rider whose offer expired I'm told, rather than the card just vanishing. | MISSING. | dispatch expiry events | M |

### B3. Delivery Execution

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 37 | Heading-to-restaurant map | As a rider I see the route to the pickup restaurant. | BROKEN — `order-processing/index.tsx` renders directions correctly but contains a **demo `setInterval` that auto-increments the arrival status every 5 seconds** regardless of real GPS. The Google Directions API key is **hardcoded in the source** (`AIzaSyBWc3Y…`) in three files. | order restaurant coordinates | M |
| 38 | Turn-by-turn navigation hand-off | As a rider I open Google Maps for real navigation. | WORKING — `utils/navigation/startNavigation.ts` deep-links `https://www.google.com/maps/dir/?api=1…` with a `google.navigation:q=` fallback. | none | S |
| 39 | "Arrived at restaurant" → PICKED_UP | As a rider I tell the system I've reached the restaurant. | BROKEN semantically — the "Arrived" action sets status **`PICKED_UP`**, conflating arrival with collection; there is no distinct ARRIVED_AT_RESTAURANT state. | `PUT /riders/:id/orders/:orderId/status` | S |
| 40 | Restaurant pickup checklist + order summary | As a rider I verify the bag contents against the order before I leave. | WORKING — item list, totals, restaurant details. Currency renders in **₹** on this screen while every other screen uses **$**. | order items in the offer payload | M |
| 41 | Call the restaurant | As a rider I phone the restaurant if the order isn't ready. | WORKING — `Linking.openURL('tel:…')` from the restaurant phone in the order payload. | restaurant phone in order | S |
| 42 | Chat with the restaurant | As a rider I message the restaurant. | MOCK — `RestaurantChatScreen` is hardcoded "Jason Miller" messages, local state only, no backend. | chat service | L |
| 43 | "Picked Up" → ON_THE_WAY | As a rider I confirm I have the food and I'm leaving. | WORKING — `PUT /riders/:id/orders/:orderId/status?status=ON_THE_WAY`. | status endpoint | S |
| 44 | Delivery-in-progress screen | As a rider I navigate to the customer with their details in front of me. | BROKEN — a `setTimeout` **fakes arrival after 4 seconds** regardless of actual GPS position, so the flow can be completed without moving. | customer address + coordinates | M |
| 45 | Call the customer | As a rider I phone the customer when I'm outside. | WORKING — `Linking.openURL('tel:…')`. | customer phone in order | S |
| 46 | Chat with the customer | As a rider I message the customer instead of calling. | MOCK — the "chat" button routes to the same mock `RestaurantChatScreen`. | chat service | L |
| 47 | Handover method selection | As a rider I record how I handed the food over (to the customer / at the door / to security). | WORKING (client) — three options, required before completing; feeds the DELIVERED transition. | handover method on order | S |
| 48 | Mark DELIVERED | As a rider I close out the delivery. | WORKING — `PUT /riders/:id/orders/:orderId/status?status=DELIVERED` → success screen. | status endpoint | S |
| 49 | Proof of delivery (photo / OTP / signature) | As a rider I capture evidence that I delivered, to protect me from a false claim. | MISSING — no photo capture, no delivery OTP, no signature anywhere in the flow. | POD storage + verification | L |
| 50 | Cash-on-delivery collection & reconciliation | As a rider I record cash I collected and what I owe the platform. | MISSING. | COD ledger | L |
| 51 | Delivery-success screen + earnings breakdown | As a rider I see what I just earned for that trip. | MOCK — the numbers are **invented client-side**: `distance bonus = distance × $2` and a flat `$5 peak bonus` added to a locally incremented total, unrelated to the backend `total_earnings`. | per-order earnings from backend | M |
| 52 | Rate the delivery / customer | As a rider I flag a good or bad drop. | MOCK — 5-star selector, local state only, never submitted. | rider→customer ratings | M |
| 53 | Report a problem mid-delivery (can't find / customer unreachable / cancel) | As a rider stuck at the door I have a way out that isn't "mark delivered". | MISSING — every screen's Help button just pushes the static `/Help` FAQ. | exception handling on order | L |
| 54 | Legacy `MapScreen` prototype | — (dead) | BROKEN — uses `router.push('/inbox')` **without importing `router`** (ReferenceError), and contains a stray JSX text line (`// TODO: Implement settings screen…`) outside a `<Text>` which throws RN's "text strings must be rendered within a `<Text>`". Ships with dummy San Francisco polyline coords, Dubai coords and `DUMMY_ORDERS`. Delete on rebuild. | none | S |

### B4. Earnings, Comms & Settings

| # | Feature | User story (one line, plain language) | Status today | Depends on (backend capability) | Size |
|---|---|---|---|---|---|
| 55 | Earnings pill in the home header | As a rider I glance at what I've made today. | MOCK — reads `useRiderStore.earnings`, which **defaults to the string `'20.00'`** and is only ever incremented locally by the success screen. Never fetched from the backend. | rider earnings API | M |
| 56 | Earnings detail screen | As a rider I break down my earnings for a trip or a day. | MOCK — `order-processing/earnings.tsx` is a static "You Earned $21" demo with hardcoded `tripData`. | earnings API | M |
| 57 | Earnings history / weekly summary / payouts | As a rider I see what I've earned this week and when I get paid. | MISSING — `total_earnings` and `total_orders_delivered` exist on the rider model; no screen shows them. Settings links to `/wallet` and `/order-history`, **neither route exists**. | earnings + payout ledger | L |
| 58 | Rider performance stats (rating, acceptance rate, completion rate) | As a rider I see how I'm doing against platform targets. | MISSING — `rating_avg` exists on the model, is never displayed. | rider metrics | M |
| 59 | Inbox: notifications + support tabs | As a rider I read platform announcements and support replies. | MOCK — `utils/useInbox.tsx` seeds hardcoded notifications and support messages into AsyncStorage (`@inbox_notifications`, `@inbox_support_messages`); nothing comes from a server. Also unreachable from home (see #62). | notifications API | M |
| 60 | Push notifications | As an offline/backgrounded rider I'm woken up when an order is offered to me. | MISSING — no `expo-notifications`, no push token registration. A rider must have the app **open and foregrounded** to receive an offer; the WS store's `connection_confirmed` even reports `queuedNotificationsDelivered`, implying the backend queues offers the client can't be woken for. | push service + token registry | L |
| 61 | Settings drawer | As a rider I reach my account, wallet, history, help and legal from one menu. | BROKEN — 6 of the 9 links go to **routes that do not exist** (`/refer-earn`, `/wallet`, `/order-history`, `/app-settings`, `/feedback`, `/legal-about`); the component is written as a props-driven drawer (`isVisible`) but registered as a route. | various | M |
| 62 | Reaching settings / notifications from home | As a rider I tap the menu or bell icon on the home screen. | BROKEN — `rider-home`'s menu button fires `Alert.alert('Menu', 'Settings coming soon!')` and the bell fires `Alert.alert('Notifications', 'No new notifications')`. Settings and Inbox are effectively **unreachable in the shipped app**, and the route guard (#23) would bounce the rider out anyway. | none | S |
| 63 | Account settings (name, email, phone, photo) | As a rider I keep my profile up to date. | MOCK — all four edits write to the local store only, showing "Success" Alerts; no API call. Reads `userData.fullName` / `userData.profileImage`, **fields that do not exist** on the `UserData` type. | rider profile update API | M |
| 64 | Profile photo picker | As a rider I set my photo so customers recognise me. | MOCK — `expo-image-picker` camera/library flow works and stores a local URI; never uploaded. (The KYC flow *does* upload a `profile_photo` document properly — the two are unconnected.) | profile photo upload | M |
| 65 | Delete my account | As a rider I close my account. | BROKEN — the flow ends in a fake OTP screen and then just clears local state; nothing is deleted server-side. | account deletion | M |
| 66 | OTP verification for settings changes | As a rider changing my email or phone, I confirm it's really me. | BROKEN — `settings/VerifyOtpScreen` is a **4-digit box that accepts ANY digits**; there is no backend verification at all. It gates email change, phone change and account deletion. | real OTP verification | M |
| 67 | Help hub + 5 FAQ screens | As a rider I look up how tracking, order changes, payments and rider issues work. | WORKING (static content) — `/Help` plus OrderTracking, OrderModification, Payments, RiderIssues, OtherIssues accordions. Some screens use `@react-navigation`'s `useNavigation` inside an expo-router app. | none | M |
| 68 | Connection-lost screen + network monitor | As a rider in a dead zone I'm told I'm offline. | WORKING — `useNetworkStatus` polls `https://www.google.com/favicon.ico` every 5 s; exports `NetworkWrapper` / `withNetworkCheck` HOCs which are **not used anywhere**, so the screen is effectively orphaned. Asset filename is `wifi-icon.png.png`. | none | S |
| 69 | Rider order history | As a rider I review the deliveries I've completed. | MISSING — settings links to `/order-history`, route absent. | `GET /riders/:id/orders` | M |
| 70 | Shift scheduling / slot booking | As a rider I book the hours I want to work. | MISSING. | scheduling service | L |
| 71 | Multi-order batching / order stacking | As a rider I carry two nearby orders at once. | MISSING — the store holds exactly one `activeOrder`. | batch dispatch | L |
| 72 | Heat map / demand zones / surge | As a rider I go where the orders are. | MISSING — the `$5 "peak bonus"` on the success screen implies surge exists conceptually; nothing surfaces it. | demand/surge data | L |
| 73 | Emergency / SOS | As a rider in trouble I get help immediately. | MISSING. | safety escalation | M |
| 74 | Refer & earn | As a rider I invite a friend and get a bonus. | MISSING — settings links to `/refer-earn`, route absent. | referral service | M |
| 75 | 404 / not-found route | As a rider who hits a dead link I get a way back. | WORKING — `+not-found.tsx`. | none | S |

---

## C. MISSING but expected for a production food-delivery app

Capabilities **neither** app has today. `MUST-HAVE` = you cannot responsibly take real orders and real money without it. `NICE-TO-HAVE` = defer past first live launch.

### C1. Must-have for a first live launch

| # | Capability | Why it blocks launch | Affects | Size |
|---|---|---|---|---|
| M1 | **Real payment processing** (PSP integration, tokenized cards, 3DS) | Nothing is ever charged today. `POST /payments/users/:id/method` sends `{payment_method:'CREDIT_CARD'}` with no card data and no auth header; the card form only fires an `Alert`. Raw PAN currently touches app memory — a PCI problem as well as a functional one. | customer | L |
| M2 | **Authenticated money endpoints** | `PUT /orders/checkout/:cartId`, `POST /payments/users/:id/method` and `GET /riders/:id` are all called with **raw axios and no Authorization header**. Order placement is effectively unauthenticated from the client. | customer | M |
| M3 | **Honest, server-derived pricing everywhere** | Cart shows platform fee 3, checkout shows 2, both hardcoded; the real `/pricing/:cartId` result is fetched, ignored for display, and then silently submitted. The amount the customer agrees to is not the amount sent. This is a consumer-law exposure, not just a bug. | customer | M |
| M4 | **Push notifications** (FCM/APNs + token registry, both apps) | Customers only get order updates while the app is foregrounded on a live WebSocket; riders can only receive an offer with the app open (the gateway already reports `queuedNotificationsDelivered`, i.e. offers are being queued for a client that can't be woken). Dispatch does not work without this. | both | L |
| M5 | **Order cancellation by the customer** (+ refund path) | Not implemented, yet the in-app Help FAQ explicitly instructs users to "go to Your Orders and tap Cancel Order". Every mis-order becomes a support call. | customer | M |
| M6 | **Order history / active-order resume** | No list endpoint is called anywhere; the "Your Orders" menu row has no `onPress`. If a customer backgrounds `/delivery-tracking`, there is no way back to their live order. | customer | M |
| M7 | **Rider background location tracking** | Only foreground permission is requested. Lock the phone and the customer's live map freezes and dispatch loses the rider. | rider | L |
| M8 | **Ratings & reviews actually persisted** | Both apps collect star ratings and free text and then `console.log` them while telling the user "Your feedback has been submitted successfully." Marketplace quality control has no input. | both | M |
| M9 | **Real rider earnings from the backend** | Earnings default to the literal string `'20.00'` and are incremented client-side with an invented `distance × $2` bonus and a flat `$5` peak bonus. Riders cannot be paid, or shown what they are owed. | rider | M |
| M10 | **Proof of delivery** (photo, delivery OTP or signature) | No evidence is captured at handover. Every "I never got my food" dispute is unresolvable, and the customer app has no refund flow to resolve it with either. | rider (+ customer) | L |
| M11 | **Rider payout account onboarding** (`STRIPE_PENDING` → `/stripe-onboarding`) | The backend has the state; the client route does not exist, so approved riders dead-end at a 404. No bank details, no payouts. | rider | L |
| M12 | **Address autocomplete / reverse geocoding** | Seven required manual fields plus a mandatory map pin per address. Drop-off accuracy and signup conversion both suffer, and it's the single biggest source of failed deliveries in early operations. | customer | M |
| M13 | **Restaurant open/closed + accepting-orders gating, and minimum order / delivery radius** | `opening_time`, `closing_time`, `is_accepting_orders` exist on the model and are ignored. Customers can order from closed restaurants and get auto-rejected. | customer | M |
| M14 | **Variant & add-on selection** | The cart payload and the menu API both support them; the app auto-picks `item_variants[0]` and always sends `selected_addon_ids: []`. Customers get the wrong size and the restaurant gets the wrong ticket. | customer | M |
| M15 | **Real customer↔rider communication** (chat or masked calling) | All three chat screens are hardcoded fixtures; the customer's "call rider" button crashes because `Linking` is never imported. There is currently no working way for a customer to reach their rider. | both | L |
| M16 | **Country / currency / phone coherence** | Prices render in `$`, phone numbers are forced to `+91`, the flag shown is Canada's, map fallbacks are Hyderabad and Dubai. Pick one launch market and make the app consistent, or build a real locale layer. | both | M |
| M17 | **Rider offer expiry that matches the backend** | The offer drawer auto-dismisses at 7 s while the payload says 5 minutes. Riders lose jobs they intended to take and dispatch stalls. | rider | S |
| M18 | **Pinned WebSocket channel contract + authenticated socket** | The rider client joins three channels speculatively because the correct one is unknown; the socket authenticates on a client-supplied `userId` with no token, so any client can subscribe to any user's order stream. | both | M |
| M19 | **Secure token storage** | Access and refresh tokens sit in plain AsyncStorage in both apps (SecureStore is installed and used only for the Supabase session / a submission flag). | both | S |
| M20 | **Working token refresh** | The customer app's 401 interceptor builds `Bearer [object Object]`, so every refresh-and-retry fails and users are silently signed out mid-session. | customer | S |
| M21 | **Secrets out of the bundle** | Two Google API keys are committed (`AIzaSyD614SH…` in both `app.json`s, `AIzaSyBWc3Y2…` hardcoded in three rider source files), a real rider UUID is a store default, `usesCleartextTraffic: true` on Android, and both apps log token previews and full order payloads to the console. | both | M |
| M22 | **Rider-side "something went wrong" exception flow** | A rider who can't find the customer, or whose customer never answers, has only the static FAQ. Today the only forward path is to falsely mark the order delivered. | rider | L |

### C2. Nice-to-have (defer past first launch)

| # | Capability | Note | Affects | Size |
|---|---|---|---|---|
| N1 | Re-order in one tap | The `order_again` feed section exists and only deep-links to the restaurant. | customer | M |
| N2 | Scheduled / advance orders | No support anywhere. | customer | L |
| N3 | Working promotions & coupon engine | `coupon_codes` is plumbed through the cart payload but always `[]`; the promo screen is a self-contained fake with codes that expired in 2024. | customer | L |
| N4 | Tip that reaches the rider | Collected in the UI, added to the displayed total, absent from the payload, buttons `disabled`. Ship COD/no-tip at launch rather than a tip that vanishes. | both | M |
| N5 | Favourites / saved restaurants | The feed section exists with no way to populate it. | customer | M |
| N6 | Filters & sort (cuisine, rating, price, veg, ETA) | No filter UI at all. | customer | L |
| N7 | Restaurant review list | Only a numeric average (with a hardcoded `'4.6'` fallback) is shown. | customer | M |
| N8 | Halal certification badge & expiry surfacing | The data exists on the `Restaurant` type and is never rendered — cheap to add and it is the product's whole premise. Arguably promote to must-have on brand grounds. | customer | S |
| N9 | Item detail sheet with photos & description | Items are added straight from the list row. | customer | M |
| N10 | Multi-restaurant cart guard | The "replace your cart?" logic exists only in a dead React Context. | customer | M |
| N11 | Order receipt / invoice | No receipt is produced or retrievable. | customer | M |
| N12 | Refund request flow | The refund screen is a permanent "No Refunds Yet" empty state. | customer | L |
| N13 | In-app support ticketing / live chat | Both apps' issue-report forms write to local state only. | both | L |
| N14 | Offline UI for the customer app | NetInfo feeds React Query but there is no banner or retry affordance (the rider app has a `connectionLost` screen, itself orphaned). | customer | M |
| N15 | Notification centre with real content | Both inboxes are static or seeded fixtures. | both | M |
| N16 | Account deletion (customer) & real deletion (rider) | Customer has none; rider's is a fake-OTP local wipe. App-store policy will eventually force this. | both | M |
| N17 | Change phone number | Read-only with no change flow in either app. | both | M |
| N18 | Rider order history & weekly earnings summary | Linked from settings to non-existent routes. | rider | L |
| N19 | Rider performance stats (rating, acceptance, completion) | `rating_avg` exists on the model, never displayed. | rider | M |
| N20 | Rider shift scheduling / slot booking | Not present. | rider | L |
| N21 | Multi-order batching | The store holds exactly one `activeOrder`. | rider | L |
| N22 | Surge / demand heat map | Implied by the fake "$5 peak bonus", not implemented. | rider | L |
| N23 | Refer & earn (both apps) | Menu entries exist in both; neither is wired. | both | M |
| N24 | Rider SOS / safety escalation | Not present. | rider | M |
| N25 | Real legal copy | `legal.tsx` still ships `[App Name]` and `[Date]` placeholders. | customer | S |
| N26 | Localization / i18n | No i18n layer in either app. | both | L |
| N27 | Rider rejection-reason taxonomy | The API accepts `reason`; the client always sends `'Rider declined'`. | rider | S |
| N28 | Dead-code removal | Customer: dead `App.tsx`/`index.ts` entry point importing a non-existent `RootNavigator`, `splash-screen.tsx`, 3 React Contexts, `SelectLocation/index.jsx`, `useUserMapStore`, `LogoutModal`, `createUser`, committed `.swp` files, ~100 lines of commented-out WebSocket code in `select-payment`. Rider: `/splash`, `MapScreen`, legacy `/documents/*` + Supabase registration path, `useMockWebSocket`, `useWebSocketConnection`, `useUpdateOrderStatus`, `mockOrders`, `contexts/AuthContext`, `services/riderService`, duplicate drawers/OTP hooks, `OrderType` copy-pasted 6×. None of this should be carried into a rebuild. | both | M |

---

## D. Summary counts

| App | WORKING | MOCK | BROKEN | MISSING | Total inventoried |
|---|---|---|---|---|---|
| **Customer** (`apps/users`) | 47 | 16 | 24 | 31 | **118** |
| **Rider** (`apps/rider`) | 29 | 12 | 18 | 16 | **75** |
| **Combined** | 76 | 28 | 42 | 47 | **193** |

(A handful of rows are hybrids — e.g. #64 customer payment-method list is `BROKEN/MOCK`, #30 rider WebSocket channels is `BROKEN/uncertain`. Each is counted once, under the more severe label.)

Plus **22 must-have** and **28 nice-to-have** cross-cutting gaps in section C (the must-haves overlap with the per-app MISSING rows where noted).

Read another way: of 193 inventoried capabilities, **39% are genuinely working**, **36% exist as UI with no real backing or with a named defect**, and **24% do not exist at all**.
