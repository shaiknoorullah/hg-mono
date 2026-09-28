---
covers: []
reviewed: 2026-09-28
---

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
| S-05 | Cancellation policy | **Free before restaurant acceptance**; after acceptance, support-mediated only. *2026-09-28:* staff may cancel after acceptance **without a support case** (the case is optional, since support cases do not ship in 1.0); the reason still goes on the audit log. Small contract change, so stuck orders have a clean, audited way out from day one |
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
| R-05 | Menu approval: auto-approve at 24 h (restaurant spec) vs never auto-approve (admin spec) | **Never auto-approve claim-bearing fields.** *2026-09-28:* a menu item an admin creates is **approved on creation** (as the contract has it) and audited; the creator is the reviewer | Silence must never become consent on a halal claim. An admin creating an item is a named person's decision on the record, and staff can fix menus quickly |
| R-06 | Discount funding: platform-funded (customer spec) vs restaurant-funded (restaurant spec) | **Restaurant-funded** | Platform has no revenue line at 0% commission |
| R-07 | Service fee: 8% clamped (platform spec) vs none | **Mechanism built, set to $0.00.** *2026-09-28:* checkout shows the line as "Service fee $0.00" | Correctable by configuration, not by release. The zero line says "no fee" out loud; its meaning changes if the fee is turned on |
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
| O-03 | **SMS / A2P registration** — which provider and account sends OTP | Nobody can sign in without it. A2P 10DLC approval takes days to weeks. Check whether the existing Supabase setup already has a usable Twilio account behind it. Since 2026-09-28 customers also sign in before browsing, so nobody sees a restaurant until this is done | You — today |
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

## Settled — redesign decisions (owner, 2026-09-28)

The owner answered 45 questions from the app redesign on 2026-09-28 ([decision page](https://claude.ai/artifact/T4yne3McYSBPsERVTftcNH)), then made two layout changes the same day. Where an answer changed a row above, that row was updated instead of repeated here: staff cancel after acceptance (cancellation policy), admin-created menu items (menu approval), the $0.00 service fee line (service fee) and sign-in before browsing (SMS registration).

### Halal and trust

| Decision | Value | Why | Date |
|---|---|---|---|
| Physical tamper seals on packages | **None at launch; seals move to v1.1** ([#47](https://github.com/shaiknoorullah/hg-mono/issues/47)). Delivery proof stays a one-time code plus a photo. Seal screens and "no seal" copy come out of all four apps | Seals were already out of [the 1.0 scope (#103)](https://github.com/shaiknoorullah/hg-mono/issues/103), and there is no seal stock or printer plan | 2026-09-28 |
| Adding items when the halal panel fails to load, or the certificate record is partial | **Allowed.** No badge, and a neutral line: "Certificate details unavailable" | The server's listing is the real gate and it checks again at checkout. Showing nothing claims nothing: [a missing halal field renders no badge](../../AGENTS.md#3-non-negotiable-invariants) | 2026-09-28 |
| How old a cached halal status may be offline | **15 minutes.** Older than that, no badge | Certificates change over days, so 15 minutes is safe and still helps in short dead zones | 2026-09-28 |
| Drafted trust and halal wording: the home line naming certifier and check date, the "How we check" page, the wording for certificates rejected as suspected forgery, the admin labels for the 11 onboarding states | **Approved as drafted**, the "How we check" page included | The lines name who certified and when we checked, never a blanket claim | 2026-09-28 |
| "Expiring soon" certificate badge | **Amber tint, in every app.** The halal badge component is fixed to match | One rule everywhere; renewal is most of the admin work on these certificates. Amber, not red: [red is never used for a halal state](../../AGENTS.md#3-non-negotiable-invariants) | 2026-09-28 |
| Certificate renewal reminders to restaurants | **30, 14, 7 and 1 days** before expiry | A lapsed certificate removes the listing, so the last-day reminder is worth sending | 2026-09-28 |
| Certificate on the customer's restaurant page *(layout change)* | **A compact halal badge and a "View certification" link button** near the restaurant name. The button opens the details (certifier, number, scope, dates, disclaimer, certificate) in a bottom sheet. The menu moves up. No halal data means no badge and no button. The expired or expiring state shows on the compact badge itself | Frees the space above the menu while keeping every halal rule. Replaces the inline certification panel above the menu | 2026-09-28 |

### Customer app

| Decision | Value | Why | Date |
|---|---|---|---|
| Support channel at launch | **Phone line during set hours only.** Outside hours, screens show the hours and the self-serve actions (cancel before acceptance, report a problem) | Closes every dead end without promising 24/7 staffing; the contract already supports it | 2026-09-28 |
| Dark theme | **Customer and rider apps follow the phone's setting; restaurant web is light-only** | Owner's choice. Every customer screen now needs a dark pass, and the dark halal colours must be published first ([theming model](../design/01-foundations.md#10-theming-model)) | 2026-09-28 |
| Bottom navigation | **Home · Search · Orders · Account.** The alerts bell stays hidden until Alerts ships | Search gets its own entry point; no empty tab or dead icon at launch | 2026-09-28 |
| Browsing before sign-in | **No: sign in first**, as the contract has it | No API work before launch. Nobody sees restaurants until sign-in codes work (see SMS registration above) | 2026-09-28 |
| Setting a location (restaurant onboarding and customer addresses) | **Both together:** type into a map search, then drag the pin for precision. Brings the map picker ([#150](https://github.com/shaiknoorullah/hg-mono/issues/150)) into 1.0 | Owner's words: "can type in to map search and manually drag pins for precision". A denied location permission no longer blocks the address form. Needs a map component and contract work | 2026-09-28 |
| What the customer sees during the restaurant's 180-second reply window | **A neutral progress bar and the time:** "Restaurant replies by 7:42 pm" | Sets expectations without pressure the customer cannot act on; no red countdown | 2026-09-28 |
| Discover home layout | **A combination** of vertical sections of compact cards and horizontal rows | Owner's answer: "Combinations". Horizontal rows need a carousel, which the design-system row below defers, so the split between the two is still to be drawn | 2026-09-28 |
| Stars on a review that moderation removes | **Removed with the text** | Removal is for abuse or bad faith; the rating is part of that | 2026-09-28 |
| Marketing consent before the email is confirmed | **Record the consent; send nothing until the email is confirmed.** Settles the Canadian anti-spam (CASL) consent item | Keeps sign-up short and sends nothing to an unproven address | 2026-09-28 |
| Address privacy note | **Add the restaurant line:** the restaurant sees the address once it starts preparing | A partial note reads as a promise that nobody else sees the address | 2026-09-28 |
| Placing a second order while one is active | **One active order at a time for 1.0** | Rare at launch and costly to design well | 2026-09-28 |

### Rider app

| Decision | Value | Why | Date |
|---|---|---|---|
| Tip shown to riders before they accept an offer | **Shown**, as the contract does today. Settles [#93](https://github.com/shaiknoorullah/hg-mono/issues/93) | Riders are paid by pure pass-through, so seeing the real pay is fair; no change needed | 2026-09-28 |
| Rider primary button colour | **Brand orange with the dark label (4.63:1).** The rider 7:1 rule covers body text, not large bold button labels | Large bold labels clear [the contrast target](../design/04-accessibility.md#11-targets) comfortably; no second button system | 2026-09-28 |
| Partner whose Stripe payouts are restricted (riders and restaurants) | **Keeps taking offers and orders.** Earnings build up and pay out once Stripe is fixed; a banner asks the partner to fix it | No lost trade; matches the contract, and the ledger already holds balances owed | 2026-09-28 |
| Rider suspended or deactivated, or a replacement document rejected | **Finish the current delivery; earned money is always paid; offline for new offers only** | The customer's food still arrives, and riders are paid for work done | 2026-09-28 |
| Rejecting one rider document | **Only the application decision notifies the rider** (request changes or reject) | One message per review, with the full list of what to fix | 2026-09-28 |
| Rider cannot hand over and the customer chose "leave at door" | **Photo plus attestation allowed** | The customer already agreed to an unattended drop-off | 2026-09-28 |
| Reversed earnings | **Original line plus a correction line that takes the money back**, as the spec has it | Money on screen matches the append-only ledger, which avoids disputes | 2026-09-28 |
| Map pins in dark mode | **New dark-mode pin tokens:** a lighter step with a light outline | The forest-green pins are nearly invisible on a dark map, and the map is the rider's main screen at night | 2026-09-28 |
| Rider navigation | **Three tabs:** Home, Earnings (with a Deliveries view), Account | No history tab without an API behind it | 2026-09-28 |

### Restaurant

| Decision | Value | Why | Date |
|---|---|---|---|
| How a new order appears | ~~A pinned "New" column on the board~~ **Superseded the same day** by the desktop working layout below: no board, a live new-order strip instead | The owner changed the whole desktop layout after answering | 2026-09-28 |
| How long the new-order sound plays | **Until the order is accepted, rejected or expires** | A missed order is voided and lost; the sound stops as soon as someone acts | 2026-09-28 |
| Staff accounts | **Owner only at launch.** The Staff screen is hidden | Owner's choice; kitchens share one login on the tablet until staff invites ship | 2026-09-28 |
| One login for several restaurants | **One restaurant per login at launch.** Settles the multi-location accounts item | No API selects the active restaurant, and few launch restaurants have several sites | 2026-09-28 |
| Two-factor recovery codes (restaurant and admin) | **Stop issuing them.** A lost authenticator is reset by an admin after an identity check | Codes nobody can sign in with are worse than none; no API change | 2026-09-28 |
| Menu drafts | **Dropped for 1.0.** Every save goes straight to review | Nothing in the contract supports drafts, and review already gates what goes live | 2026-09-28 |
| Setting item availability | **A switch; turning it off opens a "for how long" menu** | "Out of this now" stays one tap | 2026-09-28 |
| Pausing on late nights | **Add "until closing"** (an API change) | "Until 23:59" quietly reopens a kitchen that is open past midnight | 2026-09-28 |
| Customer's masked phone number before accepting | **Hidden until accept**, enforced by the server, not only hidden on screen | Stricter privacy; the restaurant has no reason to call before accepting | 2026-09-28 |
| Document review time quoted to restaurants | **"Within 3 business days"** | A clear promise cuts support contact during onboarding; staff must meet it | 2026-09-28 |
| Liability insurance upload | **Hidden until V2**, as the spec has it | Nothing uses it at launch | 2026-09-28 |

### Admin

| Decision | Value | Why | Date |
|---|---|---|---|
| Goodwill refund that needs a second approver | **Above CAD 50, for every role** (the contract's figure) | At 0% commission every goodwill dollar is platform money; the limit can be raised later | 2026-09-28 |
| Dates in admin table cells | **Short form in cells; the full date in the tooltip and detail views** | Dense tables stay readable; the full date is one hover away | 2026-09-28 |
| Platform on-call contact | **Name a person and a phone number now**, and link the incident runbook ([#66](https://github.com/shaiknoorullah/hg-mono/issues/66)) from the system page | An outage in launch week needs an escalation path on the page staff open | 2026-09-28 |
| Warning above 25 active staff accounts | **No warning at launch** | Staff numbers will stay small for months | 2026-09-28 |

### Design system and desktop layout

| Decision | Value | Why | Date |
|---|---|---|---|
| New design-system components | **Add `StatCard`, `KeyValueList`, `FileDrop` and `SideNav` now.** Defer `BarChart` and `Carousel` | They repeat across apps; charts have no data until the time-series API ([#152](https://github.com/shaiknoorullah/hg-mono/issues/152)) | 2026-09-28 |
| Desktop working pages, restaurant and admin *(layout change)* | **The page fits the screen and never scrolls;** long lists scroll inside their own region. **No overlay sheets or modals for working tasks:** detail opens in panels on the page that collapse when not needed. **Collapsible sidebars.** **Overview, then detail, then more detail, as side-by-side panes** (list, order, timeline). Restaurant: **no column board;** a live strip in the header or footer lists every order awaiting acceptance with its countdown. Arrow keys move, one key accepts, one key rejects; reject still asks for a reason; a stray key press cannot accept an order that is not focused. Admin: the same panes for queues, verification, orders and refunds; the verification console shows the application, the certificate and the seven checks together. New components: split panels that can be resized, collapsible sidebar, detail panel ([#109](https://github.com/shaiknoorullah/hg-mono/issues/109)) | Owner's layout change: dense working screens where nothing moves and nothing covers the work | 2026-09-28 |

## Open — non-blocking

Shipping on defaults; revisit when convenient.

Rider background checks · insurance commercial-use requirement · surge model · contractor tax handling (T4A) · performance enforcement thresholds · SOS/rider safety · scheduled orders · impersonation policy · data retention beyond the 7-year financial minimum.

Tip visibility before accept, multi-location restaurant accounts and CASL marketing consent were settled on 2026-09-28: see [the redesign decisions](#settled--redesign-decisions-owner-2026-09-28).

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
