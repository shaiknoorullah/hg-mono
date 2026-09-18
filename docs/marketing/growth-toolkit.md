# Halal Goes — Growth & Marketing Toolkit

_Synthesis of 7 research lanes (landing inspiration · copywriting · CRO · SEO/GEO+analytics ·
marketing MCPs · design/creative MCPs · awesome-repos). Ranked, deduped, and wired **onto** the
already-decided stacks: `docs/planning/growth-stack.md` (RudderStack · ClickHouse · dbt · Kestra ·
Castled · Dittofeed · OpenFeature+GrowthBook · Branch · Metabase · Klaro · Chatwoot) and the design
system in `docs/design/`. Researched Aug–Sep 2026._

> **Read `growth-stack.md` first.** This toolkit does not choose analytics/experiment/messaging
> vendors — those are locked. It chooses the **inspiration, copy patterns, CRO tactics, SEO/GEO
> plumbing, and AI tooling** to build a marketing/landing surface on top of that plane.

---

## 0. The hard constraints every item here obeys

These come from `CLAUDE.md` §3 and `docs/design/01-foundations.md`. Any generic marketing advice
that violates one of these is **wrong for this product** and is flagged inline below.

| # | Constraint | Consequence for marketing |
|---|---|---|
| **H-9** | Never red for a halal state | No "urgency red" CTA convention. CTAs use a non-red brand accent. |
| **H-10 / H-1 / L-4** | Solid green reserved to `color.halal.*` (hue 100–180° filled backgrounds banned elsewhere) | Semantic success/CTAs are **tint-only** or a non-green accent. The seal is the *only* solid green. |
| **H-8** | A missing halal field renders no badge — silence, never an optimistic one | Copy never overclaims certification. No "trusted!" without a real verified restaurant behind it. |
| **Expired = cool slate** | Not red | "We can't currently vouch" — model expired-cert states in slate, per `02-components.md`. |
| **Consent-first** | Klaro gates all SDKs (PIPEDA/GDPR) | No pixel/tag fires pre-consent. FTC dark-pattern rules bar false scarcity. |
| **Ontario-only launch, HST pending** | O-01/O-05 blockers | Geofenced waitlist, not a dead app-store listing. Footer discloses HST-registration-pending. |

---

## ⭐ TOP 10 — ADOPT NOW (ranked by leverage)

The highest-return items across all 7 lanes, deduped. Everything else is depth behind these.

| # | Item | Lane(s) | Why it's #1-priority | Link |
|---|---|---|---|---|
| **1** | **GrowthBook MCP** (`growthbook/growthbook-mcp`) | mcp-marketing | Flags/experiments are already GrowthBook. Thinnest, lowest-risk official MCP found (4 tools). Lets Claude run the CTA/waitlist/hero A/B tests directly. | https://github.com/growthbook/growthbook-mcp |
| **2** | **`writing-landing-page-copy` skill (already installed)** + **StoryBrand SB7** framing | copywriting | Zero install. Use it once the 3 messaging pillars are locked (verification claim · seven-check instrument · no-optimistic-badge). Customer = hero, HG = guide. | (local skill) / https://storybrand.com/building-a-storybrand-book-new/ |
| **3** | **Astro SEO/GEO base kit**: `@astrojs/sitemap` + `astro-seo` + `astro-seo-schema` + a static `/llms.txt` | seo-geo | Astro ships zero-JS HTML at build → wins classic SEO *and* GEO out of the box. This is the entire "make it citable" surface; it's plumbing, not a growth lever. | https://docs.astro.build/en/guides/integrations-guide/sitemap/ · https://github.com/jonasmerlin/astro-seo · https://www.npmjs.com/package/astro-seo-schema · https://llmstxt.org/ |
| **4** | **Klaro consent gate** (already in stack) wired in front of RudderStack + Branch on the page | seo-geo / stack | Nothing else may fire first. Consent Mode v2 compatible, self-hosted — matches the data-plane philosophy. This is the load-bearing compliance piece. | https://github.com/kiprotect/klaro |
| **5** | **RudderStack JS SDK** on the page (auto-captures `context.campaign` UTM/click-IDs) + **Branch deep-links as the app-CTA hrefs** | seo-geo / stack | The *only* two new client-side surfaces needed. UTM→ClickHouse and install attribution unify here — **do not add GA4/PostHog/Mixpanel**. | https://www.rudderstack.com/docs/sources/event-streams/sdks/rudderstack-javascript-sdk/ · https://help.branch.io/marketer-hub/docs/deep-link-reference |
| **6** | **Figma Dev Mode MCP** + **Vercel MCP** | mcp-design | Design→code handoff (real tokens/layout, not screenshots) and deploy/manage the Astro site from this session. The two build-side servers that match the stated toolchain. | https://www.figma.com/blog/introducing-figma-mcp-server/ · https://mcp.vercel.com |
| **7** | **Design-token bridge** (`design-token-bridge-mcp` or `claude-design-mcp`) | mcp-design | HG already has DTCG tokens in `docs/design/`. Bridge them into the page's Tailwind theme mechanically → the halal color-safety rules (no solid red, green reserved) are enforced structurally, not by review. | https://github.com/kenneives/design-token-bridge-mcp · https://github.com/Evilander/claude-design-mcp |
| **8** | **Two-audience fork + address/postcode-first hero** (Rover/DoorDash mechanic) | landing / cro | Steal the *mechanic*: single input as the primary CTA (not "Sign up"), and split customer / restaurant / rider paths within the first screen. Model the trust panel on HalalBooking, not a food hero. | https://www.rover.com/ · https://www.doordash.com/ · https://www.halalbooking.com/ |
| **9** | **`coreyhaines31/marketingskills`** (CRO + copy + SEO + analytics as Claude skills) | copy / mcp / repos | The single most on-target skill pack — appears in 3 lanes independently. Test against real HG copy tasks before building custom skills. | https://github.com/coreyhaines31/marketingskills |
| **10** | **Objection-ladder page structure + one-CTA discipline** (CXL/Baymard/NN-g) | cro / copy | hero → how verification works → certifying-body proof → FAQ → final CTA; one repeated CTA verb; >54% of attention is above the fold; a 2nd competing CTA cut conversion up to 266% in cited tests. | https://cxl.com/blog/how-to-build-a-high-converting-landing-page/ · https://www.nngroup.com/articles/communicating-trustworthiness/ |

**Watch-next (not now):** Ahrefs/Semrush official MCPs (SEO, when there's traffic to analyze) ·
Recraft/Ideogram/Runway creative MCPs (when launch creative volume justifies it) · Google Ads MCP
(PPC, post-launch) · RudderStack + ClickHouse + Metabase MCPs (when querying real HG data).

---

## 1. Landing-page inspiration & exemplars

**Use three galleries for three different jobs — cross-reference, don't pick one:**

| Gallery | Job | Link |
|---|---|---|
| **Lapa Ninja** | Whole-page scroll structure (7,300+ full-page screenshots + Sections/OG/Fonts sub-galleries) | https://www.lapa.ninja/ |
| **Mobbin (Sites)** | Component/micro-interaction search; see a marketplace's landing *and* its post-signup screens side by side | https://mobbin.com/ |
| **Refero.design** | Micro-interaction reference (hover, form transitions) once structure is set | https://refero.design/ |
| **Land-book** | Themed collections (dark mode, marketplace, gradient) — _blocks scraping (403), browse manually_ | https://land-book.com/ |
| **SaaSLandingPage** | Filter by tech stack/font/color — useful once Astro + halal-safe palette is fixed | https://saaslandingpage.com/ |
| **One Page Love** | Single long-scroll storytelling + anchor nav (fits a one-page HG landing) | https://onepagelove.com/ |
| **Awwwards Food & Drink** / **CSSDA** | Typography & food photography treatment only — winners are single-brand DTC, **weak for marketplace conversion** | https://www.awwwards.com/inspiration_search/food-drink/ · https://www.cssdesignawards.com/ |

**Exemplars — steal the mechanic, not the visual (esp. not red):**

- **Structural analog is trust/certification, not food delivery.** HG's halal-verification claim
  has no food-delivery analog. Model the certification panel on **HalalBooking.com** (above-the-fold
  "how we verify halal" badge + explainer — nearest real precedent) and **Airbnb**'s verified-host
  badge system (how a verification claim reads as a scannable badge across screen sizes).
  - https://www.halalbooking.com/ · https://www.airbnb.com/
- **The three food-delivery moves to copy** (DoorDash, Uber Eats, Deliveroo): (1) single
  address/postcode input as the primary CTA, (2) one brand-color accent used *only* on CTAs
  (**must be non-red for HG**), (3) a trust strip (ratings, restaurant count, delivery time) under
  the fold. Deliveroo is the closest regulatory cousin (UK/EU) and already uses **tint-only green
  badges** — directly aligned with H-1.
  - https://www.doordash.com/ · https://www.ubereats.com/ · https://deliveroo.co.uk/
- **Two-sided marketplace fork** (Rover, Instacart Shoppers): fork customer / restaurant / rider
  paths early with distinct CTAs and their own trust indicators — not one generic "Get Started."
  Supply-side recruit pages lead with income estimate up front.
  - https://www.rover.com/ · https://a-fresh.website/websites/instacart-shoppers

---

## 2. Copywriting frameworks + trust-product patterns

**Framework picks for a TRUST product (halal verification):**

1. **StoryBrand SB7 (spine).** Customer (halal-observant diner) = hero; HalalGoes = guide with a
   plan (verified badge + seven-check instrument). Never make the platform the hero. "If you
   confuse, you lose." → https://storybrand.com/building-a-storybrand-book-new/
2. **PAS or 4Us for the hero headline** (not AIDA). Agitate the real anxiety — _"Is this actually
   halal, or just claimed?"_ — then resolve with the verification mechanism. AIDA's slower build
   is wrong for a category-creating claim.
3. **Fascinations (Copyhackers)** for curiosity subheads that tease the seven-check instrument as
   a differentiator without dumping the full methodology into the hero.
4. **Schwartz "stages of market awareness"** — critical: most of the audience knows the *anxiety*
   but not that a *verification mechanism* exists. Write to problem-aware, not product-aware.

**The trust-specific rules (these override generic CRO conventions):**

- **Authority > volume.** Certifying-body logos, "verified by X", process transparency beat
  generic star-rating social proof — per Halal Food Council USA / ISA Halal, authenticity signals
  outperform volume when *trust itself is the product*, and fake-cert scandals destroy trust
  instantly. **Never overclaim** (ties to invariant H-8).
- **CTA color follows the design system, not "urgency red."** Consciously deviate from generic
  CTA-color advice (Woobox/KlientBoost) — solid green is reserved to `color.halal.*`, red never
  signals a halal state.
- **Objection-ladder structure:** hero CTA → how verification works → certifying-body proof →
  FAQ (price, delivery time, _what happens if a restaurant loses certification_) → final CTA.
  Place each CTA right after an objection is resolved.
- **CTA microcopy under the button:** risk reversal + anchors — "No card required" / "Verified in
  7 checks" / "Trusted by N Ontario restaurants" (only if literally true — see §3 FTC rule).

**References:** Copyhackers formulas & headlines (https://copyhackers.com/2015/10/copywriting-formula/ ·
https://copyhackers.com/headlines-for-beginner-copywriters/ · https://copyhackers.com/how-to-optimize-a-headline/) ·
Copywriting.school formula comparison (https://copywriting.school/formulas) ·
Instant Press objection-first sections (https://www.instantpress.co/blog/how-to-write-landing-page-copy) ·
KlientBoost CTA copy (https://www.klientboost.com/landing-pages/call-to-action-copy/) ·
Social proof: WiserNotify (https://wisernotify.com/blog/landing-page-social-proof/) · Nudgify (https://www.nudgify.com/social-proof-landing-pages/) ·
**Domain-specific:** Halal Food Council USA (https://halalfoodcouncilusa.com/how-to-market-your-halal-certified-product-to-u-s-consumers/) · ISA Halal (https://www.isahalal.com/news-events/blog/gaining-and-maintaining-customer-trust-through-halalcertification) ·
**Classics:** Schwartz *Breakthrough Advertising* · Ogilvy *on Advertising* (honest-claim discipline, fits H-8) · Whitman *Cashvertising*.

**Copy skills (Claude Code) — try before building custom:** `coreyhaines31/marketingskills` (⭐ top-10)
· `cyrwheelninja/copywriting-skill` (50+ frameworks + 34 Copyhackers prompts) ·
`robpalmer99/claude-code-copywriting-skills` (incl. a **compliance-check** skill — relevant to
HST/regulatory copy) · `makash/great-web-copy` (auto-activates for hero/CTA copy) ·
`rampstackco/claude-skills` landing-page-copy (maps to the objection ladder).

---

## 3. CRO techniques to apply

Wire every experiment through **GrowthBook** (already in stack) with **ClickHouse** as the analysis
warehouse — no new experimentation vendor.

**The rules, in priority order:**

1. **Above the fold does the work.** >54% of attention concentrates there (Baymard), more on
   mobile. Put the halal-certification promise, one CTA, and app badges there — nothing competing.
2. **One CTA per screen, repeated verbatim.** A cited test showed a second competing CTA cut
   conversion up to 266%. Keep one verb on the page.
3. **Waitlist, not a dead store listing (pre-launch).** Ontario-only launch → geofenced waitlist
   (email + postal code) avoids a store listing with an empty product. Flip to direct app-store
   CTAs once Ontario supply is live. A/B this in GrowthBook.
4. **Minimize form friction** (Baymard). Waitlist = email + city, nothing else. App hand-off =
   Branch deep link straight to the store listing, no interstitial signup wall.
5. **Verifiable social proof only** (NN/g). Real counts, linkable reviews, named restaurants.
   Anonymous testimonials draw "healthy skepticism" and can hurt.
6. **Ethical scarcity only** (FTC 2022 dark-patterns report names false low-stock/high-demand as
   enforcement targets). Any urgency ("X restaurants live in your area, more onboarding weekly")
   must be literally true — ideally bound to real RudderStack/ClickHouse counts. **No countdown
   timers.** This matches HG's own "never manufacture false confidence" halal ethos.
7. **Official app-store badges, correctly placed** — one case cited a 20% download lift. Above the
   fold and repeated at the bottom CTA; localized Apple/Google assets linking to the live listing.
8. **Mobile-first canvas.** Design at 375px first (67% of mobile ecommerce homepages rate
   mediocre/poor — Baymard 2025). Hero + CTA fully visible without scroll.
9. **Distribute trust signals by funnel position** (NN/g Pyramid of Trust), don't cluster: hero =
   cert badge + review count; mid-page = named restaurant logos/testimonials; footer = legal /
   **HST-registration-pending disclosure** / privacy.

**First GrowthBook experiments to queue:** waitlist field count (email-only vs +city vs +phone) ·
CTA verb ("Get the app" vs "Join the waitlist" vs "Find halal near me") · hero proof type (cert
seal vs restaurant-count stat vs customer quote) · app-badge placement (top-only vs top+sticky bottom).

**References:** CXL landing anatomy / optimization process / 79.3% case study
(https://cxl.com/blog/how-to-build-a-high-converting-landing-page/ ·
https://cxl.com/blog/landing-page-optimization/ · https://cxl.com/blog/case-study-how-we-improved-landing-page-conversion/) ·
Baymard friction audit / mobile checkout / homepage UX
(https://baymard.com/learn/audit-checkout-flow-hidden-friction · https://baymard.com/blog/mobile-checkout · https://baymard.com/learn/ecommerce-category-page) ·
NN/g trust (https://www.nngroup.com/articles/communicating-trustworthiness/ · https://www.nngroup.com/reports/ecommerce-ux-trust-and-credibility/ · https://www.nngroup.com/videos/pyramid-trust/) ·
FTC dark patterns (https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf) · Mathur et al. dark-patterns crawl (https://arxiv.org/pdf/1907.07032) ·
App-store badge lift (https://618media.com/en/blog/app-store-badge-utilization/) ·
GrowthBook best practices / A-B primer (https://docs.growthbook.io/using/experimentation-best-practices · https://www.growthbook.io/blog/what-is-a-b-testing) ·
Unbounce testing method (https://unbounce.com/landing-pages/landing-page-testing/ — method only, don't buy the tool) ·
Landingi pre-launch go/no-go checklist (https://landingi.com/conversion-optimization/checklist/).

---

## 4. SEO/GEO + analytics/attribution wiring (Astro on Vercel-or-self-hosted)

> **Stack note (Sep 2026).** This section was written against Astro. The site is **Next.js**, so
> the Astro-specific packages below — `@astrojs/sitemap`, `astro-seo`, `astro-seo-schema` — do not
> apply; their jobs are done by `src/app/sitemap.ts`, `robots.ts`, the Metadata API and
> `StructuredData.tsx` in `apps/marketing/`. The *reasoning* in this section (what to mark up, why
> GEO blocks matter, consent before tracking) still holds, and the rest of this document is
> framework-independent.

**Astro is already ahead:** zero client-JS by default, full HTML + structured data at build time,
so AI crawlers get real markup not a JS shell. The work is plumbing (sitemap + JSON-LD +
robots/llms.txt), not framework-fighting.

**SEO/GEO build kit (all ⭐ item 3):**

| Piece | Package | Link |
|---|---|---|
| Sitemap (auto, hreflang) | `@astrojs/sitemap` → reference from robots.txt | https://docs.astro.build/en/guides/integrations-guide/sitemap/ |
| Meta/OG/Twitter | `astro-seo` `<SEO>` component | https://github.com/jonasmerlin/astro-seo |
| Type-safe JSON-LD | `astro-seo-schema` (Restaurant/LocalBusiness/FAQPage/Organization) | https://www.npmjs.com/package/astro-seo-schema |
| GEO-first schema graph | `seo-graph` (Joost de Valk — "agent-ready SEO", LLM-consumption-first) | https://github.com/jdevalk/seo-graph |
| AI-citation map | static `/llms.txt` (+ optional `/llms-full.txt`) listing canonical/citation-worthy URLs | https://llmstxt.org/ |
| Validate before ship | Google Rich Results Test · Schema.org validator | https://search.google.com/test/rich-results · https://validator.schema.org/ |
| CWV / dynamic bits | Astro View Transitions + Server Islands (e.g. live "N verified this week" counter) | https://docs.astro.build/en/guides/view-transitions/ |

**GEO reality check:** schema shows *no proven causal citation lift* — treat it as hygiene, not a
growth lever. Spend the marginal effort on genuinely citable structured facts (certification
status, service area, pricing) with consistent NAP/menu/hours, and keep content non-JS-gated so
Perplexity/ChatGPT can read it.

**Analytics/attribution wiring — DO NOT add GA4/PostHog/Mixpanel.** The page's *only* new
client-side surfaces:

1. **RudderStack JS SDK** — auto-populates `context.campaign` (utm_*) on every page/track call →
   ClickHouse. This is the UTM capture point, not a separate tool.
   https://www.rudderstack.com/docs/sources/event-streams/sdks/rudderstack-javascript-sdk/
2. **Branch deep-link snippet** — "Download the app" CTAs are Branch links (not raw store URLs) so
   install attribution unifies with the funnel; Branch forwards its tags as UTMs and won't clobber
   existing ones. https://help.branch.io/marketer-hub/docs/deep-link-reference
3. **Klaro** — blocks 1 & 2 until consent granted; Consent Mode v2 compatible, self-hosted.
   https://github.com/kiprotect/klaro
4. **(Optional, skippable)** Plausible or Umami for a cookieless self-serve pageview dashboard —
   **redundant with Metabase-on-ClickHouse**, adopt only if marketing wants a plug-and-play UI.
   Umami (MIT, Postgres, ~512MB) is cheaper to run than Plausible (needs ClickHouse).
   https://plausible.io/self-hosted-web-analytics · https://umami.is/

**Gotcha:** RudderStack **cloud-mode GA4 does NOT reliably forward UTMs**. If any GA4 pass-through
is kept for Search Console/Ads continuity, use **device mode** or send campaign context explicitly
in the payload. https://www.rudderstack.com/docs/destinations/streaming-destinations/google-analytics-4/cloud-mode/

**Experiments:** reuse **GrowthBook** for headline/CTA tests (exposure read from ClickHouse) — not
VWO/Optimizely. https://www.growthbook.io/

---

## 5. MCPs / agents / skills — ranked shortlist

### 5a. Marketing / analytics / CDP / SEO / CRM / PPC

| Rank | Server | Verdict | What it does | Link |
|---|---|---|---|---|
| **A1** | **GrowthBook MCP** (official) | **Adopt now** | Flag/experiment CRUD from Claude; thinnest official server found (4 tools). Matches the chosen flag tool. | https://github.com/growthbook/growthbook-mcp |
| **A2** | **RudderStack MCP** (official, workspace ops) | **Adopt now** (when pipelines live) | Debug delivery errors, author/test transformations, review audit logs on the chosen CDP. | https://www.rudderstack.com/docs/ai-features/rudderstack-mcp/ |
| **A3** | **ClickHouse MCP** (`ClickHouse/mcp-clickhouse`, official) | **Adopt now** (when warehouse live) | NL queries over the event warehouse. Use the official repo, **not** the ~9 community forks. | https://github.com/ClickHouse/mcp-clickhouse |
| **A4** | **Metabase MCP** (`easecloudio` / `jerichosequitin` — community) | Adopt (no official exists) | 70+ tools over dashboards/cards/DBs — the BI layer. Pick the most-maintained fork. | https://github.com/easecloudio/mcp-metabase-server |
| **A5** | **RudderStack Profiles MCP** (official) | Watch | Build identity-resolution/feature-engineering Profiles projects conversationally. When targeting needs unified profiles. | https://github.com/rudderlabs/profiles-mcp |
| **A6** | **Ahrefs MCP** (official, hosted/OAuth) | Watch → adopt when there's traffic | Keyword/backlink/rank research. Prefer this hosted endpoint over deprecated local clones. | https://github.com/ahrefs/ahrefs-mcp-server |
| **A7** | **Semrush MCP** (official, hosted) | Watch | domain_overview / keyword / competitor / paid-search research — competitive halal-delivery market view. | https://mcp.semrush.com/v2/mcp |
| **A8** | **Google Search Console MCP** + **GA4 MCP** (community) | Watch | Live ranking data / schema-aware GA4 — only if GA4 is kept alongside RudderStack for Search Console/Ads. | https://github.com/charlesdove977/search-console-mcp · https://github.com/surendranb/google-analytics-mcp |
| **A9** | **Google Ads MCP** (official, read-only) | Watch (post-launch PPC) | GAQL reporting, no campaign writes — fits a conservative budget rollout. | https://github.com/googleads/google-ads-mcp |
| **A10** | **HubSpot MCP** (official) | Watch (if CRM adopted) | Restaurant-partner/sales CRM — vendor-maintained, avoid unofficial forks. | https://github.com/hubspot/mcp-server |
| **A11** | **markifact-mcp** / Pipeboard | Watch (evaluate) | Multi-platform ads/CRM (Google/Meta/TikTok/LinkedIn) with **human-in-the-loop write gate** (fits deny-by-default). markifact = 300+ tools; Pipeboard = paid BSL. | https://github.com/markifact/markifact-mcp |

- **No MCP for Dittofeed or Branch.** For Branch, RudderStack's own Branch destination is the
  practical bridge (send events into Branch server/device-side). Dittofeed has none found.
- **PostHog MCP** (official) is the reference product-analytics MCP but **PostHog is deliberately
  out of the stack** — note only, don't adopt. https://github.com/PostHog/mcp

### 5b. Design / creative

| Rank | Server | Verdict | What it does | Link |
|---|---|---|---|---|
| **B1** | **Figma Dev Mode MCP** (official) | **Adopt now** | Frame hierarchy, layout constraints, variables/**design tokens**, text styles as structured data → design-accurate code, not screenshot-guessing. | https://www.figma.com/blog/introducing-figma-mcp-server/ |
| **B2** | **Vercel MCP** (official, OAuth) | **Adopt now** | Manage projects/deployments + read deploy logs for the Astro site from this session (matches deploy target). | https://mcp.vercel.com |
| **B3** | **Design-token bridge** (`design-token-bridge-mcp` / `claude-design-mcp`) | **Adopt now** | Translate `docs/design/` DTCG tokens → Tailwind theme mechanically → halal color rules enforced structurally. | https://github.com/kenneives/design-token-bridge-mcp · https://github.com/Evilander/claude-design-mcp |
| **B4** | **21st.dev Magic MCP** | Adopt (fast scaffolding) | "v0-in-editor": searches 10k+ React/Tailwind components, generates hero/pricing/CTA blocks + logo/SVG search. Fastest path to polished Astro+Tailwind UI. | https://github.com/21st-dev/magic-mcp |
| **B5** | **Recraft MCP** (official, remote) | Watch → adopt for creative volume | On-brand vector/illustration + bg removal + custom styles — suits a halal illustration style that must avoid red/haram-coded imagery. | https://www.recraft.ai/docs/mcp-reference/remote-server |
| **B6** | **Ideogram v3 MCP** (via fal.ai) | Watch | Best legible **text-in-image** — promo banners, App Store screenshots, badges with embedded copy. | https://lobehub.com/mcp/pierrunoyt-fal-ideogram-v3-mcp-server |
| **B7** | **Nano Banana MCP** | Watch | Cheap bulk image variants (social sizes, hero crops), 4K, Gemini model. | https://github.com/zhongweili/nanobanana-mcp-server |
| **B8** | **Runway MCP** (official) | Watch (if launch video) | Broadest video option — Seedance/Kling/Gen-4.5/Veo/Nano Banana Pro behind one server. | https://runway.com/mcp |
| **B9** | **Cloudinary MCP** (official) | Watch | Upload/organize/responsive-transform whatever creative gets generated — last-mile asset pipeline. | https://github.com/cloudinary/mcp-servers |
| **B10** | **Getty Images MCP** (official) | Watch | Licensed real food/restaurant photography with clean commercial licensing (vs AI-generated). | https://newsroom.gettyimages.com/en/getty-images/ |
| — | `replicate-flux-mcp` · `fal.ai Recraft v3` · `mcp-video-gen` · Framer Plugin MCP | Fallbacks | Model aggregators / alt hosting / no-code Framer microsite fallback. | https://github.com/awkoy/replicate-flux-mcp · https://github.com/Sheshiyer/framer-plugin-mcp |

### 5c. Skills (Claude Code) — not MCP

| Rank | Skill pack | Verdict | Link |
|---|---|---|---|
| **S0** | **`writing-landing-page-copy`** (already installed locally) + repo `seo-geo` skill | **Use now** | (local) |
| **S1** | **`coreyhaines31/marketingskills`** — CRO/copy/SEO/analytics/growth-eng | **Adopt now** (⭐ top-10) | https://github.com/coreyhaines31/marketingskills |
| **S2** | **`zubair-trabzada/ai-marketing-claude`** — 15 skills + parallel subagents (site audit, copy, email, ads, calendars, competitive intel) | Adopt for campaign prep | https://github.com/zubair-trabzada/ai-marketing-claude |
| **S3** | Copy skills: `cyrwheelninja/copywriting-skill` · `robpalmer99/...` (compliance-check) · `makash/great-web-copy` · `rampstackco/claude-skills` | Try against real copy | (see §2) |
| **S4** | `VoltAgent/awesome-agent-skills` — 1000+ index to search later | Bookmark | https://github.com/VoltAgent/awesome-agent-skills |

---

## 6. Awesome-repos & directories to bookmark

**MCP discovery — two layers:** static awesome-lists (quality-filtered starting points) + live
registries (is-there-an-MCP-for-X, thousands, continuously updated).

| Type | Resource | Use | Link |
|---|---|---|---|
| Awesome list | `wong2/awesome-mcp-servers` | Canonical MCP directory | https://github.com/wong2/awesome-mcp-servers |
| Awesome list | `punkpeye/awesome-mcp-servers` | Largest, actively updated — cross-check maintenance | https://github.com/punkpeye/awesome-mcp-servers |
| Awesome list | `appcypher/awesome-mcp-servers` | Triangulate maintained vs abandoned forks | https://github.com/appcypher/awesome-mcp-servers |
| Registry | **Smithery** | Discover + one-click deploy (hosting/auth built in) | https://smithery.ai/ |
| Registry | **mcp.so** | Broadest search layer (20k+) | https://mcp.so/ |
| Registry | **Glama** | Quality-scored — pick production-grade servers | https://glama.ai/mcp/servers |
| Directory | **mcpservers.org/marketing** | Periodic re-scan for new marketing MCPs (234 listed) | https://mcpservers.org/category/marketing |
| Claude Code hub | **`hesreallyhim/awesome-claude-code`** | De-facto community hub — skills/subagents/hooks/plugins; watch for worktree/plan-verify patterns | https://github.com/hesreallyhim/awesome-claude-code |
| Subagents | `VoltAgent/awesome-claude-code-subagents` | 100+ pre-built subagents incl. marketing roles | https://github.com/VoltAgent/awesome-claude-code-subagents |
| Growth skills | `mikiarlo3/awesome-growth-hacking-skills` | Curated open-source growth agent skills | https://github.com/mikiarlo3/awesome-growth-hacking-skills |
| GEO | `Citedrelevance/awesome-generative-engine-optimization` | Most rigorous GEO glossary/standard — feed the `seo-geo` skill | https://github.com/Citedrelevance/awesome-generative-engine-optimization |
| GEO | `amplifying-ai/awesome-generative-engine-optimization` | Complementary (AEO/AISO/LLMO variants) | https://github.com/amplifying-ai/awesome-generative-engine-optimization |
| SEO | `teles/awesome-seo` · `Suganthan-Mohanadasan/awesome-seo-tools` · `best-of-ai/awesome-ai-seo` | Classic SEO + 208 tools + AI-SEO tooling | https://github.com/teles/awesome-seo |
| Meta | `sindresorhus/awesome` | Master index — discover new lists as the space moves | https://github.com/sindresorhus/awesome |
| Background only | `ninjasort/awesome-marketing` · `bekatom/awesome-growth-hacking` | Historical reference — **thin/stale**, not active tooling | https://github.com/ninjasort/awesome-marketing |
| Agent frameworks | `aloth/awesome-ai-agents` | If HG ever builds a custom agent over the growth data plane | https://github.com/aloth/awesome-ai-agents |

---

## Appendix — cross-lane dedupe log

Items that surfaced in multiple lanes (counted once, ranked by combined signal):

- **`coreyhaines31/marketingskills`** — copywriting + mcp-marketing + awesome-repos (3 lanes) → ⭐ #9 / S1.
- **GrowthBook** — cro (experiments) + seo-geo (A/B) + mcp-marketing (MCP) → ⭐ #1 (MCP) + §3/§4.
- **RudderStack + ClickHouse + Branch + Klaro** — seo-geo (wiring) + mcp-marketing (MCPs) → ⭐ #4/#5 + §5a.
- **Design tokens (`docs/design/`)** — mcp-design token bridges + copy/CRO color constraints → ⭐ #7.
- **Objection-ladder / one-CTA / trust placement** — copywriting + cro (NN/g overlap) → ⭐ #10 + §2/§3.
- **HalalBooking / Rover fork / non-red CTA** — landing + copywriting + cro → ⭐ #8 + §1.
- **Astro zero-JS SEO/GEO** — seo-geo only, but underpins ⭐ #3 and the whole page technical basis.

_Dropped as out-of-stack (documented so they aren't re-proposed): GA4/PostHog/Mixpanel as primary
analytics (RudderStack+ClickHouse own this), VWO/Optimizely (GrowthBook), OneTrust/Cookiebot
(Klaro), Unbounce as a tool (method only), Novu (Dittofeed owns marketing delivery)._
