---
covers: []
reviewed: 2026-10-04
---

# Customer app — design audit and redesign brief

> **Historical: the customer app as audited on 27 September 2026, before the redesign.** The
> owner's approved [Claude Design canvases](../design-surface.md#1-where-the-screens-are) and the
> [decision log](../../decisions/README.md) supersede this audit;
> [reading the audits](../redesign-constitution.md#7-reading-the-pre-redesign-audits) says what
> still holds.
>
> **Recommendations here that the owner decided differently:**
>
> - Browsing before sign-in → **sign in first**
>   ([browsing before sign-in](../../decisions/README.md#customer-app)).
> - Five tabs, with Favourites → **Home, Search, Orders, Account**, and the alerts bell hidden
>   ([bottom navigation](../../decisions/README.md#customer-app)).
> - The certification panel above the menu → **a compact badge and a "View certification" button**
>   that opens the details in a bottom sheet
>   ([certificate on the restaurant page](../../decisions/README.md#halal-and-trust)).
> - A standing "every restaurant is halal certified" strip → **approved wording that names the
>   certifier and the check date**, never a blanket claim
>   ([trust and halal wording](../../decisions/README.md#halal-and-trust)).
> - A countdown on tracking for the restaurant's 180-second reply → **a neutral progress bar and
>   the time**, "Restaurant replies by 7:42 pm"
>   ([reply window](../../decisions/README.md#customer-app)).
> - A feed led by "Order again", mostly carousels → **vertical sections of compact cards plus two
>   rows**, "Open now, closest first" and one such as "Quickest delivery"; "Order again" waits for
>   the sectioned home feed ([Discover home](../../decisions/README.md#customer-app),
>   [horizontal rows](../../decisions/README.md#customer-app-1)).
> - The tamper report card → **no tamper seals at launch**; seal screens and copy come out
>   ([tamper seals](../../decisions/README.md#halal-and-trust)).
> - Dark mode as an open question → **the theme follows the phone's setting**
>   ([dark theme](../../decisions/README.md#customer-app)).
> - 24-hour times such as "Opens 17:00" → **12-hour times everywhere**
>   ([time format](../../decisions/README.md#every-app)).

**Surface:** `apps/customer` (Expo / React Native) · **Register:** `consumer` theme, `comfortable` density
**Date:** 2026-09-27 · **Status:** audit + brief. Step 1 and 2 of `redesign-constitution.md` §8. No code changed.
**Scope:** 11 screens, the login gate, the router and the tab bar.

---

## 0. Method, and the constraints this audit designs inside

Read in order: `AGENTS.md` · `docs/design/01-foundations.md` · `02-components.md` · `03-patterns.md` · `04-accessibility.md` · `docs/design/tokens.json` · `docs/design/redesign-constitution.md` · `docs/design/design-surface.md` · `docs/spec/00-overview.md` · `docs/spec/02-customer.md` (C-01…C-40) · `contracts/openapi.yaml` · every file under `apps/customer/src`. Contrast figures below were computed with the WCAG 2.1 relative-luminance formula against the values in `packages/ui-native/src/tokens/generated/themes.ts`, including alpha compositing where a surface is translucent. Screenshots in `tools/verify/` were used as corroboration, with their commit dates checked — two of them predate the AppBar contrast fix in `fd0ab49` and are flagged where used.

### 0.1 The customer density register, exactly

From `docs/design/tokens.json`. The customer app selects `comfortable` at `apps/customer/App.tsx:251`.

| Token | Value |
|---|---:|
| `density.comfortable.rowHeight` | **64** |
| `density.comfortable.cardPadding` | **16** |
| `density.comfortable.gutter` | **16** |
| `target.min` | **44** |
| `target.field` | **56** (rider only — not this surface) |
| `target.criticalField` | **72** |
| `target.spacing` | **8** |

For comparison: `compact` is 44/12/12 and `roomy` is 72/20/20.

> **Generator gap, minor but real.** `tokens.json` defines `target.field: 56`, but `generated/themes.ts` emits only `{min, critical, spacing}` (see `themes.ts:491–495`). `target.field` does not survive the build. It is unused on the customer surface, so nothing is broken here — but it will be on the rider surface, and the token/generated drift should be closed.

### 0.2 A documentation conflict the reader must know about

`01-foundations.md` §2 still describes the **Saffron / Midnight / Sand** palette (`brand.500 #FFC220`, `accent.600 #24406F`, ink `#1F1B17`). That palette no longer exists. `docs/decisions/palette-and-invariant-10.md` (Sep 2026, client-confirmed) replaced it with the **old-brand forest/orange/cream** palette now in `tokens.json`: brand `#F1521E` orange, accent/chrome `#1B3B31` forest, canvas `#FFFAEA` cream, ink `#232323`, seal `#0F7A43`, brass `#C9A24B`.

Foundations itself sets the tie-break — *"Where they disagree, `tokens.json` wins and this document is the bug."* — so this audit reads tokens.json as authoritative throughout. But §2 of foundations is now actively misleading, and every hex quoted in §2.1–2.5, §8 and §12 is stale. **Fix the document or mark the section superseded.** A designer who reads foundations §2.5 will build a `#04482A` seal that does not exist.

### 0.3 Component inventory: what this app has, and what it is not using

`@hg/ui-native` exports, by tier. Usage counted across `apps/customer/src` and `App.tsx`.

| Available | Used by the customer app |
|---|---|
| Button, Icon, IconButton, Badge, Input, Select, Checkbox, Radio/RadioGroup, Switch, **Chip/FilterChip**, Avatar/AvatarGroup, **Skeleton**, Toast, Spinner, Divider | Button ×44, ErrorState ×25, Spinner ×23, AppBar ×22, Input ×17, Card ×17, Icon ×16, EmptyState ×14, Toast ×12, Price ×11, Divider ×8 … |
| HalalBadge, HalalCertificationPanel | Panel ×2 (one call site) |
| Card, Price, Rating, QuantityStepper, RestaurantCard, MenuItemCard, OrderCard | all used, thinly |
| AppBar, BottomNav, Tabs, **Sheet**, **Modal** | AppBar, BottomNav, Tabs ×2 |
| Banner, EmptyState, ErrorState, StatusTimeline, **MapView** | all but MapView |

**Never used anywhere in the customer app:** `Chip` / `FilterChip`, `Sheet`, `Modal`, `MapView`, `Checkbox`, `Radio` / `RadioGroup`, `IconButton`, `Skeleton` (directly), `HalalBadge` (directly).

That list is not trivia. It is the audit's thesis in five nouns:

- **No `Chip`** → no cuisine chips, no filters, no tip presets, no delivery-instruction chips, no cancellation reasons, no allergen chips. Every choice in the app is a full-width form control or nothing.
- **No `Sheet`** → no item-detail sheet, so no variants and no add-ons (C-15/C-16, both V0). Tapping a dish adds quantity 1 of the default configuration and nothing else is possible.
- **No `Modal`** → nothing destructive is ever confirmed. Delete an address, clear a cart, sign out: all one tap, no undo.
- **No `MapView`** → tracking has no map (C-32 is *"Track orders in real-time with a map interface"*), and address entry has no pin (C-31).
- **No `Skeleton`** → loading is a centred spinner 23 times over, against `03-patterns.md` §0 rule 1.

The library was built for the app that `03-patterns.md` §1.1–1.9 describes. The app that shipped uses about a third of it.

---

## 1. Per screen

Each entry: **what it is for → what the customer is trying to do → what it renders today → what is wrong.**

---

### 1.0 `LoginGate` — `App.tsx:40–206`

**For.** Phone-OTP sign-in (C-01/C-02).
**The customer is trying to.** Get in. This is the first thing anyone ever sees of HalalGoes.
**Renders today.** A centred white page, hand-built from bare `View` / `Text` / `TextInput` / `Pressable`, with its own `StyleSheet` (`App.tsx:152–206`). It mounts **outside** `ThemeProvider` (`App.tsx:240–247` vs `App.tsx:251`), so not one token reaches it.

**Problems.**

1. **Lint L-1, eight times over.** Raw colour literals: `#fff` (153), `#111` (163, 177), `#555` (168), `#ccc` (172), `#1a7a4a` (180), `#fff` (192), `#c0392b` (195), `#1a7a4a` (203), plus `color="#fff"` on two `ActivityIndicator`s (106, 133). `AGENTS.md` §L-1 bans every one of these in `apps/**`.
2. **Invariant 10 violation, on the first screen.** `App.tsx:180` fills the primary button with **`#1a7a4a`** — a saturated green, hue ≈150°, squarely inside the 100–180° band lint L-4 forbids outside `color.halal.*`. On a product whose entire claim is a green seal meaning *halal verified*, the first green solid a customer ever sees is a login button. `redesign-constitution.md` §2 ranks this above taste: solid green is the verification signal, and this spends it on "Send code". The action colour is orange (`color.action.primary #F1521E`) precisely so that green never means "tap here."
3. **Input border `#ccc` on white = 1.61:1.** WCAG 1.4.11 requires 3:1 for a control boundary. `border.interactive` (`#8B8578`) is 3.51:1 on the canvas and exists for this.
4. **"Change number" is a 28pt target.** `paddingVertical: 8` (200) on a 14pt line ≈ 28 high, against `target.min` 44.
5. **Off-scale type.** 24/700 (161–163) approximates `heading.xl` but drops its −0.01em tracking; `fontSize: 14` (167) is not a step in the scale at all (the scale goes 13 → 15); `fontSize: 16` (176) on the field and `13` (196) on the error are hand-picked.
6. **No `Input`, no `Button`.** Both exist, both are accessibility-reviewed, and `Input variant="otp"` and `variant="tel"` exist specifically for these two fields (`primitives/Input.tsx:23–31`). Using them would have given the correct keyboards, the two-layer focus ring, the error association, the loading-not-disabled behaviour and the 44 targets for free.
7. **The gate blocks anonymous browse.** `App.tsx:10–12` says so in its own comment. C-14 R6 is explicit: *"`NO_ADDRESS` never blocks browsing"*, and `RestaurantCard` ships a whole `NO_ADDRESS` branch (`RestaurantCard.tsx:180–207`) that no customer can currently reach. A hungry person who has not signed up cannot see a single restaurant.
8. **Dark mode is off.** `App.tsx:251` hard-codes `scheme="light"`. A complete dark palette exists (`themes.customer.dark`). `redesign-constitution.md` §5 asks that this be raised rather than assumed for the customer app — **raising it here.** Ordering dinner at 22:00 is the modal case, not the edge case.
9. **No branded splash.** `App.tsx:235–238` returns `null` while fonts load.

---

### 1.1 `DiscoveryScreen` — the home feed

**For.** Halal-gated restaurant discovery (C-09).
**The customer is trying to.** Decide where dinner is coming from, in under a minute, one-handed.
**Renders today.** `AppBar title="Discover" subtitle="Halal-certified, near you"` (89–90), then **one flat `FlatList` of up to 20 full-bleed `RestaurantCard`s** (150–157), then the tab bar.

This screen is the origin of *"the mobile app looks really really bad as it has no sections."* The complaint is literally accurate, and the cause is one line.

**Problems.**

1. **It calls the wrong endpoint.** `DiscoveryScreen.tsx:60` calls `GET /v1/restaurants` with `{ limit: 20 }`. The contract has **`GET /v1/feed`** (`contracts/openapi.yaml:1354`), returning `FeedSection[]` with `key ∈ {order_again, restaurants_near_you, trending_in_your_area, your_favourite_restaurants, popular_items, you_might_like}` (`openapi.yaml:7625–7645`), each with a `title`, each omitted entirely when empty. A fixture exists: `contracts/fixtures/catalogue/feed_sections.json`. **The sections are specified, contracted, fixtured — and not called.** That is the whole defect.
2. **Roughly two cards fit on a phone.** A 390pt-wide screen with 16 gutters gives a 358pt card; the 16:9 hero is 201 tall, and the body (seal 24 + name 24 + cuisines 19 + meta 18 + `cardPadding` 32 + gaps) adds ~120. Call it 320pt per card. Usable height after the AppBar (~100 with inset) and the nav (~128) is ~615. **1.9 cards.** Discovery is a magazine you scroll two posters at a time — the opposite of `01-foundations.md` §1.3: *"Dense, information-rich cards over generous whitespace: a food-delivery home is a list of options, not a magazine."*
3. **No search field.** `03-patterns.md` §1.1 requires a *"persistent `Input variant="search"` pinned below the AppBar, always visible, never a magnifier that expands"*, and `01-foundations.md` §1.3 lists it as an adopted HungerStation pattern. `GET /v1/search` exists (`openapi.yaml:1399`). There is no search anywhere in this app, and no `search` route in `stack.tsx:17–28`.
4. **No address selector.** §1.1 requires `AppBar variant="large"` carrying the address as its title — location-first, because the catalogue is meaningless without an address. The app uses `variant="default"` with a static subtitle. The customer cannot see, or change, the address every distance, ETA and fee on the screen is computed from. They must go Profile → Saved addresses → Edit.
5. **The standing certification header is missing.** C-11 and §1.1 require one strip on `halal.certified.tint` with the seal glyph and the fixed line **"Every restaurant on HalalGoes is halal certified."** — stated once, at the top. `grep` across `apps/customer/` finds no such string. This is the sentence that explains why there is no halal filter. Without it the product's single claim is carried entirely by a badge repeated on every card, which is proof without a premise.
6. **Every hero is an empty grey plate.** `tools/verify/customer-discovery-tabbar.png` (commit `824ba56`) shows two cards, each more than half blank `border.decorative` rectangle, because `hero_image_url` does not resolve. The component behaves correctly (`RestaurantCard.tsx:106–116` — *"Every image sits on a `neutral.200` plate so a failed load is a visible empty plate"*), but the *screen* has chosen a layout in which a missing image costs 200 vertical points twice per viewport. `variant="compact"` (96pt thumb) exists for exactly this.
7. **Loading shows a spinner and skeletons at once.** `DiscoveryScreen.tsx:118–126` renders `Spinner label="Loading restaurants"` *above* three `RestaurantCardSkeleton`s. `03-patterns.md` §0 rule 1: skeletons match the real layout; a spinner is permitted only where the geometry is unknown. Here it is known — that is what the skeletons are. Two loading signals stacked reads as a stall.
8. **One empty state where the spec requires two.** `DiscoveryScreen.tsx:137–147` renders one "No restaurants nearby". §1.1 and `03-patterns.md` §0 rule 3 require *no address set* (feed not fetched at all; "Set your delivery address to see restaurants near you" + "Add address") to be a different screen from *address set, nothing in range* ("No restaurants deliver to {address} yet" + "Try a different address"). Conflating them is named a defect in the patterns doc. The customer cannot tell whether the problem is coverage or their own address.
9. **No active-order resume banner.** C-26 requires a persistent banner on home whenever an active order exists, with status and ETA, tapping through to tracking; AC1 gives it a 2-second budget from cold start. `GET /v1/orders/active` exists (`openapi.yaml:1948`). Nothing on this screen reads it. A customer with food on the way opens the app and sees a restaurant list.
10. **Content clips under the nav.** `contentContainerStyle` ends at `paddingBottom: 16 + bottomInset` (153), but the floating cart circle overflows **25.6pt** above the space the nav reserves (arithmetic in §1.11). 16 < 25.6.
11. **No pull-to-refresh** (C-09 R6), **no favourites** (C-17), **no filters or sort** (C-11, V2).

---

### 1.2 `RestaurantScreen` — detail + menu

**For.** C-12 certification display and C-13 detail/menu.
**The customer is trying to.** Confirm this place is vouched for, see whether it is open and how long it will take, then build an order.
**Renders today.** `AppBar` with the restaurant name (105–109) → `HalalCertificationPanel` → an **info `Banner`** carrying the description → categories stacked in a `ScrollView` → a sticky "View cart" bar.

`03-patterns.md` §1.3 calls its layout *normative*. Here it is, against what ships:

| §1.3 requires | Ships |
|---|---|
| hero image (`hero_object_key`, never bundled) | **absent** |
| name · cuisine chips · Rating (tappable → reviews) | **absent** (the name is only in the AppBar) |
| `HalalCertificationPanel`, above the menu | present — but crippled, see (2) |
| availability strip: open/closed · hours · ETA · fee · minimum | **absent** |
| address · distance · delivery options for the selected address | **absent** |
| `Tabs`: All + `food_categories` in `sort_order` | **absent** |
| `MenuItemCard` rows | present |
| floating cart bar, **sum of quantities** | present |

**Problems.**

1. **Six of eight normative blocks are missing.** `RestaurantDetail` extends `RestaurantCard` (`openapi.yaml:7693–7695`) and therefore already carries `hero_image_url`, `availability`, `rating_avg`, `rating_count`, `cuisines`, `price_band`, plus `address`, `hours` and `public_phone_e164`. `RestaurantScreen.tsx:127–133` reads exactly two fields off it — `name` and `description` — and discards the rest. The customer cannot learn from this screen whether the restaurant is open, how far it is, what delivery costs, what the minimum order is, or what anyone thinks of the food.
2. **The certificate cannot be viewed. Anywhere.** `HalalCertificationPanel` renders its "View certificate" button only when `onViewCertificate` is supplied (`HalalCertificationPanel.tsx:214–224`), and "Report a halal concern" only when `onReportConcern` is (226–230). `RestaurantScreen.tsx:119–125` passes **neither**. `GET /v1/restaurants/{id}/certificate-url` exists (`openapi.yaml:1553`). The SOW line C-12 traces to is *"View **and verify** Halal certifications for restaurants."* Verification means looking at the document. On the product whose single claim is halal verification, the verification artefact is unreachable from every screen. **This is the most on-brief defect in the app.**
3. **The description is rendered as a semantic info alert.** `RestaurantScreen.tsx:128–132` wraps the restaurant's own marketing copy in `Banner variant="info"` — a blue `#E9F1FE` plate with an info glyph, sitting at the top of a food menu. `Banner` is a feedback component for conditions that need attention (`02-components.md` §37). A restaurant description is content, not a condition. Semantically it tells a screen-reader user that something requires their attention; visually it puts the coldest colour in the palette on the appetite surface.
4. **No category tabs.** `Tabs` ships `includeAllTab` explicitly *"C-13 R2: the 'All' tab is implicit and first on menu categories"* (`Tabs.tsx:43–44`) and `scrollable`. `RestaurantScreen.tsx:212–228` instead stacks every category in one `ScrollView` behind a hand-rolled `CategoryHeading` (231–240) made of a `heading.sm` `Text` and a 1px `View`. A twelve-category menu is a single unbroken scroll with no way to jump.
5. **No item detail, therefore no variants and no add-ons.** `RestaurantScreen.tsx:221` wires `onAdd` straight to `addToCart(item.id, 1)`. C-15 and C-16 are **V0** scope (`00-overview.md`: *"restaurant detail + menu with variants/addons"*), and `03-patterns.md` §1.4 specifies the whole thing — `Sheet variant="bottom"` at snap points `[0.6, 0.95]`, `RadioGroup` per variant group, `Checkbox` group per add-on group, each option's `priceDeltaCents` through `Price`, a notes field, a sticky footer with `QuantityStepper` + "Add to cart · {Price}". `Sheet`, `RadioGroup`, `Checkbox` and `Price` all exist. None is used. A customer cannot choose a size.
6. **No in-menu search** (C-13 R3), **no allergen/ingredient surface**, **no offers**.
7. **The sticky bar breaks lint L-7.** `RestaurantScreen.tsx:148–149` uses `left: 0, right: 0`. L-7 bans physical direction properties in favour of `start`/`end`; this is what keeps RTL (divergence D8) a config flip rather than a rewrite.
8. **The sticky CTA is not full-width.** `Button` defaults to `alignSelf: 'flex-start'` (`Button.tsx:143`); line 158 omits `fullWidth`. The single most important control on the screen renders as a hug-content pill floating at the left edge of a full-width white bar. See §2.3.
9. **`paddingBottom: 96 + insets.bottom`** (117) is a magic number guarding against the sticky bar, not a token.
10. **Loading is a spinner over skeletons again** (185–193), and the certification panel's loading is passed correctly (121) — which is the one thing this screen gets exactly right, because §1.3 is emphatic that a briefly-empty certification area on a trust product reads as *"no certification."*

---

### 1.3 `CartScreen`

**For.** C-19 cart management.
**The customer is trying to.** Check the order is right and find out what it will actually cost.
**Renders today.** `AppBar "Your cart"` → restaurant name as secondary text → hand-rolled line rows with a `QuantityStepper` → a footer with **subtotal only**, "Continue to checkout", "Clear cart".

**Problems.**

1. **No halal badge.** `03-patterns.md` §1.5 opens with *"Restaurant header with `HalalBadge`"*. `CartScreen.tsx:159–163` renders the restaurant name in `label.lg` at `text.secondary` — smaller and dimmer than the dish names below it. C-12 AC2 asserts the badge on six card surfaces; this is one of the moments where the customer is deciding whether to commit money.
2. **The customer cannot see what the order costs.** The footer shows `indicative_subtotal_cents` and nothing else (197–202). No tax, no delivery fee, no total, no ETA, no delivery address. §1.5 requires the *server-computed price breakdown* here — subtotal, delivery fee, service fee, tax, tip, total — with `Price` skeletons at exact glyph width while the quote is in flight. `POST /v1/quotes` exists (`openapi.yaml:1747`) and the checkout screen already calls it. Today the only way to learn the real total is to press "Continue to checkout" and commit to the next screen. At a $2.99 + $1.00/km delivery fee and 13% HST, the number the customer is shown can be 25–30% below what they will pay.
3. **`NO_ADDRESS` is a dead end.** `CartScreen.tsx:300` maps the blocking reason to "Add a delivery address to continue" inside a `Banner` (185–195) that carries **no action**, on a screen with no route to the address form. `Banner` takes an `action: ActionSpec` (`Banner.tsx:31`). The customer is told what is wrong and given no way to fix it.
4. **"Clear cart" sits directly under the primary CTA with no confirmation.** `CartScreen.tsx:207` — a `ghost` button, left-aligned, 12pt below "Continue to checkout", one tap from destroying the order. `Modal variant="confirm"` exists and `02-components.md` §31 specifies `role="alertdialog"` with focus on the least destructive action.
5. **Line rows are hand-built.** `CartScreen.tsx:229–241` writes its own card: `borderRadius: 12` as a literal rather than `radius.md`, `padding: 12` rather than `density.cardPadding` (16), its own border and its own `opacity: 0.7` for unavailable. `Card` exists and reads `density.cardPadding` by default (`Card.tsx:61`). The result is a cart whose rows are visually a different system from every other list in the app.
6. **No thumbnails.** `tools/verify/customer-cart.png` shows six near-identical text rows, two of which are literally the same dish name at the same price ("Chicken Biryani $16.95" twice, "Beef Nihari $42.90" twice) with nothing distinguishing them, because variant and add-on lines are only rendered when `line.variant` is set (244–248). A customer scanning for the thing they want to remove has to read.
7. **No minimum-order shortfall.** C-14 R5 requires "Add ${x} more to order" from `details.shortfall_cents`. Not implemented.
8. **No cart TTL.** `01-foundations.md` §7.4 and `02-components.md` §38 both name the 15-minute cart window. There is no `Countdown` in `@hg/ui-native`, so this is a library gap, not a screen defect — recorded in §5.
9. **The footer uses a 1px border, not `elevation.sticky`.** `CartScreen.tsx:181–182`. The `sticky` elevation token exists precisely for "floating cart bar, sticky checkout footer (shadow points **up**)" (`01-foundations.md` §6).
10. **Loading is a bare spinner** (126–132). §1.5: line items render from local cart state instantly; only the totals skeleton.

---

### 1.4 `CheckoutScreen`

**For.** C-22/C-23/C-24/C-25 — price the quote, take payment, place the order.
**The customer is trying to.** Confirm where it's going, how they're paying, and hand over money.
**Renders today.** `AppBar "Checkout"` → an "Order summary" card of price rows → a footer repeating the total and a "Place order" button.

This is the screen with the largest gap between what it must do and what it does.

**Problems.**

1. **The delivery address is never shown.** `CheckoutScreen.tsx:58–61` calls `ensureDeliveryAddress()` and uses the result to build the quote — silently. The customer is asked to authorise a payment without being told where the food is going. §1.6 puts *delivery address + instructions* first in the layout, expanded, as the first thing on the page.
2. **There is no payment method.** No card, no wallet, no `PaymentState`, nothing. `GET /v1/payment-methods`, `POST /v1/payment-methods/setup-intent`, `PUT .../default` and `POST /v1/orders/{orderId}/payment` all exist (`openapi.yaml:2227–2373`). C-24 and C-25 are V0. "Place order" (135) charges against an instrument the customer has never seen and cannot choose. §1.6 also requires the *no saved card* empty state — payment section expanded, everything below disabled.
3. **There is no tip.** C-36 is the rider's entire variable income (`00-overview.md`: rider earnings = delivery fee pass-through + **100% of tips**). `CheckoutScreen.tsx:188` renders a Tip row only when `tip_cents !== 0`, and nothing in the app can ever make it non-zero. The quote DTO carries `tip_cents`; the client may send a tip (it is the one number a client is allowed to send — `AGENTS.md` invariant 1). **Riders currently cannot be tipped.**
4. **There are no delivery instructions.** C-33 specifies a fixed multi-select chip set mapped 1:1 to the backend enum plus one free-text field. `Chip variant="filter"` exists. Nothing.
5. **No restaurant name, no halal badge, no items, no ETA.** §1.6: *"**restaurant name with `HalalBadge`** … Why the seal appears at checkout: this is the moment of commitment. It costs one row and it is the last opportunity to affirm the single claim the customer is paying for."* The screen never names the restaurant.
6. **The total is rendered twice**, 60pt apart — once at `CheckoutScreen.tsx:192` inside the summary card and again at 134 in the footer. `tools/verify/customer-checkout.png` shows both, with a screen-height void between them.
7. **No `Idempotency-Key`.** §1.6 requires a client-generated UUIDv4 on every order-creating call, the `meta.idempotent_replay=true` success path, and the "we're checking whether your order went through" state on a network drop mid-submit. `placeOrder` sends `quote_id` only. The contract's rating endpoint requires `IdempotencyKeyRequired` (`openapi.yaml:2196`), so the convention is established.
8. **No 3DS/SCA path** (C-25, §1.6).
9. **A mock workaround is in the production code path.** `CheckoutScreen.tsx:76–88`: on any 5xx from `placeOrder`, the screen calls `getActiveOrder()` and navigates to whatever order that returns. Against a real backend, a genuine failure now routes the customer to an unrelated order and tells them nothing went wrong. This is a demo scaffold wired into the money path.
10. **Payment failure is a `Banner` in the scroll body** (115–121) reading "Nothing was charged", with the generic copy regardless of decline reason. §1.6: declines are inline, at the payment section, with the provider's reason where given.
11. **The primary CTA is not full-width** (135) and carries no price. §1.6: *sticky "Place order · {Price}"*.
12. **Loading is a bare spinner** (103–106).
13. **The nav is not hidden.** `02-components.md` §28: *"Hidden entirely during the rider offer sheet and **during checkout** — a modal flow must not offer an escape hatch that abandons a payment."* This screen is a pushed route with no `BottomNav`, so the outcome is right by accident; when checkout becomes a tab-visible flow the `hidden` prop must be used deliberately.

---

### 1.5 `TrackingScreen`

**For.** C-32 live tracking, C-26 active-order resume, C-29 cancellation.
**The customer is trying to.** Find out where their food is and when it arrives.
**Renders today.** `AppBar "Order {code}"` → state label + restaurant name → `StatusTimeline` in a card → a full receipt → a **"Refresh" button**.

**Problems.**

1. **There is no map.** C-32's SOW trace is verbatim *"Track orders in real-time with **a map interface**, showing the rider's location and estimated delivery time."* `MapView` ships in `@hg/ui-native/feedback` with `restaurant`, `customer`, `rider`, `route`, `travelled`, `follow`, `state` and `fallbackDetail` props (`MapView.tsx:57–84`), and §1.7 gives it the top ~55% of the screen. Not imported.
2. **There is no realtime.** `grep` for `WebSocket|realtime|ticket` across `apps/customer/src` returns nothing. There is no 15-second poll either. `TrackingScreen.tsx:125` gives the customer a **`variant="secondary"` "Refresh" button at the bottom of a scroll** and asks them to press it. `docs/spec/02-customer.md` §0.4 defines realtime numerically (p95 ≤ 3 s socket, 15 s polling fallback, `resume{last_event_id}` on reconnect); `/v1/realtime/ticket` and `/v1/orders/{orderId}/tracking` both exist. `StatusTimeline` even takes a `connection: 'live' | 'reconnecting' | 'polling'` prop (`StatusTimeline.tsx:56`) to render the degradation banner §1.7 requires. It is not passed.
3. **The ETA is not visible.** `eta_at` is handed to `StatusTimeline` as `estimatedAt` (113) and appears inside the stepper. C-32 R3 is categorical: *"**ETA is always present.** … the UI shows 'Arriving {HH:MM}–{HH:MM}' (a ±5 min window). There is no 'Calculating…' terminal state."* The one number the customer opened the app for is a detail inside a component.
4. **The order cannot be cancelled.** C-29 is V1, `POST /v1/orders/{orderId}/cancel` exists (`openapi.yaml:2063`), and §1.7 requires both the Cancel action while eligible *and* an explanation when it disappears: *"a `caption` reads 'This order is being prepared and can no longer be cancelled here.'"* — the control's absence must be explained, not silent. Neither exists.
5. **No rider, no contact, no address.** C-34 (`GET /v1/orders/{orderId}/rider`), C-35, and the delivery address and instructions from §1.7. The customer cannot reach the person holding their food.
6. **Hierarchy is inverted.** The receipt (151–186) is a full itemised money card with the same visual weight as the status card, and it sits above the only action. While an order is in flight the customer wants, in order: where is it, when, who, can I still change it. The receipt is the thing they want *after*.
7. **No terminal outcome screens.** C-32 R8: `REJECTED`/`CANCELLED`/`FAILED` replace the stepper with a full-screen outcome that states the refund position and does not auto-dismiss. `StatusTimeline` handles all 14 states, so nothing crashes — but a rejected order renders as a timeline with a failed step and a receipt, not as an answer.
8. **Back goes to Discover from anywhere.** `TrackingScreen.tsx:72` is `nav.popTo('discovery')`. Arriving from Orders, back lands on the feed.
9. **Literal radii again** — `borderRadius: 12` at 104 and 161.

---

### 1.6 `OrdersScreen`

**For.** C-26 order history and active-order resume.
**The customer is trying to.** Find a past order to reorder, rate, get a receipt for, or complain about.
**Renders today.** `AppBar "Your orders"` → `Tabs` All/Active/Past → `FlatList` of `OrderCard variant="customer"` with Reorder and (when `COMPLETED`) Rate buttons.

This is the app's best screen. It uses `OrderCard`, `OrderCardSkeleton`, `Tabs`, `EmptyState` and `ErrorState` correctly, and `OrderCard` carries the `HalalBadge` (`OrderCard.tsx:164–166`).

**Problems.**

1. **The last card is permanently under the tab bar.** `OrdersScreen.tsx:150` sets `paddingBottom: 16`. `bottomInset` is threaded in as a prop (105, 88) and then **never used**. Combined with the nav's 25.6pt overflow (§1.11), the bottom card is clipped on every device with a home indicator.
2. **Sections vs filters.** C-26 specifies two sections — Active pinned at the top with a compact `StatusTimeline`, Past below — not a three-way filter. §1.8 says the same. The Tabs implementation makes the customer choose a view before seeing whether they have a live order.
3. **Nested interactive.** `OrderCard` is pressable (155) and `actions` (156–172) puts two `Button`s inside it. `02-components.md` §15 is explicit: *"an interactive card is one tab stop with one accessible name. Nested links inside a pressable card are forbidden … If a card needs two actions, the card is not pressable and the actions are explicit buttons beside it."* `04-accessibility.md` §2 calls overlapping targets the most common RN accessibility defect.
4. **Four of six row actions are missing.** C-26 R6 requires Reorder, View receipt, Get help, Request refund. Only Reorder and Rate exist. `GET /v1/orders/{orderId}/receipt` and `POST /v1/refunds` are both in the contract.
5. **No pagination.** The contract is cursor-paginated (default 20, max 50); §1.8 requires load-more appending a skeleton at the tail. `listOrders` fetches one page and stops.
6. **Spinner over skeletons again** (116–123).
7. **One empty state.** §1.8 requires *never ordered* and *filtered to nothing* to be different.

---

### 1.7 `NotificationsScreen`

**For.** C-40 in-app inbox.
**The customer is trying to.** See what changed about their order.
**Renders today.** `AppBar "Notifications"` → `FlatList` of rows with a dot, a title, a body, an absolute timestamp and a "New" `Badge`.

**Problems.**

1. **Unread is signalled four times.** A coloured dot (148–157), a bold title (159), a raised surface (144) **and** a `Badge label="New"` (167). `04-accessibility.md` §1.4 requires status to be more than colour; it does not ask for four redundant channels. The row is louder than its content.
2. **Off-scale typography.** `NotificationsScreen.tsx:159` composes `body.md` (15/400) with `fontWeight: read ? '400' : '700'`, producing a 15/700 that is not a step in the scale. The scale offers `heading.sm` 16/600 and `label.lg` 15/600.
3. **Full absolute datetimes.** `new Date(...).toLocaleString()` (164) renders `"9/27/2026, 1:06:32 PM"` on every row. On a notification list, relative time ("12 min ago") is the readable form and the absolute belongs in the detail.
4. **The tab badge never fires.** `CustomerTabBar` accepts `unreadCount` and folds it into the Alerts tab's accessible name (`TabBar.tsx:51–63`). Every call site — `DiscoveryScreen.tsx:100`, `OrdersScreen.tsx:92`, `NotificationsScreen.tsx:57`, `ProfileScreen.tsx:63` — omits it. The unread count is computed nowhere and shown nowhere outside this screen.
5. **Rows have no minimum height.** Content-driven `Pressable` (131–146). `density.rowHeight` is 64 and exists for this.
6. **`paddingBottom: bottomInset`** only (107) — worst of the three clipping cases.
7. **No mark-all-read, no day grouping, no filter, no pagination.**
8. **The dot is a hand-built `View`** with `borderRadius: 4` (153) rather than `Badge style="dot"`, which exists (`Badge.tsx:21`).

---

### 1.8 `ProfileScreen`

**For.** C-03 profile, and the account hub the rest of the C-0x features hang off.
**The customer is trying to.** Change something about their account, or find help.
**Renders today.** Avatar card → an edit form in a `Card` → two navigation `Card`s (Saved addresses, Order history) → `Divider` → Sign out.

**Problems.**

1. **The floating cart button physically covers "Sign out".** `tools/verify/customer-profile.png` shows the peach circle sitting on top of the last control, cutting the word in half. The mechanism is in §1.11: the detached action overflows 25.6pt above the space the nav reserves, and `ProfileScreen.tsx:125` allows only `16 + bottomInset` — and `bottomInset` is already consumed by the nav itself, so the effective clearance is **16 against a 25.6 overhang**. This is a live, reproducible collision on the screen where the customer signs out.
2. **The account hub has two rows.** C-26 R2 and AC4: *"Every customer-facing surface that today lacks an `onPress` … must route; a UI test asserts every rendered menu row navigates somewhere or is not rendered."* Absent, all with specs written: **C-04** Preferences · **C-05** Account deletion · **C-06** Help centre & FAQ · **C-07** Call support · **C-08** Support message thread · **C-17** Favourites · **C-24** Payment methods · **C-37** Refunds · **C-39** Grievances. `04-accessibility.md` §10.2 claims WCAG 2.2 *3.2.6 Consistent Help* is met because "the Help hub is reachable from every screen." **There is no Help hub.** That claim is currently false.
3. **Off-scale row titles.** `ProfileScreen.tsx:167` and `178` compose `body.sm` (13/400) with `fontWeight: '700'` — a 13px bold that is *smaller* than the form field labels above it, for rows that are the screen's primary navigation.
4. **Chevrons are mirrored back-arrows at an off-token size.** Lines 170–172 and 181–183: `<Icon name="back" weight="linear" size={18} />` inside `transform: [{ scaleX: -1 }]`. `icon.sm` is 16 and `icon.md` is 20; 18 is neither. The mirror transform also defeats RTL (L-7's intent), since under RTL the arrow must not flip again.
5. **Sign out has no confirmation** (189) and no session cleanup beyond `setToken(null)`.
6. **"Not yet verified." is a dead end.** `ProfileScreen.tsx:146–148` shows the state; `POST /v1/auth/email/resend` exists (`openapi.yaml:428`); there is no resend control.
7. **`Badge` is imported and never used** (line 15).
8. **Two navigation rows as two separate elevated `Card`s** with a 16 gap read as two unrelated islands rather than a menu. This is the "no sections" complaint in its account-screen form. `ListRow` is specified in `02-components.md` §39 as *"the most-used component in the system after `Button`"* — and is **not implemented in `@hg/ui-native`**. See §5.
9. **A chevron row that resets the stack.** Line 58: `onOpenOrders` calls `nav.reset({name:'orders'})`. A chevron promises a push; the stack is destroyed instead, so Orders has no back affordance.
10. **Avatar fills are from the retired palette.** `themes.ts` `avatarFills` still lists `#24406F`, `#0B72E7`, `#7A5800` — the old Midnight/Saffron viz ramp. The screenshot shows an olive-brown avatar that belongs to no current brand colour. This is a token-generation issue, not a screen issue, but it lands here.

---

### 1.9 `AddressesScreen`

**For.** C-30 saved-address management.
**The customer is trying to.** Set where dinner goes.
**Renders today.** `AppBar` with a `+` action → list of `Card`s, each with label, `Default` badge, two address lines, and Make-default / Delete buttons.

**Problems.**

1. **"Unit Unit 4211".** `AddressesScreen.tsx:141` renders `, Unit ${address.unit}` while the stored `unit` already contains the word. Visible in `tools/verify/customer-addresses.png` on two of three addresses. Whether the bug is the template or the seed data, the string on screen is wrong.
2. **The `+` action is invisible.** Line 72 sets the icon colour to `theme.color.text.onBrand` (`#0F241C`, a near-black forest ink intended for the *orange* CTA fill) and the `AppBar` background is `surface.chrome` (`#1B3B31`). That is **1.33:1**. `AppBar` resolves its own foreground correctly — `onChrome` at `AppBar.tsx:108`, giving 10.67:1 — but the action icon's colour comes from the call site. This is the same failure class the AppBar title fix in `fd0ab49` documented at 1.28:1, reintroduced one layer up. On a device today, the only way to add an address from this screen is invisible. *(The Sep-12 screenshot predates the `text.onBrand` token flip and still shows a light `+`; the current token value is `#0F241C`.)*
3. **Delete has no confirmation.** Line 152. Irreversible, one tap, no `Modal`.
4. **Delete and Make-default are visually identical.** Both `variant="tertiary" size="sm"`; `destructive` on a tertiary is a colour shift only. `04-accessibility.md` §1.4 requires status to be more than colour, and §2 requires ≥8 between adjacent targets — they sit at `gap: 8`, at the floor, one of them destructive.
5. **Nested interactive.** `Card onPress={onEdit}` (133) wrapping two `Button`s (148, 152). Same `02-components.md` §15 violation as `OrdersScreen`.
6. **No map, no pin, no distance.** C-31 and §1.9. `MapView` exists.
7. **No "outside delivery area" badge.** §1.9 requires save to succeed with an `Outside delivery area` `Badge` on the row.
8. **Off-scale spacing.** `gap: 6` (134) and `marginTop: 6` (146) are not on the 4-based scale.
9. **The primary add affordance is a 20pt icon in the bar**, with no "Add address" button in the list itself.

---

### 1.10 `AddressFormScreen`

**For.** C-30/C-31 address entry.
**The customer is trying to.** Type an address once, correctly.
**Renders today.** Nine stacked controls — Label, Street, Unit, Buzzer, City, Province `Select`, Postal code, Delivery notes, default `Switch` — and a Save button.

**Problems.**

1. **A raw hex literal.** `AddressFormScreen.tsx:151`: `<Text style={{ color: '#B42318' }}>`. Lint L-1. `#B42318` is not even in the current palette — it is `viz.8`, a leftover from the retired ramp. `theme.color.feedback.danger.text` is `#A0210F`.
2. **Every address in the app is the same point.** The file's own header (5–9) says so: *"`latitude`/`longitude` are required by the contract and normally come from a map picker; this app has none yet … so every address this form writes is pinned to the same served downtown-Toronto point."* Consequence: **every distance, every ETA, every delivery fee and every serviceability verdict in the customer app is fiction**, because C-14 computes all of them from these coordinates. The honesty of the comment is commendable; the state it describes makes the discovery screen's metadata row decorative.
3. **No autocomplete, no geocode, no pin.** C-31 and §1.9 require a search field with autocomplete (3 skeleton rows, never a spinner that hides suggestions), a draggable pin, reverse geocoding with the address line as a skeleton for ≤1 s, and — critically — *"Manual entry is always available; the customer is never trapped behind a geocoder."* Today it is manual-only, which satisfies the escape hatch and nothing else.
4. **Nine flat fields, no grouping.** The longest form in the app is one undifferentiated column. Address / Access (unit, buzzer, notes) / Label are three groups.
5. **Every `Input` is `variant="text"`.** `Input` ships `text | email | tel | numeric | password | search | otp` with keyboard mappings (`Input.tsx:23–43`). Postal code gets a full alphabetic keyboard with no `M5H 2N2` mask, no `autoCapitalize`, no validation beyond non-empty (99).
6. **The error is unassociated.** Line 151 renders a bare red `Text` beneath the last field rather than `errorText` on the field that failed — so a screen-reader user hears an error with no idea which control it belongs to. `Input` has `errorText` (`Input.tsx:68`) and `AddressFormScreen` already uses it correctly in `TamperReportCard.tsx:79`.
7. **`gap: 14`** (135) is off-scale.
8. **No province default from the postal code**, no "use my current location", no save-and-select.

---

### 1.11 `RateOrderScreen`

**For.** C-38 rating submission.
**The customer is trying to.** Say the food was good, or that it wasn't.
**Renders today.** Restaurant name → "How was the food?" `Rating variant="input"` in a `Card` → optionally the same for the rider → a comment `Input` → Submit.

**Problems.**

1. **Ratings are discarded when the app closes.** `api/ratings.ts:1–12` asserts as fact: *"`contracts/openapi.yaml` has no rating-submission endpoint at any version."* **This is false.** `PUT /v1/orders/{orderId}/rating`, `operationId: submitOrderRating`, is at `openapi.yaml:2178`, is V1, takes `IdempotencyKeyRequired`, and upserts food and rider targets independently. `GET` is at 2149. The module stores ratings in a `Map` (line 24) instead. `AGENTS.md` §6 says the contract is authoritative — here a screen was built against a belief about the contract rather than the contract.
2. **The primary question is 13px.** `RateOrderScreen.tsx:92` and `108` compose `body.sm` (13/400) with `fontWeight: '700'`. "How was the food?" is the reason the screen exists and is set smaller than the restaurant name above it.
3. **The contract allows partial submission; the screen does not.** Line 65: `canSubmit = foodRating > 0 && (!hasRider || riderRating > 0)`. The endpoint's own description: *"Both `food` and `rider` are optional in the request — the customer may submit either or both in one call."* A customer who wants to rate the food but has no opinion about the rider cannot submit.
4. **No window handling.** The contract returns `409 REVIEW_WINDOW_CLOSED` past 14 days and `409 REVIEW_EDIT_WINDOW_CLOSED` past 24 h from the rating's own creation. The screen offers "Update rating" (132) unconditionally.
5. **Thin hierarchy.** `heading.sm` restaurant name (87) over `body.sm` order code (88), then two identical cards.
6. **No exit but Back.** No "Not now".

---

### 1.12 `TamperReportCard` — `src/components/TamperReportCard.tsx`

**For.** The customer half of the sealed-bag chain of custody, rendered inside tracking during `PICKED_UP`/`ARRIVED`/`DELIVERED`.

**Problems.**

1. **"Take photo & report" does not take a photo.** Line 81's label promises a camera; `submit()` (31–46) calls `reportSealTamper(orderId, note)` with text only. A promise in a button label that the handler does not keep.
2. **Its collapsed state is a bare `ghost` Button** (61) floating in the tracking scroll with no heading and no context — the customer meets "Seal looks tampered?" with nothing around it.
3. **Hand-rolled card.** `cardStyle` (22–29) with `borderRadius: 12` and `gap: 10` (off-scale) instead of `Card`.
4. **Two stacked full-bleed buttons inside a card** (81, 84), neither `fullWidth`, so both hug left.
5. It does one thing right that the rest of the app does not: `errorText` is bound to the `Input` that failed (79).

---

### 1.13 `CustomerTabBar` + `BottomNav` — the navigation

**For.** Primary wayfinding.
**Renders today.** A **floating translucent forest-green pill**, inset from the screen edges, with four tabs, plus a **detached pale-peach circle** hovering above its centre for the cart.

This is *"the navigation looks ugly as fuck even though I had asked to go with normal navigation bar."* The client's word for it is the right one, and the reason is that the component was redesigned away from its own specification.

**`02-components.md` §28 — the actual `BottomNav` spec:**

> **Customer items (5, fixed):** Home · Search · Orders · Favourites · Account.
> **Layout.** 56 + safe-area inset. Icon 24 + `label.md`. Labels always visible.
> **States.** active (`color.brand.600` icon + label, 2px indicator above) · inactive (`text.tertiary`) …

No pill. No translucency. No detached action button. No floating inset. The spec describes an opaque, full-width, 56pt bar with five tabs. `grep` for "glass", "pill" or "detached" across `01-foundations.md`, `02-components.md` and `03-patterns.md` returns nothing but `Tabs variant="pill"` and RULE H-1's "filled green pill". The glass pill and the detached action arrived in commit `0cabf7c` and are documented only in the component's own source comment (`BottomNav.tsx:16–24`), which justifies the action button's soft tint against a review note but never establishes the pill.

**Problems.**

1. **The tab labels fail AA by a wide margin, and the client's measurement understates it.** `BottomNav.tsx:190` sets inactive labels to `theme.color.text.tertiary` = `#6E7C77`. Line 182 sets the pill to `withAlpha(theme.color.surface.chrome, 0.78)` = `#1B3B31` at 78%.
   - Against the **nominal** chrome `#1B3B31`: **2.80:1** — the figure in the brief. Confirmed exactly.
   - Against the **actually composited** pill (78% chrome over `surface.sunken #F6EFDD`, which every screen sets as its background) = `#4B6357`: **1.49:1**.
   The requirement for a 13pt `label.md` is 4.5:1. The rendered value is **one third of it**. In `customer-discovery-tabbar.png` the words "Orders", "Alerts" and "Profile" are barely present.
2. **The active tab fails too.** Line 190: `brand.solid` = `#F1521E` on the composited pill = **1.85:1** (2.98× short). Nominally on chrome it is 3.48:1 — still under 4.5:1 for a 13pt label. **Every label in the navigation fails AA in every state.** There is no reading of the numbers in which this bar is legible.
3. **The pill's own boundary fails 1.4.11.** Line 183 uses `withAlpha(border.decorative, 0.4)` = `#899589` composited, **2.09:1** against the pill it bounds. The bar has no legible edge.
4. **The detached action button overlaps content on every scrolling screen.** Geometry, from source:
   - `actionDiameter = max(56, target.min 44) + 8 = 64` (`BottomNav.tsx:118–119`)
   - `actionWrap.height = 64 × ACTION_OVERLAP 0.6 = 38.4` (92, 138)
   - `actionWrap` is `justifyContent: 'flex-end'` (254), so a 64pt child in a 38.4pt box **overflows 25.6pt upward** into whatever is above it.
   Screens allow: Discovery `16` (`DiscoveryScreen.tsx:153`), Profile `16` (`ProfileScreen.tsx:125`), Notifications `0` (`NotificationsScreen.tsx:107`), Orders `0` with `bottomInset` accepted-and-ignored (`OrdersScreen.tsx:105,150`). All four are below 25.6. `customer-profile.png` shows the result: the circle cuts "Sign out" in half.
5. **The floating action reads as a broken fifth tab.** It sits dead-centre, where a fifth tab would be in the five-tab spec, at 64pt against 56pt tabs, in `state.selectedTint` (`#FEF0EA`) — which is **1.03:1 against the cream page**, i.e. an invisible fill with a thin orange ring. It has the position of a tab, the shape of a FAB, and the visual weight of neither.
6. **A cart affordance that is always present and never informative.** It carries no badge and no count. `RestaurantScreen` already has its own sticky "View cart · N items" bar, so on that screen there are two cart entry points, one of which knows how many items are in the cart and one of which does not.
7. **Four tabs, not the specified five.** Ships Discover · Orders · Alerts · Profile. The spec is Home · **Search** · Orders · **Favourites** · Account. Search (C-10, V1, `/v1/search` contracted) and Favourites (C-17) have no entry point anywhere in the app.
8. **The floating inset wastes the scarcest space on a phone.** `paddingHorizontal: target.spacing × 2 = 16` (126) plus the safe-area inset below means cream on all four sides of the bar, at the bottom of the screen where thumb reach is best.

**`Router.tsx` / `stack.tsx`.**

9. **Switching tabs destroys the stack.** `TabBar.tsx:71` calls `nav.reset()`. The doc-comment (4–8) defends this for tab roots, and for a tab *root* it is right — but the stack has no per-tab history, so Discover → Restaurant → Orders → Discover lands on the feed at the top, having lost the restaurant and the scroll position.
10. **Screens remount on every param change.** `Router.tsx:62` keys the fragment on the route identity. Correct for a different restaurant; it also means scroll position is unrecoverable.
11. **No Android hardware-back integration, no deep links, no URL state.** C-11 R5 requires filter state restorable from route params; push notifications (C-40, P-24) need to open a specific order.
12. **Routes that do not exist:** search, favourites, item detail, help, support thread, payment methods, refunds, receipt, preferences, account deletion.

---

## 2. The five worst problems, ranked

Ranked by what each one costs the customer, not by how much code it touches.

### 1. The certificate is unreachable, so the product's single claim cannot be verified

`AGENTS.md`: *"The product's single claim is halal verification. Everything else is furniture around it."* C-12's SOW trace is *"View **and verify** Halal certifications."* Verification means reading the document.

`HalalCertificationPanel` renders "View certificate" only when given `onViewCertificate`, and "Report a halal concern" only when given `onReportConcern` (`HalalCertificationPanel.tsx:214–230`). `RestaurantScreen.tsx:119–125` supplies neither. `GET /v1/restaurants/{id}/certificate-url` is contracted at `openapi.yaml:1553` and never called.

**Cost.** A customer who wants to know *who* certified this kitchen and *what the certificate says* — which is the entire reason a halal marketplace exists rather than a general one — is shown a badge and a panel and given no way to look behind them. The badge becomes a claim the customer must take on trust, which is precisely the state of affairs the product was built to end. Everything else in this audit is furniture; this is the product.

### 2. The home screen has no structure, because it calls the wrong endpoint

`DiscoveryScreen.tsx:60` calls `GET /v1/restaurants` instead of `GET /v1/feed`. The sectioned feed is specified (C-09), contracted (`openapi.yaml:1354`, `FeedSection` at 7625), and fixtured (`contracts/fixtures/catalogue/feed_sections.json`). The screen also has no search field, no address selector and no standing certification header, all three required by `03-patterns.md` §1.1.

**Cost.** A hungry person gets an undifferentiated column of 20 posters at roughly two per screen, with no way to search, no way to see or change the address the whole list is computed from, and no way to find the place they ordered from last week. There is no answer to "what should I have tonight" and no answer to "where's that biryani place" — the two things anyone opens a food app to do. This is the client's "no sections" complaint and it is one endpoint away from being solved.

### 3. Navigation fails AA in every state and physically covers content

Every label in the tab bar: **1.49:1** inactive, **1.85:1** active, as composited (2.80:1 and 3.48:1 nominal). Requirement 4.5:1. The bar's own border is 2.09:1 against 1.4.11's 3:1. The detached action overflows 25.6pt into content that four screens do not clear, and `customer-profile.png` shows it bisecting "Sign out".

None of this is in `02-components.md` §28, which specifies an opaque 56pt bar with five tabs and no floating action. The client asked for a normal navigation bar; the spec describes a normal navigation bar; the component is not one.

**Cost.** Wayfinding is the one chrome a customer must be able to read without looking. Three of four destinations are illegible, and the fourth is illegible in a different colour. A control sits on top of other controls. Every route the customer might take out of a dead end runs through this bar.

### 4. Checkout takes money without showing where the order is going or how it is being paid

No address (`CheckoutScreen.tsx:58–61` resolves one silently). No payment method — C-24/C-25 are V0 and `/v1/payment-methods` is contracted at `openapi.yaml:2227`. No tip, so riders cannot be tipped at all, despite tips being 100% of their variable income. No delivery instructions (C-33). No restaurant name and no halal badge, which `03-patterns.md` §1.6 requires precisely because *"this is the moment of commitment … the last opportunity to affirm the single claim the customer is paying for."* No `Idempotency-Key`. And a mock-server workaround (76–88) that, against a real backend, routes a genuine failure to an unrelated order.

Upstream, the cart shows only `indicative_subtotal_cents` (`CartScreen.tsx:197–202`), so the real total — subtotal + $2.99 + $1.00/km + 13% HST — is first visible after the customer has already committed to the checkout screen.

**Cost.** The customer authorises a charge they have not seen the composition of, to an address they have not been shown, on an instrument they have not chosen. Every one of those is a support ticket, a chargeback, or a person who does not press the button.

### 5. "Live tracking" is a Refresh button

No map (`MapView` exists, unused). No socket and no poll (`grep` finds neither in `apps/customer/src`). No ETA on the surface (C-32 R3: *"ETA is always present"*). No rider and no way to contact one (C-34, `/v1/orders/{orderId}/rider`). No cancel (C-29, `/v1/orders/{orderId}/cancel`). `TrackingScreen.tsx:125` hands the customer a secondary-styled button at the bottom of a scroll and asks them to press it to find out whether anything changed.

**Cost.** The window between paying and eating is the most anxious part of the experience and the one the SOW names twice. The app's answer is manual refresh, below a receipt.

---

### The pattern underneath all five

Every one of these is **available and unwired**. The endpoint exists. The component exists. The pattern is written down, in normative language, in `03-patterns.md` §1.1–1.9. `Chip`, `Sheet`, `Modal`, `MapView`, `Checkbox`, `RadioGroup`, `Skeleton` and `IconButton` are all shipped, both-theme, accessibility-reviewed, and imported nowhere in this app.

So the honest characterisation of the customer app is not "badly designed". It is **a scaffold that proved the data flows end to end and was never composed into the product the design system was built for**. That is good news for the redesign: the expensive work — tokens, components, contract, fixtures, patterns — is done. What is missing is composition, which is exactly what `redesign-constitution.md` scopes this exercise to.

---

## 3. Redesign direction

### 3.1 The situation, taken seriously

It is 19:40 on a Tuesday in Mississauga. Someone is standing up, holding a phone in one hand, hungry enough that patience is already spent. They may have eaten at three places before and want one of them again. They may be looking for something specific. They are **almost certainly comparing** — this app against the two other delivery apps on the same home screen.

What makes them stay is not this app being prettier. It is this app answering, faster than the others, the one question the others cannot answer at all: **is this halal, and who says so?**

That reframes the whole surface. A generic delivery app's home screen sells appetite. This one has to sell appetite *and* deliver a standing proof, in the same viewport, without the proof ever reading as a compliance footnote — divergence D1: *"the halal seal is the loudest thing on a card; brand yellow is reserved for actions."*

### 3.2 Five principles, argued from the situation

**1. Answer "what should I eat" before "what exists."**
An undifferentiated list makes the customer do the sorting. Sections do the sorting for them: *Order again* is the fastest path for a returning customer and should be first; *Near you* is the default answer; *Trending* is the answer when they have no answer. The contract already returns exactly these, in order, with empty ones omitted. Nothing needs inventing — it needs calling.

**2. Prove it once, then stop apologising.**
The standing header states the guarantee once — *"Every restaurant on HalalGoes is halal certified."* — and the seal on each card is its per-listing evidence. That relationship is why there is no halal filter (D5: *"a filter implies non-certified listings exist"*). And the proof must be **followable**: the certifying body's name in the panel, the certificate one tap behind it. A badge you cannot look behind is a logo.

**3. Design for one thumb, and put the decision in the bottom half.**
A 6.1" phone held one-handed reaches comfortably to about 60% of the screen height. Today the primary action on four screens is a hug-left pill in a footer; on tracking it is a secondary button below a receipt. Every screen should have exactly one full-width primary action in the sticky footer, sized to `target.min` 44 minimum, and the information needed to press it should be above it without scrolling.

**4. Never make them press something to find out.**
Refresh buttons, silent address resolution, subtotals that are not totals, and error banners with no action all shift work onto the customer at the moment they have the least patience. Replace each with the thing it is standing in for: a socket with a 15-second polling fallback and a `connection` state on the timeline; a visible, tappable address; a full priced quote; a `Banner` with an `action`.

**5. Density is a kindness, not a compromise.**
`comfortable` is 64/16/16 — it is already the roomiest register in the system, and it does not mean two cards per screen. `01-foundations.md` §1.3 settles this: *"Dense, information-rich cards over generous whitespace: a food-delivery home is a list of options, not a magazine."* A carousel of `RestaurantCard variant="carousel"` (280pt wide) puts 2.5 options in the horizontal space one full-bleed card occupies vertically. Vertical space is the scarce resource; horizontal space is free.

### 3.3 What it should feel like

**Certain, and quick.** Certain because the guarantee is stated at the top and the seal is on every card in the same place every time, and because tapping it leads somewhere real. Quick because the first screen already contains the three likeliest answers, the search field is always there and never hides behind a magnifier, the address is one tap from the title, and nothing waits on a button press to tell you something it already knows.

**Warm, but not decorated.** Saffron-heir orange on actions, cream canvas, photography where photography earns its place — and no photograph so large that its absence costs 200 vertical points. The forest chrome is chrome, per the amended invariant 10: a dark neutral, not a signal. The one saturated green on screen is the seal, and it means one thing.

**Never alarmed.** Invariant 9 governs more than the halal states. Expired is slate, not red, because red is a religious ruling. That temperature discipline should extend outward: a closed restaurant is a scrim and a time, not a warning; an unavailable item is annotated, not struck through in danger red; a missing address is a prompt with a button, not an alert.

### 3.4 What must not change

Restating `redesign-constitution.md` §1–3 as design constraints, because each one will be tempting to break:

- **No new tokens.** Everything below composes from `tokens.json` as it stands. A needed token is a misread.
- **No new primitives.** `Chip`, `Sheet`, `Modal`, `MapView`, `Checkbox`, `RadioGroup`, `Skeleton`, `IconButton` cover the gaps. The two genuine library absences are recorded in §5, not designed around silently.
- **Invariant 8** — a missing `halal_display_state` renders **no badge**. `HalalBadge` already does this and reports `HALAL_DISPLAY_STATE_MISSING`. No skeleton, no placeholder, no "verifying…" in the seal's slot.
- **Invariant 9** — no halal state is ever red. Not the badge, not the panel, not an error about certification, not a toast.
- **Invariant 10** — the only saturated green solid on any customer screen is `color.halal.certified.seal`. Starting with the login button.

---

## 4. Screen-by-screen redesign brief

Each screen: the intended structure in existing components, the information hierarchy, and what is above the fold. "Above the fold" assumes a 390×844 viewport, minus the AppBar and the tab bar.

Global, applied everywhere:

- Every sticky footer CTA is `fullWidth`, `variant="primary"`, and carries the consequence in its label ("Place order · $27.11").
- Every card is `Card` at `density.cardPadding` (16). No `borderRadius: 12` literals.
- Every loading state is a `Skeleton` in the real geometry. `Spinner` only where geometry is genuinely unknown. Never both.
- Every destructive action goes through `Modal variant="confirm"` with focus on the least destructive action.
- Every screen clears **≥32** of bottom padding above the tab bar until the `BottomNav` overflow is fixed (25.6 + `target.spacing`).
- Both colour schemes render. `App.tsx:251` stops hard-coding `scheme="light"`.

---

### 4.1 LoginGate

**Structure.** `AppBar variant="default"` with no back (or none at all) → a single `Card variant="elevated"` centred in the safe area → `Input variant="tel"` (phase 1) / `Input variant="otp"` (phase 2), both `size="lg"` → `Button variant="primary" fullWidth` → `Button variant="ghost" fullWidth` "Change number" (phase 2 only) → `Banner variant="danger"` for failures, above the button, with the retry as its `action`.

**Hierarchy.** Wordmark / "Sign in" (`heading.xl`) → the one sentence explaining why a phone number (`body.md`, `text.secondary`) → the field → the action.

**Above the fold.** All of it. This screen never scrolls.

**Must change.** Mount **inside** `ThemeProvider`. Delete the entire `StyleSheet` at `App.tsx:152–206` — every value in it exists as a token. The green button becomes `variant="primary"` (orange). The OTP field gets `variant="otp"`, which brings the numeric keypad and paste support (`04-accessibility.md` §10.2 leans on this for WCAG 2.2 3.3.8). "Change number" becomes a 44pt `Button`.

**Also.** Discovery should be reachable without signing in, per C-14 R6 — the gate moves to the first action that needs an identity (add to cart, save address), not the app root. If that is deferred, say so as a decision rather than leaving the comment at `App.tsx:10–12` as the record.

---

### 4.2 Discovery — the home feed

**Structure.**

```
AppBar variant="large"
  title    = the selected address, tappable → address sheet     (C-09 R5, §1.1)
  actions  = [ IconButton: favourites ]
Input variant="search", size="md", pinned, always visible        (§1.1, C-10)
Standing certification strip                                      (C-11, §1.1)
  View on color.halal.certified.tint + shield glyph + caption:
  "Every restaurant on HalalGoes is halal certified."
Banner variant="info" — active-order resume, when one exists      (C-26 R3)
  title = ORDER_STATE_LABELS[state], description = ETA,
  action = { label: 'Track order', onPress: → tracking }
SectionList over GET /v1/feed:
  section header  heading.sm + optional "See all"
  order_again              → RestaurantCard variant="carousel", horizontal
  restaurants_near_you     → RestaurantCard variant="feed", vertical
  trending_in_your_area    → carousel
  your_favourite_restaurants → carousel
  popular_items            → carousel
  you_might_like           → carousel
BottomNav (opaque, full-width — see §4.12)
```

**Hierarchy.** Address (everything below is computed from it) → search → the guarantee → the live order if there is one → *Order again* → *Near you* → the rest.

**Above the fold.** Address, search field, certification strip, the first section header, and **the first carousel row complete** (~180pt: hero 4:3 at 210×158 plus seal, name and meta). A returning customer sees the place they order from without scrolling. Rough budget: AppBar+inset 100 · search 56 · strip 44 · section header 32 · carousel 250 · nav 128 = 610 of 844, leaving ~230 for the resume banner and the start of *Near you*.

**Rules.**
- `restaurants_near_you` stays `variant="feed"` — it is the browse section and deserves the photograph. Everything else is a carousel. That one decision takes the screen from ~2 options per viewport to ~9.
- A section with no items is **absent**, never an empty shell (C-09, `FeedSection` description). The server already omits them; the client must not render headers for keys it did not receive.
- `RestaurantCardSkeleton` with `reserveSealSlot` (`Skeleton.tsx:30`) — the seal's slot is full size from the first frame so nothing reflows. The certification strip renders immediately and never skeletons: it is a static claim.
- Pull-to-refresh sends `Cache-Control: no-cache`, rate-limited 1/10 s (C-09 R6).

**Empty (two, distinct).**
- *No address* → the feed is **not fetched**. `EmptyState variant="page"`: "Set your delivery address to see restaurants near you", primary "Add address". AppBar, search and strip persist.
- *Address set, nothing in range* → "No restaurants deliver to {address} yet", secondary "Try a different address".

**Error.** `ErrorState variant="page"` below the strip; AppBar, search and strip survive so the customer can change address or search out of it. Offline is distinct: persistent `Banner variant="info"` "You're offline", last-cached feed dimmed, every add control disabled.

---

### 4.3 Search *(new route)*

**Structure.** `AppBar variant="search"` with the `Input variant="search"` in `searchSlot`, focused on entry → `Chip variant="filter"` row pinned below once results exist → results: `RestaurantCard variant="compact"` (96pt thumb) then a "Dishes" header and dish rows → `BottomNav`.

**Above the fold.** The field with the cursor in it, and either recent-search chips or the first three compact results.

**Rules.** 250 ms debounce, minimum 2 characters, and the error string says "2" (C-10 R2). **Results are never blanked while typing** — previous results hold at 60% opacity under a 2px indeterminate `AppBar progress` bar. Filters are `FilterChip`; the filter `Sheet`'s header restates the guarantee once. There is no halal filter.

**Empty.** *No query* → recent searches + popular cuisines as chips; not an empty state. *Zero results* → different copy with and without filters, and "Clear filters" only when filters are on.

---

### 4.4 Restaurant detail

**Structure** — `03-patterns.md` §1.3 order is normative:

```
AppBar variant="transparent" over the hero, collapsing to "default"
Card media = hero image 16:9 on a border.decorative plate
  name           heading.xl
  Chip variant="static" × cuisines (max 2 + "+n")
  Rating value/count, pressable → reviews
HalalCertificationPanel                                     ★ above the menu
  onViewCertificate  → GET /v1/restaurants/{id}/certificate-url
  onReportConcern    → C-39 grievance, category HALAL_CONCERN
Availability strip — a Card of DetailLine rows from `availability`:
  state (OPEN / Opens 17:00 / Paused / Too far to deliver)
  ETA range · delivery fee (Price, free="Free delivery") · minimum order
  address · distance
Tabs variant="underline" scrollable includeAllTab            (C-13 R2)
MenuItemCard rows, onPress → item Sheet (§4.5)
Sticky footer: Button primary fullWidth "View cart · N · {Price}"
```

**Hierarchy.** Hero and name (is this the right place) → **certification** (can I eat here) → availability (can I order now, and when) → menu (what do I want).

**Above the fold.** Hero, name, cuisines, rating, and **the halal seal**. The certification panel's header must be visible or one short scroll away — `04-accessibility.md` §3.5 requires it reachable by heading navigation without traversing the menu, and the same should be true for a thumb.

**Rules.**
- Pass **both** panel handlers. This closes worst-problem 1.
- The description moves out of `Banner variant="info"` into a plain `Text` at `body.md` under the name, or an "About" row that opens a `Sheet`. `Banner` is for conditions, not content.
- The availability strip is rendered **from the server object only** (C-14) — the client never recomputes hours, distance, fee or ETA. Every `OPEN`-and-not state disables the add controls and states the reason inline (C-14 R3).
- `Tabs` gets `includeAllTab` and `scrollable`. Selecting a tab filters; the active tab auto-scrolls into view without stealing focus.

**Loading.** Hero skeleton at 16:9 → **certification panel skeleton reserving the seal at `lg` and three metadata lines, never a spinner in the seal's slot** → availability skeleton → tab-strip skeleton → 4 `MenuItemCardSkeleton`.

**Error.** 404 (an `EXPIRED`/`UNVERIFIED` restaurant) → full-page "This restaurant isn't available on HalalGoes right now." **Never** "certification expired" on a customer surface. Certification endpoint fails but detail succeeds → panel shows `ErrorState variant="inline"` + Retry and **draws no seal**; the seal is never rendered from the list payload or from cache.

---

### 4.5 Item detail *(new, `Sheet`)*

**Structure.** `Sheet variant="bottom" snapPoints={[0.6, 0.95]} scrollable keyboardAvoiding` → image → name `heading.lg` → description `body.md` → nutrition block, **omitted entirely when `calories_kcal` is null — no "N/A", no zero** (C-15 R3) → `Chip tone="veg"|"nonveg"` + allergen chips → `RadioGroup` per single-select variant group → `Checkbox` group per multi-select add-on group, each option's `priceDeltaCents` through `Price` (`Checkbox` exports `formatCentsDelta` for exactly this) → notes `Input` → **sticky footer:** `QuantityStepper` + `Button primary fullWidth "Add to cart · {Price}"`.

**Above the fold at snap 0.6.** Name, price, veg marker, allergens, and the first variant group. The footer is always visible — `Sheet` is `keyboardAvoiding` by contract, because a sheet whose submit button sits under the keyboard is broken (`02-components.md` §30).

**Error.** `ITEM_UNAVAILABLE` on add → the sheet **stays open**, an inline `Banner variant="warning"` appears, the footer disables, the menu cache invalidates. The sheet does not close under the user.

---

### 4.6 Cart

**Structure.**

```
AppBar "Your cart", back
Card — restaurant header: Avatar/logo · name heading.md · HalalBadge size="sm"
Line items — Card per line:
  1:1 thumbnail · name label.lg · variant + add-ons body.sm ·
  Price · QuantityStepper (trailing)
  unavailable → Banner variant="warning" inline on the row, with a Remove action
Input — order notes
Card — price breakdown, server-computed:
  subtotal · delivery fee · service fee · each tax line · tip · Divider · Total
  each a Price row; skeletons at exact glyph width while the quote is in flight
Banner variant="warning" — blocking reasons, each WITH an action
  NO_ADDRESS → action { label: 'Add address', onPress: → addressForm }
  BELOW_MINIMUM_ORDER → "Add $4.20 more to order"          (C-14 R5)
Sticky footer (elevation "sticky"):
  Total row · Button primary fullWidth "Go to checkout · {Price}"
Clear cart → a destructive AppBar action, NOT a button under the CTA
```

**Hierarchy.** Where it's from and that it's certified → what's in it → what it costs → go.

**Above the fold.** Restaurant header with the seal, and the first two line items.

**Rules.**
- The breakdown is server-authoritative. The checkout button is **disabled and labelled "Calculating…"** until the quote lands, and is **never enabled against a stale total** (§1.5).
- `Clear cart` moves to an `AppBar` action and goes through `Modal variant="confirm"`.
- Adding from a second restaurant (C-20) → `Modal variant="confirm"`: "Start a new cart with {new}? Your current cart from {old} will be cleared." **Destructive action is secondary; Cancel is primary.**
- `RESTAURANT_UNAVAILABLE` (409) → the halal-specific `ErrorState` (C-12 R3): *"This restaurant's halal certification is no longer current, so we can't place this order. Your cart is saved."* **The cart is not emptied.** And per invariant 9, that state is presented in slate/neutral, never in the danger ramp.

---

### 4.7 Checkout

**Structure.** One scrolling page, all sections visible.

```
AppBar "Checkout", back, progress
Card — Delivery
  address line + label · "Change" → address Sheet
  Chip variant="filter" × delivery-instruction enum          (C-33)
  Input — free-text instruction
Card — Payment                                               (C-24/C-25)
  Radio per saved method: "Visa •••• 4242" · "Add payment method"
Card — Tip                                                   (C-36)
  Chip row: 10% · 15% · 20% · Custom · None, each showing the Price
Card — Order summary — the full quote breakdown
Card — Ordering from
  restaurant name + HalalBadge                               (§1.6)
Sticky footer (elevation "sticky"):
  Button primary fullWidth "Place order · {Price}"
BottomNav hidden                                             (§28)
```

**Hierarchy.** Where → how you pay → the rider's cut → what it costs → who you're trusting → commit.

**Above the fold.** The delivery address and the payment method. Those are the two facts a person checks before they look at the number.

**Rules.**
- The total appears **once**, in the sticky footer, in the button. The summary card itemises; it does not repeat the total 60pt above it.
- No saved address → the Delivery section is first, expanded, "Add delivery address" the only enabled control, everything below disabled. Same treatment for payment.
- Every order-creating call carries a client-generated UUIDv4 `Idempotency-Key`. On submit: the button enters `loading` **with its label intact** ("Placing order…"), the form goes inert, and a second press is impossible. `meta.idempotent_replay=true` is success, routed to tracking — never an error.
- Network drop mid-submit → "We're checking whether your order went through" + automatic re-poll on the idempotency key **before** offering Retry. Never an immediate Retry that risks a double charge.
- 3DS → full-screen web view; on return the app resumes the same order intent.
- Declines render **inline at the Payment card**, with the provider's reason where given.
- Delete the mock-recovery branch at `CheckoutScreen.tsx:76–88` from the production path.

---

### 4.8 Tracking

**Structure.**

```
MapView — top ~55%                                           (§1.7, C-32)
  restaurant · customer · rider (only while PICKED_UP / ARRIVED)
  route active + travelled · follow="fit-all"
  fallbackDetail = both addresses + ETA, for when tiles fail
Sheet variant="bottom" snapPoints={[0.35, 0.8]}, non-dismissible:
  ETA            display.md  "Arriving 19:42–19:52"          (C-32 R3)
  StatusTimeline audience="customer", connection="live|reconnecting|polling"
  Card — rider: Avatar · name · Rating · IconButton call / IconButton chat
  Card — delivery address + instructions
  Card — order summary (collapsed; receipt is C-27's screen)
  Button secondary fullWidth "Cancel order"  — only while cancellable
  caption when it disappears:
    "This order is being prepared and can no longer be cancelled here."
  Button ghost fullWidth "Get help"
TamperReportCard — PICKED_UP / ARRIVED / DELIVERED only
```

**Hierarchy.** Where is it (map) → **when** (ETA, the single largest number on the screen) → what stage → who is bringing it → can I still change it.

**Above the fold.** The map and the ETA. Nothing else matters until those two are answered.

**Rules.**
- **The Refresh button is deleted.** Socket first; `GET /orders/:id` every 15 s when the socket is not `OPEN`; the UI is identical on both paths and `connection` says which one is live.
- Rider position only while `PICKED_UP`/`ARRIVED`/`ON_THE_WAY` (C-32 R4) — the rider's trip *to* the restaurant is not exposed.
- No position for 45 s → `Banner variant="info"` "Location updating…" and the marker **freezes** at last-known; it does not drift.
- Map tiles fail → `MapView` collapses to `fallbackDetail`. **The map is never the only way to know where the order is.**
- Terminal states (`REJECTED`, `CANCELLED`, `FAILED`) replace the timeline with a full-screen outcome that states the refund position and **does not auto-dismiss**.
- Certification lapsing mid-flight (C-12 R2) is an **informational `Banner`** only — the order proceeds, because the food was prepared under valid certification. Neutral tone. Never danger.
- `TamperReportCard` becomes a `Card` with a heading, and either opens the camera or its button is relabelled to what it does.

---

### 4.9 Orders

**Structure.** `AppBar "Your orders"` → **Active section pinned**, each row an `OrderCard variant="customer"` with a compact `StatusTimeline` → `Divider label="Past"` → past `OrderCard`s → load-more → `BottomNav`.

`OrderCard` is **not pressable**; the row's actions are explicit `Button`s beside it: Track / Reorder / Rate / View receipt / Get help / Request refund (C-26 R6), overflow to an `IconButton` + `Sheet` when more than two.

**Above the fold.** The active order with its timeline, or — when there is none — the two most recent past orders with Reorder within thumb reach.

**Must change.** `paddingBottom` uses the threaded `bottomInset` plus ≥32. Two sections, not three tabs. Skeletons without a spinner. Cursor pagination appending a skeleton at the tail; loaded rows do not move.

---

### 4.10 Notifications

**Structure.** `AppBar "Notifications"` with a "Mark all read" action → `SectionList` grouped by day ("Today", "Yesterday", date) → rows at `minHeight: density.rowHeight` (64): `Badge style="dot"` (unread only) · title `label.lg` · body `body.sm` · relative time `caption` → `Divider` between → `BottomNav`.

**Hierarchy.** Day → unread first within day → title → body → time.

**Above the fold.** Four to five rows.

**Must change.** **One** unread signal — the dot — plus the accessible ", unread" that is already correct (133). Drop the bold-weight override, the surface change and the "New" badge. Relative time. `paddingBottom` ≥32 + inset. Compute the unread count here and feed `CustomerTabBar unreadCount` from every screen.

---

### 4.11 Profile / Account

**Structure.**

```
AppBar "Account"
Card — identity: Avatar lg · name heading.md · phone body.sm · "Edit" → Sheet
Card — the menu, ONE card with Divider-separated rows        (not five cards)
  Saved addresses          → addresses
  Payment methods          → payment methods          (C-24)
  Favourites               → favourites               (C-17)
  Order history            → orders
  Refunds                  → refunds                  (C-37)
Card — the second menu group
  Preferences              → preferences              (C-04)
  Help centre              → help                     (C-06)
  Contact support          → support thread           (C-07/C-08)
Button ghost fullWidth "Sign out"    → Modal variant="confirm"
Button ghost fullWidth destructive "Delete account"  (C-05)
caption — app version, legal links
BottomNav
```

**Hierarchy.** Who you are → the things you change often (addresses, payment) → the things you need when something is wrong (help, support, refunds) → the things you do once (sign out, delete).

**Above the fold.** Identity card and the first menu group entire.

**Must change.** Rows at `label.lg` (15/600), not `body.sm` + a weight override. Rows grouped in **one** `Card` with `Divider`s, not one `Card` each. A real chevron from the `Icon` set at `icon.sm`/`icon.md`, not a mirrored back-arrow at 18. The profile form moves into a `Sheet` so the account screen is a menu, which is what it is for. ≥32 bottom clearance. Sign out and Delete both confirm.

> This screen alone closes the WCAG 2.2 *Consistent Help* claim that `04-accessibility.md` §10.2 currently makes and the app does not honour.

---

### 4.12 Navigation — `BottomNav` and `CustomerTabBar`

**The bar returns to its specification** (`02-components.md` §28): opaque, full-width, 56 + safe-area inset, edge to edge, no floating inset, no detached action.

```
BottomNav
  background  surface.raised (an opaque role — not withAlpha(chrome, .78))
  top edge    1px border.decorative, or elevation "sticky" (shadow points up)
  items (5, fixed, per §28):
    Home · Search · Orders · Favourites · Account
  active      color.action.primary icon + label, 2px indicator above
  inactive    text.secondary  (#4A4E48 — 8.13:1 on the cream)
  labels      always visible, label.md, maxFontSizeMultiplier 1.6
  badge       Alerts/Orders count folded into the accessible name
  hidden      during checkout and any modal payment flow
```

**The cart is not a tab and not a floating circle.** It is a **contextual sticky bar** that appears only when the cart is non-empty, sits directly above the nav, and carries what the nav's circle could not: item count and subtotal — "View cart · 3 items · $42.15". `RestaurantScreen` already has this pattern; promote it to the app shell so it is available from Discovery and Search too, and delete the duplicate.

**Contrast, resolved.** Inactive `text.secondary #4A4E48` on `surface.raised #FFFFFF` = **8.49:1** (8.13:1 if the bar sits on the cream canvas). Active `action.primary #F1521E` on white = **3.52:1** — below 4.5:1 for a 13pt label — so the active tab's *label* uses `brand.700 #B0330B` (**6.32:1** on white, 6.05:1 on cream) or `brand.800 #8A2909` (**8.74:1** / 8.37:1), while the **icon and the 2px indicator** carry the brand orange. That keeps the brand present, keeps the label legible, and stays inside the frozen palette. State the chosen step at artboard review; both are in `tokens.json`.

Compare with today: 1.49:1 inactive and 1.85:1 active. The fix is a role swap, not a new colour.

**If the glass pill survives review**, it needs all three of: an opaque fallback wherever the composite drops a label below 4.5:1, a `≥3:1` boundary (not `border.decorative` at 40%), and an action button that does not overflow its own container. Simpler to drop it. The client asked for a normal navigation bar, the spec describes a normal navigation bar, and the pill has never been written down anywhere but its own source comment.

**Router.** Per-tab stacks so a tab press returns to that tab's root without discarding the others; Android hardware back; deep links for push notifications (C-40) and for filter state (C-11 R5). Routes to add: `search`, `favourites`, `itemDetail`, `help`, `support`, `paymentMethods`, `refunds`, `receipt`, `preferences`.

---

## 5. What I could not determine, and what I would need

### 5.1 Questions for the client or the product owner

1. **Is the glass pill a client instruction or a designer's addition?** The client's words are *"I had asked to go with normal navigation bar"*, which reads as a rejection of the pill. The pill appears in no design document. But `01-foundations.md` also records the standing brief *"as close to HungerStation as possible"*, and I could not verify HungerStation's current nav treatment — the research section at §1.2 states egress to `hungerstation.com` was blocked, so the reference itself is unverified. **Needed:** a yes/no on the opaque bar before artboards.
2. **Does the customer app ship dark mode at V1?** `redesign-constitution.md` §5 asks for this to be raised rather than assumed. Raising it. The palette is complete; the cost is QA, not design. **Needed:** a decision.
3. **Five tabs or four?** §28 fixes Home · Search · Orders · Favourites · Account. The app ships Discover · Orders · Alerts · Profile. Alerts is not in the spec's set and Search and Favourites are missing. Notifications could live as an `AppBar` action on Home with the unread badge. **Needed:** confirmation that the §28 set still stands.
4. **Anonymous browse at V0?** C-14 R6 says `NO_ADDRESS` never blocks browsing, and `RestaurantCard` implements the state. The login gate blocks the whole tree. Given **O-03 (SMS/A2P registration) is an open blocker with the longest lead time in the project** (`AGENTS.md` §7), an app that cannot be opened without an OTP cannot be demoed at all. **Needed:** whether browse-before-signin is V0.
5. **Are the empty grey heroes a data problem or a delivery problem?** `hero_image_url` does not resolve in the fixtures. If real restaurants will not have photographs at launch either, the feed card's whole proportion is wrong and `variant="compact"` should be the default. **Needed:** the expected hero-coverage rate at launch. `01-foundations.md` §12 specifies "cuisine-derived gradient placeholders, never stock food photography" — I could not find that generator implemented anywhere.

### 5.2 Library gaps I could not design around

Both are specified in `02-components.md` and absent from `@hg/ui-native`. `redesign-constitution.md` §1 says to say so and stop rather than add a primitive, so:

6. **`ListRow` (§39) does not exist.** It is described as *"the most-used component in the system after `Button`"* and is the correct basis for the account menu, the address list, the payment-method list and the delivery-instruction list. Four screens currently hand-roll it out of `Card` + `Text` + a mirrored icon, which is exactly how they drifted. **Needed:** a decision — build `ListRow`, or ratify `Card` + `Divider` as the official row pattern and document it.
7. **`Countdown` (§38) does not exist in `@hg/ui-native`.** The customer surface needs it for the 15-minute cart TTL and, arguably, for the 180-second restaurant-acceptance window on tracking. Its spec is unusually precise — server-anchored `expiresAt` + `serverNow`, measured clock skew, linear easing, tabular figures, announcements at 50/25/10/0 — so it is not something a screen should improvise. **Needed:** same decision.

### 5.3 Things I could not verify from this repo

8. **How the app actually looks on a device today.** I could not run the Expo build or the mock server (`tools/verify/customer-design-system-sweep.mjs` fails at `ERR_CONNECTION_REFUSED`; it also needs a web export that is not checked in). The committed screenshots corroborate the tab bar and the layout collisions, but `customer-checkout.png` and `customer-tracking.png` predate the palette change and `customer-discovery-tabbar.png`, `customer-profile.png` and `customer-addresses.png` predate the AppBar contrast fix in `fd0ab49`. Every contrast figure in this audit was computed from the **current** `generated/themes.ts`, not read off a screenshot. **Needed:** a fresh capture pass on a device — and `04-accessibility.md` §9's manual gate (VoiceOver + TalkBack over the V0 12) has evidently not been run against this app.
9. **The lint rules the docs call CI-blocking are not wired up.** `01-foundations.md` §8 and `04-accessibility.md` §9 both list `contrast.check.mjs` as CI-blocking over `tokens.json._pairs`. **The file does not exist** (`find` over the repo, excluding `node_modules`, returns nothing). The L-4 rule *does* exist, as `packages/ui-native/src/lint/rules/no-green-solids.cjs` with a `RuleTester` suite — but there is **no ESLint configuration anywhere in the repo** (no `eslint.config.*`, no `.eslintrc*`, at root or in any package), so nothing runs it over anything, least of all `apps/**`. That is why `App.tsx`'s eight raw hexes, `AddressFormScreen.tsx:151`'s ninth, the `#1a7a4a` green solid and the `left`/`right` physical properties in `RestaurantScreen.tsx:148–149` are all still in the tree. L-1, L-4 and L-7 are documented as CI-blocking and are not enforced where it matters. **This is worth fixing before the redesign, not after** — otherwise the redesign reintroduces the same class of defect and nothing catches it.
10. **What the `hero_object_key` → CDN URL resolution is.** `01-foundations.md` §12 says restaurant imagery resolves "through the media CDN", and C-13 AC1 asserts the displayed URL contains the key. I could not find the resolver.
11. **Whether `EXPIRING_SOON` has ever been rendered on this surface.** Fixtures exist under `contracts/fixtures/halal/` and `HalalCertificationPanel` implements the renewal note (`HalalCertificationPanel.tsx:204–206`), but with only one panel call site and no state-driven demo route I could not confirm it renders. `design-surface.md` §4 makes `HalalDisplayState` the one enum where a design error is a product failure. **Needed:** a gallery route or a fixture switch that walks all four states on the real screens.

### 5.4 Product facts I did not assume

Stated explicitly because `redesign-constitution.md` §7.8 requires every on-screen claim to trace to a spec or `claims.ts`:

- The only `claims.ts` in the repo is `apps/marketing/src/lib/claims.ts` — a **marketing** register. I have not treated it as a source for in-app copy.
- Every copy string proposed in §4 is either quoted from `docs/spec/02-customer.md`, from `03-patterns.md` §1, or from `04-accessibility.md` §3.1's fixed labels. Where I needed a string that is not in those, I have marked it as a placeholder for copy review rather than asserting it.
- I have **not** asserted any halal-method, madhhab or certifying-body fact. C-12 R6 forbids the platform from ranking or editorialising certifying bodies; the brief's only requirement is that the body's name is displayed verbatim and the certificate is reachable.
