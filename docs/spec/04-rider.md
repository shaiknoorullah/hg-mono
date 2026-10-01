---
covers:
  - apps/rider/**
  - services/hg/internal/rider/**
reviewed: 2026-10-01
---

# HalalGoes — RIDER Domain Specification

**Status:** implementation-ready draft · **Date:** 2026-08-10
**Target architecture:** Go modular monolith (`rider`, `dispatch`, `delivery`, `earnings`, `payouts` modules) + Postgres 16 w/ PostGIS + Redis 7 + MinIO + Traefik. Expo (React Native) rider app.
**Sources:** `sow.txt` (Rider section, items 1–9) · `scope/features-customer-rider.md` (§B, §C) · `fleet/hg-fe-rider-app.md` · `fleet/gap-realtime-dispatch.md`

This document exists because the SOW's Rider section is nine bullet groups of undefined adjectives, and the system built against it got every hard question wrong. Every rule below is stated so that two engineers reading it independently write the same code, and a QA engineer can fail a build against it.

---

## 0. Conventions (binding on every feature below)

### 0.1 Platform invariants

| Concern | Rule |
|---|---|
| Money | Integer **cents**, currency fixed `CAD`. No floats anywhere, including JSON. Field naming `*_cents`. |
| Time | Stored and transmitted as UTC RFC-3339 with milliseconds (`2026-08-10T14:03:11.482Z`). Rendered in `rider.timezone` (default `America/Toronto`). |
| Distance | Integer **metres**. Duration integer **seconds**. |
| Geo | `geography(Point,4326)`. Proximity via `ST_DWithin`; ordering via `ST_Distance`. No Redis GEO as a source of truth (see §0.6). |
| IDs | UUIDv7 (time-sortable) for all entities. Path params are UUIDs; never sequential ints. |
| Enums | Postgres native enums, SCREAMING_SNAKE. Client must treat unknown enum values as "unsupported — refresh app", never crash. |
| Errors | `{"error":{"code":"OFFER_ALREADY_TAKEN","message":"...","details":{}}}`. `code` is a stable machine constant; UI copy is keyed off `code`, never off `message`. |
| Idempotency | Every non-GET endpoint that moves money, changes an assignment, or transitions a delivery **requires** header `Idempotency-Key` (UUID). Server stores `(rider_id, endpoint, key) → response` for 24 h and replays the stored response verbatim. |
| Versioning | All rider endpoints under `/api/v1/riders/...`. Breaking change ⇒ `/v2`, both served for ≥90 days. |

### 0.2 Authorization (replaces the client-side gate that shipped)

Every `/api/v1/riders/:riderId/...` endpoint enforces, server-side, in this order:

1. Valid non-expired access JWT, `role=rider`.
2. `jwt.sub == :riderId` (or caller has `role in (admin, support)` with an audit record written).
3. `rider.account_status = ACTIVE` for all operational endpoints (availability, offers, deliveries, earnings, payouts). `SUSPENDED`/`DEACTIVATED` ⇒ `403 ACCOUNT_NOT_ACTIVE`.
4. `rider.onboarding_state = ACTIVE` for dispatch-related endpoints ⇒ otherwise `403 ONBOARDING_INCOMPLETE` with `details.next_step`.

**No client-persisted boolean (`isApproved`, `isVerified`, `isAuthenticated`) is ever load-bearing.** The app renders from server state only; a forged local flag must produce a 403 on the first call.

Access token TTL 15 min, refresh token TTL 30 days, rotating, single-use, family-revoked on reuse detection. Both tokens stored in `expo-secure-store`, never `AsyncStorage`.

### 0.3 Realtime contract (pins the "three guessed channels" problem)

One authenticated WebSocket per rider device at `wss://<host>/ws`:

- Connect with `Authorization: Bearer <access token>` in the `Sec-WebSocket-Protocol` header or a `?ticket=` short-lived (60 s) ticket obtained from `POST /api/v1/realtime/ticket`. **The server derives `rider_id` from the token. A client-supplied `userId` is ignored.** (Today any client can subscribe to any user's stream.)
- The server subscribes the socket to exactly two logical topics, both server-side: `rider:{rider_id}` and, while an assignment is active, `order:{order_id}`. The client **never** joins channels; `join_channel` does not exist in v1.
- Message envelope, every message:
  ```json
  { "id":"<uuid>", "type":"offer.created", "occurred_at":"...", "seq":1187, "data":{...} }
  ```
- `seq` is a per-rider monotonic counter. On reconnect the client sends `{"type":"resume","after_seq":1187}`; the server replays undelivered events from a 30-minute Redis stream. This replaces the "queue vs failed_notifications key mismatch" dead-letter that silently ate notifications.
- Event types (rider): `offer.created`, `offer.withdrawn`, `assignment.updated`, `order.cancelled`, `earnings.credited`, `payout.updated`, `verification.updated`, `broadcast.message`.
- **Every event that requires rider action is also sent as a push notification** (§D-33). The WebSocket is an optimisation, never the only delivery path. A rider with the app killed must still receive an offer.

### 0.4 Canonical state machines

**`rider.onboarding_state`**
```
REGISTERED → PHONE_VERIFIED → PROFILE_PENDING → VEHICLE_PENDING → DOCUMENTS_PENDING
  → DOCUMENTS_REVIEW → (DOCUMENTS_REJECTED → DOCUMENTS_PENDING)*  → PAYOUT_PENDING → ACTIVE
```

**`rider.account_status`**: `PENDING | ACTIVE | SUSPENDED | DEACTIVATED`
(orthogonal to onboarding_state; only `ACTIVE` + onboarding `ACTIVE` can be dispatched)

**`rider.availability_state`** — single source of truth, column on `rider`, mutated only by the server:
```
OFFLINE  --rider toggles on-->            ONLINE_IDLE
ONLINE_IDLE --accept offer (same txn)-->  ON_DELIVERY
ON_DELIVERY --assignment terminal-->      ONLINE_IDLE   (if the rider was online at accept time)
ONLINE_IDLE --no location for 120s-->     ONLINE_STALE  (not dispatchable, still "online" in UI)
ONLINE_STALE --location received-->       ONLINE_IDLE
any --rider toggles off / suspended-->    OFFLINE
```
Going `OFFLINE` while `ON_DELIVERY` is rejected (`409 ACTIVE_DELIVERY_IN_PROGRESS`); the rider may set `go_offline_after_delivery=true` instead.

**`offer.state`**: `PENDING → ACCEPTED | REJECTED | EXPIRED | WITHDRAWN`
**`assignment.state`**:
```
ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → PICKED_UP → EN_ROUTE_TO_DROPOFF
   → ARRIVED_AT_DROPOFF → DELIVERED
   ↘ (from any pre-DELIVERED state) UNDELIVERABLE → RETURNING → RETURNED
   ↘ CANCELLED_BY_PLATFORM | REASSIGNED
```
`PICKED_UP` + `EN_ROUTE_TO_DROPOFF` are the SOW's "in transit". Transitions are strictly forward; a repeat of the current state is a 200 no-op (idempotent retry), a backwards transition is `409 INVALID_TRANSITION`.

### 0.5 Reference constants (all admin-configurable, seeded with these values)

| Key | Value | Used by |
|---|---|---|
| `dispatch.wave_size` | 3 riders | D-13 |
| `dispatch.offer_ttl_seconds` | 30 | D-15 |
| `dispatch.max_waves` | 5 | D-13/15 |
| `dispatch.inter_wave_gap_seconds` | 2 | D-13 |
| `dispatch.radius_ladder_m` | `[3000, 6000, 10000]` | D-13 |
| `dispatch.location_freshness_seconds` | 90 | D-13 |
| `dispatch.max_total_seconds` | 300 | D-15 |
| `dispatch.ops_queue_seconds` | 600 | D-15 |
| `geo.arrival_radius_m` | 150 | D-20 |
| `earn.base_fare_cents` | 350 | D-26 |
| `earn.per_km_cents` | 80 | D-26 |
| `earn.wait_free_minutes` | 8 | D-26 |
| `earn.wait_per_minute_cents` | 25 (cap 20 min) | D-26 |
| `earn.min_guarantee_cents` | 600 | D-26 |
| `earn.cancel_compensation_cents` | 300 (post-`ARRIVED_AT_PICKUP`) | D-26 |
| `payout.min_balance_cents` | 1000 | D-28 |
| `payout.schedule` | weekly, Mon 09:00 America/Toronto | D-28 |
| `loc.active_interval_seconds` | 5 | D-12 |
| `loc.idle_interval_seconds` | 15 | D-11 |

### 0.6 Explicitly deleted mechanisms

The rebuild **must not** reintroduce: Redis keys `riders:available:locations`, `riders:available:online`, `riders:active`, `failed_notifications:*`; client-side channel guessing; client-computed earnings; client-persisted approval flags; the 7-second drawer auto-dismiss; the "arrived" demo `setInterval`/`setTimeout` timers; hardcoded API base URLs and Google keys in source.

---

## 1. Feature specifications

### D-01 — Rider signup: phone entry + OTP + account creation

- **SOW trace**: *"Signup/Register: Register with document upload, age verification, licence, phone and vehicle documents."* · *"Login/Logout: Simple login using mobile number or email, with OTP verification for security"*
- **Behaviour**: The rider enters a phone number in E.164 with country selector limited to `CA` (`+1`, 10 national digits, NANP-valid area code). `POST /api/v1/auth/rider/otp/request {phone}` always returns `202` with `{request_id, expires_at, resend_available_at}` regardless of whether the number is known (no account enumeration). SMS delivers a 6-digit numeric code. `POST /api/v1/auth/rider/otp/verify {request_id, phone, code}` returns either (a) `{onboarding_token}` — new rider, a 24 h scoped JWT valid only for onboarding endpoints, or (b) `{access_token, refresh_token, rider}` — existing rider. A new rider row is created at first successful verify with `onboarding_state=PHONE_VERIFIED`, `account_status=PENDING`.
- **Data**:
  - `rider(id, phone, phone_verified_at, email, email_verified_at, first_name, last_name, date_of_birth, timezone, locale, onboarding_state, account_status, coords, coords_updated_at, availability_state, availability_changed_at, go_offline_after_delivery, rating_avg, rating_count, created_at, updated_at, deleted_at)`
  - `otp_request(id, phone, role, code_hash, attempts, max_attempts, expires_at, consumed_at, ip, created_at)`
- **States**: `(none) → REGISTERED → PHONE_VERIFIED` on first successful verify.
- **Rules**:
  - Code TTL 5 min. Max 5 verify attempts per `request_id`, then `410 OTP_EXPIRED` and a new request is required.
  - Resend allowed after 30 s; max 3 sends per phone per 15 min; max 10 per phone per 24 h; max 20 per IP per hour. Exceeded ⇒ `429 OTP_RATE_LIMITED` with `retry_after_seconds`.
  - Codes stored only as bcrypt hashes; never logged, never returned, never included in a push payload.
  - The phone number is the account identity; email is captured later (D-03) and is **not** a login factor in V1.
  - A phone belonging to a `DEACTIVATED` rider returns the normal `202`; verify returns `403 ACCOUNT_DEACTIVATED`.
- **Acceptance criteria**:
  1. Given a valid CA number, When the rider requests an OTP twice within 30 s, Then the second call returns `429 OTP_RATE_LIMITED` and no second SMS is sent.
  2. Given a 6-digit code, When the rider enters it wrong 5 times, Then the 6th attempt returns `410 OTP_EXPIRED` and the correct code no longer works.
  3. Given a brand-new number, When verification succeeds, Then the response contains `onboarding_token` and no `access_token`, and calling `PUT /riders/:id/availability` with that token returns `403 ONBOARDING_INCOMPLETE`.
  4. Given an existing ACTIVE rider, When verification succeeds, Then `access_token` + `refresh_token` are returned and both are written to SecureStore (assert via device-storage test that `AsyncStorage` contains no token).
- **Out of scope**: email/password login, social sign-in (Apple/Google/Facebook buttons are removed, not stubbed), non-CA phone numbers, WhatsApp OTP.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — launch market**: Is the launch market Canada-only for riders in V1, or must the app support a second market (the current codebase mixes `+1` flags with `+91` logic and CAD/₹ currency)? · **Proposed default**: Canada only — `CA` phone, `CAD`, `America/*` timezones, English only; every other locale is a V3 i18n project. · **Why**: One coherent market removes an entire class of currency/phone/timezone defects at zero cost.

---

### D-02 — Login, session, logout

- **SOW trace**: *"Login/Logout: Simple login using mobile number or email, with OTP verification for security"*
- **Behaviour**: Same OTP flow as D-01 for an existing rider. On app launch, the client calls `GET /api/v1/riders/me` with the stored access token; on `401` it performs a single refresh via `POST /api/v1/auth/refresh {refresh_token}` and retries once; on refresh failure it clears tokens and routes to phone entry. `GET /riders/me` returns the full server-side routing decision so the client contains **no** branching tree: `{rider, onboarding_state, next_step, next_route, account_status, availability_state, active_assignment_id|null}`. Logout calls `POST /api/v1/auth/logout` (revokes the refresh-token family), wipes SecureStore, disconnects the socket, and cancels location tasks.
- **Data**: `refresh_token(id, rider_id, family_id, token_hash, issued_at, expires_at, revoked_at, replaced_by, device_id, user_agent)`
- **States**: no rider-state change. Session: `ANONYMOUS → AUTHENTICATED → ANONYMOUS`.
- **Rules**:
  - The 401 interceptor must send `Authorization: Bearer ${result.access_token}` — a single-flight refresh shared by all queued requests (the shipped app produced `Bearer [object Object]` and silently logged users out).
  - Refresh tokens are single-use and rotating; presenting a used token revokes the whole family and forces re-login (`401 REFRESH_REUSE_DETECTED`).
  - Logout while `ON_DELIVERY` is allowed but does **not** end the assignment; the assignment remains and reappears on next login. Ops is alerted after 5 min of no location on an active assignment (D-12).
  - `next_route` values are a closed enum the client maps to screens; an unknown value routes to a "please update the app" screen.
- **Acceptance criteria**:
  1. Given an expired access token and a valid refresh token, When five requests fire concurrently, Then exactly one refresh call is made and all five requests succeed with the new token.
  2. Given a refresh token that has already been used, When it is presented again, Then the response is `401 REFRESH_REUSE_DETECTED` and the previously-issued sibling token is also rejected.
  3. Given a logged-out rider, When the app relaunches, Then no network call carries an Authorization header and the rider lands on phone entry.
- **Out of scope**: multi-device concurrent sessions with independent availability (V1 = one active session per rider; a new login revokes the previous device's socket).
- **Version**: V1 · **Size**: M

---

### D-03 — Rider profile & age verification

- **SOW trace**: *"Register with document upload, age verification, licence, phone and vehicle documents."* · *"Profile management: Update Personal Information"*
- **Behaviour**: After phone verification the rider supplies `email`, `first_name`, `last_name`, `date_of_birth` via `POST /api/v1/riders/:id/onboarding/profile`. Age is computed server-side as full years at request time. **Age verification is two-stage**: (1) declared DOB gate at signup; (2) admin confirmation that the DOB on the uploaded government photo ID / driver's licence matches the declared DOB (D-06). A mismatch is a rejection reason, not a silent pass.
- **Data**: `rider.first_name, last_name, date_of_birth (date), email, email_verified_at`; `rider_profile_photo_document_id` (FK to `rider_document`).
- **States**: `PHONE_VERIFIED → PROFILE_PENDING → VEHICLE_PENDING` on success.
- **Rules**:
  - `date_of_birth` must yield age ≥ **18** years and ≤ 80 at submission. Below ⇒ `422 UNDERAGE` with `details.min_age`. The client mirrors the rule but the server is authoritative.
  - Names: 1–50 chars, letters/space/hyphen/apostrophe, trimmed, NFC-normalised.
  - Email: RFC-5322 syntactic + MX check, lowercased, unique among non-deleted riders (`409 EMAIL_IN_USE`). Email verification link is sent but does **not** block onboarding in V1.
  - `date_of_birth` is immutable after `DOCUMENTS_APPROVED` — changing it requires a support ticket and re-verification.
  - Post-activation profile edits: `first_name`/`last_name` edits set `onboarding_state` unchanged but flag `name_change_pending_review=true` and notify admin; email/phone changes require a fresh OTP to the **new** value (the shipped 4-digit "accepts any digits" screen is deleted).
- **Acceptance criteria**:
  1. Given a DOB making the rider 17 years and 364 days old, When profile is submitted, Then `422 UNDERAGE` and `onboarding_state` is unchanged.
  2. Given an email already used by another active rider, When profile is submitted, Then `409 EMAIL_IN_USE`.
  3. Given an approved rider, When they PATCH `date_of_birth`, Then `409 IMMUTABLE_AFTER_APPROVAL`.
  4. Given an approved rider changing their email, When they submit the new address, Then no change is persisted until an OTP sent to the new address is verified.
- **Out of scope**: government ID number capture/storage, third-party identity-verification vendors (Persona/Onfido), SIN collection.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — minimum rider age**: 18 everywhere, or 19 in provinces where 19 is the age of majority (BC, NB, NL, NS, NT, NU, YT)? · **Proposed default**: 18 nationally, with a per-province override table seeded so BC/NS/NB/NL/NT/NU/YT require 19. · **Why**: contracting with a minor is unenforceable in provinces with a 19 age of majority.

> **DECISION REQUIRED — identity-verification depth**: is manual admin review of a licence photo sufficient for launch, or does the client require an automated IDV vendor (liveness + document authenticity)? · **Proposed default**: manual admin review in V1; IDV vendor integration is a V2 line item. · **Why**: manual review is launchable in days and the volume at launch is small enough for humans.

---

### D-04 — Vehicle registration record

- **SOW trace**: *"Register with document upload, age verification, licence, phone and vehicle documents."*
- **Behaviour**: `POST /api/v1/riders/:id/onboarding/vehicle {vehicle_type, make, model, year, colour, licence_plate}`. `vehicle_type` determines which documents are subsequently required (D-05) and which routing profile is used for ETA/distance (D-22/D-23).
- **Data**: `rider_vehicle(id, rider_id, vehicle_type, make, model, year, colour, licence_plate, is_active, created_at, updated_at)`
  - `vehicle_type ∈ {CAR, SCOOTER, MOTORCYCLE, BICYCLE, ON_FOOT}`
- **States**: `VEHICLE_PENDING → DOCUMENTS_PENDING` on success.
- **Rules**:
  - `CAR | SCOOTER | MOTORCYCLE` ⇒ `licence_plate` required, uppercase alphanumeric + space/hyphen, 2–8 chars, unique among active vehicles (`409 PLATE_IN_USE`); `year` 1990–current+1.
  - `BICYCLE | ON_FOOT` ⇒ plate/make/model/year must be absent (server rejects them rather than auto-filling `"N/A"`).
  - Exactly one `is_active` vehicle per rider. Changing vehicle type after activation sets `onboarding_state=DOCUMENTS_PENDING` and `account_status` stays ACTIVE but `availability_state` is forced `OFFLINE` until the new document set is approved.
  - Routing profile mapping: `CAR/SCOOTER/MOTORCYCLE → driving`, `BICYCLE → cycling`, `ON_FOOT → walking`.
- **Acceptance criteria**:
  1. Given `vehicle_type=BICYCLE` with a `licence_plate`, When submitted, Then `422 FIELD_NOT_APPLICABLE` naming `licence_plate`.
  2. Given `vehicle_type=CAR` without a plate, When submitted, Then `422 FIELD_REQUIRED`.
  3. Given an ACTIVE rider who switches CAR → BICYCLE, When the change is saved, Then availability becomes OFFLINE, onboarding_state becomes DOCUMENTS_PENDING, and a dispatch offer is not sent to them.
- **Out of scope**: multi-vehicle fleets, vehicle-level insurance policy parsing, VIN capture.
- **Version**: V1 · **Size**: S

---

### D-05 — Document upload (licence, vehicle registration, insurance, profile photo)

- **SOW trace**: *"Register with document upload… licence, phone and vehicle documents."* · *"Document Verification: Upload and submit legal documents for verification."* · *"Profile management: … Upload Documents"*
- **Behaviour**: Three-call presigned flow per document, all through the API (no hardcoded host):
  1. `POST /api/v1/riders/:id/documents/upload-url {document_type, file_name, content_type, size_bytes}` → `{document_id, upload_url, object_key, expires_at}` (MinIO presigned PUT, TTL 10 min).
  2. Client `PUT`s the bytes directly to `upload_url`.
  3. `POST /api/v1/riders/:id/documents/:document_id/confirm {expires_on?}` → server HEADs the object, verifies size + content-type + magic bytes, stores metadata, sets `status=UPLOADED`.
  Then `POST /api/v1/riders/:id/onboarding/documents` submits the complete set for review.
- **Data**: `rider_document(id, rider_id, document_type, object_key, bucket, file_name, content_type, size_bytes, sha256, expires_on, status, uploaded_at, reviewed_at, reviewed_by, rejection_code, rejection_note, superseded_by, version, created_at)`
  - `document_type ∈ {DRIVERS_LICENCE, VEHICLE_REGISTRATION, VEHICLE_INSURANCE, PROFILE_PHOTO, GOVERNMENT_ID}`
  - `status ∈ {PENDING_UPLOAD, UPLOADED, UNDER_REVIEW, APPROVED, REJECTED, EXPIRED, SUPERSEDED}`
- **States**: document lifecycle above; rider `DOCUMENTS_PENDING → DOCUMENTS_REVIEW` when a complete set is submitted.
- **Rules**:
  - **Required set by vehicle type**:
    | vehicle_type | required documents |
    |---|---|
    | CAR / SCOOTER / MOTORCYCLE | DRIVERS_LICENCE (+expiry), VEHICLE_REGISTRATION (+expiry), VEHICLE_INSURANCE (+expiry), PROFILE_PHOTO |
    | BICYCLE / ON_FOOT | GOVERNMENT_ID (+expiry), PROFILE_PHOTO |
  - Accepted MIME: `image/jpeg`, `image/png`, `image/heic`, `application/pdf`. Max 15 MB per file, max 20 pages for PDF. Anything else ⇒ `415 UNSUPPORTED_MEDIA_TYPE`. Magic-byte check must match the declared content-type (`422 CONTENT_TYPE_MISMATCH`).
  - `expires_on` required for every type except `PROFILE_PHOTO`; must be ≥ 30 days in the future at submission (`422 DOCUMENT_EXPIRES_TOO_SOON`).
  - Re-uploading a type marks the previous row `SUPERSEDED` and increments `version`; history is never deleted.
  - Objects live in a **private** bucket. Reads are only ever via a 5-minute presigned GET issued to the owning rider or to an admin/support principal, with an access-log row. No public URLs.
  - Submission is blocked with `422 DOCUMENTS_INCOMPLETE` and `details.missing[]` naming each missing type/expiry.
  - **Expiry enforcement**: a nightly job sets `status=EXPIRED` at `expires_on`. At `expires_on - 30d`, `-7d`, `-1d` the rider gets a push + inbox notice. On expiry the rider is forced `OFFLINE` and `account_status=SUSPENDED` with reason `DOCUMENT_EXPIRED` until a replacement is approved.
- **Acceptance criteria**:
  1. Given a `.exe` renamed to `.pdf`, When confirm is called, Then `422 CONTENT_TYPE_MISMATCH` and the object is deleted from MinIO.
  2. Given a CAR rider missing vehicle insurance, When they submit for review, Then `422 DOCUMENTS_INCOMPLETE` with `missing:["VEHICLE_INSURANCE"]`.
  3. Given an approved rider whose insurance `expires_on` is today, When the nightly job runs, Then availability becomes OFFLINE, account_status becomes SUSPENDED(DOCUMENT_EXPIRED), and the next dispatch wave excludes them.
  4. Given a document object key, When an unauthenticated client requests it directly from MinIO, Then the request is denied (403) — no object is publicly readable.
- **Out of scope**: OCR/auto-extraction of expiry dates, police/background checks, provincial licence-database lookups, Supabase storage (deleted).
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — background checks**: does HalalGoes require a criminal-record / driving-abstract check before a rider handles food and money? · **Proposed default**: not in V1; a `BACKGROUND_CHECK` document type and `background_check_status` column are provisioned but unused, so adding the vendor later is not a migration. · **Why**: the SOW does not mention it and it is a per-province legal question for the client's counsel.

---

### D-06 — Verification status tracking + notifications

- **SOW trace**: *"Track Registration Verification Status: Notifications: Get notifications on verification status · Support: Get support on verification rejections"*
- **Behaviour**: `GET /api/v1/riders/:id/onboarding/status` returns the whole review picture: `{state, progress_percent, next_step, next_route, is_complete, submitted_at, decided_at, documents:[{document_type, status, expires_on, rejection_code, rejection_note}], steps_completed:{phone_verified, profile, vehicle, documents_submitted, documents_approved, payout_onboarded}}`. The rider app **does not poll**: it renders from this endpoint on screen focus and updates live from the `verification.updated` WebSocket event plus a push notification for every decision.
- **Data**: `rider_verification_review(id, rider_id, submitted_at, decided_at, decided_by, decision, rejection_summary, sla_due_at)`; per-document decisions on `rider_document`.
- **States**: `DOCUMENTS_REVIEW → DOCUMENTS_APPROVED (→ PAYOUT_PENDING)` or `→ DOCUMENTS_REJECTED`. Partial approval is allowed: individual documents can be `APPROVED` while others are `REJECTED`; the rider-level decision is `REJECTED` if ≥1 required document is rejected.
- **Rules**:
  - Rejection uses a closed `rejection_code` taxonomy, each with rider-facing copy: `ILLEGIBLE`, `EXPIRED`, `WRONG_DOCUMENT_TYPE`, `NAME_MISMATCH`, `DOB_MISMATCH`, `PLATE_MISMATCH`, `SUSPECTED_ALTERATION`, `INCOMPLETE_PAGES`, `OTHER` (requires `rejection_note`). The **real** code and note are rendered — never a hardcoded example list.
  - A document can be approved only once its file has been virus-scanned clean ([presigned upload and download](01-platform.md#p-28--presigned-upload-and-download)); until then an approval is refused and the document stays under review.
  - Review SLA: `sla_due_at = submitted_at + 48h` (business hours America/Toronto). Breach raises an ops alert; the rider sees "under review" with the expected decision date.
  - Notifications fired: `verification.submitted`, `verification.approved`, `verification.rejected` (lists each failed document + reason), `verification.expiring` (30/7/1 days), `verification.expired`. Each is push + in-app inbox row + WS event.
  - Support access from the rejection screen: a deep link that pre-fills a support ticket with `rider_id`, `review_id`, and the rejection codes (D-34).
  - `progress_percent` is server-computed from `steps_completed`; the client never invents it.
- **Acceptance criteria**:
  1. Given a review where only the insurance is rejected, When the rider opens the status screen, Then the licence shows APPROVED, the insurance shows REJECTED with its actual `rejection_code` and note, and only the insurance has a re-upload button.
  2. Given a decision is recorded by an admin, When the rider's app is backgrounded, Then a push notification is delivered within 60 s and the inbox contains a matching row.
  3. Given a rider in DOCUMENTS_REVIEW, When they call `PUT /riders/:id/availability {is_online:true}`, Then `403 ONBOARDING_INCOMPLETE` with `details.next_step="AWAITING_REVIEW"`.
- **Out of scope**: admin-side review tooling (specified in the admin domain), automated document authenticity scoring.
- **Version**: V1 · **Size**: M

---

### D-07 — Re-verification request & document resubmission

- **SOW trace**: *"Request For Reverification: Request reverification, re upload documents"*
- **Behaviour**: From the rejection screen the rider re-uploads only the rejected document types (D-05 flow), then calls `POST /api/v1/riders/:id/onboarding/documents/resubmit`. This creates a new `rider_verification_review` row linked to the previous one and moves the rider back to `DOCUMENTS_REVIEW`. An ACTIVE rider may also proactively replace an expiring document without leaving ACTIVE, provided the current document has not yet expired.
- **Data**: `rider_verification_review.previous_review_id`, `attempt_number`.
- **States**: `DOCUMENTS_REJECTED → DOCUMENTS_PENDING → DOCUMENTS_REVIEW`.
- **Rules**:
  - Only documents with `status=REJECTED` or `EXPIRED` may be replaced during resubmission; re-uploading an APPROVED document is allowed but resets that document to `UNDER_REVIEW`.
  - Max **3** resubmission attempts per rider. On the 4th rejection the rider becomes `account_status=DEACTIVATED` with reason `VERIFICATION_EXHAUSTED`, and only support can reopen.
  - Cooldown: a resubmission may not be made more than once per 30 minutes (`429 RESUBMIT_TOO_SOON`) to stop upload-spam loops.
  - A resubmission with no changed documents is rejected `422 NOTHING_TO_RESUBMIT`.
  - An ACTIVE rider replacing a still-valid document keeps working; the new document only takes effect on approval, and rejection leaves the old (valid) document in force.
- **Acceptance criteria**:
  1. Given a rejected licence, When the rider re-uploads it and resubmits, Then `attempt_number=2`, state is `DOCUMENTS_REVIEW`, and the previously approved documents are not re-reviewed.
  2. Given `attempt_number=4` rejected, When the decision is recorded, Then `account_status=DEACTIVATED` reason `VERIFICATION_EXHAUSTED` and login returns `403 ACCOUNT_DEACTIVATED`.
  3. Given an ACTIVE rider who uploads a replacement insurance 20 days before expiry, When it is under review, Then they remain ONLINE-capable and continue receiving offers.
- **Out of scope**: appeals workflow with human dialogue thread (V2 — see D-34).
- **Version**: V1 · **Size**: M

---

### D-08 — Payout account onboarding (Stripe Connect)

- **SOW trace**: *"Earnings Support: Assist riders with payout related disputes/grievances."* (Support Agent) — the payout account is the precondition for every earnings feature in SOW Rider item 5.
- **Behaviour**: After `DOCUMENTS_APPROVED` the rider enters `PAYOUT_PENDING`. `POST /api/v1/riders/:id/payout-account` creates a **Stripe Connect Express** account (country `CA`, currency `cad`, capability `transfers`) and returns a single-use Account Link URL, opened in an in-app browser (`expo-web-browser`). Stripe redirects back to `halalgoes-rider://payout/return` or `…/refresh`. The server does **not** trust the redirect: account readiness is set only from the `account.updated` webhook when `payouts_enabled=true && charges_enabled` and `requirements.currently_due` is empty. On readiness, `onboarding_state → ACTIVE` and `account_status → ACTIVE`.
- **Data**: `rider_payout_account(id, rider_id, provider='STRIPE', provider_account_id, payouts_enabled, requirements_due jsonb, disabled_reason, default_external_account_last4, created_at, updated_at)`; `webhook_event(id, provider, provider_event_id UNIQUE, type, payload, processed_at)`.
- **States**: `PAYOUT_PENDING → ACTIVE` (readiness) · `ACTIVE → SUSPENDED(PAYOUT_ACCOUNT_RESTRICTED)` if Stripe later reports `payouts_enabled=false`.
- **Rules**:
  - `/stripe-onboarding` must exist as a real route (the shipped app 404'd here — riders literally could not finish signup).
  - Account Links expire; the client must request a fresh link each time rather than caching the URL.
  - Webhooks are signature-verified and deduplicated on `provider_event_id`; processing is idempotent.
  - A rider may not go ONLINE without `payouts_enabled=true` (`403 PAYOUT_ACCOUNT_INCOMPLETE`). Riders who become restricted mid-shift finish their active delivery and are then forced OFFLINE.
  - Earnings continue to accrue in the internal ledger while the account is restricted; only the transfer is blocked.
- **Acceptance criteria**:
  1. Given a rider who completes Stripe onboarding, When the `account.updated` webhook arrives with `payouts_enabled=true`, Then `onboarding_state=ACTIVE` and the rider can toggle online.
  2. Given a rider who returns to the app via the redirect but Stripe still lists `currently_due`, When they open the app, Then they see the outstanding requirements and cannot go online.
  3. Given the same Stripe event delivered twice, When both are processed, Then exactly one state change and one audit row exist.
- **Out of scope**: non-Stripe payout rails, Stripe Custom accounts, instant payouts (D-28 V2), tax-form generation (T4A).
- **Version**: V1 · **Size**: L

---

### D-09 — Profile management (personal info, photo, documents, settings)

- **SOW trace**: *"Profile management: Update Personal Information · Upload Documents · Manage Availability Settings"*
- **Behaviour**: `GET /api/v1/riders/me` renders the profile. `PATCH /api/v1/riders/:id` accepts `{first_name, last_name, email, timezone, locale, preferences}`. Phone and email changes route through OTP verification of the **new** value. Profile photo is uploaded via the D-05 document flow with `document_type=PROFILE_PHOTO` and is only shown to customers after admin approval. Every write hits the API — no "Success" alerts over local-only state.
- **Data**: `rider.preferences jsonb {push_offers:bool, push_earnings:bool, push_announcements:bool, sound_profile:'LOUD'|'DEFAULT', auto_go_offline_after_delivery:bool, preferred_zone_id:uuid|null}`.
- **States**: no state change, except a pending photo (`UNDER_REVIEW`) continues to display the previous approved photo.
- **Rules**:
  - `push_offers` cannot be disabled while `availability_state != OFFLINE` (`422 REQUIRED_WHILE_ONLINE`) — a rider who is online but muted is the top cause of stalled dispatch.
  - Optimistic concurrency via `If-Match: <etag>`; mismatch ⇒ `412 STALE_WRITE`.
  - PII fields are audit-logged (`who, when, old→new`) with old values hashed after 90 days.
  - `preferred_zone_id` is stored but has no dispatch effect in V1 (see D-13 out-of-scope).
- **Acceptance criteria**:
  1. Given an online rider, When they turn off offer notifications, Then `422 REQUIRED_WHILE_ONLINE` and the toggle reverts.
  2. Given a name change, When it is saved, Then a `GET /riders/me` on a second device returns the new name (i.e. it is server-persisted, not local).
  3. Given a new profile photo pending review, When a customer views the rider card, Then the previously approved photo is returned.
- **Out of scope**: rider-initiated account deletion (see decision below), referral programme, in-app document viewer for approved docs (V2).
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — account deletion & data retention**: app-store policy requires in-app account deletion; what is the retention period for a deleted rider's delivery, earnings and location records? · **Proposed default**: in-app deletion request → immediate `DEACTIVATED` + PII redaction after 30 days; financial records (earnings, payouts, invoices) retained 7 years per CRA rules; raw GPS traces retained 90 days then aggregated. · **Why**: PIPEDA requires a stated retention period and CRA requires 7 years for financial records — the two cannot use one rule.

---

### D-10 — Availability: online / offline

- **SOW trace**: *"Profile management: … Manage Availability Settings"* · *"Order Acceptance/Rejection: Option to accept or decline orders based on availability or preferences."*
- **Behaviour**: `PUT /api/v1/riders/:id/availability {is_online: bool, lat, lng, accuracy_m}` is the **only** way availability changes by rider action. The server sets `availability_state`, writes `coords`, and returns the authoritative `{availability_state, since, can_receive_offers, blocking_reasons[]}`. The client renders the returned state; it never sets availability locally (the shipped app called `setOnline(false)` client-only after accepting, permanently desynchronising client and server).
- **Data**: `rider.availability_state, availability_changed_at, coords, coords_updated_at`; `rider_availability_event(id, rider_id, from_state, to_state, reason, actor, occurred_at, lat, lng)` — an append-only log used for shift/online-time analytics.
- **States**: as §0.4. Triggers:
  | Transition | Trigger |
  |---|---|
  | `OFFLINE → ONLINE_IDLE` | rider toggles on, with a location fix ≤ 60 s old and accuracy ≤ 100 m |
  | `ONLINE_IDLE → ON_DELIVERY` | offer accepted (same DB transaction as the assignment, D-16) |
  | `ON_DELIVERY → ONLINE_IDLE` | assignment reaches `DELIVERED`, `RETURNED`, `CANCELLED_BY_PLATFORM`, or `REASSIGNED` |
  | `ON_DELIVERY → OFFLINE` | as above **and** `go_offline_after_delivery=true`, or the rider was suspended mid-delivery |
  | `ONLINE_IDLE → ONLINE_STALE` | `now - coords_updated_at > 120 s` (sweeper, every 15 s) |
  | `ONLINE_STALE → ONLINE_IDLE` | any location update |
  | `* → OFFLINE` | rider toggles off, admin suspension, document expiry, payout restriction, 12 h continuous online cap |
- **Rules**:
  - Going online requires: `onboarding_state=ACTIVE`, `account_status=ACTIVE`, `payouts_enabled=true`, foreground **and** background location permission granted, notification permission granted, a fresh fix. Each unmet condition appears in `blocking_reasons[]` with a machine code so the app can deep-link to the fix.
  - Going offline while `ON_DELIVERY` ⇒ `409 ACTIVE_DELIVERY_IN_PROGRESS`; the response includes `{"suggestion":"SET_GO_OFFLINE_AFTER_DELIVERY"}`.
  - **Restoration is server-owned and guaranteed.** A reconciliation job runs every 60 s: any rider in `ON_DELIVERY` with no assignment in a non-terminal state is returned to `ONLINE_IDLE`/`OFFLINE` and an anomaly is logged. (In the old system availability was never restored — this job is the backstop, not the mechanism.)
  - Continuous-online cap: 12 h. At 11 h the rider is warned; at 12 h they are forced OFFLINE and must wait 8 h before going online again. Active deliveries always complete first.
  - Auto-offline for unresponsiveness: 3 consecutive `EXPIRED` offers (no interaction at all) ⇒ forced `OFFLINE` with reason `UNRESPONSIVE`, push explaining why. Explicit rejections do not count.
- **Acceptance criteria**:
  1. Given a rider without background location permission, When they toggle online, Then `422 CANNOT_GO_ONLINE` with `blocking_reasons:["BACKGROUND_LOCATION_PERMISSION"]` and the state stays OFFLINE.
  2. Given a rider who accepts an offer, When the accept succeeds, Then a second `GET /riders/me` from another client shows `availability_state=ON_DELIVERY` (no client-only mutation).
  3. Given a delivery marked DELIVERED, When the transition commits, Then within the same transaction `availability_state` becomes `ONLINE_IDLE` and the rider is eligible for the very next dispatch wave.
  4. Given a rider whose app dies while ON_DELIVERY and whose assignment is later cancelled by ops, When the reconciliation job runs, Then availability is no longer `ON_DELIVERY`.
  5. Given three consecutive expired offers, When the third expires, Then availability becomes OFFLINE with reason `UNRESPONSIVE` and a push explains it.
- **Out of scope**: shift booking / slot scheduling (V3), zone-locked availability, "pause for 15 min" (V2).
- **Version**: V1 · **Size**: M

---

### D-11 — Foreground location streaming (idle)

- **SOW trace**: *"Distance Tracking: Track distance traveled for accurate payment calculations."* · *"Real-Time Navigation…"* (dispatch and customer tracking both depend on position)
- **Behaviour**: While `ONLINE_IDLE`, the app reports position on the greater of every `15 s` or `100 m` at Balanced accuracy, batched: `POST /api/v1/riders/:id/locations {points:[{lat,lng,accuracy_m,heading,speed_mps,recorded_at,source}]}` with up to 20 points. The server updates `rider.coords`/`coords_updated_at` from the newest point and appends all points to the trace table.
- **Data**: `rider_location_point(id, rider_id, assignment_id NULL, geog, accuracy_m, heading_deg, speed_mps, recorded_at, received_at, source)` — partitioned monthly, `assignment_id NULL` rows pruned after 30 days.
- **States**: drives `ONLINE_IDLE ⇄ ONLINE_STALE` (D-10).
- **Rules**:
  - Points with `accuracy_m > 200` are stored but excluded from `rider.coords` updates and from dispatch eligibility.
  - Points with `recorded_at` more than 5 min old or in the future are rejected (`422 STALE_POINT`) and dropped, not clamped.
  - Requests are batched to bound battery/data: at most one HTTP request per 15 s while idle.
  - No location is collected while `OFFLINE`. Toggling offline cancels the location task within 5 s. This must be provable in a test — it is both a battery and a privacy commitment.
  - `rider.coords` writes must not be lost to stale closures: the location task reads `rider_id`/`assignment_id` from a store snapshot at emit time, not at subscribe time.
- **Acceptance criteria**:
  1. Given an idle online rider, When 60 s pass, Then between 1 and 4 HTTP requests are made (not one per fix).
  2. Given the rider toggles offline, When 10 s pass, Then no further location request is made and no OS location indicator remains active.
  3. Given a point with `accuracy_m=500`, When it is posted, Then `rider.coords` is unchanged and the rider is not returned by a dispatch query relying on freshness.
- **Out of scope**: geofence-triggered wake, motion-activity classification.
- **Version**: V1 · **Size**: M

---

### D-12 — Background location during an active delivery

- **SOW trace**: *"Order Status Updates… in real-time"* · *"Distance Tracking: Track distance traveled for accurate payment calculations."*
- **Behaviour**: On entering `ON_DELIVERY` the app starts a **background** location task (`expo-location` `startLocationUpdatesAsync` + `expo-task-manager`): Android — a **foreground service** with a persistent notification ("Delivery in progress — HalalGoes"), `foregroundService.killServiceOnDestroy=false`; iOS — `allowsBackgroundLocationUpdates=true`, `pausesUpdatesAutomatically=false`, `activityType=AutomotiveNavigation`, requires **Always** authorization. Cadence: every `5 s` or `25 m`, High accuracy. Points are queued locally (SQLite/AsyncStorage ring buffer) and flushed every 10 s in batches of ≤ 20; on network failure the buffer holds up to **500 points or 30 minutes**, whichever is smaller, and flushes on reconnect. The task stops when the assignment reaches a terminal state.
- **Data**: as D-11 with `assignment_id` set; `assignment.last_location_at`; `rider_device(id, rider_id, platform, os_version, app_version, push_token, background_permission_status, battery_optimisation_exempt, last_seen_at)`.
- **States**: introduces `assignment.tracking_health ∈ {HEALTHY, DEGRADED, LOST}` — `HEALTHY` < 60 s since last point, `DEGRADED` 60–300 s, `LOST` > 300 s.
- **Rules**:
  - **App killed mid-delivery**: Android's foreground service survives task-swipe and is restarted by the OS; on cold start the app reads `GET /riders/me.active_assignment_id` and resumes the task and the delivery screen. iOS relaunches the app in the background for location events; if the user force-quits, iOS will not relaunch for standard updates — the fallback is (a) `tracking_health=LOST`, (b) a high-priority push every 60 s asking the rider to reopen the app, (c) at 5 min an ops alert and the customer's ETA is marked "updating", (d) **the assignment is never auto-reassigned on tracking loss alone** — only ops can reassign, because a reassignment while the rider is actually delivering causes a double delivery.
  - Battery policy: cadence degrades to 15 s / 100 m when device battery < 15 % and the app surfaces "power saving — tracking less often". Android riders are prompted once to exempt the app from battery optimisation; refusal is recorded on `rider_device` and shown to ops when tracking is chronically LOST.
  - Buffered points keep their original `recorded_at`; the server accepts backfilled points for an assignment for up to 2 h after its terminal state, for distance reconciliation.
  - Location points are only ever exposed to the customer as the rider's **current** position while the assignment is active, at a maximum of one update per 5 s, and never after `DELIVERED`.
- **Acceptance criteria**:
  1. Given an Android rider with the app swiped away during `EN_ROUTE_TO_DROPOFF`, When 2 minutes pass, Then the server has received continuous points and `tracking_health=HEALTHY`.
  2. Given a rider in a tunnel with no network for 4 minutes, When connectivity returns, Then all buffered points are accepted with their original timestamps and the billable distance is unchanged versus a rider with continuous connectivity over the same route.
  3. Given an iOS rider who force-quits the app, When 5 minutes pass, Then `tracking_health=LOST`, an ops alert exists, the rider has received ≥ 4 push prompts, and no reassignment has occurred.
  4. Given an assignment reaching DELIVERED, When 30 s pass, Then the background task is stopped and the OS shows no persistent location notification.
- **Out of scope**: always-on background tracking while idle (explicitly rejected — privacy and battery), driver-behaviour telemetry (harsh braking, speed scoring).
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — tracking-loss reassignment**: after how long without location on an active delivery may ops reassign the order, and does the original rider still earn anything? · **Proposed default**: ops may reassign after 10 min of `LOST` **and** a failed phone contact attempt; the original rider is paid the cancellation compensation (`earn.cancel_compensation_cents`) if they had already reached `ARRIVED_AT_PICKUP`, nothing otherwise. · **Why**: reassigning too eagerly duplicates deliveries; never reassigning strands the customer.

---

### D-13 — Dispatch: candidate selection, ranking and offer waves

- **SOW trace**: *"Order Dashboard: View available order with details like pickup location, drop-off location, customer name, and order items."* · *"Order Alerts: Push notifications for new orders…"*
- **Behaviour**: When an order reaches `READY_FOR_DISPATCH` (restaurant accepted and prep is underway), the dispatch module runs a **batched-sequential** algorithm. Terminology: a *wave* is a set of riders offered the same order at the same time.

  **Step 1 — candidate query** (single Postgres query, no Redis):
  ```sql
  SELECT r.id,
         ST_Distance(r.coords, $pickup) AS pickup_distance_m
  FROM rider r
  JOIN rider_payout_account p ON p.rider_id = r.id AND p.payouts_enabled
  WHERE r.onboarding_state = 'ACTIVE'
    AND r.account_status   = 'ACTIVE'
    AND r.availability_state = 'ONLINE_IDLE'
    AND r.coords_updated_at > now() - interval '90 seconds'
    AND ST_DWithin(r.coords, $pickup, $radius_m)
    AND NOT EXISTS (SELECT 1 FROM offer o
                     WHERE o.rider_id = r.id AND o.order_id = $order_id
                       AND o.state IN ('REJECTED','EXPIRED'))
    AND NOT EXISTS (SELECT 1 FROM offer o
                     WHERE o.rider_id = r.id AND o.state = 'PENDING')
  ORDER BY score DESC
  LIMIT 50
  FOR UPDATE SKIP LOCKED;   -- on the offer insert, not the select
  ```
  **Step 2 — ranking score** (deterministic, computed in Go, logged per candidate for replay):
  ```
  score = 1000
        - 0.100 × eta_to_pickup_seconds        // dominant term
        + 0.050 × min(idle_seconds, 1800)      // fairness: longest-waiting rider first
        + 2.000 × acceptance_rate_30d_percent  // reliability
        + 1.000 × completion_rate_30d_percent
        + 50    × (rating_avg - 4.0)           // quality, ±
        - 200   × recent_offer_penalty         // 1 if offered anything in the last 60s
  ```
  `eta_to_pickup_seconds` comes from the routing provider's matrix API for the rider's vehicle profile, falling back to `haversine_m / profile_speed_mps × 1.35` when the provider errors or exceeds 800 ms.

  **Step 3 — waves**: offer to the top `wave_size=3` candidates **simultaneously**, each with an identical `expires_at = now + 30 s`. When the wave resolves (someone accepts, or all 3 reject/expire), wait `inter_wave_gap_seconds=2` and offer the next 3. Riders who rejected or let an offer expire are excluded from all later waves **for that order**. After the candidate list at radius `r` is exhausted, widen to the next radius in `[3000, 6000, 10000]` and rebuild the candidate list. Hard stop at `max_waves=5` or `max_total_seconds=300`, whichever comes first → D-15.

  **Rationale for batched-sequential (3 at a time) over broadcast-to-all**: broadcast maximises fill speed but guarantees that N−1 riders lose a race and learn to ignore offers; pure sequential is fair but adds 30 s of latency per declining rider. Three is small enough that a loss is rare and large enough that one non-responder does not stall the order.

- **Data**:
  - `dispatch_run(id, order_id, state, started_at, ended_at, wave_count, final_outcome, config_snapshot jsonb)`
  - `dispatch_wave(id, dispatch_run_id, wave_number, radius_m, offered_at, expires_at, candidate_snapshot jsonb)`
  - `offer(id, dispatch_run_id, wave_id, order_id, rider_id, state, offered_at, expires_at, responded_at, response_reason_code, delivered_to_device_at, seen_at, pickup_distance_m, eta_to_pickup_seconds, estimated_earnings_cents, surge_multiplier, score, rank_in_wave)` — `UNIQUE(order_id, rider_id)`, partial unique index `UNIQUE(rider_id) WHERE state='PENDING'`.
- **States**: `dispatch_run.state ∈ {SEARCHING, ASSIGNED, NO_RIDER_FOUND, ESCALATED_TO_OPS, CANCELLED}`.
- **Rules**:
  - **A rider is offered at most one order at a time**, enforced by the partial unique index on `offer(rider_id) WHERE state='PENDING'` and by the `availability_state='ONLINE_IDLE'` filter. A rider `ON_DELIVERY` is structurally un-offerable in V1. (The old system had neither guard; double-assignment was inevitable.)
  - A rider appears in at most one wave per order.
  - `estimated_earnings_cents` shown on the offer is computed with the same formula as D-26 using the *routed* pickup→dropoff distance, and the **surge multiplier is frozen onto the offer row**. If the rider accepts, that frozen multiplier is what pays out, even if surge drops before delivery.
  - Every candidate list and score is persisted in `candidate_snapshot` so any "why didn't I get that order" dispute is answerable.
  - Dispatch never runs before the restaurant accepts the order; the customer is never charged for a delivery that has no dispatch attempt.
  - Config values are snapshotted onto `dispatch_run` so a config change mid-run cannot alter an in-flight run.
- **Acceptance criteria**:
  1. Given 10 eligible riders within 3 km, When dispatch starts, Then exactly 3 offers exist with the same `expires_at`, ranked by score, and rider #4 has no offer row.
  2. Given a rider whose last location was 100 s ago, When the candidate query runs, Then that rider is not a candidate.
  3. Given a rider with a `PENDING` offer for order A, When dispatch for order B selects candidates, Then that rider is excluded, and attempting to insert a second PENDING offer violates the unique index.
  4. Given all 3 riders in wave 1 reject, When 2 s elapse, Then wave 2 offers the next 3 by score and none of wave 1's riders appear.
  5. Given zero candidates at 3 km, When the wave completes, Then the next wave uses radius 6 km and the run's `wave_number` increments.
- **Out of scope**: order batching/stacking (V3), rider-preferred zones, restaurant-preferred riders, machine-learned ranking, cherry-pick prevention beyond the acceptance-rate term.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — dispatch shape**: batched-sequential (3 riders × 30 s waves) vs broadcast-to-all-nearby vs strict one-at-a-time? · **Proposed default**: batched-sequential, wave size 3, 30 s TTL, 5 waves max, radius ladder 3/6/10 km. · **Why**: bounded loss rate for riders and bounded latency for customers; both parameters are config, so the client can retune after launch without a deploy.

> **DECISION REQUIRED — ranking weights**: is fastest-to-pickup the right primary objective, or should earnings fairness (lowest-earning rider first) dominate? · **Proposed default**: ETA-dominant with an idle-time fairness term as specified. · **Why**: customer ETA is the promise being sold; fairness is handled by the idle-time bonus rather than by inverting the objective.

---

### D-14 — Receiving an offer on the device

- **SOW trace**: *"Order Dashboard: View available order with details like pickup location, drop-off location, customer name, and order items."* · *"Order Alerts: Push notifications for new orders"*
- **Behaviour**: An offer is delivered by **three parallel paths**, all carrying the same `offer_id` and server `expires_at`: (1) high-priority data push (FCM `priority=high`, APNs `apns-priority=10`, `content-available=1`, with a critical-alert-style sound and a 30 s time-sensitive interruption level on iOS); (2) the WebSocket `offer.created` event; (3) the pull endpoint `GET /api/v1/riders/:id/offers/current` which the app calls on foreground, on socket connect and on push receipt. The UI shows a full-screen, non-dismissible offer sheet with a countdown derived from the **server** `expires_at` minus measured clock skew — never a local constant.
- **Data**: `offer.delivered_to_device_at`, `offer.seen_at` (set by `POST /offers/:id/seen`); `push_delivery(id, offer_id, rider_id, channel, provider_message_id, sent_at, delivered_at, error)`.
- **States**: `offer.state` stays `PENDING`; delivery telemetry only.
- **Rules**:
  - The offer sheet displays exactly: pickup restaurant name + address + distance to pickup, drop-off area (street + neighbourhood; **full unit number and customer phone are withheld until accept**), item count and total weight class, estimated total trip distance and duration, `estimated_earnings_cents` broken into base/distance/surge/tip-so-far, and the countdown.
  - The sheet **never auto-dismisses before `expires_at`**. At `expires_at` it closes and shows "Offer expired" for 3 s. (The shipped app dismissed at 7 s against a 5-minute server window — riders lost jobs they intended to take.)
  - If clock skew between device and server exceeds 5 s, the countdown uses `server_now` from the response plus monotonic elapsed time.
  - Duplicate deliveries of the same `offer_id` across paths must render one sheet (dedupe on `offer_id`).
  - If the app receives an offer whose `expires_at` is already past (late push), it must not render a sheet; it silently calls `GET /offers/current`.
  - Sound/vibration must play even in silent mode when the rider is `ONLINE_IDLE` (Android channel with `IMPORTANCE_HIGH` + bypass DND opt-in; iOS time-sensitive).
- **Acceptance criteria**:
  1. Given a killed app on Android and iOS, When an offer is created, Then a high-priority push wakes the app and the offer sheet is visible within 5 s of `offered_at`.
  2. Given the same offer arrives by push and by WebSocket, When both are processed, Then exactly one sheet is shown.
  3. Given a server `expires_at` 30 s out and a device clock 10 minutes fast, When the sheet renders, Then the countdown starts at ~30 s, not a negative or 10-minute value.
  4. Given a rider taps nothing, When the countdown reaches zero, Then the sheet closes at `expires_at` ± 1 s and the server independently marks the offer EXPIRED.
- **Out of scope**: offer preview for offline riders, "next order" pre-notification, offer sound customisation beyond the two profiles.
- **Version**: V1 · **Size**: M

---

### D-15 — Offer expiry, wave escalation, and the no-rider-found path

- **SOW trace**: *"Order Acceptance/Rejection: Option to accept or decline orders based on availability or preferences."* (the failure side of it) · *"Order Alerts: … order updates"*
- **Behaviour**: Expiry is **server-authoritative**. A durable timer (Postgres `expires_at` + a 1 s sweeper on a single leader, plus an in-process timer for latency) transitions `PENDING → EXPIRED` at `expires_at`. When every offer in a wave is resolved non-positively, the run advances to the next wave (D-13). When waves, radii and `max_total_seconds` are all exhausted:
  1. `dispatch_run.state = ESCALATED_TO_OPS`; the order enters an ops **manual dispatch queue** with a countdown of `ops_queue_seconds = 600`.
  2. The customer is notified: "We're still finding a delivery partner — you'll be updated in 10 minutes; you can cancel for a full refund now."
  3. Ops can manually assign any ACTIVE rider (bypassing radius) or extend the window once.
  4. If the window expires unassigned: order → `CANCELLED_NO_RIDER`, and a **real refund** is issued through the payment module (full order total, including delivery fee and tip), with a `refund` record, a customer notification, and a goodwill credit. The restaurant is notified to stop preparation; if food was already prepared, the restaurant is compensated per the restaurant domain's spec.
- **Data**: `dispatch_run.final_outcome ∈ {ASSIGNED, CANCELLED_NO_RIDER, CANCELLED_BY_CUSTOMER, CANCELLED_BY_RESTAURANT}`; `ops_dispatch_queue_item(id, order_id, dispatch_run_id, enqueued_at, deadline_at, claimed_by, resolved_at, resolution)`.
- **States**: `offer: PENDING → EXPIRED` · `dispatch_run: SEARCHING → ESCALATED_TO_OPS → ASSIGNED | CANCELLED_NO_RIDER`.
- **Rules**:
  - **A refund is a refund**, not a `TODO` log line. The cancel-and-refund path must call the payment provider, persist a `refund` row with the provider reference, and be covered by an integration test against the provider's test mode. Failure to refund raises a P1 alert and enters a retry queue with exponential backoff; it is never swallowed.
  - Expiry never cancels the order by itself — only the exhaustion of the whole run plus the ops window does.
  - A single rejection does **not** end the run (the old system let one rider's reject cancel and refund the entire order while 14 other riders held live offers). Only exhaustion or an explicit ops/customer/restaurant cancellation ends it.
  - When the run ends for any reason, all still-`PENDING` offers are immediately `WITHDRAWN` and an `offer.withdrawn` event + silent push closes the sheet on every device with reason (`TAKEN_BY_ANOTHER_RIDER`, `ORDER_CANCELLED`, `RUN_ENDED`).
  - Every state change of a run emits a customer-facing order event so the customer app never sits on a spinner with no information.
- **Acceptance criteria**:
  1. Given an offer with `expires_at` in the past and a rider who calls accept 200 ms late, When accept is processed, Then `409 OFFER_EXPIRED` and no assignment is created.
  2. Given 5 waves across all three radii with no acceptance, When the last wave expires, Then the run is `ESCALATED_TO_OPS`, an ops queue item exists with a 10-minute deadline, and the customer has received a notification.
  3. Given an escalated order that ops does not resolve, When the deadline passes, Then the order is `CANCELLED_NO_RIDER`, a `refund` row exists with a provider reference, and the customer's payment method is credited in the provider's test dashboard.
  4. Given rider A accepts, When the run ends, Then riders B and C receive `offer.withdrawn` with reason `TAKEN_BY_ANOTHER_RIDER` within 2 s and their sheets close automatically.
  5. Given one rider rejects in wave 1, When 1 s passes, Then the order is still `SEARCHING` and the other two offers remain PENDING.
- **Out of scope**: dynamic incentive injection ("+$3 to take this order") on later waves — see decision.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — offer TTL and escalation window**: 30 s per offer, 5 waves, 300 s total, then 600 s of ops time before cancel-and-refund — are these acceptable to the business? · **Proposed default**: as specified (worst case ~15 min from dispatch start to refund). · **Why**: 30 s is the industry norm for a decision made while driving; anything shorter causes accidental expiries, anything longer strands the customer.

> **DECISION REQUIRED — late-wave incentives**: should the platform add a bonus to the offer on waves 4–5 to improve fill rate? · **Proposed default**: not in V1; the field `offer.incentive_cents` exists and is always 0. · **Why**: an incentive engine needs a budget owner and abuse controls that do not exist yet.

---

### D-16 — Accepting an offer (single-winner concurrency)

- **SOW trace**: *"Order Acceptance/Rejection: Option to accept or decline orders based on availability or preferences."*
- **Behaviour**: `POST /api/v1/riders/:id/offers/:offer_id/accept` with `Idempotency-Key`. The server executes one serialisable transaction:
  ```sql
  BEGIN;
    UPDATE "offer" SET state='ACCEPTED', responded_at=now()
     WHERE id=$offer AND rider_id=$rider AND state='PENDING' AND expires_at > now();
    -- 0 rows ⇒ ROLLBACK, decide 409 code from the current row state

    UPDATE "order" SET rider_id=$rider, status='RIDER_ASSIGNED'
     WHERE id=$order AND rider_id IS NULL AND status='AWAITING_RIDER';
    -- 0 rows ⇒ ROLLBACK ⇒ 409 OFFER_ALREADY_TAKEN

    UPDATE rider SET availability_state='ON_DELIVERY', availability_changed_at=now()
     WHERE id=$rider AND availability_state='ONLINE_IDLE';
    -- 0 rows ⇒ ROLLBACK ⇒ 409 RIDER_NOT_AVAILABLE

    INSERT INTO assignment (...) VALUES (... state 'ASSIGNED' ...);
    UPDATE "offer" SET state='WITHDRAWN' WHERE order_id=$order AND state='PENDING';
  COMMIT;
  ```
  The **conditional UPDATE on `order` is the sole arbiter** of simultaneous accepts: exactly one transaction sees `rider_id IS NULL` and commits; every other accept gets 0 rows and returns `409 OFFER_ALREADY_TAKEN`. There is no Redis lock, no Temporal signal, and no dependency on a 30-minute-TTL Redis key that, when missing, made accept impossible (`order_rider_checkout_mapping`). The response returns the full assignment payload including the now-unmasked customer address, unit, phone alias and delivery instructions.
- **Data**: `assignment(id, order_id, rider_id, offer_id, state, assigned_at, en_route_pickup_at, arrived_pickup_at, picked_up_at, en_route_dropoff_at, arrived_dropoff_at, delivered_at, terminal_at, terminal_reason, pod_method, pod_photo_document_id, pod_otp_verified_at, handover_method, tracking_health, last_location_at, billable_distance_m, pickup_wait_seconds, created_at, updated_at)`
- **States**: `offer PENDING → ACCEPTED`; `assignment (none) → ASSIGNED`; `rider ONLINE_IDLE → ON_DELIVERY`; `order AWAITING_RIDER → RIDER_ASSIGNED`. All in one transaction.
- **Rules**:
  - Accepting **always** changes availability to `ON_DELIVERY` in the same transaction (not a client-side toggle, not a separate call). The rider stops being dispatchable at the instant of accept.
  - Distinct 409 codes so the app can say the right thing: `OFFER_EXPIRED`, `OFFER_ALREADY_TAKEN`, `OFFER_WITHDRAWN`, `ORDER_CANCELLED`, `RIDER_NOT_AVAILABLE`.
  - Idempotent: a retry with the same `Idempotency-Key` returns the original 200 and does not create a second assignment.
  - On success the server emits: `assignment.updated` to the rider, `order_update(RIDER_ASSIGNED)` to the customer and restaurant, `offer.withdrawn` to the losing riders, and a push to each.
  - Accept must succeed in < 500 ms p95; the transaction touches four rows and must not call any external service inline (routing, push and notifications are queued after commit via the transactional outbox).
  - `POST /offers/:id/accept` is the only path that assigns a rider. Ops manual assignment (D-15) uses the same service function with `actor=OPS`.
- **Acceptance criteria**:
  1. Given three riders holding PENDING offers for one order, When all three POST accept within 50 ms of each other, Then exactly one returns 200 with an assignment and the other two return `409 OFFER_ALREADY_TAKEN`; the order has exactly one `rider_id`. (Load test: 500 concurrent triples, zero double assignments.)
  2. Given a successful accept, When the transaction commits, Then `rider.availability_state='ON_DELIVERY'` and a dispatch run for another order started 1 ms later does not include that rider.
  3. Given a network timeout after the server committed, When the client retries with the same Idempotency-Key, Then it receives the same assignment and no duplicate row exists.
  4. Given Redis is entirely down, When a rider accepts, Then accept still succeeds (Postgres is the only correctness-critical store on this path).
- **Out of scope**: accepting while on another delivery (V3 batching), scheduled/pre-booked orders.
- **Version**: V1 · **Size**: L

---

### D-17 — Rejecting or ignoring an offer

- **SOW trace**: *"Order Acceptance/Rejection: Option to accept or decline orders based on availability or preferences."*
- **Behaviour**: `POST /api/v1/riders/:id/offers/:offer_id/reject {reason_code, note?}` moves the offer to `REJECTED` and immediately frees the wave slot; if all offers in the wave are resolved the next wave starts without waiting for the TTL. Ignoring (no interaction) results in `EXPIRED` at the TTL. The app requires a `reason_code` chosen from a list — no more hardcoded `'Rider declined'`.
- **Data**: `offer.response_reason_code, response_note`; taxonomy:
  `TOO_FAR_PICKUP, TOO_FAR_DROPOFF, EARNINGS_TOO_LOW, VEHICLE_UNSUITABLE, RESTAURANT_TOO_SLOW, ENDING_SHIFT, PERSONAL_BREAK, SAFETY_CONCERN, ORDER_TOO_LARGE, OTHER` (`OTHER` requires a note of 5–200 chars).
- **States**: `offer PENDING → REJECTED`.
- **Rules**:
  - Rejecting does not change `availability_state`; the rider stays `ONLINE_IDLE` and is eligible for the next order (but not for another wave of the same order).
  - Rejecting after `expires_at` returns `409 OFFER_EXPIRED` (harmless; treated as a no-op by the UI).
  - Metrics distinguish `REJECTED` (explicit, counted in acceptance rate) from `EXPIRED` (ignored, counted in both acceptance rate and the unresponsiveness counter of D-10).
  - No punitive action in V1 beyond the 3-consecutive-expiry auto-offline; acceptance rate feeds the dispatch score only.
  - Reason codes are aggregated for ops: e.g. a spike of `RESTAURANT_TOO_SLOW` for one restaurant is an operational signal, surfaced in the admin domain.
- **Acceptance criteria**:
  1. Given a reject without `reason_code`, When submitted, Then `422 FIELD_REQUIRED` and the offer remains PENDING.
  2. Given all three riders in a wave reject at t+4 s, When t+6 s arrives, Then wave 2 has already been offered (the run did not wait for the 30 s TTL).
  3. Given a rider who rejects, When a different order dispatches 1 s later, Then that rider is a valid candidate.
- **Out of scope**: acceptance-rate-based deactivation, rejection penalties, "why am I not getting orders" coaching screen (V2).
- **Version**: V1 · **Size**: S

---

### D-18 — Order dashboard (active work + resume)

- **SOW trace**: *"Order Dashboard: View available order with details like pickup location, drop-off location, customer name, and order items."*
- **Behaviour**: The home screen shows one of three server-determined modes from `GET /api/v1/riders/me/dashboard`: **OFFLINE** (today's earnings, go-online button, blocking reasons), **ONLINE_IDLE** (map with own position, "waiting for offers", today's earnings + trips, current surge zone if any), **ON_DELIVERY** (a persistent card that deep-links straight into the active assignment screen at the correct step). There is no list of "available orders" to browse — dispatch is push-based, and a browsable pool would break the single-winner guarantee.
- **Data**: response `{mode, rider:{...}, today:{earnings_cents, trips, online_seconds}, active_assignment:{...}|null, current_offer:{...}|null, announcements:[...]}`.
- **States**: mirrors `rider.availability_state`.
- **Rules**:
  - The dashboard is the **only** recovery path after an app crash: it always returns `active_assignment` if one exists, with `assignment.state`, so the app can restore the exact screen. The rider must never be able to reach home while an assignment is live without a visible resume affordance.
  - The dashboard is cheap and cached 5 s server-side; live changes arrive over the socket.
  - Earnings shown here come from the server ledger (D-26). The client never adds numbers.
  - If `mode=ON_DELIVERY` and `tracking_health != HEALTHY`, a banner tells the rider tracking is not reporting, with a one-tap fix (permissions/battery settings deep link).
- **Acceptance criteria**:
  1. Given a rider with an assignment in `PICKED_UP`, When they force-quit and reopen the app, Then within one API call they land on the in-transit screen with the correct order, not on the map.
  2. Given an offline rider, When they open the app, Then `today.earnings_cents` matches the sum of ledger entries for the local day in the rider's timezone.
  3. Given no active assignment and no offer, When the dashboard loads, Then `active_assignment` and `current_offer` are both null and the UI shows the waiting state.
- **Out of scope**: an open marketplace/order board, historical list on the home screen (that is D-30).
- **Version**: V1 · **Size**: M

---

### D-19 — Order details

- **SOW trace**: *"Order Details: View detailed information about the order, including special instructions from the customer."*
- **Behaviour**: `GET /api/v1/riders/:id/assignments/:assignment_id` returns the full working view: restaurant (name, address, phone alias, pickup notes, prep status), customer (first name + last initial, masked phone alias, address with unit, buzzer, delivery instructions, drop-off photo requirement), items (name, quantity, variant, add-ons, per-item notes — **no prices**), order totals limited to `item_count` and `payment_status=PREPAID`, earnings estimate breakdown, and the required proof-of-delivery method.
- **Data**: assignment + order projection; `order.delivery_instructions ∈ {LEAVE_AT_DOOR, MEET_AT_DOOR, MEET_IN_LOBBY, DO_NOT_RING_BELL, CALL_ON_ARRIVAL}` (a single closed enum shared by customer app, API and rider app — the shipped system had three different vocabularies), plus `order.special_instructions` free text ≤ 280 chars.
- **States**: none; read model. Field visibility is state-dependent (below).
- **Rules**:
  - **Progressive disclosure**: before accept, drop-off is street + neighbourhood only and no phone alias. After accept, the full address, unit and phone alias are visible. After the assignment reaches a terminal state, the customer's address is redacted from the rider's history to street level and the phone alias is deactivated within 30 minutes.
  - Item **prices and order totals are never shown to the rider** (prepaid orders; the rider has no reason to know the basket value and it invites disputes). Currency is `CAD` and formatted `$` everywhere — one currency, no screen showing `₹`.
  - Special instructions are displayed verbatim, never truncated silently; long text scrolls.
  - Allergen and halal notes present on an item are shown as chips so the rider does not swap bags.
- **Acceptance criteria**:
  1. Given an offer sheet (pre-accept), When rendered, Then the response contains no unit number and no phone alias for the customer.
  2. Given an accepted assignment, When the details load, Then the full address, buzzer code, phone alias and instruction enum are present and the instruction enum is one of the five canonical values.
  3. Given a delivered assignment 31 minutes later, When the rider opens it from history, Then the address is street-level only and calling the alias returns "this number is no longer available".
- **Out of scope**: editing order contents, viewing customer order history, item price visibility.
- **Version**: V1 · **Size**: M

---

### D-20 — Delivery status updates (arrived / picked up / in transit / delivered)

- **SOW trace**: *"Order Status Updates: Update order status (eg., picked up, in transit, delivered) in real-time."*
- **Behaviour**: One endpoint, `POST /api/v1/riders/:id/assignments/:assignment_id/transitions {to_state, lat, lng, accuracy_m, occurred_at, evidence?}` with `Idempotency-Key`. The server validates the transition against the machine in §0.4, validates geofence/evidence preconditions, persists the timestamp, emits events to the customer/restaurant, and returns the new assignment. **No timer in the app may advance a state** — the demo `setInterval`/`setTimeout` "arrivals" are deleted.
- **Data**: `assignment_transition(id, assignment_id, from_state, to_state, occurred_at, recorded_at, lat, lng, accuracy_m, geofence_ok, override_reason, actor)`.
- **States / triggers**:
  | To state | Trigger | Precondition |
  |---|---|---|
  | `EN_ROUTE_TO_PICKUP` | automatic on accept, or first movement | — |
  | `ARRIVED_AT_PICKUP` | rider taps "I'm at the restaurant" | within `geo.arrival_radius_m` (150 m) of the restaurant, or manual override with reason |
  | `PICKED_UP` | rider taps "Picked up" after confirming the bag checklist | state = `ARRIVED_AT_PICKUP`; restaurant order status is `READY_FOR_PICKUP` **or** rider supplies `override_reason` |
  | `EN_ROUTE_TO_DROPOFF` | automatic on `PICKED_UP` commit | — |
  | `ARRIVED_AT_DROPOFF` | rider taps "I'm here" | within 150 m of the drop-off, or override with reason |
  | `DELIVERED` | rider completes proof of delivery (D-21) | state = `ARRIVED_AT_DROPOFF` **and** POD satisfied |
  | `UNDELIVERABLE` | rider reports an exception (D-32) | any pre-DELIVERED state |
- **Rules**:
  - `ARRIVED_AT_PICKUP` and `PICKED_UP` are **distinct states**. Conflating them (as the shipped app did) destroys restaurant wait-time measurement and the wait-time pay component.
  - Geofence failures do not block the rider: the transition is allowed with `geofence_ok=false` and a mandatory `override_reason`, and is flagged for ops. Repeated overrides (>3 in 7 days) trigger a review.
  - `occurred_at` is client-supplied but clamped to `[recorded_at - 120 s, recorded_at]`; the server timestamp is authoritative for pay.
  - Every transition emits `order_update` to the customer and restaurant with the mapped customer-facing status, and updates the customer ETA.
  - Repeating the current state returns `200` with the unchanged assignment (idempotent). Any backwards transition returns `409 INVALID_TRANSITION` with `details.current_state`.
  - Transitions are accepted offline-first: the app queues them with `occurred_at` and replays on reconnect; the server accepts replays up to 2 h late.
- **Acceptance criteria**:
  1. Given a rider 2 km from the restaurant, When they tap "I'm at the restaurant" without an override reason, Then `422 GEOFENCE_REQUIRED` and no transition row is written.
  2. Given `ARRIVED_AT_PICKUP` at 10:00 and `PICKED_UP` at 10:14, When the delivery completes, Then `pickup_wait_seconds=840` and the wait-pay component is non-zero.
  3. Given a rider who taps "Picked up" twice, When both requests land, Then one transition row exists and both responses are 200.
  4. Given a rider who taps "Delivered" while in `EN_ROUTE_TO_DROPOFF`, When submitted, Then `409 INVALID_TRANSITION`.
  5. Given no network at the restaurant, When the rider taps "Picked up" and regains signal 4 minutes later, Then the transition is recorded with the original `occurred_at`.
- **Out of scope**: automatic geofence-triggered transitions without a tap (V2), restaurant-side "handed to rider" confirmation as a hard gate (V2).
- **Version**: V1 · **Size**: M

---

### D-21 — Proof of delivery

- **SOW trace**: *"Order Status Updates: Update order status (eg… delivered)"* — the SOW does not specify evidence; this fills the gap that made every "I never got my food" dispute unresolvable.
- **Behaviour**: The required POD method is determined by the **customer's delivery instruction** on the order and is returned to the rider in the assignment payload as `required_pod_method`:
  | Delivery instruction | `required_pod_method` | Rider action |
  |---|---|---|
  | `MEET_AT_DOOR`, `MEET_IN_LOBBY`, `CALL_ON_ARRIVAL` | `OTP` | Rider enters the 4-digit code the customer reads out |
  | `LEAVE_AT_DOOR`, `DO_NOT_RING_BELL` | `PHOTO` | Rider takes a photo of the placed order; uploaded before DELIVERED commits |
  | any, when the rider reports the customer unreachable | `PHOTO_WITH_ATTESTATION` | Photo + a reason code + a mandatory 5-minute wait (D-32) |
  The OTP is generated at `PICKED_UP`, shown in the customer app, delivered by push and SMS, and never shown to the rider.
- **Data**: `delivery_otp(assignment_id, code_hash, attempts, max_attempts=5, generated_at, verified_at)`; `assignment.pod_method, pod_photo_document_id, pod_otp_verified_at, handover_method`.
  `handover_method ∈ {HANDED_TO_CUSTOMER, LEFT_AT_DOOR, LEFT_WITH_RECEPTION, HANDED_TO_OTHER_PERSON}`.
- **States**: gates `ARRIVED_AT_DROPOFF → DELIVERED`.
- **Rules**:
  - The POD photo is uploaded via the presigned flow (D-05, `document_type=DELIVERY_PROOF`), stored in the private bucket, visible to the customer for 24 h and to support for 90 days, then deleted. Max 5 MB, JPEG only, EXIF stripped except timestamp, server-stamped with the assignment's location.
  - OTP: 4 digits, 5 attempts, no expiry within the assignment's life. After 5 failures the rider must fall back to `PHOTO_WITH_ATTESTATION` and the event is flagged.
  - `DELIVERED` cannot commit without the POD artefact recorded in the **same transaction** — no "mark delivered, upload later".
  - Signature capture: not in V1.
  - Every POD artefact and its metadata is attached to any subsequent dispute, and is the evidence used to decide chargebacks and rider penalties.
- **Acceptance criteria**:
  1. Given `LEAVE_AT_DOOR`, When the rider taps Delivered without a photo, Then `422 POD_REQUIRED` with `required_pod_method="PHOTO"`.
  2. Given `MEET_AT_DOOR` and a wrong OTP entered 5 times, When the 6th attempt is made, Then `423 OTP_LOCKED` and the app offers the photo-with-attestation path.
  3. Given a successful POD photo upload, When DELIVERED commits, Then `pod_photo_document_id` is non-null in the same transaction and the customer can view the photo.
  4. Given a delivered order 91 days old, When support opens it, Then the POD photo object no longer exists and the record shows `deleted_at`.
- **Out of scope**: signature capture, ID check for age-restricted goods (no alcohol in scope), face/ID matching.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — POD policy**: is OTP-for-handoff / photo-for-doorstep the right split, or does the client want photo on every delivery? · **Proposed default**: as specified (OTP for met handoffs, photo for unattended). · **Why**: OTP is faster for the common case and photos of a customer at their door are a privacy problem; photos are only needed when nobody signs for the food.

---

### D-22 — Navigation & maps

- **SOW trace**: *"Real-Time Navigation: Integration with Google Maps or similar services for turn-by-turn directions and optimized routes."*
- **Behaviour**: In-app the rider sees a map with their position, the active waypoint (restaurant, then customer), and a route polyline with distance and ETA, refreshed every 30 s or on a >200 m deviation. Turn-by-turn is **handed off** to the rider's installed navigation app via a deep link (`google.navigation:q=lat,lng&mode=d|b|w`, iOS fallback `comgooglemaps://`, then Apple Maps `maps://`, then a universal `https://www.google.com/maps/dir/?api=1` URL). The route polyline and ETA come from **the server**: `GET /api/v1/riders/:id/assignments/:id/route?leg=PICKUP|DROPOFF` returns `{polyline, distance_m, duration_s, provider, computed_at}`.
- **Data**: `assignment_route(id, assignment_id, leg, provider, polyline, distance_m, duration_s, computed_at)` — one row per recomputation, retained for distance auditing.
- **States**: none.
- **Rules**:
  - **No map/routing API key ships in the app bundle for server-computable work.** Routing, matrix and ETA calls are proxied through the API with a server-held key, rate-limited per rider. The only client-side key is the platform Maps SDK render key, which is restricted by bundle id/SHA-1 fingerprint and stored in EAS secrets, never committed.
  - Routing profile follows `vehicle_type` (D-04): `driving` / `cycling` / `walking`.
  - Route recomputation is capped at 1 call per 30 s per assignment, plus one immediately on each state transition; results are cached in Redis for 30 s keyed on `(origin_cell, destination, profile)`.
  - If the routing provider fails, the map falls back to a straight line with an explicit "route unavailable" label and haversine × 1.35 distance; the assignment is still completable.
  - The customer's live map is fed from the same rider positions, throttled to one update per 5 s.
- **Acceptance criteria**:
  1. Given a rider on a BICYCLE, When the route loads, Then the provider was called with the cycling profile and the deep link uses `mode=b`.
  2. Given the routing provider returns 500, When the map loads, Then the screen still renders with a straight-line fallback and the rider can complete the delivery.
  3. Given a grep of the built JS bundle, When searching for `AIza`, Then no routing/Directions key is present.
- **Out of scope**: in-app turn-by-turn voice guidance, multi-stop route optimisation (V3 with batching), offline maps.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — maps/routing provider**: Google Maps Platform (Directions + Distance Matrix + Roads) or an OSM-based stack (Mapbox / self-hosted Valhalla + OSRM)? · **Proposed default**: Google Directions/Matrix server-side for launch, behind a `RoutingProvider` interface so a swap is one adapter. · **Why**: the client's SOW names Google and the team already has keys; the interface keeps the per-request cost negotiable later.

> **2026-10-01:** Google Maps Platform and Mapbox are SaaS, which [the self-hosted, open-source rule](../decisions/README.md#settled--platform-decisions-owner-2026-10-01) now rules out. Self-hosted Valhalla or OSRM fit it. The choice is tracked in [#199](https://github.com/shaiknoorullah/hg-mono/issues/199).

---

### D-23 — Distance tracking for payment

- **SOW trace**: *"Distance Tracking: Track distance traveled for accurate payment calculations."*
- **Behaviour**: Two distances are computed and stored per assignment: `routed_distance_m` (the provider's route from the pickup to the drop-off, computed at `PICKED_UP` and frozen) and `traced_distance_m` (map-matched GPS polyline actually travelled between `PICKED_UP` and `DELIVERED`). **`billable_distance_m = max(routed_distance_m, min(traced_distance_m, routed_distance_m × 1.30))`** — the rider is never paid less than the sensible route, is paid for genuine detours up to 30 %, and cannot inflate pay by driving in circles.
- **Data**: `assignment.routed_distance_m, traced_distance_m, billable_distance_m, distance_source, distance_computed_at`; `rider_location_point` rows scoped to `assignment_id` are the trace input.
- **States**: computed at `DELIVERED`; frozen once an earnings ledger entry is written.
- **Rules**:
  - The trace is cleaned before use: points with `accuracy_m > 50` dropped; implied speeds above the vehicle profile's max (car 130 km/h, bike 45, foot 12) dropped; the remainder map-matched to the road graph (or, if the provider is unavailable, summed as haversine between consecutive cleaned points).
  - If `tracking_health` was `LOST` for more than 20 % of the delivery, `distance_source='ROUTED_ONLY'` and `billable = routed_distance_m`; the rider is never penalised for tracking gaps.
  - Distance is computed **server-side only**. The client displays it; it never derives it. (`distance × $2` in the shipped app was a fiction.)
  - The pickup leg (rider → restaurant) is **not** paid per kilometre in V1; it is reflected in the base fare. This must be stated plainly in the rider's earnings breakdown so it is not perceived as missing pay.
  - Recorded to the metre; rounded only at display time.
- **Acceptance criteria**:
  1. Given a routed distance of 4 000 m and a traced distance of 4 400 m, When earnings are computed, Then `billable_distance_m = 4400`.
  2. Given a routed distance of 4 000 m and a traced distance of 9 000 m, When earnings are computed, Then `billable_distance_m = 5200` (the 1.30 cap).
  3. Given a routed distance of 4 000 m and a traced distance of 3 100 m (GPS gaps), When earnings are computed, Then `billable_distance_m = 4000`.
  4. Given tracking was LOST for 40 % of the trip, When earnings are computed, Then `distance_source='ROUTED_ONLY'` and no penalty is applied.
- **Out of scope**: paying for the pickup leg per km, odometer integration, toll reimbursement.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — distance basis for pay**: routed distance, GPS-traced distance, or the capped hybrid above? · **Proposed default**: the capped hybrid (`max(routed, min(traced, routed×1.30))`). · **Why**: pure routed under-pays real detours; pure traced is trivially gameable and unstable under GPS noise.

---

### D-24 — Customer communication

- **SOW trace**: *"Customer Communication: In-app chat or call functionality to contact customers for delivery instructions or updates."*
- **Behaviour**: **V1 = masked voice call + canned message templates.** `POST /api/v1/riders/:id/assignments/:id/contact {channel:'CALL'|'MESSAGE', template_code?, body?}` returns, for `CALL`, a proxy number + PIN valid for the assignment's life; the rider's dialer opens that number and the platform bridges to the customer without either party seeing the other's real number. For `MESSAGE`, the rider picks from a fixed template list (`ARRIVING_2_MIN`, `AT_YOUR_DOOR`, `CANNOT_FIND_ADDRESS`, `BUZZER_NOT_WORKING`, `RUNNING_LATE_5_MIN`, `ORDER_ITEM_UNAVAILABLE`) which is delivered to the customer as a push + an entry in the order thread. Free-text two-way chat is **V2** (D-24b below is the same feature at V2 scope).
- **Data**: `contact_session(id, assignment_id, provider, proxy_number, rider_pin, customer_pin, created_at, expires_at, revoked_at)`; `order_message(id, order_id, sender_type, sender_id, template_code, body, created_at, read_at)`.
- **States**: `contact_session` active until `assignment.terminal_at + 30 min`, then revoked.
- **Rules**:
  - `Linking.openURL` must be reachable — the module is imported and the call button is covered by a test that asserts no ReferenceError (the shipped app crashed here).
  - Calling is only permitted between `ASSIGNED` and `terminal_at + 30 min`; outside that window the endpoint returns `403 CONTACT_WINDOW_CLOSED`.
  - Real phone numbers are never present in any rider-facing payload, log or push.
  - Call metadata (start, duration, outcome) is recorded for dispute resolution; audio is not recorded.
  - Rate limit: 5 call-session requests and 10 template messages per assignment.
- **Acceptance criteria**:
  1. Given an active assignment, When the rider taps Call, Then the dialer opens with a proxy number and the assignment payload contains no `customer.phone` field.
  2. Given a delivery completed 31 minutes ago, When the rider taps Call, Then `403 CONTACT_WINDOW_CLOSED`.
  3. Given the rider sends `ARRIVING_2_MIN`, When the customer app is backgrounded, Then a push arrives and the message appears in the order thread.
- **Out of scope (V1)**: free-text chat, voice notes, photo messages, calling before accept.
- **Version**: V1 (masked call + templates) · **Size**: M

### D-24b — Two-way free-text chat with customer and restaurant

- **SOW trace**: *"In-app chat or call functionality"* · *"Restaurant Communication: Notify restaurants upon arrival or if there are issues with the order."*
- **Behaviour**: A persisted per-order thread with participants rider/customer/restaurant/support, delivered over the same authenticated WebSocket with `message.created` events, read receipts, and push fallback. Replaces the three hardcoded "Jason Miller" mock screens.
- **Data**: `order_thread(id, order_id, created_at, closed_at)`; `order_message(..., delivered_at, read_at, attachments jsonb)`.
- **States**: thread `OPEN → CLOSED` (at `terminal_at + 30 min`).
- **Rules**: messages retained 90 days; profanity/PII filter on rider→customer messages; no attachments in V2 except the POD photo reference; support can join any thread.
- **Acceptance criteria**:
  1. Given an open thread, When the rider sends a message, Then the customer receives it in < 2 s over WS and via push if backgrounded.
  2. Given a closed thread, When either party posts, Then `403 THREAD_CLOSED`.
  3. Given a rider reopens the app, When the thread loads, Then all prior messages are present from the server (not local state).
- **Out of scope**: voice/video, translation.
- **Version**: V2 · **Size**: L

---

### D-25 — Restaurant communication

- **SOW trace**: *"Restaurant Communication: Notify restaurants upon arrival or if there are issues with the order."*
- **Behaviour**: `ARRIVED_AT_PICKUP` automatically notifies the restaurant dashboard ("Rider Ahmed is here for order #1234") — no rider action required. The rider additionally has a masked call button (same mechanism as D-24) and a fixed issue list: `ORDER_NOT_READY`, `ITEM_MISSING`, `WRONG_ORDER_HANDED`, `RESTAURANT_CLOSED`, `LONG_WAIT` — each posts to the restaurant dashboard and, for `RESTAURANT_CLOSED` / `LONG_WAIT > 20 min`, raises an ops ticket.
- **Data**: `assignment_issue(id, assignment_id, raised_by, issue_code, note, created_at, resolved_at, resolution)`; reuses `contact_session`.
- **States**: no assignment state change (except `UNDELIVERABLE` via D-32 when the restaurant is closed).
- **Rules**:
  - Arrival notification is idempotent and fired exactly once per assignment.
  - The rider may raise at most 3 issues per assignment.
  - Restaurant wait clock starts at `ARRIVED_AT_PICKUP` and drives both the wait-pay component (D-26) and the restaurant's performance metrics.
- **Acceptance criteria**:
  1. Given `ARRIVED_AT_PICKUP` commits, When the restaurant dashboard is open, Then it displays the rider-arrived banner within 2 s, exactly once.
  2. Given the rider raises `ORDER_NOT_READY` at 12 minutes of waiting, When 20 minutes of waiting are reached, Then an ops ticket exists.
  3. Given a rider taps Call restaurant, Then the number dialled is a proxy number, not the restaurant's real line.
- **Out of scope**: rider-side view of the restaurant's prep queue, rider-initiated order edits.
- **Version**: V1 · **Size**: M

---

### D-26 — Earnings formula and per-delivery ledger

- **SOW trace**: *"Earnings Dashboard: View daily, weekly, and monthly earnings."* (the number has to come from somewhere)
- **Behaviour**: On `DELIVERED` (or a compensable terminal state) the earnings module writes an immutable ledger entry computed **server-side**:
  ```
  base            = earn.base_fare_cents                                        // 350
  distance        = round(billable_distance_m / 1000 × earn.per_km_cents)       // 80 ¢/km
  wait            = clamp(pickup_wait_seconds/60 - 8, 0, 20) × 25               // ¢
  subtotal        = round((base + distance) × surge_multiplier) + wait
  guaranteed      = max(subtotal, earn.min_guarantee_cents)                     // 600 floor
  gross           = guaranteed + tip_cents + adjustment_cents
  ```
  `surge_multiplier` is the value frozen on the accepted offer (D-13). `tip_cents` is 100 % pass-through and may increase after delivery (post-delivery tipping window of 24 h creates a second ledger entry of type `TIP`). Every component is stored, not just the total, and the formula version is stamped.
- **Data**: `earning_entry(id, rider_id, assignment_id, type, base_cents, distance_cents, wait_cents, surge_multiplier, subtotal_cents, guarantee_topup_cents, tip_cents, adjustment_cents, gross_cents, currency='CAD', formula_version, status, earned_at, payout_id, created_at)`
  - `type ∈ {DELIVERY, TIP, CANCELLATION_COMPENSATION, BONUS, ADJUSTMENT, CLAWBACK}`
  - `status ∈ {PENDING, AVAILABLE, PAID, REVERSED}`
- **States**: `PENDING` (until the assignment is 60 min old and dispute-free) `→ AVAILABLE → PAID`; `→ REVERSED` on a substantiated fraud/dispute finding, which writes a `CLAWBACK` entry rather than mutating the original.
- **Rules**:
  - **The client never computes earnings.** Any client-side arithmetic on money is a build-breaking review failure. (The shipped app invented `distance × $2 + $5`.)
  - Ledger entries are append-only and immutable; corrections are new `ADJUSTMENT`/`CLAWBACK` rows referencing the original.
  - `CANCELLATION_COMPENSATION` (`earn.cancel_compensation_cents = 300`) is paid when an order is cancelled by the customer, restaurant, or platform **after** the rider reached `ARRIVED_AT_PICKUP`; nothing is paid for a cancellation before arrival.
  - Tips are visible to the rider only **after** delivery (the offer shows tip-so-far only if the client decides tips are pre-visible — see decision), and 100 % of a tip reaches the rider with no platform deduction.
  - Earnings are gross to the rider as an independent contractor; the platform withholds nothing and reports per the tax decision below.
  - Every entry is reproducible: given `formula_version` and the stored inputs, recomputation must yield the identical `gross_cents` (property test).
- **Acceptance criteria**:
  1. Given `billable_distance_m=4400`, `pickup_wait_seconds=840`, `surge=1.0`, `tip=200`, When the entry is written, Then `base=350, distance=352, wait=150, subtotal=852, gross=1052`.
  2. Given a 0.4 km trip with no wait and no surge, When the entry is written, Then `guarantee_topup_cents` brings `gross` to at least 600.
  3. Given surge 1.5 frozen at offer time and surge 1.0 at delivery time, When the entry is written, Then `surge_multiplier=1.5` was applied.
  4. Given an order cancelled after `ARRIVED_AT_PICKUP`, When it terminates, Then a `CANCELLATION_COMPENSATION` entry of 300 exists.
  5. Given a customer tips $3 two hours after delivery, When the tip is captured, Then a second `TIP` entry of 300 exists and the original entry is unchanged.
- **Out of scope**: hourly guarantees, referral bonuses, quest/streak bonuses, fuel surcharges.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — earnings rate card**: confirm base $3.50, $0.80/km on the drop-off leg, $0.25/min wait after 8 free minutes (20 min cap), $6.00 minimum per delivery, 100 % of tips, $3.00 cancellation compensation after arrival — all CAD. · **Proposed default**: exactly these numbers, stored as admin config so they change without a deploy. · **Why**: the rate card is a commercial decision the client owns, but the system cannot be built or tested without concrete numbers.

> **DECISION REQUIRED — surge**: who sets the multiplier and how? · **Proposed default**: V1 ships a manual, admin-set surge per zone per time window (multiplier 1.0–2.5, 0.1 steps), frozen onto each offer; automatic demand-based surge is V3. · **Why**: an automatic surge engine needs demand data the platform will not have until it is live.

> **DECISION REQUIRED — tip visibility before accept**: does the offer show the tip the customer has already added? · **Proposed default**: yes, show tip-so-far in the offer's estimated earnings, and never reduce a rider's pay if the tip is later lowered (tip reductions become platform-funded adjustments). · **Why**: hiding it depresses acceptance on high-tip orders; allowing retroactive reduction invites "tip-baiting" complaints.

> **DECISION REQUIRED — contractor tax handling**: does the platform issue T4A slips and collect GST/HST numbers from riders? · **Proposed default**: collect an optional GST/HST number at payout onboarding, issue annual earnings summaries, no withholding; formal T4A generation deferred pending the client's accountant. · **Why**: it is a legal/accounting decision, but the data model must reserve the fields now.

---

### D-27 — Earnings dashboard (daily / weekly / monthly)

- **SOW trace**: *"Earnings Dashboard: View daily, weekly, and monthly earnings."*
- **Behaviour**: `GET /api/v1/riders/:id/earnings/summary?period=DAY|WEEK|MONTH&from&to&tz` returns per-bucket totals `{bucket_start, gross_cents, delivery_cents, tip_cents, bonus_cents, adjustment_cents, trips, online_seconds, distance_m, effective_cents_per_hour}` plus a period total and the current unpaid balance. `GET /api/v1/riders/:id/earnings/entries?...` paginates the underlying ledger entries; each entry drills into a full breakdown identical to D-26's components. A per-delivery breakdown screen appears immediately after `DELIVERED`, populated from the server response of the delivered transition — never from local arithmetic.
- **Data**: read model over `earning_entry` + `rider_availability_event`; a materialised `earning_daily_rollup(rider_id, local_date, ...)` refreshed on write and rebuilt nightly.
- **States**: none.
- **Rules**:
  - Bucketing uses the rider's local timezone; a delivery at 00:30 local belongs to that local day regardless of UTC.
  - Weeks run Monday–Sunday local, aligned with the payout period (D-28).
  - The dashboard must reconcile exactly: `sum(entries in period) == period total == sum(rollup buckets)`. A reconciliation test runs in CI over generated data.
  - Currency formatting is `$X.XX CAD`, one symbol across every screen.
  - Empty periods return zeros with the correct bucket list, not an empty array (so charts do not lie by omission).
- **Acceptance criteria**:
  1. Given 3 deliveries today totalling $28.40, When the dashboard loads, Then `today.gross_cents=2840` and it equals the sum of the three drill-down entries.
  2. Given a delivery completed at 00:30 America/Toronto (04:30 UTC), When the daily summary is requested, Then it appears in the local day that started at 00:00 local, not the previous day.
  3. Given a rider who was online 6 h and earned $90, When the summary loads, Then `effective_cents_per_hour=1500`.
- **Out of scope**: CSV/PDF export (V2), earnings projections, tax-year statements (V2).
- **Version**: V1 (daily/weekly) · V2 (monthly charts, export) · **Size**: M

---

### D-28 — Payouts

- **SOW trace**: *"Earnings Support: Assist riders with payout related disputes/grievances."* (Support Agent) · SOW Restaurant §6 establishes the payout pattern (request, status tracking, history, preferences) that riders inherit.
- **Behaviour**: **Automatic weekly payout.** Every Monday at 09:00 America/Toronto a job sums each rider's `AVAILABLE` entries for the prior Monday 00:00 → Sunday 23:59:59 local, and if the total ≥ `payout.min_balance_cents` (1000) creates a `payout` row and a Stripe **Transfer** to the rider's connected account (Stripe then pays out to the bank on its own schedule). Below the minimum, the balance rolls into the next period. Riders see: current balance, next payout date and estimated amount, and a payout history with per-payout entry lists. `GET /api/v1/riders/:id/payouts`, `GET /payouts/:id`.
- **Data**: `payout(id, rider_id, period_start, period_end, gross_cents, entry_count, provider, provider_transfer_id, status, initiated_at, settled_at, failure_code, failure_message, created_at)`
  - `status ∈ {SCHEDULED, PROCESSING, PAID, FAILED, REVERSED}`
- **States**: `SCHEDULED → PROCESSING → PAID | FAILED`; `FAILED` returns its entries to `AVAILABLE` for the next run.
- **Rules**:
  - Entry selection and the payout row are created in one transaction that stamps `earning_entry.payout_id` and flips `status → PAID` only on the provider's success webhook. An entry can belong to at most one non-reversed payout (`UNIQUE(payout_id, id)` semantics enforced by the FK plus a partial index).
  - Payouts are blocked (and the balance held) when `payouts_enabled=false`; the rider sees why and a link to fix it.
  - Failures are surfaced with the provider's reason mapped to rider-readable copy, retried on the next cycle, and alerted to ops after 2 consecutive failures.
  - Negative balances (clawbacks exceeding earnings) are carried forward and netted against future earnings; the platform never debits a rider's bank account.
  - Idempotency: the weekly job uses `Idempotency-Key = sha256(rider_id|period_start)`; a re-run creates no duplicate transfer.
  - Every payout has a downloadable statement listing each contributing delivery.
- **Acceptance criteria**:
  1. Given a rider with $47.20 available for the period, When the Monday job runs, Then one `payout` row exists with `gross_cents=4720`, one Stripe transfer is created, and all contributing entries carry its `payout_id`.
  2. Given a rider with $6.40 available, When the job runs, Then no payout is created and the balance appears in the next period's total.
  3. Given the weekly job is accidentally run twice, When the second run executes, Then no second transfer is created for the same rider/period.
  4. Given a transfer fails, When the failure webhook is processed, Then the payout is `FAILED`, its entries return to `AVAILABLE`, and the rider sees a reason.
- **Out of scope (V1)**: rider-triggered instant/on-demand payout (V2, with a fee), payout-frequency preferences (daily/monthly) (V2), multiple bank accounts, cash-out to a card.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — payout schedule, minimum and instant cash-out**: weekly Monday transfers with a $10 minimum, no rider-triggered payout in V1 — confirm? · **Proposed default**: as specified; V2 adds on-demand payout capped at once per day with a $0.75 fee. · **Why**: automatic weekly is the lowest-operations option and matches Stripe Connect defaults; on-demand is a retention feature, not a launch blocker.

---

### D-29 — Performance metrics

- **SOW trace**: *"Performance Metrics: Track metrics like delivery time, customer ratings, and order completion rates."*
- **Behaviour**: `GET /api/v1/riders/:id/performance?window=7D|30D|ALL` returns, each with its definition string and the platform target: `acceptance_rate`, `completion_rate`, `on_time_rate`, `rating_avg` + `rating_count`, `avg_pickup_wait_seconds`, `avg_delivery_duration_seconds`, `deliveries`, `cancellations_by_rider`, `undeliverable_count`, `override_count`.
- **Data**: `rider_metric_daily(rider_id, local_date, offers_sent, offers_accepted, offers_rejected, offers_expired, assignments_started, assignments_delivered, assignments_undeliverable, on_time_count, late_count, rating_sum, rating_count, pickup_wait_seconds_sum, delivery_duration_sum)` — rebuilt from event tables nightly and incremented on write.
- **States**: none.
- **Rules** (definitions are part of the contract; ambiguity here is what makes riders distrust metrics):
  - `acceptance_rate = accepted / (accepted + rejected + expired)` over the window; offers withdrawn because another rider won are **excluded** from the denominator.
  - `completion_rate = delivered / (delivered + rider_initiated_cancellations + undeliverable_attributable_to_rider)`; platform/customer/restaurant cancellations are excluded.
  - `on_time = delivered_at <= promised_at + 5 min`, where `promised_at` is the ETA quoted to the customer at order placement, frozen. Deliveries where the restaurant wait exceeded 15 minutes are excluded from the on-time denominator (the rider cannot control restaurant delay).
  - Metrics are display-and-dispatch-input only in V1; **no automatic deactivation** on any metric.
  - Every metric shows its window, its target, and a plain-English definition in the UI.
- **Acceptance criteria**:
  1. Given 10 offers of which 6 accepted, 2 rejected, 1 expired and 1 withdrawn, When performance is requested, Then `acceptance_rate = 6/9 = 66.7%`.
  2. Given a delivery where the restaurant wait was 22 minutes and the order arrived 12 minutes late, When on-time rate is computed, Then that delivery is in neither the numerator nor the denominator.
  3. Given a rider with no offers in the window, When performance is requested, Then rates are `null` (not 0) and the UI shows "not enough data".
- **Out of scope**: tiering/gamification, automatic deactivation, leaderboards.
- **Version**: V1 (core four) · V2 (full panel, trends) · **Size**: M

> **DECISION REQUIRED — enforcement thresholds**: at what acceptance/completion/rating levels, if any, does the platform warn or deactivate a rider? · **Proposed default**: warn below 4.2 rating (min 20 ratings) or below 80 % completion; no automatic deactivation in V1 — support review only. · **Why**: automatic deactivation on thin early data creates wrongful terminations and a legal exposure.

---

### D-30 — Delivery history

- **SOW trace**: *"Order History: View past deliveries with details like date, time, earnings, and customer feedback."*
- **Behaviour**: `GET /api/v1/riders/:id/assignments?status=&from=&to=&cursor=&limit=20` returns a cursor-paginated list (newest first) of terminal assignments with `{assignment_id, order_reference, restaurant_name, dropoff_area, delivered_at, duration_seconds, billable_distance_m, gross_cents, rating_given_by_customer, terminal_reason}`. Tapping one opens a detail view: the timeline of transitions with timestamps, the earnings breakdown (D-26 components), the route map, the POD artefact, and the customer's rating and comment if any.
- **Data**: read model over `assignment`, `assignment_transition`, `earning_entry`, `rider_rating`.
- **States**: none.
- **Rules**:
  - Only terminal assignments appear (`DELIVERED`, `RETURNED`, `CANCELLED_BY_PLATFORM`, `REASSIGNED`); the active one lives on the dashboard.
  - Customer PII is redacted per D-19 (street-level area only, no phone, no name beyond first name).
  - History is retained and viewable for 24 months; the underlying GPS trace is pruned at 90 days, after which the route map shows the routed polyline instead of the trace.
  - Cursor pagination (keyset on `delivered_at, id`), never offset — riders accumulate thousands of rows.
  - A "report a problem with this delivery" action opens a support ticket pre-filled with the assignment context, available for 14 days after delivery.
- **Acceptance criteria**:
  1. Given 250 past deliveries, When the list is paged to the end, Then no row is repeated or skipped and each page returns in < 300 ms.
  2. Given a delivery from 100 days ago, When its detail opens, Then the route map renders the stored routed polyline and no GPS trace points are returned.
  3. Given a delivered assignment, When the detail opens, Then `gross_cents` equals the sum of its ledger entries.
- **Out of scope**: exporting history, filtering by restaurant, re-running a past route.
- **Version**: V1 · **Size**: M

---

### D-31 — Ratings received from customers

- **SOW trace**: *"Feedback and Ratings: View customer feedback and ratings for each delivery."*
- **Behaviour**: After delivery the customer may rate the rider 1–5 with optional tags and free text. `GET /api/v1/riders/:id/ratings?cursor=` returns the rider's received ratings (score, tags, comment, delivered_at, order reference), plus a distribution summary. `rider.rating_avg` is a rolling average over the **last 100 ratings**, recomputed on each new rating.
- **Data**: `rider_rating(id, assignment_id UNIQUE, rider_id, customer_id, score, tags text[], comment, created_at, moderated_at, moderation_status, hidden_reason)`
  - tags ∈ `{FRIENDLY, FAST, CAREFUL_WITH_FOOD, GOOD_COMMUNICATION, FOLLOWED_INSTRUCTIONS, LATE, RUDE, FOOD_DAMAGED, WRONG_LOCATION}`
- **States**: `moderation_status ∈ {PUBLISHED, PENDING_REVIEW, HIDDEN}`.
- **Rules**:
  - One rating per assignment; editable by the customer for 24 h, after which it is frozen.
  - Comments pass an automated abuse/PII filter; flagged comments are `PENDING_REVIEW` and are not shown to the rider or counted until moderated.
  - Ratings attached to an assignment that a dispute later found not to be the rider's fault (e.g. restaurant error) can be `HIDDEN` by support with a reason and are excluded from `rating_avg`.
  - `rating_avg` is shown to the rider only after **5** ratings; below that the UI says "not enough ratings yet". The customer-facing rider card uses the same threshold.
  - Ratings are never editable or deletable by the rider.
- **Acceptance criteria**:
  1. Given a customer rates 4 stars with a comment, When the rider opens ratings, Then the score, tags and comment are visible and attributed to the correct delivery.
  2. Given a comment containing a phone number, When it is submitted, Then it is `PENDING_REVIEW` and not visible to the rider until moderated.
  3. Given support hides a rating, When `rating_avg` recomputes, Then that score is excluded.
  4. Given a rider with 4 ratings, When they open the ratings screen, Then no average is displayed.
- **Out of scope**: rider→customer ratings (collected but not surfaced in V1 — the shipped 5-star selector was never submitted; either wire it to `customer_rating` or delete it), rider replies to reviews.
- **Version**: V1 · **Size**: M

---

### D-32 — Incident reporting & mid-delivery exceptions

- **SOW trace**: *"Report Incidents: Get support from the application support team to report incidents such as customer disputes, incorrect addresses, restaurant delays, order abandonment, etc."*
- **Behaviour**: Two distinct things, both currently absent:
  **(a) Blocking exceptions** — the rider cannot complete the delivery. `POST /api/v1/riders/:id/assignments/:id/exception {code, note, lat, lng, evidence_document_id?}`. The server applies a resolution policy and drives the assignment out of the live flow. Codes and resolutions:
  | code | required evidence | resolution |
  |---|---|---|
  | `CUSTOMER_UNREACHABLE` | 2 call attempts logged + 5 min wait timer + photo | after the timer: `UNDELIVERABLE` → policy per customer instruction (leave at door if permitted, else `RETURNING`) |
  | `ADDRESS_NOT_FOUND` | photo of location | ops contacted; ops may supply a corrected address (assignment continues) or mark `UNDELIVERABLE` |
  | `CUSTOMER_REFUSED` | note | `UNDELIVERABLE → RETURNING` |
  | `RESTAURANT_CLOSED` | photo | assignment `CANCELLED_BY_PLATFORM`; rider paid cancellation compensation |
  | `ORDER_NOT_READY_TIMEOUT` | — | after 25 min waiting the rider may release the order; compensation paid; order re-dispatched |
  | `VEHICLE_BREAKDOWN` / `RIDER_UNWELL` | note | assignment released for re-dispatch; compensation if past `ARRIVED_AT_PICKUP` |
  | `ACCIDENT` | note | ops paged immediately (P1), assignment released, safety follow-up |
  | `UNSAFE_SITUATION` | note | ops paged, assignment released, no penalty |
  **(b) Non-blocking incident reports** — after the fact: `POST /api/v1/riders/:id/incidents {code, assignment_id?, note, attachments[]}` creating a support ticket the rider can track.
- **Data**: `assignment_exception(id, assignment_id, code, note, lat, lng, evidence_document_id, created_at, resolved_at, resolution, resolved_by)`; `support_ticket(id, rider_id, assignment_id, category, subject, body, status, priority, created_at, updated_at, closed_at)`; `ticket_message(...)`.
- **States**: exceptions drive `assignment → UNDELIVERABLE → RETURNING → RETURNED` or `→ CANCELLED_BY_PLATFORM` / `→ REASSIGNED`. Tickets: `OPEN → IN_PROGRESS → RESOLVED → CLOSED`.
- **Rules**:
  - **A rider must always have a forward path that is not "falsely mark delivered".** Every screen from `ASSIGNED` onward exposes the exception action. This is the single most important rider-safety and data-integrity rule in the domain.
  - `CUSTOMER_UNREACHABLE` requires: ≥2 call attempts via `contact_session` at least 60 s apart, a 5-minute countdown that the server times (not the client), and a photo. Only then does the option to finish appear.
  - `RETURNING` requires the rider to bring the food back to the restaurant; on `RETURNED` the rider is paid the full delivery earnings (they did the work) and the customer's refund is decided by the dispute policy.
  - Every exception notifies the customer with honest copy and updates their order status.
  - Ops receives every exception in a queue with the evidence attached; `ACCIDENT`/`UNSAFE_SITUATION` page immediately.
  - Exceptions are never resolvable by the rider alone when money moves — the rider triggers, the server decides.
- **Acceptance criteria**:
  1. Given `CUSTOMER_UNREACHABLE` with only one call attempt, When submitted, Then `422 PRECONDITION_NOT_MET` naming the missing call attempt.
  2. Given the 5-minute server timer is running, When the rider tries to finish at 4:30, Then `409 WAIT_PERIOD_ACTIVE` with `remaining_seconds`.
  3. Given `RESTAURANT_CLOSED` with a photo, When submitted, Then the assignment is `CANCELLED_BY_PLATFORM`, a `CANCELLATION_COMPENSATION` entry exists, availability returns to `ONLINE_IDLE`, and the customer is refunded.
  4. Given `ACCIDENT`, When submitted, Then a P1 ops alert is raised within 30 s and the rider is not offered another order until support clears them.
- **Out of scope**: in-app emergency services dialling (see SOS decision), insurance claim filing.
- **Version**: V1 (blocking exceptions + ticket creation) · V2 (ticket threads, attachments) · **Size**: L

> **DECISION REQUIRED — SOS / rider safety**: does V1 need an in-app emergency button (911 dial + live location shared with ops + emergency contact SMS)? · **Proposed default**: yes — a minimal SOS that dials 911, pins the rider's location to an ops P1 alert, and SMSs one stored emergency contact; the full safety programme is V2. · **Why**: riders are alone at night with strangers' addresses; the minimal version is small and the absence is hard to defend.

> **DECISION REQUIRED — undelivered food policy**: what happens to food after `UNDELIVERABLE`? · **Proposed default**: return to the restaurant within 30 minutes if within 5 km; otherwise the rider disposes of it and the platform absorbs the cost; the rider is paid full delivery earnings either way. · **Why**: without a stated policy riders either eat the order (fraud risk) or drive unpaid across the city.

---

### D-33 — Notifications & alerts

- **SOW trace**: *"Notification and Alerts: Order Alerts: Push notifications for new orders, order updates, and delivery confirmations."*
- **Behaviour**: `expo-notifications` registers a device push token at login and on every app start; `POST /api/v1/riders/:id/devices {push_token, platform, os_version, app_version, timezone}` upserts on `push_token`. The server sends via FCM (Android) and APNs (iOS) with per-category configuration. An in-app inbox (`GET /api/v1/riders/:id/notifications?cursor=`) persists every notification server-side with read state — no locally seeded fixtures.
- **Data**: `rider_device(...)` (D-12); `notification(id, rider_id, category, title, body, data jsonb, deep_link, created_at, read_at, expires_at)`; `push_delivery(...)`.
- **States**: notification `UNREAD → READ`; device token `ACTIVE → STALE` (on provider "unregistered" response).
- **Rules**:
  - Categories and channels: `OFFER` (max priority, custom sound, bypasses DND when online, time-sensitive on iOS), `ASSIGNMENT` (high), `EARNINGS`/`PAYOUT` (default), `VERIFICATION` (high), `ANNOUNCEMENT` (low). Android channels are created at first launch; the rider can mute all but `OFFER` while online (D-09).
  - Notification permission is **required to go online** and requested at the point of first going online, with an explanation screen before the OS prompt.
  - Every push carries `data.type` and `data.deep_link` so a tap opens the exact screen; the app must handle cold-start, background and foreground receipt identically.
  - Provider "token unregistered" responses mark the device `STALE` and stop sending to it.
  - Delivery is logged per attempt; the offer path additionally verifies delivery (D-14) and alerts ops when the offer push failure rate for a device exceeds 20 % in an hour.
  - Notifications older than 90 days are pruned from the inbox.
- **Acceptance criteria**:
  1. Given a rider with the app killed, When an offer is created, Then a push arrives and tapping it opens the offer sheet directly, not the home screen.
  2. Given a rider who denies notification permission, When they toggle online, Then `422 CANNOT_GO_ONLINE` with `blocking_reasons:["NOTIFICATION_PERMISSION"]`.
  3. Given a token that FCM reports as unregistered, When the next send occurs, Then no send is attempted to that token and the device row is `STALE`.
  4. Given 3 notifications, When the rider opens the inbox on a second device, Then the same 3 rows appear with correct read state (server-persisted).
- **Out of scope**: SMS/email notification channels for riders, notification scheduling/quiet hours (V2).
- **Version**: V1 · **Size**: L

---

### D-34 — Support & help

- **SOW trace**: *"Support & Help: Access FAQs · Live Chat · Call Support for Assistance"*
- **Behaviour**: A help hub with (a) server-delivered FAQ content (`GET /api/v1/content/help?audience=RIDER&locale=`) so copy changes without an app release, (b) ticket creation and a tracked ticket list (shares `support_ticket` with D-32), (c) a "call support" action showing the support line and hours, and (d) contextual entry points that pre-fill the ticket (from a rejection screen, an assignment, an earnings entry, a payout).
- **Data**: `help_article(id, audience, slug, title, body_md, order, published_at)`; `support_ticket`, `ticket_message` (D-32).
- **States**: ticket `OPEN → IN_PROGRESS → RESOLVED → CLOSED`; reopenable within 7 days of `RESOLVED`.
- **Rules**:
  - FAQ content must not promise flows that do not exist (the shipped apps' FAQ instructed users to use a cancel flow that was never built). A CI check fails the build if a help article references a route that is not registered.
  - Ticket categories: `ONBOARDING`, `DOCUMENTS`, `DELIVERY_ISSUE`, `EARNINGS`, `PAYOUT`, `APP_TECHNICAL`, `SAFETY`, `OTHER`. `SAFETY` is priority P1.
  - First-response SLA displayed to the rider: 4 h business hours (P1: 15 min, 24/7).
  - Live chat is V2 and, until it ships, the UI must say "we reply by ticket within 4 hours" rather than showing a dead chat button.
- **Acceptance criteria**:
  1. Given a rejected verification, When the rider taps "Get help", Then a ticket draft opens pre-filled with category `DOCUMENTS` and the rejection codes.
  2. Given an open ticket, When support replies, Then the rider gets a push and the reply appears in the ticket thread.
  3. Given a help article referencing `/order-history`, When the route is not registered, Then CI fails.
- **Out of scope (V1)**: live chat, phone callback queue, multilingual help content.
- **Version**: V1 (FAQ + tickets) · V2 (live chat) · **Size**: M

---

## 2. Deferred features (explicitly out of V1 scope, named so they are not "forgotten")

| Ref | Feature | Version | Note |
|---|---|---|---|
| D-35 | Multi-order batching / stacking | V3 | Requires the assignment model to hold N orders and a batched routing solver; the single-active-assignment invariant in D-13/D-16 is what makes V1 correct. |
| D-36 | Surge / demand heat map on the rider map | V3 | Depends on the manual surge zones from D-26's decision. |
| D-37 | Shift scheduling / slot booking | V3 | Changes the dispatch candidate query (scheduled riders prioritised). |
| D-38 | Refer & earn | V2 | Needs a fraud model. |
| D-39 | Cash on delivery collection & reconciliation | V3 | Requires a rider cash ledger, deposit workflow and float limits. Prepaid only in V1. |
| D-40 | Rider → customer ratings surfaced | V2 | Collected data with no consumer today; either wire it or remove the UI. |

---

## 3. Decisions required (consolidated)

Each was raised inline; work proceeds on the proposed default until the client rules otherwise. Items marked **BLOCKING** must be answered before the corresponding module is built.

| # | Topic | Question | Proposed default | Blocking? | Feature |
|---|---|---|---|---|---|
| 1 | Launch market | Canada-only riders in V1, or a second market? | Canada only: `CA` phone, `CAD`, `America/*`, English | BLOCKING | D-01 |
| 2 | Minimum rider age | 18 nationally, or 19 where that is the age of majority? | 18 national, per-province override to 19 (BC, NS, NB, NL, NT, NU, YT) | BLOCKING | D-03 |
| 3 | Identity-verification depth | Manual admin review, or an automated IDV vendor? | Manual review in V1; IDV vendor in V2 | no | D-03 |
| 4 | Background checks | Criminal-record / driving-abstract check required? | Not in V1; columns provisioned | no | D-05 |
| 5 | Account deletion & retention | Retention period for a deleted rider's data? | Deactivate now, PII redacted at 30 d, financial records 7 y, GPS traces 90 d | no | D-09 |
| 6 | Tracking-loss reassignment | When may ops reassign a delivery whose rider stopped reporting, and is that rider paid? | After 10 min LOST + a failed call; cancellation compensation if past `ARRIVED_AT_PICKUP` | no | D-12 |
| 7 | Dispatch shape | Batched-sequential vs broadcast vs strict sequential? | Batched-sequential, wave size 3, 30 s TTL, 5 waves, radii 3/6/10 km | BLOCKING | D-13 |
| 8 | Ranking weights | Is ETA-to-pickup the primary objective? | ETA-dominant with an idle-time fairness term | BLOCKING | D-13 |
| 9 | Offer TTL & escalation window | 30 s / 5 waves / 300 s / 600 s ops window before cancel+refund? | As specified (~15 min worst case) | BLOCKING | D-15 |
| 10 | Late-wave incentives | Add a bonus on waves 4–5 to lift fill rate? | Not in V1; `offer.incentive_cents` exists and is 0 | no | D-15 |
| 11 | POD policy | OTP for met handoffs + photo for unattended, or photo always? | As specified | BLOCKING | D-21 |
| 12 | Maps/routing provider | Google Maps Platform or an OSM stack? | Google server-side behind a `RoutingProvider` interface | BLOCKING | D-22 |
| 13 | Distance basis for pay | Routed, traced, or capped hybrid? | `max(routed, min(traced, routed × 1.30))` | BLOCKING | D-23 |
| 14 | Earnings rate card | Confirm base $3.50 / $0.80 per km / $0.25 per min wait after 8 min / $6.00 minimum / 100 % tips / $3.00 cancellation compensation (CAD) | Exactly these, as admin config | BLOCKING | D-26 |
| 15 | Surge model | Who sets the multiplier and how? | Manual admin surge per zone/window, 1.0–2.5, frozen on the offer; automatic in V3 | no | D-26 |
| 16 | Tip visibility before accept | Show the customer's tip in the offer? | Yes; tip reductions become platform-funded adjustments | no | D-26 |
| 17 | Contractor tax handling | T4A slips? GST/HST collection? | Collect optional GST/HST number, issue annual summaries, no withholding; T4A deferred | no | D-26 |
| 18 | Payout schedule & instant cash-out | Weekly Monday transfers, $10 minimum, no on-demand payout in V1? | As specified; on-demand in V2 at $0.75, once/day | BLOCKING | D-28 |
| 19 | Performance enforcement thresholds | Do low metrics warn or deactivate? | Warn below 4.2 rating (min 20) or 80 % completion; no auto-deactivation in V1 | no | D-29 |
| 20 | SOS / rider safety | Is an in-app emergency button in V1? | Yes, minimal: 911 dial + ops P1 with location + emergency-contact SMS | no | D-32 |
| 21 | Undelivered food policy | What happens to the food after `UNDELIVERABLE`? | Return within 30 min if ≤5 km, else dispose; rider paid in full either way | BLOCKING | D-32 |

Additional decisions that fall outside the rider domain but block rider behaviour, raised for the record:

| # | Topic | Question | Proposed default | Owner domain |
|---|---|---|---|---|
| 22 | Dispatch trigger point | Does dispatch start at restaurant acceptance, or at `prep_time - travel_time` so the rider arrives as the food is ready? | Start at restaurant acceptance in V1 (simple, slightly more restaurant waiting); prep-time-aware dispatch in V2 | order |
| 23 | Customer cancellation window | Until which order status may a customer cancel without charge, and what does the assigned rider receive? | Free cancellation until `PICKED_UP`; rider receives cancellation compensation if past `ARRIVED_AT_PICKUP` | order/payment |
| 24 | Delivery fee vs rider pay | Is the customer's delivery fee independent of the rider's earnings (platform takes the spread), or a pass-through? | Independent: the customer fee is a pricing decision, the rider rate card is a cost; the two are never coupled in code | payment |

---

## 4. Cross-cutting acceptance gates for the rider domain

The domain is not "done" until all of these pass in CI against a live stack:

1. **No double assignment**: 500 concurrent accept-triples across 500 orders produce exactly 500 assignments and 1 000 `409 OFFER_ALREADY_TAKEN`.
2. **Availability always restores**: a randomised chaos test that kills the app, drops the network and cancels orders mid-flight leaves zero riders stuck in `ON_DELIVERY` after the reconciliation job.
3. **No money is computed on a client**: a static-analysis rule fails the build on arithmetic over any `*_cents` field in the mobile app.
4. **Every rejection/refund is real**: the no-rider path is covered by an integration test asserting a provider-side refund object exists.
5. **Offer countdowns agree**: a test asserts the client's rendered countdown and the server's `expires_at` differ by < 1 s under a 10-minute device clock skew.
6. **Secrets**: a bundle scan finds no `AIza…`, no hardcoded base URL, no committed rider UUID.
7. **Auth**: every `/riders/:id/...` endpoint is exercised with another rider's token and must return 403.
8. **Offline resilience**: the full delivery flow (arrive → pick up → in transit → deliver with POD) completes with the network disabled from `ARRIVED_AT_PICKUP` onwards and reconciles correctly on reconnect.
