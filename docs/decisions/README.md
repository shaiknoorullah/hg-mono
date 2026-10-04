---
covers: []
reviewed: 2026-10-01
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
| S-09 | Infrastructure | Traefik + Go binary + Postgres + **Redis** + **MinIO** (object storage is now Silo, its maintained fork: see [platform decisions](#settled--platform-decisions-owner-2026-10-01)) |
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

## Settled — redesign decisions, round 2 (owner, 2026-10-01)

The owner answered 42 questions from the second round of the app redesign on 2026-10-01. Three answers differ from the recommended option, and their rows say so: how a rider confirms pickup, how restaurants manage their menu, and the rows on the Discover home. Some answers narrow or extend a row from [round 1](#settled--redesign-decisions-owner-2026-09-28); where the two differ, the row here wins. "Launch" means what release 1.0 builds ([#103](https://github.com/shaiknoorullah/hg-mono/issues/103)); "later version" means the contract's V1 tier. Contract work for these answers: [#182](https://github.com/shaiknoorullah/hg-mono/issues/182) (later-version operations needed at launch), [#183](https://github.com/shaiknoorullah/hg-mono/issues/183) and [#184](https://github.com/shaiknoorullah/hg-mono/issues/184) (contract behaviour).

### Launch scope and contract

| Decision | Value | Why | Date |
|---|---|---|---|
| Later-version operations that launch screens depend on | **Seven move to launch:** marking an item out of stock; forgot password and reset; changing your own password; two-step sign-in enrolment for staff; the staff list and staff invites; sign out everywhere; restaurant payout history. **One new launch operation:** an admin updates or removes a menu item on a restaurant's behalf. **These stay later-version:** turning two-step sign-in off; listing and ending single sessions (the "My sessions" screen is hidden); dependency status (the System page uses the readiness check); the in-app inbox (the bell is hidden); restaurant staff. The restaurant "Account security" screen stays hidden. Restaurant menu editing and the menu review queue also move to launch: see the menu row below | Closes every gap that breaks launch: kitchens can mark a dish sold out, staff can enrol in the two-step sign-in the platform requires, nobody needs an engineer to unlock an account or add staff, and restaurants can see their payouts. Costs backend work on sign-in, staff and payouts before launch | 2026-10-01 |
| How restaurants get their menu onto HalalGoes and change it | **Restaurants edit their own menu from launch, and the menu review queue moves to launch with it:** creating and updating items and categories, and the queue where staff decide on a menu version. Every save still goes to review; items an admin creates are still approved on creation. Menu editing while suspended is undecided: [#205](https://github.com/shaiknoorullah/hg-mono/issues/205). *Owner's choice:* the recommended option was a menu file or photo at onboarding, changes sent by email, and admins entering them | Restaurants are self-serve from day one. It is the largest backend and admin addition in this round | 2026-10-01 |
| Where map address search comes from: typing to search, filling the fields from the pin, turning a pin into an address | **Our API, which forwards to Mapbox:** three new launch operations. Mapbox keys: [#57](https://github.com/shaiknoorullah/hg-mono/issues/57). Mapbox is an approved exception to the self-hosted rule ([platform decisions](#settled--platform-decisions-owner-2026-10-01)) | One place to rate-limit, cache and swap providers; the secret key stays on the server; the server already checks addresses against delivery zones | 2026-10-01 |
| Account deletion | **Stays later-version, but ships before the store release** ([#67](https://github.com/shaiknoorullah/hg-mono/issues/67)). At launch, staff delete an account by hand on request by phone or email. The proposed retention periods and the in-app deletion flow are not settled by this answer | No launch contract work, and the stores' in-app deletion requirement is still met in time. Deletion is manual for the first weeks | 2026-10-01 |

### Halal and trust

| Decision | Value | Why | Date |
|---|---|---|---|
| A restaurant's description and the name customers see | **Changed through a request that HalalGoes reviews,** like legal name and address. No instant save | Both are free text on the customer's restaurant page and can carry a halal claim. A field that can carry a claim is never approved automatically, so the halal-claim gate stays closed. Slower for restaurants | 2026-10-01 |
| A certifying body that is not on the accepted list | **The reviewer releases their claim and marks the application "waiting on certifying body".** It leaves the queue until a super admin decides on the body, then returns at the top. The contract gains the waiting state and a release action | The restaurant is not rejected for a gap on HalalGoes's side, and the review is not wasted | 2026-10-01 |
| Who pays when staff refund a halal complaint | **The restaurant pays the item's net price only when the complaint is substantiated;** otherwise the refund is goodwill paid by the platform. Staff file it as a "halal concern" with evidence; the refund form and the contract gain that reason. Narrows the [refund liability row](#settled--launch-decisions-sep-2026-client-confirmed-at-rc1) | Fair to restaurants, and it discourages false complaints | 2026-10-01 |
| A document suspected to be forged | **The reviewer records the matching check (one of the seven) as Fail with a forgery note, and releases the claim.** During a suspected-forgery hold only a super admin decides; the reviewer's screen is read-only | Every rejection still traces to a failed check, and forgery decisions sit with the most senior role | 2026-10-01 |
| Label on the amber "expiring soon" badge | **"Halal certified" plus the expiry date:** "Halal certified · expires 20 Oct" | The certificate is still valid, so the label stays; the date says why the badge is amber | 2026-10-01 |

### Orders and delivery

| Decision | Value | Why | Date |
|---|---|---|---|
| How a rider confirms pickup, with no tamper seals | **The kitchen reads a short code to the rider, who types it in.** The restaurant screen shows the code, the contract gains a field for it, and the seal-scan requirement comes out of the contract. *Owner's choice:* the recommended option was the rider tapping "Picked up" at the restaurant, location-checked | Proves the rider and the kitchen were both there. Today no order can be picked up without a seal scan | 2026-10-01 |
| How a customer who meets the rider proves the handover | **The customer's order view and tracking screen show the 4-digit delivery code,** with a push when the rider arrives. The rider is still never shown it. One new field in the contract | Without it, every handover at the door or in a lobby falls through to the locked-code fallback | 2026-10-01 |
| The customer's address on a rider's offer | **Approximate area before accepting; the full address once accepted.** Contract, copy and the approved privacy wording change | Better privacy for customers; riders still see distance and direction | 2026-10-01 |
| "Leave at door" when the rider can't hand over | **No wait: photo and statement straight away.** The 5-minute wait the canvas added comes out, and the proof-of-delivery endpoint accepts a statement where only a photo was required | The customer already asked for the door | 2026-10-01 |
| A rider suspended mid-delivery | **Operations may still reassign the delivery to another rider.** The copy keeps "unless HalalGoes contacts you" | Covers suspensions for safety reasons | 2026-10-01 |
| A new order while the only active one is under review after a problem report | **Allowed:** an order under review does not count as active. A server rule change only; narrows "one active order at a time" | Review can take up to 48 hours, and the customer still needs dinner | 2026-10-01 |
| Reporting a problem before delivery | **"Get help" opens from the restaurant's acceptance,** with reasons that fit before delivery: very late, wrong address, want to cancel | Matches the contract's refund-request rules and cuts calls. The pre-delivery reasons need design | 2026-10-01 |
| The cart after an unpaid order is cancelled, expires or fails payment | **Offer "Put these items back in your cart".** The app re-adds the items with the existing cart operations, and [the server prices them again](../../AGENTS.md#3-non-negotiable-invariants) | No contract change, and one tap to retry | 2026-10-01 |

### Customer app

| Decision | Value | Why | Date |
|---|---|---|---|
| How the app knows the support phone line is closed | **The server turns support off outside the hours; the app shows the hours text.** The Call button disappears while the line is closed | No contract change: the existing support on/off switch does the work | 2026-10-01 |
| Horizontal rows on the Discover home | **Two at launch:** "Open now, closest first", plus a second row such as "Quickest delivery", which needs a new sort on the restaurant list. "Order again" and "Trending" wait for the sectioned home feed ([#157](https://github.com/shaiknoorullah/hg-mono/issues/157)). *Owner's choice:* the recommended option was one row | A richer home | 2026-10-01 |

### Rider app

| Decision | Value | Why | Date |
|---|---|---|---|
| Which partners keep working while Stripe restricts payouts | **Only partners whose payout account worked before.** New riders and restaurants still finish Stripe setup before their first order. The contract tells "never set up" apart from "later restricted"; the contract, the rider spec and the rider Home screen change to let a restricted partner keep working. Narrows the round-1 rule | Every active partner has a verified identity and bank account | 2026-10-01 |
| When a held payout is released | **On the next Monday payout,** not straight away | One payout run to build and reconcile. A rider may wait up to a week after fixing their account | 2026-10-01 |
| A rider whose balance stays below zero for a long time | **No automatic block at launch;** operations follow up by hand. The app says nothing new | Nothing new to build or explain; a few riders may owe money for a while | 2026-10-01 |
| A replacement document turned down while the current one is still valid | **The rider keeps riding until the current document expires,** and is asked for a new upload. Narrows the round-1 suspension rule for this case | No income lost over a bad photo; the expiry date still takes them offline | 2026-10-01 |
| Notifying a paused rider who is reinstated | **Reinstatement sends a notification,** like an application decision | The rider knows at once they can go back online and earn | 2026-10-01 |
| Asking for changes after a rider's third resubmission | **No: after three, approve or reject only** | Enforces the limit the rider was told about | 2026-10-01 |

### Restaurant

| Decision | Value | Why | Date |
|---|---|---|---|
| Devices for the restaurant app at launch | **Desktop, and landscape tablets from 1024×768 up.** No portrait or phone layouts. Menu & Hours needs one tablet pass | Designing to 1024×768 also covers larger tablets | 2026-10-01 |
| Where the live strip of new orders sits | **In the header, directly under the app bar,** on every restaurant page. Settles the header-or-footer choice from round 1 | Seen first, where the eye starts; it pushes page content down a little | 2026-10-01 |
| Changing the GST/HST number | **Reviewed, like legal name and address** | The number prints on customer receipts, so a wrong or fake one never reaches them. Restaurants wait for the check | 2026-10-01 |
| "Mark ready" button colour | **Forest green;** brand orange only ever means "accept a new order". Forest is the brand chrome colour, not the halal seal green ([palette decision](palette-and-invariant-10.md)) | On the kitchen screen, accept and mark ready looked the same at a glance | 2026-10-01 |
| Optional note when accepting an order | **Removed at launch** | Accept stays one tap. No view returns the note, so nobody reads it today | 2026-10-01 |
| "For how long" options for out-of-stock items and pauses | **Item: default "until closing". Pause: "until closing" replaces "rest of today"** | Fewer, clearer choices that follow each restaurant's own hours, late nights included | 2026-10-01 |
| Opening hours while suspended | **Editable while suspended; read-only once deactivated.** The menu: [#205](https://github.com/shaiknoorullah/hg-mono/issues/205) | The restaurant is ready the moment it is reinstated | 2026-10-01 |

### Admin

| Decision | Value | Why | Date |
|---|---|---|---|
| Who resets a password or two-step sign-in by hand, and the identity check | **Super admins only.** First they call back on the phone number on file and match two account details. Needs an admin reset operation; until then, engineers reset it in the database | Tight control and a clear audit trail. One super admin can become a bottleneck | 2026-10-01 |
| What support agents see | **Failed refunds: all of them. Rider applications: only through a support case;** the contract narrows the queue listing | Chasing failed refunds is support's job; identity documents stay need-to-know | 2026-10-01 |
| Staff session length | **30 minutes idle and 12 hours in total, for all staff** | Staff issue refunds, approve certificates and read identity documents. Strict and simple: staff sign in again after a break and every shift | 2026-10-01 |
| A failed text-message sender check | **A sticky banner on every admin page until fixed;** the banner priority rules change to fit it | Without sign-in codes nobody new can sign in, so every admin needs to see it at once | 2026-10-01 |
| Admin dark theme | **Light only for release 1.0.** The dark admin boards and their design-system blockers come out | Staff use desktops, mostly in office hours | 2026-10-01 |
| Opening an order from the Orders grid | **The three-pane workspace, as drawn:** list, order, timeline | Matches the side-by-side panes rule. Fewer grid columns show while an order is open | 2026-10-01 |
| Steps for a reconciliation exception on the System page | **Approved as drafted:** open the order; follow the runbook before changing anything; call on-call if the customer was overcharged or the order can't be matched. The same steps go into the incident runbook ([#66](https://github.com/shaiknoorullah/hg-mono/issues/66)) | Ships now, and the runbook and the screen agree | 2026-10-01 |
| System page and banners for support agents | **A support version** that says what customers see and what to tell them | Support agents take the customer calls during an outage and answer consistently. A few more copy variants | 2026-10-01 |

### Every app

| Decision | Value | Why | Date |
|---|---|---|---|
| Time format | **12-hour everywhere** ("7:42 pm"), through one shared formatter. Copy with 24-hour times, like the restaurant's "until 23:59", changes | Everyday use in Ontario, and the owner's own example | 2026-10-01 |
| "What's new" on a new device, with no record of what the person last saw | **Only the latest release's notes;** older notes stay in the history | Short and relevant | 2026-10-01 |

## Settled — platform decisions (owner, 2026-10-01)

How HalalGoes is built and hosted.

| Decision | Value | Why | Date |
|---|---|---|---|
| Email | **Templates are built with [React Email](https://react.email). Mail is delivered through [Resend](https://resend.com)**, on HalalGoes's Resend accounts. This replaces Postmark or SES. The rest of the design holds: one provider behind the `EmailSender` interface, a sending subdomain with SPF, DKIM and DMARC, and retries then dead-letter ([SMS and email spec](../spec/01-platform.md#p-26--sms-and-email)). Sending real email: [#59](https://github.com/shaiknoorullah/hg-mono/issues/59) | React Email is open source, and Resend's deliverability is hard to match with a self-hosted mail server | 2026-10-01 |
| Self-hosted and open source | **Every HalalGoes system runs self-hosted on open-source software, with no SaaS:** the marketing site, geocoding and routing, object storage, analytics, the customer data platform and engagement, feature flags, telemetry and error tracking. **Exceptions:** email delivery through Resend (the row above); **maps through Mapbox** (approved by the owner on 2026-10-01): map tiles come from Mapbox, and address search, place details and reverse geocoding go through our API, which forwards to Mapbox ([map address search](#settled--redesign-decisions-round-2-owner-2026-10-01)); and services that cannot be self-hosted by nature: card payments (Stripe), mobile push delivery (Apple and Google push services), SMS carriers (Twilio Verify) and the app stores. Hosted services the docs still name: [#199](https://github.com/shaiknoorullah/hg-mono/issues/199) | The owner's choice to own the stack. Mapbox is an exception the owner approved; forwarding search through our API keeps the secret key on the server | 2026-10-01 |
| Object storage | **[pgsty/silo](https://github.com/pgsty/silo), the maintained open-source (AGPL) fork of MinIO, replaces the pinned MinIO release.** The pinned MinIO images can no longer be pulled: [#202](https://github.com/shaiknoorullah/hg-mono/issues/202). Silo keeps MinIO's configuration, S3 API and on-disk format, ships the full admin console, and gets security fixes. Pin a Silo release by digest, in a registry HalalGoes controls; [the compose file](../../deploy/docker-compose.yml) runs the old MinIO pin until [#202](https://github.com/shaiknoorullah/hg-mono/issues/202) lands. **The console and the S3 API are still never exposed to the public internet:** reach the console only over SSH or a VPN; keep the S3 endpoint inside the Docker network, or behind Traefik with presigned URLs only; keep buckets private. Today the compose file publishes both ports and the media bucket is public-read: [#200](https://github.com/shaiknoorullah/hg-mono/issues/200). The API signs every presigned link with the root user, and uploads are signed on the host only; least-privilege keys and fully signed upload links: [#203](https://github.com/shaiknoorullah/hg-mono/issues/203) | The owner's choice. It replaces the MinIO pin recorded earlier the same day: the images are gone and upstream MinIO is archived, while Silo is a drop-in, maintained fork with the complete console | 2026-10-01 |

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
