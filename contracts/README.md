# `contracts/` — the single source of truth for every API shape

Two files define the entire wire surface of HalalGoes:

| File | What it defines |
|---|---|
| `openapi.yaml` | OpenAPI 3.1. Every HTTP operation, request, response, enum and error. |
| `websocket.md` | The realtime surface: ticket handshake, channels, envelope, event catalogue, per-role projections, replay. |

Everything else — the Go server's handler signatures, the four frontends' API clients, the
fixtures, the mocks — is **generated from or validated against** these two files.

---

## The rule

> **`contracts/` is the source of truth. Hand-edited clients are forbidden.**

Concretely:

1. **No frontend may declare its own request or response type.** If a type is not in the
   generated client, the endpoint does not exist. This is the mechanism that kills the
   ghost-endpoint class — frontends calling routes nobody implemented — that the previous system
   had at scale.
2. **No handler may accept a field that is not in the contract.** The decoder runs with
   `DisallowUnknownFields`; an unknown field is a `422`, not a silent drop. That is what catches
   `is_accepting` against `is_accepting_orders` at the boundary, instead of returning a cheerful
   200 over an unchanged row.
3. **Contract changes come first.** Edit `openapi.yaml`, regenerate, then write the code. A CI
   drift check compares the committed contract against the one generated from the route registry
   and fails the build on any difference.
4. **Generated output is never edited.** `apps/*/src/api/generated/**` and
   `services/*/internal/http/gen/**` carry a "do not edit" header and are checked by a CI hook
   that fails on a manual diff. If the generated client is wrong, the contract is wrong.
5. **Deleting a field is a breaking change.** Add first, migrate consumers, delete later. For
   realtime payloads, bump the envelope's `v` and keep emitting the old version through the
   deprecation window.

---

## Regenerating clients

```bash
# 0. Validate. Must pass before anything is generated.
pnpm validate:contract     # YAML parse + $ref resolution + operationId/x-roles/x-version
                           # + money and mass-assignment invariants + ErrorCode casing
                           # + YAML-1.1 truthy scalars + unsatisfiable allOf

# 1. The TypeScript client the four frontends share
pnpm generate              # → packages/api-client/src/generated/openapi.d.ts
pnpm generate:check        # regenerate, then `git diff --exit-code` — the drift gate

# 2. Fixtures, and the proof they still match the contract
pnpm fixtures:build        # → contracts/fixtures/**  (deterministic; diffable)
pnpm validate:fixtures     # every fixture against its named schema

# 3. Everything CI runs
pnpm check

# Not yet built (no Go service exists):
make contracts-gen-go       # oapi-codegen (strict-server, chi) → services/hg/internal/http/gen/
make contracts-gen-realtime # from GET /v1/realtime/schema's committed snapshot
```

Under the hood:

| Command | Tool | Notes |
|---|---|---|
| `pnpm validate:contract` | `tools/contract-tools/src/validate-contract.ts` | Enforces every invariant in §"What CI enforces" below. |
| `pnpm generate` | `openapi-typescript` + `openapi-fetch` | Types only plus a thin typed fetch wrapper — no heavyweight runtime, no hand-written wrapper layer. See `packages/api-client/README.md` for why. |
| `pnpm fixtures:build` | `contracts/fixtures/_build/build.py` | Walks the real schemas and fills them in; nothing is typed against a remembered field list. |
| `pnpm validate:fixtures` | Ajv 2020-12 over the OpenAPI 3.1 document | 3.1 schemas *are* JSON Schema 2020-12, so no translation step. |
| `contracts-gen-go` | `oapi-codegen` (`strict-server`, `chi`) | Produces server interfaces the router must satisfy, so an unimplemented operation is a compile error. |
| `contracts-gen-realtime` | `json-schema-to-typescript` / `go-jsonschema` | Consumes the JSON-Schema bundle served by `getRealtimeSchema`. Until it exists, `packages/api-client/src/realtime.ts` is the one hand-maintained shim. |

**Frontend agents working against a contract with no backend running:** everything you need is
already built.

```bash
pnpm install
pnpm generate        # TypeScript client → packages/api-client/src/generated/
pnpm mock            # the whole API at http://localhost:4010, no backend
```

`packages/api-client` is the generated client plus the money helpers; **it is the only place a
frontend may get a request or response type from.** `contracts/fixtures/` holds 310 named
scenarios covering every state in the contract — not one representative response per operation
but every order state, every dispatch state, every empty list, every overflowing name. Read
`contracts/fixtures/README.md`: it is the menu. Select one with `?scenario=` or
`X-Mock-Scenario:` against the mock, or import the JSON directly into Mock Service Worker.

Every fixture is schema-validated by `pnpm validate:fixtures` in CI, so a fixture can never
drift from the contract.

---

## The conventions, stated plainly

### Envelope

Every 2xx body is `{"data": …}`, plus `{"meta": …}` for collections. Every non-2xx body is
`{"error": {"code", "message", "details", "request_id"}}`.

There are no bare arrays, no bare scalars, and no `{"success": false}` with a 200. HTTP status
always agrees with the body. Clients branch on `error.code`, **never** on `error.message`.

### Money

* Every monetary field is an **integer count of Canadian cents**, named with a `_cents` suffix,
  `format: int64`. There is no `number`-typed money field anywhere in the contract, and no
  string-formatted money.
* **No inbound request body carries a price.** The server prices every order — that is
  invariant #1. Exactly three fields are allowlisted, and each is documented where it appears:
  * `tip_cents` on `createQuote` — the one customer-chosen monetary input;
  * `amount_cents` on `issueRefund` — admin goodwill only, capped and dual-approved;
  * `price_cents` on `createMenuItem` — a **merchant** setting its own catalogue price, which is
    not a client pricing an order.
* Rates (tax, surge) cross the wire as **exact decimal strings**, precisely so that no client
  parses one into a float and multiplies money by it.
* `contract-invariants.py` walks the schema and fails CI on any money-shaped field that is not an
  integer, and on any money-shaped field appearing in a request body outside the allowlist.

### Pagination

One scheme, everywhere: **keyset**. `?limit=` (1–100, default 20) and `?cursor=`; the response
carries `meta = {next_cursor, has_more}`. There is no `page`, no `offset` and no `total_pages`. A
non-numeric `limit` is a `422`, never a silent NaN.

### Idempotency

Every money-mutating operation and every durable-resource creation requires an `Idempotency-Key`
header (client-generated UUID or ULID, 16–128 chars), scoped
`(account_id, method, path_template, key)`:

* two concurrent requests with the same key produce **exactly one** business effect;
* a replay returns the original status and body byte-identically, with `Idempotency-Replayed: true`;
* the same key with a **different** body is `409 IDEMPOTENCY_KEY_REUSE`, never a silent replay of
  the wrong result;
* the record commits in the same transaction as the business effect, so "money moved but the
  idempotency record did not commit" cannot happen.

The header is marked `required: true` on every such operation in `openapi.yaml`, so a generated
client cannot omit it.

### Enums

Never a bare `string` where the specification defines a closed set. Every state machine, reason
code, document type, role and error code is a named schema with a full enum. Clients must treat
an unknown enum value as "unsupported — refresh the app", never crash.

### Authorization

Deny by default. Every operation declares `x-roles`. `PUBLIC` in that list is the *only* way an
operation may be called unauthenticated, and that set is fixed:

| Public operation | Why |
|---|---|
| `getHealth`, `getReadiness`, `getOpenApiDocument`, `getPublicConfig` | Infrastructure and client bootstrap |
| `requestOtp`, `verifyOtp` | You cannot authenticate to authenticate |
| `registerRestaurant`, `verifyEmail`, `resendEmailVerification`, `login` | Same |
| `requestPasswordReset`, `resetPassword` | Same |
| `refreshSession` | Authenticated by the refresh token itself |
| `receiveStripeWebhook` | Authenticated by signature, not by session |

Four security schemes are declared, matching the four ways identity is established:
`otpSession` (customer/rider, phone-OTP issued), `passwordSession` (restaurant/admin/support,
email+password issued), `refreshCookie` + `csrfHeader` (web refresh), and `realtimeTicket`
(the WebSocket upgrade, documented here because it is not an HTTP operation).

`404` versus `403`: a principal with no relationship to a subject gets `404` — existence is not
leaked. `403` means "you can see this resource but may not perform this action".

### Versioning

Every operation carries `x-version`: `V0` (in the 43-feature launch cut) or `V1` (needed to make
a V0 screen coherent, but not itself launch-blocking). Current counts: **139 V0, 16 V1**
(`pnpm validate:contract` prints them).

On 2026-10-01 the owner moved into launch the operations launch screens depend on, and added
one capability ([round-2 decisions, "Launch scope and contract"](../docs/decisions/README.md#launch-scope-and-contract),
issue [#182](https://github.com/shaiknoorullah/hg-mono/issues/182)):

| What | Operations |
|---|---|
| Forgot and reset password; change your own password | `requestPasswordReset`, `resetPassword`, `changePassword` |
| Two-step sign-in enrolment for staff | `enrollTotp`, `verifyTotpEnrolment` |
| The staff list and staff invites | `listStaff`, `createStaffUser` |
| Sign out everywhere | `logoutAll` |
| Restaurant payout history | `listRestaurantPayouts` |
| Marking an item out of stock | `setMenuItemAvailability` |
| Restaurants edit their own menu | `createMenuCategory`, `createMenuItem`, `updateMenuItem` |
| **New:** a restaurant renames, reorders, deactivates or reactivates its own category | `updateMenuCategory` |
| The menu review queue | `listMenuReviewQueue`, `decideMenuVersion` |
| **New:** an admin updates or removes a menu item on a restaurant's behalf | `updateMenuItemOnBehalf`, `deleteMenuItemOnBehalf` |

Still later-version: turning two-step sign-in off, listing and ending single sessions,
dependency status, the in-app inbox, restaurant staff, ratings, the home feed and a restaurant
adding delay to an order (`delayOrder`).

The same day the owner replaced the package seal with two 4-digit handover codes
([round-2 decisions, "Orders and delivery"](../docs/decisions/README.md#orders-and-delivery)).
Seals are not used at launch and move to v1.1
([#47](https://github.com/shaiknoorullah/hg-mono/issues/47)), so the four seal operations
(`bindPackageSeal`, `scanPickup`, `scanDelivery`, `reportTamper`) are now later-version, and no
seal scan gates any order transition.

| Code | Who sees it | Who types it in | Where in the contract |
|---|---|---|---|
| **Pickup code** | The kitchen, on `OrderRestaurantView.pickup_code` and `restaurant.order_accepted`, from acceptance until pickup | The rider, as `pickup_code` on the `PICKED_UP` transition of `createAssignmentTransition`. Wrong code: `PICKUP_CODE_INCORRECT` with the attempts left; five wrong codes: `PICKUP_CODE_LOCKED`, then pickup needs an `override_reason` and is flagged for operations ([#178](https://github.com/shaiknoorullah/hg-mono/issues/178), [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)) |
| **Delivery code** | The customer, on `OrderCustomerView.delivery_code`, `OrderTracking.delivery_code` and the `order.rider_arrived` event (a push without the code also goes out), while a met handover is out for delivery | The rider, as `otp_code` on `submitProofOfDelivery`. Five wrong codes lock it and the rider falls back to a photo with a statement ([#180](https://github.com/shaiknoorullah/hg-mono/issues/180)) |

The rider is never sent either code; each one is heard from the person holding it.

---

## Spec contradictions found while writing this contract

The five domain specs disagree in twenty-four places. Nothing below was silently chosen; each row
records the conflict, what the contract does, and on what authority. The ordering rule applied
throughout is:

> `docs/decisions/README.md` (a client or reconciliation decision) **>** `01-platform.md`
> (normative, and which `00-overview.md` says domain specs "do not re-litigate") **>** the domain
> spec.

Rows marked **OPEN** need a human answer; the contract encodes a defensible default and the field
exists either way.

| # | Conflict | Where | Contract's resolution | Basis |
|---|---|---|---|---|
| 1 | **Base path** — `/v1` vs `/api/v1` | 01 §P-02 vs 02 §0.2, 04 §0.1 | `/v1` | Platform normative |
| 2 | **Response envelope** — `{data, meta}`/`{error}` vs an always-three-key `{data, error, meta}` vs `{error:{code,message,field_errors}}` | 01 §G-6 vs 02 §0.2 vs 03 §1.1 | `{data, meta?}` on 2xx, `{error}` on non-2xx; per-field detail lives in `error.details` as `FieldError[]` | Platform G-6 |
| 3 | **Error-code casing** — `snake_case` (`quote_stale`) vs `SCREAMING_SNAKE` (`OFFER_ALREADY_TAKEN`, `DIFFERENT_RESTAURANT`) | 01 vs 02/04/05 | **RESOLVED — normalised to `SCREAMING_SNAKE_CASE`.** All 78 `snake_case` members were upper-cased and the three resulting collisions collapsed, taking the enum from 147 members to 144. See §"Error-code normalisation" below. | The normalisation this row asked for, done before any client existed |
| 4 | **Money storage and rounding** — customer spec says DB columns are `numeric(12,2)` *and* int64 cents in the same table, and that percentage discounts round **half-down** ("ties toward the customer"); platform bans `numeric` in money paths and mandates **half-up** everywhere | 02 §0.1 vs 01 §G-2, §P-12 | `int64` cents only; `round_half_up`, symmetric away from zero for negatives so a full refund reverses exactly | Platform G-2/P-12; the customer spec contradicts itself internally |
| 5 | **Halal state vocabulary** — three enums: `halal_display_state {CERTIFIED, EXPIRING_SOON, EXPIRED, UNVERIFIED}`, `halal_status {CERTIFIED, SELF_DECLARED, NOT_HALAL}`, `halal_status {NONE, PENDING, CERTIFIED, LAPSED, REJECTED, REVOKED}` | 02 §C-12 vs 01 §P-34 vs 05 §A-15 | `HalalDisplayState` (the four customer-visible values) on every customer-facing payload; `HalalCertificateStatus` (the admin lifecycle) on the admin surface. The platform's `SELF_DECLARED` is **not** exposed — decision O-06's default is to hide self-declared restaurants entirely. | Brief names the four-value set; O-06 default |
| 6 | **Delivery-instruction enum** — 3 values (customer), 5 values incl. `MEET_AT_DOOR`/`MEET_IN_LOBBY` (platform), 5 values incl. `CALL_ON_ARRIVAL` (rider) | 02 §C-33 vs 01 §P-36 vs 04 §D-19 | The platform's five. `CALL_ON_ARRIVAL` is dropped; `MEET_AT_DOOR`/`MEET_IN_LOBBY` map to OTP proof-of-delivery, the rest to photo. | Platform normative — its validation message enumerates exactly five |
| 7 | **Rider earnings model** — an independent rate card ($3.50 base + $0.80/km, $6.00 floor, wait pay) vs delivery-fee pass-through | 01 §P-13, 04 §D-26 vs decisions S-03/R-02 | **Pure pass-through**: rider earnings = delivery fee + 100% of tips. The component fields (`base_cents`, `distance_cents`, `wait_cents`, `guarantee_topup_cents`) are retained on `EarningEntry` so the rate card can be switched on by configuration. | R-02: the rate card loses money on every short trip at 0% commission |
| 8 | **Refund reason codes** — three overlapping sets (`ITEM_MISSING` vs `MISSING_ITEMS`, `NEVER_DELIVERED` vs `ORDER_NEVER_ARRIVED`, …) | 01 §P-18 vs 02 §C-37 vs 05 §A-33 | Reconciled **union**, both spellings retained, since each spec pins its own spellings in acceptance criteria and in the liability matrix | **Needs a decision** — the liability matrix (O-04) must be signed off anyway, and that is the moment to collapse the synonyms |
| 9 | **Order state machine vocabulary** — four different sets: the platform's 14 states; the customer's `PENDING_PAYMENT / AWAITING_RESTAURANT / CONFIRMED / RIDER_ASSIGNED / ON_THE_WAY / NO_RIDER_FOUND`; the restaurant's `PENDING_RESTAURANT / ACCEPTED / CANCELLED_BY_*`; the rider's assignment states | 01 §P-14 vs 02 §C-23 vs 03 §1.4 vs 04 §0.4 | The platform's 14-state `OrderState` is the **only** order enum. The rider's `AssignmentState` is retained as the subordinate dispatch machine's rider-facing view — that separation is deliberate and is P-14's central design decision. The customer's and restaurant's vocabularies are display mappings, not states, and do not appear on the wire. | Platform normative; overview §V0 says "14-state order machine" |
| 10 | **State count** — P-14's prose says "eleven states, five terminal"; its own SQL enum lists fourteen; the overview says fourteen | 01 §P-14 | Fourteen | The SQL enum and the overview agree; the prose is a stale sentence |
| 11 | **Restaurant acceptance window** — 300 s vs 180 s | 02 §C-23 vs 01/03 | **180 s**, exposed as `restaurant_response_window_seconds` in `getPublicConfig` | Decision R-04 |
| 12 | **Realtime transport** — the restaurant spec specifies Server-Sent Events on `/v1/restaurant/events` with a 15 s ETag poll fallback; the rider spec specifies `/ws` with a 60 s ticket and two topics; the platform specifies one WebSocket at `/v1/ws` with a 30 s ticket and five channels | 03 §R-09, 04 §0.3 vs 01 §P-20–23 | **One WebSocket**, `/v1/ws`, 30-second single-use ticket, five channels, per-channel `seq` and replay. `websocket.md` is the only realtime contract. | Platform normative; two transports would mean two authorization surfaces |
| 13 | **Dispatch parameters** — 3 waves × 20 s at 3/6/10 km with 8 riders per wave (platform); 30 s per wave (overview); 5 waves × 30 s with 3 riders per wave and a 300 s total cap (rider) | 01 §P-32 vs 00 §Timeouts vs 04 §0.5 | Not fixed in the contract — these are `dispatch_config` values, and the wire only carries `wave`, `expires_at` and `server_time`. The client renders the server's numbers. | Deliberate: making them contract constants would repeat the mistake of hardcoding fee and ETA values in clients |
| 14 | **Discount funding** — platform-funded vs restaurant-funded | 02 §C-21 vs 03 | **Restaurant-funded**. `QuoteDiscount` carries `funded_by` *and* `reimbursable` as separate fields because they answer different questions (who bears it; how the CRA coupon rules tax it). | Decision R-06 |
| 15 | **Commission rate** — 20% / 18% / 15% | 01 vs 03 vs 05 | **0%** at launch. `commission_rate_bps` is present, read-only to partners, switchable without a release. | Decisions S-01 / R-01 |
| 16 | **Payout minimum** — CAD 25 (restaurant), CAD 10 (rider), or none | 01 §P-19, 04 §0.5 vs decisions | **No minimum**, weekly, Monday, automatic, for both partner types | Decisions S-04 / R-03 |
| 17 | **Pricing mechanism** — an HMAC-signed pricing snapshot echoed by the client and re-verified, vs a persisted `quote` row whose id is the only thing checkout accepts | 02 §C-22 vs 01 §P-09 | **The persisted quote.** `createOrder` accepts `quote_id` and nothing money-shaped; the server re-executes `Quote()` and returns `409 QUOTE_STALE` with the new quote embedded on any difference. Nothing signed by the server is ever echoed back by the client. | Platform P-09 — a signed snapshot is still a client-supplied number, only harder to audit |
| 18 | **Menu auto-approval** — a 24-hour auto-approve backstop for pending menu versions vs never auto-approving | 03 §R-17 (D-22) vs 05 §A-19 | **Never auto-approve claim-bearing fields.** Price, availability and ordering are instant and unreviewed, so a stalled queue cannot freeze a restaurant's trading. | Decision R-05: silence must never become consent on a halal claim |
| 19 | **Halal certificate expiry consequence** — hide the restaurant entirely; keep trading without the badge then suspend at 14 days; delist | 02 §C-12 vs 01 §P-29/P-34 vs 05 §A-17 | Customer-visible only for `CERTIFIED` and `EXPIRING_SOON`; everything else is `404` from every customer read path. `RestaurantAccountState.DELISTED` carries the non-punitive system state. | 02 §C-12 default, consistent with A-17's delist semantics |
| 20 | **Document-set naming** — `BUSINESS_LICENCE / FOOD_SAFETY / OWNER_ID` vs `BUSINESS_REGISTRATION / FOOD_HANDLING_PERMIT / OWNER_GOVERNMENT_ID / VOID_CHEQUE_OR_BANK_LETTER`; riders similarly (`GOVERNMENT_ID` vs `PROVINCIAL_ID`, plus `WORK_ELIGIBILITY` and `BANKING`) | 03 §R-07 vs 05 §A-13 / §A-23 | The partner-spec names (`RestaurantDocType`, `RiderDocType`). `VOID_CHEQUE_OR_BANK_LETTER` and `BANKING` are omitted — Stripe Connect supersedes them and the platform stores no bank details. `WORK_ELIGIBILITY` is retained on the rider enum. | Partner specs own the upload flow; both spec sets agree the FSSAI certificate is replaced (decision R-08) |
| 21 | **Cart line quantity cap** — 1–20 vs "quantity ≤ 99" | 02 §C-16/C-19 vs 01 §P-36 | **1–20** | The customer spec explicitly reduces the old cap of 99; P-36 mentions 99 only in passing |
| 22 | **Fee parameters** — $2.99 + $1.00/km (overview); $2.99 + 3 km included + $1.20/km, min $2.99 / max $12.99, small-order threshold (P-09); base 299 + 150/km, flat platform fee 499 (C-22) | 00 vs 01 §P-09 vs 02 §C-22 | **None of them are in the contract.** Fees live in `pricing_config` and reach clients only as computed cents on a quote. `getPublicConfig` deliberately exposes no fee parameter, so no client can compute a price. | Overview §Money model is authoritative for the values; the contract's job is to make them unreachable by clients |
| 23 | **OTP rate limits** — 5/hour + 10/day per phone, 5 verify attempts (platform); 3 per 15 min per phone, 5 verify attempts (customer); 3 per 15 min + 10/day + 20/hour per IP (rider) | 01 §P-02 vs 02 §C-01 vs 04 §D-01 | Not fixed in the contract — the wire carries `resend_after_s` and `expires_at`, and the client renders the server's cooldown. The platform's limits are the implementation default. | Same reasoning as #13 |
| 24 | **Concurrent orders** — the customer spec forbids a second active order; no other spec mentions it | 02 §C-26 | **One active order per customer.** `createOrder` returns `409 ACTIVE_ORDER_EXISTS`; `getActiveOrder` returns zero or one. | 02 §C-26 default — it removes a class of tracking and refund ambiguity and can be relaxed without a migration |

### Error-code normalisation (contradiction #3, resolved)

Row 3 said a one-time normalisation was "cheap now and expensive later". It was done while
"now" was still true — before a single client, handler or fixture existed to be renamed.

**The rule: every `ErrorCode` member is `SCREAMING_SNAKE_CASE`. To map a spec that still
writes a code in `snake_case`, upper-case it. Nothing was renamed, split or dropped.**

Three pairs became identical once cased alike, and were collapsed to one member each:

| Kept | Absorbed | Consequence |
|---|---|---|
| `OTP_INCORRECT` | `otp_incorrect` | The auth OTP code and the **proof-of-delivery** OTP code are now one member. They were always distinguishable only by endpoint, and still are — `POST /v1/auth/otp/verify` versus `submitProofOfDelivery`. `OTP_LOCKED` and `POD_METHOD_MISMATCH` remain separate. |
| `OFFER_EXPIRED` | `offer_expired` | Same meaning in both specs — a dispatch offer whose countdown ran out. A genuine duplicate. |
| `PROVINCE_NOT_SERVED` | `province_not_served` | The address-validation code and the quote-time code. Same customer-facing outcome, gated by the same `getPublicConfig.served_provinces` list (decision O-05). |

Scope of the change: **162 token replacements** across `contracts/openapi.yaml` — the enum
itself plus every backtick-quoted reference in a `description`, and nothing else. English
prose was untouched: "hand-edited clients are **forbidden**" and "a rejection or **timeout**
voids the authorisation" still read as sentences, because only code tokens inside backticks
and bare enum list items were rewritten.

`pnpm validate:contract` now fails the build on any `ErrorCode` member that is not
`SCREAMING_SNAKE_CASE`, and `pnpm validate:fixtures` fails on any error fixture whose `code`
is not a member of the enum. The casing cannot regress.

### Two contract defects fixed alongside it

Both were found by generating fixtures against the document — which is the point of
generating fixtures against the document.

| Defect | Effect | Fix |
|---|---|---|
| **`Province: enum [AB, …, ON, …]`** — `ON` unquoted | In **YAML 1.1** (PyYAML, libyaml, `gopkg.in/yaml.v2`) a bare `ON` is the boolean `true`. Ontario — the only province served at launch — silently became `true` for every YAML-1.1 consumer, while the YAML-1.2 JS toolchain read `"ON"`. A Go server and a TypeScript client would have disagreed about Ontario. | Every member quoted. `validate-contract.ts` now fails on any unquoted YAML-1.1 truthy scalar in an `enum`, `examples` or `default`. |
| **Nine `allOf` compositions over a base with `additionalProperties: false`** — `RestaurantDetail`, `MenuCategoryWithItems`, `MenuItemOwnerView`, `OrderAdminView`, `RiderLocation`, `PayoutDetail`, `RestaurantApplication`, `RiderApplication`, and the inline category in `OwnedMenu` | An `additionalProperties` assertion only sees the properties of **its own** subschema, so the base rejected every field the extension added. These nine schemas were **unsatisfiable**: no instance could validate. That covers the customer app's restaurant detail, every menu, the restaurant app's menu editor and the admin order view. | `additionalProperties: false` removed from the eight base schemas that are extended, each with a comment saying why. `validate-contract.ts` fails on any new instance of the pattern. |

### Blocking open decisions that the contract encodes as defaults

These are `docs/decisions/README.md` §"Open — blocking". The contract shapes exist and are stable
either way, but the **values** need a human before launch:

| Decision | What the contract does today |
|---|---|
| **O-01** HST registration and supplier position | `Receipt` carries both `platform_tax_registration_number` and `restaurant_tax_registration_number`; `QuoteTaxLine.remittable_by` switches per line. Either answer is expressible without a schema change. |
| **O-02** Accepted halal certifying bodies | `HalalIssuingBody` registry with `PROPOSED → ACCEPTED` promotion gated to super admin. Check `H2_ISSUER_ACCEPTED` fails until the list is seeded, so **no restaurant can be certified until the client supplies it**. |
| **O-03** SMS / A2P registration | `requestOtp` is fully specified; nobody can sign in until a provider is live. No contract impact, total launch impact. |
| **O-04** Refund liability allocation | `RefundLiabilitySplit` is computed at authorisation and stored. The reason-code → split mapping is server config, not contract. |
| **O-05** Launch provinces | `Province` enumerates all thirteen; `getPublicConfig.served_provinces` gates them; a quote outside the list fails `PROVINCE_NOT_SERVED`. |
| **O-06** Self-declared restaurants | Hidden entirely. `HalalDisplayState` has no `SELF_DECLARED` member, so a listing surface cannot accidentally render one. |

---

## What CI enforces

| Check | Fails when |
|---|---|
| YAML parse + `$ref` resolution | Any reference does not resolve (currently 1,084 refs, 0 unresolved) |
| `operationId` uniqueness and camelCase | Two operations share a name, or a name would generate an ugly client method |
| `x-roles` and `x-version` present | Any operation omits either — this is the deny-by-default gate expressed in the contract |
| Money invariant | A `_cents` field is not `integer/int64`, or a money-shaped field lacks the suffix, or a `number`-typed field has a money-shaped name |
| Mass-assignment invariant | A request body contains a price-shaped field outside the three-item allowlist |
| Component reachability | A schema, parameter or response is declared and never referenced |
| Contract drift | The document generated from the route registry differs from the committed one |
| Fixture validity | Any fixture under `contracts/fixtures/` does not validate against its named schema (`pnpm validate:fixtures`) |
| Error-code casing | Any `ErrorCode` member is not `SCREAMING_SNAKE_CASE`, or the enum contains a duplicate |
| YAML 1.1 truthy scalars | An unquoted `ON`/`OFF`/`YES`/`NO` appears in an `enum`, `examples` or `default` — see §"Two contract defects" |
| Unsatisfiable `allOf` | An `allOf` extends a base that sets `additionalProperties: false` |
| Generated-client drift | `pnpm generate` changes `packages/api-client/src/generated/**` (`git diff --exit-code`) |
| Fixture drift | `pnpm fixtures:build` changes anything under `contracts/fixtures/` (`git diff --exit-code`) |
