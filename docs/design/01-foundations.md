---
covers:
  - docs/design/tokens.json
  - packages/design-tokens/**
  - packages/ui-web/src/tokens/**
  - packages/ui-native/src/tokens/**
  - packages/ui-web/src/styles/**
  - packages/ui-web/src/lint/**
  - packages/ui-native/src/lint/**
reviewed: 2026-10-04
---

# HalalGoes — Design Foundations (token system)

**Status:** system of record for all four surfaces · **Date:** 2026-08-10
**Consumers:** customer app (Expo/RN), rider app (Expo/RN), restaurant web, admin web.
**Machine source:** [`tokens.json`](./tokens.json) — W3C DTCG format, feeds Style Dictionary → NativeWind preset + CSS custom properties. **This document explains the tokens; `tokens.json` *is* the tokens.** Where they disagree, `tokens.json` wins and this document is the bug.

---

## 0. The one-paragraph brief

HalalGoes is a **trust and verification** product that happens to sell food. Every restaurant in the catalogue is already halal-certified (customer spec C-12 R1: `EXPIRED` and `UNVERIFIED` restaurants are not merely de-emphasised, they are *invisible*). That inverts the usual food-delivery job of the badge: it is not a filter that separates good listings from bad ones, it is a **standing proof** attached to every listing, and the thing a customer looks for before they look at the photo. The system therefore has two visual registers that must never blur into each other:

- **Appetite register** — warm, saffron-forward, photo-led. This is where the HungerStation direction lives.
- **Verification register** — a reserved bottle-green *seal*, a brass ring, a shield glyph, absolute dates, and the certifying body's name in plain text. Nothing else in the system may use it.

Restaurant and rider surfaces run in a **third register — operational**: Midnight chrome, high contrast, dense, glanceable, no appetite appeal (a kitchen expeditor and a rider on a bike in July sun are not being sold to).

---

## 1. HungerStation research — what was verified, what was not

The client's direction is "as close to HungerStation as possible." This section records what was actually established, because several of the decisions below are deliberate departures and the reasoning only holds if the starting point is honest.

### 1.1 What is verified

| Fact | Source |
|---|---|
| HungerStation founded 2012 in Saudi Arabia; pioneer of online food delivery in KSA | [Delivery Hero — HungerStation brand page](https://www.deliveryhero.com/brands/hungerstation/) |
| Wholly owned by Delivery Hero since July 2023 (bought the remaining 37% minority for USD 297m); FY2022 revenue EUR 609m, +36%, positive EBIT > EUR 50m | [Delivery Hero newsroom](https://www.deliveryhero.com/newsroom/delivery-hero-takes-sole-ownership-of-hungerstation/) |
| Multi-vertical: restaurants, groceries, pharmacy, flowers — 55,000+ stores across 102+ cities | [Delivery Hero — HungerStation](https://www.deliveryhero.com/brands/hungerstation/) |
| The brand colour is a **bright yellow**; the 2024 mascot is "an animated box character in HungerStation's bright yellow colour with the letter 'H' engraved on the side" | [Campaign Middle East, 2024](https://campaignme.com/hungerstation-teases-an-out-of-the-box-mascot/) |
| A full rebrand was run by Delivery Hero's in-house brand studio, published April 2019, tagged *yellow, brandbook, typography, rider, packaging* | [Behance — Hungerstation: Rebranding Project](https://www.behance.net/gallery/78476193/Hungerstation-Rebranding-Project) |
| Logo eras: 2012–2014, 2014–2019, 2019–2024, 2024–present — i.e. the current mark is a 2024 revision of the 2019 rebrand | [Logopedia — HungerStation](https://logos.fandom.com/wiki/HungerStation) · [Wikimedia Commons, `Hunger station logo 2024.svg`](https://commons.wikimedia.org/wiki/File:Hunger_station_logo_2024.svg) |
| **Arabic-first UI with RTL support**, bilingual AR/EN switching, built for KSA/GCC | [VLink — food delivery app build guide referencing HungerStation](https://vlinkinfo.com/blog/cost-to-build-a-food-delivery-app-like-hungerstation) |
| Location-first onboarding: the app asks for location before showing a catalogue, then curates nearby restaurants/stores | [Appic Softwares teardown](https://appicsoftwares.com/blog/how-to-create-an-app-like-hungerstation/) |
| Prominent persistent search; restaurant menus organised into explicit categories and subcategories (appetisers/mains/desserts) | [Appic Softwares teardown](https://appicsoftwares.com/blog/how-to-create-an-app-like-hungerstation/) · [CSIT — Designing an App Like HungerStation](https://csit.sa/en/articles/designing-an-app-like-hungerstation) |
| Delivery Hero MENA runs a shared, scaled design system across its brands | [Amber Jabeen — Building and Scaling a Design System at Delivery Hero MENA](https://amberjabeen.com/portfolio/building-and-scaling-a-design-system-at-delivery-hero-mena/) |

### 1.2 What could NOT be verified — and what we did instead

> **The exact HungerStation brand hex is unverified.** This session's egress policy blocked direct fetches of `hungerstation.com`, `brandfetch.com`, `commons.wikimedia.org` and the app-store listings, so no first-party CSS token, brand book page, or logo SVG `fill` attribute could be read. **No hex is asserted as HungerStation's.** Anyone who later obtains the brand book should replace `color.brand.500` and re-run the contrast suite in §8.

What we derived instead, and why it is defensible:

- The brand is consistently described in independent sources as **bright yellow**, and the 2019 rebrand is literally tagged *yellow*.
- A "bright yellow" that is usable as a primary action colour has a narrow window: too pale and it disappears on white; too orange and it collides with the semantic warning ramp.
- We therefore set **`color.brand.500 = #FFC220`** — a saturated golden yellow (~hue 44°) that (a) reads as the same brand family a customer would recognise, (b) carries near-black text at **10.58:1**, and (c) leaves ≥3:1 luminance separation from our warning orange so the two are never confused.

**Every hex in §2 is labelled `HS-derived` or `ours`.** `HS-derived` means "chosen to sit in the colour family HungerStation is documented to use"; it does **not** mean "sampled from HungerStation".

### 1.3 Patterns adopted from HungerStation

- Warm yellow primary; near-black label on yellow (the only accessible way to use a yellow CTA).
- Location-first: no catalogue before an address. Matches C-14 `NO_ADDRESS`.
- Persistent, always-visible search field on the customer home — not a magnifier icon that expands.
- Menu organised as category tabs + item rows with thumbnail-right (spec C-13 already requires this).
- Bottom tab navigation as the primary customer wayfinding.
- Dense, information-rich cards over generous whitespace: a food-delivery home is a list of options, not a magazine.

### 1.4 Where we deliberately diverge (summary — full reasoning at each site)

| # | HungerStation | HalalGoes | Why |
|---|---|---|---|
| D1 | Yellow is the loudest thing on screen | The **halal seal** is the loudest thing on a card; brand yellow is reserved for actions | If the certification competes with the brand for attention, the brand wins, and we have shipped a yellow food app with a compliance footnote. The seal is the product. |
| D2 | Yellow/amber doubles as warning | Warning is **orange `#B84A08`**, never yellow | Brand yellow is spent on CTAs. Two ambers with different meanings is a defect. |
| D3 | Green used freely (success, promos, "free delivery") | **Green solid fills are reserved to the halal namespace.** Semantic success is tint-only, never a filled green pill | Measured: no two accessible greens achieve 3:1 luminance separation (§2.5). Hue cannot separate them, so **form** does. |
| D4 | Multi-vertical category tile grid on home (food / grocery / pharmacy / flowers) | **No vertical tile grid at V0/V1.** Cuisine chips + the fixed feed sections of C-09 | The tiles exist to route between verticals we do not have. Copying them builds empty rooms. |
| D5 | Halal status is one attribute among many, filterable | Halal is a **precondition, not a filter** (C-12 R1, C-11) — no halal filter control exists; a standing header states the guarantee once | A filter implies non-certified listings exist. They do not. Offering the control teaches the wrong model. |
| D6 | Consumer-warm rider app | Rider + restaurant surfaces use **Midnight operational chrome**, larger type, ≥7:1 body contrast | Sunlight legibility and never-miss-an-order beat appetite. Different job, different register. |
| D7 | Light-dominant | **Full dark-mode parity across all four surfaces** | Riders work at night; restaurant tablets sit in dim pass-throughs. Dark mode is an operational requirement, not a preference. |
| D8 | RTL-native Arabic-first | LTR `en-CA` only at launch, but **all layout uses logical properties**; RTL is a config flip, not a rewrite | We must not architect against the direction our customer base and our parent reference both come from. |
| D9 | Prices as formatted strings | `Price` accepts **`int64` cents only** and will not compile against a float | Platform §0.1: floats are banned in every money path. |

---

## 2. Colour

### 2.0 Reading the ramps

Every ramp has a **light value** and a **dark value** for each semantic *role*. Ramps themselves (the numbered steps) are theme-independent raw palette; **roles** (`text.primary`, `surface.raised`, `border.interactive`) are what components consume, and roles are what flip between themes. Components must never reference a numbered step directly — a lint rule enforces this (§9).

All ratios quoted below are computed, not estimated; the generator is in `docs/design/` history and reproduced in §8.

### 2.1 Primary — "Saffron" *(HS-derived)*

The brand and action colour. Appetite register.

| Step | Hex | Use |
|---|---|---|
| 50 | `#FFF9E6` | brand tint surface |
| 100 | `#FFF0BF` | tint hover |
| 200 | `#FFE694` | tint pressed |
| 300 | `#FFDB69` | dark-theme accents on Midnight chrome (14.23:1 on `#080F1C`) |
| 400 | `#FFD147` | dark-theme brand text (12.05:1 on `#1C1916`) |
| **500** | **`#FFC220`** | **brand base — primary button fill, active tab, brand marks** |
| 600 | `#DFA400` | brand fill pressed |
| 700 | `#A87C00` | brand fill on dark; icon on light |
| 800 | `#7A5800` | **brand text on light surfaces** (6.51:1) — `#FFC220` as text is 1.62:1 and is *banned* |
| 900 | `#513B00` | brand text AAA |
| 950 | `#2B1F00` | brand-tinted dark surface |

> **Hard rule:** brand 500/600 are *fills only*. Text on brand fill is `text.onBrand` = `#1F1B17` (10.58:1). White on brand yellow is 1.62:1 and is a build failure.

### 2.2 Accent — "Midnight" *(ours)*

Authority, chrome, operational surfaces. Chosen as a deep indigo-navy so it is unambiguously not the info blue (`#0B72E7`, brighter and cyan-shifted) and not the warm neutrals.

| Step | Hex | Use |
|---|---|---|
| 50 | `#EEF2F9` | accent tint |
| 100 | `#D6DFEE` | |
| 200 | `#B0C0DC` | |
| 300 | `#8098C4` | dark-theme accent text |
| 400 | `#5471A8` | |
| 500 | `#34528C` | secondary fill (7.69:1 with white) |
| **600** | **`#24406F`** | **secondary button fill, AppBar on restaurant/admin (10.30:1 with white)** |
| 700 | `#1B3157` | pressed |
| 800 | `#142542` | |
| 900 | `#0E1A2F` | rider AppBar / restaurant queue header |
| 950 | `#080F1C` | rider full-screen offer chrome (16.99:1 with `#F3F1ED`) |

### 2.3 Neutral — "Sand" *(ours)*

Warm-tinted greys (~hue 40°, very low chroma) so they sit under the saffron without going cold. Pure `#FFFFFF` and `#000000` are included but `#000000` is only ever a shadow colour.

| Step | Hex | Light role | Dark role |
|---|---|---|---|
| 0 | `#FFFFFF` | `surface.base`, `text.onDark` | `text.onBrand` never |
| 50 | `#FAF9F7` | `surface.sunken` (page bg) | — |
| 100 | `#F3F1ED` | `surface.subtle` | `text.primary` (15.51:1) |
| 200 | `#E7E3DC` | `border.decorative` | — |
| 300 | `#D5CFC5` | skeleton base | — |
| 400 | `#B6AEA1` | `text.disabled` (WCAG-exempt, §04-a11y) | `text.secondary` (7.96:1) |
| 500 | `#948C7E` | `border.interactive` (3.33:1), `text.placeholder` | skeleton highlight |
| 600 | `#6E6658` | `text.tertiary` (5.67:1) | `border.interactive` dark (3.09:1) |
| 700 | `#4A443B` | `text.secondary` (9.63:1) | `border.decorative` dark |
| 800 | `#332E28` | | `surface.raised` |
| 900 | `#1F1B17` | `text.primary` (17.11:1), `text.onBrand` | `surface.subtle` |
| 950 | `#12100D` | | `surface.base` |
| 1000 | `#000000` | shadow colour only | shadow colour only |

### 2.4 Semantic ramps *(ours)*

Four roles. Each has `.tint` (background), `.tintText`, `.solid` (fill), `.onSolid`, `.text` (on plain surface), `.border`.

| Role | Light tint / tintText | Light solid + label | Light text | Dark text | Notes |
|---|---|---|---|---|---|
| **success** | `#E7F7F0` / `#05603F` (6.89:1) | **no solid fill — see D3** | `#067A55` (5.35:1) | `#4FC79A` (8.31:1) | icon step `#0E9F6E` (3.39:1) |
| **warning** | `#FEF1E7` / `#8F3A06` (6.83:1) | `#B84A08` + white (5.22:1) | `#B84A08` (5.22:1) | `#F59A5C` (8.05:1) | **orange, ~28°** — 3.23:1 from brand yellow |
| **danger** | `#FDECEA` / `#912018` (7.58:1) | `#D92D20` + white (4.83:1) | `#B42318` (6.57:1) | `#F08C82` (7.32:1) | |
| **info** | `#E9F1FE` / `#07458F` (8.19:1) | `#0B72E7` + white (4.59:1) | `#0959B8` (6.70:1) | `#6FA9F2` (7.19:1) | was the focus ring base until Sep 2026 — focus now follows `border.brand` ([decision](../decisions/focus-indicator.md)) |

Full numbered ramps are in `tokens.json` (`color.success.50…900` etc.).

### 2.5 Halal certification colours — the reserved namespace ★

This is the most important section in the document.

**The constraint.** The brief requires that halal colours "must not collide with the semantic ramp". We tested whether that is achievable by hue and lightness alone. It is not:

```
halal seal #04482A  vs  success.solid #067A55   →  2.00:1   (needs ≥3:1 to be separable)
halal tint #E4F0E9  vs  success.tint  #E7F7F0   →  1.06:1   (indistinguishable)
```

There is no pair of greens that are both (a) individually accessible against white and against white text, and (b) 3:1 apart from each other. **Hue cannot be the separator.** So we separate by **form**, and enforce it:

> **RULE H-1 — the green-solid monopoly.** `halal.certified.seal` is the **only filled solid green surface in the entire design system**. Semantic success is tint-only: a light background with dark green text, an icon, or a 2px accent border. No component may render a filled green pill, chip, button, or badge outside the `halal.*` namespace. Enforced by the token lint in §9 and by a visual-regression rule.
>
> **RULE H-2 — the seal is composite.** A halal state is never "a colour". It is always `{ fill, ring, glyph, label }` shipped as one token group and one component (`HalalBadge`). A bare green dot is not a halal indicator and is a spec violation.
>
> **RULE H-3 — no red, ever.** No halal state uses the danger ramp. A red halal state reads as *haram* — a religious ruling. The platform explicitly does not make religious rulings (C-12 R6: "does not rank, score, or editorialise certifying bodies"; the standing line "HalalGoes does not itself certify food"; A-15 keeps issuing-body acceptance an admin registry decision). "We cannot currently vouch for this" is a **grey** statement, not a red one.

**The four states.**

| State | Light | Dark | Form | Orderable |
|---|---|---|---|---|
| **`CERTIFIED`** | fill `#04482A` · label `#FFFFFF` (**10.68:1**) · ring `#D4A72C` (4.76:1 vs fill) | fill `#0F7A46` · label `#FFFFFF` (5.39:1) · ring `#E3BE4A` (3.01:1 vs fill) | **Filled seal**: shield glyph + `Halal certified`, 1.5px brass outer ring, radius `md` | yes |
| **`EXPIRING_SOON`** | **card badge identical to CERTIFIED.** Panel note only: text `#7A5600` on tint `#FBF1D8` (5.91:1), clock glyph `#8A6100`, border `#D9BE7A` | note text `#E8C463` on `#2A2008` (9.56:1) | Seal unchanged + a separate **renewal note row** inside `HalalCertificationPanel` | yes |
| **`EXPIRED`** | fill `#4E5862` (cool slate) · label `#FFFFFF` (7.25:1) · tint `#EDEFF1` / text `#39424B` (8.87:1) | fill `#7C8794` (5.20:1 vs `#12100D`) · tint `#1B1F24` / text `#AEB6BF` (8.08:1) | Filled seal, **outline shield glyph** (not solid), no brass ring | **no** |
| **`UNVERIFIED`** | **customer surfaces render nothing.** Operational surfaces: transparent fill, 1.5px **dashed** border `#B6AEA1`, text `#6E6658` (6.71:1) | dashed border `#4A443B`, text `#B6AEA1` | Dashed outline, dashed shield glyph | **no** |

**Why the brass ring.** `#D4A72C` is the single point in the system where the brand's warm register touches the verification register. It does three jobs: it makes the seal read as a *seal* (a stamped, ringed mark) rather than a status chip; it visually claims the certification as a HalalGoes act, tying it to the brand; and it is a shape cue that no success toast will ever have. It is decorative — the seal's boundary against the page is already carried by `#04482A` vs `#FFFFFF` at 10.68:1 — so its own contrast against the page is not load-bearing.

**Why `EXPIRING_SOON` keeps the green card badge.** Spec C-12 says the card badge is unchanged and only the detail panel gets a renewal note. We keep that. Downgrading the badge would tell the customer the restaurant's halal status is in doubt, which is false: the certificate is valid today. The note is a *renewal* signal for transparency, not a *warning*. It uses the reserved brass-ochre tint rather than the semantic warning orange precisely so it does not read as an alert.

**Why `EXPIRED` is grey rather than a downgraded green.** Per C-12 R1 an expired restaurant is invisible to customers, so this state only appears on restaurant, admin, and rider surfaces. Grey says "the platform's knowledge has lapsed" — an administrative fact. Green-with-a-cross would say "this food is not halal", which we do not know and would not be entitled to publish. Cool slate (`#4E5862`) rather than the warm neutral ramp so the state reads as *a certification state*, not as disabled chrome.

**Namespacing.** All of the above live under `color.halal.*` in `tokens.json` and are exported to NativeWind as `halal-*` utilities and to CSS as `--hg-halal-*`. Nothing outside `HalalBadge`, `HalalCertificationPanel`, and the admin `HalalChecklist` may import them.

### 2.6 Data-visualisation and map colours *(ours)*

Admin charts and the rider/customer map need a categorical set that avoids all reserved meanings.

`viz.1 #24406F` · `viz.2 #0B72E7` · `viz.3 #7A5800` · `viz.4 #8E4EC6` · `viz.5 #B84A08` · `viz.6 #4E5862` · `viz.7 #0F766E` · `viz.8 #B42318`

Map roles: `map.route.active #0B72E7` (5px, 2px white casing) · `map.route.travelled #948C7E` · `map.pin.restaurant` = brand seal shape in `#FFC220` with ink glyph · `map.pin.customer` = `#24406F` · `map.pin.rider` = `#04482A` bearing arrow *(this is the one authorised use of the halal green outside the namespace — a rider pin is a HalalGoes rider; it is not a certification claim, it carries no shield, and it is registered as an explicit exception in the lint allowlist)*. Geofence circle: `#0B72E7` at 12% fill, 2px stroke.

---

## 3. Typography

### 3.1 Typefaces

One UI family across all four surfaces. Multiple families cost RN bundle size and font-load jank for no expressive gain in a product whose job is legibility.

| Role | Family | Weights shipped | Licence | Why |
|---|---|---|---|---|
| **UI (all text)** | **Plus Jakarta Sans** | 400, 500, 600, 700 | SIL OFL | Adopted Sep 2026 (`0cabf7c`), replacing Inter. Warmer, more distinctive at display sizes than a neutral grotesque, and ships as static weights so Expo `expo-font` does not need variable-font support. **It is weaker than Inter at disambiguating `1/l/I` and `0/O`** — so identifiers that must not be misread (certificate numbers, order numbers, unit numbers) are set in `typography.mono.*` with `font.numeric.tabular`, never in this face. |
| **RTL companion (not shipped at launch)** | **IBM Plex Sans Arabic** | 400, 500, 600, 700 | SIL OFL | Pre-selected now so §D8 holds: when Arabic is added the family swap is a token change, not a redesign. Vertical metrics are close enough to Plus Jakarta Sans that line-height tokens survive the swap. |
| **Data / mono (admin only)** | **JetBrains Mono** | 400, 600 | SIL OFL | Admin `DataTable` IDs, UUIDv7s, JSON payloads in audit views, cert numbers in the halal checklist. |

**Fallback chains** (used verbatim as the `fontFamily` value on web; RN registers the loaded family name and falls through to the platform default):

```
--hg-font-ui:   "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI",
                Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
--hg-font-rtl:  "IBM Plex Sans Arabic", "Noto Sans Arabic", "Geeza Pro",
                "Segoe UI", Tahoma, sans-serif;
--hg-font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo,
                Consolas, "Liberation Mono", monospace;
```

React Native has no fallback chain — a missing family renders the system font silently. So: **`expo-font` load is awaited at the splash gate**, and a startup assertion logs an error if `PlusJakartaSans_600SemiBold` is not resolvable. Never ship a screen that renders in a fallback the design was not measured against.

### 3.2 Numerals — non-negotiable

Prices, countdowns, distances, ETAs, earnings and order numbers all change in place. Proportional figures make them jitter, which on a 180-second restaurant response timer or a 30-second rider offer timer is an actual usability defect.

- **Web:** `font-variant-numeric: tabular-nums;` — applied by the `Price`, `Countdown`, `StatusTimeline`, `DataTable` and `Rating` components.
- **React Native:** `style={{ fontVariant: ['tabular-nums'] }}` — supported on iOS and on Android API 26+. Below that, `Countdown` pads with a fixed-width layout instead.
- **Currency:** always `$12.34`; the literal string `CAD` additionally on receipts and refund records (C-08 §0.1). Never `₹`, never a bare number.

### 3.3 The scale

Sizes are **unitless numbers**. On web, Style Dictionary emits `rem` (÷16) so the scale respects browser font-size settings. On RN, it emits raw numbers used as `fontSize` (density-independent pixels), scaled at runtime by the dynamic-type multiplier (§04-a11y §5).

Line-heights are given as a **unitless multiplier** (web `line-height: 1.5`) and as a **resolved px value** (RN `lineHeight`, which requires absolute units). Both are in `tokens.json`; the px value is the source of truth for RN and must be regenerated if a size changes.

| Token | Size | Line-height | Resolved LH | Weight | Tracking | Use |
|---|---:|---:|---:|---|---:|---|
| `display.lg` | 36 | 1.15 | 42 | 700 | −0.02em | Rider offer earnings; admin dashboard hero metric |
| `display.md` | 30 | 1.2 | 36 | 700 | −0.02em | Empty-state headline; checkout total |
| `heading.xl` | 24 | 1.25 | 30 | 700 | −0.01em | Screen title (restaurant name on detail) |
| `heading.lg` | 20 | 1.3 | 26 | 600 | −0.01em | Section header; sheet title; card title on `OrderCard` |
| `heading.md` | 18 | 1.35 | 24 | 600 | 0 | `RestaurantCard` name; modal title |
| `heading.sm` | 16 | 1.4 | 22 | 600 | 0 | `MenuItemCard` name; list-row title; feed section header |
| `body.lg` | 17 | 1.5 | 26 | 400 | 0 | **Rider app body** (one size up — read at arm's length, outdoors) |
| `body.md` | 15 | 1.5 | 22 | 400 | 0 | **Default body** (customer, restaurant, admin) |
| `body.sm` | 13 | 1.45 | 19 | 400 | 0 | Secondary metadata: cuisine list, distance, review count |
| `label.lg` | 15 | 1.2 | 18 | 600 | 0 | Button label (`md`/`lg`) |
| `label.md` | 13 | 1.2 | 16 | 600 | +0.01em | Button label (`sm`); tab label; chip |
| `label.sm` | 11 | 1.2 | 14 | 600 | +0.04em | **Badge and seal label** (`HALAL CERTIFIED` is `label.sm` at `medium` letter-spacing, sentence case — see below); overline |
| `caption` | 12 | 1.4 | 17 | 400 | 0 | Timestamps, disclaimers, the standing certification line |
| `mono.md` | 13 | 1.45 | 19 | 400 | 0 | Admin IDs, certificate numbers |
| `mono.sm` | 11 | 1.4 | 15 | 400 | 0 | Audit payloads |

**Casing.** The halal seal label is **"Halal certified"** — sentence case, exactly that string, per C-12 R7. Not `HALAL CERTIFIED`, not "100% Halal", not "Verified halal". `label.sm`'s letter-spacing gives it presence without shouting, and sentence case keeps it screen-reader-clean (all-caps is read letter-by-letter by some SR configurations).

**Minimum sizes.** Nothing below 11. Anything at 11 must be `600` weight and ≥4.5:1. `body.sm` (13) is the floor for any text a customer must read to make a decision.

**Rider deltas.** The rider app sets `body.md → body.lg` and `label.md → label.lg` as its defaults (a one-step bump applied at the theme level, not per component), and forces `text.primary` at ≥7:1.

---

## 4. Spacing

Base unit **4**. Named by multiplier so the arithmetic is visible at the call site.

| Token | Value | Typical use |
|---|---:|---|
| `space.0` | 0 | |
| `space.1` | 4 | icon↔label inside a chip |
| `space.2` | 8 | inside a badge; between a price and its strikethrough |
| `space.3` | 12 | list-row internal vertical; chip padding-x |
| `space.4` | 16 | **default gutter** — screen padding, card padding |
| `space.5` | 20 | |
| `space.6` | 24 | between card groups; section padding-y |
| `space.8` | 32 | between feed sections |
| `space.10` | 40 | |
| `space.12` | 48 | above a primary CTA in a sheet |
| `space.16` | 64 | empty-state vertical rhythm |
| `space.20` | 80 | |
| `space.24` | 96 | |

**Density modes.** One token, three values, set at the theme root:

| Mode | Surfaces | `density.rowHeight` | `density.cardPadding` | `density.gutter` |
|---|---|---:|---:|---:|
| `comfortable` | customer | 64 | 16 | 16 |
| `compact` | restaurant queue, admin tables | 44 | 12 | 12 |
| `roomy` | rider | 72 | 20 | 20 |

Components read `density.*`; they do not hard-code 16.

---

## 5. Radii

| Token | Value | Use |
|---|---:|---|
| `radius.none` | 0 | data-table cells; map overlays |
| `radius.xs` | 4 | checkbox, small chip |
| `radius.sm` | 8 | input, select, small button |
| `radius.md` | 12 | **default** — button, card, badge, **the halal seal** |
| `radius.lg` | 16 | `RestaurantCard`, modal |
| `radius.xl` | 20 | bottom sheet top corners |
| `radius.2xl` | 24 | rider full-screen offer sheet |
| `radius.full` | 9999 | avatar, pill chip, quantity stepper, FAB |

> The halal seal is `radius.md`, **not** `radius.full`. A pill reads as a tag; a softly-squared plate with a ring reads as a seal. This is the shape half of RULE H-2.

---

## 6. Elevation

Shadows must be expressed twice: web `box-shadow`, RN `shadowColor/shadowOffset/shadowOpacity/shadowRadius` + Android `elevation`. Both forms are in `tokens.json` under each level.

| Level | Web | RN (iOS) | Android `elevation` | Use |
|---|---|---|---:|---|
| `0` | none | none | 0 | flat on page |
| `1` | `0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.08)` | `{0,1}, .08, 3` | 1 | resting card |
| `2` | `0 2px 4px rgba(0,0,0,.06), 0 4px 8px rgba(0,0,0,.08)` | `{0,2}, .10, 6` | 3 | raised card, dropdown |
| `3` | `0 4px 8px rgba(0,0,0,.08), 0 8px 16px rgba(0,0,0,.10)` | `{0,4}, .12, 12` | 6 | sheet, popover |
| `4` | `0 8px 16px rgba(0,0,0,.10), 0 16px 32px rgba(0,0,0,.12)` | `{0,8}, .16, 24` | 12 | modal, rider offer sheet |
| `sticky` | `0 -2px 8px rgba(0,0,0,.08)` | `{0,-2}, .10, 8` | 8 | floating cart bar, sticky checkout footer (shadow points **up**) |

**Dark mode does not use shadows for hierarchy** — a black shadow on a near-black surface is invisible. In dark themes, elevation resolves to a **surface step** instead: `surface.base #12100D` → `surface.subtle #1F1B17` → `surface.raised #332E28`, plus a 1px `border.decorative` hairline at level ≥3. `tokens.json` carries both; the theme picks.

---

## 7. Motion

### 7.1 Durations

| Token | ms | Use |
|---|---:|---|
| `duration.instant` | 75 | press state, checkbox tick |
| `duration.fast` | 120 | hover, chip toggle, tooltip |
| `duration.base` | 180 | **default** — most enter/exit |
| `duration.moderate` | 240 | sheet, dropdown, toast |
| `duration.slow` | 320 | modal, screen transition |
| `duration.deliberate` | 480 | `StatusTimeline` step advance; halal seal first reveal |

### 7.2 Easing

| Token | Curve | Use |
|---|---|---|
| `easing.standard` | `cubic-bezier(0.2, 0, 0, 1)` | default both-ways |
| `easing.decelerate` | `cubic-bezier(0, 0, 0, 1)` | entering |
| `easing.accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | exiting |
| `easing.emphasized` | `cubic-bezier(0.2, 0, 0, 1.05)` | sheet arrival, seal reveal (tiny overshoot) |
| `easing.linear` | `linear` | **countdowns and progress only** |

### 7.3 Springs (RN Reanimated)

| Token | Config | Use |
|---|---|---|
| `spring.snappy` | `{damping: 22, stiffness: 320, mass: 1}` | quantity stepper, chip |
| `spring.smooth` | `{damping: 26, stiffness: 200, mass: 1}` | bottom sheet |
| `spring.gentle` | `{damping: 30, stiffness: 140, mass: 1}` | map camera, card entrance |

### 7.4 Rules

1. **Countdowns are linear and server-anchored.** The 180 s restaurant response window (R-24), the 30 s rider offer (D-14/D-15) and the 15 min cart TTL animate `linear` from `server_expires_at − measured_skew`, never from a local constant, never eased. Easing a deadline misrepresents remaining time.
2. **Nothing blocks on animation.** Every transition is interruptible; a tap during an exit is honoured.
3. **`prefers-reduced-motion` / `isReduceMotionEnabled`** collapses all durations to `0ms` and replaces slide/scale with cross-fade at `duration.fast`. Countdown *numerals* keep updating — the information is not decoration.
4. **The halal seal never animates on scroll, never pulses, never shimmers.** It appears with the card. A moving trust mark reads as an advertisement.
5. Map camera moves are `spring.gentle` and never re-centre while the user is panning.

---

## 8. Contrast verification

Every pair in this document was computed with the WCAG 2.1 relative-luminance formula. The generator is checked in as `docs/design/contrast.check.mjs` (to be added by the implementing agents against `tokens.json`) and must run in CI. Failing pairs are build failures, not warnings.

Targets, restated from `04-accessibility.md`:

- Body text ≥ **4.5:1**; rider body text ≥ **7:1**.
- Large text (≥18.66px @700, or ≥24px) ≥ **3:1**.
- Non-text UI boundaries — input borders, focus rings, toggle tracks, the seal edge — ≥ **3:1** (WCAG 1.4.11).
- **The halal seal targets ≥7:1 in both themes** and achieves 10.68:1 light / 5.39:1 dark. The dark value is the one weak point in the system; it is AA not AAA because a green dark enough for AAA-on-white is invisible against a `#12100D` page. Dark-mode seals therefore carry the brass ring at full 1.5px and a 1px `#1F1B17` outer separator.

**Known exemptions** (documented, not accidental):

| Pair | Ratio | Justification |
|---|---:|---|
| `text.disabled` `#B6AEA1` on white | 2.20 | WCAG 2.1 §1.4.3 exempts disabled controls. Disabled state is *additionally* signalled by 60% opacity on the whole control and `aria-disabled`. |
| `border.decorative` `#E7E3DC` on white | 1.28 | Purely decorative dividers carry no information; they never delimit an interactive control. Any border that bounds a control uses `border.interactive` `#948C7E` (3.33:1). |
| brass ring `#D4A72C` vs page | 2.24 | Decorative. The seal's informational boundary is the green against the page at 10.68:1. |

---

## 9. Token pipeline and lint rules

```
tokens.json  (W3C DTCG, single source)
   └─ Style Dictionary
        ├─ packages/tokens/nativewind-preset.js   → Expo apps (customer, rider)
        ├─ packages/tokens/tokens.css             → :root + [data-theme="dark"] custom properties
        ├─ packages/tokens/tokens.ts              → typed TS object for RN StyleSheet + tests
        └─ packages/tokens/tokens.d.ts            → literal union types for token names
```

**Lint rules.** All seven are specified to block CI. **Only rule 4, no green solids, is implemented today** (Sep 2026). The other six are specification only; the contrast checker that rule 6 needs (`contrast.check.mjs`) does not exist yet.

1. **L-1 no raw colour.** No hex, `rgb()`, `hsl()` or named colour literal in any `apps/**` file. Only token references.
2. **L-2 no ramp steps in components.** Components reference *roles* (`text.primary`), never steps (`neutral.700`). Only the theme files map steps to roles.
3. **L-3 halal namespace.** `color.halal.*` may only be imported by `HalalBadge`, `HalalCertificationPanel`, `HalalChecklist` (admin), and the map-pin module (registered exception, §2.6).
4. **L-4 no green solids.** No filled background may resolve to a colour whose hue is 100°–180° unless it comes from `color.halal.*`. This is RULE H-1 in executable form. Implemented in `packages/ui-web/src/lint/l4-no-green-solids.ts` and run by `pnpm lint` (part of `pnpm check`) over `@hg/ui-web`, `@hg/ui-native` (ESLint), marketing and all four apps. A `var()` is exempt only if it resolves to a real `color.halal.*`, map-pin or chrome token; a name that matches no token is not, and its fallback colour is judged instead. Colours applied from script (`el.style.background = …`) are checked too.
5. **L-5 no float money.** Any `Price`/`Money` prop typed as `number` must be documented `int64 cents`; a `.toFixed(` or `parseFloat(` in a pricing path is a failure (mirrors the platform migration linter that bans `money`/`double precision`/`real`).
6. **L-6 contrast.** `contrast.check.mjs` walks every `{fg, bg}` pair declared in `tokens.json`'s `_pairs` block and fails below target.
7. **L-7 no physical properties.** `marginLeft`/`paddingRight`/`left`/`right`/`textAlign: 'left'` are banned in favour of `marginStart`/`paddingEnd`/`start`/`end`/`textAlign: 'start'`. This is what makes D8 (RTL readiness) real rather than aspirational.

---

## 10. Theming model

Three themes, not two. Each is a role→value map over the same ramps.

| Theme | Surfaces | Notes |
|---|---|---|
| `consumer` | customer app, both colour schemes | Saffron-forward, `comfortable` density, elevation-by-shadow (light) / surface-step (dark). |
| `operational` | restaurant web, admin web | Midnight chrome, `compact` density, brand yellow restricted to primary CTAs only. Success/warning/danger carry more of the visual load because these surfaces are status-driven. |
| `field` | rider app | Midnight `900/950` chrome, `roomy` density, `body.lg` default, **all body text ≥7:1**, no photographic imagery behind text, minimum touch target 56 (not 44). |

All three share one `tokens.json`. A surface never defines a colour; it selects a theme and overrides `density` and the type-scale default.

---

## 11. Iconography

- **Set:** Lucide (ISC licence) — 24px grid, 2px stroke, consistent across web (`lucide-react`) and RN (`lucide-react-native`).
- **Sizes:** `icon.sm 16` · `icon.md 20` · `icon.lg 24` · `icon.xl 32` · `icon.2xl 48` (rider/empty states).
- **Stroke:** 2px at `md`+; 1.75px at `sm` to keep optical weight even.
- **The shield is bespoke.** The halal shield glyph is a custom asset, not `lucide/shield-check`, so it cannot be reused accidentally and cannot collide with a security icon elsewhere. Four variants: solid (certified), outline (expired), dashed (unverified), solid-with-clock (panel renewal note). Shipped as an inline SVG component per platform; **never** as a font glyph (font glyphs fail silently and would render a blank certification badge).
- Icons are decorative by default (`aria-hidden` / `accessibilityElementsHidden`) unless they are the sole content of a control, in which case the control carries the label.

---

## 12. Imagery

- **Aspect ratios:** restaurant hero `16:9`; restaurant card thumb `4:3`; menu-item thumb `1:1`; rider proof-of-delivery `4:3`.
- **All restaurant and item imagery is remote** (`restaurants.hero_object_key` via the media CDN). C-13 R4 forbids bundled restaurant photographs, and a test asserts it. Placeholders are generated cuisine-derived gradients from the neutral + saffron ramps, never stock food photography.
- **Every image sits on a `neutral.200` plate** so a failed load is a visible empty plate, not a layout collapse.
- **No text is ever composited over an image without a scrim.** Scrim: linear gradient `rgba(31,27,23,0)` → `rgba(31,27,23,0.72)` over the bottom 55%. The halal seal is **never** placed on an image — it sits on the card's solid surface below the hero. (This is divergence D1 in practice: a seal floating on a photo is a sticker; a seal on the card body is a credential.)

---

## 13. Open questions for the client

1. **Brand hex.** `#FFC220` is derived, not sampled (§1.2). If the client can supply the HungerStation brand book or a licensed brand kit, replace `color.brand.500` and re-run §8. Nothing else in the system depends on the exact value — the accessible pairings are all against `text.onBrand`.
2. **HalalGoes has its own wordmark.** This document specifies no logo. A yellow-and-green mark that includes a seal motif would let the badge and the logo reinforce each other; that is a brand-design engagement, not a token decision.
3. **Density preference on the restaurant tablet.** `compact` assumes a 10" tablet at arm's length in a kitchen. If the deployment is a phone, the queue needs `comfortable` and a two-column layout instead of four.
