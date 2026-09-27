# Decision log

The five domain specs surfaced **141 decisions**. Most shipped with a written default and need no action. This log records the ones that were actively decided, the conflicts that were reconciled, and the handful still open.

Format: a decision is *settled* when it is implementable without further input.

---

## Settled — client decisions

| # | Decision | Value |
|---|---|---|
| S-01 | Platform commission at launch | **0%**, per-restaurant field retained and switchable |
| S-02 | Delivery fee | **$2.99 base + $1.00/km**, charged to customer |
| S-03 | Delivery fee recipient | **100% to rider** |
| S-04 | Payout cadence | **Weekly, Monday, automatic, no minimum**, Stripe Connect |
| S-05 | Cancellation policy | **Free before restaurant acceptance**; after acceptance, support-mediated only |
| S-06 | Client app shape | **Three separate apps** — customer (Expo), rider (Expo), restaurant (web) — plus admin web |
| S-07 | Authentication location | **In the binary.** No external auth server |
| S-08 | Auth method by role | Customers + riders: **phone OTP**. Restaurants + admins: **email + password** |
| S-09 | Infrastructure | Traefik + Go binary + Postgres + **Redis** + **MinIO** |
| S-10 | Launch target | **Live, taking real orders** |
| S-11 | Accepted halal certifying bodies *(was O-02)* | **HMA Canada · HFSAA · ISNA Canada.** A certificate from **any one** of these satisfies check `H2_ISSUER_ACCEPTED`. Seeded registry — extensible at runtime by a super admin, not a closed set. Seeded in `services/hg/migrations/seed/002_halal_issuing_bodies.sql` (authoritative for the running system) and generated as the `halal_issuing_bodies_seed` fixture by `contracts/fixtures/_build/dom_onboarding.py` |

## Settled — reconciliations

Where two specs disagreed, or a spec default contradicted a client decision.

| # | Conflict | Resolution | Rationale |
|---|---|---|---|
| R-01 | Commission: platform spec 20%, restaurant 18%, admin 15% | **0%** | Client decision overrides all three |
| R-02 | Rider pay: independent rate card ($3.50 + $0.80/km, $6.00 floor) vs delivery-fee pass-through | **Pure pass-through** | The rate card loses money on every short trip at 0% commission |
| R-03 | Payout minimum: CAD 25 (restaurant), CAD 10 (rider) | **No minimum** | Client decision |
| R-04 | Acceptance window: 300 s (customer spec) vs 180 s (restaurant + platform) | **180 s** | Faster failure is better for a waiting customer; a voided auth costs nothing |
| R-05 | Menu approval: auto-approve at 24 h (restaurant spec) vs never auto-approve (admin spec) | **Never auto-approve claim-bearing fields** | Silence must never become consent on a halal claim |
| R-06 | Discount funding: platform-funded (customer spec) vs restaurant-funded (restaurant spec) | **Restaurant-funded** | Platform has no revenue line at 0% commission |
| R-07 | Service fee: 8% clamped (platform spec) vs none | **Mechanism built, set to $0.00** | Correctable by configuration, not by release |
| R-08 | FSSAI certificate (SOW) | **Replaced** with business licence, halal certificate, provincial food-safety permit, owner ID; CRA business number replaces GSTIN | FSSAI is the Indian regulator and has no Canadian meaning |
| R-09 | Rider wait-time pay and cancellation compensation | **Deferred to V1**, funded by the service fee when enabled | No funding source under pass-through |
| R-11 | `halal_checklist_version`: `05-admin.md` and the contract say **1**, fixtures said **3** | **1** | Greenfield system — there have been no prior checklist versions. Fixtures corrected at the generator |
| R-10 | Repository name | **`hg-mono`** | Unambiguous against `hg-api`, `halal-goes`, `hg-docker` |
| R-12 | `TestConformance_Reachability` drift notes for `getOrder` (documented as 403, "order.read not granted to CUSTOMER") and `getCustomerProfile` (documented as 405, "only PATCH registered") | **Stale comments, not live drift.** `order.read` has been in the `CUSTOMER` grant set (`internal/auth/matrix.go`) since it was written, and `GET /v1/me/profile` is registered alongside `PATCH`. Both routes return live `200` bodies that validate against the contract; the harness's own reachability test already logs `HTTP 200` on both and self-documents it as fixed ("note: … now returns 200"). Widening the contract was unnecessary — the handlers already conform | Verified by running the harness against a seeded DB, not by re-reading the comments |
| R-13 | C-38 (reviews/ratings submission) scope for the `getOrderRating`/`submitOrderRating` contract addition | **Food + rider targets only, in this pass.** Dish-level ratings (`food_item_rating_reviews`) are a separate per-line-item resource the spec itself marks V2/size M; adding them here would mean a third nested array shape, a third moderation surface and a third aggregate (`food_items.rating_avg`) with no seeded per-dish fixture data to validate against. Restaurant + rider ratings cover the two aggregates (`restaurants.rating_avg`, `riders.rating_avg`) already read elsewhere in the contract (`RestaurantSummary`, `RiderPublicProfile`) | Dish ratings tracked as a follow-up; `OrderRatingInput`/`OrderRating` are additive shapes so a `dishes` array can be appended without a breaking change |

## Open — blocking

Cannot proceed on engineering judgement. *(O-02 resolved — see S-11.)*

| # | Decision | Why it blocks | Owner |
|---|---|---|---|
| O-01 | **HST registration number + supplier position** — is the platform the deemed supplier for non-registrant restaurants, or does each restaurant remain supplier of record? | No legal basis to charge tax. Affects every invoice and payout | Client's accountant |
| O-03 | **SMS / A2P registration** — which provider and account sends OTP | Nobody can sign in without it. A2P 10DLC approval takes days to weeks. Check whether the existing Supabase setup already has a usable Twilio account behind it | You — today |
| O-04 | **Refund liability allocation** — who absorbs each refund reason code | Determines ledger postings and partner balances | You |
| O-05 | **Launch province(s)** | Gates tax rates and address validation. Default: Ontario only | You |
| O-06 | **Self-declared halal restaurants** — list behind an explicit filter, or hide entirely? | Product-defining. Default: hide entirely | You |


## Settled — launch decisions (Sep 2026, client-confirmed at rc1)

| # | Decision | Value | Code state |
|---|---|---|---|
| O-05 | **Launch province(s)** | **Ontario only** (13% HST) | Default — no change. `HG_TAX_HST_REGISTRATION_NUMBER=728591827RT0001` set in `deploy/.env` (gitignored). |
| O-04 | **Refund liability allocation** | **By-fault, per reason code** | **Already coded** in `payments.ComputeLiabilitySplit`: item-missing/wrong & food-quality/safety/halal → restaurant; never-delivered → rider earnings reversed + platform; restaurant-rejected → restaurant; late/no-rider/changed-mind/goodwill/platform-error → platform; unknown → platform (fail-safe). Ledger balances by construction. |
| O-06 | **Self-declared (uncertified) halal restaurants** | **Hide entirely** (the coded default) | No change — the discovery predicate already excludes everything but CERTIFIED/EXPIRING_SOON; there is no `SELF_DECLARED` on the wire. |

_O-06 note: filter-gated "show behind an opt-in filter" was considered and **declined** — it would
soften the core promise ("every listing is one we vouched for") and requires a new listing state +
contract change + customer-app filter UI. Kept the strongest, already-coded default: only
admin-verified certified restaurants ever appear. Can be revisited post-launch if supply demands it._

## Open — non-blocking

Shipping on defaults; revisit when convenient.

Rider background checks · insurance commercial-use requirement · surge model · tip visibility before accept · contractor tax handling (T4A) · performance enforcement thresholds · SOS/rider safety · scheduled orders · multi-location restaurant accounts · impersonation policy · CASL marketing consent · data retention beyond the 7-year financial minimum.

---

## Decisions deliberately not required

Closed without client input because the SOW's own wording or the product premise determines the answer. Recorded so they are not reopened: halal is a **precondition for listing**, not a filter; reviews are **order-bound** with authorship from the session, never the request body; the amount displayed is the amount charged; a missing halal field renders **no badge**.

---

## Standalone entries

Decisions too long for a table row live in their own file beside this one.

| File | Subject | Status |
|---|---|---|
| [`palette-and-invariant-10.md`](palette-and-invariant-10.md) | Old-brand green palette; amendment separating green-as-chrome from green-as-verified-signal | **Settled**, client-confirmed |
| [`halal-slaughter-method.md`](halal-slaughter-method.md) | Slaughter-method position | **Settled** |
| [`hero-motion-and-the-creative-direction.md`](hero-motion-and-the-creative-direction.md) | Marketing hero: amends `docs/design/landing-creative-direction.md` §7 for `/` to permit scroll-driven sequences and Lenis. The seal-motion ban is **not** amended. Carries five owed conditions, chief of which is a rendered-pixel check for L-4 — lint cannot see inside a canvas | **Settled**, client-instructed · 5 conditions owed |
| [`focus-indicator.md`](focus-indicator.md) | One focus indicator in the theme colour: bordered fields focus with their own 2px `border.brand` border (no ring, no glow); borderless controls keep the two-layer ring, now brand instead of `info` blue. Amends `04-accessibility.md` §4.1 and `02-components.md` rule 3 | **Settled**, owner-confirmed |
