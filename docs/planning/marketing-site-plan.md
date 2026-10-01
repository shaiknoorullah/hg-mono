# Marketing site — build plan

_Sep 2026. Client-confirmed inputs are marked **[confirmed]**._

> **2026-10-01:** this plan hosts the site and Umami on Vercel, with Postgres on Neon. Both are
> SaaS, which [the self-hosted, open-source rule](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)
> now rules out. Replacing them is tracked in [#199](https://github.com/shaiknoorullah/hg-mono/issues/199).

> **`landing-page-plan.md` and `claude-design-brief.md` were deleted (Sep 2026).** Both specified
> the Astro build; the site is Next.js and is built, so they described a stack that does not exist.
> Where their content went:
>
> | Their content | Now |
> |---|---|
> | Astro · Decap CMS · Vercel | Next.js · Keystatic · Vercel — §1 below, and `apps/marketing/` |
> | Dual audience toggle | **Three** audiences (riders added), as real pages: `AudienceSwitch.tsx` |
> | The nine-section IA | Built, in the copy deck's order: hero → why → verification sheet → steps → FAQ → final CTA |
> | Copy strategy | `docs/marketing/copy-deck.md` (Gate B) |
> | Conversion mechanics — phone, CASL opt-in, consent timestamp, E.164 | Built: `WaitlistForm.tsx`, `lib/contact.ts`, `actions/waitlist.ts` |
> | Analytics · consent · SEO | Built: Umami behind Klaro, `sitemap.ts`, `robots.ts`, JSON-LD, generated OG |
> | Claude Design brief → artboards | Done: F0 desktop, E1-m phone, V verification — all approved and ported |
> | "Social proof: certified-restaurant count" | **Now forbidden.** Counts are on the copy deck's not-publishable list until they can be read live from the database |
>
> **Two things did not carry over and are open:**
> - **Dedupe by phone.** `saveSignup` does not deduplicate; the same number can join twice.
> - **Referral "move up the list"** was a v1.1 idea and remains unbuilt.

The deliverable is **halalgoes.com**: a three-audience marketing site — customers, restaurants,
**riders** — that is marketing-ready (forms capture, leads land), ads-ready (pixels, UTM, conversion
events), content-ready (blog + CMS + SEO), and does not read as machine-generated.

---

## 1. Decisions changed from the original Astro plan

| Area | Was | Now | Why |
|---|---|---|---|
| Framework | Astro | **Next.js (App Router)** **[confirmed]** | Component/library ecosystem support. See §2 for the upside this unlocks. |
| Audiences | Dual (customer, restaurant) | **Triple — + rider** **[confirmed]** | Riders are a supply side with their own acquisition problem. |
| CMS | Decap (default) | **Keystatic** (recommendation, §2) | Git-based, no database, mounts as a route *inside* the Next app. |
| Analytics | Plausible/Umami *or* RudderStack | **Umami, self-hosted** **[confirmed: free, OSS, deployed with the site]** | OSS, cookieless, deploys to Vercel. The v2 RudderStack plane stays v2. |
| Hero | Food photography | **Type-led, Kiff-style** **[confirmed]** | Puts the differentiator in the hero; no photo budget; stock food photography is an AI-slop tell. |
| Palette | — | **Locked, untouchable** **[confirmed]** | `docs/decisions/palette-and-invariant-10.md`. |
| Everything else in the design system | Plus Jakarta Sans, 11/16/999 radii | **Open** **[confirmed]** | Type, scale, radii, motion all re-specifiable. |

The Astro→Next.js reversal needs a `docs/decisions/` entry before the build starts, per the
repo rule that settled decisions are not silently reversed.

---

## 2. Stack

```
Next.js (App Router, RSC)  →  Vercel
  ├── @hg/design-tokens     ← tokens.json → theme.css (Tailwind v4)  [exists]
  ├── @hg/ui-web            ← React components                        [exists, 54 files]
  ├── Keystatic             ← git-based CMS at /keystatic, content as MDX in-repo
  ├── Umami                 ← self-hosted analytics (Vercel + Postgres)
  ├── Klaro                 ← consent gate (already the locked CMP in growth-stack.md)
  └── Postgres (Neon free)  ← waitlist leads + Umami. One instance, two schemas.
```

**The upside of the Next.js pivot.** `@hg/ui-web` is React. Under Astro the halal components would
have had to be ported and kept in sync — two versions of the seal, which is the one thing that must
never drift. Under Next.js, `HalalShield`, `HalalBadge`, `HalalCertificationPanel` and
`HalalChecklist` are imported directly. The site's seal *is* the product's seal, by construction.

**The cost, and the mitigation.** Next.js is not zero-JS by default. Mitigation: the site is React
Server Components throughout; client components are limited to the audience toggle, the waitlist
forms, the countdown, the consent banner, the marquee and the sticky bar. That is Astro's islands
model by another name, and `page-speed-impact-review` gates it with real numbers.

**Why Keystatic over Decap/Tina/Payload.** Git-based (edits are commits — no database, no backup
story, content reviewable in PRs), mounts inside the Next app so there is nothing extra to deploy,
and its schema is TypeScript so content shapes are typechecked by `pnpm check`. Payload 3.0 also runs
inside Next but needs Postgres for content; Decap needs an OAuth broker. Keystatic needs neither.

---

## 3. Design system — the anti-slop problem, stated honestly

Anthropic's own design guidance names the current AI-design cliché explicitly: *warm cream ground,
serif display, terracotta accent*. HalalGoes' locked palette is a warm cream ground (`#FFFAEA`) with
an orange accent (`#F1521E`). The palette is not the problem — it is recovered from the old deployed
brand and documented in a decisions entry, so it is heritage, not a default. **But it means the
palette cannot do any differentiating work, and every other axis has to.**

Concretely, the following are ruled out for this build:

- A serif display face (that is the exact cliché pairing — the one move we must not make).
- Inter, Space Grotesk, or any "safe default" face.
- Centred everything; uniform `rounded-lg` on every card; accent bars on rounded cards.
- Emoji as section markers. Gradient hero. Stock food photography.

Differentiation comes from: an unexpected display face, an extreme and deliberate type scale, an
asymmetric editorial grid, a bespoke interactive verification instrument, and a motion budget
borrowed from Wispr Flow (§5). Direction is chosen with the client at **Gate A** before any code.

### Token work
All of it lands in `packages/design-tokens/tokens/tokens.json`, which already carries `typography`,
`radius` and `motion` groups, and regenerates `tokens.css` + Tailwind v4 `theme.css` + `tokens.ts`.
`pnpm check` already fails on token drift and on hand-edited generated files. **No colour token changes.**

---

## 4. Components to build

Base primitives come from `@hg/ui-web`. Marketing-specific, animated, with micro-interactions:

| Component | Micro-interaction |
|---|---|
| Sticky nav + audience toggle (3-way) | Segmented pill, spring slide; **marquee text on hover** for select nav items [confirmed request] |
| Hero lockup | Wordmark-scale type, seal interlocked through letterforms |
| Verification instrument | The seven checks running — the product demonstrated, not described |
| Waitlist forms ×3 | Inline validation, optimistic pending, real error states |
| Countdown | See §9 — gated on a real date |
| Consent banner (Klaro) | Bottom sheet, never a full-screen wall |
| Exit-intent / scroll popup | One only; `popup-and-overlay-timing-review` decides if it survives |
| Sticky mobile CTA bar | Appears past the hero, hides on scroll-down |
| Logo marquee | 40s linear ticker — **only once real logos exist** |
| FAQ accordion | Height + opacity transition, keyboard-operable |
| Blog index / post / author | MDX, Keystatic-driven |
| Footer | Legal, socials, language seam |

Every one implements empty / loading / error, per the repo rule.

---

## 5. Motion budget (measured from wisprflow.ai, not invented)

- `opacity` and `transform` only. **Never animate layout.**
- Durations 0.10s–0.45s. One spring: `cubic-bezier(.34, 1.56, .64, 1)`, transform only.
- Marquee/ticker: 40s linear.
- `will-change: transform, opacity`. No animation library, no video.
- Full `prefers-reduced-motion` honouring.

Wispr achieves its entire "smooth feel" this way — no GSAP, no Framer Motion, no Lottie, zero video.
These go into `tokens.json` under `motion` so they are enforced, not remembered.

---

## 6. Phases and gates

| Phase | Work | Gate |
|---|---|---|
| **0 · Strategy** | Objection map, awareness-stage framing, content pillars, pSEO template design | — |
| **1 · Design system** | Type pairing, scale, radii, motion → `tokens.json` → regenerate | **Gate A — client picks the direction** |
| **2 · Copy** | All three audiences, every section, CTA microcopy, FAQ, legal | **Gate B — client approves copy** |
| **3 · Build** | Next.js app, components, forms, CMS, consent, SEO, analytics | — |
| **4 · Review** | The 26-skill diagnostic gauntlet (§7) | **Gate C — findings fixed, evidence attached** |
| **5 · Ship** | Vercel, domain, DNS, verify forms land + pixels fire | **Gate D — client sees it live** |

---

## 7. Quality gates — what is actually verified

The 26 landing-page skills are **diagnostic, not generative**. That is precisely their value: they
are an adversarial review gate applied to work already built.

**Entry point:** `landing-page-triage` — it runs no diagnosis itself; it names at most three skills
to run and in what order. It is run first, and its ordering is followed rather than firing all 26.

| When | Skill | Why then |
|---|---|---|
| Phase 0 | `objection-map-builder` | Real objections → the section that answers each |
| Phase 0 | `marketing-psychology` | Schwartz awareness stages — write problem-aware, not product-aware |
| Phase 0 | `content-strategy` | Blog pillars, topic clusters, editorial calendar |
| Phase 0 | `programmatic-seo` | City/cuisine template design (**publish gated on real supply**) |
| Phase 2 | `copywriting` | Hero, sections, CTAs — all three audiences |
| Phase 2 | `landing-page-copy-readability-pass` | Names the exact sentences that slow a reader |
| Phase 4 | `hero-section-diagnosis` | The four hero elements as one argument |
| Phase 4 | `above-the-fold-clarity-review` | What cold traffic understands before scrolling |
| Phase 4 | `offer-clarity-diagnosis` | Is the offer specific, or a category description |
| Phase 4 | `cta-clarity-check` | One ask per view, or five quiet ones |
| Phase 4 | `trust-signal-audit` | The cautious-buyer questions — **core to this product** |
| Phase 4 | `social-proof-strength-audit` | Would it convince a sceptic, or is it decoration |
| Phase 4 | `form-friction-finder` | Waitlist completion |
| Phase 4 | `lead-form-sales-handoff-check` | Every field earns its place |
| Phase 4 | `popup-and-overlay-timing-review` | **Consent banner + popup + countdown + sticky bar all compete** |
| Phase 4 | `mobile-conversion-review` | Thumb reach, tap targets, keyboard |
| Phase 4 | `accessibility-conversion-blocker-check` | Contrast, labels, perceivable errors |
| Phase 4 | `conversion-leak-finder` | Every way out that isn't the CTA |
| Phase 4 | `page-length-fit-check` | Long enough for cold traffic, not longer |
| Phase 4 | `traffic-temperature-match-review` | Three audiences × cold/warm/branded |
| Phase 4 | `page-speed-impact-review` | Turns Lighthouse into a priority, not a scoreboard |
| Phase 4 | `thank-you-page-opportunity-audit` | Post-waitlist, where attention peaks |
| Pre-ads | `google-ads-landing-page-experience-review` | Quality Score before spend |
| Pre-ads | `landing-page-scale-readiness-check` | Will it hold when budget goes up |
| Post-ads | `paid-traffic-message-match-audit` · `landing-page-ab-test-readout` | Once ads and traffic exist |

**Deliberately not used yet:** `comparison-page-positioning-review` (no competitor page),
`pricing-page-clarity-review` (no pricing page), `trial-vs-demo-path-decision` (waitlist, not trial),
`community-marketing` (post-launch).

### Machine-checked, with evidence
1. Every page driven in real Chromium at **390 / 768 / 1440**, screenshots attached.
2. Lighthouse — LCP/CLS/TBT reported as numbers, never claimed.
3. axe-core accessibility scan.
4. A real waitlist submission, with the row verified in the database.
5. `pnpm check` — token drift, typecheck, lint including **L-4** (solid green reserved to `color.halal.*`).
6. `/code-review` and `/security-review` on the diff.
7. Invariant assertions: no red on any halal state; no badge rendered from a missing halal field.

---

## 8. What cannot be guaranteed, and what that means

Stated plainly, because a trust product is the wrong place to overclaim.

- **"Not AI slop" is a judgement, not a checklist result.** What is guaranteed: a distinctive
  direction chosen with the client at Gate A *before* any code, and visual sign-off at Gate C. Not an
  outcome a test can assert.
- **Social proof cannot be manufactured.** No testimonials, restaurant counts, press mentions or
  partner logos will be invented. The repo's own rule (`growth-toolkit.md`: "only if literally true")
  and Canadian advertising law both forbid it. Sections ship with honest placeholders or do not ship.
- **Certifying-body logos need permission.** HMA Canada, HFSAA and ISNA Canada marks cannot be
  displayed on a live commercial site without it.
- **The expired-certificate angle needs legal care.** The *anxiety* is fair game and is the strongest
  copy thread available — it is exactly the problem-aware framing the audience is already in. But
  naming specific businesses as fraudulent is defamation exposure. Copy will reference publicly
  reported regulatory actions with citations, or describe the category risk without naming anyone.
  No accusation, no implied ruling. This is also invariant #8 territory: the platform does not issue
  religious verdicts.

---

## 9. The countdown

Requested [confirmed]. It is buildable, but it needs a real date, and there is a conflict to resolve:
the site's own rule is **ethical urgency only, no fake scarcity** — carried over from the deleted
Astro plan and still binding — and launch
is currently blocked on client-side items (A2P 10DLC, Stripe live keys, hosting) with no committed date.

**Resolved [confirmed]:** the countdown ships, and the real date is set at launch, when the site
goes public and the blocked items have cleared. Nothing is publicly visible before then, so no
visitor ever sees an invented deadline — the concern about fake scarcity does not arise.

Built so it cannot go wrong by accident, rather than by remembering to fix it:

- **One value, `NEXT_PUBLIC_LAUNCH_AT`** (RFC 3339). Changing the date is an env-var edit and a
  redeploy — no code change, no rebuild of the component.
- **Unset → the countdown does not render.** It falls back to the live waitlist counter ("N people
  ahead of you in Ontario"), which is a real number and true from day one. This is the default, so
  the failure mode of forgetting to set a date is *no countdown*, never a wrong one.
- **Date in the past → switches to the live state**, never negative numbers or a frozen `00:00:00`.
- **Invalid value → treated as unset**, and the build logs a warning.

The waitlist counter is built regardless: it is honest urgency that works today and keeps working
after launch, when a countdown has nothing left to count.

---

## 10. What only the client can supply

Everything else is engineering. These are not:

- Vercel account access, and `halalgoes.com` DNS.
- A committed launch date, or the decision to drop the countdown (§9).
- Any real testimonial, partner logo, or restaurant count — plus permission to display them.
- Meta / Google Ads account IDs for the pixels.
- Legal sign-off on the CASL consent wording (phone waitlist) and the privacy policy.

---

## 11. Immediate next step

**Gate A — the design system.** Type pairing, type scale, radius language and motion character,
decided interactively, then written into `tokens.json` and regenerated. No code before that is signed off.
