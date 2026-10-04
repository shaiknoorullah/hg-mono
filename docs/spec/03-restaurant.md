---
covers:
  - apps/restaurant/**
  - services/hg/internal/restaurant/**
  - services/hg/internal/catalog/**
reviewed: 2026-10-04
---

# HalalGoes — RESTAURANT domain specification

**Status**: implementable spec, derived from SOW items 1–8 (Restaurant section).
**Target**: Go modular monolith, single binary. Postgres + Redis + [Silo](https://github.com/pgsty/silo), the maintained MinIO fork ([object storage](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)) + Traefik. No Temporal, no
microservices, no serverless.
**Restaurant surface**: web app only (Next.js today; surface-agnostic here). The Expo
`apps/restaurant` mobile app is **not** in this spec — see "Global out of scope".
**Devices**: desktop and landscape tablets from 1024×768 up, light theme only; no portrait or phone
layouts ([devices at launch](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [dark theme](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
**Market**: Canada. Currency CAD. Language en-CA (fr-CA deferred to V3).

---

## 0. Reading this document

Every feature entry uses a fixed shape: SOW trace → Behaviour → Data → States → Rules →
Acceptance criteria → Out of scope → Version → Size.

- **Version** — `V1` = required before the platform can take one real paid order.
  `V2` = contracted in the SOW but not launch-blocking. `V3` = enhancement / deferred.
- **Size** — `S` ≈ under a day, `M` ≈ 1–3 days, `L` ≈ a week or more, for one engineer including tests.
- Wherever a business rule could not be derived from the SOW or the existing system, a
  **DECISION REQUIRED** block appears inline, a specific default is proposed, and the spec then
  proceeds *as if that default were accepted*. All of them are collected in §4.

---

## 1. Cross-cutting conventions (normative — apply to every feature below)

### 1.1 Identity and money

| Concern | Rule |
|---|---|
| Primary keys | `uuid` v7, generated server-side. Client-supplied ids are rejected with `400 invalid_field`. |
| Money | `bigint` **cents**, CAD only. No floats anywhere, no `@db.Money`, no rounding to 5c. Field names end `_cents`. |
| Time | `timestamptz` stored UTC. Every restaurant has `timezone` (IANA, e.g. `America/Toronto`). All restaurant-facing day boundaries, hours and reports use restaurant-local time. |
| Soft delete | `deleted_at timestamptz NULL`. Every read path filters it. Deleted rows are never returned to the restaurant surface. |
| Enums | Postgres native enums, `SCREAMING_SNAKE`. Unknown value on input → `422 invalid_enum_value`, never coerced. |
| Envelope | All responses `{"data": …, "meta": {…}}` or `{"error": {"code","message","field_errors":[]}}`. Never a bare array. Never HTTP 200 with `success:false`. |
| Pagination | Cursor-based: `?limit=` (default 20, max 100) + `?cursor=`. `meta.next_cursor` null at end. |
| Idempotency | Every non-GET carries `Idempotency-Key` (UUID). Replays inside 24h return the stored original response. Required on accept/reject, payout request, document confirm. |
| Validation | Request bodies validated against explicit structs at the HTTP boundary. Field allowlists only — no struct passthrough to the ORM, so `is_approved`, `commission_rate_bps`, `deleted_at` are never client-writable. |
| Authorization | Every restaurant endpoint resolves `restaurant_id` from the **session**, never the path/body. A path `restaurant_id` that differs from the session's → `403 forbidden`, never 404-masked. |
| Rate limits | Per-session: 300 req/min general, 10/min on auth, 20/min on document upload-url, 5/min on payout request. Exceeded → `429` + `Retry-After`. |
| Audit | Every state-changing action writes `audit_log(id, actor_type, actor_id, restaurant_id, action, entity_type, entity_id, before_json, after_json, ip, user_agent, created_at)`. Immutable, append-only. |

> **DECISION REQUIRED — locale, currency and timezone scope**: are these global constants or per-restaurant settings? · **Proposed default**: currency **CAD only, globally**, with no multi-currency code path anywhere; **timezone per restaurant** (IANA), governing every day boundary, schedule, report and payout window; locale **`en-CA` only** until V3. · **Why**: a single currency removes an entire class of money bug at the type level, while per-restaurant timezones are unavoidable in a country spanning six of them. *(D-23)*

### 1.2 Core entities referenced throughout

```
restaurant(id, legal_name, display_name, slug, email, phone_e164, description,
           cuisine_type_ids[], timezone, currency='CAD', logo_media_id, cover_media_id,
           address_line1, address_line2, city, province_code, postal_code, country_code='CA',
           lat numeric(9,6), lng numeric(9,6), coords geography(Point,4326) NOT NULL,
           onboarding_state, account_status, is_accepting_orders bool,
           avg_prep_minutes int, commission_rate_bps int, gst_hst_number,
           last_heartbeat_at, missed_order_count int, created_at, updated_at, deleted_at)

restaurant_user(id, restaurant_id, email citext UNIQUE, password_hash, role,
                email_verified_at, last_login_at, failed_login_count, locked_until)

restaurant_document(id, restaurant_id, doc_type, media_id, status, issuer_name,
                    document_number, issued_on date, expires_on date, review_note,
                    reviewed_by_admin_id, reviewed_at, version int, created_at)

media(id, owner_type, owner_id, bucket, object_key, mime_type, size_bytes,
      width_px, height_px, visibility, checksum_sha256, created_at)

menu_category(id, restaurant_id, name, sort_order, is_active, deleted_at)
menu_item(id, restaurant_id, category_id, live_version_id, pending_version_id,
          price_cents, availability_state, out_of_stock_until, sort_order, deleted_at)
menu_item_version(id, menu_item_id, name, description, ingredients_text, dietary_tags[],
                  spice_level, image_media_id, contains_alcohol=false, review_status,
                  submitted_at, reviewed_by_admin_id, reviewed_at, review_note, created_at)

order(id, order_number, restaurant_id, customer_id, rider_id, status,
      subtotal_cents, discount_cents, delivery_fee_cents, platform_fee_cents,
      tax_cents, tip_cents, total_cents, restaurant_payout_cents, commission_cents,
      offered_at, response_deadline_at, accepted_at, promised_ready_at, ready_at,
      picked_up_at, delivered_at, cancelled_at, cancel_reason_code, placed_at)
order_line(id, order_id, menu_item_id, item_version_id, name_snapshot,
           unit_price_cents, quantity, options_json, line_total_cents, note)
```

`order_line` is a **price-and-content snapshot** taken at order creation. Nothing that happens to a
menu item afterwards can change an existing order line. This single rule answers "can a restaurant
edit a menu while orders are in flight" — see R-15.

### 1.3 Restaurant account status (governs everything)

`account_status` enum, orthogonal to `onboarding_state`:

| Status | Set by | Can receive new orders | Existing accepted orders | Can log in |
|---|---|---|---|---|
| `PENDING` | system on signup | no | n/a | yes |
| `ACTIVE` | admin approval + payout account ready | yes (subject to hours/toggle) | continue | yes |
| `SUSPENDED` | admin, or automatic compliance rule | no | **continue to completion** | yes; read-only except disputes and opening hours; the menu is locked for everyone, admins included ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
| `REJECTED` | admin at onboarding review | no | n/a | yes, to re-submit documents |
| `BANNED` | admin (irreversible without super-admin) | no | force-cancelled | no; the menu is locked for everyone, admins included ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
| `CLOSED` | restaurant self-service offboarding | no | continue to completion | yes for 90 days |

Full transition and in-flight-order semantics are specified in **R-36**.

### 1.4 Order lifecycle (restaurant-visible slice)

```
PENDING_RESTAURANT ──accept──▶ ACCEPTED ──restaurant marks──▶ PREPARING
      │                            │                              │
      │ reject                     │                              ▼
      │ timeout(EXPIRED)           │                        READY_FOR_PICKUP
      ▼                            │                              │
  CANCELLED_*                      └── restaurant cancel ─▶ CANCELLED_BY_RESTAURANT
                                                                  │
                                       pickup code ──▶ PICKED_UP ─┴─▶ ON_THE_WAY ─▶ DELIVERED
```

`PICKED_UP`, `ON_THE_WAY`, `DELIVERED` are rider/system-driven and are **read-only** to the
restaurant. The restaurant may write only: `accept`, `reject`, `mark_preparing`, `mark_ready`,
`delay`, `cancel` (bounded, R-28).

### 1.5 The FSSAI problem — flagged

> ⚠️ **SOW DEFECT — FSSAI is the wrong jurisdiction.**
> SOW §2 In-Scope / Restaurants / Account Management reads: *"uploading necessary legal documents
> (e.g., business license, **FSSAI certificate**, Halal Certificate)"*.
> **FSSAI** is the Food Safety and Standards Authority of **India**. It has no legal meaning in
> Canada and no Canadian restaurant can produce one. The legacy mobile app compounds this: it
> collects an Indian **GSTIN** (15-char regex) and labels the upload "FSSAI/Halal certificate", and
> the shared auth package hardcodes country code `+91` while the UI shows `+1`.
> This spec **replaces FSSAI** with the Canadian document set defined in R-07 and treats the SOW
> line as a template error, not a requirement. See **D-11**.

---

## 2. Feature specifications

---

### R-01 — Restaurant account signup

- **SOW trace**: *"Signup and Registration: Restaurants can register on the application by providing basic details (e.g., name, location, cuisine type) and uploading necessary legal documents…"* (SOW §2, Restaurants §1).

- **Behaviour**: An unauthenticated visitor creates a restaurant **account** with four fields only:
  `legal_name`, `email`, `password`, `terms_version`. Location, cuisine and documents are **not**
  collected here — they belong to R-05 and R-07, which require an authenticated session. On success
  the server creates exactly one `restaurant` row (`onboarding_state=REGISTERED`,
  `account_status=PENDING`) and one `restaurant_user` row (`role=OWNER`, `email_verified_at=NULL`),
  sends a verification email (R-02), and returns `201` with **no tokens**. Signup never authenticates.

- **Data**:
  - `restaurant_user`: `id, restaurant_id, email citext UNIQUE, password_hash, role OWNER|MANAGER|STAFF, email_verified_at, created_at`
  - `restaurant`: `id, legal_name, onboarding_state, account_status, created_at`
  - `terms_acceptance`: `id, restaurant_user_id, terms_version, accepted_at, ip, user_agent`
  - `email_verification_token`: `id, restaurant_user_id, token_hash, expires_at, consumed_at`

- **States**: `restaurant.onboarding_state` starts at `REGISTERED`. Transition: *(none)* →
  `REGISTERED` on successful signup. `restaurant_user` has no state of its own beyond
  `email_verified_at` being null/non-null.

- **Rules**:
  1. `email` — RFC 5322, ≤254 chars, lowercased and stored `citext`. Uniqueness is **global across
     restaurant users**. Duplicate → `409 email_already_registered` with a generic message; the
     response is timing-padded to the same latency band as a success to avoid account enumeration.
  2. `password` — minimum **12** characters, must contain ≥1 upper, ≥1 lower, ≥1 digit; max 128;
     rejected if present in the bundled top-10k breached-password list. Hashed with **Argon2id**
     (m=64MiB, t=3, p=2). Never logged, never returned.
  3. `legal_name` — 2–120 chars, Unicode letters/digits/space/`&'-.,` only.
  4. `terms_version` — must equal the current server-side `TERMS_VERSION` constant; a stale value →
     `409 terms_version_stale`.
  5. Rate limit 5 signups/hour/IP and 3/day/email-domain-prefix. Exceeded → `429`.
  6. No phone/OTP at signup. Phone is collected in R-05 and verified in V2.
  7. Signup is idempotent on `Idempotency-Key`; a replay returns the original `201` body.

- **Acceptance criteria**:
  1. **Given** no account exists for `chef@example.ca`, **when** POST `/v1/restaurant/auth/signup` with a 12-char compliant password and current `terms_version`, **then** `201` is returned with `{restaurant_id, email, onboarding_state:"REGISTERED"}`, no access or refresh token is present in the body or in any `Set-Cookie`, and exactly one verification email is enqueued.
  2. **Given** `chef@example.ca` already exists, **when** the same signup is repeated with a different `Idempotency-Key`, **then** `409 email_already_registered` is returned, no second `restaurant` row is created, and response latency is within ±100 ms of the success-path median.
  3. **Given** a password of `Password1234` that appears in the breached list, **when** signup is attempted, **then** `422` is returned with `field_errors:[{field:"password",code:"breached_password"}]` and no rows are written.
  4. **Given** a successful signup, **when** the `restaurant_user` row is inspected, **then** `password_hash` starts with `$argon2id$` and the plaintext appears in no log line, audit row, or error payload.

  > **Decided:** one restaurant per login at launch; a chain onboards each location separately ([one login for several restaurants](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)). One menu per restaurant stays the proposed default.

- **Out of scope**: social login (Apple/Google/Facebook — the legacy mobile buttons were decorative and are **not** rebuilt); phone/OTP signup; invite-based staff signup (a later version: the owner is the only login at launch, [staff accounts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)); multi-restaurant / franchise accounts under one login (**D-15**); CAPTCHA (V2); self-serve email change.

- **Version**: V1
- **Size**: M

---

### R-02 — Email verification and account activation

- **SOW trace**: *"Signup and Registration…"* (SOW §2, Restaurants §1) — verification is the implied precondition for the SOW's document-submission step and is present in the live contract (`POST /auth/restaurant/verify-email`).

- **Behaviour**: The signup email contains a link to `{APP_ORIGIN}/verify-email?token=…`. The web app
  POSTs the token once. On success the server sets `email_verified_at`, advances
  `onboarding_state REGISTERED → EMAIL_VERIFIED`, issues an access + refresh token pair (R-03), and
  returns the onboarding status object so the client can route to the next step. The token is
  single-use and is consumed atomically (`UPDATE … WHERE consumed_at IS NULL RETURNING`).

- **Data**: `email_verification_token(id, restaurant_user_id, token_hash sha256, expires_at, consumed_at, created_at, requested_ip)`. The raw token is a 32-byte CSPRNG value, base64url; only its SHA-256 is stored.

- **States**: `onboarding_state`: `REGISTERED --verify_email--> EMAIL_VERIFIED`.
  Token: `ISSUED --consume--> CONSUMED`; `ISSUED --expires_at passed--> EXPIRED` (lazy, evaluated on use);
  `ISSUED --new token requested--> SUPERSEDED` (all prior unconsumed tokens for the user are invalidated).

- **Rules**:
  1. Token TTL **24 hours**. Expired → `410 verification_token_expired` with an actionable
     `resend_available:true`.
  2. Resend allowed at most **3 times per 24h per user**, minimum **60 s** apart. Each resend
     supersedes all outstanding tokens for that user.
  3. Consuming a token a second time → `410 verification_token_used`. It does **not** re-issue tokens.
  4. An unverified account cannot call any endpoint other than
     `signup/login/verify-email/resend-verification`. All others → `403 email_not_verified`.
  5. Accounts unverified after **30 days** are soft-deleted by a nightly job; the email is released
     for re-registration.

- **Acceptance criteria**:
  1. **Given** a fresh verification token, **when** it is POSTed once, **then** `200` returns `{access_token, refresh_token, onboarding_state:"EMAIL_VERIFIED", next_step:"PROFILE"}` and `email_verified_at` is set.
  2. **Given** the same token, **when** it is POSTed a second time within 1 s (double-submit), **then** exactly one of the two requests succeeds and the other returns `410 verification_token_used` — verified under a concurrent 2-request test.
  3. **Given** a token issued 25 hours ago, **when** it is POSTed, **then** `410 verification_token_expired` is returned and no session is created.
  4. **Given** an account with `email_verified_at IS NULL`, **when** it calls `GET /v1/restaurant/menu/items` with a forged bearer token, **then** `403 email_not_verified` is returned.

- **Out of scope**: magic-link login; email change flow; verification by SMS; deliverability/bounce handling beyond writing a `bounced` flag (V2).

- **Version**: V1
- **Size**: S

---

### R-03 — Login, session and token lifecycle

- **SOW trace**: *"Signup and Registration"* / *"Login/Logout"* (SOW §2 — stated explicitly for Customers and Riders, implied for Restaurants by the live `POST /auth/restaurant/login` contract).

- **Behaviour**: Email + password login returns an access token and a refresh token, plus the
  onboarding status object that determines the landing route (`/dashboard`, `/onboarding?step=N`, or
  `/onboarding/pending-approval`). Access tokens are JWTs (RS256) with 15-minute TTL. Refresh tokens
  are opaque 32-byte random values, hashed at rest, 30-day TTL, **rotated on every use** with reuse
  detection. Both are delivered as `HttpOnly; Secure; SameSite=Lax` cookies. Neither token is ever
  written to `localStorage`.

- **Data**:
  - `restaurant_session(id, restaurant_user_id, refresh_token_hash, parent_session_id, issued_at, expires_at, revoked_at, revoked_reason, ip, user_agent, last_seen_at)`
  - JWT claims: `sub` (restaurant_user_id), `rid` (restaurant_id), `role`, `sid` (session id), `iat`, `exp`, `jti`.

- **States**: session `ACTIVE --refresh--> ACTIVE(new row, parent set)`; `ACTIVE --logout--> REVOKED(user_logout)`;
  `ACTIVE --reuse of a rotated token--> REVOKED(token_reuse)` **and the entire ancestor chain is revoked**;
  `ACTIVE --expires_at--> EXPIRED`; `ACTIVE --admin suspend/ban--> REVOKED(admin_action)`.

- **Rules**:
  1. Failed logins increment `failed_login_count`. At **10** failures the account is locked for
     15 minutes (`locked_until`); counter resets on success. Locked → `423 account_locked` with
     `retry_after_seconds`.
  2. Wrong password and unknown email return the **same** `401 invalid_credentials` body and the
     server performs a dummy Argon2 verification on unknown emails to equalise timing.
  3. Refresh rotation: presenting refresh token *T* issues *T′* and marks *T* consumed. Presenting
     *T* again (reuse) revokes the whole chain and returns `401 session_revoked` — the client must
     re-authenticate.
  4. Maximum **10** concurrent active sessions per user; the oldest is revoked beyond that.
  5. `POST /v1/restaurant/auth/logout` revokes the current session; `logout-all` revokes every
     session for the user.
  6. Password reset: `request-reset` → emailed token (TTL 30 min, single-use, supersedes prior) →
     `confirm-reset` sets the new hash and revokes **all** sessions. A signed-in user may change
     their own password, which revokes every other session. Reset, change and `logout-all` ship at
     launch ([launch scope](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  7. Authorization middleware rejects a request whose JWT `rid` does not match the `restaurant_id`
     of the resource being addressed. No endpoint accepts `restaurant_id` from the client for
     authorization purposes.

- **Acceptance criteria**:
  1. **Given** a verified user, **when** login succeeds, **then** the response sets `access_token` and `refresh_token` cookies both carrying `HttpOnly`, `Secure` and `SameSite=Lax`, and `document.cookie` in the browser exposes neither.
  2. **Given** refresh token *T* has been used once, **when** *T* is presented again, **then** `401 session_revoked` is returned, the descendant session is marked `revoked_reason='token_reuse'`, and a subsequent call with the previously-valid *T′* also fails.
  3. **Given** restaurant A's session, **when** it calls `GET /v1/restaurant/orders?restaurant_id=<B's id>`, **then** `403 forbidden` is returned and A's own orders are **not** returned as a silent fallback.
  4. **Given** 10 consecutive wrong-password attempts, **when** the 11th attempt uses the *correct* password, **then** `423 account_locked` is returned with `retry_after_seconds` ≤ 900.

- **Out of scope**: SSO/SAML; MFA (V2; it issues no recovery codes, and a super admin resets a lost
  authenticator after a phone call-back check: [recovery codes](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), [manual resets](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)); device-trust / "remember this device"; biometric; session
  transfer between the web app and a future mobile app.

- **Version**: V1
- **Size**: M

---

### R-04 — Onboarding state machine and progress tracking

- **SOW trace**: *"Document Verification: Upload and submit legal documents for verification. Track the verification status in real-time."* (SOW §2, Restaurants §1).

- **Behaviour**: A single server-owned state machine drives the whole onboarding funnel. The client
  never decides the next step; it reads `GET /v1/restaurant/onboarding/status` and renders whatever
  `current_step` says. Each step's completion is recorded as a boolean in `steps_completed` so the
  UI can render a checklist and so a partially-completed application survives logout.

- **Data**:
  ```
  restaurant.onboarding_state enum
  restaurant_onboarding(restaurant_id PK, profile_completed_at, documents_submitted_at,
                        documents_approved_at, documents_rejected_at, payout_account_ready_at,
                        first_menu_published_at, activated_at, rejection_reason_code,
                        rejection_note, review_cycle int)
  ```
  Status response:
  `{onboarding_state, current_step, progress_percent, steps_completed:{profile,documents_uploaded,documents_submitted,documents_approved,payout_account,menu_published}, blocking_reason, rejection: {reason_code, note, documents:[{doc_type, status, review_note}]}}`

- **States** (`onboarding_state`, exact list and triggers):

  | From | To | Trigger |
  |---|---|---|
  | — | `REGISTERED` | signup (R-01) |
  | `REGISTERED` | `EMAIL_VERIFIED` | email token consumed (R-02) |
  | `EMAIL_VERIFIED` | `PROFILE_PENDING` | first authenticated load (no-op marker) |
  | `PROFILE_PENDING` | `DOCUMENTS_PENDING` | profile saved and valid (R-05) |
  | `DOCUMENTS_PENDING` | `DOCUMENTS_REVIEW` | all required docs confirmed + `documents/submit` (R-08) |
  | `DOCUMENTS_REVIEW` | `DOCUMENTS_APPROVED` | admin approves the pack (R-08) |
  | `DOCUMENTS_REVIEW` | `DOCUMENTS_REJECTED` | admin rejects ≥1 required doc (R-08) |
  | `DOCUMENTS_REJECTED` | `DOCUMENTS_PENDING` | restaurant re-uploads any rejected doc; `review_cycle`+1 |
  | `DOCUMENTS_APPROVED` | `PAYOUT_PENDING` | automatic |
  | `PAYOUT_PENDING` | `MENU_PENDING` | payout account reaches `READY` (R-11) |
  | `MENU_PENDING` | `ACTIVE` | ≥1 menu item reaches `LIVE` (R-17) **and** hours are set (R-06) |
  | any | `WITHDRAWN` | restaurant abandons application (self-service, ≥1 confirmation) |

  `account_status` becomes `ACTIVE` exactly when `onboarding_state` becomes `ACTIVE`.

- **Rules**:
  1. Transitions are executed only by named server functions inside a transaction with
     `SELECT … FOR UPDATE` on the restaurant row. There is **no** generic
     `PUT /onboarding/state` endpoint.
  2. An illegal transition attempt returns `409 illegal_state_transition` naming `from` and `to`.
  3. `progress_percent` is a pure function of `steps_completed` with fixed weights:
     profile 20, documents_submitted 20, documents_approved 25, payout_account 25,
     menu_published 10. It is computed server-side; the client never computes it.
  4. Steps are strictly ordered; skipping is impossible. Requesting a later step's endpoint before
     its prerequisite → `409 step_not_available` with `required_step`.
  5. Going **backwards** is possible only via `DOCUMENTS_REJECTED → DOCUMENTS_PENDING`. Approved
     documents are not re-requested; only the rejected ones are re-uploaded.
  6. `review_cycle` ≥ 4 raises an internal admin flag `excessive_resubmission` (no automatic block).

- **Acceptance criteria**:
  1. **Given** `onboarding_state='DOCUMENTS_PENDING'`, **when** the client calls the Stripe-connect endpoint, **then** `409 step_not_available` with `required_step:"DOCUMENTS_APPROVED"` is returned and no external call is made.
  2. **Given** an admin rejects the halal certificate only, **when** the restaurant fetches status, **then** `onboarding_state='DOCUMENTS_REJECTED'`, `rejection.documents` lists exactly the halal certificate with its `review_note`, and the three approved documents retain `status='APPROVED'`.
  3. **Given** a restaurant that re-uploads the rejected halal certificate, **when** it calls `documents/submit`, **then** state becomes `DOCUMENTS_REVIEW`, `review_cycle` is 2, and the previously approved documents are not re-queued for review.
  4. **Given** all steps complete except a published menu item, **when** status is fetched, **then** `onboarding_state='MENU_PENDING'`, `progress_percent=90`, and `blocking_reason='no_live_menu_item'`.

- **Out of scope**: partial-approval trading (a restaurant cannot take orders with any required
  document unapproved); parallel step completion; admin-initiated onboarding on the restaurant's
  behalf; onboarding for additional locations of an existing restaurant (**D-15**).

- **Version**: V1
- **Size**: M

---

### R-05 — Business profile submission (onboarding step 1)

- **SOW trace**: *"Restaurants can register… by providing basic details (e.g., name, location, cuisine type)"* and *"Profile Management: Update restaurant details (e.g., address, contact information, cuisine type, operating hours)"* (SOW §2, Restaurants §1).

- **Behaviour**: A single form captures the operational identity of the restaurant: owner contact,
  public description, address, geographic coordinates, cuisine types, average preparation time and
  timezone. Coordinates are chosen by typing into a map search, then dragging the pin for precision;
  search and pin-to-address requests go through our API, which forwards to Mapbox
  ([setting a location](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), [map address search](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  The server **derives and validates** them rather than trusting the client blindly. Saving a valid profile advances `PROFILE_PENDING → DOCUMENTS_PENDING`.

- **Data** (all on `restaurant` unless noted):
  `display_name, legal_name, owner_first_name, owner_last_name, phone_e164, description,
   address_line1, address_line2, city, province_code, postal_code, country_code, lat, lng,
   coords geography(Point,4326), timezone, cuisine_type_ids[], avg_prep_minutes, gst_hst_number`
  plus lookup `cuisine_type(id, name, slug, is_halal_relevant, sort_order)`.

- **States**: no entity states of its own. Drives `onboarding_state PROFILE_PENDING → DOCUMENTS_PENDING`
  on first valid save. Post-approval edits are governed by **R-12**.

- **Rules**:
  1. `country_code` is fixed to `CA`. `province_code` must be one of the 13 ISO 3166-2:CA codes
     (`AB BC MB NB NL NS NT NU ON PE QC SK YT`). Anything else → `422 unsupported_country`.
     **This replaces the current system's Malaysia/India/Dubai defaults.**
  2. `postal_code` must match `^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$`
     (Canadian FSA/LDU), stored uppercased with a single space.
  3. `phone_e164` must match `^\+1[2-9]\d{9}$`. **The `+91` default in the shared auth package is a
     defect and must not be ported.**
  4. `gst_hst_number` optional; if present must match `^\d{9}RT\d{4}$` (CRA business number +
     program identifier). **The Indian GSTIN regex must not be ported.**
  5. `lat`/`lng` required, and must fall inside the Canadian bounding box
     (lat 41.6–83.2, lng −141.1–−52.5). Outside → `422 coordinates_outside_service_area`.
  6. `coords` is written in the **same statement** as `lat`/`lng` using
     `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`. There is exactly one geographic column
     used by dispatch and discovery. **The legacy `location POINT` column is not created.** (This
     eliminates the current geo split-brain where every checkout dies at rider assignment.)
  7. `description` 20–1000 chars. `avg_prep_minutes` integer 5–120.
  8. `timezone` must be an IANA zone whose country is CA; defaulted from `province_code` and
     overridable.
  9. `cuisine_type_ids` 1–5 entries from the server-managed lookup. Free-text cuisine is rejected.
  10. The map pin is authoritative; the address fields may be filled from the pin through the same
      API, and the text is stored as the owner confirms it. A mismatch check (pin vs. postal-code centroid > 5 km) raises a
      soft warning shown to the admin reviewer, not a hard failure.

- **Acceptance criteria**:
  1. **Given** a profile with `lat=3.1478, lng=101.7128` (Kuala Lumpur), **when** it is submitted, **then** `422 coordinates_outside_service_area` is returned and `onboarding_state` remains `PROFILE_PENDING`.
  2. **Given** a valid Ontario profile, **when** it is saved, **then** `SELECT ST_Y(coords::geometry), ST_X(coords::geometry)` returns the submitted lat/lng to 6 decimal places, and `onboarding_state` is `DOCUMENTS_PENDING`.
  3. **Given** `phone_e164='+919876543210'`, **when** the profile is saved, **then** `422` with `field_errors:[{field:"phone_e164",code:"non_canadian_number"}]`.
  4. **Given** `gst_hst_number='27AAPFU0939F1ZV'` (an Indian GSTIN), **when** the profile is saved, **then** `422 invalid_gst_hst_number`.
  5. **Given** a saved profile, **when** the same payload is re-submitted, **then** `200` is returned, the row is unchanged apart from `updated_at`, and no duplicate audit entry with an empty diff is written.

- **Out of scope**: address searches sent from the browser straight to a map provider; multiple
  addresses per restaurant; delivery-radius configuration (platform-owned); French-language profile
  fields (V3); social links; restaurant website field.

- **Version**: V1
- **Size**: M

---

### R-06 — Operating hours, holidays and temporary closure

- **SOW trace**: *"Profile Management: Update restaurant details (e.g., address, contact information, cuisine type, **operating hours**)"* (SOW §2, Restaurants §1).

- **Behaviour**: Hours are a set of weekly intervals in restaurant-local time, plus date-specific
  overrides (holidays, one-off closures), plus a "pause new orders for N minutes" control. The
  server computes `is_open_now` and **enforces** it: an order for a closed restaurant is rejected at
  the customer's checkout, not discovered later. This replaces the current
  `opening_time`/`closing_time` pair which is stored and enforced nowhere.

- **Data**:
  ```
  restaurant_hours(id, restaurant_id, day_of_week 0..6, opens_at time, closes_at time,
                   crosses_midnight bool, sort_order)          -- up to 3 intervals per day
  restaurant_hours_override(id, restaurant_id, date, is_closed bool,
                            opens_at time NULL, closes_at time NULL, reason)
  restaurant.pause_until timestamptz NULL, pause_reason
  ```

- **States**: derived, not stored — `open_state ∈ {OPEN, CLOSED_HOURS, CLOSED_HOLIDAY, PAUSED, CLOSED_TOGGLE, CLOSED_SUSPENDED, CLOSED_OFFLINE}`, evaluated in that precedence order.
  Transitions are time-driven (clock crossing an interval boundary) or action-driven (`pause`, `resume`, toggle in R-22, suspension in R-36).

- **Rules**:
  1. Up to **3** intervals per weekday (e.g. lunch and dinner service). Overlapping intervals on the
     same day → `422 overlapping_hours`.
  2. An interval whose `closes_at <= opens_at` is interpreted as crossing midnight and sets
     `crosses_midnight=true`; the maximum single interval is 24h.
  3. A day with zero intervals means closed all day.
  4. `restaurant_hours_override` beats the weekly schedule for that date. Overrides may be created up
     to 365 days ahead; a nightly job deletes overrides older than 90 days.
  5. **Last-order cutoff**: new orders are refused from `closes_at − avg_prep_minutes`. A restaurant
     is never handed an order it cannot finish before closing.
  6. `pause_until` accepts only the values 15, 30, 60 minutes or "until closing" (the restaurant's
     next closing time, past midnight included), which replaces "rest of today"; an API change
     ([pausing on late nights](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), ["for how long" options](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
     Pausing does **not** affect already-accepted orders.
  7. Editing hours while orders are in flight is allowed and has no effect on them.
  8. `is_open_now` is computed server-side in the restaurant's timezone with DST handled by the
     IANA database. It is exposed on the customer feed and re-checked at checkout; a checkout for a
     closed restaurant → `409 restaurant_closed` with `next_open_at`.
  9. Changing hours takes effect immediately. There is no admin approval for hours. Hours stay
     editable while the restaurant is suspended and become read-only once it is deactivated
     ([opening hours while suspended](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

- **Acceptance criteria**:
  1. **Given** Friday hours `11:00–14:00` and `17:00–23:00` in `America/Toronto` and `avg_prep_minutes=20`, **when** a customer checks out at 22:45 local, **then** `409 restaurant_closed` is returned with `next_open_at` = the next Saturday opening instant in UTC.
  2. **Given** a Saturday interval `20:00–02:00`, **when** `is_open_now` is evaluated at 00:30 Sunday local, **then** it is `true` and `open_state='OPEN'`.
  3. **Given** an override `{date: 2026-12-25, is_closed: true}`, **when** hours are evaluated on that date, **then** `open_state='CLOSED_HOLIDAY'` regardless of the weekly schedule.
  4. **Given** the DST spring-forward night in `America/Toronto` and an interval `01:00–04:00`, **when** `is_open_now` is evaluated, **then** no panic occurs and the interval is treated as `03:00–04:00` local.
  5. **Given** `pause_until = now + 30m`, **when** an order is already `ACCEPTED`, **then** it remains `ACCEPTED` and its status timeline is unaffected.

- **Out of scope**: per-menu-item availability windows (breakfast-only items) — V2; per-category
  hours; seasonal schedules; capacity-based auto-pause (order-volume throttling) — V3; statutory
  holiday auto-population.

- **Version**: V1
- **Size**: M

---
### R-07 — Compliance document upload

- **SOW trace**: *"uploading necessary legal documents (e.g., business license, FSSAI certificate, Halal Certificate)"* and *"Document Verification: Upload and submit legal documents for verification."* (SOW §2, Restaurants §1).

- **Behaviour**: The restaurant uploads a fixed pack of documents through a three-call presigned flow
  so that file bytes never traverse the API: `POST documents/upload-url` (server validates intent,
  mints a Silo presigned `PUT`, creates a `media` row in `PENDING_UPLOAD`) → client `PUT`s the bytes
  directly to Silo → `POST documents/confirm` (server `HEAD`s the object, verifies size and
  content-type, computes checksum, flips `media` to `STORED` and creates/replaces the
  `restaurant_document` row). Documents live in a **private** bucket; they are readable only through
  short-lived presigned GETs issued to the owning restaurant or to an admin (R-08).

> **Decided:** the four required documents below replace FSSAI; a CRA business number replaces GSTIN; liability insurance stays hidden until V2 ([FSSAI certificate](../decisions/README.md#settled--reconciliations), [liability insurance upload](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).

> **Decided:** three seeded certifying bodies, extensible by a super admin; any other body sends the application to "waiting on certifying body" ([accepted certifying bodies](../decisions/README.md#settled--client-decisions), [body not on the accepted list](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

> ⚠️ **FSSAI is replaced.** See §1.5. The V1 required pack for Canada is:

  | `doc_type` | What it is | Required | Extra fields captured |
  |---|---|---|---|
  | `BUSINESS_LICENCE` | Municipal business licence or provincial incorporation / master business licence | yes | `issuer_name`, `document_number`, `expires_on` (optional) |
  | `HALAL_CERTIFICATE` | Certificate from a recognised Canadian halal certifier | yes | `issuer_name` (from allowlist, **D-10**), `document_number`, `issued_on`, `expires_on` (**required**) |
  | `FOOD_SAFETY` | Provincial/municipal food-premises permit **or** food-handler certification | yes | `issuer_name`, `expires_on` (**required**) |
  | `OWNER_ID` | Government photo ID of the signing owner/director | yes | `expires_on` (required) |
  | `LIABILITY_INSURANCE` | Commercial general liability certificate | no (V2) | `issuer_name`, `expires_on` |

- **Data**:
  - `media(id, owner_type='RESTAURANT_DOCUMENT', owner_id, bucket='hg-private', object_key, mime_type, size_bytes, checksum_sha256, visibility='PRIVATE', upload_state, created_at)`
  - `restaurant_document(id, restaurant_id, doc_type, media_id, status, issuer_name, document_number, issued_on, expires_on, version, superseded_by_id, review_note, reviewed_by_admin_id, reviewed_at, created_at)`
  - Object key: `restaurants/{restaurant_id}/documents/{doc_type}/{media_id}.{ext}` — never a client-supplied filename.

- **States**:
  - `media.upload_state`: `PENDING_UPLOAD --confirm(HEAD ok)--> STORED`;
    `PENDING_UPLOAD --presign TTL elapsed, nightly sweep--> ABANDONED` (object and row deleted).
  - `restaurant_document.status`: `UPLOADED --submit(R-08)--> IN_REVIEW`;
    `IN_REVIEW --admin approve--> APPROVED`; `IN_REVIEW --admin reject--> REJECTED`;
    `UPLOADED|REJECTED --restaurant re-uploads same doc_type--> SUPERSEDED` (new row, `version`+1);
    `APPROVED --expires_on passed--> EXPIRED` (nightly job, R-10).

- **Rules**:
  1. Accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. The server
     verifies the **actual** content type by magic-byte sniffing on `confirm`, not the client's
     declaration. Mismatch → `422 content_type_mismatch` and the object is deleted.
  2. Max size **10 MB** per file. Enforced twice: in the presigned policy (`content-length-range`)
     and again on `confirm` via `HEAD`. Min size 10 KB (rejects blank/placeholder files).
  3. PDFs: max 20 pages. Images: min 600×600 px.
  4. Presigned `PUT` TTL **15 minutes**, single object key, `Content-Type` and content-length pinned
     in the policy. Presigned `GET` TTL **5 minutes**.
  5. The bucket is **private**, with public access explicitly denied by policy. A KYC document must
     never be reachable by an unauthenticated URL. *(The legacy mobile path wrote licences and halal
     certificates to a world-readable Supabase bucket — that path is deleted, not ported.)*
  6. `expires_on` must be a future date at upload time; an already-expired certificate →
     `422 document_already_expired`.
  7. `HALAL_CERTIFICATE.issuer_name` must be selected from the server-managed
     `halal_certifier` allowlist (**D-10**); `OTHER` is permitted, and the reviewer then marks the
     application "waiting on certifying body" until a super admin decides on that body
     ([body not on the accepted list](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  8. Re-uploading a `doc_type` supersedes the previous row rather than mutating it. Full history is
     retained for audit; only the newest non-superseded row is "current".
  9. Uploads are permitted only in `onboarding_state ∈ {DOCUMENTS_PENDING, DOCUMENTS_REJECTED}` or,
     post-activation, for renewal (R-10). Otherwise `409 step_not_available`.
  10. Rate limit 20 `upload-url` calls per hour per restaurant.
  11. A document is attached only from the caller's own confirmed compliance upload: uploaded by
      the owner or manager attaching it, `READY`, not deleted, uploaded as a `KYC_DOCUMENT`, and
      not attached to another restaurant's or rider's documents. Anything else is `404`, the same
      answer as a file that does not exist, and nothing is written. A download link goes to whoever
      owns the document, so attaching a file another account uploaded would hand over its bytes
      ([#359](https://github.com/shaiknoorullah/hg-mono/issues/359)). The download link is also
      refused when a document's file is not its restaurant's own upload, and restaurant staff, who
      cannot list the documents, cannot download them either.
  12. Attaching a file that is already attached as that type, including two attaches of it at once,
      returns the existing document and adds nothing: no second review item, and for a halal
      certificate no second certificate superseding the first. The database refuses a second
      document for one file ([#360](https://github.com/shaiknoorullah/hg-mono/issues/360)). A
      different file is a re-upload, as in rule 8.

- **Acceptance criteria**:
  1. **Given** a presigned URL minted for `HALAL_CERTIFICATE` with a 10 MB limit, **when** the client `PUT`s an 11 MB file, **then** Silo rejects the upload with `EntityTooLarge` and `confirm` subsequently returns `409 upload_not_found`.
  2. **Given** a file whose declared type is `application/pdf` but whose bytes begin `MZ`, **when** `confirm` is called, **then** `422 content_type_mismatch` is returned, the Silo object is deleted, and no `restaurant_document` row exists.
  3. **Given** a stored document, **when** its `object_key` is requested from Silo without a signature, **then** HTTP `403` is returned — verified by an integration test against the live bucket policy.
  4. **Given** a `BUSINESS_LICENCE` at `version=1` with `status='REJECTED'`, **when** a new business licence is uploaded, **then** a `version=2` row is created with `status='UPLOADED'`, the v1 row becomes `SUPERSEDED`, and `GET /documents` returns only v2 as current.
  5. **Given** a `HALAL_CERTIFICATE` with `expires_on` yesterday, **when** `confirm` is called, **then** `422 document_already_expired` and no document row is created.

- **Out of scope**: OCR/auto-extraction of certificate fields; virus scanning (V2 — ClamAV sidecar);
  automated verification against certifier registries; document translation; e-signature; storing
  documents in any bucket other than Silo; the legacy Supabase/Payload-CMS upload path (deleted).

- **Version**: V1
- **Size**: L

---

### R-08 — Document pack submission and admin verification review

- **SOW trace**: *"Upload and submit legal documents for verification"* (SOW §2, Restaurants §1); *"Restaurant Onboarding: Review and approve restaurant registrations and documents"*, *"Halal Certification Verification: Verify and approve Halal certifications for restaurants. Track verification status (pending, approved, rejected)"*, *"Restaurant Approval/Rejection"* (SOW §2, Admin §1).

- **Behaviour**: When all four required documents are `UPLOADED`, the restaurant calls
  `documents/submit`, which atomically flips them to `IN_REVIEW` and the restaurant to
  `DOCUMENTS_REVIEW`, and enqueues a review task. An admin opens the review queue, views each
  document through a 5-minute presigned GET, and records a per-document decision plus an overall
  decision. **Approval requires every required document to be approved**; a single rejection rejects
  the pack. Every decision is attributed to the admin's authenticated identity — never to an
  `admin_id` taken from a request body.

- **Data**:
  - `restaurant_review_task(id, restaurant_id, review_cycle, state, assigned_admin_id, submitted_at, first_opened_at, decided_at, sla_due_at, decision, decision_note)`
  - `restaurant_document.status/review_note/reviewed_by_admin_id/reviewed_at` (R-07)
  - `document_rejection_reason` enum: `ILLEGIBLE`, `EXPIRED`, `WRONG_DOCUMENT_TYPE`, `NAME_MISMATCH`, `ADDRESS_MISMATCH`, `UNRECOGNISED_CERTIFIER`, `SUSPECTED_FORGERY`, `INCOMPLETE_PAGES`, `OTHER`.

- **States**: `restaurant_review_task`: `QUEUED --admin opens--> IN_PROGRESS`;
  `IN_PROGRESS --approve all--> APPROVED`; `IN_PROGRESS --reject ≥1--> REJECTED`;
  `IN_PROGRESS --admin releases--> QUEUED`; `QUEUED|IN_PROGRESS --restaurant withdraws--> CANCELLED`.
  Drives `onboarding_state DOCUMENTS_REVIEW → DOCUMENTS_APPROVED | DOCUMENTS_REJECTED` (R-04).

- **Rules**:
  1. `documents/submit` requires all four required `doc_type`s to have a current row with
     `status='UPLOADED'`. Otherwise `422 incomplete_document_pack` listing the missing types.
  2. Submission is idempotent: a second submit while `DOCUMENTS_REVIEW` returns `200` with the
     existing task, not a duplicate.
  3. Documents are **immutable** while `IN_REVIEW`. An upload attempt for a doc_type in review →
     `409 document_locked_for_review`.
  4. Rejection requires a `reason_code` from the enum **and** a `review_note` of ≥20 characters when
     the code is `OTHER`. *(The current admin UI collects the reason via a browser `prompt()` — not
     acceptable; this is a structured form.)*
  5. Review SLA: `sla_due_at = submitted_at + 2 business days` in `America/Toronto`. Breach raises an
     admin dashboard flag. Restaurants are told to expect a decision "within 3 business days"
     ([document review time](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
     **No auto-approval on SLA breach, ever** — menu changes are never auto-approved either
     ([menu approval](../decisions/README.md#settled--reconciliations)).
  6. Approving the pack sets `documents_approved_at`, transitions to `PAYOUT_PENDING`, and emits
     `restaurant.documents.approved` (R-09, R-34).
  7. Rejecting sets `DOCUMENTS_REJECTED`, marks only the failing documents `REJECTED` (approved ones
     keep `APPROVED`), and emits `restaurant.documents.rejected` with the per-document notes.
  8. An admin cannot review their own restaurant application (email-domain and explicit
     `admin_id != restaurant_user_id` checks); attempts are audited and blocked.
  9. Presigned document GETs issued to admins are logged as `document_viewed` audit events with the
     admin id, document id and timestamp.

- **Acceptance criteria**:
  1. **Given** three of four required documents uploaded, **when** `documents/submit` is called, **then** `422 incomplete_document_pack` with `missing:["FOOD_SAFETY"]` and `onboarding_state` stays `DOCUMENTS_PENDING`.
  2. **Given** a task in `IN_PROGRESS`, **when** the admin approves 3 documents and rejects the halal certificate with `reason_code='EXPIRED'`, **then** the task decision is `REJECTED`, `onboarding_state='DOCUMENTS_REJECTED'`, exactly one restaurant-facing notification is emitted, and the three approved documents are not re-queued on the next cycle.
  3. **Given** a document with `status='IN_REVIEW'`, **when** the restaurant requests a new upload URL for that `doc_type`, **then** `409 document_locked_for_review`.
  4. **Given** an admin approval, **when** the audit log is read, **then** exactly one row exists with `actor_type='ADMIN'`, the admin's session-derived id, `action='restaurant.documents.approve'`, and a before/after diff — and **no** code path accepted an `admin_id` from the request body.
  5. **Given** an approved pack, **when** the restaurant fetches status, **then** `onboarding_state='PAYOUT_PENDING'` within 5 seconds of the admin's click (R-09).

- **Out of scope**: multi-reviewer consensus; risk scoring; automated forgery detection; appeals
  workflow beyond re-upload; admin bulk-approval; approving a restaurant with an incomplete pack;
  re-verifying documents on a fixed calendar (R-10 handles expiry only).

- **Version**: V1
- **Size**: L

---

### R-09 — Verification status tracking ("real-time")

- **SOW trace**: *"Track the verification status in real-time."* (SOW §2, Restaurants §1). *"Track verification status (pending, approved, rejected)"* (SOW §2, Admin §1).

- **Behaviour**: "Real-time" is given a mechanical definition rather than left as an adjective.
  The restaurant web app holds one authenticated **Server-Sent Events** stream,
  `GET /v1/restaurant/events` (`text/event-stream`). Any change to onboarding state, document status,
  payout-account state or account status publishes an event to Redis pub/sub channel
  `rt:restaurant:{restaurant_id}`, which the binary fans out to that restaurant's open SSE
  connections. The client also holds a **15-second ETag-conditional poll** of
  `GET /v1/restaurant/onboarding/status` as a fallback, and every terminal decision additionally
  sends an email. The status endpoint is the single source of truth; SSE is a latency optimisation,
  never the only delivery path.

  > **Definition of done for "real-time"**: p95 latency from the admin's decision commit to the
  > restaurant UI reflecting it is **≤ 5 seconds** while SSE is connected, and **≤ 20 seconds**
  > with SSE unavailable (poll fallback). This is an asserted, measured number.

- **Data**:
  - `restaurant_event(id, restaurant_id, seq bigserial, event_type, payload_json, created_at)` — a
    durable per-restaurant event log, retained 30 days.
  - SSE frames: `id: {seq}`, `event: {event_type}`, `data: {json}`.
  - Redis channel `rt:restaurant:{id}`; Redis key `rt:presence:{restaurant_id}` (TTL 60 s, refreshed
    by heartbeat) records live connections.
  - Event types (V1): `onboarding.state_changed`, `document.status_changed`,
    `payout_account.state_changed`, `account.status_changed`, `order.offered`, `order.updated`,
    `menu_item.review_decided`, `payout.state_changed`.

- **States**: SSE connection: `CONNECTING --200 + headers--> OPEN`; `OPEN --network loss--> RECONNECTING`
  (client `EventSource` auto-retry with server-sent `retry: 3000`, exponential to 30 s);
  `RECONNECTING --Last-Event-ID replay--> OPEN`; `OPEN --24h max age or session revoked--> CLOSED`.

- **Rules**:
  1. The SSE endpoint authenticates from the session cookie. An unauthenticated or cross-restaurant
     request → `401`/`403`. There is **no** client-declared `userId`/`userType` handshake.
     *(The current WebSocket gateway trusts whatever the client claims and lets any client
     impersonate any restaurant; that design is not ported.)*
  2. Reconnect carries `Last-Event-ID`; the server replays every `restaurant_event` with
     `seq > last_id` (max 500, else instructs a full refetch). **Event delivery is non-destructive** —
     reading never deletes. *(The current offline queue is drained with `DEL`, so a reconnect
     permanently consumes another user's notifications; not ported.)*
  3. Heartbeat comment frame every 25 s to defeat proxy idle timeouts. Traefik is configured with
     buffering disabled and `readTimeout` ≥ 90 s on this route.
  4. Max 5 concurrent SSE connections per restaurant; the oldest is closed beyond that.
  5. The status endpoint returns a strong `ETag`; a conditional GET returns `304` with no body.
  6. Any state change writes `restaurant_event` **inside the same transaction** as the state change,
     then publishes to Redis after commit. If Redis is down, the poll fallback still delivers —
     correctness never depends on the message bus.
  7. Terminal onboarding decisions (approved/rejected) additionally send email regardless of
     connection state.

- **Acceptance criteria**:
  1. **Given** an open SSE stream, **when** an admin approves the document pack, **then** an `onboarding.state_changed` frame carrying `{from:"DOCUMENTS_REVIEW",to:"DOCUMENTS_APPROVED"}` is received in ≤5 s at p95 over 100 trials.
  2. **Given** the SSE connection is severed after `seq=42`, **when** the client reconnects with `Last-Event-ID: 42`, **then** every event with `seq>42` is replayed in order and none was consumed by the disconnect.
  3. **Given** Redis is stopped, **when** an admin approves the pack, **then** the restaurant's 15-second poll reflects the new state within 20 s and no event is lost from `restaurant_event`.
  4. **Given** restaurant A's session, **when** it opens SSE and restaurant B's document is approved, **then** A receives no frame referencing B.

- **Out of scope**: WebSockets (SSE is sufficient — the restaurant surface has no client→server
  streaming need); mobile push for onboarding (email only in V1); event replay beyond 30 days;
  exactly-once delivery guarantees (at-least-once with `seq` de-duplication on the client).

- **Version**: V1
- **Size**: M

---

### R-10 — Document expiry, renewal and compliance suspension

- **SOW trace**: *"Halal Certification Verification: Verify and approve Halal certifications… Track verification status"* and *"Compliance Monitoring: Ensure restaurants comply with platform policies"* (SOW §2, Admin §1). Derived requirement: a halal certificate has an expiry date, and the platform's entire value proposition is that halal claims are currently valid.

- **Behaviour**: A nightly job (03:00 `America/Toronto`) evaluates every current, approved
  `restaurant_document` with a non-null `expires_on`. It sends renewal reminders 30, 14, 7 and 1
  days before expiry ([certificate renewal reminders](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)),
  and on the expiry date it marks the document `EXPIRED`. An expired **halal certificate**
  or **food safety** document automatically moves the restaurant to `SUSPENDED` with
  `suspension_reason='DOCUMENT_EXPIRED'`. Renewal is a normal R-07 upload plus an R-08 review of just
  that document; approval restores `ACTIVE` automatically.

  > **DECISION REQUIRED — expired-document consequence**: auto-suspend, flag only, or allow a grace period? · **Proposed default**: an expired `HALAL_CERTIFICATE` or `FOOD_SAFETY` triggers **automatic suspension with no grace period**; an expired `OWNER_ID` or `BUSINESS_LICENCE` raises an admin flag only. Reminders 30, 14, 7 and 1 days before expiry (decided: [certificate renewal reminders](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)). · **Why**: a grace period means knowingly serving orders under an expired halal certificate, which is the one failure that destroys the platform's reason to exist. *(D-12)*

- **Data**: `restaurant_document.expires_on`, `restaurant.suspension_reason`,
  `document_reminder(id, restaurant_document_id, offset_days, sent_at)` (idempotency guard so a
  reminder is sent at most once per offset per document).

- **States**: document `APPROVED --expires_on < today--> EXPIRED`;
  `EXPIRED --new version uploaded--> SUPERSEDED` and the new row runs `UPLOADED → IN_REVIEW → APPROVED`.
  Restaurant `ACTIVE --required doc EXPIRED--> SUSPENDED(DOCUMENT_EXPIRED)`;
  `SUSPENDED(DOCUMENT_EXPIRED) --replacement APPROVED and no other blocker--> ACTIVE` (automatic).

- **Rules**:
  1. Documents with expiry tracked: `HALAL_CERTIFICATE` (required), `FOOD_SAFETY` (required),
     `OWNER_ID` (required), `BUSINESS_LICENCE` (optional field), `LIABILITY_INSURANCE` (V2).
  2. Expiry of `HALAL_CERTIFICATE` or `FOOD_SAFETY` → automatic suspension. Expiry of `OWNER_ID` or
     `BUSINESS_LICENCE` → admin flag only, no suspension (**D-12**).
  3. Suspension takes effect at the start of the expiry date in restaurant-local time and follows
     R-36 semantics exactly: no new offers, all accepted orders run to completion.
  4. Renewal may be uploaded from T−60 days. Uploading a renewal does **not** lift a suspension;
     admin approval does.
  5. Reminders go to the owner email + in-app banner + `restaurant_event`. Each reminder is sent at
     most once (enforced by the unique `(restaurant_document_id, offset_days)` index).
  6. The suspension banner names the document, the expiry date and the exact action required.
  7. The nightly job is idempotent and safe to re-run; it is driven by a single advisory lock so two
     binary instances cannot double-suspend.

- **Acceptance criteria**:
  1. **Given** a halal certificate expiring in 30 days, **when** the nightly job runs, **then** exactly one T−30 reminder is recorded and re-running the job the same day sends nothing further.
  2. **Given** a halal certificate whose `expires_on` is today, **when** the job runs at 03:00 local, **then** the document is `EXPIRED`, `account_status='SUSPENDED'`, `suspension_reason='DOCUMENT_EXPIRED'`, and a customer attempting checkout receives `409 restaurant_unavailable`.
  3. **Given** a suspended restaurant with one order already `PREPARING`, **when** suspension takes effect, **then** that order still transitions to `READY_FOR_PICKUP` and `DELIVERED` normally.
  4. **Given** a renewed halal certificate approved by an admin and no other blocker, **when** approval commits, **then** `account_status` returns to `ACTIVE` in the same transaction and an `account.status_changed` event is emitted.

- **Out of scope**: automatic verification against certifier registries; grace periods (**D-12**);
  provincial-specific renewal calendars; insurance-expiry suspension (V2).

- **Version**: V1
- **Size**: M

---

### R-11 — Payout account: add and verify bank details

- **SOW trace**: *"Add & Verify Bank Account: Add bank account details. Submit for verification and track verification status (pending, verified, failed)."* (SOW §2, Restaurants §6).

- **Behaviour**: The platform does **not** store bank credentials. Bank details are collected by
  **Stripe Connect (Express, country CA, currency CAD)** through a hosted onboarding session; the
  platform stores only the Stripe account id and the derived capability flags. The restaurant clicks
  "Set up payouts", the server creates or reuses a Connect account and an Account Link, and redirects
  the browser to Stripe. Stripe returns to `/onboarding/payouts/complete`; the authoritative state
  comes from the `account.updated` **webhook**, not from the return URL.

- **Data**:
  ```
  payout_account(id, restaurant_id UNIQUE, provider='STRIPE', stripe_account_id,
                 state, charges_enabled bool, payouts_enabled bool, details_submitted bool,
                 requirements_currently_due text[], requirements_disabled_reason,
                 bank_last4, bank_institution_name, default_currency='cad',
                 onboarding_link_expires_at, created_at, updated_at)
  webhook_event(id, provider, provider_event_id UNIQUE, type, payload_json,
                received_at, processed_at, process_error)
  ```

- **States** (`payout_account.state`):

  | From | To | Trigger |
  |---|---|---|
  | — | `NOT_STARTED` | restaurant reaches `PAYOUT_PENDING` |
  | `NOT_STARTED` | `LINK_ISSUED` | Account Link created |
  | `LINK_ISSUED` | `PENDING_VERIFICATION` | webhook: `details_submitted=true`, `payouts_enabled=false` |
  | `LINK_ISSUED` | `LINK_EXPIRED` | link TTL elapsed without completion |
  | `LINK_EXPIRED` | `LINK_ISSUED` | restaurant requests a new link |
  | `PENDING_VERIFICATION` | `READY` | webhook: `payouts_enabled=true` |
  | `PENDING_VERIFICATION` | `ACTION_REQUIRED` | webhook: `requirements.currently_due` non-empty |
  | `ACTION_REQUIRED` | `LINK_ISSUED` | restaurant requests a remediation link |
  | `READY` | `RESTRICTED` | webhook: `payouts_enabled` flips false (e.g. failed verification) |
  | `RESTRICTED` | `READY` | webhook: `payouts_enabled` true again |

  `READY` maps to the SOW's *verified*; `PENDING_VERIFICATION` to *pending*; `RESTRICTED`/`ACTION_REQUIRED` to *failed*.

- **Rules**:
  1. No bank account number, transit number, institution number or SIN is ever accepted by, or
     stored in, the HalalGoes database. `bank_last4` and `bank_institution_name` are display-only
     values echoed back by Stripe.
  2. Account Link TTL is Stripe's (a few minutes); the server records
     `onboarding_link_expires_at` and refuses to reuse an expired link, minting a new one instead.
  3. Webhooks are **signature-verified** (`Stripe-Signature`, tolerance 300 s). Unverified → `400`
     and no processing. `provider_event_id` is unique — replays are acknowledged `200` and skipped.
  4. Return- and refresh-URL handlers are **advisory only**: they trigger a fresh `Account.Retrieve`
     and then render whatever the stored state says. They never write state from URL parameters.
     Error paths redirect to `/login` (an existing route) — *the current `/auth/login` redirect is a
     dead route and is a defect not to be ported.*
  5. `onboarding_state PAYOUT_PENDING → MENU_PENDING` occurs only on `state='READY'`.
  6. A restaurant cannot become `ACTIVE` or take its first order until `payout_account.state` is
     `READY`. One that was `READY` and is later `RESTRICTED` keeps taking orders: earnings build up
     and are paid on the next Monday payout after Stripe is fixed, and a banner asks the owner to
     fix it ([restricted payouts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), [which partners keep working](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [held payout release](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01);
     contract change: [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)).
  7. Only one payout account per restaurant. Changing bank details is done inside Stripe's hosted
     flow, re-entered through a fresh Account Link.
  8. Stripe API calls carry an idempotency key derived from `(restaurant_id, operation, attempt)`.

- **Acceptance criteria**:
  1. **Given** `payout_account.state='NOT_STARTED'`, **when** the restaurant starts payout setup, **then** a Stripe Express account is created once, state becomes `LINK_ISSUED`, and a second click within the link's TTL reuses the same `stripe_account_id`.
  2. **Given** an `account.updated` webhook with a valid signature and `payouts_enabled=true`, **when** it is processed, **then** state becomes `READY` and `onboarding_state` advances to `MENU_PENDING` in the same transaction.
  3. **Given** the same webhook is re-delivered, **when** it is processed, **then** `200` is returned, no duplicate state transition or event is emitted, and `webhook_event` still holds exactly one row for that `provider_event_id`.
  4. **Given** a webhook with a tampered signature, **when** it is posted, **then** `400 invalid_signature` is returned and nothing is written.
  5. **Given** a database scan of every column, **when** searched for bank-account-number-shaped values, **then** none exist outside `bank_last4`.

- **Out of scope**: manual bank-account entry; micro-deposit verification; PayPal/Interac/wire
  payout methods (**D-07** covers method choice); multiple payout accounts; payouts in any currency
  other than CAD; the SOW's *"Choose preferred payout methods"* beyond Stripe standard payouts (V2,
  R-32).

- **Version**: V1
- **Size**: L

---

### R-12 — Profile management after activation

- **SOW trace**: *"Profile Management: Update restaurant details (e.g., address, contact information, cuisine type, operating hours) and upload images (e.g., logo, menu, restaurant photos)."* (SOW §2, Restaurants §1).

- **Behaviour**: An active restaurant edits its own profile. Fields are partitioned into three
  classes so that low-risk edits are instant while identity- and location-affecting edits go through
  admin review — because address and legal name are what the approved documents attest to, and the
  customer-facing name and description can carry a halal claim.

  | Class | Fields | Effect |
  |---|---|---|
  | **Instant** | `phone_e164`, `cuisine_type_ids`, `avg_prep_minutes`, `logo_media_id`, `cover_media_id`, gallery, hours (R-06) | Live on save |
  | **Reviewed** | `display_name`, `description`, `legal_name`, `address_*`, `lat`/`lng`, `province_code`, `gst_hst_number` | Creates a `profile_change_request`; live values unchanged until an admin approves ([description and customer-facing name](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [GST/HST number](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
  | **Locked** | `email`, `commission_rate_bps`, `account_status`, `onboarding_state`, `slug`, any `*_at`, any id | Not writable by the restaurant at all; `403 field_not_writable` |

- **Data**: `profile_change_request(id, restaurant_id, requested_by_user_id, changes_json,
  state, reason_note, reviewed_by_admin_id, reviewed_at, review_note, created_at)`.

- **States**: `profile_change_request`: `PENDING --admin approve--> APPROVED` (changes applied in the
  approving transaction) · `PENDING --admin reject--> REJECTED` · `PENDING --restaurant withdraws--> WITHDRAWN`
  · `PENDING --superseded by a newer request--> SUPERSEDED`.

- **Rules**:
  1. Only one `PENDING` request per restaurant; a new one supersedes the old.
  2. An address change of more than **500 m** from the approved coordinates additionally requires a
     re-uploaded `BUSINESS_LICENCE` and `FOOD_SAFETY` document (a moved kitchen is a new premises).
  3. Instant edits are applied immediately, audited, and reflected in the customer feed within the
     feed cache TTL (60 s).
  4. `display_name` 2–80 chars; `slug` is derived once at approval and never changes (customer links
     stay stable).
  5. Profile edits never affect in-flight orders. `order_line.name_snapshot` and address snapshots on
     the order are immutable.
  6. `PUT` semantics are **partial** (`PATCH`-like allowlist merge). Omitted fields are untouched; a
     `null` explicitly clears a nullable field.
  7. Coordinates written through this path use the same single `coords` geography column as R-05.
     There is no separate location endpoint. *(The current
     `PUT /api/restaurants/{id}/location` relative-fetch defect disappears by construction.)*

- **Acceptance criteria**:
  1. **Given** an active restaurant, **when** it PATCHes `avg_prep_minutes`, **then** `200` is returned, the value is live immediately, and no `profile_change_request` is created.
  2. **Given** an active restaurant, **when** it PATCHes `address_line1` and `lat`/`lng`, **then** `202` is returned with a `profile_change_request` in `PENDING`, and `GET /v1/restaurant/profile` still shows the old address with `pending_changes` populated.
  3. **Given** a PATCH containing `commission_rate_bps`, **when** it is submitted, **then** `403 field_not_writable` naming that field, and no other field in the same payload is applied.
  4. **Given** a coordinate change of 3 km, **when** it is submitted, **then** the response includes `requires_documents:["BUSINESS_LICENCE","FOOD_SAFETY"]` and the request cannot be approved until both are re-uploaded and approved.

- **Out of scope**: changing the login email; transferring ownership; deleting the restaurant
  (offboarding is R-36); bulk profile import; admin editing profiles on the restaurant's behalf (V2).

- **Version**: V1
- **Size**: M

---

### R-13 — Restaurant imagery (logo, cover, gallery)

- **SOW trace**: *"…and upload images (e.g., logo, menu, restaurant photos)."* (SOW §2, Restaurants §1).

- **Behaviour**: Same three-call presigned flow as R-07 but writing to the **public-read** media
  bucket, because these images are rendered to customers. The server derives and stores three
  renditions per image (thumb 200px, card 600px, full 1600px, WebP + JPEG fallback) synchronously on
  confirm. One `LOGO`, one `COVER`, up to 10 `GALLERY` images.

- **Data**: `media(… bucket='hg-public', visibility='PUBLIC', width_px, height_px, renditions_json)`;
  `restaurant.logo_media_id`, `restaurant.cover_media_id`;
  `restaurant_gallery(id, restaurant_id, media_id, sort_order, caption, created_at)`.

- **States**: `media.upload_state`: `PENDING_UPLOAD → STORED → PROCESSED` (renditions written) ·
  `PENDING_UPLOAD → ABANDONED` (sweep) · `PROCESSED → REPLACED` (a new logo supersedes the old;
  the old object is deleted after 7 days).

- **Rules**:
  1. Accepted: `image/jpeg`, `image/png`, `image/webp`. Max **5 MB**. Min 600×600 for `LOGO`,
     1200×675 for `COVER`, 800×800 for `GALLERY`. Max 6000×6000.
  2. EXIF is stripped (including GPS) on rendition generation. Original is retained privately for 30
     days for dispute purposes, then deleted.
  3. Content-type verified by magic bytes on confirm; animated GIF and SVG are rejected outright.
  4. Public object keys are `restaurants/{restaurant_id}/media/{media_id}_{rendition}.{ext}` —
     unguessable enough to avoid enumeration but explicitly **public**, unlike KYC documents.
  5. Uploading a new `LOGO` atomically repoints `restaurant.logo_media_id`; there is never a moment
     with no logo once one exists.
  6. Restaurant imagery does **not** go through admin approval. Menu item images do (R-16/R-17),
     because they carry food claims.
  7. URLs returned to clients are absolute and built from a single configured `PUBLIC_MEDIA_BASE_URL`.
     *(The current backend returns malformed `host:0/path` URLs that the frontend patches with a
     `fixImageUrl()` hack; the base URL is configuration, and a malformed base fails startup
     validation.)*

- **Acceptance criteria**:
  1. **Given** a 4000×3000 JPEG with GPS EXIF, **when** it is confirmed as `COVER`, **then** three renditions exist, every rendition's EXIF contains no GPS tags, and `renditions_json` lists all three with byte sizes.
  2. **Given** a 12 MB PNG, **when** upload is attempted, **then** the presigned policy rejects it and `confirm` returns `409 upload_not_found`.
  3. **Given** an SVG renamed to `.png`, **when** `confirm` is called, **then** `422 content_type_mismatch` and the object is deleted.
  4. **Given** a stored gallery image, **when** its public URL is fetched anonymously, **then** `200` is returned with `Cache-Control: public, max-age=31536000, immutable`.

- **Out of scope**: image moderation / NSFW detection (V2); AI image generation or enhancement;
  video; the SOW's "upload menu image" as a *document* (a photographed menu is not a menu — menu data
  is structured, R-14/R-15); reordering gallery by drag in V1 (`sort_order` is settable via API).

- **Version**: V1
- **Size**: M

---
### R-14 — Menu and category management

- **SOW trace**: *"Categorize Menu: Organize the menu into categories (e.g., starters, main course, desserts, beverages) for easier navigation."* (SOW §2, Restaurants §2).

- **Behaviour**: Each restaurant has exactly **one** menu, created automatically when the restaurant
  reaches `MENU_PENDING`. Categories are ordered containers of items within that menu. The
  restaurant creates, renames, reorders, deactivates and deletes categories. Categories carry no
  pricing and require no admin approval.

  > *The "one menu" decision removes an entire class of defect from the current system, where the
  > frontend auto-creates a "Main Menu" by POSTing to a route that does not exist, and where a
  > dead `menu_id` UUID is hardcoded in a component.*

- **Data**:
  ```
  menu(id, restaurant_id UNIQUE, name='Main Menu', created_at)
  menu_category(id, restaurant_id, menu_id, name, description, sort_order,
                is_active bool, item_count_cache int, created_at, updated_at, deleted_at)
  ```

- **States**: `menu_category`: `ACTIVE --deactivate--> INACTIVE` (hidden from customers, items
  hidden with it, restaurant still sees it) · `INACTIVE --activate--> ACTIVE` ·
  `ACTIVE|INACTIVE --delete--> DELETED` (soft; only permitted when the category holds zero
  non-deleted items).

- **Rules**:
  1. `name` 1–60 chars, unique per restaurant case-insensitively (`UNIQUE (restaurant_id, lower(name)) WHERE deleted_at IS NULL`). Duplicate → `409 category_name_taken`.
  2. Max **40** categories per restaurant.
  3. `sort_order` is a dense integer sequence maintained server-side; the reorder endpoint accepts the full ordered id list and rewrites it in one transaction. Partial/sparse client-supplied orders are rejected.
  4. Deleting a non-empty category → `409 category_not_empty` with `item_count`. Items must be moved or deleted first. **Deleting a category never deletes items.**
  5. Deactivating a category hides its items from customers immediately but does not change item state; reactivating restores exactly the prior item visibility.
  6. Categories are keyed by id, never by name. *(The current system dedupes cuisines and categories by a slug stored in the display-name column; that is not ported.)*
  7. Category edits are live immediately — no admin approval (see R-17 for what is reviewed).

- **Acceptance criteria**:
  1. **Given** a category named "Starters", **when** a second category "starters" is created, **then** `409 category_name_taken` and only one row exists.
  2. **Given** a category with 3 live items, **when** deletion is attempted, **then** `409 category_not_empty` with `item_count:3` and no rows are modified.
  3. **Given** categories ordered `[A,B,C]`, **when** the reorder endpoint is called with `[C,A,B]`, **then** `sort_order` becomes `0,1,2` for `C,A,B` respectively in a single transaction and a concurrent reorder is serialised, not interleaved.
  4. **Given** a category is deactivated, **when** the customer menu is fetched, **then** neither the category nor its items appear, and the restaurant's own menu view still shows them flagged `is_active:false`.

- **Out of scope**: nested sub-categories; per-category images; category-level availability windows (V2); multiple menus per restaurant (breakfast/lunch menus) — V2, **D-15** adjacent; sharing categories across restaurants.

- **Version**: V1
- **Size**: S

---

### R-15 — Menu item authoring

- **SOW trace**: *"Add/Edit Menu: Create and update the food menu with details like dish names, descriptions, prices, ingredients, dietary information (e.g., vegetarian, vegan, gluten-free), and images."* (SOW §2, Restaurants §2).

- **Behaviour**: An item is a stable identity (`menu_item`) plus a chain of **content versions**
  (`menu_item_version`). Price and availability live on the item and change instantly. Descriptive
  content lives on a version and, when changed, is reviewed by an admin before it reaches customers
  (R-17). Customers always read the item's `live_version_id`; the restaurant reads live + pending.

  **Orders in flight never block a menu edit.** Order lines snapshot
  `item_version_id`, `name_snapshot` and `unit_price_cents` at order creation (§1.2), so no menu edit
  can retroactively change what a customer bought, what the restaurant must cook, or what either
  party pays. There is no "orders in flight" guard and no version pinning beyond the snapshot. Only the
  account state locks the menu: nobody edits it while the restaurant is suspended or banned ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

- **Data**:
  ```
  menu_item(id, restaurant_id, category_id, live_version_id NULL, pending_version_id NULL,
            price_cents bigint CHECK (price_cents BETWEEN 50 AND 50000),
            availability_state, out_of_stock_until, sort_order,
            prep_minutes int NULL, is_signature bool, created_at, updated_at, deleted_at)

  menu_item_version(id, menu_item_id, version int, name, description, ingredients_text,
                    dietary_tags dietary_tag[], allergen_tags allergen_tag[], spice_level 0..3,
                    portion_description, image_media_id, review_status, submitted_at,
                    reviewed_by_admin_id, reviewed_at, review_note, created_at)

  price_change_log(id, menu_item_id, old_price_cents, new_price_cents,
                   changed_by_user_id, pct_change_bps, flagged bool, created_at)
  ```
  `dietary_tag` enum: `VEGETARIAN, VEGAN, GLUTEN_FREE, DAIRY_FREE, NUT_FREE, HALAL_CERTIFIED, SPICY, KETO, LOW_CARB`.
  `allergen_tag` enum (Health Canada priority allergens): `PEANUTS, TREE_NUTS, SESAME, MILK, EGGS, FISH, CRUSTACEANS_MOLLUSCS, SOY, WHEAT_TRITICALE, SULPHITES, MUSTARD`.

- **States**: see R-17 for `menu_item_version.review_status` and R-18 for `availability_state`.
  `menu_item` itself: `DRAFT` (no live version yet) `--first version approved--> LIVE` ·
  `LIVE --delete--> DELETED` (soft; removed from customer view immediately).

- **Rules**:
  1. `name` 2–80 chars, unique per restaurant case-insensitively among non-deleted items.
  2. `description` 0–600 chars. `ingredients_text` 0–1000 chars, free text (structured ingredients are V3).
  3. `price_cents` integer, **CAD 0.50 – CAD 500.00**. Outside → `422 price_out_of_range`.
  4. `dietary_tags` max 6. **`HALAL_CERTIFIED` is not restaurant-settable** — it is derived from the restaurant's approved halal certificate and applied platform-side. A restaurant asserting it directly → `403 field_not_writable`. Any item that contains `contains_alcohol=true` or a pork-derived ingredient keyword is rejected outright (`422 prohibited_ingredient`) against a maintained keyword list.
  5. `allergen_tags` may be empty but the UI must force an explicit "no listed allergens" acknowledgement; the API records `allergens_declared_at`.
  6. Deleting an item is a soft delete. Items referenced by any order are never hard-deleted.
     *(The current system's menu-item delete calls a route that does not exist; this one does.)*
  7. **Price changes are instant and do not require review**, but each is written to `price_change_log`.

  > **DECISION REQUIRED — price-change guardrail**: Should a large price increase be blocked, flagged, or ignored? · **Proposed default**: instant and never blocked, but any increase where `new > old × 1.30` within a rolling 24 h window sets `flagged=true` and raises an admin **compliance** flag (SOW: *"Compliance Monitoring… e.g., pricing"*); more than 5 flagged changes in 7 days raises a review task. · **Why**: bait-and-switch pricing is the main abuse vector when price edits bypass review, and blocking edits outright breaks legitimate supplier-cost changes. *(D-04)*

  8. A price change never affects any existing order, cart line already priced at checkout, or active offer's `original_price_cents` snapshot.
  9. `prep_minutes` optional per item; when absent the restaurant's `avg_prep_minutes` applies.

  > **DECISION REQUIRED — order ETA source**: Is the promised prep time per item, per order, or restaurant-level? · **Proposed default**: `promised_ready_at = accepted_at + max(item.prep_minutes ∪ {restaurant.avg_prep_minutes})`, capped at 90 minutes, and the restaurant may adjust it once at accept time within ±15 minutes. · **Why**: max-of-items is the only rule that does not promise a time the kitchen cannot meet, and a single adjustable knob keeps the accept flow one click. *(D-20)*

- **Acceptance criteria**:
  1. **Given** an item priced at CAD 12.00 with an order already `PREPARING` that contains it, **when** the price is changed to CAD 15.00, **then** the change is live for new carts immediately and the in-flight order's `order_line.unit_price_cents` is still 1200.
  2. **Given** an item price of CAD 10.00, **when** it is changed to CAD 14.00 (+40%), **then** the change succeeds, `price_change_log.flagged=true`, and an admin compliance flag exists.
  3. **Given** a create payload with `dietary_tags:["HALAL_CERTIFIED"]`, **when** it is submitted, **then** `403 field_not_writable` and the item is not created.
  4. **Given** an item whose `ingredients_text` contains "pork belly", **when** it is submitted, **then** `422 prohibited_ingredient` naming the matched term.
  5. **Given** an item referenced by a delivered order, **when** it is deleted, **then** `deleted_at` is set, the customer menu omits it, and the historical order still renders its name and price from the snapshot.

- **Out of scope**: nutritional information / calorie counts (SOW mentions it for the *customer* app — deferred to V2 and sourced from the restaurant then); structured ingredient lists with quantities; recipe/inventory deduction; item-level tax codes (**D-19**); multi-language item names (V3); CSV/bulk menu import (V2); menu scraping from a photographed menu.

- **Version**: V1
- **Size**: L

---

### R-16 — Menu item images

- **SOW trace**: *"…and images"* (SOW §2, Restaurants §2 — Add/Edit Menu).

- **Behaviour**: Identical presigned mechanics to R-13 (public bucket, renditions, EXIF strip), but
  the image is attached to a `menu_item_version`, so **changing an item's photo is a reviewed
  change** (R-17): the new photo sits on the pending version and customers keep seeing the approved
  one until an admin approves.

- **Data**: `menu_item_version.image_media_id` → `media` (public bucket). Renditions: `thumb 200`,
  `card 600`, `hero 1200`, WebP + JPEG.

- **States**: inherits `media.upload_state` (R-13) and `menu_item_version.review_status` (R-17).

- **Rules**:
  1. Exactly **one** image per item version in V1 (no galleries per dish).
  2. Max 5 MB; min 800×800; square-ish enforced by cropping server-side to 1:1 for `thumb`/`card`
     using centre crop; `hero` preserves aspect within 16:9 bounds.
  3. An item may go live without an image; a placeholder is rendered. Images are strongly encouraged,
     not required.
  4. Replacing an image on an item that has **no** pending version creates one containing only the
     image change.
  5. Orphaned `media` rows (`PENDING_UPLOAD` older than 24 h, or `STORED` with no referencing
     version after 24 h) are swept nightly, objects deleted.

- **Acceptance criteria**:
  1. **Given** a live item with an approved image, **when** a new image is uploaded and confirmed, **then** the customer menu still serves the old image and the restaurant view shows `pending_version.image_media_id` set.
  2. **Given** the pending image is approved, **when** the customer menu is fetched, **then** the new image URL is served within the menu cache TTL (60 s) and the old object remains fetchable for 7 days.
  3. **Given** a 300×300 upload, **when** `confirm` is called, **then** `422 image_too_small` with `min:"800x800"`.
  4. **Given** an image uploaded but never attached to a version, **when** the nightly sweep runs 25 h later, **then** the Silo object and the `media` row are gone.

- **Out of scope**: multiple images per dish; video; auto-cropping UI; background removal;
  stock-photo library; image-based dish recognition.

- **Version**: V1
- **Size**: M

---

### R-17 — Menu change approval workflow (admin)

- **SOW trace**: *"Menu Approval: Approve or reject restaurant menus and updates."* (SOW §2, Admin §1).

- **Behaviour**: The SOW requires admin approval of menus. Approving *every* keystroke would make the
  product unusable, so approval is scoped precisely to the fields that carry a **claim to the
  customer** — the words, the picture and the dietary/allergen assertions — while price, availability
  and ordering are operational and instant.

  A restaurant edit to a reviewed field writes a `menu_item_version` with
  `review_status='PENDING_REVIEW'` and leaves `live_version_id` untouched. An admin sees a queue of
  pending versions and approves or rejects each. Approval sets `live_version_id = pending_version_id`
  and clears `pending_version_id` in one transaction.

  > **DECISION REQUIRED — reviewed vs. instant menu fields**: Which menu fields need admin approval before going live? · **Proposed default**: **Reviewed** = `name`, `description`, `ingredients_text`, `dietary_tags`, `allergen_tags`, `image_media_id`, `portion_description`. **Instant** = `price_cents`, `availability_state`, `out_of_stock_until`, `category_id`, `sort_order`, `prep_minutes`, item creation as `DRAFT`, and item deletion. · **Why**: reviewed fields are food-safety and halal claims the platform vouches for; instant fields are operational and would make the queue the bottleneck of every dinner service. *(D-03)*

  > **Decided:** menu changes are never auto-approved; a pending version waits until an admin decides ([menu approval](../decisions/README.md#settled--reconciliations)). The review SLA stays proposed at 4 business hours.

- **Data**: `menu_item_version.review_status, submitted_at, reviewed_by_admin_id, reviewed_at, review_note`;
  `menu_review_task(id, restaurant_id, pending_version_ids uuid[], state, submitted_at, sla_due_at, decided_at, assigned_admin_id)`;
  `menu_rejection_reason` enum: `MISLEADING_DESCRIPTION`, `UNSUBSTANTIATED_HALAL_CLAIM`, `INCORRECT_DIETARY_TAG`, `MISSING_ALLERGEN`, `POOR_IMAGE_QUALITY`, `IMAGE_NOT_OF_DISH`, `PROHIBITED_ITEM`, `OFFENSIVE_CONTENT`, `OTHER`.

- **States** (`menu_item_version.review_status`):

  | From | To | Trigger |
  |---|---|---|
  | — | `PENDING_REVIEW` | restaurant saves a reviewed field; no drafts at launch ([menu drafts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) |
  | — | `APPROVED` | an admin creates the item on the restaurant's behalf; the creator is the reviewer ([menu approval](../decisions/README.md#settled--reconciliations)). Never while the restaurant is suspended or banned ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
  | `PENDING_REVIEW` | `APPROVED` | admin approves |
  | `PENDING_REVIEW` | `REJECTED` | admin rejects with a reason code |
  | `PENDING_REVIEW` | `WITHDRAWN` | restaurant saves again (creates a newer pending version) or cancels |
  | `APPROVED` | `SUPERSEDED` | a newer version is approved |

- **Rules**:
  1. A menu item's **first** version must be `APPROVED` before the item can appear to customers. A
     restaurant cannot reach `account_status='ACTIVE'` with zero live items (R-04).
  2. At most one `PENDING_REVIEW` version per item; a further edit replaces it and resets `submitted_at`.
  3. Rejection requires a `reason_code`; `OTHER` requires a ≥20-char note. The restaurant sees the
     code and note verbatim and can edit and resubmit without limit.
  4. Approval of a version whose item has since been deleted is a no-op returning `409 item_deleted`.
  5. Bulk approve is permitted for one restaurant's whole pending set in a single transaction; bulk
     reject is not (each rejection needs a reason).
  6. Every decision emits `menu_item.review_decided` on the restaurant's event stream (R-09) and an
     email digest at most once per hour.
  7. Every approval, including an item an admin creates, writes `audit_log` with `actor_type='ADMIN'`.

- **Acceptance criteria**:
  1. **Given** a live item, **when** the restaurant changes only `price_cents`, **then** the new price is live immediately, no `menu_item_version` is created, and the admin queue is unchanged.
  2. **Given** a live item, **when** the restaurant changes `description`, **then** customers still see the old description, `pending_version_id` is set, and the admin queue contains one entry.
  3. **Given** a pending version submitted 25 h ago with no admin decision, **when** it is read, **then** it is still `PENDING_REVIEW` and customers still see the previous live version.
  4. **Given** an admin creates an item on a restaurant's behalf, **when** it is saved, **then** its first version is `APPROVED` with that admin as reviewer, and one `audit_log` row records it.
  5. **Given** a restaurant with zero approved item versions, **when** it attempts to go `ACTIVE`, **then** `409 no_live_menu_item`.

- **Out of scope**: approval of categories, hours, offers (offers are reviewed separately in R-21),
  restaurant imagery, or prices; per-field diff UI beyond a before/after JSON; approval delegation to
  support agents (V2); ML-assisted pre-screening (V3).

- **Version**: V1
- **Size**: L

---

### R-18 — Item availability and out-of-stock management

- **SOW trace**: *"Out-of-Stock Management: Mark items as out of stock or temporarily unavailable."* (SOW §2, Restaurants §2).

- **Behaviour**: Availability is a **binary state with an optional auto-restock time**, not a
  quantity. One tap marks an item unavailable; the restaurant chooses how long. There are no stock
  counts in V1 — restaurants do not maintain them accurately and counting creates reservation
  semantics the platform cannot enforce.

  > **Decided:** a switch; turning it off opens a "for how long" menu whose default is "until closing" ([setting item availability](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), ["for how long" options](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  > **Open** (proposed defaults stand): the other options, 1 hour and indefinitely; a per-minute restore job; "until closing" items restored at the next opening; a weekly digest of items unavailable over 14 days.

- **Data**: `menu_item.availability_state`, `menu_item.out_of_stock_until timestamptz NULL`,
  `menu_item.unavailable_since`, `availability_change_log(id, menu_item_id, from_state, to_state, until, changed_by_user_id, created_at)`.

- **States** (`menu_item.availability_state`):

  | From | To | Trigger |
  |---|---|---|
  | — | `AVAILABLE` | item created |
  | `AVAILABLE` | `OUT_OF_STOCK` | restaurant marks unavailable; `out_of_stock_until` = now+1h / next closing time / NULL |
  | `OUT_OF_STOCK` | `AVAILABLE` | restaurant marks available, **or** per-minute job when `out_of_stock_until <= now()`, **or** next-opening restore job |
  | `AVAILABLE` | `HIDDEN` | item's category deactivated, or item soft-deleted |
  | `HIDDEN` | previous state | category reactivated |
  | any | `BLOCKED` | admin blocks the item (compliance); restaurant cannot self-restore |
  | `BLOCKED` | `AVAILABLE` | admin unblocks |

- **Rules**:
  1. The customer-facing menu **shows** out-of-stock items greyed out with "Unavailable" rather than
     hiding them — hiding causes support tickets ("where did my favourite go") and hurts the
     restaurant's perceived breadth. Out-of-stock items are not addable to a cart.
  2. Toggling availability is instant, requires no approval, and is rate-limited to 120 changes per
     hour per restaurant.
  3. A bulk endpoint accepts up to 200 item ids and one target state, applied in one transaction.
  4. Marking an item unavailable **does not** affect any order already accepted containing it. If the
     kitchen genuinely cannot make it, the path is R-28 (cancel with reason) or an R-33 escalation —
     never a silent substitution.
  5. `BLOCKED` items cannot be re-enabled by the restaurant and display the admin's reason.
  6. Availability changes emit `menu_item.availability_changed` on the restaurant stream and
     invalidate the customer menu cache key for that restaurant immediately.
  7. The per-minute restock job holds an advisory lock and is idempotent.

- **Acceptance criteria**:
  1. **Given** an item marked out of stock "until closing" at 14:00 with closing at 23:00 local, **when** the per-minute job runs at 23:00, **then** the item is `AVAILABLE` and one `availability_change_log` row records the automatic restore with `changed_by_user_id=NULL`.
  2. **Given** an item marked out of stock indefinitely, **when** 48 hours pass, **then** it is still `OUT_OF_STOCK` and it appears in the weekly stale-item digest.
  3. **Given** an accepted order containing item X, **when** X is marked out of stock, **then** the order is untouched and no notification is sent to that order's customer.
  4. **Given** a bulk request marking 200 items unavailable, **when** one item id belongs to another restaurant, **then** `403 forbidden` is returned and **none** of the 200 are changed.
  5. **Given** an item in `BLOCKED`, **when** the restaurant marks it available, **then** `403 item_blocked_by_admin` with the admin reason string.

- **Out of scope**: quantity-tracked inventory (SOW places "inventory management" in **Version 2.0**); ingredient-level depletion; auto out-of-stock from repeated cancellations (V3); supplier integration; par levels; per-variant availability (V2, arrives with R-20).

- **Version**: V1
- **Size**: M

---

### R-19 — Out-of-stock interaction with active carts and checkout

- **SOW trace**: *"Out-of-Stock Management: Mark items as out of stock or temporarily unavailable."* (SOW §2, Restaurants §2) × *"Cart Management: Add food items to the cart… Note: Only one restaurant per order is allowed."* (SOW §2, Customers §11).

- **Behaviour**: This is the cross-domain rule the SOW never states. **A cart is not a reservation.**
  Availability is evaluated at three moments only: (a) add-to-cart, (b) cart read, (c) checkout
  pre-flight, which runs inside the same transaction that authorises payment. Nothing mutates a
  customer's cart on the restaurant's behalf, and nothing is ever substituted.

  > **DECISION REQUIRED — cart behaviour on an item going out of stock**: Should the platform silently drop the line, block checkout, or notify the customer live? · **Proposed default**: **never mutate the cart**. Mark the line `unavailable` on the next cart read and at checkout pre-flight return `409 cart_has_unavailable_items` with the offending `line_ids`; the customer must explicitly remove them. Customers with a live session additionally receive a push/toast when an item in their cart goes unavailable. · **Why**: silent removal changes the price the customer thought they were paying, and silent substitution is a halal-compliance hazard. *(D-14)*

- **Data**: no new restaurant-side entity. Cart line read model gains
  `availability: {is_available, reason ∈ {OUT_OF_STOCK, ITEM_DELETED, CATEGORY_INACTIVE, RESTAURANT_CLOSED, RESTAURANT_UNAVAILABLE, PRICE_CHANGED}, current_price_cents}`.
  `checkout_preflight_log(id, cart_id, restaurant_id, result, blocking_reasons[], created_at)`.

- **States**: none of its own. Checkout pre-flight result ∈ `{OK, BLOCKED_UNAVAILABLE_ITEMS, BLOCKED_PRICE_CHANGED, BLOCKED_RESTAURANT_CLOSED, BLOCKED_RESTAURANT_UNAVAILABLE, BLOCKED_MINIMUM_NOT_MET}`.

- **Rules**:
  1. Add-to-cart of an unavailable item → `409 item_unavailable`. The item is never added.
  2. Cart read annotates every line; the API never removes lines.
  3. Checkout pre-flight re-checks, in this order and inside one serializable transaction:
     restaurant `account_status='ACTIVE'` → `is_open_now` and last-order cutoff (R-06) →
     `is_accepting_orders` (R-22) → every line's item state → every line's price vs. the price the
     client displayed. Any failure returns `409` with a machine-readable reason and **no payment
     authorisation is created**.
  4. **Price drift**: if `current_price_cents != client_quoted_price_cents`, checkout is blocked with
     `BLOCKED_PRICE_CHANGED` and the new totals so the customer can re-confirm. The server price is
     always authoritative. *(The current system charges a client-supplied `amount_to_pay` verbatim;
     that is not ported under any circumstance.)*
  5. Once payment is authorised, the order's contents are frozen. A later out-of-stock toggle cannot
     invalidate it.
  6. Pre-flight is idempotent per `Idempotency-Key` for 60 seconds so a double-tap does not double-authorise.

- **Acceptance criteria**:
  1. **Given** a cart containing item X and X is then marked out of stock, **when** the customer reads the cart, **then** the line is still present with `availability.is_available=false, reason:"OUT_OF_STOCK"` and the cart total still includes it, flagged as unpayable.
  2. **Given** the same cart, **when** checkout is attempted, **then** `409 cart_has_unavailable_items` with the line id, and no payment authorisation exists in Stripe.
  3. **Given** the customer removes the line, **when** checkout is retried, **then** it succeeds and exactly one payment authorisation is created.
  4. **Given** item X's price changed from 1200 to 1400 after the cart was rendered, **when** checkout is attempted with `quoted_total_cents` based on 1200, **then** `409 BLOCKED_PRICE_CHANGED` with the new totals and no authorisation.
  5. **Given** an authorised order containing X, **when** X is marked out of stock one second later, **then** the order remains valid and appears normally in the restaurant's queue.

- **Out of scope**: substitution suggestions; "notify me when back" subscriptions (V3); holding stock during checkout; partial-order fulfilment; cart merging across restaurants (SOW forbids multi-restaurant orders).

- **Version**: V1
- **Size**: M

---

### R-20 — Variants and modifier groups

- **SOW trace**: *"Add/Edit Menu: Create and update the food menu with details like dish names, descriptions, prices…"* (SOW §2, Restaurants §2). The SOW does not name variants or add-ons; they are included because the existing data model, cart and order paths already assume them and because a menu without sizes is not usable for most restaurants. Flagged as an interpretation, not a quoted requirement.

- **Behaviour**: An item may have **one** variant group (mutually exclusive, exactly one selection,
  each variant carrying an absolute price that **replaces** the base price) and **zero or more**
  modifier groups (add-ons with min/max selection counts, each option carrying a price delta). Both
  are captured on the order line's `options_json` and priced server-side.

- **Data**:
  ```
  menu_item_variant_group(id, menu_item_id, name, is_required=true, sort_order)
  menu_item_variant(id, group_id, name, price_cents, is_default bool,
                    availability_state, sort_order)
  menu_item_modifier_group(id, menu_item_id, name, min_select int, max_select int, sort_order)
  menu_item_modifier(id, group_id, name, price_delta_cents, availability_state, sort_order)
  order_line.options_json = {variant:{id,name,price_cents},
                             modifiers:[{id,name,price_delta_cents}]}
  ```

- **States**: variants and modifiers reuse `availability_state` from R-18 (`AVAILABLE`/`OUT_OF_STOCK`).
  Groups have no state; deleting a group soft-deletes its options.

- **Rules**:
  1. **Line price formula, singular and normative**:
     `unit_price_cents = COALESCE(variant.price_cents, item.price_cents) + Σ modifier.price_delta_cents`
     `line_total_cents = unit_price_cents × quantity`.
     This formula is implemented **once**, in one Go function, and is used by the cart, the pricing
     endpoint and order creation. *(The current system has four competing definitions; a single
     shared function plus a golden-file test suite is the acceptance bar.)*
  2. Max 1 variant group, max 20 variants; max 5 modifier groups, max 30 modifiers each.
  3. `min_select` 0–`max_select`; `max_select` ≤ number of options. A cart line violating the counts
     → `422 modifier_selection_invalid`.
  4. `price_delta_cents` ∈ [−2000, +5000]. Negative deltas allowed (e.g. "no cheese −$1.00").
  5. `order_line` carries variant and modifier identity **and** the prices charged. There is no
     unique constraint on `(order_id, menu_item_id)`; the natural key is
     `(order_id, menu_item_id, options_fingerprint)` where the fingerprint is a stable hash of the
     sorted option ids. *(This is precisely the constraint that aborts orders today.)*
  6. Variant/modifier names and prices are **instant** edits (not reviewed) — they are structurally
     price data. Adding a *new* modifier group whose name makes a dietary claim is caught by R-17
     only if it touches item content; that is accepted.
  7. A variant marked out of stock is not selectable; if it was the only available variant the whole
     item reads as unavailable.

- **Acceptance criteria**:
  1. **Given** an item with base 1000 and variants Small 900 / Large 1400, **when** Large is chosen with modifiers +200 and −100, **then** `unit_price_cents=1500`, and the identical computation is produced by the cart endpoint, the pricing endpoint and order creation (golden-file test).
  2. **Given** one order containing the same dish as Small and as Large, **when** the order is created, **then** two `order_line` rows exist and no unique-constraint violation occurs.
  3. **Given** a modifier group with `min_select=1, max_select=2`, **when** a cart line selects zero options, **then** `422 modifier_selection_invalid` naming the group.
  4. **Given** an order line with two modifiers, **when** the order is read back, **then** `options_json` lists both with the exact `price_delta_cents` charged, and their sum reconciles `line_total_cents` to the cent.

- **Out of scope**: nested modifiers (a modifier with its own options); per-variant images; cross-item shared modifier libraries (V3); quantity per modifier ("×2 cheese") — V3; variant-level prep times.

- **Version**: V2
- **Size**: L

---

### R-21 — Special offers, discounts and combos

- **SOW trace**: *"Special Offers: Add discounts, combo offers, or promotional items to the menu."* (SOW §2, Restaurants §2). Related: *"Promotions and Campaigns: Create and manage platform-wide promotions, discounts."* (SOW §2, Super Admin §2) and *"Promotions and Offers: Alerts about platform-wide promotions or campaigns that restaurants can participate in."* (SOW §2, Restaurants §8).

- **Behaviour**: A restaurant creates offers scoped to its own menu. Offers are typed, time-bounded,
  budget-capped and admin-reviewed before going live. At checkout the server evaluates all eligible
  offers and applies at most one restaurant offer plus at most one platform coupon.

  **Offer types (V2, exhaustive):**

  | `offer_type` | Mechanic | Required fields |
  |---|---|---|
  | `PERCENT_OFF_ITEMS` | X% off the listed items | `percent_bps`, `item_ids[]`, `max_discount_cents` |
  | `AMOUNT_OFF_ITEMS` | Flat CAD off the listed items | `amount_off_cents`, `item_ids[]` |
  | `PERCENT_OFF_ORDER` | X% off item subtotal above a threshold | `percent_bps`, `min_subtotal_cents`, `max_discount_cents` |
  | `AMOUNT_OFF_ORDER` | Flat CAD off item subtotal above a threshold | `amount_off_cents`, `min_subtotal_cents` |
  | `COMBO` | A fixed set of items sold at a fixed bundle price | `combo_lines[{item_id, quantity}]`, `bundle_price_cents` |

  `BOGO` is **explicitly deferred to V3** — it interacts badly with per-line refunds and partial cancellations.

  > **Decided:** discounts are restaurant-funded ([discount funding](../decisions/README.md#settled--reconciliations)), and commission is 0% at launch ([platform commission](../decisions/README.md#settled--client-decisions)).

  > **DECISION REQUIRED — stacking**: How many discounts can apply to one order? · **Proposed default**: at most **one** restaurant offer and **one** platform coupon per order; within restaurant offers the one producing the **largest** customer discount wins; combined discount is capped at **50%** of item subtotal; discounts never apply to delivery fee, platform fee, taxes or tip. · **Why**: unbounded stacking is the classic route to negative-revenue orders, and "best offer wins" is the only rule customers do not perceive as arbitrary. *(D-24)*

- **Data**:
  ```
  offer(id, restaurant_id, offer_type, name, customer_description, percent_bps,
        amount_off_cents, min_subtotal_cents, max_discount_cents, bundle_price_cents,
        funding_source, platform_share_bps, starts_at, ends_at,
        day_of_week_mask smallint, daypart_start time, daypart_end time,
        budget_cents NULL, spent_cents, max_redemptions NULL, redemption_count,
        max_redemptions_per_customer, state, review_status, reviewed_by_admin_id,
        review_note, created_by_user_id, created_at, deleted_at)
  offer_item(offer_id, menu_item_id, quantity)
  offer_redemption(id, offer_id, order_id, customer_id, discount_cents,
                   funded_by_restaurant_cents, funded_by_platform_cents, created_at)
  ```

- **States** (`offer.state`):

  | From | To | Trigger |
  |---|---|---|
  | — | `DRAFT` | created |
  | `DRAFT` | `PENDING_REVIEW` | submitted |
  | `PENDING_REVIEW` | `APPROVED` | admin approves (never auto-approved, like menu changes) |
  | `PENDING_REVIEW` | `REJECTED` | admin rejects with reason |
  | `APPROVED` | `SCHEDULED` | approved and `starts_at > now()` |
  | `SCHEDULED` | `LIVE` | clock reaches `starts_at` |
  | `LIVE` | `PAUSED` | restaurant pauses |
  | `PAUSED` | `LIVE` | restaurant resumes, if still inside the window |
  | `LIVE` | `EXHAUSTED` | `spent_cents >= budget_cents` or `redemption_count >= max_redemptions` |
  | `LIVE`/`SCHEDULED`/`PAUSED` | `ENDED` | clock passes `ends_at` |
  | any non-terminal | `CANCELLED` | restaurant cancels, or admin force-stops |

- **Rules**:
  1. `percent_bps` 100–5000 (1%–50%). `max_discount_cents` required for percentage offers.
  2. `ends_at > starts_at`; max duration 180 days; max 20 `LIVE`+`SCHEDULED` offers per restaurant.
  3. A `COMBO`'s `bundle_price_cents` must be ≥ 50% of the sum of its components' current prices, and
     the combo is evaluated as an all-or-nothing line replacement: the cart must contain every combo
     line at ≥ the required quantity.
  4. An offer never makes the item subtotal negative, and never reduces the total below
     `delivery_fee + platform_fee + tax`. Post-discount item subtotal floor is CAD 0.01.
  5. `budget_cents` decrements atomically inside the order transaction (`UPDATE … SET spent_cents = spent_cents + $1 WHERE id=$2 AND (budget_cents IS NULL OR spent_cents + $1 <= budget_cents) RETURNING`). A losing race means the offer simply does not apply — never an over-spend.
  6. Offers require admin review (they are marketing claims). Reviewed fields: `name`,
     `customer_description`, and any `funding_source != RESTAURANT`.
  7. On refund or cancellation, `offer_redemption` is reversed and `spent_cents`/`redemption_count`
     decremented in the same transaction as the refund.
  8. Discount attribution is recorded per redemption so settlement (R-31) can compute the
     restaurant's and platform's shares without re-deriving them.

- **Acceptance criteria**:
  1. **Given** a restaurant-funded `PERCENT_OFF_ORDER` of 20% with `max_discount_cents=1000` on a CAD 80.00 subtotal, **when** the order is priced, **then** `discount_cents=1000`, commission is computed on 7000, and `offer_redemption.funded_by_restaurant_cents=1000`, `funded_by_platform_cents=0`.
  2. **Given** two live restaurant offers yielding CAD 5 and CAD 8, **when** an order qualifies for both, **then** exactly one redemption is written for the CAD 8 offer and the CAD 5 offer's counters are untouched.
  3. **Given** an offer with `budget_cents=10000` and `spent_cents=9500`, **when** 10 concurrent orders each qualifying for CAD 800 are placed, **then** the sum of applied discounts never exceeds 10000 and the remaining orders complete without the discount.
  4. **Given** a `PERCENT_OFF_ORDER` of 50% and a platform coupon of 20%, **when** both are eligible, **then** the combined discount is capped at 50% of item subtotal and delivery fee, platform fee, tax and tip are unaffected.
  5. **Given** a delivered order with a redemption, **when** it is fully refunded, **then** `spent_cents` and `redemption_count` return to their pre-order values in the refund transaction.

- **Out of scope**: BOGO (V3); free-delivery offers (platform-owned, they touch the delivery fee); customer-segment targeting; first-order-only offers (platform-owned); referral mechanics; loyalty/stamp cards (V3); happy-hour dynamic pricing (SOW places dynamic pricing in Version 2.0, platform-side); coupon **codes** typed by customers (platform-owned, SOW §2 Customers §11).

- **Version**: V2
- **Size**: L

---

### R-22 — Store availability: accepting-orders toggle and auto-offline

- **SOW trace**: *"Order Acceptance/Rejection: Accept or reject orders based on availability or operational capacity."* (SOW §2, Restaurants §3) — the master switch is the pre-emptive form of the same control.

- **Behaviour**: One boolean, `is_accepting_orders`, gates whether the restaurant is offered new
  orders at all. It is combined with hours (R-06), pause (R-06), account status (R-36) and a
  **liveness heartbeat** into a single computed `open_state` that the customer feed and checkout
  pre-flight both read.

  > **DECISION REQUIRED — heartbeat-gated availability**: Should a restaurant with no live browser session still receive orders? · **Proposed default**: no. The web app POSTs a heartbeat every 30 s while the orders screen is focused or backgrounded-but-open. If `now() - last_heartbeat_at > 5 minutes`, `open_state` becomes `CLOSED_OFFLINE` and no orders are offered; `is_accepting_orders` itself is **not** mutated, so the restaurant returns to service automatically the moment the tab reconnects. A banner and an email fire on the first auto-offline event of a day. · **Why**: an order offered to an unattended screen expires, cancels a paid customer order and burns the customer relationship; requiring proven liveness is how every mature delivery platform handles it. *(D-09)*

- **Data**: `restaurant.is_accepting_orders`, `restaurant.last_heartbeat_at`,
  `restaurant.pause_until`, `restaurant.missed_order_count`,
  `availability_toggle_log(id, restaurant_id, from_value, to_value, source ∈ {MANUAL, AUTO_MISSED_ORDERS, AUTO_SUSPENSION, ADMIN}, actor_id, created_at)`.

- **States**: computed `open_state`, evaluated in strict precedence:
  `CLOSED_SUSPENDED` (account_status ≠ ACTIVE) → `CLOSED_OFFLINE` (stale heartbeat) →
  `CLOSED_TOGGLE` (`is_accepting_orders=false`) → `PAUSED` (`pause_until > now`) →
  `CLOSED_HOLIDAY` (override) → `CLOSED_HOURS` (outside intervals or past last-order cutoff) → `OPEN`.

- **Rules**:
  1. The API field name is `is_accepting_orders` everywhere — request body, response body, database
     column and event payload. *(The current defect is a frontend sending `is_accepting` against a
     backend destructuring `isAccepting`, producing a silent 200 no-op. The contract test in AC-1
     exists specifically to prevent its recurrence.)*
  2. Toggling returns the **persisted** row read back after the write, so a no-op write is impossible
     to mistake for a success.
  3. Turning the toggle off does not affect accepted orders and does not cancel pending offers older
     than the toggle — an order already offered keeps its full response window.
  4. **Two consecutive expired offers** (R-24) force `is_accepting_orders=false` with
     `source='AUTO_MISSED_ORDERS'`; the restaurant must re-enable manually. `missed_order_count`
     resets to 0 on any accepted order.
  5. Heartbeat endpoint is cheap (`UPDATE restaurant SET last_heartbeat_at=now()`), rate-limited to
     4/min, and never returns a body larger than the current `open_state`.
  6. `open_state` is exposed to the restaurant with a plain-language `reason` and, where applicable,
     `resolvable_by ∈ {RESTAURANT, ADMIN, TIME}`.

- **Acceptance criteria**:
  1. **Given** `is_accepting_orders=true`, **when** `PATCH {"is_accepting_orders": false}` is sent, **then** the response body contains `is_accepting_orders:false` read back from the database, and a contract test asserts no other spelling of the field is accepted (`is_accepting`, `isAccepting` → `422 unknown_field`).
  2. **Given** the last heartbeat was 6 minutes ago, **when** a customer attempts checkout, **then** `409 restaurant_unavailable` with `reason:"CLOSED_OFFLINE"`, and `is_accepting_orders` in the database is still `true`.
  3. **Given** two consecutive offers expired unanswered, **when** the second expiry commits, **then** `is_accepting_orders=false`, `source='AUTO_MISSED_ORDERS'`, and an email plus an in-app banner are emitted.
  4. **Given** an order in `PENDING_RESTAURANT` with 90 s remaining, **when** the restaurant toggles off, **then** that order's `response_deadline_at` is unchanged and it can still be accepted.

- **Out of scope**: capacity-based throttling (orders per 15 minutes) — V3; auto-offline from
  repeated rejections; per-channel availability (pickup vs delivery) — pickup is not in scope at all;
  scheduled toggle automation.

- **Version**: V1
- **Size**: S

---
### R-23 — Live order dashboard

- **SOW trace**: *"Order Dashboard: View incoming orders in real-time with details like customer name, order items, delivery address, and special instructions."* (SOW §2, Restaurants §3).

- **Behaviour**: No column board. A live strip in the header, directly under the app bar on every
  restaurant page, lists each order awaiting acceptance with its countdown (R-24), and the alert
  sounds until the order is accepted, rejected or expires. Arrow keys move along the strip, one key
  accepts and one rejects (reject still asks for a reason); a stray key press never accepts an
  order that is not focused. Open orders show as side-by-side panes (list, order, timeline) on a
  page that fits the screen, with no overlay modal or sheet ([how a new order appears](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28),
  [desktop working pages](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), [where the live strip sits](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  It loads via REST and then stays current via the SSE stream (R-09).

- **Data**: `GET /v1/restaurant/orders` returns the contract's `OrderRestaurantView` (its shape wins
  where this sketch differs), projected from `order` + `order_line`:
  ```
  {id, order_number, status, placed_at, response_deadline_at, promised_ready_at,
   customer_display_name, customer_phone_masked (null until accepted), delivery_address_short,
   special_instructions, line_count, item_summary[], subtotal_cents, total_cents,
   restaurant_payout_cents, rider:{display_name, eta_at, status} | null,
   is_scheduled bool, elapsed_seconds}
  ```

- **States**: the dashboard renders `order.status` (§1.4). It writes none directly; every write goes
  through R-24/R-25/R-26/R-28.

- **Rules**:
  1. **Customer PII is minimised.** The restaurant sees the customer's **first name + last initial**;
     the **masked phone** (`+1 ••• ••• 4821`) and the delivery address arrive **only after the order
     is `ACCEPTED`**, withheld by the server, not just the screen ([masked phone before accepting](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28);
     contract change: [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)). Before
     acceptance it sees the delivery city and distance band only. Full phone is
     never exposed; contact goes through the platform (R-26). *(Today, order reads expose raw
     customer phone numbers to partners.)*
  2. `special_instructions` is rendered verbatim, HTML-escaped, max 500 chars, and is prominent — it
     is the highest-frequency source of order errors.
  3. The list is paginated (cursor) and filtered server-side by `status[]`. The default view fetches
     at most 100 open orders. No unbounded list is ever returned.
  4. Reconciliation: on SSE (re)connect the client refetches the open set; the SSE stream is a
     delta channel, not the source of truth.
  5. Sort: `PENDING_RESTAURANT` by `response_deadline_at` ascending (most urgent first); all others
     by `promised_ready_at` ascending.
  6. An order whose `promised_ready_at` has passed while still `PREPARING` is visually flagged
     `late` and appears in the delay prompt (R-26).
  7. The dashboard is read-authorised by session `rid` only. There is no order id that a different
     restaurant can read. *(Currently any caller can read any order by id.)*

- **Acceptance criteria**:
  1. **Given** an order in `PENDING_RESTAURANT`, **when** the restaurant fetches the dashboard, **then** `delivery_address_short` contains city and distance band but no street address, and `customer_phone_masked` is null.
  2. **Given** the same order after acceptance, **when** it is refetched, **then** the full delivery address is present and the phone appears, masked to its last 4 digits.
  3. **Given** restaurant A, **when** it requests order `X` belonging to restaurant B by id, **then** `403 forbidden` and no order fields are leaked in the error body.
  4. **Given** an SSE disconnect of 40 s during which two orders arrived, **when** the client reconnects, **then** both orders are present after the reconnect refetch and neither is duplicated in the UI.

- **Out of scope**: kitchen display system (KDS) integration; receipt/label printer integration (V3); table/dine-in orders; scheduled/pre-orders (V2); order editing by the restaurant; multi-screen role splitting (expeditor vs. line).

- **Version**: V1
- **Size**: M

---

### R-24 — Order acceptance, rejection and response timeout

- **SOW trace**: *"Order Acceptance/Rejection: Accept or reject orders based on availability or operational capacity."* (SOW §2, Restaurants §3).

- **Behaviour**: This is the highest-risk interaction in the domain and is specified exhaustively.

  When a customer completes checkout, the platform **authorises** (does not capture) the payment,
  creates the order in `PENDING_RESTAURANT`, sets
  `response_deadline_at = offered_at + RESPONSE_WINDOW`, and pushes an `order.offered` event. The
  restaurant has until the deadline to `accept` or `reject`. The **server** is the sole authority on
  expiry; the client countdown is decorative.

  > **Decided:** `RESPONSE_WINDOW = 180 seconds` ([acceptance window](../decisions/README.md#settled--reconciliations)); expiry voids the authorisation, never captures ([authorise then capture](../../AGENTS.md#3-non-negotiable-invariants)).
  > **Open** (proposed defaults stand): an apology credit offer to the customer; toggle forced off after two consecutive expiries (R-22); no re-offer, no re-route.

  > **DECISION REQUIRED — authorise-then-capture vs capture-then-refund**: When is the customer's card actually charged? · **Proposed default**: **manual capture**. Authorise at checkout (`capture_method=manual`), capture on restaurant acceptance, void on reject/expiry. Authorisations are re-authorised if still uncaptured at 6 days (Stripe's 7-day limit). · **Why**: it makes rejection and timeout free and instantaneous for the customer, and it is the only model in which "the restaurant said no" does not involve moving money at all. *(D-02)*

  **Rejection** requires a structured reason and is never implicit. Moving focus off the live strip,
  navigating away, refreshing, losing the socket, or the browser crashing all leave the order in
  `PENDING_RESTAURANT` until the server-side deadline. *(The current implementation auto-rejects on
  dialog dismiss and on expiry client-side, so an accidental click loses a paid order. That
  behaviour is a defect and is explicitly not ported.)*

- **Data**:
  ```
  order.status, offered_at, response_deadline_at, accepted_at, rejected_at,
  order.reject_reason_code, order.reject_note, order.cancel_reason_code,
  order.accepted_by_user_id, order.promised_ready_at
  order_offer(id, order_id, offered_at, deadline_at, resolved_at, resolution, resolved_by_user_id)
  payment_intent(id, order_id, provider_intent_id, state, amount_authorised_cents,
                 amount_captured_cents, authorised_at, captured_at, voided_at)
  ```
  `reject_reason_code` enum: `ITEM_UNAVAILABLE`, `KITCHEN_AT_CAPACITY`, `CLOSING_SOON`,
  `EQUIPMENT_FAILURE`, `ADDRESS_OUT_OF_RANGE`, `SUSPECTED_FRAUD`, `OTHER`.

- **States** (order, restaurant-response slice):

  | From | To | Trigger |
  |---|---|---|
  | *(checkout)* | `PENDING_RESTAURANT` | payment authorisation succeeded; offer created |
  | `PENDING_RESTAURANT` | `ACCEPTED` | restaurant `accept` before deadline; authorisation captured |
  | `PENDING_RESTAURANT` | `CANCELLED_BY_RESTAURANT` | restaurant `reject` with reason; authorisation voided |
  | `PENDING_RESTAURANT` | `CANCELLED_NO_RESPONSE` | scheduler at `response_deadline_at`; authorisation voided |
  | `PENDING_RESTAURANT` | `CANCELLED_BY_CUSTOMER` | customer cancels before acceptance; authorisation voided |
  | `PENDING_RESTAURANT` | `CANCELLED_PAYMENT_FAILED` | capture fails at accept time |
  | `PENDING_RESTAURANT` | `CANCELLED_ADMIN` | admin force-cancel |

- **Rules**:
  1. Expiry is driven by a **durable scheduler**: a `due_at`-indexed table polled every second by a
     single leader-elected goroutine (`SELECT … WHERE due_at <= now() AND state='PENDING' FOR UPDATE SKIP LOCKED LIMIT 100`). It is not a client timer, an in-memory timer, or a workflow execution timeout. A binary restart loses nothing.
  2. `accept` and `reject` are guarded by `SELECT … FOR UPDATE` on the order and are strictly
     idempotent via `Idempotency-Key`. A late `accept` (deadline passed) → `409 offer_expired` with
     the final status — never a partial success.
  3. **Accept** performs, in one transaction: status → `ACCEPTED`; set `accepted_at`,
     `accepted_by_user_id`, `promised_ready_at` (R-15 D-20); reset `missed_order_count=0`; enqueue
     the payment **capture**; enqueue rider dispatch. If capture fails, the order moves to
     `CANCELLED_PAYMENT_FAILED`, the restaurant is notified, and rider dispatch is **not** enqueued.
     There is no path where a failed money operation lets the flow continue. *(Today the saga falls
     through to rider assignment when cancel/refund returns false.)*
  4. **Reject** performs, in one transaction: status → `CANCELLED_BY_RESTAURANT`; store reason;
     void the authorisation; notify the customer; release any offer budget (R-21). A void failure
     leaves the order in `CANCELLED_BY_RESTAURANT` and raises an operational alert with a retry job —
     it never leaves the order alive.
  5. Rejections are counted: `reject_rate_7d` above 20% raises an admin compliance flag; above 40%
     the restaurant is queued for an admin review task. No automatic suspension.
  6. `ITEM_UNAVAILABLE` rejections prompt (but do not force) the restaurant to mark the offending
     item out of stock, pre-filling R-18.
  7. The accept/reject endpoints authorise from the session; there is no Redis-key correlation, no
     `restaurantId` in the body, and no unauthenticated path. *(Currently anyone who knows an
     orderId + restaurantId can accept or reject an order.)*
  8. The audible alert repeats every 10 s until the order is resolved or expires; the browser tab
     title flashes. Sound requires a one-time user gesture to arm and the UI blocks going "online"
     until sound is armed.

- **Acceptance criteria**:
  1. **Given** an order in `PENDING_RESTAURANT` with 200 s elapsed and `RESPONSE_WINDOW=180`, **when** the restaurant clicks accept, **then** `409 offer_expired`, the order is `CANCELLED_NO_RESPONSE`, the Stripe intent shows `canceled` with `amount_captured=0`, and no rider was dispatched.
  2. **Given** an unanswered offer, **when** the API process is killed at t=60 s and restarted at t=90 s, **then** the order still transitions to `CANCELLED_NO_RESPONSE` within 2 s of `response_deadline_at`.
  3. **Given** an order in the live strip, **when** the restaurant moves focus away, refreshes the page and loses the SSE connection, **then** the order is still `PENDING_RESTAURANT` and fully acceptable — no client action rejects an order implicitly.
  4. **Given** an accept whose Stripe capture returns `card_declined`, **when** the transaction completes, **then** the order is `CANCELLED_PAYMENT_FAILED`, no rider dispatch job exists, and the restaurant sees a specific "payment failed" message rather than a generic error.
  5. **Given** the same accept request replayed 3× with one `Idempotency-Key`, **when** all three complete, **then** exactly one capture exists in Stripe and exactly one `ACCEPTED` audit row.
  6. **Given** two consecutive expired offers, **when** the second expires, **then** `is_accepting_orders=false` and a third order is never offered.

- **Out of scope**: partial acceptance (accepting some lines); re-offering to a different restaurant; restaurant-proposed substitutions at accept time; negotiating prep time with the customer; auto-accept mode (V3, and only with an explicit contractual opt-in); scheduled orders.

- **Version**: V1
- **Size**: L

---

### R-25 — Preparation status updates

- **SOW trace**: *"Order Preparation Status: Update the status of orders (e.g., received, preparing, ready for pickup)."* (SOW §2, Restaurants §3).

- **Behaviour**: After acceptance the restaurant advances the order through exactly two
  restaurant-owned transitions: `ACCEPTED → PREPARING` and `PREPARING → READY_FOR_PICKUP`. Marking
  ready notifies the assigned rider (R-26) and the customer. All later statuses belong to the rider.

  *(In the current system this is unreachable: the transition table lives in a workflow that starts
  at `RIDER_ASSIGNED`, the `updateStatus()` function on the order page is defined and never called,
  and the only status endpoint casts the incoming string `as any` with no validation and no auth.
  This feature is a from-scratch build of the restaurant half of the order state machine.)*

- **Data**: `order.status, preparing_at, ready_at, promised_ready_at`;
  `order_status_transition(id, order_id, from_status, to_status, actor_type, actor_id, reason_code, created_at)` — an append-only transition log used by analytics (R-29) and disputes (R-33).

- **States** (restaurant-writable transitions only; the full table lives in the order domain):

  | From | To | Actor | Trigger |
  |---|---|---|---|
  | `ACCEPTED` | `PREPARING` | restaurant | "Start preparing" (or automatically 60 s after accept if untouched) |
  | `PREPARING` | `READY_FOR_PICKUP` | restaurant | "Mark ready" |
  | `PREPARING` | `PREPARING` | restaurant | delay applied (R-26) — `promised_ready_at` moves, status unchanged |
  | `ACCEPTED`/`PREPARING` | `CANCELLED_BY_RESTAURANT` | restaurant | bounded cancel (R-28) |
  | `READY_FOR_PICKUP` | `PICKED_UP` | rider | rider types the short pickup code the kitchen reads out from its order screen; no seal at launch ([how a rider confirms pickup](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [#47](https://github.com/shaiknoorullah/hg-mono/issues/47); contract change: [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)) — **not** restaurant-writable |

- **Rules**:
  1. The transition table is enforced in **one** place — a pure Go function
     `func Transition(from, to OrderStatus, actor Actor) error` — and every writer calls it. An
     illegal or out-of-order transition → `409 illegal_status_transition` naming `from`, `to` and
     `allowed[]`.
  2. A restaurant cannot write `PICKED_UP`, `ON_THE_WAY`, `DELIVERED`, or any cancellation code
     reserved to other actors. Attempt → `403 transition_not_permitted_for_actor`.
  3. Transitions are idempotent: re-sending the current status returns `200` with the unchanged
     order, not an error and not a duplicate log row.
  4. `ACCEPTED → PREPARING` auto-fires 60 s after acceptance if the restaurant has not clicked, so
     the customer's tracking screen never stalls on "accepted".
  5. `mark_ready` is blocked until a rider is assigned **unless** `allow_ready_before_rider=true`
     (platform config, default `true`): food going cold is worse than a mismatched sequence, but the
     event carries `rider_assigned=false` so dispatch can prioritise.
  6. Every transition writes `order_status_transition` in the same transaction as the status change
     and emits `order.updated` to the customer, rider and restaurant channels.
  7. Elapsed-time metrics (`accept→preparing`, `preparing→ready`, `ready→picked_up`) are derived from
     this log, never recomputed from event timestamps.

- **Acceptance criteria**:
  1. **Given** an order in `ACCEPTED`, **when** the restaurant POSTs `{"to_status":"READY_FOR_PICKUP"}`, **then** `409 illegal_status_transition` with `allowed:["PREPARING","CANCELLED_BY_RESTAURANT"]`.
  2. **Given** an order in `PREPARING`, **when** the restaurant POSTs `{"to_status":"DELIVERED"}`, **then** `403 transition_not_permitted_for_actor` and the status is unchanged.
  3. **Given** an order accepted 61 s ago with no restaurant action, **when** the scheduler runs, **then** the status is `PREPARING`, and `order_status_transition` records `actor_type='SYSTEM'`.
  4. **Given** an order marked ready, **when** the restaurant sends `mark_ready` again, **then** `200` is returned with the same `ready_at` and exactly one transition row exists.
  5. **Given** a completed order, **when** its transition log is read, **then** every status change is present exactly once, in order, with a non-null actor.

- **Out of scope**: sub-statuses (e.g. "in the oven"); per-line preparation tracking; prep-time
  prediction; automatic ready detection; bumping orders between kitchen stations.

- **Version**: V1
- **Size**: M

---

### R-26 — Delay handling and rider communication

- **SOW trace**: *"Rider Communication: Notify riders when orders are ready for pickup or communicate delays."* (SOW §2, Restaurants §4).

- **Behaviour**: Two mechanisms, both structured. **(a) Ready notification** — marking
  `READY_FOR_PICKUP` (R-25) pushes to the assigned rider and updates the customer's ETA; there is no
  separate "notify rider" action to forget. **(b) Delay** — the restaurant selects a canned delay
  (+5 / +10 / +15 / +20 minutes) and an optional reason code; `promised_ready_at` moves, the rider and
  customer are both notified with the new ETA, and the delay is logged.

  > **DECISION REQUIRED — restaurant↔rider communication channel**: Free-text chat, masked voice call, or canned messages only? · **Proposed default**: **V1 = canned messages only** (a fixed enum of delay and pickup-issue messages) plus a **masked voice call via a telephony proxy in V2**. No free-text chat in V1 or V2. · **Why**: free text needs moderation, PII controls, retention policy and a real-time transport the restaurant surface otherwise does not need; canned messages carry all the operational information a rider actually needs and are translatable and auditable. *(D-17)*

- **Data**:
  ```
  order_delay(id, order_id, added_minutes, reason_code, previous_promised_ready_at,
              new_promised_ready_at, created_by_user_id, created_at)
  order_message(id, order_id, from_actor_type, from_actor_id, to_actor_type,
                template_key, params_json, created_at, delivered_at, read_at)
  ```
  `delay_reason_code` enum: `HIGH_VOLUME`, `INGREDIENT_PREP`, `EQUIPMENT_ISSUE`, `STAFF_SHORTAGE`, `ORDER_COMPLEXITY`, `OTHER`.
  Restaurant→rider `template_key` set (V1): `ORDER_READY`, `DELAY_ADDED`, `PACKAGING_IN_PROGRESS`, `PICKUP_AT_SIDE_DOOR`, `WAIT_INSIDE`, `ORDER_HANDED_OVER`.
  Restaurant→customer templates are platform-owned; the restaurant cannot author customer-facing text.

- **States**: `order_message`: `QUEUED --pushed--> DELIVERED --rider opens--> READ`;
  `QUEUED --rider offline > 10 min--> FALLBACK_SMS` (V2). `order_delay` has no state.

- **Rules**:
  1. Maximum **3** delays per order, maximum **+45 minutes** cumulative. Beyond that the restaurant
     must cancel (R-28) or raise an escalation (R-33); the customer is offered a free cancellation
     once cumulative delay exceeds 20 minutes.
  2. A delay may only be applied while the order is `ACCEPTED` or `PREPARING`.
  3. Every delay notifies the customer automatically. The restaurant cannot delay silently.
  4. Templates render server-side into the recipient's locale; the restaurant sends a `template_key`
     plus bounded params, never a string. Params are typed and length-capped.
  5. Rider identity exposed to the restaurant: first name, last initial, vehicle type, ETA, photo.
     No phone number, no exact location beyond an ETA band. Contact is proxied (V2).
  6. Messages are rate-limited to 10 per order per actor.
  7. `ORDER_READY` is emitted automatically by R-25 and cannot be sent manually (prevents duplicate
     pings).

- **Acceptance criteria**:
  1. **Given** an order with `promised_ready_at = T`, **when** a +10 delay with `reason_code='HIGH_VOLUME'` is applied, **then** `promised_ready_at = T+10m`, one `order_delay` row exists, and both the rider and the customer receive an ETA update within 5 s.
  2. **Given** an order with 3 delays already applied, **when** a fourth is attempted, **then** `409 delay_limit_reached` with `cumulative_minutes` and `next_actions:["CANCEL","ESCALATE"]`.
  3. **Given** an order in `READY_FOR_PICKUP`, **when** a delay is attempted, **then** `409 delay_not_allowed_in_status`.
  4. **Given** a restaurant attempting to send a free-text message, **when** the request includes a `body` field, **then** `422 unknown_field` — the endpoint accepts only `template_key` and `params`.
  5. **Given** a rider assigned to an order, **when** the restaurant reads the order, **then** no rider phone number appears anywhere in the payload.

- **Out of scope**: free-text chat (V3 at the earliest); voice calls in V1 (V2 via proxy); rider→restaurant photos; group chat with the customer; translation of free text; call recording.

- **Version**: V1 (canned + ready notification) · V2 (masked voice)
- **Size**: M

---

### R-27 — Order history, search and export

- **SOW trace**: *"Order History: View past orders with details like date, time, customer, items, and total cost."* (SOW §2, Restaurants §3).

- **Behaviour**: A separate, paginated, filterable view of terminal orders (`DELIVERED` and all
  `CANCELLED_*`), with per-order detail showing the immutable snapshot of what was ordered, what was
  charged, what the restaurant earned, and the full status timeline. CSV export for a bounded date
  range. History reads `GET /v1/restaurant/orders` (`listRestaurantOrders`) filtered by terminal
  `state`, which returns `OrderRestaurantView`.

  *(Today there is no history view at all — the orders table is a live list with no pagination, no
  date filter and no status filter.)*

  > **DECISION REQUIRED — retention and PII minimisation in order history**: how long is order history kept and how much customer data stays in it? · **Proposed default**: orders queryable for **7 years** (Canadian business-record retention); customer PII inside them minimised after **90 days** to first name + last initial and the first three postal characters; KYC documents retained 7 years after account closure; ticket attachments 2 years; notifications 90 days. · **Why**: business-record retention and PIPEDA data-minimisation pull in opposite directions, and this split satisfies both without asking the restaurant to choose. *(D-21)*

- **Data**: reads `order`, `order_line`, `order_status_transition`, `order_delay`,
  `offer_redemption`, `settlement_line` (R-31). Export job:
  `export_job(id, restaurant_id, kind, params_json, state, media_id, row_count, requested_by_user_id, created_at, completed_at, expires_at)`.

- **States**: `export_job`: `QUEUED --worker picks up--> RUNNING --success--> READY --download or 7 days--> EXPIRED`; `RUNNING --error--> FAILED` (retryable 3×).

- **Rules**:
  1. Filters: `state[]`, as the contract has it; there is no unbounded history query. Date range
     (restaurant-local days, max span 366 days), text search (order number or customer first name,
     min 3 chars) and total filters are not in the contract and need a contract change first.
  2. Cursor pagination, default 20, max 100. Sorted by `placed_at DESC` with `id` as a tiebreaker so
     paging is stable under concurrent inserts.
  3. Retention: order history is queryable for **7 years** (Canadian business-record retention);
     customer PII inside it is progressively minimised — after **90 days** the customer's name is
     reduced to initials and the delivery address to the first three postal characters (**D-21**).
  4. Detail view renders `order_line.name_snapshot` and `unit_price_cents` — never the current menu.
     A deleted or renamed item still renders correctly.
  5. Money reconciliation is displayed explicitly:
     `subtotal − discount + delivery_fee + platform_fee + tax + tip = total`, and
     `restaurant_payout = subtotal − discount − commission + restaurant_tax_share`. If any order row
     fails this identity, it is flagged in a nightly integrity report rather than silently rendered.
  6. CSV export is asynchronous, capped at 50,000 rows, delivered as a presigned private URL valid
     7 days, and rate-limited to 3 exports per day per restaurant.
  7. Cancelled orders show the cancel reason code and who cancelled.

- **Acceptance criteria**:
  1. **Given** 5,000 historical orders, **when** the first page is requested with `limit=25`, **then** the query plan uses the `(restaurant_id, placed_at DESC, id)` index, returns in <200 ms at p95, and `meta.next_cursor` pages without repeats or gaps under concurrent inserts.
  2. **Given** a history request with no `limit`, **when** it is submitted, **then** at most 20 orders are returned and `meta.next_cursor` pages on.
  3. **Given** an order containing an item that has since been renamed and re-priced, **when** the historical detail is opened, **then** the original name and price are shown.
  4. **Given** an order 91 days old, **when** it is read, **then** the customer name renders as initials and the address as the first three postal characters.
  5. **Given** an export request for 12 months, **when** the job completes, **then** a presigned URL returns a CSV whose row count equals the filtered order count and whose totals column sums to the dashboard's period revenue to the cent.

- **Out of scope**: PDF invoices per order (V2, R-31 covers statements); re-ordering on a customer's behalf; editing historical orders; exports in XLSX; accounting-package integrations (QuickBooks/Xero) — V3.

- **Version**: V1 (list + filter + detail) · V2 (CSV export)
- **Size**: M

---

### R-28 — Restaurant-initiated cancellation after acceptance

- **SOW trace**: *"Order Acceptance/Rejection: Accept or reject orders based on availability or operational capacity."* (SOW §2, Restaurants §3) + *"Performance Reports: Generate detailed reports on sales trends, customer feedback, and **order cancellations**."* (SOW §2, Restaurants §5) — the SOW reports on restaurant cancellations, so they must exist.

- **Behaviour**: A restaurant may cancel an order it has already accepted, but only before pickup and
  only with a reason. Cancellation refunds the customer in full, reverses any offer redemption, and
  is recorded against the restaurant's reliability metrics. This is deliberately a **worse** outcome
  than rejecting at offer time, and the UI says so.

  > **DECISION REQUIRED — post-acceptance cancellation policy**: Is a restaurant charged or penalised for cancelling an accepted order? · **Proposed default**: **no monetary penalty in V1**; the cancellation is recorded, surfaced in the restaurant's reliability score (R-29), and a rate above **5% over 7 days with ≥20 orders** opens an admin compliance review task. A financial penalty regime is deferred until the platform has enough volume for the metric to be fair. · **Why**: penalising early with thin data drives restaurants off the platform; measuring from day one preserves the option to introduce penalties later with evidence. *(D-16)*

- **Data**: `order.cancel_reason_code, cancelled_at, cancelled_by_actor_type, cancelled_by_user_id`;
  `refund(id, order_id, provider_refund_id, amount_cents, reason, state, created_at, settled_at)`;
  `restaurant_reliability_daily(restaurant_id, date, orders_offered, orders_accepted, orders_rejected, orders_expired, orders_cancelled_by_restaurant, on_time_ready_count)`.
  `cancel_reason_code` enum: `ITEM_UNAVAILABLE`, `KITCHEN_EMERGENCY`, `EQUIPMENT_FAILURE`, `STAFF_SHORTAGE`, `ORDER_ERROR`, `CUSTOMER_REQUEST`, `RIDER_NO_SHOW`, `OTHER`.

- **States**: `ACCEPTED|PREPARING|READY_FOR_PICKUP --restaurant cancel--> CANCELLED_BY_RESTAURANT`.
  After `PICKED_UP` the restaurant cannot cancel — `409 cancellation_window_closed`, and the path is
  an escalation (R-33).
  `refund`: `PENDING --provider accepts--> SUBMITTED --webhook--> SUCCEEDED | FAILED`;
  `FAILED --retry (max 5, exponential)--> SUBMITTED`; `FAILED×5 --> MANUAL_REVIEW`.

- **Rules**:
  1. Cancellation is permitted only while `status ∈ {ACCEPTED, PREPARING, READY_FOR_PICKUP}` and
     `picked_up_at IS NULL`.
  2. The refund is for the **full customer-paid amount including delivery fee, tax and tip** — the
     customer is made whole for a failure that is not theirs. Rider compensation for a wasted trip is
     platform-borne (rider domain).
  3. Refund execution is a durable job with retries; the order reaches `CANCELLED_BY_RESTAURANT`
     immediately and the refund state is tracked independently. A refund that cannot succeed after 5
     attempts raises `MANUAL_REVIEW` and an admin alert. **No code path logs "refund would be
     initiated here" and continues.**
  4. `CUSTOMER_REQUEST` requires the customer's cancellation request to exist (the customer-side
     cancel is the primary path); otherwise `422 unsupported_reason_for_actor`.
  5. If a rider is already assigned, the rider is notified immediately and released back to the pool.
  6. Cancelling reverses `offer_redemption` counters (R-21) and writes a reversing `settlement_line`
     if the order had already entered a settlement period (R-31).
  7. Every cancellation writes `order_status_transition` and `audit_log` with the acting user.

- **Acceptance criteria**:
  1. **Given** an order in `PREPARING` with an assigned rider, **when** the restaurant cancels with `EQUIPMENT_FAILURE`, **then** the order is `CANCELLED_BY_RESTAURANT`, a `refund` row for the full `total_cents` is `PENDING` within the same transaction, and the rider receives a release notification.
  2. **Given** an order in `PICKED_UP`, **when** cancellation is attempted, **then** `409 cancellation_window_closed` with `alternative:"ESCALATION"`.
  3. **Given** a refund whose provider call fails 5 times, **when** the last retry exhausts, **then** the refund is `MANUAL_REVIEW`, an admin alert exists, and the order status is still `CANCELLED_BY_RESTAURANT` — the two are never conflated.
  4. **Given** 21 orders in 7 days with 2 restaurant cancellations (9.5%), **when** the nightly reliability job runs, **then** an admin compliance review task exists and the restaurant sees the metric on its dashboard.
  5. **Given** an order whose offer redemption consumed CAD 8 of budget, **when** it is cancelled, **then** `offer.spent_cents` decreases by 800 in the same transaction as the cancellation.

- **Out of scope**: partial cancellation (removing lines); restaurant-initiated refunds without cancellation (that is a dispute, R-33); cancellation fees; customer-initiated cancellation (customer domain); rider no-show auto-cancellation (platform domain).

- **Version**: V1
- **Size**: M

---
### R-29 — Sales dashboard and analytics

- **SOW trace**: *"Sales Dashboard: Visualize sales performance with metrics like total orders, revenue, popular dishes, and peak hours."* (SOW §2, Restaurants §5).

- **Behaviour**: A dashboard over a chosen period (Today / 7d / 30d / custom, max 366 days) showing a
  fixed, defined metric set. Every metric has a single written definition; none is computed on the
  client. The dashboard reads from a nightly-rolled aggregate table plus a live delta for today, so
  it never scans the order table at request time.

  *(Today's dashboard is 100% hardcoded recharts demo data — "Hello Orlando", $215,860 — while real
  `/stats` and `/analytics` endpoints exist and are never called. Every number below must be
  traceable to a query.)*

- **Metric definitions (normative)**:

  | Metric | Definition |
  |---|---|
  | `orders_delivered` | count of orders with `status='DELIVERED'` and `delivered_at` in the period (restaurant-local) |
  | `orders_cancelled` | count with any `CANCELLED_*` status and `cancelled_at` in period, split by who cancelled |
  | `gross_sales_cents` | Σ `subtotal_cents` of delivered orders (pre-discount, excl. delivery/platform fee/tax/tip) |
  | `net_sales_cents` | Σ (`subtotal_cents − discount_cents`) of delivered orders |
  | `commission_cents` | Σ `commission_cents` of delivered orders |
  | `restaurant_earnings_cents` | Σ `restaurant_payout_cents` of delivered orders |
  | `average_order_value_cents` | `net_sales_cents / orders_delivered`, null when the denominator is 0 |
  | `accept_rate` | `orders_accepted / orders_offered` over the period |
  | `on_time_ready_rate` | orders where `ready_at <= promised_ready_at` ÷ orders reaching `READY_FOR_PICKUP` |
  | `median_prep_minutes` | median of `ready_at − accepted_at` over delivered orders |
  | `top_items` | top 10 by Σ `quantity` of `order_line` on delivered orders, with revenue |
  | `peak_hours` | order counts bucketed by restaurant-local hour-of-day across the period |
  | `repeat_customer_rate` | distinct customers with ≥2 delivered orders ÷ distinct customers, in the period |

- **Data**:
  ```
  restaurant_metrics_daily(restaurant_id, date, orders_offered, orders_accepted,
      orders_rejected, orders_expired, orders_delivered, orders_cancelled_restaurant,
      orders_cancelled_customer, gross_sales_cents, discount_cents, commission_cents,
      net_sales_cents, payout_cents, tip_cents, prep_minutes_sum, prep_minutes_count,
      on_time_ready_count, distinct_customers, computed_at)
  restaurant_item_metrics_daily(restaurant_id, menu_item_id, date, quantity, revenue_cents)
  restaurant_hour_metrics_daily(restaurant_id, date, hour_local, order_count, revenue_cents)
  ```

- **States**: aggregation job per `(restaurant_id, date)`: `PENDING --job--> COMPUTED`;
  `COMPUTED --late-arriving change (refund, dispute adjustment)--> STALE --recompute--> COMPUTED`.

- **Rules**:
  1. All periods are restaurant-local calendar days derived from `restaurant.timezone`.
  2. Money is displayed in **CAD** with `$` and two decimals, formatted from integer cents. There is
     no other currency in the product. *(The current admin UI renders USD on one page and PKR/RS on
     another; a single formatter with a locked currency code is the fix.)*
  3. Today's figures are computed live and labelled `partial:true`; historical days come from the
     aggregate.
  4. A refund, dispute adjustment or late cancellation marks the affected day `STALE`; the recompute
     job runs hourly. Dashboards show `as_of` so a user can tell how fresh a number is.
  5. Comparison to the previous equivalent period is shown as a signed percentage, suppressed when
     the prior period had fewer than 5 orders (avoids meaningless ±900% deltas).
  6. Every dashboard query is bounded by `restaurant_id` and a date range and must satisfy an index
     scan; the aggregate tables carry `PRIMARY KEY (restaurant_id, date)`.
  7. No analytics endpoint returns raw customer identifiers.

- **Acceptance criteria**:
  1. **Given** 30 days of seeded orders, **when** the dashboard's `net_sales_cents` is compared to a direct SQL sum over `order`, **then** they are equal to the cent.
  2. **Given** a refund issued for an order delivered 3 days ago, **when** the hourly recompute runs, **then** that day's `restaurant_metrics_daily` reflects the reversal and the dashboard's `as_of` advances.
  3. **Given** a restaurant in `America/Vancouver`, **when** an order is delivered at 23:30 local (07:30 UTC next day), **then** it is counted on the local calendar day, not the UTC one.
  4. **Given** a period with zero delivered orders, **when** the dashboard loads, **then** `average_order_value_cents` is `null` and the UI renders "—" rather than `$0.00` or `NaN`.
  5. **Given** the dashboard endpoint, **when** it is called for a 366-day range on a restaurant with 100k orders, **then** it returns in <500 ms p95 without touching the `order` table.

- **Out of scope**: cohort analysis; forecasting; AI insights (SOW places AI-driven insights in Version 2.0, admin-side); competitor benchmarking; customer-level analytics; real-time streaming charts; margin/food-cost analysis (the platform does not know the restaurant's costs).

- **Version**: V2
- **Size**: L

---

### R-30 — Performance reports

- **SOW trace**: *"Performance Reports: Generate detailed reports on sales trends, customer feedback, and order cancellations."* (SOW §2, Restaurants §5).

- **Behaviour**: Three named, fixed-format reports generated asynchronously over a chosen period and
  delivered as CSV plus an on-screen table: **Sales trends**, **Customer feedback**, **Cancellations
  and reliability**. Reports are not an ad-hoc query builder.

- **Data**: reuses R-29 aggregates plus:
  ```
  restaurant_review(id, restaurant_id, order_id, customer_id, rating smallint CHECK (rating BETWEEN 1 AND 5),
                    comment, created_at, is_hidden, hidden_reason)
  food_item_review(id, menu_item_id, order_line_id, rating 1..5, comment, created_at)
  restaurant_reply(id, restaurant_review_id, body, created_at)   -- V3
  export_job (R-27)
  ```
  *(Restaurant ratings do not exist in the current system at all — only rider and food-item reviews —
  and those accept any number with no 1–5 clamp and take the rater's identity from the request body.
  The `CHECK` constraint and order-linkage above are the specification.)*

- **States**: `export_job` states from R-27. `restaurant_review`: `VISIBLE --admin moderates--> HIDDEN`;
  `VISIBLE --customer edits within 24h--> VISIBLE(edited)`.

- **Rules**:
  1. **Sales trends**: daily rows of `orders_delivered, net_sales_cents, average_order_value_cents,
     top_item_id`, plus week-over-week deltas.
  2. **Customer feedback**: rating distribution 1–5, mean rating (2 dp), count of reviews with
     comments, the 50 most recent comments, and per-item mean ratings for items with ≥5 ratings.
  3. **Cancellations**: counts and rates by `reject_reason_code` and `cancel_reason_code`, split by
     actor, with the reliability metrics from R-28.
  4. A review may be written only by the customer of a `DELIVERED` order, at most one per order,
     within 14 days of delivery. Identity comes from the session. Rating is an integer 1–5 enforced
     in the API **and** by a database `CHECK`.
  5. Restaurants cannot delete or hide reviews; they may report one for moderation (admin decides).
  6. Reports over ranges >92 days are always asynchronous; shorter ranges may render synchronously.
  7. Report figures must reconcile with R-29 for the same period; a nightly consistency check
     compares them and alerts on divergence.

- **Acceptance criteria**:
  1. **Given** a customer who did not order from restaurant R, **when** they attempt to review R, **then** `403 no_eligible_order` and no row is written.
  2. **Given** a rating of `7`, **when** it is submitted, **then** `422 rating_out_of_range` and the database `CHECK` would independently reject it.
  3. **Given** a 30-day feedback report, **when** its mean rating is compared to a direct SQL average over the same window, **then** they match to 2 decimal places.
  4. **Given** a 180-day sales-trends request, **when** it is submitted, **then** `202` with an `export_job` id, and the completed CSV's `net_sales_cents` column sums to the R-29 dashboard value for the same period.

- **Out of scope**: replying to reviews (V3); sentiment analysis; NPS; benchmarking against other restaurants; scheduled email delivery of reports (V3); custom report builder.

- **Version**: V2
- **Size**: M

---

### R-31 — Earnings ledger, statements and payment history

- **SOW trace**: *"Payment History: View detailed records, receipts of all payments received, including order ID, amount, and date."* (SOW §2, Restaurants §6).

- **Behaviour**: A double-entry-shaped ledger of everything that moves money for the restaurant.
  Every delivered order produces settlement lines; every refund, adjustment, dispute outcome and
  payout produces its own lines. The restaurant sees a running balance, a per-period statement, and a
  per-order breakdown that reconciles exactly.

  > **Decided:** commission is **0%** at launch, kept per restaurant as `commission_rate_bps` and switchable ([platform commission](../decisions/README.md#settled--client-decisions)).
  > **Open** (proposed defaults stand): commission applies to `(subtotal − discount)`. The restaurant does **not** bear the payment-processing fee, the delivery fee, or the platform fee charged to the customer; tips pass through 100% to the rider (restaurant tips are out of scope). Formula: `restaurant_payout = (subtotal − discount) − commission + restaurant_tax_remittance`.

  > **DECISION REQUIRED — GST/HST**: who computes, collects and remits sales tax? · **Proposed default**: the platform computes GST/HST on the food subtotal using the **delivery province** rate table, collects it from the customer, and remits it to the restaurant as `restaurant_tax_remittance` in the payout; the restaurant remains the remitter of record to CRA. Platform-charged fees (delivery, service, commission) carry their own tax, invoiced separately by the platform. · **Why**: the platform must show a tax-inclusive total at checkout, but assuming the remitter role for the restaurant's food sales is a tax-registration question the SOW explicitly excludes ("Business Specific Legal Compliance Measures" is out of scope). **This one needs an accountant's sign-off before build.** *(D-19)*

- **Data**:
  ```
  ledger_entry(id, restaurant_id, entry_type, order_id NULL, payout_id NULL, dispute_id NULL,
               amount_cents bigint,           -- signed: credit +, debit −
               currency='CAD', occurred_at, available_at, period_key,
               description, metadata_json, created_at)
  settlement_period(restaurant_id, period_key, starts_at, ends_at, state,
                    gross_cents, commission_cents, adjustments_cents, tax_cents,
                    net_cents, payout_id, closed_at)
  ```
  `entry_type` enum: `ORDER_SALE`, `ORDER_DISCOUNT`, `COMMISSION`, `TAX_REMITTANCE`,
  `REFUND_REVERSAL`, `DISPUTE_ADJUSTMENT`, `PROMO_PLATFORM_CREDIT`, `MANUAL_ADJUSTMENT`,
  `PAYOUT`, `PAYOUT_REVERSAL`, `INSTANT_PAYOUT_FEE`.

- **States**: `settlement_period`: `OPEN --period ends--> PENDING_CLOSE --hold period elapses--> CLOSED --payout initiated--> PAID_OUT`; `CLOSED --late adjustment--> REOPENED --> CLOSED` (adjustments after `PAID_OUT` land in the next open period, never retroactively).
  `ledger_entry` is immutable once written; corrections are reversing entries.

- **Rules**:
  1. **Every** entry is integer cents with an explicit sign. The sum of all entries for a restaurant
     equals its balance; there is no separately maintained balance field. Floats appear nowhere.
  2. `available_at = delivered_at + HOLD_DAYS` (see R-32). Funds are `pending` before that and
     `available` after.
  3. Order entries are written **when the order reaches `DELIVERED`**, not at acceptance, not at
     capture.
  4. A refund debits the restaurant only when its reason code makes the restaurant liable
     ([refund liability](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).
     A halal complaint charges the restaurant the item's net price only when substantiated; otherwise
     the platform pays it as goodwill ([halal complaint refunds](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
     A restaurant-liable refund writes `REFUND_REVERSAL` entries that exactly negate the original
     order's entries for the refunded proportion, including the commission.
  5. Per-order breakdown always reconciles:
     `Σ ledger_entry(order_id=X) = restaurant_payout_cents(X)`. A nightly integrity job asserts this
     for every order and alerts on any mismatch.
  6. Statements are per settlement period, downloadable as CSV and PDF, and immutable once the period
     is `CLOSED`.
  7. `MANUAL_ADJUSTMENT` requires an admin actor, a reason, and a linked dispute or ticket.
  8. The restaurant sees: pending balance, available balance, next payout date, next payout estimate,
     and the full entry list with cursor pagination.

- **Acceptance criteria**:
  1. **Given** a delivered order with subtotal 5000, discount 500, commission rate 1800 bps, **when** the ledger is written, **then** entries are `ORDER_SALE +5000`, `ORDER_DISCOUNT −500`, `COMMISSION −810`, and `Σ = 3690 = restaurant_payout_cents`.
  2. **Given** that order is later fully refunded for a restaurant-liable reason, **when** the refund settles, **then** three `REFUND_REVERSAL` entries exactly negate the originals and the restaurant's balance returns to its pre-order value.
  3. **Given** a period that has already been `PAID_OUT`, **when** a dispute adjustment for one of its orders is approved, **then** the adjustment lands in the current `OPEN` period and the closed period's statement is byte-identical to the one previously downloaded.
  4. **Given** every money column in the schema, **when** types are inspected, **then** all are `bigint` cents; no `numeric`, `money` or floating-point column holds currency.
  5. **Given** 10,000 seeded orders with refunds and adjustments, **when** the nightly integrity job runs, **then** zero reconciliation mismatches are reported.

- **Out of scope**: multi-currency; invoice generation for the restaurant's own tax filing beyond the CSV/PDF statement; accounting-software sync (V3); restaurant-side tipping; per-item cost accounting; chargeback handling (platform domain, surfaces here only as `DISPUTE_ADJUSTMENT`).

- **Version**: V1 (ledger + order breakdown) · V2 (period statements, PDF)
- **Size**: L

---

### R-32 — Payout schedule, preferences and payout requests

- **SOW trace**: *"Payout Requests: Request payouts for accumulated earnings. Track payout status in real-time (pending, processed, failed)."* and *"Payout Preferences: Set payout frequency (daily, weekly, monthly). Choose preferred payout methods."* (SOW §2, Restaurants §6).

- **Behaviour**: Available balance is paid out automatically on the restaurant's chosen cadence via
  Stripe Connect payouts to the verified bank account (R-11). Separately, the restaurant may request
  an **on-demand payout** of its available balance, subject to a floor and a fee.

  > **Decided:** payouts run weekly on Monday, automatically, with no minimum ([payout cadence](../decisions/README.md#settled--client-decisions), [payout minimum](../decisions/README.md#settled--reconciliations)).
  > **Open** (proposed defaults stand): a **3 calendar day** hold after `delivered_at`; whether the SOW's daily and monthly options are offered later; Stripe standard bank payout only.

  > **DECISION REQUIRED — on-demand payout limits and fee**: What are the constraints on "request a payout"? · **Proposed default**: minimum **CAD 50.00** available balance, maximum **1 per calendar day**, fee **CAD 1.50** debited as an `INSTANT_PAYOUT_FEE` ledger entry, only while `payout_account.state='READY'` and `account_status='ACTIVE'`. Arrival is Stripe-standard (1–2 business days) — the platform does **not** promise instant arrival. · **Why**: an unlimited free on-demand payout is a per-transaction cost the platform absorbs and an operational lever for fraud; one per day with a small fee makes it a genuine convenience rather than a default. *(D-08)*

- **Data**:
  ```
  payout_preference(restaurant_id PK, frequency DAILY|WEEKLY|MONTHLY,
                    weekly_day_of_week, monthly_day_of_month, minimum_cents,
                    is_paused bool, updated_at)
  payout(id, restaurant_id, kind SCHEDULED|ON_DEMAND, amount_cents, fee_cents,
         state, provider_payout_id, requested_by_user_id, requested_at,
         submitted_at, expected_arrival_date, paid_at, failed_at,
         failure_code, failure_message, period_keys[], idempotency_key UNIQUE)
  ```

- **States** (`payout.state`) — this is the SOW's *"track payout status in real-time (pending, processed, failed)"*:

  | From | To | Trigger |
  |---|---|---|
  | — | `REQUESTED` | scheduler fires, or restaurant requests |
  | `REQUESTED` | `SUBMITTED` | Stripe payout created successfully |
  | `REQUESTED` | `REJECTED` | pre-checks fail (below minimum, account not READY, suspended) |
  | `SUBMITTED` | `IN_TRANSIT` | webhook `payout.paid` pending / `payout.updated` |
  | `IN_TRANSIT` | `PAID` | webhook `payout.paid` |
  | `SUBMITTED`/`IN_TRANSIT` | `FAILED` | webhook `payout.failed` — balance is restored via `PAYOUT_REVERSAL` |
  | `FAILED` | `REQUESTED` | manual or automatic retry after the cause is cleared (max 3) |
  | `REQUESTED`/`SUBMITTED` | `CANCELLED` | admin cancels before submission |

  `PENDING` in SOW terms = `REQUESTED`+`SUBMITTED`+`IN_TRANSIT`; `PROCESSED` = `PAID`; `FAILED` = `FAILED`/`REJECTED`.

- **Rules**:
  1. Payout amount = sum of `ledger_entry` with `available_at <= now()` not already attached to a
     payout, computed inside the payout transaction with `FOR UPDATE` on the restaurant's ledger
     cursor. Double-payout of the same entry is structurally impossible (each entry is stamped with
     its `payout_id`).
  2. A payout is never created while `account_status ∈ {SUSPENDED, BANNED}` — funds accrue and are
     released on reinstatement, or paid out at admin discretion during offboarding.
  3. `FAILED` payouts write `PAYOUT_REVERSAL` entries restoring the balance, and the failure reason
     is shown to the restaurant in plain language with a remediation link (usually "update your bank
     details in Stripe").
  4. Changing `frequency` takes effect from the **next** scheduled run; it never retro-triggers one.
  5. The scheduler is idempotent per `(restaurant_id, period_key)` with a unique index; a
     double-fire creates zero extra payouts.
  6. Payout state changes emit `payout.state_changed` on the restaurant SSE stream (R-09) and an
     email on `PAID` and `FAILED`.
  7. Payout history is paginated with the same conventions as R-27 and links each payout to its
     constituent ledger entries.
  8. "Choose preferred payout methods" is honoured as a **stored preference** with exactly one legal
     value in V1 (`BANK_TRANSFER_STRIPE`); additional methods are V2+ and the enum exists so adding
     one is not a schema migration.

- **Acceptance criteria**:
  1. **Given** an available balance of CAD 18.00 and `frequency=WEEKLY`, **when** the Monday scheduler runs, **then** a payout of CAD 18.00 is created, because there is no minimum.
  2. **Given** an available balance of CAD 400.00, **when** the scheduler fires twice concurrently for the same period, **then** exactly one `payout` row exists and every consumed ledger entry carries that single `payout_id`.
  3. **Given** a `payout.failed` webhook, **when** it is processed, **then** the payout is `FAILED`, `PAYOUT_REVERSAL` entries restore the exact amount, the available balance returns to its pre-payout value, and the restaurant receives an email naming the failure reason.
  4. **Given** an on-demand request with CAD 45.00 available, **when** it is submitted, **then** `422 below_minimum_payout` with `minimum_cents:5000`.
  5. **Given** an on-demand payout already made today, **when** a second is requested, **then** `429 payout_request_limit_reached` with `retry_after` set to the next local midnight.
  6. **Given** a suspended restaurant with CAD 900 available, **when** the scheduler runs, **then** no payout is created and the balance is preserved intact.

- **Out of scope**: instant/same-hour payouts; payouts to cards or wallets; splitting payouts across accounts; advance/financing products; payout in currencies other than CAD; automatic tax withholding.

- **Version**: V1 (scheduled weekly payouts + status tracking) · V2 (frequency preference, on-demand requests)
- **Size**: L

---

### R-33 — Escalations and disputes

- **SOW trace**: *"Raise Escalations: Submit escalations to customer support for issues like incorrect orders, payment disputes, or technical problems."* and *"Dispute Resolution: Track the status of escalations and receive updates on resolutions."* (SOW §2, Restaurants §7). Also *"Customer Support: Raise escalations or contact customer support…"* (SOW §2, Restaurants §4).

- **Behaviour**: A ticketing surface scoped to the restaurant. The restaurant opens a ticket in a
  fixed category, optionally attached to an order, with a description and up to 5 attachments.
  Support agents and admins work the ticket through a defined state machine with a threaded
  conversation. Financial outcomes are applied as `DISPUTE_ADJUSTMENT` ledger entries (R-31) —
  never as a direct balance edit.

  > **DECISION REQUIRED — who can move money in a dispute, and how fast**: What authority and SLA govern financial resolutions? · **Proposed default**: a **support agent** may resolve non-financial tickets and propose adjustments up to **CAD 50**; an **admin** approves adjustments above CAD 50; a **super admin** approves above CAD 500. First-response SLA **4 business hours**, resolution target **3 business days**; SLA breach escalates the ticket's priority automatically and flags it on the admin dashboard. · **Why**: the SOW defines Support Agent, Admin and Super Admin roles but assigns no financial limits; tiered authority is the minimum control that prevents a single support account from draining the ledger. *(D-18)*

- **Data**:
  ```
  ticket(id, restaurant_id, opened_by_user_id, order_id NULL, category, priority,
         subject, state, assigned_agent_id, sla_first_response_due_at,
         first_responded_at, sla_resolution_due_at, resolved_at, resolution_code,
         resolution_note, adjustment_cents, adjustment_ledger_entry_id,
         approved_by_admin_id, created_at, updated_at)
  ticket_message(id, ticket_id, author_type RESTAURANT|AGENT|ADMIN|SYSTEM, author_id,
                 body, is_internal bool, created_at)
  ticket_attachment(id, ticket_id, ticket_message_id, media_id, created_at)
  ```
  `category` enum: `ORDER_INCORRECT`, `ORDER_NOT_COLLECTED`, `RIDER_ISSUE`, `CUSTOMER_ABUSE`,
  `PAYMENT_DISCREPANCY`, `PAYOUT_ISSUE`, `MENU_REVIEW_APPEAL`, `ACCOUNT_SUSPENSION_APPEAL`,
  `DOCUMENT_VERIFICATION_HELP`, `TECHNICAL_ISSUE`, `OTHER`.
  `priority` enum: `LOW`, `NORMAL`, `HIGH`, `URGENT` (auto-set from category and order value).

- **States** (`ticket.state`):

  | From | To | Trigger |
  |---|---|---|
  | — | `OPEN` | restaurant submits |
  | `OPEN` | `ACKNOWLEDGED` | agent posts first response |
  | `ACKNOWLEDGED` | `UNDER_REVIEW` | agent takes ownership / investigates |
  | `UNDER_REVIEW` | `AWAITING_RESTAURANT` | agent requests information |
  | `AWAITING_RESTAURANT` | `UNDER_REVIEW` | restaurant replies |
  | `AWAITING_RESTAURANT` | `AUTO_CLOSED` | 7 days with no restaurant reply |
  | `UNDER_REVIEW` | `PENDING_APPROVAL` | proposed adjustment exceeds the agent's limit |
  | `PENDING_APPROVAL` | `RESOLVED` | admin approves; adjustment posted |
  | `PENDING_APPROVAL` | `UNDER_REVIEW` | admin declines the proposal |
  | `UNDER_REVIEW`/`ACKNOWLEDGED` | `RESOLVED` | agent resolves with a resolution code |
  | `UNDER_REVIEW` | `REJECTED` | agent/admin declines the claim with a reason |
  | `OPEN`/`ACKNOWLEDGED`/`UNDER_REVIEW` | `WITHDRAWN` | restaurant withdraws |
  | `RESOLVED`/`REJECTED`/`AUTO_CLOSED` | `REOPENED` | restaurant reopens within 14 days (once) |

- **Rules**:
  1. Max **10** open tickets per restaurant; further attempts → `429 too_many_open_tickets`.
  2. `order_id`, when present, must belong to the session's restaurant.
  3. Attachments: max 5 per message, 10 MB each, images/PDF, stored in the **private** bucket with
     presigned access limited to the ticket participants.
  4. `is_internal` messages are never returned on the restaurant-facing endpoint — enforced by a
     server-side filter with a dedicated test, not by client rendering.
  5. Resolutions carrying money write exactly one `DISPUTE_ADJUSTMENT` ledger entry, linked
     bidirectionally to the ticket, inside the resolving transaction.
  6. SLA clocks pause while the ticket is `AWAITING_RESTAURANT`.
  7. Every state change and message emits a restaurant event (R-09) and an email if the restaurant
     has no live session within 5 minutes.
  8. Tickets are retained 7 years; attachments 2 years.

- **Acceptance criteria**:
  1. **Given** a ticket with an agent-proposed adjustment of CAD 75, **when** the agent tries to resolve it, **then** the state becomes `PENDING_APPROVAL` and no ledger entry exists until an admin approves.
  2. **Given** an admin approves a CAD 75 adjustment, **when** the transaction commits, **then** exactly one `DISPUTE_ADJUSTMENT` entry of `+7500` exists, `ticket.adjustment_ledger_entry_id` points to it, and the restaurant's available balance reflects it after the hold.
  3. **Given** a ticket containing internal agent notes, **when** the restaurant fetches the thread, **then** no `is_internal=true` message appears in the response body at any nesting level.
  4. **Given** a ticket in `AWAITING_RESTAURANT` for 7 days, **when** the sweeper runs, **then** the ticket is `AUTO_CLOSED` and the restaurant is notified with a reopen link valid for 14 days.
  5. **Given** restaurant A, **when** it opens a ticket referencing restaurant B's `order_id`, **then** `403 forbidden` and no ticket is created.

- **Out of scope**: live chat and phone support (SOW's *"live chat, or call support"* — V2, see R-35); customer-facing dispute visibility; chargeback representment; legal/arbitration workflow; ticket merging; CSAT surveys on tickets (V3).

- **Version**: V2
- **Size**: L

---

### R-34 — Notifications and alerts

- **SOW trace**: *"Order Alerts: Receive real-time notifications for new orders, order updates, and customer cancellations. Payment Alerts: Notifications for successful payments, cashout requests, and refunds. Promotions and Offers: Alerts about platform-wide promotions or campaigns that restaurants can participate in."* (SOW §2, Restaurants §8).

- **Behaviour**: One notification service with a typed catalogue. Each notification type has a fixed
  set of channels and a fixed criticality. **Operationally critical notifications (a new order) are
  never delivered by email alone** — they require the in-app channel with an audible alert, which is
  why R-22 gates availability on a live session.

  > **DECISION REQUIRED — escalation when the restaurant is not looking at the screen**: Should the platform phone or SMS a restaurant that is offered an order but has no live session? · **Proposed default**: **no** — instead, the restaurant is not offered orders at all when its session is stale (R-22 heartbeat gate), so the "unattended offer" case does not arise. SMS/voice escalation is deferred to V2 as an opt-in for restaurants that want to run without a persistent screen. · **Why**: preventing the bad offer is cheaper and more reliable than escalating after it; SMS escalation without a heartbeat gate still loses orders when nobody is in the kitchen. *(D-26)*

- **Data**:
  ```
  notification(id, restaurant_id, type, severity, title, body, data_json,
               order_id NULL, group_key, created_at, read_at, archived_at)
  notification_delivery(id, notification_id, channel, state, provider_message_id,
                        attempted_at, delivered_at, failed_at, failure_reason)
  notification_preference(restaurant_id, type, channel, enabled, updated_at)
  ```
  Channels: `IN_APP` (SSE + persisted list), `EMAIL`, `WEB_PUSH` (V2), `SMS` (V2, opt-in).

  **Catalogue (V1)** — type · channels · mutable by restaurant?

  | Type | Channels | Restaurant can disable |
  |---|---|---|
  | `ORDER_NEW` | IN_APP (audible, repeating) | **no** |
  | `ORDER_CANCELLED_BY_CUSTOMER` | IN_APP (audible), EMAIL | no |
  | `ORDER_EXPIRED_NO_RESPONSE` | IN_APP, EMAIL | no |
  | `ORDER_RIDER_ASSIGNED` / `ORDER_RIDER_ARRIVED` / `ORDER_PICKED_UP` | IN_APP | yes |
  | `DOCUMENT_APPROVED` / `DOCUMENT_REJECTED` | IN_APP, EMAIL | no |
  | `DOCUMENT_EXPIRING` (T−30/14/7/1) | IN_APP, EMAIL | no |
  | `ACCOUNT_SUSPENDED` / `ACCOUNT_REINSTATED` | IN_APP, EMAIL | no |
  | `MENU_ITEM_APPROVED` / `MENU_ITEM_REJECTED` | IN_APP, EMAIL (hourly digest) | yes (digest only) |
  | `PAYOUT_PAID` / `PAYOUT_FAILED` | IN_APP, EMAIL | no |
  | `REFUND_ISSUED` | IN_APP, EMAIL (daily digest) | yes (digest only) |
  | `TICKET_UPDATED` | IN_APP, EMAIL | yes |
  | `PLATFORM_PROMOTION` | IN_APP, EMAIL | yes |
  | `AUTO_OFFLINE` | IN_APP, EMAIL | no |

- **States**: `notification`: `UNREAD --restaurant reads--> READ --archive or 90 days--> ARCHIVED`.
  `notification_delivery`: `QUEUED --attempt--> SENT --provider ack--> DELIVERED`;
  `QUEUED|SENT --error--> FAILED --retry (3×, exponential)--> SENT`; `FAILED×3 --> DEAD_LETTER`.

- **Rules**:
  1. Notifications are **persisted first, delivered second**. The in-app list is authoritative;
     SSE is a delivery optimisation. Reading a notification never deletes it. *(The current offline
     queue deletes on read, so a reconnect destroys unread notifications; not ported.)*
  2. `group_key` collapses related notifications (e.g. all events for one order) so a busy service
     does not produce 12 rows per order in the list.
  3. Email uses server-rendered templates with a version key; the restaurant cannot author them.
     Every email carries an unsubscribe link **only** for types marked disable-able.
  4. Delivery is at-least-once with de-duplication on `(notification_id, channel)`.
  5. Provider failures never block the originating transaction: notifications are enqueued in the
     same transaction as the state change (transactional outbox) and delivered by a worker.
  6. Retention: 90 days in the list, then archived; `notification_delivery` retained 30 days.
  7. Quiet hours do not apply to `ORDER_NEW` or any `severity='CRITICAL'` type.

- **Acceptance criteria**:
  1. **Given** a new order, **when** it is offered, **then** a `notification` row exists before any delivery attempt, and killing the delivery worker does not lose it — it is delivered on worker restart.
  2. **Given** an unread `ORDER_NEW` notification, **when** the SSE connection drops and reconnects, **then** the notification is still `UNREAD` and present in the list.
  3. **Given** a restaurant that has disabled `PLATFORM_PROMOTION` email, **when** a campaign is sent, **then** no email delivery row is created for it, but an `IN_APP` row still exists.
  4. **Given** a restaurant attempting to disable `ORDER_NEW`, **when** the preference is set, **then** `422 notification_type_not_disableable`.
  5. **Given** the email provider returns 500 three times for one notification, **when** retries exhaust, **then** the delivery is `DEAD_LETTER`, an operational alert fires, and the in-app notification is unaffected.

- **Out of scope**: native mobile push (there is no restaurant mobile app in scope); WhatsApp/Telegram channels; per-user (rather than per-restaurant) notification routing until staff accounts exist (a later version); marketing-campaign authoring by restaurants; notification analytics.

- **Version**: V1 (IN_APP + EMAIL, catalogue above) · V2 (WEB_PUSH, SMS, digests)
- **Size**: L

---

### R-35 — Support and help

- **SOW trace**: *"Support and Help: Access to FAQs, live chat, or call support for assistance."* (SOW §2, Restaurants §1).

- **Behaviour**: V1 delivers a searchable, admin-managed FAQ/help-centre plus a contextual
  "Contact support" action that opens an R-33 ticket pre-filled with the current page, restaurant id
  and (where relevant) order id. Live chat and telephone support are V2 and are explicitly a
  third-party integration, not a build.

- **Data**:
  ```
  help_article(id, slug UNIQUE, title, body_markdown, category, audience='RESTAURANT',
               locale='en-CA', sort_order, is_published, published_at, updated_at,
               search_vector tsvector)
  help_article_feedback(id, article_id, restaurant_user_id, was_helpful bool, comment, created_at)
  ```

- **States**: `help_article`: `DRAFT --publish--> PUBLISHED --unpublish--> DRAFT`; `PUBLISHED --archive--> ARCHIVED`.

- **Rules**:
  1. Articles are authored by admins (SOW §2, Super Admin §2 "Content Management"). Restaurants read
     only published articles for `audience='RESTAURANT'`.
  2. Full-text search uses a Postgres `tsvector` GIN index over title + body; no external search
     service.
  3. "Contact support" always creates a ticket (R-33) rather than sending an email to a shared inbox,
     so every request is tracked.
  4. Help content is versioned; `updated_at` is shown so a restaurant can tell whether a policy has
     changed.
  5. Support phone number and hours are configuration, rendered from a single settings source.
  6. The SOW's out-of-scope list explicitly excludes **Helpdesk** operations and **Content
     Generation** (policies) — the platform provides the surface; the client provides the content and
     staffs the desk.

- **Acceptance criteria**:
  1. **Given** 200 published articles, **when** a restaurant searches "payout", **then** results are ranked by relevance, return in <150 ms p95, and no unpublished or non-restaurant article appears.
  2. **Given** a restaurant on an order detail page, **when** it clicks "Contact support", **then** a ticket is created with `order_id` pre-filled and `category` defaulted from the page context.
  3. **Given** an unpublished article, **when** its slug is requested directly, **then** `404` (not `403`, which would confirm existence).

- **Out of scope**: live chat (V2, vendor integration); telephony (V2); AI support assistant (V3);
  multilingual help content (V3); community forum; in-product guided tours.

- **Version**: V1 (FAQ + contact) · V2 (live chat, call)
- **Size**: S

---

### R-36 — Account status, suspension, reinstatement and in-flight orders

- **SOW trace**: *"Restaurant Approval/Rejection: Approve or reject restaurant registrations based on submitted documents and compliance."*, *"Compliance Monitoring: Ensure restaurants comply with platform policies"*, *"Account Management: Suspend or reinstate… accounts based on violations or complaints."* (SOW §2, Admin §1–2).

- **Behaviour**: This feature defines exactly what happens to a restaurant's live business when its
  status changes — the question the SOW never asks. The governing principle: **a status change stops
  the future, never the present.** Orders already accepted are always allowed to complete, because a
  customer has paid and food is being cooked.

- **Data**: `restaurant.account_status`, `suspension_reason`, `suspended_at`, `suspended_by_admin_id`,
  `suspension_note`, `reinstated_at`, `closure_requested_at`, `closed_at`;
  `account_status_change(id, restaurant_id, from_status, to_status, reason_code, note, actor_type, actor_id, created_at)`.
  `suspension_reason` enum: `DOCUMENT_EXPIRED`, `HALAL_COMPLIANCE`, `FOOD_SAFETY_COMPLAINT`,
  `EXCESSIVE_CANCELLATIONS`, `FRAUD_SUSPECTED`, `PAYMENT_ISSUE`, `CUSTOMER_COMPLAINTS`,
  `POLICY_VIOLATION`, `RESTAURANT_REQUEST`, `OTHER`.

- **States** (`account_status`) — full transition table:

  | From | To | Trigger | Effect on orders |
  |---|---|---|---|
  | — | `PENDING` | signup | n/a |
  | `PENDING` | `ACTIVE` | onboarding reaches `ACTIVE` (R-04) | begins receiving offers |
  | `PENDING` | `REJECTED` | admin rejects the application (R-08) | n/a |
  | `REJECTED` | `PENDING` | restaurant re-submits documents | n/a |
  | `ACTIVE` | `SUSPENDED` | admin action, or automatic (R-10, R-28 thresholds) | **no new offers**; `PENDING_RESTAURANT` orders are cancelled + authorisations voided; `ACCEPTED`/`PREPARING`/`READY_FOR_PICKUP` **run to completion** |
  | `SUSPENDED` | `ACTIVE` | admin reinstates, or the automatic cause clears (R-10) | resumes offers |
  | `ACTIVE`/`SUSPENDED` | `BANNED` | admin, with a second-admin confirmation | all non-terminal orders force-cancelled with full refunds; sessions revoked; login blocked |
  | `ACTIVE` | `CLOSED` | restaurant requests offboarding, 7-day notice | no new offers after the notice; existing orders complete; final payout after the last order settles |
  | `CLOSED` | `ACTIVE` | admin reactivates within 90 days | resumes |
  | `BANNED` | `SUSPENDED` | **super admin only**, with a documented reason | manual review |

  > **DECISION REQUIRED — pending offers at the moment of suspension**: cancel them or let them be answered? · **Proposed default**: **cancel and void** every `PENDING_RESTAURANT` order at the instant of suspension, notifying the customer with an apology credit; do not let a suspended restaurant accept new work. · **Why**: suspension usually follows a compliance or safety concern, and allowing a restaurant to accept an order seconds after being suspended for a halal violation is exactly the failure the platform exists to prevent. *(D-25)*

- **Rules**:
  1. Suspension requires a `reason_code` and a `note` of ≥20 characters, and is attributed to the
     admin's session identity. *(The existing approve endpoint takes `admin_id` from the request body
     with no authentication; that path is deleted.)*
  2. Suspension takes effect atomically: within one transaction the status flips, pending offers are
     cancelled, and the customer feed cache key is invalidated. A customer cannot check out against a
     restaurant suspended a second earlier — this is re-verified in checkout pre-flight (R-19).
  3. `BANNED` requires a second admin's confirmation within 24 hours; an unconfirmed ban reverts to
     `SUSPENDED` automatically.
  4. A suspended restaurant retains full read access, its order history, its ledger, and the ability
     to open and reply to tickets (specifically to appeal, R-33 category
     `ACCOUNT_SUSPENSION_APPEAL`). It cannot accept orders. It may still edit its opening hours,
     which become read-only once it is deactivated ([opening hours while suspended](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
     Nobody can change its menu until the suspension is lifted, admins acting on its behalf included;
     the same holds while it is banned. The lock follows the account state: a restaurant that is
     delisted rather than suspended can still edit its menu ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  5. Funds accrued before suspension are preserved; payouts pause (R-32) and resume on reinstatement.
     Offboarding (`CLOSED`) triggers a final payout after the last order's hold period elapses.
  6. Reinstatement from an automatic suspension is automatic when the cause clears **and** no manual
     suspension is also in force. Manual and automatic suspensions are tracked independently so
     clearing one does not clear the other.
  7. Every transition writes `account_status_change` and `audit_log`, and emits
     `account.status_changed` (R-09) plus email.

- **Acceptance criteria**:
  1. **Given** a restaurant with one order in `PENDING_RESTAURANT`, one in `PREPARING` and one in `READY_FOR_PICKUP`, **when** an admin suspends it, **then** the first is `CANCELLED_ADMIN` with the authorisation voided, and the other two remain untouched and complete normally through `DELIVERED`.
  2. **Given** a suspended restaurant, **when** a customer attempts checkout 500 ms after the suspension commits, **then** `409 restaurant_unavailable` — verified with a concurrency test, not just a sequential one.
  3. **Given** a restaurant suspended manually **and** for an expired halal certificate, **when** the certificate is renewed and approved, **then** it stays `SUSPENDED` because the manual suspension is still in force.
  4. **Given** a ban not confirmed by a second admin, **when** 24 hours pass, **then** the status reverts to `SUSPENDED` and an audit row records the automatic reversion.
  5. **Given** a suspended restaurant with CAD 900 in available balance, **when** it opens a ticket, **then** the ticket is created and the balance is unchanged and still visible.

- **Out of scope**: probation tiers; automated fraud scoring (SOW places fraud detection in Version 2.0); graduated visibility penalties in search ranking; legal notices; data deletion on closure beyond the retention policy (**D-21**).

- **Version**: V1
- **Size**: M

---

## 3. Feature index

| ID | Feature | Version | Size |
|---|---|---|---|
| R-01 | Restaurant account signup | V1 | M |
| R-02 | Email verification and account activation | V1 | S |
| R-03 | Login, session and token lifecycle | V1 | M |
| R-04 | Onboarding state machine and progress tracking | V1 | M |
| R-05 | Business profile submission | V1 | M |
| R-06 | Operating hours, holidays, temporary closure | V1 | M |
| R-07 | Compliance document upload | V1 | L |
| R-08 | Document pack submission and admin verification review | V1 | L |
| R-09 | Verification status tracking ("real-time") | V1 | M |
| R-10 | Document expiry, renewal and compliance suspension | V1 | M |
| R-11 | Payout account: add and verify bank details | V1 | L |
| R-12 | Profile management after activation | V1 | M |
| R-13 | Restaurant imagery | V1 | M |
| R-14 | Menu and category management | V1 | S |
| R-15 | Menu item authoring | V1 | L |
| R-16 | Menu item images | V1 | M |
| R-17 | Menu change approval workflow | V1 | L |
| R-18 | Item availability and out-of-stock management | V1 | M |
| R-19 | Out-of-stock interaction with carts and checkout | V1 | M |
| R-20 | Variants and modifier groups | V2 | L |
| R-21 | Special offers, discounts and combos | V2 | L |
| R-22 | Accepting-orders toggle and auto-offline | V1 | S |
| R-23 | Live order dashboard | V1 | M |
| R-24 | Order acceptance, rejection and response timeout | V1 | L |
| R-25 | Preparation status updates | V1 | M |
| R-26 | Delay handling and rider communication | V1 / V2 | M |
| R-27 | Order history, search and export | V1 / V2 | M |
| R-28 | Restaurant-initiated cancellation after acceptance | V1 | M |
| R-29 | Sales dashboard and analytics | V2 | L |
| R-30 | Performance reports | V2 | M |
| R-31 | Earnings ledger, statements and payment history | V1 / V2 | L |
| R-32 | Payout schedule, preferences and payout requests | V1 / V2 | L |
| R-33 | Escalations and disputes | V2 | L |
| R-34 | Notifications and alerts | V1 / V2 | L |
| R-35 | Support and help | V1 / V2 | S |
| R-36 | Account status, suspension, reinstatement, in-flight orders | V1 | M |

**Counts** — V1: **27** · V2: **9** (of which 6 have a V1 slice delivered first) · V3: **0** standalone features (V3 items are named as out-of-scope exclusions inside the entries above). Total **36**.

By size: S **4** · M **19** · L **13**.

Rough V1 build weight (V1 features only, counting the V1 slice of split features): S 4 · M 17 · L 10.

---

## 4. Global out of scope (restaurant domain)

Aggressive exclusions that apply across every feature above:

1. **The Expo restaurant mobile app.** The restaurant surface is web only. The existing
   `apps/restaurant` is a Supabase + Payload-CMS lead-capture funnel that never talks to the API; it
   is retired, not rebuilt. No restaurant mobile app in V1–V3.
2. **Multi-location / franchise accounts.** One login = one restaurant = one address = one menu.
3. **Staff sub-accounts and roles.** The `role` column exists (`OWNER|MANAGER|STAFF`) but only
   `OWNER` is issued at launch and the Staff screen is hidden; restaurant staff come in a later
   version ([staff accounts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
4. **Pickup / dine-in / table ordering.** Delivery only.
5. **Scheduled and pre-orders.** Immediate orders only.
6. **Inventory quantities, recipes, food-cost accounting, supplier integration.**
7. **POS, KDS and receipt-printer integrations.**
8. **Restaurant-authored customer-facing free text** beyond menu content and offer descriptions
   (both admin-reviewed). No restaurant-written emails, push copy or chat messages.
9. **Search-ranking control.** A restaurant cannot pay for or influence its position in the feed.
10. **Anything the SOW lists as out of scope**: cloud maintenance, helpdesk staffing, sales
    assistance, R&D, business-specific legal compliance measures, and content generation (privacy
    policy, refund policy, restaurant policy, terms of service). The platform renders those
    documents; the client writes them.
11. **Temporal, microservices, serverless.** The SOW's Version 2.0 "migrate to microservices" is
    explicitly **not** part of this rebuild; the target is one Go binary.
12. **AI features** (recommendations, dynamic pricing, fraud scoring, AI insights) — SOW Version 2.0,
    platform-side, not restaurant-domain.
13. **French-language (fr-CA) UI and content.** English only until V3.
14. **Any currency other than CAD; any country other than Canada.**

---

## 5. Decisions required

Every open business rule, with the default this spec was written against. Each is answerable with a
sentence; none requires new engineering analysis.

| # | Topic | Question | Proposed default | Why | Blocks |
|---|---|---|---|---|---|
| **D-01** | Order response timeout | What exactly happens when a restaurant does not answer an order in time? | 180 s window (decided: [acceptance window](../decisions/README.md#settled--reconciliations)); on expiry → `CANCELLED_NO_RESPONSE`, payment **authorisation voided** (no capture, no refund), customer notified + apology credit, `missed_order_count`+1; two consecutive expiries force `is_accepting_orders=false`. **No re-offer, no re-route** (SOW mandates one restaurant per order). | Long enough for a busy kitchen, short enough not to strand a paying customer; voiding beats refunding on fees and speed. | R-24 · **V1** |
| **D-02** | Payment timing | Authorise-then-capture, or capture-then-refund? | **Manual capture**: authorise at checkout, capture on acceptance, void on reject/expiry; re-authorise at day 6. | Makes rejection and timeout free and instant, and removes the entire "refund failed" failure class. | R-24 · **V1** |
| **D-03** | Menu approval scope | Which menu fields need admin approval before going live? | Reviewed: `name`, `description`, `ingredients_text`, `dietary_tags`, `allergen_tags`, `image`, `portion_description`. Instant: `price_cents`, availability, `category_id`, `sort_order`, `prep_minutes`, deletion. | Reviewed fields are halal and food-safety claims; instant fields are operational and would make the review queue the bottleneck of dinner service. | R-17 · **V1** |
| **D-04** | Price-change guardrail | Block, flag or ignore a large price increase? | Never block. Flag any increase >30% within 24 h; >5 flagged changes in 7 days opens an admin compliance task. | Bait-and-switch is the abuse vector when prices bypass review; blocking breaks legitimate cost changes. | R-15 · **V1** |
| **D-05** | Discount funding | Who pays for a discount — restaurant or platform? | **Decided:** restaurant-funded ([discount funding](../decisions/README.md#settled--reconciliations)). | Any other default lets a restaurant spend platform money. | decided |
| **D-06** | Commission | What does the platform charge? | **Decided:** 0% at launch, kept per restaurant as `commission_rate_bps` and switchable ([platform commission](../decisions/README.md#settled--client-decisions)). Restaurant does not bear processing, delivery or platform fees; tips pass to the rider. | Standard, auditable, and per-restaurant deals become a data change. | decided |
| **D-07** | Payout cadence | How often, how soon, what minimum? | **Decided:** weekly, Monday, automatic, no minimum ([payout cadence](../decisions/README.md#settled--client-decisions), [payout minimum](../decisions/README.md#settled--reconciliations)). Still proposed: **3-day hold** after delivery; daily/monthly options possibly later; Stripe bank payout only. | 3 days is the shortest hold that nets same-day disputes instead of clawing back. | R-32 · **V1** |
| **D-08** | On-demand payouts | Limits and fee for "request a payout"? | Min CAD 50 available, max 1/calendar day, CAD 1.50 fee, only while payout account `READY` and account `ACTIVE`. Standard 1–2 business day arrival — no "instant" promise. | Free unlimited on-demand payouts are a per-transaction cost and a fraud lever. | R-32 · V2 |
| **D-09** | Heartbeat-gated availability | Should a restaurant with no live session receive orders? | No. 30 s heartbeat; >5 min stale → `CLOSED_OFFLINE`; `is_accepting_orders` is not mutated, so service resumes automatically on reconnect. | Preventing an unattended offer is cheaper and more reliable than escalating after one. | R-22 · **V1** |
| **D-10** | Halal certifier allowlist | Which Canadian halal certifiers does the platform recognise? | **Decided:** three seeded bodies, extensible by a super admin; any other body puts the application in "waiting on certifying body" ([accepted certifying bodies](../decisions/README.md#settled--client-decisions), [body not on the accepted list](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)). | The platform's entire value proposition is that the halal claim is verifiable; an unbounded free-text issuer field makes it unverifiable. | decided |
| **D-11** | Canadian document set (FSSAI) | The SOW names FSSAI, an **Indian** authority with no Canadian meaning. What replaces it? | **Decided** ([FSSAI certificate](../decisions/README.md#settled--reconciliations)): `BUSINESS_LICENCE`, `HALAL_CERTIFICATE`, `FOOD_SAFETY` (provincial/municipal food-premises permit or food-handler certificate), `OWNER_ID`. `LIABILITY_INSURANCE` hidden until V2. `gst_hst_number` as a field, CRA format `\d{9}RT\d{4}` — **not** an Indian GSTIN. | FSSAI is a template error; no Canadian restaurant can produce one, and food-premises permitting in Canada is provincial/municipal. | decided |
| **D-12** | Expired-document consequence | Auto-suspend, flag, or grace period? | Expired `HALAL_CERTIFICATE` or `FOOD_SAFETY` → automatic suspension, **no grace period**. Expired `OWNER_ID` or `BUSINESS_LICENCE` → admin flag only. Reminders at T−30/14/7/1 (decided: [certificate renewal reminders](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)). | Trading on an expired halal certificate is the single failure that destroys the platform's premise. | R-10 · **V1** |
| **D-13** | Out-of-stock snooze | What durations, and when does an item come back? | A switch; off opens "for how long", default **until closing** (decided: ["for how long" options](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)). Other options: 1 hour / indefinitely. Per-minute auto-restore job; all "until closing" items restore at next opening; weekly digest of items unavailable >14 days. | Matches how a kitchen actually runs out of a prep batch, and stops menus silently rotting. | R-18 · **V1** |
| **D-14** | Cart vs out-of-stock | Drop the line, block checkout, or notify live? | **Never mutate the cart.** Annotate on read; block checkout with `409 cart_has_unavailable_items` and explicit line ids; live toast to connected customers. Never substitute. | Silent removal changes the price the customer thought they agreed to; silent substitution is a halal hazard. | R-19 · **V1** |
| **D-15** | Multi-location accounts | Can one login own several restaurants / can one restaurant have several menus? | **Decided:** one restaurant per login at launch ([one login for several restaurants](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)). One menu per restaurant stays the default. | Multi-tenancy inside a tenant touches every query, index and authorisation check; committing to it late is far cheaper than committing to it wrongly now. | decided |
| **D-16** | Post-acceptance cancellation | Is a restaurant penalised for cancelling an accepted order? | No monetary penalty in V1. Recorded, surfaced in reliability metrics; >5% over 7 days with ≥20 orders opens an admin compliance review. | Penalising on thin data drives supply away; measuring from day one keeps the option open. | R-28 · **V1** |
| **D-17** | Restaurant↔rider channel | Free text, masked call, or canned messages? | V1 canned messages only (fixed template enum); V2 masked voice via telephony proxy. **No free-text chat in V1 or V2.** | Free text needs moderation, PII controls, retention and a transport this surface otherwise does not need. | R-26 · **V1** |
| **D-18** | Dispute authority and SLA | Who can move money in a dispute, and how fast? | Support agent ≤ CAD 50; admin ≤ CAD 500; super admin above. First response 4 business hours, resolution target 3 business days; SLA breach auto-escalates priority. | The SOW defines the roles but no financial limits; tiered authority is the minimum ledger control. | R-33 · V2 |
| **D-19** | GST/HST | Who computes, collects and remits sales tax on food? | Platform computes on the delivery province's rate, collects from the customer, remits to the restaurant as `restaurant_tax_remittance`; the restaurant remains remitter of record. Platform fees taxed and invoiced separately. | Needed for a tax-inclusive checkout total, but the remitter question is a registration matter the SOW excludes from scope. **Requires an accountant's sign-off before build.** | R-31 · **V1 — external advice needed** |
| **D-20** | Prep time and ETA | Per item, per order, or restaurant-level? | `promised_ready_at = accepted_at + max(item prep times ∪ restaurant avg)`, capped at 90 min, adjustable once at accept time by ±15 min. | Max-of-items is the only rule that never promises a time the kitchen cannot meet. | R-15, R-24 · **V1** |
| **D-21** | Data retention | How long are orders, PII and documents kept? | Orders 7 years (business records); customer PII inside orders minimised after 90 days (initials + partial postal code); KYC documents 7 years after account closure; ticket attachments 2 years; notifications 90 days. | Canadian business-record retention vs. PIPEDA minimisation; the split keeps both satisfiable. | R-27, R-36 · V2 |
| **D-22** | Menu review SLA and fallback | What if admins never review a pending menu change? | **Decided:** never auto-approved, like KYC; a pending version waits for an admin ([menu approval](../decisions/README.md#settled--reconciliations)). SLA still proposed: 4 business hours. | An unreviewed claim never reaches customers just because time passed. | decided |
| **D-23** | Locale, currency, timezone | Are these per restaurant or global? | Currency **CAD only**, globally. Timezone **per restaurant** (IANA), driving every day boundary, report and schedule. Locale `en-CA` only until V3. | One currency removes an entire class of money bug; per-restaurant timezone is unavoidable in a country with six of them. | all · **V1** |
| **D-24** | Offer stacking | How many discounts can apply to one order? | Max one restaurant offer + one platform coupon; best-for-customer wins among restaurant offers; combined cap 50% of item subtotal; never applies to delivery fee, platform fee, tax or tip. | Unbounded stacking is the classic route to negative-revenue orders. | R-21 · V2 |
| **D-25** | Suspension vs pending offers | Cancel offers in flight at the moment of suspension, or let them be answered? | **Cancel and void** every `PENDING_RESTAURANT` order at the instant of suspension; customer gets an apology credit. Accepted orders always complete. | Letting a restaurant accept work seconds after being suspended for a halal violation is exactly the failure the platform exists to prevent. | R-36 · **V1** |
| **D-26** | Unattended-order escalation | SMS or phone a restaurant that is offered an order with no live session? | No — the heartbeat gate (D-09) prevents the offer instead. SMS/voice escalation deferred to V2 as an opt-in. | Preventing the bad offer beats escalating after it; escalation without a heartbeat gate still loses orders. | R-34 · V2 |

**Blocking for V1 build start**: D-01, D-02, D-03, D-09, D-12, D-19, D-20, D-25.
**Requires client-supplied data**: none; the certifier list and the document set are decided.
**Requires external professional advice**: D-19 (GST/HST remitter role).




