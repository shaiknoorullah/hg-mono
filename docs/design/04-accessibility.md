---
covers:
  - packages/ui-web/src/certification/**
  - packages/ui-native/src/certification/**
  - packages/ui-web/src/styles/**
reviewed: 2026-10-09
---

# HalalGoes — Accessibility Standard

**Status:** system of record · **Date:** 2026-08-10
**Target:** WCAG 2.2 Level AA across all four surfaces, with named AAA commitments where the product's claim depends on it.
**Depends on:** [`01-foundations.md`](./01-foundations.md), [`02-components.md`](./02-components.md), [`03-patterns.md`](./03-patterns.md), [`tokens.json`](./tokens.json)

---

## 0. Why this document is not boilerplate

HalalGoes is a religious-dietary compliance product. Its single claim — *this restaurant's halal certification has been verified* — is communicated by a coloured badge with an icon. That is exactly the construction that fails for the largest accessibility populations: colour-vision deficiency (~8% of men), low vision, and screen-reader users. **A halal badge that is only legible to a sighted, full-colour user is not a working feature.** Accordingly:

> **A-0.** The halal certification state must be recoverable through **three independent channels**: colour, shape/glyph, and text. Any two channels removed, the state must still be unambiguous. This is tested, not assumed (§9).

Everything else in this document is ordinary AA diligence. §3 is not.

---

## 1. Contrast

### 1.1 Targets

| Content | Target | Where |
|---|---|---|
| Body text | **4.5:1** (AA 1.4.3) | all surfaces |
| **Rider body text** | **7:1** (AAA) | `field` theme — sunlight legibility, not a preference |
| Large text (≥24px, or ≥18.66px @700) | 3:1 | all |
| **Halal seal label on seal** | **7:1** target | achieved 10.68:1 light |
| Non-text UI boundaries — input borders, switch tracks, focus rings, the seal edge | **3:1** (AA 1.4.11) | all |
| Icons carrying meaning | 3:1 | all |
| Charts/map routes | 3:1 against adjacent | admin, tracking |

Every pair is enumerated in `tokens.json` `_pairs` and checked in CI by `contrast.check.mjs`. **A failing pair is a build failure**, not a warning. Measured values for the whole palette are in foundations §2 and §8.

### 1.2 Documented exemptions

Three, all recorded in `_pairs` with a `note`:

| Pair | Ratio | Basis |
|---|---:|---|
| `text.disabled` on surface | 2.20 | WCAG 1.4.3 explicitly exempts disabled controls. Compensated: disabled state is *also* 60% opacity on the whole control, *also* `aria-disabled`, and — per §5 — a disabled control that a user might reasonably expect to be enabled must state why. |
| `border.decorative` on surface | 1.28 | Decorative dividers convey nothing and never bound an interactive control. Any border that bounds a control uses `border.interactive` at 3.33:1. |
| brass ring on page | 2.24 | Decorative. The seal's informational boundary is `#04482A` against the page at 10.68:1. |

### 1.3 The one weak spot, stated openly

The dark-theme halal seal is **5.39:1 (AA)**, not AAA. A green dark enough to hit 7:1 against white text is effectively invisible against a `#12100D` page, so the dark seal is necessarily lighter. Compensation: the dark seal always carries the full 1.5px brass ring **plus** a 1px `#1F1B17` outer separator, giving it two boundaries rather than one. No other token in the system falls short of its target.

### 1.4 Not-by-colour-alone

WCAG 1.4.1 in this system means, concretely:

- Every `Badge`, `Banner`, `Toast` and `Chip` that carries a status carries **an icon and a word**. There is no bare coloured dot anywhere.
- `OrderCard` `urgent` and `late` add a text badge, not just a border colour.
- `Countdown` `urgent`/`critical` change colour **and** the numeral is itself the information.
- Veg/non-veg markers are distinct **glyphs** (square-in-square filled vs outline), not a green dot and a red dot.
- `DataTable` selected rows have a checkbox, not just a tint.
- The halal states are four **different glyph forms** (§3.2) before they are four colours.

---

## 2. Touch targets and pointer

| Token | Size | Applies |
|---|---:|---|
| `target.min` | **44** | absolute floor, every surface, every control (WCAG 2.5.8 AA requires 24; we take Apple HIG / WCAG 2.5.5 AAA at 44) |
| `target.field` | **56** | every control in the rider app |
| `target.criticalField` | **72** | rider Accept/Decline; restaurant Accept-order |
| `target.spacing` | **8** | minimum gap between adjacent targets |

Rules:

- If the visual is smaller than the target, the hit area is expanded (RN `hitSlop`, web `::after` overlay). The visual never grows to meet the rule when that would break the layout — the *hit area* grows.
- **Never two overlapping targets.** A `ListRow` with a trailing `Switch` is not itself pressable; the switch is the control. This is the most common RN accessibility defect and is caught by a lint rule.
- Destructive and constructive actions in a timed decision are **≥24 apart** (rider offer, restaurant accept). An accidental Decline under a 30-second clock is unrecoverable.
- Pointer surfaces (restaurant web, admin) must be **fully operable by keyboard alone**; no action is hover-only or drag-only. Drag-to-reorder in the menu editor has a keyboard alternative (move up/move down in the row menu) — WCAG 2.5.7.
- No path-based gestures are required (2.5.1). Map pinch-zoom has button equivalents.
- Long-press is never the only way to reach an action.

---

## 3. Screen-reader labelling for the halal states ★

The most important section in this document.

### 3.1 Fixed accessible labels

These strings are **fixed, reviewed, and not templatable by callers** (C-12 R7 fixes the visible copy; this fixes the spoken copy):

| `halal_display_state` | Visible label | Accessible label |
|---|---|---|
| `CERTIFIED` | "Halal certified" | **"Halal certified"** |
| `EXPIRING_SOON` | "Halal certified" (identical) | **"Halal certified"** (identical) |
| `EXPIRED` | "Certification expired" | **"Halal certification expired. This restaurant cannot take orders."** |
| `UNVERIFIED` | *(customer: nothing)* | *(customer: nothing)* · operational: **"Halal certification not verified."** |
| `null` / absent / unknown | *(nothing)* | *(nothing)* + `reportClientError('HALAL_DISPLAY_STATE_MISSING')` |

On native, the redesign surface's `HalalCertificationPanel` (`@hg/ui-native/ds`) applies the same rule to the whole panel: a missing or unknown `display_state` renders nothing and reports `CERTIFICATION_PANEL_STATE_MISSING`, and `UNVERIFIED` renders nothing. The same client-error reporter also carries two non-halal codes from that surface: `ICON_NAME_UNKNOWN` and `MONEY_NOT_INTEGER_CENTS`.

C-12 acceptance criterion 2 asserts the exact string "Halal certified" is present as an accessible label on all six card surfaces (feed, search, favourites, order history, receipt, detail header). That assertion is a snapshot test and it is the reason the label is not parameterised.

### 3.2 The three channels (A-0 in practice)

| Channel | `CERTIFIED` | `EXPIRING_SOON` | `EXPIRED` | `UNVERIFIED` |
|---|---|---|---|---|
| **Colour** | bottle green + brass ring | *(identical to certified)* | cool slate | transparent |
| **Shape/glyph** | **solid** shield | **solid** shield | **outline** shield | **dashed** shield + dashed border |
| **Text** | "Halal certified" | "Halal certified" | "Certification expired" | "Not verified" |

Read the row for `EXPIRED` in greyscale: the shield is hollow and the word says "expired". Read it with no shapes: the word says "expired". Read it with no text: the shield is hollow against a slate plate, distinct from the filled ringed plate. Three channels, any two sufficient.

`EXPIRING_SOON` is *deliberately* identical to `CERTIFIED` on all three channels, because it *is* certified today. Its signal lives only in the panel's renewal note, which is itself text-first.

### 3.3 The detail-page announcement

On `HalalCertificationPanel`, the seal's accessible name extends to carry the value rather than the state name:

> *"Halal certified by {certifying_body_name}. Valid until 14 March 2027. Double tap for certificate details."*

The certifying body's name is in the **first sentence**, not buried below. C-12 R6 forbids the platform from ranking or editorialising certifying bodies, and the C-04 decision refuses to encode madhhab or method — which means the customer applies their own standard, which means they must be told *who certified it*. For a screen-reader user, "who" must arrive without opening a panel.

Dates are always **absolute** in the accessible name ("14 March 2027"), never relative ("in 7 months"). C-12 requires absolute expiry display; the same applies to speech.

### 3.4 Reading order on a card

`RestaurantCard`'s accessible name concatenates in this order:

> *"{name}. **Halal certified.** {cuisines}. {rating} stars, {count} reviews. {distance} kilometres. {eta} minutes. {availability}."*

The halal state comes **second, immediately after the name** — before rating, before distance, before price. A screen-reader user hears the certification in the first two seconds of every card, matching what a sighted user sees at the top of every card. This ordering is asserted by test.

### 3.5 The certification panel as a landmark

`HalalCertificationPanel` is `role="region"` with `aria-labelledby` pointing at a **visually present** "Halal certification" heading. Consequences:

- It appears in the landmark list and the heading list.
- It is reachable by heading navigation from the top of the restaurant detail page **without traversing the menu**. An SR user must not have to pass 40 menu items to reach the certification.
- The "View certificate" action announces that the view is recorded (`certificate_view_audit`), because a viewer that silently logs identity is a dark pattern regardless of legitimacy.

### 3.6 What must never happen

- The seal is **never** the sole content of a link.
- The seal **never** animates, pulses or shimmers (foundations §7.4 rule 4). A moving trust mark reads as an advertisement, and motion-sensitive users lose access to it.
- The seal is **never** rendered from a cached, defaulted, or optimistic value. If `halal_display_state` is absent, nothing is drawn and a client error is reported (C-12 R4/AC5). **"Assume certified" is the single worst failure mode this product has**, and it is a failure mode that hurts screen-reader users first, because they have the least opportunity to notice a badge that should not be there.
- The visible label and the accessible label **never diverge** for the halal states. Test-asserted.

---

## 4. Focus handling

### 4.1 The indicator

**One indicator per control, in the theme's focus colour** — `theme.*.focus.ring`, which is `border.brand` (`brand.600` light, `brand.400` dark). Why, and what it replaced: [`docs/decisions/focus-indicator.md`](../decisions/focus-indicator.md).

**Bordered fields** (`Input`, `Textarea`, `Select`) — focus *is* the field's own border:

```
field edge: 1px border.interactive  →  2px theme.*.focus.ring
            (4.30:1 on control.bg, 3.91:1 on surface.sunken; dark 5.9–6.2:1)
```

No ring, no glow. The system has no coloured shadows: elevation shadows are neutral and dark mode drops shadows entirely, so a glow would be an invented, light-only effect. On web the second pixel is an inset shadow so the change never shifts layout, and a transparent outline stays in place for forced-colors mode, which strips shadows. An **invalid** field keeps its 2px danger border — that border means "error" and cannot also mean "focused" — so it takes the two-layer ring below.

**Borderless controls** (buttons, links, cards, chips) have no edge to recolour, so they take the **two-layer ring** — two layers because no single colour clears 3:1 on every container we ship (the token generator measures each container and reports the flip set):

```
control edge
  └─ 2px offset  in the container's own colour (theme.*.focus.offset)
      └─ 3px ring in theme.*.focus.ring   (brand.600 light / brand.400 dark)
          ...flipping to theme.*.focus.onColor on any coloured container
             where the ring measures < 3:1
```

`outline: none` without a replacement is a lint failure. The ring is never clipped by `overflow: hidden` — containers that clip use an inset ring variant.

### 4.2 Movement

- **Modals and sheets** trap focus; focus enters on open and **returns to the trigger** on close.
- Focus lands on the **least destructive** action in a confirm dialog.
- **The rider offer sheet** takes focus on mount, traps it, and cannot be dismissed by Escape or back before server `expires_at` — it is the one place where trapping without an escape is correct, because the alternative is a rider silently losing a job.
- When an error replaces content the user was acting on, focus moves to the error.
- Route changes move focus to the new page's `h1` and announce the page name.
- **Focus is never moved on a data refresh.** A polled tracking screen or a live restaurant queue must not steal focus every 15 seconds.
- Toasts do not take focus; they announce. Toasts with actions are persistent and reachable in the tab order.

### 4.3 Keyboard (web surfaces)

| Key | Behaviour |
|---|---|
| `Tab` / `Shift+Tab` | forward/back through interactive elements in DOM order |
| `Arrow` | within composites: `RadioGroup`, `Tabs`, `BottomNav`, `DataTable` grid, `Select` list, chip rows, the one-time-code boxes of `Input` |
| `Home` / `End` | first/last within a composite |
| `Enter` / `Space` | activate (`Space` on buttons/checkboxes, `Enter` on links) |
| `Escape` | close dismissible sheet/modal/popover, clear a search field |
| type-ahead | jump within `Select` and `DataTable` |

A skip link ("Skip to main content") is the first focusable element on every web page. Admin adds "Skip to table". Tab order follows visual order in both LTR and RTL, because order is derived from the DOM and the DOM is direction-agnostic (§7).

---

## 5. Dynamic type

- **Web:** the type scale emits `rem`. A user's browser font-size setting scales everything. Text must remain functional to **200% zoom** (WCAG 1.4.4) with no loss of content and no horizontal scrolling at 320 CSS px width (1.4.10). Text-spacing overrides (1.4.12) must not clip — line-height 1.5×, paragraph 2×, letter 0.12em, word 0.16em.
- **React Native:** `fontScale` from `useWindowDimensions()` multiplies the scale. Applied globally at the theme root, **not** per component.
  - Scaling is **capped at 1.6×** for structural chrome (`BottomNav` labels, `AppBar` title, `Tabs`) to prevent navigation collapse. It is **uncapped** for body content, prices, addresses, and — explicitly — every halal string.
  - `allowFontScaling={false}` is **banned** by lint, with exactly one registered exception: the `Countdown` numeral, which uses a fixed-width layout so digits do not reflow. The countdown's surrounding label scales normally.
- **Layouts reflow, they do not clip.** Any row that would overflow at 200% wraps to a stacked layout. `RestaurantCard` metadata wraps to two lines; `OrderCard` action rows stack. Tested at 1.0×, 1.3×, 2.0× and 3.0× in snapshot.
- **Truncation rules.** Restaurant and item names truncate at 2 lines with an ellipsis **and** carry the full string in the accessible name. `special_instructions` **never truncate** (R-23 R2, D-19) — they scroll. Halal labels **never truncate**.
- Bold-text and increase-contrast OS settings are honoured: bold-text raises `regular`→`medium` and `semibold`→`bold`; increase-contrast swaps `border.decorative`→`border.interactive` and `text.tertiary`→`text.secondary`.

---

## 6. Motion, timing and interruptions

- `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled` collapses all durations to `0ms` and replaces slide/scale with cross-fade at `duration.fast`. **Countdown numerals keep updating** — they are information, not decoration.
- No auto-advancing carousels anywhere (WCAG 2.2.2). Horizontal feed sections advance only on user gesture.
- No content flashes more than 3×/second (2.3.1). The `Countdown` `critical` 1 Hz pulse is well under, and is suppressed entirely under reduced-motion.
- **Timed decisions** (2.2.1). The system has real deadlines that cannot be extended client-side: 180 s restaurant response, 30 s rider offer, 15 min cart. These fall under the *Real-time Exception* — the deadline is an essential property of a live marketplace, not an arbitrary session timer. What we owe instead:
  - the remaining time is always visible and always announced at 50%/25%/10%/0;
  - expiry is explained ("Offer expired", "Response window closed"), never silent;
  - **the rider sheet never dismisses early** — the shipped app's 7-second dismissal against a 5-minute window is the exact failure this rule exists to prevent;
  - expiry is never presented as the user's fault.
- Session/auth expiry (15 min access token) is invisible: refresh rotates silently. A user is never dropped mid-form.

---

## 7. RTL readiness

We ship **LTR `en-CA` only** at V1 (customer spec §0.1: no i18n layer, all copy English). We nonetheless architect for RTL, because HungerStation — the explicit reference — is Arabic-first and RTL-native, and because a large share of the Canadian halal market reads Arabic or Urdu.

**What is enforced now, at zero cost:**

1. **Lint L-7 bans physical properties.** `marginLeft`/`paddingRight`/`left`/`right`/`textAlign:'left'` are build failures. Only `marginStart`/`paddingEnd`/`start`/`end`/`textAlign:'start'`.
2. **Directional icons are mirrored by role, not by asset.** Back chevrons, "next" arrows, progress arrows and the `StatusTimeline` direction carry `rtlFlip`. Icons that must **not** mirror are explicitly marked: the halal shield, clocks, checkmarks, media controls, and any logo.
3. **`I18nManager.allowRTL(true)`** is set in both Expo apps from day one, and `forceRTL` is never called.
4. **Numbers, prices, phone numbers and dates stay LTR** inside RTL text via isolation (`⁨…⁩` / `unicodeBidi: 'isolate'`). A price rendered without isolation in an RTL run is a classic and very visible bug.
5. **Layout is flex-based**, never absolute-positioned by side.
6. **Snapshot tests run in both directions** with a forced-RTL fixture, from the first component. The suite is the thing that keeps this real rather than aspirational — an untested RTL claim decays within one sprint.
7. **The RTL typeface is pre-selected** (IBM Plex Sans Arabic, foundations §3.1) with vertical metrics close enough to Inter that the line-height tokens survive the swap.

**What is deferred:** translated copy, plural rules, Arabic-Indic numeral preference, and locale-aware date formatting. These need a translation pipeline and a copy review that includes the religious terminology — "halal certified" is not a phrase to hand to a general-purpose translator.

---

## 8. Per-surface specifics

| Surface | Additional requirements |
|---|---|
| **Customer (RN)** | VoiceOver + TalkBack full pass on the V0 12 features. Every image has `alt`. The floating cart bar is announced when it appears. Address selection is fully operable without the map. |
| **Rider (RN)** | ≥7:1 all body text. 56/72 targets. Offer sound + haptic must fire in silent mode when `ONLINE_IDLE` (Android `IMPORTANCE_HIGH` + DND-bypass opt-in; iOS time-sensitive). One-handed reach: every primary action in the bottom third. **No hover, no tooltips.** Screen brightness is not fought — the design assumes maximum brightness outdoors. |
| **Restaurant (web)** | The queue must be operable entirely by keyboard. **Audio alerts are mandatory and must survive autoplay policy** via a one-time gate before the queue is usable — a silent queue is a broken queue, and this is an accessibility issue for deaf staff too, so the audible alert is always paired with a visual flash on the board and an OS-level notification. |
| **Admin (web)** | Full `DataTable` grid keyboard navigation. `aria-sort` on every sortable column. The halal checklist is a `fieldset` per check with a legend; locked checks are `aria-readonly` with the reason in `aria-describedby`. Every destructive action is a labelled `alertdialog`. |

---

## 9. Testing and enforcement

**Automated, CI-blocking:**

| Check | Tool | Blocks |
|---|---|---|
| Token contrast across `_pairs` | `contrast.check.mjs` | build |
| Component a11y violations | `jest-axe` (web), `@testing-library/react-native` a11y queries | build |
| Every interactive element has an accessible name | custom lint | build |
| No `allowFontScaling={false}` outside the registered exception | lint | build |
| No physical direction properties (L-7) | lint | build |
| No raw colour / no ramp steps / halal namespace (L-1, L-2, L-3, L-4) | lint | build |
| Snapshot × {light, dark} × {LTR, RTL} × {1.0×, 2.0×} | jest snapshot | build |
| **`HalalBadge` accessible label matches the fixed string, all four states, all six card surfaces** | snapshot (C-12 AC2) | build |
| **`HalalBadge` renders nothing + reports an error when `halal_display_state` is absent** | component test (C-12 AC5) | build |
| **`CERTIFIED` and `EXPIRING_SOON` card renders are byte-identical** | snapshot | build |
| **Greyscale + glyph-stripped renders of the four halal states remain distinguishable** (A-0) | visual regression | build |

**Manual, per release:**

- VoiceOver (iOS) and TalkBack (Android) walkthrough of the V0 43 features, with the halal surfaces as a named gate.
- Keyboard-only walkthrough of the restaurant queue and the admin halal checklist.
- 200% zoom pass on both web surfaces.
- **Outdoor sunlight test of the rider app.** Not simulable. Someone takes a phone outside at midday and reads an offer.
- Colour-vision simulation (protanopia, deuteranopia, tritanopia, achromatopsia) across all four halal states and the veg/non-veg markers.

**Definition of done for any screen:** its Empty, Loading and Error states each pass the automated suite, not just its happy state. `03-patterns.md` §5 is the checklist.

---

## 10. Known gaps

Stated so they are decisions, not oversights.

1. **Dark-theme halal seal is AA (5.39:1), not AAA.** §1.3. Mitigated by a double boundary. Revisit if the brand ever permits a lighter seal with a dark label.
2. **No cognitive-accessibility review yet.** WCAG 2.2's new criteria (3.2.6 Consistent Help, 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication) are met structurally — the Help hub is reachable from every screen, addresses and payment methods are saved and re-offered, and OTP fields accept paste with `autoComplete="one-time-code"` — but no plain-language review of the copy has been done. The certification panel's copy in particular is legally-flavoured and deserves one.
3. **Arabic and Urdu are not shipped.** §7 makes them cheap to add; it does not make them present. The religious terminology needs a reviewer, not a translator.
4. **No formal VPAT.** Out of scope at V1; the evidence to produce one is being generated by §9 from the first commit.
