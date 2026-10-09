# Claude Design brief — HalalGoes landing page

> **Historical brief, corrected.** This was the first-round brief for halalgoes.com. It is kept for
> context, and the parts that had gone stale have been corrected in place. Where anything here
> still disagrees with the brand book (`README.md`), the claims register
> (`apps/marketing/src/lib/claims.ts`) or the creative direction
> (`docs/design/landing-creative-direction.md`), those win.

_Confirmed inputs: three audience tracks (order food, list your restaurant, deliver with us) ·
Next.js site · warm-appetising-human mood · cleaned old-brand green palette · “Verified halal,
delivered.” · restaurant hook “0% commission at launch”._

---

## TOKENS (marketing subset — the full set is `docs/design/tokens.json`)

```json
{
  "color": {
    "brand":   { "forest": "#1B3B31", "forestDeep": "#0F241C" },
    "surface": { "canvas": "#FFFAEA", "card": "#FFFFFF" },
    "action":  { "default": "#F1521E", "pressed": "#D8410F", "label": "#0F241C" },
    "ink":     { "default": "#232323", "muted": "#6E7C77" },
    "tint":    { "sage": "#E9F3E4" },
    "border":  "#E6E0D4",
    "halal":   { "seal": "#0F7A43", "ring": "#C9A24B", "expired": "#4E5862" },
    "danger":  "#C42B1C"
  },
  "font": {
    "display": "Bricolage Grotesque, Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif",
    "body":    "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif",
    "mono":    "IBM Plex Mono, ui-monospace, monospace"
  },
  "radius": "the shared scale: 4 / 8 / 12 / 16 / 20 / 24 / pill; document cards 16px",
  "space":  { "section": "96px", "block": "24px" }
}
```

## PROMPT

> Design a **three-audience marketing landing page** for **HalalGoes**, a Canadian (Ontario-first)
> halal food-delivery marketplace. It is **pre-launch** — every call to action is a **waitlist**,
> not an app download. Use the tokens above. Mood: **warm, appetising, human** — real food
> photography, cream grounds, forest-green chrome, an orange CTA with a dark forest label,
> Bricolage Grotesque headlines over Plus Jakarta Sans text. Trustworthy and hungry, not loud.
>
> **The single differentiator is halal *verification*** — every restaurant is checked by an admin
> against seven checks. This claim must carry the page. Show it as a record — the seal plus its
> mono record line — never as a buried footnote and never as a seal on its own.
>
> **Hard brand rules (non-negotiable):**
> - Forest green `#1B3B31` is **dark chrome/neutral only** — never a “success” signal.
> - The **only bright/solid green** is the **halal-verified seal `#0F7A43`** (with brass ring) —
>   used exclusively on the verification badge/panel and the seven check ticks.
> - **Action/CTA is orange `#F1521E`** with a `#0F241C` label. Never green.
> - **Never red for anything halal-related** (red reads as *haram*). “Expired / not verified” = slate.
> - Never imply a religious ruling; copy says “verified” / “certified by [body]”, never “guaranteed halal.”
> - **The seal never moves** and is never placed over a photograph. **No gradients, no scrims.**
> - **No numbers that are not in the claims register** — no restaurant, rider, order or waitlist
>   counts, no testimonials, not even as placeholders.
>
> **Structure (long-scroll):**
> 1. **Sticky nav** — the HalalGoes wordmark · a segmented **audience toggle `[ Order food ] [ List
>    your restaurant ] [ Deliver with us ]`** (separate pages: `/`, `/restaurants`, `/riders`) · one
>    context-aware CTA.
> 2. **Hero, Order food (default)** — headline **“Verified halal, delivered.”** · lede “Seven checks
>    on every restaurant, before it reaches you.” · an **email** waitlist field + “Notify me” ·
>    reassurance “No spam. One email, the day we open in your area.” · an unticked consent
>    checkbox beside the field.
> 3. **Hero, List your restaurant** — headline **“0% commission at launch.”** · lede “Keep the whole
>    ticket. We make our money later, and we’ll tell you before we do.” · **email** field + “Get
>    early access.”
> 4. **Hero, Deliver with us** — headline **“The delivery fee is yours. All of it.”** · lede “$2.99
>    plus $1.00 per kilometre, paid to you. Every Monday, automatically, with no minimum.” ·
>    **email** field + “Start delivering.”
> 5. **The verification proof** (shared, the centrepiece) — the seven checks explained simply, the
>    seal with its record line, the three accepted certifying bodies (HMA Canada, HFSAA, ISNA
>    Canada) with their logos — the client has permission; the files come from GitHub issue #116,
>    and until they arrive the names are set in type — and a “how we verify” explainer. Authority
>    over volume.
> 6. **How it works** — 3 steps, per audience (toggle-aware).
> 7. **Why HalalGoes** — benefit band per audience, using only claims in the register.
> 8. **An honest empty state** where social proof would go — no reviews or counts until they exist.
> 9. **FAQ** — objection handling: what “verified halal” means, coverage (Ontario first), fees, timing.
> 10. **Final CTA + footer** — repeat the audience-appropriate waitlist, socials, legal.
>
> **Conversion craft:** one primary CTA per view, the verb repeated; above-the-fold clarity; ethical
> urgency only (a launch waitlist, no fake scarcity); fees and “0%” stated plainly; phone-first
> (design the 390px width first, then desktop). Light (cream) is primary.
>
> Produce artboards for: nav, the three heroes, the verification panel, how-it-works, the benefit
> band, FAQ, and the footer CTA — at phone (390px) and desktop (1280px).

---

## After the design is approved (build sequence, as it was actually built)

1. **Next.js 16 + Tailwind v4 + Keystatic** (`apps/marketing`), consuming these tokens.
2. **Waitlist**: every track collects an **email** (there is no approved SMS sender yet), with an
   unticked consent checkbox and a consent timestamp.
3. **Tracking/SEO** (per `docs/planning/growth-stack.md`): Klaro consent gate before any tracking,
   sitemap, schema.org (Organization / FoodEstablishment / FAQPage), a static `/llms.txt`.
4. **Deploy** and point `halalgoes.com`; verify Lighthouse/LCP, that tracking fires only after
   consent, and that forms land.
