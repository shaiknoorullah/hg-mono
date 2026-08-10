# Halal Goes — Layout Patterns by Surface

**Status:** system of record · **Date:** 2026-08-10
**Depends on:** [`01-foundations.md`](./01-foundations.md), [`02-components.md`](./02-components.md), [`tokens.json`](./tokens.json)

---

## 0. How to read this document

**MANDATORY:** every pattern below defines its **Empty**, **Loading** and **Error** states. A pattern documented only in its happy state is incomplete and will be rejected at review. Where a state is genuinely unreachable, it is marked *unreachable* **with the reason**, not omitted.

Three global rules that every pattern inherits:

1. **Loading has geometry.** Skeletons match the real layout. A centred spinner is permitted only where the eventual geometry is genuinely unknown.
2. **Error names the cause and the next action.** Copy is keyed off the stable `error.code` enum, never off `error.message`. Unmapped codes fall back to generic copy **and report the gap**.
3. **Empty distinguishes "nothing yet" from "nothing matched".** These are different events with different copy and different actions. Conflating them is a defect.

And one that is specific to this product:

4. **A degraded state never degrades the certification claim.** If certification data fails to load, the seal is not drawn from cache, not assumed, and not approximated — the surface says it could not verify right now. The one thing this system may never do is show a halal badge it is not certain about.

---

# 1. Customer surface (`consumer` theme, `comfortable` density)

## 1.1 Home / browse feed

**Layout.** Collapsing `AppBar variant="large"` carrying the **address selector** as its title (location-first, per HungerStation — the catalogue is meaningless without an address) → persistent `Input variant="search"` pinned below the AppBar, always visible, never a magnifier that expands → **the standing certification header** → the fixed feed sections → `BottomNav`.

**The standing certification header.** A single full-width strip directly under the search field, on `halal.certified.tint`, with the seal glyph and the fixed line: **"Every restaurant on Halal Goes is halal certified."** (C-11). It is stated once, at the top, and never repeated per section.

> **Divergence D5 in practice.** HungerStation's home is a grid of vertical tiles (food / grocery / pharmacy / flowers) with filters below. We have one vertical and one guarantee. Copying the tile grid would build empty rooms; copying the filter row would offer a "halal" filter that implies non-certified listings exist. Instead the guarantee is a statement, and the seal on each card is its per-listing proof.

**Sections** (C-09, exactly these, in this order, each **omitted entirely when empty — never an empty shell**): `order_again` (≤6) · `restaurants_near_you` (≤20) · `trending_in_your_area` (≤8) · `your_favourite_restaurants` (≤10) · `popular_items` (≤10) · `you_might_like` (≤10).

**Card anatomy** — the vertical order is fixed and is the most important layout decision in the customer app:

```
[ hero 16:9, radius lg top ]
[ HalalBadge md          ]   <- seal, on the card's solid surface, NEVER on the image
[ Name          heading.md ]
[ cuisines · +n   body.sm  ]
[ ★4.6 (312) · 2.4 km · 25–35 min · $$ ]
```

The seal sits **between the image and the name**, on solid surface. Foundations §12 forbids placing it on a photograph: a seal on an image is a sticker; a seal on the card body is a credential.

**Empty.** Two distinct cases.
- *No address set* → the feed is not fetched at all. Full-screen `EmptyState`: "Set your delivery address to see restaurants near you" + a primary "Add address". `BottomNav` stays.
- *Address set, zero results in range* → "No restaurants deliver to {address} yet" + secondary actions "Try a different address" and "Notify me when we launch here". **Never** "No results" alone — the customer must learn whether the problem is coverage or the address.

**Loading.** `AppBar` and search render immediately from local state (address is cached). The certification header renders immediately — it is a static claim and must never appear to load. Sections render as skeletons in their real geometry: 2 full-width card skeletons for `restaurants_near_you`, a horizontal row of 2.5 carousel skeletons for the rest. **Each skeleton reserves the seal's slot at full size** so nothing reflows when data lands. Section headers are skeletons too, because section presence is not known until the response arrives.

**Error.** Whole-feed failure → `ErrorState variant="page"` under the AppBar; the AppBar, search and certification header persist so the user can still change address or search. Partial failure is not possible (`GET /feed` is one call). Offline is a distinct state: a persistent `Banner` "You're offline" + the last-cached feed rendered with a 10% dim and every add control disabled, because prices and availability cannot be trusted offline.

---

## 1.2 Search

**Layout.** `AppBar variant="search"` with the field focused on entry → recent searches → results as `RestaurantCard variant="compact"` and dish results interleaved under a "Dishes" header (C-10) → a `FilterChip` row pinned under the AppBar once results exist.

**Filters** (C-11). Cuisine, rating, price band, delivery time, veg-only, offers. **There is no halal filter.** The filter sheet's header restates the guarantee once.

**Empty.**
- *No query yet* → recent searches + popular cuisines. Not an empty state.
- *Query, zero results* → "No restaurants or dishes match '{query}'" + spelling hint + "Clear filters" **when filters are active**. The zero-results-with-filters copy differs from zero-results-without: "No matches for '{query}' with these filters" + a prominent Clear.

**Loading.** Debounced 300 ms. During in-flight: the previous results stay visible at 60% opacity with a 2px indeterminate bar under the AppBar. **Results are never blanked while typing** — a list that empties on every keystroke is the most common search defect. First-ever search shows 4 compact skeletons.

**Error.** Inline `ErrorState variant="inline"` in the results area, Retry; the query and filters persist so Retry is one tap. A timeout is distinguished from a server error in copy.

---

## 1.3 Restaurant detail

**Layout** (C-13, order is normative):
```
hero (restaurants.hero_object_key — never a bundled asset)
name · cuisine chips · Rating (tappable → reviews)
──────────────────────────────────────────────
HalalCertificationPanel                    ★  <- ABOVE the menu, always
──────────────────────────────────────────────
availability strip (C-14: open/closed · hours · ETA · fee · minimum)
address · distance · delivery options for the SELECTED address
──────────────────────────────────────────────
Tabs: All + food_categories in sort_order
MenuItemCard rows
──────────────────────────────────────────────
floating cart bar (sum of quantities, not distinct lines)
```

**Why the panel is above the menu.** C-12 places it there, and the reason is the whole product thesis: the certification is read *before* the food, not after. It is also the first landmark after the header for heading navigation.

**Empty.**
- *Menu has no available items* → "This restaurant isn't serving right now" in the menu area; the certification panel and availability strip still render. (Unavailable items are omitted, not greyed, at V1 — C-13 R1 — so an all-unavailable menu is legitimately empty.)
- *A category tab with no items* → unreachable: tabs are **derived** from the categories present in the returned items (C-13 R2), so an empty tab cannot exist.

**Loading.** Hero skeleton at 16:9 → **the certification panel skeleton reserves the seal at `lg` size and shows three metadata lines**; it never shows a spinner where the seal will be (§0 rule 4 — a briefly-empty certification area on a trust product reads as "no certification") → availability strip skeleton → tab strip skeleton → 4 menu-row skeletons. Menu payload is cached 5 min (C-13 R5); a cache hit renders instantly and revalidates behind a 2px bar.

**Error.**
- *Restaurant 404* — which is what an `EXPIRED`/`UNVERIFIED` restaurant returns (C-12 R1) — → a full-page state: "This restaurant isn't available on Halal Goes right now." **Do not say "certification expired"** on a customer surface; C-12's decision default hides the restaurant entirely precisely so customers never learn that non-certified restaurants exist on the platform. Action: "Browse restaurants near you".
- *Certification endpoint fails, detail succeeds* → the page renders; the panel shows `ErrorState variant="inline"` + Retry and **draws no seal**. The seal is never rendered from cache or from the list payload.
- *Menu fails, detail succeeds* → the panel and availability persist; the menu area gets an inline error + Retry.

---

## 1.4 Item detail / variant + add-on selection

**Layout** (C-15/C-16). `Sheet variant="bottom"`, snap points [0.6, 0.95]: image → name → description → nutrition (**omitted entirely when `calories_kcal` is null — no "N/A", no zero**, C-15 R3) + the fixed disclaimer → allergen chips → `RadioGroup` per single-select variant group → `Checkbox` group per multi-select add-on group, each option showing its `priceDeltaCents` through `Price` → notes `Textarea` → sticky footer: `QuantityStepper` + "Add to cart · {Price}".

**Empty.** *Unreachable* — an item with no variants and no add-ons simply renders neither group. A group with no options is a data error and renders nothing while reporting a client error.

**Loading.** The sheet opens immediately with the data already in the menu payload; only the image loads. If opened via deep link, the whole sheet is a skeleton in the final geometry with the footer button disabled and labelled "Loading".

**Error.** `ITEM_UNAVAILABLE` on add → the sheet stays open, an inline `Banner variant="warning"` appears, the footer disables, and the menu cache is invalidated (C-13 R5). The sheet does not close under the user.

---

## 1.5 Cart

**Layout.** Restaurant header with `HalalBadge` → line items as `ListRow` + `QuantityStepper` → notes → server-computed price breakdown (`Price` rows: subtotal, delivery fee, service fee, tax, tip, total) → sticky "Go to checkout".

**Single-restaurant constraint** (C-20). Adding from a second restaurant opens a `Modal variant="confirm"`: "Start a new cart with {new restaurant}? Your current cart from {old} will be cleared." Destructive action is secondary; Cancel is primary.

**Empty.** "Your cart is empty" + "Browse restaurants". The `BottomNav` badge clears.

**Loading.** Line items render from local cart state instantly. **The price breakdown is server-authoritative (C-22) and shows `Price loading` skeletons at exact glyph width** while the quote is in flight, so the total does not jump. The checkout button is disabled and labelled "Calculating…" until the quote lands — never enabled against a stale total.

**Error.**
- *Quote fails* → totals show "—", checkout disabled, inline error + Retry. **The button is never enabled against an unquoted cart.**
- *`RESTAURANT_UNAVAILABLE` (409)* → the halal-specific `ErrorState` (C-12 R3): "This restaurant's halal certification is no longer current, so we can't place this order. Your cart is saved." **The cart is not silently emptied.** Actions: "Find a similar restaurant" / "Keep cart".
- *`ITEM_UNAVAILABLE`* → the affected row is marked with a warning `Banner` and a "Remove" action; other rows are untouched.

---

## 1.6 Checkout

**Layout.** Single scrolling page, sections collapsible but all visible: delivery address + instructions enum (C-33) → schedule (ASAP only at V1) → payment method → tip selector → the full price breakdown → **restaurant name with `HalalBadge`** → sticky "Place order · {Price}".

**Why the seal appears at checkout.** This is the moment of commitment. It costs one row and it is the last opportunity to affirm the single claim the customer is paying for.

**Empty.** *No saved address* → the address section is the first thing, expanded, with "Add delivery address" as the only enabled control and everything below disabled. *No saved card* → same treatment for payment.

**Loading.** Sections render from cache; the price breakdown skeletons as in the cart. On submit, the primary button enters `loading` with its label intact ("Placing order…"), the whole form becomes inert, and **the button cannot be pressed twice** — every order-creating call carries a client-generated `Idempotency-Key` (UUIDv4) and a replay returns the original response.

**Error.**
- *3DS / SCA required* → a full-screen web view; on return the app resumes the same order intent, never creates a second.
- *Payment declined* → inline, at the payment section, with the decline reason where the provider gives one; the order is not created; the cart is untouched.
- *Idempotent replay detected* (`meta.idempotent_replay=true`) → treated as success, routed to tracking. Never a duplicate order and never an error shown for a replay.
- *Network drop mid-submit* → "We're checking whether your order went through" + an automatic re-poll on the idempotency key before offering Retry. **Never** an immediate Retry that risks a double charge.

---

## 1.7 Live order tracking

**Layout** (C-32). `Map` occupying the top ~55% → a `Sheet` at snap [0.35, 0.8] containing `StatusTimeline` → ETA → rider `Avatar` + name + call/chat (masked alias) → restaurant contact → order summary → cancel (only while cancellable).

**Cancellation** (C-29). Free before acceptance, which voids the authorisation. The Cancel affordance disappears at `PREPARING` and is replaced by "Contact support" — the control's absence must be explained, not silent: a `caption` reads "This order is being prepared and can no longer be cancelled here."

**Empty.** *Unreachable* — this screen requires an order id. Deep-linking a terminal order routes to the receipt instead.

**Loading.** Timeline skeleton with the **correct number of steps** (the shape is known before the data) → map frame with skeleton tiles → sheet content skeletons. The last-known state is rendered from cache first and revalidated, so a reopened app never shows a blank tracker.

**Error.**
- *Socket down* → poll `GET /orders/:id` every 15 s (§0.4). A `Banner variant="info"`: "Reconnecting — updates may be delayed." **The timeline stays correct, only less fresh, and says so.**
- *No rider position for 45 s* → `Banner`: "Location updating…"; the marker **freezes** at last-known and does not drift or interpolate.
- *Map tiles fail* → the map collapses to a text panel with both addresses and the ETA. **The map is never the only way to know where the order is.**
- *Order cancelled while viewing* (`CANCELLED_NO_RIDER`, restaurant reject, timeout) → the timeline switches to a `failed` step, the sheet expands, and the refund status is shown with its provider reference. C-12 R2's case — certification lapses mid-flight — shows an informational `Banner` only; the order proceeds, because the food was prepared under valid certification.

---

## 1.8 Order history and receipt

**Layout.** Active orders pinned at the top with a compact `StatusTimeline`; past orders as `OrderCard variant="customer"` (each carrying a `HalalBadge` — the badge is required on order history and receipts, C-12 AC2). Cursor-paginated with load-more.

**Empty.** *Never ordered* → "You haven't ordered yet" + "Browse restaurants". *Filtered to nothing* → "No orders in this period" + Clear.

**Loading.** 4 `OrderCard` skeletons. Load-more appends a skeleton row at the tail; loaded rows do not move.

**Error.** Inline error + Retry, with already-loaded pages retained. A single failed page never discards the list.

---

## 1.9 Address entry

**Layout** (C-30/C-31). Search field with autocomplete → map with a draggable pin → the reverse-geocoded address, editable → unit/buzzer → instruction enum → label (Home/Work/Other) → Save.

**Empty.** *No saved addresses* → the entry form is the screen, not an empty list.

**Loading.** Autocomplete shows 3 skeleton rows under the field, never a spinner that hides suggestions. Reverse geocode after a pin drag shows the address line as a skeleton for ≤1 s, then the result; Save is disabled meanwhile.

**Error.**
- *Geocode fails* → manual entry is enabled with all fields editable and a `Banner`: "We couldn't find that address — you can enter it manually." **Manual entry is always available; the customer is never trapped behind a geocoder.**
- *Location permission denied* → an inline explanation + a deep link to system settings + manual entry. Never a bare grey map.
- *Outside delivery area* → save is allowed (the address is still theirs), but the address row carries an "Outside delivery area" `Badge` and selecting it puts the feed into the `OUT_OF_RANGE` state.

---

# 2. Rider surface (`field` theme, `roomy` density)

Design constraints, stated once: **outdoor sunlight**, **one-handed**, **helmet/gloves**, **glanceable in under two seconds**, **often in motion (stationary but on a bike)**. Therefore: all body text ≥7:1, `body.lg` default, `target.field` 56 minimum and `target.criticalField` 72 for Accept/Decline, no photographic imagery behind text, no hover affordances, no tooltips, and Midnight `900/950` chrome so the screen is not a mirror.

## 2.1 Offer sheet

**Layout** (D-14). Full-screen, `zIndex.offerSheet` (outranks everything), **non-dismissible until server `expires_at`**.

```
┌──────────────────────────────────────┐
│  Countdown ring        0:27          │   linear, server-anchored, skew-corrected
│                                      │
│  $11.40              display.lg      │   base · distance · surge · tip-so-far
│  ─────────────────────────────       │
│  PICKUP    Al-Noor Grill             │
│            1.2 km · 4 min            │
│  DROPOFF   Danforth Ave, Riverdale   │   street + neighbourhood ONLY
│            5.8 km · 17 min           │   unit + phone withheld until accept
│  ─────────────────────────────       │
│  3 items · standard                  │
├──────────────────────────────────────┤
│  [   Decline   ]  [    ACCEPT     ]  │   72h each, ≥24 apart, Accept at thumb
└──────────────────────────────────────┘
```

**Rules that are layout rules.** The sheet **never auto-dismisses before `expires_at`** and shows "Offer expired" for 3 s at expiry — the shipped app dismissed at 7 s against a 5-minute window and riders lost jobs they intended to take. Duplicate deliveries of the same `offer_id` across the three parallel paths (push, socket, pull) render **one** sheet. A late push whose `expires_at` has passed renders **nothing** and silently re-pulls.

**Empty.** *Unreachable* — a sheet without an offer is not rendered.

**Loading.** The sheet opens with whatever the push payload carries and fills the rest from `GET /offers/current`. **The countdown starts immediately from the push payload's `expires_at`** — it never waits on the pull. Missing secondary fields render as skeletons; Accept is enabled the whole time, because the countdown does not pause for our network.

**Error.** *Pull fails* → the sheet stays open with push-payload fields only and Accept remains enabled (accepting is server-validated; a client that cannot read the details can still take the job). *Accept fails* → `409 OFFER_ALREADY_TAKEN` / `OFFER_EXPIRED` → the sheet closes with a plain explanation and a 2 s "back to waiting" transition. It is never presented as the rider's fault.

---

## 2.2 Rider dashboard

**Layout** (D-18). Three server-determined modes; the client renders the mode, it does not compute it.

| Mode | Layout |
|---|---|
| `OFFLINE` | Today's earnings `display.lg` → a full-width 72h "Go online" `Switch`-button → **blocking reasons listed explicitly** if any (onboarding incomplete, documents expired, account suspended), each with the next action |
| `ONLINE_IDLE` | Map with own position → "Waiting for offers" → today's earnings + trips → surge zone if any |
| `ON_DELIVERY` | A persistent full-width card that **deep-links straight into the active assignment at the correct step** |

**The dashboard is the only crash-recovery path.** It always returns `active_assignment` when one exists, with its state, so the app restores the exact screen. A rider must never be able to reach home with a live assignment and no visible resume affordance.

**Empty.** `ONLINE_IDLE` with no offers is **not** an empty state — it is the working state, and it says so ("Waiting for offers · online 42 min"). A genuine empty is `OFFLINE` with zero earnings today: "No trips yet today. Go online to start receiving offers."

**Loading.** Cached mode renders instantly; the dashboard is cached 5 s server-side. Earnings show `Price` skeletons — **never a stale number, never a client-computed one** (the client never adds numbers; D-18).

**Error.** *Dashboard fails while `ON_DELIVERY` is cached* → the assignment card renders from cache with a `Banner`: "Reconnecting." The rider can still act; transitions are idempotent and server-validated. *Tracking unhealthy* → a persistent `Banner variant="warning"`: "Tracking isn't reporting — you may stop receiving offers" + a **one-tap deep link** to permissions/battery settings (D-18).

---

## 2.3 Delivery flow

**Layout.** One screen per assignment state, each with: a map strip at top, the current objective in `heading.xl`, the address block, contact `IconButton`s (call alias / chat), and **one primary 72h action at the bottom edge**.

```
ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → PICKED_UP
        → EN_ROUTE_TO_DROPOFF → ARRIVED_AT_DROPOFF → DELIVERED
```

**Rules that are layout rules.**
- **No timer in the app may advance a state.** Every transition is an explicit rider action posted to `/transitions` with lat/lng/accuracy and an `Idempotency-Key`, validated server-side against the machine and the geofence.
- Transitions are strictly forward. A repeat of the current state is a 200 no-op; a backwards transition is `409 INVALID_TRANSITION`. The UI therefore shows **exactly one** forward action — there is no Back.
- **Prices and order totals are never shown** (D-19).
- `special_instructions` render **verbatim and never silently truncated**; long text scrolls.
- Allergen and halal notes on an item render as `Chip`s so the rider does not swap bags.
- Progressive disclosure: full address, unit and phone alias appear **only after accept**, and are redacted to street level within 30 minutes of a terminal state.

**Proof of delivery** (D-21). Camera → preview → confirm. The photo must be captured in-flow, never picked from the library. Layout: viewfinder at 4:3 with the instruction enum overlaid as a reminder ("Leave at door").

**Empty.** *Unreachable* — a delivery flow requires an assignment.

**Loading.** The step screen renders from the dashboard's `active_assignment` immediately. Map and route load behind it. The primary action is **enabled as soon as its precondition is known**, never gated on the map.

**Error.**
- *Transition rejected on geofence* (`arrival_radius_m` 150) → an inline explanation with the measured distance and an **override path that requires a reason** — a rider physically at a mis-geocoded address must not be stuck. The override is recorded in `assignment_transition.override_reason`.
- *Offline at transition* → queued with its idempotency key, an "Will send when back online" `Banner`, and automatic retry. The rider proceeds; the state advances locally as *pending* with a visible pending marker, and reconciles on reconnect.
- *POD upload fails* → the photo is retained locally and retried; the delivery is **not** blocked on the upload, and the pending upload is shown on the dashboard until it clears.
- *Assignment cancelled/reassigned mid-flow* → a full-screen interrupt explaining what happened and what the rider is owed (`cancel_compensation_cents` where applicable), then a return to `ONLINE_IDLE`.

---

## 2.4 Earnings

**Layout.** Period selector (day/week/month) → total `display.lg` → a per-delivery ledger list, each row: date, order ref, base + distance + wait + tip breakdown, total. Next payout date and amount pinned at top.

**Empty.** "No earnings in this period" + the period selector retained. Never a bare zero.

**Loading.** Total as a `Price` skeleton; 5 ledger-row skeletons.

**Error.** Inline + Retry. **Earnings are never estimated client-side** — a failed fetch shows no number at all rather than a computed one. Showing a rider a wrong earnings figure is worse than showing none.

---

# 3. Restaurant surface (`operational` theme, `compact` density)

Design constraints: **dense**, **audible**, **never miss an order**, often a wall-mounted or counter tablet in a noisy kitchen with a 180-second decision window.

## 3.1 Live order queue

**Layout** (R-23). Four columns at ≥`lg` breakpoint, `Tabs` below it:

```
│   NEW (2)    │  ACCEPTED (1) │  PREPARING (4) │   READY (1)   │
│  countdown   │               │  late flags    │  rider ETA    │
└──────────────┴───────────────┴────────────────┴───────────────┘
  ▸ Out for delivery (3)                              collapsed strip
```

- `NEW` sorts by `response_deadline_at` ascending (most urgent first); all others by `promised_ready_at` ascending.
- A new order raises a `Modal` with a `Countdown` and **an audible, repeating alert** that does not stop until acknowledged.
- Orders past `promised_ready_at` while `PREPARING` carry a `late` flag: a `color.warning` start-border + a "Late" badge.
- **PII minimisation is a layout constraint**: first name + last initial, masked phone, and the delivery address **only after `ACCEPTED`** — before acceptance the card shows city + distance band only.
- `special_instructions` are rendered **verbatim, HTML-escaped, prominent** — R-23 R2 names them the highest-frequency source of order errors, so they get their own bordered block, not a metadata line.

**The accept modal.** Accept at `target.criticalField`, Reject separated by ≥24 and requiring a reason code. The `Countdown` is `critical` under 45 s. At expiry the modal closes itself and the order moves out of `NEW` — the restaurant is told what happened, not left with a dead dialog.

**Empty.** *No open orders* → the four columns persist with their headers (the structure is the information) and a single centred line in the board area: "No open orders. New orders will appear here and sound an alert." **Never** collapse the columns — a restaurant staring at a blank screen cannot tell "quiet" from "broken".

**Loading.** Column headers and counts render first; 2 skeleton cards per column. Initial load is REST; the SSE stream then keeps it current.

**Error.**
- *SSE disconnect* → a **persistent, prominent** `Banner variant="danger"` at the top of the board: "Not receiving new orders — reconnecting." This is the highest-severity UI state on this surface: an unnoticed disconnected queue is a missed order. On reconnect the client **refetches the open set** (the stream is a delta channel, not the source of truth) and de-duplicates.
- *Reconnect gap* → both orders that arrived during a 40 s gap are present after refetch, neither duplicated.
- *Accept fails* → the modal stays open with the countdown still running and an inline error. It never closes on a failed accept.
- *Audio blocked by autoplay policy* → a blocking one-time "Enable sound" gate before the queue is usable, plus a persistent indicator that sound is on. A silent queue is not a functioning queue.

---

## 3.2 Menu management

**Layout.** Category sidebar → item list → an edit `Sheet variant="side"`. Availability is a `Switch` per row (immediate, server-confirmed, never optimistic). Items pending admin approval carry a `Badge variant="info"` "Pending review" and remain visible with their previous live values.

**Empty.** *No menu* → a first-run state: "Your menu is empty. Add your first category to get started" + a primary action. *Category with no items* → an inline empty inside the list with "Add item", the category retained.

**Loading.** Sidebar renders first; 6 item-row skeletons. Availability switches show `loading` on the thumb while confirming.

**Error.** Save failure keeps the sheet open with values intact and an inline error naming the field. Availability toggle failure **reverts the switch and toasts the reason** — the switch must never end up disagreeing with the server.

---

## 3.3 Onboarding and document upload

**Layout** (R-04 to R-10). `StatusTimeline variant="horizontal"` driven by the **server's** `onboarding_state` — never a client step counter. Each step is a card: what is needed, what was submitted, current status, and the next action. The halal certificate step carries a `HalalBadge surface="operational"` reflecting the certificate's real state, including `UNVERIFIED` (this is the one surface where `UNVERIFIED` renders).

**Empty.** *Nothing submitted* → each step shows its requirement and an upload action. Not an empty state — a checklist.

**Loading.** Timeline from cached state; per-document status as `Badge` skeletons. Upload shows real byte progress, never an indeterminate spinner.

**Error.** *Rejected document* → the step turns `failed`, shows the **admin's rejection reason code and text verbatim**, and offers re-upload. *Upload failure* → retained locally, retryable, with the file name preserved. *Expiring document* → a `Banner variant="warning"` at `[30, 14, 7, 1]` days out (the `halal_cert_warning_days` schedule), escalating in prominence, and at expiry a `danger` banner explaining that the restaurant is now `DELISTED` and how to restore.

---

# 4. Admin surface (`operational` theme, `compact` density)

## 4.1 Tables and queues

**Layout.** Persistent left nav → filter bar → `DataTable` → a `Sheet variant="side"` for row detail. Cursor pagination with load-more. Saved views per queue (onboarding, halal, refunds, cases).

**Empty.** Three distinct states, three distinct copies:
- *No records at all* → "No restaurants have applied yet."
- *Filtered to nothing* → "No records match these filters" + a prominent **Clear filters**.
- *Queue drained* → "Onboarding queue is clear" — a **positive** state with the last-processed timestamp, so an admin can tell "done" from "broken". This distinction is the whole reason the three cases are separated.

**Loading.** Header + filter bar render immediately; 5 skeleton rows in the real column geometry. **Never a centred spinner replacing the table** — that loses the header and the user's place. Load-more appends a tail skeleton.

**Error.** `ErrorState` in the table body with the header retained; filters preserved so Retry is one click. Per-row action failures toast and leave the row unchanged.

---

## 4.2 Document review

**Layout.** Split: `DocumentViewer` on the start side (60%), the review form on the end side (40%), both independently scrollable. The document is always visible while reviewing — a reviewer must never scroll away from the evidence to record a decision.

**Empty.** *Queue empty* → the drained state above, with a link to the audit log.

**Loading.** Viewer skeleton at the document's aspect ratio; the form renders immediately from the record, since the checklist structure is known before the image loads.

**Error.** *Presigned URL expired (403 from MinIO after 300 s)* → this is the **expected** path, not an error: the viewer shows "This link expired" + "Request again", which mints a new presigned URL and writes a new audit row. *Document genuinely missing* → a hard error blocking approval, because a check cannot be recorded against a document nobody can see.

---

## 4.3 Halal verification ★

**Layout** (A-15). The most consequential screen in the platform, and the one place where the admin UI is deliberately slower than it could be.

```
┌───────────────────────────┬──────────────────────────────────┐
│                           │  TRANSCRIBE (6 fields + scope)   │
│                           │   certificate_number  [ mono ]   │
│   DocumentViewer          │   issuing_body_id     [Select]   │  registry only,
│   (the certificate)       │   certified_legal_name           │  free text NOT permitted
│   always visible          │   certified_address              │
│                           │   issued_on / expires_on         │
│                           │   scope               [Select]   │
│                           ├──────────────────────────────────┤
│                           │  HalalChecklist — 7 checks       │
│                           │   H1 legible/complete    human   │
│                           │   H2 issuer accepted     system→ │
│                           │   H3 name match          system→ │
│                           │   H4 address match       partial │
│                           │   H5 dates valid       🔒 locked │
│                           │   H6 scope sufficient    human   │
│                           │   H7 not reused        🔒 locked │
│                           ├──────────────────────────────────┤
│                           │  [ Reject ]        [ Approve ]   │
└───────────────────────────┴──────────────────────────────────┘
```

**Deliberate friction.** Approve stays disabled until all seven are `PASS`, and its disabled state **names the outstanding keys** ("2 checks outstanding: H1, H6"). H5 and H7 are server-computed and render locked — the affordance to override is not offered at all, because offering it and then returning `409 CHECK_NOT_OVERRIDABLE` teaches admins that the system is arbitrary. Any human override of H2/H3/H4 requires a ≥20-character note, enforced by a live counter with an explanatory block rather than a silent disable. A persistent notice states that every field transcription and every check result is audited with full before/after retention.

**Empty.** *No pending certificates* → the drained state, plus a link to the halal register (every restaurant, certificate, issuing body, expiry).

**Loading.** The checklist renders immediately with all seven rows and their descriptions — the structure is fixed and known. Only the system-computed results (H2/H3/H5/H7) show inline skeletons. **Approve is disabled while any computed check is still loading**, and says so.

**Error.** *A computed check fails to evaluate* → that row shows an error and Approve stays disabled. **The admin may not proceed with an unevaluated H5 or H7** — these are the two checks that protect against expired and duplicate certificates, and a design that lets them be skipped under load is how a bad certificate gets approved. *Approve rejected server-side* (`422 CHECKLIST_INCOMPLETE` / `422 CHECK_FAILED`) → the named keys are highlighted inline and focus moves to the first one.

---

## 4.4 Order lookup and refunds

**Layout.** Search by order number/phone/email → `DataTable` → detail sheet with `StatusTimeline` (full 14-state vocabulary, not the customer's collapsed five), the double-entry ledger view, payment/refund records with provider references, and the audit trail.

**Empty.** *No match* → "No order matches '{query}'" + the accepted formats listed. *No refunds on an order* → an inline "No refunds issued" line, not a hidden section — absence is information here.

**Loading.** Skeleton rows; the ledger renders after the order, and the sheet does not block on it.

**Error.** A refund action failure is **never** swallowed: it shows the provider error, keeps the record in a retry queue with exponential backoff, and raises the P1 path. The UI states plainly whether money moved. "A refund is a refund, not a TODO log line" (D-15) is a UI requirement as much as a backend one.

---

# 5. Cross-surface state matrix

The check every screen must pass before review.

| Surface / screen | Empty | Loading | Error |
|---|---|---|---|
| Customer home feed | ✅ no-address vs zero-in-range (distinct copy) | ✅ skeletons w/ seal slot reserved | ✅ page error; chrome + certification header persist; offline distinct |
| Customer search | ✅ no-query vs zero-results vs zero-with-filters | ✅ debounced; prior results dimmed, never blanked | ✅ inline + Retry; query preserved |
| Restaurant detail | ✅ no available items | ✅ panel skeleton reserves seal at `lg` | ✅ 404 ≠ "expired"; cert failure draws **no** seal |
| Item sheet | ✅ *unreachable* (groups omitted) | ✅ instant from menu payload | ✅ `ITEM_UNAVAILABLE` keeps sheet open |
| Cart | ✅ empty cart | ✅ `Price` skeletons; checkout disabled | ✅ `RESTAURANT_UNAVAILABLE` halal copy; cart preserved |
| Checkout | ✅ no address / no card | ✅ inert form; idempotency-keyed | ✅ 3DS, decline, replay, network-drop all distinct |
| Tracking | ✅ *unreachable* (needs order id) | ✅ timeline w/ correct step count | ✅ socket-down, 45 s stale, tile failure, cancellation |
| Order history | ✅ never-ordered vs filtered | ✅ card skeletons; load-more tail | ✅ page retained on partial failure |
| Address entry | ✅ form is the screen | ✅ suggestion skeletons | ✅ geocode fail → manual entry always available |
| Rider offer | ✅ *unreachable* | ✅ countdown starts from push payload | ✅ taken/expired stated as fact, not fault |
| Rider dashboard | ✅ offline-zero (idle ≠ empty) | ✅ 5 s cache; `Price` skeletons | ✅ cached assignment + reconnect banner; tracking-unhealthy banner |
| Rider delivery flow | ✅ *unreachable* | ✅ renders from `active_assignment` | ✅ geofence override w/ reason; offline queue; POD retry |
| Rider earnings | ✅ no-earnings-in-period | ✅ skeletons | ✅ **no number rather than a wrong number** |
| Restaurant queue | ✅ columns persist + explanatory line | ✅ headers first, 2 cards/column | ✅ **persistent** disconnect banner; refetch + dedupe; audio gate |
| Restaurant menu | ✅ no-menu vs empty-category | ✅ sidebar first | ✅ switch reverts on failure |
| Restaurant onboarding | ✅ checklist, not empty | ✅ real byte progress | ✅ rejection reason verbatim; expiry escalation |
| Admin tables | ✅ none vs filtered vs **drained** | ✅ rows only; header retained | ✅ filters preserved |
| Admin doc review | ✅ drained | ✅ viewer skeleton; form immediate | ✅ presigned expiry is expected, not an error |
| Admin halal ★ | ✅ drained + register link | ✅ 7 rows immediate; computed checks skeleton | ✅ **unevaluated H5/H7 blocks approval** |
| Admin refunds | ✅ no-match vs no-refunds | ✅ sheet does not block on ledger | ✅ failure states plainly whether money moved |
