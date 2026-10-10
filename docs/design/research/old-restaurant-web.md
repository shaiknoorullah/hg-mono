---
covers:
  - apps/restaurant/src/**
reviewed: 2026-10-10
---

# What the old restaurant web app teaches the redesign

> **2026-10-09:** the redesign is being built in `apps/restaurant/src/redesign/`, behind the
> `VITE_HG_REDESIGN` build flag (off in release builds), from the owner-approved canvases
> ([#89](https://github.com/shaiknoorullah/hg-mono/issues/89), tracking
> [#658](https://github.com/shaiknoorullah/hg-mono/issues/658)). Until a redesigned screen lands, the
> redesign hosts the legacy screen for that route inside the new shell. This brief still describes
> the old Next.js app and what the redesign takes from it; nothing below changes.

> **2026-10-05:** the new app adds what the old one never had — a live "rider approaching" map on
> accepted orders, drawn from the coarse realtime position
> ([R-23 rule 8](../../spec/03-restaurant.md#r-23--live-order-dashboard)). Nothing below changes.

Brief for issue #140, which feeds the restaurant redesign (#82). Written 28 Sep 2026.

**Sources**

- **Old app:** `shaiknoorullah/halal-goes`, branch `restaurant-prod`, the `restaurant-web` folder under `apps/`, a Next.js app.
  - Paths below written as `old:src/...` are relative to that folder.
- **Today's app:** `apps/restaurant/src` in this repo.
- **Rules and data:**
  - the restaurant audit and the redesign constitution, both on branch `origin/claude/redesign-groundwork`
  - the restaurant spec, `docs/spec/03-restaurant.md`
  - the API contract, `contracts/openapi.yaml` and `contracts/websocket.md`

**How the old app was studied.** It could not be rendered cheaply, so there are no screenshots. Every page sits behind `AuthGuard` and `old:src/middleware.ts`, which redirect to `/login`, and every screen fetches from the old backend. There is no Storybook and there are no screenshots in `docs/` or `public/`. This brief comes from reading the page and component code closely.

**Some of the old app's code was never shown to users.** The findings keep this apart from what shipped.

| Component | Status |
|---|---|
| `old:src/components/orders/OrderKanbanBoard.tsx` | Never mounted |
| `OrderCard.tsx` | Never mounted |
| `OrderNotificationDialog.tsx` | Never mounted |
| `WhatsNewPanel.tsx` | Never mounted |
| `OrderEventTimeline.tsx` | Commented out |
| `orderSheet.tsx`, `menuItemSheet.tsx` | Mock data only |
| `/disputes` | Placeholder page |
| `/categories` | Read-only; its buttons are disabled |

---

## 0. The owner's claim, tested

The owner says the old app is better at layout, hierarchy and information display. That holds up, for five reasons:

1. **Persistent frame.** The old app shows the same status on every screen: an icon rail, plus a 56px status bar with the page title, the accepting-orders switch, the restaurant name and area, "Closes at 10:00 PM today", help, notifications and profile. Today's app has only a side rail. The `TopBar` and `systemBanner` slots are empty, and there is no page title in the chrome.
2. **Master–detail.** On the old orders page you pick an order from a list on the left and its full detail opens on the right, so you never lose your place. Today's app shows a flat grid of cards and has no detail view.
3. **Summary first, then list, then drill-down.** Payments opens with three summary cards (earnings, pending, next payout), then tabs, then a table, then a detail sheet. The menu page opens with counts, then a toolbar, then grouped rows. Today's app opens straight into lists and shows no summary numbers anywhere.
4. **More of the data is visible.** The old app shows add-ons, the rider, the customer's contact, the address, variants and add-ons on menu rows, image thumbnails, allergen counts, and why a transfer failed. Today's app leaves out much of what the contract already provides (see the per-screen findings in the [restaurant audit, PR #14](https://github.com/shaiknoorullah/hg-mono/pull/14)).
5. **Every screen has proper states.** There are skeletons shaped like each page's layout, and empty states that tell "nothing matches your filter" apart from "you have nothing yet". Today's app uses a centred spinner everywhere.

It is not "best" for five reasons:

1. **Colours break our rules.** It uses raw Tailwind colours: solid green Accept buttons, red for urgency, red "Non-Veg" badges, red counters.
2. **It does money in the browser.** Prices arrive as strings in dollars, are parsed to floats, multiplied, and formatted as USD.
3. **It says almost nothing about halal.** Its one statement is a "Halal Certified: Yes/No" figure on the profile page.
4. **It polls every 30 seconds instead of using realtime.**
5. **Some of its behaviour is unsafe.** The never-mounted order dialog rejects the order when the user closes it or its timer runs out.

---

## 1. Shell: icon rail, status bar, breadcrumbs

**Files:** `old:src/components/layoutWrapper.tsx`, `sidebar.tsx`, `StatusBar.tsx`, `ContentHeader.tsx`, `contexts/PageContext.tsx`.

### What it shows, in order

**Left: a fixed 64px icon-only rail.**
- Items: Dashboard, Menu, Orders, Payments, with Settings at the bottom.
- Each icon shows its name in a tooltip.
- The active item gets an orange tint.

**Top: a sticky 56px bar, left group:**
1. The page title, in uppercase.
2. A divider.
3. The **accepting-orders switch**, with an "Auto" chip when automatic scheduling is on.
4. A divider.
5. The restaurant name, with a second line: area · postcode | "Closes at 10:00 PM today" (or "Opens at …").

**Top bar, right group:** Help, the notifications bell with an unread count, and a profile menu (name and email, Profile, Settings, Logout).

**Content:** breadcrumbs and an optional page description, set by each page through `PageContext`, then the page itself with 24px padding.

### Better than today

- **The accepting-orders state and its control are in view on every screen.** Today it lives only on `/hours`.
- **Each page has a title in the chrome, plus breadcrumbs.** Today titles are in-page H1s at 18px.
- **The rail leaves more room for content.** It is 64px instead of 256px, which matters on a 1024px landscape tablet.

### Badly or wrongly done

- **"Closes at" is coloured red while the restaurant is open,** and "Opens at" is green while it is closed. The meaning of the colours is backwards.
- **Open and close times are worked out in the browser** from a single `opening_time`/`closing_time`. The server's `open_state` and `reason` are ignored.
- **The switch is solid `green-500`,** which breaks the green reservation ([solid green is reserved for halal status (invariant 10)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants), enforced by [the no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules)).
- **The unread badge is a solid red dot** with "9+".
- **The rail shows no counts,** so the new-order count is not visible from Menu or Payments.
- **Logout has no confirmation.**
- **The top bar shows no connection state.**

### Recommendation

**Keep the frame, rebuilt in our library.** In `AppShell`:

- **`topBar` → `TopBar` holding:**
  1. The page title.
  2. An open-state `Chip` driven by `open_state`, with `reason` as its tooltip. Tint only, never red.
  3. A `Switch` for `is_accepting_orders`, labelled, and blocked until sound is armed ([order acceptance rules (R-24)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-24--order-acceptance-rejection-and-response-timeout)).
  4. A connection/"live" indicator.
  5. A notifications `IconButton` + `Popover`.
  6. A profile `Popover`.
- **`sideNav` → `SideNav` with `collapsed`** for the tablet board. Give Orders a **badge** showing the count of pending orders.
- **`systemBanner` → `Banner`** for suspension, removal from listings, an expiring certificate and connection loss.
- **`pageHeader` → `Breadcrumbs`** plus the page description.

**Don't copy:** the open-state text worked out in the browser, the colour meanings, or the uppercase title.

---

## 2. Dashboard (`/dashboard`)

**File:** `old:src/app/dashboard/page.tsx`

### What it shows

1. **Row 1:** three KPI cards: Total orders (all time), Orders this month, Revenue this month. Each card has an orange icon tile, a label, and a 24px bold value.
2. **Row 2:** an "Avg order value" card.
3. **Rows 3–4:** five placeholder cards saying **"No data yet"**: Revenue over time (2/3 width), Top categories, Orders overview, Order types, Trending items.

Loading shows skeleton cards shaped like the stat cards. An error shows an inline banner, and the rest of the page still renders.

### Better than today

- **Numbers come before lists.** Today's app has no dashboard and no summary figures at all.
- **An analytics failure doesn't blank the page.** The error banner sits above cards that still render.

### Badly or wrongly done

- **Five of the nine cards are empty placeholders.** That is scaffolding shipped as a screen.
- **Revenue arrives as a string,** is run through `parseFloat`, and is shown as `$` in `en-US`. [Money is integer minor units (invariant 3)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants), so floats are forbidden in money paths.
- **A trend arrow is always green.**
- **It sits in the first nav slot, ahead of Orders,** though Orders is the job.

### Recommendation

**Don't build a KPI dashboard for V1.**
- The contract has **no analytics or summary endpoint**. [The sales dashboard (R-29)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-29--sales-dashboard-and-analytics) is V2.
- Any tiles we could make would be computed in the browser, or empty like the old ones.

**Carry the "numbers first" habit into the screens that have data:**

- **Orders board header:** counts by column (New / Preparing / Ready / Out for delivery), computed from the live list, and `missed_order_count` from `RestaurantAvailability`.
- **Payouts header:** see [payments](#6-payments-payments).

**When [the sales dashboard (R-29)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-29--sales-dashboard-and-analytics) lands,** use `Card` stat tiles with `Price`, and a single `color.viz.*` series per chart. Never green for "up" or red for "down"; use tint and arrow shape instead.

---

## 3. Orders list + detail (`/orders`, `/orders/[id]`)

**Files:**
- `old:src/app/orders/page.tsx` (1,049 lines: the list and detail split, which shipped)
- `old:src/app/orders/[id]/page.tsx` (the full-page detail)
- `old:src/components/orders/*` (the never-mounted board, card and timeline)

### What it shows, in order

**1. Top strip.**
- An "Auto-refresh: 30s" note.
- **Count chips that filter when clicked:** N New (pulsing), N Preparing, N Ready, N Delivering, N Urgent. Each chip is hidden when its count is zero.
- A Refresh button.

**2. Split view, the full height of the viewport.**

**Left pane (384px):**
- Search (by id, customer name or phone) and a status `Select` with 13 options, including "Active" and "In kitchen".
- A strip showing "N orders".
- A scrolling list. Each row shows, top to bottom:
  1. `#` plus the first 8 characters of the UUID, in mono; an urgency dot; a status badge.
  2. The customer name and the **total**.
  3. Time since placed, the item count, and a **live elapsed timer**.
- The row's left border and background tint change with urgency. Urgency is worked out in the browser from `created_at`:
  - New: warning at 2 minutes, critical at 5.
  - Preparing: warning at 15, critical at 25.
  - Ready: warning at 5, critical at 10.

**Right pane (flexible width):**
- With nothing selected: "Select an order".
- When an order is selected, top to bottom:
  1. **Header:** order number, "Urgent"/"Attention" badge, date and time, elapsed timer, status badge. The whole header is tinted by urgency.
  2. **A state-specific action panel, with one sentence and the buttons:**
     - PLACED: "New order waiting for your response", then Accept and Reject side by side.
     - CONFIRMED: Start preparing, or Mark ready.
     - PREPARING: Mark ready for pickup.
     - RIDER_ASSIGNED: "Rider is on the way – finish preparing the order".
  3. **Items:** name, variant, "+ add-ons", "Qty × unit price", a line total, then the order total.
  4. **Customer:** name and a `tel:` link.
  5. **Delivery address:** street, building, floor, apartment.
  6. **Rider:** name, `tel:` link, phase badge ("Coming to pickup" / "Picked up" / "On the way").
  7. **Live tracking map** of the restaurant, the rider and the destination.

**The `/orders/[id]` full page** has the same content in a different arrangement:
- The map across the top.
- Then a 2/3 + 1/3 grid:
  - left: Status card, then Items, then Actions
  - right: Customer, then Address, then Rider

**Never mounted but instructive:**
- `OrderKanbanBoard` has tabs Incoming / In kitchen / Ready / Out for delivery / History, each with a count. It also has a "Live/Offline" dot, a banner saying "Not accepting orders – toggle above", and a banner saying "Real-time updates unavailable".
- `OrderCard` has a coloured left border for its state, a preview of the first two items plus "+N more", and the rider's name with a phone button.
- `OrderEventTimeline` groups events by day. Each event has an icon, a label, the actor (customer, restaurant, rider, admin or system) and a detail such as "Prep time: 20 min" or "3 riders notified".

### Better than today

| Old app | Today |
|---|---|
| **Master–detail:** the list keeps your place, the detail has room for everything | A flat grid of cards, with no detail view |
| **Counts that filter when clicked**, and search, and a status filter | None |
| **One sentence per state** above the action ("Rider is on the way – finish preparing the order") | Buttons with no context |
| **Add-ons**, the **rider** (name, phone, phase), the **customer contact** and the **address** after accept | `addons`, `special_request`, `rider`, `phone_masked`, `delivery_address` and `is_late` are all in the contract but not rendered |
| **Elapsed and urgency shown on every row**, so a stuck order is visible without opening it | None |
| **The never-mounted board's "Offline" and "Not accepting" banners** | These are the audit's missing stale and connection states |
| **The event timeline's actor and detail layout** | A good pattern for `StatusTimeline` |

### Badly or wrongly done (do not copy)

**Money.**
- The line total is computed in the browser: `parseFloat(unit_price) * quantity`.
- The total is a `$` string, parsed with `parseFloat`, shown as USD, and **coloured solid `text-green-600`**.
- **Rule:** display the server's `line_total_cents` and `money.*` through `Price`. Never do arithmetic on money in the browser ([the server prices every order, and money is integer minor units (invariants 1 and 3)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants)).

**Colour.**
- Accept is solid `bg-green-600` (breaks [the no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules)), and Reject is `destructive` red at the same size, right next to it.
- Urgency is shown with red backgrounds and a pulsing red dot.
- "Delivered" is solid green text with a check-mark emoji.

**Deadline.**
- There is **no reject reason** and no confirmation.
- Urgency comes from `created_at` and fixed minute limits, not from `deadline_at` or `promised_ready_at` from the server.
- There is no countdown to the 180-second offer deadline.

**Unsafe behaviour** (in `OrderNotificationDialog`, which was never mounted):
- **Closing the dialog rejects the order.**
- **A timer in the browser auto-rejects the order when it runs out.**
- Both directly break [the order acceptance rules (R-24)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-24--order-acceptance-rejection-and-response-timeout): closing never rejects, and only the server decides expiry.
- The spec also rules out auto-accept, so there must be no automatic action in either direction.

**Privacy and data.**
- The full customer name and raw phone number are shown. The spec says first name, last initial and a masked phone.
- The full address is shown before accept. The spec shows the area only until then.
- The map falls back to Sydney coordinates.

**States that don't match ours.**
- "Start preparing" is a separate step. Our contract has no ACCEPTED state: accept goes straight to PREPARING.
- **The order code is the first 8 characters of a UUID** rather than a human `code`.

**Live updates.**
- The page polls every 30 seconds, even though an SSE connection was open elsewhere in the app. New orders could therefore take up to 30 seconds to appear.
- *The rebuild (Oct 2026):* the queue (`apps/restaurant/src/routes/OrdersPage.tsx`) refetches the moment an order event arrives on the realtime socket, and keeps a 7-second poll underneath for when the socket is down. A ready order's card shows its 4-digit pickup code, large, for the kitchen to read out to the rider ([#659](https://github.com/shaiknoorullah/hg-mono/issues/659)).

### Recommendation

**Use the audit's D1 board, combined with the old master–detail.**

**Board (the main surface).**
- `AppShell` with the `SideNav` collapsed.
- Three columns: **New / Preparing / Ready**, plus an "Out for delivery" strip that can be collapsed. Columns never collapse when empty; each shows `emptyQueueDrained`.
- Each column heading carries its **count**, and those counts also drive the `SideNav` badge.
- Cards are `OrderCard variant="restaurant"`, using its `urgent`, `late` and `stale` props and its countdown and actions slots.

**New-order card, in order:**
1. **The countdown**, the largest element on the card (`display.md`), anchored to the server clock with `measureSkewMs`/`remainingMs`.
2. `code`.
3. First name, last initial.
4. `delivery_area`.
5. `special_instructions`, prominent, in a warning tint.
6. Lines with add-ons.
7. "You earn" `Price`.
8. **Accept**: a 72px primary button at the bottom (`target.criticalField`).
9. **Reject**: a small tertiary button at least 24px away, which opens `ConfirmDialog` with the 7 reason codes. The dialog keeps the countdown visible.

**Detail.** Selecting a card opens the full detail in the **`aside` slot**, which is the old right pane, rather than a separate page. Sections in the old order:
1. Header: `code`, the state, and a timer driven by `deadline_at` or `promised_ready_at`.
2. **Action panel with a one-line explanation of the state** (keep that idea). Actions: Accept (with `prep_eta_minutes` ±15), Mark ready, Delay (+5/10/15/20 with a reason), Seal binding.
3. Items: every line with its variant, add-ons (`addon_quantity`, `addon_price_cents`), `special_request` and `line_total_cents`, all through `Price`.
4. The `money` breakdown: subtotal, discount, commission, **net**.
5. Customer: `display_name` and `phone_masked`.
6. Address: only after accept, with `delivery_instructions`.
7. Rider: `display_name`, `vehicle_type`, `eta_at`. No map in V1: the contract only carries coarse `rider.location`, and the library has no map component.

**Status timeline.** Use `StatusTimeline` with `buildOrderTimelineSteps`, built from the timestamps the contract provides (`placed_at`, `accepted_at`, `ready_at`). The contract has no events array.

**History tab.** A **LyteNyte Grid** (#141) fed by `GET /v1/restaurant/orders` with terminal `state[]` values:

| Column | Cell type |
|---|---|
| Code | Mono text |
| Placed | Relative and absolute time |
| State | **Status chip**, using `ORDER_STATE_LABELS`, tint only |
| Items | **Counter** |
| Net | Money (`Price`, tabular figures) |
| Prep | **Inline bar**: time actually taken (from `accepted_at` to `ready_at`) against the promised time. The overrun is shown in the warning tint, never red. |
| Late | Flag chip |

- No sparklines here: there is no time series.
- The old "search by name or phone" needs the contract widened first. Today it filters by state only.

**Page states.**
- Loading: a `Skeleton` in the shape of the board. The old app's page-shaped skeletons are the right idea.
- Stale: a `Banner` when the realtime connection drops, with the old wording "Real-time updates unavailable".
- Error: `ErrorState`.

---

## 4. Menus, items, add-ons, categories

**Files:**
- `old:src/app/menus/page.tsx`, `menus/[menuId]/page.tsx`, `menus/new/page.tsx`, `menus/addons/page.tsx`, `menus/[menuId]/items/*`
- `old:src/components/MenuStatsCards.tsx`, `MenuItemsToolbar.tsx`, `MenuItemListRow.tsx`, `MenuItemCard.tsx`, `MenuItemForm.tsx` (1,618 lines)
- `old:src/app/categories/page.tsx`

### What it shows

**Menus list.**
1. A segmented control, **Menus | Add-ons**, and a primary "Create menu" button.
2. **Four stat cards:** Total menus, Active menus, Total items, Revenue (30d).
3. Search, and a status `Select` (All / Active / Inactive).
4. A table:

   | Column | Content |
   |---|---|
   | Checkbox | Selection |
   | Name | Name + description |
   | Status | Switch + Active badge |
   | Availability | Schedule, e.g. "11:00 AM – 3:00 PM" / "No schedule" |
   | Items | Count badge |
   | Created | Date |
   | Actions | ⋯ menu |

   The sortable columns are Name, Status, Items and Created. Clicking a row opens it.
5. A footer: "Showing N of M menus (K selected)".

**Menu detail.**
1. **Header card:**
   - The name, **editable in place** (a pencil appears on hover; Enter saves, Escape cancels).
   - An Active badge and an Activate/Deactivate button.
   - A description, also editable in place.
   - The schedule line.
2. **Toolbar:**
   - Search, a Filters button (with a count), and "N items".
   - A **view switch (list / grid)** and a card-size menu for grid view.
   - A primary "Add item" button.
   - The filter row opens underneath: category, and "Clear filters".
3. **Items grouped by category,** under headings that fold, each with a count.
   - **List row**, left to right:
     1. An expand chevron.
     2. A 48px thumbnail.
     3. The name, a Veg/Non-Veg badge, a warning chip "N allergens", and the description.
     4. Category and cuisine chips.
     5. "N variants" and "N add-ons".
     6. The price, with a struck-through old price.
     7. **An availability switch.**
     8. A ⋯ menu: Edit, Add variant, Link add-on, Delete.
   - **Expanding the row** shows each variant (name, Default, Available, price) and each linked add-on (+price), with "Add variant" and "Link add-on" links inline.
   - **Grid card:** an image with badges on it, hover actions, and allergens/ingredients in tooltips.

**Item form.**
- A **4-step wizard**: Basic info → Details (dietary, availability, ingredients, allergens) → Variants → Add-ons.
- A new item gets only the first two steps. After creation, **a screen asks "Add variants" or "Link add-ons"** as two large choice tiles, with "Done – back to menu".

**Add-ons.**
- A reusable add-on library.
- A table: thumbnail + name, description, price, image count, edit/delete.
- "Load more" pages by cursor.
- Create and edit in a **side sheet**.

**Categories.** Cards derived from the first menu's items, with counts. Add, edit and delete are disabled with a tooltip: "Backend endpoint not yet available".

### Better than today

| Old app | Today |
|---|---|
| **Variants and add-ons visible inside the row**, expanding in place without opening an editor | "N variant groups" chip only |
| **Thumbnail, allergen count and variant/add-on counts** visible in the row | Only a row of 11px chips |
| **Search, filters and a result count** | No search |
| **Editing in a side sheet** for add-ons, so the list stays in view | A centred modal |
| **Next-step prompt after creation**: add variants, link add-ons | Save and done |
| **Editing name and description in place** | A modal for everything |
| **Empty states that say whether a filter caused them**: "No menus match your filters – Try adjusting…" versus "No menus yet – Create your first menu" | One empty state |
| **Selection count in the table footer** | Nothing |

### Badly or wrongly done

**It doesn't match our model.**
- **Multiple menus with schedules.** Our spec has one menu per restaurant with up to 40 categories.
- **A struck-through "Original price".** That is discount/offer behaviour ([special offers and discounts (R-21)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-21--special-offers-discounts-and-combos), V2), and a misleading-price risk.

**It makes halal-adjacent claims with nothing behind them.**
- A **Veg / Non-Veg badge in red and green** on every item.
- On a halal platform, a red badge on a meat item reads as a ruling.
- There is no halal field, no dietary-tag review, and no review state at all. Every edit goes live at once.

**There is no review workflow.**
- Nothing like `pending_version`, rejection reasons, "Live immediately" versus "Reviewed" fields, or explicit allergen acknowledgement.

**Money.**
- Prices are strings run through `parseFloat(...).toFixed(2)` with a `$`.
- Add-on prices are shown in a **green badge**.

**Wording and colour.**
- "Revenue (30d)" is actually this calendar month's figure.
- Delete uses red text and a red confirmation button.

**Categories.**
- A category page whose every action is disabled.
- Categories are derived from item names, not real category records.

**The wizard puts variants after creation.** An item can therefore go live without its sizes.

### Recommendation

**Layout.**
- A **category rail** on the left. Today it is a fixed 190px button list. Make it a `Tabs` or `SideNav`-style list with **counts**, drawn from `MenuCategory.item_count`.
- An **item grid** on the right.
- A **side-sheet editor** in the `aside` slot.

**Toolbar:** `FilterBar` with search, availability state and review state; the result count; and a primary "Add item" `Button`.

**Items: a LyteNyte Grid (#141).**

| Column | Cell type |
|---|---|
| Item | Rich cell: thumbnail from `image_url` (placeholder if missing) + name + one line of description |
| Availability | **Inline `Switch` cell** that saves instantly. Its menu offers auto-restock: 1 hour / end of service / indefinitely (`out_of_stock_until`). It is disabled for BLOCKED and HIDDEN items, and the reason is shown in a `Tooltip`. |
| Price | Money cell, `Price` with tabular figures |
| Review | **Status chip**: Live / Pending review / Rejected, from `live_version`/`pending_version` |
| Variants | **Counter** |
| Add-ons | **Counter** |
| Allergens | **Counter**, warning tint; the list in a tooltip |
| Prep | Minutes |

- **Rows expand** to show variant groups and add-on groups with their prices, which is the old app's best idea.
- Multi-select enables **bulk "Mark out of stock"** ([item availability rules (R-18)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-18--item-availability-and-out-of-stock-management) allow up to 200). The contract has no bulk endpoint, so either loop the single endpoint or add one.
- No bars or sparklines here: there is no sales data per item.

**Editor in the `aside`.** Replace the wizard with **two labelled groups**:
- **"Live immediately":** price, availability, category, sort order, prep minutes.
- **"Customers see these only after review":** name, description, ingredients, dietary tags, allergens (with an explicit "none" acknowledgement) and image. It ends with an explicit **Submit for approval**.
- If a `pending_version` or `REJECTED` version exists, a `Banner` at the top shows `rejection_reason_code` and `review_note` word for word, with a comparison against the live version.
- `HALAL_CERTIFIED` is never offered as a choice. **Halal is the restaurant's certificate, not a per-item tag.**
- Keep the old next-step prompt after creating an item, but only for what the contract supports. Variant and add-on writes don't exist yet ([variants and modifier groups (R-20)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-20--variants-and-modifier-groups) are V2).

**Add-ons.** Wait for [variants and modifier groups (R-20)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-20--variants-and-modifier-groups) and the contract. When they land, reuse the old reusable-library pattern: a LyteNyte grid plus a side-sheet editor.

**Categories.** They live in the rail rather than on their own page. The contract has create only, so rename, reorder and delete need contract work first.

**Empty states.** Use `emptyAfterFilter` and `emptyNoRecords` separately, as the old app did.

---

## 5. Disputes (`/disputes`)

**File:** `old:src/app/disputes/page.tsx`, which renders `Upcoming`: a flag icon, "Upcoming… Hold on tight, we are working on it" and "Back home".

**Better than today:** nothing.

**Badly done:** a placeholder page with a route.

**Recommendation.** Leave it out of the nav.
- [Escalations and disputes (R-33)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-33--escalations-and-disputes) are V2.
- The contract has no restaurant ticket or refund endpoints.
- When they land, design them as a thread using the notification-list pattern (see [notifications stream](#11-notifications-stream)) plus a `StatusTimeline`. Money must move only through ledger adjustments; never offer a "refund" button.

---

## 6. Payments (`/payments`)

**Files:** `old:src/app/payments/page.tsx`, `old:src/components/payments/*`, `old:src/lib/utils/settlements.ts`

### What it shows, in order

**1. Three summary cards:**
- **Total earnings**, with "↑ 4.2% vs last period".
- **Pending**, "Awaiting transfer".
- **Next payout**: the date plus "in 3 days".

**2. A card containing tabs** — Overview / History / **Pending (with a count badge)** — and a Refresh button.

- **Overview**, two columns:
  - **Earnings breakdown:** one row per type (Order earnings / Delivery fee / Tip) with its amount and a **proportion bar**, then Platform fees (−), then Net total.
  - **Settlement status:** Completed / Scheduled / Pending / Failed, each with a coloured dot, a count and an amount.
- **History:**
  - Filters: status, type, date range.
  - A table: Date, Order (link), Type, Gross, Fees, Net, Status.
  - **On a phone the table becomes a list of cards.**
  - Pagination.
- **Pending:** a summary (total pending, total scheduled, next batch), then grouped rows (scheduled / processing / pending), each linking to its order.

**3. Settlement detail sheet:**
- Status.
- Order link, type, created date.
- Gross, **platform fee (with %)**, net.
- Transfer details: Stripe transfer id, transferred at, scheduled for, batch id.
- **A "Transfer failed" block with the failure reason and retry count.**
- A "View order" button.

**4. States:** an `ErrorState` card with "Try again", skeletons for each tab, and an empty state for Pending.

### Better than today

- **What the owner cares about comes first:** earnings, pending money and the next payout date. Today's page opens on a bare table with no totals and no next payout.
- **Drill-down from a payout to the orders behind it,** and from a line to the order.
- **Failure is explained where it happened:** the reason plus the retry count.
- **The table becomes cards on a phone.**
- **A count badge on the Pending tab.**

### Badly or wrongly done

- **Currency and colour.**
  - Amounts are formatted as **USD** (`en-US`, `USD`); our market is CAD.
  - Fees are in red, net in solid green, the breakdown bars are solid `green-500`, and the trend is green or red.
- **Money worked out in the browser.**
  - The fee percentage is computed in the browser (`platform_fee / gross * 100`). Commission is already `commission_rate_bps` on the profile.
  - "Pending" adds pending and scheduled together in the browser.
- **Settlement types that don't exist for us.** Settlements per order with a "Delivery fee" type: in our model the restaurant does not earn delivery fees.
- **Raw internals shown to owners:** Stripe transfer and batch IDs.

### Recommendation

**Numbers first,** limited to what the contract carries.

**Header strip:**
- **Next payout**: "Monday", from the [weekly Monday payout cadence (S-04)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--client-decisions), plus the amount of the newest payout that is not yet `PAID`.
- **Last paid**: amount and date.
- **Held or failed**: a count, using `Banner` when greater than zero.

Each is a `Card` with `Price`, and each blank shows "—" rather than an invented figure.

**Payouts table: LyteNyte Grid (#141).**

| Column | Cell type |
|---|---|
| Period | `period_start`–`period_end` |
| Orders | **Counter** from `entry_count` |
| Amount | Money cell plus an **inline bar** scaled to the largest amount on the loaded page (tint, not green) |
| Status | **Status chip**. PAID is a success *tint*; FAILED and HELD are warning or danger tints with `hold_reason`/`failure_message` in the cell. |
| Paid | Date |

- A **sparkline of `amount_cents` over the loaded periods** in the header is honest: it uses real payout data, not invented analytics.
- **Pagination** by cursor.

**Row detail** in the `aside`: the old detail-sheet layout of status, amounts and the failure block, without the Stripe IDs.

**Contract gap.** The per-order earnings breakdown and the pending/available balance need the ledger endpoint of [earnings ledger and statements (R-31)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-31--earnings-ledger-statements-and-payment-history), which doesn't exist yet. Record it as a contract item. Don't compute it in the browser.

---

## 7. Onboarding, including Stripe, pending approval and rejected

**Files:**
- `old:src/app/onboarding/page.tsx` (1,306 lines)
- `onboarding/pending-approval/page.tsx`, `onboarding/rejected/page.tsx`, `onboarding/stripe/complete/page.tsx`, `onboarding/stripe/refresh/page.tsx`
- `old:src/components/LocationPicker.tsx`, `old:src/store/onboarding-store.ts`

### What it shows

**A three-step indicator:** Profile → Documents → Payment. The server's `onboarding_steps_pending` decides where it resumes.

**A "Documents under review" banner** that stays visible above every step: "You can continue setting up Stripe in the meantime".

**1. Profile.**
- Owner name, phone, description (minimum 20 characters), operating hours, address.
- A **map location picker** (Leaflet, in a modal).

**2. Documents.**
- Four upload tiles: business licence, **halal certificate**, food safety, owner ID.
- Each tile is a dashed drop area ("PDF, PNG, JPG up to 10MB"). Once uploaded it becomes a **thumbnail preview + file name + "Uploaded successfully" + remove**, with a spinner per tile while uploading.

**3. Payment.**
- A review-status card with "Refresh status".
- A "Connect Stripe account" card. Once connected it reads "Charges enabled: Yes/No, Payouts enabled: Yes/No".
- **"Onboarding progress" checklist:** email verified, profile set up, documents submitted, documents approved or under review, Stripe connected or pending.
- A progress bar with "N% complete".

**Pending approval.**
- A large clock icon, "Documents under review… 24–48 hours".
- **Polls every 10 seconds**, advances automatically to the dashboard or back to step 3, and offers a manual check.

**Rejected.**
- A centred card: the icon, "Application rejected", the rejection date.
- A **reason block**.
- **"What you can do"**: review the reason, prepare documents, resubmit.
- Buttons: Resubmit documents, Contact support, Sign out.

**Stripe complete / refresh.**
- A status table: details submitted, charges, payouts.
- Redirects automatically once charges are enabled.

### Better than today

- **A checklist of what is done and what is left.** Today `steps_completed` is never rendered, and the client computes a misleading "Step N of 5".
- **The Stripe step can run while documents are in review.** Today's steps are strictly one after another.
- **The location is picked on a map.** Today latitude and longitude are hard-coded to Toronto.
- **Each document tile shows a preview and its file name** after upload.
- **The rejected page gives next steps and a resubmit action.** Today "Go to documents" only reloads the page.
- **Status polling moves the owner on automatically** when approved.

### Badly or wrongly done

**The checklist lies.**
- The first three ticks ("Email verified", "Profile setup", "Documents submitted") are **always shown as done**.
- The progress bar falls back to **70%** when the value is missing.

**It is unfinished.**
- A **debug panel** renders in development builds.
- "24–48 hours" has no source.

**Colour.**
- Stripe "No" is shown in red, and a solid green check marks success.
- The rejected page uses a red `XCircle` icon and a red reason block.
- Emoji (a party popper).

**The halal certificate is just a file upload.**
- It captures no issuer, number or expiry.
- No halal-state badge.

**It doesn't use the server's own wording** for why onboarding is stuck, and has no withdraw option.

### Recommendation

**Layout.** A single column (`max-w` ~720px) outside the main shell:
1. **`StatusTimeline`**, driven by the six `steps_completed` booleans. The old checklist, made honest.
2. `blocking_reason` as a `Banner`.
3. The current step's body.

**Keep "review runs in parallel":** PAYOUT can proceed while the step is AWAITING_REVIEW, if the server's `current_step` allows it.

**Documents.** One `Card` row per `doc_type`:
- The state `Chip`, from `KycDocument.state`.
- A `DocumentViewer` thumbnail.
- The issuer, `valid_until` and version.
- Upload/Replace, with byte progress.
- The **halal certificate row shows `HalalBadge` UNVERIFIED** (dashed and neutral) until it is approved. Never green before approval, never red after rejection.

**FIX_DOCUMENTS** gets the old rejected page's structure:
- The rejection summary: `rejection.reason_code` and `note`, word for word.
- **Each rejected document listed with its own `rejection_reason_code` and a button that goes straight to that document.**
- A "What to do next" list.
- Contact support.

Use a warning tint, not red.

**Payout.** A `Card` driven by `ConnectStatus`:
- Charges, payouts, `details_submitted` and `bank_last4`.
- `requirements.currently_due` rendered as a list in our own words.
- Pending items show a neutral "Pending" chip, never red "No".

Open the onboarding link in the same tab, and handle the return to this page.

**Location picker.** It is worth having, but the library has no map component, and the constitution forbids new primitives. **Raise it as an explicit gap.** Until it is resolved, use address geocoding with a confirmation step instead of hard-coded coordinates.

---

## 8. Settings and profile

**Files:** `old:src/app/settings/page.tsx`, `old:src/app/settings/profile/page.tsx`

### What it shows

**Settings** (max-width 4xl, stacked cards):
1. **Business hours:** one open time, one close time, timezone, and "Save hours".
2. **Order settings:** the Accept-orders switch, plus **Automatic scheduling** ("Automatically start/stop accepting orders based on business hours").
3. **Notification preferences:** Email, Push and "Order alerts (sound)" switches.

**Profile:**
1. **Restaurant information card**, read-only by default: an **Edit** button changes it to Cancel/Save. Fields: name, email (read-only), description, address.
2. **Owner information card**, with the same pattern: name and phone.
3. **Account actions:** change password, logout.
4. **Account strip** of four figures: total orders, **"Halal certified: Yes/No"**, onboarding %, member since.

### Better than today

- **Cards are read-only until you press Edit.** That cuts accidental edits; today's app is one long 16-field form.
- **Settings are grouped into small titled cards** with a line of help text for each switch.
- **There is a summary strip.**

### Badly or wrongly done

- **The notification switches are fake.** They use `defaultChecked`, have no handler, and save nothing.
- **Business hours allow a single interval,** with no per-day hours, overnight intervals or closures.
- **"Halal certified: Yes/No"** is a bare boolean.
  - A missing field renders "No", a claim made from missing data.
  - There is no certifier, no expiry and no state.
  - This is the old app's only halal statement, and it is the weakest part of the product.

### Recommendation

**Put `HalalCertificationPanel` full width at the top of Settings**, as the audit recommends:
- The four states from `halal.display_state`, with the certifier and the expiry.
- The expiry reminders (30/14/3 days) as a `Banner`.
- **An expired certificate is slate, never red.** Its copy explains suspension and the path to "Upload renewed certificate".

**Keep the old read-then-edit cards** (Business profile, Owner, Tax/GST-HST, Delivery and prep), each with its own Edit/Save and field-level server errors.

**Remove notification switches that do nothing.** The spec says `ORDER_NEW` cannot be turned off, and the contract has no preferences endpoint.

**Automatic scheduling** is covered by our `open_state` model: CLOSED_HOURS happens automatically. Say that in the Hours copy instead of offering a switch.

**Staff moves under Settings,** as the audit says, and uses the contract's `listRestaurantStaff`/`createRestaurantStaffUser` in a LyteNyte grid:

| Column | Cell type |
|---|---|
| Name + email | Text |
| Role | Chip |
| Status | Status chip |
| Last login | Relative time |

---

## 9. Account suspended (`/account-suspended`)

**File:** `old:src/app/account-suspended/page.tsx`

### What it shows

A centred card, outside the shell:
- A red shield icon.
- "Account (permanently) suspended".
- Temporary and permanent versions.
- A reason block.
- Appeal copy (temporary only).
- Buttons: Contact support, Sign out.

### Better than today

It exists. Today there is only an 11px account-state chip in Settings.

### Badly or wrongly done

- **It is a dead end that locks the owner out.** [Account status and suspension (R-36)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-36--account-status-suspension-reinstatement-and-in-flight-orders) says a suspended restaurant keeps **read access**: accepted orders complete, payouts pause, and history stays visible.
- **It is red.**
- **It never says what happens to in-flight orders and payouts.**

### Recommendation

**Not a separate page. Keep the shell and put a `Banner` with prominent emphasis in `systemBanner`,** saying:
- the cause
- what still works (in-flight orders finish, history can be read)
- what is paused (new offers, payouts)
- the next step

Actions that would change anything are disabled, with the reason in a `Tooltip`.

**If the cause is an expired halal certificate,** use the slate halal-expired treatment with "Upload renewed certificate" as the primary action.

**Only BANNED or CLOSED** get a full-page `ErrorState`-style card, with neutral tone, Contact support and Sign out.

---

## 10. Login, signup and verify-email

**Files:** `old:src/app/login/page.tsx`, `signup/page.tsx`, `verify-email/page.tsx`

### What it shows

- **A split screen.**
  - Left half: a stock Unsplash photo labelled "Restaurant dashboard illustration".
  - Right half: the form.
- **Login:** email, password (show/hide), a general error, a link to sign up.
- **Signup:**
  - Business name, email, password with its rules stated, confirm password.
  - A terms checkbox whose links go to `href="#"`.
  - After submit: a **"Check your email" success screen** with a link to log in.
- **Verify-email:**
  - Reads the token and verifies it automatically.
  - Three designed states: verifying, success (redirecting), error (links to sign up and log in).

### Better than today

- **The verification states and the post-signup confirmation are designed screens.**
- **The password rules are stated up front.**

### Badly or wrongly done

- **Half of a tablet screen goes to a stock photo.**
- **The terms links are dead.**
- **There is no forgot-password flow and no MFA.**

### Recommendation

- **Keep today's centred `Card`,** which is right for a tablet.
- Add from the old app:
  - the three verify-email states
  - the stated password rules
- Add from the contract, which the old app lacked:
  - forgot password (`requestPasswordReset`)
  - the TOTP step, with a proper error for a 403 that isn't about MFA
  - terms shown in a `Popover` or on their own page before the checkbox

---

## 11. Notifications stream

**Files:**
- `old:src/components/NotificationPanel.tsx`
- `old:src/hooks/useNotifications.ts`
- `old:src/app/api/notifications/stream/route.ts`
- `old:src/store/notification-store.ts`
- `old:docs/notifications.md`

### What it shows

**A bell `Popover` (384px) in the status bar:**
1. Header: "Notifications", an unread-count pill, "Mark all read".
2. A list **grouped Today / Yesterday / Earlier**. Each item has a category icon in a tinted circle, a title, a body, relative time and an unread state.
3. Footer: "View all notifications". This goes to `/notifications`, **a route that does not exist**.

**Transport.** Server-sent events (SSE):
- **resumes where it left off after a reconnect** (`Last-Event-ID`)
- **exponential backoff**, up to 10 attempts
- a connection state in the store
- a proxy route

Only `restaurant.order.new` becomes a notification; other events are filtered out as "UI events".

**Documentation.** `old:docs/notifications.md` catalogues every notification: its type, category, priority, data fields and an example payload. That is good practice.

### Better than today

Today's app has **no notifications UI at all**, even though the contract has `listNotifications`/`markNotificationRead`.

### Badly or wrongly done

- **The realtime connection feeds only the bell.** The orders list still polls every 30 seconds.
- **No sound.**
- **"View all" links to a page that doesn't exist.**
- **The unread count is solid red, and PAYMENT notifications are green.**

### Recommendation

**Keep the popover's layout** (date groups, category icon, unread state, mark-all-read) in a `TopBar` `IconButton` + `Popover`. Use the contract's `Notification`:

| Field | Use |
|---|---|
| `priority` | CRITICAL also raises a `systemBanner` `Banner` |
| `deep_link` | Where clicking goes |
| `kind` | Icon |
| `read_at` | Unread state |

**Build the full list page,** or leave the "View all" link out.

**One realtime connection** (`restaurant:{id}` over our WebSocket) drives the board, the badge and the bell. Keep the old reconnect design: resume on reconnect and back off exponentially. The stream carries `order_offered`, `order_offer_expired` and `status_changed`.

**`useOrderAlert`** provides the repeating sound and the flashing tab title.

---

## 12. Changelog and "What's new" (relevant to #101)

**Files:**
- `old:CHANGELOG.md`, `old:.release-it.mjs`, `old:scripts/generate-changelog-json.mjs`
- `old:public/changelog/index.json`
- `old:src/lib/changelog/*`, `old:src/hooks/useWhatsNew.ts`, `old:src/components/WhatsNewPanel.tsx`

### What it does

**Pipeline:**
1. `release-it` with conventional commits, **filtered to restaurant-scoped commits**, maps commit types to sections:
   - `feat` → Features
   - `fix` → Bug Fixes
   - `perf` → Performance
   - `refactor` → Improvements
   - `docs`, `chore`, `test`, `ci` and `build` are hidden
2. That produces `CHANGELOG.md`.
3. A script turns `CHANGELOG.md` into `public/changelog/index.json` plus one JSON file per release. Types are `ChangelogRelease {version, date, sections[{title, items[{scope, description}]}]}`.

**App side:**
- `useWhatsNew` stores `halalgoes-last-seen-version` in `localStorage`.
- It loads the index and the latest release, and sets `hasNewReleases` when the latest version differs from the last one seen.
- **`WhatsNewPanel`** is a `Popover`:
  - header "What's New" with a `vX (commit)` chip
  - each section is a chip with an icon and an item count, followed by bullet items with the scope in bold
  - relative date
  - empty and loading states
  - "View all releases →"
- **Opening the panel marks the release as seen.**

### Worth reusing for #101

- **Split the release notes into one JSON file per release, with an index.** The app fetches only what it needs, and #97 can produce the same shape.
- **Sections by kind, with counts.** An owner can skim "3 new features, 2 fixes".
- **A "last seen" marker**, and opening the panel marks it as seen.
- **Empty and loading states** are already designed.

### Badly or wrongly done (all of it must be fixed, not copied)

1. **The panel is never mounted.** Owners never saw it.
2. **The pipeline is broken.**
   - The generator expects `## [x.y.z]` headings, but `CHANGELOG.md` has `## 11.0.0 (date)`.
   - So `index.json` is `{"latest": null, "releases": []}`, and the panel would always say "No updates yet".
3. **It shows only the latest release, not everything since the last one seen.** #101 needs every release since then.
4. **The notes are commit subjects.** For example "fix(restaurant-web/auth): persist access_token in sessionStorage for preview" means nothing to a restaurant owner.
5. **Every release is a major version bump** (4.0.0 → 11.0.0 in two weeks).
6. **"Bug Fixes" is coloured red,** and "View all releases" links to a GitHub repo owners cannot open.

### Recommendation for #101

**Data.**
- Keep the index-plus-one-file-per-release shape from #97.
- Add a **plain-language `summary` per item** written for owners, and keep commit text out of the app.
- Show **every release newer than the last-seen version**, newest first.

**When the notes appear.**
- Open them once, and only when no task is in progress: never over the orders board while an offer is pending.
- Use the `aside` panel or a `Popover` from a `TopBar` "What's new" `IconButton` with an unread dot (tint, not red).

**Where they live permanently.** A "What's new" entry under Settings, rendered as a `StatusTimeline`-style list of versions with section `Chip`s (neutral or info tones) and item counts.

**Storage.** The last-seen version is stored per device, wrapped in try/catch. All states: empty, loading, error.

---

## 13. Patterns worth reusing on every screen

| # | Pattern | Where in the old app | In our system |
|---|---|---|---|
| 1 | **A persistent frame showing status** (title, open state, accept switch, bell, profile) | `StatusBar.tsx` | `AppShell` `topBar` → `TopBar`, plus the `systemBanner` `Banner` |
| 2 | **Master–detail**: the list stays, the detail opens beside it | `orders/page.tsx`, add-on and settlement sheets | The `AppShell` `aside` slot |
| 3 | **Summary, then filters, then list, then drill-down** | payments, menus | `Card` + `Price` header, `FilterBar`, LyteNyte grid, `aside` |
| 4 | **Count chips that also filter** | orders top strip | `Chip` with counts; the `SideNav` badge for Orders |
| 5 | **One sentence explaining the state above its action** | order action panels | Copy slot above the action in the `aside` and on `OrderCard` |
| 6 | **Rows that expand to show children** (variants, add-ons) | `MenuItemListRow.tsx` | LyteNyte expandable rows |
| 7 | **Skeletons shaped like the page** | `OrdersPageSkeleton`, `MenusPageSkeleton`, `AddonsPageSkeleton`, `MenuDetailSkeleton` | `Skeleton` compositions per page; never a centred spinner in place of a table (`03-patterns.md`) |
| 8 | **Empty states that know whether a filter caused them** | menus and add-ons tables | `emptyAfterFilter` / `emptyNoRecords` / `emptyQueueDrained` |
| 9 | **Footer count: "Showing N of M (K selected)"** | menus | Grid footer |
| 10 | **Read-only cards with explicit Edit/Save/Cancel** | profile | `Card` + `Button`s, and a guard against leaving with unsaved changes |
| 11 | **Next-step prompt after creating something** | item form | Composition of `Card` + `Button`s |
| 12 | **Realtime that resumes and backs off on reconnect** | `useNotifications.ts` | One WebSocket client for board, badge and bell |
| 13 | **Page-level errors that leave the rest of the page usable** | dashboard, payments | `ErrorState` per panel, not per page |
| 14 | **Timelines with who did what** | `OrderEventTimeline.tsx` | `StatusTimeline` (actor in the secondary line) |
| 15 | **A catalogue of notification types**, documented | `old:docs/notifications.md` | Keep a restaurant notification catalogue next to `contracts/` |

---

## 14. Everything the old app does that our rules forbid (checklist for artboard review)

| Old behaviour | Rule broken | Where |
|---|---|---|
| Line totals computed in the browser (`parseFloat(unit_price) × qty`) and money handled as floats | [Server prices every order; money is integer minor units (invariants 1 and 3)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) | orders pages |
| USD formatting | Market is CAD | settlements utilities |
| Fee % and pending totals computed in the browser | [Server prices every order; money is integer minor units (invariants 1 and 3)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) | payments |
| Solid green Accept, solid green switch, green totals, green bars | [Solid green is halal-only (invariant 10)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) / [no green solids (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules) | orders, status bar, payments |
| Red urgency, red counters, red "Non-Veg" | "Never red for a halal state"; red "Non-Veg" also reads as a halal ruling | orders, menu |
| "Halal certified: Yes/No" where a missing field reads as "No" | [A missing halal field renders no badge (invariant 8)](https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants) | profile |
| No halal state, certifier or expiry anywhere in the operating app | The product's one claim | whole app |
| Closing the dialog rejects the order; the browser timer auto-rejects | [Order acceptance rules (R-24)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-24--order-acceptance-rejection-and-response-timeout): closing never rejects; the server decides expiry | `OrderNotificationDialog.tsx` |
| Reject with no reason and no confirmation | [Order acceptance rules (R-24)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-24--order-acceptance-rejection-and-response-timeout): reason codes required | orders |
| Full name, raw phone and address before accept | [Live order dashboard (R-23)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-23--live-order-dashboard) privacy rules | orders |
| Menu edits go live instantly, and there is no allergen acknowledgement | [Menu item authoring (R-15)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-15--menu-item-authoring) and [menu change approval (R-17)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-17--menu-change-approval-workflow-admin) review | menu form |
| Onboarding ticks always shown as done, and a 70% fallback | Claims must trace to data | onboarding |
| Notification switches that save nothing | Screens must be real | settings |
| A suspended account is a dead-end page | [Account status and suspension (R-36)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-36--account-status-suspension-reinstatement-and-in-flight-orders): read access continues | account-suspended |
| Placeholder pages ("Upcoming", disabled categories, "No data yet" charts) | Every screen must work | disputes, categories, dashboard |

---

## 15. Contract and library gaps this brief surfaces

These must be decided before the artboards, not worked around in the client.

- **No restaurant analytics or summary endpoint.** It blocks dashboard tiles and any sparklines other than the payout amounts.
- **No ledger or balance endpoint ([earnings ledger and statements (R-31)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-31--earnings-ledger-statements-and-payment-history)).** It blocks the old per-order earnings breakdown and "pending balance".
- **Order history has no text or date filters and no export ([order history, search and export (R-27)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/03-restaurant.md#r-27--order-history-search-and-export)).**
- **Menu writes are missing:**
  - category update, reorder and delete
  - bulk availability
  - variant and add-on writes
  - explicit submit and withdraw of a version
- **No map component in `@hg/ui-web`,** needed for the onboarding location picker and any rider map.
- **LyteNyte Grid cell components (#141):** a status chip, counter, money, inline bar, sparkline, switch and thumbnail+name cell. Each needs its colours checked against [the no-green-solids lint rule (L-4)](https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules) and the halal-state rules.
