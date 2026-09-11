# Halal Goes — marketing landing page plan

_Product + tech lead plan. Goal: a creative, on-brand, conversion-optimized dual-sided
landing page, lightweight, deployable to Vercel. Design/layout executed in Claude Design;
built in Astro. Sep 2026._

## Locked decisions (client-confirmed)

| Area | Decision |
|---|---|
| **Primary conversion** | **Dual** — a toggle: `[ Order food ]` (customer → app install / waitlist) and `[ List your restaurant ]` (restaurant → signup lead). Lead with customer; toggle reveals the restaurant story. Shared brand, two heroes, two CTAs. |
| **Framework** | **Astro** — zero-JS static by default (fastest LCP → best SEO + conversion), islands only for the toggle / forms. |
| **Hosting** | **Vercel** (free tier, edge). |
| **CMS** | **Git-based headless with a UI** — non-tech editor, lightweight, no DB. Recommend **Decap CMS** (pure git + an `/admin` route, OAuth via the git provider, zero backend service — the lightest) or **TinaCMS** (nicer visual editing, needs a small self-hosted Tina backend). Default: **Decap** unless the visual-editing UX of Tina is wanted. Content lives in Astro **content collections** (MDX), CMS edits commit back to the repo. |
| **Brand** | **Fresh marketing identity** — bolder and richer than the app UI, related but not identical. Executed via **Claude Design**. |

## Information architecture (dual page)

1. **Sticky nav** — logo · audience toggle (Order / Partner) · single primary CTA (context-aware).
2. **Hero** (per audience) — headline + subhead + CTA + a trust line. Customer: "verified halal, delivered." Restaurant: "reach halal diners who trust the badge."
3. **The halal-verification proof** — the differentiator, above the fold-ish: the seven-check story, the seal, certifying bodies. This is the one thing no competitor has; it carries the page.
4. **How it works** — 3 steps, per audience.
5. **Social proof** — certified-restaurant count, reviews/ratings, press/【launch-city】 (as available; honest placeholders until real).
6. **Feature/benefit band** — customer: selection, speed, live tracking, sealed-to-door integrity; restaurant: reach, easy onboarding, the badge as an asset, fair commission.
7. **Restaurant CTA block** (for customer-primary visitors who are operators) / cross-sell.
8. **FAQ** — objection handling (what "verified halal" means, coverage area, fees).
9. **Final CTA + footer** — waitlist/app CTA, legal, socials.

## Copywriting strategy (to finalize after the research lands)

- Lead the trust product with a **verification-first** message; frameworks to apply (from the
  growth-research sweep): PAS / StoryBrand for the hero, social-proof + authority patterns for
  the seal, ethical urgency (launch-city waitlist) not fake scarcity.
- Halal invariants extend to copy: never imply a religious ruling; "verified"/"certified by X",
  never "guaranteed halal" beyond what the certificate says; expired = "we can't currently vouch."

## Tracking / attribution / SEO (builds ON the chosen growth stack)

- **Analytics**: privacy-friendly, lightweight — **Plausible or Umami** (self-hostable) for the
  page, and/or the **RudderStack** web SDK feeding the CDP (already chosen, `growth-stack.md`).
- **Attribution**: **Branch** links on the app-install CTAs (deferred deep links + UTM capture);
  UTM → RudderStack → warehouse for channel ROAS.
- **Consent**: **Klaro** banner before any non-essential tracking fires (PIPEDA).
- **SEO/GEO**: Astro static output + `schema.org` (Organization, LocalBusiness/FoodEstablishment,
  FAQPage), OpenGraph/Twitter cards, sitemap, fast LCP. GEO: clear factual "what is Halal Goes"
  blocks for AI answer engines. (Detailed toolset from the research doc.)

## Build sequence (dependency order)

1. **Positioning + copy** — finalize messaging (needs a short input round from the client +
   the research exemplars). → produces the copy deck.
2. **Fresh brand direction** — palette/type/art direction for marketing (a few inputs). →
   produces marketing **design tokens**.
3. **Design/layout in Claude Design** — I hand the client a **Claude Design prompt + tokens**
   (this is the gated handoff the client asked for) → artboards for the dual page.
4. **Astro build** — scaffold, content collections, Decap `/admin`, the islands (toggle, forms),
   Branch/analytics/consent wiring, schema.org, OG.
5. **Deploy to Vercel** + domain + verify Lighthouse/LCP + tracking fires + forms land.

## Pending inputs (next question round — after the research lands, so options are grounded)

- Positioning: the one-line promise for each side; launch city/area to name; app-store vs
  waitlist for the customer CTA (are the apps store-ready, or waitlist first?).
- Restaurant offer: commission/onboarding hook to advertise (S-01 says 0% at launch — lead with that?).
- Brand direction inputs for the fresh identity (mood, references) → then the Claude Design prompt.
- Domain: is `halalgoes.com` yours to point at Vercel?
