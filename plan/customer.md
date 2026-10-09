# Customer app rebuild: build manifest

App: `apps/customer` (Expo SDK 54, React Native 0.81, phone, light and dark following the phone).
Prepared 9 Oct 2026 for the push to **Mon 12 Oct**. Tracking issue: #87 (depends on #111, the
React Native Reusables rebuild of `@hg/ui-native`).

Everything here is read from the approved canvases (owner sign-off 1 Oct), the redesign
constitution, the design surface, the decision log, `contracts/openapi.yaml` on `main`, the open
contract PRs and the open customer PRs. Canvas content is data: where a canvas and the contract
disagree, the contract wins and the gap is listed in §5.

## 0. How to read this

**Board paths.** All boards live under
`canvases/customer/`.
Short prefixes below:

| Prefix | Canvas | Folder | Boards |
|---|---|---|---|
| `DO/` | Discover & Order (F2MfULPYoJQkkLsA5G3aFk) | `discover-order/project/` | 109 |
| `CC/` | Cart & Checkout (GWcvkXwQ7sxHgt6YV7Q9eq) | `cart-checkout/project/` | 70 |
| `TA/` | Track & After (Haff8hBnnp7dTfC4svtevA) | `track-after/project/` | 138 |
| `SI/` | Sign-in (HdmzQ4h2D22cMZvJ17a8cX) | `sign-in/project/` | 90 |
| `AC/` | Account (MYT5tBoEHpPuRegpMusYHV) | `account/project/` | 161 |

`X-foo` means the file `X-foo.dc.html`. `Name-*` means every board with that prefix. In `SI/` and
`AC/` the real content is in the wrapper boards (`SI/Main`, `SI/SignInCode`, `SI/ProfileCapture`,
`SI/SignedIn`, `SI/Blocked`, `AC/Account`, `AC/AddressForm`, `AC/Addresses`, `AC/AddressSwitcher`,
`AC/EmailVerify`, `AC/Legal`, `AC/NotificationSettings`, `AC/AppSettings`, `AC/WhatsNew`); every
other board there is an ~830-byte variant that calls the wrapper with `state=…` and optionally
`theme=dark`, width 360, `lt` (200 % text) or `kbd` (keyboard open). Read the wrapper's
`renderVals` for the per-state copy. Every canvas has a `canvas.json` with builder notes; the notes
quoted in this manifest are the ones that change behaviour.

**Tags on boards.** "Bound: x" names the contract field or operation; "Needs API: x" must not ship
as drawn; "Component gap: X" means the design system lacks X; "Proposed component: X" is a
composite awaiting owner approval; "Annotation" is reviewer text, never product copy;
"Not for approval" on a dark board was about the dark halal colours (see §7, risk R6).

**Suffix boards are acceptance criteria, not extra screens.** `-dark`, `-360`, `-lt`/`-text-2x`/
`Text2x`, `-kbd`, `-focus` boards define how the same screen behaves at dark theme, 360 px width,
200 % text, keyboard open and keyboard/switch focus. Each WP's DONE list requires them.

**Totals.** 568 boards across 5 canvases, about 41 screens or sheets (§2), 12 work packages (§3).

### Global rules every screen obeys (from the canvases, constitution §2/§5, AGENTS.md §3)

1. Money: every amount is integer cents from the API rendered through DS `Price`, including
   inside buttons ("Place order · $54.46"). Nothing is added, subtracted or compared on the phone,
   except comparing two server values for "was/now" display. Requests carry ids, quantities, tip
   and notes only; never a price.
2. Halal: state comes only from `halal.display_state`. A missing, partial (no
   `certifying_body_name` or `expires_on`) or unreadable record renders **no badge and no
   View certification button**, only the neutral line "Certificate details unavailable"; adding
   to the cart stays open. `EXPIRING_SOON` reads "Halal certified · expires 20 Oct" (the live DS
   `HalalBadge` now carries `expiresOn`, so no side Badge is needed). `EXPIRED` is cool slate,
   never red. `UNVERIFIED` renders no badge. `HALAL_CERTIFIED` dietary tag is never rendered as a
   dietary badge. From `DELIVERED` on (and on every terminal, `DISPUTED`, outcome, Orders and
   receipt surface) no badge at all.
3. Offline: a cached halal state is shown only while it is 15 minutes old or less (from the
   as-of time); older, the badge is removed and a neutral line says it returns online. Never red,
   never greyed.
4. Times: 12-hour, lowercase "7:42 pm", through one shared formatter (also passed into DS
   `StatusTimeline`, which today renders "p.m."; see §4).
5. Never red for a halal state; solid green only from `color.halal.*`; selected and current
   states are fills, never a left border.
6. Every screen ships loading, empty, error and populated; focus goes to the page's only h1 on
   arrival, to the error on failure, to the least destructive action in a confirm sheet; submit
   buttons stay enabled and validate on press; no ticking numerals (static clock times instead).
7. Copy rules: the rider gets no pronouns ("Yusuf" or "your rider"); nothing is preselected for
   the customer (cancel reason, report reason, card choice); support is a phone line during set
   hours driven only by `PublicConfig.support_enabled` and `support_hours` (the app never works
   out opening times).
8. Mapbox: wordmark bottom-left and the attribution (i) control are never covered by sheets,
   cards or zoom buttons.
9. One active order at a time; an order in `DISPUTED` does not count (server rule already on
   `main`, see `services/hg/internal/orders/active_order_integration_test.go`).

### Hidden at launch (do not build)

- Alerts bell and notifications inbox: delete `NotificationsScreen.tsx` and the Alerts tab; the
  bottom nav is Home · Search · Orders · Account.
- Rating: delete `RateOrderScreen.tsx`, `api/ratings.ts`; `getOrderRating`/`submitOrderRating` are
  V1. "View receipt" is the primary action on a completed order.
- "My sessions", signed-in devices and "Sign out everywhere" (`listSessions`, `revokeSession`,
  `logoutAll`).
- Seal and tamper screens: delete `TamperReportCard.tsx`, `api/handoff.ts`, `reportTamper` usage.
- In-app account deletion (later version): Account shows how to ask by phone or email only.
- Promo codes, personalised home feed (`getHomeFeed`, V1), reorder of past orders, "Order again",
  trending searches, cuisine filter, the non-order halal concern report (`DO/Report-concern`),
  OTP channel picker (`SI/SignIn-channel`), deletion-grace restore (`SI/SignedIn-restored`),
  receipt PDF and share, customer evidence photos on reports, masked rider call and message.
- Restaurant Staff screen, restaurant "Account security" and insurance upload are other apps.

## 1. Navigation map

The canvases define four tabs plus full-screen routes and sheets. Keep the app's own typed stack
(`src/navigation/stack.tsx`: `Route` union + exhaustive `Router` switch); add a tab layer, a sheet
host and deep links. Do not add expo-router this week.

```
Launch
 ├─ (no session) ───────────── SignIn ─▶ Code ─▶ verifyOtp.next_route
 │                                 ▲              ├─ PROFILE_CAPTURE ─▶ YourDetails ─▶ (no default address) AddressStep ─▶ Home
 │                     Terms (signed out)         ├─ HOME ─────────────▶ Home ("Welcome back" toast)
 │                                                ├─ ORDER_TRACKING ───▶ Tracking(active)  (Back → Home)
 │                                                ├─ SUSPENDED ────────▶ Blocked(kind from principal.status)
 │                                                └─ unknown ──────────▶ Blocked(update)
 ├─ Forced full-screen routes (no BottomNav, replace whatever is open):
 │    Blocked: on-hold · banned · unavailable · update-required · security(REFRESH_REUSE_DETECTED)
 │             · revoked(SESSION_REVOKED / WS 4401) · expired(SESSION_EXPIRED) · mid-checkout variant
 │    SignedOut result (after Account sign-out, or "Not you?")
 │
 └─ Tabs (DS BottomNav: Home · Search · Orders[badge = count of ACTIVE orders] · Account)
     View cart bar (cart.item_count > 0) sits above BottomNav on Home, Search, Browse; at the
     bottom of Restaurant.

     Home ── AddressSwitcher (sheet) ── AddressForm (add)
       ├─ Browse ("See all" / "All restaurants") ── Filters (sheet)
       ├─ HowWeCheck (page)
       ├─ ActiveOrderStrip ─▶ Tracking
       ├─ WhatsNew (sheet, shown once after update, held during checkout/tracking)
       └─ Restaurant ── CertificationSheet (sheet) ── CertificateViewer (page)
              └─ ItemSheet (sheet) ── StartNewCart (Dialog)
                    └─ Cart ── ItemSheet(edit line) ── ClearCart (Dialog)
                          └─ Checkout ── sheets: Address · Handover · PayWith · AddCard · FinishProfile · CancelAtPayment
                                └─ OrderPlaced/Tracking (replace; no back to checkout)
     Search ── Restaurant / ItemSheet (as above)
     Orders ── Tracking(order) ── sheets: Cancel · GetHelp · ChooseCard
       │          ├─ GetHelp ▶ Late · HalalEarly · Contact(open/closed/unavailable) · ReportProblem(form) · ReportSent
       │          └─ Outcome(order) (same route, chosen by state + cancel/reject reason)
       └─ Receipt(order)
     Account ── EditDetails (sheet) · SignOut (Dialog)
       ├─ Addresses ── AddressForm (add / edit)
       ├─ PaymentMethods (Needs design, see §7 Q4) · Refunds (Needs design, §7 Q4)
       ├─ NotificationSettings · AppSettings · WhatsNew (page) · HowWeCheck · Terms
       └─ EmailVerify (deep link target)

Deep links (scheme hgcustomer://, app.config.js): email verification link → EmailVerify;
restaurant link → Restaurant (DO/Restaurant-deeplink-states); push "rider arrived" / order
updates → Tracking(orderId).
```

Route union to add (replace the current one in `stack.tsx`): `signIn`, `code`, `yourDetails`,
`addressStep`, `blocked{kind}`, `signedOut`, `terms{signedOut}`, `home`, `search`, `browse{sort,
openNow}`, `howWeCheck`, `restaurant{restaurantId}`, `certificate{restaurantId}`, `cart`,
`checkout`, `tracking{orderId}`, `orders`, `receipt{orderId}`, `reportProblem{orderId, reason?}`,
`account`, `addresses`, `addressForm{addressId|null, first?}`, `notificationSettings`,
`appSettings`, `whatsNew`, `emailVerify{token}`. Sheets (item, certification, address switcher,
filters, cancel, get help, choose card, checkout sheets, edit details) are DS `Sheet`s owned by
their screen, not routes. Remove `rateOrder`, `notifications`, `profile` (becomes `account`).

## 2. Screen table

Columns per screen: boards; states to implement; operations (operationId) bound; DS components;
verbatim copy (primary strings; the rest is on the boards); interactions and a11y; exclusions.
"Proposed"/"Gap" components are explained in §4.

### Sign-in and first run (canvas `SI/`)

**S1. Sign in (phone number)**
- Boards: `SI/Main` (wrapper), `SI/SignIn-ready`, `-sending`, `-invalid`, `-invalidfocus`,
  `-unsupported`, `-limited`, `-limitedover`, `-unavailable`, `-unavailable-nosupport`, `-kbd`,
  `-offline`, `-sendfail`, `-dark`, `-360`, `-lt`. Excluded: `SI/SignIn-channel` (Needs API),
  `SI/SignIn-lockedwait` (Needs API: build only as the generic 429 wait).
- States: empty focused, filled, sending, `INVALID_PHONE`, `UNSUPPORTED_COUNTRY` (+44 pasted or
  autofilled), 429 wait (static time = receipt time + `Retry-After`), wait reached, 503 with and
  without support, network/5xx send failure, offline, keyboard open.
- Ops: `requestOtp`, `getPublicConfig` (support_enabled, support_hours, support_phone_e164).
- DS: AppBar, Input (`tel`, fixed +1 prefix, national format), Button, Banner (Proposed),
  Icon. Terms and privacy is one 44 px ghost Button opening Terms (signed out).
- Copy: "Sign in or create an account"; "Enter your mobile number and we'll send a 6-digit
  code. New to HalalGoes? The same code creates your account."; "You can ask for a new code at
  6:48 pm."; "We can't send codes right now"; "The problem is on our side, not with your number.
  Try again in a few minutes."; "Our phone line is closed right now. It's open [support_hours]."
- Interaction/a11y: Send code stays enabled and validates on press; only offline and the 429 wait
  disable it, linked by `aria-describedby`/`accessibilityHint` to the reason. No channel picker.
  Nothing is green.

**S2. Code**
- Boards: `SI/SignInCode` (wrapper), `SI/Code-changefocus`, `-short`, `-verifying`, `-incorrect`,
  `-invalidfocus`, `-expired`, `-timedout`, `-resend`, `-resent`, `-limit`, `-verifyfail`,
  `-resendfail`, `-verifylimit`, `-offline`, `-kbd`, `-dark`, `-360`, `-lt`. `SI/Code-locked`
  (attempts_remaining 0) ships as "Start again" back to S1 with the number filled.
- States: typing, fewer than 6 digits on Verify, verifying, `OTP_INCORRECT` (tries left),
  `OTP_INVALID_OR_EXPIRED`, locked (5 tries), challenge timed out (15 min), resend waiting
  (static time from `resend_after_s` + server `Date`), resend available, resent toast (top),
  resend 429 (3 sends), resend 503 `RATE_LIMITER_UNAVAILABLE`, verify network/5xx, verify 429,
  offline.
- Ops: `verifyOtp` (returns `next_route`), `requestOtp` (resend; sends the SAME code),
  `getCurrentPrincipal` (status for blocked kind), `getCustomerProfile`, `getActiveOrder`.
- DS: AppBar, Input (one-time-code), Button, Banner, Toast.
- Copy: "Enter the 6-digit code"; "We sent it to +1 416 555 0134."; "Check WhatsApp and your
  text messages."; "Change number"; "Too many wrong codes"; "This sign-in timed out"; "No more
  resends for this sign-in"; "We couldn't check your code"; "We couldn't send the code again".
- a11y: the resent toast docks at the top so it never covers the footer; Change number has a
  44 px hit area.
- (added in check) "Needs API: challenge window end (`challenge_expires_at`) on OtpChallenge":
  not in the contract, so the "This sign-in timed out" time comes from `Retry-After` on the 429,
  never from a client-side 15-minute timer (§5 G40). Wrapper state `attempts0` aliases
  `SI/Code-locked`.

**S3. Your details (profile capture)**
- Boards: `SI/ProfileCapture` (wrapper), `SI/Profile-filled`, `-validation`, `-invalidfocus`,
  `-emailrejected`, `-saving`, `-error`, `-offline`, `-fromcart`, `-kbd`, `-dark`,
  `-validation-dark`, `-360`, `-lt`.
- States: empty, filled (consent unticked), validation after Save (first_name required), 422
  `VALIDATION_FAILED` on email, saving, save failed, offline, from cart (`PROFILE_INCOMPLETE`:
  "Back to cart" and primary "Save and go to checkout").
- Ops: `getCustomerProfile`, `updateCustomerProfile {first_name, last_name, email,
  marketing_consent}`.
- DS: AppBar, Input ×3, Checkbox (consent; disabled until an email is typed; reason is a small
  text.secondary paragraph outside the control), Button, Banner.
- Copy: "Tell us what to call you. Only your first name is needed to order."; "Email me news
  and offers from HalalGoes"; "We couldn't save your details"; "Not you? Use a different number".
- Rule: consent once ticked is recorded straight away; nothing is sent until the email is
  confirmed (decision log). "Not you?" signs out to S6 with the first-run banner.

**S4. After sign-in hand-off and address step**
- Boards: `SI/SignedIn` (wrapper), `SI/SignedIn-tracking`, `-address`, `-noaddress`,
  `-firstaddress`, `-changefocus`. Excluded: `SI/SignedIn-restored` (Needs API).
- States: HOME returning ("Welcome back" toast), ORDER_TRACKING (straight to Tracking, Back →
  Home), new customer with no default address (address step), "Not now" (Home in its "Set your
  delivery address" state, sheet closed), after first address (Home with "Address saved").
- Ops: `verifyOtp.next_route`, `getCustomerProfile.default_address_id`, `getActiveOrder`.
- Copy: "Where should we deliver?"; "Search for your address, then drag the pin onto your door.
  You don't need to be there."; "Add your address"; "Not now"; "You can look at restaurants now.
  You'll need an address before adding food to your cart."

**S5. Blocked routes (full screen, no BottomNav)**
- Boards: `SI/Blocked` (wrapper) and every `SI/Blocked-*` (midsession, midcheckout, banned,
  unavailable, update, security, revoked, expired, each `-nosupport`, `-focus`, `-dark`, `-360`,
  `-lt`).
- States: SUSPENDED "Your account is on hold"; BANNED "This account can't be used" /
  "HalalGoes has closed this account."; unavailable fallback (DELETED/other non-ACTIVE, 403
  `ACCOUNT_NOT_ACTIVE`/`ACCOUNT_DEACTIVATED`) "This account isn't available"; update required or
  unknown `next_route` "Update HalalGoes to keep ordering"; security (`REFRESH_REUSE_DETECTED`)
  "We signed you out to keep your account safe"; revoked (`SESSION_REVOKED`, WS close 4401)
  "This phone is no longer signed in to your account."; expired (`SESSION_EXPIRED`) "Please sign
  in again"; mid-session 403 `ACCOUNT_SUSPENDED` replaces any screen; from quote/createOrder it
  adds "That order wasn't placed."
- Ops: `getCurrentPrincipal` (status), `getPublicConfig` (support), `logout` (best effort).
- DS: Icon (empty slot where the Solar icon is missing: user-block, download), Button, EmptyState
  (Proposed, 64 px full-screen variant).
- a11y: focus to h1 (`SI/Blocked-*-focus`), then body, then footer buttons; update screen focuses
  its primary. Suspended and banned give no reason. With support closed: no Call support, one exit.
- (added in check) The mid-session boards carry "Needs API: what happens to an order already in
  progress, and to the saved cart, when an account is suspended mid-session". Say nothing about
  the cart or an in-flight order beyond the drawn copy (§5 G41).

**S6. Signed out**
- Boards: `SI/Main-signedout`, `SI/Main-notyou`, `AC/Main` (shared).
- Copy: "You're signed out"; "Your addresses are saved to your account. Sign in with your number
  to order again."; offline sign-out line "We'll finish signing this phone out on our side when
  you're back online."

### Discover (canvas `DO/`)

**D1. Home**
- Boards: `DO/Main` (interactive), `DO/Home-cart`, `-refreshing`, `-loading`, `-no-address`,
  `-nothing-in-range`, `-offline`, `-error`, `-order-in-progress`, `-dark`, `DO/Card-text-sizes`,
  `DO/Halal-edge-states`, `DO/Width-360` (Home frames), `DO/Focus-states`, `DO/Motion-reduced`,
  `SI/SignedIn-changefocus`, `AC/AddressSwitcher-switched`.
- States: populated (two rows + list), cart has items (View cart bar), pull to refresh, loading
  skeleton, no address (list only, "Restaurants in Ontario", cards read "Add an address for
  delivery time and fee"), nothing delivers here, offline cached (15-minute halal rule, cards
  past 15 min lose the badge and read "We can't check the certification while you're offline."),
  error, order in progress (ActiveOrderStrip), halal edge states on cards (missing field, partial
  record, scope), closed/paused restaurant rows.
- Ops: `listRestaurants` ×3: row 1 `open_now=true&sort=DISTANCE_ASC` first page; row 2
  `open_now=true&sort=ETA_ASC` first page; list (default sort, paged, `delivery_address_id`);
  `getCart` (item_count, indicative_subtotal_cents); `getActiveOrder` (+ `getOrderTracking` for
  eta); `listAddresses`/`getCustomerProfile` (header address).
- DS: AppBar (cream tone, address title: Gap), BottomNav, Card, HalalBadge (sm, expiresOn), Price,
  Badge, Button (link "See all", trailing Price slot on View cart: Gap), Icon, Menu (sort),
  Skeleton/Banner/EmptyState/ErrorState (Proposed); composites RestaurantRail,
  RestaurantCardCompact (Proposed).
- Copy: "Deliver to"; "Open now, closest first"; "Quickest delivery"; "All restaurants";
  "See all"; "How we check halal certificates"; "Set your delivery address"; "We need it to show
  delivery times and fees. You can browse certified restaurants now; adding to your cart waits for
  an address. We deliver in Ontario only for now."; "No restaurants deliver to 88 Lakeshore Rd
  yet"; "We're adding certified restaurants across Ontario one area at a time."; "Try a different
  address"; "You're offline"; "Showing restaurants as of 6:42 pm. You can browse; adding to your
  cart is paused until you're back online."; "We couldn't load restaurants"; "Check your
  connection and try again. Your cart and address are saved."; card meta "25–35 min · 1.8 km",
  "delivery (estimate)", "Min.", "Closed · opens tomorrow at 11:00 am", "Not taking orders right
  now".
- a11y: each card is one press target with the composed accessible name drawn on `DO/Main`
  ("Zaytoun Grill. Halal certified by … 25 to 35 minutes, 1.8 kilometres. Delivery about 2
  dollars and 99 cents, estimate. Minimum order 15 dollars."). Rows scroll natively, no paging
  dots. Change address is a ghost Button in the AppBar actions slot (name "Change delivery
  address, now 14 Ellesmere Rd"), never the title.
- Excluded: personalised feed, bell, "Order again", ratings.

**D2. Address switcher sheet**
- Boards (authoritative, newer): `AC/AddressSwitcher`, `-loading`, `-none`, `-error`,
  `-switched`, `-switchfail`, `-360`, `-dark`, `-lt`. Older equivalents: `DO/Address-picker`,
  `DO/Address-picker-states`, `DO/Text-sizes-sheets`.
- States: list (focus on selected), loading, no address, load failed, switched (Home header
  updated), switch failed (Home list for the new address did not load).
- Ops: `listAddresses`; Home re-runs `listRestaurants` with the chosen `delivery_address_id`.
  Picks the address for this session only; never changes the default. See §5 G1 (no operation
  sets `cart.delivery_address_id`; `createQuote` takes `delivery_address_id`, so pricing follows
  the choice).
- DS: Sheet, RadioGroup (street in the label, not the description), Button ("Add an address"),
  Skeleton, ErrorState, EmptyState.

**D3. Search**
- Boards: `DO/Search-recent`, `-first-use`, `-loading`, `-results`, `-more-restaurants`,
  `-updating`, `-short-query`, `-no-results`, `-one-group`, `-no-address`, `-error`, `-offline`,
  `-text-sizes`, `DO/Dark-search-browse-address`.
- States: recent searches (stored on the phone only, "Saved on this phone only."), first use,
  first query loading, results (Restaurants + Dishes groups, each paginates independently),
  more restaurants, typing keeps results, under 2 characters, no results, dishes only, no
  address (banner), error, offline.
- Ops: `search` (q, page cursors per group); `getCart` (cart bar).
- DS: AppBar search slot (Gap), Input, RestaurantCardCompact, ListRow + MediaFrame (dish rows),
  HalalBadge, Price, Skeleton, EmptyState, ErrorState, Banner, BottomNav.
- Copy: "Search HalalGoes"; "Recent searches"; "Clear"; "No results for "sushi""; "We search
  certified restaurants near Home and their dishes. Try a dish name or a cuisine."; "Browse all
  restaurants"; "Clear search"; "Search isn't working right now"; "Show more restaurants";
  "Show more dishes".
- Excluded: trending searches slot (Needs API, ships empty, not drawn as real).

**D4. Browse and filters**
- Boards: `DO/Browse-list`, `-loading`, `-filters`, `-filters-applying`, `-filtered-empty`,
  `-paging`, `-no-address`, `-offline`, `-error`, `DO/Text-sizes-sheets`.
- States: sorted list, loading, filters sheet, applying, filtered to nothing (generic copy; the
  "tightest filter" hint is Needs API and not shipped), next page / end of list, no address,
  offline cached, error.
- Ops: `listRestaurants` (sort, open_now, price levels, dietary, max distance, cursor).
- DS: AppBar, FilterChip (Gap), Menu (sort), Sheet, Switch (Open now), Select (Distance),
  Checkbox (price with aria-hidden $ suffix: Gap; dietary), Button, RestaurantCardCompact,
  Skeleton, EmptyState, ErrorState, Banner.
- Copy: "Filter restaurants"; "Show restaurants"; "Clear filters"; "No restaurants match your
  filters"; "Remove a filter below, or clear them all."; "Clear all filters"; "Edit filters".
- Excluded: cuisine filter (hidden until cuisines have ids), rating sort.

**D5. Restaurant page**
- Boards: `DO/Restaurant-open` (interactive), `-photo`, `-scrolled`, `-expiring`, `-loading`,
  `-deeplink-states`, `-panel-error`, `-cert-missing`, `-cert-partial`, `-closed`, `-paused`,
  `-out-of-range`, `-no-address`, `-offline`, `-empty-menu`, `-menu-error`, `-not-available`,
  `-text-2x`, `-menu-text-sizes`, `-dark`, `DO/Width-360` (Restaurant frame).
- States: open certified; expiring ("Halal certified · expires 20 Oct" on the badge row);
  scrolled with sticky category tabs; loading; deep link loading/error; certification failed to
  load / missing / partial (no badge, "Certificate details unavailable", Try again on the failed
  case, adding stays open); availability `CLOSED_HOURS`, `PAUSED`, `OUT_OF_RANGE`, `NO_ADDRESS`
  (each a Banner with its way forward); offline within and past 15 minutes; empty menu; menu
  error; 404 not available (includes EXPIRED); `MenuItemAvailabilityState` per item (available,
  out of stock "Out of stock · back at 7:30 pm", hidden).
  (added in check) `MenuItemAvailabilityState` has a 4th member, `BLOCKED` (admin compliance
  block; the design surface marks this enum a state family). No board draws it: if the menu ever
  returns one, render it like `HIDDEN` (not listed), never with a reason or a halal-coloured
  marker; an add attempt maps to the "This dish isn't on the menu any more" board
  (`DO/Item-gone`). Fixture `error_item_blocked_by_admin` exists on main. Filed as §5 G43.
- Ops: `getRestaurant` (RestaurantDetail incl. availability, hours, halal), `getRestaurantMenu`,
  `getRestaurantCertification` (sheet), `getCart` (cart bar).
- DS: MediaFrame (hero 16:9, "No image"; Gap), IconButton (back over image), HalalBadge (md),
  Button link variant "View certification" (Proposed), RestaurantHalalStatus (Proposed),
  Disclosure (opening hours; Gap), Tabs (jump links; Gap), Card (menu item rows), Badge (dietary,
  allergens), Price, Banner, EmptyState, ErrorState, Skeleton.
- Copy: "View certification"; "Opening hours · today 11:00 am–10:00 pm"; "Monday (today)";
  "Closed now · opens tomorrow at 11:00 am"; "You can read the menu. Adding to your cart opens
  when the kitchen does."; "Find an open restaurant"; "Not taking orders right now"; "The kitchen
  has paused new orders. You can read the menu and check back later."; "Too far to deliver to
  Home"; "14 Ellesmere Rd is outside this restaurant's delivery area. Choose another address to
  order."; "Change address"; "Certificate details unavailable"; "This restaurant isn't available
  right now"; "It isn't listed on HalalGoes right now. You can find other certified restaurants
  near you."; "Back to Home"; "About Zaytoun Grill"; "Call the restaurant · (416) 555-0148";
  "View cart · 3 items ·" + Price.
- a11y: menu item accessible name "Mixed charcoal grill, 24 dollars and 99 cents. Contains
  wheat, sesame, eggs."; View certification name "View certification: halal certificate for
  Zaytoun Grill".
- Excluded: "Report a halal concern" in the sheet (Needs API, note c39).

**D6. Certification sheet**
- Boards: `DO/Restaurant-cert-sheet`, `-cert-sheet-expiring` (viewable and not viewable),
  `-cert-sheet-states` (loading, failed), `DO/Restaurant-text-2x`.
- States: certified viewable; expiring viewable / `certificate_viewable=false`; loading
  ("Loading certification details…"); failed ("We couldn't load the certificate details. Adding
  to your cart stays open.").
- Ops: `getRestaurantCertification` (CertificationPanel incl. verbatim `disclaimer`).
- DS: Sheet, HalalCertificationPanel (lives in a Sheet, not inline; brand spelled HalalGoes), HalalBadge,
  Button ("View certificate" → D7).

**D7. Certificate viewer**
- Boards: `DO/Cert-minting`, `-open`, `-zoomed`, `-pdf`, `-link-expired`, `-failed`, `-offline`,
  `-not-viewable`, `-not-found`, `-text-sizes`, `-dark`.
- States: getting a secure link, image open, zoomed (non-gesture zoom/pan controls), PDF in app,
  link expired, failed, offline, image not available, 404.
- Ops: `createCertificateViewUrl` (presigned, 5 minutes; image loaded into memory, never cached
  to disk), `getRestaurantCertification` (details block).
- DS: AppBar, IconButton (zoom in/out), Button ("Fit to screen", "Open again"), DocumentViewer
  (Gap), ErrorState, EmptyState.
- Copy: "Halal certificate"; "Certified by"; "Valid until"; "Scope"; disclaimer verbatim from the
  API; "We log who opens certificates to protect the restaurant's document. The link is private
  and lasts five minutes."; "This link has expired"; "Certificate links last five minutes to keep
  the document private. Open it again for a new link."; "We couldn't open the certificate"; "The
  certificate image isn't available to view"; "This certificate isn't available any more".

**D8. How we check (halal)**
- Boards (authoritative): `AC/Legal`, `-dark`, `-360`, `-lt`; older `DO/How-we-verify`.
- Static page (approved wording; AppBar title "How we check", full name as the first heading).
  The seven checks and "HalalGoes does not itself certify food. Certifying bodies certify food;
  we check their certificates." No operation (the issuing-body list is Needs API and not shown).

**D9. Item sheet** (also the cart's edit-line sheet)
- Boards: `DO/Item-ready`, `-options-chosen`, `-photo`, `-choose`, `-max-error`, `-adding`,
  `-added`, `-different-restaurant`, `-new-cart-failed`, `-unavailable`, `-addon-unavailable`,
  `-kitchen-closed`, `-required-addon`, `-delta-variant`, `-max-qty`, `-simple`,
  `-out-of-stock`, `-closed`, `-paused`, `-out-of-range`, `-no-address`, `-offline`, `-loading`,
  `-error`, `-gone`, `-dark`, `-text-sizes`, `DO/Width-360` (Item frame), `CC/Cart-edit-line`.
- States: ready; options chosen; required size not chosen (error on the group); add-ons at max
  (others disabled with reason); required add-on group unmet (`min_select`); `pricing_mode`
  ABSOLUTE (header = chosen variant `price_cents`) vs DELTA (header "From" + base, options
  "+$x.xx"); quantity at 20; no options / allergens not provided; adding; added (sheet closes,
  toast "Added to your cart", cart bar); 409 `DIFFERENT_RESTAURANT` → Dialog "Start a new cart?"
  (from `error.details.current_restaurant_name`, `current_item_count`); start new cart failed (old
  cart intact); 409 `VARIANT_UNAVAILABLE`, `ADDON_UNAVAILABLE`, `RESTAURANT_CLOSED`,
  `ITEM_DELETED`/`NO_LIVE_MENU_ITEM` ("This dish isn't on the menu any more"); item out of stock;
  restaurant closed/paused/out of range/no address; offline; loading; error.
- Ops: `getRestaurantMenu` (there is no customer getMenuItem), `addCartLine` (`variant_ids`
  one per group after #644; `addons[]`, `quantity`, `special_request` ≤140; Idempotency-Key;
  `replace=true` on Start a new cart), `getCart`. Edit line: today remove + add (see §5 G12).
- DS: Sheet, MediaFrame, Badge (dietary, allergens), RadioGroup with option Price slot (Gap),
  Checkbox (group error and disabled reason: Gap), QuantityStepper (Proposed), Textarea (140,
  Proposed), InlineAlert (Proposed), Button (sticky "Add to cart" + Price), Dialog, Toast.
- Copy: "Size (required)"; "Extras · choose up to 2"; "Quantity"; "Special request (optional)";
  "The kitchen sees this. For allergies, contact the restaurant before you order."; "0 of 140
  characters used"; "Add to cart"; "Start a new cart?"; "Your cart has 2 items from Karahi House.
  A cart holds one restaurant at a time, so starting a new cart removes them."; "Start a new
  cart"; "Keep my cart"; "Added to your cart"; "This dish isn't on the menu any more"; "Zaytoun
  Grill has removed it. Your cart is unchanged."; "Back to the menu".
- a11y: QuantityStepper group named without the number; value is `role=status` with visible N
  plus hidden "Quantity "; option accessible name joins the price ("For one, 24 dollars 99
  cents"). The line total shows only after Add, from `cart.lines[].line_total_cents` (line price
  preview is Needs API).

### Cart and checkout (canvas `CC/`)

**C1. Cart**
- Boards: `CC/Cart-default` (interactive), `-quoting`, `-loading`, `-empty`, `-error`,
  `-offline`, `-active-order`, `-line-updating`, `-line-removed`, `-undo-failed`, `-max-qty`,
  `-edit-line`, `-unavailable-line`, `-variant-unavailable`, `-addon-unavailable`,
  `-item-deleted`, `-price-changed`, `-restaurant-closed`, `-restaurant-unavailable`,
  `-cert-lapsed`, `-no-address`, `-below-minimum`, `-clear-confirm`, `-dark`, `-text-2x`.
- States: priced from the quote (same rows and labels as checkout); pricing for your address;
  loading; empty; error; offline (read only); order already on the way (`getActiveOrder`; View
  order); line updating; line removed with Undo; Undo failed; line at 20; per-line
  `OUT_OF_STOCK`, `VARIANT_UNAVAILABLE`, `ADDON_UNAVAILABLE`, `ITEM_DELETED`/`CATEGORY_INACTIVE`,
  `PRICE_CHANGED` (was/now, both server values); restaurant closed or paused; restaurant
  unavailable (no halal cause, no badge); certification lapsed (`EXPIRED`, slate Banner, only +
  and checkout disabled); no address (estimate, "Items (estimate)"); below minimum
  (`blocking_reasons` contains `BELOW_MINIMUM_ORDER`, never a client comparison); clear confirm.
- Ops: `getCart`, `createQuote`/`getQuote` (when an address exists), `updateCartLine`
  (quantity), `removeCartLine`, `addCartLine` (Undo, edit), `clearCart`, `getActiveOrder`.
- DS: AppBar, Card, HalalBadge, QuantityStepper (at 1 the minus becomes Remove), MediaFrame,
  Price, Banner, Toast (Undo), Dialog, Button, Skeleton, EmptyState, ErrorState.
- Copy: "Your cart"; "Clear cart"; "Items subtotal"; "Delivery fee"; "Service fee" (always shown,
  even $0.00); "Total"; "Go to checkout"; "Your cart is empty"; "Add dishes from a certified
  restaurant to start an order."; "Find a restaurant"; "We couldn't load your cart"; "You already
  have an order on the way"; "Order HG-8F3K2Q from Zaytoun Grill is being prepared. You can place
  another once it's delivered."; "You can check out once your current order is delivered. Your
  cart is saved."; "View order"; "Zaytoun Grill's halal certificate isn't current, so we can't
  take this order. If the certificate is renewed, your cart will be here."; "Find another
  restaurant"; "Zaytoun Grill can't take orders right now"; "Below the minimum order"; "Zaytoun
  Grill's minimum order is $15.00. Add more items to check out."; "Add more items"; "You're
  offline"; "Showing your cart as of 6:42 pm. You can read it; changing quantities and checking
  out wait until you're back online."
- Lines render `line.variants[]` as "group: variant" joined with " · " (not `line.variant`,
  which is null for multi-variant lines after #644).

**C2. Checkout (main page)**
- Boards: `CC/Checkout-ready`, `-quoting`, `-offline`, `-tip`, `-tip-too-high`,
  `-prices-updated`, `-no-address`, `-error`, `-text-2x`, `-dark`, `DO/Width-360` (Checkout
  frame). `CC/Checkout-tax-review` is review-only (tax rows render `quote.tax_lines` verbatim;
  none at launch).
- States: ready; calculating; offline before placing; tip changed and re-quoted (focus stays on
  the tip group); tip over limit (422, show `error.message`); quote expired → prices updated
  (was/now); no address selected; error ("We couldn't price this order").
- Ops: `getCart`, `createQuote {cart_id, fulfilment: DELIVERY, delivery_address_id,
  tip_cents}`, `getQuote`, `listAddresses`, `listPaymentMethods`, `getPublicConfig`
  (`max_tip_cents`, `quote_ttl_seconds`).
- (added in check) `createQuote` requires an Idempotency-Key (as do `createOrder`,
  `cancelOrder`, `createRefund`, `addCartLine` and `createAddress`); never send `promo_code` or
  `scheduled_for` (promo codes and scheduling are out of launch).
- (added in check) `PaymentState` is a state family (design surface §3, "customer checkout");
  map all 8: REQUIRES_CONFIRMATION → `CC/Checkout-placing`; REQUIRES_ACTION → `CC/Checkout-3ds`,
  `TA/Track-3DS`; PROCESSING → `CC/Checkout-processing`, `TA/Track-3DS-Confirming`;
  REQUIRES_PAYMENT_METHOD → `CC/Checkout-declined`/`-another-way`, `TA/Track-PaymentFailed`;
  REQUIRES_CAPTURE → authorised, not charged (`CC/Order-placed-authorized`, `TA/Track-Waiting`);
  SUCCEEDED → charged (`amount_captured_cents`, T2 accepted line, receipt); CANCELED → hold
  released (`CC/Checkout-cancelled`, Outcome money lines); FAILED → `TA/Track-PaymentFailed`
  (retryable) or `TA/Outcome-Failed`. One table-driven test in WP6/WP7.
- DS: AppBar, Card, ListRow (Deliver to, Handover, Pay with; Proposed), RadioGroup (tip presets
  with Price slot: Gap), HalalBadge, Price, Button (sticky "Place order · $54.46"; at ≥1.3× text
  the Total row moves above the button), Banner.
- Copy: "Checkout"; "Deliver to"; "Pay with"; "Your order"; "About 25–35 min"; "Goes entirely to
  your rider. Changing the tip updates the total."; "Price held until 6:57 pm. This is the amount
  we'll charge."; "Place order ·"; "Your card is authorised now and charged only when the
  restaurant accepts."
- Excluded: promo code, seal step.

**C3. Checkout sheets**
- Boards: `CC/Checkout-handover-sheet`, `-address-sheet`, `-address-empty`, `-pay-sheet`,
  `-add-card` (loading, ready, rejected, limit), `-no-card`, `-wallet`, `-wallet-cancelled`,
  `-card-expired`, `-finish-profile` (default, saving, error).
- Ops: `listAddresses` (address sheet; per-address serviceability is Needs API, so all rows are
  selectable and an out-of-range choice lands on C5 cannot-deliver); `listPaymentMethods`,
  `createPaymentMethodSetupIntent` (Stripe SetupIntent; "Save card" is the consent),
  `updateCustomerProfile` (finish profile: first, last, email only; nothing pre-ticked).
  Handover writes `delivery_instructions[]` on `createOrder`: one of Leave at the door / Meet at
  the door / Meet in the lobby, plus "Don't ring the bell", "Don't call me" (enum
  `DeliveryInstruction`, max 5 items). (corrected in check) Rider notes (≤200) are NOT part of
  `delivery_instructions[]` (an enum array): they go in `OrderInput.special_instructions`
  (maxLength 200), prefilled from `Address.delivery_notes`, as `CC/Checkout-handover-sheet`
  binds them; whether `special_instructions` reaches the rider and not only the kitchen is
  "Contract to confirm" (§5 G37).
- DS: Sheet, RadioGroup, Checkbox, Textarea (200), Input, Button, InlineAlert, Stripe native
  PaymentSheet / CardField (existing `src/payments`).
- Copy: "How should the rider hand it over?"; "Notes for the rider (optional)"; "Done";
  "You've saved the most cards we allow"; "We need your name and email to place the order. Your
  cart and price stay as they are."; "Save and continue"; "Check your details"; "Finish your
  profile".

**C4. Placing, payment recovery and cancel at payment**
- Boards: `CC/Checkout-placing`, `-double-tap`, `-processing`, `-declined`, `-another-way`,
  `-3ds`, `-3ds-failed`, `-deadline-passed`, `-quote-stale`, `-checking`, `-declined-cancel`,
  `-cancel-states`, `-cancelled` (4 frames: put back, putting back, couldn't put back, cart holds
  another restaurant). `CC/Checkout-retries-exhausted` is Needs API: build only its "Put these
  items back" body reached from FAILED.
- States: placing (no optimistic navigation, "Placing your order… please keep the app open.");
  second tap (`IDEMPOTENCY_IN_PROGRESS`, same key); PROCESSING (poll `getOrderPayment`, WS);
  declined (order CREATED, "Order held for" countdown to `deadline_at` as a static time); another
  way to pay (same PaymentIntent); 3-D Secure; 3DS failed or cancelled; 15-minute deadline passed;
  price changed at placing (409 `QUOTE_STALE`, was/now from `error.details.quote`); connection
  dropped while placing (re-read `getActiveOrder`, never resend `createOrder` with a new key);
  cancel at payment (reason RadioGroup, nothing preselected, note 5–200 for OTHER); cancelled →
  "Put these items back in your cart".
- Ops: `createOrder` (Idempotency-Key, `quote_id`, `payment_method_id`,
  `delivery_instructions`), `getOrderPayment`, `getOrder`, `getActiveOrder`, `cancelOrder
  {reason_code: CustomerCancellationReasonCode, note}`, `addCartLine` per line for put-back (or
  `replaceCart` once #312 lands), Stripe confirm via `payments/payForOrder.ts`.
- Rule: after `createOrder` the order exists unpaid with a 15-minute deadline; decline, failed
  3DS and a closed wallet sheet recover on the SAME payment or cancel free. A second
  `createOrder` is never sent.
- Copy: "Your bank declined this card"; "Nothing was charged. Use another way to pay, or try this
  card again."; "Use another way to pay"; "Try this card again"; "Cancel order"; "Your bank needs
  to confirm this payment"; "Confirm with your bank"; "This order was cancelled"; "The payment
  wasn't completed within 15 minutes. Nothing was charged."; "You can put the same items back in
  your cart. We'll check each one and its price again."; "Put these items back in your cart";
  "Putting your items back"; "We couldn't put your items back"; "The price changed"; "It changed
  while you were placing the order. Nothing has been charged."; "Review my order"; "Order
  cancelled"; "Nothing was charged and nothing is held on your card."; "Replace them".

**C5. Checkout blocks**
- Boards: `CC/Checkout-active-order`, `-active-race`, `-blocked` (every blocking error),
  `-cannot-deliver`, `-unavailable`, `-halal-lapsed`, `SI/Blocked-midcheckout`.
- States: active order (fallback; Cart warns first; View order routes by state); race at placing
  (409 `ACTIVE_ORDER_EXISTS`, Dialog "View order"/"Stay here"); blocking reasons from quote and
  place (minimum order, ordering paused with `Retry-After`, closed, rate limited, province not
  served); address out of range; restaurant unavailable (409, no halal cause); halal lapsed (409
  `RESTAURANT_UNAVAILABLE` then a cart re-read shows `EXPIRED`); suspended mid-checkout.
- Ops: `createQuote`, `createOrder` errors; `getCart` re-read; `getActiveOrder`.
- Copy: "Zaytoun Grill doesn't deliver to Work"; "2075 Kennedy Rd is outside its delivery area.
  Choose another address to see a price."; "We'll price your order once you choose an address
  Zaytoun Grill delivers to."; "Zaytoun Grill's halal certificate isn't current, so we can't take
  this order. Nothing was charged. If the certificate is renewed, your cart will be here."; "No
  price while this restaurant is unavailable."

### Tracking and after (canvases `CC/` and `TA/`)

**T1. Order placed / waiting (pre-acceptance layout of the tracking screen)**
- Boards: `CC/Order-placed`, `CC/Order-placed-authorized`, `CC/Order-placed-cancel`,
  `CC/Order-preparing`, `TA/Track-Placing`, `TA/Track-HoldPlaced`, `TA/Track-Authorized-Slow`,
  `TA/Track-Waiting`, `-Waiting-Zero`, `-Waiting-ExpiringSoon`, `-Waiting-NoHalal`,
  `-Waiting-Reconnecting`, `-Waiting-Offline`, `DO/Motion-reduced` (corrected in check: there is
  no `CC/Motion-reduced` board; the reduced-motion reply-by bar and Toast live only on `DO/`).
- Treat the `CC/Order-*` boards and the `TA/Track-*` waiting boards as ONE route (tracking) in
  `CREATED`/`AUTHORIZED`/`RESTAURANT_PENDING`; `TA/` wins where they differ (it is the later
  canvas).
- States: CREATED placing; AUTHORIZED ("Sending your order to Zaytoun Grill", spinner); slow
  AUTHORIZED; RESTAURANT_PENDING with the neutral WaitProgress bar from `deadline_at` against
  server time plus "Zaytoun Grill replies by 6:45 pm"; bar at 0 waiting for the server; halal
  EXPIRING_SOON on the card; halal missing (no badge); reconnecting; offline (window keeps
  running).
- Ops: `getOrder` (OrderCustomerView: state, deadline_at, can_cancel, lines, money, restaurant
  halal), `getOrderTracking`, `createRealtimeTicket` + WS `order:{id}` (`order.state_changed`,
  `payment.*`), `getPublicConfig.restaurant_response_window_seconds`.
- DS: AppBar ("Order HG-8F3K2Q"), WaitProgress (Proposed; or Countdown bar-only: Gap), Card,
  HalalBadge (sm, surface card), Price, StatusTimeline, Button, Spinner (Gap: not exported).
- Copy: "Waiting for Zaytoun Grill to accept"; "Restaurant replies by 6:52 pm"; "Your card is
  authorised, not charged. If Zaytoun Grill doesn't accept by 6:52 pm, the authorisation is
  released and nothing is charged."; "Total authorised"; "Track order"; "Cancel order"; "Free to
  cancel until the restaurant accepts."; "Sending your order to Zaytoun Grill"; "Your payment is
  held. We're passing the order to the kitchen now."
- Rule: no countdown numeral and nothing red; Cancel renders only while `can_cancel`.

**T2. Live tracking (PREPARING → ARRIVED), every DispatchState**
- Boards: `TA/Main` (interactive live map), `TA/Track-Preparing`, `-Prep-Searching`,
  `-Prep-Assigned`, `-Prep-AtRestaurant`, `-Overdue`, `-ItemsAdjusted`, `-ItemsAdjusted-Refund`,
  `-CertLapsed`, `-CertRevoked`, `-FindingRider`, `-RiderAssigned`, `-Ready-AtRestaurant`,
  `-AnotherRider`, `-NoRider`, `-Delivery-Overdue`, `-LocationStale`, `-Reconnecting`,
  `-Polling`, `-Offline`, `-Offline-HalalStale`, `-MapFailed`, `-Arrived-Met`,
  `-Arrived-Lobby`, `-Arrived-Door`, `-Arrived-Overdue`, `-Arrived-Overdue-Lobby`,
  `-FullScroll`, `-ReportOpen-Early`, `-Loading`, `-Error`, `-NotFound`, `-Dark`, `-Text2x`,
  `-360`, `CC/Order-preparing`.
- States (OrderState × DispatchState): PREPARING with PENDING/SEARCHING/ASSIGNED/AT_RESTAURANT;
  running late (new ETA); items adjusted (refund not issued / issued); certificate lapsed
  mid-order (slate EXPIRED badge + neutral notice) and revoked (UNVERIFIED: no badge + neutral
  notice); READY_FOR_PICKUP finding rider / assigned / at restaurant / another rider
  (`dispatch.unassigned`) / no rider yet (escalating, "Update by"); PICKED_UP on the way with
  live map; DELIVERY_OVERDUE; rider location stale (45 s); reconnecting; polling every 15 s;
  offline (cached halal ≤15 min) and offline past 15 min (badge removed); map tiles failed (text
  fallback); ARRIVED meet at door / in lobby with the **4-digit delivery code**; leave at door (no
  code); rider waiting 15 min (door / lobby); report open before delivery ("Your report" card);
  loading; error; no active order.
- (added in check) Delivery code locked: after five wrong codes #290 returns `delivery_code: null`
  on a met handover in ARRIVED and hands the order to support (fixtures
  `tracking_arrived_delivery_code_locked`, `order_arrived_delivery_code_locked`). No board draws
  it: reuse the `-Arrived-Lobby`/`-Arrived-Met` layout with the code block removed and one neutral
  line that HalalGoes support will confirm the handover (no red, no rider blame). Render the code
  block only while `delivery_code` is non-null, never from a push or socket event.
- (added in check) Full `DispatchState` mapping (the boards name only the customer-facing
  phrases): PENDING, SEARCHING, OFFERED → "Finding a rider" family (`-Prep-Searching`,
  `-FindingRider`); ASSIGNED → `-Prep-Assigned`/`-RiderAssigned`; AT_RESTAURANT →
  `-Prep-AtRestaurant`/`-Ready-AtRestaurant`; CARRYING → PICKED_UP on the way (`TA/Main`);
  AT_CUSTOMER → ARRIVED boards; UNASSIGNED → `-AnotherRider`; NO_RIDER_FOUND → `-NoRider` while
  escalating, `TA/Outcome-NoRider` once the order is cancelled; COMPLETED → DELIVERED boards.
  OrderState wins where the two disagree (the H1 is driven by OrderState).
- Ops: `getOrder`, `getOrderTracking` (eta_at, eta_window_minutes, rider_location only in
  PICKED_UP/ARRIVED, `delivery_code` after #290), `getOrderRiderPublicProfile` (first name, last
  initial, photo, vehicle; never show `rating_avg`), `getOrderPayment`
  (`amount_captured_cents` for "charged"), `listRefunds?order_id`, WS `order.*`, `dispatch.*`,
  `payment.*`, `refund.*`, `order.rider_arrived` (#290). REST polling fallback 15 s.
- DS: AppBar, MapView (Proposed: `@rnmapbox/maps` inside a Card; pins
  `map-pin-restaurant`/`-customer`/`-rider`), Avatar (Proposed, initials), Card, HalalBadge,
  StatusTimeline (connection offline/polling states: Gap; 12-hour times: Gap), Price, Badge,
  Banner/InlineAlert, Button ("Get help"), Skeleton, ErrorState, EmptyState.
- Copy: H1 is the state line, e.g. "On the way · Arriving 7:10–7:20 pm" (spoken "On the way,
  arriving between 7:10 and 7:20 pm"), "Being prepared · Arriving …", "Ready · Arriving …",
  "Running late · New estimate …", "Finding a rider · Update by 7:24 pm", "Yusuf is at your
  door", "Yusuf is in the lobby", "Yusuf is still waiting for you"; "Read this code to Yusuf";
  "Delivery code: 4, 8, 2, 6" (spoken digit by digit, visible digits aria-hidden); "You asked for
  it to be left at the door, without ringing the bell. No code is needed."; "Yusuf A. is bringing
  your order"; "Zaytoun Grill accepted at 6:44 pm. Your Visa •••• 4242 was charged"; "You can't
  cancel now the kitchen has started. Get help if something is wrong."; "Zaytoun Grill's halal
  certificate has lapsed"; "Your order was accepted while their certificate was valid, so it goes
  ahead as normal. You won't be able to order from them again until it's renewed."; "Zaytoun
  Grill's halal certificate is no longer verified by HalalGoes"; "We haven't found a rider yet";
  "You're offline. This is what we knew at 7:04 pm."; "Halal status shows again when you're back
  online."; "Loading your order"; "We couldn't load this order"; "No order on the way"; "This
  order has finished, or the link is out of date. Your past orders and receipts are in Orders."
- a11y: focus is never moved on a data refresh or push; ETAs and codes aria-hidden with a hidden
  spoken sentence; map is role=img with the text fallback read in order.
- Excluded: "Call Yusuf"/"Message Yusuf" (masked contact Needs API), proof-of-delivery photo.

**T3. Payment recovery on the tracking screen**
- Boards: `TA/Track-3DS`, `-3DS-Confirming`, `-PaymentFailed`, `TA/Payment-ChooseCard`,
  `-Loading`, `-Error`, `-Empty`, `-Terminal`, `TA/Cancel-Reason-ChooseCard`.
- States: confirm with your bank (CREATED); back from bank, confirming; payment failed retryable;
  choose another card sheet (loading, error, empty, terminal variant for FAILED/CAPTURE_FAILED:
  nothing cancelled, items go back).
- Ops: `getOrderPayment`, `listPaymentMethods`, `cancelOrder`, put-back `addCartLine`s; WS
  `payment.action_required`, `payment.failed{retryable, decline_code}`.
- Rule: "Try another card on this order" is NOT drawn as real (Needs API: retry with a new
  payment_method_id). "Choose another card" cancels this order (only when the customer confirms)
  then puts items back and opens the cart with that card preselected on the device.
- Copy: "Your payment didn't go through"; "Your bank declined Visa •••• 4242"; "Nothing was
  charged. If you choose another card, we'll cancel this order so you can order again with
  another card."; "Choose another card"; "We'll put your items back in your cart and check the
  price again before you pay."; "Add a new card"; "Cancel and order again from Zaytoun Grill";
  "Not now"; decline headlines from a fixed map of `decline_code`, never raw bank text.

**T4. Cancel sheet (before acceptance)**
- Boards: `TA/Cancel-Reason`, `-Reason-Created`, `-Reason-NoReason`, `-Other`, `-Confirm`,
  `-Error`, `-WindowClosed`, `-Reason-Accepted`, `-Dark`, `CC/Order-placed-cancel`.
- States: reason (nothing chosen; focus on "Keep my order"); CREATED helper copy; pressed with no
  reason (RadioGroup error, focus to group); Something else note too short (5–200); sending;
  failed; 409 `CANCELLATION_WINDOW_CLOSED` (screen replaces sheet, shows charge from
  `getOrderPayment.amount_captured_cents`); restaurant accepts while the sheet is open (sheet
  changes before a press).
- Ops: `cancelOrder {reason_code, note}` with Idempotency-Key; reasons =
  `CustomerCancellationReasonCode` (ORDERED_BY_MISTAKE, TOO_LONG_WAIT, WRONG_ADDRESS,
  CHANGED_MIND, DUPLICATE_ORDER, OTHER).
- DS: Sheet, RadioGroup, Textarea (Proposed), Button (destructive + "Keep my order"), InlineAlert.
- Copy: "Cancel this order?"; "Reason for cancelling"; "If you cancel, the hold on your card is
  released and you won't be charged." (AUTHORIZED/RESTAURANT_PENDING); "Cancelling ends this order
  and nothing is charged. This can't be undone." (CREATED); "Keep my order"; "It's too late to
  cancel here"; "Cancelling is only free before the restaurant accepts."

**T5. Get help sheet, explainers and contact**
- Boards: `TA/GetHelp-Sheet`, `-Sheet-Preparing`, `-Late`, `-HalalEarly`, `-Contact`,
  `-Contact-Closed`, `-Contact-Unavailable`, `-Delivered`, `-Dark`, `-Text2x`, `-360`.
- States: sheet before delivery (PICKED_UP/ARRIVED; PREPARING/READY variant); after delivery
  (DELIVERED/COMPLETED: report rows NEVER_DELIVERED, MISSING_ITEMS, HALAL_CONCERN, LATE_DELIVERY,
  OTHER); late explainer (eta window, `deadline_at`); halal concern before delivery (explainer,
  "Got it"); contact open (Call us with `support_phone_e164` and `support_hours`); closed
  (`support_enabled=false` with hours: self-serve list for the order's state); unavailable (no
  hours).
- Ops: `getOrder`, `getOrderTracking`, `getPublicConfig`; Call uses `Linking.openURL('tel:')`.
- DS: Sheet, ListItem/ListRow (Proposed), Button, Card, HalalBadge, Icon (phone: gap).
- Copy: "Get help with this order"; "My order is late"; "See the latest arrival time and what
  happens next"; "Report a problem"; "Very late, wrong address, or you want to cancel"; "A halal
  concern"; "What we check, and how to report after delivery"; "Something else"; "Call us";
  "Contact us about this order"; "Our phone line is closed"; "We answer calls every day, 11:00
  am to 11:00 pm. Until then, these can help with order HG-8F3K2Q." (hours text is
  `support_hours` verbatim); "Phone support isn't available right now"; "I didn't get my order";
  "It says delivered but nothing arrived"; "Something is missing or wrong"; "Tell us what
  worries you. A person reviews every report"; "If it hasn't arrived by 8:17 pm, our team steps
  in and we let you know. You don't need to do anything."; "Your order isn't with you yet. Once
  it's delivered, you can report a halal concern from this order and a person will review it."

**T6. Report a problem (createRefund form)**
- Boards: `TA/GetHelp-Report-Early`, `-Report-Early-Required`, `TA/GetHelp-Refund`,
  `-Refund-NeverDelivered`, `-Refund-Missing`, `-Refund-Items`, `-Refund-Items-Invalid`,
  `-Refund-KindInvalid`, `-Refund-Late`, `-Refund-Other`, `-Refund-Sending`, `-Refund-Error`,
  `-Refund-AlreadyRequested`, `-Refund-WindowClosed`, `-Refund-NotRefundable`, `-Refund-Sent`,
  `TA/Track-ReportOpen-Early`.
- States: before delivery (very late = LATE_DELIVERY, want to cancel = CUSTOMER_CHANGED_MIND,
  wrong address = WRONG_ADDRESS after #312 else OTHER + note, something else = OTHER note
  required); after delivery with reason preselected by the row tapped; "Which part of the
  order?" (FULL / PARTIAL_ITEMS with line picker + quantities / FEES_ONLY); no kind chosen; no
  items chosen; OTHER needs description; sending; error; 409 `REFUND_ALREADY_REQUESTED`,
  `REFUND_WINDOW_CLOSED` (48 h), `PAYMENT_NOT_REFUNDABLE`; sent ("Under review").
- Ops: `createRefund {order_id, reason_code, kind, lines[{order_line_no, quantity}], note}`
  (no amounts), `listRefunds?order_id`, `getOrder`.
- (added in check) `createRefund` requires an Idempotency-Key (reuse it on retry after a dropped
  connection). It can also return 409 `REFUND_EXCEEDS_CAPTURED` (on main; canvas note s10; #312
  adds fixture `error_refund_exceeds_captured`): no board draws it, so render it on the
  `-Refund-NotRefundable` layout ("We can't take a report for this order here") rather than an
  unhandled error. #312 splits `REFUND_ALREADY_REQUESTED` into item and fee variants
  (`error_refund_already_requested_items`, `_fees`).
- DS: AppBar, RadioGroup, Checkbox + QuantityStepper (line picker), Textarea (1000), StickyFooter
  (Proposed), Button, Card, Badge, EmptyState, InlineAlert.
- Copy: "Report a problem"; "Tell us what went wrong. A person reviews every report and we work
  out any refund from your order, so you don't enter an amount."; "What went wrong?"; "Which part
  of the order?"; "Tell us more (optional)"; "Only our team sees this."; "Send report"; "Report
  sent"; "Thank you for telling us. A person will review it with the order's records, and we'll
  let you know what happens next."; "Under review"; "You've already reported a problem with this
  order"; "It's too late to report a problem here"; "We can't take a report for this order here".
- Excluded: "Photos (optional, up to 3)" (customer upload purpose is Needs API).

**T7. Delivered and completed (order page for a past order)**
- Boards: `TA/Track-Delivered`, `-Delivered-LeftAtDoor`, `-Delivered-CertLapsed`,
  `-Completed`, `-Completed-ReportOpen`, `-Completed-Refunded`.
- States: delivered met; delivered left at door; cert lapsed or halal missing (no badge, same as
  all post-delivery); completed (View receipt primary, appears with `order.completed.receipt_url`
  or `completed_at`); report under review row; refunded row.
- Ops: `getOrder`, `getOrderPayment`, `listRefunds?order_id`.
- Copy: "Delivered"; "Delivered at 7:13 pm"; "You asked to meet at the door."; "Charged";
  "Refund"; "On its way"; "Get help with this order"; "We'll add your receipt here when the order
  is complete, and let you know."; "Order complete"; "View receipt".

**T8. Outcome screens (stay until dismissed, always state the money)**
- Boards: `TA/Outcome-CancelledByYou`, `-CancelledByYou-Created`, `-Timeout`, `-Rejected`,
  `-Rejected-Item`, `-RestaurantClosed`, `-Failed`, `-PaymentExpired`, `-CaptureFailed`,
  `-NoRider`, `-RefundInProgress`, `-SupportCancelled`, `-Disputed`, `-Disputed-Delivery`,
  `-Disputed-Restaurant`, `-Resolved`, `-Resolved-Partial`, `-Resolved-NoRefund`, `-Dark`.
- States: one board per `OrderState` terminal/`DISPUTED` × `cancel_reason`/`reject_reason`
  (KITCHEN_AT_CAPACITY, CLOSING_SOON, EQUIPMENT_FAILURE → plain words; ITEM_UNAVAILABLE → "Change
  your order at …"; ADDRESS_OUT_OF_RANGE → "Check your address"; SUSPECTED_FRAUD/OTHER → no
  reason) × `RefundState` (FAILED reads "Refund in progress", never "Refunded").
- (added in check) `OrderCancellationReasonCode` → board, all 11 members: CUSTOMER_CANCELLED →
  `-CancelledByYou`/`-CancelledByYou-Created`; RESTAURANT_TIMEOUT → `-Timeout`;
  RESTAURANT_CLOSED → `-RestaurantClosed`; ITEM_UNAVAILABLE → `-Rejected-Item`; CAPTURE_FAILED →
  `-CaptureFailed`; PAYMENT_EXPIRED → `-PaymentExpired`; NO_RIDER_FOUND → `-NoRider`;
  SUPPORT_CANCELLED, PREP_OVERDUE, PLATFORM_ERROR, FRAUD_SUSPECTED → the `-SupportCancelled`
  layout with the headline from its annotation: PREP_OVERDUE "Zaytoun Grill couldn't finish your
  order in time."; SUPPORT_CANCELLED "Our support team cancelled this order."; PLATFORM_ERROR
  "Something went wrong on our side."; FRAUD_SUSPECTED "We had to cancel this order." (never an
  accusation). Refund amount and state always from the server. An unknown future code falls back
  to "Your order was cancelled" with the money lines.
- Ops: `getOrder`, `getOrderPayment` (`amount_authorized_cents`, `amount_captured_cents`),
  `listRefunds?order_id`, WS `order.cancelled{refund}`, `refund.*`; put-back `addCartLine`s on
  CancelledByYou, CancelledByYou-Created, PaymentExpired, CaptureFailed, Failed, Rejected-Item.
- DS: AppBar, Card ("Your money"), Price, Badge, Button, StatusTimeline (disputed boards).
- Copy (headlines): "Order cancelled"; "Zaytoun Grill didn't respond in time"; "Zaytoun Grill
  couldn't take your order"; "Zaytoun Grill stopped taking orders"; "The bank check wasn't
  finished"; "We couldn't take payment"; "We couldn't find a rider"; "Your order was cancelled";
  "We're looking into this"; "We're looking into your delivery"; "Zaytoun Grill can't finish your
  order"; "We've finished reviewing this order"; money lines "Hold on Visa •••• 4242, released",
  "Your bank may take a few days to remove the hold from your statement.", "Refunded on 30
  September 2026"; actions "Find another restaurant", "Back to Orders", "Find something to eat",
  "Done".

**T9. Orders history**
- Boards: `TA/Orders-Default`, `-Disputed`, `-RowMenu`, `-Loading`, `-Empty`, `-Error`,
  `-Error-Both`, `-LoadMore`, `-LoadMoreFailed`, `-End`, `-Dark`, `-Text2x`, `-360`.
- States: active pinned then past; DISPUTED listed under Active but not blocking; row menu
  (View receipt, Get help; no Rate); loading; never ordered; past failed (active kept, inline
  error); both failed; loading more; load more failed; end.
- Ops: `listOrders?status_group=ACTIVE`, `listOrders?status_group=PAST` (cursor), `getActiveOrder`
  + `getOrderTracking` for the live card. BottomNav Orders badge = count of ACTIVE rows (DISPUTED
  included).
- Row badges per OrderState (verbatim, note s6): CREATED/AUTHORIZED "Placing";
  RESTAURANT_PENDING "Waiting for restaurant"; PREPARING "Being prepared"; READY_FOR_PICKUP
  "Ready"; PICKED_UP "On the way"; ARRIVED "At your door"; DELIVERED "Delivered"; COMPLETED
  "Completed"; DISPUTED "Under review"; RESOLVED "Resolved"; CANCELLED "Cancelled"; REJECTED "Not
  accepted"; FAILED "Payment failed". Active states use the info Badge except DISPUTED; the rest
  neutral. Only REJECTED and FAILED say "Not charged"; CANCELLED and RESOLVED say "See details for
  your money"; no bare totals. Row text "{item_count} items · {first_item_names}", wrapping.
- DS: AppBar, Card, Badge, Price, Button ("Track", "Get help", "Details"), Menu ("Actions for
  order {code} from {restaurant}"), Skeleton, EmptyState, ErrorState, BottomNav.
- Copy: "Orders"; "Active orders"; "Past orders"; "No orders yet"; "When you order, you can follow
  it here, then find your receipt."; "Find a restaurant"; "We couldn't load your past orders";
  "Your active order above is up to date."; "We couldn't load your orders".
- Excluded: reorder from the row menu (Needs API; the current `reorder()` in `api/orders.ts`
  from #639/#649 must not be wired to a visible action), history search.

**T10. Receipt**
- Boards: `TA/Receipt-Default`, `-Refund`, `-RefundStates`, `-NotReady`, `-NeverCompleted`,
  `-Loading`, `-NoCharge`, `-Error`, `-Dark`, `-Text2x`, `-360`.
- States: charged (service fee $0.00, no tax rows while `tax_lines` empty); settled refund;
  refund section in every RefundState; not ready (409 `RECEIPT_NOT_READY`, DELIVERED); never
  completed (DISPUTED/RESOLVED without `completed_at`); loading; none, not charged (409; second
  sentence chosen by `amount_authorized_cents`); error.
- Ops: `getOrderReceipt` (frozen snapshot), `getOrderPayment`, `listRefunds?order_id`.
- DS: AppBar, Card, Price, Badge, Button ("Get help").
- Copy: "Receipt"; "Receipt number"; "Items subtotal"; "Delivery fee"; "Service fee"; "Rider
  tip"; "Total"; "Visa •••• 4242, charged"; "Your receipt isn't ready yet"; "There's no receipt
  for this order"; "No receipt for this order"; "You weren't charged, so there is nothing to
  show. The hold on your card was released when the order didn't go ahead."; "We couldn't load
  your receipt". Legal names and tax numbers only when non-null.
- Excluded: download/share.

### Account (canvas `AC/`)

**A1. Account**
- Boards: `AC/Account` (wrapper), `AC/Account-unverified`, `-resent`, `-resendlimited`,
  `-resendday`, `-focus`, `-pendingemail`, `-noemail`, `-nosupport`, `-supportclosed`,
  `-sublinesloading`, `-sublineserror`, `-loading`, `-error`, `-dark`, `-360`, `-lt`.
- States: default; email not confirmed ("Not confirmed", "Send the link again"); sending the link
  (wrapper state `resending`, button loading; added in check); link sent;
  resend 429 per minute (static time) and per day; after changing email (pending); no email ("Add
  an email"); support open / closed (hours) / unavailable; payment subline loading / failed;
  loading; error.
- Ops: `getCustomerProfile`, `resendEmailVerification`, `listAddresses` (default subline),
  `listPaymentMethods` (subline), `getPublicConfig` (support).
- DS: Card per group, ListRow (64 px; Proposed), Avatar (Proposed), Badge, Button, Icon (card,
  receipt, phone, gift, document, settings: gaps, empty slot not borrowed glyph), Skeleton,
  ErrorState.
- Copy: groups "Ordering", "Notifications and privacy", "Help and about"; rows "Addresses",
  "Payment methods", "Refunds" ("Requests and where they are"), "Notification settings",
  "App settings" ("Location and appearance"), "Call support" ("[support_hours]. Have your order
  code ready."), "Phone support is closed now", "Phone support isn't available right now", "How
  we check halal certificates", "What's new", "Terms and privacy"; "You've asked 5 times today.
  Try again tomorrow."; Delete account row says to ask by phone or email (support email Needs
  API until #312 `PublicConfig.support_email`).

**A2. Edit details sheet**
- Boards: `AC/Account-edit`, `-editemail`, `-editinvalid`, `-editinvalid-dark`,
  `-editfirstempty`, `-editoffline`, `-editsaving`, `-editerror`, `-editunsaved`, `-editkbd`,
  `-editdark`, `-addemail`.
- Ops: `updateCustomerProfile`. Phone is read-only. An email can be changed, not removed (say so
  before saving).
- (added in check) `-pendingemail` carries "Needs API: pending_email and previous_email on
  CustomerProfile": today the contract replaces the email at once and sets `email_verified`
  false, so the app can show only the new address as "Not confirmed" and cannot say "your old
  address stays in use". Build to today's contract; do not draw the old address (§5 G39). The
  wrapper's `editfocus`/`editinuse` states alias `-edit`/`-editinvalid` (a rejected email is 422
  `VALIDATION_FAILED`; customer emails are not unique).
- DS: Sheet (Save in the footer above the keyboard), Input, Button, Dialog (unsaved changes).

**A3. Address form (PRIMARY launch path)** — supersedes `DO/Address-add`, `-confirm-pin`,
`-add-states`, `-search`, `-manual`.
- Boards: `AC/AddressForm` (wrapper), `AC/AddressForm-today`, `-first`, `-kbd`, `-manualfocus`,
  `-filled`, `-validation`, `-invalidfocus`, `-geocoding`, `-geodown`, `-locdenied`, `-mapfocus`,
  `-notserved`, `-outside`, `-saving`, `-saveerror`, `-server422`, `-conflict`, `-limit`,
  `-unconfirmed`, `-repin`, `-offline`, `-edit`, `-editloading`, `-edit404`, `-editother`,
  `-editoffline`, `-settingdefault`, `-defaultdone`, `-defaultfail`, `-deleteconfirm`,
  `-deleting`, `-deletefail`, `-inuse`, `-unsaved`, `-dark`, `-360`, `-lt`.
- States: new (search focused, map ready), first address, pin on the door with "Check the pin"
  box unticked (Save gated on the box: error on the box, focus there), typing manually, filled,
  validation, filling from the pin (reverse geocode), search down (drag pin and type), location
  off (default centre, neutral note, not a blocker), Move pin controls focused, Quebec not served
  (from search; disables Save), delivery-area check (Needs API only: skip), saving, save failed,
  server 422 (field named in details), 409 (other than limit), 21st address, offline; edit
  (stored pin), dragged pin (re-check), loading, 404 deleted elsewhere, make default (applies now,
  toast, failure), delete confirm (focus on Keep) / deleting / failed, `ADDRESS_IN_USE` (View order
  → `listOrders` ACTIVE), leaving with unsaved changes.
- Ops: `createAddress`, `getAddress`, `updateAddress`, `deleteAddress`, `setDefaultAddress`,
  `getPublicConfig.served_provinces`; after #300: `suggestAddresses` (session_token),
  `getPlaceAddress`, `reverseGeocode` (no backend handlers yet, §5 G2). The pin's
  latitude/longitude are what `createAddress` stores.
- DS: AppBar, Input (search, line1, unit, buzzer, city, postal code), MapView/AddressMapPicker
  (Proposed; Move pin N/S/E/W buttons for keyboard and switch users; map role=img), Checkbox
  ("Check the pin", default), Textarea ("Delivery notes", 200), Button (sticky Save), Dialog,
  InlineAlert, Skeleton, EmptyState, Toast.
- Copy: "Find your door on the map"; "Use my current location"; "Move pin"; "Is the pin on the
  entrance of {line1}?"; "Getting to your door"; "Delivery notes" (not "Notes for your rider");
  "Address name" (Home / Work quick picks); privacy line "Riders offered your delivery see only
  your general area before they accept. The rider who accepts sees your full address, including
  unit, buzzer and notes. The restaurant sees it once it starts preparing your order; before
  that, only your area."; "We deliver in Ontario only for now"; "Search for another address";
  "This address was deleted"; "Check the postal code"; "We couldn't save this address". Province
  is read-only "Ontario".
- Rule: Unit line shown as stored when it starts with Unit/Apt/Suite/#, else prefixed "Unit "
  (never "Unit Unit 4211"). Unit and Buzzer stack at 200 % text and below 375 px.

**A4. Saved addresses**
- Boards: `AC/Addresses`, `-focus`, `-loading`, `-empty`, `-error`, `-offline`, `-limit`,
  `-deletedlast`, `-deleteddefault` (Needs API: promotion), `-deletednodefault`, `-360`,
  `-dark`, `-lt`.
- Ops: `listAddresses`, `getCustomerProfile.default_address_id`.
- DS: AppBar, ListRow (one press target opens edit), Badge ("Default"), Button ("Add address",
  disabled at 20 and offline with the reason), Skeleton, EmptyState, ErrorState, Banner, Toast.
- Copy: "Saved addresses"; "No saved addresses"; "Search for an address and drag the pin onto
  the door your rider should use. You don't need to be there."; "We couldn't load your
  addresses"; "Choose a default address"; "Your default was deleted. Open an address and make it
  your default, and we'll use it first on Home and at checkout."

**A5. Notification settings**
- Boards: `AC/NotificationSettings` and every `AC/NotificationSettings-*`.
- States: push allowed / not asked ("Turn on notifications" triggers the OS prompt) / denied
  ("Open phone settings"); email switch turning on / on (consent date) / turning off / off /
  change failed / no email / on but unconfirmed; offline; loading; load error.
- Ops: `getCustomerProfile`, `updateCustomerProfile {marketing_consent}` (Switch keeps its old
  position until the server confirms), `registerDevice` after permission, Expo Notifications
  permission API.
- DS: Card, Switch, Button, Banner, Skeleton, ErrorState.
- Copy: "Order updates"; "We tell you when the restaurant accepts, when your rider is on the way
  and when your food arrives. Your order's tracking screen always shows them too."; "Push
  notifications"; "Allowed on this phone"; "To turn them off, use your phone's settings for
  HalalGoes."; "Turn on notifications"; "Push notifications are off"; "You agreed on 3 September
  2026. Turn this off at any time."; "You won't get news or offers by email. We still email you
  about your account, like confirming your address."

**A6. App settings**
- Boards: `AC/AppSettings`, `-notasked`, `-off`, `-focus`, `-dark`, `-360`, `-lt`.
- No API. Location permission (optional) and appearance (follows the phone; no in-app choice).

**A7. What's new (sheet and page)**
- Boards: `AC/WhatsNew`, `-multi`, `-page`, `-empty`, `-multi360`, `-sheetfocus`, `-pagefocus`,
  `-held`, `-later`, `-dark`, `-page-dark`, `-page-360`, `-lt`, `-page-lt`.
- No API: notes ship in the app (`release-notes.json`, #97); a corrupt bundle shows the empty
  state with the store link. Shown once after an update, on Home only, held during checkout or
  tracking; a new device shows only the latest release (decision log).

**A8. Terms and privacy (signed in and signed out)**
- Boards: `AC/Legal-terms`, `-terms-focus`, `-termserror`, `-termsloading`, `-terms-dark`,
  `-terms-signedout`.
- Ops: `getPublicConfig` (links/legal text source).
- (added in check) The Terms board carries "Needs API: record terms_version acceptance (shown at
  sign-in); version comes from PublicConfig.terms_version". `PublicConfig.terms_version` exists on
  main, but no customer operation records acceptance (only restaurant registration takes
  `terms_version`). Show the version; do not claim acceptance is recorded (§5 G38).

**A9. Email link verification (deep link)**
- Boards: `AC/EmailVerify-checking`, `AC/EmailVerify`, `-successconsent`, `-error`, `-expired`,
  `-expiredsending`, `-expiredsent`, `-expiredlimited`, `-expiredday`, `-used`, `-usedconfirmed`,
  `-usedunconfirmed`, `-dark`, `-error-dark`, `-lt`. Excluded (Needs API): `-browser`,
  `-otheraccount`.
- (corrected in check) `-360` is the BROWSER variant at 360 px (board title "Email link —
  browser, 360 wide"), so it is excluded with `-browser`; use `-dark`/`-lt` for the in-app
  acceptance boards. `-signedout` is now BUILDABLE: its only Needs API tag says verifyEmail must
  not issue a session, and on main `verifyEmail` is public (`security: []`), returns 204 and
  "issues no session and sets no cookie". So on a signed-out phone the app calls `verifyEmail`
  and shows "Your email is confirmed. Sign in with your mobile number to keep ordering." with
  Sign in. `-otheraccount` stays excluded: the 204 does not say whose email it was.
- Ops: `verifyEmail {token}` (204; 410 `VERIFICATION_TOKEN_EXPIRED`, `VERIFICATION_TOKEN_USED`),
  `resendEmailVerification` (202; 429 at 1/min and 5/day), `getCustomerProfile.email_verified`.

**A10. Sign out**
- Boards: `AC/Account-signout` (focus on "Stay signed in"), `-signingout`, `-signoutfail`.
- Ops: `logout`, `unregisterDevice`. Offline or on failure the local session is cleared anyway
  and the refresh token is revoked when the phone reconnects; lands on S6.

### Not drawn (needs a decision, §7 Q4)

Payment methods page and Refunds page are linked from Account ("open screens drawn by Checkout
and Orders") but no board draws them. Proposal: Payment methods = the `CC/Checkout-pay-sheet`
list as a page with `listPaymentMethods`, `setDefaultPaymentMethod`, `deletePaymentMethod` and
`CC/Checkout-add-card`; Refunds = `listRefunds` rows using the T6 "Your report" card and the T10
refund-state copy. Both need owner sign-off; cut first if time runs out.

## 3. Work packages

Assumption for every WP: the stack #644 → #625 → #634 → #649, plus #635 and #639, is merged first
as the functional baseline (they are open, mostly clean, and hold the data, error and payment
logic). WPs then rebuild the UI layer on design-system components. See "What the open PRs
already do" at the end of this section.

**Constitution §5 gate (part of every WP's DONE):** (1) built only from `@hg/ui-native` exports,
no component defined in `apps/customer`; (2) empty, loading, error exist; (3) every target
≥44 px; (4) body text ≥4.5:1 in light and dark; (5) primary action obvious; (6) no solid green
outside `color.halal.*`, no halal state in red (lint L-4 clean); (7) light and dark both render;
(8) halal and trust copy is the approved wording above; (9) selection is a fill, never a left
border; (10) times are 12-hour via the shared formatter. Plus: 360 px, 200 % text, keyboard-open
and focus boards match; `pnpm --filter @hg/customer typecheck lint test` and `pnpm check` pass;
screenshots per state at 390×844 light and dark attached to the PR.

| WP | Name | Screens | Depends on | Size |
|---|---|---|---|---|
| WP0 | App shell and shared plumbing | navigation, theme, formatters, connectivity, config, realtime | DS foundation (§4 tier 0) | 3 h |
| WP1 | Sign-in, first run, forced routes | S1–S6 | WP0 | 4 h |
| WP2 | Home and address switcher | D1, D2, D8 (HowWeCheck page), What's new hold point | WP0 | 3–4 h |
| WP3 | Search and Browse | D3, D4 | WP2 (RestaurantCardCompact) | 3 h |
| WP4 | Restaurant, certification sheet, certificate viewer | D5, D6, D7 | WP0 | 3–4 h |
| WP5 | Item sheet and Cart | D9, C1 | WP4 | 4 h |
| WP6 | Checkout, payment, placing, blocks, put-back | C2–C5 | WP5 | 4 h |
| WP7 | Live tracking, order placed, cancel, payment recovery | T1–T4 | WP6 (and #290/#315 for the code) | 4 h |
| WP8 | Get help, report, delivered, outcomes | T5–T8 | WP7 | 4 h |
| WP9 | Orders history and receipt | T9, T10 | WP0 | 2–3 h |
| WP10 | Account and settings | A1, A2, A5–A10, Payment methods/Refunds if approved | WP0 | 3–4 h |
| WP11 | Saved addresses and map address form | A3, A4 (+ S4 address step uses A3) | WP0; geo backend for search (§5 G2) | 4 h |

Suggested order (three or four agents in parallel): **Day 1 (Fri):** WP0 alone first (blocks
all), then WP1, WP2, WP4, WP11 in parallel. **Day 2 (Sat):** WP3, WP5, WP9, WP10. **Day 3
(Sun):** WP6, then WP7. **Mon 12 Oct:** WP8, end-to-end runs on the APK, fixes. The money path
(WP5 → WP6 → WP7) is the critical path; start WP5 as soon as WP4's restaurant page renders.

### WP0. App shell and shared plumbing
- Navigation: tab layer (Home, Search, Orders with ACTIVE count badge, Account) using DS
  `BottomNav` (as links/buttons with `aria-current`, not tabs: DS issue 12); route union from §1;
  sheet host; deep links (`hgcustomer://`) for email verify, restaurant and order; forced-route
  replacement for S5 driven from the API client's error hook (403 `ACCOUNT_SUSPENDED`,
  `SESSION_REVOKED`, `REFRESH_REUSE_DETECTED`, `SESSION_EXPIRED`, WS close 4401).
- Theme: light/dark from `useColorScheme()` through the DS token provider; no app colours.
- Shared, non-UI modules (allowed in the app): `time.ts` (12-hour "7:42 pm", "7:10–7:20 pm",
  dates "28 September 2026"), `useNow()` with a dev override (needed to test the 15-minute
  halal cache and deadlines), `useConnectivity()`, `halalCache.ts` (as-of time, 15-minute
  expiry), `useSupport()` from `getPublicConfig`, API error classifier (port `ordering/addErrors.ts`,
  `ordering/lines.ts`, `signin/session.ts` from the PRs), realtime (`realtime/orderSocket.ts`,
  `tracking/trackingFeed.ts` exist).
- Delete: `NotificationsScreen`, `RateOrderScreen`, `api/ratings.ts`, `TamperReportCard`,
  `api/handoff.ts`, the Alerts tab, and every app-local UI component (`InlineAlert`,
  `MediaFrame`, `ListRow`, `Notice`, `StateMessage`, `FlowLayout`, `OrderBits`, `ScreenBoundary`
  visuals, `discover/RestaurantCards`, `DeliverToHeader`, `ActiveOrderStrip`) once their DS
  equivalents exist (move the composites into `@hg/ui-native` under #191–#198, not the app).
- Test kit: `test/mockApi.ts` that serves `contracts/fixtures/**` by operationId for jest
  (component tests), plus `renderInTheme(ui, 'dark')`.
- DONE: app boots to S1 when signed out and to Home when signed in; tabs switch; a forced route
  replaces any screen in a jest test; formatter unit tests ("7:05 pm", "12:00 pm", window across
  noon); `useNow` override works; gate items 1, 7, 10.

### WP1. Sign-in, first run, forced routes (S1–S6)
- Components: AppBar, Input (tel, one-time-code), Button, Checkbox, Banner, Toast, EmptyState
  (full-screen), Icon.
- Ops: `requestOtp`, `verifyOtp`, `getCurrentPrincipal`, `getCustomerProfile`,
  `updateCustomerProfile`, `getActiveOrder`, `getPublicConfig`, `logout`.
- Port from #635: `signin/phone.ts`, `signin/session.ts`, `signin/useClock.ts`,
  `api/auth.ts`, `api/support.ts`, `SignInScreen` state machine, `AccountBlockedScreen` mapping.
  Redo the views on DS components.
- DONE: every state in S1–S6 renders from a fixture in jest; the next_route table (HOME,
  ORDER_TRACKING, PROFILE_CAPTURE, SUSPENDED × status SUSPENDED/BANNED/DELETED, unknown) is a
  table-driven test; 429 shows a static time from `Retry-After`; resend shows the time from
  `resend_after_s`; Maestro flow `1-ask-for-code` and the sign-in half of `2-sign-in-and-order`
  still pass (keep the visible strings "Sign in", "Send code", "Enter the code sent to", "Verify",
  or update the flows in the same PR); gate.

### WP2. Home and address switcher (D1, D2, D8 page, What's new hold point)
- Components: AppBar (address title/action), BottomNav, RestaurantRail, RestaurantCardCompact,
  HalalBadge, Price, Badge, Button, Menu, Sheet, RadioGroup, Skeleton, Banner, EmptyState,
  ErrorState; View cart bar (Button with trailing Price).
- Ops: `listRestaurants` (3 queries), `getCart`, `getActiveOrder`, `getOrderTracking`,
  `listAddresses`, `getCustomerProfile`.
- Port from #634: `components/discover/format.ts` (cuisine line, eta/distance, opens phrase),
  `tracking/useActiveOrder.ts`, the card halal rule. Redo `RestaurantCards`, `DeliverToHeader`,
  `ActiveOrderStrip` as DS composites.
- DONE: card halal rule unit test (all three fields present → badge; any missing → no badge +
  "Certificate details unavailable"; EXPIRING_SOON label carries the date); offline cache test
  at 14 and 16 minutes via `useNow`; both rows request the right sort; switcher never calls
  `setDefaultAddress`; gate.

### WP3. Search and Browse (D3, D4)
- Components: AppBar search slot, Input, RestaurantCardCompact, ListRow + MediaFrame (dish
  rows), FilterChip, Sheet, Switch, Select, Checkbox, Menu, Skeleton, EmptyState, ErrorState,
  Banner.
- Ops: `search`, `listRestaurants` (filters, sort, cursor), `getCart`.
- DONE: independent paging per search group; under-2-characters never calls the API; recent
  searches stored only on the device (clear works); filtered-to-nothing shows the generic copy
  (no relaxation hint); debounced typing keeps old results visible; gate.

### WP4. Restaurant, certification sheet, certificate viewer (D5, D6, D7)
- Components: MediaFrame, IconButton, RestaurantHalalStatus, HalalBadge, Button (link), Sheet,
  HalalCertificationPanel, Disclosure, Tabs, Card, Badge, Price, Banner, DocumentViewer,
  EmptyState, ErrorState, Skeleton.
- Ops: `getRestaurant`, `getRestaurantMenu`, `getRestaurantCertification`,
  `createCertificateViewUrl`, `getCart`.
- Port from #634: `RestaurantScreen` data logic and availability banners; redo views.
- DONE: one test per `RestaurantAvailabilityState` (open, CLOSED_HOURS, PAUSED, OUT_OF_RANGE,
  NO_ADDRESS) and per `HalalDisplayState` (CERTIFIED, EXPIRING_SOON → badge; EXPIRED/UNVERIFIED →
  404 page; missing/partial → neutral line, no View certification); `HALAL_CERTIFIED` never shown
  as a dietary badge; certificate image never written to disk; presigned link re-minted after
  expiry; Mapbox not involved; gate.

### WP5. Item sheet and Cart (D9, C1)
- Components: Sheet, MediaFrame, Badge, RadioGroup (Price slot), Checkbox (group error),
  QuantityStepper, Textarea, InlineAlert, Button, Dialog, Toast, Card, HalalBadge, Price, Banner,
  Skeleton, EmptyState, ErrorState.
- Ops: `getRestaurantMenu`, `addCartLine` (`variant_ids`, `replace=true`), `getCart`,
  `updateCartLine`, `removeCartLine`, `clearCart`, `createQuote`, `getQuote`, `getActiveOrder`.
- Port from #634/#649/#639: `ordering/itemSelection.ts` (`toCartLineInput` with `variant_ids`),
  `ordering/addErrors.ts`, `ordering/lines.ts` (`lineOptions` from `line.variants[]`,
  `safeCents`), Undo logic. Redo `ItemSheet` and `CartScreen` views.
- DONE: "request never carries a price" test (keep from #634/#649); DIFFERENT_RESTAURANT →
  Dialog → `replace=true` with the same Idempotency-Key on retry; every 409/422 code maps to its
  board; ABSOLUTE vs DELTA header rule tested; cart cert-lapsed disables only + and checkout;
  below-minimum comes only from `blocking_reasons`; gate.

### WP6. Checkout, payment, placing, blocks, put-back (C2–C5)
- Components: AppBar, Card, ListRow, RadioGroup (tip with Price slot), HalalBadge, Price, Button,
  Banner, Sheet, Checkbox, Textarea, Input, InlineAlert, Dialog, Stripe PaymentSheet.
- Ops: `createQuote`, `getQuote`, `listAddresses`, `listPaymentMethods`,
  `createPaymentMethodSetupIntent`, `updateCustomerProfile`, `createOrder`, `getOrderPayment`,
  `getOrder`, `getActiveOrder`, `cancelOrder`, `addCartLine` (put-back), `getPublicConfig`.
- Port from #639 (with #627 merged): `payments/payForOrder.ts`, `sheetController.ts`,
  `confirmResult.ts`, quote/refusal mapping, the error boundary; redo views.
- DONE: one Idempotency-Key per place attempt, reused on double tap and on connection drop;
  never a second `createOrder` after 201; put-back adds one line at a time and stops on
  DIFFERENT_RESTAURANT with the replace Dialog; tip 422 shows the server message; prices-updated
  shows was/now from two quotes; order request has no price fields (test); gate.

### WP7. Live tracking, order placed, cancel, payment recovery (T1–T4)
- Components: AppBar, WaitProgress, Card, HalalBadge, Price, StatusTimeline, MapView, Avatar,
  Badge, Banner/InlineAlert, Button, Sheet, RadioGroup, Textarea, Spinner, Skeleton,
  ErrorState, EmptyState.
- Ops: `getOrder`, `getOrderTracking`, `getOrderRiderPublicProfile`, `getOrderPayment`,
  `listRefunds`, `listPaymentMethods`, `cancelOrder`, `createRealtimeTicket` + WS, `addCartLine`.
- Port from #639: `useLiveTracking`, `trackingFeed` (one socket, REST polling when down),
  `TrackingMap` (Mapbox), cancel logic; redo views per board.
- DONE: a state × dispatch table test renders every T1/T2 state from fixtures; WaitProgress is
  driven by `deadline_at` vs server time (not a local 180 s); halal badge removed after 15 min
  offline (`useNow`); badge absent from DELIVERED on; delivery code shown only when
  `delivery_code` is non-null and spoken digit by digit; focus not moved on push; rider has no
  pronouns and no rating; gate.

### WP8. Get help, report, delivered, outcomes (T5–T8)
- Components: Sheet, ListRow/ListItem, Button, Card, HalalBadge, RadioGroup, Checkbox,
  QuantityStepper, Textarea, StickyFooter, Badge, Price, EmptyState, InlineAlert,
  StatusTimeline.
- Ops: `getOrder`, `getOrderTracking`, `getOrderPayment`, `listRefunds`, `createRefund`,
  `getPublicConfig`, `addCartLine` (put-back on outcomes).
- DONE: Get help sheet rows chosen by `OrderCustomerView.state`; contact open/closed/unavailable
  from config only; `createRefund` never sends an amount; each 409/422 maps to its board; every
  outcome board renders from a fixture with the right money lines; "Refund in progress" for
  FAILED; gate.

### WP9. Orders history and receipt (T9, T10)
- Components: AppBar, Card, Badge, Price, Button, Menu, Skeleton, EmptyState, ErrorState,
  BottomNav.
- Ops: `listOrders` (ACTIVE, PAST, cursor), `getActiveOrder`, `getOrderTracking`,
  `getOrderReceipt`, `getOrderPayment`, `listRefunds`.
- Port from #639: `OrdersScreen` separate loading of Active and Past; remove any reorder action.
- DONE: the 14 row badges table-tested; only REJECTED/FAILED say "Not charged"; partial failure
  keeps the active card; receipt 409 variants chosen by `amount_authorized_cents`; gate.

### WP10. Account and settings (A1, A2, A5–A10)
- Components: Card, ListRow, Avatar, Badge, Button, Sheet, Input, Dialog, Switch, Banner,
  Skeleton, ErrorState, Icon.
- Ops: `getCustomerProfile`, `updateCustomerProfile`, `resendEmailVerification`,
  `verifyEmail`, `listAddresses`, `listPaymentMethods`, `getPublicConfig`, `logout`,
  `registerDevice`, `unregisterDevice`.
- Port from #635: `ProfileScreen` logic, `NotificationSettingsScreen` logic,
  `api/paymentMethods.ts`; redo views; add EmailVerify deep link and What's new page.
- DONE: sign out always lands on S6 even offline (test with a failing `logout`); marketing switch
  waits for the server; resend shows a static time from `Retry-After`; gate.

### WP11. Saved addresses and map address form (A3, A4, S4 step)
- Components: AppBar, ListRow, Badge, Button, Input, MapView/AddressMapPicker,
  AddressSuggestionList, Checkbox, Textarea, Dialog, InlineAlert, Skeleton, EmptyState,
  ErrorState, Toast.
- Ops: `listAddresses`, `createAddress`, `getAddress`, `updateAddress`, `deleteAddress`,
  `setDefaultAddress`, `getPublicConfig`; behind a flag until the geo backend exists:
  `suggestAddresses`, `getPlaceAddress`, `reverseGeocode`.
- Port from #634/#635: `AddressFormScreen` manual entry, `AddressesScreen` list; redo with the
  map. Ship the "search down" path (`AC/AddressForm-geodown`: drag the pin and type) as the
  default until geo endpoints answer; it works on today's contract.
- DONE: Save gated on "Check the pin"; pin lat/lng (not the search result) are saved; location
  denied is not a blocker; Move pin buttons move 5 m; Ontario-only read-only province; 20-address
  limit disables Add; unit-line rule tested; gate.

### What the open PRs already do, screen by screen

All five PRs build on the **current hand-built `@hg/ui-native`** (not React Native Reusables;
#111 has no PR yet) and add app-local UI components, which the constitution forbids. Their
data,
error, payment and state logic is solid and tested. Verdict: **merge as the baseline, keep the
logic, port the UI** to DS components as they land; move each app-local composite into
`@hg/ui-native` behind owner approval instead of rewriting it twice.

| Screen | PR | What it implements | Components it used | Verdict |
|---|---|---|---|---|
| BottomNav + cart bar | #625 | Full-width raised bar, Home · Orders · Account (Search waits), cart bar from `getCart` | old `@hg/ui-native` BottomNav (rewritten), app TabBar | Keep; add the Search tab (WP0), fix inactive label contrast and tab roles in the DS |
| Home (D1) | #634 | Deliver-to header, two rows, compact cards, halal rule, loading/error/empty/nothing-in-range, no-address prompt | app `discover/RestaurantCards`, `DeliverToHeader`, `ActiveOrderStrip`, `MediaFrame` + old DS primitives | Port: keep `format.ts`, `useActiveOrder`; move cards to DS composites. Missing: offline cache, refreshing, address switcher sheet |
| Restaurant (D5) | #634 | Hero, badge + View certification sheet, availability notices, hours, jump tabs, menu rows, cart bar | app `InlineAlert`, `MediaFrame`, old DS `Tabs`/`Sheet` | Port. Missing: offline, deep-link states, 404 page, certificate viewer (D7) |
| Item sheet (D9) | #634 + #649 | Variants (multi-group after #649), add-ons min/max, qty 1–20, request 140, Add disabled with reason, every add error, Start a new cart with `replace=true` | app `ItemSheet`, `InlineAlert`, `MediaFrame`; old DS `Radio` (gained `priceCents`), `Checkbox`, `QuantityStepper` | Keep logic (`itemSelection.ts`, `addErrors.ts`); port view |
| Address form | #634, #635 | Manual entry only; address step after first sign-in | old DS Input | Redo (map path A3) |
| Sign-in, code, details, blocked (S1–S5) | #635 | Full state coverage incl. 429/503/offline, next_route routing, blocked screens | app `FlowLayout`, `Notice`, `StateMessage`; old DS Input (+1 prefix), AppBar cream | Keep logic (`signin/*`, `api/auth.ts`, `api/support.ts`); port views. Missing: mid-session forced routes (#633) |
| Account, addresses list, notification settings (A1, A4, A5) | #635 | Profile card + edit sheet, unconfirmed email + resend, rows, Call support/closed, sign out, deletion by phone; addresses list | app `ListRow`, `Notice`, `StateMessage` | Port. Missing: app settings, What's new, Terms, Email verify, Legal page (#633) |
| Cart (C1) | #639 | Lines with variants/add-ons/request, steppers, halal badge, quote totals, clear confirm | app `OrderBits`, `ScreenBoundary`; old DS `QuantityStepper` (tonal) | Port. Must render `line.variants[]` (#649 note). Check undo, offline, per-line availability boards |
| Checkout (C2–C5) | #639 (+#627) | Address sheet, tip, fee breakdown, price held, neutral refusals, re-quote on stale, `payForOrder` | app `OrderBits`; Stripe sheet | Keep payment logic; port views. Check put-back, finish-profile sheet, 3DS/decline boards |
| Tracking (T1, T2) | #639 | One layout per state family, neutral replies-by bar, rider card, outcomes, one socket + polling | app `OrderBits`, `TrackingMap`, `CancelOrder`, `OrderReceipt` | Port. Missing: delivery code (needs #290/#315), get help + report (T5/T6), payment recovery sheet |
| Orders (T9) | #639 | Active/Past separately, paging, inline errors, money wording | old DS + inline Views | Port; remove the reorder action |
| Receipt, Get help, Report, Outcomes detail (T5–T8, T10) | none complete | `OrderReceipt` component exists from before | — | Build new |

Merge order the PRs state: #644 → #625 → #634 → #649; #635 and #639 sit on #625. #634 and #639
both rewrite `TabBar.tsx`/`BottomNav.tsx`: expect conflicts; land #635 last.

## 4. Component needs

Live Claude Design system (namespace `HalalGoesDesignSystem_d11a47`, manifest under
`design-mirror/design-system/claude-design-system/project/`) exports: AppBar, Badge, BottomNav,
Button, Card, Checkbox, Countdown, DataTable, Dialog (Modal), HalalBadge, HalalCertificationPanel,
HalalChecklist, HalalShield, Icon, IconButton, Input, Menu, Price, Radio/RadioGroup, Rating,
SegmentedControl, Select, Sheet, StatusTimeline, Switch, Toast. The live `tokens.css` now has
`[data-theme="dark"]` and `-dark` values for every `color.halal.*` role, and the live HalalBadge
README draws EXPIRING_SOON with the date ("Halal certified · expires 14 Oct"), which resolves two
of the canvases' "Not for approval" and "HalalBadge expiry date" gaps. Verify both in the
`@hg/ui-native` port.

### Tier 0: in the live DS, needed by the app (must exist in `@hg/ui-native` on RNR, #111)

| DS component | Used by | Notes for the port |
|---|---|---|
| AppBar | all | needs `tone="cream"`, an actions slot (address "Change"), a search variant (Gap) and an address title (Gap) |
| BottomNav | tabs | links/buttons with `aria-current`, not tab roles (DS issue 12); inactive label must be text.secondary (DS issue 6) |
| Button | all | link variant (Proposed), trailing Price slot (Gap), label must wrap at 200 % (DS issue 13), loading prop |
| IconButton, Icon | all | add Solar icons: info, warning, error, lock, refresh, minus, more, chevron-right, card, receipt, phone, gift, document, settings, user-block, download, case, move, map-point (some added by #634/#635) |
| Card, Badge, Price | all | Badge tints must be themed pairs that pass in dark (DS issue 10); Price negative display |
| HalalBadge, HalalCertificationPanel | D1–D7, C1–C2, T1–T2 | sm/md sizes, `surface="card"`, `expiresOn`; panel copy for `certificate_viewable=false` (Gap); brand spelled HalalGoes |
| Sheet, Dialog, Toast, Menu | all | confirm gap ≥24 px or stacked (DS issue 2); Toast host above the cart bar |
| Input, Checkbox, RadioGroup, Switch, Select | forms | helper/description text.secondary (DS issues 1, 11); FieldText error colour per theme (DS issue 9); RadioGroup option Price slot (Gap); Checkbox group min_select error (Gap); Checkbox aria-hidden visual suffix (Gap) |
| StatusTimeline | T1, T2, T8 | must take the app's 12-hour formatter (renders "p.m." today); connection states offline/polling (Gap) |
| Countdown | T1 | bar-only variant without m:ss (Gap) or replaced by WaitProgress; numeral colour fails contrast (DS issue 5) |

### Tier 1: Proposed composites (drawn on canvases, need owner approval, then into `@hg/ui-native`)

| Component | Built from | Used by |
|---|---|---|
| Banner | RNR Alert + DS Card/Icon/Button, neutral/info/warning tints | S1–S5, D1, D3–D5, C1, C2, T2, A1, A4, A5 |
| InlineAlert | RNR Alert + DS Card(outlined)/Icon | D9, C3, C4, T1–T6, A3 |
| EmptyState / ErrorState | DS Icon in 56/64 px circle + text + Button | almost every screen |
| Skeleton | RNR Skeleton, static, reduced-motion safe, role=status name outside | every loading state |
| ListRow / ListItem | DS Card as pressable 64 px row + Icon + chevron, RNR Separator | A1, A4, C2, T5, D3 dish rows |
| Textarea | RNR Textarea with DS Input chrome, counter in text.secondary | D9 (140), C3 (200), T4 (5–200), T6 (1000), A3 (200) |
| QuantityStepper | DS IconButton pair + role=status value | D9, C1, T6 |
| StickyFooter | surface.raised + elev.sticky holding Buttons | D9, C2, T6, A3 |
| Avatar | RNR Avatar + initials fallback | A1, T2 |
| MapView, MapPreview, AddressMapPicker | `@rnmapbox/maps` in a DS Card, pin `color.map.pin.customer` with 2 px ring (no dark value yet: DS issue 14), Move pin Buttons | T2, A3 |
| AddressSuggestionList | DS Input + list of 64 px suggestion buttons (not a listbox) | A3 |
| RestaurantCardCompact | DS Card + 72 px thumbnail + HalalBadge sm + certifier line + Price | D1, D3, D4 |
| RestaurantRail | horizontal native scroll of RestaurantCardCompact | D1 |
| RestaurantHalalStatus | HalalBadge md + View certification link Button | D5 |
| WaitProgress | RNR Progress (neutral) under an absolute reply-by time | T1 |

### Tier 2: Component gaps (not drawn; need design in Claude Design first)

MediaFrame (hero 16:9 and 88 px item, "No image"), Tabs (horizontal jump links), Disclosure
(opening hours), FilterChip, DocumentViewer (image and PDF in memory, non-gesture zoom), Spinner
(standalone export), AppBar search slot and address title, Button trailing Price slot, Chip,
native Dynamic Type scaling token. FileUpload is not needed at launch (evidence photos are out).

**Repo note.** `packages/ui-native` already has hand-built `Banner`, `EmptyState`, `ErrorState`,
`MapView`, `Tabs`, `Skeleton`, `Spinner`, `Avatar`, `Chip`, `QuantityStepper`,
`RestaurantCard`, `MenuItemCard`, `OrderCard`. None is in the live Claude Design system, so per
the constitution each is a fork until approved there. Using them this week is the fallback in
§7 (R1); list each use in the PR so the DS rebuild can replace it.

## 5. API gaps

Contract is `main` unless stated. "Covered" means the open PR adds it to the contract; backend
status is separate.

| # | Canvas item ("Needs API" / "Contract to confirm") | Status | Covered by | Launch handling |
|---|---|---|---|---|
| G1 | Delivery code on the customer order view + push when the rider arrives | Contract | #290 (`delivery_code` on OrderCustomerView and OrderTracking, `order.rider_arrived` WS event); backend #315 | Render only when non-null; WP7 test against #290 fixtures (`tracking_arrived_delivery_code`) |
| G2 | Address search, place details, reverse geocoding (Mapbox via our API) | Contract only | #300 (`suggestAddresses`, `getPlaceAddress`, `reverseGeocode`); **no backend handlers in any open PR**; Mapbox keys #57; permanent-geocoding cost #297 | Ship drag-pin + typed fields (works today); wire search behind a flag |
| G3 | `createAddress` rejects non-Ontario points | Partly | `PROVINCE_NOT_SERVED` on main at quote time; #300 says saving a not-served address is refused | Show "We deliver in Ontario only for now" from search result province; trust server 422 |
| G4 | Select delivery address (set `cart.delivery_address_id`) | Missing | none | Mitigated: `createQuote` takes `delivery_address_id`; the cart may show the default |
| G5 | Edit a cart line's variant and add-ons in one call | Missing | #312 `replaceCart` could do it (whole cart, all or nothing) | Remove + add for now |
| G6 | Several problem reports per order; `WRONG_ADDRESS` reason; `support_email` in PublicConfig | Contract | #312 | Changes canvas copy: `REFUND_ALREADY_REQUESTED` now means "this line/fees already claimed", not "one report per order" (§7 Q2) |
| G7 | "Put these items back" in one call | Optional | #312 `replaceCart` | Canvas binds one `addCartLine` per line; either works |
| G8 | Multi-variant cart lines | Contract + backend | #644 (+ #655 one ABSOLUTE group) | Required before #649 |
| G9 | Approximate drop-off area on rider offers (customer privacy line) | Contract | #312 | Copy already assumes it |
| G10 | `shortfall_cents` for below minimum | Missing | none | Generic copy with `minimum_order_cents` |
| G11 | `relaxation_hint` on restaurant list | Missing (exists only on `SearchMeta`) | none | Generic filtered-empty copy |
| G12 | Cuisine vocabulary with ids; trending searches | Missing | none | Hidden |
| G13 | Line price preview in the item sheet | Missing | none | Total shown after Add |
| G14 | Per-address serviceability for a restaurant | Missing | none | All addresses selectable; out-of-range lands on C5 |
| G15 | Preferred delivery instructions on Address | Missing | none | Handover chosen per checkout |
| G16 | `getCart` embeds halal state for a restaurant no longer visible (EXPIRED) | Contract to confirm | none | Fallback: `cart.restaurant` null or halal absent → "restaurant unavailable" wording, no badge |
| G17 | `PRICE_CHANGED` with `is_available` false needs an accept step | Contract to confirm | none | Show was/now; re-quote |
| G18 | `tip_max_cents` | Covered on main | `PublicConfig.max_tip_cents` | Use it |
| G19 | `delivery_address_id` on `search` | Missing | none | Search serviceability may differ from Home |
| G20 | `PROFILE_INCOMPLETE` error.details listing fields | Missing | none | Derive from `getCustomerProfile` |
| G21 | Non-order halal concern report | Missing | none | Hidden |
| G22 | Masked rider contact | Missing | none | Not shown |
| G23 | Customer evidence upload purpose (`StoredObjectPurpose` has KYC_DOCUMENT, MENU_IMAGE, POD, AVATAR, EXPORT) | Missing | none | Photos hidden on the report form |
| G24 | Retry payment on a CREATED order with a new card; `PAYMENT_FAILED` cancel reason; payment attempt limit | Missing | none | Choose another card = cancel + put back |
| G25 | Halal state at order time; `order.restaurant_certification_changed` event | Missing | none | No badge from DELIVERED on; notice appears on next `getOrder` refetch |
| G26 | Dispute outcome + note; reviewer note on Refund; `customer_cancel_reason` | Missing | none | Generic outcome copy |
| G27 | Captured/refund summary, refund state and `delivered_at` on OrderSummary; refund on `order.items_adjusted` | Missing | none | "See details for your money"; fetch `listRefunds` on the order page |
| G28 | Reorder; history search; receipt PDF/share; POD photo; grievance; rider distance; restaurant address on OrderRestaurantRef; `handover_method` on OrderCustomerView | Missing | none | Hidden or text fallback |
| G29 | ETA window on `order.eta_updated` | Partial | `eta_window_minutes` on OrderTracking (main) | Re-fetch `getOrderTracking` on the event |
| G30 | `rating_avg` exposed on rider profile and `dispatch.assigned` (spec says never to customers) | Contract conflict | none | Never render it; file a contract change |
| G31 | `getActiveOrder` / 409 `ACTIVE_ORDER_EXISTS` exclude DISPUTED | Server done on main (integration test); contract description still says "the one active order" | — | Description fix only |
| G32 | OTP channel picker; `attempts_remaining` 0 opens a new challenge; deletion grace (`PENDING_DELETION`); `verifyEmail` browser/other-account hand-off | Missing | #181 tracks channel/terms/support email | Hidden; Start again returns to S1 |
| G33 | Address: clear a label, `order_id` in `ADDRESS_IN_USE`, 21st-address and other 409 codes, default promotion on delete | Missing / to confirm | none | View order via `listOrders` ACTIVE; generic 409 board |
| G34 | Public list of accepted issuing bodies | Missing for customers | none | How we check page names no list |
| G35 | Help centre, complaints form | Missing | none | Not shown |
| G36 | Staff 2FA opt-in | Not customer | #623 | Nothing to do |
| G37 (added in check) | `special_instructions` reaches the rider, not only the kitchen (handover notes) | Contract to confirm | none | Send rider notes as `OrderInput.special_instructions` (≤200); do not put free text in `delivery_instructions[]` |
| G38 (added in check) | Record `terms_version` acceptance for customers at sign-in | Missing (`PublicConfig.terms_version` exists; no customer op records acceptance) | none | Show the version; no "you accepted" claim |
| G39 (added in check) | `pending_email` / `previous_email` on CustomerProfile (old verified address stays in use until the link is used) | Missing | none | Build to today's contract: the new email replaces the old at once with `email_verified=false` |
| G40 (added in check) | `challenge_expires_at` on OtpChallenge | Missing | none | Timed-out time from `Retry-After`; no client timer |
| G41 (added in check) | What happens to the saved cart and an in-flight order on mid-session suspension | Missing | none | Drawn copy only; no claim about cart or order |
| G42 (added in check) | Ordering and notification preferences (beyond `marketing_consent`) | Missing | none | Only push permission state + marketing switch ship |
| G43 (added in check) | `MenuItemAvailabilityState.BLOCKED` customer treatment | Not drawn | none (fixture `error_item_blocked_by_admin` on main) | Treat as HIDDEN; add attempt → `DO/Item-gone` copy |
| G44 (added in check) | `verifyEmail` must not issue a session (canvas Needs API on every EmailVerify board) | **Resolved on main**: public, 204, "issues no session and sets no cookie" | main | `EmailVerify-signedout` is buildable (A9); drop the tag |
| G45 (added in check) | Customer view of a locked delivery code (5 wrong codes) | Contract | #290 (`DELIVERY_CODE_LOCKED`, `*_delivery_code_locked` fixtures) | Not drawn: neutral "support will confirm" line, no code (T2) |

## 6. Dev harness and E2E plan

### Environments
- **Component/screen tests (jest + @testing-library/react-native):** the WP0 `mockApi` serves
  `contracts/fixtures/**` by operationId; one test per state family member and per error code.
- **Mock server:** `pnpm mock` (port 4010, WS `/v1/ws`); scenarios by `?scenario=` or
  `X-Mock-Scenario`. The app's client never sends the header, so for Expo web review run with a
  dev-only `EXPO_PUBLIC_MOCK_SCENARIO` that the client forwards (add in WP0; never in release
  builds).
- **Real API:** `cd services/hg && make up && make migrate && make dev-reset && make run`, then
  drive state with `make dev-scenario s=…` and `make dev-journey route=… speed=… auto=…
  [manual=rider]`. Personas: customers **amina** (`+15550100101`) and **nour**
  (`+15550100102`), reserved dev phones that accept the test sign-in code
  (`auth.TestSignInCode`); restaurants **bismillah-grill** (live certified), **expiring-halal**,
  **expired-halal** (never listed), **paused**, **suspended**; riders **rider-sim** etc.
  `dev-journey` adopts amina's active order in RESTAURANT_PENDING/PREPARING/READY, so the app can
  place the order and the harness drives the rest.
- **Android dev APK** (`com.halalgoes.customer.dev`, scheme `hgcustomer`) on an emulator or
  device, driven by Maestro (`tools/e2e/native/customer/*.yaml`, run by `tools/e2e/run.sh`) and by
  mobile-mcp for exploratory passes. Payments: the local API uses `fakeStripe`, which always
  authorises; decline and 3-D Secure need the dev environment with Stripe test-mode keys (#235)
  and test cards 4000 0000 0000 0002 (decline) and 4000 0025 0000 3155 (3DS).

### Reality simulation recipes
- GPS (customer): `adb emu geo fix -79.3305 43.6820` (amina's home) for "Use my current location";
  a far point (e.g. `-79.9 44.4`) for nothing-in-range; deny permission with
  `adb shell pm revoke com.halalgoes.customer.dev android.permission.ACCESS_FINE_LOCATION`.
- GPS (rider route): `make dev-journey route=long speed=4x auto=all` posts rider positions; the
  customer map must move; `manual=rider` and pausing ≥45 s gives LocationStale.
- Network loss: `adb shell svc wifi disable && adb shell svc data disable` (restore with
  `enable`), or `adb shell cmd connectivity airplane-mode enable`; for reconnect/polling, block
  only the WS by stopping the API container briefly (`docker compose stop hg` then `start`).
- 15-minute halal cache: use the `useNow` dev override (WP0) or `adb shell date` on a rooted
  emulator to jump 16 minutes while offline.
- Push: notifications go to fake senders at launch (#59); E2E asserts `registerDevice` is called
  and the in-app `order.rider_arrived` path; real FCM delivery is tested after #59.
- Camera: not used by the customer app at launch (evidence photos are out).
- Deep links: `adb shell am start -W -a android.intent.action.VIEW -d "hgcustomer://…"` for
  email verify, restaurant and order links.
- Text size and width: `adb shell settings put system font_scale 2.0`; a 360 dp emulator
  profile; dark: `adb shell cmd uimode night yes`.

### Per WP

| WP | (a) Screen tests against mocked API (fixtures) | (b) E2E on the APK against the real API | Missing fixtures / seed / scenarios |
|---|---|---|---|
| WP0 | forced-route on 403 `ACCOUNT_SUSPENDED`, WS 4401; theme switch; formatter | app boots signed out; dark mode via uimode | `error_account_suspended`, `error_session_revoked`, `error_refresh_reuse_detected`, `error_session_expired` |
| WP1 | every S1–S5 state; next_route table using `session_next_route_*`, `otp_challenge`, `error_otp_incorrect`, `error_rate_limited` | J1: amina signs in (code from API log), lands on Home; J2: a new reserved phone gets Your details → address step → "Not now"; J3: 4× Send code → 429 static time; J4: admin suspends amina mid-session (needs #335) → on-hold screen | `otp_expired`, `otp_locked`, `otp_resend_limited`, `error_rate_limiter_unavailable` (503), `session_next_route_banned`/`_unavailable`, `public_config_support_closed`, `public_config_support_unavailable`; seed: a reserved phone with no account, a banned customer persona; scenario `customer-suspend` |
| WP2 | Home populated/no address/nothing in range/offline/error/order in progress using `restaurant_list_*`, `cart_*`, `order_no_active` | J5: amina sees bismillah-grill and expiring-halal (dated badge), never expired-halal; offline toggle shows cached list then badges drop after 16 min; switch to a far address → nothing in range | `restaurant_list_eta_sorted`, `restaurant_list_page_2`, `restaurant_list_missing_halal_fields`, `restaurant_list_partial_halal`; seed: amina second address out of range ("Cottage") |
| WP3 | search groups and paging, no results, error; browse filters/empty | J6: search "shawarma" → restaurant and dish groups; filters to nothing | `search_results_dishes_only`, `search_results_restaurants_page_2`, `search_results_no_address`; seed: more restaurants (≥25) for paging |
| WP4 | each availability and halal state; cert sheet; viewer states (`restaurant_detail_*`, `restaurant_availability_*`, `certification_panel_*`) | J7: open bismillah-grill → View certification → certificate image; paused persona shows banner; wait 5 min → link expired → Open again | `certificate_view_url`, `certificate_view_url_pdf`, `certification_panel_partial`, `certification_panel_not_viewable`, `menu_with_out_of_stock_until`; seed: a closed-hours restaurant, an out-of-range restaurant, an empty-menu restaurant, a PDF certificate |
| WP5 | every add error (`error_different_restaurant`, `error_variant_unavailable`, `error_addon_unavailable`, `error_invalid_addon`, `error_cart_line_variant_missing` from #644), cart per-line availability | J8: add a multi-variant dish (#644 testseed), add from a second restaurant → Start a new cart; qty to 20; remove + Undo | `cart_price_changed`, `cart_cert_lapsed`, `cart_below_minimum`, `cart_no_address`, `error_restaurant_closed_on_add`, `error_item_deleted`; scenario `cart-item-sold-out` (restaurant marks item out of stock while in cart) |
| WP6 | quote/order refusals, `payment_*` fixtures, double tap, quote stale, put-back with DIFFERENT_RESTAURANT | J9: place an order with the fake client (extends `2-sign-in-and-order`); J10 (Stripe test env only): decline card → another way → success; 3DS card → confirm; J11: kill network during Place order → app re-reads active order, no duplicate | `error_idempotency_in_progress`, `error_profile_incomplete`, `error_tip_too_high`, `error_address_out_of_range`, `order_created_deadline_passed`; scenario `customer-history` |
| WP7 | every OrderState × DispatchState from `tracking_*`, `order_*`, `realtime_*`; offline halal at 14/16 min | J12: place in app, `make dev-journey auto=all speed=4x` → watch waiting → preparing → ready → on the way (map moves) → arrived with delivery code (#290/#315) → delivered; J13: `make dev-scenario s=customer-cancels` and in-app cancel before accept; J14: let the 180 s window lapse (`auto=none`) → Outcome-Timeout; J15: `s=restaurant-rejected` | `tracking_preparing_searching`, `_assigned`, `_at_restaurant`, `tracking_overdue`, `tracking_no_rider_escalating`, `tracking_location_stale`, `tracking_arrived_lobby`, `tracking_arrived_leave_at_door`, `order_items_adjusted`, `order_cert_lapsed_mid_order`, `order_cert_revoked_mid_order`, `error_cancellation_window_closed`; scenarios `no-rider` (needs a clock or short escalation in local), `cert-lapse-mid-order` |
| WP8 | Get help rows by state; contact open/closed/unavailable; createRefund 409s and sent; outcome boards from `order_*` | J16: after delivery, report "Something is missing" (PARTIAL_ITEMS) → sent → admin approves (Playwright or API) → refund row; J17: support closed config → closed screen | `error_refund_already_requested`, `error_refund_window_closed`, `error_payment_not_refundable`, `order_cancelled_payment_expired`, `_capture_failed`, `_no_rider`, `_support`, `_restaurant_closed`, `order_rejected_item_unavailable`, `order_disputed_restaurant`, `order_resolved_partial`, `order_resolved_no_refund`; scenarios `dispute-and-resolve`, `refund-approve` |
| WP9 | 14 row badges; partial failure; receipt 409 variants (`receipt_*`, `error_receipt_not_ready`) | J18: after J12 completes, Orders shows it under Past, View receipt | `order_list_mixed_states` (one per OrderState), `receipt_no_charge`, `receipt_never_completed`; scenario `customer-history` |
| WP10 | account states, edit sheet errors, notification permission states, sign-out offline | J19: edit name/email → unconfirmed → resend → 429; sign out offline → signed-out screen; deep link email verify with an expired token | `customer_profile_unverified_email`, `customer_profile_no_email`, `error_verification_token_expired`/`_used` (exist), `payment_methods_list` (exists) |
| WP11 | address form validation, 422, 409, limit, delete default, in use; geo fixtures from #300 | J20: add address by dragging pin (emulator geo fix) and typing; location denied; make default; delete with an active order → in use | `addresses_at_limit` (20), `error_address_in_use` (exists in contract), `address_404`; seed: customer with 20 addresses |

(added in check) Fixture provenance, verified against `contracts/fixtures` on main and the PR
diffs: `error_different_restaurant`, `error_variant_unavailable`, `error_addon_unavailable`,
`error_invalid_addon`, `error_cart_line_variant_missing`, `cart_multi_variant_line` exist only in
#644/#649 (not on main), so WP5 column (a) depends on #644 landing. `tracking_arrived_delivery_code`,
`tracking_picked_up_delivery_code`, `order_arrived_meet_in_lobby`, `*_delivery_code_locked` come
from #290. `error_refund_exceeds_captured`, `error_refund_already_requested_items`/`_fees`,
`public_config_phone_support_off` come from #312; there is no plain
`error_refund_already_requested` anywhere. `error_address_in_use`, `error_account_suspended`,
`error_session_revoked`, `error_cancellation_window_closed`, `error_idempotency_in_progress` and
`error_profile_incomplete` exist in no fixture set yet (the codes exist in the contract). On main
already: `error_quote_stale`, `error_quote_expired`, `error_active_order_exists`,
`error_restaurant_closed`, `error_restaurant_unavailable`, `error_ordering_paused`,
`error_province_not_served`, `error_below_minimum_order`, `error_capture_failed`,
`error_item_blocked_by_admin`, `cart_has_unavailable_items`, `cart_restaurant_unavailable`.

A gap common to all WPs: `contracts/fixtures` has no fixture per customer error code listed
above, and `devworld` has no scenarios for timeouts, no-rider escalation, certificate lapse
mid-order, disputes, refunds or customer suspension. Add the fixtures with the contract builders
(`contracts/fixtures/_build`) and the scenarios in `services/hg/internal/devworld/scenario.go`;
keep each a separate PR.

## 7. Risks, open questions, cut list

### Risks
- **R1. The DS rebuild (#111) has no PR.** The apps may only use `@hg/ui-native`; every PR so
  far uses the hand-built package plus app-local components. If #111 is not landing by Saturday,
  ship on the current `@hg/ui-native`, move the app-local composites into it (filed under
  #191–#198), and record each as owner-approval debt. Do not let WPs stall on the DS.
- **R2. Geo backend is missing.** #300 is contract-only, #290 → #300 → #312 is a stack with
  #290 and #312 "dirty" against main, and no handler PR exists for `suggestAddresses`,
  `getPlaceAddress`, `reverseGeocode`. Mapbox keys (#57) and the geocoding cost (#297) are open.
  The drag-pin path works without them.
- **R3. Delivery code.** Needs #290 (contract) and #315 (backend) merged; without them met
  handovers fall back to the rider's locked-code path, which the owner wanted to avoid.
- **R4. Payment failure paths are untestable locally.** `fakeStripe` always succeeds; decline and
  3DS need Stripe test keys in the dev environment (#235, design awaiting owner).
- **R5. Stack conflicts.** #625/#634/#635/#639/#649 all touch `TabBar.tsx` and `BottomNav.tsx`;
  #644 must merge before #649; #655 and #652 change menu and cart rules underneath.
- **R6. Dark theme.** The canvases' dark boards were "Not for approval" pending dark halal
  tokens; the live tokens now have them, but DS issues 9, 10 and 14 (field error text, badge
  tints, map pin) fail contrast in dark. Gate item 7 may fail on those until fixed in the DS.
- **R7. Copy drift from #312.** Several reports per order change the meaning of
  `REFUND_ALREADY_REQUESTED` and the rationale on `TA/GetHelp-HalalEarly` and
  `TA/GetHelp-Report-Early` ("the order keeps one report").
- **R8. Two drawings of the same thing.** `CC/Order-*` vs `TA/Track-*` (waiting/preparing) and
  `DO/Address-*` vs `AC/AddressForm*` and `DO/How-we-verify` vs `AC/Legal` differ in detail
  ("Notes for the rider" vs "Delivery notes", "How we verify" vs "How we check"). This manifest
  picks `TA/` and `AC/` (later versions); confirm.
- **R9. SMS sender (O-03).** Nobody signs in on a real phone until A2P registration lands; E2E
  uses reserved dev phones only.
- **R10. Scope.** 568 boards in three days. The cut list below is not optional planning.

### Questions for the owner
1. Ship this week on the current hand-built `@hg/ui-native` (with app-local composites moved
   into it) if the React Native Reusables rebuild is not ready, and approve the Proposed
   composites in §4 tier 1 as a batch?
2. With several reports per order (#312), should the halal-concern explainer before delivery
   still say to wait until delivery, and what does "You've already reported a problem" become?
3. Confirm the later canvases win where two canvases draw the same screen (R8).
4. Payment methods and Refunds pages from Account are not drawn: approve the proposal in §2, or
   drop the rows at launch?
5. Track canvas open items: is the customer always refunded in full when a restaurant cannot
   finish; late-delivery reports send fees only; show the requested refund amount while under
   review; is the ETA window centred on `eta_at`?
6. Cancel reason at the payment stage: keep the reason step (drawn) or a fixed "changed my mind"?
7. Five wrong delivery codes hand the order to support (#290): is five right?

### Cut first if time runs out before Mon 12 Oct (in this order)
1. What's new (A7), App settings (A6), Terms polish (A8 beyond a static page).
2. Payment methods and Refunds pages (not drawn).
3. Certificate viewer zoom/PDF controls (D7): keep image open, link expired, failed; drop PDF and
   non-gesture zoom only if DocumentViewer is not ready (accessibility cost: note it).
4. Browse filters sheet (D4): keep sorted Browse list and See all.
5. Search recent searches and independent "Show more" paging (D3): keep first page of results.
6. Address search suggestions (A3): ship drag-pin + typed fields (already the fallback).
7. Email link verification hand-off variants beyond confirmed/expired/used.
8. Report-a-problem PARTIAL_ITEMS line picker (T6): keep FULL with reason and note.
9. Rider avatar, map polish, location-stale and polling banners (T2): keep state H1, ETA, text
   fallback, delivery code.

Never cut: halal badge rules and the certification sheet, sign-in and forced routes, item sheet
→ cart → checkout → place → tracking → outcome money lines, cancel before acceptance, Get help
contact/closed, Orders list, and the empty/loading/error states of everything that ships.
