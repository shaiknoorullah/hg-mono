# Claude Design brief — Halal Goes landing page

_Paste the PROMPT below into Claude Design, with the TOKENS block. This produces the design +
layout artboards for the dual landing page; the Astro build follows from the approved design.
Confirmed inputs: dual page · Astro/Vercel · warm-appetizing-human mood · cleaned old-brand
green palette · "Verified halal, delivered." · restaurant hook "0% commission at launch"._

---

## TOKENS (paste into Claude Design tokens)

```json
{
  "color": {
    "brand":   { "forest": "#1B3B31", "forestDeep": "#0F241C" },
    "surface": { "canvas": "#FFFAEA", "card": "#FFFFFF" },
    "action":  { "default": "#F1521E", "pressed": "#D8410F" },
    "ink":     { "default": "#232323", "muted": "#6E7C77" },
    "tint":    { "sage": "#E9F3E4" },
    "border":  "#E6E0D4",
    "halal":   { "seal": "#0F7A43", "ring": "#C9A24B", "expired": "#4E5862" },
    "danger":  "#C42B1C"
  },
  "font": {
    "display": "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif",
    "body":    "Plus Jakarta Sans, ui-sans-serif, system-ui, sans-serif"
  },
  "radius": { "sm": "11px", "md": "16px", "pill": "999px" },
  "space":  { "section": "96px", "block": "24px" }
}
```

## PROMPT (paste into Claude Design)

> Design a **dual-audience marketing landing page** for **Halal Goes**, a Canadian (Ontario-launch)
> halal food-delivery marketplace. It is **pre-launch** — both CTAs are **waitlist**, not app
> downloads. Use the tokens above. Mood: **warm, appetizing, human** — real food photography, cream
> grounds, forest-green chrome, an orange CTA, friendly rounded Plus Jakarta Sans. Trustworthy and
> hungry, not loud.
>
> **The single differentiator is halal *verification*** — every restaurant is admin-verified
> against a seven-point certification check. This claim must carry the page. Model the verification
> proof on a certification *panel/badge* (à la a verified-host badge), never a buried footnote.
>
> **Hard brand rules (non-negotiable):**
> - Forest green `#1B3B31` is **dark chrome/neutral only** — never a "success" signal.
> - The **only bright/solid green** is the **halal-verified seal `#0F7A43`** (with brass ring) —
>   used exclusively on the verification badge/panel. Do not use it anywhere else.
> - **Action/CTA is orange `#F1521E`.** Never green.
> - **Never red for anything halal-related** (red reads as *haram*). "Expired/unverified" = slate.
> - Never imply a religious ruling; copy says "verified" / "certified by [body]", never "guaranteed halal."
>
> **Structure (long-scroll, single page):**
> 1. **Sticky nav** — logo · a segmented **audience toggle `[ Order food ] [ List your restaurant ]`** · one context-aware CTA.
> 2. **Hero (Order food, default)** — headline **"Verified halal, delivered."** · subhead "Every
>    restaurant checked seven ways before it reaches you." · a **waitlist field that takes a phone
>    number** + "Notify me" · a slim trust line (certified-restaurant count placeholder). Food
>    photography or the seal as a hero element.
> 3. **Hero (List your restaurant, on toggle)** — headline **"0% commission at launch."** · subhead
>    "Keep every dollar — and reach halal diners who trust the badge." · **email** waitlist field +
>    "Get early access."
> 4. **The verification proof** (shared, the centerpiece) — the seven-point check explained simply,
>    the seal, certifying-body logos, a "how we verify" mini-explainer. Authority over volume.
> 5. **How it works** — 3 steps, per audience (toggle-aware).
> 6. **Why Halal Goes** — benefit band: customers (verified selection, live tracking, sealed-to-door
>    integrity); restaurants (0% at launch, easy onboarding, the badge as a trust asset).
> 7. **Social proof** — reviews / launch-city interest (honest placeholders until real).
> 8. **FAQ** — objection handling: what "verified halal" means, coverage (Ontario first), fees, timing.
> 9. **Final CTA + footer** — repeat the audience-appropriate waitlist, socials, legal.
>
> **Conversion craft:** one primary CTA per view, the verb repeated; above-the-fold clarity; ethical
> urgency only (launch-city waitlist, no fake scarcity); fee/'0%' stated plainly; mobile-first (design
> the 390px width first, then desktop). Deliver light/dark if natural, but light (cream) is primary.
>
> Produce artboards for: nav, both heroes (toggle states), the verification panel, how-it-works, the
> benefit band, FAQ, and the footer CTA — at mobile (390px) and desktop (1280px).

---

## After the design is approved (build sequence — I handle)

1. Scaffold **Astro** (+ Tailwind consuming these tokens) → the approved artboards as sections;
   islands only for the audience toggle + the two waitlist forms.
2. **Waitlist**: customer form → phone (E.164, CASL opt-in checkbox + consent timestamp);
   restaurant form → email. Rows → a form endpoint → the CDP / a table.
3. **Tracking/SEO** (build ON `docs/planning/growth-stack.md`): RudderStack JS SDK (UTM capture),
   Branch links on CTAs, Klaro consent gate, `@astrojs/sitemap` + schema.org (Organization/
   FoodEstablishment/FAQPage) + a static `/llms.txt`.
4. **Deploy** to Vercel; point `halalgoes.com`; verify Lighthouse/LCP + tracking fires + forms land.
