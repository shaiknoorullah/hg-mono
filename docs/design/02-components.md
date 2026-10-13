---
covers:
  - packages/ui-web/src/primitives/**
  - packages/ui-web/src/certification/**
  - packages/ui-web/src/content/**
  - packages/ui-web/src/data/**
  - packages/ui-web/src/feedback/**
  - packages/ui-web/src/navigation/**
  - packages/ui-native/src/primitives/**
  - packages/ui-native/src/certification/**
  - packages/ui-native/src/content/**
  - packages/ui-native/src/feedback/**
  - packages/ui-native/src/navigation/**
reviewed: 2026-10-10
---

# HalalGoes — Component Inventory

**Status:** system of record · **Date:** 2026-08-10
**Depends on:** [`01-foundations.md`](./01-foundations.md), [`tokens.json`](./tokens.json)
**Read with:** [`03-patterns.md`](./03-patterns.md) (where these get composed), [`04-accessibility.md`](./04-accessibility.md) (the rules every entry below defers to)

**41 components** in five tiers. No implementation code — this is what four app agents build against.

### The redesign surface on native: `@hg/ui-native/ds` and `/proposed`

Redesigned customer and rider screens (behind `EXPO_PUBLIC_HG_REDESIGN`) import only from:

- **`@hg/ui-native/ds`**: the live design system's components, with the names and props of its `index.d.ts` ([Claude Design](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv)). Today each entry adapts those props onto the legacy component below; the rebuild on React Native Reusables ([#111](https://github.com/shaiknoorullah/hg-mono/issues/111)) swaps the internals without changing the API. Native differs from the web `.d.ts` in four ways: `style` is a `StyleProp`, `onChange` receives the value, money is the branded `Cents`, and labels are strings. `Icon` also takes the live extension names (`chevron-down`, `chevron-right`, `minus`, `lock`, `info`, `warning`, `error`, `more`, `refresh`); an unknown name renders nothing and reports `ICON_NAME_UNKNOWN`. A non-integer `Price` renders nothing and reports `MONEY_NOT_INTEGER_CENTS`.
- **`@hg/ui-native/proposed`**: composites drawn on the approved canvases but not yet approved as components ([#191](https://github.com/shaiknoorullah/hg-mono/issues/191)–[#198](https://github.com/shaiknoorullah/hg-mono/issues/198)). Owner decision, 9 Oct 2026: allowed on `main` for flagged screens only.

The package root stays what the released apps use until the post-launch cut-over.

---

## 0. Rules that bind every component

These are stated once. No entry below re-litigates them.

1. **States are a closed set.** Every interactive component implements exactly: `default`, `hover` (pointer surfaces only), `pressed`, `focus-visible`, `disabled`, `loading`. A component that cannot be in a state omits it explicitly; it does not silently lack it.
2. **`focus-visible`, never `focus`.** Keyboard/AT focus draws the ring. Pointer focus does not. RN: `onFocus` from the accessibility layer only.
3. **One focus indicator, in the theme's focus colour** (`theme.*.focus.ring` = `border.brand`; [decision](../decisions/focus-indicator.md)). **Bordered fields** (`Input`, `Textarea`, `Select`) show focus with **their own border**: 2px `theme.*.focus.ring`, nothing else — no ring, no glow; an invalid field keeps its 2px danger border and takes the ring below instead. **Borderless controls** (buttons, links, cards, chips) take the **two-layer ring** (foundations §2.4): 2px offset in the container colour + 3px ring in `theme.*.focus.ring`, flipping to `focus.onColor` on any container where the ring falls below 3:1. Never `outline: none` without a replacement.
4. **`loading` is not `disabled`.** A loading control keeps its accessible name, sets `aria-busy` / `accessibilityState={{busy:true}}`, and blocks re-entry by ignoring the event — it does not go grey and lose its label.
5. **Minimum touch target** `target.min` 44 everywhere, `target.field` 56 in the rider app, `target.criticalField` 72 for rider Accept/Decline and restaurant Accept-order. If the visual is smaller, the hit area is expanded (RN `hitSlop`, web `::after` overlay). Adjacent targets are ≥8 apart.
6. **No physical direction properties** (lint L-7). `start`/`end`, never `left`/`right`. This is what keeps RTL a config flip.
7. **No raw colour, no ramp steps** (lint L-1/L-2). Roles only.
8. **Money is `int64` cents.** Any component that shows money takes cents and renders through `<Price>`. No component accepts a pre-formatted currency string, and none accepts a float (lint L-5).
9. **Server state only.** No component derives a business state client-side. Notably: the halal badge renders from `halal_display_state` in the payload or renders nothing and logs a client error (C-12 R4 — "there is no 'assume certified'"); countdowns derive from server `expires_at` minus measured clock skew, never a local constant (D-14).
10. **Unknown enum values do not crash.** Any component switching on a server enum has a documented fallback branch and reports it (rider spec §0.1: "Client must treat unknown enum values as 'unsupported — refresh app', never crash").
11. **Every component ships a `testID` / `data-testid`** derived from its name, and snapshot coverage in both themes and both density modes.
12. **Current and selected are a fill, never an edge.** A current page, active nav item, selected row or selected card is never marked with a bar, border or stripe on its inline-start edge. On the dark chrome it is an inverted tile: fill `text.onAccent`, with the label and icon in `surface.chrome`. On any other surface it is a `state.selectedTint` fill. Either way the label is bold and the state is in the markup (`aria-current` / `aria-selected`), so it never rests on colour alone. Owner decision, 1 Oct 2026; [issue #398](https://github.com/shaiknoorullah/hg-mono/issues/398) moved the web `SideNav` off its edge bar.

---

## Tier 1 — Primitives (11)

### 1. `Button`

**Purpose.** The single affordance for an action. If it navigates, it is a `Link` styled as a button and announces as a link.

**Variants.** `primary` (brand fill `color.brand.500` + `text.onBrand`) · `secondary` (accent fill `color.accent.600` + white) · `tertiary` (transparent, `text.primary`, `border.interactive`) · `ghost` (transparent, no border) · `danger` (`color.danger.500` + white) · `success` — **does not exist** (RULE H-1: no filled green outside the halal namespace; a "confirm" action uses `primary`).

**Sizes.** `sm` 36h / `label.md` / `space.3` padding-x · `md` 44h / `label.lg` / `space.4` · `lg` 52h / `label.lg` / `space.5` · `xl` 60h / `heading.sm` / `space.6` (rider primary actions only).

**Props.** `variant`, `size`, `fullWidth`, `iconStart`, `iconEnd`, `loading`, `disabled`, `destructive`, `onPress`, `accessibilityLabel`, `href` (web link mode).

**States.**
| State | Treatment |
|---|---|
| default | as variant |
| hover | `state.hoverOverlay` composited over the fill |
| pressed | `state.pressedOverlay` + scale 0.98, `duration.instant`, `easing.standard` |
| focus-visible | two-layer ring, `radius` + 2 |
| disabled | `state.disabledOpacity`, pointer-events off, `aria-disabled="true"` (not the `disabled` attribute — a disabled button is not focusable and cannot explain itself) |
| loading | spinner replaces `iconStart`, label **stays visible**, width frozen to prevent layout shift, `aria-busy` |

**Accessibility.** Label is the visible text; icon-only is `IconButton`, not `Button`. `destructive` adds no colour-only meaning — the label must contain the verb ("Cancel order", not "Confirm"). A button that triggers an irreversible action under a deadline (rider Accept, restaurant Accept) must be ≥`target.criticalField` and must not be adjacent to its opposite within 16.

---

### 2. `IconButton`

**Purpose.** A control whose only content is an icon.

**Variants.** `plain` · `filled` · `tonal` (tint background). **Sizes.** `sm` 36 · `md` 44 · `lg` 56.

**Props.** `icon`, `variant`, `size`, `accessibilityLabel` (**required — no default**), `badge` (dot or count), `loading`, `disabled`.

**Accessibility.** `accessibilityLabel` is a required prop and the type system enforces it. The icon itself is always `aria-hidden`. Hit area is never smaller than the size token even when the glyph is 20px.

---

### 3. `Input`

**Purpose.** Single-line text entry.

**Variants.** `text` · `email` · `tel` (E.164 `+1`, mask `+1 (___) ___-____`, C-01) · `numeric` · `password` · `search` · `otp` (6 discrete cells, one hidden field, paste-aware, `autoComplete="one-time-code"`).

**Sizes.** `md` 44h · `lg` 52h (rider default).

**Props.** `label` (**required, always visible — never placeholder-as-label**), `value`, `onChange`, `placeholder`, `helperText`, `errorText`, `required`, `disabled`, `readOnly`, `loading`, `prefix`, `suffix`, `maxLength`, `characterCount`, `autoComplete`, `inputMode`, `textContentType`.

**States.** default (`border.interactive` 1px) · hover (`border.strong`) · pressed n/a · focus-visible (2px `border.brand` border **only** — no ring, rule 3; when `error`, the danger border stays and the two-layer ring marks focus) · disabled (`surface.subtle` fill, 60% opacity) · loading (trailing spinner, input stays editable unless `readOnly`) · **error** (2px `color.danger.500` border + `errorText` below in `color.danger.600` with a `alert-circle` icon) · **success** (checkmark in `color.success.600`, **no green fill** per RULE H-1).

**Accessibility.** Label is programmatically associated (`htmlFor`/`nativeID` + `accessibilityLabelledBy`). `errorText` is `role="alert"` / `accessibilityLiveRegion="assertive"` and is linked via `aria-describedby`; the field gets `aria-invalid`. Errors are never colour-only — icon + text always. Placeholder contrast is 3.33:1 and placeholder is never the only label. `maxLength` announces remaining characters at 80% and at the limit.

---

### 4. `Textarea`

Same contract as `Input`. Adds `rows`, `autoGrow`, `maxLength` with a visible counter. Used for: delivery instructions ≤280 chars (C-33/D-19), restaurant rejection reasons, admin halal check notes (min 20 chars for a human override, A-15 R5 — the counter enforces the minimum and the submit is blocked with an explanatory message, not a silent disable).

---

### 5. `Select`

**Purpose.** Choice from a closed server-defined set.

**Variants.** `native` (RN `Picker` / web `<select>` — default; the accessible path) · `sheet` (opens a `Sheet` with a searchable list — for >8 options, e.g. the halal issuing-body registry in A-15/A-16) · `inline` (segmented, ≤3 short options).

**Props.** `label`, `options: {value, label, description?, disabled?}[]`, `value`, `onChange`, `placeholder`, `searchable`, `errorText`, `required`, `loading`, `emptyText`.

**States.** As `Input`, plus `open`. `loading` shows a skeleton list inside the sheet, never an empty list.

**Accessibility.** `sheet` variant implements the combobox pattern: `role="combobox"` + `aria-expanded` + `aria-controls`, arrow-key navigation, type-ahead, Escape closes and restores focus to the trigger. The selected option is `aria-selected`. **Never** use a `Select` for a binary — that is `Switch` or `Radio`.

---

### 6. `Checkbox` / 7. `Radio`

**Purpose.** `Checkbox` = independent booleans (add-ons with multi-select, C-16; admin bulk selection). `Radio` = exactly one from a set (variants with single-select, C-16; refund reason codes, C-37).

**Sizes.** control 20 or 24; **hit area always ≥44**, achieved by padding the whole row — the entire label row is the target, not just the box.

**Props.** `checked`/`selected`, `indeterminate` (checkbox only), `label`, `description`, `priceDeltaCents` (add-on/variant rows — rendered through `Price`), `disabled`, `disabledReason`, `error`, `onChange`; `RadioGroup` adds `name`, `value`, `orientation`, `required`.

**States.** default (`border.interactive`) · hover · pressed (ripple/overlay on the whole row) · focus-visible (ring on the control, not the row) · checked (`color.brand.500` fill, `text.onBrand` tick — **not green**) · indeterminate · disabled (60% opacity + `disabledReason` in `text.tertiary`, e.g. "Out of stock").

**Accessibility.** Native semantics (`role="checkbox"`/`"radio"`, `accessibilityRole`, `accessibilityState={{checked}}`). A `RadioGroup` is a single tab stop; arrows move within it. Group label is `role="radiogroup"` + `aria-labelledby`. Required-group validation announces on the group, not on the last option.

---

### 8. `Switch`

**Purpose.** Immediate, self-applying binary state. Used for exactly: rider online/offline (D-10), restaurant accepting-orders (R-22), item availability (R-18), admin feature flags.

**Props.** `checked`, `onChange`, `label`, `description`, `loading`, `disabled`, `confirmOnDisable`.

**States.** Track `border.strong` off / `color.brand.600` on (3:1 track-vs-surface required, WCAG 1.4.11). `loading` = thumb spinner, switch stays in the **old** position until the server confirms — an optimistic switch that snaps back is the single worst pattern for a rider toggling offline.

**Accessibility.** `role="switch"` + `aria-checked`. On/off state is never conveyed by thumb position alone: the row carries a text state ("Online" / "Offline"). Rider going offline while `ON_DELIVERY` is rejected server-side (`409 ACTIVE_DELIVERY_IN_PROGRESS`) — the switch reverts and a `Toast` explains, offering `go_offline_after_delivery`.

---

### 9. `Badge`

**Purpose.** A small non-interactive status marker. **Not** the halal badge — that is its own component and deliberately does not share this one.

**Variants.** `neutral` · `info` · `warning` · `danger` · `brand` · `outline`. **No `success` variant** (RULE H-1).
**Styles.** `solid` · `tint` (default) · `dot` (leading dot + label).
**Sizes.** `sm` 18h `label.sm` · `md` 22h `label.sm` · `lg` 26h `label.md`.

**Props.** `variant`, `style`, `size`, `label`, `icon`, `max` (for counts, "99+").

**Accessibility.** Announced as text in reading order. A count badge on an `IconButton` must be inside the button's accessible name ("Cart, 3 items"), not a separate node. Never colour-only: `danger` badges carry a word.

---

### 10. `Chip` / `FilterChip`

**Purpose.** `Chip` = a static attribute (cuisine, allergen, veg marker, dietary note). `FilterChip` = a toggleable filter (C-11).

**Variants.** `static` · `filter` (toggle) · `choice` (single-select in a row) · `input` (removable, with an X).
**Sizes.** `sm` 26h · `md` 32h.

**Props.** `label`, `icon`, `selected`, `onPress`, `onRemove`, `count`, `disabled`, `tone` (`neutral` | `warning` for allergens | `veg` | `nonveg`).

**Notes.** The veg/non-veg marker (C-13) is a `Chip` with a square-in-square glyph, `color.success.600` outline for veg and `color.danger.600` for non-veg — **outline, never filled** (RULE H-1). Allergen chips use `warning` tone and are warnings, not filters (C-11 out-of-scope).

**Accessibility.** `filter` is `role="button"` + `aria-pressed`. A filter row is horizontally scrollable and must be keyboard-reachable with arrow keys; scroll position never traps focus. Selected state is border + fill + a check glyph, never fill alone.

---

### 11. `Avatar`

**Purpose.** Person or business identity.

**Variants.** `image` · `initials` (deterministic hue from the id, drawn from `viz.*` so it never lands on a reserved colour) · `icon` (fallback) · `group` (stacked, max 3 + "+n").
**Sizes.** `xs` 24 · `sm` 32 · `md` 40 · `lg` 56 · `xl` 80.
**Shape.** `radius.full` for people, `radius.md` for restaurants (a restaurant is not a person).

**Props.** `src`, `name`, `size`, `shape`, `status` (`online`/`offline` dot — rider only), `alt`.

**Accessibility.** Decorative when the name is adjacent (`alt=""`); otherwise `alt` is the name. Status dot is never the only signal.

---

## Tier 2 — The certification family (3) ★

This tier is the product. Nothing here is generic.

### 12. `HalalBadge` ★

**Purpose.** Render the customer-visible `halal_display_state` as a seal. It appears on **every** restaurant card across all six surfaces (feed, search, favourites, order history, receipt, detail header) — C-12 acceptance criterion 2 asserts this by snapshot across all six.

**Props.**
```
state: 'CERTIFIED' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNVERIFIED' | null | undefined
size: 'sm' | 'md' | 'lg'
surface: 'card' | 'detail' | 'operational'
onPress?: () => void      // detail surface only -> opens HalalCertificationPanel
```
There is **no** `color`, `label`, `variant` or `icon` prop. The four states are the entire API. A caller cannot make this component say something else.

**States → rendering.**

| `state` | Renders |
|---|---|
| `CERTIFIED` | Filled seal `halal.certified.seal`, 1.5px brass ring `halal.certified.ring`, solid shield glyph, label **"Halal certified"** (exact string, C-12 R7), `radius.md`, `label.sm` |
| `EXPIRING_SOON` | **Byte-identical to `CERTIFIED`.** The renewal signal lives only in `HalalCertificationPanel` (C-12 states table). A snapshot test asserts the two renders are identical. |
| `EXPIRED` | Filled seal `halal.expired.seal`, **outline** shield glyph, no brass ring, label "Certification expired" |
| `UNVERIFIED` | **`surface='card' \| 'detail'` → returns `null`.** `surface='operational'` → dashed outline, dashed shield, label "Not verified" |
| `null` / `undefined` / unknown | **Returns `null` AND calls `reportClientError('HALAL_DISPLAY_STATE_MISSING', {restaurantId})`.** C-12 R4/AC5: no default, no optimistic value, no "assume certified". A component test deletes the field and asserts both the absent badge and the reported error. |

**Sizes.** `sm` 20h (dense list rows, order history) · `md` 24h (**default** — restaurant cards) · `lg` 32h (detail header).

**States (interaction).** Non-interactive by default. On `detail` with `onPress`, it gains `pressed` and `focus-visible` and a chevron; hit area ≥44 regardless of size.

**Accessibility.**
- `accessibilityRole="image"` (non-interactive) or `"button"` (with `onPress`).
- Accessible labels — **fixed strings, reviewed, not templated by callers**:
  - `CERTIFIED` / `EXPIRING_SOON`: **"Halal certified"** (C-12 AC2 asserts exactly this label across all six card surfaces).
  - `EXPIRED`: **"Halal certification expired. This restaurant cannot take orders."**
  - `UNVERIFIED` (operational only): **"Halal certification not verified."**
- On the detail surface the label extends with the value, not the state name: *"Halal certified by {certifying_body_name}. Valid until 14 March 2027. Double tap for certificate details."* Screen-reader users get the certifying body without opening the panel, because the body's name is the thing a customer applies their own standard to (C-12 R6, and the C-04 decision that the platform does not encode madhhab).
- The seal is **never** the sole content of a link. It never sits on a photograph (foundations §12).
- Never animates (foundations §7.4 rule 4).

**Divergence from HungerStation (D1).** In HungerStation's language a per-listing attribute of this kind would be a small yellow-family chip in the card's metadata row. Here it is a dark, ringed, high-contrast seal placed **above** the metadata row and below the hero, at 10.68:1 — the highest-contrast element on the card, above the restaurant name. Rationale: on a catalogue where 100% of listings are certified, the badge's job is not to differentiate listings from each other but to prove the platform's single claim on every impression. A chip that blends into the brand palette fails that job precisely because it blends in.

---

### 13. `HalalCertificationPanel` ★

**Purpose.** The always-reachable certification section on the restaurant detail page, above the menu (C-12 surface 2). Fed by `GET /restaurants/:id/certification` — a separate endpoint from restaurant detail so it can refresh without refetching the menu, cached 60 s (C-12 R8).

**Props.** `restaurantId`, `certification: {state, certifyingBodyName, certificateNumber, issuedOn, expiresOn, verifiedAt, scope}`, `onViewCertificate`, `onReportConcern`.

**Composition, in order.**
1. `HalalBadge size="lg" surface="detail"`.
2. **Certifying body name** — free text, exactly as the admin verified it, `heading.sm`. Never ranked, scored, annotated or linked to a rating (C-12 R6).
3. Certificate number (`mono.md`), issue date, **expiry in absolute form** — "Valid until 14 March 2027" (C-12 surface 2). Never "expires in 7 months", never a relative time.
4. **Renewal note row** — rendered **only** when `state === 'EXPIRING_SOON'`: clock glyph + "Certificate renews {absolute date}" on `halal.expiring.tint`. Not an alert, not the warning ramp (foundations §2.5).
5. Scope, when present (`WHOLE_ESTABLISHMENT` | `KITCHEN_ONLY` | `SPECIFIC_MENU_ITEMS` | `SUPPLIER_CHAIN_ONLY`, A-15) rendered as plain English.
6. **"View certificate"** — `Button variant="tertiary"`, opens `DocumentViewer` via a per-request presigned GET, TTL 300 s, audited (C-12 R5).
7. **Standing line**, `caption`, always present, never collapsible: *"Certification verified by HalalGoes on {verified_at}. HalalGoes does not itself certify food."* (C-12 R7). `verified_at` is an instant, so it names the day it was in Toronto (America/Toronto), not the UTC day; the issue and expiry dates are calendar days and are shown as written.
8. **"Report a halal concern"** — `Button variant="ghost"`, opens the C-39 grievance flow with category `HALAL_CONCERN` pre-set (server-assigned `CRITICAL`, 4 h acknowledge SLA).

**States.**
- **Loading** — skeleton with the seal's silhouette reserved at full size. **Never a spinner where the seal will be**: a briefly-empty certification area on a trust product reads as "no certification".
- **Error** — the panel does **not** disappear. It renders `ErrorState variant="inline"` with "Couldn't load certification details" + Retry, and the seal is **not** drawn (no cached state is trusted). The rest of the page still renders.
- **Empty** — not reachable on a customer surface: an uncertified restaurant returns 404 (C-12 R1).

**Accessibility.** `role="region"` + `aria-labelledby` pointing at a visually-present "Halal certification" heading. The panel is a landmark and is reachable by heading navigation from the top of the detail page — an SR user should not have to pass the menu to reach it. Dates are in `<time datetime>` with the full date in the accessible name.

---

### 14. `HalalChecklist` (admin) ★

**Purpose.** The seven-check verification form (A-15). Admin surface only.

**Props.** `certificate`, `checks: {key, result, note, autoEvaluated, overridable}[]`, `onRecord`, `onApprove`, `onReject`.

**Composition.** Seven rows, fixed order `H1_LEGIBLE_COMPLETE` → `H7_UNIQUE_NOT_REUSED`, each with: check key, plain-English description, a three-way control (`PASS` / `FAIL` / unset), and a note field.

**Rules encoded in the UI.**
- `H5_DATES_VALID` and `H7_UNIQUE_NOT_REUSED` are server-computed and **not overridable** — the control renders read-only with the computed result and a lock glyph. An attempt returns `409 CHECK_NOT_OVERRIDABLE`; the UI must not offer the affordance in the first place.
- `H2`/`H3`/`H4` render the server's pre-computed suggestion as a pre-selected value with a visible "system suggested" marker; changing it **requires** a note.
- Any human override requires a note of ≥20 characters (A-15 R5). The `Textarea` counter enforces it and Approve stays enabled-but-blocking with an explanatory error, not silently disabled.
- **Approve is disabled until all seven are recorded `PASS`.** A check counts only once it is recorded (`checked_at` set, otherwise the row reads "Not recorded"), and H5 and H7 also need the server's `computed_result` present and `PASS`. Its disabled state names the outstanding keys ("2 checks outstanding: H1, H6") — a disabled button that will not say why is a defect.
- Reject requires ≥1 `FAIL`, a reason code from the closed enum and a message to the restaurant of 10–1000 characters (`HalalDecisionInput.reason_text` in the contract), sent word for word. The 20-character minimum is the override note's, not the rejection's.

**Accessibility.** A `<fieldset>` per check with a legend. Locked checks are `aria-readonly` with the reason in `aria-describedby`. Approve/Reject are separated by ≥24 and are not colour-only. Every recorded value writes an `audit_event` — the UI shows a persistent "this action is audited" note, because it changes behaviour.

---

## Tier 3 — Content and data display (12)

### 15. `Card`

**Purpose.** The generic surface container everything else composes from.

**Variants.** `elevated` (elevation 1, `surface.raised`) · `outlined` (1px `border.decorative`) · `filled` (`surface.subtle`) · `interactive` (elevated + hover/press).
**Props.** `variant`, `padding` (defaults to `density.cardPadding`), `radius` (default `lg`), `onPress`, `media`, `header`, `footer`.
**States.** interactive only: hover (elevation +1), pressed (scale 0.99 + overlay), focus-visible (ring around the whole card).
**Accessibility.** An interactive card is **one** tab stop with **one** accessible name; nested links inside a pressable card are forbidden (the "nested interactive" trap). If a card needs two actions, the card is not pressable and the actions are explicit buttons.

---

### 16. `RestaurantCard`

**Purpose.** The customer catalogue unit. Six surfaces render it (C-12 AC2): feed, search, favourites, order history, receipt, detail header.

**Variants.** `feed` (full-width, 16:9 hero) · `compact` (list row, 4:3 thumb — search results, favourites) · `carousel` (fixed 280 width — "trending", "order again").
**Sizes.** driven by variant + `density`.

**Content, in fixed order** (C-09): hero image → **`HalalBadge`** → name (`heading.md`) → cuisine list (max 2 + "+n") → `Rating` + review count → distance to 1 dp → ETA range → price band → availability overlay.

**Props.** `restaurant`, `variant`, `availability` (the server-computed C-14 object — the client never recomputes hours), `onPress`, `onFavourite`, `showDistance`.

**States.**
| State | Treatment |
|---|---|
| default / hover / pressed / focus-visible | per `Card` |
| **`CLOSED_HOURS`** | 55% `surface.scrim` over the hero + centred "Closed · Opens {time}"; card stays pressable (browsing a closed menu is legitimate); the add controls inside are what disable |
| **`PAUSED`** | scrim + "Not accepting orders" |
| **`OUT_OF_RANGE`** | scrim + "Outside delivery area" + the distance |
| **`NO_ADDRESS`** | no scrim; the ETA/fee/distance triple is replaced by "Set your address" as a link |
| loading | `Skeleton` in the exact card geometry |

**Accessibility.** One tab stop. Accessible name concatenates in reading order: *"{name}. Halal certified. {cuisines}. {rating} stars, {count} reviews. {distance} kilometres. {eta} minutes. {availability}."* — the halal state comes **second, immediately after the name**, before rating and distance. Favourite is a separate `IconButton` with its own label and its own hit area, positioned so it does not overlap the card's target.

---

### 17. `MenuItemCard`

**Purpose.** A row in a restaurant menu (C-13).

**Variants.** `row` (default: text start, 1:1 thumb end) · `grid` (2-col, image-led — used only for "popular items").
**Content.** Name (`heading.sm`) · description truncated to exactly 2 lines · `Price` · veg/non-veg `Chip` · allergen `Chip`s · `QuantityStepper` or an add `IconButton`.

**Props.** `item`, `variant`, `quantityInCart`, `onAdd`, `onPress`, `disabled`, `disabledReason`, `highlighted`.

**States.** default · hover · pressed · focus-visible · **`highlighted`** (1.5s `color.brand.100` wash after an in-menu search result is tapped, C-13 R3 — the row scrolls to and highlights; it must not open an alert) · **unavailable** (at V1 unavailable items are *omitted*, not greyed, C-13 R1 — this state exists only for the restaurant-side menu editor) · loading (skeleton row).

**Accessibility.** The row is the tab stop; the add control is a second, adjacent stop with the label "Add {item name}". Price is inside the row's accessible name. Allergen chips are read as "Contains: peanuts, sesame" — a single grouped string, not five separate nodes.

---

### 18. `OrderCard`

**Purpose.** One order, rendered on customer history (C-26), restaurant queue (R-23), rider dashboard (D-18) and admin lookup. One component, three densities.

**Variants.** `customer` · `restaurant` · `rider` · `admin`.
**Content by variant** — deliberately different, because these audiences may not see the same fields:
- `customer`: restaurant name + `HalalBadge` + item summary + `Price` total + `StatusTimeline` compact + action.
- `restaurant`: order number + `Countdown` (when `PENDING_RESTAURANT`) + customer **first name + last initial** + **masked phone** + `special_instructions` **prominent and verbatim** + line items + `restaurant_payout_cents`. Delivery address appears **only after `ACCEPTED`** (R-23 R1).
- `rider`: pickup + dropoff + item count + earnings breakdown + instruction enum. **No prices, no order total, ever** (D-19: "the rider has no reason to know the basket value and it invites disputes").
- `admin`: everything + ids in `mono.md`.

**Props.** `order`, `variant`, `onPress`, `actions`, `elapsedSeconds`, `deadlineAt`.

**States.** default · pressed · focus-visible · **`urgent`** (deadline < 25% remaining: 2px `color.danger.500` border + the `Countdown` turns danger) · **`late`** (`promised_ready_at` passed while `PREPARING`, R-23 R6: `color.warning` left border + "Late" badge) · loading · **`stale`** (socket disconnected > 45 s: a `Banner` above the list, cards dimmed 10% — a stale queue must announce itself).

**Accessibility.** `urgent`/`late` are never colour-only — both add a text badge. The countdown is an `aria-live="off"` region polled by the SR on demand (a live-updating countdown announced every second is unusable); instead, announcements fire at 50%, 25% and 10% remaining via `aria-live="assertive"`.

---

### 19. `RiderOfferCard`

**Purpose.** The full-screen, non-dismissible offer (D-14). Structurally distinct enough from `OrderCard` to be its own component.

**Composition.** `Countdown` ring at top (from server `expires_at` − skew) · earnings in `display.lg` with the base/distance/surge/tip breakdown · pickup restaurant name + address + distance-to-pickup · dropoff **street + neighbourhood only** (unit and phone withheld until accept, D-19 progressive disclosure) · item count + weight class · total trip distance + duration · Accept / Decline at `target.criticalField` (72), Accept at the bottom edge under the thumb, Decline separated by ≥24.

**States.** `pending` · `accepting` (Accept enters `loading`; both buttons block) · `expired` (D-14: sheet closes at `expires_at` and shows "Offer expired" for 3 s — it must **never** auto-dismiss early; the shipped app dismissed at 7 s against a 5-minute window and riders lost jobs) · `withdrawn` (`offer.withdrawn` arrives: sheet closes with the reason — `TAKEN_BY_ANOTHER_RIDER` / `ORDER_CANCELLED` / `RUN_ENDED`) · `duplicate` (same `offer_id` arrives by push and socket: exactly one sheet, deduped on `offer_id`).

**Accessibility.** Sheet takes focus on mount and traps it. Announces once on open with the full offer: *"New delivery offer. {earnings}. Pickup {restaurant}, {distance}. {duration} minutes. {n} seconds to respond."* Countdown re-announces at 15 s, 10 s and 5 s only. Accompanied by sound + haptic that plays in silent mode when `ONLINE_IDLE` (D-14). Renders in the `field` theme: ≥7:1 body contrast, `body.lg`, 72 targets.

---

### 20. `Price` ★

**Purpose.** Render money. The only component permitted to.

**Props.**
```
cents: number            // int64 minor units. NEVER a float. Lint L-5 enforces.
currency?: 'CAD'         // default and only value at V1
size?: 'sm'|'md'|'lg'|'xl'
strikethrough?: boolean
sign?: 'auto'|'always'|'never'   // 'always' for ledger/earnings deltas
showCode?: boolean       // appends 'CAD' -- required on receipts and refund records
free?: string            // label when cents === 0, e.g. 'Free delivery'
```
There is **no** `value: number` prop and **no** `formatted: string` prop. A component that accepted a formatted string would let a caller invent a price.

**Rendering.** `$12.34`. `cents === 0` renders `free` if provided, else `$0.00` — never blank. Negative renders `−$3.00` with a true minus (U+2212), not a hyphen. Always `font.numeric.tabular`. Rounding never happens here: the component divides by 100 and pads; all rounding is server-side (`money.Round`, half-down to the cent, ties toward the customer — customer spec §0.1).

**States.** static; `loading` renders a `Skeleton` at the exact glyph width so totals do not jump during a quote refresh.

**Accessibility.** Accessible name is "12 dollars and 34 cents" (locale-formatted), not the glyph string — SRs read `$12.34` inconsistently. `strikethrough` prices are prefixed "was", current prices "now". A price that is part of a larger name (a menu row) is inlined, not a separate node.

---

### 21. `Rating`

**Props.** `value` (0–5, 1 dp), `count`, `size`, `showCount`, `interactive`, `onChange`.
**Variants.** `display` (star + "4.6 (312)") · `stars` (five glyphs) · `input` (submission, C-38).
**States.** display is static; input has hover/pressed/focus-visible per star and is a radiogroup under the hood.
**Accessibility.** Accessible name "4.6 out of 5 stars, 312 reviews" — never five separate star nodes. `input` variant is arrow-key navigable and announces on change. Tabular figures.

---

### 22. `QuantityStepper`

**Props.** `value`, `min` (0), `max`, `onChange`, `size`, `loading`, `disabled`, `removeAtZero`.
**Sizes.** `sm` 32 · `md` 40 · `lg` 48. Each button ≥44 hit area regardless.
**States.** default · hover · pressed · focus-visible (ring on the focused button) · disabled at bounds (the `−`/`+` disables individually, with the reason available) · **loading** (value freezes, both buttons block, spinner replaces the number — cart mutations are server-authoritative and an optimistic stepper that reverts is worse than a 200 ms wait) · **`removeAtZero`** (the `−` becomes a trash glyph at 1 and announces "Remove {item}").
**Accessibility.** `role="group"` with a name ("Quantity for {item}"). Buttons are "Increase quantity" / "Decrease quantity". The value is `aria-live="polite"`. On web the numeral is also a focusable `spinbutton` accepting direct entry.

---

### 23. `StatusTimeline`

**Purpose.** Order progress. Customer tracking (C-32), restaurant order detail, admin order lookup, rider assignment.

**Variants.** `vertical` (default, full detail) · `horizontal` (compact, on `OrderCard`) · `compact` (a bar + current-step label).
**Props.** `steps: {key, label, at?, state}[]`, `currentKey`, `orientation`, `showTimes`, `estimatedAt`.
**Step states.** `complete` · `current` · `upcoming` · **`failed`** (`CANCELLED`/`REJECTED`/`FAILED`) · **`stalled`** (deadline passed, still here).

**Mapping.** Renders the platform's 14-state machine collapsed to the audience's vocabulary. Customer: Placed → Confirmed → Preparing → On the way → Delivered. (`CREATED`/`AUTHORIZED` collapse into "Placed"; `RESTAURANT_PENDING` is "Confirming"; `PICKED_UP`/`ARRIVED` are both "On the way"; `COMPLETED` is not shown — settlement is not a customer concern.) Restaurant and rider use their own domain vocabularies. **The mapping table lives in one shared module**, not per surface, so the customer app and the restaurant app can never disagree about what an order state is called.

**States.** loading (skeleton with the correct number of steps — the shape of the timeline is known before the data) · error (the timeline persists with the last known state and a `Banner`: "Not updating — reconnecting"; it never blanks) · `stalled` (`color.warning` step + an explanatory line: C-32 requires the customer never sits on a spinner with no information; D-15 requires every run state change emit a customer-facing event).

**Accessibility.** `role="list"`, each step a `listitem`. Accessible name per step: "{label}, {state}, {time}". The current step is `aria-current="step"`. State changes announce via `aria-live="polite"` **once per change**, deduplicated. Times are absolute in the accessible name ("2:41 PM") even when displayed relative.

---

### 24. `DataTable` (admin)

**Purpose.** Admin lists: orders, restaurants, riders, documents, the halal register, audit events, refunds.

**Props.** `columns`, `rows`, `sort`, `onSortChange`, `selection`, `onSelectionChange`, `cursor`, `onLoadMore`, `density`, `stickyHeader`, `rowActions`, `emptyState`, `errorState`, `loading`.

**Behaviour.** **Cursor pagination only** (`?limit&cursor`, `meta.next_cursor`/`has_more`) — no page numbers, no total count, matching the platform's API contract. Server-side sort and filter. Column widths from content class (`id` `mono.md` fixed-width, money end-aligned tabular, dates absolute + a relative tooltip). Sticky header and sticky first column. Row height from `density.rowHeight` (44 in `compact`).

**States.** default · row hover · row focus-visible · row selected (`state.selectedTint` + a checkbox, never colour alone) · **loading** (5 skeleton rows in the real column geometry — never a centred spinner replacing the table, which loses the header and the user's place) · **loading-more** (a skeleton row at the tail; the loaded rows stay put) · **empty** (`EmptyState` inside the table body, header retained) · **empty-after-filter** (distinct copy + a "Clear filters" action — a filtered-to-nothing table is not the same event as an empty table and must not say "No records yet") · **error** (`ErrorState` in the body, header retained, Retry).

**Accessibility.** Real `<table>` semantics: `<th scope="col">`, `aria-sort` on sortable headers, `<caption>` naming the table. Full keyboard grid navigation (arrows within, Tab out). Selection announces the running count. Row actions are a menu button per row with a unique name ("Actions for order HG-10482") — never five identical "Actions" buttons. Sorting announces the new order.

---

### 25. `DocumentViewer`

**Purpose.** Render a presigned document: halal certificates (C-12 / A-15), rider licence/insurance (D-05), restaurant compliance docs (R-07), proof of delivery (D-21).

**Props.** `url` (presigned, TTL 300 s), `contentType`, `title`, `onExpire`, `onDownload`, `allowDownload`.
**Behaviour.** Images render in-app with pinch-zoom and rotate; PDFs open in the system viewer. **Never cached to disk** (C-12 R5). A visible TTL indicator; at expiry the view blanks and offers "Request again" (which mints a new presigned URL and writes a new `certificate_view_audit` row).
**States.** loading (skeleton at the document's aspect ratio) · loaded · **expired** (blanked + re-request, not a broken image) · error (403 from MinIO after TTL is the *expected* path and gets the expired treatment, not the error treatment) · unsupported content type (download-only fallback).
**Accessibility.** `title` is the accessible name. Zoom controls are real buttons, not gesture-only. Announces "This view is recorded" where an audit row is written — a viewer that silently logs identity is a dark pattern.

---

### 26. `Map`

**Purpose.** Customer tracking (C-32), rider navigation (D-22), address pin placement (C-31), admin dispatch view.

**Props.** `center`, `zoom`, `markers`, `route`, `geofence`, `followMode` (`none`|`rider`|`fit-all`), `interactive`, `onMarkerPress`, `onRegionChange`.
**Markers.** Restaurant (brand seal shape), customer (`map.pinCustomer`), rider (`map.pinRider`, a bearing arrow). Rider position updates at 1 msg / 10 s while `PICKED_UP`/`ON_THE_WAY` (customer §0.4).
**States.**
- **loading** — the map frame with a `Skeleton` tile pattern, never a blank white rectangle.
- **`stale`** — no position for 45 s: a "Location updating…" `Banner` and the last-known marker **freezes** (customer §0.4). It must not drift or interpolate.
- **`degraded`** — socket down, polling `GET /orders/:id` every 15 s. The map stays correct, only less fresh, and says so.
- **permission-denied** (rider/address entry) — an inline explanation + a deep link to system settings. Never a bare grey map.
- **error** — tile failure falls back to a text panel with the addresses and the ETA. **The map is never the only way to know where the order is.**
**Accessibility.** The map is `accessibilityElementsHidden` / `aria-hidden` and is **always accompanied by an equivalent text summary** that is the actual accessible content: "Rider is 1.2 km away, about 6 minutes." Follow-mode is a labelled toggle. Camera moves use `spring.gentle` and never fight a user's pan.

---

## Tier 4 — Navigation and structure (6)

### 27. `AppBar`

**Variants.** `default` (title + optional back + actions) · `large` (collapsing, customer home) · `search` (an `Input` in place of the title) · `contextual` (selection mode, admin) · `transparent` (over a hero, with a scrim).
**Props.** `title`, `subtitle`, `back`, `actions`, `variant`, `elevated`, `progress`.
**States.** at-rest (no shadow) · scrolled (elevation 1 + a hairline) · loading (an indeterminate 2px `progress` bar at the bottom edge).
**Accessibility.** `role="banner"` / `accessibilityRole="header"`. The title is the page's `h1` on web. Back has the label "Back to {previous}" where known. Actions are `IconButton`s with real labels. Never a scroll-hidden AppBar on the rider or restaurant surfaces — an operational chrome that disappears is a control that cannot be found in a hurry.

---

### 28. `BottomNav`

**Purpose.** Primary wayfinding on the two RN apps. Adopted from HungerStation.
**Props.** `items: {key, label, icon, badge}[]`, `active`, `onChange`.
**Customer items (5, fixed):** Home · Search · Orders · Favourites · Account.
**Rider items (3, fixed):** Home · Earnings · Account. (Deliberately minimal — the rider's real navigation is the assignment flow, which takes over the screen.)
**Layout.** 56 + safe-area inset. Icon 24 + `label.md`. **Labels are always visible** — icon-only tabs fail recognition and fail SR users who get a bare glyph name.
**States.** active (`color.brand.600` icon + label, 2px indicator above) · inactive (`text.tertiary`) · pressed · focus-visible · badge (dot or count, inside the tab's accessible name).
**Accessibility.** `role="tablist"` with `role="tab"` children, `aria-selected`. Each tab ≥44 and full-height. Badges are in the name ("Orders, 2 active"), not separate nodes. **Hidden entirely during the rider offer sheet and during checkout** — a modal flow must not offer an escape hatch that abandons a payment or a live offer.

---

### 29. `Tabs`

**Purpose.** In-page section switching: menu categories (C-13), admin detail sections, restaurant queue columns on narrow screens.
**Variants.** `underline` (default) · `pill` · `scrollable` (menu categories — the "All" tab is implicit and first, C-13 R2).
**Props.** `tabs`, `value`, `onChange`, `variant`, `scrollable`, `sticky`.
**States.** active · inactive · hover · pressed · focus-visible · disabled · loading (skeleton pills).
**Accessibility.** Full tabs pattern: arrows move, Home/End jump, Tab exits to the panel, `aria-controls`/`aria-labelledby` paired. The active tab auto-scrolls into view without stealing focus. Scroll position is preserved per tab.

---

### 30. `Sheet`

**Variants.** `bottom` (default, RN) · `side` (admin filters/detail) · `full` (rider offer).
**Props.** `open`, `onClose`, `snapPoints`, `dismissible`, `title`, `footer`, `scrollable`, `keyboardAvoiding`.
**States.** closed · opening (`spring.smooth`) · open · dragging · closing · **`non-dismissible`** (rider offer: no backdrop tap, no swipe, no back button, until server `expires_at` — D-14).
**Accessibility.** Focus moves in on open and is trapped; on close it returns to the trigger. `role="dialog"` + `aria-modal` + `aria-labelledby`. Escape/back closes when dismissible. A drag handle is present but never the only way to close — there is always a visible close button. `keyboardAvoiding` is mandatory: a sheet whose submit button sits under the keyboard is broken.

---

### 31. `Modal`

**Variants.** `dialog` (title + body + actions) · `confirm` (destructive) · `alert` (single acknowledgement).
**Props.** `open`, `onClose`, `title`, `description`, `actions`, `destructive`, `dismissible`, `size`.
**States.** as `Sheet`; `confirm` primary action can be `loading`.
**Accessibility.** `role="alertdialog"` for destructive confirms (announces immediately). Focus lands on the **least destructive** action. The title is the accessible name; the description is `aria-describedby`. Backdrop is `surface.scrim`. **Never** a modal for anything a `Toast` or inline error could carry.

---

### 32. `Toast`

**Variants.** `neutral` · `success` (tint + `color.success.600` icon — **no green fill**, RULE H-1) · `warning` · `danger` · `info`.
**Props.** `variant`, `title`, `description`, `action`, `duration` (default 5000; `danger` defaults to persistent), `onDismiss`, `icon`.
**Placement.** Bottom, above `BottomNav`/sticky footer, respecting safe-area. Max 3 stacked; the oldest collapses.
**States.** entering (`duration.moderate`, `easing.decelerate`) · visible · exiting · paused (hover / SR focus pauses the timer — an auto-dismissing message that vanishes mid-read is inaccessible).
**Accessibility.** `role="status"` (polite) or `role="alert"` (assertive for `danger`). Persistent when the message carries an action. Never the sole carrier of an error that blocks a task — that belongs inline. Dismiss is a real 44 target.

---

## Tier 5 — Feedback and state (9)

### 33. `Skeleton`

**Props.** `variant` (`text`|`circle`|`rect`|`card`), `width`, `height`, `lines`, `animated`.
**Behaviour.** Matches the **real geometry** of what is loading, not a generic grey box — a card skeleton has a hero, a badge-sized block, a title line and two metadata lines. Shimmer `neutral.300` → `neutral.200`, 1.4 s, disabled under reduced-motion (falls back to a static tint).
**Accessibility.** `aria-hidden`; the containing region carries `aria-busy="true"` and announces "Loading {thing}" once. Skeletons never announce individually.
**Hard rule.** The halal seal's slot is always reserved at full size in any skeleton that will contain one. A card that reflows when the badge arrives makes the badge feel like an afterthought.

---

### 34. `Spinner`

**Props.** `size` (`sm` 16 / `md` 24 / `lg` 40), `label`, `inline`.
**Use.** Inside buttons and for indeterminate waits under ~1 s. **Skeletons beat spinners** for anything with known geometry.
**Accessibility.** `role="status"` + a real label. Under reduced-motion it becomes a static indeterminate bar.

---

### 35. `EmptyState`

**Props.** `illustration`, `title`, `description`, `primaryAction`, `secondaryAction`, `variant` (`page`|`inline`|`table`).
**Rule.** Every empty state names **why it is empty** and **what to do next**. "No orders" is a failure; "You haven't ordered yet — browse restaurants near you" is a state.
**Note.** C-09 is explicit that feed sections with no content are **omitted entirely, never rendered as an empty shell**. `EmptyState` applies to whole screens and to tables, not to feed sections.
**Accessibility.** Title is a heading at the right level. Illustrations are `aria-hidden`. The primary action is the first focusable element after the heading.

---

### 36. `ErrorState`

**Props.** `variant` (`page`|`inline`|`toast`|`table`), `errorCode`, `title`, `description`, `onRetry`, `onSupport`, `technicalDetail`.
**Rule.** Copy is keyed off the stable `error.code` enum, **never off `error.message`** (customer §0.2, rider §0.1). An unmapped code falls back to a generic message **and reports the unmapped code** so the gap is discoverable.
**Content.** Plain-language cause + what the user can do + Retry. `technicalDetail` (request id, code) is collapsed by default and always copyable — support cannot work from "something went wrong".
**Special cases.**
- `RESTAURANT_UNAVAILABLE` (409 at checkout, C-12 R3) uses **halal-specific copy** and the cart is **not** emptied: "This restaurant's halal certification is no longer current, so we can't place this order. Your cart is saved."
- Network-offline is a distinct state with distinct copy, not a generic error.
**Accessibility.** `role="alert"` for `inline`. Focus moves to the error when it replaces the content the user was acting on. Retry is a real button, never a link styled as text.

---

### 37. `Banner`

**Purpose.** A persistent, non-blocking inline message attached to a region.
**Variants.** `info` · `warning` · `danger` · `neutral`. **No `success`.**
**Props.** `variant`, `title`, `description`, `action`, `dismissible`, `icon`.
**Uses.** "Location updating…" on the tracking map; "Tracking is not reporting" on the rider dashboard when `tracking_health != HEALTHY` (D-18, with a one-tap deep link to permissions/battery settings); "Reconnecting" on the restaurant queue; "Your cart is from a different restaurant" (C-20); account-status remediation on a `DELISTED` restaurant.
**Accessibility.** `role="status"` or `role="alert"` by severity. A dismissible banner that reports an ongoing condition must reappear if the condition persists across sessions.

---

### 38. `Countdown`

**Purpose.** Every deadline in the system: restaurant response 180 s (R-24), rider offer 30 s (D-14/15), cart `CREATED` 15 min, `READY_FOR_PICKUP` 15 min, ops escalation 600 s.

**Props.**
```
expiresAt: string        // server RFC-3339. REQUIRED.
serverNow: string        // server clock at response time. REQUIRED.
onExpire: () => void
variant: 'ring' | 'bar' | 'text'
size, urgentThreshold (default 0.25), criticalThreshold (default 0.1)
```
There is no `seconds: number` prop. Clock skew is measured as `serverNow − deviceNow`; if it exceeds 5 s the countdown runs on `serverNow` plus monotonic elapsed time (D-14 R3: a device 10 minutes fast must still show ~30 s, not a negative).

**States.** `normal` (`color.info.500`) · `urgent` (<25%: `color.warning.600`) · `critical` (<10%: `color.danger.500` + a 1 Hz pulse, suppressed under reduced-motion) · `expired` (fires `onExpire` once, idempotently) · **`skew-corrected`** (a small marker in dev builds).
**Rules.** Always `easing.linear`. Always tabular figures. Never eased, never spring. A late-arriving item whose `expires_at` is already past renders nothing and triggers a re-fetch rather than a negative countdown (D-14).
**Accessibility.** `aria-live="off"` for the ticking numeral; explicit assertive announcements at 50%, 25%, 10% and 0. The visual state is never colour-only — the numeral itself is the information.

---

### 39. `ListRow`

**Purpose.** The generic settings/menu/detail row. The most-used component in the system after `Button`.
**Props.** `title`, `subtitle`, `leading` (icon/avatar), `trailing` (chevron/switch/value/badge), `onPress`, `destructive`, `disabled`, `dense`.
**States.** default · hover · pressed · focus-visible · disabled · selected.
**Accessibility.** One tab stop, one accessible name concatenating title + subtitle + trailing value. If `trailing` is a `Switch`, the **row** is not pressable — the switch is the control (two overlapping targets is the most common RN accessibility defect). Chevron is decorative.

---

### 40. `Divider`

**Props.** `orientation`, `inset`, `label`. Uses `border.decorative`. `aria-hidden` unless it carries a `label`, in which case it is a `separator` with an accessible name.

---

### 41. `Tooltip` / `Popover`

**Purpose.** Supplementary explanation on pointer surfaces (restaurant web, admin). **Not used in the RN apps** — hover does not exist and long-press discovery is unreliable; RN uses inline `helperText` or a `Sheet`.
**Props.** `content`, `placement`, `trigger` (`hover`|`focus`|`press`), `delay`.
**Accessibility.** Content is in `aria-describedby` on the trigger, so it is available without hover. Dismissible with Escape. **Never** the sole location of information required to complete a task — WCAG 1.4.13 requires hoverable, dismissible, persistent.

---

## Component summary

| Tier | Count | Components |
|---|---:|---|
| 1 — Primitives | 11 | Button, IconButton, Input, Textarea, Select, Checkbox, Radio, Switch, Badge, Chip/FilterChip, Avatar |
| 2 — Certification ★ | 3 | **HalalBadge**, **HalalCertificationPanel**, **HalalChecklist** |
| 3 — Content & data | 12 | Card, RestaurantCard, MenuItemCard, OrderCard, RiderOfferCard, Price, Rating, QuantityStepper, StatusTimeline, DataTable, DocumentViewer, Map |
| 4 — Navigation | 6 | AppBar, BottomNav, Tabs, Sheet, Modal, Toast |
| 5 — Feedback & state | 9 | Skeleton, Spinner, EmptyState, ErrorState, Banner, Countdown, ListRow, Divider, Tooltip/Popover |
| **Total** | **41** | |

**Shipped beside the 41, not counted in them:** `Icon` (see [iconography](./01-foundations.md#11-iconography)) and `Wordmark`, the HalalGoes logo, in both `@hg/ui-web` and `@hg/ui-native`. `Wordmark` draws the approved traced artwork from `@hg/brand` ([packages/brand/README.md](../../packages/brand/README.md)); its letters take `text.primary` and its swash `action.primary`, so it has no green and never stands in for the halal seal. The rules for the mark are in Claude Design's [wordmark and app icon guideline](https://claude.ai/artifact/1GwGVZz8Ju9wcz4HfCnzbv).

**Deliberately absent, and why:**
- **`SuccessButton` / filled green anything** — RULE H-1.
- **`HalalFilter`** — halal is a precondition, not a filter (C-12 R1, C-11 out-of-scope). Building the control would teach customers that non-certified listings exist.
- **`Carousel`** as a primitive — the feed's horizontal sections are `ScrollView` + `RestaurantCard variant="carousel"`. A general carousel invites auto-advancing content, which is a WCAG 2.2.2 problem and an appetite pattern we do not need.
- **`Accordion`** — used only in the Help hub (C-06); it is `ListRow` + a disclosure region, not a distinct component.
- **`Pagination`** — the API is cursor-based (`next_cursor`/`has_more`), so there are no page numbers to render. `DataTable` and lists use load-more.
- **`Stepper`/wizard chrome** — onboarding progress is `StatusTimeline variant="horizontal"` driven by the server's `onboarding_state` enum, not a client-side step counter.
