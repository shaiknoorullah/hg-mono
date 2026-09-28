# Halal Goes — design research

_Deep research (Aug 2026): flows, journeys, UI/UX references for all four apps + palette / icon / map directions. Anchor: HungerStation's energy, made cleaner. Raw agent output in `design-research-raw.json`._

## Executive summary

Halal Goes should read as "HungerStation's energy, made cleaner." The client's reference app gets its life not from yellow alone but from a division of labor most delivery apps miss: gold is the frame (logo, active nav, "Add"/"Apply" CTAs, location pin), magenta/maroon is a dedicated PROMO register, and blue carries "free delivery" links. hg's existing gold baseline (#FFC220) already passes every contrast gate; the single missing ingredient is that promo/discount accent layer. Adding it — as an isolated namespace that never touches semantic or halal roles — is the lowest-risk way to import HungerStation's punch without recalibrating anything.

The product's one load-bearing claim is halal verification, and the research repeatedly surfaces the same structural lesson from competitors: dietary/allergen trust is almost always reduced to a generic free-text box (an independent audit found 80% of DoorDash/Uber Eats restaurants expose nothing better). hg wins by making halal a first-class, queryable field with its own filter row, its own card badge slot, and — on the restaurant page — a full certification PANEL (certifying body, expiry, seven-check summary), not a corner icon. Three invariants must be visible in every mock: a missing halal field renders NO badge (never optimistic, never a flash of green while data loads); expired/can't-vouch is cool slate, never red (red reads as a haram ruling the platform must not make); solid green is reserved to the halal seal, so generic success is tint-only.

Recommended visual direction is "Saffron Sharpened" (Direction A): keep the calibrated gold ramp and warm neutrals verbatim, add a promo family (magenta #E5157E / discount #C31B6B / HS-verified maroon #5E2D20) and a formalized link-blue (#0959B8). Icons: Phosphor (one family, matched outline+fill weights — solving the HungerStation inactive-outline/active-fill nav pattern from a single source). Maps: two published Mapbox Studio styles (hg-light forked from warm Monochrome, hg-dark from Midnight), deliberately desaturated so gold routes and pins are the only saturated thing on screen; verified-halal pins are the sole place halal green appears on the map.

Research coverage note: Customer and Rider apps are fully sourced below. The Admin ops console has strong references (Stripe Identity, Linear, shadcn Data Table, Trust & Safety queues) centered on the seven-check verification instrument. The Restaurant/merchant operator app was not covered in the source research — flagged in "apply to hg" as the top open gap to close before the client walkthrough.

## Palette directions (hex)

HungerStation extracted: `#FBEF00` primary-yellow (VERIFIED — fill of the 2024 logo SVG, Wikimedia Commons), `#5E2D20` maroon / wordmark-brown (VERIFIED — 2nd fill of the 2024 logo SVG, 14 occurrences), `#FCC43C` alt brand yellow (documented web/app usage — colorswall/schemecolor 'Hungry ordering food' palette), `#FFC800` golden-yellow variant (commonly cited HS yellow, 'Tangerine/Philippine Yellow'), `#F8D468` pale yellow highlight (documented palette companion), `#E5157E` promo/discount magenta-pink (OBSERVED from client videos — deals, 'Apply', promo pills), `#7A1F3D` deep discount maroon (OBSERVED — deep 'save X%' container; aligns with logo maroon), `#1A73E8` free-delivery / link blue (OBSERVED — 'Free delivery' links, secondary links), `#2FB344` badge green (OBSERVED — 'Required', trending/Top-Choice badges), `#232323` neutral text near-black (OBSERVED), `#FFFFFF` surface white (OBSERVED)


**Old HG brand (recovered):** repo `Not public under github.com/shaiknoorullah (public API lists 20+ repos — Aether, opsbench, ts-monorepo-template, etc. — but NO halal-goes/hg-api/hg-docker; they are private or under another org). Live marketing site was archived: web.archive.org/web/20251010131707/https://www.halalgoes.com/` · logo `https://fcjoexxqhequdlazybxi.supabase.co/storage/v1/object/public/web-content/media/logo.svg (referenced as both <img src> and <link rel=icon href>; served from the old project's public Supabase 'web-content' bucket). Social card: https://www.halalgoes.com/og-image.png` · colors ['#1B3B31 (dominant — deep forest/pine green, 17 uses)', '#0F241C (near-black green)', '#FFFAEA (warm cream background, 10 uses)', '#232323 (body text)', '#9CACA7 (muted sage)', '#EDFDD5 (pale green tint)', '#FD5000 (orange CTA accent)', '#D0D0D1 (borders)']

_The OLD brand was GREEN-forward (forest green + cream), the exact opposite of today's gold baseline. Critically, that green identity now COLLIDES with invariant #10 (solid green reserved to color.halal.*): reviving the old forest green as a generic brand/UI color would break the halal-verification signal. The pivot to gold/saffron in hg-mono is therefore not just aesthetic — it freed green to mean 'halal-verified' exclusively. Reuse the old logo only if re-colored to gold; do not reintroduce #1B3B31 as chrome. The one orange accent (#FD5000) is close to the new 'Ember' warning ramp and should not be revived as a brand color either (would clash with brand yellow)._


### Direction — A — Saffron Sharpened (recommended: lowest-risk blend)

Keep the existing, already-contrast-calibrated saffron ramp and warm neutrals verbatim (they pass every gate), and inject the ONE thing HungerStation has that hg lacks: a dedicated PROMO/DISCOUNT register (magenta-pink -> maroon) plus a formalized link-blue. This is what makes HS feel energetic — the yellow is the frame, but the deals are pink/maroon and the 'Free delivery' links are blue. Primary CTA stays brand.500 #FFC220 with dark onBrand text #1F1B17 at 10.58:1 (WCAG AAA); white on it is banned (1.62:1). The new promo family never touches semantic or halal roles: promo.600 #C31B6B carries a white label at ~5.4:1 (AA), the vivid promo.500 #E5157E (~4.0:1 white) is icon/large-badge-only, and the HS maroon #5E2D20 (white ~11:1) is the deep 'save' pill. Blue reuses the existing info ramp as the 'free delivery / link' role. This is the sleekest path: nothing recalibrates, HS energy arrives through an accent layer.

| role | hex |
|---|---|
| brand.500 (primary CTA fill — unchanged; dark text 10.58:1 AAA) | `#FFC220` |
| brand.600 (pressed / hairline) | `#DFA400` |
| brand.800 (brand-as-text on light, 6.51:1) | `#7A5800` |
| text.onBrand (label on brand fill) | `#1F1B17` |
| neutral.0 / surface | `#FFFFFF` |
| neutral.50 (warm app background) | `#FAF9F7` |
| neutral.900 (primary text) | `#1F1B17` |
| promo.500 (NEW — magenta icon / large-badge accent, ~4.0:1 white; not for body text) | `#E5157E` |
| promo.600 (NEW — discount pill fill, white label ~5.4:1 AA) | `#C31B6B` |
| promo.700 (NEW — promo text on promo.50 tint) | `#9B1553` |
| promo.50 (NEW — promo tint background) | `#FDE9F3` |
| promo.maroon (NEW — deep 'save %' container, HS-verified, white ~11:1) | `#5E2D20` |
| link/info.600 (free-delivery & links — reuses info ramp, 6.70:1) | `#0959B8` |
| warning.600 (Ember orange fill, 5.22:1) | `#B84A08` |
| danger.500 (semantic only, never halal, 4.83:1) | `#D92D20` |
| success.600 (TINT-ONLY emerald text/icon, no fill) | `#067A55` |
| halal.certified.seal (the only solid green surface, 10.68:1) | `#04482A` |
| halal.certified.ring (brass) | `#D4A72C` |
| halal.expired.seal (cool slate — never red) | `#4E5862` |

_Invariants: Green stays reserved to halal only (halal namespace unchanged). Success remains tint-only emerald (no filled green). Halal-expired stays cool slate #4E5862, never red. Promo pink/maroon are a separate namespace — forbidden from halal and from semantic success/danger, so red is never used for a halal state and pink is never mistaken for a state. Missing halal field still renders no badge._


### Direction — B — HungerStation Bright (bolder, higher-energy CTA)

Push the primary toward HungerStation's real luminance without adopting its acid lemon. HS's true #FBEF00 is a chartreuse-leaning lemon (hue ~57) that reads cheap and, worse, drifts toward green — unusable next to a green halal seal. Instead lift the CTA to a brighter 'signal gold' brand.500 #FFD400 (hue ~50, more luminous, unmistakably HS-adjacent) while keeping the calibrated dark ramp. #FFD400 carries dark onBrand text #1F1B17 at ~11.8:1 (AAA) — actually higher contrast than today. Pair it with a hotter promo magenta and the maroon for a punchier deals shelf. Best when the client wants the app to feel visibly louder/younger than the conservative saffron.

| role | hex |
|---|---|
| brand.500 (brighter signal-gold CTA; dark text ~11.8:1 AAA) | `#FFD400` |
| brand.600 (pressed) | `#E8B400` |
| brand.700 (deep gold / active nav underline) | `#A87C00` |
| brand.800 (brand-as-text on light) | `#7A5800` |
| text.onBrand | `#1F1B17` |
| neutral.50 (warm background) | `#FAF9F7` |
| neutral.900 (text) | `#1F1B17` |
| promo.600 (hot discount fill, white ~5.4:1) | `#C31B6B` |
| promo.500 (magenta accent) | `#E5157E` |
| promo.maroon (deep save pill, HS-verified) | `#5E2D20` |
| link/info.600 (free delivery / links) | `#0959B8` |
| warning.600 (Ember, kept far from brighter yellow) | `#B84A08` |
| danger.500 (semantic only) | `#D92D20` |
| success.600 (tint-only) | `#067A55` |
| halal.certified.seal | `#04482A` |
| halal.expired.seal (slate) | `#4E5862` |

_Invariants: Still gold, not green — the brighter yellow is nudged AWAY from the halal-green hue, preserving the green reservation. Success stays tint-only; danger stays semantic-only; halal-expired stays slate. Promo namespace is isolated. White-on-brand still banned (fails contrast); dark label enforced._


### Direction — C — Gold + Maroon Duotone (premium/editorial, warmest)

The 'cleaner, more modern, sleeker' reading of HungerStation: keep gold for action, but swap the operational chrome from cool Midnight-blue toward the HS maroon #5E2D20 as a warm secondary brand color, over the old-brand cream #FFFAEA as the app canvas. Gold CTA + deep maroon chrome + cream surface is a warm, confident, premium duotone that also quietly honors the OLD Halal Goes cream — a brand-continuity nod — while abandoning its now-forbidden forest green. Deals use a softer coral-magenta so the maroon chrome and the pink promos share a warm family. Primary CTA #FFC220 dark text 10.58:1 (AAA). Maroon chrome #5E2D20 carries white nav labels at ~11:1. Use this if the brand should feel less 'delivery-app loud' and more 'trusted halal marketplace'.

| role | hex |
|---|---|
| brand.500 (gold CTA; dark text 10.58:1 AAA) | `#FFC220` |
| brand.800 (gold-as-text on cream) | `#7A5800` |
| text.onBrand | `#1F1B17` |
| chrome.maroon (secondary brand / AppBar; white label ~11:1) | `#5E2D20` |
| chrome.maroon.pressed | `#412016` |
| surface.canvas (warm cream, echoes old HG) | `#FFFAEA` |
| surface.card | `#FFFFFF` |
| neutral.900 (text) | `#1F1B17` |
| promo.600 (coral-magenta discount fill, white ~4.8:1) | `#CB2A5E` |
| promo.50 (promo tint) | `#FCE8ED` |
| link/info.600 (free delivery / links) | `#0959B8` |
| warning.600 (Ember) | `#B84A08` |
| danger.500 (semantic red only — distinct from maroon chrome) | `#D92D20` |
| success.600 (tint-only emerald) | `#067A55` |
| halal.certified.seal (only solid green) | `#04482A` |
| halal.certified.ring (brass — sits beautifully on maroon) | `#D4A72C` |
| halal.expired.seal (slate, never red) | `#4E5862` |

_Invariants: Maroon is a warm brown-red at hue ~12 but is used ONLY as chrome/secondary brand, never as a state — so it cannot be read as danger, and danger stays the true red #D92D20 reserved to semantic use (never halal). Green still reserved to halal. Cream is a neutral surface, not a success signal. Halal-expired stays slate; halal seal green is the only solid green. Success tint-only._


## Icons

**Pick: Phosphor Icons** — HungerStation's bottom nav (and most modern delivery apps) uses OUTLINE icons for inactive tabs and FILLED icons for the active tab. Phosphor ships every one of its ~9,000 icons in 6 matched weights — Thin/Light/Regular/Bold/Fill/Duotone — from a single family, so inactive=Regular and active=Fill come from the SAME source with identical geometry (no compositing hacks, no second library). Duotone is ideal for the category tiles and menu-modifier illustrations. It has first-class React + React Native packages (@phosphor-icons/react, phosphor-react-native) that work across the customer/rider Expo apps and the restaurant/admin web, MIT-licensed, tree-shakeable. It is geometric and clean enough to read as 'sleek/modern' while carrying more warmth than a pure engineering set. The active-fill capability is the deciding factor: it's exactly the HS energy the client asked for, solved within one consistent family.

Alternatives: Lucide — the cleanest, most tightly consistent OUTLINE set (1,500+), the safest 'sleek/minimal' default, superb lucide-react + lucide-react-native support, MIT. Downside for THIS brief: outline-only (single weight), so active-tab fills must be faked with a colored pill/background or a hand-forked filled variant. Pick Lucide if the client prefers maximum minimalism and is fine with background-fill active states. | Iconsax — very 'delivery-app modern' with Bold + Duotone variants and rounded forms that pair well with the gold; but the free tier's licensing is more restrictive than MIT, stroke consistency is looser than Phosphor/Lucide, and RN tooling is less first-class. | SF Symbols — EXCLUDED: Apple-platform only. It cannot render on Android or web, so it would break icon parity across the two Expo apps and the two web consoles. Non-starter for a cross-platform system.


## Maps (Mapbox)

Use @rnmapbox/maps (requires an Expo dev build — NOT Expo Go) for the customer/rider apps and mapbox-gl-js for admin web, driven by ONE Mapbox account (the client's existing subscription). Ship TWO published Mapbox Studio styles — hg-light and hg-dark — and switch by the app's color-scheme. Keep the basemap deliberately DESATURATED so the brand tint on routes and pins is the only saturated thing on screen; that restraint is what makes it read 'cleaner/sleeker' than HungerStation's default Google-style map. Verified-halal restaurant markers are the one place the halal seal green appears on the map — this is the map-pin exception already registered in tokens.json (color.halal); no other green on the map.

Base: Fork Mapbox 'Monochrome' via the Studio Style Generator (blog.mapbox.com/custom-map-style-generator-and-monochrome-style). Seed hg-light from the warm off-white neutral.50 #FAF9F7 (start from the 'Golden' Monochrome preset, then pull saturation down so it's a warm greige, not a yellow map); seed hg-dark from the Midnight accent.950 #080F1C (near the 'Midnight' preset) so night mode matches the rider offer chrome. Alternatively fork Mapbox Standard and toggle its built-in lightPreset (day/dusk/night) via setConfigProperty for a 3D option — but Monochrome gives tighter brand control for a flat, sleek 2D map. Mute POI/road labels to neutral.500–600; let the destinations carry the color.

Theming: Route line = brand gold: brand.500 #FFC220 core with a brand.600 #DFA400 casing/underlay for legibility on light; in dark mode step up to brand.300 #FFDB69 so the route stays ≥3:1 on #080F1C. Customer 'your location' pin & the 'set delivery address' pin = brand gold #FFC220 (matches HS's yellow location pin). Rider live position marker = Midnight accent.600 #24406F (Direction A/B) or maroon chrome #5E2D20 (Direction C) — the operational/authority color, kept visually distinct from the gold route. Restaurant markers: verified-halal = halal seal green (#04482A light / #0F7A46 dark) with the brass ring, per the registered halal map-pin exception; non-verified restaurants render a neutral #4A443B pin with NO green (invariant #8 — no optimistic badge). Destination pin = neutral.900 #1F1B17 teardrop. Deals/promo map badges may use promo.600. Never use red for any halal or 'unavailable-restaurant' map state — use neutral/slate.


## Per-app flows & references


### Customer (mobile / Expo)

**Top references:** Revyl Atlas — DoorDash screen map (revyl.com/atlas/doordash): 98 real iOS screens organized by exactly our flow categories — use as a completeness checklist (Store Info sheet, Add-Tip sheet, Saved Stores empty state, Profile Badges modal); talabat iOS on Mobbin — HungerStation's direct Delivery Hero sibling: login options (phone-first + social), live tracking map with driver-chat entry, feedback flow (mobbin.com/explore/screens/ac4ab7ef... and .../9cf34fd0...); Mapbox × Wolt showcase (mapbox.com/showcase/wolt) — validates Matrix API for traffic-aware ETA + Static Maps for lightweight tracking; ETA accuracy, not map prettiness, is what Wolt optimized first; Luis Fernandez checkout teardown (luiselias.com) — Uber Eats 6-step vs DoorDash 4-step vs Glovo 5-step, with named pitfalls (hidden fees, vague allergy toggles, tip dark patterns); Zomato personality-driven UX (blakecrosley.com/guides/design/zomato) — dietary/trust badges as a first-class visual system + humanizing the tracking wait; Baymard grocery/food-delivery research (baymard.com/blog/grocery-food-delivery-orders) — reorder belongs on the homepage first viewport, not buried in history; Uber Allergy-Friendly Program (help.uber.com) — the closest shipped analogue to a halal certified-badge + DIETARY TYPE filter


**Must-have flows:**
- OTP onboarding: phone-first (country default CA), no social fallback for MVP per O-03; auto-read OTP + resend + change-number escape; deferred name/email; location prompt with an explicit 'not now' (never gate browsing on permission); halal mission one-liner on splash
- Home/discovery: pinned address bar, search entry, category tiles with a distinct 'Halal Certified' tile as a first-class category, promo carousel (gold+promo accents, never green here), 'Order Again' rail in the first viewport, photo-forward restaurant cards with rating+count, shield-icon delivery time, distance, free-delivery tag, halal badge in a fixed top-left slot
- Search + filters/sort: typeahead (restaurant + dish), filter bottom sheet with 'Halal Certified' pinned at the TOP of the sheet (its own section, not alphabetized among vegan/gluten-free), removable applied-filter chips
- Restaurant page: hero header, then a tappable halal CERTIFICATION PANEL directly below (certifying body, expiry, seven-check summary) — the trust centerpiece, with its own distinct loading skeleton so no optimistic/green flash; sticky menu category tabs; item rows with +add
- Menu-item modifier bottom sheet: large photo, required single-select (radio) vs optional multi-select (checkbox) groups labeled 'Required'/'Select up to N', quantity stepper + full-width price-updating CTA ('Add to cart · $12.50'), always-visible special-instructions field
- Cart: pinned restaurant header, inline quantity steppers, optional upsell rail that never blocks CTA, EXPANDED fee breakdown (subtotal/delivery/service/tax as separate lines), server-repriced on open, sticky 'Go to checkout · $X'
- Checkout: address+time → cart review+instructions → tip (chips + custom, NONE pre-selected, 'No tip' equal weight) → payment+place-order in ONE step with a visible summary (no separate late-stage payment round-trip)
- Live tracking: full-bleed themed map, route restaurant→rider→customer, status stepper tied to deadline_at, rider card with chat/call, prominent traffic-aware ETA countdown
- Order history + reorder: newest-first, receipt detail, per-row Reorder that RE-PRICES server-side (never replays cached total), designed empty state
- Ratings: SEPARATE stars for food vs rider, optional quick tags, optional text+photo, dismissible confirmation
- Profile/addresses/wallet/notifications: labeled saved addresses, payment methods, split order-vs-promo notification toggles — every list ships empty/loading/error


**Key patterns:** Halal badge = a reserved slot that renders NOTHING when the field is null/loading (invariant #8), with a certification-panel loading state visually distinct from generic skeletons so 'not loaded' never reads as 'checked, failed'; Trust gets a PANEL not an icon: card view uses the badge, the restaurant page earns a tappable certification block near the decision point; Cool-slate expired state, deliberately diverging from Uber's orange allergy banner — never red/orange for any halal ambiguity; Reorder rail on the homepage first viewport (Baymard), plus shield glyph for delivery-time ETA (HungerStation signature); Fee breakdown expanded by default; tip selector with no high default (counter to DoorDash's criticized nudge); Certified filter as its own top-of-sheet section (platform guarantee), not one dietary checkbox among many; Traffic-aware ETA via Mapbox Matrix API, not a flat average; map re-themed via LUTs per light/dark; Server prices everything (invariant #1): cart and reorder treat all prices as server-returned, re-fetched, never client-computed


### Rider / Courier (mobile / Expo)

**Top references:** Uber Design — 'Uber Navigation: Designing for Drivers' (medium.com/uber-design/uber-navigation-f662e7611f3): the '3-foot, 1-second rule', separately-validated night mode, gesture minimalism — the richest primary source for the map + single-glance brief; DoorDash 'Redesigning the Dasher Homescreen' (medium.com/@a_kill_): map-first home, one decision at a time, P0/P1/P2 communication tiering, differentiated 'looking for offers' wait state; DoorDash Help + entrecourier: offer-card spec (pay/distance/items/deadline + map thumb), ~45s countdown = auto-decline, 3-step asymmetric decline (and its documented driver resentment); Wolt Courier Partner (mwm.ai) + Wolt Newsroom: slide-to-go-online, weekly earnings + 'expected demand' graph, 2025 City Heat Maps + Early/instant Payouts; Uber & Deliveroo onboarding (help.uber.com documents, rider.deliveroo.co.uk/document-check): per-document corner-framed capture with specific rejection reasons, Onfido-style selfie/liveness gate, explicit 'up to 48h under review' state; Uber earnings IA (help.uber.com trip earnings) + DoorDash ratings: three-tab earnings, category-broken ratings; Mapbox Navigation SDK custom Day/Night theme (docs.mapbox.com/android/navigation/examples/add-custom-theme) — auto style-switch on time-of-day/tunnel, the concrete themed-rider-map path


**Must-have flows:**
- Onboarding + KYC: phone/email → vehicle type → per-document capture (licence, registration, insurance, background-check consent, photo) with 4-corner framing and specific rejection reasons; right-to-work as a distinct step; selfie/liveness biometric match as a HARD gate; explicit 'under review up to 48h' state; first-trip tutorial on approval. Maps onto invariant #7 (private-bucket + presigned only for every document)
- Availability + earnings goal: offline-default with a slide-to-go-online control (friction is deliberate); going online reveals a map-first home with a non-scrollable bottom sheet carrying ONE action; always-visible earnings pill (weekly offline / live session online); distinct 'looking for offers near you' state with the map still live
- Offer stack: bottom-sheet card over the map (prominent pay, distance, item count, deadline, map thumbnail); shrinking-ring countdown (~45s, timeout=decline); large one-tap Accept, lower-emphasis Decline; on accept, immediate transition to pickup navigation
- Navigation pickup→dropoff under the 3-foot/1-second rule: single-tap overview↔first-person toggle, distinct pickup vs dropoff pins + side-of-street indicators, geofence-triggered arrival, zero dead-end screens between legs, tuned night mode
- Arrival / pickup confirmation: geofenced arrival, itemized contents + pickup instructions + restaurant contact, explicit 'confirm pickup' gate, no-contact/dropoff flags surfaced up front on the task card
- Proof of delivery: OTP primary (large auto-submit keypad) with photo fallback + framing guidance; framed as dispute EVIDENCE, not a payment gate (money captured on acceptance); straight to earnings-updated completion
- Earnings + payouts: three-tab IA (total+graph / per-delivery gross-vs-net history / weekly→daily pay summaries), early/instant payout, demand heat map framed as forward planning
- Ratings: category-broken (Communication, Instructions, Handling, Friendliness), separate 'compliments' quotes, graceful no-feedback empty state


**Key patterns:** Map-first home + non-scrollable single-action bottom sheet ('help the rider decide if it's a good time to dash without a dozen buttons in the way'); Slide-to-go-online (not tap); P0/P1/P2 comms tiering so promos/messages never stack over the map (route P2 to a notifications hub); Offer card with shrinking countdown + asymmetric accept/decline weight — but flag DoorDash's punitive acceptance-rate-cost decline as a trust risk; disclose plainly rather than spring it; Separately-validated night mode (tested dark room, then real night drives) — copy the process even with hg's own colors; Per-document corner-framing + specific rejection reasons; biometric selfie-to-ID as a distinct hard gate; never a silent post-upload state; Category-broken ratings using TINT/slate chips — do NOT copy DoorDash's solid-red thumbs-down (violates hg's no-red-as-judgment rule); Any rider-facing halal badge at pickup obeys the same rules: missing field = no badge, expired = slate not red; Mapbox Nav SDK Day/Night classes auto-switch — hook hg's custom styles into the same trigger; if bike couriers are supported, use a cycling-SAFE route profile, not fastest-by-default (Deliveroo motorway-safety complaint)


### Admin ops console (web)

**Top references:** Stripe Identity Review tools (docs.stripe.com/identity/review-tools) — the closest real product to the seven-check instrument: verification queue, at-a-glance list view + deep two-pane detail, human override of a machine decision, permanent blocklist, biometric-duplicate warning; Stripe Disputes (docs.stripe.com/disputes) — reason code + evidence trail + STAGE-then-SUBMIT two-step commit + SLA countdown; the model for refund-approval second-approver flows; Linear DESIGN.md — the 'cleaner/sleeker' ops-console model: no drop shadows, depth via a 4-step surface ladder, a single accent reserved for actionable elements (and that accent must NOT be halal-green), hairline rows, pill status badges, mono type for IDs; shadcn/ui Data Table + TanStack Table — headless filtered→sorted→paginated row model mapping cleanly onto Go/Postgres keyset (cursor) pagination; row-selection + floating bulk-action bar; Vercel Geist Badge + Deployments filter bar — color-to-meaning token rules (never color alone) and URL-persisted filter chips for shareable queue views; Trust & Safety queues (Cinder / Hive) — priority-ordered take-next, reviewer hotkeys for approve/reject/escalate, reusable queue configs — validates the FIFO SKIP LOCKED design; Retool review-queue template + Untitled UI dashboards — the standard 'queue list → detail with action bar' skeleton, plus KPI cards and banded HEALTHY/WATCH/AT_RISK gauges


**Must-have flows:**
- Seven-check halal verification (A-15) — the single highest-trust screen: FIFO take-next (SKIP LOCKED, 60-min lock); two-pane detail (presigned 5-min document viewer with zoom/rotate/multi-page | transcription form of the six structured fields, issuing_body bound to the ACCEPTED registry only, never OCR-suggested); H1-H7 checklist where H2/H5/H7 are system-computed locked badges (surface the 409 CHECK_NOT_OVERRIDABLE inline, wrap disabled controls so tooltips still fire), H1/H6 are human PASS/FAIL, H3/H4 are system-suggested-admin-confirms with a side-by-side diff (H4→PASS override requires a ≥20-char note, validated client-side); sticky decision bar with a live 'N of 7 recorded' counter, Approve disabled until all recorded and none FAIL, Reject requires a closed reason code; inline state transition then auto-return to queue
- Refund / dispute case (A-33/A-35): reason code + evidence/notes trail + stage-then-submit two-step, second-approver request, SLA countdown
- Restaurant / rider / order / case queues: dense keyset-paginated data tables, URL-persisted filter chips, row-selection bulk actions, per-row status pills
- KPI dashboard (A-09) + compliance/performance banded widgets (A-20/A-21): HEALTHY/WATCH/AT_RISK using green/amber/SLATE — never red for any halal-adjacent state
- Audit log + issuing-body registry (A-16): searchable, immutable, mono IDs
- Every queue and detail ships explicit empty/loading/error states


**Key patterns:** Queue list + detail-with-action-bar is the standard internal-tool shape — don't over-invent it; Machine decision + human override, with computed checks server-LOCKED so the UI cannot game them; the frontend's job is to make computed-vs-human-vs-confirm states legible, not overridable; Admin accent color is a single non-halal-green accent reserved for actionable elements (Linear discipline); status badges are tokenized meaning→color and never rely on color alone (Geist); Reviewer hotkeys for approve/reject/escalate; priority-ordered take-next; two-step stage/submit for anything irreversible; Keyset (cursor) pagination surfaced as pageInfo, not offset math — matches the Go backend


### Restaurant / merchant operator (web / tablet) — RESEARCH GAP

**Top references:** NOT COVERED in source research — the per-app slot was a placeholder. Closest adjacent references surfaced in the inspiration galleries, to be validated before the walkthrough:; Dribbble 'FoodMagic — Restaurant Order Management Dashboard' (dribbble.com/shots/22162296) — live order queue, accept/reject, tablet-oriented layout; Dribbble tag restaurant-management-dashboard + Food Delivery Dashboard UI (analytics + live order tracking); Shopify Polaris — the gold standard for a merchant operator console: table patterns, empty states, and especially content/voice + error-message writing; Uber Base Design System (base.uber.com) — one token set spanning consumer, driver, and operator surfaces; structural model for hg's cross-app language


**Must-have flows:**
- TO BE RESEARCHED: incoming-order queue with accept/reject (ties to invariant #5 authorise-then-capture-on-acceptance and every order carrying deadline_at)
- TO BE RESEARCHED: menu/item availability toggles (needs a distinct non-halal-colored motion language), open/closed + hours toggle, prep-time management
- TO BE RESEARCHED: how the restaurant's own halal certification status and expiry are surfaced back to the operator (submission, pending, expiring-soon warnings in slate not red)


**Key patterns:** Availability/open-closed toggles need their own non-green motion language (green stays halal-reserved); Order-accept action is the capture trigger in the money model — the operator UI is where authorise→capture happens, so its confirmation and timeout states are load-bearing, not cosmetic


## Apply to Halal Goes (prioritized)
1. 1. Close the Restaurant/merchant operator research gap BEFORE the client walkthrough — it is the one app with zero source coverage. Mine FoodMagic (dribbble 22162296), Shopify Polaris (table/empty-state/voice), and Uber Base; storyboard the order-accept queue (it is the authorise→capture trigger, invariant #5) and a non-green availability toggle. This is the top open blocker.
2. 2. Add the promo/link accent layer to tokens.json now (Direction A): promo.500 #E5157E, promo.600 #C31B6B, promo.maroon #5E2D20, promo.50 #FDE9F3, link/info.600 #0959B8. Wire lint so promo.* is forbidden from halal.* and from semantic success/danger roles — this is what safely imports HungerStation's energy without recalibration.
3. 3. Build the halal certification PANEL component (restaurant page) with its OWN loading skeleton distinct from generic content skeletons, plus the card-level badge SLOT that renders nothing on null/loading. Prove invariant #8 (no optimistic badge, no green flash) and invariant #9 (expired = slate #4E5862) in a real mock, both themes. Highest-trust surface in the product.
4. 4. Make 'Halal Certified' a first-class filter section pinned at the top of the filter bottom sheet (not alphabetized among vegan/gluten-free) and a distinct home-screen category tile — signals platform guarantee vs per-user preference.
5. 5. Ship the two Mapbox Studio styles (hg-light from warm Monochrome, hg-dark from Midnight), desaturated, with the gold route + halal-green verified pin exception. Confirm the Expo apps move to a DEV BUILD (rnmapbox needs it — not Expo Go); note this against the known Expo Go constraint of the (since removed) native component gallery. Adopt Matrix API for ETA, not a static average.
6. 6. Adopt Phosphor across all four apps; standardize the nav pattern as Regular (inactive) + Fill (active) from the single family, and the delivery-time shield glyph on restaurant cards.
7. 7. Bake the anti-dark-pattern stances into the design spec as hard rules: tip defaults UNSELECTED with 'No tip' at equal weight (counter DoorDash); fee breakdown EXPANDED by default (no fees hidden in tax); payment + place-order in ONE step (no Glovo-style late round-trip); reorder RE-PRICES server-side (invariant #1); 'Order Again' rail in the homepage first viewport (Baymard).
8. 8. Rider: implement P0/P1/P2 comms tiering and a differentiated 'looking for offers' state (not a spinner) around a map-first home; use the 3-foot/1-second rule as the active-trip design constraint; keep the offer countdown but make the decline flow non-punitive (disclose any acceptance metric plainly). Enforce the KYC document flow as private-bucket + presigned (invariant #7) with an explicit 'under review up to 48h' state.
9. 9. Enforce hg's palette discipline everywhere feedback/ratings appear: separate food-vs-rider ratings (customer) and category-broken ratings with TINT/slate chips, never DoorDash's solid-red thumbs-down. Extend 'never red for a judgment call' from halal state to all quality feedback.
10. 10. Admin seven-check instrument (A-15): build the two-pane list+detail with the H1-H7 typology explicit in the UI — computed checks (H2/H5/H7) as locked badges surfacing 409 inline, human checks (H1/H6), and confirm-with-diff checks (H3/H4, H4→PASS gated on a ≥20-char note). Live 'N of 7 recorded' counter drives the Approve button state. Give the admin a single non-halal-green accent (Linear discipline).
11. 11. Every screen in every app ships empty/loading/error — repo-level hard requirement; specifically design Saved Stores empty, Orders empty, Notifications empty, all admin queues empty, and the halal 'not yet loaded' vs 'no badge' distinction.


## Inspiration & pattern library


### Award-winning food-delivery & logistics apps (Mobbin / real competitor flows)
- [Mobbin — Food Delivery App Design Examples](https://mobbin.com/explore/mobile/app-categories/food-delivery-app) — The single best source for exact HungerStation-adjacent Gulf-market UX (Talabat, Careem, Zomato, Uber Eats side by side) — filter to 'Food Delivery' to compare home, cart-sheet and checkout patterns screen-for-screen before designing hg's customer app.
- [Mobbin — Zomato iOS: Ordering a Food Delivery Flow](https://mobbin.com/explore/flows/2f24d961-d028-4775-bef5-bf582edaa7cd) — Full ordering flow (item customization → instructions → payment → tracking → confirmation) captured as a sequential flow, not just screens — use it to storyboard hg's own checkout-to-tracking handoff.
- [Mobbin — Uber Eats iOS: Delivery App Homepage](https://mobbin.com/explore/screens/0c758216-f623-4b62-9e81-e0496e07f38b) — Reference for category-tile + featured-restaurant-carousel home layout, directly comparable to the HungerStation home the client referenced.
- [Mobbin — talabat iOS Screen](https://mobbin.com/explore/screens/f29e37b4-9b74-4c27-9700-494001dec50e) — Talabat is HungerStation's direct regional sibling (same Delivery Hero family) — closest publicly-captured visual/IA cousin to the client's reference video.
- [Mobbin — Mobile Adding to Cart & Bag User Flow](https://mobbin.com/explore/mobile/flows/adding-to-cart-bag) — Cross-app pattern library specifically for the add-to-cart moment (quantity stepper + price CTA) the brief calls out as a HungerStation signature.
- [Dribbble — Food Delivery App UI: Onboarding, Home, Tracking & Checkout](https://dribbble.com/shots/26497109-Food-Delivery-App-UI-Onboarding-Home-Tracking-Checkout) — A single, cohesive concept spanning the full funnel (not just a hero shot) — good end-to-end visual-language reference to critique against hg's gold/amber palette.
- [Dribbble — tag: food-delivery-app](https://dribbble.com/tags/food-delivery-app) — Live-updating aggregation feed; use as a weekly-scan source for fresh restaurant-card, rating-badge and promo-banner treatments rather than a single fixed reference.
- [Behance — Food Delivery App Case Study (UI/UX)](https://www.behance.net/gallery/110252055/Food-Delivery-App-Case-Study-UIUX-Case-Study) — Full case-study format (problem → wireframe → hi-fi → rationale) — useful for how to *present* hg's own design decisions to stakeholders, not just the visuals.
- [Behance — search: food delivery app](https://www.behance.net/search/projects/food%20delivery%20app) — Broad curated feed of complete case studies (Food2Door, Food Ping, Munch, etc.) — mine for menu bottom-sheet and modifier-group (required/multi-select) treatments the brief specifically asks for.

### Modern data-dense dashboards (for admin ops console & restaurant/merchant app)
- [Dribbble — FoodMagic: Restaurant Order Management Dashboard](https://dribbble.com/shots/22162296-FoodMagic-Restaurant-order-management-Dashboard) — Purpose-built for the exact restaurant-operator use case hg needs — live order queue, accept/reject actions, tablet-oriented layout.
- [Dribbble — tag: restaurant-management-dashboard](https://dribbble.com/search/restaurant-management-dashboard) — Aggregation of restaurant-specific dashboard concepts (menu toggles, hours, order queue) — closest analog to hg's restaurant web/tablet operator app.
- [Dribbble — Food Delivery Dashboard UI: Analytics & Order Tracking](https://dribbble.com/shots/27215945-Food-Delivery-Dashboard-UI-Analytics-Order-Tracking) — Combines KPI/analytics tiles with a live order-tracking table — the same split of concerns hg's admin ops console needs (verification queue + platform metrics).
- [Dribbble — tag: order-management](https://dribbble.com/tags/order-management) — Cross-vertical (not just food) order-management table/kanban patterns — useful for the admin console's order-state and dispute views beyond food-specific chrome.
- [IBM Carbon Design System](https://carbondesignsystem.com/) — Best-in-class token architecture + accessibility + data-visualization guidance for genuinely data-dense enterprise UI — directly applicable to admin's verification queue and analytics screens.
- [Shopify Polaris](https://polaris.shopify.com/) — The gold standard for a merchant-facing operator console (Shopify admin) — study its content/voice guidelines and table/empty-state patterns for hg's restaurant operator app.
- [Atlassian Design System](https://atlassian.design/) — Strong precedent for dense, action-heavy productivity UI prioritizing usability over decoration — relevant to admin's certification-verification workflows.
- [Uber Base Design System](https://base.uber.com/) — Uber's own public system spans consumer (Eats-adjacent) and dense operational surfaces from one token set — a structural model for hg maintaining one language across customer, rider, restaurant and admin apps.

### Micro-interaction & motion references
- [Dribbble — Add to Cart micro-interaction (Alberto Conti)](https://dribbble.com/shots/3305459-Add-to-Cart-micro-interaction) — Quick, prototype-grade add-to-cart animation — a direct reference for the price-CTA-to-cart moment the brief highlights from HungerStation's bottom sheet.
- [Dribbble — Add To Cart Micro-Interaction (Blake Howard)](https://dribbble.com/shots/6461974-Add-To-Cart-Micro-Interaction) — A sliding/morphing button-to-confirmation interaction — alternative motion language to compare against Conti's for hg's own CTA-press feedback.
- [Dribbble — tag: microinteraction-button](https://dribbble.com/search/microinteraction-button) — Broader feed for toggle and button micro-interactions — relevant to the restaurant app's availability/open-closed toggle, which needs its own distinct, non-halal-colored motion language.
- [LottieFiles — Delivery Animation Pack](https://lottiefiles.com/marketplace/delivery-547) — Ready-to-inspect JSON Lottie set (courier, route, package states) for order-tracking motion — usable directly as a starting rig for hg's live-tracking screen animation.
- [IconScout — Courier Tracking Lottie Animations](https://iconscout.com/lotties/courier-tracking) — 70 variations of the moving-pin/courier-on-map motion pattern specifically — the exact interaction class hg's order-tracking map needs, useful for range-of-motion comparison before committing to one style.

### Map UX in delivery apps (Mapbox-specific)
- [Mapbox — On-Demand Logistics solutions](https://www.mapbox.com/use-cases/logistics) — Mapbox's own logistics/delivery use-case page — the direct starting point since the client already holds a Mapbox subscription; covers live ETA, route-line and courier-marker patterns natively.
- [Mapbox — Map design and styles (docs)](https://docs.mapbox.com/help/dive-deeper/map-design/) — Official guidance on building a custom Mapbox Studio style matched to a brand theme — the concrete how-to for hg's light+dark map style requirement.
- [Mapbox agent-skills — delivery-logistics style patterns (GitHub)](https://github.com/mapbox/mapbox-agent-skills/blob/main/skills/mapbox-style-patterns/references/delivery-logistics.md) — A maintained reference doc of concrete Mapbox Studio patterns for delivery/logistics styling (route color-coding by leg, building-type shading) — directly implementable, not just inspirational.
- [Mapbox blog — Add navigation to your on-demand delivery app](https://blog.mapbox.com/add-nav-into-your-on-demand-delivery-app-be09db23641f) — Mapbox's own worked example of embedding turn-by-turn + live tracking into a delivery app UI — relevant to both hg's customer tracking screen and the rider navigation view.
- [Dribbble — tag: order_tracking](https://dribbble.com/tags/order_tracking) — Visual-only (non-Mapbox-specific) feed of map-centric order-tracking screen compositions — bottom-sheet-over-map layouts, courier-ETA cards, progress-stepper overlays.

### Design systems worth borrowing structure from (token architecture, governance, docs)
- [IBM Carbon Design System](https://carbondesignsystem.com/) — (cross-listed) Strongest public example of token-first architecture plus a dedicated 'Carbon for AI' pattern set — model for hg's own DTCG token discipline.
- [Shopify Polaris](https://polaris.shopify.com/) — (cross-listed) Exceptional content-design guidelines (voice, tone, error-message writing) — a gap most component libraries never cover, worth stealing wholesale for hg's docs.
- [Atlassian Design System](https://atlassian.design/) — (cross-listed) Documentation-quality benchmark: every pattern ships with explicit usage do/don't guidance — model for how hg's own `docs/design/` should read.
- [Uber Base Design System](https://base.uber.com/) — (cross-listed) The single closest sibling to hg's own scope: one system spanning a consumer marketplace app, a driver/operator app, and internal ops tooling.
- [Radix / shadcn-adjacent primitives](https://www.radix-ui.com/) — Unstyled, accessible interaction primitives (menus, dialogs, toggles) that most 2026-era systems (including shadcn/ui) build on — relevant to hg's ui-web component layer for correctness-first a11y behavior underneath its own visual skin.