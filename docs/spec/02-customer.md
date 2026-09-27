# Halal Goes — CUSTOMER Domain Specification

**Target architecture:** Go modular monolith, single binary. PostgreSQL 17 + PostGIS · Redis · MinIO · Traefik. Expo (React Native) customer app.
**Contract source:** SOW items **9–17** (Customers).
**Ground truth for "what exists":** `scope/features-customer-rider.md`, `fleet/hg-fe-users-app.md`, `fleet/hg-api-*.md`, `fleet/crosscut-order-flow.md`.
**Date:** 2026-08-10 · **Status:** implementable spec, pending the decisions in §Decisions required.

---

## 0. Global conventions (binding on every feature below)

These exist so that individual features do not have to re-litigate them. Anything in §0 is a hard rule; a feature may narrow it, never widen it.

### 0.1 Market, locale, money

| Concern | Constraint |
|---|---|
| Launch market | **Canada only.** No other country may complete registration at V1. |
| Phone | E.164, country code `+1` only. National significant number exactly 10 digits, first digit 2–9. Stored as `user.phone` = `+1XXXXXXXXXX` (12 chars). |
| Currency | **CAD only.** Displayed as `$12.34` with the string `CAD` on receipts and refund records. |
| Money representation | **Integer minor units (cents), `int64`, everywhere in Go.** DB columns are `numeric(12,2)`. The existing `@db.Money` columns and all JS-float arithmetic in the current pricing activities are replaced. No `float64` may appear in any pricing, order, payment, or refund code path. |
| Rounding | A single helper `money.Round(cents int64) int64` = identity. Percentage discounts round **half-down to the cent** (`floor(x + 0.5)` on cents, ties toward the customer). The existing `roundPrice` (nearest 5¢) is deleted. |
| Locale | `en-CA` only at V1. No i18n layer; all copy is English. |
| Time | All timestamps stored UTC (`timestamptz`). Restaurant opening/closing hours evaluated in the restaurant's own `restaurants.timezone` (IANA string, e.g. `America/Toronto`). Customer-facing times rendered in the device timezone. |

### 0.2 API shape

- Base path `/api/v1`. Every response body is exactly:
  `{"data": <object|array|null>, "error": <null|{"code":string,"message":string,"details":object|null}>, "meta": <null|object>}`.
  No endpoint may return a bare array. (This kills the current `.data`-vs-bare-array split-brain between `LocationSelector` and cart/checkout.)
- `error.code` is a stable SCREAMING_SNAKE enum. Clients branch on `code`, never on `message`.
- Pagination is **cursor-based**: request `?limit=<1..50, default 20>&cursor=<opaque>`; response `meta = {"next_cursor": string|null, "has_more": bool}`. No `page`/`total_pages`.
- Idempotency: every state-changing customer endpoint that spends money or creates an order accepts a required `Idempotency-Key` header (UUIDv4, client-generated, retained 24 h in Redis `idem:{userId}:{key}`). Replay returns the original response with `meta.idempotent_replay=true`.

### 0.3 Authorization (non-negotiable)

- Every `/api/v1/**` customer endpoint requires `Authorization: Bearer <access JWT>`. There are **no unauthenticated customer endpoints** other than `/auth/otp/request` and `/auth/otp/verify`.
- Where a path contains `:userId`, the server asserts `jwt.sub == :userId` **and** `jwt.role == "customer"`, else `403 FORBIDDEN`. Where a path contains `:orderId`/`:cartId`/`:addressId`, the server asserts the resource's owner column equals `jwt.sub`, else `404 NOT_FOUND` (not 403 — do not leak existence).
- Access token TTL 15 min, refresh token TTL 30 days, refresh rotates (old refresh is single-use, reuse ⇒ revoke the whole family). Tokens are stored client-side in **expo-secure-store**, never AsyncStorage.
- The realtime socket authenticates with the access JWT in the connect frame. A client-supplied `userId` is never trusted (the current gateway does exactly that).

### 0.4 Realtime — what "real-time" means numerically

- Transport: a single **WSS** connection to `/api/v1/realtime`, one per app instance, authenticated per §0.3.
- Latency target: **p95 ≤ 3 s, p99 ≤ 8 s** from server-side state commit to client render, measured by `event.emitted_at` vs client receive.
- Rider position is published at **1 message / 10 s** while an order is in `PICKED_UP` or `ON_THE_WAY`. If no position has arrived for **45 s**, the map shows a "Location updating…" banner and freezes the last known marker.
- Degradation: if the socket is not `OPEN`, the client polls `GET /orders/:orderId` every **15 s**. Any feature that says "live" must remain correct (only less fresh) on the polling path.
- Reconnect: exponential backoff 1 s → 2 s → 4 s → 8 s → 15 s (cap), full jitter. On reconnect the client sends `resume{last_event_id}` and the server replays missed events for that order from Redis stream `order:{orderId}:events` (retained 6 h).

### 0.5 Sizing / versioning key

- **V1** — required to accept a real, paid order from a real customer in Canada.
- **V2** — contracted in the SOW, not launch-blocking.
- **V3** — nice-to-have / explicitly hedged in the SOW.
- **S** < 1 h agent work · **M** hours · **L** a day or more. Sized against a clean Go + Expo build, not against patching today's code.

---

## 1. Account management (SOW 9)

### C-01 — Registration & phone OTP verification
- **SOW trace**: *"Registration: Customers can register on the application using their phone number and OTP verification."*
- **Behaviour**: Customer enters a Canadian mobile number (`+1`, 10 national digits). Server issues a 6-digit numeric OTP valid **5 minutes**, delivered by SMS. Customer enters the code; on success the server returns either (a) an `onboarding_token` (scope `onboarding`, TTL 30 min) if no `users` row exists for that phone, or (b) an access+refresh pair if one does. The onboarding token is exchangeable exactly once at `POST /auth/register` after profile completion (C-03).
- **Data**: `users.id`, `users.phone`, `users.phone_verified`, `users.created_at`, `users.onboarding_state`. `otp_challenges(id, phone, code_hash, attempts, expires_at, consumed_at, ip, created_at)`. Redis `otp:rl:{phone}` and `otp:rl:{ip}`.
- **States**: `users.onboarding_state ∈ {PHONE_VERIFIED, PROFILE_PENDING, ACTIVE, SUSPENDED, DELETED}`.
  - `(none) → PHONE_VERIFIED` — triggered by successful OTP verify creating the row.
  - `PHONE_VERIFIED → PROFILE_PENDING` — automatic, on issuing the onboarding token.
  - `PROFILE_PENDING → ACTIVE` — triggered by C-03 profile completion.
  - `ACTIVE → SUSPENDED` — triggered by an admin action only.
  - `ACTIVE|SUSPENDED → DELETED` — triggered by C-05.
  - The legacy `REGISTERED` value is removed.
- **Rules**:
  1. OTP code is stored only as `bcrypt(code)`; the plaintext never persists and is never logged.
  2. Rate limits: **3 OTP requests per phone per rolling 15 min**, **10 per IP per rolling hour**. Exceeding ⇒ `429 OTP_RATE_LIMITED` with `details.retry_after_seconds`.
  3. **5 verify attempts** per challenge; on the 5th failure the challenge is consumed and a new request is required. Response is a constant-time generic `OTP_INVALID` — never distinguish "wrong code" from "expired".
  4. Resend is allowed after a **30 s** client-enforced and server-enforced cooldown; a resend invalidates the previous challenge.
  5. A phone already attached to a `SUSPENDED` user returns `403 ACCOUNT_SUSPENDED` at verify time (not at request time).
  6. `+1` is the only accepted country code; any other returns `400 UNSUPPORTED_COUNTRY`.
  7. SMS-send failure returns `502 OTP_DELIVERY_FAILED` and does **not** consume the rate-limit budget.
- **Acceptance criteria**:
  1. Given a fresh phone `+15551234567`, when OTP request → correct code verify, then a `users` row exists with `phone_verified=true`, `onboarding_state='PHONE_VERIFIED'`, and the response contains an `onboarding_token` and **no** access token.
  2. Given 3 OTP requests in 10 minutes for one phone, when a 4th is requested, then the response is `429 OTP_RATE_LIMITED` and no SMS is dispatched.
  3. Given a challenge, when 5 wrong codes are submitted, then the 6th submission with the *correct* code returns `400 OTP_INVALID`.
  4. Given an expired (>5 min) challenge, when the correct code is submitted, then the response is `400 OTP_INVALID` and the response time is within 20 ms of the wrong-code path.
- **Out of scope**: email/password login; Google/Apple/Facebook sign-in; WhatsApp OTP; voice-call OTP; any country other than Canada; phone-number *change* (see out-of-scope note in C-03); CAPTCHA; device fingerprinting.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — SMS provider**: Which SMS provider sends OTP in Canada, and who owns the account and the A2P/short-code registration? · **Proposed default**: Twilio Programmable Messaging with a Canadian long code, credentials owned by the client, provider abstracted behind an `SMSSender` interface with a `LogSender` implementation for dev. · **Why**: the SOW names Twilio as a dependency and Canadian A2P registration is a client-side legal obligation with a multi-week lead time.

> **DECISION REQUIRED — Supabase retirement**: OTP is currently sent via Supabase inside `@halal-goes/auth`. Does the rebuild keep Supabase or move OTP fully in-house? · **Proposed default**: remove Supabase entirely; the Go monolith owns `otp_challenges` and calls the SMS provider directly. · **Why**: a single binary with Postgres/Redis/MinIO is the stated architecture; a second identity system is a second failure and audit surface.

---

### C-02 — Login, logout, session lifecycle
- **SOW trace**: *"Login/Logout: Customers can login and logout to and from the application"*
- **Behaviour**: Login is the same OTP flow as C-01 landing on an existing `ACTIVE` user, which returns `{access_token, refresh_token, expires_in}`. The app refreshes proactively at **T-120 s** before access expiry and reactively once on a `401`. Logout revokes the presented refresh token family server-side and clears all local state (tokens, cart cache, address cache, selected payment method).
- **Data**: `refresh_tokens(id, user_id, family_id, token_hash, issued_at, expires_at, revoked_at, replaced_by, user_agent, ip)`. Redis `revoked:jti:{jti}` (TTL = remaining access TTL) for immediate access-token kill.
- **States**: refresh token ∈ `{ACTIVE, ROTATED, REVOKED}`. `ACTIVE → ROTATED` on successful refresh; `ACTIVE|ROTATED → REVOKED` on logout, on detected reuse, or on admin suspension.
- **Rules**:
  1. Presenting a `ROTATED` refresh token (replay) revokes the **entire family** and returns `401 REFRESH_REUSE_DETECTED`; the client must re-run OTP.
  2. The refresh endpoint returns `{access_token: string, refresh_token: string}`. The client sets `Authorization: Bearer ` + `response.access_token` — the current `Bearer [object Object]` defect is a regression test, not just a bug fix.
  3. Exactly **one** in-flight refresh per app instance (single-flight mutex); concurrent 401s queue behind it.
  4. Logout is idempotent: logging out with an already-revoked token returns `204`.
  5. Refresh failure classes are distinguished: `REFRESH_EXPIRED` (silent re-auth prompt), `REFRESH_REUSE_DETECTED` (forced logout + security notice), network error (retry, do **not** log the user out).
  6. Server clock skew tolerance on JWT `exp`/`nbf`: 60 s.
- **Acceptance criteria**:
  1. Given a valid refresh token used twice concurrently, when both requests complete, then exactly one succeeds, the family is revoked, and the second returns `401 REFRESH_REUSE_DETECTED`.
  2. Given an access token that expired 1 s ago, when any authenticated call is made, then the client refreshes once and the retried call succeeds with a correctly formed `Authorization` header (asserted by a test that inspects the outgoing header string).
  3. Given logout, when the app is force-quit and relaunched, then no token exists in SecureStore and the app lands on the phone-entry screen.
  4. Given an admin suspends the account, when the customer's next access token expires, then refresh returns `403 ACCOUNT_SUSPENDED` and the app shows the suspension screen.
- **Out of scope**: "remember this device"; biometric unlock; concurrent-session limits; per-device session listing/revocation UI; social login.
- **Version**: V1 · **Size**: M

---

### C-03 — Profile management (personal information)
- **SOW trace**: *"Profile Management: … Update personal information"*
- **Behaviour**: After phone verification the customer supplies `first_name`, `last_name`, `email`, `date_of_birth`; submitting completes onboarding and moves the account to `ACTIVE`. Thereafter the same four fields (minus phone) are editable from Account → Personal details. `email` changes require re-verification by emailed link before `email_verified` flips.
- **Data**: `users.first_name`, `users.last_name`, `users.email`, `users.email_verified`, `users.date_of_birth`, `users.avatar_object_key` (MinIO), `users.onboarding_state`, `users.last_modified_at`.
- **States**: `users.email_verified ∈ {false,true}`; setting a new email sets it to `false` and creates `email_verifications(id, user_id, email, token_hash, expires_at, consumed_at)` with a 24 h TTL.
- **Rules**:
  1. Validation: `first_name`/`last_name` 1–50 chars, letters/space/hyphen/apostrophe only. `email` RFC 5322 + ≤320 chars, lowercased on write. `date_of_birth` ⇒ age **≥ 13** on the day of submission (matches today's zod rule).
  2. The request/response field names are **`first_name` / `last_name`** in snake_case. There is no `name` field anywhere (the current app sends `{name,...}` against a `first_name/last_name` contract).
  3. `phone` is read-only on this endpoint; sending it returns `400 FIELD_NOT_EDITABLE`.
  4. Email is **not unique** (matches the existing schema — phone is the identity). Two accounts may share an email.
  5. Avatar upload uses a MinIO presigned PUT (`POST /users/:id/avatar/upload-url` → PUT → `POST /users/:id/avatar/confirm`); max 5 MB, `image/jpeg|png|webp` only, server re-encodes to 512×512 webp.
  6. Profile completion is required before any cart or order endpoint will accept a request: those return `409 PROFILE_INCOMPLETE`.
- **Acceptance criteria**:
  1. Given a user in `PROFILE_PENDING`, when a valid profile is submitted, then `onboarding_state='ACTIVE'` and the onboarding token is consumed and rejected on reuse.
  2. Given `date_of_birth` making the user 12 years 364 days old, when submitted, then the response is `400 VALIDATION_FAILED` with `details.date_of_birth`.
  3. Given an authenticated user, when `PATCH /users/:id` sends `{"name":"X"}`, then the response is `400 VALIDATION_FAILED` — no partial write occurs.
  4. Given an email change, when the emailed link is opened within 24 h, then `email_verified=true`; when opened after 24 h, then `410 VERIFICATION_EXPIRED` and the email reverts to the previous verified value.
- **Out of scope**: changing the phone number (no flow at any version — a phone change is an account migration and is deliberately deferred); merging accounts; profile visibility settings; gender/pronoun fields; marketing consent capture (see C-04).
- **Version**: V1 · **Size**: M

---

### C-04 — Preferences
- **SOW trace**: *"Profile Management: Manage preferences"* — the SOW gives no list.
- **Behaviour**: A single Preferences screen with exactly these toggles and no others: (a) **Dietary** — `veg_only` (bool), `exclude_dairy` (bool), `excluded_allergens` (multi-select from the platform allergen vocabulary); (b) **Notifications** — `push_order_updates` (locked on, see C-40), `push_promotions`, `email_promotions`, `sms_promotions`; (c) **Discovery** — `default_sort` ∈ {RECOMMENDED, RATING, ETA, DISTANCE}. Dietary preferences act as a **default filter pre-fill** on discovery (C-11), never as a hard server-side content block.
- **Data**: new `user_preferences(user_id PK/FK, veg_only bool, exclude_dairy bool, excluded_allergens text[], push_order_updates bool, push_promotions bool, email_promotions bool, sms_promotions bool, default_sort text, updated_at)`. Allergen vocabulary comes from the distinct values of `food_items.allergens[]` curated into a new `allergens(code, label)` table.
- **States**: none (a settings row; created lazily with defaults on first read).
- **Rules**:
  1. Defaults: everything `false` except `push_order_updates=true`, `default_sort='RECOMMENDED'`.
  2. `push_order_updates` cannot be set to `false` via the API (`400 FIELD_NOT_EDITABLE`) — transactional order notifications are not optional. OS-level notification denial is handled in C-40.
  3. `excluded_allergens` accepts only codes present in `allergens`; unknown codes ⇒ `400 VALIDATION_FAILED`, whole request rejected.
  4. Preferences pre-fill discovery filters on app cold start only; if the customer clears a filter in-session it stays cleared for that session.
  5. Dietary preferences **never** hide an item from a restaurant menu — items matching an excluded allergen render with a red allergen chip and an "Contains {allergen}" warning instead.
- **Acceptance criteria**:
  1. Given `veg_only=true`, when the customer opens Search after a cold start, then the veg-only filter chip is active and results contain no item with `is_non_veg=true`.
  2. Given `excluded_allergens=['peanuts']`, when the customer opens a menu containing a peanut item, then the item is visible and carries a "Contains peanuts" warning chip.
  3. Given a `PATCH /users/:id/preferences` with `push_order_updates=false`, then the response is `400 FIELD_NOT_EDITABLE` and the stored value remains `true`.
- **Out of scope**: language preference; currency preference; halal-school/madhhab preference (see decision below); saved dietary profiles per household member; preference-driven recommendation training.
- **Version**: V3 · **Size**: M

> **DECISION REQUIRED — halal strictness preferences**: Should customers be able to filter by certifying body or halal school of thought (e.g. hand-slaughtered vs. machine, alcohol-serving premises)? · **Proposed default**: **No at V1–V3.** Certification is a single binary + the certifying body's name shown as text (C-12). No filtering by body or method. · **Why**: encoding madhhab distinctions is a religious-authority judgement the vendor cannot make, and getting it wrong is a brand-fatal error.

---

### C-05 — Account deletion
- **SOW trace**: not in the SOW. Included because Apple App Store Guideline 5.1.1(v) and Google Play's Data Deletion policy make it a **ship blocker**, and PIPEDA gives Canadian users a withdrawal-of-consent right.
- **Behaviour**: Account → Delete account → typed confirmation → server marks the account for deletion and immediately logs the user out. A **7-day grace period** allows recovery by logging in again with the same phone. After 7 days a job hard-anonymises the record.
- **Data**: `users.is_deleted`, `users.deleted_at`, `users.deletion_scheduled_for`, `users.phone` (rewritten at purge), `users.first_name/last_name/email/date_of_birth/avatar_object_key` (nulled at purge). `deletion_requests(id, user_id, requested_at, reason_code, executed_at)`.
- **States**: `ACTIVE → PENDING_DELETION` (customer request) → `DELETED` (purge job, ≥7 days) or → `ACTIVE` (customer logs in during grace).
- **Rules**:
  1. Deletion is **refused** with `409 DELETION_BLOCKED_ACTIVE_ORDER` while the customer has an order not in a terminal state (`DELIVERED|CANCELLED|REJECTED|REFUNDED`), or a refund request in `REQUESTED|UNDER_REVIEW`.
  2. Purge nulls PII and rewrites `users.phone` to `+1000000000{n}` (unique, non-dialable) so `phone` uniqueness is preserved.
  3. Orders, receipts, and payment ledger rows are **retained for 7 years** (Canadian record-keeping) with `customer_id` intact but PII resolved through the anonymised user row. Reviews are retained with the author shown as "Deleted user".
  4. A confirmation email (if `email_verified`) and SMS are sent at request time and at purge time.
  5. Re-registering the same phone after purge creates a brand-new account with no history.
- **Acceptance criteria**:
  1. Given an order in `ON_THE_WAY`, when deletion is requested, then `409 DELETION_BLOCKED_ACTIVE_ORDER` and no state changes.
  2. Given a deletion request 3 days old, when the customer completes OTP login with the same phone, then the account returns to `ACTIVE` with cart empty and addresses intact.
  3. Given a deletion request 8 days old, when the purge job runs, then `users.first_name/last_name/email/date_of_birth` are `NULL`, `phone` no longer matches the original, and `orders` rows for that customer still exist with their totals.
- **Out of scope**: data-export ("download my data"); selective deletion of individual orders or reviews; deletion initiated from the web.
- **Version**: V1 · **Size**: M

---

### C-06 — Help centre & FAQ
- **SOW trace**: *"Support and Help: Access FAQs"*
- **Behaviour**: A Help hub listing categories (Orders & tracking, Payments & refunds, Delivery, Account, Halal certification) each containing accordion Q&A. Content is served from the backend so it can be corrected without an app release, cached client-side for 24 h with stale-while-revalidate. A client-side substring search filters across question and answer text.
- **Data**: new `help_articles(id, category_code, question, body_markdown, sort_order, is_published, locale, updated_at)`; `help_categories(code, label, sort_order)`.
- **States**: `help_articles.is_published ∈ {false,true}`; only `true` is served to customers.
- **Rules**:
  1. Body is a constrained Markdown subset: headings h3–h4, bold, italic, links, ordered/unordered lists. No raw HTML, no images at V1.
  2. `GET /help/articles` returns all published articles for `locale='en-CA'` in one response (expected < 200 KB); the client does not paginate.
  3. **No FAQ article may describe a flow that does not exist.** A CI check asserts that every `help_articles.body_markdown` mentioning "Cancel Order", "modify your order", or "reschedule" is linked to a shipped feature ID; unlinked mentions fail the build. (Today's FAQ instructs users to use a cancel flow that was never built.)
  4. Every article ends with an escalation affordance routing to C-08 (V2+) or C-07 (V1).
  5. Legal documents (Terms, Privacy, Refund Policy) are served through the same endpoint under category `LEGAL` and **must contain zero `[App Name]` / `[Date]` placeholder tokens** — enforced by a publish-time validator.
- **Acceptance criteria**:
  1. Given the app is offline, when Help is opened within 24 h of the last fetch, then cached articles render and a "last updated" timestamp is shown.
  2. Given an article body containing the literal `[App Name]`, when an admin attempts to publish it, then publishing fails with `422 PLACEHOLDER_TOKEN_PRESENT`.
  3. Given a search term "refund", when typed into Help search, then every article whose question or body contains "refund" (case-insensitive) is listed and no other article is.
- **Out of scope**: multi-language articles; video content; AI-generated answers; per-user personalised help; in-article deep links into arbitrary app routes (only the escalation link is interactive).
- **Version**: V1 · **Size**: M

---

### C-07 — Call support
- **SOW trace**: *"Support and Help: … Call support"*
- **Behaviour**: A "Call support" button that opens the device dialler (`tel:`) with a single platform support number fetched from `GET /config/public` (never hardcoded). The button is shown only inside the support hours configured on that config object; outside hours it is replaced by "Support is closed — message us instead" routing to C-08.
- **Data**: `platform_config` row keys `support_phone_e164`, `support_hours_open_local`, `support_hours_close_local`, `support_timezone`, `support_enabled`.
- **States**: derived only: `OPEN` / `CLOSED` computed from the config and current time.
- **Rules**:
  1. The number is `tel:`-dialled by the OS. The app does **not** place VoIP calls and does not record calls.
  2. `Linking` must be imported in the calling module — a lint rule (`no-undef` on `Linking`) plus a smoke test asserts the button does not throw. (Today's equivalent button crashes with a `ReferenceError`.)
  3. If `support_enabled=false`, the button is not rendered at all.
  4. The customer's `user_id` and any in-context `order_id` are copied to the clipboard and shown on screen before dialling, so the agent can be given a reference.
- **Acceptance criteria**:
  1. Given `support_enabled=true` and the current time inside support hours, when "Call support" is tapped, then the OS dialler opens pre-filled with the configured E.164 number and no exception is thrown.
  2. Given the current time outside support hours, when the Help screen renders, then no dial button is present and the "message us" affordance is shown instead.
  3. Given a support call initiated from an order screen, when the dialler opens, then the on-screen reference string contains the order's short code.
- **Out of scope**: in-app VoIP; call queueing/IVR; masked numbers for support; callback requests; call transcripts.
- **Version**: V2 · **Size**: S

> **DECISION REQUIRED — support staffing & hours**: Is there a staffed phone line, and what are its hours and timezone? · **Proposed default**: no phone line at V1; ship C-08 (async ticket) as the only channel and set `support_enabled=false`. · **Why**: a dial button to an unstaffed number is worse than no button, and the SOW puts "Helpdesk" explicitly **out of scope**.

---

### C-08 — Customer support: message thread ("live chat")
- **SOW trace**: *"Support and Help: … Live chat"* and *"Customer Support: Chat or call customer service for assistance with orders, payments, or other issues."*
- **Behaviour — the ambiguity resolved**: "Live chat" is **an asynchronous, persistent support ticket thread**, not a synchronous human chat and not a canned-response bot. The customer opens a ticket with a category and free text (optionally attached to an order), and receives replies from a support agent in the admin back-office. New agent messages arrive over the realtime socket when the app is open and as a push notification when it is not. There is no typing indicator, no presence, no guaranteed instant reply.
- **Data**: new `support_tickets(id, user_id, order_id NULL, category_code, subject, status, priority, created_at, first_response_at, resolved_at, closed_at, assigned_agent_id)`; `support_ticket_messages(id, ticket_id, author_type ENUM(CUSTOMER,AGENT,SYSTEM), author_id, body, created_at, read_by_customer_at)`; `support_ticket_attachments(id, message_id, object_key, content_type, bytes)`.
- **States**: `support_tickets.status ∈ {OPEN, AWAITING_CUSTOMER, AWAITING_AGENT, RESOLVED, CLOSED}`.
  - `(new) → AWAITING_AGENT` — customer creates the ticket.
  - `AWAITING_AGENT → AWAITING_CUSTOMER` — agent posts a message.
  - `AWAITING_CUSTOMER → AWAITING_AGENT` — customer posts a message.
  - `AWAITING_* → RESOLVED` — agent marks resolved.
  - `RESOLVED → AWAITING_AGENT` — customer replies within 7 days (reopen).
  - `RESOLVED → CLOSED` — automatic 7 days after resolution; a closed ticket cannot be reopened, only referenced by a new one.
- **Rules**:
  1. Category codes (fixed enum): `ORDER_ISSUE`, `PAYMENT_ISSUE`, `REFUND`, `DELIVERY_ISSUE`, `RIDER_CONDUCT`, `RESTAURANT_ISSUE`, `HALAL_CONCERN`, `ACCOUNT`, `OTHER`. `HALAL_CONCERN` is auto-set `priority='HIGH'`.
  2. Message body 1–4000 chars. Max **3 attachments** per message, each ≤ 10 MB, `image/jpeg|png|webp` or `application/pdf`, uploaded by MinIO presigned PUT.
  3. A customer may hold at most **5 non-closed tickets**; a 6th returns `409 TOO_MANY_OPEN_TICKETS`.
  4. Rate limit: 20 messages per ticket per hour.
  5. The UI states the expected response time from `platform_config.support_first_response_target_hours` (default 24) and shows the actual elapsed time. **No message claims a live agent is present.**
  6. Grievances (C-39) are a distinct entity and are *not* modelled as tickets, but a grievance may spawn a linked ticket.
- **Acceptance criteria**:
  1. Given a customer with 5 non-closed tickets, when a 6th is created, then `409 TOO_MANY_OPEN_TICKETS` and no row is written.
  2. Given an open ticket and the app backgrounded, when an agent posts a reply, then a push notification arrives within the C-40 latency budget and opening it lands on that ticket thread.
  3. Given a ticket `RESOLVED` 8 days ago, when the customer attempts to post a message, then `409 TICKET_CLOSED` and the UI offers "Start a new request" pre-filled with a reference to the closed ticket.
  4. Given a message with 4 attachments, when submitted, then `400 TOO_MANY_ATTACHMENTS` and no attachment is persisted.
- **Out of scope**: synchronous/live agent chat with presence; chatbots or canned auto-replies; third-party helpdesk integration (Zendesk/Intercom); voice notes; agent-initiated outbound threads; SLA escalation automation.
- **Version**: V2 · **Size**: L

---

## 2. Restaurant & food discovery (SOW 10)

### C-09 — Home feed
- **SOW trace**: implied by *"Restaurant and Food Discovery"* and the Month-1 milestone *"Customer App (Mobile): Basic features like registration, restaurant search, and order placement."*
- **Behaviour**: On the home screen the app calls `GET /feed?lat&lng` (no `:userId` in the path — the user comes from the JWT) and renders a fixed, ordered list of sections. **Exactly these sections, in this order**, each omitted entirely when empty (never rendered as an empty shell): `order_again` (max 6), `restaurants_near_you` (max 20), `trending_in_your_area` (max 8), `your_favourite_restaurants` (max 10), `popular_items` (max 10), `you_might_like` (max 10). Each restaurant card shows: name, hero image, **halal badge (C-12)**, cuisine list (max 2 + "+n"), `rating_avg` to 1 dp with review count, distance in km to 1 dp, ETA range (C-14), price band, and an "Closed" / "Not accepting orders" overlay when applicable.
- **Data**: `restaurants.*`, `restaurant_addresses.coords`, `orders` (for `order_again`/trending), `user_favorite_restaurant`, `food_items.rating_avg`, `restaurant_cuisines`. Response cached in Redis `feed:{userId}:{geohash7}` for **120 s**.
- **States**: none.
- **Rules**:
  1. Geo: nearby = restaurants whose `restaurant_addresses.coords` is within `platform_config.max_delivery_radius_km` (default **12 km**) of the request point, computed with PostGIS `ST_DWithin` on `geography` — **not** the current degrees×111 approximation.
  2. `order_again` = distinct restaurants from the customer's last 20 `DELIVERED` orders, most recent first. `trending_in_your_area` = restaurants ranked by `DELIVERED` order count in the last **30 days** within the radius, minimum 10 orders to qualify. `you_might_like` = restaurants sharing a cuisine with the customer's top-3 ordered cuisines, excluding those already in `order_again`.
  3. Only restaurants where `is_approved=true AND is_banned=false AND is_deleted=false AND halal_display_state IN ('CERTIFIED','EXPIRING_SOON')` (C-12) are ever returned. This is enforced in one SQL predicate used by feed, search and detail alike.
  4. Card fallbacks are forbidden: a missing image renders a neutral placeholder asset, a missing rating renders "New" — the current hardcoded `'4.6'` rating and `'25-35 min'` ETA fallbacks are removed and covered by a test that greps for them.
  5. If location permission is denied, the app shows an explicit "Set your delivery address to see nearby restaurants" state and calls the feed with the coordinates of the customer's default address; if there is none, it shows an address-entry prompt. **There is no geographic fallback constant** — the current Hyderabad (17.385, 78.487) and Dubai (25.2048, 55.2708) fallbacks are deleted.
  6. Pull-to-refresh bypasses the Redis cache (`Cache-Control: no-cache`), rate-limited to 1 per 10 s per user.
- **Acceptance criteria**:
  1. Given a customer at coordinates with no restaurant within 12 km, when the feed loads, then every section is absent and a single "No restaurants deliver here yet" state renders — not an empty scroll.
  2. Given a restaurant with `is_banned=true`, when the feed is requested, then that restaurant appears in no section (asserted for all six sections).
  3. Given location permission denied and no saved address, when home opens, then no feed request is made with coordinates `0,0` or any hardcoded city, and the address prompt is shown.
  4. Given a section returns fewer than its max, when rendered, then no placeholder cards are drawn.
- **Implementation status (Sep 2026)**:
  - Served: `order_again`, `restaurants_near_you`, `trending_in_your_area`, `you_might_like`.
  - Required but not served yet (R-14): `your_favourite_restaurants` needs C-17 (favourites) built first; `popular_items` needs a definition (O-07).
  - Radius, trending window, trending floor and rail size come from `discovery_config`, not the figures above — see decision **R-14**. Every section is capped at `rail_size`.
  - Every section is radius-gated, the personal ones included (AC1). A request with no point returns no sections (rule 5).
  - Not yet built: the 120 s Redis cache, resolving `delivery_address_id` to a point, and the pull-to-refresh cache bypass.
- **Out of scope**: sponsored placement / paid ranking; ML recommender training; infinite scroll on the home screen (see C-11 for the full list); banner/ad carousels backed by a campaign system (V3, not specified here); category tiles (folded into C-11 filters).
- **Version**: V1 · **Size**: L

---

### C-10 — Search (restaurants and dishes)
- **SOW trace**: *"Search and Filter: Customers can search for restaurants or dishes by name, cuisine, or location."*
- **Behaviour**: A single search box searching **three** target types simultaneously: restaurant name, dish name, and cuisine name. Query is debounced **250 ms** client-side, minimum **2 characters**. Results are returned as two labelled groups, `restaurants` and `food_items`, each independently cursor-paginated. A cuisine match promotes all restaurants carrying that cuisine into the `restaurants` group. Recent searches (last 10, local only) and platform trending searches (top 10 by 7-day count) are offered as chips when the box is empty.
- **Data**: `restaurants.name` (trigram + full-text), `food_items.item_name`, `food_items.item_description`, `cuisines.name`, `user_search_history(user_id, query, created_at)`. Trending computed nightly into `trending_searches(query, count, computed_at)`.
- **States**: none.
- **Rules**:
  1. Matching: Postgres `pg_trgm` similarity ≥ **0.3** OR `websearch_to_tsquery` full-text match on an `unaccent`-normalised column. Ranking = `ts_rank * 0.6 + similarity * 0.4`, tie-broken by distance ascending.
  2. Minimum query length is **2** and the error message says "2" — the current backend says "greater than 3 characters" while checking `<= 3`.
  3. Results are filtered by the same visibility predicate and radius as C-09. A dish result whose restaurant is closed still appears, marked "Closed".
  4. Each group paginates independently with its own cursor (`meta.restaurants.next_cursor`, `meta.food_items.next_cursor`). Page size default 10 per group, max 25.
  5. The response cache key is `search:{sha256(normalised_query)}:{geohash6}:{limit}:{cursor}` with a **300 s** TTL and a JSON-serialised value. (The current cache stores `[object Object]` under a key that ignores user, page and limit.)
  6. Every executed search writes one `user_search_history` row (deduplicated within 60 s).
  7. Filters from C-11 apply to search identically to browse; the same query object serves both.
- **Acceptance criteria**:
  1. Given the query `"biry"`, when searched, then a dish named "Chicken Biryani" appears in `food_items` (trigram match) and the response arrives in ≤ 400 ms p95 against a 10 000-item dataset.
  2. Given a 1-character query, when submitted, then no network request is made and the UI shows "Type at least 2 characters".
  3. Given two different users issuing the same query from different cities, when both are served from cache, then each receives results for their own city (cache key includes geohash).
  4. Given a search with `has_more=true`, when the next cursor is requested for `food_items` only, then `restaurants` is unchanged and no duplicate `food_items` appear across pages.
- **Out of scope**: voice search; typo "did you mean" suggestions; searching by address/postal code (location means the customer's current point, not a typed place); searching reviews; search within order history; synonym dictionaries.
- **Version**: V1 · **Size**: M

---

### C-11 — Filters and sort ("advanced filters")
- **SOW trace**: *"Advanced filters include price range, ratings, and delivery time."*
- **Behaviour — the ambiguity resolved**: "Advanced filters" is **exactly this closed set**, applied identically to browse and search, combinable, and encoded in the query string so a filtered view is shareable and restorable:

  | Filter | Param | Type / allowed values | Semantics |
  |---|---|---|---|
  | Cuisine | `cuisines` | multi-select of `cuisines.name` | restaurant carries **any** selected cuisine (OR within, AND across filters) |
  | Price band | `price_band` | multi-select of `1,2,3` (`$`,`$$`,`$$$`) | band = median `food_items.item_price` of the restaurant's active menu: `1` < $12, `2` $12–24.99, `3` ≥ $25 |
  | Minimum rating | `min_rating` | one of `3.5, 4.0, 4.5` | `restaurants.rating_avg >= value`; restaurants with < 5 reviews are excluded when this filter is on |
  | Max delivery time | `max_eta_minutes` | one of `30, 45, 60` | upper bound of the C-14 ETA range ≤ value |
  | Veg only | `veg_only` | bool | restaurant has ≥1 available item with `is_non_veg=false`; **and** the restaurant menu view auto-hides non-veg items |
  | Open now | `open_now` | bool | C-14 availability = `OPEN` |
  | Free delivery | `free_delivery` | bool | computed delivery fee for this customer's address = 0 |
  | Has offers | `has_offers` | bool | ≥1 non-expired `restaurant_offers` or `food_item_offers` |
  | Distance | `max_distance_km` | one of `2, 5, 10, 12` | ≤ value, capped by the platform radius |

  Sort (single-select, mutually exclusive): `RECOMMENDED` (default — the C-09 ranking), `RATING_DESC`, `ETA_ASC`, `DISTANCE_ASC`, `PRICE_ASC`.
  **Halal certification is not a filter** — it is a precondition for being listed at all (C-12). The UI states this once, as a header: "Every restaurant on Halal Goes is halal certified."
- **Data**: read-only over `restaurants`, `restaurant_cuisines`, `food_items`, `restaurant_offers`, `food_item_offers`, `restaurant_addresses.coords`. A materialised `restaurant_facets(restaurant_id, price_band, median_price_cents, has_veg, min_item_price_cents, offer_count, refreshed_at)` refreshed on menu write and nightly.
- **States**: none.
- **Rules**:
  1. Filters combine as **AND across filter types, OR within a multi-select**.
  2. The active filter count is shown on the Filters button; "Clear all" resets to the C-04 preference defaults, not to empty.
  3. An unknown filter key or an out-of-enum value returns `400 VALIDATION_FAILED` — filters are never silently ignored.
  4. When a filter combination yields zero results, the UI shows which filter is most restrictive (the one whose removal yields the largest result count, computed by the server returning `meta.relaxation_hint`) and offers a one-tap removal.
  5. Filter state persists across the session and is restored from the URL/route params on navigation back; it does **not** persist across app restarts (preferences do, per C-04).
- **Acceptance criteria**:
  1. Given `cuisines=lebanese,turkish&min_rating=4.0`, when applied, then every returned restaurant carries Lebanese **or** Turkish **and** has `rating_avg >= 4.0` with ≥5 reviews.
  2. Given `max_eta_minutes=30`, when applied, then no returned restaurant's ETA upper bound exceeds 30.
  3. Given an unknown param `?spicy=true`, when the request is made, then `400 VALIDATION_FAILED` naming `spicy`.
  4. Given a zero-result filter set, when rendered, then `meta.relaxation_hint` names exactly one filter key and tapping it re-runs the query without that filter yielding ≥1 result.
- **Out of scope**: filtering by certifying body or halal method (see C-04 decision); "delivery vs pickup" toggle (no pickup at any version); dietary filters beyond veg-only (allergens are warnings, not filters); saved filter presets; filter by promo code eligibility.
- **Version**: V2 · **Size**: L

---

### C-12 — Halal certification display and verification ★ CRITICAL
- **SOW trace**: *"Halal Certification: View and verify Halal certifications for restaurants."* · Project goal: *"build a platform where users could easily find restaurants around them that provide halal certified food."* · Definition: *"Halal Certification: Official certification provided by recognized authorities confirming that food products comply with Islamic dietary laws."*
- **Behaviour**: This is the product's reason to exist and is currently rendered **nowhere**. Three surfaces:
  1. **Badge** — on every restaurant card (feed, search, favourites, order history, receipt) and in the restaurant detail header. One of exactly four visual states, defined below. Badge = shield glyph + one-word label; never a bare tick.
  2. **Certification panel** — a dedicated, always-reachable section on the restaurant detail page, above the menu, showing: certifying body name, certificate number, issue date, **expiry date in absolute form** ("Valid until 14 March 2027"), verification status, the date the platform admin verified it, and a "View certificate" action.
  3. **Certificate viewer** — opens the admin-verified certificate document from MinIO through a **short-lived presigned GET (TTL 300 s)** issued per request, rendered in-app (image) or in the system PDF viewer.
- **Data**: `restaurants.is_halal_certified`, `restaurants.halal_certification_expiry`, `restaurants.is_approved`, `restaurants.approved_at`, `restaurants.approved_by_admin_id`, `restaurants.is_banned`. Replacing the untyped `halal_certification_docs Json[]`: new `halal_certifications(id, restaurant_id, certifying_body_name, certifying_body_id NULL, certificate_number, issued_on, expires_on, document_object_key, document_content_type, status, verified_by_admin_id, verified_at, rejection_reason, created_at)`. Optional reference table `certifying_bodies(id, name, country, website_url, is_recognised)`.
- **States**: `halal_certifications.status ∈ {PENDING, VERIFIED, REJECTED, EXPIRED, REVOKED}` (admin-driven; the customer app is read-only).
  Derived, **customer-visible** `halal_display_state` — computed, never stored:
  | State | Condition | Badge | Orderable? |
  |---|---|---|---|
  | `CERTIFIED` | latest cert `status=VERIFIED` AND `expires_on > today + 30d` | green shield "Halal certified" | yes |
  | `EXPIRING_SOON` | `status=VERIFIED` AND `today < expires_on ≤ today + 30d` | green shield + amber "Certificate renews {date}" note on the detail panel only (card badge unchanged) | yes |
  | `EXPIRED` | `status=VERIFIED` AND `expires_on ≤ today`, **or** `status=EXPIRED` | grey shield "Certification expired" | **no** |
  | `UNVERIFIED` | no cert row, or latest is `PENDING`/`REJECTED`/`REVOKED` | none | **no** |
  Transitions are triggered exclusively by the admin domain (verify/reject/revoke) and by a nightly job flipping `VERIFIED → EXPIRED` at `expires_on`.
- **Rules**:
  1. **Only `CERTIFIED` and `EXPIRING_SOON` restaurants are visible to customers at all.** `EXPIRED` and `UNVERIFIED` restaurants are excluded from feed, search, favourites results, and return `404 NOT_FOUND` on detail. This is one shared SQL predicate (`restaurant_customer_visible`), used by every read path, with a single unit test.
  2. If a restaurant's certification transitions to `EXPIRED`/`REVOKED` **while an order is in flight**, the order proceeds (the food was prepared under valid certification); the customer is sent an informational notification and the restaurant becomes unorderable for new carts.
  3. If a cart contains items from a restaurant that becomes non-visible, the cart is **blocked at checkout** with `409 RESTAURANT_UNAVAILABLE` and an explicit halal-specific message; the cart is not silently emptied.
  4. The badge is **never** rendered from a client-side constant, a default, or an optimistic value. If `halal_display_state` is absent from the payload the card renders **no badge** and logs a client error. There is no "assume certified".
  5. Certificate documents are **never** served from a public URL and never cached to disk by the app. Presigned GET TTL 300 s, single use recorded in `certificate_view_audit(id, user_id, certification_id, viewed_at, ip)`.
  6. The certification panel must render the certifying body as free text exactly as verified by the admin. The app does not rank, score, or editorialise certifying bodies.
  7. Copy is fixed and reviewed: the badge says **"Halal certified"** (not "Halal", not "100% Halal", not "Verified halal"), and the panel carries the standing line: *"Certification verified by Halal Goes on {verified_at}. Halal Goes does not itself certify food."*
  8. `GET /restaurants/:id/certification` is a separate endpoint from restaurant detail so the panel can refresh without refetching the menu; it is cached 60 s.
- **Acceptance criteria**:
  1. Given a restaurant whose latest certification is `VERIFIED` with `expires_on` yesterday, when the nightly job runs and any customer requests the feed, search, or that restaurant's detail page, then the restaurant is absent from feed and search and detail returns `404 NOT_FOUND`.
  2. Given a `CERTIFIED` restaurant, when any customer-facing surface renders a card for it, then a badge element with accessible label "Halal certified" is present — asserted by a snapshot test across all six card surfaces.
  3. Given a customer taps "View certificate", when the request is made, then the response is a presigned URL whose expiry is ≤ 300 s from now, an audit row is written, and re-using the URL after 300 s returns HTTP 403 from MinIO.
  4. Given a restaurant with `expires_on` in 14 days, when the detail page renders, then the card badge is the standard green "Halal certified" and the panel additionally shows "Certificate renews {date}".
  5. Given an API response missing `halal_display_state`, when a card renders, then no badge is drawn and a client error is reported (asserted by a component test with the field deleted).
- **Out of scope**: customer-submitted certification challenges (that is C-39 `HALAL_CONCERN`); certifying-body directory browsing; per-dish halal status (certification is restaurant-level only); ingredient-level halal analysis; showing certification for riders or for the platform itself; automatic certificate OCR/validation.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — restaurants with lapsed certification**: When a certificate expires, should the restaurant be hidden entirely or shown as "certification expired" and blocked from ordering? · **Proposed default**: **hidden entirely** from all customer surfaces. · **Why**: showing a grey "expired" shield teaches customers that non-certified restaurants exist on the platform, which is precisely the confusion the product removes.

> **DECISION REQUIRED — recognised certifying bodies**: Does Halal Goes maintain a whitelist of recognised Canadian certifying bodies, or accept any body an admin approves? · **Proposed default**: no whitelist; `certifying_bodies` is a free reference list, admin judgement is the gate, and the body's name is always displayed to the customer so they can apply their own standard. · **Why**: maintaining an authoritative whitelist is a religious-authority function the vendor cannot assume, and the SOW places legal/compliance measures out of scope.

> **DECISION REQUIRED — certificate document visibility**: Are halal certificates public to any signed-in customer, or gated? · **Proposed default**: viewable by any authenticated customer, presigned 300 s, audited. · **Why**: the SOW says customers "view and verify"; verification is meaningless without the document, and certificates are not confidential business records.

---

### C-13 — Restaurant detail page
- **SOW trace**: *"Restaurant Details: View detailed information about restaurants, including menus, ratings, reviews, and delivery options."*
- **Behaviour**: One screen composed of: hero image (the restaurant's **own** `restaurants.hero_object_key`, never a bundled asset), name, cuisine chips, `rating_avg` + review count (tappable → C-18), **halal certification panel (C-12)**, availability strip (C-14: open/closed, today's hours, ETA range, delivery fee, minimum order), address + distance, "delivery options" = the delivery fee/ETA/minimum-order triple for **the customer's selected address**, then the menu: category tabs derived from `food_categories`, item rows with image, name, truncated description (2 lines), price, veg/non-veg marker, allergen chips, and an add control. An in-menu search overlay filters the loaded menu client-side.
- **Data**: `restaurants.*`, `restaurant_addresses`, `restaurant_menus.is_active`, `food_items.*`, `food_categories`, `cuisines`, `restaurant_offers`. Two endpoints: `GET /restaurants/:id` and `GET /restaurants/:id/menu`.
- **States**: none beyond C-14 availability and C-12 certification.
- **Rules**:
  1. Menu returns **only** items where `is_currently_available=true AND is_deleted=false` from the single menu where `restaurant_menus.is_active=true`. Unavailable items are omitted, not greyed out, at V1.
  2. Category tabs are derived from the distinct `food_categories` present in the returned items, ordered by `food_categories.sort_order`, with an implicit "All" first tab.
  3. Tapping an in-menu search result **scrolls to and highlights that item row** and, if the item is available and the restaurant is orderable, exposes its add control. It does not open an alert. (Today it fires `Alert.alert('Item Selected')`.)
  4. The hero image is `restaurants.hero_object_key` resolved through the media CDN path; if null, a neutral cuisine-derived placeholder. A test asserts no bundled restaurant photograph exists in the app bundle.
  5. Menu payload is cached client-side for 5 min and invalidated on cart mutation failure with `ITEM_UNAVAILABLE`.
  6. A floating cart bar appears when the cart is non-empty, showing **sum of quantities** (not distinct line count) and the cart subtotal.
- **Acceptance criteria**:
  1. Given a restaurant with a `hero_object_key`, when the detail page renders, then the displayed image URL contains that key and matches no path under the app's static assets directory.
  2. Given a menu with items in 3 categories, when the page renders, then tabs are `All` + those 3 in `sort_order`, and selecting a tab shows only that category's items.
  3. Given the in-menu search for an item further down the list, when a result is tapped, then the list scrolls to that row and the row is visually highlighted for 1.5 s.
  4. Given a cart holding 2× item A and 3× item B, when the floating bar renders, then it displays `5`.
- **Out of scope**: restaurant photo galleries; "about the restaurant" long copy; social links; table booking; pickup; restaurant-level chat entry point (see C-35); menu availability schedules (breakfast/lunch menus) — the platform supports exactly one active menu per restaurant.
- **Version**: V1 · **Size**: M

---

### C-14 — Restaurant availability & serviceability gating
- **SOW trace**: *"Restaurant Details: … including … delivery options."* Derived necessity: the schema already carries `opening_time`, `closing_time`, `is_accepting_orders`, and nothing reads them, so customers can order from closed restaurants and are auto-rejected.
- **Behaviour**: A single server-computed availability object returned on every restaurant card and detail response: `{state, opens_at, closes_at, eta_min_minutes, eta_max_minutes, delivery_fee_cents, minimum_order_cents, distance_km, out_of_range_reason}`. The client renders from this object only and never recomputes hours locally.
- **Data**: `restaurants.opening_time`, `restaurants.closing_time`, `restaurants.timezone`, `restaurants.is_accepting_orders`, `restaurants.avg_prep_minutes`, `restaurant_addresses.coords`, `platform_config.max_delivery_radius_km`, `platform_config.minimum_order_cents`, delivery-fee parameters (C-22).
- **States**: `availability.state ∈ {OPEN, CLOSED_HOURS, PAUSED, OUT_OF_RANGE, NO_ADDRESS}`.
  - `OPEN` — inside hours (restaurant tz) **and** `is_accepting_orders=true` **and** within radius of the selected address.
  - `CLOSED_HOURS` — outside `opening_time..closing_time` for the current local day.
  - `PAUSED` — inside hours but `is_accepting_orders=false` (restaurant-triggered).
  - `OUT_OF_RANGE` — distance from the selected delivery address > `max_delivery_radius_km`.
  - `NO_ADDRESS` — the customer has no selected/default address, so serviceability cannot be computed.
- **Rules**:
  1. Hours crossing midnight (e.g. 17:00→02:00) are supported and evaluated against the restaurant's local time. A restaurant with `opening_time == closing_time` is treated as 24 h.
  2. ETA range = `restaurants.avg_prep_minutes` (default 25) `+ travel_minutes ± 20%`, where `travel_minutes = ceil(distance_km / platform_config.avg_speed_kmh * 60)` with `avg_speed_kmh` default **22**. The result is rounded outward to the nearest 5 minutes and always presented as a range (e.g. "30–40 min"). **No hardcoded ETA string may exist in the app** — enforced by a lint rule banning the literals `45 min` and `25-35 min`.
  3. Add-to-cart is blocked for any state other than `OPEN`: the control is disabled and the reason is shown inline. Checkout re-validates and returns `409 RESTAURANT_UNAVAILABLE` with `details.state`.
  4. `CLOSED_HOURS` cards show "Opens {time}" using `opens_at`; the restaurant remains browsable and its menu readable.
  5. Minimum order is compared against `item_total` **before** fees and discounts. Below minimum, checkout returns `409 BELOW_MINIMUM_ORDER` with `details.shortfall_cents`, and the cart screen shows "Add ${x} more to order".
  6. `NO_ADDRESS` never blocks browsing; it blocks add-to-cart with a prompt to add an address.
- **Acceptance criteria**:
  1. Given a restaurant with hours 17:00–02:00 America/Toronto and a request at 01:30 local, then `state='OPEN'`.
  2. Given `is_accepting_orders=false` during opening hours, when the detail page renders, then the state is `PAUSED`, add controls are disabled, and the menu is still readable.
  3. Given a cart subtotal of $9.00 and a minimum of $15.00, when checkout is attempted, then `409 BELOW_MINIMUM_ORDER` with `details.shortfall_cents=600`.
  4. Given a restaurant 14 km from the selected address with a 12 km radius, then `state='OUT_OF_RANGE'` and the card renders "Too far to deliver".
- **Out of scope**: per-day opening hours (one open/close pair applies to every day of the week — a schema limitation carried forward deliberately); holiday closures; temporary "busy" prep-time inflation; surge/peak pricing; scheduled ordering for a future open window (see C-41 out-of-scope note).
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — per-day opening hours**: The schema stores a single `opening_time`/`closing_time` pair, not a weekly schedule. Do we extend it? · **Proposed default**: keep the single pair at V1 and add `restaurant_hours(restaurant_id, weekday, opens_at, closes_at)` at V2. · **Why**: real restaurants have different weekend hours, but a weekly schedule touches the restaurant portal and admin approval flows, which are outside this document.

---

### C-15 — Food item detail
- **SOW trace**: *"Food Details: View detailed descriptions, images, ingredients, and nutritional information for each dish."*
- **Behaviour**: Tapping a menu row opens a bottom sheet showing: image carousel (`food_items.item_images[]`, max 5), name, full description, price (and struck-through original if an offer applies), veg/non-veg marker, **ingredients list**, **allergen chips**, dairy flag, an optional nutrition block, the variant picker and add-on picker (C-16), a quantity stepper, a per-item "special request" free-text field, and the add-to-cart action showing the computed line total.
- **Data**: `food_items.item_name`, `item_description`, `item_images[]`, `ingredients[]`, `allergens[]`, `is_non_veg`, `contains_dairy` (**renamed from the persisted typo `contains_diary` by migration — the typo is not carried forward**), `item_price`, `rating_avg`, `food_item_variants[]`, `addon_items[]`, `food_item_offers[]`. New optional nutrition columns on `food_items`: `calories_kcal int NULL`, `serving_description varchar(80) NULL`.
- **States**: none.
- **Rules — "nutritional information" resolved**:
  1. The current data model has **no nutrition fields at all**. At V1 "nutritional information" means exactly: `ingredients[]`, `allergens[]`, `is_non_veg`, `contains_dairy`, plus **optional** `calories_kcal` + `serving_description`.
  2. All nutrition fields are **entered by the restaurant** in the restaurant portal and are **optional**. The platform does not compute, validate, or verify them.
  3. When `calories_kcal` is null the nutrition block is **omitted entirely** — no "N/A", no zero. When present it renders as "{n} kcal · {serving_description}" with the fixed disclaimer *"Nutrition information is provided by the restaurant and has not been verified by Halal Goes."*
  4. `ingredients[]` and `allergens[]` render as chips; an empty `allergens[]` renders the line "Allergen information not provided by this restaurant" — **never** "No allergens", which would be an unsafe claim.
  5. Per-item special request: 0–140 chars, plain text, stored on the cart line and copied to the order line; it is advisory and does not change price.
  6. Item images are served through presigned/CDN URLs; missing images render a neutral placeholder — no `via.placeholder.com`, `picsum.photos`, `pexels`, or `unsplash` URL may appear in the shipped bundle (asserted by a bundle grep test).
- **Acceptance criteria**:
  1. Given an item with `allergens = []`, when the sheet renders, then the text "Allergen information not provided by this restaurant" is present and the string "No allergens" is absent.
  2. Given an item with `calories_kcal = NULL`, when the sheet renders, then no nutrition block, no "N/A" and no "0 kcal" is rendered.
  3. Given an item with a 141-character special request, when add-to-cart is pressed, then the request is blocked client-side and the server returns `400 VALIDATION_FAILED` if forced.
  4. Given the shipped JS bundle, when scanned, then it contains zero occurrences of `via.placeholder.com`, `picsum.photos`, `contains_diary`.
- **Out of scope**: full macro tables (protein/fat/carbs/sodium); per-100 g normalisation; allergen cross-contamination statements; dietary certifications other than halal (vegan/kosher/gluten-free badges); nutrition sourced from a third-party database; item-level review submission from this sheet (see C-38).
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — nutrition data ownership**: Who supplies calories, and is it mandatory for restaurants? · **Proposed default**: optional, restaurant-entered, unverified, displayed with a disclaimer. · **Why**: Canadian menu-labelling law applies to chains of ≥20 locations in Ontario; mandating it platform-wide would block independent restaurant onboarding, which the SOW's assumptions depend on.

---

### C-16 — Variant and add-on selection
- **SOW trace**: implied by *"Cart Management: Add food items to the cart"* plus the existing schema (`food_item_variants`, `addon_items`, `cart_food_items.selected_variant_id`, `selected_addon_ids`).
- **Behaviour**: Inside the item sheet (C-15), variants render as **single-select** radio groups, one group per `variant_type` present on the item (`SIZE`, `WEIGHT`, `QUANTITY`, `STYLE`, `SPICE_LEVEL`). Add-ons render as a **multi-select** checkbox list. The line price updates live. Add-to-cart is disabled until every required variant group has a selection.
- **Data**: `food_item_variants(id, food_item_id, variant_type, name, variant_price, is_default_variant, is_currently_available)`, `addon_items(id, name, price, is_available)` + `food_item_addons` junction, `cart_food_items.selected_variant_id`, `cart_food_items.selected_addon_ids uuid[]`, and new `order_food_items.selected_variant_id`, `order_food_items.selected_addon_ids uuid[]`, `order_food_items.special_request`.
- **States**: none.
- **Rules**:
  1. **Variant price replaces the base price; add-on prices are added.** Line total = `(variant_price ?? item_price) + Σ(addon.price) ) × quantity`. This single formula is used by cart, pricing, and order creation. (Today the cart *adds* variant price to base while order creation *replaces* it — the two disagree, so cart, pricing and order totals can all differ.)
  2. If an item has variants, one group per `variant_type` is **required**; the `is_default_variant=true` option is pre-selected. If no default exists, nothing is pre-selected and add-to-cart is disabled. Silent auto-selection of `item_variants[0]` is prohibited.
  3. Unavailable variants/add-ons (`is_currently_available=false`) render disabled with "Unavailable", and are rejected server-side with `409 VARIANT_UNAVAILABLE` / `409 ADDON_UNAVAILABLE`.
  4. `selected_addon_ids` is validated server-side against the item's linked add-ons; unknown ids ⇒ `400 INVALID_ADDON`. (Today it is an unconstrained uuid[] with no FK and the client always sends `[]`.)
  5. Cart line identity = `(cart_id, food_item_id, selected_variant_id, sorted(selected_addon_ids), special_request)`. Two adds with identical identity increment quantity; any difference creates a distinct line.
  6. `order_food_items` **must** persist the variant and add-on selection. (Today the order table drops them, so the restaurant receives the wrong ticket.)
  7. Max **10 add-ons** per line; quantity per line 1–20 (the current cap of 99 is reduced).
- **Acceptance criteria**:
  1. Given an item with a `SIZE` group and no `is_default_variant`, when the sheet opens, then no size is selected and the add button is disabled with the hint "Choose a size".
  2. Given base price $10, `Large` variant $14, and two add-ons at $1.50 each, quantity 2, then the displayed line total is $34.00 and the server-computed cart line total is 3400 cents.
  3. Given the same item added twice with different spice levels, when the cart renders, then there are two distinct lines.
  4. Given an order placed with variant `Large` and add-on `Extra cheese`, when the restaurant fetches the order, then `order_food_items` carries `selected_variant_id` and `selected_addon_ids` matching the cart.
- **Out of scope**: nested/conditional add-on groups; add-on quantity > 1 per add-on; min/max selection rules per group beyond required-single-select; combo/meal builders; per-variant images.
- **Version**: V1 · **Size**: M

---

### C-17 — Favourite restaurants
- **SOW trace**: not explicit in SOW 9–17; the existing feed exposes a `your_favourite_restaurants` section with no way to populate it. Included as the completion of a shipped-but-unreachable capability.
- **Behaviour**: A heart control on restaurant cards and the detail header toggles a favourite. A Favourites screen lists them, applying the same visibility predicate as C-09.
- **Data**: `user_favorite_restaurant(id, user_id, restaurant_id, created_at)` (exists), unique `(user_id, restaurant_id)`.
- **States**: binary present/absent.
- **Rules**:
  1. Toggle is optimistic client-side with rollback on error; the endpoint is idempotent (`PUT` to add, `DELETE` to remove, both return `204` regardless of prior state).
  2. Max **200** favourites per customer; exceeding returns `409 FAVOURITES_LIMIT`.
  3. A favourited restaurant that becomes non-visible (C-12/banned) is **retained in the table** but hidden from the Favourites list and the feed section, with a one-line footer "1 restaurant is currently unavailable".
  4. The `your_favourite_restaurants` feed section is populated from this table only — it is not a computed "most ordered" section (that is `order_again`).
- **Acceptance criteria**:
  1. Given a restaurant is favourited, when the home feed reloads, then it appears in `your_favourite_restaurants`.
  2. Given a favourited restaurant is later banned, when the Favourites screen loads, then it is not listed, the row still exists in the database, and the footer count is 1.
  3. Given the favourite endpoint is called twice with `PUT`, then both return `204` and exactly one row exists.
- **Out of scope**: favourite dishes (`user_favorite_food` exists but gets no UI); favourite-based push notifications; sharing favourites; folders/lists.
- **Version**: V3 · **Size**: S

---

### C-18 — Reviews and ratings display (read side)
- **SOW trace**: *"Restaurant Details: View detailed information about restaurants, including menus, ratings, reviews…"*
- **Behaviour**: The restaurant detail header shows `rating_avg` to 1 dp and a review count; tapping opens a Reviews screen with a rating-distribution bar chart (5→1), a filter chip row (`All`, `5★`, `4★`, `3★`, `2★`, `1★`, `With photos`), and a cursor-paginated list. Each review shows: reviewer first name + last initial, star rating, date, body, up to 3 photos, and the restaurant's reply if any. Item detail shows the dish's own `rating_avg` and count with the same list scoped to that dish.
- **Data**: new `restaurant_rating_reviews(id, order_id, user_id, restaurant_id, rating numeric(2,1), body citext NULL, images text[], status, created_at, restaurant_reply text NULL, replied_at NULL)` — **this table does not exist today**; only `food_item_rating_review` and `rider_rating_review` do. Plus `restaurants.rating_avg`, `restaurants.rating_count`, `food_items.rating_avg`, `food_items.rating_count` (count columns are new).
- **States**: `status ∈ {PUBLISHED, PENDING_MODERATION, REMOVED}`. Customers see only `PUBLISHED`; the author additionally sees their own `PENDING_MODERATION` marked "Under review".
- **Rules**:
  1. `rating_avg` is a maintained aggregate recomputed inside the same transaction as any review insert/update/removal; it is never computed on read. Displayed to 1 dp, rounded half-up.
  2. Restaurants with `rating_count < 5` display **"New"** instead of a numeric average anywhere a rating would appear.
  3. Rider ratings are **never shown to customers** on any surface (they are an internal quality metric). The current customer app fetches the rider's whole record including earnings and rating; the replacement `GET /orders/:orderId/rider` returns exactly `{first_name, last_initial, photo_url, vehicle_type, masked_phone_token}` and nothing else.
  4. Review body is displayed truncated at 300 chars with "Read more"; photos open a full-screen viewer.
  5. Sort order: most recent first. No "most helpful" ranking, no voting.
  6. Reviews from deleted accounts display author as "Deleted user".
- **Acceptance criteria**:
  1. Given a restaurant with 4 reviews, when its card renders anywhere, then "New" is shown and no numeric rating appears.
  2. Given a review is set to `REMOVED` by moderation, when any customer loads the list, then it is absent and `rating_avg`/`rating_count` reflect its removal.
  3. Given `GET /orders/:orderId/rider`, when the response is inspected, then it contains no `total_earnings`, `rating_avg`, `phone`, or `email` field.
  4. Given the `4★` filter, when applied, then every listed review has `rating >= 4.0 AND rating < 5.0`.
- **Out of scope**: helpful votes; review sorting options; replying to reviews from the customer app; reporting a review (that is C-39); reviewer profiles; verified-purchase badges (all reviews are order-bound by construction, per C-38).
- **Version**: V2 · **Size**: M

---

## 3. Cart, coupons and order placement (SOW 11)

### C-19 — Cart management
- **SOW trace**: *"Cart Management: Add food items to the cart, with the ability to edit quantities or remove items."*
- **Behaviour**: The server holds the single source of truth for the cart. The client issues **granular, intent-based** operations — `POST /cart/lines`, `PATCH /cart/lines/:lineId {quantity}`, `DELETE /cart/lines/:lineId`, `DELETE /cart` — each returning the full recomputed cart including its price breakdown. The client renders the returned cart; it does not compute totals.
- **Data**: `carts(id, user_id UNIQUE, restaurant_id, delivery_address_id, subtotal_cents, updated_at)`, `cart_lines(id, cart_id, food_item_id, selected_variant_id, selected_addon_ids uuid[], quantity, special_request, unit_price_cents, line_total_cents)`, `cart_coupons`.
- **States**: cart is either absent (no row) or present; there is no cart status enum. A cart is deleted on successful order creation and on `DELETE /cart`.
- **Rules**:
  1. Exactly **one cart per customer** (`carts.user_id` unique) — matching today's de-facto behaviour, now enforced by constraint.
  2. Operations are **granular**, not full-replacement PUTs. (Today every quantity change PUTs the entire desired cart, and removal is implemented as `quantity = -999`.) Removal is `DELETE`; `quantity` must be `1..20`; `quantity=0` is rejected with `400 VALIDATION_FAILED`.
  3. `carts.delivery_address_id` is set from the **customer's currently selected address** (C-30) and updated whenever the selection changes — never from `addresses[0]`. If no address is selected, cart operations still succeed but `delivery_fee_cents` is `null` and checkout is blocked.
  4. Every mutation re-validates: item exists, `is_currently_available`, belongs to the cart's restaurant, variant/add-on valid and available, restaurant still visible and `OPEN`. Failure returns a typed error and the **unchanged** cart, so the client can reconcile.
  5. Prices are snapshotted onto `cart_lines.unit_price_cents` at add time, and **re-validated at checkout**: if any unit price changed, checkout returns `409 PRICE_CHANGED` with the diff, and the client shows a "Prices updated" confirmation before retrying.
  6. Carts idle for **7 days** are deleted by a nightly job.
  7. The tab-bar badge shows `Σ quantity`, not the line count.
  8. Cart survives logout only in the sense that it is server-side: after logout the local copy is cleared and re-fetched on next login.
- **Acceptance criteria**:
  1. Given a cart with lines A(2) and B(3), when the badge renders, then it shows `5`.
  2. Given `PATCH /cart/lines/:id {quantity: 0}`, then `400 VALIDATION_FAILED` and the cart is unchanged.
  3. Given an item whose price changed from $10 to $12 after it was added, when checkout is initiated, then `409 PRICE_CHANGED` with `details.lines[].old_cents=1000,new_cents=1200`, and no order and no payment is created.
  4. Given the customer switches the selected address, when the cart is next read, then `carts.delivery_address_id` matches the new selection and `delivery_fee_cents` is recomputed.
- **Out of scope**: multiple named carts; saving a cart for later; sharing a cart; cart merge across devices with conflict resolution (last write wins); guest carts (auth is required).
- **Version**: V1 · **Size**: M

---

### C-20 — Single-restaurant cart constraint
- **SOW trace**: *"Note: Only one restaurant per order is allowed."*
- **Behaviour — the ambiguity resolved**: When the customer adds an item from restaurant B while the cart holds items from restaurant A, the server rejects the add and the client shows a **blocking modal** with exactly two actions: **"Start a new cart"** (destructive — clears the cart and adds the new item) and **"Keep my {A} cart"** (cancels the add). There is no silent merge, no multi-cart, no "save A for later".
- **Data**: `carts.restaurant_id`; error code `409 DIFFERENT_RESTAURANT` with `details = {current_restaurant_id, current_restaurant_name, current_line_count}`.
- **States**: none.
- **Rules**:
  1. The constraint is enforced **server-side** as the authority. The client modal is a UX affordance, not the enforcement. (Today the only such logic lives in a dead React Context that nothing mounts, so a second restaurant's items silently join the cart.)
  2. "Start a new cart" is a **single atomic call** `POST /cart/lines?replace=true` — clear + add in one transaction. A two-call clear-then-add is prohibited (it can leave an empty cart on failure).
  3. The modal names the current restaurant explicitly ("Your cart has 3 items from Al-Noor Grill").
  4. Checkout re-asserts that every line belongs to `carts.restaurant_id`; a violation is a `500` class invariant failure, alarmed, never surfaced as a customer error.
  5. Order creation copies `carts.restaurant_id` to `orders.restaurant_id`; there is no path to a multi-restaurant order at any version.
- **Acceptance criteria**:
  1. Given a cart with 3 items from restaurant A, when an item from restaurant B is added, then the API returns `409 DIFFERENT_RESTAURANT` with `details.current_line_count=3` and the cart is unchanged.
  2. Given the same situation, when "Start a new cart" is chosen, then exactly one API call is made, the resulting cart contains exactly 1 line, and `carts.restaurant_id` is B.
  3. Given "Keep my cart" is chosen, then no API call is made and the cart is unchanged.
  4. Given a database with any cart whose lines span two restaurants, when the invariant check runs, then it fails (asserted by a data-integrity test).
- **Out of scope**: multi-restaurant orders; parallel carts per restaurant; "order from both" split into two orders; carrying the old cart into a saved list.
- **Version**: V1 · **Size**: S

---

### C-21 — Coupons, promo codes and discounts
- **SOW trace**: *"Coupons and Discounts: Add or apply coupons, promo codes, or discounts to orders."*
- **Behaviour**: A single coupon input on the cart and checkout screens. Entering a code calls `POST /cart/coupons {code}` which validates and, on success, returns the recomputed cart with `discount_cents` and the applied coupon. An "Offers" list shows coupons the customer is currently eligible for (public, non-expired, meeting the cart's conditions), each with one-tap apply.
- **Data**: `coupon_codes(id, name UNIQUE, description, discount_percent numeric(5,2), discount_max_cents int NULL, min_order_cents int NULL, expiry, usage_limit_total int NULL, usage_limit_per_user int NULL, restaurant_id uuid NULL, is_public bool, is_deleted, created_by)` — the columns after `expiry` are **new**. `cart_coupons(cart_id, coupon_code_id)`, `coupon_redemptions(id, coupon_code_id, user_id, order_id, discount_cents, redeemed_at)`, `orders.coupon_codes text[]`, `orders.discount_cents`.
- **States**: a coupon on a cart is `APPLIED`; on order creation it becomes a `coupon_redemptions` row. On order cancellation before `PREPARING` the redemption is deleted (the coupon is returned to the customer); after `PREPARING` it is consumed.
- **Rules**:
  1. **Exactly one coupon per cart/order.** Applying a second replaces the first (with an explicit confirmation). No stacking. `orders.coupon_codes` is retained as an array for schema compatibility but will hold at most one element.
  2. Discount computation: `discount_cents = min( floor(item_total_cents × discount_percent / 100), discount_max_cents ?? ∞ )`. The discount applies to **item subtotal only** — never to delivery fee, platform fee, tax, or tip.
    **The current backend inverts this**: `applyCouponDiscount` returns the discount amount and the caller treats it as the post-discount total, so a 10% coupon on $50 charges $5. This inversion is an explicit regression test.
  3. Validation order (first failure wins, each with a distinct code): `COUPON_NOT_FOUND` → `COUPON_EXPIRED` → `COUPON_NOT_APPLICABLE_RESTAURANT` → `COUPON_BELOW_MIN_ORDER` (with `details.shortfall_cents`) → `COUPON_USAGE_LIMIT_REACHED` → `COUPON_ALREADY_USED_BY_USER`.
  4. Codes are case-insensitive, trimmed, and compared against `upper(name)`. Max 32 chars.
  5. Rate limit: **10 failed coupon attempts per user per hour**, then `429 COUPON_ATTEMPTS_EXCEEDED` — codes are guessable otherwise.
  6. `usage_limit_total` is enforced with `SELECT … FOR UPDATE` on the coupon row inside the order-creation transaction; the cart-time check is advisory. A coupon exhausted between apply and checkout returns `409 COUPON_USAGE_LIMIT_REACHED` and the order is **not** created.
  7. The discount is displayed as a negative line in the breakdown with the coupon name; the customer never sees a total that omits it.
  8. Every promo surfaced in the app must be a live `coupon_codes` row. **No hardcoded promo list may exist in the client** (today's screen ships SAVE20/FIRST15/DELIVERY5/WEEKEND10/STUDENT25/LOYAL30, all expired in 2024) — enforced by a bundle grep test.
- **Acceptance criteria**:
  1. Given a 10% coupon and an item subtotal of $50.00, when applied, then `discount_cents = 500` and `amount_to_pay` equals subtotal − 500 + fees + tax.
  2. Given a coupon with `usage_limit_total=1` already redeemed, when a second customer checks out with it, then `409 COUPON_USAGE_LIMIT_REACHED`, no order row, and no payment authorisation.
  3. Given 10 invalid codes entered in an hour, when an 11th is entered, then `429 COUPON_ATTEMPTS_EXCEEDED`.
  4. Given a cart with a coupon applied and a second code entered, when confirmed, then exactly one coupon is on the cart and the total reflects only the new one.
  5. Given the shipped bundle, when scanned, then the strings `SAVE20`, `FIRST15`, `DELIVERY5` are absent.
- **Out of scope**: stacking multiple coupons; referral codes; loyalty points; free-item coupons; delivery-fee-waiver coupons (use `free_delivery` restaurant offers instead); auto-applied best-coupon selection; personalised coupon targeting; coupon creation from the customer app.
- **Version**: V2 · **Size**: M

> **DECISION REQUIRED — who funds discounts**: Is a coupon's cost borne by the platform or the restaurant, and does it affect restaurant settlement? · **Proposed default**: platform-funded at V1/V2; the restaurant is settled on the full pre-discount item subtotal, and `coupon_redemptions.discount_cents` is a platform expense line. · **Why**: restaurant-funded discounts require a settlement negotiation and a restaurant-portal opt-in, neither of which is specified.

---

### C-22 — Price breakdown (pricing authority)
- **SOW trace**: *"Order Placement: Place orders with selected items, delivery address, and payment method."* — the price the customer agrees to is the core of that.
- **Behaviour**: One server-computed pricing object is attached to every cart response and re-derived at checkout. The client renders it verbatim. The breakdown lines, in fixed order: **Item subtotal**, **Discount** (negative, only if non-zero), **Delivery fee**, **Platform fee**, **Tax**, **Tip** (only if non-zero), **Total to pay**.
- **Data**: computed object `{item_total_cents, discount_cents, delivery_fee_cents, platform_fee_cents, tax_cents, tip_cents, amount_to_pay_cents, currency:"CAD", pricing_version, computed_at, signature}`. Persisted on the order as `orders.item_total_cents`, `orders.discount_cents`, `orders.delivery_fee_cents`, `orders.platform_fee_cents`, `orders.tax_cents`, `orders.tip_cents`, `orders.total_cents`.
- **States**: none; a pricing snapshot is valid for **10 minutes** from `computed_at`.
- **Rules**:
  1. **The client never computes, defaults, or displays a hardcoded fee.** A lint rule bans numeric fee literals in the app; a test asserts the cart screen and the checkout screen render from the same object (today cart shows platform fee 3, checkout shows 2, and the server's real number is sent silently — the amount agreed is not the amount submitted).
  2. Delivery fee = `base_fee_cents + ceil(distance_km) × per_km_cents`, clamped to `[min_fee_cents, max_fee_cents]`, all from `platform_config` (defaults: base 299, per-km 150, min 299, max 1200). Distance is **road-agnostic great-circle via PostGIS `ST_Distance` on `geography`** between the restaurant address and **the order's delivery address** — not the customer's primary address (the current activity uses the wrong address and a degrees×111 conversion).
  3. Platform fee = `platform_config.platform_fee_cents` (default 499), a flat amount.
  4. Tax: see the decision below. Implementation applies `tax_cents = round(taxable_base × rate)` where `taxable_base = item_total − discount + delivery_fee + platform_fee` and `rate` comes from `tax_rates(province_code, rate, effective_from)` keyed on the delivery address province.
  5. The snapshot is **signed** (HMAC over the field set with a server key) and echoed by the client at checkout. The server **recomputes** and compares; a mismatch or an expired snapshot returns `409 PRICING_STALE` and the client re-fetches and re-confirms. (Today the server does not recompute at all — it trusts the client's echoed snapshot.)
  6. Every arithmetic operation is on `int64` cents. Any use of floating point in this path fails a static check.
  7. `amount_to_pay_cents` is the **only** number ever passed to the payment provider.
- **Acceptance criteria**:
  1. Given a cart, when the cart screen and the checkout screen both render, then every displayed line is byte-identical between the two screens (asserted by a UI test comparing rendered strings).
  2. Given a pricing snapshot 11 minutes old, when checkout is submitted, then `409 PRICING_STALE` and no payment is attempted.
  3. Given a tampered snapshot (client sends `amount_to_pay_cents` reduced by 1000), when checkout is submitted, then `409 PRICING_STALE` (signature mismatch) and the incident is logged with the user id.
  4. Given a restaurant 4.2 km away with defaults, then `delivery_fee_cents = 299 + 5×150 = 1049`.
- **Out of scope**: surge/dynamic pricing; small-order surcharge; distance-tiered platform fees; service fee split by restaurant; currency conversion; tax-exempt handling; price display excluding tax.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — sales tax**: Which taxes apply to prepared food delivery in the launch province(s), who is the registrant, and is tax charged on fees as well as food? · **Proposed default**: Ontario-only launch; 13% HST applied to the full taxable base (food + delivery fee + platform fee); the client is the registrant; rates held in a `tax_rates` table so other provinces can be added without a release. · **Why**: the SOW puts legal compliance on the client, but a Canadian food-delivery app that charges no tax cannot go live; a table-driven rate is the smallest correct implementation.

> **DECISION REQUIRED — launch province(s)**: Which Canadian province(s) are in scope for launch? · **Proposed default**: Ontario (GTA) only; addresses outside Ontario are rejected at address creation. · **Why**: tax rate, support hours, and delivery radius all key off this, and a single province removes an entire class of ambiguity.

---

### C-23 — Order placement (checkout)
- **SOW trace**: *"Order Placement: Place orders with selected items, delivery address, and payment method."*
- **Behaviour**: The checkout screen shows: delivery address (the **selected** one, editable), the C-22 breakdown, delivery instructions (C-33), tip (C-36, V2), coupon (C-21, V2), and payment method (C-24). Pressing **Place order** calls `POST /orders` with `{cart_id, delivery_address_id, payment_method_id, pricing_signature, delivery_instructions, special_instructions, tip_cents, idempotency_key}`. The client then shows a **pending** state and waits for the server's terminal answer — it does **not** navigate to a success screen optimistically.
- **Data**: `orders.*`, `order_food_items.*`, `payment_intents`, `carts` (deleted on success), `coupon_redemptions`.
- **States**: `orders.status`, the customer-visible machine (the legacy `PLACED` and `DISPUTED` values are removed; `PENDING_PAYMENT` is internal-only):

  | From | To | Trigger |
  |---|---|---|
  | *(none)* | `PENDING_PAYMENT` | order row created inside the checkout transaction |
  | `PENDING_PAYMENT` | `AWAITING_RESTAURANT` | payment authorised (C-25) |
  | `PENDING_PAYMENT` | `PAYMENT_FAILED` | authorisation declined or timed out |
  | `AWAITING_RESTAURANT` | `CONFIRMED` | restaurant accepts |
  | `AWAITING_RESTAURANT` | `REJECTED` | restaurant rejects, or acceptance window expires |
  | `CONFIRMED` | `PREPARING` | restaurant marks preparing |
  | `PREPARING` | `READY_FOR_PICKUP` | restaurant marks ready |
  | `CONFIRMED`\|`PREPARING`\|`READY_FOR_PICKUP` | `RIDER_ASSIGNED` | dispatch assigns a rider (may occur in parallel with prep) |
  | `RIDER_ASSIGNED` | `PICKED_UP` | rider confirms collection |
  | `PICKED_UP` | `ON_THE_WAY` | rider departs |
  | `ON_THE_WAY` | `DELIVERED` | rider marks delivered |
  | `AWAITING_RESTAURANT`\|`CONFIRMED` | `CANCELLED` | customer cancels (C-29) or admin cancels |
  | `PREPARING`…`ON_THE_WAY` | `CANCELLED` | admin/support only |
  | `AWAITING_RESTAURANT`…`ON_THE_WAY` | `NO_RIDER_FOUND` → `CANCELLED` | dispatch exhausts the search |

  Terminal: `DELIVERED`, `CANCELLED`, `REJECTED`, `PAYMENT_FAILED`. Every transition is validated against this table **in the database write path**, not only inside a workflow's in-memory copy, and every transition writes an `order_status_events(id, order_id, from_status, to_status, actor_type, actor_id, reason_code, created_at)` row.
- **Rules**:
  1. Order creation is a **single database transaction**: validate cart → re-price → validate coupon with row lock → insert `orders` + `order_food_items` (snapshotting name, unit price, variant, add-ons, special request) → insert `coupon_redemptions` → delete cart. Payment authorisation happens **after** commit, keyed by `orders.id`.
  2. `Idempotency-Key` is required. A replayed key returns the original order.
  3. Pre-flight validations, each with its own code and none of them client-side-only: `PROFILE_INCOMPLETE`, `CART_EMPTY`, `RESTAURANT_UNAVAILABLE` (C-14), `BELOW_MINIMUM_ORDER`, `ADDRESS_OUT_OF_RANGE`, `ITEM_UNAVAILABLE`, `PRICE_CHANGED`, `PRICING_STALE`, `PAYMENT_METHOD_INVALID`.
  4. **Restaurant acceptance window: 5 minutes.** On expiry the order auto-transitions to `REJECTED` with `reason_code='RESTAURANT_TIMEOUT'` and the payment authorisation is voided. (Today there is no restaurant timeout at all; the only bound is a 15-minute workflow timeout that kills the saga without running compensation or refunding.)
  5. **Compensation is unconditional**: if the order fails after authorisation for any reason, the void/refund runs and its result is recorded; a failed compensation raises an operational alert and creates a `refund_requests` row in `UNDER_REVIEW` — it never silently continues. (Today a rejected order continues to rider assignment when compensation returns false.)
  6. The success screen is reached only on a server response of `AWAITING_RESTAURANT` or later. On any error the customer stays on checkout with the specific reason.
  7. `orders.short_code` = 6-character Crockford base-32, unique per day, shown to the customer and used in support.
- **Acceptance criteria**:
  1. Given a valid cart and a working payment method, when Place order is pressed, then exactly one `orders` row exists, the cart row is deleted, and the app shows the pending screen only after the server responds.
  2. Given the payment authorisation fails, when the response returns, then `orders.status='PAYMENT_FAILED'`, no cart was deleted, and the customer remains on checkout with a retry affordance.
  3. Given the same `Idempotency-Key` submitted twice within 24 h, then exactly one order exists and the second response carries `meta.idempotent_replay=true`.
  4. Given a restaurant that does not respond, when 5 minutes elapse, then the order is `REJECTED` with `reason_code='RESTAURANT_TIMEOUT'`, the authorisation is voided, and the customer receives a notification.
  5. Given an attempted transition `DELIVERED → PREPARING`, when written by any path, then the write is rejected by the transition validator (asserted directly against the repository layer, not only the workflow).
- **Out of scope**: scheduled/future orders; group ordering; order splitting; editing an order after placement (see below); pickup orders; guest checkout; multi-address delivery.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — restaurant acceptance window**: How long does a restaurant have to accept before auto-rejection? · **Proposed default**: **5 minutes**, then auto-reject with full void. · **Why**: today there is no timeout, and the internal integration guide claims 2 minutes while the code implements none; 5 minutes balances kitchen reality against customer patience, and must be agreed because it is visible in the UI countdown.

> **DECISION REQUIRED — order modification after placement**: The current in-app FAQ promises customers can add items after ordering. Is that in scope? · **Proposed default**: **No, at any version.** The FAQ copy is corrected and the customer is directed to cancel-and-reorder (C-29) within the cancellation window. · **Why**: order amendment requires re-pricing, re-authorisation, and a restaurant-side ticket amendment — a large feature the SOW never asks for.

---

### C-24 — Payment methods
- **SOW trace**: *"Payment Methods: Add, edit, or remove payment methods (e.g., credit/debit cards)."*
- **Behaviour**: A Payment methods screen listing the customer's saved cards as `{brand, last4, exp_month, exp_year, is_default}`, plus "Add card" and "Cash on delivery" (if enabled). Adding a card opens the **payment provider's own SDK sheet**; the app never sees a PAN. The provider returns a token which the server attaches to the customer's provider profile and mirrors into `user_payment_methods` as non-sensitive metadata only.
- **Data**: replace the current stub `user_payment_method(payment_method enum)` with `payment_methods(id, user_id, provider, provider_payment_method_id, type ENUM(CARD,CASH), brand, last4 char(4), exp_month smallint, exp_year smallint, is_default bool, created_at, deleted_at)`. Plus `users.provider_customer_id`.
- **States**: `payment_methods` row is `ACTIVE` (deleted_at null) or `REMOVED`. `is_default` is unique-per-user via a partial unique index.
- **Rules**:
  1. **No card number, CVV, or expiry is ever typed into a screen we render.** The current `add-card` screen (which formats a raw PAN in app memory and then only fires an `Alert`) is deleted. A CI check fails the build if any input field in the repo is named/labelled for card number or CVV.
  2. `provider_payment_method_id` is the only credential stored. `last4`/`brand`/`expiry` are display metadata returned by the provider.
  3. Maximum **5** saved cards; a 6th returns `409 PAYMENT_METHOD_LIMIT`.
  4. Removing a card is a soft delete; a card referenced by an in-flight order cannot be removed (`409 PAYMENT_METHOD_IN_USE`). Removing the default promotes the most recently used remaining card.
  5. "Edit" is limited to setting the default. Card details are edited by removing and re-adding — there is no editable card form.
  6. Cash on delivery is a `type='CASH'` pseudo-method, shown only when `platform_config.cod_enabled=true` **and** the order total ≤ `platform_config.cod_max_order_cents`.
  7. Every payment-method endpoint is authenticated per §0.3. (Today `POST /payments/users/:id/method` is called by raw axios with no `Authorization` header and a hardcoded body with no card data.)
- **Acceptance criteria**:
  1. Given the repository, when scanned for text inputs whose label or name matches `/card.?number|cvv|cvc|security code/i`, then zero matches are found.
  2. Given 5 saved cards, when a 6th is added, then `409 PAYMENT_METHOD_LIMIT` and the provider token is detached.
  3. Given an order in `PREPARING` paid with card X, when card X is removed, then `409 PAYMENT_METHOD_IN_USE`.
  4. Given the default card is removed, when the list is re-read, then exactly one remaining card has `is_default=true`.
- **Out of scope**: wallets (Apple Pay / Google Pay) at V1; in-app wallet balance; PayPal; Interac; gift cards; storing billing addresses; 3DS challenge UI customisation.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — payment provider**: Which PSP? · **Proposed default**: **Stripe** — Payment Intents + Payment Element/Payment Sheet for cards, Stripe Connect for restaurant and rider payouts. · **Why**: the schema already carries `payment_log.stripe_payment_id`, the rider onboarding state machine already has a `STRIPE_PENDING` state, and the restaurant portal already redirects to Stripe Connect.

> **DECISION REQUIRED — cash on delivery**: Is COD offered at launch? · **Proposed default**: **No.** `cod_enabled=false` at V1. · **Why**: COD requires rider cash handling, a float, and a reconciliation ledger — none of which exists on the rider side — and the enum value alone (`CASH_ON_DELIVERY` in the current type union) is not an implementation.

---

### C-25 — Payment execution and 3DS
- **SOW trace**: *"Secure Payments: Integration with secure payment gateways for seamless and safe transactions."*
- **Behaviour**: On order creation the server creates a provider PaymentIntent for `amount_to_pay_cents` with `capture_method=manual` (authorise now, capture later). If the provider requires 3-D Secure, the server returns `requires_action` with a client secret; the app presents the provider's challenge sheet and confirms. **Capture occurs when the restaurant accepts** (`AWAITING_RESTAURANT → CONFIRMED`). Authorisation is **voided** on rejection, timeout, no-rider, or customer cancellation before capture.
- **Data**: `payments(id, order_id, user_id, payment_method_id, provider, provider_intent_id UNIQUE, amount_cents, currency, status, captured_at, voided_at, failure_code, created_at)`; `payment_events(id, payment_id, provider_event_id UNIQUE, type, payload jsonb, received_at)` for webhook idempotency; `refunds` (C-37).
- **States**: `payments.status ∈ {REQUIRES_ACTION, AUTHORIZED, CAPTURED, VOIDED, FAILED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED}`.
  - `(new) → REQUIRES_ACTION|AUTHORIZED|FAILED` — intent creation/confirmation.
  - `REQUIRES_ACTION → AUTHORIZED|FAILED` — 3DS outcome.
  - `AUTHORIZED → CAPTURED` — restaurant acceptance.
  - `AUTHORIZED → VOIDED` — rejection/timeout/no-rider/customer cancel.
  - `CAPTURED → REFUND_PENDING → PARTIALLY_REFUNDED|REFUNDED` — C-37.
  All transitions are driven by **provider webhooks** as the source of truth; the synchronous API response is treated as a hint.
- **Rules**:
  1. Webhook endpoint verifies the provider signature; unknown/duplicate `provider_event_id` is acknowledged with `200` and ignored (idempotent).
  2. Authorisation hold expires per provider rules (Stripe: 7 days); an order still uncaptured at hold expiry auto-cancels with a full void.
  3. The amount sent to the provider is `orders.total_cents` recomputed server-side — never a client-supplied number.
  4. On `FAILED`, `failure_code` is mapped to one of a fixed set of customer messages: `card_declined`, `insufficient_funds`, `expired_card`, `incorrect_cvc`, `processing_error`, `authentication_failed`. No raw provider text is shown.
  5. **The app may not display a success screen before the server confirms.** (Today `select-payment` navigates to `/payments/success` before the checkout request resolves, so the customer is told "Payment Successful!" even when it failed.) A test asserts the success route is unreachable without an `AUTHORIZED`/`CAPTURED` server state.
  6. All money movement is logged to `payment_events`; a reconciliation job compares provider balance transactions to local `payments` daily and reports drift.
  7. Retry: a `FAILED` payment may be retried on the same order up to **3 times** within 15 minutes with a different or the same method; after that the order transitions to `PAYMENT_FAILED` terminally.
- **Acceptance criteria**:
  1. Given a card requiring 3DS, when the order is placed, then the app presents the provider challenge, and on success the order reaches `AWAITING_RESTAURANT` with `payments.status='AUTHORIZED'`.
  2. Given the restaurant rejects, when the rejection is processed, then `payments.status='VOIDED'` within 60 s and no capture ever occurred (asserted against the provider's test API).
  3. Given the same webhook delivered 3 times, when processed, then exactly one `payment_events` row exists and `payments.status` changed once.
  4. Given a declined card, when the response returns, then the app shows "Your card was declined" and the success route was never mounted.
  5. Given a captured payment, when the daily reconciliation runs, then local `amount_cents` equals the provider's captured amount for that intent.
- **Out of scope**: split payments; partial authorisation; saving cards during checkout without an explicit opt-in; stored-credential/MIT off-session charges; instalments; tipping after capture (see C-36); chargeback/dispute handling in the customer app.
- **Version**: V1 · **Size**: L

---

### C-26 — Order history and active-order resume
- **SOW trace**: *"Order History: View past orders with details like date, time, restaurant, items, and total cost."*
- **Behaviour**: **Your Orders** lists the customer's orders newest first, cursor-paginated, split into two sections: **Active** (any non-terminal status) and **Past**. Each row: restaurant name + logo, short code, placed-at date/time, item count with the first two item names, total, and a status chip. Tapping an active order opens live tracking (C-32); tapping a past order opens the order detail/receipt (C-27). Additionally, whenever an active order exists, a **persistent resume banner** appears on the home screen and above the tab bar showing the status and ETA, tapping through to tracking.
- **Data**: `orders`, `order_food_items`, `restaurants.name`, `restaurants.logo_object_key`, `order_status_events`.
- **States**: none new; the section split is derived from `orders.status`.
- **Rules**:
  1. `GET /orders?status_group=active|past&limit&cursor`. `active` = status ∉ terminal set. Default page size 20, max 50.
  2. Every customer-facing surface that today lacks an `onPress` (Account → "Your Orders") must route; a UI test asserts every rendered menu row navigates somewhere or is not rendered.
  3. The resume banner is driven by a single lightweight `GET /orders/active` (returns 0 or 1 order — see rule 4) polled on app foreground and updated over the socket.
  4. **At most one active order per customer at a time.** A second checkout while an order is active returns `409 ACTIVE_ORDER_EXISTS` with the active order's id.
  5. Past orders are retained and visible for 7 years (C-05 rule 3).
  6. Each row exposes: Reorder (C-28, V3), View receipt (C-27), Get help (C-08/C-39), Request refund (C-37, only within the eligibility window).
- **Acceptance criteria**:
  1. Given an order in `ON_THE_WAY`, when the app is cold-started to home, then the resume banner is visible within 2 s and tapping it opens tracking for that order.
  2. Given an active order, when a second checkout is attempted, then `409 ACTIVE_ORDER_EXISTS` and the client offers to open the existing order.
  3. Given 25 past orders, when the list loads, then 20 render and scrolling to the end loads the remaining 5 with no duplicates.
  4. Given the Account menu, when rendered, then every visible row has a navigation target (asserted for all rows).
- **Out of scope**: filtering/searching order history; exporting history; per-restaurant history views; order history on web; hiding/deleting an order from history.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — concurrent orders**: May a customer have more than one active order at once? · **Proposed default**: **No** — one active order at a time. · **Why**: it removes an entire class of tracking, notification-routing and refund ambiguity for launch, and can be relaxed later without a data migration.

---

### C-27 — Order receipts
- **SOW trace**: *"Order Receipts: Access digital receipts for completed orders."*
- **Behaviour**: Every order in `DELIVERED` (and every order with a captured or refunded payment) has a receipt reachable from order history and from the post-delivery screen. The receipt renders in-app and can be exported as a PDF via a share sheet. It shows: platform legal name and address, restaurant name and address, receipt number, order short code, placed-at and delivered-at timestamps, delivery address, itemised lines (name, variant, add-ons, quantity, unit price, line total), each pricing line from C-22, tax with the registration number, payment method (`brand ••••last4`), amount charged, plus any refunds with their dates.
- **Data**: `receipts(id, order_id UNIQUE, receipt_number UNIQUE, issued_at, pdf_object_key NULL, total_cents, tax_cents, tax_registration_number, snapshot jsonb)`. `snapshot` is an immutable copy of everything printed.
- **States**: a receipt is `ISSUED` on payment capture; it is **never mutated**. A refund appends a `refunds` reference rendered as a supplementary section; the original snapshot is untouched.
- **Rules**:
  1. `receipt_number` format `HG-{YYYY}-{sequential 8 digits}`, gapless per calendar year (allocated from a Postgres sequence inside the capture transaction).
  2. The receipt is generated from `snapshot`, not by re-querying live data — a later price, menu, or restaurant-name change must not alter an issued receipt.
  3. PDF generation is on-demand and cached to MinIO under `receipts/{year}/{receipt_number}.pdf`; the share link is a presigned GET with a **15 min** TTL.
  4. The receipt is available for orders that were cancelled after capture (showing the charge and the refund), and is **not** issued for orders that never captured.
  5. Tax registration number comes from `platform_config.tax_registration_number`; if it is empty the receipt renders without a tax line and the build emits a warning — it never prints a placeholder.
- **Acceptance criteria**:
  1. Given a delivered order, when the receipt is opened, then every C-22 line and the payment method's last4 are present and the totals sum exactly to `amount charged`.
  2. Given the restaurant later renames itself, when the old receipt is reopened, then it shows the original name from `snapshot`.
  3. Given an order refunded in full, when the receipt is opened, then a refund section shows the refund amount and date, and the original charge line is unchanged.
  4. Given a PDF share link, when used after 15 minutes, then MinIO returns 403.
- **Out of scope**: emailing receipts automatically (V2); invoices with a customer's business details; per-item tax breakdown; multi-currency receipts; editing a receipt.
- **Version**: V1 · **Size**: M

---

### C-28 — Reorder
- **SOW trace**: implied by the existing `order_again` feed section; not stated in SOW 9–17.
- **Behaviour**: A "Reorder" action on any past order clones its lines into a new cart. Items no longer available, or whose price changed, are surfaced in a pre-confirmation sheet: available lines are checked, unavailable lines are listed as excluded, and changed prices are shown old→new. Confirming creates the cart.
- **Data**: reads `orders`, `order_food_items`; writes `carts`, `cart_lines`.
- **States**: none.
- **Rules**:
  1. Reorder is blocked if the restaurant is not customer-visible (C-12) or `state != OPEN` (C-14), with the specific reason.
  2. If the current cart is non-empty and from a different restaurant, C-20's replace flow applies.
  3. Variants/add-ons are carried across by id; if a variant or add-on no longer exists or is unavailable, that line is excluded (not silently downgraded to the base item).
  4. Coupons are **not** carried across.
  5. Special requests are carried across verbatim.
- **Acceptance criteria**:
  1. Given a past order of 3 items where 1 is unavailable, when Reorder is confirmed, then the new cart has 2 lines and the sheet listed the excluded item by name.
  2. Given a past order whose restaurant is closed, when Reorder is tapped, then no cart is created and the reason "Closed — opens at {time}" is shown.
  3. Given a past order with a coupon, when reordered, then the new cart has no coupon applied.
- **Out of scope**: scheduling a repeat order; subscriptions; "favourite order" naming; reordering a partially refunded order's refunded items only.
- **Version**: V3 · **Size**: S

---

### C-29 — Order cancellation by the customer
- **SOW trace**: not in SOW 9–17 explicitly, but *"Refund Requests: Request refunds for canceled or unsatisfactory orders"* (SOW 13) and *"Refund Requests: Submit refund requests for canceled, incorrect, or unsatisfactory orders"* (SOW 17) both presuppose customer cancellation. The current in-app FAQ instructs customers to use a cancel flow that does not exist.
- **Behaviour**: A **Cancel order** action is available on the tracking screen while the order is in `AWAITING_RESTAURANT` or `CONFIRMED`. It requires selecting a reason from a fixed list and confirming in a modal that states the refund outcome in plain words before the customer commits. After `PREPARING` the action is replaced by "Get help" (C-08/C-39) — the customer cannot self-cancel.
- **Data**: `orders.status`, `orders.cancelled_at`, `orders.cancellation_reason_code`, `orders.cancelled_by ENUM(CUSTOMER,RESTAURANT,ADMIN,SYSTEM)`, `order_status_events`, `payments`, `refunds`.
- **States**: `AWAITING_RESTAURANT → CANCELLED` and `CONFIRMED → CANCELLED`, actor `CUSTOMER`. No other customer-triggered transition exists.
- **Rules**:
  1. Reason codes (fixed): `ORDERED_BY_MISTAKE`, `TOO_LONG_WAIT`, `WRONG_ADDRESS`, `CHANGED_MIND`, `DUPLICATE_ORDER`, `OTHER` (requires 5–200 chars of free text).
  2. Refund outcome, stated in the confirmation modal and enforced by the server:
     - Cancelled in `AWAITING_RESTAURANT` (not yet captured) ⇒ **authorisation voided, no charge**.
     - Cancelled in `CONFIRMED` (captured) ⇒ **full refund** of `total_cents`, auto-approved, no review.
  3. Cancellation is racy by nature: it is applied with a conditional update (`UPDATE orders SET status='CANCELLED' WHERE id=? AND status IN ('AWAITING_RESTAURANT','CONFIRMED')`). Zero rows affected ⇒ `409 CANCELLATION_WINDOW_CLOSED` with the current status, and the UI refreshes.
  4. Cancellation notifies the restaurant and (if assigned) the rider immediately over their channels.
  5. Abuse guard: **3 customer cancellations in a rolling 7 days** flags the account for review (`users.risk_flag`); a 4th still succeeds but creates an admin task. Cancellation is never silently blocked.
  6. The FAQ copy (C-06) must match this behaviour exactly; the CI check in C-06 rule 3 covers it.
- **Acceptance criteria**:
  1. Given an order in `AWAITING_RESTAURANT`, when the customer cancels, then `orders.status='CANCELLED'`, `cancelled_by='CUSTOMER'`, `payments.status='VOIDED'`, and no `refunds` row is created.
  2. Given an order in `CONFIRMED` with a captured payment, when the customer cancels, then a `refunds` row for the full `total_cents` is created in `PENDING` and auto-submitted to the provider.
  3. Given an order that transitions to `PREPARING` between the UI render and the tap, when cancel is submitted, then `409 CANCELLATION_WINDOW_CLOSED` and the screen updates to show "Get help" instead.
  4. Given an order in `PREPARING`, when the tracking screen renders, then no cancel affordance exists anywhere on it.
- **Out of scope**: partial cancellation (removing one item); cancellation fees; cancellation after `PREPARING` by the customer; re-instating a cancelled order.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — cancellation cutoff**: Is `CONFIRMED` (restaurant accepted but not yet cooking) really cancellable with a full refund? · **Proposed default**: yes, full refund up to and including `CONFIRMED`; nothing after. · **Why**: `PREPARING` is the first point at which the restaurant has incurred food cost, so it is the defensible boundary, and it is a boundary the restaurant itself controls by pressing "start preparing".

---

## 4. Delivery, addresses and tracking (SOW 12)

### C-30 — Delivery address management
- **SOW trace**: *"Delivery Address Management: Add, edit, or remove delivery addresses. Option to save multiple addresses for convenience."*
- **Behaviour**: A Saved addresses screen listing addresses with a label, the formatted address, and a Default marker. Full CRUD: add, edit, delete, set default. A compact address switcher in the home header and on checkout selects the **active** address for the session, which drives serviceability (C-14), delivery fee (C-22), and the cart (C-19).
- **Data**: `delivery_addresses(id, user_id, label, street, building, floor, apartment, landmark, suburb, city, province_code, postal_code, country_code, coords geography(Point,4326), is_default, is_third_person, third_person_name, third_person_phone, delivery_note, is_deleted, deleted_at, created_at)`. Note `coords` replaces the legacy native `POINT`; `city`/`province_code`/`country_code` are new.
- **States**: `is_default` is unique per user (partial unique index `WHERE is_deleted=false AND is_default=true`).
- **Rules**:
  1. Required fields: `label`, `street`, `postal_code`, `city`, `province_code`, `coords`. Optional: `building`, `floor`, `apartment`, `landmark`, `suburb`, `delivery_note`. (Today `apartment`, `floor`, `landmark` and `suburb` are all *required* by the client's zod schema, which is a conversion killer.)
  2. `postal_code` must match the Canadian pattern `^[A-CEGHJ-NPR-TVXY]\d[A-CEGHJ-NPR-TV-Z] ?\d[A-CEGHJ-NPR-TV-Z]\d$`, stored uppercased with a single space.
  3. `province_code` must be a valid 2-letter Canadian province; at V1 only the launch province is accepted (see the launch-province decision in C-22), others return `400 PROVINCE_NOT_SERVED`.
  4. `coords` must be present and must come from the map picker or geocoder (C-31); a manually typed address without coordinates cannot be saved.
  5. Maximum **20** addresses per customer.
  6. `label` is free text ≤ 30 chars with quick-pick suggestions Home / Work / Other; labels need not be unique.
  7. Deleting an address is a **soft delete**; addresses referenced by past orders remain resolvable. Deleting the default promotes the most recently created remaining address. Deleting the last address is allowed and leaves the customer in `NO_ADDRESS` (C-14).
  8. An address referenced by an active order cannot be deleted (`409 ADDRESS_IN_USE`).
  9. Third-person delivery: when `is_third_person=true`, `third_person_name` (1–50) and `third_person_phone` (E.164 `+1`) are required and are the contact given to the rider.
  10. **Every one of add / edit / delete / set-default must actually call the API.** Today edit's mutation is commented out, and delete and set-default only show a success Alert. A test asserts each action issues its request and reflects the server response.
- **Acceptance criteria**:
  1. Given an address is edited, when Update is pressed, then a `PATCH` request is issued, the list reflects the server response, and no success message is shown before the response arrives.
  2. Given a delete is confirmed, when the request succeeds, then the row disappears from the list and a subsequent `GET` does not return it.
  3. Given the default address is deleted, when the list reloads, then exactly one other address has `is_default=true`.
  4. Given a postal code `M5V3L9`, when saved, then it is stored as `M5V 3L9`; given `12345`, then `400 VALIDATION_FAILED`.
  5. Given an address used by an order in `ON_THE_WAY`, when deletion is attempted, then `409 ADDRESS_IN_USE`.
- **Out of scope**: address sharing between accounts; company/billing addresses; address verification against a postal authority database; delivery to coordinates without a street address; contact-book import.
- **Version**: V1 · **Size**: M

---

### C-31 — Address entry: autocomplete, geocoding and map pin
- **SOW trace**: enabling requirement for *"Delivery Address Management"* — without it, every address is seven manual fields plus a mandatory map pin, which the current app requires.
- **Behaviour**: Address entry starts with a **search-as-you-type** field. Suggestions come from a places provider, proxied through our backend (`GET /geo/autocomplete?q&session_token&lat&lng`), restricted to Canada and biased to the current location. Selecting a suggestion calls `GET /geo/place/:id` which returns the structured components and coordinates, pre-filling the form. The customer then confirms or adjusts the pin on a map and fills only unit/floor/instructions. Manual entry remains available via "Enter address manually", which requires dropping a pin.
- **Data**: no new persistent entity; writes into `delivery_addresses` (C-30). Redis cache `geo:auto:{sha256(q|geohash5)}` TTL 3600 s; `geo:place:{placeId}` TTL 30 days.
- **States**: none.
- **Rules**:
  1. The provider key lives **server-side only**. The app never holds a places/geocoding key. (Today two Google keys are committed into the repo.)
  2. Requests are proxied and rate-limited to **30 autocomplete calls per user per minute**; session tokens are used to keep provider billing on the session model.
  3. Results are restricted to `components=country:ca`; non-Canadian results are filtered server-side even if the provider returns them.
  4. Reverse geocoding (`GET /geo/reverse?lat&lng`) fills the form when the customer drops a pin without searching.
  5. If the provider is unavailable, the flow degrades to manual entry + map pin, with a visible notice — address entry never becomes impossible.
  6. The map picker's initial camera is: the customer's current GPS fix if permitted, else the current default address, else the launch city centre from `platform_config.default_map_center`. **No hardcoded Dubai or Hyderabad fallback.**
  7. The pin's final coordinates are what is stored, even if they differ from the geocoded result — the customer's pin wins.
- **Acceptance criteria**:
  1. Given the repository and built bundle, when scanned for the pattern `AIza[0-9A-Za-z_\-]{35}`, then zero matches are found.
  2. Given the query "221B Baker", when typed, then suggestions are Canadian-only and selecting one pre-fills street, city, province, and postal code with ≥1 field non-empty in each.
  3. Given the provider returns HTTP 500, when the customer opens address entry, then the manual form with a map picker is shown with a notice, and an address can still be saved.
  4. Given location permission is denied and no saved address, when the map picker opens, then the camera is at `platform_config.default_map_center` and not at coordinates `25.2048,55.2708` or `17.385,78.487`.
- **Out of scope**: what3words or plus codes; unit-level (apartment) validation; building-entrance routing hints; saving pins without an address; offline geocoding.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — maps & places provider**: Google Maps Platform (Places + Geocoding + Directions) or an alternative (Mapbox)? · **Proposed default**: **Google**, proxied server-side, since the apps already use `react-native-maps` with `PROVIDER_GOOGLE` and the rider app deep-links to Google navigation. · **Why**: it is the shortest path and the SOW names Google Maps as a dependency; the cost is a per-request billing exposure that the proxy + cache must contain.

---

### C-32 — Live order tracking
- **SOW trace**: *"Live Order Tracking: Track orders in real-time with a map interface, showing the rider's location and estimated delivery time."*
- **Behaviour**: One tracking screen per order, reachable from the resume banner (C-26), the post-checkout flow, and order history. It shows: a status stepper, a map, the ETA, the rider card (once assigned), the delivery address, delivery instructions, an order summary, and contextual actions (cancel → C-29 while eligible; call rider → C-34; get help → C-08).
  The stepper has **five** steps, mapped from `orders.status`: **Confirmed** (`AWAITING_RESTAURANT`, `CONFIRMED`) → **Preparing** (`PREPARING`) → **Ready / Rider assigned** (`READY_FOR_PICKUP`, `RIDER_ASSIGNED`) → **On the way** (`PICKED_UP`, `ON_THE_WAY`) → **Delivered** (`DELIVERED`). Terminal failures (`REJECTED`, `CANCELLED`, `NO_RIDER_FOUND`, `PAYMENT_FAILED`) replace the stepper with a full-screen outcome state.
  The map shows the restaurant marker, the delivery marker, and the rider marker once `RIDER_ASSIGNED`; a route polyline is drawn from the rider to the current leg's destination.
- **Data**: `orders`, `order_status_events`, `riders` (via the slim projection in C-18 rule 3), Redis `rider:{id}:location`, socket topic `order:{orderId}`.
- **States**: as C-23. The client subscribes to `order:{orderId}` and receives typed events: `order.status_changed`, `order.rider_assigned`, `order.rider_location`, `order.eta_updated`, `order.cancelled`.
- **Rules**:
  1. Subscription authorisation is server-side: the socket verifies `jwt.sub == orders.customer_id` before joining the topic. A client-supplied user id is never trusted, and a customer cannot subscribe to another customer's order.
  2. Event delivery meets the §0.4 latency budget; when the socket is down the client polls `GET /orders/:orderId` every 15 s and the UI is identical.
  3. **ETA is always present.** `eta_at` is computed at order creation and recomputed on each status change and each rider location update; the UI shows "Arriving {HH:MM}–{HH:MM}" (a ±5 min window). There is no "Calculating…" terminal state; if computation fails the last known ETA is shown with a "estimate" qualifier.
  4. Rider location is shown only while status ∈ `{PICKED_UP, ON_THE_WAY}`. Before pickup the map shows restaurant + destination only — the rider's position en route to the restaurant is **not** exposed to the customer.
  5. Marker updates are interpolated over 10 s to avoid teleporting; stale >45 s ⇒ the banner from §0.4.
  6. The screen retains no unbounded message history; events are reduced into a single state object. (Today every WS message is appended to an unbounded array.)
  7. Backgrounding and returning re-subscribes and replays missed events by `last_event_id`; state must be identical to an uninterrupted session.
  8. Terminal outcome screens are **not** auto-dismissed. (Today the rejection screen redirects home after 2 s, too fast to read.) They require an explicit action and, for `REJECTED`/`CANCELLED`, state the refund outcome and link to C-37.
- **Acceptance criteria**:
  1. Given an order in `PREPARING`, when the restaurant marks it ready, then the stepper advances within 3 s p95 with the socket connected, and within 18 s with the socket forced closed.
  2. Given customer A authenticated, when they attempt to subscribe to customer B's order topic, then the join is refused and no event is delivered.
  3. Given status `CONFIRMED`, when the tracking map renders, then no rider marker is present even if the rider's location is being published.
  4. Given a rejected order, when the outcome screen renders, then it persists until the customer acts and it states the refund outcome.
  5. Given 30 minutes on the tracking screen with location updates every 10 s, then client memory growth attributable to event history is < 1 MB (no unbounded accumulation).
- **Out of scope**: turn-by-turn route display for the rider's path; showing other orders in the rider's batch; historical playback of the delivery route; sharing a live tracking link with a third party; delivery-window countdown promises ("on time or free").
- **Version**: V1 · **Size**: L

---

### C-33 — Delivery instructions
- **SOW trace**: *"Delivery Instructions: Add special instructions for the rider (e.g., 'Leave at the door,' 'Call before delivery')."*
- **Behaviour**: On checkout, a set of **multi-select chips** plus one free-text field. The chip set is exactly the backend enum and the labels map 1:1:
  | Code | Label |
  |---|---|
  | `LEAVE_AT_DOOR` | Leave at my door |
  | `DO_NOT_RING_BELL` | Don't ring the bell |
  | `DO_NOT_CALL` | Don't call me |
  Free text: `special_instructions`, 0–200 chars. Both are shown to the rider on the delivery screen and printed on the order ticket.
- **Data**: `orders.delivery_instructions delivery_instruction[]`, `orders.special_instructions varchar(200)`, `delivery_addresses.delivery_note` (a per-address default that pre-fills the free text).
- **States**: none.
- **Rules**:
  1. **The chip ids sent to the server are the enum values.** Today the UI sends `'door' | 'meet' | 'lobby'`, which are neither the enum values nor semantically the same three options, so instructions silently never reach the rider. A schema-validated request rejects anything outside the enum with `400 VALIDATION_FAILED`.
  2. Instructions are editable only until the order leaves `CONFIRMED`; after that the field is read-only and the customer must use C-34.
  3. `LEAVE_AT_DOOR` and `DO_NOT_CALL` are compatible; no combination is prohibited.
  4. `delivery_addresses.delivery_note` pre-fills but does not overwrite an edited value for the current order.
  5. Free text is stored as-is (no markdown, no links rendered) and is length-capped server-side.
- **Acceptance criteria**:
  1. Given the customer selects "Leave at my door" and "Don't ring the bell", when the order is created, then `orders.delivery_instructions = {LEAVE_AT_DOOR, DO_NOT_RING_BELL}` and the rider app displays both.
  2. Given a request containing `"door"`, then `400 VALIDATION_FAILED` naming `delivery_instructions`.
  3. Given an order in `PREPARING`, when the instructions field is rendered, then it is read-only.
  4. Given an address with a `delivery_note`, when checkout opens, then the free-text field is pre-filled with it and editing does not modify the saved address.
- **Out of scope**: photo-on-delivery requests (needs rider-side capture, not in the customer scope); "meet at lobby / meet outside" options (not in the backend enum — adding them is a schema change requiring rider-app support); per-item instructions (that is C-15's special request); voice instructions.
- **Version**: V1 · **Size**: S

---

### C-34 — Contacting the rider
- **SOW trace**: *"Rider Communication: Chat or call the rider for delivery updates or instructions."*
- **Behaviour — the ambiguity resolved**: At V1 this is **masked voice calling only**, no chat. While the order is in `RIDER_ASSIGNED`…`ON_THE_WAY`, a Call rider button requests `POST /orders/:orderId/rider-call` which returns a **proxy number + PIN** valid for the remainder of the delivery; the app dials it. Neither party ever sees the other's real number. In-app text chat with the rider is **V3 and not specified here** — the current mock chat screens are deleted rather than wired up.
- **Data**: `rider_call_sessions(id, order_id, customer_user_id, rider_id, proxy_number_e164, pin, provider_session_id, expires_at, created_at)`; `riders.phone` never leaves the server.
- **States**: session ∈ `{ACTIVE, EXPIRED}`. Created on first request, expires at `order.delivered_at + 30 min` or `order.cancelled_at`.
- **Rules**:
  1. The button exists only for statuses `RIDER_ASSIGNED, PICKED_UP, ON_THE_WAY`. Outside that window it returns `409 CALL_WINDOW_CLOSED`.
  2. `Linking.openURL` is used to dial and **`Linking` must be imported** — the current crash is a regression test.
  3. Rate limit **5 call-session requests per order**; the same session is returned for repeats within its validity.
  4. The rider's real phone number must not appear in any customer-facing API response (asserted by a contract test against `GET /orders/:orderId/rider`).
  5. If the masking provider is unavailable, the button is disabled with "Calling unavailable — message support", not replaced by a direct number.
- **Acceptance criteria**:
  1. Given an order in `ON_THE_WAY`, when Call rider is tapped, then a proxy number is returned, the dialler opens with it, and `riders.phone` appears nowhere in the response payload.
  2. Given an order in `PREPARING`, when the call endpoint is invoked, then `409 CALL_WINDOW_CLOSED`.
  3. Given 5 sessions already created for an order, when a 6th is requested, then the existing active session is returned (not an error, not a new session).
  4. Given the tracking screen, when Call rider is tapped, then no `ReferenceError` occurs (asserted by an E2E tap test).
- **Out of scope**: in-app chat with the rider (V3); VoIP; call recording; messaging the rider before assignment; contacting the rider after the 30-minute post-delivery window.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — number masking provider**: Masked calling requires a provider (Twilio Proxy or equivalent) and per-minute cost. Is it funded? · **Proposed default**: Twilio Proxy; if it is not funded, ship V1 with **no** customer↔rider contact channel at all and rely on delivery instructions, rather than exposing real phone numbers. · **Why**: exposing a rider's personal number to customers is a safety and privacy liability that no amount of product convenience justifies.

---

### C-35 — Contacting the restaurant
- **SOW trace**: *"Restaurant Communication: Contact restaurants directly for special requests or clarifications (if supported by the app)."* — the SOW itself hedges with "if supported".
- **Behaviour**: The restaurant's public phone number is shown on the order detail while the order is in `AWAITING_RESTAURANT`…`READY_FOR_PICKUP`, with a Call restaurant button dialling it directly (restaurants are businesses; their number is public, so no masking). No chat.
- **Data**: `restaurants.public_phone_e164` (new, distinct from any owner contact), `orders.status`.
- **States**: none.
- **Rules**:
  1. Shown only when `restaurants.public_phone_e164` is non-null and verified by admin; otherwise the button is absent (not disabled).
  2. Available only for the status window above; afterwards the customer is routed to C-08.
  3. Special requests belong on the order (C-15/C-33), not on a phone call — the UI states "For changes to your order, contact support" next to the button.
  4. The restaurant owner's personal contact details are never exposed.
- **Acceptance criteria**:
  1. Given an order in `PREPARING` and a verified restaurant phone, when the order detail renders, then a Call restaurant button dials that number.
  2. Given a restaurant with no verified public phone, when the order detail renders, then no call affordance is present.
  3. Given an order in `ON_THE_WAY`, when the order detail renders, then the restaurant call button is absent and a support link is present.
- **Out of scope**: chat with the restaurant (the current mock screen is deleted); modifying an order by phone (the app cannot reflect it); masked numbers for restaurants.
- **Version**: V3 · **Size**: S

---

### C-36 — Tipping the rider
- **SOW trace**: not in SOW 9–17; present in the current app as four disabled buttons whose value is added to the displayed total but never sent to the backend. Specified here because a tip shown in the UI and never paid is a live consumer-harm defect.
- **Behaviour**: On checkout, tip options **$0 / $2 / $3 / $5 / Custom** (custom 0–2000 cents… see rules). The selected tip is a first-class line in the C-22 breakdown and is included in `amount_to_pay_cents`. It is captured with the order and passed through to the rider's earnings in full.
- **Data**: `orders.tip_cents` (replacing `delivery_partner_tip @db.Money`), included in the pricing snapshot and the receipt; `rider_earnings.tip_cents` (rider domain, referenced only).
- **States**: none. The tip is fixed at capture; there is no post-delivery adjustment at this version.
- **Rules**:
  1. Tip is **0 by default**. No pre-selected non-zero tip.
  2. Custom tip range 0–5000 cents (max $50); above returns `400 VALIDATION_FAILED`.
  3. The tip is **excluded** from the coupon discount base and from the restaurant's settlement; it is taxed per the C-22 decision only if required by the tax decision (default: tips are not taxable).
  4. **100% of the tip goes to the rider**, stated in the UI next to the control.
  5. If the order is cancelled or refunded in full, the tip is refunded in full. On a partial refund the tip is retained unless the refund reason is `NEVER_DELIVERED`.
  6. `orders.tip_cents` must appear in the checkout request payload; a test asserts a non-zero selected tip changes the submitted `amount_to_pay_cents` by exactly that amount.
- **Acceptance criteria**:
  1. Given a $3 tip selected, when the order is placed, then `orders.tip_cents=300`, the provider is charged the subtotal+fees+tax+300, and the receipt shows a Tip line of $3.00.
  2. Given no tip selected, when checkout renders, then the total equals the no-tip total and no tip line is displayed.
  3. Given a custom tip of $60, then `400 VALIDATION_FAILED`.
  4. Given a fully refunded order with a tip, then the refund amount includes the tip.
- **Out of scope**: post-delivery tipping; tipping the restaurant; percentage-based tip presets; tip suggestions based on order value; splitting tips across a batch.
- **Version**: V2 · **Size**: M

---

## 5. Post-order: refunds, reviews, grievances (SOW 13, 14, 17)

### C-37 — Refund requests and refund tracking
- **SOW trace**: *"Refund Requests: Request refunds for canceled or unsatisfactory orders and track refund status."* (13) · *"Refund Requests: Submit refund requests for canceled, incorrect, or unsatisfactory orders. Refund Tracking: Track the status of refund requests."* (17)
- **Behaviour**: From a past order the customer can **Request a refund**, choosing a reason, a scope (whole order or specific items), and optionally attaching up to 3 photos and a 0–500 char description. The request creates a `refunds` row in `REQUESTED` for a **customer-proposed amount computed by the server** (the customer never types an amount). A Refunds screen lists all refund requests with their status, amount, and a timeline. Automatic refunds (cancellation, rejection, no-rider) appear in the same list, already `APPROVED`/`COMPLETED`.
- **Data**: `refunds(id, order_id, user_id, payment_id, type ENUM(AUTOMATIC,CUSTOMER_REQUESTED), reason_code, scope ENUM(FULL,PARTIAL), requested_amount_cents, approved_amount_cents, status, description, evidence_object_keys text[], decided_by_admin_id, decided_at, provider_refund_id, completed_at, denial_reason, created_at)`; `refund_lines(refund_id, order_food_item_id, quantity, amount_cents)`.
- **States**: `refunds.status`:
  | From | To | Trigger |
  |---|---|---|
  | *(new)* | `REQUESTED` | customer submits (customer-requested) |
  | *(new)* | `APPROVED` | system, for automatic refunds (cancel/reject/no-rider) |
  | `REQUESTED` | `UNDER_REVIEW` | agent opens it, or auto after 1 h |
  | `REQUESTED`\|`UNDER_REVIEW` | `APPROVED` | agent approves (full or reduced amount) |
  | `REQUESTED`\|`UNDER_REVIEW` | `DENIED` | agent denies with a reason |
  | `APPROVED` | `PROCESSING` | provider refund submitted |
  | `PROCESSING` | `COMPLETED` | provider webhook confirms |
  | `PROCESSING` | `FAILED` | provider rejects; alarms, returns to `APPROVED` for retry |
  | `DENIED` | `UNDER_REVIEW` | customer appeals once (C-39) |
- **Rules**:
  1. **Eligibility window**: a customer-requested refund may be opened while the order is in any status **from `CONFIRMED` up to 48 hours after `DELIVERED`**. Outside that ⇒ `409 REFUND_WINDOW_CLOSED` with a link to C-08.
  2. Reason codes (fixed): `NEVER_DELIVERED`, `MISSING_ITEMS`, `WRONG_ITEMS`, `FOOD_QUALITY`, `LATE_DELIVERY`, `DAMAGED_SPILLED`, `HALAL_CONCERN`, `CHARGED_INCORRECTLY`, `OTHER` (description required). `HALAL_CONCERN` also auto-creates a linked grievance (C-39) at `HIGH` priority.
  3. **The customer never proposes an amount.** For `FULL` scope the amount is `orders.total_cents` minus any prior refunds. For `PARTIAL` the amount is `Σ(selected line unit_price × quantity)` plus a proportional share of tax, **excluding** delivery and platform fees unless the reason is `NEVER_DELIVERED` (which refunds everything including fees and tip).
  4. One open refund request per order (`REQUESTED`/`UNDER_REVIEW`); a second returns `409 REFUND_ALREADY_REQUESTED`. Total refunds against an order may never exceed the captured amount (enforced by a check inside the approval transaction).
  5. Automatic refunds are never queued for human review and are submitted to the provider immediately.
  6. Refunds go **back to the original payment method** only. No store credit, no alternative destination.
  7. Expected settlement time is displayed as "5–10 business days" from `platform_config.refund_settlement_days_copy`, and the status timeline shows the actual `completed_at` when the webhook lands.
  8. The customer receives a notification on every status change (C-40).
  9. Evidence images: ≤3, ≤10 MB each, jpeg/png/webp, MinIO presigned upload, retained 2 years.
- **Acceptance criteria**:
  1. Given a delivered order 47 hours old, when a refund is requested, then a `refunds` row in `REQUESTED` is created; at 49 hours, `409 REFUND_WINDOW_CLOSED`.
  2. Given a partial refund for 1 of 3 items with reason `MISSING_ITEMS`, then `requested_amount_cents` equals that item's line total plus its proportional tax, and excludes delivery and platform fees.
  3. Given reason `NEVER_DELIVERED` and scope `FULL`, then the computed amount equals `orders.total_cents` including delivery fee, platform fee and tip.
  4. Given an approved refund of $20 on a $30 order that already had a $15 refund completed, when approval is attempted, then it fails with `409 REFUND_EXCEEDS_CAPTURED`.
  5. Given a provider refund webhook, when processed twice, then `refunds.status` is `COMPLETED` and exactly one `payment_events` row exists.
- **Out of scope**: instant/automatic approval heuristics for customer-requested refunds; store credit or wallet; refunds to a different card; partial refunds of the tip; chargeback representation; refund of an order the customer did not place.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — refund approval policy**: Are customer-requested refunds auto-approved below a threshold, or always human-reviewed? · **Proposed default**: always human-reviewed at V1 (with a 24 h target), because there is no fraud signal yet; add an auto-approve threshold (e.g. ≤ $15 and ≤1 refund in 90 days) once volume exists. · **Why**: auto-approval without a fraud model is an open cash tap; the SOW places "Helpdesk" out of scope, so the client must staff the review.

> **DECISION REQUIRED — refund window**: How long after delivery can a customer request a refund? · **Proposed default**: **48 hours**. · **Why**: long enough for a late-evening order to be raised the next day, short enough that food-quality claims remain assessable.

---

### C-38 — Reviews and ratings submission (restaurant, food, rider)
- **SOW trace**: *"Restaurant Reviews: Rate and review restaurants based on food quality, service, and overall experience. Food Reviews: Rate and review individual dishes. Rider Reviews: Rate and review delivery riders based on punctuality, behavior, and service."*
- **Behaviour**: After `DELIVERED`, the customer is prompted once (post-delivery screen, and again as a single notification 2 h later if skipped) to rate the order. One flow, three targets:
  1. **Restaurant** — 1–5 stars (required to submit), optional 0–1000 char review, optional up to 3 photos, plus optional tag chips drawn from a fixed set: `Food quality`, `Portion size`, `Packaging`, `Value`, `Speed`.
  2. **Dishes** — for each ordered dish, an optional 1–5 star rating and optional 0–500 char review.
  3. **Rider** — optional 1–5 stars, optional tag chips from a fixed set: `On time`, `Polite`, `Careful handling`, `Followed instructions`, `Late`, `Rude`, `Wrong drop-off`, plus optional 0–500 char comment.
  Submitting persists all three in one request. Skipping is a first-class outcome with no nagging beyond the single reminder.
- **Data**: `restaurant_rating_reviews` (new, see C-18), `food_item_rating_reviews` (exists; gains `order_id`, `order_food_item_id`, `status`), `rider_rating_reviews` (exists; gains `order_id`, `status`, `tags text[]`). Aggregates: `restaurants.rating_avg/rating_count`, `food_items.rating_avg/rating_count`, `riders.rating_avg/rating_count`.
- **States**: each review row `status ∈ {PUBLISHED, PENDING_MODERATION, REMOVED}`. New reviews are `PUBLISHED` unless they trip the moderation rules below, in which case `PENDING_MODERATION`.
- **Rules**:
  1. **Every review is bound to an order** (`order_id` NOT NULL) and the server derives `user_id` from the JWT. The current endpoints take `user_id` from the request body and verify nothing — anyone can rate anything as anyone.
  2. One review per `(order_id, target)`. A review is **editable for 24 h** after submission, then frozen. Deleting one's own review is allowed within 24 h and decrements the aggregate.
  3. Rating must be an integer 1–5. The current API accepts any number with no clamp (the `Decimal(2,1)` column silently accepts 9.9).
  4. Reviews may only be submitted for orders in `DELIVERED`, within **14 days** of `delivered_at`; outside that, `409 REVIEW_WINDOW_CLOSED`.
  5. Aggregates are recomputed in the same transaction as the write, using `UPDATE … SET rating_avg = (…), rating_count = …` derived from `PUBLISHED` rows only.
  6. Auto-moderation to `PENDING_MODERATION`: review contains a phone number, email, or URL; or matches the profanity list; or the customer has had ≥2 reviews removed in 90 days. Everything else publishes immediately.
  7. Rider reviews are **never shown to the customer population** (C-18 rule 3); they feed the rider's internal metrics and the admin moderation queue only.
  8. **The UI must not claim submission succeeded unless the server confirmed.** Today the rating screen only `console.log`s and then tells the user "Your feedback has been submitted successfully" — this is the single most user-hostile defect in the app and is covered by a dedicated E2E test that fails the build if the success state can be reached without a 2xx response.
- **Acceptance criteria**:
  1. Given a delivered order, when the customer submits 4★ for the restaurant, 5★ for one dish, and 3★ for the rider in one action, then three rows exist with `order_id` set and all three aggregates are updated in the same transaction.
  2. Given the API is stubbed to return 500, when the customer submits, then an error state is shown and no success message appears anywhere.
  3. Given a rating value of `7`, then `400 VALIDATION_FAILED`.
  4. Given a review containing `test@example.com`, when submitted, then it is stored with `status='PENDING_MODERATION'` and does not affect `rating_avg`.
  5. Given a review edited 25 h after submission, then `409 REVIEW_EDIT_WINDOW_CLOSED`.
- **Out of scope**: replying to a restaurant's reply; rating the platform itself; rating without an order; anonymous reviews; incentivised reviews; review translation; rating individual add-ons.
- **Version**: V2 · **Size**: M

---

### C-39 — Grievances and dispute escalation
- **SOW trace**: *"Grievances: Submit grievances or complaints regarding orders, restaurants, or riders."* (14) · *"Dispute Resolution: Escalate unresolved issues to customer support for further assistance."* (17)
- **Behaviour — distinguished from C-08 and C-37**: A **grievance** is a formal complaint about a *party* (restaurant, rider) or about the platform's handling of an issue, with a tracked outcome and an SLA. It is not a general question (C-08) and not a money claim (C-37), though it may reference either. Entry points: order detail → "Report a problem"; review flow → "Report this restaurant/rider"; refund denial → "Appeal this decision"; certification panel → "Report a halal concern".
- **Data**: `grievances(id, user_id, subject_type ENUM(ORDER,RESTAURANT,RIDER,PLATFORM,REFUND_DECISION), subject_id, order_id NULL, refund_id NULL, category_code, severity, description, evidence_object_keys text[], status, assigned_agent_id, resolution_code, resolution_note, created_at, acknowledged_at, resolved_at, sla_due_at)`; `grievance_events(id, grievance_id, actor_type, actor_id, event_type, note, created_at)`.
- **States**: `grievances.status ∈ {SUBMITTED, ACKNOWLEDGED, INVESTIGATING, RESOLVED, REJECTED, ESCALATED}`.
  - `(new) → SUBMITTED` — customer submits.
  - `SUBMITTED → ACKNOWLEDGED` — agent (or the auto-acknowledge job at 1 h).
  - `ACKNOWLEDGED → INVESTIGATING` — agent begins.
  - `INVESTIGATING → RESOLVED|REJECTED` — agent decides, resolution code required.
  - `SUBMITTED|ACKNOWLEDGED|INVESTIGATING → ESCALATED` — SLA breach (auto) or customer requests escalation once.
  - `RESOLVED|REJECTED → ESCALATED` — customer disputes the outcome, once only, within 7 days.
  - Terminal: `RESOLVED`, `REJECTED` after the 7-day dispute window closes.
- **Rules**:
  1. Category codes: `HALAL_CONCERN`, `FOOD_SAFETY`, `RIDER_CONDUCT`, `RESTAURANT_CONDUCT`, `DISCRIMINATION`, `PRIVACY`, `BILLING_DISPUTE`, `SERVICE_FAILURE`, `OTHER`.
  2. **Severity is server-assigned, not customer-chosen**: `HALAL_CONCERN`, `FOOD_SAFETY`, `DISCRIMINATION`, `PRIVACY` ⇒ `CRITICAL` (SLA acknowledge 4 h, resolve 3 business days); everything else ⇒ `STANDARD` (acknowledge 24 h, resolve 7 business days). `sla_due_at` is computed at insert.
  3. A `CRITICAL` grievance about halal certification additionally: notifies the admin halal queue immediately, and records the restaurant id so admin can suspend certification if warranted. It does **not** automatically hide the restaurant — that is an admin decision.
  4. Description 20–2000 chars (a lower bound, deliberately, so complaints are actionable). Up to 5 evidence files, ≤10 MB each.
  5. The customer sees a status timeline built from `grievance_events` and receives a notification at every transition.
  6. Rate limit: 5 grievances per customer per 7 days; beyond that `429 GRIEVANCE_RATE_LIMITED` with a route to C-08.
  7. A grievance never itself moves money. A resolution that warrants a refund creates a linked `refunds` row (C-37) whose id is shown on the grievance.
  8. Escalation is available exactly **once** per grievance and routes to a higher admin tier; a second attempt returns `409 ALREADY_ESCALATED`.
- **Acceptance criteria**:
  1. Given a grievance with category `HALAL_CONCERN`, when submitted, then `severity='CRITICAL'`, `sla_due_at` is 4 h out, and the admin halal queue receives it.
  2. Given a `SUBMITTED` grievance untouched for its SLA acknowledge window, when the SLA job runs, then status becomes `ESCALATED` and the customer is notified.
  3. Given a `RESOLVED` grievance, when the customer escalates once then attempts a second escalation, then the first succeeds and the second returns `409 ALREADY_ESCALATED`.
  4. Given a description of 12 characters, then `400 VALIDATION_FAILED` requiring at least 20.
  5. Given a grievance resolved with a refund, when the customer opens it, then a link to the `refunds` record is shown with its current status.
- **Out of scope**: legal claims handling; small-claims/arbitration workflows; publishing grievance outcomes; grievances against other customers; anonymous grievances; compensation offers other than a refund (no credits/vouchers exist).
- **Version**: V2 · **Size**: L

---

## 6. Notifications (SOW 16)

### C-40 — Notifications: push, in-app inbox, and alerts
- **SOW trace**: *"Order Updates: Push notifications for order confirmation, preparation status, dispatch, and delivery. Promotions and Offers: Notifications about discounts, coupons, or special offers from restaurants. Account Alerts: Alerts for profile updates, payment confirmations, or refund status."*
- **Behaviour**: Three delivery channels and one inbox.
  - **Push (FCM/APNs via Expo Notifications)** for the events listed below.
  - **In-app realtime** when the app is foregrounded (the socket already carries the event; the app renders a toast instead of a system notification).
  - **In-app inbox** — a persisted, cursor-paginated list of every notification ever sent to the customer, with read/unread state and a tab-bar/header unread badge.
  Permission is requested **contextually**, immediately after the first successful order placement ("Get updates on your order?"), never at app launch.
- **Data**: `push_tokens(id, user_id, token, platform ENUM(IOS,ANDROID), device_id, app_version, is_active, last_seen_at, created_at)`; `notifications(id, user_id, type, title, body, data jsonb, order_id NULL, created_at, read_at, push_sent_at, push_status)`; `user_preferences` (C-04) for the promotional opt-outs.
- **States**: `notifications.read_at` null/set. `push_tokens.is_active` flips to false on a provider `DeviceNotRegistered` error.
- **Rules**:
  1. **Notification catalogue (exhaustive at V1).** Transactional (cannot be disabled): `ORDER_PLACED`, `ORDER_CONFIRMED`, `ORDER_REJECTED`, `ORDER_PREPARING`, `ORDER_READY`, `RIDER_ASSIGNED`, `ORDER_PICKED_UP`, `ORDER_ARRIVING` (fired once when the rider is within 500 m or 3 min), `ORDER_DELIVERED`, `ORDER_CANCELLED`, `PAYMENT_FAILED`, `REFUND_APPROVED`, `REFUND_COMPLETED`, `REFUND_DENIED`, `SUPPORT_REPLY`, `GRIEVANCE_UPDATE`, `CERTIFICATION_LAPSED_ON_ACTIVE_ORDER`. Optional (respect C-04): `PROMOTION`, `REVIEW_REMINDER` (max one per order).
  2. Every push carries `data.deep_link` naming an in-app route and the entity id; tapping always lands on the specific object, never the home screen.
  3. Delivery target: push dispatched within **5 s p95** of the triggering state change. A push that fails is retried twice with backoff, then recorded `push_status='FAILED'`; the inbox row still exists so nothing is lost.
  4. **Every notification is persisted to the inbox regardless of push outcome or OS permission.** The inbox is the system of record; push is a delivery optimisation. (Today the inbox is a permanently static "No New Notifications" screen.)
  5. Deduplication: one notification per `(user_id, type, order_id)` — a repeated status event never produces a second push.
  6. Quiet hours 22:00–08:00 local suppress **`PROMOTION` only**; transactional pushes are always delivered.
  7. Token lifecycle: registered on login and on app foreground if changed; deactivated on logout and on provider rejection. A token is bound to exactly one `user_id` (re-registration under a new user detaches it from the old).
  8. If the OS permission is denied, the app shows a one-line inbox banner explaining that updates are in the inbox and offering a link to system settings; it does not re-prompt more than once per 30 days.
  9. Badge count = unread inbox rows, updated over the socket and on cold start.
- **Acceptance criteria**:
  1. Given the app is force-quit and the restaurant accepts the order, then a push arrives within 5 s p95, and tapping it opens the tracking screen for that specific order.
  2. Given push permission is denied, when the order status changes, then a `notifications` row still exists and the inbox badge increments.
  3. Given `push_promotions=false`, when a promotional campaign is dispatched, then no push is sent to that customer and no `PROMOTION` inbox row is created.
  4. Given the same `ORDER_CONFIRMED` event is emitted twice, then exactly one notification row and one push exist.
  5. Given a customer logs out and another logs in on the same device, when a notification is sent to the first customer, then it is not delivered to that device.
- **Out of scope**: email notifications (V2, except the C-03 verification and C-05 deletion emails); SMS notifications; notification categories/channels beyond the two groups; rich media push; scheduled marketing campaigns and the campaign authoring tool; web push; in-app notification centre filtering/search.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — push infrastructure**: Expo Push Service (managed) or direct FCM/APNs? · **Proposed default**: **Expo Push Service** for V1 (one integration, works with EAS builds, no APNs certificate management inside the Go binary), with the server-side sender abstracted so a direct FCM/APNs implementation can replace it without touching call sites. · **Why**: the apps are Expo-managed; direct APNs/FCM adds certificate operations for no launch-critical benefit.

---

## 7. Cross-cutting requirements binding on the customer app

These are not features, but any of them missing invalidates the features above. Listed so they are not dropped in planning.

| # | Requirement | Why it is here |
|---|---|---|
| X-1 | Tokens in `expo-secure-store`, never AsyncStorage | today both apps keep access + refresh tokens in plain AsyncStorage |
| X-2 | No API keys, UUIDs, or credentials in the app bundle or repo | two Google keys are committed today; a bundle scan is part of CI |
| X-3 | `usesCleartextTraffic: false`; all traffic HTTPS/WSS through Traefik | today Android cleartext is enabled to permit `ws://` |
| X-4 | No PII, tokens, or full payloads in production logs | today both apps log token previews and full order payloads |
| X-5 | Offline state: a global connectivity banner and a retry affordance on every data screen | the customer app has none today |
| X-6 | Every screen has an explicit empty state, error state, and loading state; loading is data-driven, not a 1-second timer | today a global skeleton auto-hides after 1 s regardless of data |
| X-7 | No dead routes: every rendered navigation affordance resolves, asserted by a route-coverage test | today seven account rows have no `onPress` and several routes 404 |
| X-8 | Currency, phone country code, map defaults and flags all agree with the launch market | today prices are `$`, phone is forced `+91`, the flag is Canadian, map fallbacks are Hyderabad and Dubai |

---

## 8. Feature index

| ID | Feature | Version | Size |
|---|---|---|---|
| C-01 | Registration & phone OTP verification | V1 | M |
| C-02 | Login, logout, session lifecycle | V1 | M |
| C-03 | Profile management | V1 | M |
| C-04 | Preferences | V3 | M |
| C-05 | Account deletion | V1 | M |
| C-06 | Help centre & FAQ | V1 | M |
| C-07 | Call support | V2 | S |
| C-08 | Customer support message thread | V2 | L |
| C-09 | Home feed | V1 | L |
| C-10 | Search | V1 | M |
| C-11 | Filters and sort | V2 | L |
| C-12 | **Halal certification display and verification** | V1 | M |
| C-13 | Restaurant detail page | V1 | M |
| C-14 | Availability & serviceability gating | V1 | M |
| C-15 | Food item detail | V1 | M |
| C-16 | Variant and add-on selection | V1 | M |
| C-17 | Favourite restaurants | V3 | S |
| C-18 | Reviews & ratings display | V2 | M |
| C-19 | Cart management | V1 | M |
| C-20 | Single-restaurant cart constraint | V1 | S |
| C-21 | Coupons and discounts | V2 | M |
| C-22 | Price breakdown | V1 | M |
| C-23 | Order placement | V1 | L |
| C-24 | Payment methods | V1 | L |
| C-25 | Payment execution and 3DS | V1 | L |
| C-26 | Order history & active-order resume | V1 | M |
| C-27 | Order receipts | V1 | M |
| C-28 | Reorder | V3 | S |
| C-29 | Order cancellation | V1 | M |
| C-30 | Delivery address management | V1 | M |
| C-31 | Address autocomplete, geocoding, map pin | V1 | M |
| C-32 | Live order tracking | V1 | L |
| C-33 | Delivery instructions | V1 | S |
| C-34 | Contacting the rider | V1 | M |
| C-35 | Contacting the restaurant | V3 | S |
| C-36 | Tipping the rider | V2 | M |
| C-37 | Refund requests and tracking | V1 | L |
| C-38 | Reviews & ratings submission | V2 | M |
| C-39 | Grievances and dispute escalation | V2 | L |
| C-40 | Notifications: push, inbox, alerts | V1 | L |

**Counts** — V1: **28** · V2: **8** · V3: **4** · total **40**.
**Sizes** — S: 6 · M: 24 · L: 10.

---

## 9. Decisions required

Each is blocking only for the feature named. Every one has a proposed default that this specification already assumes; if a default is accepted no further work is needed, and if it is rejected only the named feature changes.

1. **SMS provider (C-01)** — Which provider sends OTP in Canada, and who owns the A2P registration? *Default: Twilio, client-owned account, abstracted behind an `SMSSender` interface.*
2. **Supabase retirement (C-01)** — Keep Supabase for OTP or move fully in-house? *Default: remove Supabase; the Go binary owns OTP.*
3. **Halal strictness preferences (C-04)** — Filter by certifying body or school of thought? *Default: no, at any version; show the body's name as text.*
4. **Support staffing & hours (C-07)** — Is there a staffed phone line, with what hours? *Default: none at V1; `support_enabled=false`.*
5. **Restaurants with lapsed certification (C-12)** — Hide entirely, or show as expired and unorderable? *Default: hide entirely from every customer surface.*
6. **Recognised certifying bodies (C-12)** — Maintain a whitelist, or admin judgement per restaurant? *Default: no whitelist; admin judgement; body name always displayed.*
7. **Certificate document visibility (C-12)** — Who may view the certificate file? *Default: any authenticated customer, presigned 300 s, audited.*
8. **Per-day opening hours (C-14)** — Extend the single open/close pair to a weekly schedule? *Default: single pair at V1, weekly table at V2.*
9. **Nutrition data ownership (C-15)** — Who supplies calories, and is it mandatory? *Default: optional, restaurant-entered, unverified, shown with a disclaimer.*
10. **Who funds discounts (C-21)** — Platform-funded or restaurant-funded coupons? *Default: platform-funded; restaurants settled on the pre-discount subtotal.*
11. **Sales tax (C-22)** — Which taxes, on which base, and who is the registrant? *Default: 13% HST on food + delivery fee + platform fee, client is the registrant, rates table-driven.*
12. **Launch province(s) (C-22)** — Which province(s) at launch? *Default: Ontario (GTA) only; other provinces rejected at address creation.*
13. **Restaurant acceptance window (C-23)** — How long before auto-rejection? *Default: 5 minutes, then auto-reject with a full void.*
14. **Order modification after placement (C-23)** — In scope, given the FAQ promises it today? *Default: no, at any version; correct the FAQ and direct customers to cancel-and-reorder.*
15. **Payment provider (C-24)** — Which PSP? *Default: Stripe (Payment Intents + Payment Sheet + Connect).*
16. **Cash on delivery (C-24)** — Offered at launch? *Default: no; `cod_enabled=false` until a rider cash ledger exists.*
17. **Concurrent orders (C-26)** — May a customer have more than one active order? *Default: no, one at a time.*
18. **Cancellation cutoff (C-29)** — Is `CONFIRMED` cancellable with a full refund? *Default: yes up to and including `CONFIRMED`; nothing after.*
19. **Maps & places provider (C-31)** — Google or Mapbox? *Default: Google, proxied server-side and cached.*
20. **Number-masking provider (C-34)** — Is masked calling funded? *Default: Twilio Proxy; if unfunded, ship with no customer↔rider channel rather than exposing real numbers.*
21. **Refund approval policy (C-37)** — Auto-approve below a threshold, or always review? *Default: always human-reviewed at V1, 24 h target.*
22. **Refund window (C-37)** — How long after delivery? *Default: 48 hours.*
23. **Push infrastructure (C-40)** — Expo Push Service or direct FCM/APNs? *Default: Expo Push Service, behind a sender abstraction.*

### Decisions deliberately NOT required (closed here)

These were ambiguous in the SOW and are closed by this document without needing client input, because the SOW's own wording or the platform's premise determines the answer:

- *"Advanced filters"* → the nine filters and five sorts enumerated in C-11. Nothing else is a filter.
- *"Real-time"* → WSS, p95 ≤ 3 s, rider position every 10 s, 15 s polling fallback (§0.4).
- *"Live chat"* → an asynchronous ticket thread with agent replies; not a synchronous chat, not a bot (C-08).
- *"Nutritional information"* → ingredients, allergens, veg/non-veg, dairy, plus optional restaurant-entered calories (C-15).
- *"Only one restaurant per order"* → server-enforced `409`, blocking modal, atomic replace-cart (C-20).
- *"Delivery options"* → the ETA range, delivery fee, and minimum order computed for the selected address (C-14).
- *"View and verify Halal certifications"* → badge + certification panel + audited presigned certificate viewer, with non-certified restaurants invisible (C-12).
