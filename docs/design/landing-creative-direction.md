# HALAL GOES — FINAL CREATIVE DIRECTION
### v1.0 · 17 September 2026 · Hand this straight to build. `apps/landing` (Astro static + vanilla islands).

---

## 1. VERDICT

**Direction 2 — "The List" — wins the spine. Direction 1 — "The Record" — wins the craft.**

Direction 1 is the more rigorous document and it is right about almost everything except the one thing that matters most: it opens a **food** brand with paperwork. A hero whose primary object is a certificate, on a page with one food photograph in it, is not "generic" — it is a white paper. The client's complaint was that the page felt like nobody lived there. Answering "generic as fuck" with "here is a form to read" trades one kind of coldness for another, and it asks a problem-aware reader to study the mechanism before they have been given a reason to want anything.

Direction 2 has the single most valuable sentence in either document — *"You already have a list. It's four places long."* That is an audience truth. No generator produces it. It is the whole brand in nine words, and it makes verification feel like **a door into something you want**, not a compliance feature.

But Direction 2 alone would ship soft. Its hero is a right-bleed food photo with type on the left — closer to the category default than it admits — and its blank record card, while honest, is a weak object to hang the brand on (an entirely empty form demonstrates nothing and reads as unfinished).

**Grafted from Direction 1, wholesale:**
- **The record as a designed artifact** — and I am overruling both directions on where it goes: it sits **in the hero, on the photograph**, as a *specimen*, not a sample of an invented restaurant and not a blank. Appetite and proof land in the same frame, in the first screen.
- **The mono record line** as the page's signature type device.
- **The four halal states, including expired in slate**, as a full section.
- **Three surface planes**, the colour budgets, and the **desaturation test** as a shippable merge gate.
- **Split pages, not a toggle** (`/` and `/for-restaurants`).
- **The `.js`-gated reveal rule** — no `opacity:0` that a JS failure can strand.
- **The CASL fixes** — unchecked consent, logged consent string, consent artifact on the email path.
- **The seven checks as a ruled single-column form**, never a card grid.

**And I am overruling both on two points:**
1. **The CBC citation is not the page's opening act and it is not a footnote.** It is one short, quiet cream band placed *between* the appetite and the door, titled *Why the list is short*. It explains a restriction the reader has just been given a reason to care about. As an opener it is a grievance; as a footnote it is wasted.
2. **Nothing invented ships, including a plausible-looking specimen restaurant.** The hero record card carries a real issuer name (HMA Canada exists; naming it is a fact), real field labels, real structure — and every identifying value is a typeset rule with the caption `SPECIMEN — THE FIELDS WE FILL IN BEFORE A KITCHEN IS LISTED.` Layout demonstrated, nothing fabricated.

---

## 2. THE CONCEPT

**Every halal household in the GTA already keeps a list.** Four places, maybe six. Assembled over years out of cousins, a WhatsApp group, and one bad experience you still think about. Everything else on every delivery app is off-limits — not because it's forbidden, but because nobody checked.

**Halal Goes is that list, kept by someone whose job it is to keep it.**

The page does not argue about verification. It makes you hungry the way the group chat does — charcoal, rice, a lemon wedge, a table with too many hands on it — then tells you, calmly and in the register of paperwork, exactly what door every kitchen had to walk through to get on it. Verification is never the pitch. It is **the permission slip under the appetite**: the thing that lets you want dinner without running the private negotiation you normally run.

**The line (on the page):**

> # Order without asking.

**The organising line (internal, never on the page):** *They already have a list. We keep it properly.*

**Three rules that govern every decision below:**
1. **Appetite first, belonging second, paperwork third — in that order, every time.** The proof is the reason it's safe to want it, never the reason to read.
2. **Show the record, never claim the virtue.** Every adjective about ourselves costs credibility; every noun we hand the reader earns it.
3. **The seal never appears without its record, and the seal never moves.** Seal + mono record line is the brand lockup. A seal alone is the placebo badge this category is already drowning in.

---

## 3. STORY SPINE

Eleven beats. The emotional arc is **desire → recognition → explanation → permission → belonging → ask.** The tension beat arrives late, quiet, and sourced — never as the opening.

| # | Beat | What the visitor thinks |
|---|---|---|
| 1 | **Desire + the artifact** (hero) | "That's dinner. …and *that's* what they keep on file before it's listed?" |
| 2 | **Recognition** | "They know about the list. Everyone I know has one." |
| 3 | **The craving grid** | "Charcoal chicken in Scarborough. Yes." |
| 4 | **Why the list is short** | "So it isn't just me being difficult. A national broadcaster checked." |
| 5 | **The door** — seven checks + issuers | "This is a real procedure, and I can see which failure each check catches." |
| 6 | **The refusal** *(hinge)* | "They're telling me what they *won't* do. Nobody does that." |
| 7 | **The record, in four states** *(hinge)* | "They'll show me when they *can't* vouch. That's the part I believe." |
| 8 | **Sealed** | "So nobody's had it open between the pass and my door." |
| 9 | **Who's behind this** + honest empty state | "A person, with an email that reaches him. No fake reviews." |
| 10 | **The restaurant door** | "My cousin should see this." |
| 11 | **The ask** *(hinge)* + FAQ + footer | "Fine. Take my number." |

Beats 6 and 7 are where the brand is won. **Voluntarily showing your own failure state, pre-launch, is the most persuasive thing on the page and it costs nothing — the states already exist in the design system.**

**Restaurant spine (`/for-restaurants`):** *your certificate is an asset nobody is paying you for* → *the same seven checks, from your side* → *the arithmetic against a published rate* → *what happens when 0% ends* → *send the certificate.*

---

## 4. PAGE ARCHITECTURE

### 4.0 Global frame

- **Grid:** 12 columns, container `max-width: 1160px`, gutter 24px (≥900px) / 20px (<900px). **One optical left edge** — every eyebrow, H2 and paragraph starts on column 1. Only two things are centred on the whole site: nothing. (The final CTA is left-aligned too; centred closers are the template tell.)
- **Breakpoints:** 640 / 900 / 1200. Verify the token generator's literal breakpoint output before relying on variants.
- **Vertical rhythm is deliberately uneven.** Add to `tokens.css`:
  ```css
  --space-section-tight: 72px;   /* short, high-contrast strips */
  --space-section: 96px;         /* existing default */
  --space-section-hinge: 176px;  /* the three narrative hinges */
  ```
  Hinges (176px): **the refusal**, **the four states**, **the ask**. Tight (72px): recognition, why-the-list-is-short, issuer row, restaurant door.
- **Three surface planes, only three.** Cream ground (`--surface-base`, ≥70% of scroll) → white document cards (`--surface-raised`, 1px `--border-decorative`, `--elev-1` max) → forest full-bleed bands (`--color-accent-600` / `-800`, no radius, no shadow). Depth comes from the plane change, never from shadow.
- **Dual audience, settled:** `/` is the diner page, complete and uncompromised, **one `<h1>`**. `/for-restaurants` is a full page of its own, **one `<h1>`**. The nav carries one quiet permanent text link. `/?for=restaurant` and `/?a=own` **301** to `/for-restaurants`. The diner page also carries one genuine restaurant band (§4.10) so nobody has to self-classify to get information. **Delete the segmented audience toggle in `Nav.astro` and the `localStorage`/`data-audience` machinery with it.**

---

### 4.1 — NAV · `Nav.astro` (rewrite)

**Job:** name the brand, put a door where a restaurateur will find it, get out of the way of the food.

**Layout:** 60px tall, `--surface-base` cream, `position: sticky; top: 0`, **no border until scrolled** (`.is-stuck` adds `border-bottom: 1px solid var(--border-decorative)`). Wordmark left, 17px/800. Right: two 15px/600 ink text links — `How we check` (anchors `#the-door`) and `I own a restaurant →`. Hairline underline on hover, 2px offset.

**No CTA button. No orange. No hamburger.** The hero form is already on screen; a second ask in the highest-attention strip is three affordances fighting. Mobile: wordmark + `I own a restaurant →` only.

**On `/for-restaurants`:** right-hand links become `How we check` + `I want to order →`.

---

### 4.2 — HERO · `Hero.astro` (rewrite) + `RecordCard.astro` (new) + `WaitlistForm.astro` (rewrite)

**Job:** in the top ~350px of a 390×844 phone, make them hungry, say the category, and take the number. Immediately below that, hand over the artifact — so the scroll is *earned*, not requested.

**Desktop (≥900px):** asymmetric two-column, `grid-template-columns: 6fr 6fr; gap: 64px`, section padding `72px` top / `120px` bottom.

- **Left column (cols 1–6, max 540px), in order:** chip → H1 → lede → form → objection line. Vertically centred against the photo.
- **Right column (cols 7–12):** one photograph, `table.jpg` regraded — a real table mid-meal, hands in frame, plates half-finished. **Full strength. No scrim. No gradient. No zoom.** `aspect-ratio: 4/5`, `min-height: 620px`, `object-fit: cover`, **bleeds to the right viewport edge** (`margin-right: calc(50% - 50vw); border-radius: 16px 0 0 16px`). If it needs a scrim for contrast, the crop is wrong — refix the crop.
- **The specimen record card** overlaps the photo's **lower-left corner**, offset `-56px` left and `-40px` up from the photo's bottom-left, `width: 400px`, `z-index: 2`. Opaque white, 16px radius, 1px `--border-decorative`, `--elev-1` **only**. This is paper on a table, not app chrome floating on a gradient: no blur, no glass, no white top-highlight, no rounded-full anything.

**Mobile (<900px):** stacks — chip → H1 → lede → form → consent → objection line → photo (4:5, full-bleed, `loading="eager"`, `fetchpriority="high"`) → record card on cream beneath it. **False-floor guard:** the photo's top edge must sit ~80px above the 844px fold line so the image is visibly *clipped*, and the record card must never be completed above the fold. A visible cut edge is the cheapest scroll affordance there is.

**Type:** chip 12px mono uppercase `.08em` tertiary with a 6px emerald dot. H1 `clamp(40px, 6.6vw, 72px)`, 800, `line-height:1.02`, `letter-spacing:-0.035em`, max 12ch/line desktop. Lede `clamp(18px,2.1vw,20px)`, 400, 1.45, **max 46ch**.

**The RecordCard (specimen state):**

```
┌─ white · 16px · 1px #E6E0D4 · --elev-1 · 28px padding ────┐
│  SPECIMEN · THE FIELDS WE FILL IN BEFORE A KITCHEN IS     │ ← mono 11px tertiary
│  LISTED                                                   │
│  ─────────────────────────────────────────────────────    │
│  ◈  Halal certified        ← seal 32px + emerald tint pill│
│  ─────────────────────────────────────────────────────    │
│  KITCHEN        ————————————————  ·  —————— , ON          │ ← label mono 11px caps
│  ISSUED BY      HALAL MONITORING AUTHORITY (HMA CANADA)   │   value mono 14px ink
│  CERTIFICATE    ————————————————                          │
│  SCOPE          ————————————————                          │
│  IN FORCE TO    ————————————————                          │
│  CHECKED BY     ——————  ·  ——————                         │
│  ─────────────────────────────────────────────────────    │
│  REVIEWS        None yet. We haven't opened.              │
│  ─────────────────────────────────────────────────────    │
│  We don't certify food and we don't make religious        │ ← 13px secondary, 52ch
│  rulings. We check the certificate and show you who       │
│  issued it.                                               │
└───────────────────────────────────────────────────────────┘
```

Empty values are 1px dotted `--border-decorative` rules of fixed width, not underscores. **The only filled value is the issuer, because that organisation is real.** On launch day this component takes real props and the `SPECIMEN` caption is deleted — a data change, not a design change.

**Component props:** `RecordCard({ state: 'certified'|'expired'|'review'|'none', specimen?: boolean, kitchen?, city?, issuer?, certNumber?, scope?, inForceTo?, checkedBy?, checkedOn?, reviews?: string, size: 'lg'|'sm' })`.

**Deleted from the current hero:** the dual audience render, the second `<h1>`, both hero variants shipping into one DOM. No stamping seal, no Ken Burns, ever.

#### 4.2F — The form (one field, forever)

Order top to bottom: **persistent label** (13px/600 ink — not a placeholder-as-label) → input → button → consent checkbox → consent sub-line → objection line.

- Input `type="tel" inputmode="tel" autocomplete="tel" autocorrect="off" spellcheck="false"`, **placeholder `416 555 0134`** — digits and spaces only; the iOS telephone keypad physically cannot type `(` or `-`. 52px tall, radius `--radius-marketing-sm` (11px), 1px `--border-interactive`.
- Button 52px, **radius 11px — not a pill**, `--action-primary` orange, 16px/600, full-width on mobile, `grid-template-columns: 1fr auto` beside the input at ≥640px.
- **Consent checkbox ships UNCHECKED.** The current `WaitlistForm.astro` renders `checked`; under CASL a pre-checked box is not express consent (CRTC 2012-549). This is a compliance fix, not a CRO choice. Recover the loss by framing the label as the *benefit*, not the permission.
- `forms.ts` must POST **the rendered consent sentence** alongside `consentAt` and `context`, so the artifact survives a copy edit. The `own` (email) path currently records no consent artifact at all — CASL covers email identically. Fix both.
- **Success replaces the form; it does not disable it in place.** See §5.7 for the full success state, including the post-conversion city field and copy-link action.

---

### 4.3 — RECOGNITION · `Recognition.astro` (new) *(tight — 72px)*

**Job:** one sentence that makes the reader feel known, so the food that follows feels like theirs. This is also the page's *breath* — the short band between a tall hero and a tall grid.

**Layout:** cream, no image, no card. Single column on the optical left edge, cols 1–7. Display type 28–34px/800, ink, max 30ch. One 13px mono line beneath in `--text-tertiary`, max 62ch. Nothing else in the band.

---

### 4.4 — THE CRAVING GRID · `CravingGrid.astro` (new)

**Job:** the appetite engine. Turn "halal delivery" from an abstraction into six things you can taste. Largest single block of vertical space on the page.

**Layout:** cream ground, `--space-section` (96px). Section head left on the grid (cols 1–6): eyebrow → H2 → one 62ch line. Then a **deliberately uneven photo grid**: 12-col CSS grid, `grid-auto-rows: 8px`, six tiles with hand-set `grid-row: span` values so heights differ (e.g. `span 46 / span 36 / span 54 / span 38 / span 50 / span 40`). Desktop 3 across × 2 rows. Tablet 2 across. **Mobile 1 across, full-width 4:5** — a scroll of plates, the most appetising possible mobile form, free.

Each tile: photo, 16px radius, 1px hairline, **no shadow**, `overflow: hidden`. Caption over the bottom-left in white 17px/600, on a 0→40% black bottom gradient **no taller than 35% of the tile**. Beneath the tile, **on cream, not on the photo**, a 12px mono neighbourhood line.

**Hard rule: no restaurant names, no logos, no prices, no ratings, no "4.8★".** Tiles are *dishes and neighbourhoods* — both real and both ownable. Anything naming a business pre-launch is fabricated proof.

**Assets:** `grill.jpg`, `biryani.jpg`, `shawarma.jpg`, `curry.jpg`, `kebab.jpg`, `mezze.jpg`. Spares: `platter.jpg`, `hero-spread.jpg`. All lazy except tile 1.

---

### 4.5 — WHY THE LIST IS SHORT · `WhyShort.astro` (new) *(tight — 72px)*

**Job:** prove the problem is real with somebody else's reporting, in the fewest possible words, attributed and linked. It explains the restriction the reader has just been given a reason to care about.

**Layout:** cream — **not** a dark band; the dark budget is spent on the refusal and the ask. Two hairline rules, one above and one below the section, full container width. Inner text block cols 1–7, `max-width: 640px`, left on the optical edge. Eyebrow mono. Body 18px/1.6. One mono attribution line at 12px with the **only non-orange link on the page** (ink, 1px underline, 3px offset). No image, no icon, no pull-quote marks, no logo.

**Never name the chains in our own copy. Let the link name them.**

---

### 4.6 — THE DOOR · `Checklist.astro` + `IssuerRow.astro` (new; replaces `Verification.astro`)

**Job:** make the labour visible. Buell & Norton: showing operational effort raises perceived value even when the output is identical. Appetite has been earned; now the reader wants to know why they're allowed to have it.

**Layout:** cream ground, `--space-section`, `id="the-door"`.
- **Left column (cols 1–4, `position: sticky; top: 88px` at ≥1000px):** eyebrow, H2, standfirst (max 56ch), then the **issuer row**, then the `Read the verification standard →` link.
- **Right column (cols 6–12):** one white document card, 16px radius, hairline, `--elev-1`, 40px padding (24px <640px). Inside it, the seven checks as a **single column at every width**. Each row `grid-template-columns: 28px 1fr 20px`, 20px vertical padding, separated by 1px `--border-decorative` hairlines — **rules, not boxes**. Col 1: check number in mono 13px tertiary, tabular. Col 2: title 17px/700 ink, then one body line 15px/1.55 secondary, max 56ch. Col 3: the emerald tick — `HalalShield.astro`'s check path at 18px, stroke `--color-halal-certified-seal`. **No filled shield here; the shield is reserved to the seal.**

**Never a seven-card grid.** A grid reads as a feature list; a ruled single column reads as a form somebody filled in. That is the entire point.

**Issuer row (`IssuerRow.astro`):** label in mono caps, then issuer **names set in type, never as logos** — 15px mono uppercase `.06em`, each an external link, with a 12px mono locality beneath. **Wordmarks are forbidden here**; a logo wall implies partnership we do not have. Frame as "certificates we read," never "our partners," and carry the non-affiliation line.

> **Integrity fix, must ship:** the live `Verification.astro` lists **HFSAA** — the Halal Food Standards Alliance of **America** — as a recognised issuer on an Ontario page. Replace with **IFANCC (Mississauga)** per the copy below, or label it `UNITED STATES` explicitly. A knowledgeable visitor spots this in two seconds and it directly undercuts the one thing we sell.

**The `Read the verification standard →` link must have a real `href`** to `/verification`. It currently ships as a `<Button>` with no destination. Verifiability is Stanford credibility guideline #1 and is our only honest substitute for social proof; a dead link there is fatal.

---

### 4.7 — THE REFUSAL · `Refusal.astro` (new) *(hinge — 176px)*

**Job:** convert our hardest legal constraint into the most trustworthy sentence on the site. Humility at scale reads as confidence.

**Layout:** the page's **first of two** full-bleed forest bands, `--color-accent-600`, `padding-block: var(--space-section-hinge)`. One statement, cols 1–8, **left-aligned**, `clamp(30px, 4.6vw, 48px)`, 800, `-0.025em`, max 16ch/line, in `--color-neutral-50`. One supporting paragraph beneath, 18px/1.65, max 58ch, in `--color-accent-100`. **Cols 9–12 stay empty.** That emptiness is the section's whole design — it is the visual equivalent of not over-claiming. No image, no button, no shadow, no grain (it bands on dark).

This copy currently lives as `.verify-disclaimer` in small grey type. Promote it.

---

### 4.8 — THE RECORD, IN FOUR STATES · `StateGrid.astro` (new) *(hinge — 176px)*

**Job:** show the failure mode voluntarily. This is the credibility beat and the one deliberate grid break.

**Layout:** cream. H2 + lede on the optical edge (cols 1–6). Beneath, a **large `RecordCard` in the certified state**, cols 3–11 — offset right by 32px, breaking the optical edge **once on the whole page**. One asymmetry in a strict grid reads as art direction; three read as chaos.

Beneath it, four compact state cards: `repeat(4,1fr)` ≥1000px, `repeat(2,1fr)` 640–999, single column below. Each white, 16px radius, hairline, 20px padding, containing the badge in that state at 40px, a 15px/700 label, a 14px/1.5 caption, and a mono line stating exactly what the app does.

1. **Halal certified** — emerald seal + brass ring · `RECORD SHOWN · TAP TO OPEN`
2. **Expired** — `--color-halal-expired-seal` #4E5862 cool slate · `LISTING HIDDEN UNTIL RENEWED`
3. **Under review** — outlined slate, **no fill** · `APPLICATION RECEIVED · NOT LISTED`
4. **No record** — **no badge at all**: an empty 40px square with a hairline · `NO BADGE RENDERED`

Invariants 8 and 9 are literally the content of this section. **Nothing here is red, and card 4 renders no badge — not a greyed one.**

---

### 4.9 — SEALED · `Sealed.astro` (new; replaces `HowItWorks.astro`)

**Job:** state chain-of-custody as a **fact**. The animated journey is dead; the fact is excellent copy.

**Layout (target, once photography exists):** cream, `--space-section-tight`. H2 on the optical edge. Three static photographs, `repeat(3,1fr)` ≥900px, stacked below, 24px gap. Each: 3:2 image, 12px radius, hairline; then a mono step label and one 15px sentence at max 42ch. Hands only, close, shallow depth of field, real bags, a real Ontario porch in real Ontario weather.

**Ship-now fallback — and this is a decision, not a placeholder:** until those three frames are shot, **ship this section as one white document card with three ruled rows** (mono step number, 17px/700 line, 15px sentence) in exactly the grammar of the seven checks. **Never a stock photograph, never an icon trio, never a timeline rail with arrows.** The card is on-brand and honest; a stock photo is neither.

**Forbidden here permanently:** connecting lines, arrows, numbered rails, sticky columns, scroll-scrub, any sequence that plays.

---

### 4.10 — WHO'S BEHIND THIS · `Founder.astro` (new) + the honest empty state *(replaces `SocialProof.astro`)*

**Job:** Stanford credibility guidelines 2, 4 and 5 — a real organisation, real people, reachable. For a community product this is the trust mechanism, not garnish.

**Layout:** cream, `--space-section-tight`, two columns ≥900px (`5fr 7fr`). Left: a 4:5 portrait of the founder — real, in a real room, looking at camera, 16px radius. Right: four short paragraphs, signed, with a **real `mailto:`** in ink, underlined — an address, not a form.

**Ship-now fallback:** if there is no real portrait, the section ships **type-only** with the signature line set in mono. **No stock portrait, ever** — on a page about who signed off, a stranger's stock face is a lie about the one thing we sell.

Beneath, on the same band: the **honest empty state** — a white strip, 1px hairline, 13px mono, stating plainly that there are no reviews, no counts and no partner logos here.

`SocialProof.astro` must be emptied of everything invented and rebuilt as this strip, or deleted. There is no third option.

---

### 4.11 — THE RESTAURANT DOOR · `RestaurantBand.astro` (new) *(tight — 72px)*

**Job:** catch the diner who owns a kitchen, or whose cousin does, with enough substance that the trip to `/for-restaurants` is worth it.

**Layout:** the page's **second and last** forest band, `--color-accent-600`, `padding-block: 72px`. Two columns: left (cols 1–6) eyebrow + H2 + three-line body + the arithmetic line in mono with its source; right (cols 8–12) a compact three-row **white card on forest** listing what onboarding takes. One **orange** button, `See the partner terms →`, linking to `/for-restaurants`.

**No email capture here.** Capturing on a band the visitor skimmed produces low-intent leads and splits the measurement.

---

### 4.12 — THE ASK · `FooterCta.astro` (rewrite) *(hinge — 176px above)*

**Job:** close with the identical words as the hero. One conversion, repeated verbatim, is what a single-conversion page is for.

**Layout:** cream (not dark — the two dark bands are spent; the footer proper is the third dark surface). Inner block `max-width: 560px`, **left-aligned on the optical edge**. H2 `clamp(30px,4vw,44px)` repeating the hero H1 **verbatim**, lede, then the *same* `WaitlistForm` component instance (`context="footer"`) — same label, same helper, same button copy, same unchecked consent.

**Footer proper:** separate strip on `--color-accent-800`, 1px `rgba(255,255,255,.08)` rule above, 48px padding. Wordmark, tagline `Verified halal, delivered.`, then `/verification` · `I own a restaurant` · `Privacy` · a real mailto, then the copyright line.

---

### 4.13 — FAQ · `Faq.astro` (rewrite)

**Job:** the reference layer and the SEO/GEO surface. Objections that *block* the form are handled inline beside the form; this is where the rest lives.

**Layout:** cream, single column, `max-width: 720px`, left-aligned, `--space-section`. `<details>` + `<summary>`, 1px hairline between items, question 17px/700, answer 16px/1.65 at max 62ch. **Remove the `name="faq"` attribute** — the exclusive accordion closes the answer a user is comparing against. Keep the `FAQPage` JSON-LD; the answers are quotable and self-contained, which is exactly what AI-search citation rewards.

---

### 4.14 — STICKY CTA · `StickyCta.astro` (new, mobile only)

Appears once the hero form scrolls out; hides whenever any waitlist form is in view. 64px, white, `--elev-sticky`, `padding-bottom: max(12px, env(safe-area-inset-bottom))` so it never sits on the iOS home indicator. One orange button + one 13px line. `display: none` ≥768px. **Ships behind a flag and gets measured** — sticky CTAs win roughly 29% of mobile tests, which is a coin-flip-plus, not a gift.

---

### 4.R — `/for-restaurants` (the mirror page)

Same components, same grammar, different argument. One `<h1>`.

1. **Nav** (right link `I want to order →`)
2. **Hero** — eyebrow carries the offer; H1 is the sunk-cost reframe; form is **email**, one field; right column is the **same `RecordCard`**, specimen state, captioned as *the record we'd build out of the document already in your drawer*. No food photograph on this page — the owner's subject is their certificate, not dinner.
3. **Why the list is short** — identical cream band, identical copy. The owner needs this beat *more* than the diner: it is why their certificate is worth something.
4. **The same seven checks**, verbatim, under an applicant-side H2.
5. **The arithmetic** — white card, three rows, tabular figures, sourced and linked.
6. **When the 0% ends** — the objection that actually kills B2B signup, answered above the form.
7. **Onboarding, three rows** — same ruled-card treatment as §4.9.
8. **Restaurant FAQ** (five entries).
9. **The ask** — cream, email form, footer.

---

## 5. FINAL COPY

> Rules that governed every line: no adjective about ourselves where a noun will do; no Arabic religious vocabulary in marketing copy; no *seamless, unlock, elevate, curated, journey, effortless, revolutionise, game-changer, "on a mission to"*; no "The [adjective] way to [verb] your [noun]"; plain Canadian English said out loud; every limit stated before the reader finds it. Two lines carry **[PRODUCT SIGN-OFF]** and the page works if they're cut.

### 5.1 Nav
- Wordmark: `Halal Goes`
- Diner page: `How we check` · `I own a restaurant →`
- Restaurant page: `How we check` · `I want to order →`

### 5.2 Hero — `/`

**Chip:** `GREATER TORONTO AREA · PRE-LAUNCH`

**H1:**
> **Order without asking.**

**Lede:**
> Halal delivery across the GTA. Every kitchen here had its halal certificate read by a person — the issuer, the kitchen it names, the date it runs out — before it was ever listed. So the only thing left to decide is dinner.

**Form:**
- Label: `Mobile number`
- Placeholder: `416 555 0134`
- Helper, under the field, 13px tertiary: `We text once, on launch day. We don't call.`
- Button: **`Text me when you open`**
- Consent, **unchecked**: `Text me when Halal Goes opens in my city.`
- Consent sub-line, 12px: `One message at launch from Halal Goes, Toronto ON, then the occasional note about newly verified kitchens near you. Reply STOP any time.`
- Objection line under the form, 13px secondary: `Nothing to install — we're pre-launch. One number, no account, no card.`

**Record card:**
- Caption: `SPECIMEN · THE FIELDS WE FILL IN BEFORE A KITCHEN IS LISTED`
- Status pill: `Halal certified`
- Labels: `KITCHEN` · `ISSUED BY` · `CERTIFICATE` · `SCOPE` · `IN FORCE TO` · `CHECKED BY` · `REVIEWS`
- Issuer value: `HALAL MONITORING AUTHORITY (HMA CANADA)`
- Reviews value: `None yet. We haven't opened.`
- Footnote: `We don't certify food and we don't make religious rulings. We check the certificate and show you who issued it.`

*Safe alternate H1 for A/B, if the client won't wear an H1 without the category in it:* **`Halal you can check, not just hope.`** A/B it against the recommendation — never against a feature headline, you'd learn nothing.

### 5.3 Recognition band

> ### You already have a list. It's four places long.

`The same kitchens for years, because somebody in the family checked once, and everywhere else stayed a question.`

### 5.4 Craving grid

**Eyebrow:** `WHAT'S ON IT`
**H2:** `Everything here made the list.`
**Line under the H2 (62ch):** `Charcoal, rice, bread straight out of the oven — from kitchens across the GTA whose certificates we've read.`

| Tile | Caption | Mono line | Asset |
|---|---|---|---|
| 1 | `Charcoal chicken, still spitting.` | `SCARBOROUGH` | `grill.jpg` |
| 2 | `Biryani by the tray.` | `MISSISSAUGA` | `biryani.jpg` |
| 3 | `Shawarma carved off the spit.` | `THORNCLIFFE PARK` | `shawarma.jpg` |
| 4 | `A curry that takes all afternoon.` | `ETOBICOKE` | `curry.jpg` |
| 5 | `Kebabs, and too much bread.` | `NORTH YORK` | `kebab.jpg` |
| 6 | `Mezze, for when there are nine of you.` | `MARKHAM` | `mezze.jpg` |

**Closing line under the grid, 13px mono tertiary:**
`NEIGHBOURHOODS WE'RE OPENING IN FIRST. KITCHEN NAMES GO UP WHEN THEY'VE PASSED THE CHECK.`

### 5.5 Why the list is short

**Eyebrow:** `WHY THE LIST IS SHORT`

> In October 2024, CBC Marketplace visited ten Greater Toronto Area locations of five well-known chains. Staff at six of them said the restaurant was halal-certified. None of the ten was. At several, an employee produced a *supplier's* certificate — proof the meat was certified — and used it to suggest the whole kitchen was.
>
> Nobody in that story is lying on purpose. The system is confusing, and the person who ends up carrying the doubt home is you. That's the whole reason check number three exists.

**Attribution:** `SOURCE: CBC MARKETPLACE, 18 OCTOBER 2024 —` [`read the investigation →`]

### 5.6 The door

**Eyebrow:** `THE DOOR`
**H2:** `How a kitchen gets on the list.`

**Standfirst (56ch):**
> Anyone can write "halal" on a menu. Getting onto this list takes a document, seven checks, and a person's name against the date they checked it. The badge on a listing *is* that record — you can open it and read it yourself.

**The seven checks:**
1. **A real certificate** — A current halal certificate is on file. Not a claim on a menu. A document.
2. **An issuer we recognise** — HMA Canada, ISNA Canada, IFANCC, or another accredited Canadian authority. We print which one on the listing.
3. **This exact kitchen** — The certificate names this restaurant. Not a parent brand, and not the meat supplier.
4. **A number that checks out** — We verify the certificate number against the issuing body's own record.
5. **In force today** — Not expired. We track the renewal date, and the listing comes down the day it lapses.
6. **It covers the menu** — The scope of the certification matches the food this kitchen actually serves.
7. **A person signed off** — A Halal Goes admin reviewed all six, and we record who checked it and when. That record is the badge.

**Issuer row label:** `CERTIFICATES WE READ`
> `HALAL MONITORING AUTHORITY (HMA CANADA)` — `TORONTO, ON`
> `ISNA CANADA HALAL` — `MISSISSAUGA, ON`
> `IFANCC` — `MISSISSAUGA, ON`

**Issuer footnote, 13px:** `We're not affiliated with these organisations and they don't endorse us. We read the certificates they issue, and we print their name on the listing so you know whose standard you're looking at.`

**Link:** `Read the verification standard →` → `/verification`

### 5.7 The refusal

**H2:**
> **We don't certify food. We don't make rulings. That isn't ours to make.**

**Body:**
> We do the clerical work. We get the certificate, we read it, we check it's real and still in force, and we put our name against the date we checked. What the badge shows is what the certificate says — including who issued it, so you can decide whether that issuer meets your standard.

### 5.8 The record, in four states

**Eyebrow:** `WHAT THE BADGE CAN SAY`
**H2:** `Including when we can't vouch for a kitchen.`
**Lede:** `Four states, and only four. We'd rather show you less than show you something we can't stand behind.`

| State | Label | Caption | Mono line |
|---|---|---|---|
| 1 | **Halal certified** | A current certificate is on file and a person has checked it. Open it and read it. | `RECORD SHOWN · TAP TO OPEN` |
| 2 | **Expired** | We can't currently vouch for this kitchen. An expired certificate means our information has lapsed — not that anything is wrong with the food. | `LISTING HIDDEN UNTIL RENEWED` |
| 3 | **Under review** | We've got the paperwork. We haven't finished checking it. | `APPLICATION RECEIVED · NOT LISTED` |
| 4 | **No record** | If we haven't read a certificate, you see nothing at all. Never a maybe. | `NO BADGE RENDERED` |

### 5.9 Sealed

**Eyebrow:** `AFTER YOU ORDER`
**H2:** `Sealed at the kitchen. Opened by you.`
1. `01 · AT THE KITCHEN` — **The kitchen seals the bag.** Nothing leaves the pass open.
2. `02 · AT PICKUP` — **Your rider scans the seal.** They carry it. They don't open it.
3. `03 · AT YOUR DOOR` — **It's scanned again when it reaches you.** If a seal arrives broken, tell us and we'll make it right.

### 5.10 Who's behind this

**H2:** `Who's behind this.`

> I'm `{founder.firstName}`. I grew up in `{founder.neighbourhood}`, and like everyone I know, I kept a short list of places I'd order from and quietly avoided the rest. Asking at the counter never got anyone a real answer — it just made you the difficult one.
>
> Halal Goes is me and a small team doing the part everybody does alone: getting the certificate, reading it, and writing down what it says. That's the whole company.
>
> We're pre-launch. There's nothing to install, there's no app, and there's nothing on this page we've made up.
>
> If something here is wrong, or a listing ever looks off to you, email me at `{founder.email}`. That reaches me, not a queue.
>
> — `{founder.firstName} {founder.lastName}`, Toronto

> **The only three fields on this site we cannot write.** They are facts the client holds, not copy: the founder's name, their neighbourhood, and a live monitored mailbox. All three must be real before ship. **Do not substitute a stock portrait, an invented name, or an unmonitored `hello@` address** — on a page whose entire claim is "we check things carefully," any of the three is the argument against us.

**Empty-state strip, 13px mono:**
`NO REVIEWS, NO RATINGS, NO CUSTOMER COUNTS AND NO PARTNER LOGOS ON THIS PAGE. WE HAVEN'T OPENED YET. WHEN WE DO, EVERY NUMBER HERE WILL BE ONE YOU CAN CHECK.`

### 5.11 The restaurant door (on `/`)

**Eyebrow:** `FOR RESTAURANT OWNERS`
**H2:** `You paid for the certification. Start getting credit for it.`
**Body:** `Halal Goes lists only kitchens whose certificate we've verified — so you're not ranked beside one that typed "halal" into a form. Launch partners pay 0% commission: every dollar of every order is yours.`
**Arithmetic line, 15px mono:** `ON A $40 ORDER, A 29% DELIVERY COMMISSION TAKES $11.60. OURS TAKES $0.00.`
**Source line, 12px:** `Rate published by DoorDash Canada, Premier plan.` [`their pricing page →`]
**Card rows:** `Your halal certificate` · `Your menu and hours` · `An afternoon`
**Button:** `See the partner terms →`

### 5.12 The ask — `/`

**H2:** `Order without asking.`
**Lede:** `Leave your number. We'll text you once, the day we open in your city — and after that, only when there's something worth telling you.`
*(Form repeats verbatim: same label, same placeholder, same helper, same button, same unchecked consent, same objection line.)*

### 5.13 Form states — diner

- **Success headline:** `You're on the list.`
- **Success body:** `We'll text 416 555 0134 the day we open in your area. One text. That's the deal.` *(echo the number the user actually typed, formatted)*
- **Then one optional field:** label `Which part of the GTA?` · placeholder `Scarborough` · button `Add it` · sub-line `Optional. It tells us where to open first.`
- **Then one action:** button `Copy the link` → copies `https://halalgoes.com`, flips to `Link copied` for 2s, then back. **No share counts, no referral position, no queue number.**
- **Already on the list:** `You're already on it — we've got this number.` *(rendered as success. Not an error. Never coloured as one.)*
- **Error, phone:** `That number doesn't look right. Canadian mobile numbers, ten digits.`
- **Error, consent:** `Tick the box and we'll text you once at launch.`
- **Error, network:** `That didn't send. Try once more.`
- All errors render `--color-warning-700` on `--color-warning-50`. **Nothing on this site is ever red.**

### 5.14 FAQ — `/`

1. **What does "verified halal" mean here, exactly?**
   A person on our team checked the restaurant's halal certificate against seven points and recorded what they found — the issuer, the certificate number, what it covers, the expiry date, and who signed off on what date. The badge on a listing is that record, and you can open it. We don't certify food ourselves and we don't make religious rulings.
2. **Is the whole restaurant certified, or just the meat?**
   We check what the certificate actually covers, and we show you. Some certificates cover a whole kitchen; some cover a supplier's meat only. A supplier's certificate never earns a restaurant a badge here — that's check number three. If the scope doesn't match the menu, the kitchen doesn't list.
3. **Whose standard do you use — is it zabiha?**
   Ours isn't a standard, it's a check. We verify the certificate is real, current, and issued by a recognised body, then we print which body issued it. Issuers differ, and Muslims differ on them. That judgement is yours, not ours — which is why the issuer's name is on every listing instead of hidden behind a label of our own.
4. **Do you certify food yourselves?**
   No. Never. We read certificates issued by others and record what they say.
5. **What happens if a certificate expires?**
   The restaurant comes off the app until it's renewed. We don't show a warning badge, because an expired certificate means our information has lapsed, not that anything is wrong with the food. We'd rather show you nothing than show you a maybe.
6. **Who actually checks it — a person or software?**
   A person. Software tracks expiry dates and flags renewals; a named admin reads the document and signs off, and we record their name and the date.
7. **What does it cost?**
   The menu price, a delivery fee shown before you pay, tax, and a tip. No fee appears after you've decided. **[PRODUCT SIGN-OFF]** *If confirmed, append:* Your tip goes to your rider in full.
8. **Where and when do you launch?**
   Ontario first, starting in the GTA. We're pre-launch — this page is a waitlist, not a download. There's nothing to install yet.
9. **What will you do with my number?**
   Text you when we open in your area. That's it. We don't sell it, we don't pass it to restaurants, and one reply gets you off the list.

### 5.R `/for-restaurants` — full copy

**Eyebrow:** `0% COMMISSION · LAUNCH PARTNERS · ONTARIO`

**H1:**
> **You paid for the certification. Start getting credit for it.**

**Lede:**
> Halal Goes lists only restaurants whose certificate we've verified — so you're not ranked beside a kitchen that typed "halal" into a form. Launch partners pay 0% commission: every dollar of every order is yours.

**Record card caption (specimen, restaurant page):** `SPECIMEN · THE RECORD WE BUILD FROM THE DOCUMENT ALREADY IN YOUR DRAWER`

**Form:**
- Label: `Work email`
- Placeholder: `chef@yourrestaurant.ca`
- Helper: `We'll send the partner terms — two pages, no call.`
- Button: **`Send me the partner details`**
- Consent, **unchecked**: `Email me about becoming a launch partner.`
- Consent sub-line: `Onboarding steps, launch dates and partner updates from Halal Goes, Toronto ON. One-click unsubscribe on every email.`
- Objection line: `No card, no contract, no exclusivity, no hardware.`

**The seven checks — H2:** `The standard you'll be held to.`
**Standfirst:** `Every kitchen on the list went through this, and so will yours. It's also why the badge on your storefront is worth something to a diner.` *(Same seven items, verbatim.)*

**The arithmetic — H2:** `On a $40 order`

| | |
|---|---|
| A major delivery app's published Canadian rate, top tier — 29% | **− $11.60** |
| Halal Goes, launch partner | **− $0.00** |
| What reaches you | **$40.00**, less card processing, itemised on every payout |

**Footnote:** `Competitor figure from DoorDash Canada's own published pricing page, Premier plan.` [`link`] *(Build note: re-check the live published rate in the week you ship, and update the figure or pull the block. A stale competitor number is exactly the error this brand can't afford.)*

**H2:** `And when the 0% ends?`
> We'll tell you the rate before it changes, in writing, at least 60 days ahead — and you can leave that day, because there's no contract and no exclusivity. We'd rather you knew now than found out in a payout. **[PRODUCT SIGN-OFF — confirm 60 days]**

**Onboarding — H2:** `A certificate, a menu, and an afternoon.`
1. **Send your certificate** — Upload it and tell us who issued it. That's the application.
2. **We run the seven checks** — Usually within two working days. If something's missing we'll tell you exactly what, rather than just declining.
3. **Go live at 0%** — Your storefront opens with the verified badge on it, and at launch you keep every dollar.

**Restaurant FAQ — `Before you ask`**
1. **What if my certificate is from an issuer you don't list?** Send it anyway. If the issuer is accredited and the certificate covers your kitchen, we'll assess it and tell you either way, with a reason. We'd rather add an issuer we can stand behind than turn away a kitchen that's done the work.
2. **What happens after launch pricing?** 60 days' written notice before the rate changes. No contract, no exclusivity, leave any time.
3. **Do I need new hardware?** No. A phone or any browser you already have. No terminal, no POS integration, no weekly device fee.
4. **How long until I'm live?** Usually two working days once we have your certificate and your menu. Photos are the slow part, and we'll help.
5. **Who pays if an order is refunded?** We're finalising this with our payments provider, and the full policy is in the partner terms before you sign anything. **[BLOCKED — decision O-04. Ship this answer as written; do not invent a split.]**

**Restaurant ask — H2:** `Every dollar of every order, at launch.`
**Lede:** `Leave your email and we'll send the two-page version: what we check, what it costs, and how to get listed before we open.`

**Restaurant success:** `Check your inbox.` / `The partner terms are on their way. If they haven't landed in ten minutes, look in spam — then email us at {founder.email}.`

### 5.x Meta + `/verification`

- `/` title: `Halal food delivery in the GTA — every kitchen's certificate checked | Halal Goes`
- `/` description: `Halal Goes reads the certificate before a kitchen is ever listed — the issuer, the number, the scope, the expiry, and the admin who signed off. Ontario, pre-launch. Join the waitlist.`
- `/for-restaurants` title: `List your halal restaurant in Ontario — 0% commission for launch partners | Halal Goes`
- `/for-restaurants` description: `Your halal certificate is already your best marketing. Halal Goes verifies it and puts it in front of diners who order by it. Launch partners pay 0% commission.`
- `/verification` title: `The Halal Goes verification standard, v1.0 | Halal Goes`
- **`/verification` must exist before the standard link ships.** Contents: the seven checks in full; the accepted issuers and *why those*; how to submit an issuer we don't list; what happens on expiry; **what we explicitly do not claim**; how to dispute a listing, with a real email; and the stamp `v1.0 — effective 17 September 2026`. Commit in writing to publishing applications received / verified / **rejected** from launch. It is the artifact a family WhatsApp group forwards.
- Footer tagline keeps **`Verified halal, delivered.`** It survives as the lockup. It just isn't the first thing a stranger reads.

---

## 6. DESIGN LANGUAGE

### Type — Plus Jakarta Sans for everything visible, JetBrains Mono for every piece of evidence

Set `.landing { font-family: var(--font-display) }` — the body default is `--font-ui` (Inter) and that belongs to the product apps, not here.

| Role | Spec |
|---|---|
| H1 | 800 · `clamp(40px, 6.6vw, 72px)` · lh 1.02 · `-0.035em` · max 12ch/line desktop |
| H2 | 800 · `clamp(30px, 4.2vw, 46px)` · lh 1.08 · `-0.025em` · max 16ch/line |
| Lede / standfirst | 400 · `clamp(18px, 2.1vw, 20px)` · lh 1.45 · max 56ch |
| Body | 400 · 17px · lh 1.65 · **max-width 62ch, always, no exceptions** |
| Card / item title | 700 · 17–22px · lh 1.25 |
| Caption | 400 · 14px · lh 1.5 · `--text-secondary` |
| Eyebrow / label | JetBrains Mono 500 · 12–13px · uppercase · `.08em` · `--text-tertiary` |
| **Record line** | JetBrains Mono 400–500 · 14px (12px <640) · `.04em` · `font-variant-numeric: tabular-nums` |

**Two weights on the spine: 800 and 400.** Nothing at 500 or 600 in headings or running body. 600 exists only on buttons, form labels and nav links; 500 only inside mono. **Middleweight everywhere is the single loudest "default template" tell.**

**The mono record line is the page's signature device.** Certificate fields, dates, step labels, neighbourhood lines, state descriptors, the empty-state strip, the specimen caption — all mono. It reads as machine-recorded and unedited, it's a type decision rather than an effect so it survives every viewport and works with JS off, and **a competitor with no records to print cannot copy it.** Mono never carries persuasion — only evidence and structure.

### Colour — a budget, not a palette

| Colour | Allowed | Forbidden |
|---|---|---|
| Cream `--color-neutral-50` | Page ground, ≥70% of scroll | — |
| White `--color-neutral-0` | **Only** on record-shaped things: the record card, the seven-check card, the four state cards, the sealed card, the onboarding card, the empty-state strip | As a section background; behind photography |
| Forest `--color-accent-600 / -800` | **Exactly three** full-bleed surfaces: the refusal, the restaurant band, the footer | Cards, buttons, hero, anywhere else |
| Orange `--color-brand-500` | **Exactly five instances on `/`:** hero submit, sticky-CTA button, restaurant-band button, footer submit, and the `Read the verification standard →` arrow | Eyebrows, underlines, icon fills, rules, borders, hover washes, section backgrounds |
| Emerald `--color-halal-certified-seal` | The seal fill; the seven tick marks; the certified state | Any semantic success, any button, any rule, any text |
| Brass `--color-halal-certified-ring` | The seal's ring. Nothing else, ever. | Dividers, gradients, decorative gold lines |
| Slate `--color-halal-expired-seal` | The expired state | — |
| Warning `--color-warning-50 / -700` | Form errors only | — |
| **Danger `--color-danger-*`** | **Nowhere on this site.** Add it to the landing lint denylist beside L-4. | Everywhere |

**The desaturation test — run before every merge.** Screenshot the full page, desaturate everything except emerald and orange. **Exactly two kinds of mark should survive: the seal (and its ticks), and the buttons.** If a third lights up, kill it. This is a pass/fail gate, not a vibe.

**Halal invariants, restated as build rules:** a missing halal field renders **no badge**, never an optimistic one (state 4 renders an empty square). **Never red for a halal state** — expired is cool slate, "we can't currently vouch." **Solid green is reserved to `color.halal.*`**; semantic success is tint-only.

### Imagery

**Budget: one hero table photograph, six craving tiles, three sealed frames (when shot), one founder portrait (when shot). Eleven images at most, one grade.**

- **One grade across every asset.** Warm balance (~5200K), available light, gentle S-curve, saturation −6 on greens, highlights held off clipping, fine grain. **No teal-and-orange. No HDR clarity.** Mixed-source photography is a louder templated tell than layout is — regrade the eight existing JPEGs as one set or reshoot.
- **Point the camera at people, hands and rooms**, not plated food. The subject is trust between people. Crops favour the messy edge of the frame: a forearm, a stacked plate, a taped-up prep list.
- **Food appears as a real portion on a real table** — charcoal, foil trays, rice, a lemon wedge. It should look like something someone ordered, not something someone built.
- **Never crop a face out of frame to be "editorial."** On a page about who signed off, faceless people undercut the thesis.
- **Banned:** overhead flat-lays on marble; hands reaching in from three sides; dripping-sauce macro; seamless backdrops; anyone who reads as a model; the smiling rider with a thermal bag at 45°; any tilted phone mockup; any stock portrait; any app-store badge for an app that does not exist.
- **Burned category clichés:** mosque silhouettes, domes, crescents, girih lattice backgrounds, faux-Kufi Latin type, calligraphy as decoration, gold-on-green "luxury" gradients, the red-and-green "100% HALAL" starburst. Halal is signalled here by rigour, not by ornament — the audience is Canadian, English-first and second-generation and does not need to be signalled at.

### Spacing, corners, depth, texture

- Section padding exactly as assigned in §4. **Uniform 96px everywhere is why the current page reads flat.** Alternating density *is* rhythm.
- Corners: cards and photos 16px (`--radius-marketing-md`); inputs and buttons **11px** (`--radius-marketing-sm`); `--radius-full` **only** on the halal status pill. **No pill buttons** — a 999px CTA is the delivery-app default and the fastest route back to generic.
- Borders: 1px `--border-decorative` hairlines do all the structural work. **Rules, not boxes.**
- Shadows: `--elev-0` by default; `--elev-1` on white cards; `--elev-sticky` on the sticky bar. **Nothing else gets a shadow.** No shadow on any forest band.
- Texture: **one** faint paper grain — inline-SVG `feTurbulence` (baseFrequency .8, 2 octaves) as a data-URI at 2.5–3.5% opacity on a `position: fixed; pointer-events: none; inset: 0` `::before` over the cream ground only. It makes cream read as *stock* rather than as `#FFFAEA`, and it is the cheapest available defence against "90s website." **No grain on forest — it bands.**
- **Forbidden outright:** glassmorphism, mesh gradients, gradient orbs, blurred blobs, gradient text, text on gradients, bento grids, three-icon feature rows, grey logo bars, dark-mode toggle.

---

## 7. MOTION SPEC

**Thesis: motion here makes things feel *deliberate*, never *alive*.** We are selling careful clerical work done by a person. Nothing swoops, bounces, springs or pops. Everything uses the existing `--ease-standard: cubic-bezier(.2,0,0,1)`. **If a visitor could describe a transition afterwards, it was too much.**

**The safety pattern, mandatory:** content is visible by default in CSS. A tiny inline script in `<head>` adds `.js` to `<html>` before paint, and the initial hidden state is *only ever* written as `html.js [data-reveal] { … }`. **No `opacity: 0` may exist in any rule not gated on `.js`.** A reveal that fails must leave the page readable, not blank. This is the highest-severity bug class on the site, and `Faq.astro`, `SocialProof.astro` and every other `data-reveal` consumer must be audited against it.

| # | Move | What it does for the user | Implementation |
|---|---|---|---|
| **M1** | **Settle** — `translateY(12px) → 0`, `opacity .001 → 1`, 320ms, 60ms stagger within a group | Signals "this section is one thought," and slows the read just enough that the page feels composed | One shared `IntersectionObserver` (`threshold:.15`, `rootMargin:"0px 0px -8%"`), adds `.in`, then `unobserve`. **12px, never 28px** — 28 reads as a slide-in |
| **M2** | **Record print** — the specimen caption line reveals left-to-right, `clip-path: inset(0 100% 0 0) → inset(0)`, 600ms, once | The one move with personality, spent on the one element that *is* the brand: a line being printed onto a form | Pure CSS transition triggered by the same `.in`. Reduced-motion → `inset(0)` immediately. **Never on the seal** |
| **M3** | **Tick stagger** — the seven emerald ticks fade + rise 4px, 80ms apart | Makes the checklist read as something being *completed* — the labour illusion, static | `transition-delay: calc(var(--i) * 80ms)`, `--i` set inline per row. No SVG path drawing, no library |
| **M4** | **Tile lift** — `scale(1.015)` on the inner `<img>` inside an `overflow:hidden` tile, 180ms, hover/focus only | Confirms a craving tile is an object, not a background | Caption does not move. Pointer/focus only; no touch equivalent |
| **M5** | **Sticky CTA reveal** — 64px bar, `translateY(100%) → 0`, 240ms, once | Returns the ask to the thumb after the fold without a second sticky element at the top | 1px sentinel `<div>` at the end of the hero + the same observer. Hidden whenever a form is in view |
| **M6** | **Field focus + FAQ chevron** — 120ms border/ring; 180ms chevron rotate on `[open]` | Ordinary, expected; absence reads as broken | `summary::after` transform |

**Explicitly forbidden:** any motion on the seal — ever (stamp, pulse, shimmer, ring-draw); Ken Burns / hero zoom; parallax; scroll-scrubbed or pinned sequences; marquees and infinite tickers; count-up numbers; word-by-word or letter-by-letter reveals; blur-in text; custom cursors; magnetic buttons; `animation-timeline: view()` as a visibility mechanism; and any dependency on GSAP, Lenis, Framer or Locomotive.

**Total JS on `/`:** one `<head>` class-setter, one ~25-line observer module, one form island, one clipboard handler. Nothing else.

> **The single best motion decision available is to use less than the visitor expects.** A page about careful, slow, human checking that scrolls calmly and refuses to perform *is itself the argument*.

---

## 8. BUILD NOTES

### File-level manifest (against the real tree at `apps/landing/src/`)

**New components:** `RecordCard.astro` · `RecordLine.astro` (the mono primitive) · `Recognition.astro` · `CravingGrid.astro` · `WhyShort.astro` · `Checklist.astro` · `IssuerRow.astro` · `Refusal.astro` · `StateGrid.astro` · `Sealed.astro` · `Founder.astro` · `RestaurantBand.astro` · `StickyCta.astro`

**Rewrite:** `Hero.astro` (single audience, one `<h1>`, right-bleed photo, overlapping specimen card, 12px reveal) · `Nav.astro` (**delete the segmented toggle, the `data-audience` root attribute, the `localStorage` persistence and the `hg:audience` event**; cream, sticky, two text links) · `WaitlistForm.astro` (**unchecked consent**, persistent label, `autocorrect="off"`, digit-only placeholder, consent string in the payload) · `forms.ts` (rich success state, city capture, copy-link, duplicate-submit = success, consent artifact on the `own` path) · `Faq.astro` (**drop `name="faq"`**) · `FooterCta.astro` (cream, left-aligned, verbatim hero H1) · `Base.astro` (set `--font-display` on the landing root, add the `.js` head script, per-page meta + JSON-LD)

**Delete:** `HowItWorks.astro`, `Benefits.astro` (their content redistributes into Sealed, the checks, and `/for-restaurants`), `SocialProof.astro` (→ the honest empty-state strip), `Verification.astro` (→ `Checklist` + `IssuerRow` + `Refusal`)

**Keep as-is:** `Button.astro`, `Badge.astro`, `HalalBadge.astro`, `HalalShield.astro`, `Icon.astro`, `pages/api/waitlist.ts`

> **Correction to the research dossier:** there is no `Marquee.astro` and no `VerifyScroll.astro` in this tree, and `Hero.astro` contains no `hero-stamp` or `hero-zoom`. Those flags are pre-emptive, not present. The real defects in the tree are: the dual `<h1>` in `Hero.astro`, the segmented audience toggle in `Nav.astro`, `checked` consent and `(416) 555-0134` in `WaitlistForm.astro`, `name="faq"` in `Faq.astro`, HFSAA in `Verification.astro`, and the `href`-less standard button.

**New pages:** `src/pages/for-restaurants.astro` · `src/pages/verification.astro` · a 301 from `/?for=restaurant` and `/?a=own` (Astro redirect or edge rule — it must be a 301, not a client-side hop, so QR codes and existing links keep their equity).

**Tokens:** add `--space-section-tight: 72px` and `--space-section-hinge: 176px`. Add `--color-danger-*` to the landing lint denylist beside the existing L-4 solid-green rule.

### Static vs island

**Static (zero JS):** every section, every image, the FAQ (native `<details>`), the nav, the footer, the record card, the state grid, the checklist. If JS never loads, the entire page reads and the form still POSTs natively to `/api/waitlist`, which re-validates.

**Islands (four, all vanilla):**
1. `head` class-setter (~4 lines, inline, render-blocking on purpose).
2. `motion.ts` — one shared `IntersectionObserver` (~25 lines) driving M1/M2/M3/M5.
3. `forms.ts` — validation, consent artifact, POST, success state, city capture, clipboard.
4. `StickyCta` visibility (shares the observer from 2).

### Mobile-first specifics

- Design and review §4.6 and §4.8 at **375px first**. A single-column ruled checklist is better than a grid even on desktop.
- **Thumb zone:** the hero submit must land in the lower third of a 390×844 viewport. Verify **with the tel keypad open** — you have ~300px of usable viewport, and the button *and* the consent checkbox must both survive it.
- **No false floor:** the hero photo is clipped by the fold; the record card is never completed above it.
- Sticky bar: `padding-bottom: max(12px, env(safe-area-inset-bottom))`. It never sits on the home indicator.
- Nav is two text links. No hamburger, no drawer, no overlay menu.

### Performance guardrails

- The LCP element is the **H1 text** on desktop; on mobile it may be the hero photo — ship it `loading="eager" fetchpriority="high"`, AVIF + WebP via `<picture>`, `srcset` at 640/960/1280, explicit `width`/`height` on every image on the page. Everything else `loading="lazy"` with `decoding="async"`.
- **One hero per page** — splitting `/` and `/for-restaurants` removes the current tax of two heroes and two forms rendering into one DOM on every mobile visit.
- Budget: **≤120KB JS+CSS** on `/` (it should land far under), no web font beyond the three already imported, and **subset the fonts** — Plus Jakarta 400/800 and JetBrains Mono 400/500 are the only faces the page uses; 500/600/700 of Jakarta load today for four elements. Self-host or `preconnect` to `fonts.gstatic.com` and `display=swap` (already set).
- Deloitte/Google: 0.1s of mobile speed is worth ~8.4% of retail conversion. On static Astro we should win this outright.

### Accessibility guardrails

- **One `<h1>` per page.** Heading order never skips.
- Persistent visible `<label>` on every field — `aria-label` alone fails the sighted user returning to a half-filled form.
- Errors: `role="status"` + `aria-live="polite"` (already present), announced text that names the fix, not the fault, and `aria-describedby` linking field → message.
- Focus ring: the token `:focus-visible` (3px `--focus-ring`, 2px offset) stays visible on every interactive element including the sticky bar and the copy-link button. Never `outline: none`.
- Contrast: every text/background pair ≥ 4.5:1 — check white-on-orange (`#F1521E`) at button size and mono tertiary on cream. Caption-over-photo must pass against the darkest and lightest points of its own crop, not against an average.
- Touch targets ≥ `--target-min` (44px). The consent checkbox gets a 44px hit area even at a 20px visual box.
- `prefers-reduced-motion` is globally reduced in `tokens.css`; every move in §7 must remain fully legible at 0.001ms — verified by toggling it, not by assuming.
- The craving-grid tiles are `<figure>` + `<figcaption>`; decorative photos get `alt=""`, meaningful ones get real alt text describing the dish, not "food image".

### Compliance and sign-off gates (nothing ships until these clear)

1. **Consent box unchecked**, both audiences. Consent sentence, timestamp, context and source logged on both the `eat` and `own` paths.
2. **HFSAA replaced with IFANCC** (or explicitly labelled `UNITED STATES`).
3. **`/verification` live** before the standard link ships.
4. **Founder name, neighbourhood and a monitored mailbox** supplied by the client and real.
5. **Product sign-off** on the tip claim and the 60-day notice. **O-04 blocks** the refund answer — ship the written holding answer, invent nothing.
6. **Competitor rate re-verified** in ship week, or the arithmetic block is pulled.
7. **A full proofing pass, budgeted as a conversion task.** For a brand whose claim is "we check things carefully," a typo, a dead link or a 404 is an argument against the product in a way it isn't for anyone else.

---

## 9. ANTI-GENERIC CHECKLIST

Run this against the built page. Every line is objectively checkable; any failure is a blocker, not a nit.

**The six AI tells — all must be absent**
- [ ] No gradient mesh, blurred blob, or orb. **No gradients at all** except the ≤35%-tall caption scrim on craving tiles.
- [ ] **Nothing is centred.** One optical left edge down the entire page, including the closing CTA.
- [ ] **No three-icon feature row.** The seven checks are a ruled single-column form at every width.
- [ ] **No logo bar.** Issuers are set in mono type, linked, with the non-affiliation line printed.
- [ ] No glassmorphic card, no 1px white top-highlight, no card floating on a gradient.
- [ ] No copy in the shape "The [adjective] way to [verb] your [noun]." No *seamless, unlock, elevate, curated, journey, effortless, revolutionise, game-changer*.

**The craft budgets — countable**
- [ ] **Orange appears exactly five times on `/`.** Count them.
- [ ] **Forest appears exactly three times.** Refusal, restaurant band, footer.
- [ ] **The desaturation test passes:** desaturate everything but emerald and orange — exactly two kinds of mark survive.
- [ ] **Two weights on the spine** (800/400). Nothing at 500/600 in a heading or running body.
- [ ] **Every paragraph is ≤62ch.** Measure the widest one.
- [ ] **Three section heights in use** (72 / 96 / 176), not one.
- [ ] **Exactly one grid break** — the large record card in §4.8.
- [ ] **No pill buttons.** Every button is 11px radius.
- [ ] **One shadow level on cards** (`--elev-1`), none on dark bands.
- [ ] **One photographic grade** across all assets — put them side by side and check.

**The brand invariants**
- [ ] **No red anywhere**, including error states. `--color-danger-*` is on the denylist.
- [ ] **Solid green appears only as the seal and the seven ticks.**
- [ ] **Brass appears only as the seal's ring.** No gold rules, dividers or gradients.
- [ ] **State 4 renders no badge** — an empty hairline square, not a greyed shield.
- [ ] **The seal never appears without its record beneath it**, and **the seal never moves** in any state, on any interaction, at any breakpoint.

**The honesty audit — the one that actually protects the brand**
- [ ] **No invented restaurant name, certificate number, admin name, review, rating, count, or logo** anywhere in the DOM, including alt text, JSON-LD and commented-out markup.
- [ ] The hero card says `SPECIMEN` and its only filled value is a real organisation's name.
- [ ] The page prints, in its own voice, at least four things it *cannot* do or does *not* have: `We don't certify food. We don't make rulings.` · `We can't currently vouch for this kitchen.` · `None yet. We haven't opened.` · `Nothing to install — we're pre-launch.`
- [ ] Every external claim is attributed and linked (CBC; the competitor rate; the three issuers).
- [ ] The founder email is live and reaches a person.

**The robustness gates**
- [ ] **Disable JavaScript. The entire page reads**, the FAQ opens, and the form still submits. No `opacity:0` outside an `html.js` rule.
- [ ] **Enable `prefers-reduced-motion`. Nothing is hidden**, nothing is mid-transition, everything is legible.
- [ ] **390px wide, tel keypad open:** the submit button and the consent checkbox are both reachable without a scroll gymnastics.
- [ ] **One `<h1>` per page.** Check the DOM, not the design.

**The final read**
- [ ] **Cover the logo. Can you still tell this is Halal Goes?** With the brass-ringed seal, the mono record line, and the white-document-on-cream grammar — yes. With a dark hero, a big sans headline and an orange button — no. That is the whole test.

---

**One sentence to hold the build to:** *the page should be defensible as journalism about our own process, wrapped around a dinner you actually want.* Everything above serves that; anything proposed later that doesn't, doesn't ship.