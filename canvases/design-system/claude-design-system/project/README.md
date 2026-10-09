# HalalGoes — design system

HalalGoes is a pre-launch halal food-delivery marketplace for Canada, opening in Ontario first.
Its single differentiator is **halal verification**: a restaurant appears in the marketplace only
after an admin has checked its certificate against seven checks, and every listing carries that
record as a badge. The name is always **HalalGoes**, one word.

The brand is warm, appetising and human: a cream canvas, white cards, deep forest-green chrome,
one orange call to action, a script wordmark with an orange swash, and exactly one bright green —
the verification seal.

## Sources this system was built from

Everything here traces to the `hg-mono` repository. Token values were imported from
`docs/design/tokens.json` at commit `cc37602` (origin/main, 28 September 2026). When this book and
the repository disagree, the repository wins and this book is corrected.

| Source (hg-mono path) | What it gives us |
|---|---|
| `docs/design/tokens.json` | The tokens themselves: colour ramps, light and dark roles, type, space, density, targets, radius, elevation, motion, the reserved halal colours, measured contrast pairs. This is the source of truth. `assets/Uploads/tokens.json` in this project is an older snapshot (it still names Inter, a blue focus ring and a white CTA label) and is kept for history only. |
| `docs/design/01-foundations.md` | The reasoning behind colour, type, spacing, motion, iconography and imagery. |
| `docs/design/02-components.md` | The component rules, including the halal badge, certification panel and admin checklist. |
| `docs/design/04-accessibility.md` | Contrast, targets, focus, spoken labels, and the rule that a halal state must survive the loss of colour or text. |
| `docs/design/landing-creative-direction.md` | The creative direction for halalgoes.com. |
| `docs/decisions/` | Settled decisions: the palette, the focus indicator, the certifying bodies, the slaughter-method record. |
| `docs/spec/02-customer.md` (the halal certification display, feature C-12) and `docs/spec/05-admin.md` (certificate review, feature A-15) | What each halal state displays, the fixed strings, and the seven checks. |
| `apps/marketing/src/lib/claims.ts` and `audiences.ts` | Every claim the marketing site may make, and the copy for its three audiences. |
| `apps/marketing/brand/` (moving to `packages/brand/`) | The supplied wordmark, its vector trace, the app icons and favicon. |
| `packages/ui-native/src/tokens/build.ts`, `packages/ui-web/scripts/generate-tokens.mjs` | How the tokens become native and web styles. |
| `docs/planning/growth-stack.md` | Tracking and consent for the marketing site. |
| `uploads/claude-design-brief.md` | The first landing-page brief. Historical; kept for context and corrected where it had gone stale. |

## Products

| Surface | Platform | Where it lives here |
|---|---|---|
| Customer app | Expo / React Native, phone-first, light theme | `ui_kits/customer-app/` |
| Rider app | Expo / React Native. A dark high-contrast “field” theme is designed and in the tokens, but both mobile apps currently ship light-only, so do not assume production matches the dark kit | `ui_kits/rider-app/` |
| Restaurant web | Desktop web, forest chrome | `ui_kits/restaurant-web/` |
| Admin web | Desktop web, compact density | `ui_kits/admin-web/` |
| Marketing site (halalgoes.com) | Next.js 16 + Tailwind v4 + Keystatic, Klaro consent; pre-launch waitlist | `ui_kits/marketing-site/` |

---

## CONTENT FUNDAMENTALS

**The register is plain, specific and slightly formal — a platform that knows it is making a
claim people care about.** Copy never sells the religion; it describes the process.

- **Second person, active voice.** “Seven checks on every restaurant, before it reaches you.” The
  platform refers to itself as “we” only when describing what it did: “we checked”, “we record”,
  “we do not certify”. Never “I”.
- **Sentence case everywhere**, including badges and buttons: “Halal certified”, “Add to order”,
  “Get early access”. All-caps is used only for small overline labels on the marketing site
  (`THE SEVEN CHECKS`), never for status text — screen readers may spell all-caps out. Say “seven
  checks”, never “seven-point”.
- **Fixed strings that must never be paraphrased** (the voice card has the full list):
  - Badge labels: “Halal certified”, “Halal certified · expires 14 Oct” (a certificate that
    expires soon, on the amber expiring plate — the one short date, owner-approved), “Certification
    expired”, “Not verified”.
  - Spoken labels: “Halal certified”; “Halal certification expired. This restaurant cannot take
    orders.”; “Halal certification not verified.”
  - Panel: “Certified by [body]”, “Valid until 14 March 2027”, “Certificate renews {date}”,
    “View certificate”.
  - The standing line: *“Certification verified by HalalGoes on {date}. HalalGoes does not itself
    certify food.”* When there is no verification date it is only the second sentence, *“HalalGoes
    does not itself certify food.”* A literal “{date}” is never shown to anyone.
- **Dates are absolute and written out**: “4 September 2026”, never “4 Sept 2026”, never
  “expires in 7 months”, on screen or spoken.
- **Forbidden claims:** “guaranteed halal”, “100% halal”, “halal approved by us”, or anything that
  reads as a religious ruling. The platform verifies certificates; certifying bodies certify food.
- **Expiry is described as our knowledge lapsing, not as a verdict on the food:** “Your listing is
  hidden from customers until renewal” — never “this restaurant is not halal”.
- **No numbers that are not in the claims register** (`apps/marketing/src/lib/claims.ts`). There
  are no restaurant, rider, order or waitlist counts and no testimonials yet, so none appear — not
  even as placeholders like “[XX] certified restaurants”. Where social proof would go, the page
  shows an honest empty state. Say Ontario, never a city or neighbourhood (none is decided).
  Ethical urgency only: a launch waitlist, never fake scarcity. “0% commission at launch.”
- **The waitlist collects an email address on every track**, because there is no approved SMS
  sender yet. Customer reassurance: “No spam. One email, the day we open in your area.” Consent
  is an unticked checkbox beside the field; silence is never consent.
- **Fees are stated before they are charged**, in the order the customer meets them: menu price,
  delivery, tax, tip — “Goes entirely to your rider.”
- **No emoji.** Not in product UI, not in marketing, not in transactional copy. Status is carried
  by a component (badge, seal, timeline), never by a glyph in a sentence.
- **Microcopy is short and consequence-first.** Buttons name the outcome (“Mark ready & seal”,
  “Hand to rider”, “Approve and publish”), not the mechanism (“Submit”).
- **Tone check:** trustworthy and hungry, not loud. If a sentence could appear on a discount
  flyer, rewrite it.

### The seven checks

A closed, versioned set (checklist version 1). Approval needs all seven to pass; six of seven is a
rejection with a reason, not a seal. In the product they appear only in the admin checklist; on
the marketing site they appear in explainer form.

| # | Key | In plain English |
|---|---|---|
| 1 | `H1_LEGIBLE_COMPLETE` | The certificate is legible and complete — readable, whole and unaltered. |
| 2 | `H2_ISSUER_ACCEPTED` | The issuing body is one we accept (suggested by the system, confirmed by the admin). |
| 3 | `H3_NAME_MATCH` | The legal name matches the restaurant (suggested by the system, confirmed by the admin). |
| 4 | `H4_ADDRESS_MATCH` | The premises address matches. |
| 5 | `H5_DATES_VALID` | The dates are valid today, with time left on them. Computed by the server; no admin can override it. |
| 6 | `H6_SCOPE_SUFFICIENT` | The scope covers everything sold, not just a supplier. |
| 7 | `H7_UNIQUE_NOT_REUSED` | The certificate is not already in use by another restaurant. Computed by the server; no admin can override it. |

Each check is recorded as **Pass**, **Fail** or **Not assessed**. A rejection needs at least one
Fail and a reason.

### Accepted certifying bodies

HMA Canada, HFSAA and ISNA Canada. A certificate from any one of them passes the issuer check. The
list is a registry that a super admin can extend; it is never typed in free-hand and never ranked.
The client has permission to use the three bodies' logos; the files and any usage rules come from
GitHub issue #116. Until they arrive, the names are set in type (see
`guidelines/brand-certifying-bodies.card.html`); no logo is drawn or approximated.

### Slaughter method

Settled, not yet built. Record the method the certificate states (hand, machine, mixed, or “not
stated”); show it on the restaurant page beside the certification panel only when it is recorded,
and render nothing when it is absent. Never rank, sort or filter by it. It is not an eighth check.
The marketing site may not mention it until the field ships.

---

## VISUAL FOUNDATIONS

**Colour.** A warm cream canvas (`#FFFAEA`) with white cards, ink text (`#232323`), and deep
forest green (`#1B3B31`) as chrome. Action is orange (`#F1521E`, pressed `#D8410F`), and its
label is dark forest `#0F241C` (4.63:1) — the only label colour allowed on the orange. Forest is a
*neutral* — it behaves like charcoal or navy, and the lint rule that bans filled greens outside
the halal colours registers it as an allowed neutral; it is never a success signal. The system's
only filled solid green is the halal seal (`#0F7A43`) with its 1.5px brass ring (`#C9A24B`);
semantic success is tint-plus-icon only. Red (`#C42B1C`) is reserved for destructive actions and
never touches a halal state. Maximum two background colours per view: cream and one of {white,
sage tint, forest}.

**Type.** Three families, settled. **Plus Jakarta Sans** (400/500/600/700) does all product work
in all four apps and the marketing body text. **Bricolage Grotesque** (variable, with an optical
size axis) is the display face for halalgoes.com headlines only, never the apps: hero 118px
desktop / 72px phone, section heads 60px / 34px. **IBM Plex Mono** sets identifiers, certificate
numbers, audit payloads and the marketing record lines, in product and marketing alike (owner
decision; the repo's token file still says JetBrains Mono and is being aligned). Because Plus
Jakarta Sans blurs 1 / l / I and 0 / O, anything that must not be misread is set in the mono.
Headings carry negative tracking (-0.01 to -0.02em); body is neutral; the 11px badge label carries
+0.04em. Tabular numerals are mandatory wherever numbers align or tick. Nothing a customer must
read to decide sits below 13px.

**Spacing and layout.** A 4px scale, 16px default gutter, 96px marketing sections. Density is a
theme-level decision (comfortable 64px rows / compact 44 / roomy 72) — components read the density
token instead of hard-coding padding. Fixed elements: the customer app's bottom nav and its
sticky checkout bar, the marketing sticky nav, the restaurant app bar, and the rider offer sheet
(which outranks every other layer and cannot be dismissed until the server's expiry).

**Backgrounds.** Flat colour. **No gradients anywhere** — not in heroes, not in cards, not behind
type, not as image placeholders (owner decision; `docs/design/01-foundations.md` §12 still
describes gradient placeholders and a photo scrim and is to be aligned to this). The one blend in
the system is inside the wordmark, where the letterforms run into the swash as drawn — that is the
artwork, not a surface treatment. Imagery is intended to be real food photography, warm and
appetising, shot on or against cream; full-bleed above the fold on the marketing hero and at the
top of a restaurant page, otherwise contained in a card with the photo bleeding to the card edge.
No photography has been supplied yet, so every image is a marked placeholder — a warm flat plate
with a muted glyph, never a fake photo. No repeating patterns or textures; no grain.

**Cards.** White, radius 16 (`--radius-lg`), either a 1px warm border (`#E6E0D4`) or elevation 1 —
rarely both loudly: a bordered card sits at elevation 0, a floating card drops the border. Corner
radii run 4 / 8 / 12 / 16 / 20 / 24 / pill; 12 is the default and the seal's radius (a
softly-squared plate reads as a seal, a pill would read as a tag). The marketing site uses the same
scale, with 16px document cards; there is no separate marketing radius set.

**Shadows.** Four light-theme steps, all low-opacity black, plus one “sticky” shadow that points
*up* for bars docked to the bottom. Dark themes ignore shadow entirely and step the surface
instead — black shadow on near-black is invisible. There are no inner shadows and no coloured
shadows or glows in the system.

**Protection.** Text over imagery is never set directly on the photo: it sits in a white capsule
or card. No scrims over photography — capsules instead. The one scrim in the system is the modal
scrim (`#232323B8`).

**The seal on marketing.** The seal never appears alone: **seal + mono record line** is the brand
lockup, and a seal without its record is the placebo badge this category is already full of. The
seal is never placed on a photograph, and it is never a hero element on its own.

**Transparency and blur.** Used sparingly and only on dark chrome: `rgba(255,255,255,.06-.12)`
fills and `.12-.16` hairlines build the rider and restaurant sidebars' inner surfaces. No
backdrop blur; no frosted glass.

**Animation.** Six durations (75 / 120 / 180 / 240 / 320 / 480ms) and six easings: `standard`
(0.2,0,0,1) for almost everything; `decelerate` for entrances; `accelerate` for exits;
`emphasized` for step advances; **`linear` only for countdowns and progress** — easing a deadline
misrepresents remaining time; and `spring` (0.34,1.56,0.64,1), **marketing site only**, transform
and opacity only. Springs (snappy / smooth / gentle) also exist for the native apps. Reduced motion
collapses every duration to zero and replaces slide/scale with a cross-fade; countdown numerals
keep updating, because they are information rather than decoration.

**The seal never performs.** In the apps the seal may appear with its card (the 480ms first
reveal), but it never animates on scroll, never pulses and never shimmers. On halalgoes.com the
seal never moves at all — no stamp, pulse, shimmer or ring-draw, in any state or at any
breakpoint. A moving trust mark reads as an advertisement.

**Hover states.** A translucent ink overlay (`#2323230F`) composited over the control's own fill —
not a different colour. Cards lift by 1px and gain one elevation step. **Press states** darken to
the ramp's pressed step (orange 500 → 600, forest 600 → 800); nothing scales down, nothing bounces.

**Borders.** Decorative hairlines use the warm `#E6E0D4`; any border that bounds an interactive
control must be at least `#8B8578` (3.33:1) to satisfy WCAG 1.4.11. Field borders are 1.5px, not
1px. The unverified halal state is the system's only dashed border.

**Focus.** One indicator, in the theme's brand colour: `#D8410F` (brand 600) in light, `#F3703F`
(brand 400) in dark. Bordered fields (text input, text area, select) show focus with their own
border turning 2px in that colour — no ring, no glow. Borderless controls (buttons, links, cards,
chips) get a 2px offset in the page colour and a 3px ring in the focus colour, flipping to white on
coloured containers where the ring would drop below 3:1. An invalid field in focus keeps its 2px
danger border and adds the ring. Info blue was the focus colour only until September 2026. See
`guidelines/focus.card.html`.

**Accessibility floor.** Body text ≥4.5:1 (≥7:1 on the rider field theme), interactive borders and
focus ≥3:1, 44px minimum targets everywhere, 56px on rider surfaces, 72px for irreversible
actions under time pressure (rider Accept / Decline and restaurant Accept order). One documented
exemption: the decorative brass ring on the seal.

---

## LOGO

The logo is the supplied **HalalGoes script wordmark with an orange swash**, traced to vector.
Files: `assets/Brand/halalgoes-wordmark-light.svg` and `assets/Brand/halalgoes-wordmark-dark.svg`
(556 × 186, transparent). See `guidelines/brand-wordmark.card.html`.

- **Light lockup:** letterforms `#232323` on cream `#FFFAEA` (15.05:1). **Dark lockup:**
  letterforms `#D0D0D1`, as supplied, on `#171717` (11.63:1). Both are the same drawing; only the
  letterform colour changes. Inside the product apps the letterforms take the theme's primary text
  colour, so the apps' dark mode paints them `#F6EFDD`.
- **The swash is always the brand orange `#F1521E`**, in both lockups. The sampled `#F05023` is
  deliberately not used, so the palette never carries two near-identical oranges.
- **Never** put the grey letterforms on cream (1.48:1, fails even the 3:1 floor for graphics);
  never recolour the swash; never redraw the mark or set the name in a typeface in its place;
  never stretch it (width follows the 556:186 ratio). The mark has no green, so it never competes
  with the seal, and it certifies nothing — it never stands in for the seal or the badge.
- Size: the product components render it at a default height of 32px. The brand source does not
  yet set a clear-space or minimum-size rule; that is an open question for the owner.
- **App icon and favicon:** the logo's own H plus the sweeping half of the swash
  (`assets/Brand/halalgoes-app-icon.svg`, one file that switches with the colour scheme). iOS
  icons are opaque and unrounded (iOS applies its own mask); Android maskable and adaptive icons
  carry extra padding so the H survives the circle crop. **The halal seal is never used as an app
  icon or favicon** — it stays where it means something, on a restaurant that has actually passed.

---

## ICONOGRAPHY

- **Solar is the icon system**, strictly, in two weights: **linear for inactive, bold for
  active**. A tab, chip or nav item swaps weight when selected rather than changing colour alone —
  the shape carries the state; colour is secondary.
- **Fourteen shared semantic names**, identical on web and native: home, search, cart, orders,
  profile, map, bell, back, close, plus, check, star, clock, menu. A new glyph is added to that
  shared list from Solar; nothing is drawn by hand and nothing comes from another set. See
  `guidelines/iconography.card.html`.
- Inline SVG in the current text colour (`currentColor`), never a hard-coded hex. Sizes are
  16 / 20 / 24 / 32 / 48.
- Icons are decorative by default; when an icon is a control's only content, the control carries
  the accessible label.
- **The halal shield is bespoke** and not part of the icon set: four variants on a 24 × 24 grid —
  solid (certified), outline (expired), dashed (not verified) and solid with a clock (the renewal
  note) — with the tick knocked out of the shield, never mirrored for right-to-left. Files:
  `assets/Brand/halal-shield-solid.svg`, `-outline.svg`, `-dashed.svg`, `-solid-clock.svg`. It is
  never an icon-set shield and never a font glyph, because a font that fails silently would render
  a blank certification badge. The four shapes let the state survive the loss of colour and text.
- **No icon fonts, no sprite sheets, no PNG icons, no emoji, and no Unicode characters used as
  icons.**

---

## Index

**Root**
- `README.md` — this brand book.
- `tokens.json` — the tokens, imported from `docs/design/tokens.json`; `tokens.css` is generated
  from it.
- `components/bundle.css` — the compiled styles consumers load; component sources are under
  `components/src/components/`.
- `guidelines/` — 28 specimen cards, grouped Colors / Type / Spacing / Brand.
- `assets/Brand/` — the wordmark (light, dark), the app icon, and the four halal shield variants.
- `assets/Uploads/tokens.json` — an older token snapshot, kept for history; not authoritative.
- `assets/notes/` — migration notes from the standalone version.
- `uploads/claude-design-brief.md` — the first landing-page brief (historical).

**Components** (sources in `components/src/components/<group>/<Name>.jsx`; each component has its
own folder under `components/` with a `.d.ts` and a README)

- `core/` — **Button**, **IconButton**, **Card**, **Badge**, **Icon** (Solar)
- `forms/` — **Input**, **Select**, **Checkbox**, **Radio**, **Switch**, **SegmentedControl**
- `halal/` — **HalalShield**, **HalalBadge**, **HalalCertificationPanel**, **HalalChecklist**
- `data/` — **Price**, **Countdown**, **StatusTimeline**, **DataTable**, **Rating**
- `feedback/` — **Dialog**, **Sheet**, **Toast**, **Menu**
- `navigation/` — **AppBar**, **BottomNav**

Two halal components carry rules worth repeating here:
- **HalalCertificationPanel** (customer) shows the certificate record: the certifying body's name
  exactly as verified, the certificate number, the issue date, the expiry as an absolute date, the
  verification status, the date an admin verified it, “View certificate”, and the standing line.
  It does not list the seven checks. It has no default state and no default body name: with no
  state it renders nothing and logs an error.
- **HalalChecklist** (admin) shows the seven checks in fixed order, 1 to 7, each as Pass / Fail /
  Not assessed with a note field. Checks 5 and 7 are locked (computed by the server); checks 2 and
  3 show a “suggested” marker.

**UI kits** — five screen kits, not components: Admin web kit (`ui_kits/admin-web/`), Customer
app kit (`ui_kits/customer-app/`), Marketing site kit (`ui_kits/marketing-site/`), Restaurant web
kit (`ui_kits/restaurant-web/`), Rider app kit (`ui_kits/rider-app/`). Each has its own README.
The marketing site has three audience tracks — Order food, List your restaurant, Deliver with us.

### Where the component inventory came from
The token file names the components it governs, and that list is the inventory built here:
HalalBadge, HalalCertificationPanel, the admin HalalChecklist and the bespoke shield; Price,
Countdown, StatusTimeline, DataTable and Rating (the tabular-numeral mandate); Button/CTA,
Input, Select, Checkbox and Switch (border and track-on rules); AppBar, BottomNav, the floating
cart bar and sticky checkout footer (elevation `sticky`); Dropdown, Sheet, Modal, Toast and the
rider offer sheet (the z-index ladder). The landing-page brief adds the segmented audience toggle.

**Intentional additions** (not named by a source, added for a stated reason):
- **Icon** — a wrapper for the Solar set with the fourteen shared names and the linear/bold
  weights; without it every surface would inline raw SVG and drift.
- **Radio** — the checkout tip selector and refund-reason picker need single-choice; the token
  file covers checkbox and switch but not radio.
- **IconButton** — app bars and photo overlays need a 44px icon-only target; splitting it out of
  Button keeps the accessible label mandatory.
- **HalalShield** — the bespoke glyph, isolated so the three halal components share one mark.

## Gaps and open questions
1. **Font binaries.** None are bundled. Plus Jakarta Sans, Bricolage Grotesque and IBM Plex Mono
   load from Google Fonts. The right-to-left face (IBM Plex Sans Arabic) is pre-selected in the
   tokens but **not shipped at launch** (English, Canada only), so `--font-rtl` is not a live token
   and no other Arabic family has been substituted for it.
2. **Certifying-body logos.** Permission is granted; the files and each body's usage rules are
   pending in GitHub issue #116. The names are set in type until then.
3. **Photography and illustration.** None supplied; all are marked flat placeholders.
4. **Wordmark clear space and minimum size.** Not yet specified by the brand source.
5. **Repository follow-ups the owner has already decided:** the token file's mono family
   (JetBrains Mono → IBM Plex Mono), its icon description (still says Lucide → Solar), and
   `01-foundations.md` §11 and §12 (Lucide, gradient placeholders and the photo scrim → Solar, no
   gradients, no scrims).
6. **Mobile artboards for the landing page.** The site is built phone-first at 390px; check the
   marketing kit against it.


## Starters

In the standalone version, this design system came with 1 starter template(s). Each is a small project of its own, not a part of the design system the page shows; its files are kept in this artifact as they were, under its folder, for a later migration of its own.

- **Waitlist hero** — Pre-launch dual-audience hero: forest nav, cream ground, orange CTA, verification seal card. (3 files, entry `templates/landing-waitlist/LandingWaitlist.dc.html`)
