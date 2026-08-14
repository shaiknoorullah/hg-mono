# Growth & marketing backend stack (self-hosted-first)

_Halal Goes. Bias: self-hostable, privacy-respecting (on-brand for a trust product, and
required under Canada PIPEDA), separate data plane from the transactional source of truth.
Researched Aug 2026._

## Architectural rule (hg-specific)

The growth stack is a **separate data plane**. Events flow **out** of the app into a CDP /
warehouse (ClickHouse-class store); they never flow back into the transactional Postgres
that prices orders and holds the ledger. Postgres stays the source of truth; analytics is
downstream and disposable-if-needed, same spirit as the Redis rule. **PII discipline:** never
pipe KYC docs, raw phone, or certificate data into analytics — hash/omit at the SDK, gate on
consent.

## The layers, and the self-hosted pick per layer

| # | Layer | What it does | Self-hosted pick | Notes |
|---|---|---|---|---|
| 1 | **Event collection / SDKs** | Capture user + server events | **PostHog** (or Snowplow for raw pipeline) | client + server SDKs; the spine everything else reads |
| 2 | **CDP / identity resolution** | Unify identities, route events to tools | **RudderStack** (robust) or **Jitsu** (lighter) | Segment alternative; warehouse-first |
| 3 | **Data warehouse** | Store/model behavioural data | **ClickHouse** (+ **dbt** for models) | PostHog & RudderStack use ClickHouse |
| 4 | **Product analytics** | Funnels, retention, paths | **PostHog** | one tool covers 1,4,5,11,12 |
| 5 | **Feature flags + experiments (A/B)** | Gated rollout, targeting, stats | **GrowthBook** (experiments) / **Unleash** (pure flags) / PostHog | GrowthBook has a real stats engine, no per-seat |
| 6 | **Engagement / journeys / messaging** | Event-triggered email/SMS/push/in-app, segments, broadcasts | **Laudspeaker** or **Dittofeed** | the Customer.io/Braze self-hosted core |
| 7 | **Notification infrastructure** | Multi-channel transactional delivery, provider fan-out, digests | **Novu** | the *delivery* layer beneath 6 (or let 6 handle it) |
| 8 | **In-app tours / coach-marks / checklists** | First-run walkthrough, onboarding | **Usertour** (web) · **Laudspeaker** (mobile onboarding) · RN libs (react-native-copilot / rn-tourguide) driven by flags | mobile platform options are thin — build the component, target via flags/CDP |
| 9 | **Email delivery** | SMTP relay + marketing sends | provider (**SES/Postmark/Resend**) + **Listmonk** (campaigns) | self-hosting an MTA isn't worth it; relay through a provider |
| 10 | **Mobile attribution (MMP) + deep linking** | Install attribution, deferred deep links, SKAdNetwork | **OpenAttribution** (OSS, immature) or **Branch** (free tier) | **weakest OSS category — see gaps** |
| 11 | **Session replay / heatmaps** | See real sessions | **PostHog** replay or **OpenReplay** | debugging + funnel diagnosis |
| 12 | **Surveys / NPS / feedback** | In-app microsurveys | **PostHog** surveys or **Formbricks** | close the qualitative loop |
| 13 | **Reverse ETL / activation** | Push warehouse audiences back into tools | **Castled** or RudderStack reverse ETL | "users who abandoned cart 2×" → messaging |
| 14 | **Consent management (CMP)** | Lawful-basis capture before tracking | **Klaro** (OSS) | **required** — PIPEDA/GDPR; must exist *before* SDK fires |
| 15 | **Tracking-plan / schema governance** | Enforce a typed event schema | Snowplow schemas / RudderStack Tracking Plans / Avo | the analytics "contract" — fits our contract-first ethos |
| 16 | **Data enrichment** | Firmographic/demographic append | mostly SaaS (Clearbit, PDL) | **OSS gap** — enrich via API when needed |
| 17 | **Support / live chat inbox** | Omnichannel support + proactive chat | **Chatwoot** (OSS) | an engagement channel, not just support |

## Tools you didn't name but need (the gap answer)

You listed engagement, flags, CDP, events/tracking, enrichment, journeys, attribution. Missing:

1. **Consent Management (Klaro)** — legally load-bearing. Nothing else may fire until consent is captured. For a *trust* brand this is also a positioning asset.
2. **Notification infrastructure (Novu)** — the delivery layer beneath "journeys"; separates *transactional* (order updates — must always send) from *marketing* (consent-gated). Conflating them gets you compliance and deliverability problems.
3. **Tracking-plan / schema governance** — without a typed event contract, the CDP fills with `btn_click2_final` garbage in a month. This is the analytics analogue of your OpenAPI contract; enforce it the same way.
4. **Reverse ETL / activation (Castled)** — otherwise the warehouse is a graveyard; this is how a segment becomes a campaign.
5. **Session replay + surveys (PostHog / OpenReplay / Formbricks)** — the qualitative half; funnels tell you *what*, replay/surveys tell you *why*.
6. **Deep linking** (inside attribution) — needed for referrals, shared restaurant links, and deferred deep links after install; don't treat it as free.
7. **dbt + a warehouse** — the modelling layer; "revenue per cohort" lives here, not in a tool.
8. **Fraud / promo-abuse detection** — not classic martech, but a delivery marketplace with promo codes + referrals *will* be abused (fake accounts, referral farming, code sharing). Protect the growth spend: velocity rules, device/deep-link signals, one-promo-per-identity. Ties to your existing `deadline_at`/idempotency discipline.
9. **Referral/loyalty engine** — usually custom; plan for it rather than discover it.

## Recommended lean anchor (don't sprawl at v0)

Start with **two tools that each cover many layers**, add the rest as you scale:

- **PostHog** (self-hosted) → events, product analytics, feature flags, experiments, session replay, surveys, CDP-lite. Covers layers 1, 4, 5, 11, 12 and part of 2.
- **Laudspeaker** *or* **Dittofeed** → engagement journeys + multi-channel messaging + (Laudspeaker) mobile onboarding. Covers 6, part of 8.
- **Klaro** (consent) and **Novu** (notification infra) as the compliance + delivery spine.
- **Branch** (free tier) for attribution + deep links until OSS MMP matures (**OpenAttribution** is the OSS watch-item).
- **Chatwoot** for support/chat.

Then, at scale: dedicated CDP (**RudderStack/Snowplow**), **ClickHouse + dbt** warehouse, **Castled** reverse ETL, **Formbricks/OpenReplay** if you outgrow PostHog's built-ins, **GrowthBook** if you want a heavier experimentation stats engine than PostHog's.

**Pick between Laudspeaker vs Dittofeed:** Laudspeaker if mobile onboarding + journeys in one matters most; Dittofeed if you want the most dev-friendly, transactional-and-marketing, broadcast-capable engine. Both self-host, both multi-channel.
