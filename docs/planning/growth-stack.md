# Marketing-intelligence plane (v2) — self-hosted, best-of-breed

_HalalGoes. **Scope: v2, plan-and-document now, build later.** This plane is **user + platform
data for marketing intelligence** — Martech, Adtech, CDP, engagement, flags/experiments. It is
**not** the transactional OLTP plane (orders/ledger) and **not** the technical telemetry plane
(see `telemetry-stack.md`). Researched Aug 2026._

## Load-bearing principles

1. **Separate data plane.** Events flow *out* of the apps into the CDP → warehouse; they never
   flow back into the Postgres that prices orders and holds the ledger. Postgres stays the
   source of truth. No marketing tool reads or writes OLTP tables directly.
2. **Best-of-breed, zero feature overlap.** Each capability is owned by exactly one tool. We do
   **not** adopt all-in-one suites (PostHog, Novu-as-everything) because they duplicate what a
   dedicated tool already owns. If two tools claim the same job, one is wrong for the stack.
3. **Consent-first.** No SDK fires before consent is captured (Klaro). PIPEDA/GDPR, and on-brand
   for a trust product.
4. **PII discipline.** KYC docs, raw phone, certificate data never enter analytics. Hash or omit
   at the SDK. The marketing plane sees pseudonymous IDs + behavioural events, not identity docs.
5. **Event contract governance.** Events are a typed contract (like `openapi.yaml`). A tracking
   plan is version-controlled and enforced at ingestion; no ad-hoc `btn_click_final2`.

## The stack — one owner per capability

| Capability | Tool | Owner boundary (no overlap) |
|---|---|---|
| **Event collection + CDP + routing** | **RudderStack** (chosen) | Collects/identifies/routes events. Does *not* do dashboards, messaging, or flags. |
| **Warehouse** | **ClickHouse** (chosen) | Same engine as ClickStack telemetry (shared ops expertise), but a **separate instance/database** — different plane, retention, and access. |
| **Transform / modelling** | **dbt** | SQL models + tests on the warehouse. The "metrics contract." |
| **Pipeline orchestration** | **Kestra** (recommended) | Schedules/observes pipelines (the lightweight Airflow). Declarative YAML, polyglot, single-binary. |
| **Reverse ETL / activation** | **Castled** (chosen) | Pushes warehouse audiences → engagement/ad tools. The only tool that writes *back out*. |
| **Engagement / journeys / messaging** | **Dittofeed** (chosen) | Owns *all* marketing channel delivery (email/SMS/push/in-app). This is why we drop Novu. |
| **Feature flags + experiments (A/B)** | **OpenFeature** + **GrowthBook** | OpenFeature = vendor-neutral SDK contract; GrowthBook = provider (flags + experiment stats). |
| **Adtech / attribution / MMP** | **OpenAttribution** (self-host) or **Branch** (free tier) + server-side CAPI | Cross-channel ad ROI + install/deep-link attribution. |
| **BI / dashboards** | **Metabase** (chosen) | Human-facing analysis on ClickHouse (native driver). The *only* dashboarding tool. |
| **Consent (CMP)** | **Klaro** | Lawful-basis capture gate before any tracking. |
| **Support / live chat** | **Chatwoot (headless)** | Engine only — omnichannel + agent model + reports. UI is built **native in the admin** (Application API + ActionCable); voice via Twilio Voice/WebRTC in-admin. See `../design/support-desk.md`. |
| **In-app tours / coach-marks** | *build in-app* (RN libs) driven by **GrowthBook** targeting + **Dittofeed** onboarding | No separate tour platform — avoids overlap with flags + engagement. |

## Adtech (the ad-ROI layer you called out)

Goal: attribute users and revenue across paid channels (Google, Meta, TikTok, etc.) and measure ROAS.
- **Install / deep-link attribution:** OpenAttribution (OSS, young — watch-item) or Branch (free tier) for deferred deep links + SKAdNetwork/Privacy-Sandbox handling. Deep links also power referrals + shared restaurant links.
- **Server-side conversion tracking:** send conversions to ad platforms via their **Conversions APIs** (Google Enhanced Conversions, Meta CAPI) using **RudderStack destinations** / **Castled**, not client pixels — more accurate post-ATT/cookie-loss, and consent-gated.
- **Attribution model:** UTM + click-ID capture at entry → RudderStack identity stitch → warehouse → BI reports ROAS per channel/campaign. The MMP handles mobile-install; the warehouse handles full-funnel ROI.
- **Promo-abuse guard (adjacent, important):** paid growth + promo codes attract fraud (fake accounts, referral farming, code sharing). Velocity rules + one-promo-per-identity + device/deep-link signals. Ties to existing idempotency/`deadline_at` discipline. Not a martech tool — a rules service.

## Notifications: this plane owns MARKETING only

Two notification classes with **opposite reliability requirements** — do not conflate:

| | **Transactional** (order accepted, rider assigned, delivered, sign-in OTP) | **Marketing** (offers, journeys, re-engagement) |
|---|---|---|
| Plane | **OLTP / core system** | OLAP / this plane |
| Delivery | **Guaranteed, atomic with the business event, at-least-once + idempotent, provider-failover** | Best-effort, droppable, rate-limited |
| Consent | **Independent** (contractual/security — always sends) | **Consent-gated + suppressible** |
| Owner | **NOT this plane** → see `transactional-notifications.md` (River outbox in Postgres) | **Dittofeed** |

- **Marketing** → **Dittofeed** owns campaign/journey delivery across channels. That's this plane.
- **Transactional** → handled by the **core system's own notification service** (transactional
  outbox via **River**, atomic with the OLTP write; Postgres-backed so a Redis flush never loses
  one). It has **no dependency** on Dittofeed, the CDP, or marketing consent. Spec: `transactional-notifications.md`.
- This is exactly why **Novu is out**: it would sit in the transactional path as an external
  failure domain with weaker guarantees than an in-transaction outbox — a reliability downgrade,
  not just an overlap with Dittofeed.

## Decisions (locked)

- **Warehouse → ClickHouse** — reuse the ClickStack engine/ops, separate instance from telemetry.
  Dropped MySQL-protocol options (Doris/StarRocks) and Postgres-as-warehouse.
- **BI → Metabase** — native ClickHouse driver, low barrier for non-technical self-serve.
- **Flags → OpenFeature + GrowthBook** — GrowthBook backs flags *and* experiment stats, and can
  read experiment exposure straight from ClickHouse (nice synergy with the warehouse choice).
- **Orchestration → Kestra** · **Transform → dbt** · **Reverse ETL → Castled** · **CDP → RudderStack**
  · **Engagement → Dittofeed** · **Consent → Klaro** · **Support → Chatwoot**.
- **MMP / attribution → Branch** (free tier, mature deep-linking) for now; **OpenAttribution** a
  self-host watch-item for later.

_All v2 data-plane decisions closed._

## Phasing (all v2)

1. **Instrument + consent first** — Klaro + RudderStack SDKs + the tracking-plan contract. Nothing else works without clean, consented events.
2. **Warehouse + dbt + Kestra** — land events, model them, schedule.
3. **Activation** — Dittofeed (engagement) + Castled (reverse ETL) + GrowthBook (flags/experiments).
4. **Adtech** — attribution + server-side CAPI + ROAS reporting in BI.
5. **Support + polish** — Chatwoot, referral/loyalty engine (custom).

_Dropped on purpose: Snowplow (OSS-in-name, heavy), Novu (paywalled + overlaps Dittofeed),
all-in-one suites (PostHog) — they overlap dedicated tools we've chosen._
