---
covers:
  - apps/admin/**
  - services/hg/internal/admin/**
reviewed: 2026-10-05
---

# HalalGoes — ADMIN / SUPER ADMIN / SUPPORT AGENT Specification

**Status**: constrained specification, derived from `sow.txt` (Super Admin / Admin / Support Agent
sections), `scope/features-restaurant-admin-backend.md`, `fleet/hg-fe-admin-web.md`.
**Target**: Go modular monolith (Postgres 16 + Redis + [Silo](https://github.com/pgsty/silo), the maintained MinIO fork ([object storage](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)) + Traefik). One admin web app,
three roles, RBAC-differentiated.
**Date**: 2026-08-10. **Feature count**: 42 (V1 27 · V2 13 · V3 2).

Everything the SOW leaves vague is constrained here. Where a business rule could not be derived
from the sources, a `DECISION REQUIRED` block states the question and a proposed default; the spec
then proceeds as if the default were accepted. The consolidated RBAC permission matrix is §7 and all
decisions are collected in §8.

---

## 0. Conventions binding on every feature

### 0.1 Units, time, money, identity

| Concern | Constraint |
|---|---|
| Money | Integer minor units (cents). Column type `BIGINT`. Never float, never `@db.Money`. Field names end `_cents`. |
| Currency | `CAD` only in V1. Stored on every monetary row as `currency CHAR(3) NOT NULL DEFAULT 'CAD'`. |
| Time | All timestamps `TIMESTAMPTZ` stored UTC. All **business** rules (SLA clocks, expiry days, "business hours") evaluate in `America/Toronto`. |
| Business hours | Mon–Sun 08:00–22:00 `America/Toronto` unless a feature says otherwise. SLA clocks pause outside business hours; expiry clocks do not. |
| IDs | UUIDv7 (`uuid` column, time-ordered) for all entities. Exposed verbatim in the API. |
| Reasons | Every state-changing admin action requires `reason_code` (enum, per feature) **and** `reason_text` (free text, 10–1000 chars). Both are persisted and audit-logged. Missing either → `422`. |
| Idempotency | Every mutating admin endpoint accepts `Idempotency-Key` header (UUID). Replay within 24h returns the original response with `Idempotency-Replayed: true`. Refund and payout endpoints **require** it (`400` if absent). |
| Errors | `{"error":{"code":"SNAKE_CASE","message":"...","details":{...}}}`. Authorization failure is `403 FORBIDDEN_PERMISSION` with the missing permission key in `details.permission`. |

### 0.2 The three roles (fixed set, V1)

| Role key | Who | One-line mandate |
|---|---|---|
| `SUPER_ADMIN` | Platform owner / ops lead | Owns staff accounts, RBAC, money policy, platform config, tier-3 escalations. |
| `ADMIN` | Operations / compliance officer | Owns approval decisions (restaurant, halal, menu, rider), moderation, account states, refunds up to cap. |
| `SUPPORT_AGENT` | Front-line support | Owns cases. Reads almost everything, changes almost nothing. Assists, records, escalates. |

Hard invariants:

1. `SUPER_ADMIN` implicitly holds every permission. Permission checks resolve `SUPER_ADMIN` → allow,
   **except** where a feature names an explicit super-admin exclusion (there are exactly two: a staff
   user may never change their own role or permissions — A-01 R4; and a staff user may never approve
   their own escalated request — A-33 R6).
2. `SUPPORT_AGENT` holds **zero** permissions whose effect is irreversible or moves money without a
   second actor. Every support "action" is either (a) a record, (b) a request routed to `ADMIN`, or
   (c) a bounded action under a hard numeric cap.
3. Role is a property of the staff account, not of the session. There is no role switching, no
   "act as", no impersonation of a staff role in V1.

### 0.3 Shared entity: `staff_user`

```
staff_user
  id                 uuid pk
  email              citext unique not null
  password_hash      text not null            -- argon2id, m=64MiB t=3 p=4
  full_name          text not null
  role               text not null            -- SUPER_ADMIN | ADMIN | SUPPORT_AGENT
  status             text not null            -- INVITED|ACTIVE|SUSPENDED|DEACTIVATED
  mfa_enrolled       boolean not null default false
  mfa_secret_enc     bytea null               -- TOTP, envelope-encrypted
  mfa_recovery_codes bytea null               -- unused: recovery codes are not issued
  failed_login_count int not null default 0
  locked_until       timestamptz null
  password_changed_at timestamptz not null
  last_login_at      timestamptz null
  created_by         uuid null references staff_user(id)
  created_at         timestamptz not null
  status_changed_at  timestamptz null
  status_changed_by  uuid null references staff_user(id)
  deactivated_reason text null
```

### 0.4 Shared entity: `case` (the one support object)

Every complaint, dispute, incident, escalation target and assistance request is a `case`. There is
no second ticket table. This resolves the SOW's overlapping use of "complaint", "grievance",
"escalation", "dispute", "incident", "report".

```
case
  id                 uuid pk
  reference          text unique not null      -- HG-2026-000123, human-quotable
  type               text not null             -- SUPPORT_REQUEST|COMPLAINT|DISPUTE|INCIDENT|REPORT
  category           text not null             -- see per-feature enums
  tier               smallint not null default 1   -- 1 support, 2 admin, 3 super admin
  status             text not null             -- NEW|OPEN|PENDING_REQUESTER|PENDING_INTERNAL|RESOLVED|CLOSED|REJECTED
  priority           text not null             -- P1|P2|P3|P4
  subject_type       text not null             -- CUSTOMER|RESTAURANT|RIDER
  subject_id         uuid not null
  order_id           uuid null
  opened_by_type     text not null             -- CUSTOMER|RESTAURANT|RIDER|STAFF|SYSTEM
  opened_by_id       uuid not null
  assigned_staff_id  uuid null references staff_user(id)
  assigned_queue     text not null             -- TIER1_SUPPORT|TIER2_ADMIN|TIER3_SUPER_ADMIN
  first_response_due_at timestamptz not null
  resolution_due_at  timestamptz not null
  first_responded_at timestamptz null
  resolved_at        timestamptz null
  resolution_code    text null
  disputed_amount_cents bigint null            -- non-null iff type=DISPUTE
  liable_party       text null                 -- PLATFORM|RESTAURANT|RIDER|CUSTOMER|NONE (DISPUTE only)
  created_at, updated_at timestamptz not null
```

**Dispute vs escalation — the definition this spec uses everywhere:**

- A **dispute** is a *kind of case* (`type = DISPUTE`). It exists when two parties disagree about
  money that has already moved or is owed, and the resolution assigns liability
  (`liable_party`) and a monetary outcome. It always has `disputed_amount_cents`.
- An **escalation** is *not a case type*. It is a **routing event applied to any case**, recorded in
  `case_escalation`, that raises the case's `tier` and moves it to the next queue. A case may have
  0..n escalations. A dispute may be escalated; an escalation is never itself a dispute.

```
case_escalation
  id uuid pk, case_id uuid not null, from_tier smallint, to_tier smallint,
  escalated_by uuid references staff_user(id) null,   -- null = system auto-escalation
  reason_code text not null, reason_text text not null,
  sla_deadline_at timestamptz not null, accepted_by uuid null, accepted_at timestamptz null,
  created_at timestamptz not null
```

### 0.5 Shared entity: `audit_event` — see A-04. Every feature below that changes state writes
exactly one `audit_event` row inside the same database transaction as the change. If the audit write
fails, the change is rolled back. This is a hard invariant, not a best effort.

---

## 1. SUPER ADMIN — staff, access, accountability, configuration

### A-01 — Staff account provisioning

- **SOW trace**: *"Create and Manage Admins: Add, edit, or remove admins and assign roles/permissions."*
- **Behaviour**: A `SUPER_ADMIN` creates a staff account by submitting `email`, `full_name`, `role`.
  No password is set by the creator. The system creates the row with `status = INVITED` and emails a
  single-use invitation token (TTL 72h, one active token per account). The invitee sets a password
  (≥ 12 chars, checked against the Have-I-Been-Pwned k-anonymity range API; on API unavailability
  fall back to a bundled 100k-common-password list) and enrols TOTP MFA in the same flow. Only after
  both complete does `status` become `ACTIVE`. "Remove" is **never** a hard delete: it is
  `status = DEACTIVATED`, which revokes all sessions within 60 seconds and blocks login permanently
  unless a `SUPER_ADMIN` reactivates.
- **Data**: `staff_user` (§0.3); `staff_invitation {id, staff_user_id, token_hash, expires_at, consumed_at, created_by}`.
- **Role**: **Super Admin** only — create, edit role, suspend, deactivate, reactivate, resend invite.
  **Admin**: read the staff list (names, roles, status) only. **Support Agent**: denied entirely.
- **States**: `INVITED → ACTIVE` (invitation consumed + MFA enrolled) · `INVITED → DEACTIVATED`
  (revoke invite, or 72h expiry + 7 days) · `ACTIVE → SUSPENDED` (super admin action, reversible) ·
  `SUSPENDED → ACTIVE` (super admin action) · `ACTIVE|SUSPENDED → DEACTIVATED` (super admin action,
  reversible only by super admin) · `DEACTIVATED → ACTIVE` (reactivation forces a new invitation and
  new MFA enrolment).
- **Rules**:
  - R1 Email is unique across all staff, case-insensitive; reuse of a `DEACTIVATED` account's email
    reactivates that row rather than creating a second one.
  - R2 The platform must always retain ≥ 2 `ACTIVE` `SUPER_ADMIN` accounts. Any operation that would
    leave fewer → `409 LAST_SUPER_ADMIN`.
  - R3 A staff user cannot suspend, deactivate or change the role of their own account → `409 SELF_ACTION_FORBIDDEN`.
  - R4 Role changes are audit-logged with before/after and take effect on the target's next request
    (permission cache TTL 30s, plus an explicit cache bust on write).
  - R5 Deactivation cascades: open cases assigned to the account are returned to their tier queue as
    `assigned_staff_id = NULL` and re-prioritised; pending approval requests they raised remain valid.
  - R6 Passwords are never set, viewed or reset *to a known value* by another staff member. Reset is
    always token-by-email. Only a Super Admin resets a password or two-step sign-in by hand, after
    calling back the phone number on file and matching two account details, and no recovery codes
    are issued ([manual resets](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
- **Acceptance criteria**:
  1. Given a `SUPER_ADMIN`, when they POST a staff account with a valid email and role `ADMIN`, then
     a row is created with `status=INVITED`, no `password_hash`, and exactly one invitation email is
     sent with a token that hashes to `staff_invitation.token_hash`.
  2. Given an `ADMIN` session, when they POST to the staff-create endpoint, then the response is
     `403 FORBIDDEN_PERMISSION` with `details.permission = "staff.create"` and no row is created.
  3. Given exactly two `ACTIVE` super admins, when one deactivates the other, then the response is
     `409 LAST_SUPER_ADMIN` and both accounts remain `ACTIVE`.
  4. Given an `ACTIVE` staff account with two live sessions, when a super admin deactivates it, then
     both sessions fail their next authenticated request with `401 SESSION_REVOKED` within 60 seconds.
  5. Given an invitation issued 73 hours ago, when the invitee opens the link, then the response is
     `410 INVITATION_EXPIRED` and the account remains `INVITED`.
- **Out of scope**: SSO/SAML/OIDC; SCIM provisioning; per-user custom permission overrides (V3, see
  A-02); staff org-chart/manager hierarchy; hard deletion of staff rows.
- **Version**: V1 · **Size**: M

> **Decided:** no warning above 25 active staff accounts at launch ([staff account warning](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
> Open: whether a seat ceiling with a commercial consequence is ever needed.

---

### A-02 — Role-based access control model

- **SOW trace**: *"Role-Based Access Control: Define and manage access levels for admins, support teams, and other roles."* · *"Access to All Features and Modules for other management roles."*
- **Behaviour**: Authorization is a static, code-defined permission set evaluated per request. Every
  admin API handler declares exactly one required permission key (`domain.action`, snake_case, e.g.
  `restaurant.approve`). A middleware resolves `session → staff_user.role → permission set` and
  denies with `403` when absent. In V1 the role→permission mapping is a compile-time constant table
  (§7) — it is **not** editable at runtime, because an editable matrix with no second reviewer is a
  privilege-escalation surface. The UI reads `GET /admin/me/permissions` and hides any control whose
  permission is absent; hiding is cosmetic, the server check is authoritative.
- **Data**: `permission` (code constant: `key`, `description`, `sensitivity ∈ {READ, WRITE, MONEY, DESTRUCTIVE}`);
  `role_permission` (code constant map); `staff_session` (see A-03). No DB tables required in V1;
  V3 introduces `custom_role` + `custom_role_permission` with the same key vocabulary.
- **Role**: **Super Admin** — read the matrix, read the effective permissions of any staff user.
  **Admin** — read own permissions only. **Support Agent** — read own permissions only.
  Nobody may edit the matrix at runtime in V1.
- **States**: n/a (stateless evaluation). Permission cache in Redis keyed `perm:{staff_id}`, TTL 30s,
  busted on role change.
- **Rules**:
  - R1 Default deny. A handler with no declared permission fails startup (a boot-time assertion
    enumerates all routes and rejects any unannotated admin route).
  - R2 `SUPER_ADMIN` short-circuits to allow, except the two named exclusions (§0.2).
  - R3 Permission checks happen after authentication and before request-body validation, so a
    forbidden caller learns nothing about payload validity.
  - R4 Any permission with `sensitivity ∈ {MONEY, DESTRUCTIVE}` additionally requires the session to
    be MFA-verified within the last 12 hours (A-03 R4), else `403 REAUTH_REQUIRED`.
  - R5 Object-level authorization is separate and always applied: e.g. `case.update` allows updating
    a case only when `assigned_staff_id = self` or the caller's role is `ADMIN`/`SUPER_ADMIN`.
- **Acceptance criteria**:
  1. Given a `SUPPORT_AGENT` session, when they call any endpoint declaring `restaurant.approve`,
     then `403 FORBIDDEN_PERMISSION` and `details.permission = "restaurant.approve"`.
  2. Given a new admin route added without a declared permission, when the service boots, then boot
     fails with a fatal log naming the route.
  3. Given an `ADMIN` whose role is changed to `SUPPORT_AGENT`, when they issue a request 31 seconds
     later, then the request is evaluated with the `SUPPORT_AGENT` set.
  4. Given an `ADMIN` session whose last MFA verification was 13 hours ago, when they call
     `refund.issue`, then `403 REAUTH_REQUIRED` and no refund is created.
- **Out of scope**: runtime-editable roles (V3); attribute/region-scoped permissions (e.g. "admin for
  Ontario only"); delegation; time-boxed temporary elevation; permission inheritance trees.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-02 · Runtime-editable roles**: Does the client require the ability to
> create new roles and edit permissions in the UI, or is a fixed three-role model acceptable for
> V1–V2? · **Proposed default**: Fixed three roles in V1/V2; runtime custom roles in V3 with
> super-admin-only editing and mandatory audit. · **Why**: The SOW names exactly three roles, and a
> live-editable matrix is the single most common privilege-escalation defect in back-offices.

---

### A-03 — Staff authentication, MFA and session policy

- **SOW trace**: Implied by *"Audit Logs: View logs of all admin activities for accountability and security"* and the SOW's *"Data Security: industry-standard security measures"*. Replaces the current `localStorage` JWT model documented in `hg-fe-admin-web.md §7`.
- **Behaviour**: Staff sign in with email + password + TOTP. On success the server issues an opaque
  session token (32 bytes CSPRNG) stored server-side in Redis and delivered as an
  `HttpOnly; Secure; SameSite=Strict; Path=/` cookie scoped to the admin origin. No JWT, no token in
  `localStorage`, no token readable by JavaScript. Absolute session lifetime 12 hours; idle timeout
  30 minutes; sliding refresh on activity within those bounds. A CSRF token (double-submit,
  per-session) is required on every non-GET request.
- **Data**: `staff_session {id, staff_user_id, token_hash, created_at, last_seen_at, absolute_expires_at, ip, user_agent, mfa_verified_at, revoked_at, revoked_by}`; `staff_login_attempt {email, ip, succeeded, failure_reason, at}`.
- **Role**: All three roles authenticate through this. At launch every staff user can sign out
  everywhere; listing and ending single sessions is a later version ([launch scope](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  Then **Super Admin** may list and revoke any session, **Admin** and **Support Agent** only their own.
- **States**: session `ACTIVE → EXPIRED` (absolute or idle) · `ACTIVE → REVOKED` (self logout, staff
  deactivation/suspension, super-admin revoke, password change).
- **Rules**:
  - R1 Rate limit: 5 failed password attempts per account per 15 min → `locked_until = now + 15 min`;
    20 failed attempts per IP per 15 min → IP throttled. Lockout does not reveal account existence.
  - R2 Login response is identical (timing-normalised, same error `401 INVALID_CREDENTIALS`) for
    unknown email, wrong password, and non-`ACTIVE` account.
  - R3 MFA is mandatory for all three roles. An account without `mfa_enrolled` cannot reach `ACTIVE`.
  - R4 `mfa_verified_at` is stamped at login and re-stamped by a step-up prompt; MONEY/DESTRUCTIVE
    permissions require it within 12 hours (A-02 R4).
  - R5 Password change or reset revokes all other sessions for that account.
  - R6 Every login, logout, failure, lockout and revocation writes an `audit_event`.
- **Acceptance criteria**:
  1. Given valid credentials and a valid TOTP, when a staff user logs in, then the response sets an
     `HttpOnly; Secure; SameSite=Strict` cookie, the body contains no token, and a `staff_session`
     row exists with `mfa_verified_at = now`.
  2. Given 5 consecutive wrong passwords for an existing account, when a 6th attempt is made with the
     *correct* password within 15 minutes, then the response is `401 INVALID_CREDENTIALS` and no
     session is created.
  3. Given a session idle for 31 minutes, when the next request is made, then `401 SESSION_EXPIRED`
     and the Redis session key is absent.
  4. Given a POST without the CSRF header, when it reaches any admin mutating endpoint, then
     `403 CSRF_INVALID` and no state changes.
- **Out of scope**: WebAuthn/passkeys; SMS OTP for staff (phishable, and the SOW's SMS provider is
  itself unbuilt); IP allowlisting; device trust; "remember this device".
- **Version**: V1 · **Size**: M

---

### A-04 — Audit log (append-only, hash-chained)

- **SOW trace**: *"Audit Logs: View logs of all admin activities for accountability and security."*
- **Behaviour**: Every staff-initiated state change, every authentication event, every permission
  denial on a MONEY/DESTRUCTIVE permission, every system-initiated state change that affects a
  merchant/rider/customer (halal lapse, auto-suspension, auto-escalation), and every read of a
  sensitive document or unmasked PII field writes exactly one `audit_event` row **in the same
  transaction** as the change. The table is append-only: the application database role is granted
  `INSERT, SELECT` and explicitly **not** `UPDATE, DELETE` on it; a `BEFORE UPDATE OR DELETE` trigger
  raises an exception as defence in depth. Rows are chained: `hash = sha256(prev_hash || canonical_json(row_without_hash))`,
  chain per calendar day per shard, with the day's terminal hash written to a separate
  `audit_chain_seal` table at 00:05 America/Toronto and included in nightly backups.
- **Data**:
  ```
  audit_event
    id uuid pk (uuidv7)          occurred_at timestamptz not null
    actor_type text not null     -- STAFF | SYSTEM
    actor_staff_id uuid null     actor_role text null
    actor_ip inet null           actor_user_agent text null
    -- actor_ip is the client address the middleware chain works out (docs/spec/01-platform.md,
    -- "Deny-by-default routing and the middleware chain"): the one Traefik forwards, not Traefik's own
    action text not null         -- e.g. restaurant.approve, halal_certificate.reject, refund.issue
    target_type text not null    -- RESTAURANT|RIDER|CUSTOMER|ORDER|MENU_VERSION|CASE|STAFF_USER|SETTING|...
    target_id uuid not null
    before_json jsonb null       after_json jsonb null    -- field-level diff, PII-redacted per A-42
    reason_code text null        reason_text text null
    request_id uuid not null     correlation_id uuid null
    prev_hash bytea not null     hash bytea not null
  audit_chain_seal { seal_date date pk, terminal_hash bytea, event_count int, sealed_at timestamptz }
  ```
  `actor_ip` is the staff member's own address as the router resolves it behind Traefik
  ([`01-platform.md`, "P-06 — Deny-by-default routing and the middleware chain"](01-platform.md#p-06--deny-by-default-routing-and-the-middleware-chain),
  stage 3), never the proxy's.
- **Role**: **Super Admin** — read all events, export, run chain verification. **Admin** — read events
  whose `target_type` is an operational entity (`RESTAURANT`, `RIDER`, `CUSTOMER`, `ORDER`,
  `MENU_VERSION`, `CASE`, `HALAL_CERTIFICATE`), i.e. the compliance trail they are accountable for;
  **denied** events with `target_type ∈ {STAFF_USER, SETTING, ROLE}`. **Support Agent** — read events
  for a single entity only, reachable from that entity's page, last 90 days, no export.
  **Nobody**, including Super Admin, can edit or delete an event.
- **States**: an event has no lifecycle. The chain has: `OPEN` (today) → `SEALED` (after 00:05 next
  day) → `VERIFIED` / `TAMPER_SUSPECTED` (per nightly verification run).
- **Rules**:
  - R1 If the `audit_event` insert fails for any reason, the enclosing business transaction is rolled
    back and the API returns `500 AUDIT_WRITE_FAILED`. No silent degradation.
  - R2 `before_json`/`after_json` contain only the fields that changed, with values passing through
    the A-42 redaction filter (payment instrument data, full addresses and phone numbers are stored
    as `"<redacted:phone>"`; a stable `sha256` fingerprint is stored alongside so identical values
    can still be correlated without exposure).
  - R3 Retention: 7 years, then archival to cold object storage (Silo bucket with object-lock in
    compliance mode). Rows are never truncated inside the retention window.
  - R4 A nightly job re-computes the previous day's chain and writes the result; a mismatch raises a
    P1 alert to `SUPER_ADMIN` and marks the day `TAMPER_SUSPECTED`. It does **not** attempt repair.
  - R5 Reads of the audit log are themselves audited (`action = audit.read`), but audit-read events
    are excluded from the chain of the events they describe to avoid recursion — they land in the
    same table with `target_type = AUDIT_QUERY`.
- **Acceptance criteria**:
  1. Given any staff user, when they attempt `UPDATE audit_event SET reason_text=...` through the
     application database role, then the statement fails with insufficient privilege, and when
     attempted as the owner role, the trigger raises `audit_event is append-only`.
  2. Given a restaurant approval, when the transaction commits, then exactly one `audit_event` exists
     with `action='restaurant.approve'`, non-null `reason_code`, `before_json.verification_status='PENDING_REVIEW'`
     and `after_json.verification_status='APPROVED'`.
  3. Given an injected artificial edit to a sealed day's row, when the nightly verifier runs, then the
     day is marked `TAMPER_SUSPECTED` and a P1 alert is raised naming the first divergent `id`.
  4. Given a `SUPPORT_AGENT`, when they request the platform-wide audit export endpoint, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='audit.export'`.
  5. Given a simulated audit-table write failure, when an admin suspends a restaurant, then the
     response is `500 AUDIT_WRITE_FAILED` and the restaurant's status is unchanged.
- **Out of scope**: SIEM streaming (V2); external notarisation/blockchain anchoring; audit of
  customer-facing app actions (only staff and system actions on operational entities are in scope);
  replay/"undo from audit" tooling.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-03 · Audit retention period**: How long must staff audit events be
> retained, and does any Canadian obligation (PIPEDA, provincial consumer-protection, CRA record
> keeping) bind it? · **Proposed default**: 7 years hot+cold, cold storage under object-lock, no
> deletion path exposed in the product. · **Why**: 7 years is the CRA business-record norm and
> exceeds PIPEDA's minimum, so it is safe absent client legal input.

> **DECISION REQUIRED — D-04 · Admin visibility of staff-account audit events**: Should a regular
> `ADMIN` be able to see who created, suspended or re-roled staff accounts? · **Proposed default**:
> No — `target_type ∈ {STAFF_USER, SETTING, ROLE}` is Super-Admin-only. · **Why**: Staff-account
> churn is HR-adjacent information and separating it limits lateral reconnaissance.

---

### A-05 — Audit log viewer and export

- **SOW trace**: *"View logs of all admin activities for accountability and security."*
- **Behaviour**: A filterable, paginated, read-only view over `audit_event`. Filters: date range
  (required, max 90 days per query), `actor_staff_id`, `actor_role`, `action` (multi-select),
  `target_type`, `target_id`, `reason_code`, free-text over `reason_text`. Results are ordered by
  `occurred_at DESC, id DESC` and paginated by keyset cursor (`(occurred_at, id)`), never by OFFSET.
  Export produces a CSV or NDJSON file written to Silo and delivered as a presigned URL with 15-minute
  TTL; the export job itself is audited and capped at 250,000 rows per export.
- **Data**: read model over `audit_event`; `audit_export {id, requested_by, filter_json, row_count, object_key, status, created_at, completed_at, expires_at}`.
- **Role**: **Super Admin** — full filters, full export. **Admin** — filters restricted to operational
  `target_type`s (A-04), export limited to a single `target_id` at a time. **Support Agent** —
  entity-scoped timeline widget only (last 90 days, no export, no cross-entity filter).
- **States**: export `QUEUED → RUNNING → READY → EXPIRED` (15 min after READY) · `RUNNING → FAILED`.
- **Rules**:
  - R1 A query with no date range, or spanning > 90 days, is rejected `422 DATE_RANGE_REQUIRED` /
    `422 DATE_RANGE_TOO_WIDE`. This is a performance guardrail, not a permission.
  - R2 Exports are generated asynchronously; the presigned URL is single-use and the object is deleted
    from Silo 24 hours after generation.
  - R3 Indexes required: `(occurred_at DESC, id DESC)`, `(target_type, target_id, occurred_at DESC)`,
    `(actor_staff_id, occurred_at DESC)`, `(action, occurred_at DESC)`, GIN on `reason_text`.
- **Acceptance criteria**:
  1. Given 1,000,000 audit events, when an admin queries a 7-day window filtered by
     `target_type=RESTAURANT`, then the first page returns in < 500 ms p95 and uses the
     `(target_type, target_id, occurred_at)` or `(occurred_at)` index (verified by `EXPLAIN`).
  2. Given a super admin requests an export of 300,000 rows, then the request is rejected
     `422 EXPORT_TOO_LARGE` naming the 250,000 cap.
  3. Given a completed export, when its presigned URL is fetched a second time, then the fetch fails
     and an `audit.export_download` event exists for the first fetch only.
- **Out of scope**: saved searches; scheduled recurring exports (V3, A-10); log analytics/graphs.
- **Version**: V1 · **Size**: S

---

### A-06 — Global platform settings

- **SOW trace**: *"Global Settings: Configure platform-wide settings (e.g., currency, delivery fees)."*
- **Behaviour**: A typed, versioned key/value store. Each setting has a fixed key, a declared type and
  validation range in code, a current value, and an audit trail of every change. Money-affecting
  settings (`class = PRICING` or `PAYOUT`) require: (a) a `reason_code` + `reason_text`, (b) an
  `effective_from` timestamp at least 60 minutes in the future, and (c) a **second distinct
  `SUPER_ADMIN`** to approve before they take effect (four-eyes). Non-money settings apply
  immediately on save. Pricing settings are **never** applied retroactively: an order's pricing
  snapshot binds the setting version in force at cart-price time, and that version id is stored on
  the order.
- **Data**:
  ```
  platform_setting        { key text pk, class text, value_type text, current_version_id uuid, updated_at }
  platform_setting_version{ id uuid pk, key text, value_json jsonb, effective_from timestamptz,
                            created_by uuid, reason_code text, reason_text text, created_at,
                            approved_by uuid null, approved_at timestamptz null,
                            status text }  -- DRAFT|PENDING_APPROVAL|SCHEDULED|ACTIVE|SUPERSEDED|REJECTED
  ```
  V1 key set (exhaustive):

  | Key | Class | Type / range | Default |
  |---|---|---|---|
  | `currency` | CORE | enum, `CAD` only in V1 | `CAD` |
  | `delivery_fee_base_cents` | PRICING | int 0–2000 | `299` |
  | `delivery_fee_per_km_cents` | PRICING | int 0–1000 | `100` ([delivery fee](../decisions/README.md#settled--client-decisions)) |
  | `delivery_fee_cap_cents` | PRICING | int 0–5000 | `1500` |
  | `delivery_max_radius_km` | CORE | decimal 1–30 | `10` |
  | `platform_service_fee_bps` | PRICING | int 0–2500 (basis points) | `0` ([service fee](../decisions/README.md#settled--reconciliations)) |
  | `platform_service_fee_min_cents` | PRICING | int 0–1000 | `0` |
  | `min_order_subtotal_cents` | PRICING | int 0–10000 | `1000` |
  | `restaurant_accept_timeout_seconds` | CORE | int 60–600 | `180` |
  | `rider_offer_timeout_seconds` | CORE | int 20–120 | `45` |
  | `refund_cap_support_agent_cents` | PAYOUT | int 0–10000 | `2500` |
  | `refund_cap_support_agent_daily_cents` | PAYOUT | int 0–100000 | `15000` |
  | `refund_cap_admin_daily_cents` | PAYOUT | int 0–1000000 | `200000` |
  | `refund_four_eyes_threshold_cents` | PAYOUT | int 0–1000000 | `5000` (goodwill refunds, every role) |
  | `halal_cert_min_remaining_days` | COMPLIANCE | int 0–180 | `30` |
  | `halal_cert_warning_days` | COMPLIANCE | int[] | `[30,14,7,1]` |
  | `rider_doc_min_remaining_days` | COMPLIANCE | int 0–180 | `14` |
  | `onboarding_review_sla_hours` | SLA | int 1–168 | `48` |
  | `menu_review_sla_hours` | SLA | int 1–72 | `4` |
  | `case_first_response_sla_minutes` | SLA | map by priority | `{P1:15,P2:60,P3:240,P4:1440}` |
  | `case_resolution_sla_hours` | SLA | map by priority | `{P1:4,P2:24,P3:72,P4:168}` |
  | `tax_mode` | PRICING | enum `PROVINCE_TABLE`/`FLAT`/`NONE` | `PROVINCE_TABLE` |
- **Role**: **Super Admin** — read all, propose all, approve `PRICING`/`PAYOUT` changes proposed by a
  *different* super admin. **Admin** — read all; propose changes only to `SLA` and `COMPLIANCE`
  classes (which then require super-admin approval); denied `PRICING`, `PAYOUT`, `CORE`.
  **Support Agent** — read `SLA` and `CORE` values only (needed to quote timelines to users); denied
  everything else.
- **States**: version `DRAFT → PENDING_APPROVAL → SCHEDULED → ACTIVE → SUPERSEDED`; any of the first
  three → `REJECTED`.
- **Rules**:
  - R1 A `PRICING`/`PAYOUT` version cannot be approved by its creator → `409 SELF_APPROVAL_FORBIDDEN`.
  - R2 A value failing its declared type/range is rejected `422 SETTING_OUT_OF_RANGE` naming the bound.
  - R3 `currency` is immutable in V1; any write → `409 SETTING_IMMUTABLE`. Multi-currency is V3 and
    requires a currency column audit across every monetary table first.
  - R4 Reading the effective value is always `value_at(key, at_time)`; nothing reads
    `platform_setting.current_version_id` for historical computation.
  - R5 Rollback is a new version with the old value, never a deletion, and follows the same approval
    path.
  - R6 Every version transition writes an `audit_event` with the full before/after value.
- **Acceptance criteria**:
  1. Given super admin A proposes `delivery_fee_base_cents = 399`, when super admin A attempts to
     approve it, then `409 SELF_APPROVAL_FORBIDDEN` and the version stays `PENDING_APPROVAL`.
  2. Given the same version approved by super admin B with `effective_from = T+1h`, when an order is
     priced at `T+30m`, then the fee uses `299`, and when priced at `T+2h`, it uses `399`; the order
     row records the `platform_setting_version.id` actually used.
  3. Given an `ADMIN`, when they propose `platform_service_fee_bps = 500`, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='setting.propose_pricing'`.
  4. Given `delivery_fee_base_cents = 99999` is proposed, then `422 SETTING_OUT_OF_RANGE` with
     `details.max = 2000`.
- **Out of scope**: per-city / per-region setting overrides (V2); per-restaurant fee overrides;
  A/B-tested pricing; dynamic/surge pricing (SOW places it in V2.0 "dynamic pricing"); currency
  conversion.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-05 · Canadian sales tax handling**: Who computes GST/HST/PST/QST on food
> delivery — the platform (per province of delivery) or the restaurant? Are delivery and service fees
> taxable at the same rate as food? · **Proposed default**: `tax_mode = PROVINCE_TABLE`; the platform
> applies a province-keyed rate table to subtotal, delivery fee and service fee alike, storing the
> rate version on the order; a per-restaurant tax-exempt flag exists but defaults false.
> · **Why**: Delivery-fee taxability differs by province and getting it wrong is a remittance
> liability the client must own, so the rate table must be client-supplied and versioned.

> **Decided:** 0% commission at launch; the per-restaurant rate field stays and can be switched on ([platform commission](../decisions/README.md#settled--client-decisions)).

---

### A-07 — Promotions and campaigns

- **SOW trace**: *"Promotions and Campaigns: Create and manage platform-wide promotions, discounts."* · *"Promotions and Offers: Alerts about platform-wide promotions or campaigns that restaurants can participate in."*
- **Behaviour**: A `SUPER_ADMIN` creates a `promotion` with a discount rule, an eligibility rule, a
  budget and a validity window. Promotions are one of exactly three kinds: `CODE` (customer types a
  code), `AUTOMATIC` (applied when eligibility matches, no code), `TARGETED` (applied only to an
  explicit customer-id list). Discount is one of `PERCENT_OFF_SUBTOTAL` (with a mandatory cap),
  `FIXED_OFF_SUBTOTAL`, `FREE_DELIVERY`. The pricing engine evaluates promotions server-side only;
  the client never asserts a discount. Every redemption decrements a budget counter atomically; when
  `budget_remaining_cents < discount_cents` the promotion stops applying and moves to `EXHAUSTED`.
- **Data**:
  ```
  promotion { id, code citext unique null, kind, name, description,
              discount_type, discount_value, discount_cap_cents,
              min_subtotal_cents, starts_at, ends_at,
              budget_total_cents, budget_spent_cents, budget_reserved_cents,
              max_redemptions_total, max_redemptions_per_customer,
              eligibility_json,           -- {new_customers_only, restaurant_ids[], city[], first_order_only}
              funding_party,              -- PLATFORM | RESTAURANT | SPLIT
              funding_restaurant_share_bps,
              status, created_by, approved_by, created_at }
  promotion_redemption { id, promotion_id, customer_id, order_id, discount_cents, redeemed_at,
                         reversed_at null, reversal_reason null }
  ```
- **Role**: **Super Admin** — create, edit, pause, resume, end, and approve. **Admin** — read all
  promotions and read redemption reports; may **pause** a promotion (a safety valve for abuse) but may
  not create, edit budget, or resume. **Support Agent** — read a promotion's terms so they can explain
  it, and read a specific customer's redemptions; no write of any kind.
- **States**: `DRAFT → SCHEDULED` (approved, `starts_at` future) → `ACTIVE` (window open) →
  `PAUSED` (manual, reversible by super admin) → `ACTIVE` · `ACTIVE → EXHAUSTED` (budget or
  `max_redemptions_total` hit, terminal) · `ACTIVE|PAUSED|SCHEDULED → ENDED` (past `ends_at` or
  manual, terminal) · `DRAFT → CANCELLED`.
- **Rules**:
  - R1 `PERCENT_OFF_SUBTOTAL` without `discount_cap_cents` is rejected `422 CAP_REQUIRED`. This
    directly prevents the uncapped-percentage class of loss.
  - R2 Discount never applies to taxes, tips or the rider's payout. `FREE_DELIVERY` zeroes only the
    delivery fee line; the rider is still paid in full from platform funds.
  - R3 Exactly one promotion applies per order. No stacking in V1. If several are eligible, the one
    yielding the largest discount to the customer wins; ties break by earliest `starts_at`.
  - R4 Budget is reserved at price-quote time (`budget_reserved_cents`) with a 15-minute TTL and
    committed at payment capture; abandoned carts release the reservation. Redemption counting is a
    single `UPDATE ... WHERE budget_spent + budget_reserved + :d <= budget_total` — no read-then-write.
  - R5 Editing an `ACTIVE` promotion may only *reduce* exposure (lower cap, raise `min_subtotal`,
    shorten window, lower budget to ≥ spent). Any widening edit requires ending it and creating a new
    one → `409 PROMOTION_WIDENING_FORBIDDEN`.
  - R6 If an order carrying a redemption is refunded in full, the redemption is reversed and the
    budget released; partial refunds do not reverse the redemption.
  - R7 `funding_party = RESTAURANT` or `SPLIT` requires a recorded restaurant opt-in
    (`promotion_participation` row, restaurant-side accepted) before the promotion can reach `ACTIVE`
    for that restaurant.
- **Acceptance criteria**:
  1. Given a promotion with `budget_total_cents = 10000` and `9900` already spent, when two concurrent
     checkouts each try to redeem `200`, then exactly one succeeds, the other prices without the
     promotion, and `budget_spent_cents ≤ budget_total_cents` always holds.
  2. Given `PERCENT_OFF_SUBTOTAL` 50% with cap `1000` on a `$90` subtotal, when the order is priced,
     then the discount is `1000` cents, not `4500`.
  3. Given an `ADMIN`, when they attempt to raise a promotion's budget, then
     `403 FORBIDDEN_PERMISSION`; when they pause the same promotion, then `200` and status `PAUSED`.
  4. Given a fully refunded order that used promotion P, when the refund settles, then the
     `promotion_redemption` row has `reversed_at` set and `budget_spent_cents` decreases by the
     discount amount.
- **Out of scope**: referral programmes; loyalty points; restaurant-created promotions (that is the
  restaurant app's "Special Offers" feature, specified in the restaurant domain); push-notification
  campaign scheduling (V3); segmentation beyond the fixed `eligibility_json` keys; promo stacking.
- **Version**: V2 · **Size**: L

> **DECISION REQUIRED — D-07 · Promotion funding and restaurant consent**: When a platform-wide
> promotion discounts food sold by a restaurant, who absorbs the discount, and must the restaurant
> agree? · **Proposed default**: `funding_party = PLATFORM` by default (platform absorbs, restaurant
> is settled on the pre-discount subtotal); `RESTAURANT`/`SPLIT` require explicit per-restaurant
> opt-in. · **Why**: Silently reducing a merchant's settlement is a contractual dispute generator, so
> consent must be explicit and recorded.

---

### A-08 — Content management (FAQ, Terms, Privacy Policy)

- **SOW trace**: *"Content Management: Manage static content (e.g., FAQs, terms and conditions, privacy policy)."* Note the SOW's Out-of-Scope: *"Content Generation — Policies: Privacy Policy, Refund Policy, Riders Policy, Restaurant Policy, Terms of Service."*
- **Behaviour**: A versioned document store for legal and help content. The platform provides the
  *management system*; the client provides the *text* (SOW out-of-scope). Each document has a stable
  `key`, a locale, and an ordered version history. Publishing a version of a document whose
  `requires_acceptance` flag is true (T&C, Privacy Policy, Rider Policy, Restaurant Policy) creates an
  acceptance requirement: affected actors are prompted on next app open and their acceptance is
  recorded with the exact `version_id`, timestamp and IP. Content is authored in Markdown, rendered
  server-side to sanitised HTML (strict allow-list: headings, paragraphs, lists, links, emphasis,
  tables; all attributes stripped except `href` on `http(s)`/`mailto`), and cached at the edge.
- **Data**:
  ```
  content_document { key text pk, kind, locale_default, requires_acceptance bool,
                     audience text[],   -- CUSTOMER|RESTAURANT|RIDER|PUBLIC
                     current_version_id uuid null }
  content_version  { id uuid pk, key, locale, title, body_md, body_html,
                     status, effective_from, created_by, published_by, published_at,
                     change_summary text, created_at }
  content_acceptance { id, document_key, version_id, actor_type, actor_id, accepted_at, ip }
  faq_entry        { id, category, question, answer_md, sort_order, locale, status, updated_by, updated_at }
  ```
  V1 document keys: `terms_of_service`, `privacy_policy`, `refund_policy`, `rider_policy`,
  `restaurant_policy`, `halal_standards_statement`, `community_guidelines`.
- **Role**: **Super Admin** — create, edit, publish, unpublish any document; manage FAQ. **Admin** —
  create and edit FAQ entries and `community_guidelines` drafts; may **draft** but not **publish** any
  `requires_acceptance = true` document. **Support Agent** — read all published content; may propose
  an FAQ entry (creates a `DRAFT` FAQ owned by an admin queue); no publish.
- **States**: version `DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED`; `DRAFT|IN_REVIEW → DISCARDED`.
  Exactly one `PUBLISHED` version per `(key, locale)` at any instant; publishing archives the previous.
- **Rules**:
  - R1 A published version is **immutable**. Corrections create a new version. Unpublishing a legal
    document is forbidden if it would leave `(key, locale)` with no published version →
    `409 NO_PUBLISHED_VERSION`.
  - R2 `halal_standards_statement` — the public statement of what the platform's halal badge means —
    is `requires_acceptance = false` but publishing it requires the same four-eyes flow as a legal
    document, because it is the product's core claim.
  - R3 Acceptance requirements are enforced at the API gateway for the affected audience: an actor
    with an outstanding required acceptance receives `409 ACCEPTANCE_REQUIRED` with the document key
    and version on any non-read endpoint until they accept.
  - R4 Locale set in V1: `en-CA` (required) and `fr-CA` (optional). A missing `fr-CA` version falls
    back to `en-CA`; a *stale* `fr-CA` (older than the published `en-CA`) is flagged in the UI and
    still served with a "translation pending" marker.
  - R5 Every publish writes an `audit_event` with `change_summary` and a diff hash of `body_md`.
- **Acceptance criteria**:
  1. Given `terms_of_service` v3 is published, when a customer opens the app, then any non-read API
     call returns `409 ACCEPTANCE_REQUIRED` until they accept, after which a `content_acceptance` row
     exists with `version_id` of v3.
  2. Given an `ADMIN`, when they attempt to publish `privacy_policy`, then `403 FORBIDDEN_PERMISSION`
     with `details.permission='content.publish_legal'`; their draft is preserved.
  3. Given a published version, when any edit is attempted on it, then `409 VERSION_IMMUTABLE` and a
     new `DRAFT` is offered instead.
  4. Given Markdown containing `<script>alert(1)</script>`, when the version is published, then the
     rendered `body_html` contains no `<script>` element.
- **Out of scope**: writing the actual policy text (client-supplied per SOW); WYSIWYG editing;
  in-app content targeting/personalisation; blog/CMS for marketing pages (that is the website
  workstream); translation workflow tooling.
- **Version**: V2 · **Size**: M

---

### A-09 — Platform KPI dashboard

- **SOW trace**: *"Platform Analytics: View detailed reports on platform performance, including user growth, order volume, and revenue."*
- **Behaviour**: A single landing dashboard with a fixed, non-configurable set of tiles and three time
  ranges (`TODAY`, `LAST_7D`, `LAST_30D`, each with a same-length prior-period delta), all evaluated
  in `America/Toronto`. Tiles (exhaustive for V1): active customers, new customers, active
  restaurants, restaurants pending review, active riders, riders pending review, orders placed,
  orders delivered, orders cancelled, cancellation rate, gross merchandise value (`GMV`), net platform
  revenue (service fee + delivery margin − promotions − refunds), average order value, average
  delivery time, halal certificates expiring in 30 days, open cases by tier, SLA breaches today.
  Numbers are computed from read-optimised aggregates refreshed every 5 minutes, never by scanning
  live transactional tables on request.
- **Data**: `agg_platform_daily { day date pk, ... }` materialised nightly; `agg_platform_rolling`
  refreshed every 5 minutes into Redis with a `computed_at` stamp displayed in the UI. Definitions:
  `GMV = Σ order.subtotal_cents` for orders reaching `DELIVERED`; `active customer` = placed ≥ 1 order
  in the window; `active restaurant` = `status = LIVE AND is_accepting_orders = true` at any point in
  the window.
- **Role**: **Super Admin** — all tiles including revenue and margin. **Admin** — all tiles **except**
  net platform revenue and margin; sees GMV, volume, operational and compliance tiles.
  **Support Agent** — only the operational tiles: open cases by tier, SLA breaches, orders in flight,
  riders online. No financial tile.
- **States**: aggregate row `FRESH` (`computed_at` within 10 min) / `STALE` (older; the UI shows a
  warning banner and the timestamp rather than hiding the number).
- **Rules**:
  - R1 Every tile displays its `computed_at`. There is no tile without a freshness stamp.
  - R2 Money tiles render from integer cents with explicit `CAD` and never mix currencies or units.
    (This corrects the current dashboard's USD/PKR inconsistency noted in `hg-fe-admin-web.md §8`.)
  - R3 A tile whose underlying aggregate failed to refresh shows the last known value plus a `STALE`
    badge; it never shows `0` or a blank.
  - R4 Soft-deleted and test-flagged entities are excluded from every count; the exclusion predicate
    is shared by all aggregates (one SQL view, not per-query filters).
- **Acceptance criteria**:
  1. Given 3 orders delivered today totalling `$120.00` subtotal, when an admin opens the dashboard
     with range `TODAY`, then the GMV tile reads `CAD $120.00` and `orders delivered` reads `3`.
  2. Given a `SUPPORT_AGENT` session, when the dashboard loads, then the response payload contains no
     revenue or margin field at all (not merely hidden client-side).
  3. Given the aggregate refresher has not run for 20 minutes, when the dashboard loads, then every
     affected tile shows a `STALE` badge with the true `computed_at` and the last known value.
- **Out of scope**: custom dashboards; drill-down to row level (use A-05/A-38); cohort analysis;
  forecasting; AI insights (SOW V2.0 item, deferred); per-restaurant P&L.
- **Version**: V1 · **Size**: S

---

### A-10 — Scheduled reports and data export

- **SOW trace**: *"Analytics And Reporting: View detailed reports on platform performance…"* · *"Performance Reports: Generate detailed reports…"*
- **Behaviour**: Named, parameterised report definitions that can be run on demand or on a schedule
  and delivered as CSV/XLSX to a presigned Silo URL and/or emailed to a fixed staff distribution
  list. V3 report set: orders detail, restaurant settlement statement, rider earnings statement,
  refunds and disputes register, halal certification register (every restaurant, certificate, issuing
  body, expiry, verifier, decision), case/SLA performance, promotion redemption.
- **Data**: `report_definition {key, name, params_schema_json, required_permission}`;
  `report_run {id, definition_key, params_json, requested_by, schedule_id null, status, row_count, object_key, started_at, completed_at, error}`;
  `report_schedule {id, definition_key, params_json, cron, timezone, recipients[], created_by, enabled}`.
- **Role**: **Super Admin** — all reports, all schedules. **Admin** — operational and compliance
  reports (orders, halal register, cases, disputes); denied settlement/earnings/revenue reports.
  **Support Agent** — denied all report generation; may only export a single case's transcript.
- **States**: run `QUEUED → RUNNING → READY → EXPIRED`; `RUNNING → FAILED`. Schedule `ENABLED ⇄ DISABLED`.
- **Rules**:
  - R1 Reports execute against read replicas / aggregate tables, never the primary write path, and are
    hard-capped at 60 seconds and 1,000,000 rows.
  - R2 Every report run is audited with the exact parameters; the halal register and any report
    containing personal data is additionally tagged `contains_pii = true` and its download is audited.
  - R3 Report output objects expire after 7 days and are deleted by a sweeper.
  - R4 A schedule that fails 3 consecutive runs auto-disables and raises a P3 case to Tier 2.
- **Acceptance criteria**:
  1. Given an `ADMIN`, when they run the rider earnings statement report, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='report.run_financial'`.
  2. Given a scheduled halal register report at 07:00 America/Toronto, when the schedule fires during
     a DST transition, then it runs exactly once at 07:00 local.
  3. Given a report run exceeding 60 seconds, then it terminates with `status=FAILED`,
     `error='TIMEOUT'`, and no partial file is published.
- **Out of scope**: BI tool integration; ad-hoc SQL console; user-defined report builder; data
  warehouse ETL.
- **Version**: V3 · **Size**: M

---

### A-11 — Support team oversight

- **SOW trace**: *"Support Team Oversight: Monitor the performance of support teams and provide guidance."*
- **Behaviour**: A per-agent and per-queue performance view plus a quality-review workflow. Metrics
  per agent over a selected window: cases assigned, cases resolved, first-response time (median, p90),
  resolution time (median, p90), SLA breach count and rate, escalation rate (cases they escalated ÷
  cases handled), reopen rate (cases resolved by them that returned to `OPEN` within 7 days),
  refunds issued count and value, CSAT where collected. Quality review: a `SUPER_ADMIN` samples a case,
  scores it against a fixed 5-criterion rubric (accuracy, policy adherence, tone, resolution
  completeness, documentation quality; each 1–5), and records coaching notes visible to the agent.
- **Data**: `agent_metrics_daily {staff_id, day, ...}`; `case_quality_review {id, case_id, reviewed_staff_id, reviewer_staff_id, scores_json, total_score, coaching_note, acknowledged_at, created_at}`.
- **Role**: **Super Admin** — all agents' metrics, create and read quality reviews. **Admin** — queue
  and team aggregate metrics, plus per-agent metrics for agents handling cases they own; may read but
  not create quality reviews. **Support Agent** — own metrics and own quality reviews only, and must
  acknowledge each review.
- **States**: review `DRAFT → PUBLISHED → ACKNOWLEDGED`.
- **Rules**:
  - R1 An agent's metrics are never visible to another agent → object-level check on `staff_id = self`.
  - R2 Metrics exclude cases where the agent was the *escalation recipient* from their first-response
    numbers, so receiving escalations does not penalise the receiver.
  - R3 SLA breach attribution follows the assignee at the moment the deadline passed, not the current
    assignee.
  - R4 Quality reviews are audit-logged and immutable once `PUBLISHED`; corrections are new reviews.
- **Acceptance criteria**:
  1. Given agent X and agent Y, when X requests Y's metrics endpoint, then `403 FORBIDDEN_PERMISSION`.
  2. Given a case that breached its first-response SLA while assigned to X and was later reassigned to
     Y, when the breach report runs, then the breach is attributed to X.
  3. Given a published quality review, when the reviewer edits it, then `409 REVIEW_IMMUTABLE`.
- **Out of scope**: shift scheduling / workforce management; payroll; call recording; automated QA
  scoring; CSAT survey delivery mechanics (assumed provided by the notification module).
- **Version**: V3 · **Size**: M

---

### A-12 — Escalation routing and tiering

- **SOW trace**: *"Escalation Handling: Resolve high-priority escalations from admins, support teams, or users."* · *"Raise Escalations: Submit escalations to customer support…"* · *"Dispute Resolution: Track the status of escalations…"*
- **Behaviour**: Escalation is a routing operation on a `case` (§0.4), not a case type. Any staff
  member may escalate a case they are assigned to, one tier at a time, with a mandatory `reason_code`
  and `reason_text`. Escalation sets `tier = tier + 1`, sets `assigned_queue` to that tier's queue,
  clears `assigned_staff_id`, recomputes `resolution_due_at` from the tier's SLA, and writes a
  `case_escalation` row. **De-escalation** is permitted only downward-by-one and only by a staff member
  at the higher tier, with its own reason. The system also auto-escalates: a case whose
  `resolution_due_at` passes without resolution escalates automatically once
  (`escalated_by = NULL`, `reason_code = SLA_BREACH`), and a `P1` case auto-escalates to Tier 2 the
  moment it is created.
- **Data**: `case`, `case_escalation` (§0.4). `reason_code` enum: `NEEDS_HIGHER_AUTHORITY`,
  `EXCEEDS_REFUND_CAP`, `POLICY_EXCEPTION_REQUESTED`, `LEGAL_OR_REGULATORY`, `SAFETY_INCIDENT`,
  `HALAL_INTEGRITY_CONCERN`, `REPEAT_ISSUE`, `VIP_OR_MEDIA_RISK`, `SLA_BREACH`, `OTHER`.
- **Role**: **Support Agent** — escalate Tier 1 → Tier 2 on cases assigned to them; cannot escalate
  past Tier 2; cannot de-escalate. **Admin** — escalate Tier 2 → Tier 3; de-escalate Tier 2 → Tier 1;
  accept and work Tier 2. **Super Admin** — accept and work Tier 3; de-escalate Tier 3 → Tier 2;
  reassign any case to any queue or staff member.
- **States**: tier `1 → 2 → 3` (escalate) and `3 → 2 → 1` (de-escalate). Case status is orthogonal and
  unchanged by escalation, except that `RESOLVED`/`CLOSED` cases cannot be escalated
  (`409 CASE_NOT_ESCALATABLE`); they must be reopened first.
- **Rules**:
  - R1 Escalation is single-step. A jump from Tier 1 to Tier 3 → `422 ESCALATION_MUST_BE_SEQUENTIAL`,
    **except** `reason_code ∈ {SAFETY_INCIDENT, LEGAL_OR_REGULATORY, HALAL_INTEGRITY_CONCERN}` which
    may go straight to Tier 3 and simultaneously raise priority to `P1`.
  - R2 A case may be auto-escalated by SLA breach at most once per tier; a second breach at the same
    tier raises a P1 alert rather than escalating again.
  - R3 The escalating staff member remains a watcher on the case and receives resolution notification;
    they lose write access to the case body but retain read.
  - R4 Tier 3 is terminal: an unresolvable Tier 3 case is closed with
    `resolution_code = EXCEPTION_DECLINED` or `ESCALATED_OFFLINE`, never escalated further.
  - R5 Escalation never changes `disputed_amount_cents` or any money state on its own.
- **Acceptance criteria**:
  1. Given a Tier 1 case assigned to agent X, when X escalates with `reason_code=EXCEEDS_REFUND_CAP`,
     then `tier=2`, `assigned_queue=TIER2_ADMIN`, `assigned_staff_id=NULL`, a `case_escalation` row
     exists, and X still appears as a watcher.
  2. Given a Tier 1 case, when a support agent attempts to set `tier=3` directly, then
     `422 ESCALATION_MUST_BE_SEQUENTIAL` and the tier is unchanged.
  3. Given a Tier 2 case whose `resolution_due_at` has passed, when the SLA sweeper runs, then exactly
     one auto-escalation to Tier 3 occurs with `escalated_by IS NULL` and `reason_code='SLA_BREACH'`,
     and a second sweeper run 5 minutes later creates no further escalation.
  4. Given a case created with `priority=P1` by a support agent, when it is created, then it is
     already at `tier=2` with `assigned_queue=TIER2_ADMIN`.
  5. Given a `RESOLVED` case, when an admin escalates it, then `409 CASE_NOT_ESCALATABLE`.
- **Out of scope**: skills-based routing; round-robin auto-assignment beyond simple queue pull
  (V2); on-call paging integration; customer-visible escalation status beyond the case status already
  exposed.
- **Version**: V1 · **Size**: M

---

## 2. ADMIN — restaurant domain

### 2.0 The restaurant lifecycle (normative, referenced by A-13…A-22)

A restaurant has **two orthogonal state columns**. Conflating them is the defect in the current
system (`verification_status` doing double duty). They are:

**`onboarding_state`** — how far through registration the restaurant has progressed. Monotonic
except for explicit rework.

```
REGISTERED → EMAIL_VERIFIED → PROFILE_SUBMITTED → DOCUMENTS_SUBMITTED
   → UNDER_REVIEW → APPROVED → PAYOUT_PENDING → MENU_PENDING → READY
   (any of UNDER_REVIEW → CHANGES_REQUESTED → DOCUMENTS_SUBMITTED)
   (UNDER_REVIEW → REJECTED, terminal unless re-application)
```

**`account_state`** — whether the restaurant may trade right now. Only meaningful once
`onboarding_state = READY`.

| State | Initiated by | Reversible | Can receive new orders | Visible in customer discovery | Login |
|---|---|---|---|---|---|
| `LIVE` | system, on READY | — | Yes (subject to hours + accepting toggle) | Yes | Full |
| `DELISTED` | **system**, non-punitive (halal cert lapsed, docs expired, no approved menu) | Auto, when the cause clears | No | No | Full, with a blocking remediation banner; the menu stays editable ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
| `SUSPENDED` | **Admin**, punitive, reversible, optionally time-boxed | Yes, by Admin+ | No | No | Restricted: read own data, upload documents, respond to cases, edit opening hours ([hours while suspended](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)); the menu is locked for everyone, admins included: every menu write is `403 MENU_LOCKED` ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [how it is enforced](#a-19--menu-approval-queue)) |
| `BANNED` | **Admin** proposes, **Super Admin** confirms; punitive, permanent | Only by Super Admin | No | No | Blocked entirely (`403 ACCOUNT_BANNED`); the menu is locked for everyone, admins included: every menu write is `403 MENU_LOCKED` ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [how it is enforced](#a-19--menu-approval-queue)) |
| `DEACTIVATED` | **the restaurant itself**, or staff on the restaurant's written request; non-punitive voluntary exit | Yes, by the restaurant or Support Agent | No | No | Full, with a "reactivate" call to action; opening hours read-only |
| `CLOSED` | Super Admin, after `BANNED` or `DEACTIVATED` + retention period, or on erasure request | No — terminal | No | No | Blocked |

These six words mean exactly this everywhere in the product, in the API, and in the UI. `suspend`,
`ban`, `deactivate` and `delist` are never used as synonyms.

> **DECISION REQUIRED — D-08 · Ban authority**: Should a single `ADMIN` be able to permanently ban a
> restaurant or rider, or must a `SUPER_ADMIN` confirm? · **Proposed default**: Admin *proposes* a
> ban (entity moves to `SUSPENDED` with `ban_proposed = true`), Super Admin confirms within 7 days or
> it lapses back to `SUSPENDED`. · **Why**: Ban is the only irreversible commercial action against a
> paying partner and deserves two-person control.

---

### A-13 — Restaurant onboarding review queue

- **SOW trace**: *"Restaurant Onboarding: Review and approve restaurant registrations and documents."* · *"Document Verification: Upload and submit legal documents for verification. Track the verification status in real-time."*
- **Behaviour**: A work queue of restaurants in `onboarding_state = UNDER_REVIEW`, ordered by
  `submitted_at ASC` with a hard FIFO default (no cherry-picking): the queue exposes a
  **"Take next"** action that atomically assigns the oldest unassigned application to the requesting
  admin (`SELECT ... FOR UPDATE SKIP LOCKED`), and a filterable list view for inspection. An assigned
  application is locked to that admin for 60 minutes (`review_lock_expires_at`), after which it returns
  to the pool. The review screen presents, on one page: business identity fields, address + map pin,
  the four required documents with inline viewers, the halal certificate panel (A-15), and a single
  decision control (Approve / Request changes / Reject).
- **Data**:
  ```
  restaurant_application { restaurant_id pk, submitted_at, onboarding_state, submission_count int,
                           assigned_admin_id null, review_lock_expires_at null,
                           first_reviewed_at null, decided_at null, decided_by null,
                           decision text null, decision_reason_code null, decision_reason_text null,
                           sla_due_at }
  restaurant_document { id, restaurant_id, doc_type, object_key, original_filename, mime_type,
                        size_bytes, sha256, uploaded_at, uploaded_by_type, uploaded_by_id,
                        review_status, reviewed_by, reviewed_at, rejection_reason_code, notes,
                        expires_on date null, superseded_by_id null }
  ```
  `doc_type` enum (V1, Canada): `BUSINESS_REGISTRATION`, `FOOD_HANDLING_PERMIT`,
  `HALAL_CERTIFICATE`, `OWNER_GOVERNMENT_ID`, `VOID_CHEQUE_OR_BANK_LETTER` (optional if Stripe
  Connect completes), `LIABILITY_INSURANCE` (optional).
- **Role**: **Admin** — take next, view, request changes, decide (A-18). **Super Admin** — all of the
  above plus reassign a locked application and override a lock. **Support Agent** — read-only view of
  an application's status and which documents are missing or rejected, in order to help the restaurant
  (A-39); cannot take, decide, or view document *contents* beyond the document type and status.
- **States**: application `UNDER_REVIEW → CHANGES_REQUESTED` (documents rejected, restaurant must
  re-upload; returns to `DOCUMENTS_SUBMITTED` on re-submit, `submission_count += 1`) ·
  `UNDER_REVIEW → APPROVED` · `UNDER_REVIEW → REJECTED`.
- **Rules**:
  - R1 SLA: first decision (approve, reject, or request changes) within `onboarding_review_sla_hours`
    (default 48 business hours) of `submitted_at`. Breach creates a P2 case at Tier 2 naming the
    application. **There is no auto-approval on breach**, ever. Restaurants are told to expect a
    decision "within 3 business days" ([document review time](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
  - R2 An application cannot enter `UNDER_REVIEW` until all **required** `doc_type`s have at least one
    document in `review_status ∈ {PENDING, APPROVED}` and the profile has a resolvable address with
    coordinates (`ST_SetSRID(ST_MakePoint(lng,lat),4326)` populated — this closes the geo split-brain
    defect B16 by making coordinates an onboarding gate).
  - R3 Each document is reviewed independently (`review_status`: `PENDING → APPROVED | REJECTED`).
    A document rejection requires `rejection_reason_code` from a fixed enum: `ILLEGIBLE`, `EXPIRED`,
    `WRONG_DOCUMENT_TYPE`, `NAME_MISMATCH`, `ADDRESS_MISMATCH`, `INCOMPLETE_PAGES`, `SUSPECTED_FORGERY`,
    `UNACCEPTED_ISSUER`, `OTHER`.
  - R4 Documents are stored in a **private** Silo bucket. They are served only via presigned GET URLs
    with a 5-minute TTL, generated per request, and every generation writes an `audit_event`
    (`action='restaurant_document.view'`). No public bucket, ever. (This is the direct remediation of
    R9 in the feature inventory: KYC currently lands in a world-readable bucket.)
  - R5 Upload constraints: `mime_type ∈ {application/pdf, image/jpeg, image/png, image/webp}`,
    `size_bytes ≤ 10 MiB`, magic-byte sniffing must agree with the declared type, filenames are never
    used as object keys (key = `restaurants/{restaurant_id}/{doc_id}`), and every object is virus
    scanned before it becomes viewable (`review_status` stays `SCANNING` until clean).
  - R6 A suspected forgery is recorded as `FAIL` on the matching check (for a halal certificate, one of
    the seven halal checks) with a forgery note, and the reviewer then releases their claim. It
    immediately creates a P1 case at Tier 2; during the hold only a Super Admin decides, and the
    reviewer's screen is read-only ([suspected forgery](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
  - R7 Re-application after `REJECTED` is allowed after a 14-day cooldown, or immediately if the
    rejection reason is remediable (`ILLEGIBLE`, `INCOMPLETE_PAGES`, `EXPIRED`, `WRONG_DOCUMENT_TYPE`).
- **Acceptance criteria**:
  1. Given three applications submitted at T1 < T2 < T3, when two admins each press "Take next"
     concurrently, then one receives T1 and the other T2, neither receives the same application, and
     both have `review_lock_expires_at = now + 60m`.
  2. Given an application locked to admin A 61 minutes ago, when admin B presses "Take next", then B
     receives that application and A's subsequent decision attempt returns `409 REVIEW_LOCK_LOST`.
  3. Given a restaurant with no coordinates, when it submits documents, then the application is
     rejected `422 LOCATION_REQUIRED` and never enters `UNDER_REVIEW`.
  4. Given an admin opens a KYC document, when the presigned URL is generated, then an `audit_event`
     with `action='restaurant_document.view'` and the `doc_id` exists, and the URL fails after 5 minutes.
  5. Given an application at 49 business hours since submission with no decision, when the SLA sweeper
     runs, then a P2 case exists at Tier 2 referencing it and the application remains `UNDER_REVIEW`.
- **Out of scope**: automated OCR/document-data extraction (V3); third-party KYB/identity-verification
  vendor integration; credit checks; site inspection scheduling; multi-branch/chain onboarding as a
  single application (each location is its own restaurant record in V1).
- **Version**: V1 · **Size**: M

> **Decided:** business licence, food-safety permit, halal certificate and owner government ID are required; liability insurance is hidden until V2 ([required documents](../decisions/README.md#settled--reconciliations), [liability insurance](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).

---

### A-14 — KYC document review (non-halal documents)

- **SOW trace**: *"Review and approve restaurant registrations and documents."* · *"Restaurant Approval/Rejection: Approve or reject restaurant registrations based on submitted documents and compliance."*
- **Behaviour**: For each non-halal document the reviewing admin performs a fixed, recorded checklist
  and sets `review_status`. The checklist is stored, not merely performed, so that "what did we
  actually check" is answerable years later. Checks per document type:
  - `BUSINESS_REGISTRATION`: legal name matches the registered business name on the application
    (exact, or an approved trade-name alias recorded on the restaurant); registration number present;
    jurisdiction is a Canadian province/territory or federal; status not shown as dissolved on the
    document face.
  - `FOOD_HANDLING_PERMIT`: issuing municipality/health unit present; premises address matches the
    onboarding address; expiry date ≥ today + `rider_doc_min_remaining_days` equivalent for
    restaurants (`14` days); permit holder name matches business or owner name.
  - `OWNER_GOVERNMENT_ID`: government-issued photo ID; not expired; name matches the registered owner
    on the application; document type ∈ {driver's licence, passport, provincial photo card, PR card}.
- **Data**: `restaurant_document` (A-13) plus
  `document_check { id, document_id, check_key, result ENUM(PASS,FAIL,NOT_APPLICABLE), note text null, checked_by, checked_at }`.
  `check_key` is a fixed enum per `doc_type`; the set is closed and versioned
  (`checklist_version` stored on the document) so a policy change does not silently rewrite history.
- **Role**: **Admin** — perform and record checks, set `review_status`. **Super Admin** — same, plus
  override a prior `APPROVED`/`REJECTED` document decision with a mandatory reason.
  **Support Agent** — see only `doc_type`, `review_status`, `rejection_reason_code` and whether a
  re-upload is required; **cannot** open the document bytes or see the checklist notes.
- **States**: document `UPLOADED → SCANNING → PENDING → APPROVED | REJECTED`;
  `APPROVED|REJECTED → SUPERSEDED` when a newer document of the same `doc_type` is uploaded.
- **Rules**:
  - R1 A document may be set `APPROVED` only when every `check_key` for its type has a recorded result
    and none is `FAIL` → otherwise `422 CHECKLIST_INCOMPLETE` listing the missing keys.
  - R2 Setting `REJECTED` requires at least one `FAIL` check **and** a `rejection_reason_code`.
  - R3 The reviewing admin may not be the uploader (impossible for restaurant uploads, but enforced
    for A-39 staff-assisted uploads) → `409 SELF_REVIEW_FORBIDDEN`.
  - R4 Superseding a document resets its type's approval: the application returns to
    `CHANGES_REQUESTED`/`DOCUMENTS_SUBMITTED` and the new document starts at `SCANNING`.
  - R5 Document expiry dates are captured as structured `expires_on` at review time, not parsed
    automatically; a document type with an expiry must have `expires_on` set before it can be
    `APPROVED` → `422 EXPIRY_REQUIRED`.
- **Acceptance criteria**:
  1. Given a `BUSINESS_REGISTRATION` with 3 of 4 checks recorded, when the admin approves it, then
     `422 CHECKLIST_INCOMPLETE` with `details.missing=["jurisdiction_canadian"]`.
  2. Given a `FOOD_HANDLING_PERMIT` whose recorded `expires_on` is 10 days away, when the admin
     approves it, then `422 DOCUMENT_EXPIRES_TOO_SOON` naming the 14-day minimum.
  3. Given an approved document, when the restaurant uploads a newer one of the same type, then the
     old row becomes `SUPERSEDED`, the new row is `SCANNING`, and the application leaves `UNDER_REVIEW`.
  4. Given a `SUPPORT_AGENT`, when they request a document's presigned URL, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='restaurant_document.view_content'`.
- **Out of scope**: automated authenticity verification against government registries; handwriting or
  seal analysis; translation of non-English/French documents (must be submitted translated).
- **Version**: V1 · **Size**: M

---

### A-15 — Halal certification verification ★ core product function

- **SOW trace**: *"Halal Certification Verification: Verify and approve Halal certifications for restaurants. Track verification status (pending, approved, rejected)."* · Project goal: *"a central management entity to approve the restaurants against the submitted documents."* · Definition: *"Halal Certification: Official certification provided by recognized authorities confirming that food products comply with Islamic dietary laws."*
- **Behaviour**: This is the platform's product. A halal certificate is **not** a document with a
  yes/no toggle; it is a first-class entity with structured, admin-entered fields and a closed
  verification checklist. When an admin opens the halal panel they must transcribe, from the uploaded
  certificate, six structured fields: `certificate_number`, `issuing_body_id` (chosen from the
  accepted registry A-16 — free text is not permitted), `certified_legal_name`, `certified_address`,
  `issued_on`, `expires_on`, plus `scope` (`WHOLE_ESTABLISHMENT` | `KITCHEN_ONLY` |
  `SPECIFIC_MENU_ITEMS` | `SUPPLIER_CHAIN_ONLY`). They then record the result of each of **seven
  mandatory checks**. Approval requires all seven `PASS`. Rejection requires ≥ 1 `FAIL` and a reason
  code. Nothing here is inferred, OCR'd or auto-approved.

  **The seven checks (closed set, `halal_checklist_version = 1`):**

  | `check_key` | What the admin verifies | Auto-evaluable? |
  |---|---|---|
  | `H1_LEGIBLE_COMPLETE` | The scan is legible, all pages present, no visible alteration | No — human |
  | `H2_ISSUER_ACCEPTED` | `issuing_body_id` is `ACCEPTED` in the registry at the moment of review | **Yes** — system pre-computes, admin confirms |
  | `H3_NAME_MATCH` | `certified_legal_name` equals the restaurant's registered legal name or a recorded alias | **Yes** — system suggests, admin confirms/overrides with note |
  | `H4_ADDRESS_MATCH` | `certified_address` matches the onboarding premises address (or the certificate explicitly covers multiple listed premises including this one) | Partially — system normalises and compares, admin decides |
  | `H5_DATES_VALID` | `issued_on ≤ today` and `expires_on ≥ today + halal_cert_min_remaining_days` | **Yes** — hard-computed, admin cannot override |
  | `H6_SCOPE_SUFFICIENT` | `scope` covers what the restaurant will sell on the platform | No — human |
  | `H7_UNIQUE_NOT_REUSED` | `(issuing_body_id, certificate_number)` is not already `APPROVED` for a **different** restaurant | **Yes** — hard-computed, admin cannot override |

- **Data**:
  ```
  halal_certificate
    id uuid pk                    restaurant_id uuid not null
    document_id uuid not null     -- the restaurant_document row holding the scan
    certificate_number text not null
    issuing_body_id uuid not null references halal_issuing_body(id)
    certified_legal_name text not null
    certified_address text not null
    scope text not null
    issued_on date not null       expires_on date not null
    status text not null          -- PENDING | APPROVED | REJECTED | EXPIRED | REVOKED | SUPERSEDED
    checklist_version int not null
    verified_by uuid null         verified_at timestamptz null
    rejection_reason_code text null   rejection_reason_text text null
    revoked_by uuid null revoked_at timestamptz null revocation_reason_code text null
    superseded_by_id uuid null
    created_at, updated_at
    UNIQUE (issuing_body_id, certificate_number) WHERE status = 'APPROVED'
  halal_certificate_check { id, halal_certificate_id, check_key, result, note, checked_by, checked_at }
  ```
  `rejection_reason_code` enum: `ILLEGIBLE`, `EXPIRED_OR_EXPIRING`, `ISSUER_NOT_ACCEPTED`,
  `NAME_MISMATCH`, `ADDRESS_MISMATCH`, `SCOPE_INSUFFICIENT`, `DUPLICATE_CERTIFICATE`,
  `SUSPECTED_FORGERY`, `OTHER`.
- **Role**: **Admin** — transcribe fields, record checks, approve, reject. **Super Admin** — the same,
  plus `REVOKE` an already-approved certificate (the only path to invalidate a live certification for
  cause) and override `H2` by adding an issuing body to the registry (A-16). **Support Agent** —
  read `status`, `expires_on`, `issuing_body.name` and the rejection reason **only**, so they can
  explain the outcome to the restaurant; they cannot view the certificate image, edit fields, or
  record checks.
- **States**:
  `PENDING` (created on document upload) → `APPROVED` (all 7 PASS, admin decision) ·
  `PENDING → REJECTED` (≥1 FAIL) · `APPROVED → EXPIRED` (system, at `expires_on` end of day
  America/Toronto — see A-17) · `APPROVED → REVOKED` (Super Admin, for cause: issuer withdrawal,
  discovered forgery, integrity complaint upheld) · `APPROVED|REJECTED → SUPERSEDED` (a newer
  certificate for the same restaurant reaches `APPROVED`).
  The restaurant-level projection `restaurant.halal_status ∈ {NONE, PENDING, CERTIFIED, LAPSED, REJECTED, REVOKED}`
  is derived, never written directly.
- **Rules**:
  - R1 `H5` and `H7` are computed by the server and are **not overridable**: an admin who tries to set
    them `PASS` when the computation says otherwise receives `409 CHECK_NOT_OVERRIDABLE`.
  - R2 Approval requires all seven checks present and `PASS` → else `422 CHECKLIST_INCOMPLETE` /
    `422 CHECK_FAILED` naming the keys.
  - R3 Approving a halal certificate is **not** the same as approving the restaurant (A-18). It is a
    necessary but not sufficient condition; a restaurant with `halal_status = CERTIFIED` may still be
    rejected on other grounds.
  - R4 A restaurant may never reach `account_state = LIVE` without exactly one `APPROVED`,
    non-expired halal certificate. Enforced by a database check plus a service-layer guard.
  - R5 `H4` failure with a note "certificate lists multiple premises" may be overridden to `PASS` only
    when the admin attaches the page reference in `note` (min 20 chars) — the note is mandatory for
    any human override and is surfaced in the halal register report (A-10).
  - R6 A `REVOKED` certificate immediately triggers the A-17 lapse path (delist + notify), and creates
    a P1 case at Tier 3.
  - R7 Every field transcription, every check result, every decision writes an `audit_event`; the
    before/after of the transcribed fields is retained in full (these are not PII-redacted).
  - R8 The customer-facing "halal certified" badge renders **only** from
    `restaurant.halal_status = CERTIFIED`, and exposes `issuing_body.name`, `expires_on` and `scope`
    to the customer. No other path may set that badge.
- **Acceptance criteria**:
  1. Given a certificate whose `expires_on` is 20 days away and `halal_cert_min_remaining_days = 30`,
     when the admin records `H5_DATES_VALID = PASS`, then `409 CHECK_NOT_OVERRIDABLE` with
     `details.computed='FAIL'`, and the certificate cannot be approved.
  2. Given certificate number `ABC-123` from issuing body `X` already `APPROVED` for restaurant R1,
     when an admin reviews the same number/body for restaurant R2, then `H7_UNIQUE_NOT_REUSED`
     computes `FAIL`, approval returns `422 CHECK_FAILED`, and rejecting with
     `DUPLICATE_CERTIFICATE` succeeds.
  3. Given all seven checks `PASS`, when the admin approves, then `halal_certificate.status='APPROVED'`,
     `verified_by`/`verified_at` are set, `restaurant.halal_status='CERTIFIED'`, and exactly one
     `audit_event` with `action='halal_certificate.approve'` exists in the same transaction.
  4. Given a restaurant with no `APPROVED` halal certificate, when any code path attempts to set
     `account_state='LIVE'`, then the write fails with `409 HALAL_CERTIFICATE_REQUIRED`.
  5. Given a `SUPPORT_AGENT`, when they GET the halal certificate detail, then the response contains
     `status`, `expires_on`, `issuing_body_name`, `rejection_reason_code` and nothing else — no
     `document_id`, no `certified_address`, no check notes.
- **Out of scope**: automated verification against an issuing body's API or public register (no
  Canadian halal certifier exposes one uniformly — see D-11); on-site halal audit workflow; supplier
  /ingredient-level halal traceability; per-menu-item halal attestation (V3); machine reading of the
  certificate image.
- **Version**: V1 · **Size**: L

> **Decided:** a curated list seeded with the three Canadian bodies the client named; a Super Admin can add more at runtime ([accepted certifying bodies](../decisions/README.md#settled--client-decisions)).

> **DECISION REQUIRED — D-11 · Depth of certificate authenticity checking**: Is the admin's review a
> documentary check (fields consistent, issuer recognised, dates valid) or must the admin contact the
> issuing body to confirm the certificate exists? · **Proposed default**: Documentary check for V1,
> with an optional `issuer_confirmation` record (method: phone/email/portal, contacted person, date)
> that an admin *may* attach and that a Super Admin *may* require for specific issuing bodies via a
> per-body `requires_issuer_confirmation` flag. · **Why**: Mandatory out-of-band confirmation for
> every restaurant is not staffable at launch, but the record must exist for high-risk issuers.

> **DECISION REQUIRED — D-12 · Minimum remaining validity at approval**: How much certificate life
> must remain for approval? · **Proposed default**: 30 days (`halal_cert_min_remaining_days`),
> configurable, hard-enforced by `H5`. · **Why**: Approving a certificate that lapses next week
> guarantees an immediate delisting and a bad merchant experience.

> **DECISION REQUIRED — D-13 · Scope semantics**: What does the customer-facing badge promise when
> `scope = KITCHEN_ONLY` or `SUPPLIER_CHAIN_ONLY` — is the whole restaurant listable?
> · **Proposed default**: Only `WHOLE_ESTABLISHMENT` and `KITCHEN_ONLY` qualify for listing in V1;
> `SPECIFIC_MENU_ITEMS` and `SUPPLIER_CHAIN_ONLY` fail `H6` and are rejected pending per-item
> certification (V3). · **Why**: The platform cannot make an item-level halal claim it has no
> item-level data model for.

---

### A-16 — Halal issuing-body registry

- **SOW trace**: *"Official certification provided by recognized authorities"* — "recognized" requires a definition of who recognises them.
- **Behaviour**: A curated registry of certifying organisations. Each body has a name, aliases (for
  matching what is printed on certificates), country/region, website, an optional accreditation
  reference (e.g. a recognised accreditation scheme), a status, and a
  `requires_issuer_confirmation` flag (D-11). Only `ACCEPTED` bodies satisfy check `H2`. Adding or
  promoting a body is a Super Admin act with a mandatory justification, because it directly widens
  what the platform will call halal.
- **Data**:
  ```
  halal_issuing_body { id, name, aliases text[], country, region text null, website,
                       accreditation_ref text null, requires_issuer_confirmation bool,
                       status, notes, proposed_by, decided_by, decided_at, created_at }
  ```
- **Role**: **Super Admin** — create, accept, suspend, reject, edit. **Admin** — read; may **propose**
  a new body (`status = PROPOSED`) when a certificate names an unlisted issuer. **Support Agent** —
  read `name` and `status` only.
- **States**: `PROPOSED → ACCEPTED` (Super Admin) · `PROPOSED → REJECTED` · `ACCEPTED → SUSPENDED`
  (issuer under question; existing approved certificates are **not** auto-revoked but a P2 case is
  raised per affected restaurant and no new certificate from that issuer may be approved) ·
  `SUSPENDED → ACCEPTED` · `ACCEPTED|SUSPENDED → RETIRED` (issuer ceased; existing certificates run to
  their expiry, no renewals accepted).
- **Rules**:
  - R1 `H2_ISSUER_ACCEPTED` passes only for `status = ACCEPTED` **at the moment of certificate review**.
  - R2 Suspending or retiring a body writes an `audit_event` and enqueues one `case` per restaurant
    holding an approved certificate from that body, at Tier 2, priority P2, category
    `HALAL_ISSUER_STATUS_CHANGE`.
  - R3 Alias matching is case-insensitive, punctuation- and whitespace-normalised; the admin still
    confirms `H2` explicitly — matching is a suggestion, never an approval.
  - R4 A body cannot be deleted, only retired.
  - R5 When a certificate names a body that is not on the accepted list, the reviewer gives up their
    claim and sets the application to "waiting on certifying body". It is out of the queue while a
    Super Admin rules on the body, and comes back first in line afterwards ([certifying body not on the list](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01);
    needs a waiting state and a release action in the contract).
- **Acceptance criteria**:
  1. Given a body in `PROPOSED`, when an admin attempts to approve a certificate naming it, then
     `H2_ISSUER_ACCEPTED` computes `FAIL` and approval returns `422 CHECK_FAILED`.
  2. Given a body moves `ACCEPTED → SUSPENDED` while 12 restaurants hold approved certificates from
     it, then 12 cases exist at Tier 2 with category `HALAL_ISSUER_STATUS_CHANGE`, and those 12
     restaurants remain `LIVE`.
  3. Given an `ADMIN`, when they attempt to set a body `ACCEPTED`, then `403 FORBIDDEN_PERMISSION`;
     when they propose a body, then `201` with `status='PROPOSED'`.
- **Out of scope**: automated scraping of certifier registries; accreditation-scheme validation;
  per-province recognition differences (V3); certifier scoring or tiering.
- **Version**: V1 · **Size**: S

---

### A-17 — Halal certificate expiry monitoring and lapse handling

- **SOW trace**: *"Track verification status (pending, approved, rejected)"* combined with *"Compliance Monitoring: Ensure restaurants comply with platform policies"* — the SOW never says what happens on expiry; this feature defines it.
- **Behaviour**: A daily job at 03:00 `America/Toronto` evaluates every `APPROVED` halal certificate.
  At `expires_on − N` days for each `N ∈ halal_cert_warning_days` (default `[30,14,7,1]`) it notifies
  the restaurant (email + in-app) and, at `N = 30`, creates a Tier 2 case (`HALAL_RENEWAL_DUE`, P3) so
  an admin can chase. At `expires_on + 1 day` 00:00 local the certificate transitions to `EXPIRED`
  and the restaurant is **delisted**, not suspended: `account_state LIVE → DELISTED` with
  `delist_reason = HALAL_CERTIFICATE_EXPIRED`. Delisting removes the restaurant from discovery and
  blocks new orders **immediately**; in-flight orders follow A-29. When a replacement certificate is
  `APPROVED`, the system automatically returns the restaurant to `LIVE` if no other delist reason or
  punitive state applies — no manual reinstatement step, because the lapse was not a punishment.
- **Data**: `halal_certificate` (A-15); `restaurant.delist_reasons text[]` (a set, so multiple causes
  can coexist and each must clear independently); `restaurant_state_event` (A-22).
- **Role**: **System** performs the transition. **Admin** — may pre-emptively delist for halal reasons,
  may not extend an expiry. **Super Admin** — may grant a **grace extension** of up to 7 days, once
  per certificate, with mandatory reason (`ISSUER_DELAY`, `RENEWAL_IN_FLIGHT_EVIDENCE`, `OTHER`) and
  evidence note; this is audit-logged as a policy exception. **Support Agent** — read the expiry date
  and the renewal instructions; may open a `HALAL_RENEWAL_DUE` case and help the restaurant upload
  (A-39); may not extend anything.
- **States**: certificate `APPROVED → EXPIRING_SOON` (derived label, not a stored state) →
  `EXPIRED` (stored). Restaurant `LIVE → DELISTED` (add `HALAL_CERTIFICATE_EXPIRED` to
  `delist_reasons`) → `LIVE` (reason removed and set becomes empty).
- **Rules**:
  - R1 There is **no automatic grace period**. Expiry means delisted at 00:00 local the day after
    `expires_on`. The only grace is an explicit Super Admin extension (max 7 days, once).
  - R2 Delisting is idempotent and additive: if a restaurant is already `DELISTED` for another reason,
    the halal reason is appended; relisting requires `delist_reasons = {}`.
  - R3 A `SUSPENDED` or `BANNED` restaurant that also lapses does not become `DELISTED` — the punitive
    state dominates, but the halal reason is still recorded so reinstatement (A-22) cannot bypass it.
  - R4 The customer-facing badge and the restaurant's discovery record must both flip within 60
    seconds of the transition; the search index update is part of the same workflow, with a retry and
    an alert on failure. A restaurant showing a halal badge with an expired certificate is a P1 defect.
  - R5 The daily job is idempotent and safe to re-run; it is driven by `expires_on` comparison, not by
    a "processed" flag.
  - R6 Every warning, the lapse, the extension and the relist write `audit_event` rows with
    `actor_type = SYSTEM` where applicable.
- **Acceptance criteria**:
  1. Given a certificate with `expires_on = 2026-09-01`, when the job runs at 03:00 on 2026-09-02,
     then the certificate is `EXPIRED`, the restaurant is `DELISTED` with
     `delist_reasons ⊇ {HALAL_CERTIFICATE_EXPIRED}`, and it is absent from customer search within 60s.
  2. Given that restaurant, when an admin approves a replacement certificate, then the reason is
     removed, `delist_reasons` is empty, `account_state` returns to `LIVE` automatically, and the
     badge reappears — with no manual reinstate action recorded.
  3. Given a delisted-for-halal restaurant that is *also* `SUSPENDED` for a compliance violation, when
     a new certificate is approved, then the restaurant remains `SUSPENDED` and does not go `LIVE`.
  4. Given a Super Admin grants a 7-day extension, when the job runs the next day, then the
     certificate stays `APPROVED`, and when it runs on day 9, then it becomes `EXPIRED`; a second
     extension attempt returns `409 EXTENSION_ALREADY_USED`.
  5. Given a certificate expiring in 30 days, when the job runs, then exactly one
     `HALAL_RENEWAL_DUE` case exists (re-running the job the same day creates no duplicate).
- **Out of scope**: automatic renewal via issuer APIs; predicting renewal likelihood; suspending
  payouts on lapse (settlement of already-delivered orders continues normally).
- **Version**: V1 · **Size**: M

---

### A-18 — Restaurant approval / rejection decision

- **SOW trace**: *"Restaurant Approval/Rejection: Approve or reject restaurant registrations based on submitted documents and compliance."*
- **Behaviour**: The single decision endpoint for an application under review. `APPROVE` requires:
  every required document `APPROVED`; exactly one `APPROVED`, non-expired halal certificate;
  coordinates present; a decision `reason_code` and `reason_text`. On approval the restaurant moves
  `onboarding_state UNDER_REVIEW → APPROVED`, then automatically to `PAYOUT_PENDING` (Stripe Connect
  onboarding link issued to the restaurant) and, once payouts are enabled, to `MENU_PENDING`; it
  becomes `READY` and `account_state = LIVE` only when a menu version is approved (A-19). `REJECT` is
  terminal for that application (re-application per A-13 R7) and requires a reason code plus text that
  is sent verbatim to the restaurant. `REQUEST_CHANGES` names the specific documents to redo.
- **Data**: `restaurant_application` (A-13); `restaurant { id, ..., onboarding_state, account_state, halal_status, delist_reasons[], approved_by, approved_at, rejected_by, rejected_at, rejection_reason_code, rejection_reason_text }`.
  Decision reason codes — approve: `ALL_CHECKS_PASSED`, `APPROVED_WITH_NOTES`; reject:
  `HALAL_CERTIFICATION_INVALID`, `DOCUMENTS_INSUFFICIENT`, `IDENTITY_UNVERIFIED`,
  `OUTSIDE_SERVICE_AREA`, `PROHIBITED_CUISINE_OR_PRODUCT`, `SUSPECTED_FRAUD`, `DUPLICATE_APPLICATION`,
  `WITHDRAWN_BY_APPLICANT`, `OTHER`.
- **Role**: **Admin** — approve, reject, request changes. **Super Admin** — same, plus reverse a
  rejection within 30 days (`REJECTED → UNDER_REVIEW`) with a mandatory reason. **Support Agent** —
  none of these; may only read the outcome and explain it (A-39).
- **States**: as A-13, plus `REJECTED → UNDER_REVIEW` (Super Admin reversal, ≤ 30 days).
- **Rules**:
  - R1 Approval is blocked with `409 PRECONDITION_NOT_MET` and an itemised `details.blockers[]` when
    any of: a required document is not `APPROVED`; no `APPROVED` halal certificate; halal certificate
    `expires_on` within `halal_cert_min_remaining_days`; coordinates missing; an open P1 case of
    category `SUSPECTED_FORGERY` exists.
  - R2 The approving admin must be the admin holding the review lock (A-13) →
    `409 REVIEW_LOCK_LOST` otherwise.
  - R3 Approval and rejection are **not** silently idempotent: a second decision on an already-decided
    application returns `409 ALREADY_DECIDED` with the prior decision, rather than overwriting.
  - R4 Rejection reason text is customer-facing (sent to the restaurant); internal notes go in a
    separate `internal_note` field that is never transmitted.
  - R5 Approval alone does **not** make the restaurant discoverable — `LIVE` additionally requires an
    approved menu (A-19) and enabled payouts. This is the explicit answer to "does approval mean live":
    no.
  - R6 Every decision writes an `audit_event` with the complete blocker evaluation snapshot in
    `after_json.preconditions`, so a later question "what did we know when we approved?" is answerable.
- **Acceptance criteria**:
  1. Given an application with all documents approved but the halal certificate `PENDING`, when the
     admin approves, then `409 PRECONDITION_NOT_MET` with
     `details.blockers=["HALAL_CERTIFICATE_NOT_APPROVED"]`.
  2. Given a fully compliant application, when the holding admin approves, then `onboarding_state`
     becomes `APPROVED`, `approved_by`/`approved_at` are set, a Stripe Connect onboarding link is
     issued, `account_state` is **not** `LIVE`, and the restaurant does not appear in customer search.
  3. Given an approved restaurant that later completes payouts and gets menu v1 approved, then
     `onboarding_state='READY'` and `account_state='LIVE'` and it appears in search within 60s.
  4. Given an already-approved application, when a second admin approves it, then `409 ALREADY_DECIDED`
     naming the first decider and timestamp.
  5. Given a rejection 31 days ago, when a Super Admin attempts reversal, then
     `409 REVERSAL_WINDOW_EXPIRED` and the restaurant must re-apply.
- **Out of scope**: conditional/probationary approval tiers; automated approval; approval quotas or
  geographic rollout gating (V2); contract e-signature.
- **Version**: V1 · **Size**: M

---

### A-19 — Menu approval queue

- **SOW trace**: *"Menu Approval: Approve or reject restaurant menus and updates."*
- **Behaviour**: Menus are versioned. There are no menu drafts: every restaurant save is submitted
  straight away ([menu drafts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)); the
  submission is classified as **material** or **non-material** by a deterministic rule, and only
  material submissions enter the review queue.

  **Material change** (requires approval before it is visible to customers) — any of: a new item; a
  change to `name`, `description`, `ingredients`, `dietary_flags` or `allergens`; a new or changed
  item image; a price increase greater than 20% versus the currently published price; adding a
  category; any change to an item's `halal_relevant` attributes (e.g. alcohol, gelatin, cross-contact
  note).

  **Non-material change** (publishes immediately, logged, subject to post-hoc audit) — price change
  within ±20%; any price decrease; availability/out-of-stock toggle; sort order; category rename that
  does not add items; opening/closing hours.

  **The go-live question, answered**: the restaurant's **first** menu version is always material and
  **blocks go-live** — `account_state` cannot become `LIVE` until menu v1 is `APPROVED` (A-18 R5).
  Subsequent material changes do **not** take the restaurant offline; the previously approved version
  stays published and serving customers while the new version waits in review.

- **Data**:
  ```
  menu_version { id, restaurant_id, version_no int, status, change_classification,
                 submitted_at, submitted_by, reviewed_by, reviewed_at,
                 decision_reason_code, decision_reason_text, published_at,
                 diff_summary_json, sla_due_at, UNIQUE(restaurant_id, version_no) }
  menu_item_snapshot { id, menu_version_id, item_key, name, description, price_cents,
                       category, dietary_flags text[], allergens text[], ingredients text,
                       image_object_key, is_available, sort_order }
  menu_review_finding { id, menu_version_id, item_key null, finding_code, note, created_by, created_at }
  ```
  `finding_code` enum: `NON_HALAL_ITEM`, `ALCOHOL_CONTENT`, `MISLEADING_DESCRIPTION`,
  `PROHIBITED_CLAIM`, `IMAGE_NOT_REPRESENTATIVE`, `IMAGE_INAPPROPRIATE`, `PRICE_IMPLAUSIBLE`,
  `ALLERGEN_INFO_MISSING`, `DUPLICATE_ITEM`, `OTHER`.
- **Role**: **Admin** — review, approve, reject, approve-with-required-edits (rejects specific items
  while approving the rest). **Super Admin** — same, plus bulk-approve a backlog with a reason (an
  operational escape hatch, heavily audited). **Support Agent** — read queue position, SLA due time
  and findings so they can tell a restaurant why their menu is held; no decision authority; may not
  edit menus.
- **States**: save `→ PENDING_REVIEW` (material) · save `→ PUBLISHED` (non-material) ·
  `PENDING_REVIEW → APPROVED → PUBLISHED` · `PENDING_REVIEW → REJECTED` (the restaurant sees the
  findings and saves again) · `PENDING_REVIEW → PARTIALLY_APPROVED → PUBLISHED`
  (approved items publish, rejected item keys are held back and listed as findings) ·
  `PUBLISHED → SUPERSEDED`.
- **Rules**:
  - R1 SLA: `menu_review_sla_hours` (default 4 business hours) from `submitted_at` to first decision.
    Breach auto-escalates the associated case to Tier 2 and raises a P2. **No auto-approval on breach**
    — a menu is a halal-claim surface, and silence must never become consent.
  - R2 Exactly one `PUBLISHED` version per restaurant at a time. Publishing supersedes atomically; a
    customer's in-flight cart continues to price against the version snapshot captured at add-to-cart
    time until checkout, at which point a changed price forces a re-confirm.
  - R3 A restaurant with zero `PUBLISHED` menu versions cannot be `LIVE` → the system adds
    `NO_APPROVED_MENU` to `delist_reasons`.
  - R4 The classifier is deterministic, server-side, and its output is stored on the version
    (`change_classification`) with the computed diff. A restaurant cannot self-declare a change
    non-material.
  - R5 A price *increase* > 20% is material specifically to prevent bait-and-switch; the threshold is
    a setting, not a literal.
  - R6 Rejection requires ≥ 1 `menu_review_finding`. `NON_HALAL_ITEM` or `ALCOHOL_CONTENT` findings
    additionally create a Tier 2 case of category `HALAL_INTEGRITY` against the restaurant, because
    they bear on the certification claim.
  - R7 Admins may create menu categories and items on a restaurant's behalf, but never while it is
    suspended or banned: then nobody changes its menu, admins included; a delisted restaurant's menu
    stays editable ([menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)). An item an admin creates
    is approved on creation and audited, with the creating admin recorded as its reviewer
    ([menu approval](../decisions/README.md#settled--reconciliations)). Updating or removing an item on
    a restaurant's behalf is a launch operation ([launch scope](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01),
    [#182](https://github.com/shaiknoorullah/hg-mono/issues/182)) the contract has and the backend
    does not build yet; it never silently discards a restaurant edit that is waiting for review.
  - R8 The menu lock is enforced, not advisory ([#256](https://github.com/shaiknoorullah/hg-mono/issues/256)).
    While the restaurant's `account_state` is `SUSPENDED` or `BANNED`, every menu write on its behalf
    answers `403 MENU_LOCKED`, with the state in `details.account_state`, and writes nothing: creating,
    updating or removing a category or an item, and approving or rejecting one of its versions waiting
    for review, which stays `PENDING_REVIEW` until the suspension is lifted. The review queue still
    lists it, and every read stays open. `ADMIN` and `SUPER_ADMIN` are refused alike. A `DELISTED`
    restaurant is not locked. The check is the same one the restaurant's own menu writes make
    ([the menu lock](03-restaurant.md#r-15--menu-item-authoring)): each write locks the restaurant row
    and reads its state in the transaction that makes the write, so a write racing a suspension
    commits before it or is refused, never after it.
- **Acceptance criteria**:
  1. Given a restaurant with no published menu, when everything else is approved, then `account_state`
     is not `LIVE` and `delist_reasons` contains `NO_APPROVED_MENU`; when menu v1 is approved, then it
     becomes `LIVE`.
  2. Given a published item at `$10.00`, when the restaurant changes it to `$11.50` (+15%), then the
     version is classified non-material and publishes immediately; when it changes it to `$13.00`
     (+30%), then the version is `PENDING_REVIEW` and customers keep seeing `$10.00`.
  3. Given a `PENDING_REVIEW` version submitted 5 business hours ago, when the SLA sweeper runs, then
     the linked case is at Tier 2 with priority P2 and the version is still `PENDING_REVIEW`
     (not approved).
  4. Given a version with 12 items of which one is rejected with `ALCOHOL_CONTENT`, when the admin
     chooses partial approval, then 11 items publish, the rejected `item_key` does not, and a Tier 2
     `HALAL_INTEGRITY` case exists.
  5. Given an `ADMIN` creates a menu item on a restaurant's behalf, then the item is approved without
     entering the review queue, the admin is its recorded reviewer, and an `audit_event` exists.
  6. Given a suspended or banned restaurant with a version waiting for review, when a `SUPER_ADMIN`
     creates a menu item on its behalf or approves that version, then `403 MENU_LOCKED`, nothing is
     written, and the version is still `PENDING_REVIEW` in the queue; when the restaurant is delisted
     instead, then both succeed.
- **Out of scope**: nutritional-data validation; automated image moderation (V2); ingredient-level
  halal verification (V3); per-item halal certification.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — D-14 · Menu re-review scope**: When a restaurant submits one changed item,
> does the admin re-review the whole menu or only the diff? · **Proposed default**: Only the diff is
> presented for decision, with the full menu available as context; approval applies to the whole
> resulting version. · **Why**: Diff review is the only workload that scales, and versioning keeps
> the whole-menu snapshot intact for audit.

> **DECISION REQUIRED — D-15 · Material-change price threshold**: Is 20% the right bar for treating a
> price increase as material? · **Proposed default**: 20%, stored as
> `menu_material_price_increase_pct`. · **Why**: Low enough to catch bait-and-switch, high enough to
> avoid queueing routine inflation adjustments.

---

### A-20 — Restaurant compliance monitoring (violations register)

- **SOW trace**: *"Compliance Monitoring: Ensure restaurants comply with platform policies (e.g., pricing, food quality, delivery times)."*
- **Behaviour**: "Comply with platform policies" is made testable by a closed set of **violation
  types**, each with a machine-detectable or human-raised trigger, a severity weight, and a defined
  consequence ladder. A `compliance_violation` row is created either automatically by a nightly
  detector or manually by an admin from a case. Violations accrue **points** on a 90-day rolling
  window; crossing thresholds triggers automatic consequences.

  | `violation_type` | Trigger (evaluated over trailing 14 days unless stated) | Points | Detection |
  |---|---|---|---|
  | `HIGH_REJECTION_RATE` | rejected orders ÷ received orders > 20% with ≥ 20 orders | 2 | Auto |
  | `HIGH_CANCELLATION_RATE` | restaurant-caused cancellations > 10% with ≥ 20 orders | 3 | Auto |
  | `EXCESSIVE_PREP_TIME` | median accept→ready > 2× the restaurant's declared prep time, ≥ 20 orders | 2 | Auto |
  | `MENU_PRICE_MISMATCH` | verified complaint that in-store price ≠ platform price | 2 | Human |
  | `FOOD_QUALITY_COMPLAINTS` | ≥ 5 upheld quality complaints per 100 delivered orders | 3 | Auto + human upheld |
  | `MISSING_ITEMS_PATTERN` | ≥ 4 upheld missing-item disputes per 100 orders | 3 | Auto + human upheld |
  | `OPERATING_HOURS_MISREPRESENTED` | ≥ 3 auto-rejections outside declared hours | 1 | Auto |
  | `HALAL_INTEGRITY` | any upheld complaint or finding bearing on the halal claim | 10 | Human |
  | `DOCUMENT_LAPSE` | any required document expired while `LIVE` | 4 | Auto |
  | `ABUSIVE_CONDUCT` | upheld report of abusive conduct toward a rider or customer | 5 | Human |

  Consequence ladder on the 90-day rolling total: **≥ 5 points** → written warning (notification +
  case at Tier 2); **≥ 10 points** → mandatory acknowledgement by the restaurant before it can accept
  further orders; **≥ 15 points** → automatic `SUSPENDED` pending admin review; **`HALAL_INTEGRITY`
  alone** → immediate `SUSPENDED` and a Tier 3 P1 case, regardless of total.
- **Data**: `compliance_violation {id, restaurant_id, violation_type, severity_points, window_start, window_end, detected_by ENUM(SYSTEM,STAFF), detected_by_staff_id null, evidence_json, case_id null, status, disputed_at null, waived_by null, waive_reason null, created_at}`;
  `compliance_score_snapshot {restaurant_id, as_of_date, rolling_points, band}`.
- **Role**: **Admin** — raise a manual violation, review, uphold, or **waive** one with a reason
  (waiving zeroes its points and is audit-logged). **Super Admin** — same, plus change the ladder
  thresholds via A-06 (`COMPLIANCE` class). **Support Agent** — read a restaurant's violation summary
  (types, dates, points) so they can explain a suspension; may not raise or waive.
- **States**: violation `DETECTED → UPHELD` (default after 7 days if the restaurant does not dispute,
  or on admin confirmation) · `DETECTED → DISPUTED → UPHELD | WAIVED` · `UPHELD → WAIVED`
  (admin, with reason) · `UPHELD → EXPIRED` (rolls out of the 90-day window; points stop counting but
  the row is retained forever).
- **Rules**:
  - R1 Automatic detection never suspends without evidence: `evidence_json` must contain the order ids
    or case ids that produced the trigger, or the violation is not written.
  - R2 A violation may only be counted once per window per type; re-detection updates the existing row
    rather than stacking.
  - R3 Waiving requires `reason_text` ≥ 20 characters and is visible to the restaurant.
  - R4 Automatic suspension at ≥ 15 points sets `account_state = SUSPENDED` with
    `suspension_reason_code = COMPLIANCE_THRESHOLD` and creates a Tier 2 P2 case; an admin must
    explicitly reinstate (A-22) — it does not auto-clear when points decay.
  - R5 Points decay by window expiry only. There is no "good behaviour" credit in V1.
- **Acceptance criteria**:
  1. Given a restaurant with 40 orders of which 9 were rejected (22.5%), when the nightly detector
     runs, then one `HIGH_REJECTION_RATE` violation exists with `evidence_json.order_ids` of length 9,
     and a second run the same night creates no duplicate.
  2. Given a restaurant reaching 15 rolling points, when the detector runs, then `account_state`
     becomes `SUSPENDED` with `suspension_reason_code='COMPLIANCE_THRESHOLD'` and a Tier 2 case exists.
  3. Given a single upheld `HALAL_INTEGRITY` violation (10 points), then the restaurant is `SUSPENDED`
     immediately and a Tier 3 P1 case exists, even though 10 < 15.
  4. Given an admin waives a violation, then rolling points decrease by its severity, the restaurant
     is notified, and an `audit_event` with the waive reason exists; the violation row is not deleted.
- **Out of scope**: mystery shopping; health-inspection integration; automatic delisting on public
  health orders (requires an external feed the SOW does not fund); restaurant appeals workflow beyond
  the dispute flag.
- **Version**: V2 · **Size**: M

> **DECISION REQUIRED — D-16 · Compliance thresholds and consequences**: Are the point weights and
> the 5/10/15 ladder acceptable as platform policy, and must the restaurant contract reference them?
> · **Proposed default**: Ship the table above as the default policy, configurable per A-06, and
> publish it as `restaurant_policy` content (A-08). · **Why**: Enforcing unpublished thresholds
> against merchants invites disputes the platform will lose.

---

### A-21 — Restaurant performance monitoring

- **SOW trace**: *"Restaurant Performance Monitoring: Monitor key metrics like order volume, customer ratings, and compliance with platform policies."*
- **Behaviour**: A per-restaurant scorecard and a sortable cross-restaurant league table. Metrics,
  each with an explicit definition and a rolling 7/30/90-day window: orders received, orders accepted,
  acceptance rate, restaurant-caused cancellation rate, median accept latency (order created →
  accepted), median prep time (accepted → ready), on-time-ready rate (ready before the promised
  pickup time), GMV, average order value, average rating (1–5, ≥ 5 ratings required to display),
  rating distribution, upheld-complaint rate per 100 orders, refund rate and refunded value per 100
  orders, current compliance points (A-20), halal certificate days-to-expiry.
- **Data**: `agg_restaurant_daily {restaurant_id, day, orders_received, orders_accepted, orders_cancelled_by_restaurant, prep_time_ms_p50, accept_latency_ms_p50, gmv_cents, refund_cents, rating_sum, rating_count, complaints_upheld}` refreshed nightly plus a 15-minute rolling Redis view for today.
- **Role**: **Admin** — full scorecard and league table for all restaurants. **Super Admin** — same,
  plus revenue/margin columns. **Support Agent** — a single restaurant's operational summary
  (acceptance rate, prep time, current status) when opened from a case; no league table, no financials.
- **States**: n/a. A restaurant's displayed band is derived: `HEALTHY` / `WATCH` (any metric outside
  its threshold) / `AT_RISK` (compliance points ≥ 10 or two metrics outside threshold).
- **Rules**:
  - R1 Every metric shows its denominator and window; no rate is displayed with a denominator < 20.
  - R2 Ratings shown to staff are the same values shown to customers; there is no hidden score.
  - R3 The scorecard reads only from aggregates (A-09 R4 exclusion predicate applies).
  - R4 A metric that cannot be computed shows `—`, never `0`.
- **Acceptance criteria**:
  1. Given a restaurant with 12 orders in the window, when the scorecard renders, then acceptance rate
     shows `—` with a "insufficient volume (12/20)" note rather than a percentage.
  2. Given a `SUPPORT_AGENT` opens a restaurant from a case, then the payload contains no `gmv_cents`
     or `refund_cents` field.
  3. Given nightly aggregates for 90 days, when the league table sorts by median prep time, then the
     query completes in < 1s and reads only `agg_restaurant_daily`.
- **Out of scope**: predictive churn scoring; automated performance-based ranking in customer search
  (V3); restaurant-facing benchmark comparisons.
- **Version**: V2 · **Size**: M

---

### A-22 — Restaurant account state actions (suspend / ban / deactivate / reinstate / delist)

- **SOW trace**: *"Compliance Monitoring…"* · *"Account Management: Suspend or reinstate customer accounts based on violations or complaints."* (SOW states this for customers; the same vocabulary is applied to restaurants, where the current admin app already exposes verify/reject/suspend/ban/reinstate.)
- **Behaviour**: The single endpoint that moves `account_state`, implementing exactly the semantics in
  §2.0. Each action requires `reason_code`, `reason_text`, and — for `SUSPEND` — an optional
  `until_at` (time-boxed suspension; absent means indefinite). `BAN` follows the two-person rule
  (D-08): an admin's ban request sets `SUSPENDED` with `ban_proposed_by/at`; a Super Admin confirms
  (→ `BANNED`) or declines (→ stays `SUSPENDED`) within 7 days, else the proposal lapses.
  Every transition emits a `restaurant_state_event` and applies A-29 to in-flight orders.
- **Data**:
  ```
  restaurant_state_event { id, restaurant_id, from_state, to_state, action,
                           reason_code, reason_text, until_at null,
                           actor_type, actor_staff_id null, created_at,
                           in_flight_orders_snapshot jsonb }
  restaurant { ..., account_state, suspension_reason_code null, suspended_until null,
               ban_proposed_by null, ban_proposed_at null, banned_by null, banned_at null,
               delist_reasons text[] }
  ```
  `reason_code` (suspend/ban): `COMPLIANCE_THRESHOLD`, `HALAL_INTEGRITY`, `FOOD_SAFETY_RISK`,
  `FRAUD_SUSPECTED`, `PAYMENT_OR_SETTLEMENT_ISSUE`, `ABUSIVE_CONDUCT`, `LEGAL_ORDER`,
  `REPEATED_VIOLATIONS`, `MERCHANT_REQUEST`, `OTHER`.
- **Role**:
  - **Admin** — `SUSPEND`, `REINSTATE` (from `SUSPENDED` or `DEACTIVATED`), `PROPOSE_BAN`,
    `DEACTIVATE` on written merchant request.
  - **Super Admin** — all of the above plus `CONFIRM_BAN`, `UNBAN` (the only role that can),
    `CLOSE` (terminal), and reinstatement of a `BANNED` account.
  - **Support Agent** — none. A support agent who believes an account must be stopped escalates a case
    with `reason_code = SAFETY_INCIDENT` or opens a Tier 2 case; they never change account state.
- **States**: exactly the table in §2.0. Illegal transitions (e.g. `BANNED → LIVE` by an Admin,
  `CLOSED → anything`) return `409 ILLEGAL_STATE_TRANSITION` naming both states.
- **Rules**:
  - R1 A time-boxed suspension auto-expires: a job at 00:05 local returns the restaurant to `LIVE`
    **only if** `delist_reasons` is empty and no other punitive state applies; otherwise it becomes
    `DELISTED` with the remaining reasons.
  - R2 `REINSTATE` clears `suspension_reason_code` and `suspended_until` but never clears
    `delist_reasons` — a suspended-and-lapsed restaurant returns to `DELISTED`, not `LIVE`
    (this is A-17 R3 from the other direction).
  - R3 Suspension and ban immediately: remove the restaurant from search within 60s, block new order
    creation with `409 RESTAURANT_NOT_ACCEPTING`, and apply A-29 to in-flight orders. Payouts for
    already-delivered orders continue for `SUSPENDED`; for `BANNED` they are held pending final
    settlement and dispute resolution (see D-17).
  - R4 `DEACTIVATED` requires either a merchant-initiated request recorded on a case, or the merchant
    acting themselves; an admin deactivating without a linked case id → `422 MERCHANT_REQUEST_REQUIRED`.
  - R5 `BANNED` blocks login and blocks re-registration with the same business registration number,
    owner government ID number hash, or bank account fingerprint → a new application matching any of
    these is auto-flagged `DUPLICATE_APPLICATION` for admin review, not auto-rejected.
  - R6 Every action writes an `audit_event` **and** a `restaurant_state_event` carrying the in-flight
    order snapshot, so "what happened to those orders" is reconstructible.
- **Acceptance criteria**:
  1. Given a `LIVE` restaurant, when an admin suspends it with `until_at = now+72h`, then
     `account_state='SUSPENDED'`, it disappears from search within 60s, new order creation returns
     `409 RESTAURANT_NOT_ACCEPTING`, and A-29 is applied to its in-flight orders.
  2. Given that suspension expires and the restaurant's halal certificate is also expired, when the
     expiry job runs, then `account_state='DELISTED'` (not `LIVE`) with
     `delist_reasons=['HALAL_CERTIFICATE_EXPIRED']`.
  3. Given an admin proposes a ban, when 8 days pass with no Super Admin decision, then the proposal
     lapses (`ban_proposed_by` cleared), the restaurant remains `SUSPENDED`, and a Tier 3 case notes
     the lapse.
  4. Given a `BANNED` restaurant, when an `ADMIN` attempts `REINSTATE`, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='restaurant.unban'`.
  5. Given a banned owner's government ID hash, when a new application arrives with the same hash,
     then it is created with an automatic `DUPLICATE_APPLICATION` flag and appears in the review queue
     highlighted, not auto-rejected.
- **Out of scope**: partial suspension (e.g. suspend delivery but allow pickup — there is no pickup
  product in V1); geographic suspension; suspension of individual menu categories.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-17 · Payouts to a banned merchant**: When a restaurant is banned, are funds
> for already-delivered orders still paid out? · **Proposed default**: Yes, after a 30-day hold to
> allow chargebacks and disputes to settle, less any upheld refunds; withholding beyond that requires
> a Super Admin decision with a legal reason code. · **Why**: Withholding earned funds without a
> contractual basis is a legal exposure; a defined hold is defensible.

---

## 3. ADMIN — rider domain

Riders use the same two-column model as restaurants: `onboarding_state` and `account_state`, with the
identical six account states (§2.0), substituting `DELISTED → OFFLINE_FORCED` semantics: a rider whose
documents lapse cannot go on shift, but is not punished.

### A-23 — Rider onboarding review and approval

- **SOW trace**: *"Rider Onboarding: Review and approve rider registrations and documents."* · *"Signup/Register: Register with document upload, age verification, licence, phone and vehicle documents."* · *"Track Registration Verification Status… Support: Get support on verification rejections… Request For Reverification."*
- **Behaviour**: Structurally identical to A-13/A-14/A-18 but with the rider document set and rider-
  specific checks. A rider submits documents; the application enters `UNDER_REVIEW`; an admin takes it
  from a FIFO queue with a 60-minute lock, reviews each document against a recorded checklist, and
  decides `APPROVE` / `REQUEST_CHANGES` / `REJECT`. Approval moves the rider to `PAYOUT_PENDING`
  (Stripe Connect onboarding link) and then `READY`; `account_state` becomes `LIVE` only once payouts
  are enabled, so a rider can never be dispatched an order they cannot be paid for.

  **Required rider documents (V1, Canada)** and their recorded checks:

  | `doc_type` | Checks (all must PASS) | Expiry captured |
  |---|---|---|
  | `DRIVERS_LICENCE` (or `PROVINCIAL_ID` for bicycle/foot couriers) | legible; name matches profile; **holder ≥ 18 years old** (computed from DOB); class valid for the declared vehicle type; not expired and ≥ 14 days remaining; province is a served province | Yes |
  | `VEHICLE_REGISTRATION` | required iff `vehicle_type ∈ {CAR, SCOOTER, MOTORCYCLE}`; plate matches profile; registrant name matches rider or a declared owner with consent note | Yes |
  | `VEHICLE_INSURANCE` | required iff registration required; policy covers the plate; **commercial/delivery use not excluded** (admin confirms explicitly); not expired, ≥ 14 days remaining | Yes |
  | `WORK_ELIGIBILITY` | Canadian citizenship, PR, or a work permit permitting this work; document not expired | Yes (if permit) |
  | `PROFILE_PHOTO` | a clear face photo, matches the ID photo, no group shots, no obstruction | No |
  | `BANKING` | superseded by Stripe Connect; only required if Connect is unavailable | No |

- **Data**: `rider_application` and `rider_document` mirroring A-13's shapes, plus
  `rider { id, ..., date_of_birth, vehicle_type, licence_plate, onboarding_state, account_state, approved_by, approved_at, rejection_reason_code }`,
  and `document_check` reused with rider `check_key`s.
  Decision reason codes, the same split as a
  [restaurant decision](#a-18--restaurant-approval--rejection-decision) — approve:
  `ALL_CHECKS_PASSED`, `APPROVED_WITH_NOTES`; reject and request changes: the document rejection
  reasons (`ILLEGIBLE`, `EXPIRED`, `WRONG_DOCUMENT_TYPE`, `NAME_MISMATCH`, `DOB_MISMATCH`,
  `ADDRESS_MISMATCH`, `PLATE_MISMATCH`, `UNRECOGNISED_CERTIFIER`, `SUSPECTED_FORGERY`,
  `SUSPECTED_ALTERATION`, `INCOMPLETE_PAGES`, `OTHER`). `REQUEST_CHANGES` also names the documents
  to redo. An approval never carries a rejection reason: the API takes one body shape per decision
  ([#163](https://github.com/shaiknoorullah/hg-mono/issues/163)). The approval reason is kept on
  the decision's `audit_event`.
- **Role**: **Admin** — take, review, decide. **Super Admin** — same, plus reverse a rejection within
  30 days and override a document decision. **Support Agent** — only through a support case
  ([what support agents see](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)):
  read application status and which documents are missing/rejected, guide the rider through
  re-upload (A-39), and re-open a rejected
  application for re-submission (`REJECTED → CHANGES_REQUESTED`) **only** when the rejection reason is
  remediable (`ILLEGIBLE`, `EXPIRED`, `WRONG_DOCUMENT_TYPE`, `INCOMPLETE_PAGES`); never approve.
- **States**: `REGISTERED → PHONE_VERIFIED → PROFILE_SUBMITTED → DOCUMENTS_SUBMITTED → UNDER_REVIEW
  → APPROVED → PAYOUT_PENDING → READY`; `UNDER_REVIEW → CHANGES_REQUESTED → DOCUMENTS_SUBMITTED`;
  `UNDER_REVIEW → REJECTED`.
- **Rules**:
  - R1 Age ≥ 18 is computed from the ID's date of birth, is not overridable, and blocks approval →
    `422 AGE_REQUIREMENT_NOT_MET`.
  - R2 The document set required is a function of `vehicle_type`; changing `vehicle_type` after
    submission invalidates the vehicle documents and returns the application to `CHANGES_REQUESTED`.
  - R3 SLA: 48 business hours to first decision, same breach handling as A-13 R1, **no auto-approval**.
  - R4 A rider cannot be dispatched an order unless `account_state = LIVE` **and** every required
    document is `APPROVED` and unexpired. Dispatch queries this projection, not the raw application.
  - R5 Same private-bucket, presigned-URL, 5-minute-TTL, audited-view rules as A-13 R4/R5.
  - R6 Rejection reason text is sent verbatim to the rider along with the specific remediation step —
    this is the SOW's "Support: Get support on verification rejections".
  - R7 Rejecting a single document does not notify the rider; only the application decision does
    ([rider document rejection](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).
  - R8 After a rider's third resubmission the only decisions are approve or reject; requesting changes
    is no longer offered ([third resubmission](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
- **Acceptance criteria**:
  1. Given a rider whose licence DOB makes them 17, when the admin approves, then
     `422 AGE_REQUIREMENT_NOT_MET` and the application stays `UNDER_REVIEW`.
  2. Given a `CAR` rider with no `VEHICLE_INSURANCE` document, when they submit, then the application
     is not accepted into `UNDER_REVIEW` and the response lists the missing `doc_type`.
  3. Given an approved rider whose Stripe Connect onboarding is incomplete, then `account_state` is
     not `LIVE` and the dispatcher never offers them an order.
  4. Given a rider rejected for `ILLEGIBLE`, when a support agent re-opens the application, then its
     state is `CHANGES_REQUESTED`; given a rider rejected for `SUSPECTED_FRAUD`, then the same attempt
     returns `403 REOPEN_NOT_PERMITTED_FOR_REASON`.
  5. Given a rider changes `vehicle_type` from `BICYCLE` to `CAR` after approval, then the vehicle
     documents become required, `account_state` moves to `OFFLINE_FORCED`, and the rider cannot be
     dispatched until the new documents are approved.
- **Out of scope**: criminal-record/background checks (see D-18); driving-abstract retrieval; vehicle
  inspection; in-person onboarding; equipment (bag) issuance tracking.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-18 · Rider background checks**: Does HalalGoes require a criminal-record
> or driving-abstract check before a rider may deliver? · **Proposed default**: Not in V1 — the
> platform records a rider self-attestation and captures a `background_check_status` field
> (`NOT_REQUIRED` default) so a vendor can be plugged in later without a schema change.
> · **Why**: Background screening is a paid third-party integration the SOW does not fund, but the
> data model must not preclude it.

> **DECISION REQUIRED — D-19 · Insurance commercial-use requirement**: Must a rider's auto insurance
> explicitly permit commercial delivery use, and does the platform carry any coverage?
> · **Proposed default**: The admin must confirm the policy does not exclude delivery use; the
> platform provides no coverage and states so in `rider_policy`. · **Why**: Personal auto policies
> commonly exclude delivery, and this is the single largest liability gap in a courier platform.

---

### A-24 — Rider document expiry monitoring

- **SOW trace**: Implied by *"Track Registration Verification Status"* and by the licence/insurance documents having expiry dates; the SOW does not state expiry handling, so it is defined here.
- **Behaviour**: The same daily 03:00 job as A-17 evaluates every `APPROVED` rider document with an
  `expires_on`. Warnings at 30/14/7/1 days to the rider. At `expires_on + 1 day` the document becomes
  `EXPIRED`, and the rider's `account_state` moves `LIVE → OFFLINE_FORCED` with
  `offline_reasons ⊇ {DOCUMENT_EXPIRED:<doc_type>}`. The rider is removed from the dispatch pool
  immediately; any order currently assigned follows A-29's rider branch. When a replacement document
  is approved and no other reason remains, the rider returns to `LIVE` automatically.
- **Data**: `rider_document` (A-23); `rider.offline_reasons text[]`; reuses `rider_state_event`.
- **Role**: **System** performs the transition. **Admin** — may force-offline a rider for document
  reasons manually; may not extend an expiry. **Super Admin** — may grant a one-time 7-day grace with
  reason. **Support Agent** — read expiry dates, notify the rider, assist re-upload (A-39).
- **States**: document `APPROVED → EXPIRED → SUPERSEDED` (on replacement approval); rider
  `LIVE → OFFLINE_FORCED → LIVE`.
- **Rules**:
  - R1 Removal from the dispatch pool must be atomic with the state change: the Redis geo pool member
    is removed in the same workflow, with a reconciliation sweep every 5 minutes that removes any pool
    member whose `account_state ≠ LIVE`. (This closes defect B69, where going offline never removed
    the rider from `riders:active`.)
  - R2 A rider with an expired document may still open the app, see earnings, and upload documents —
    they simply cannot go on shift.
  - R3 Grace extensions are recorded as policy exceptions and reported in the compliance register.
  - R4 A replacement document turned down while the current one is still valid does not take the
    rider offline: the current document stays in force until it expires, and the rider is asked to
    upload again ([replacement document](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
- **Acceptance criteria**:
  1. Given a rider whose insurance expired yesterday, when the job runs, then `account_state` is
     `OFFLINE_FORCED`, they are absent from the `riders:active` geo pool, and a dispatch search in
     their area does not return them.
  2. Given that rider uploads and gets a new insurance document approved, then `offline_reasons` is
     empty and `account_state` returns to `LIVE` with no manual action.
  3. Given a rider manually removed from the pool but still `LIVE` due to a bug, when the 5-minute
     reconciliation runs, then pool membership matches `account_state` exactly.
- **Out of scope**: automatic renewal reminders by SMS (depends on the SMS provider); insurer
  integration; document auto-extraction of expiry dates.
- **Version**: V1 · **Size**: S

---

### A-25 — Rider performance monitoring

- **SOW trace**: *"Performance Monitoring: Track rider performance metrics (e.g., delivery times, customer ratings)."* · *"Performance Metrics: Track metrics like delivery time, customer ratings, and order completion rates."*
- **Behaviour**: Per-rider scorecard with defined metrics over 7/30/90-day windows: offers received,
  offers accepted, acceptance rate, offers expired-without-response, deliveries completed, completion
  rate (accepted → delivered), median pickup latency (assigned → picked up), median delivery latency
  (picked up → delivered), on-time rate against the customer-promised ETA, average customer rating
  (≥ 5 ratings to display), rating distribution, cancellations after acceptance, incidents (A-26)
  count by type, earnings (Super Admin/Admin only).
- **Data**: `agg_rider_daily {rider_id, day, offers, accepts, completions, pickup_ms_p50, delivery_ms_p50, on_time_count, rating_sum, rating_count, cancels_after_accept, earnings_cents}`.
- **Role**: **Admin** — full scorecard and cross-rider table. **Super Admin** — same plus earnings.
  **Support Agent** — a single rider's operational summary from a case, plus that rider's earnings
  **for the specific order under discussion only** (needed for A-36 payout questions); no cross-rider
  table.
- **States**: derived band `HEALTHY` / `WATCH` / `AT_RISK`, thresholds in `COMPLIANCE` settings.
- **Rules**:
  - R1 No rate displayed below a 20-event denominator; show `—` and the denominator.
  - R2 Acceptance rate excludes offers made while the rider had a live order (a rider is not penalised
    for being busy) and offers expired during a network outage window flagged by ops.
  - R3 Ratings below 3 automatically attach the associated order id so an admin can read context; a
    rating alone never triggers a state change.
- **Acceptance criteria**:
  1. Given a rider with 15 completed deliveries, when the scorecard renders, then on-time rate shows
     `—` with the denominator, not a percentage.
  2. Given offers made while the rider had an active order, when acceptance rate is computed, then
     those offers are excluded from both numerator and denominator.
  3. Given a `SUPPORT_AGENT` opens a rider from case C referencing order O, then the payload includes
     earnings for O only and no lifetime earnings total.
- **Out of scope**: gamification/tiers; automatic deactivation on low ratings; heat-map/utilisation
  planning; shift scheduling.
- **Version**: V2 · **Size**: M

---

### A-26 — Rider incident handling

- **SOW trace**: *"Incident Handling: Resolve rider-related incidents (e.g., disputes, accidents)."* · *"Report Incidents: Get support from the application support team to report incidents such as customer disputes, incorrect addresses, restaurant delays, order abandonment, etc."*
- **Behaviour**: An incident is a `case` with `type = INCIDENT` and a closed `category` set. Riders
  raise incidents from the rider app; support agents and admins may also raise them. Incident
  categories, each with a fixed default priority and required fields:

  | Category | Priority | Required fields | Immediate system action |
  |---|---|---|---|
  | `ACCIDENT_OR_INJURY` | P1 | free-text description, location, whether emergency services involved | Rider forced offline; current order reassigned; Tier 2 immediately |
  | `VEHICLE_BREAKDOWN` | P2 | location, order id if carrying | Current order reassigned; rider offline |
  | `CUSTOMER_ABUSE` | P1 | description, order id | Case at Tier 2; customer flagged for A-28 review |
  | `RESTAURANT_ABUSE_OR_DELAY` | P2 | restaurant id, order id, minutes waited | Compliance signal to A-20 |
  | `INCORRECT_ADDRESS` | P3 | order id, what was found | Routed to A-41 delivery-issue flow |
  | `UNSAFE_DELIVERY_LOCATION` | P2 | order id, description | Address flagged; future deliveries require confirmation |
  | `ORDER_ABANDONMENT` | P2 | order id, reason | Order reassigned or cancelled+refunded per A-29 |
  | `THEFT_OR_ROBBERY` | P1 | description, police report number if any | Rider offline; Tier 3; order cancelled+refunded |
  | `FOOD_DAMAGED_IN_TRANSIT` | P3 | order id, photo | Redelivery or refund decision (A-33) |

- **Data**: `case` (§0.4) with `type=INCIDENT`; `incident_detail {case_id pk, category, occurred_at, location_point, order_id null, emergency_services bool, description, evidence_object_keys text[], outcome_code null, liability_note null}`.
- **Role**: **Support Agent** — receive, triage, gather evidence, resolve `P3` categories, escalate
  `P1`/`P2` (which are auto-escalated on creation anyway). **Admin** — resolve `P2`, decide liability
  and any compensation up to their refund cap (A-33), force a rider offline, raise a compliance
  violation against a restaurant or customer. **Super Admin** — resolve `P1`, approve above-cap
  compensation, authorise ex-gratia payments.
- **States**: case lifecycle (§0.4). `outcome_code`: `RESOLVED_NO_FAULT`, `RIDER_AT_FAULT`,
  `RESTAURANT_AT_FAULT`, `CUSTOMER_AT_FAULT`, `PLATFORM_AT_FAULT`, `THIRD_PARTY`, `UNDETERMINED`.
- **Rules**:
  - R1 `ACCIDENT_OR_INJURY` and `THEFT_OR_ROBBERY` are P1 and auto-escalate to Tier 2 at creation and
    to Tier 3 on any `emergency_services = true` — the rider's safety path must never wait in a queue.
  - R2 An incident that forces a rider offline sets `offline_reasons ⊇ {INCIDENT:<case_id>}`; only an
    admin clearing the incident restores `LIVE` (unlike document lapses, this does not auto-clear).
  - R3 Every incident carrying an `order_id` must reach an order outcome (delivered, reassigned, or
    cancelled+refunded) before the case can be `RESOLVED` → `409 ORDER_OUTCOME_PENDING`.
  - R4 Evidence uploads follow the same private-bucket, scan-before-view, audited-access rules as KYC.
  - R5 Liability findings feed A-20 (restaurant) and A-25 (rider) but never automatically suspend an
    entity; suspension is always an explicit A-22/A-27 action.
- **Acceptance criteria**:
  1. Given a rider reports `ACCIDENT_OR_INJURY` with `emergency_services=true`, then the case is
     created at `tier=3`, `priority=P1`, the rider is `OFFLINE_FORCED`, and their live order enters
     reassignment within 60 seconds.
  2. Given an incident with `order_id` and no order outcome, when an admin resolves it, then
     `409 ORDER_OUTCOME_PENDING`.
  3. Given a support agent, when they attempt to resolve a P1 incident, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='incident.resolve_p1'`.
  4. Given an incident resolved `RESTAURANT_AT_FAULT` for a 40-minute wait, then a
     `RESTAURANT_ABUSE_OR_DELAY` compliance signal exists against that restaurant and the restaurant's
     state is unchanged.
- **Out of scope**: insurance claim filing; emergency-services dispatch integration; live location
  streaming to responders; legal case management.
- **Version**: V2 · **Size**: M

---

### A-27 — Rider account state actions

- **SOW trace**: *"Incident Handling…"* and the platform-wide account-management pattern the SOW states for customers.
- **Behaviour**: Identical semantics and vocabulary to A-22, applied to riders, with
  `OFFLINE_FORCED` replacing `DELISTED`. Actions: `FORCE_OFFLINE`, `SUSPEND`, `PROPOSE_BAN`,
  `CONFIRM_BAN`, `REINSTATE`, `DEACTIVATE` (rider-requested), `CLOSE`.
- **Data**: `rider_state_event` mirroring `restaurant_state_event`; `rider.offline_reasons text[]`,
  `suspension_reason_code`, `suspended_until`, ban fields.
  `reason_code`: `DOCUMENT_EXPIRED`, `INCIDENT_UNDER_INVESTIGATION`, `SAFETY_RISK`, `FRAUD_SUSPECTED`,
  `REPEATED_CANCELLATIONS`, `ABUSIVE_CONDUCT`, `LOW_PERFORMANCE`, `ACCOUNT_SHARING`, `LEGAL_ORDER`,
  `RIDER_REQUEST`, `OTHER`.
- **Role**: **Admin** — force offline, suspend, reinstate, propose ban, deactivate on request.
  **Super Admin** — confirm/reverse ban, close. **Support Agent** — none; escalate instead.
- **States**: `LIVE ⇄ OFFLINE_FORCED`, `LIVE|OFFLINE_FORCED → SUSPENDED ⇄ LIVE`,
  `SUSPENDED → BANNED` (two-person), `→ DEACTIVATED ⇄ LIVE`, `→ CLOSED` (terminal).
- **Rules**:
  - R1 Any state other than `LIVE` removes the rider from the dispatch pool within 60 seconds and is
    reconciled every 5 minutes (A-24 R1).
  - R2 `ACCOUNT_SHARING` (a different person delivering) is treated as fraud: immediate `SUSPENDED`
    plus a Tier 2 P1 case; confirmation leads to ban proposal.
  - R3 A rider carrying an order cannot be hard-stopped mid-delivery by a state change alone; the
    state change is applied and A-29's rider branch decides the order's fate. `SAFETY_RISK` and
    `THEFT_OR_ROBBERY` are the exceptions: the order is immediately reassigned or cancelled+refunded.
  - R4 Banned riders are blocked from re-registration by phone hash, government ID hash and bank
    fingerprint, with the same "flag for review, do not auto-reject" rule as A-22 R5.
  - R5 Earned but unpaid rider earnings are paid on the normal schedule for `SUSPENDED`; for `BANNED`
    they follow D-17's hold rule.
  - R6 Reinstatement notifies the rider, like an application decision ([reinstatement](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
- **Acceptance criteria**:
  1. Given a `LIVE` rider carrying order O, when an admin suspends them for `SAFETY_RISK`, then O
     enters reassignment immediately and the rider is removed from the pool within 60s.
  2. Given a `LIVE` rider carrying order O, when an admin suspends them for `LOW_PERFORMANCE`, then O
     completes normally and the rider is removed from the pool only after O reaches a terminal state.
  3. Given a banned rider's phone hash, when a new rider registers with the same number, then the
     application is created and flagged, not blocked silently.
- **Out of scope**: partial restrictions (e.g. banned from a single restaurant); geographic
  restrictions; probationary reinstatement with reduced dispatch priority.
- **Version**: V1 · **Size**: S

---

## 4. ADMIN — customer, content and reports

### A-28 — Customer account state actions

- **SOW trace**: *"Account Management: Suspend or reinstate customer accounts based on violations or complaints."*
- **Behaviour**: Same six-state vocabulary (§2.0) applied to customers, with `DELISTED` inapplicable.
  Additional customer-specific control: `ORDERING_RESTRICTED` — a partial state in which the customer
  may log in, browse and contact support but may not place orders, used for payment-failure and
  refund-abuse cases where a full suspension is disproportionate.
- **Data**:
  ```
  customer { id, ..., account_state, restriction_reason_code null, suspended_until null,
             ban_proposed_by null, banned_by null, banned_at null,
             refund_abuse_score int, deletion_requested_at null }
  customer_state_event { id, customer_id, from_state, to_state, action, reason_code, reason_text,
                         until_at, actor_type, actor_staff_id, case_id null, created_at }
  ```
  `reason_code`: `PAYMENT_FAILURE_UNRESOLVED`, `REFUND_ABUSE`, `FRAUDULENT_CHARGEBACK`,
  `ABUSIVE_CONDUCT_TO_RIDER`, `ABUSIVE_CONDUCT_TO_RESTAURANT`, `FAKE_REVIEWS`, `ACCOUNT_TAKEOVER_RISK`,
  `PROMOTION_ABUSE`, `LEGAL_ORDER`, `CUSTOMER_REQUEST`, `OTHER`.
- **Role**: **Admin** — restrict, suspend, reinstate, propose ban, deactivate on request.
  **Super Admin** — confirm ban, unban, close (including PIPEDA erasure execution).
  **Support Agent** — may set `ORDERING_RESTRICTED` **only** for `PAYMENT_FAILURE_UNRESOLVED`, which is
  a factual, reversible, non-punitive state; everything else is escalated.
- **States**: `ACTIVE ⇄ ORDERING_RESTRICTED`, `ACTIVE|ORDERING_RESTRICTED → SUSPENDED ⇄ ACTIVE`,
  `SUSPENDED → BANNED` (two-person), `ACTIVE → DEACTIVATED ⇄ ACTIVE`, `→ CLOSED` (terminal, erasure).
- **Rules**:
  - R1 A customer with an in-flight order cannot be moved to `BANNED` until those orders reach a
    terminal state or are cancelled per A-29 → `409 IN_FLIGHT_ORDERS_PRESENT` listing the order ids.
  - R2 `REFUND_ABUSE` requires evidence: at least 3 upheld-then-reversed refund patterns or a
    documented pattern in `evidence_json`; a bare assertion → `422 EVIDENCE_REQUIRED`.
  - R3 `CLOSED` executes deletion per the platform's retention policy: personal identifiers are
    erased/pseudonymised, while order and financial records are retained in anonymised form for the
    statutory period (orders keep a stable `customer_ref` hash, not a name, email or phone).
  - R4 Suspension does not void outstanding refunds owed to the customer; they are paid regardless.
  - R5 Every action requires a linked `case_id` when the trigger was a complaint or report.
- **Acceptance criteria**:
  1. Given a customer with an order in `PREPARING`, when an admin bans them, then
     `409 IN_FLIGHT_ORDERS_PRESENT` naming the order.
  2. Given a support agent, when they set `ORDERING_RESTRICTED` with `PAYMENT_FAILURE_UNRESOLVED`,
     then `200`; when they attempt it with `REFUND_ABUSE`, then `403 FORBIDDEN_PERMISSION`.
  3. Given a `CLOSED` customer, when their historical orders are queried, then no name, email, phone
     or address is returned and a stable `customer_ref` is present.
  4. Given a suspended customer owed a `$14.20` refund, when the refund executes, then it succeeds and
     the suspension is unaffected.
- **Out of scope**: device/IP-level blocking; fraud-scoring engine (V3); credit-style risk models;
  shadow-banning.
- **Version**: V1 · **Size**: S

> **DECISION REQUIRED — D-20 · Customer data erasure scope**: On a PIPEDA erasure request, which
> records must survive and in what form? · **Proposed default**: Erase/pseudonymise identifiers;
> retain order, payment, refund and tax records for 7 years keyed by an irreversible `customer_ref`;
> retain case transcripts with the customer's messages redacted. · **Why**: Deleting transaction
> records conflicts with tax and chargeback obligations, so pseudonymisation is the standard
> compromise, but the client's counsel must confirm.

---

### A-29 — In-flight order treatment on entity state change

- **SOW trace**: Derived requirement. The SOW mandates suspend/reinstate (Admin) and order support (Support Agent) but never states what happens to orders already in progress. Left undefined, this is the single largest source of stranded money and abandoned food.
- **Behaviour**: A single, shared policy engine invoked by every state change in A-22, A-27, A-28 and
  every incident that forces a rider offline. It classifies each of the entity's non-terminal orders
  by current status and applies a defined outcome. **In-flight** means
  `order.status ∉ {DELIVERED, CANCELLED, REFUNDED, REJECTED}`.

  **Restaurant `SUSPENDED` / `DELISTED` / `DEACTIVATED`:**

  | Order status | Outcome |
  |---|---|
  | `AWAITING_RESTAURANT_ACCEPTANCE` | Auto-cancel + **full refund** (including fees) + customer notified with reason "restaurant unavailable" |
  | `ACCEPTED` / `PREPARING` | **Allowed to complete.** Food is already being made; cancelling wastes it and strands the customer. Restaurant may not receive further orders. |
  | `READY_FOR_PICKUP` / `PICKED_UP` / `IN_TRANSIT` | Allowed to complete |

  **Restaurant `BANNED` (confirmed):** same as above **except** `ACCEPTED`/`PREPARING` orders are
  cancelled + fully refunded unless the ban reason is `MERCHANT_REQUEST` or the order is already
  `READY_FOR_PICKUP`. Rationale: a ban means the platform no longer vouches for the food, and the
  halal claim in particular cannot be stood behind.

  **Restaurant `SUSPENDED` for `HALAL_INTEGRITY` or `FOOD_SAFETY_RISK` (override):** **all** in-flight
  orders not yet `DELIVERED` are cancelled + fully refunded immediately, including `PICKED_UP` ones
  (the rider is instructed to discard/return and is paid the full delivery fee). This is the one case
  where food waste is the correct outcome.

  **Rider `SUSPENDED` / `OFFLINE_FORCED` / incident:**

  | Order status | Outcome |
  |---|---|
  | `RIDER_ASSIGNED` (not yet picked up) | Unassign, return to dispatch, re-offer; rider paid nothing for it |
  | `PICKED_UP` / `IN_TRANSIT`, reason ∈ {`LOW_PERFORMANCE`, `DOCUMENT_EXPIRED`, `REPEATED_CANCELLATIONS`} | Allowed to complete this delivery; rider removed from pool afterwards; rider paid in full |
  | `PICKED_UP` / `IN_TRANSIT`, reason ∈ {`SAFETY_RISK`, `ACCIDENT_OR_INJURY`, `THEFT_OR_ROBBERY`, `FRAUD_SUSPECTED`, `ABUSIVE_CONDUCT`} | Order enters `RECOVERY`: dispatch attempts a re-pickup from the rider's location if safe; if not recoverable within 15 minutes → cancel + full refund; rider paid a pro-rata amount per D-21 |

  **Customer `SUSPENDED` / `BANNED`:** orders already `ACCEPTED` or beyond complete normally (the
  restaurant has already committed resources). Orders in `AWAITING_RESTAURANT_ACCEPTANCE` are
  cancelled + fully refunded. New order creation is blocked immediately.

- **Data**: `order_intervention {id, order_id, trigger_type, trigger_entity_type, trigger_entity_id, from_status, action, refund_id null, reassignment_attempts int, decided_by ENUM(SYSTEM,STAFF), staff_id null, created_at}`; the `in_flight_orders_snapshot` written on every state event (A-22 R6).
- **Role**: **System** applies the policy automatically on every qualifying state change.
  **Admin** — may override a specific order's computed outcome with a reason (e.g. let a
  `PREPARING` order complete despite a ban) and may trigger the engine manually for one order.
  **Super Admin** — may override any outcome including the halal/food-safety override.
  **Support Agent** — read the computed outcomes and explain them; may request an override via
  escalation; may not override.
- **States**: order statuses are owned by the order state machine; this feature only injects
  `CANCELLED` (with a cancellation reason) or `RIDER_UNASSIGNED`/`RECOVERY` transitions through that
  machine's legal transitions. It never writes `order.status` directly.
- **Rules**:
  - R1 Every auto-cancellation issues a **full** refund of everything the customer paid (subtotal,
    delivery fee, service fee, tax, tip) with `refund_reason = PLATFORM_INITIATED_CANCELLATION`. The
    customer is never out of pocket for a platform- or partner-caused cancellation.
  - R2 The refund is issued through the A-33 pipeline with `authority = SYSTEM`, bypassing per-role
    caps but still fully audited and idempotent (keyed on `order_id + trigger`).
  - R3 The engine is idempotent: re-running it for the same `(order_id, trigger)` produces no second
    cancellation or refund.
  - R4 If a refund fails, the order still cancels, the failure creates a P1 case at Tier 2, and the
    refund enters a retry queue with exponential backoff — the customer's money is never silently lost.
  - R5 Every intervention notifies the affected customer, restaurant and rider with a reason string
    drawn from a fixed message catalogue, never free text.
  - R6 The snapshot of what was in flight and what was decided is retained permanently.
- **Acceptance criteria**:
  1. Given a restaurant with one order `AWAITING_RESTAURANT_ACCEPTANCE` and one `PREPARING`, when an
     admin suspends it for `COMPLIANCE_THRESHOLD`, then the first is cancelled with a full refund and
     the second completes; two `order_intervention` rows exist.
  2. Given the same restaurant suspended for `HALAL_INTEGRITY`, then **both** orders are cancelled and
     fully refunded, including a `PICKED_UP` third order, and the rider on it is paid the full fee.
  3. Given a rider forced offline for `DOCUMENT_EXPIRED` while `IN_TRANSIT`, then the delivery
     completes, the rider is paid, and pool removal happens after the order reaches `DELIVERED`.
  4. Given a rider suspended for `THEFT_OR_ROBBERY` while `IN_TRANSIT`, when recovery fails for 15
     minutes, then the order is `CANCELLED`, a full refund is issued, and a P1 case exists.
  5. Given the engine is invoked twice for the same suspension event, then exactly one refund exists
     per order (verified by the idempotency key).
- **Out of scope**: partial refunds on intervention (always full); customer choice of
  replacement-restaurant; automatic re-ordering elsewhere.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-21 · Rider pay on interrupted deliveries**: What is a rider paid when their
> delivery is aborted mid-route by a platform decision (accident, theft, safety suspension)?
> · **Proposed default**: Full delivery fee if `PICKED_UP` or beyond; 50% if `RIDER_ASSIGNED` and
> they had travelled to the restaurant; nothing if unassigned before travel. · **Why**: The rider
> bore the cost and the interruption was not their commercial risk.

> **DECISION REQUIRED — D-22 · Food-waste cost on halal-integrity cancellation**: When a
> halal-integrity suspension forces discard of prepared food, who bears the food cost — platform or
> restaurant? · **Proposed default**: The restaurant is not settled for the discarded orders, and the
> platform bears the customer refund; if the integrity finding is later overturned, the restaurant is
> settled retroactively. · **Why**: The party that caused the integrity doubt should not be paid for
> the food it is under question for, but reversal must be possible.

---

### A-30 — Review moderation

- **SOW trace**: *"Review Moderation: Moderate customer reviews and ratings for restaurants and riders."* · *"Restaurant Reviews / Food Reviews / Rider Reviews"* · *"Feedback Handling: Address customer feedback and complaints."*
- **Behaviour**: Reviews are published optimistically and moderated post-hoc, with a pre-publication
  automated screen. On submission a review passes through: (1) an authorship check — the reviewer must
  have a `DELIVERED` order matching the reviewed entity within the last 30 days, else it is rejected
  at write time; (2) a rating-range check (integer 1–5); (3) an automated content screen (profanity
  list, contact-information patterns, URL patterns, all-caps ratio, repeated-character runs) that can
  set `AUTO_FLAGGED`. `AUTO_FLAGGED` reviews are **held** (not published) and enter the moderation
  queue. Everything else publishes immediately and can be flagged later by any user or by staff.
- **Data**:
  ```
  review { id, subject_type ENUM(RESTAURANT, FOOD_ITEM, RIDER), subject_id, order_id, customer_id,
           rating smallint, body text null, status, auto_flags text[], published_at,
           moderated_by, moderated_at, moderation_reason_code, edited_by_author_at }
  review_flag { id, review_id, flagged_by_type, flagged_by_id, reason_code, note, created_at, resolved_at }
  ```
  Moderation reason codes: `PROFANITY`, `HATE_OR_HARASSMENT`, `PERSONAL_INFORMATION`, `SPAM_OR_ADVERT`,
  `OFF_TOPIC`, `FALSE_OR_UNVERIFIABLE_CLAIM`, `CONFLICT_OF_INTEREST`, `EXTORTION_ATTEMPT`,
  `HALAL_ALLEGATION` (routed separately), `OTHER`.
- **Role**: **Admin** — approve, remove, redact (remove the body while keeping the rating), or restore
  any review; resolve flags. **Super Admin** — same, plus remove a rating (which changes an average)
  and bulk actions. **Support Agent** — triage the flag queue: read reviews, add notes, and
  **recommend** an action that an admin confirms; may remove nothing. A support agent *may* mark a
  flag as `NO_ACTION` for obviously frivolous flags.
- **States**: `PENDING_SCREEN → PUBLISHED` · `PENDING_SCREEN → AUTO_FLAGGED → PUBLISHED | REMOVED` ·
  `PUBLISHED → FLAGGED → PUBLISHED | REDACTED | REMOVED` · `REMOVED → PUBLISHED` (restore, Admin+).
- **Rules**:
  - R1 A review whose author has no matching `DELIVERED` order is rejected at submission with
    `403 REVIEW_NOT_ELIGIBLE`; there is no moderation path for it because it never exists.
  - R2 Removing a review removes it from the displayed average **and** recomputes the entity's
    aggregate within 60 seconds. `REDACTED` keeps the rating in the average.
  - R3 A review containing a halal allegation (keyword screen: "not halal", "pork", "haram", "alcohol"
    plus configurable terms) is auto-published *and* auto-creates a Tier 2 case of category
    `HALAL_INTEGRITY` — the review is not suppressed, because suppressing halal complaints would
    corrupt the platform's core promise, but it is investigated.
  - R4 `EXTORTION_ATTEMPT` (a review used to demand a refund) creates a Tier 2 case against the
    customer and feeds `refund_abuse_score`.
  - R5 A restaurant or rider may flag a review once; repeated flags on the same review by the same
    entity are rejected. Flagging never auto-hides.
  - R6 Every moderation action is audit-logged with the review body before and after.
  - R7 Ratings are integers 1–5 enforced at the API and by a DB check constraint. (This closes defect
    B90/B91, where any number was accepted and the rater was never verified.)
- **Acceptance criteria**:
  1. Given a customer with no delivered order from restaurant R, when they submit a review of R, then
     `403 REVIEW_NOT_ELIGIBLE` and no row is created.
  2. Given a review with rating `7`, when submitted, then `422 RATING_OUT_OF_RANGE` and the DB
     constraint would also reject it.
  3. Given a published review containing "this was not halal", then it remains published and a Tier 2
     `HALAL_INTEGRITY` case exists referencing it and the restaurant.
  4. Given an admin removes a 1-star review from a restaurant with 10 reviews, then the displayed
     average recomputes over 9 reviews within 60 seconds.
  5. Given a `SUPPORT_AGENT`, when they attempt to remove a review, then `403 FORBIDDEN_PERMISSION`;
     when they mark a flag `NO_ACTION`, then `200`.
- **Out of scope**: ML-based toxicity classification (V3); review responses by restaurants (a
  restaurant-app feature); review helpfulness voting; photo reviews.
- **Version**: V2 · **Size**: M

---

### A-31 — Abuse and fraud report handling

- **SOW trace**: *"Report Handling: Address reports from users (e.g., inappropriate content, fraudulent activities)."* · *"Grievances: Submit grievances or complaints regarding orders, restaurants, or riders."*
- **Behaviour**: Any actor (customer, restaurant, rider) can report any other actor or any content
  item. A report creates a `case` with `type = REPORT` and a fixed category. Reports are triaged by
  support (Tier 1), investigated by admin (Tier 2) where they concern fraud, safety or halal
  integrity, and resolved with an outcome that may create a compliance violation (A-20), a state
  action (A-22/A-27/A-28), or nothing. Duplicate reports about the same target within 24 hours are
  merged into one case with a `report_count`, so a brigading campaign cannot manufacture urgency.
- **Data**: `case` (§0.4) with `type=REPORT`; `report_detail {case_id pk, category, target_type, target_id, content_ref null, description, evidence_object_keys[], report_count int, first_reported_at, outcome_code null}`.
  Categories: `INAPPROPRIATE_CONTENT`, `FRAUDULENT_ACTIVITY`, `FAKE_HALAL_CLAIM`, `IMPERSONATION`,
  `HARASSMENT`, `PAYMENT_FRAUD`, `PROMO_ABUSE`, `ACCOUNT_SHARING`, `FOOD_SAFETY`, `OTHER`.
- **Role**: **Support Agent** — triage, deduplicate, gather evidence, close `INAPPROPRIATE_CONTENT`
  and `OTHER` with `NO_ACTION`; must escalate `FRAUDULENT_ACTIVITY`, `FAKE_HALAL_CLAIM`,
  `PAYMENT_FRAUD`, `FOOD_SAFETY`, `IMPERSONATION`. **Admin** — investigate and resolve all categories,
  create violations and state actions. **Super Admin** — resolve reports naming staff members, and any
  report where the proposed outcome is a ban.
- **States**: case lifecycle; `outcome_code`: `NO_ACTION`, `CONTENT_REMOVED`, `WARNING_ISSUED`,
  `VIOLATION_RECORDED`, `ACCOUNT_RESTRICTED`, `ACCOUNT_SUSPENDED`, `BAN_PROPOSED`, `REFERRED_EXTERNAL`.
- **Rules**:
  - R1 `FAKE_HALAL_CLAIM` is always P1 and always routed to Tier 2 immediately; its investigation must
    record a halal outcome (`SUBSTANTIATED` / `UNSUBSTANTIATED` / `INCONCLUSIVE`) and, if
    substantiated, triggers A-22's `HALAL_INTEGRITY` suspension path.
  - R2 A report naming a `staff_user` as target is invisible to `ADMIN` and routed straight to Tier 3.
  - R3 Reporters are notified of the outcome category only ("action taken" / "no action taken"), never
    of the specific consequence applied to the reported party.
  - R4 A reporter with ≥ 5 `NO_ACTION` reports in 30 days is rate-limited to 1 report/day and flagged
    for review; this is recorded, not hidden.
  - R5 Evidence handling follows the private-bucket rules; screenshots may contain PII and are subject
    to A-42 access auditing.
- **Acceptance criteria**:
  1. Given a `FAKE_HALAL_CLAIM` report, then the case is created at Tier 2 with `priority=P1` and a
     support agent attempting to resolve it receives `403 FORBIDDEN_PERMISSION`.
  2. Given 6 reports about the same restaurant within 24 hours, then exactly one case exists with
     `report_count=6`.
  3. Given a report naming a staff user, when an `ADMIN` lists reports, then that case is absent from
     their results and present in the Tier 3 queue.
  4. Given a substantiated fake-halal-claim outcome, then the restaurant is `SUSPENDED` with
     `HALAL_INTEGRITY` and A-29's override path runs.
- **Out of scope**: automated fraud detection models (SOW V2.0 "fraud detection"); law-enforcement
  reporting workflow; chargeback representment (handled inside the payment provider).
- **Version**: V2 · **Size**: M

---

### A-32 — Feedback and ratings review

- **SOW trace**: *"Feedback Review: Monitor and analyze customer feedback and ratings."* · *"Feedback Handling: Address customer feedback and complaints."*
- **Behaviour**: A read-and-route surface distinct from moderation (A-30). It aggregates all
  customer-supplied signal — ratings, review text, post-order survey answers, complaint categories —
  into a browsable, filterable stream and a set of rollups: rating trend per restaurant/rider, top
  complaint categories by volume and by 30-day delta, worst-rated items, and free-text theme tags
  assigned by the reviewing staff member (not by ML). Any feedback item can be converted into a case
  with one click, carrying its context.
- **Data**: `feedback_item` view over `review`, `case`, `order_survey_response`;
  `feedback_theme {id, name, active}`; `feedback_theme_assignment {feedback_ref_type, feedback_ref_id, theme_id, assigned_by, assigned_at}`.
- **Role**: **Admin** — full stream, all rollups, assign themes, convert to case. **Super Admin** —
  same. **Support Agent** — the stream filtered to entities on their assigned cases, may assign themes
  and convert to case.
- **States**: feedback item `NEW → REVIEWED → CONVERTED_TO_CASE | DISMISSED`.
- **Rules**:
  - R1 Dismissal requires a theme assignment, so dismissed feedback still contributes to trend data.
  - R2 Rollups exclude removed reviews (A-30) but retain them in a separate "moderated" count so
    moderation volume is visible.
  - R3 Converting to a case links bidirectionally and pre-fills subject, order and text.
- **Acceptance criteria**:
  1. Given a 1-star review with text, when an admin converts it to a case, then the case's
     `subject_id`, `order_id` and description are pre-filled and the review shows `CONVERTED_TO_CASE`.
  2. Given feedback dismissed without a theme, then `422 THEME_REQUIRED`.
  3. Given 3 reviews removed by moderation, then the rating rollup excludes them and a "moderated: 3"
     counter is displayed.
- **Out of scope**: NPS/CSAT survey design and delivery; sentiment analysis; automatic theme
  extraction; customer-facing "you said, we did" publishing.
- **Version**: V2 · **Size**: S

---

## 5. MONEY — refunds, credits, disputes, payouts

### A-33 — Refund issuance and authority limits

- **SOW trace**: *"Customer Support: Handle customer complaints, refund requests, and disputes."* (Admin) · *"Order Support: Assist customers with order placement, tracking, and refunds."* (Support Agent) · *"Refund Requests: Request refunds for canceled or unsatisfactory orders and track refund status."* (Customer)
- **Behaviour**: One refund pipeline, used by staff-initiated refunds, customer-requested refunds and
  system-initiated refunds (A-29). A refund is always **against a specific payment on a specific
  order**, is always in cents, and always names a `refund_reason_code` and one of three scopes:
  `FULL` (everything the customer paid), `PARTIAL_ITEMS` (a named set of line items plus their
  proportional tax and, if the whole order failed, the fees), or `PARTIAL_AMOUNT` (an arbitrary amount
  ≤ remaining refundable). The **authority check** runs before anything is sent to the payment
  provider:

  | Check | Support Agent | Admin | Super Admin |
  |---|---|---|---|
  | Max per order | `refund_cap_support_agent_cents` (default CAD 25.00) | order total (100%) | unlimited |
  | Max per rolling 24h (all orders) | `refund_cap_support_agent_daily_cents` (CAD 150.00) | `refund_cap_admin_daily_cents` (CAD 2,000.00) | unlimited |
  | Order age limit | ≤ 14 days since delivery | ≤ 90 days | unlimited |
  | May exceed order total (ex-gratia) | No | No | Yes |
  | Second approver required ([goodwill refunds](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) | Goodwill above CAD 50.00 | Goodwill above `refund_four_eyes_threshold_cents` (CAD 50.00) | Goodwill above CAD 50.00 |
  | May refund an already-partially-refunded order | Yes, within remaining headroom and their cap | Yes | Yes |

  A request exceeding the caller's authority is **not rejected**: it creates a
  `refund_approval_request` and escalates the case to the next tier (A-12,
  `reason_code = EXCEEDS_REFUND_CAP`), so the customer's request is never lost.

- **Data**:
  ```
  refund { id, order_id, payment_id, amount_cents, currency, scope,
           reason_code, reason_text, line_item_refs jsonb null,
           requested_by_type ENUM(CUSTOMER,STAFF,SYSTEM), requested_by_id,
           authorised_by_staff_id null, second_approver_staff_id null,
           case_id null, idempotency_key text unique not null,
           provider_refund_id text null, status, failure_code null,
           liability_split jsonb,        -- {platform_cents, restaurant_cents, rider_cents}
           created_at, submitted_at, settled_at }
  refund_approval_request { id, refund_draft_json, requested_by, required_tier, case_id,
                            status, decided_by, decided_at, decision_reason }
  staff_refund_ledger { staff_id, window_start, total_cents }   -- rolling cap enforcement
  ```
  `reason_code`: `ORDER_NEVER_ARRIVED`, `MISSING_ITEMS`, `WRONG_ITEMS`, `FOOD_QUALITY`,
  `FOOD_SAFETY`, `LATE_DELIVERY`, `RESTAURANT_CANCELLED`, `PLATFORM_INITIATED_CANCELLATION`,
  `DUPLICATE_CHARGE`, `PRICING_ERROR`, `HALAL_CONCERN`, `HALAL_INTEGRITY`, `GOODWILL`, `DISPUTE_RESOLUTION`,
  `CHARGEBACK_PREEMPTIVE`, `OTHER`.
- **Role**: as the table above. **Support Agent** holds `refund.issue_capped`; **Admin** holds
  `refund.issue`; **Super Admin** holds `refund.issue_unlimited` and `refund.approve`.
  Nobody may approve their own above-cap request.
- **States**: `DRAFT → PENDING_APPROVAL` (above cap) → `AUTHORISED` → `SUBMITTED` → `SETTLED`
  · `SUBMITTED → FAILED → RETRY_QUEUED → SUBMITTED` · `PENDING_APPROVAL → DECLINED`
  · `AUTHORISED → CANCELLED` (only before submission).
  `SETTLED` is **terminal and irreversible** — there is no "unrefund". A refund issued in error is
  corrected by a separate charge, which is a distinct, super-admin-only operation (V2).
- **Rules**:
  - R1 `Σ refunds(order).amount_cents ≤ order.total_paid_cents` unless the authorising role is
    `SUPER_ADMIN` with `scope = PARTIAL_AMOUNT` and `reason_code = GOODWILL`. Enforced by a
    transactional check against a `SELECT ... FOR UPDATE` on the order, not by a read-then-write.
  - R2 `Idempotency-Key` is **mandatory**. A duplicate key returns the original refund unchanged with
    `Idempotency-Replayed: true`. This is what prevents the double-refund that a retried support click
    would otherwise cause.
  - R3 Rolling 24h caps are enforced with an atomic upsert into `staff_refund_ledger` inside the same
    transaction that authorises the refund; the check is `total + amount ≤ cap` in one statement.
  - R4 Liability split is computed at authorisation and stored, by fault per reason code
    ([refund liability](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)):
    `MISSING_ITEMS`, `WRONG_ITEMS`, `FOOD_QUALITY`, `FOOD_SAFETY`, `RESTAURANT_CANCELLED` → restaurant
    bears the food portion; `HALAL_CONCERN` / `HALAL_INTEGRITY` (staff file it as a halal concern, with
    evidence) → restaurant bears the item's net price only when the complaint is substantiated,
    otherwise the platform bears it as goodwill ([halal complaint refunds](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01));
    `ORDER_NEVER_ARRIVED` → the rider's earnings for the order are reversed and the platform bears the
    rest; `LATE_DELIVERY`, `PRICING_ERROR`, `PLATFORM_INITIATED_CANCELLATION`, `GOODWILL`,
    `DUPLICATE_CHARGE`, `OTHER` → platform bears it. The split feeds settlement (A-36) and is visible to the
    bearing party.
  - R5 A refund is submitted to the payment provider only after `AUTHORISED`; provider failures move
    to `FAILED` with the provider's code, are retried with exponential backoff up to 24 hours, and
    raise a P1 case at Tier 2 on final failure. **The customer-facing refund status never shows
    "completed" before the provider confirms.** (This closes defects B48/B54, where refunds only ever
    logged "refund would be initiated here".)
  - R6 Refunds require the session's MFA to be verified within 12 hours (A-02 R4).
  - R7 Every refund state change writes an `audit_event` including the authority path used
    (`role`, `cap_applied`, `approver_ids`).
  - R8 A refund against an order whose payment is not `CAPTURED` is rejected
    `409 PAYMENT_NOT_REFUNDABLE`; a cancellation before capture voids the authorisation instead and is
    a different operation.
- **Acceptance criteria**:
  1. Given a support agent and an order totalling `$40.00`, when they issue a `$30.00` refund, then no
     refund is created, a `refund_approval_request` exists at Tier 2, and the case is escalated with
     `reason_code='EXCEEDS_REFUND_CAP'`.
  2. Given the same agent issues `$20.00`, then the refund is `AUTHORISED` and submitted, and
     `staff_refund_ledger` for their rolling window increases by `2000`.
  3. Given that agent has already refunded `$140.00` in the last 24 hours, when they issue `$20.00`,
     then `409 DAILY_CAP_EXCEEDED` and an approval request is created instead.
  4. Given the same `Idempotency-Key` is submitted twice, then exactly one `refund` row exists and the
     second response carries `Idempotency-Replayed: true`.
  5. Given an admin authorises a `$60.00` goodwill refund with the second-approver threshold at
     `$50.00`, then the refund stays `PENDING_APPROVAL` until a **different** admin or super admin approves; a
     self-approval attempt returns `409 SELF_APPROVAL_FORBIDDEN`.
  6. Given the payment provider returns a permanent failure, then the refund is `FAILED`, a P1 case
     exists at Tier 2, and the customer-facing status reads "processing — we are on it", never
     "refunded".
- **Out of scope**: chargeback/representment handling inside the provider; refunds to a different
  payment instrument than the original; cash refunds; partial refunds of tips to riders already paid
  out (V2); currency conversion.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — D-23 · Support agent refund cap**: What is the maximum a front-line support
> agent may refund without approval — per order and per day? · **Proposed default**: CAD 25.00 per
> order, CAD 150.00 per rolling 24 hours, orders up to 14 days old. · **Why**: Covers the great
> majority of missing-item and late-delivery goodwill without creating a meaningful loss surface from
> a single compromised or careless account.

> **DECISION REQUIRED — D-24 · Refund liability allocation**: When a refund is caused by the
> restaurant or rider, is the cost deducted from their settlement automatically or only after they
> can respond? · **Proposed default**: The split is computed and recorded at authorisation but only
> deducted at the next settlement run, and the bearing party has 72 hours to dispute (A-35) before
> the deduction is final. · **Why**: Automatic silent deductions are the most common merchant
> grievance in delivery platforms.

---

### A-34 — Goodwill credit issuance

- **SOW trace**: *"Handle customer complaints…"* · admin-web's existing dispute resolution shape `{refund_amount, coupon_amount}` implies a credit instrument distinct from a refund.
- **Behaviour**: A **credit** is platform currency applied to a future order; a **refund** returns
  money to the original payment instrument. They are different instruments with different accounting
  and different authority. A credit is issued to a customer with an amount, an expiry (default 90
  days), a reason and an optional minimum-order condition. Credits apply automatically at checkout
  before payment, oldest-expiring first, and never apply to tips.
- **Data**: `customer_credit {id, customer_id, amount_cents, remaining_cents, currency, reason_code, reason_text, case_id null, issued_by_staff_id, expires_at, min_order_subtotal_cents, status, created_at}`;
  `customer_credit_application {id, credit_id, order_id, amount_cents, applied_at, reversed_at null}`.
- **Role**: **Support Agent** — issue up to CAD 15.00 per case and CAD 100.00 per rolling 24h.
  **Admin** — up to CAD 100.00 per case, CAD 1,000.00 per day. **Super Admin** — unlimited. Same
  above-cap → approval-request behaviour as A-33.
- **States**: `ACTIVE → PARTIALLY_USED → FULLY_USED` (terminal) · `ACTIVE|PARTIALLY_USED → EXPIRED`
  (terminal) · `ACTIVE → REVOKED` (Admin+, only if unused, with reason).
- **Rules**:
  - R1 Credits are never convertible to cash and never refundable to a payment instrument.
  - R2 Credit application is atomic against `remaining_cents` (`UPDATE ... WHERE remaining_cents >= :x`).
  - R3 If an order that consumed credit is cancelled or fully refunded, the credit application is
    reversed and `remaining_cents` restored, with the original expiry preserved.
  - R4 Credits do not stack with a promotion in V1 — a credit reduces the amount payable after the
    single applied promotion, which is permitted; two credits may combine, two promotions may not.
  - R5 Issuing a credit when a refund is the correct remedy (order never arrived, duplicate charge) is
    a policy violation: those `reason_code`s are rejected for credits → `422 REFUND_REQUIRED`.
- **Acceptance criteria**:
  1. Given a support agent issues a CAD 10.00 credit, then `customer_credit` exists with
     `remaining_cents=1000` and `expires_at = now + 90d`.
  2. Given a CAD 10.00 credit and a CAD 7.00 order (goods and fees, excluding tip), when the customer
     checks out, then `remaining_cents` becomes `300`, the card is charged `0` for that portion, and
     any tip is charged to the card in full.
  3. Given an order that consumed CAD 7.00 of credit is fully refunded, then the credit's
     `remaining_cents` returns to `1000` and the refund to the card covers only what was charged to
     the card.
  4. Given a support agent attempts a CAD 40.00 credit, then an approval request is created at Tier 2
     and no credit is issued.
  5. Given `reason_code = DUPLICATE_CHARGE`, when a credit is attempted, then `422 REFUND_REQUIRED`.
- **Out of scope**: credit transfer between accounts; credits to restaurants or riders; promotional
  mass-credit campaigns (that is A-07); credit as a settlement instrument.
- **Version**: V2 · **Size**: S

---

### A-35 — Dispute case management

- **SOW trace**: *"Escalations and Disputes: Raise Escalations… Dispute Resolution: Track the status of escalations and receive updates on resolutions."* (Restaurant) · *"Refunds and Disputes… Dispute Resolution: Escalate unresolved issues to customer support."* (Customer) · *"Handle customer complaints, refund requests, and disputes."* (Admin)
- **Behaviour**: A dispute is a `case` with `type = DISPUTE` (§0.4): two parties, a contested amount,
  and a determination of liability. Disputes arise from: a customer contesting a charge or a denied
  refund; a restaurant contesting a refund deducted from its settlement (A-33 R4 / D-24); a rider
  contesting earnings (A-36 routes into here); or a payment-provider chargeback notification. The
  resolution records `liable_party`, a monetary outcome (refund and/or credit and/or settlement
  adjustment), and a rationale visible to both parties. Both parties may submit evidence within a
  defined response window before resolution.
- **Data**: `case` + `dispute_detail {case_id pk, dispute_reason, claimant_type, claimant_id, respondent_type, respondent_id, disputed_amount_cents, response_due_at, evidence_object_keys jsonb, resolution_refund_id null, resolution_credit_id null, resolution_settlement_adjustment_cents null, rationale text, provider_chargeback_id null}`.
  `dispute_reason` (extending the enums already present in admin-web): `WRONG_ORDER`,
  `MISSING_ITEMS`, `POOR_QUALITY`, `LATE_DELIVERY`, `NEVER_DELIVERED`, `UNAUTHORISED_CHARGE`,
  `REFUND_DEDUCTION_CONTESTED`, `EARNINGS_SHORTFALL`, `HALAL_CLAIM_CONTESTED`, `OTHER`.
- **Role**: **Support Agent** — open a dispute, collect and attach evidence, communicate with both
  parties, and resolve **only** disputes whose `disputed_amount_cents` is within their refund cap and
  whose `liable_party = PLATFORM`. Everything else escalates. **Admin** — resolve disputes up to their
  refund cap, assign liability to restaurant or rider, apply settlement adjustments.
  **Super Admin** — resolve any dispute, override liability, resolve chargebacks, authorise ex-gratia.
- **States**: `OPEN → EVIDENCE_PENDING → UNDER_REVIEW → RESOLVED → CLOSED` ·
  `OPEN|EVIDENCE_PENDING|UNDER_REVIEW → REJECTED` (claim not substantiated; the claimant is told why) ·
  `RESOLVED → REOPENED` (once only, within 14 days, on new evidence) → `UNDER_REVIEW`.
- **Rules**:
  - R1 A dispute cannot be `RESOLVED` while `response_due_at` is in the future unless both parties have
    submitted or explicitly waived → `409 RESPONSE_WINDOW_OPEN`. Default window: 72 hours.
  - R2 `liable_party` is mandatory at resolution; `NONE` is permitted and means the platform absorbs
    the cost without attributing fault.
  - R3 The monetary outcome executes through A-33 (refund), A-34 (credit) and the settlement engine
    (adjustment) — a dispute never moves money itself, so every cent still passes the authority,
    idempotency and audit controls.
  - R4 A provider-originated chargeback creates a dispute automatically with
    `dispute_reason = UNAUTHORISED_CHARGE`, priority P1, tier 2, and freezes any pending refund on the
    same order to avoid double payment → `409 CHARGEBACK_IN_PROGRESS`.
  - R5 Reopening is limited to once and only with new evidence attached; a second attempt returns
    `409 DISPUTE_ALREADY_REOPENED`.
  - R6 Both parties see: status, the contested amount, the deadline, their own and the other party's
    submitted evidence *descriptions* (not necessarily the files), the outcome and the rationale.
    Internal notes are never exposed.
- **Acceptance criteria**:
  1. Given a dispute opened 1 hour ago with a 72-hour window and no responses, when an admin resolves
     it, then `409 RESPONSE_WINDOW_OPEN`; when both parties waive, then resolution succeeds.
  2. Given a resolution assigning `liable_party = RESTAURANT` with a CAD 18.00 refund, then a `refund`
     row exists with `liability_split.restaurant_cents = 1800` and a settlement adjustment is queued.
  3. Given a chargeback arrives for an order with a pending refund, then the refund is blocked with
     `409 CHARGEBACK_IN_PROGRESS` and a P1 dispute exists.
  4. Given a support agent and a CAD 120.00 dispute, when they attempt to resolve it, then
     `403 FORBIDDEN_PERMISSION` and the case escalates to Tier 2.
  5. Given a dispute reopened once and resolved, when a party attempts a second reopen, then
     `409 DISPUTE_ALREADY_REOPENED`.
- **Out of scope**: arbitration/mediation workflow; legal claim tracking; automated evidence
  submission to the card network; small-claims documentation.
- **Version**: V2 · **Size**: L

> **DECISION REQUIRED — D-25 · Dispute response window**: How long do parties have to respond before
> a dispute may be resolved without them? · **Proposed default**: 72 hours for restaurants and
> riders, 72 hours for customers, resolvable earlier if all parties respond or waive.
> · **Why**: Long enough for a merchant's weekend, short enough that a customer is not left waiting.

---

### A-36 — Rider earnings and payout dispute assistance

- **SOW trace**: *"Earnings Support: Assist riders with payout related disputes/grievances."* (Support Agent) · *"Payout Requests: … Track payout status in real-time (pending, processed, failed)."* (Restaurant) · *"Earnings Dashboard: View daily, weekly, and monthly earnings."* (Rider)
- **Behaviour**: A staff-side view of a rider's or restaurant's earnings ledger and payout history,
  with a defined path from "my money looks wrong" to a determination. The view shows, per period:
  every earning line (delivery fee share, distance/time component, tip, incentive, adjustment), every
  deduction (refund liability per A-33 R4, penalty), the computed net, the payout batch it belongs to,
  and the payout's provider status. A support agent can explain any line, recompute the period on
  demand (a pure function over the stored order facts), and — where the recomputation differs from the
  stored ledger — open a `DISPUTE` case with `dispute_reason = EARNINGS_SHORTFALL` pre-filled with the
  variance. They cannot adjust the ledger.
- **Data**:
  ```
  earning_line { id, earner_type ENUM(RIDER,RESTAURANT), earner_id, order_id null, period_id,
                 kind, amount_cents, computed_from_json, created_at }
  earning_adjustment { id, earner_type, earner_id, period_id, amount_cents, reason_code, reason_text,
                       case_id, created_by_staff_id, approved_by_staff_id, created_at }
  payout_batch { id, earner_type, earner_id, period_start, period_end, gross_cents, deductions_cents,
                 net_cents, status, provider_transfer_id, failure_code, initiated_at, settled_at }
  ```
  `kind`: `DELIVERY_FEE_SHARE`, `DISTANCE_COMPONENT`, `TIME_COMPONENT`, `TIP`, `INCENTIVE`,
  `ORDER_SUBTOTAL_SHARE` (restaurants), `COMMISSION` (negative), `REFUND_LIABILITY` (negative),
  `PENALTY` (negative), `MANUAL_ADJUSTMENT`.
- **Role**: **Support Agent** — read the ledger for the earner under a case, recompute, explain, open
  a dispute; **cannot** create an `earning_adjustment`. **Admin** — create adjustments up to their
  refund cap equivalent, retry a failed payout batch. **Super Admin** — unlimited adjustments,
  approve above-cap adjustments, change payout schedules (A-06).
- **States**: payout batch `PENDING → SCHEDULED → PROCESSING → COMPLETED` · `PROCESSING → FAILED →
  RETRY_QUEUED → PROCESSING` · `FAILED → CANCELLED` (Super Admin, funds returned to the next batch).
- **Rules**:
  - R1 The ledger is append-only. Corrections are new `earning_adjustment` rows, never edits.
  - R2 Recomputation is deterministic and reads only stored order facts and the setting versions in
    force at the time of the order (A-06 R4) — it must reproduce the historical number exactly when
    nothing is wrong. A variance is therefore always meaningful.
  - R3 An adjustment requires a `case_id`. Adjustments without a case → `422 CASE_REQUIRED`.
  - R4 Tips are pass-through: they are never reduced by commission, never used to offset a refund
    liability, and never withheld. (This corrects defect B52, where rider earnings counted *only* tips
    and ignored the delivery fee share — both directions of that error are excluded here.)
  - R5 A failed payout raises a P2 case to Tier 2 automatically and notifies the earner with the
    provider's plain-language reason.
  - R6 Support agents see the earner's ledger only for periods containing the order under dispute, not
    the earner's entire history (A-42).
- **Acceptance criteria**:
  1. Given a rider claims a shortfall, when a support agent recomputes the period, then the
     recomputation returns each `earning_line` with its `computed_from_json` and a variance total; a
     zero variance is displayed explicitly, not as a blank.
  2. Given a non-zero variance, when the agent opens a dispute, then the case is
     `type=DISPUTE, dispute_reason=EARNINGS_SHORTFALL` with `disputed_amount_cents` equal to the
     variance and tier 2.
  3. Given a support agent attempts to create an `earning_adjustment`, then
     `403 FORBIDDEN_PERMISSION` with `details.permission='earnings.adjust'`.
  4. Given a payout batch fails with `account_closed`, then its status is `FAILED`, a P2 case exists at
     Tier 2, and the rider is notified with the plain-language reason.
  5. Given an order with a CAD 5.00 tip and a CAD 12.00 refund liability, when the period is computed,
     then the tip is paid in full and the liability is applied only against non-tip earnings.
- **Out of scope**: the payout execution mechanism itself (Stripe Connect transfers, specified in the
  payments domain); tax slips (T4A) generation; rider expense tracking; instant-payout products.
- **Version**: V2 · **Size**: M

> **Decided:** weekly, every Monday, automatic, with no minimum ([payout cadence](../decisions/README.md#settled--client-decisions), [payout minimum](../decisions/README.md#settled--reconciliations)).

---

## 6. SUPPORT AGENT — the support desk

### A-37 — Case model, queue and assignment

- **SOW trace**: *"Support and Help: Access to FAQs, live chat, or call support for assistance."* · *"Customer Support: Handle customer complaints…"* · *"Feedback Handling: Address customer feedback and complaints."* · *"Technical Support: Provide technical assistance for restaurant app features."*
- **Behaviour**: Every support interaction is a `case` (§0.4). Cases arrive from in-app "contact
  support" forms (customer, restaurant, rider apps), from email into a support address, from staff
  creating one on behalf of a caller, or from the system (SLA breaches, failed payouts, compliance
  events). A case carries a threaded `case_message` transcript with three visibility levels:
  `PUBLIC` (visible to the requester), `INTERNAL` (staff only), `SYSTEM` (automatic entries). Agents
  work from tier queues with **pull-based assignment** ("Take next" with `SKIP LOCKED`), not
  push-assignment, plus a manual assign for supervisors. Priority is set on creation from the category
  and can be raised (never silently lowered — lowering requires a reason).
- **Data**: `case`, `case_escalation` (§0.4);
  `case_message {id, case_id, author_type ENUM(STAFF,CUSTOMER,RESTAURANT,RIDER,SYSTEM), author_id, visibility, body, attachments jsonb, created_at}`;
  `case_watcher {case_id, staff_id}`; `case_tag {case_id, tag}`;
  `case_link {case_id, linked_type ENUM(ORDER,REFUND,DISPUTE,INCIDENT,CASE,RESTAURANT,RIDER,CUSTOMER), linked_id}`.
  Category enum (V1, closed): `ORDER_ISSUE`, `REFUND_REQUEST`, `PAYMENT_ISSUE`, `ACCOUNT_ACCESS`,
  `PROFILE_UPDATE`, `DELIVERY_ISSUE`, `RESTAURANT_DOCUMENT_HELP`, `RIDER_ONBOARDING_HELP`,
  `EARNINGS_QUESTION`, `TECHNICAL_ISSUE`, `COMPLAINT`, `FEEDBACK`, `HALAL_QUESTION`, `OTHER`.
- **Role**: **Support Agent** — take next from Tier 1, work, respond, resolve within their authority,
  escalate. **Admin** — everything a support agent can do, plus work Tier 2, reassign cases, override
  priority, and merge/split cases. **Super Admin** — plus Tier 3 and cross-queue reassignment.
- **States**: `NEW → OPEN` (first agent action) → `PENDING_REQUESTER` (awaiting the user) →
  `OPEN` · `OPEN → PENDING_INTERNAL` (awaiting another team/provider) → `OPEN` ·
  `OPEN → RESOLVED` → `CLOSED` (auto after 7 days without reopening) · `RESOLVED → OPEN`
  (requester replies within 7 days) · `NEW|OPEN → REJECTED` (out of scope / duplicate, with reason).
- **Rules**:
  - R1 SLA clocks: `first_response_due_at` and `resolution_due_at` are computed at creation from
    `case_first_response_sla_minutes` / `case_resolution_sla_hours` by priority (A-06), pause outside
    business hours except for P1 (24/7), and pause while `PENDING_REQUESTER`.
  - R2 A case in `PENDING_REQUESTER` for 7 days auto-resolves with `resolution_code=NO_RESPONSE`, after
    one reminder at 72 hours.
  - R3 An agent may only write to a case where `assigned_staff_id = self`, or where they are a
    watcher (internal notes only), or if their role is `ADMIN`/`SUPER_ADMIN`.
  - R4 A case must have at least one `case_link` when its category implies a subject
    (`ORDER_ISSUE`, `REFUND_REQUEST`, `DELIVERY_ISSUE`, `EARNINGS_QUESTION` require an order or
    earner link) → `422 LINK_REQUIRED`.
  - R5 `PUBLIC` messages are delivered to the requester over their app's notification channel and by
    email; `INTERNAL` messages are never included in any customer-facing payload or export.
  - R6 Merging cases preserves both transcripts and redirects the merged reference; it is reversible
    within 24 hours.
  - R7 Every case state change, assignment, escalation and public message writes an `audit_event`.
- **Acceptance criteria**:
  1. Given three unassigned Tier 1 cases, when two agents press "Take next" concurrently, then each
     receives a different case and neither receives the same one.
  2. Given a P2 case created at 21:30 with a 60-minute first-response SLA and business hours ending at
     22:00, then `first_response_due_at` is 08:30 the next day (30 minutes carried over); given a P1
     case at the same moment, then it is 22:00 the same evening (P1 does not pause).
  3. Given an agent attempts to post a message on a case assigned to another agent, then
     `403 CASE_NOT_ASSIGNED`; posting an internal note as a watcher succeeds.
  4. Given a `REFUND_REQUEST` case with no `case_link`, when it is created, then `422 LINK_REQUIRED`.
  5. Given a `PENDING_REQUESTER` case with no reply for 7 days, then it is `RESOLVED` with
     `resolution_code='NO_RESPONSE'` and one reminder was sent at 72 hours.
- **Out of scope**: live chat transport and presence (a separate real-time component); voice/telephony;
  chatbot deflection; multilingual auto-translation; knowledge-base authoring beyond FAQ (A-08).
- **Version**: V1 · **Size**: L

> **Decided:** a phone line during set hours only, at launch ([support channel at launch](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).

---

### A-38 — Order lookup and admin order intervention

- **SOW trace**: *"Order Issues: Resolve order-related issues (e.g., incorrect orders, payment disputes)."* · *"Order Support: Assist customers with order placement, tracking, and refunds."* · *"Delivery Issues: Resolve delivery-related issues."*
- **Behaviour**: A single order-detail surface used by all three roles, showing: order header
  (reference, placed-at, status, current ETA), customer (masked per A-42), restaurant, rider, full
  line items with variants and add-ons and their prices, the complete pricing breakdown with the
  setting versions used, payment and refund history, the delivery address and instructions, the status
  timeline with actor attribution, the rider's route events, all linked cases, and the WebSocket event
  log for the order. From here, role-gated interventions are available: `RESEND_RECEIPT`,
  `CONTACT_RIDER`, `CONTACT_RESTAURANT`, `UPDATE_DELIVERY_INSTRUCTIONS`, `REASSIGN_RIDER`,
  `EXTEND_ETA`, `CANCEL_ORDER`, `FORCE_STATUS` (super admin only, emergency).
- **Data**: read model over the order aggregate; `order_intervention` (A-29) records every action.
- **Role**:

  | Intervention | Support Agent | Admin | Super Admin |
  |---|---|---|---|
  | View order detail (PII masked) | Allow | Allow | Allow |
  | Reveal customer phone/address (justified) | Allow, per A-42 | Allow | Allow |
  | Resend receipt / notification | Allow | Allow | Allow |
  | Update delivery instructions (pre-pickup) | Allow | Allow | Allow |
  | Extend customer-facing ETA | Allow (≤ 20 min, once) | Allow | Allow |
  | Request rider reassignment | Allow (creates request) | Allow (executes) | Allow |
  | Cancel order **before** restaurant acceptance | Allow | Allow | Allow |
  | Cancel order **after** acceptance | Deny — escalate | Allow | Allow |
  | Force an arbitrary status transition | Deny | Deny | Allow, with reason, audited |

- **States**: this feature does not own order states; it invokes legal transitions on the order state
  machine. `FORCE_STATUS` is the sole exception and is constrained to transitions the machine declares
  `admin_forceable`, never to an arbitrary string.
- **Rules**:
  - R1 Every intervention requires a linked `case_id` → `422 CASE_REQUIRED`, except cancelling after
    acceptance: staff may do that without a case, and the reason goes on the audit log
    ([cancellation policy](../decisions/README.md#settled--client-decisions); needs a contract change).
  - R2 Cancelling after acceptance always issues a refund per A-29 R1 and A-33; the two are one
    transaction from the operator's point of view.
  - R3 `FORCE_STATUS` writes an `audit_event` with severity `DESTRUCTIVE`, requires re-authentication
    (A-02 R4), and raises a P3 case at Tier 3 for after-the-fact review.
  - R4 ETA extension is customer-visible and notifies the customer; it never changes any SLA
    measurement used for restaurant or rider performance.
  - R5 The order detail response is generated from the same read model the customer app uses, so
    support and customer can never see contradictory states.
  - R6 Reassigning a rider returns the order to dispatch with the previous rider excluded from the
    next offer round.
- **Acceptance criteria**:
  1. Given a support agent and an order in `PREPARING`, when they attempt `CANCEL_ORDER`, then
     `403 FORBIDDEN_PERMISSION` and the UI offers "escalate to Tier 2" which creates the escalation.
  2. Given an admin cancels an accepted order, then the order is `CANCELLED`, a full refund is
     `AUTHORISED` in the same transaction, and one `order_intervention` row links both.
  3. Given any intervention without `case_id`, then `422 CASE_REQUIRED` — except an admin cancelling an
     accepted order, which succeeds and records the reason on the `audit_event`.
  4. Given a super admin performs `FORCE_STATUS` from `IN_TRANSIT` to `DELIVERED`, then the transition
     succeeds only if the state machine marks it `admin_forceable`, an `audit_event` exists, and a
     Tier 3 P3 review case is created.
  5. Given a support agent extends the ETA by 20 minutes twice on the same order, then the second
     attempt returns `409 ETA_EXTENSION_LIMIT` and escalation is offered.
- **Out of scope**: editing order contents (adding/removing items after placement); changing the
  delivery address after pickup; splitting an order; re-charging a customer.
- **Version**: V1 · **Size**: M

---

### A-39 — Restaurant and rider document upload assistance

- **SOW trace**: *"Document Verification: Assist restaurants with document uploads and verification."* (Support Agent) · *"Onboarding Assistance: Help riders with registration and document uploads."* (Support Agent)
- **Behaviour**: A guided, read-mostly surface that lets an agent see exactly where an applicant is
  stuck and help them move. The agent sees: the applicant's `onboarding_state`, the required document
  checklist with each item's `review_status` and, where rejected, the `rejection_reason_code` and the
  customer-facing remediation text; upload errors the applicant hit (size, type, scan failure); and a
  "send upload link" action that emails/pushes a single-use, 24-hour link taking the applicant
  directly to the failing step. The agent may **not** open the document contents (A-14 role rule) and
  may **not** upload on the applicant's behalf in V1 — with one exception below.
- **Data**: read model over `restaurant_application`/`rider_application` and `*_document`;
  `onboarding_assist_event {id, case_id, applicant_type, applicant_id, action, doc_type null, created_by, created_at}`;
  `upload_link {id, applicant_type, applicant_id, doc_type null, token_hash, expires_at, consumed_at, created_by}`.
- **Role**: **Support Agent** — view checklist and statuses, send upload links, record assistance,
  re-open a remediably-rejected application (A-23 role rule; same for restaurants), answer document
  questions. **Admin** — all of the above, plus upload a document on the applicant's behalf when the
  applicant has emailed it in (`uploaded_by_type = STAFF`), which then **must** be reviewed by a
  *different* admin (A-14 R3). **Super Admin** — all of the above.
- **States**: no new lifecycle; drives `*_document` and `*_application` states already defined.
- **Rules**:
  - R1 A support agent viewing this surface sees `doc_type`, `review_status`, `rejection_reason_code`
    and the remediation string only. Any attempt to fetch a document object → `403`.
  - R2 Upload links are single-use, 24-hour, scoped to one applicant and optionally one `doc_type`,
    and their creation and consumption are audited.
  - R3 Staff-uploaded documents are indelibly marked `uploaded_by_type = STAFF` with the staff id, and
    are excluded from same-person review.
  - R4 Every assistance action requires a `case_id`.
  - R5 Nothing on this surface can approve, reject or advance an application's decision state.
- **Acceptance criteria**:
  1. Given a restaurant stuck with a rejected `FOOD_HANDLING_PERMIT`, when an agent opens the assist
     view, then they see `rejection_reason_code='EXPIRED'` and the remediation text, and the document
     fetch endpoint returns `403`.
  2. Given the agent sends an upload link, then exactly one `upload_link` exists, it works once, and a
     second use returns `410 LINK_CONSUMED`.
  3. Given an admin uploads a document on a restaurant's behalf and then tries to approve it, then
     `409 SELF_REVIEW_FORBIDDEN`.
  4. Given a support agent re-opens an application rejected for `ILLEGIBLE`, then its state is
     `CHANGES_REQUESTED`; for `SUSPECTED_FORGERY`, then `403 REOPEN_NOT_PERMITTED_FOR_REASON`.
- **Out of scope**: agents filling in application form fields; screen sharing / co-browsing;
  document editing; expediting the review queue.
- **Version**: V1 · **Size**: S

---

### A-40 — Customer account assistance

- **SOW trace**: *"Account Assistance: Help customers with account-related issues (e.g., login problems, profile updates)."*
- **Behaviour**: The bounded set of things an agent may do to a customer's account, each defined and
  each audited. Permitted: (1) trigger a login/OTP re-send (rate-limited, never revealing the code —
  the agent sees only "sent at 7:42 pm to number ending 4821"); (2) trigger a password-reset email;
  (3) correct a customer's display name or email **after** verifying identity, with the old value
  retained; (4) correct or delete a saved delivery address; (5) clear a stuck `ORDERING_RESTRICTED`
  caused by a resolved payment failure; (6) resend receipts; (7) unlock an account locked by failed
  login attempts. Explicitly not permitted for any staff role: viewing or setting a password, viewing
  an OTP code, viewing full card data, changing a phone number without OTP verification on the new
  number, or logging in as the customer.
- **Data**: `customer` profile fields; `account_assist_event {id, case_id, customer_id, action, before_json, after_json, verification_method, created_by, created_at}`.
  `verification_method` enum: `OTP_TO_REGISTERED_PHONE`, `EMAIL_LINK_CONFIRMED`,
  `ORDER_HISTORY_CHALLENGE` (customer states two recent order facts), `NOT_REQUIRED`.
- **Role**: **Support Agent** — all seven permitted actions. **Admin** — same, plus merging duplicate
  customer accounts and changing a verified phone number (which still requires OTP on the new number).
  **Super Admin** — same, plus executing an erasure request (A-28).
- **States**: no new lifecycle.
- **Rules**:
  - R1 Identity verification is mandatory before any mutating action: `verification_method` must be
    recorded and must not be `NOT_REQUIRED` for actions 3, 4 and 7 → `422 VERIFICATION_REQUIRED`.
  - R2 Email changes require confirmation on the **new** address before they take effect; the old
    address is notified and can revert within 7 days.
  - R3 Phone changes require OTP on the new number; staff can initiate but never complete them.
  - R4 No staff role may authenticate as a customer. There is no impersonation feature in V1 (see
    D-28).
  - R5 OTP re-send is rate-limited to 3 per hour per customer across all channels including staff
    initiation, and the agent never sees the code.
  - R6 Every action requires `case_id` and writes both an `account_assist_event` and an `audit_event`.
- **Acceptance criteria**:
  1. Given an agent changes a customer's email with `verification_method='ORDER_HISTORY_CHALLENGE'`,
     then the change is pending until the new address confirms, the old address is notified, and both
     values are in the audit event.
  2. Given an agent attempts to change a delivery address with no `verification_method`, then
     `422 VERIFICATION_REQUIRED`.
  3. Given an agent triggers a third OTP within an hour and then a fourth, then the fourth returns
     `429 OTP_RATE_LIMITED` and no code is sent.
  4. Given any staff role, when they call any endpoint that would issue a customer session token, then
     no such endpoint exists (verified by the route inventory test).
- **Out of scope**: customer impersonation/"view as user"; password viewing or setting; storing or
  displaying card numbers; social-account unlinking; account merging for restaurants or riders.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — D-28 · Support impersonation**: Do support agents need a "view the app as
> this customer" capability to diagnose issues? · **Proposed default**: No impersonation in V1;
> instead the order-detail read model (A-38) shows exactly what the customer sees. If required later,
> implement as a read-only, time-boxed, consent-recorded, fully-audited shadow session — never a real
> customer token. · **Why**: Impersonation is the highest-risk support feature and is unnecessary if
> the read models are faithful.

---

### A-41 — Delivery issue resolution

- **SOW trace**: *"Delivery Issues: Resolve delivery-related issues (e.g., incorrect addresses, order delays)."* (Support Agent) · *"Incorrect Addresses"* (rider incident) · *"Delivery Instructions"* (customer)
- **Behaviour**: A guided workflow for the five delivery failure modes, each with a defined decision
  tree, permitted remedies and role gates.

  | Failure mode | Detection | Support Agent remedy | Escalates when |
  |---|---|---|---|
  | `ADDRESS_UNREACHABLE` | rider incident or customer call | Correct the address if the new address is within the same delivery zone and the order is pre-pickup; re-dispatch instructions to the rider | New address outside zone, or post-pickup and beyond the fee already charged |
  | `CUSTOMER_UNREACHABLE` | rider reports no answer | Attempt contact; authorise "leave at door" if the customer consents in writing on the case; start a 10-minute wait timer | No contact after the timer → Tier 2 decides abandon-and-charge or return-and-refund |
  | `ORDER_DELAYED` | ETA exceeded by > 15 min | Extend ETA once (≤ 20 min, A-38), issue goodwill credit within cap (A-34), inform the customer | Delay > 45 min, or customer requests cancellation after pickup |
  | `RIDER_UNRESPONSIVE` | no location updates for 10 min while `IN_TRANSIT` | Attempt contact; request reassignment | No contact for 20 min → Tier 2, order enters `RECOVERY` (A-29) |
  | `WRONG_OR_MISSING_ITEMS` | customer report at delivery | Record the itemised claim with evidence; refund within cap (A-33 `PARTIAL_ITEMS`) | Claim exceeds the agent's cap, or the restaurant contests it (→ A-35 dispute) |

- **Data**: `case` with `category = DELIVERY_ISSUE`; `delivery_issue_detail {case_id pk, failure_mode, order_id, original_address_id, corrected_address_id null, consent_recorded_at null, wait_timer_started_at null, outcome_code, remedy_refund_id null, remedy_credit_id null}`.
- **Role**: **Support Agent** — everything in the "remedy" column, within A-33/A-34 caps.
  **Admin** — all remedies without the zone/pre-pickup constraints, decide abandon-vs-return, assign
  liability. **Super Admin** — override anything, authorise above-cap compensation.
- **States**: case lifecycle; `outcome_code`: `DELIVERED_AFTER_CORRECTION`, `LEFT_AT_DOOR_WITH_CONSENT`,
  `RETURNED_AND_REFUNDED`, `ABANDONED_AND_CHARGED`, `PARTIAL_REFUND_ISSUED`, `FULL_REFUND_ISSUED`,
  `NO_ACTION_REQUIRED`.
- **Rules**:
  - R1 An address correction post-pickup is forbidden to support agents because it changes the
    delivery distance and therefore the rider's pay and the customer's fee →
    `403 POST_PICKUP_ADDRESS_CHANGE`. Admins may do it and must record the fee/pay adjustment.
  - R2 `ABANDONED_AND_CHARGED` (customer charged, food left/discarded) requires: a recorded contact
    attempt log with at least two attempts across two channels, a 10-minute wait, and Tier 2
    authorisation. It can never be a Tier 1 decision.
  - R3 "Leave at door" without prior customer consent recorded on the case is forbidden; consent is
    stored with a timestamp and the channel it arrived on.
  - R4 Every remedy that moves money routes through A-33/A-34 with their caps and audit intact.
  - R5 The rider is paid in full for `ABANDONED_AND_CHARGED` and `RETURNED_AND_REFUNDED`.
- **Acceptance criteria**:
  1. Given an order pre-pickup with an unreachable address, when the agent corrects it to an address
     in the same zone, then the order updates, the rider is notified, and the fee is unchanged; when
     the new address is outside the zone, then `403 OUT_OF_ZONE` and escalation is offered.
  2. Given a post-pickup address change attempt by a support agent, then
     `403 POST_PICKUP_ADDRESS_CHANGE`.
  3. Given `ABANDONED_AND_CHARGED` attempted by a Tier 1 agent, then `403 FORBIDDEN_PERMISSION`; given
     the same at Tier 2 with only one contact attempt logged, then `422 CONTACT_ATTEMPTS_INSUFFICIENT`.
  4. Given `LEFT_AT_DOOR_WITH_CONSENT` with no `consent_recorded_at`, then `422 CONSENT_REQUIRED`.
  5. Given a `RETURNED_AND_REFUNDED` outcome, then the customer receives a full refund and the rider's
     earnings for the order are unchanged.
- **Out of scope**: automated address validation/geocoding correction suggestions (V2); rider
  turn-by-turn re-routing from the admin app; parcel-locker or reception-desk workflows.
- **Version**: V2 · **Size**: M

---

### A-42 — Global entity search, PII masking and access justification

- **SOW trace**: Derived from every Support Agent duty (all require finding the right record) and from the SOW's *"Data Security"* and *"Confidentiality"* obligations.
- **Behaviour**: One search box resolving a typed query across customers, restaurants, riders, orders,
  cases and refunds, by: order reference, case reference, email, phone (E.164 or last 4), name,
  business name, restaurant id, and partial address. Results are role-filtered and **masked by
  default**: phone as `••• ••• 4821`, email as `j•••@g•••.com`, address as street-less
  (`Toronto, M5V`), payment instrument as `VISA ••4242`. Full values are revealed only through an
  explicit "reveal" action that requires a linked `case_id` and a `justification_code`, is rate
  limited, and writes an `audit_event` per revealed field. Card PAN, CVV and full bank account numbers
  are never revealable by any role — they are not stored in a retrievable form.
- **Data**: search index (Postgres full-text + trigram on a materialised `search_document` table, or
  the same over live tables with the required indexes — no external search engine in V1);
  `pii_access_event {id, staff_id, case_id, subject_type, subject_id, field, justification_code, created_at}`.
  `justification_code`: `CONTACTING_CUSTOMER`, `VERIFYING_IDENTITY`, `DELIVERY_ISSUE`,
  `FRAUD_INVESTIGATION`, `LEGAL_REQUEST`, `PAYOUT_INVESTIGATION`.
- **Role**: **Support Agent** — search all entity types; reveal phone, email and delivery address with
  justification; never reveal payment instruments beyond the last 4 and brand; never see staff records.
  **Admin** — same plus staff-list read, plus reveal without a case link for compliance
  investigations (still justified and audited). **Super Admin** — everything, plus read the
  `pii_access_event` log and run reveal-frequency reports.
- **States**: n/a.
- **Rules**:
  - R1 Masking is applied **server-side**. A masked field is never present in the response payload in
    unmasked form. (Client-side masking would be defeated by opening dev tools.)
  - R2 Reveal is rate-limited: 20 reveals per agent per hour; exceeding it locks reveals for that agent
    for 1 hour and raises a P3 case at Tier 2.
  - R3 A reveal without a `case_id` by a support agent → `422 CASE_REQUIRED`.
  - R4 Search results never include entities the caller's role cannot open (e.g. support agents get no
    `staff_user` results at all, not "0 results" for a query that matched).
  - R5 Every search query string is **not** logged verbatim if it could contain PII; the query is
    hashed and the result count logged. Reveals are logged in full.
  - R6 A weekly report to Super Admin lists the top revealers, reveals without case links, and any
    reveal on an entity with no case activity — the standard snooping detection pattern.
- **Acceptance criteria**:
  1. Given a support agent searches a phone number, then the result rows show `••• ••• 4821` and the
     raw JSON payload contains no full phone number.
  2. Given they press reveal with `case_id` and `justification_code='CONTACTING_CUSTOMER'`, then the
     full number is returned once and a `pii_access_event` row exists.
  3. Given 21 reveals within an hour, then the 21st returns `429 REVEAL_RATE_LIMITED` and a P3 case
     exists at Tier 2.
  4. Given a support agent searches a staff member's email, then zero staff results are returned and
     no indication that a staff record matched.
  5. Given any role, when they request full card data for an order, then the response contains only
     brand and last 4, and no endpoint exists that returns more.
- **Out of scope**: external search infrastructure (Elasticsearch/OpenSearch); fuzzy name matching
  beyond trigram; cross-entity graph views; data-loss-prevention on exports beyond the audit trail.
- **Version**: V1 · **Size**: M

---

## 7. RBAC permission matrix

Permission keys are the authoritative vocabulary: every admin API handler declares exactly one of
these (A-02 R1). `Allow` = unconditional. `Limited` = allowed subject to the named constraint, which
is enforced server-side. `Deny` = `403 FORBIDDEN_PERMISSION`.

### 7.1 Staff, access and platform configuration

| Permission | Feature | Super Admin | Admin | Support Agent |
|---|---|---|---|---|
| `staff.read` | A-01 | Allow | Limited — list only (name, role, status) | Deny |
| `staff.create` | A-01 | Allow | Deny | Deny |
| `staff.update_role` | A-01 | Limited — never own account | Deny | Deny |
| `staff.suspend` / `staff.deactivate` | A-01 | Limited — never own account; ≥2 super admins must remain | Deny | Deny |
| `staff.reactivate` | A-01 | Allow | Deny | Deny |
| `rbac.read_matrix` | A-02 | Allow | Limited — own effective permissions only | Limited — own only |
| `rbac.edit_matrix` | A-02 | Deny (V1 — compile-time constant) | Deny | Deny |
| `session.read_any` / `session.revoke_any` | A-03 | Allow | Deny | Deny |
| `session.revoke_own` | A-03 | Allow | Allow | Allow |
| `audit.read_all` | A-04/05 | Allow | Deny | Deny |
| `audit.read_operational` | A-04/05 | Allow | Allow — operational target types only | Limited — single entity, 90 days |
| `audit.export` | A-05 | Allow | Limited — single `target_id` per export | Deny |
| `audit.verify_chain` | A-04 | Allow | Deny | Deny |
| `setting.read` | A-06 | Allow | Allow | Limited — `SLA` and `CORE` classes only |
| `setting.propose_pricing` / `setting.propose_payout` | A-06 | Allow | Deny | Deny |
| `setting.propose_operational` | A-06 | Allow | Limited — `SLA`, `COMPLIANCE` classes | Deny |
| `setting.approve` | A-06 | Limited — never own proposal | Deny | Deny |
| `promotion.read` | A-07 | Allow | Allow | Limited — terms + a named customer's redemptions |
| `promotion.create` / `promotion.edit` / `promotion.resume` | A-07 | Allow | Deny | Deny |
| `promotion.pause` | A-07 | Allow | Allow | Deny |
| `content.read` | A-08 | Allow | Allow | Allow — published only |
| `content.draft` | A-08 | Allow | Allow | Limited — FAQ proposals only |
| `content.publish_faq` | A-08 | Allow | Allow | Deny |
| `content.publish_legal` | A-08 | Allow | Deny | Deny |
| `analytics.read_operational` | A-09 | Allow | Allow | Limited — case/SLA/in-flight tiles only |
| `analytics.read_financial` | A-09 | Allow | Deny | Deny |
| `report.run_operational` | A-10 | Allow | Allow | Deny |
| `report.run_financial` | A-10 | Allow | Deny | Deny |
| `report.schedule` | A-10 | Allow | Deny | Deny |
| `oversight.read_agent_metrics` | A-11 | Allow | Limited — team aggregates + own-queue agents | Limited — own metrics only |
| `oversight.create_quality_review` | A-11 | Allow | Deny | Deny |

### 7.2 Restaurant domain

| Permission | Feature | Super Admin | Admin | Support Agent |
|---|---|---|---|---|
| `restaurant.read` | A-13/21 | Allow | Allow | Limited — operational summary, from a case |
| `restaurant_application.take` | A-13 | Allow | Allow | Deny |
| `restaurant_application.reassign` | A-13 | Allow | Deny | Deny |
| `restaurant_document.read_status` | A-13/39 | Allow | Allow | Allow |
| `restaurant_document.view_content` | A-13/14 | Allow | Allow | **Deny** |
| `restaurant_document.review` | A-14 | Allow | Allow | Deny |
| `restaurant_document.override_decision` | A-14 | Allow | Deny | Deny |
| `restaurant_document.upload_on_behalf` | A-39 | Allow | Allow | Deny |
| `halal_certificate.read_summary` | A-15 | Allow | Allow | Allow — status, expiry, issuer, reason only |
| `halal_certificate.read_full` | A-15 | Allow | Allow | Deny |
| `halal_certificate.verify` (transcribe + record checks) | A-15 | Allow | Allow | Deny |
| `halal_certificate.approve` / `halal_certificate.reject` | A-15 | Allow | Allow | Deny |
| `halal_certificate.revoke` | A-15 | Allow | Deny | Deny |
| `halal_certificate.grant_grace` | A-17 | Limited — 7 days, once per certificate | Deny | Deny |
| `halal_issuing_body.read` | A-16 | Allow | Allow | Limited — name + status |
| `halal_issuing_body.propose` | A-16 | Allow | Allow | Deny |
| `halal_issuing_body.decide` | A-16 | Allow | Deny | Deny |
| `restaurant.approve` / `restaurant.reject` / `restaurant.request_changes` | A-18 | Allow | Allow | Deny |
| `restaurant.reverse_rejection` | A-18 | Limited — ≤30 days | Deny | Deny |
| `menu.read_queue` | A-19 | Allow | Allow | Allow — position, SLA, findings |
| `menu.review` (approve / reject / partial; refused while the restaurant is suspended or banned, [menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) | A-19 | Allow | Allow | Deny |
| `menu.bulk_approve` (refused while the restaurant is suspended or banned, as above) | A-19 | Allow | Deny | Deny |
| `menu.edit` (create, update or remove on a restaurant's behalf; refused while it is suspended or banned, [menu lock](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) | A-19 | Allow | Allow | Deny |
| `compliance.read` | A-20 | Allow | Allow | Limited — violation summary only |
| `compliance.raise_violation` | A-20 | Allow | Allow | Deny |
| `compliance.waive_violation` | A-20 | Allow | Allow | Deny |
| `restaurant.suspend` / `restaurant.reinstate` | A-22 | Allow | Allow | **Deny — escalate** |
| `restaurant.propose_ban` | A-22 | Allow | Allow | Deny |
| `restaurant.confirm_ban` / `restaurant.unban` | A-22 | Allow | Deny | Deny |
| `restaurant.deactivate_on_request` | A-22 | Allow | Allow — requires linked case | Deny |
| `restaurant.close` | A-22 | Allow | Deny | Deny |

### 7.3 Rider domain

| Permission | Feature | Super Admin | Admin | Support Agent |
|---|---|---|---|---|
| `rider.read` | A-23/25 | Allow | Allow | Limited — from a case |
| `rider_application.take` | A-23 | Allow | Allow | Deny |
| `rider_document.read_status` | A-23/39 | Allow | Allow | Limited — through a support case |
| `rider_document.view_content` | A-23 | Allow | Allow | **Deny** |
| `rider_document.review` | A-23 | Allow | Allow | Deny |
| `rider.approve` / `rider.reject` | A-23 | Allow | Allow | Deny |
| `rider_application.reopen_remediable` | A-23/39 | Allow | Allow | Allow — remediable reasons only |
| `rider.grant_doc_grace` | A-24 | Limited — 7 days, once | Deny | Deny |
| `rider.force_offline` | A-24/27 | Allow | Allow | Deny |
| `rider.suspend` / `rider.reinstate` | A-27 | Allow | Allow | **Deny — escalate** |
| `rider.propose_ban` | A-27 | Allow | Allow | Deny |
| `rider.confirm_ban` / `rider.unban` / `rider.close` | A-27 | Allow | Deny | Deny |
| `incident.read` | A-26 | Allow | Allow | Allow |
| `incident.create` | A-26 | Allow | Allow | Allow |
| `incident.resolve_p3` | A-26 | Allow | Allow | Allow |
| `incident.resolve_p2` | A-26 | Allow | Allow | Deny |
| `incident.resolve_p1` | A-26 | Allow | Deny | Deny |
| `rider_performance.read` | A-25 | Allow | Allow | Limited — single rider, from a case |

### 7.4 Customer, content and orders

| Permission | Feature | Super Admin | Admin | Support Agent |
|---|---|---|---|---|
| `customer.read` | A-28/42 | Allow | Allow | Allow — masked (A-42) |
| `customer.restrict_ordering` | A-28 | Allow | Allow | Limited — `PAYMENT_FAILURE_UNRESOLVED` only |
| `customer.suspend` / `customer.reinstate` | A-28 | Allow | Allow | Deny |
| `customer.propose_ban` | A-28 | Allow | Allow | Deny |
| `customer.confirm_ban` / `customer.unban` | A-28 | Allow | Deny | Deny |
| `customer.close_and_erase` | A-28 | Allow | Deny | Deny |
| `customer.assist` (OTP resend, reset, unlock, profile fix) | A-40 | Allow | Allow | Allow — verification required |
| `customer.change_verified_phone` | A-40 | Allow | Allow — OTP on new number still required | Deny |
| `customer.merge_accounts` | A-40 | Allow | Allow | Deny |
| `customer.impersonate` | A-40 | **Deny — feature does not exist** | Deny | Deny |
| `review.read` | A-30 | Allow | Allow | Allow |
| `review.moderate` (remove / redact / restore) | A-30 | Allow | Allow | Deny |
| `review.remove_rating` / `review.bulk_action` | A-30 | Allow | Deny | Deny |
| `review.triage_flag` | A-30 | Allow | Allow | Allow — `NO_ACTION` and recommendations only |
| `report.triage` | A-31 | Allow | Allow | Allow |
| `report.resolve_standard` | A-31 | Allow | Allow | Limited — `INAPPROPRIATE_CONTENT`, `OTHER` with `NO_ACTION` |
| `report.resolve_sensitive` (fraud, halal, safety, impersonation) | A-31 | Allow | Allow | Deny |
| `report.resolve_staff_target` | A-31 | Allow | Deny | Deny |
| `feedback.read` | A-32 | Allow | Allow | Limited — entities on own cases |
| `feedback.assign_theme` / `feedback.convert_to_case` | A-32 | Allow | Allow | Allow |
| `order.read` | A-38 | Allow | Allow | Allow — masked |
| `order.resend_receipt` / `order.update_instructions` | A-38 | Allow | Allow | Allow |
| `order.extend_eta` | A-38 | Allow | Allow | Limited — ≤20 min, once per order |
| `order.reassign_rider` | A-38 | Allow | Allow | Limited — creates a request, does not execute |
| `order.cancel_pre_acceptance` | A-38 | Allow | Allow | Allow |
| `order.cancel_post_acceptance` | A-38 | Allow | Allow | **Deny — escalate** |
| `order.force_status` | A-38 | Limited — `admin_forceable` transitions only, reauth + Tier 3 review | Deny | Deny |
| `order.correct_address_pre_pickup` | A-41 | Allow | Allow | Limited — same delivery zone only |
| `order.correct_address_post_pickup` | A-41 | Allow | Allow | Deny |
| `order.authorise_abandon_and_charge` | A-41 | Allow | Allow | Deny |

### 7.5 Money

| Permission | Feature | Super Admin | Admin | Support Agent |
|---|---|---|---|---|
| `refund.read` | A-33 | Allow | Allow | Allow |
| `refund.issue_capped` | A-33 | — | — | Allow — ≤CAD 25/order, ≤CAD 150/24h, ≤14-day-old orders |
| `refund.issue` | A-33 | Allow | Allow — ≤order total, ≤CAD 2,000/24h, ≤90-day-old orders | Deny |
| `refund.issue_unlimited` (ex-gratia above order total) | A-33 | Allow | Deny | Deny |
| `refund.approve` (four-eyes / above-cap requests) | A-33 | Limited — never own request | Limited — never own request, below own cap ceiling | Deny |
| `credit.issue` | A-34 | Allow — unlimited | Allow — ≤CAD 100/case, ≤CAD 1,000/day | Allow — ≤CAD 15/case, ≤CAD 100/day |
| `credit.revoke` | A-34 | Allow | Allow — unused credits only | Deny |
| `dispute.read` | A-35 | Allow | Allow | Allow |
| `dispute.open` / `dispute.add_evidence` | A-35 | Allow | Allow | Allow |
| `dispute.resolve_capped` | A-35 | — | — | Limited — within refund cap **and** `liable_party = PLATFORM` |
| `dispute.resolve` (assign liability to partner) | A-35 | Allow | Allow | Deny |
| `dispute.resolve_chargeback` / `dispute.override_liability` | A-35 | Allow | Deny | Deny |
| `earnings.read` | A-36 | Allow | Allow | Limited — periods containing the case's order |
| `earnings.recompute` | A-36 | Allow | Allow | Allow |
| `earnings.adjust` | A-36 | Allow | Allow — within refund cap equivalent | Deny |
| `payout.retry_batch` | A-36 | Allow | Allow | Deny |
| `payout.cancel_batch` / `payout.change_schedule` | A-36 | Allow | Deny | Deny |

### 7.6 Support desk and data access

| Permission | Feature | Super Admin | Admin | Support Agent |
|---|---|---|---|---|
| `case.read` | A-37 | Allow | Allow | Allow |
| `case.take_tier1` | A-37 | Allow | Allow | Allow |
| `case.work_tier2` | A-37 | Allow | Allow | Deny |
| `case.work_tier3` | A-37 | Allow | Deny | Deny |
| `case.assign_other` / `case.merge` / `case.override_priority` | A-37 | Allow | Allow | Deny |
| `case.escalate` | A-12 | Allow — to Tier 3 | Allow — to Tier 3 | Limited — Tier 1 → Tier 2 only |
| `case.de_escalate` | A-12 | Allow | Allow — Tier 2 → Tier 1 | Deny |
| `onboarding.assist` (view checklist, send upload link) | A-39 | Allow | Allow | Allow |
| `search.global` | A-42 | Allow | Allow | Allow — no staff results |
| `pii.reveal` | A-42 | Allow | Allow — case link optional with justification | Limited — case link + justification, ≤20/hour |
| `pii.reveal_payment_instrument` | A-42 | **Deny — no role; brand + last 4 only** | Deny | Deny |
| `pii.read_access_log` | A-42 | Allow | Deny | Deny |

### 7.7 The three answers this matrix encodes

1. **Someone can approve a restaurant**: `ADMIN` holds `restaurant.approve` and
   `halal_certificate.approve` (A-15, A-18) — V1.
2. **Someone can approve a rider**: `ADMIN` holds `rider.approve` (A-23) — V1.
3. **Someone can issue a refund**: `SUPPORT_AGENT` holds `refund.issue_capped` (≤ CAD 25) and `ADMIN`
   holds `refund.issue` (full order value) (A-33) — V1. `SUPER_ADMIN` is not required for the
   day-to-day money path, only for exceptions above the cap.

---

## 8. Decisions required

Every one of these has a proposed default already written into the spec above; the spec is
implementable as-is. Confirming or changing them is a client decision, not a blocker.

| # | Topic | Question | Proposed default | Affects |
|---|---|---|---|---|
| D-01 | Staff seat model | Is there a maximum number of active staff accounts, with a commercial consequence? | **Decided** in part: no warning above 25 at launch ([staff account warning](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)); ceiling still open | A-01 |
| D-02 | Runtime-editable roles | Must roles/permissions be editable in the UI, or is a fixed three-role model acceptable? | Fixed three roles V1–V2; custom roles V3, super-admin-only | A-02 |
| D-03 | Audit retention | How long must staff audit events be retained? | 7 years, hot + object-locked cold storage, no deletion path | A-04 |
| D-04 | Staff-audit visibility | May a regular Admin see staff-account and settings audit events? | No — Super Admin only | A-04, A-05 |
| D-05 | Canadian sales tax | Who computes GST/HST/PST/QST, and are delivery and service fees taxable? | Platform applies a client-supplied province rate table to all lines; version stored on the order | A-06 |
| D-06 | Restaurant commission | What is the platform's commission on the food subtotal? | **Decided:** 0%, per-restaurant field retained ([platform commission](../decisions/README.md#settled--client-decisions)) | A-06, A-36 |
| D-07 | Promotion funding | Who absorbs a platform promotion's discount, and must the restaurant consent? | Platform funds by default; restaurant/split requires recorded opt-in | A-07 |
| D-08 | Ban authority | Can one Admin permanently ban a partner, or must a Super Admin confirm? | Admin proposes (entity → SUSPENDED), Super Admin confirms within 7 days or it lapses | A-22, A-27, A-28 |
| D-09 | Required restaurant documents | Which documents are mandatory in the target provinces? | **Decided:** business licence, food-safety permit, halal certificate, owner government ID; insurance hidden until V2 ([required documents](../decisions/README.md#settled--reconciliations)) | A-13, A-14 |
| D-10 | Accepted halal certifiers | Curated allow-list or any certifier? | **Decided:** curated list of three seeded bodies, extensible at runtime by a Super Admin ([accepted certifying bodies](../decisions/README.md#settled--client-decisions)) | A-15, A-16 |
| D-11 | Certificate authenticity depth | Documentary check only, or must the issuing body be contacted? | Documentary check in V1; optional recorded issuer confirmation, mandatory per-body via a flag | A-15 |
| D-12 | Minimum remaining validity | How much certificate life must remain at approval? | 30 days, configurable, hard-enforced | A-15, A-17 |
| D-13 | Halal scope semantics | Do `KITCHEN_ONLY` / `SUPPLIER_CHAIN_ONLY` certificates qualify for listing? | `WHOLE_ESTABLISHMENT` and `KITCHEN_ONLY` only; others rejected pending item-level certification (V3) | A-15 |
| D-14 | Menu re-review scope | Whole menu or diff only on resubmission? | Diff for decision, whole menu as context, version snapshot retained | A-19 |
| D-15 | Material price threshold | Is a 20% price increase the right bar for pre-moderation? | 20%, configurable | A-19 |
| D-16 | Compliance thresholds | Are the violation point weights and the 5/10/15 ladder acceptable, and must they be published? | Ship as default policy, configurable, published as `restaurant_policy` | A-20 |
| D-17 | Payouts to banned partners | Are earned funds still paid after a ban? | Yes, after a 30-day hold, less upheld refunds; longer holds need a Super Admin legal reason | A-22, A-27, A-36 |
| D-18 | Rider background checks | Is criminal-record or driving-abstract screening required? | Not in V1; `background_check_status` field reserved, defaults `NOT_REQUIRED` | A-23 |
| D-19 | Rider insurance | Must the policy permit commercial delivery use, and does the platform carry coverage? | Admin must confirm no delivery exclusion; platform carries none and says so in `rider_policy` | A-23 |
| D-20 | Customer erasure scope | What survives a PIPEDA erasure request? | Pseudonymise identifiers; retain financial and order records 7 years under an irreversible `customer_ref` | A-28 |
| D-21 | Rider pay on interrupted delivery | What is a rider paid when a platform decision aborts their delivery? | Full fee if picked up; 50% if assigned and travelled; nothing if unassigned before travel | A-29 |
| D-22 | Food-waste cost on halal suspension | Who bears the cost of discarded prepared food? | Restaurant not settled for those orders; platform funds the customer refund; reversible if the finding is overturned | A-29 |
| D-23 | Support agent refund cap | Maximum refund without approval, per order and per day? | CAD 25.00 per order, CAD 150.00 per rolling 24h, orders ≤14 days old | A-33 |
| D-24 | Refund liability allocation | Are partner-caused refunds deducted automatically? | Computed at authorisation, deducted at next settlement, 72-hour window to dispute first | A-33, A-35, A-36 |
| D-25 | Dispute response window | How long before a dispute can be resolved without a party? | 72 hours, resolvable earlier on response or waiver | A-35 |
| D-26 | Payout schedule | How often are partners paid, and is there a minimum? | **Decided:** weekly, Monday, automatic, no minimum ([payout cadence](../decisions/README.md#settled--client-decisions)) | A-36 |
| D-27 | Support channels at launch | In-app form only, or also email, chat and phone? | **Decided:** phone line during set hours only, at launch ([support channel at launch](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) | A-37 |
| D-28 | Support impersonation | Do agents need a "view as customer" capability? | No impersonation in V1; faithful read models instead; if ever needed, read-only, consented, time-boxed, audited | A-40 |

---

## 9. Feature index

| # | Feature | Role owner | Version | Size |
|---|---|---|---|---|
| A-01 | Staff account provisioning | Super Admin | V1 | M |
| A-02 | Role-based access control model | Super Admin | V1 | M |
| A-03 | Staff authentication, MFA and session policy | All | V1 | M |
| A-04 | Audit log (append-only, hash-chained) | Super Admin / Admin read | V1 | M |
| A-05 | Audit log viewer and export | Super Admin / Admin | V1 | S |
| A-06 | Global platform settings | Super Admin | V1 | M |
| A-07 | Promotions and campaigns | Super Admin | V2 | L |
| A-08 | Content management (FAQ, T&C, Privacy) | Super Admin | V2 | M |
| A-09 | Platform KPI dashboard | All (tiered) | V1 | S |
| A-10 | Scheduled reports and data export | Super Admin / Admin | V3 | M |
| A-11 | Support team oversight | Super Admin | V3 | M |
| A-12 | Escalation routing and tiering | All | V1 | M |
| A-13 | Restaurant onboarding review queue | Admin | V1 | M |
| A-14 | KYC document review (non-halal) | Admin | V1 | M |
| A-15 | **Halal certification verification** | Admin | V1 | L |
| A-16 | Halal issuing-body registry | Super Admin | V1 | S |
| A-17 | Halal certificate expiry and lapse handling | System / Admin | V1 | M |
| A-18 | Restaurant approval / rejection decision | Admin | V1 | M |
| A-19 | Menu approval queue | Admin | V1 | L |
| A-20 | Restaurant compliance monitoring | Admin | V2 | M |
| A-21 | Restaurant performance monitoring | Admin | V2 | M |
| A-22 | Restaurant account state actions | Admin / Super Admin | V1 | M |
| A-23 | Rider onboarding review and approval | Admin | V1 | M |
| A-24 | Rider document expiry monitoring | System / Admin | V1 | S |
| A-25 | Rider performance monitoring | Admin | V2 | M |
| A-26 | Rider incident handling | Support / Admin / Super Admin | V2 | M |
| A-27 | Rider account state actions | Admin / Super Admin | V1 | S |
| A-28 | Customer account state actions | Admin / Super Admin | V1 | S |
| A-29 | In-flight order treatment on state change | System | V1 | M |
| A-30 | Review moderation | Admin | V2 | M |
| A-31 | Abuse and fraud report handling | Support / Admin | V2 | M |
| A-32 | Feedback and ratings review | Admin | V2 | S |
| A-33 | Refund issuance and authority limits | All (capped) | V1 | L |
| A-34 | Goodwill credit issuance | All (capped) | V2 | S |
| A-35 | Dispute case management | Support / Admin / Super Admin | V2 | L |
| A-36 | Rider earnings and payout dispute assistance | Support / Admin | V2 | M |
| A-37 | Case model, queue and assignment | All | V1 | L |
| A-38 | Order lookup and admin order intervention | All (tiered) | V1 | M |
| A-39 | Document upload assistance | Support Agent | V1 | S |
| A-40 | Customer account assistance | Support Agent | V1 | M |
| A-41 | Delivery issue resolution | Support / Admin | V2 | M |
| A-42 | Global search, PII masking, access justification | All | V1 | M |

**Totals** — V1: 27 · V2: 13 · V3: 2 · **42 features**.
By size: S 9 · M 27 · L 6.

### 9.1 The V1 critical path for a single real paid order

A restaurant must be approvable, a rider must be approvable, and a refund must be issuable. The
minimum V1 chain is: **A-03** (staff can log in securely) → **A-02** (roles enforced) → **A-04**
(everything recorded) → **A-13/A-14** (documents reviewed) → **A-15/A-16** (halal verified — the
product's reason to exist) → **A-18** (restaurant approved) → **A-19** (menu v1 approved, go-live
gate) → **A-23** (rider approved) → **A-06** (fees configured so pricing is server-authoritative) →
**A-33** (refund issuable when it goes wrong) → **A-29** (in-flight orders handled when an entity
stops trading). Everything else in V1 exists to keep that chain operable: A-37/A-38/A-42 make the
support desk able to answer a phone call; A-17/A-24 keep the compliance claim true after launch;
A-22/A-27/A-28 stop bad actors; A-05/A-09/A-12/A-39/A-40 are the surrounding operational hygiene.
