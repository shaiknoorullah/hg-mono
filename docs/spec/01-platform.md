---
covers:
  - services/hg/internal/auth/**
  - services/hg/internal/session/**
  - services/hg/internal/orders/**
  - services/hg/internal/payments/**
  - services/hg/internal/realtime/**
  - services/hg/internal/notify/**
  - services/hg/internal/files/**
  - services/hg/internal/dispatch/**
  - services/hg/internal/httpx/**
reviewed: 2026-10-04
---

# HalalGoes — Cross-Cutting Platform Layer Specification

**Target**: Go modular monolith, one binary. Postgres 17 + PostGIS 3.6, Redis 7, [Silo](https://github.com/pgsty/silo) object storage (MinIO-compatible S3 API; [object storage decision](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)), Traefik v3, docker compose.
**Currency**: CAD only. **Market**: Canada; launch in Ontario only ([launch province](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).
**Status**: normative. Every domain module (restaurant, menu, cart, order, dispatch, payments, admin) depends on this layer and may not re-implement any part of it.

**Sources**: `sow.txt`; `scope/features-restaurant-admin-backend.md`; `fleet/crosscut-order-flow.md`.

---

## 0. Ground rules that bind every section

These are not capabilities; they are constraints on all of them. Violating one is a build break, not a bug.

**G-1 — Postgres is the only source of truth.** Redis is a disposable cache/transport. `FLUSHALL` against production Redis must cause *degradation* (slower, briefly noisier, lost live fan-out) and **never incorrectness**: no login is granted, no rate limit is bypassed into a money path, no order is lost, no notification is dropped permanently, no OTP attempt counter is reset in a way that grants extra attempts. Every Redis key in this document names its Postgres rebuild source. A test (`TestRedisFlushSafety`) flushes Redis mid-scenario in CI and asserts the end state is identical.

**G-2 — Money never touches a float.** No `float32`/`float64`/`REAL`/`DOUBLE PRECISION`/`NUMERIC` and no Postgres `money` type anywhere in a monetary value's path. Integer minor units only. A migration linter rejects any new column matching `%_cents` that is not `BIGINT`, and any column of type `money`/`double precision` in a table listed in `MONEY_TABLES`. A Go arch-lint rejects `float64` in any file under `internal/money`, `internal/pricing`, `internal/payments`, `internal/ledger`.

**G-3 — The client never sends a price.** Inbound DTOs may not contain any field whose name matches `(?i)(price|amount|total|fee|subtotal|tax|discount|payout|earning|commission|cents)` unless it is `tip_cents` (the one customer-chosen monetary input) or `custom_amount_cents` on an explicitly allowlisted admin route. Enforced by `arch-lint` over the request-struct package plus a runtime middleware that rejects unknown fields.

**G-4 — Deny by default.** A route with no registered policy fails at boot, not at runtime (P-06).

**G-5 — No state waits forever.** Every non-terminal order/dispatch/payout/document row carries `deadline_at NOT NULL` with a declared timeout action. Enforced by a Postgres `CHECK` constraint (P-15).

**G-6 — One envelope.** Every JSON response is `{"data": …, "meta": …}` or `{"error": {"code","message","details","request_id"}}`. No bare arrays, ever (the old `GET /addresses` returned a bare array). HTTP status always agrees with the body: a body containing `error` never ships with 2xx, and `{"success": false}` is not a representable response shape.

**G-7 — Fail loud on config.** The binary refuses to boot if any required env var is missing, if any configured host resolves to `localhost`/`127.0.0.1` while `HG_ENV != local`, or if a startup self-probe fails (P-27 bucket privacy probe, P-30 PostGIS probe, Stripe key/livemode probe). `GET /internal/deps` returns each dependency's *resolved and connected* address.

**G-8 — ULIDs for public identifiers, UUIDv7 for rows.** Primary keys are `uuid` generated as UUIDv7 (time-ordered, index-friendly). Externally visible correlation ids (`request_id`, event `id`, idempotency records) are ULID strings. No sequential integers are exposed.

**G-9 — Time.** All timestamps are `timestamptz` stored in UTC. All API timestamps are RFC3339 with milliseconds and `Z`. "Local time" (trading hours, quiet hours, tax periods) is computed from the subject's IANA timezone (`restaurant.timezone`, `address.timezone`), never the server's. User-facing copy shows 12-hour times ("7:42 pm") through one shared formatter ([time format](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

---

# 1. Identity & sessions

### P-01 — Account model (one table, many roles)

- **Behaviour**: One `account` row per human. Roles are grants, not table membership. A person who is a customer and also rides for the platform has **one** account, one phone, one session family, one audit subject. Role-specific data lives in a per-role profile table with `account_id` as PK. Restaurant staff are accounts holding a `RESTAURANT_*` role **scoped** to a `restaurant_id`; a restaurant is not an account. This directly replaces the old `Admin` model that could not represent a credential (B2/B102).

  Credentials are also grants: an account may hold a phone credential, a password credential, both, or (V2) an OIDC credential. Which credential types may be used to obtain a session for a given role is fixed by policy, not by the client:

  | Role | Permitted auth methods | MFA |
  |---|---|---|
  | `CUSTOMER` | phone OTP | — |
  | `RIDER` | phone OTP | — |
  | `RESTAURANT_OWNER`, `RESTAURANT_MANAGER`, `RESTAURANT_STAFF` | email + password | optional TOTP |
  | `SUPPORT_AGENT` | email + password | TOTP required |
  | `ADMIN`, `SUPER_ADMIN` | email + password | TOTP required |

  An account holding both `CUSTOMER` and `ADMIN` must authenticate with the admin method to receive an access token carrying the admin role; a phone-OTP session for that account carries `CUSTOMER` only. This is the `amr` claim's job (P-04).

- **Data**:

```sql
CREATE TYPE account_status AS ENUM ('ACTIVE','SUSPENDED','BANNED','DELETED');

CREATE TABLE account (
  id                uuid PRIMARY KEY,              -- uuidv7
  phone_e164        text UNIQUE,                   -- '+14165550123', E.164, digits only after '+'
  email             citext UNIQUE,
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  password_hash     text,                          -- argon2id encoded string; NULL if no password credential
  password_set_at   timestamptz,
  totp_secret_enc   bytea,                         -- AES-GCM under APP_DATA_KEY; NULL if no TOTP
  totp_enrolled_at  timestamptz,
  status            account_status NOT NULL DEFAULT 'ACTIVE',
  status_reason     text,
  locale            text NOT NULL DEFAULT 'en-CA', -- 'en-CA' | 'fr-CA'
  timezone          text NOT NULL DEFAULT 'America/Toronto',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT account_has_identifier CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT account_phone_e164_shape CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

CREATE TYPE role_name AS ENUM (
  'CUSTOMER','RIDER',
  'RESTAURANT_OWNER','RESTAURANT_MANAGER','RESTAURANT_STAFF',
  'SUPPORT_AGENT','ADMIN','SUPER_ADMIN'
);

CREATE TABLE account_role (
  id            uuid PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES account(id),
  role          role_name NOT NULL,
  scope_type    text NOT NULL,          -- 'GLOBAL' | 'RESTAURANT'
  scope_id      uuid,                   -- restaurant_id when scope_type='RESTAURANT', else NULL
  granted_by    uuid REFERENCES account(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES account(id),
  CONSTRAINT scope_shape CHECK (
    (scope_type='GLOBAL' AND scope_id IS NULL) OR (scope_type='RESTAURANT' AND scope_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX account_role_live ON account_role(account_id, role, COALESCE(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;

CREATE TABLE customer_profile (account_id uuid PRIMARY KEY REFERENCES account(id), first_name text NOT NULL, last_name text, avatar_object_id uuid, default_address_id uuid, marketing_consent_at timestamptz, marketing_consent_source text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE rider_profile   (account_id uuid PRIMARY KEY REFERENCES account(id), first_name text NOT NULL, last_name text NOT NULL, date_of_birth date NOT NULL, vehicle_type text NOT NULL, onboarding_state text NOT NULL, approved_at timestamptz, approved_by uuid, stripe_account_id text UNIQUE, is_online boolean NOT NULL DEFAULT false, rating_avg numeric(3,2), rating_count int NOT NULL DEFAULT 0);
CREATE TABLE admin_profile   (account_id uuid PRIMARY KEY REFERENCES account(id), display_name text NOT NULL, department text);
```

  Redis: none. Identity is never read from Redis.

- **Rules & invariants**:
  - **I-01.1** `account.phone_e164` and `account.email` are globally unique when non-null. No two accounts share a phone.
  - **I-01.2** An access token may only carry roles that (a) exist un-revoked in `account_role` at issue time and (b) are permitted for the session's `amr` per the table above.
  - **I-01.3** `status <> 'ACTIVE'` ⟹ no new session may be issued and all existing sessions are revoked within 10 s (P-04).
  - **I-01.4** Deleting an account is a status change plus PII tombstoning; `account.id` is never reused and never hard-deleted while any `order`, `ledger_entry`, or `audit_event` references it.
  - **I-01.5** A restaurant always has at least one un-revoked `RESTAURANT_OWNER` grant. Revoking the last owner is rejected.
- **Acceptance criteria**:
  1. Given a phone `+14165550123` already on account A, When a signup flow verifies OTP for that phone, Then the existing account A is used; no second account is created.
  2. Given account A holds `CUSTOMER` and `ADMIN`, When A signs in by phone OTP, Then the issued access token's `roles` contains `CUSTOMER` only and a call to any `ADMIN` route returns 403.
  3. Given a `RESTAURANT_MANAGER` grant scoped to restaurant R1, When the holder requests restaurant R2's orders, Then the response is 404 and an `authz.denied` audit event is written.
  4. Given a restaurant with exactly one owner, When an admin revokes that owner grant, Then the request fails 409 `last_owner_required` and the grant is unchanged.
  5. Given `account.status='SUSPENDED'`, When any existing access token for that account is presented, Then within 10 s of the status change every request returns 401 `session_revoked`.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — one account across roles**: Should a single person be able to hold customer, rider and restaurant-staff roles on one account, or must riders/restaurants have separate logins? · **Proposed default**: one account, many roles, as specified above; a rider ordering food uses the same account. · **Why**: one identity is the only way session revocation, audit and fraud signals stay coherent, and it makes the "rider who also orders" case free.

> **Decided:** owner only at launch; manager and staff roles wait for a later version ([staff accounts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), [restaurant staff](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

> **Decided:** TOTP mandatory for staff; no recovery codes; a super admin resets a lost authenticator after a call-back identity check ([manual reset](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

---

### P-02 — Phone OTP authentication (customers, riders)

- **Behaviour**: Two endpoints, one challenge object, all state in Postgres.

  `POST /v1/auth/otp/request` `{phone_e164, purpose, device_id?}` where `purpose ∈ {SIGN_IN, PHONE_CHANGE, STEP_UP}`.
  Server: normalises to E.164 (reject anything that is not a valid Canadian or international E.164 — **no hardcoded country prefix anywhere**; the old apps hardcoded `+91` behind a `+1` flag, R1/#5); applies rate limits (below); finds or creates a **pending** `otp_challenge`; generates a 6-digit code with `crypto/rand` uniformly over `[0, 999999]` rendered zero-padded; stores `HMAC-SHA256(code, OTP_PEPPER)`; enqueues an SMS via the notification router (P-24) with template `otp_sign_in`. Response is **always** `200 {"data":{"challenge_id","resend_after_s":60,"expires_at"}}` whether or not the number is known — no account enumeration.

  `POST /v1/auth/otp/verify` `{challenge_id, code, device_id?}`.
  Server: single-statement consume —
  ```sql
  UPDATE otp_challenge
     SET attempts = attempts + 1,
         consumed_at = CASE WHEN code_hash = $2 THEN now() ELSE NULL END
   WHERE id = $1 AND consumed_at IS NULL AND expires_at > now() AND attempts < max_attempts
  RETURNING (consumed_at IS NOT NULL) AS ok, attempts, max_attempts;
  ```
  Zero rows ⟹ 400 `otp_invalid_or_expired`. `ok=false` ⟹ 400 `otp_incorrect` with `attempts_remaining`. `ok=true` ⟹ find-or-create account by phone, set `phone_verified_at`, grant `CUSTOMER` (or `RIDER` when the request arrives on the rider audience — see below), issue session (P-04). Response carries `is_new_account` so the client can route to profile capture.

  **Audience**: the request carries `X-HG-Client` (`customer-app`, `rider-app`, `restaurant-web`, `admin-web`, `web`) validated against a registered client list; a signed-in-by-OTP session on `rider-app` grants `RIDER`, on `customer-app` grants `CUSTOMER`. An account may end up with both. The client header is *not* trusted for authorization — it only selects which role grant is created on first sign-up, and role creation for `RIDER` puts the rider in `onboarding_state='REGISTERED'`, not `APPROVED`.

  **Resend**: `POST /v1/auth/otp/request` with the same `{phone, purpose}` inside an open challenge's lifetime re-sends the **same** code (does not rotate it) and increments `sends`. Cooldown 60 s, max 3 sends per challenge, challenge lifetime 15 min, code validity 5 min from the most recent send.

  **Provider**: sign-in codes go through Twilio Verify ([SMS carriers exception](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)). When it is configured, Twilio generates, sends and checks the code and no code hash is stored locally; without it (development), the challenge table below is used. Sender registration is still open ([SMS registration](../decisions/README.md#open--blocking)).

- **Data**:

```sql
CREATE TABLE otp_challenge (
  id           uuid PRIMARY KEY,
  phone_e164   text NOT NULL,
  purpose      text NOT NULL,
  code_hash    bytea NOT NULL,
  attempts     int  NOT NULL DEFAULT 0,
  max_attempts int  NOT NULL DEFAULT 5,
  sends        int  NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,          -- last_sent_at + 5 min
  window_ends_at timestamptz NOT NULL,        -- created_at + 15 min
  consumed_at  timestamptz,
  request_ip   inet,
  device_id    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenge_open ON otp_challenge(phone_e164, purpose) WHERE consumed_at IS NULL;
```

  Redis (rate-limit counters only, all **disposable**):

  | Key | Type | TTL | Limit |
  |---|---|---|---|
  | `rl:otp:phone:{e164}:h` | counter | 3600 s | 5 requests / hour |
  | `rl:otp:phone:{e164}:d` | counter | 86400 s | 10 requests / day |
  | `rl:otp:ip:{ip}:h` | counter | 3600 s | 20 requests / hour |
  | `rl:otp:device:{device_id}:h` | counter | 3600 s | 10 requests / hour |
  | `rl:otp:verify:{challenge_id}` | counter | 900 s | soft mirror of `attempts` |
  | `sms:spend:{yyyymmdd}` | counter | 172800 s | global daily SMS circuit breaker |

  **Disposability**: flushing Redis resets the *request* counters (an attacker regains at most one hour of send budget — bounded by SMS spend alarms) but **cannot** reset `otp_challenge.attempts`, `consumed_at` or `expires_at`, so no code becomes re-guessable or re-usable. If Redis is unreachable, OTP request/verify **fail closed** (503 `rate_limiter_unavailable`) — these are the two endpoints where fail-open is unacceptable.

- **Rules & invariants**:
  - **I-02.1** A challenge is consumable exactly once: `consumed_at` is set by a conditional `UPDATE`, never by read-then-write.
  - **I-02.2** Codes are never logged, never returned in any response, never included in an audit `before/after` payload.
  - **I-02.3** Verify latency is constant-time with respect to code correctness (`hmac.Equal`).
  - **I-02.4** `attempts >= max_attempts` ⟹ the challenge is dead; the client must request a new one. There is no unlock.
  - **I-02.5** No country prefix is hardcoded. `phone_e164` is validated by an E.164 library, and the client sends the full `+1…` string.
  - **I-02.6** In `HG_ENV=production` the fixed-test-number bypass is compiled out; a boot assertion fails if `OTP_TEST_NUMBERS` is non-empty in production.
- **Acceptance criteria**:
  1. Given a challenge with `attempts=4, max_attempts=5`, When a wrong code is submitted, Then 400 `otp_incorrect` with `attempts_remaining: 0`, and When any code (including the correct one) is submitted again, Then 400 `otp_invalid_or_expired`.
  2. Given an open challenge, When Redis is flushed and the correct code is submitted, Then sign-in succeeds exactly once and a second submission of the same code fails.
  3. Given 5 OTP requests for `+14165550123` in one hour, When a 6th is requested, Then 429 `rate_limited` with `Retry-After`, and no SMS is sent.
  4. Given phone `+14165550123` is not registered, When an OTP is requested, Then the response body is byte-identical in shape and the latency distribution is indistinguishable from the registered case.
  5. Given a request with `phone_e164: "9876543210"` (no `+`), When submitted, Then 422 `invalid_phone` — the server never prepends a country code.
  6. Given a resend 30 s after the previous send, When submitted, Then 429 with `resend_after_s` reflecting the remaining cooldown, and `sends` is unchanged.

- **Version**: V1 · **Size**: M

---

### P-03 — Email + password authentication (restaurants, admins, support)

- **Behaviour**:
  - `POST /v1/auth/register/restaurant` `{email, password, business_name, terms_version}` → creates `account` (unverified) + `restaurant` in `onboarding_state='REGISTERED'` + `RESTAURANT_OWNER` grant. Sends verification email with a single-use token. **No session is issued until the email is verified.**
  - `POST /v1/auth/email/verify` `{token}` → sets `email_verified_at`, advances onboarding to `PROFILE_PENDING`, issues a session.
  - `POST /v1/auth/email/resend` — rate limited 1/min, 5/day per account.
  - `POST /v1/auth/login` `{email, password, totp_code?}` → verifies argon2id, checks `status`, checks role auth policy, checks TOTP when enrolled/required, issues session. Uniform failure `401 invalid_credentials` for wrong-email, wrong-password and unverified-email cases (unverified additionally returns `error.details.email_verification_required: true` only **after** correct credentials).
  - `POST /v1/auth/password/forgot` `{email}` → always 200; sends reset token if the account exists.
  - `POST /v1/auth/password/reset` `{token, new_password}` → sets hash, **revokes every session in the account's family**, audit `session.revoked_all`, sends a security email.
  - `POST /v1/auth/password/change` `{current_password, new_password}` (authenticated) → same revocation, except the calling session which is re-issued.
  - `POST /v1/auth/totp/enroll` / `verify` / `disable` (step-up required).

  Password hashing: **argon2id**, `t=3, m=64 MiB, p=2, saltLen=16, keyLen=32`, encoded in the standard `$argon2id$v=19$m=65536,t=3,p=2$…` string so parameters can be upgraded per-user on next successful login. Policy: minimum 12 characters, maximum 256 bytes, no composition rules, rejected against a bundled top-10k breached-password list.

  Tokens for email verification and password reset: 32 random bytes, base64url; stored as SHA-256; single-use; verification TTL 24 h, reset TTL 30 min.

- **Data**:

```sql
CREATE TABLE credential_token (
  id           uuid PRIMARY KEY,
  account_id   uuid NOT NULL REFERENCES account(id),
  kind         text NOT NULL,             -- 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'EMAIL_CHANGE'
  token_hash   bytea NOT NULL UNIQUE,
  new_email    citext,                    -- for EMAIL_CHANGE
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_ip   inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE login_attempt (
  id          bigserial PRIMARY KEY,
  email       citext,
  account_id  uuid,
  ip          inet NOT NULL,
  outcome     text NOT NULL,             -- 'SUCCESS' | 'BAD_PASSWORD' | 'NO_ACCOUNT' | 'LOCKED' | 'BAD_TOTP'
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_recent ON login_attempt(email, at DESC);
```

  Redis: `rl:login:email:{email}` (10/15 min), `rl:login:ip:{ip}` (30/15 min). Lockout truth lives in `login_attempt` (Postgres): 10 consecutive `BAD_PASSWORD` within 15 min ⟹ 15-minute lock computed by query, so a Redis flush does not unlock an account.

- **Rules & invariants**:
  - **I-03.1** Plaintext passwords never appear in logs, audit payloads, error messages or panics. A `String()` method on the password type returns `"[REDACTED]"`.
  - **I-03.2** Password change/reset revokes all refresh tokens of the account.
  - **I-03.3** Tokens are single-use; a second use is an audited security event.
  - **I-03.4** No session is issued for an account whose `email_verified_at IS NULL` and whose role set requires email auth.
- **Acceptance criteria**:
  1. Given a registered but unverified restaurant, When login is attempted with correct credentials, Then 403 `email_not_verified` and no token pair is returned.
  2. Given a password reset completes, When a refresh token issued before the reset is presented, Then 401 `session_revoked`.
  3. Given a verification token is used once, When it is replayed, Then 400 `token_consumed` and an `auth.token_reuse` audit event is written.
  4. Given 10 failed logins in 15 minutes for one email, When an 11th is attempted with the *correct* password, Then 429 `account_temporarily_locked` — and When Redis is flushed and the attempt repeats, Then it is still 429.
- **Version**: V1 · **Size**: M

---

### P-04 — Sessions: token format, lifetime, refresh, revocation

- **Behaviour**: Split tokens. A short-lived **access JWT** proves identity to the API; a long-lived **opaque refresh token** buys new access JWTs and is the only revocable artefact.

  **Access token** — JWT, `EdDSA` (Ed25519), compact, ~400 bytes:
  ```json
  {
    "iss": "https://api.halalgoes.com",
    "aud": "hg-api",
    "sub": "<account uuid>",
    "sid": "<session uuid>",
    "jti": "<ulid>",
    "iat": 1786000000, "exp": 1786000900,
    "amr": ["otp"],                                  // "otp" | "pwd" | "pwd+totp"
    "roles": [{"r":"RESTAURANT_OWNER","s":"<restaurant uuid>"}, {"r":"CUSTOMER"}],
    "ver": 1
  }
  ```
  TTL **15 minutes** for every role. Keys are Ed25519 pairs in `signing_key` (Postgres, private key sealed with `APP_DATA_KEY`); two keys are active at a time; rotation every 90 days; verification tries all non-expired public keys by `kid`.

  **Refresh token** — 32 random bytes, base64url, sent as `hgrt_<base64url>`. Only its SHA-256 is stored. Rotating on every use with **reuse detection**: the presented token is marked `rotated_at`, a new one is issued in the same family. Presenting an already-rotated token revokes the **entire family**, writes `session.reuse_detected`, and emails/pushes the account.

  Refresh TTL (idle + absolute):

  | Role class | Idle TTL | Absolute TTL |
  |---|---|---|
  | Customer, Rider | 30 days | 180 days |
  | Restaurant | 14 days | 90 days |
  | Support, Admin, Super Admin ([staff session length](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) | 30 minutes | 12 hours |

  **Transport**:
  - Web surfaces (`restaurant-web`, `admin-web`): refresh token in `Set-Cookie: hg_rt=…; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth; Max-Age=…`. Access token returned in the JSON body and held **in memory only**. `localStorage` is forbidden — this is the R17/A4 fix, enforced by a frontend lint rule banning `localStorage.setItem` with a key matching `token`.
  - Native apps: both tokens in the JSON body; the app stores them in `expo-secure-store`/Keychain.
  - CSRF for cookie-bearing routes: `Origin` must match the allowlist **and** a double-submit `X-HG-CSRF` header must equal the `hg_csrf` non-HttpOnly cookie.

  **Endpoints**: `POST /v1/auth/refresh`, `POST /v1/auth/logout` (this session), `POST /v1/auth/logout-all` (family), `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{id}`, `GET /v1/auth/me`.

  **Revocation propagation**: the API keeps an in-process deny set of revoked `sid`s (and `account_id`s revoked wholesale), refreshed from Postgres **every 10 seconds** and additionally invalidated immediately via Redis pub/sub channel `sys:session_revoked`. Redis makes revocation instant; Postgres makes it *correct*. Worst case with Redis down or flushed: **≤10 s** propagation. Access tokens are otherwise trusted for their ≤15-minute life.

- **Data**:

```sql
CREATE TABLE session (
  id                 uuid PRIMARY KEY,
  family_id          uuid NOT NULL,
  account_id         uuid NOT NULL REFERENCES account(id),
  amr                text NOT NULL,
  roles_snapshot     jsonb NOT NULL,
  client             text NOT NULL,           -- 'customer-app' | 'rider-app' | 'restaurant-web' | 'admin-web'
  device_id          text,
  user_agent         text,
  ip                 inet,
  refresh_hash       bytea NOT NULL UNIQUE,
  issued_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  idle_expires_at    timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  rotated_at         timestamptz,
  rotated_to         uuid REFERENCES session(id),
  revoked_at         timestamptz,
  revoke_reason      text
);
CREATE INDEX session_family ON session(family_id);
CREATE INDEX session_account_live ON session(account_id) WHERE revoked_at IS NULL;

CREATE TABLE signing_key (
  kid text PRIMARY KEY, alg text NOT NULL DEFAULT 'EdDSA',
  public_key bytea NOT NULL, private_key_enc bytea NOT NULL,
  not_before timestamptz NOT NULL, not_after timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
```

  Redis: `sys:session_revoked` (pub/sub, no persistence). Rebuild source: `SELECT id FROM session WHERE revoked_at > now() - interval '30 minutes'`.

- **Rules & invariants**:
  - **I-04.1** A refresh token is valid at most once. `UPDATE session SET rotated_at=now() … WHERE refresh_hash=$1 AND rotated_at IS NULL AND revoked_at IS NULL RETURNING id` — zero rows means either reuse or revocation.
  - **I-04.2** Reuse of a rotated token revokes every session sharing `family_id`.
  - **I-04.3** Roles are re-read from `account_role` on every refresh; a revoked grant disappears from tokens within one access-token lifetime (≤15 min) at worst.
  - **I-04.4** No refresh token is ever written to a log, an audit payload, or a `Location` header.
  - **I-04.5** Clock skew tolerance for `exp`/`iat` is ±60 s and no more.
- **Acceptance criteria**:
  1. Given refresh token R1 is exchanged for R2, When R1 is presented again, Then 401 `refresh_reuse_detected`, every session in the family shows `revoked_at`, and a security notification is sent.
  2. Given an admin session, When 30 minutes pass with no use, Then refresh returns 401 `session_expired`.
  3. Given `DELETE /v1/auth/sessions/{id}` succeeds, When an access token minted from that session is used 11 s later, Then 401 `session_revoked` — and this holds with Redis stopped.
  4. Given a restaurant-web login, When the response is inspected, Then the refresh token appears only in a `Set-Cookie` with `HttpOnly; Secure; SameSite=Lax` and never in the JSON body.
  5. Given a request with a valid access token but `Origin: https://evil.example`, When it targets a cookie-authenticated route, Then 403 `csrf_origin_rejected`.
- **Version**: V1 · **Size**: L

> **Decided:** support and admin staff, 30 minutes idle and 12 hours in total ([staff session length](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

> **Open:** are the customer, rider and restaurant lifetimes in the table acceptable to operations?

---

# 2. Authorization

### P-05 — Role, scope and permission model

- **Behaviour**: Authorization is `Can(principal, action, subject) → allow | deny`. `action` is a `noun.verb` string from a **closed, compile-time enumerated** set (`order.read`, `order.accept`, `menu_item.update`, `payout.read`, `kyc_document.download`, …). Permissions are a static Go map `role → set[action]`, versioned in-repo and covered by a golden test; they are **not** database-configurable in V1 (no runtime permission editing means no runtime permission bug). Scope narrows the subject set: a `RESTAURANT_MANAGER` scoped to R1 holding `order.accept` may only accept orders whose `restaurant_id = R1`, which is the *ownership* check (P-07), not the role check.

  `SUPER_ADMIN` holds all actions. `ADMIN` holds all except `admin.grant_role`, `platform_config.write`, `payout_config.write`. `SUPPORT_AGENT` holds read actions plus `refund.request` (which requires admin approval above a threshold) and `order.annotate`.

- **Data**: no table in V1. `account_role` (P-01) is the only persisted authorization data. The permission matrix ships as `internal/authz/matrix.go` and is dumped into the OpenAPI description and into `docs/permissions.md` by `go generate`.

- **Rules & invariants**:
  - **I-05.1** Every `action` constant appears in the matrix for at least one role, and every route's declared action exists in the enum. A test enumerates routes and fails on any unknown action.
  - **I-05.2** No handler calls `Can` with a string literal; actions are typed constants.
  - **I-05.3** Elevation of a role grant is itself an action (`account_role.grant`) held only by `SUPER_ADMIN`, and is always audited with `before`/`after`.
- **Acceptance criteria**:
  1. Given the permission matrix, When `go test ./internal/authz` runs, Then the golden snapshot of `role → actions` matches, so any permission change is visible in a diff.
  2. Given a route declares action `refund.issue`, When a `SUPPORT_AGENT` calls it, Then 403 `permission_denied` with `required: "refund.issue"`.
- **Version**: V1 · **Size**: S

---

### P-06 — Deny-by-default routing and the middleware chain

- **Behaviour**: Routes are registered through a wrapper that **requires** a policy value; there is no way to add a handler without one.

```go
type Policy struct {
    Action     authz.Action  // required unless Public
    Public     bool          // must be set explicitly; mutually exclusive with Action
    Class      RateClass     // AUTH | READ | WRITE | MONEY | UPLOAD | REALTIME | WEBHOOK
    Idempotent bool          // requires Idempotency-Key when true
    MaxBody    int64
}
func (r *Router) Handle(method, path string, p Policy, h Handler)
```

  At boot, `router.Verify()` walks every registered route and **panics** if `p.Action == "" && !p.Public`, if `p.Class` is zero, or if a `MONEY`-class route has `Idempotent == false`. A CI test asserts `Verify()` passes and additionally that the set of `Public` routes exactly equals a checked-in allowlist (`testdata/public_routes.txt`) — adding a public route requires editing that file, which is an L3-lane review.

  **The chain, in this exact order.** Each numbered stage runs for every request; stages 10–14 are where the old system had nothing at all.

  | # | Middleware | Responsibility | Failure |
  |---|---|---|---|
  | 1 | `RequestID` | read/generate `X-Request-ID` (ULID), put in ctx + response header | — |
  | 2 | `Recover` | catch panics, log with stack, alert | 500 `internal_error` |
  | 3 | `RealIP` | trust `X-Forwarded-For` **only** from Traefik's IP: when the peer is in `HG_TRUSTED_PROXY_CIDRS` (required outside `HG_ENV=local`, where an empty list would give every caller Traefik's address; any range not wholly inside `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `::1/128` or `fc00::/7`, `/0` included, refused at boot), the client is the right-most address in the header that is not a trusted proxy; otherwise the peer, and the header is ignored. Every reader of the client address uses this one result. A per-IP rate limit counts an IPv4 caller by address and an IPv6 caller by its /64 (a subscriber can send from any address in its /64), and a request with no resolved address in one shared bucket, never unlimited; logs and audit rows keep the exact address | — |
  | 4 | `AccessLog` | structured log, PII-redacted, sampled for 2xx reads | — |
  | 5 | `Timeout` | ctx deadline by `Class` (READ 5 s, WRITE 15 s, MONEY 20 s, UPLOAD 60 s) | 503 `timeout` |
  | 6 | `BodyLimit` | `Policy.MaxBody` (default 1 MiB, AUTH 16 KiB) | 413 `payload_too_large` |
  | 7 | `SecurityHeaders` | HSTS 2y preload, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, CSP on HTML routes | — |
  | 8 | `CORS` | exact-origin allowlist per env, `credentials: true`, no wildcard, preflight cached 600 s | 403 `origin_not_allowed` |
  | 9 | `RateLimit` | token bucket by `Class` + key (P-38) | 429 `rate_limited` |
  | 10 | `Authenticate` | parse bearer/cookie → `Principal{AccountID, SessionID, Roles, AMR, Anonymous}`. **Never rejects**; anonymous is a valid principal. Checks the revoked-`sid` deny set. | 401 only on a *malformed or revoked* token |
  | 11 | `RequireRoute` | deny-by-default gate: `Policy.Public` ⟹ pass; else require non-anonymous **and** `authz.RoleHasAction(principal.Roles, Policy.Action)` | 401 `authentication_required` / 403 `permission_denied` |
  | 12 | `Idempotency` | for `Policy.Idempotent`, claim/replay the key (P-37) | 400 `idempotency_key_required` / 409 `idempotency_conflict` / replay 200 |
  | 13 | `Validate` | decode into the typed request struct with `DisallowUnknownFields`, run validators, run the money-field guard (G-3) | 422 `validation_failed` with per-field details |
  | 14 | `Authorize` (ownership) | resolve the subject with a principal-scoped query and evaluate `Can` (P-07) | 404 `not_found` (invisible) / 403 `forbidden` (visible, not permitted) |
  | 15 | Handler | business logic; opens the tx; writes outbox + audit inside it | — |
  | 16 | `AuditFinalize` | flush the audit event recorded by the handler; for denials at 11/14 emit `authz.denied` | — |

  **404-vs-403 rule**: if the principal has no relationship to the subject at all, the answer is `404 not_found` — an unrelated customer must not learn that order `X` exists. `403` is reserved for "you can see this resource but not perform this action" (e.g. a `RESTAURANT_STAFF` trying `payout.read` on their own restaurant).

- **Data**: none persisted. `testdata/public_routes.txt` in the repo is the contract.
- **Rules & invariants**:
  - **I-06.1** `router.Verify()` passes at boot in every environment or the process exits non-zero.
  - **I-06.2** The set of public routes equals the checked-in allowlist exactly (no additions, no removals) — CI test.
  - **I-06.3** No handler reads the raw `*http.Request` for identity. `Principal` comes from ctx only; a lint bans `r.Header.Get("Authorization")` outside `internal/http/middleware/auth`.
  - **I-06.4** Every `MONEY`-class route is `Idempotent`.
  - **I-06.5** CORS never emits `Access-Control-Allow-Origin: *` on any route that can carry credentials; a test asserts the header for a disallowed origin is absent.
- **Acceptance criteria**:
  1. Given a new route registered without a `Policy.Action` and without `Public: true`, When the binary starts, Then it panics with the route's method+path and CI fails.
  2. Given `GET /v1/orders/{id}` and an anonymous caller, Then 401 `authentication_required`; the handler is never entered (assert via a handler-entry counter).
  3. Given customer C2 and an order belonging to C1, When C2 requests it, Then 404 with no order fields in the body and an `authz.denied` audit row with `subject_id` set.
  4. Given `PUT /v1/restaurants/{id}/menu-items/{itemId}` and a body containing `{"price_cents": 1}`, When submitted, Then 422 `unknown_field: price_cents` (the field is not on the inbound DTO at all).
  5. Given a preflight from `https://evil.example`, Then no `Access-Control-Allow-Origin` header is returned.
- **Version**: V1 · **Size**: L

---

### P-07 — Ownership checks (the IDOR fix)

- **Behaviour**: The rule is mechanical: **a repository method that loads an owned entity must take the principal and push the ownership predicate into SQL.** There is no `GetOrder(ctx, id)`; there is `GetOrderFor(ctx, p Principal, id uuid)`. This makes the "load then forget to compare" bug — the entire IDOR class the old system had (B6) — unwriteable.

  A single view expresses order visibility:

```sql
CREATE VIEW order_visibility AS
SELECT o.id AS order_id, o.customer_id AS account_id, 'CUSTOMER' AS via FROM "order" o
UNION ALL
SELECT o.id, ar.account_id, 'RESTAURANT'
  FROM "order" o
  JOIN account_role ar ON ar.scope_type='RESTAURANT' AND ar.scope_id = o.restaurant_id AND ar.revoked_at IS NULL
UNION ALL
SELECT o.id, d.rider_account_id, 'RIDER'
  FROM "order" o JOIN dispatch d ON d.order_id = o.id
 WHERE d.rider_account_id IS NOT NULL AND d.state <> 'WITHDRAWN';
```

  and every order read is `… JOIN order_visibility v ON v.order_id = o.id AND v.account_id = $principal` unless the principal holds a global `order.read_any` action (admin/support), in which case the join is skipped **and** the access is written to the audit log as `order.read_any` (privileged reads are always audited).

  **Field-level scoping** is part of ownership, not a separate concern: the same order is projected differently per `via`. The restaurant sees the customer's first name, the masked phone (`+1 416 ••• 0123`) only once it accepts, enforced by the server ([masked phone](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)), and the delivery address only once it starts preparing; the rider sees an approximate area on the offer and the full delivery address once it accepts ([address on a rider's offer](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01); contract change: [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)), and a platform-proxied phone number, never the raw one; the customer sees the rider's public profile (first name, photo, vehicle, rating) and never the rider's earnings or full record (the old `GET /riders/:id` leaked earnings to customers). Projections are separate Go structs (`OrderCustomerView`, `OrderRestaurantView`, `OrderRiderView`, `OrderAdminView`), never a single struct with conditional field blanking.

  Owned-entity families and their predicates:

  | Entity | Owner predicate |
  |---|---|
  | `cart`, `address`, `payment_method`, `notification` | `account_id = $p` |
  | `order` | `order_visibility` as above |
  | `restaurant`, `menu`, `menu_item`, `restaurant_payout` | `EXISTS (account_role WHERE scope_id = restaurant_id AND account_id=$p AND revoked_at IS NULL)` |
  | `rider_profile`, `rider_payout`, `dispatch_offer` | `account_id = $p` |
  | `kyc_document` | subject is the uploading account, or a global `kyc_document.download` holder (always audited) |
  | `stored_object` | via the owning `kyc_document` / `menu_item` / `order` |

- **Data**: the `order_visibility` view; no new tables. (V2: Postgres RLS as a redundant second layer with `SET LOCAL hg.account_id`.)
- **Rules & invariants**:
  - **I-07.1** `arch-lint` fails the build if any exported repository function whose name matches `Get|List|Update|Delete` on an owned entity lacks a `Principal` (or explicit `SystemPrincipal`) parameter.
  - **I-07.2** Every privileged cross-tenant read (`*.read_any`) writes an audit event before returning.
  - **I-07.3** Customer PII is never present in a `OrderRiderView` before the rider accepts the offer nor in an `OrderRestaurantView` before acceptance.
  - **I-07.4** A rider removed from a dispatch loses order visibility immediately (`d.state <> 'WITHDRAWN'`).
- **Acceptance criteria**:
  1. Given the full route table, When the IDOR sweep test runs (for every route with a path `{id}` parameter, call it as an unrelated principal of each role), Then every call returns 404 or 403 — zero 2xx. This test is generated from the route registry, so a new route is covered automatically.
  2. Given rider R holds an unaccepted offer for order O, When R views it, Then only the approximate drop-off area is present; When R accepts, Then `delivery_address.line1` is present and `customer_phone` is a proxy number.
  3. Given a support agent reads order O, Then an `order.read_any` audit row exists with `actor_id`, `subject_id`, `request_id`.
  4. Given a rider is unassigned from O, When the rider re-fetches O, Then 404.
- **Version**: V1 · **Size**: L

---

# 3. Money model

> This is the section every other section defers to. The old platform had four competing definitions of a line-item price, charged the client-supplied number, inverted its coupon maths, and stored currency as JS floats against `@db.Money` columns. Everything below exists to make each of those unrepresentable.

### P-08 — Currency representation

- **Behaviour**: The only monetary type is `money.Amount`:

```go
package money

type Currency string
const CAD Currency = "CAD"

// Amount is a signed integer count of minor units (Canadian cents).
type Amount int64

func (a Amount) Add(b Amount) Amount
func (a Amount) Sub(b Amount) Amount
func (a Amount) MulRate(r Rate) Amount     // half-up to the cent, see P-11
func (a Amount) Neg() Amount
func (a Amount) String() string            // "CA$12.34" — display only
func (a Amount) MarshalJSON() ([]byte, error) // emits an integer, never a string, never a float
```

  There is no `Amount` constructor from `float64`. Parsing from user-entered dollars (admin console only) goes through `ParseDollars(string) (Amount, error)` which is decimal-string based.

  Rates (tax, commission, service fee) are `money.Rate` = an exact rational `{Num int64, Den int64}` — e.g. HST Ontario is `{13, 100}`, QST is `{9975, 100000}`. Never a float, never a `NUMERIC` read into a float.

  **JSON contract**: every monetary field in every API payload is an integer of cents with a `_cents` suffix, accompanied by a sibling `currency: "CAD"` at the object level. Clients format for display; the server never sends `"12.34"`.

- **Data**: every monetary column is `BIGINT NOT NULL` named `*_cents`. Rate columns are `NUMERIC(12,8) NOT NULL` and are read into `money.Rate` via exact decimal parsing, never `float64`. A `currency char(3) NOT NULL DEFAULT 'CAD' CHECK (currency='CAD')` column sits on `order`, `quote`, `payment`, `refund`, `ledger_entry`, `payout` so the V2 multi-currency migration is additive.

  Migration linter rules (CI, blocking):
  - any column `~ '_cents$'` must be `bigint`;
  - `money`, `double precision`, `real` are banned outright in migrations;
  - a `numeric` column is allowed only if its name matches `_rate$|_ratio$|_pct$|_km$|rating`.

- **Rules & invariants**:
  - **I-08.1** No `float64` appears in `internal/{money,pricing,payments,ledger,payouts}` — arch-lint.
  - **I-08.2** `Amount` arithmetic panics on int64 overflow (checked add/sub) rather than wrapping.
  - **I-08.3** No rounding to anything other than one cent, anywhere. The old `roundPrice`-to-nearest-5¢ behaviour is deleted; Canadian nickel rounding applies **only to cash tender** and this platform is card-only.
  - **I-08.4** All monetary JSON fields end in `_cents` — a contract test walks the generated OpenAPI schema and fails on any numeric field with a money-ish name lacking the suffix.
- **Acceptance criteria**:
  1. Given a migration adding `column total numeric(10,2)` to `order`, When CI runs, Then the migration linter fails naming the column.
  2. Given an order total of `$12.005` arising from any intermediate computation, When it is stored, Then the stored value is an exact integer of cents and the rounding step that produced it is recorded in `quote.rounding_log`.
  3. Given any API response containing money, When the schema test runs, Then every such field is `type: integer` and no field is `type: number`.
- **Version**: V1 · **Size**: S

---

### P-09 — Canonical price computation (the Quote)

- **Behaviour**: There is exactly **one** function that turns a cart into money: `pricing.Quote(ctx, QuoteInput) (Quote, error)`. Every surface — cart screen, checkout screen, payment, order creation, receipt, refund, settlement — reads the same persisted `quote` row. The client sends **item identifiers and quantities only**.

  `POST /v1/quotes` (idempotent, `MONEY` class):
  ```json
  { "cart_id":"…", "delivery_address_id":"…", "fulfilment":"DELIVERY",
    "tip_cents": 300, "promo_code":"WELCOME10", "scheduled_for": null }
  ```
  Response: the full `Quote` (below). The quote is persisted, has an `expires_at` (**10 minutes**), and its `id` is the only thing checkout accepts:
  `POST /v1/orders` `{ "quote_id":"…", "payment_method_id":"…", "delivery_instructions":[…], "idempotency_key" via header }`.
  The server **re-executes** `Quote()` at order time and compares to the stored quote. Identical ⟹ proceed. Different (price changed, item went unavailable, address changed) ⟹ `409 quote_stale` with the new quote embedded; the client must show the difference and get explicit re-confirmation. Expired ⟹ `409 quote_expired`.

  **The computation, in order. Each step is a pure function of DB state; none of it reads the request body for money.**

  **Step 1 — line unit price.** For each cart line, with the menu item, chosen variant and chosen add-ons re-read from Postgres inside the quote transaction (`FOR SHARE` on the menu item so a concurrent price edit cannot interleave):

  ```
  base            = menu_item.price_cents
  variant_part    = CASE variant.pricing_mode
                      WHEN 'ABSOLUTE' THEN variant.price_cents        -- replaces base
                      WHEN 'DELTA'    THEN base + variant.delta_cents -- adjusts base
                      WHEN none chosen THEN base
                    END
  addons_part     = Σ over chosen addons of (addon.price_cents × addon_quantity)
  line_unit_cents = variant_part + addons_part
  line_total_cents = line_unit_cents × quantity
  ```

  This is the single definition. The cart, the order line and the receipt all display `line_unit_cents` from the quote; none of them recompute. `variant.pricing_mode` is a column on the variant, so a restaurant can express "Large = $14.99" and "Extra cheese = +$1.50" without ambiguity. The old system's cart-adds-variant-to-base vs order-replaces-base contradiction (B39) is resolved by making the mode explicit data.

  **Step 2 — subtotal.** `subtotal_cents = Σ line_total_cents`.

  **Step 3 — discount.** The promo engine returns at most one `discount` per quote:
  ```
  discount_cents      = min(computed, cap_cents, applicable_base)
  discount_target     ∈ {ITEMS, DELIVERY_FEE, SERVICE_FEE}
  discount_funded_by  ∈ {PLATFORM, RESTAURANT}
  discount_reimbursable boolean            -- CRA coupon classification, see P-11
  ```
  A percentage promo of 10% on a $50 subtotal yields `discount_cents = 500`, and the customer pays `4500`. (The old code returned the discount and the caller treated it as the payable amount, charging $5 — B35. The types make this impossible here: `Quote.DiscountCents` and `Quote.TotalCents` are distinct named fields and the conservation test I-09.4 fails instantly if they are swapped.)

  **Step 4 — delivery fee.**
  ```
  billable_km      = ceil(route_m / 1000) computed by P-31 from restaurant.location to the ORDER's delivery address
  delivery_fee_cents = base_delivery_fee_cents
                     + max(0, billable_km − included_km) × per_km_cents
                     + small_order_surcharge_cents           -- if subtotal < small_order_threshold_cents
  ```
  clamped to `[min_delivery_fee_cents, max_delivery_fee_cents]`. All parameters come from `pricing_config` (versioned, effective-dated), **never** from constants in code and never from the request. Note the address used is the order's, not the customer's primary — the old code measured to the primary address (B38).

  **Step 5 — service fee (customer-facing platform fee).**
  ```
  service_fee_cents = clamp(round_half_up(subtotal_cents × service_fee_rate), service_fee_min_cents, service_fee_max_cents)
  ```

  **Step 6 — tax.** P-11. Produces one or more `tax_line`s, each `{jurisdiction, tax_kind, rate, base_cents, amount_cents}`.

  **Step 7 — tip.** `tip_cents` is the only monetary value the client supplies; it is validated `0 ≤ tip ≤ max(2000, subtotal)` and is **not** taxed (P-11).

  **Step 8 — total.**
  ```
  total_cents = subtotal_cents − discount_items_cents
              + delivery_fee_cents − discount_delivery_cents
              + service_fee_cents  − discount_service_cents
              + tax_total_cents
              + tip_cents
  ```

  **Step 9 — internal split** (computed at quote time, frozen onto the order at acceptance, used by P-13):
  ```
  commission_cents      = round_half_up((subtotal_cents − restaurant_funded_discount_cents) × restaurant.commission_rate)
  restaurant_net_cents  = subtotal_cents − restaurant_funded_discount_cents − commission_cents
  rider_earnings_cents  = delivery_fee_cents + tip_cents          -- pure pass-through, no rate card
  platform_gross_cents  = commission_cents + service_fee_cents
  ```
  Launch values: commission rate 0% ([commission](../decisions/README.md#settled--client-decisions)); service fee $0.00, shown as "Service fee $0.00" ([service fee](../decisions/README.md#settled--reconciliations)); every discount restaurant-funded ([discount funding](../decisions/README.md#settled--reconciliations)); the rider receives the whole delivery fee and every tip ([rider pay](../decisions/README.md#settled--reconciliations)). Wait-time pay is deferred to a later version ([wait-time pay](../decisions/README.md#settled--reconciliations)).

- **Data**:

```sql
CREATE TABLE pricing_config (
  id uuid PRIMARY KEY, version int NOT NULL,
  effective_from timestamptz NOT NULL, effective_to timestamptz,
  base_delivery_fee_cents bigint NOT NULL, included_km int NOT NULL, per_km_cents bigint NOT NULL,
  min_delivery_fee_cents bigint NOT NULL, max_delivery_fee_cents bigint NOT NULL,
  small_order_threshold_cents bigint NOT NULL, small_order_surcharge_cents bigint NOT NULL,
  service_fee_rate numeric(12,8) NOT NULL, service_fee_min_cents bigint NOT NULL, service_fee_max_cents bigint NOT NULL,
  default_commission_rate numeric(12,8) NOT NULL,
  quote_ttl_seconds int NOT NULL DEFAULT 600,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(id),
  cart_id uuid NOT NULL,
  restaurant_id uuid NOT NULL,
  delivery_address_id uuid,
  fulfilment text NOT NULL,                    -- 'DELIVERY' | 'PICKUP'
  currency char(3) NOT NULL DEFAULT 'CAD',
  pricing_config_id uuid NOT NULL REFERENCES pricing_config(id),
  tax_profile_id uuid NOT NULL,
  subtotal_cents        bigint NOT NULL,
  discount_items_cents  bigint NOT NULL DEFAULT 0,
  discount_delivery_cents bigint NOT NULL DEFAULT 0,
  discount_service_cents  bigint NOT NULL DEFAULT 0,
  delivery_fee_cents    bigint NOT NULL DEFAULT 0,
  service_fee_cents     bigint NOT NULL DEFAULT 0,
  tax_total_cents       bigint NOT NULL DEFAULT 0,
  tip_cents             bigint NOT NULL DEFAULT 0,
  total_cents           bigint NOT NULL,
  commission_cents      bigint NOT NULL,
  restaurant_net_cents  bigint NOT NULL,
  rider_earnings_cents  bigint NOT NULL,
  platform_gross_cents  bigint NOT NULL,
  billable_km           int    NOT NULL DEFAULT 0,
  route_meters          int    NOT NULL DEFAULT 0,
  promo_code            text,
  promo_id              uuid,
  input_hash            bytea NOT NULL,        -- sha256 of the canonical QuoteInput
  state_hash            bytea NOT NULL,        -- sha256 of every price/rate/config row read
  rounding_log          jsonb NOT NULL,        -- ordered list of {step, base, rate, raw, rounded}
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_total_identity CHECK (
    total_cents = subtotal_cents - discount_items_cents
                + delivery_fee_cents - discount_delivery_cents
                + service_fee_cents  - discount_service_cents
                + tax_total_cents + tip_cents
  ),
  CONSTRAINT quote_non_negative CHECK (
    subtotal_cents >= 0 AND delivery_fee_cents >= 0 AND service_fee_cents >= 0
    AND tax_total_cents >= 0 AND tip_cents >= 0 AND total_cents >= 0
  )
);

CREATE TABLE quote_line (
  quote_id uuid NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  line_no int NOT NULL,
  menu_item_id uuid NOT NULL,
  menu_item_name text NOT NULL,               -- snapshotted
  variant_id uuid, variant_name text, variant_pricing_mode text,
  quantity int NOT NULL CHECK (quantity > 0),
  base_price_cents bigint NOT NULL,
  variant_part_cents bigint NOT NULL,
  addons_part_cents bigint NOT NULL,
  line_unit_cents bigint NOT NULL,
  line_total_cents bigint NOT NULL,
  tax_category text NOT NULL,                 -- 'PREPARED_FOOD' | 'ZERO_RATED_GROCERY' | 'BEVERAGE_ALCOHOL'
  PRIMARY KEY (quote_id, line_no),
  CONSTRAINT line_identity CHECK (
    line_unit_cents = variant_part_cents + addons_part_cents
    AND line_total_cents = line_unit_cents * quantity
  )
);

CREATE TABLE quote_line_addon (
  quote_id uuid NOT NULL, line_no int NOT NULL,
  addon_id uuid NOT NULL, addon_name text NOT NULL,
  addon_quantity int NOT NULL CHECK (addon_quantity > 0),
  addon_price_cents bigint NOT NULL,
  PRIMARY KEY (quote_id, line_no, addon_id),
  FOREIGN KEY (quote_id, line_no) REFERENCES quote_line(quote_id, line_no) ON DELETE CASCADE
);
```

  Note `quote_line` is keyed by `(quote_id, line_no)`, **not** `(quote_id, menu_item_id)`. Two lines of the same dish with different variants or add-on sets are therefore representable — the constraint collision that aborted orders in the old system (B25/B34) cannot occur. `order_line` copies this shape exactly, including add-ons, so add-on money can never be dropped between cart and order (B26).

  Redis: `quote:{id}` may cache the serialized quote for 600 s as a read optimisation. **Disposable** — a miss re-reads Postgres. Nothing is ever *only* in Redis.

- **Rules & invariants**:
  - **I-09.1** The only writer of `total_cents` is `pricing.Quote`. Arch-lint: no assignment to a `*_cents` field of `Quote`/`Order` outside `internal/pricing` and `internal/ledger`.
  - **I-09.2** `order.total_cents` always equals `quote.total_cents` of the referenced quote. FK + trigger.
  - **I-09.3** `Quote()` is deterministic: same `input_hash` + same `state_hash` ⟹ byte-identical output. Property test with 10k random carts.
  - **I-09.4 (conservation)** `total = subtotal − discounts + delivery + service + tax + tip` — enforced as a Postgres `CHECK`, not merely a test.
  - **I-09.5** An order can only be created from a non-expired quote whose recomputation matches; there is no code path that accepts a total from the request.
  - **I-09.6** Every rounding operation appends to `rounding_log`; the log's replay reproduces the stored totals exactly (test).
  - **I-09.7** A quote referencing an unavailable item, a closed restaurant, or an address outside the restaurant's delivery radius fails at quote time with a typed error listing the offending lines — it never silently zeroes.
- **Acceptance criteria**:
  1. Given a checkout request containing `total_cents`, `pricing`, or any monetary field, When posted, Then 422 `unknown_field` and no order, quote or PaymentIntent is created.
  2. Given a quote for $50.00 with promo `SAVE10` (10%), Then `discount_items_cents = 500` and `total_cents` reflects $45.00 + fees + tax; a snapshot test pins the exact integer.
  3. Given a cart with two lines of "Chicken Biryani" — one Large with extra raita, one Regular — When quoted, Then two distinct `quote_line` rows exist with different `line_unit_cents`, and When ordered, Then two distinct `order_line` rows exist. (Old system: constraint violation, order aborted.)
  4. Given a restaurant raises an item's price between quote and order, When `POST /v1/orders` is called with the stale quote, Then 409 `quote_stale` with the new quote in `error.details.quote`, and no PaymentIntent is created.
  5. Given a quote created 11 minutes ago, When used, Then 409 `quote_expired`.
  6. Given add-ons totalling $3.00 on a line, When the order is created, Then `order_line_addon` rows sum to 300 and `order.subtotal_cents` includes them.
  7. Given `GET /v1/quotes/{id}` from the cart screen and the checkout screen, Then both render from the identical persisted numbers — a UI test asserts the two screens display equal fee values (the old apps hardcoded $5/$2 and $3 in different screens).
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — variant pricing semantics**: Does a chosen variant replace the base price or adjust it? · **Proposed default**: both, made explicit per variant via `pricing_mode ∈ {ABSOLUTE, DELTA}`, defaulting to `ABSOLUTE` on import of existing data. · **Why**: the old data contains both intents and guessing one silently mis-charges every order of the other kind.

> **Decided:** delivery fee $2.99 + $1.00/km; service fee $0.00; commission 0% ([delivery fee](../decisions/README.md#settled--client-decisions), [service fee](../decisions/README.md#settled--reconciliations)).

> **Open:** included km, minimum and maximum delivery fee, and any small-order surcharge?

> **DECISION REQUIRED — quote TTL**: How long is a quoted price honoured? · **Proposed default**: 10 minutes, with mandatory re-confirmation on any change. · **Why**: long enough to complete 3-D Secure, short enough that a menu price change is not honoured for an hour.

---

### P-10 — Fee breakdown presented to the customer

- **Behaviour**: The receipt and the checkout screen render **exactly** these lines, in this order, from the quote, with no client-side arithmetic:

  | Display line | Field | Notes |
  |---|---|---|
  | Items subtotal | `subtotal_cents` | sum of line totals |
  | Promotion (`promo_code`) | `−(discount_items+discount_delivery+discount_service)` | omitted when zero |
  | Delivery fee | `delivery_fee_cents` | omitted for `PICKUP` |
  | Service fee | `service_fee_cents` | labelled "Service fee", never "platform fee" to the customer |
  | GST / HST / QST / PST lines | one row per `tax_line` | labelled with the statutory name for the province |
  | Rider tip | `tip_cents` | shown as its own line, never folded into a fee |
  | **Total** | `total_cents` | the amount authorized |

  Canadian consumer-protection posture: the checkout screen must show the **all-in total including taxes and all mandatory fees** before the pay action; no fee may be introduced after the pay action. `GET /v1/orders/{id}/receipt` returns the same structure plus the platform's GST/HST registration number and, when the restaurant is the supplier, the restaurant's.

- **Data**: `quote_tax_line` (see P-11), plus a `receipt` materialisation stored as an immutable JSONB snapshot on the order at `COMPLETED` (`order.receipt_snapshot`), so a later config change can never alter a historical receipt.
- **Rules & invariants**:
  - **I-10.1** The sum of displayed lines equals `total_cents` exactly (no "rounding adjustment" line exists).
  - **I-10.2** The tip is never included in any fee, commission or tax base.
  - **I-10.3** `receipt_snapshot` is written once and never updated; a trigger rejects `UPDATE` when the old value is non-null.
- **Acceptance criteria**:
  1. Given any completed order, When the receipt is fetched twice a year apart with `pricing_config` changed in between, Then the two payloads are byte-identical.
  2. Given a customer in Ontario, When the receipt renders, Then a single `HST 13%` line appears (or `HST 5% (POS rebate)` per P-11), never "GST + PST".
  3. Given the checkout screen, When compared against the created order, Then every displayed cents value equals the corresponding order field (automated screen-to-API assertion).
- **Version**: V1 · **Size**: M

---

### P-11 — Canadian sales tax (GST / HST / QST / PST)

- **Behaviour**: Tax is computed from a **tax profile** resolved at quote time, keyed by the *place of supply*. For delivered food the place of supply is the **delivery address's province**; for pickup it is the restaurant's province. Rates are data in `tax_rate`, effective-dated, never constants in code.

  **Rate table shipped at launch** (effective 2026-08-10; `tax_rate` rows, each with `effective_from`):

  | Province | Kind | Rate on prepared food |
  |---|---|---|
  | ON | HST | 13% — **but 5% via the point-of-sale rebate of the 8% provincial part on qualifying prepared food & beverages sold for ≤ $4.00** |
  | NB, NL, PE | HST | 15% |
  | NS | HST | 14% (reduced from 15% on 2025-04-01) |
  | QC | GST + QST | 5% + 9.975% |
  | BC | GST (+PST) | 5%; BC PST does **not** apply to restaurant food (does apply to alcohol) |
  | MB | GST + RST | 5% + 7% (restaurant meals are RST-taxable in MB) |
  | SK | GST + PST | 5% + 6% (restaurant meals are PST-taxable in SK) |
  | AB, NT, NU, YT | GST | 5% |

  **What is taxed:**
  - **Prepared food and beverages** (`tax_category='PREPARED_FOOD'`): taxable at the full applicable rate. This is the overwhelming majority of the catalogue.
  - **Basic groceries** (`ZERO_RATED_GROCERY`): zero-rated (0%). Present in the model because some restaurants sell packaged goods; each menu item carries a `tax_category` that defaults to `PREPARED_FOOD` and can only be changed by an admin.
  - **Alcohol** (`BEVERAGE_ALCOHOL`): full rate plus provincial liquor treatment; **out of scope for V1** — items in this category are rejected at menu publish until V2.
  - **Delivery fee**: taxable at the same rate as the food it delivers (it is part of the supply of a taxable good).
  - **Service fee**: taxable at the applicable rate.
  - **Tip**: a voluntary gratuity is **not** consideration for a supply and is **not taxed**. `tip_cents` never enters a tax base. (If a mandatory service charge is ever introduced it is a different field and *is* taxable.)
  - **Commission charged by the platform to the restaurant**: a taxable supply of services by the platform to the restaurant; GST/HST on commission is computed and posted to the ledger separately (P-13), invoiced monthly, and is **not** part of the customer's total.

  **Discounts and the tax base** follow the CRA coupon rules:
  - *Non-reimbursable* discount (the vendor simply charges less — typically a **restaurant-funded** promo): tax is computed on the **reduced** amount. `discount_reimbursable = false`.
  - *Reimbursable* discount (a third party reimburses the vendor — a **platform-funded** promo where the platform makes the restaurant whole): tax is computed on the **pre-discount** amount and the coupon is treated as tax-included consideration. `discount_reimbursable = true`.
  This distinction is why `discount_funded_by` and `discount_reimbursable` are separate columns.

  **Ontario POS rebate mechanics**: if `province = 'ON'`, the sum of `PREPARED_FOOD` line totals (after non-reimbursable discount) is ≤ `$4.00`, and the order qualifies, then the food base is taxed at 5% and the 8% provincial part is rebated at point of sale. Implemented as two `tax_line` rows in the ledger sense (`HST_FEDERAL_PART 5%` on the qualifying base, and the non-qualifying base at 13%), so the remittance report can reconstruct the rebate claim.

  **Computation order** (integer, half-up, per base):
  ```
  for each (jurisdiction, tax_kind, rate) in profile:
      base = Σ of taxable component amounts assigned to that rate
      amount = (base × rate.Num + rate.Den/2) / rate.Den        // integer half-up
      emit tax_line{jurisdiction, kind, rate, base, amount}
  tax_total_cents = Σ tax_line.amount_cents
  ```
  Tax is computed **once per rate over the summed base**, not per line and summed — this avoids per-line rounding drift. Per-line tax attribution for reporting is derived afterwards by largest-remainder allocation of `tax_line.amount_cents` across the lines in that base, so the allocated parts sum exactly to the line total (P-12).

  **Who is the supplier** is modelled explicitly. `restaurant.tax_role ∈ {RESTAURANT_IS_SUPPLIER, PLATFORM_IS_DEEMED_SUPPLIER}`, plus `restaurant.gst_hst_number`, `restaurant.qst_number`. When the restaurant is the supplier, the food tax is *restaurant-payable* and appears on the restaurant's ledger; when the platform is the deemed supplier (a distribution-platform-operator position for non-registered small-supplier restaurants), the food tax is *platform tax-payable*. In both cases the delivery-fee and service-fee tax is platform tax-payable. The ledger (P-13) is what makes this switchable without touching the pricing code.

- **Data**:

```sql
CREATE TABLE tax_jurisdiction (
  code text PRIMARY KEY,               -- 'CA-ON', 'CA-QC', …
  country char(2) NOT NULL, province char(2) NOT NULL, display_name text NOT NULL
);

CREATE TABLE tax_rate (
  id uuid PRIMARY KEY,
  jurisdiction_code text NOT NULL REFERENCES tax_jurisdiction(code),
  tax_kind text NOT NULL,              -- 'GST' | 'HST' | 'QST' | 'PST' | 'RST' | 'HST_FEDERAL_PART'
  tax_category text NOT NULL,          -- 'PREPARED_FOOD' | 'DELIVERY' | 'SERVICE_FEE' | 'COMMISSION' | 'ZERO_RATED_GROCERY'
  rate numeric(12,8) NOT NULL,
  effective_from date NOT NULL, effective_to date,
  statutory_label text NOT NULL,       -- 'HST', 'GST', 'QST' — what the receipt prints
  notes text
);
CREATE UNIQUE INDEX tax_rate_unique ON tax_rate(jurisdiction_code, tax_kind, tax_category, effective_from);

CREATE TABLE quote_tax_line (
  quote_id uuid NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  seq int NOT NULL,
  jurisdiction_code text NOT NULL,
  tax_kind text NOT NULL,
  statutory_label text NOT NULL,
  rate numeric(12,8) NOT NULL,
  base_cents bigint NOT NULL,
  amount_cents bigint NOT NULL,
  rebate_applied boolean NOT NULL DEFAULT false,
  remittable_by text NOT NULL,          -- 'PLATFORM' | 'RESTAURANT'
  PRIMARY KEY (quote_id, seq)
);
```
  Plus on `restaurant`: `tax_role`, `gst_hst_number`, `qst_number`, `province`.
  Redis: none. Tax is never cached.

- **Rules & invariants**:
  - **I-11.1** `quote.tax_total_cents = Σ quote_tax_line.amount_cents` — Postgres `CHECK` via a trigger-maintained column.
  - **I-11.2** `tip_cents` appears in no `quote_tax_line.base_cents`. Test: setting a tip changes `total_cents` by exactly the tip and leaves `tax_total_cents` unchanged.
  - **I-11.3** No tax rate is a literal in Go. Arch-lint bans numeric literals matching `0\.(05|13|14|15|09975|07|06)` in `internal/pricing`.
  - **I-11.4** A quote whose delivery province has no effective `tax_rate` row fails loudly (`tax_profile_missing`); it never defaults to zero tax.
  - **I-11.5** Every `quote_tax_line` names its `remittable_by`, and the ledger posts the tax to that party's payable account.
  - **I-11.6** Rate changes are effective-dated; recomputing a historical quote with today's code and the historical `effective_from` reproduces the historical tax exactly (regression corpus of one order per province per rate epoch).
- **Acceptance criteria**:
  1. Given an Ontario delivery with subtotal $30.00, delivery $4.19, service $2.40, tip $5.00, Then one `HST 13%` line with `base_cents = 3659` and `amount_cents = 476`, `tax_total_cents = 476`, and the tip is absent from the base.
  2. Given a Quebec delivery, Then two tax lines appear — `GST 5%` and `QST 9.975%` — both computed on the same base, and the receipt prints both statutory labels.
  3. Given an Ontario order whose qualifying prepared-food subtotal is $3.75, Then the food base is taxed at 5% with `rebate_applied = true`, while delivery and service fees are taxed at 13%.
  4. Given an Alberta delivery, Then exactly one `GST 5%` line appears.
  5. Given a Nova Scotia delivery dated after 2025-04-01, Then the rate is 14%; given one dated before, Then 15%.
  6. Given a platform-funded promo (`discount_reimbursable = true`) of $10 on a $40 subtotal, Then the food tax base is $40; given a restaurant-funded promo (`false`), Then the base is $30.
  7. Given a province with no configured rate, When quoted, Then 422 `tax_profile_missing` and no order is created.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — GST/HST supplier position**: Is HalalGoes the deemed supplier for orders from non-registrant (small-supplier) restaurants, or does each restaurant remain the supplier? · **Proposed default**: platform is the deemed supplier for restaurants without a GST/HST number and collects/remits their food tax; registrant restaurants remain the supplier and receive their tax in their payout. Both paths are modelled by `restaurant.tax_role`. · **Why**: this determines who remits food tax and is the single highest-consequence tax question; it must be signed off by Canadian tax counsel before launch, and the data model supports either answer without a code change. Still open and blocking: [HST registration](../decisions/README.md#open--blocking).

> **Decided:** no Quebec at launch; Ontario only, other provinces rejected with `province_not_served` ([launch province](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

> **DECISION REQUIRED — tip taxation**: Confirm tips are treated as voluntary untaxed gratuities and that 100% flows to the rider. · **Proposed default**: yes to both; no commission and no tax on tips. · **Why**: it is the correct CRA treatment for a voluntary gratuity and the only defensible position with riders.

> **DECISION REQUIRED — commission tax invoicing**: How is GST/HST on the platform's commission to the restaurant handled? · **Proposed default**: computed per order, accrued to `tax_payable`, and invoiced to the restaurant monthly as a self-billed invoice deducted from payouts, with the commission tax shown on the restaurant's monthly statement. · **Why**: commission is a taxable supply by the platform and must be documented for the restaurant's input tax credits.

---

### P-12 — Rounding and allocation

- **Behaviour**: Two operations need rules.

  **Rounding a rate application**: `round_half_up`, integer-only:
  ```go
  func (a Amount) MulRate(r Rate) Amount { return Amount((int64(a)*r.Num + r.Den/2) / r.Den) } // r.Num, r.Den > 0, a >= 0
  ```
  For negative amounts (refunds, credits) the implementation rounds half **away from zero** so that `(-x).MulRate(r) == -(x.MulRate(r))` — symmetry matters because a full refund must reverse the original amount exactly.

  **Allocating a rounded total across parts** (per-line tax attribution, partial-refund apportionment, splitting a discount across lines): **largest remainder**. Compute each part's exact rational share, floor it, then distribute the remaining cents one at a time to the parts with the largest fractional remainders, ties broken by ascending `line_no` (deterministic). The allocation is guaranteed to sum to the target exactly.

  ```go
  func Allocate(total Amount, weights []Amount) []Amount  // Σ result == total, always
  ```

- **Data**: `quote.rounding_log jsonb` — an ordered array of `{"step":"service_fee","base":3000,"rate":"8/100","raw":"240.00","rounded":240}`. Written for every rounding and every allocation; ~1 KB per quote.
- **Rules & invariants**:
  - **I-12.1** `Σ Allocate(t, w) == t` for all inputs — property test with 1M random cases.
  - **I-12.2** `Allocate` is deterministic for the same inputs and order.
  - **I-12.3** No rounding to any granularity other than 1 cent occurs anywhere.
  - **I-12.4** `MulRate` symmetry: `(-a).MulRate(r) == -(a.MulRate(r))`.
  - **I-12.5** Replaying `rounding_log` reproduces `quote.total_cents`.
- **Acceptance criteria**:
  1. Given $10.005 of computed tax, When rounded, Then 1001 cents (half-up), and `rounding_log` records `raw: "1000.5"`.
  2. Given a $10.00 discount to allocate across three lines of $3.33, $3.33, $3.34, Then the parts are 333/333/334 and sum to 1000 exactly.
  3. Given a full refund of an order, When each component is reversed, Then the sum of reversals equals the captured amount exactly with zero residual cent.
- **Version**: V1 · **Size**: S

---

### P-13 — The ledger and the zero-residual invariant

- **Behaviour**: Every cent that moves is a **double-entry** posting. This is the mechanism that makes "the charge decomposes exactly with zero residual" a database fact rather than an aspiration.

  Accounts (chart of accounts, fixed enum):

  | Account | Sign convention | Meaning |
  |---|---|---|
  | `CUSTOMER_CHARGES` | credit (−) | what the customer was charged |
  | `PSP_CLEARING` | debit (+) | money held at Stripe before settlement |
  | `PSP_FEES` | debit (+) | Stripe processing fees |
  | `RESTAURANT_PAYABLE` | debit (+) | owed to a restaurant |
  | `RIDER_PAYABLE` | debit (+) | owed to a rider |
  | `PLATFORM_REVENUE` | debit (+) | commission + service fee + delivery margin |
  | `TAX_PAYABLE` | debit (+) | GST/HST/QST/PST to remit, split by `remittable_by` |
  | `PROMO_EXPENSE` | debit (+) | platform-funded discounts |
  | `REFUNDS` | debit (+) | money returned to customers |
  | `PLATFORM_ABSORBED` | debit (+) | goodwill / no-rider write-offs |

  Postings happen at four moments: **capture** (customer charge recognised), **delivery/settlement** (split to restaurant, rider, platform, tax), **refund** (reversal), **payout** (payable → transferred). Each is a *balanced batch*: a set of `ledger_entry` rows written in one transaction whose `amount_cents` sum to zero.

  Worked example, at launch values (commission 0%, service fee $0.00, rider paid the delivery fee plus the tip) — Ontario, subtotal $30.00, restaurant-funded promo $3.00, delivery $5.99 ($2.99 + 3 km × $1.00), service $0.00, HST 13% on ($27.00 + $5.99) = $32.99 → $4.29, tip $5.00, total **$42.28**. Rider $5.99 + tip $5.00 = $10.99. Restaurant is a registrant (`RESTAURANT_IS_SUPPLIER`), so food HST ($27.00 × 13% = $3.51) is restaurant-remittable; delivery HST ($5.99 × 13% = $0.78) is platform-remittable.

  | Entry | Account | Amount (cents) |
  |---|---|---|
  | capture | `CUSTOMER_CHARGES` | −4228 |
  | capture | `PSP_CLEARING` | +4228 |
  | settle | `PSP_CLEARING` | −4228 |
  | settle | `RESTAURANT_PAYABLE` | +2700 ($27.00, no commission) |
  | settle | `TAX_PAYABLE` (restaurant) | +351 |
  | settle | `RIDER_PAYABLE` | +1099 |
  | settle | `TAX_PAYABLE` (platform) | +78 |
  | **Σ** | | **0** |

  The customer's $42.28 decomposes to restaurant $27.00 + restaurant tax $3.51 + rider $10.99 (incl. $5.00 tip) + platform tax $0.78 = $42.28. Zero residual; with commission and service fee at zero the platform posts no revenue row. (Stripe fees are posted separately against `PLATFORM_REVENUE` when the balance-transaction webhook arrives, keeping the customer-facing decomposition clean.)

- **Data**:

```sql
CREATE TYPE ledger_account AS ENUM (
  'CUSTOMER_CHARGES','PSP_CLEARING','PSP_FEES','RESTAURANT_PAYABLE','RIDER_PAYABLE',
  'PLATFORM_REVENUE','TAX_PAYABLE','PROMO_EXPENSE','REFUNDS','PLATFORM_ABSORBED'
);

CREATE TABLE ledger_batch (
  id uuid PRIMARY KEY,
  kind text NOT NULL,                  -- 'CAPTURE'|'SETTLE'|'REFUND'|'PAYOUT'|'ADJUSTMENT'|'PSP_FEE'
  order_id uuid,
  payout_id uuid,
  idempotency_key text NOT NULL UNIQUE,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by text NOT NULL              -- 'system:capture', 'admin:<uuid>', …
);

CREATE TABLE ledger_entry (
  id bigserial PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES ledger_batch(id),
  order_id uuid,
  account ledger_account NOT NULL,
  counterparty_type text,              -- 'RESTAURANT'|'RIDER'|'CUSTOMER'|'PLATFORM'|'CRA'
  counterparty_id uuid,
  amount_cents bigint NOT NULL,        -- signed; sum per batch = 0
  currency char(3) NOT NULL DEFAULT 'CAD',
  component text NOT NULL,             -- 'SUBTOTAL'|'COMMISSION'|'DELIVERY_FEE'|'SERVICE_FEE'|'TAX'|'TIP'|'DISCOUNT'|'PSP_FEE'|'REFUND'
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entry_order ON ledger_entry(order_id);
CREATE INDEX ledger_entry_cp ON ledger_entry(counterparty_type, counterparty_id, account);
```

  A deferred constraint trigger on `ledger_batch` verifies `SUM(amount_cents)=0` for the batch at COMMIT; a batch that does not balance cannot be committed.

  `ledger_entry` is append-only: `REVOKE UPDATE, DELETE` from the app role, plus a `BEFORE UPDATE OR DELETE` trigger that raises. Corrections are new `ADJUSTMENT` batches.

  Redis: none. The ledger never touches Redis.

- **Rules & invariants**:
  - **I-13.1 (batch balance)** `SELECT batch_id FROM ledger_entry GROUP BY batch_id HAVING SUM(amount_cents) <> 0` → **zero rows**, enforced by the deferred trigger.
  - **I-13.2 (order zero residual)** For any order in a terminal money state: `SELECT order_id FROM ledger_entry GROUP BY order_id HAVING SUM(amount_cents) <> 0` → **zero rows**. This is *the* decomposition invariant.
  - **I-13.3 (charge identity)** For every order, `−SUM(amount_cents) FILTER (WHERE account='CUSTOMER_CHARGES') = net_captured_cents = SUM(captured) − SUM(refunded)`.
  - **I-13.4 (payable identity)** A party's balance is `SUM(amount_cents)` over their `*_PAYABLE` account; a payout batch drives it toward zero and may never make it negative without an explicit `ADJUSTMENT` batch authorised by an admin.
  - **I-13.5 (tip pass-through)** `SUM(amount_cents WHERE component='TIP' AND account='RIDER_PAYABLE') = order.tip_cents` for every delivered order.
  - **I-13.6 (immutability)** Zero `UPDATE`/`DELETE` on `ledger_entry` ever succeeds.
  - **I-13.7 (global balance)** `SELECT SUM(amount_cents) FROM ledger_entry` = 0 at all times.
- **Acceptance criteria**:
  1. Given the worked example order, When settled, Then `SUM(amount_cents) WHERE order_id = X` is exactly 0 and the five settlement rows match the table above cent-for-cent.
  2. Given an attempt to write an unbalanced batch, When the transaction commits, Then it fails with `ledger_batch_unbalanced` and nothing is persisted.
  3. Given a partial refund of $10.00 on the worked example, When posted, Then a new balanced batch exists, `SUM` over the order is still 0, and the restaurant/rider/platform reversals sum to exactly 1000.
  4. Given any attempt to `UPDATE ledger_entry SET amount_cents = …`, Then the statement raises `ledger_is_append_only`.
  5. Given the nightly reconciliation job, When it compares `PSP_CLEARING` to the Stripe balance-transaction total for the day, Then the difference is 0 or an ops alert fires with the offending order ids.
  6. Given an order with a $5.00 tip, Then the rider's payable increases by exactly 500 more than the delivery fee, and `PLATFORM_REVENUE` has no `TIP` component row.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — Stripe fee absorption**: Who bears Stripe's processing fee (~2.9% + $0.30 on Canadian cards)? · **Proposed default**: the platform absorbs it entirely; it is posted to `PSP_FEES` against `PLATFORM_REVENUE` and never affects restaurant or rider payouts. · **Why**: partner payouts must be predictable and computable before the fee webhook arrives.

> **DECISION REQUIRED — commission base**: Is commission charged on the subtotal before or after a restaurant-funded discount? · **Proposed default**: after (on `subtotal − restaurant_funded_discount`), so a restaurant running its own promo is not charged commission on money it discounted. · **Why**: charging commission on a discount the restaurant funded is the most common source of partner disputes.

> **Decided:** pure pass-through: the whole delivery fee plus every tip; no rate card, no floor ([rider pay](../decisions/README.md#settled--reconciliations), [delivery fee recipient](../decisions/README.md#settled--client-decisions)).

---

# 4. Order state machine

> Design decision stated up front, because it is the fix for a whole family of old bugs: **the order has one fulfilment state track, and rider assignment is a separate, subordinate machine.** The old system put `PREPARING` and `RIDER_ASSIGNED` on one line, which is precisely why the restaurant's own transitions became unreachable (B58/R31) and why the tracking workflow that owned the transition table started at `RIDER_ASSIGNED` and could never validate the restaurant-side moves. Here, `dispatch` runs concurrently with `PREPARING` and may only push the order forward through three named transitions.

### P-14 — Order lifecycle states and transitions

- **Behaviour**: One enum, eleven states, five terminal.

```
CREATED ──────────► AUTHORIZED ──────► RESTAURANT_PENDING ──┬──► PREPARING ──► READY_FOR_PICKUP ──► PICKED_UP ──► ARRIVED ──► DELIVERED ──► COMPLETED
   │                    │                     │             │        │                 │               │            │            │             │
   │                    │                     └──► REJECTED │        │                 │               │            │            │             ├──► DISPUTED ──► RESOLVED
   ├──► FAILED          ├──► CANCELLED ◄──────────────────────────────┴─────────────────┴───────────────┘            │            │
   └──► CANCELLED       └──► FAILED                                                                                  └────────────┘
```

  **The authoritative table.** `actor` is who may trigger it; `system` means the deadline runner or a webhook, never a client.

  | # | From | To | Trigger | Actor | Money effect |
  |---|---|---|---|---|---|
  | T1 | `CREATED` | `AUTHORIZED` | `payment_intent.amount_capturable_updated` (status `requires_capture`) | system (Stripe webhook) | funds held |
  | T2 | `CREATED` | `FAILED` | PaymentIntent permanently failed | system | none |
  | T3 | `CREATED` | `CANCELLED` | customer abandons, or 15-min deadline | customer, system | PI cancelled |
  | T4 | `AUTHORIZED` | `RESTAURANT_PENDING` | offer emitted to restaurant | system | none |
  | T5 | `AUTHORIZED` | `CANCELLED` | restaurant closed / not accepting / item unavailable at offer time, or customer cancels | system, customer | auth voided |
  | T6 | `RESTAURANT_PENDING` | `PREPARING` | restaurant accepts **and** capture succeeds | restaurant staff (`order.accept`) | **capture** |
  | T7 | `RESTAURANT_PENDING` | `REJECTED` | restaurant declines with a reason | restaurant staff (`order.reject`) | auth voided |
  | T8 | `RESTAURANT_PENDING` | `CANCELLED` | 180-s acceptance deadline expires | system | auth voided |
  | T9 | `RESTAURANT_PENDING` | `CANCELLED` | customer cancels before acceptance | customer (`order.cancel`) | auth voided, no fee |
  | T10 | `PREPARING` | `READY_FOR_PICKUP` | restaurant marks ready | restaurant staff (`order.mark_ready`) | none |
  | T11 | `PREPARING` | `CANCELLED` | staff cancel, no support case needed, reason on the audit log ([cancellation policy](../decisions/README.md#settled--client-decisions)); or prep escalation cap reached | admin (whether support agents may too is open), system | refund per policy |
  | T12 | `READY_FOR_PICKUP` | `PICKED_UP` | dispatch → `CARRYING` (rider types the pickup code the kitchen reads out; [contract change](https://github.com/shaiknoorullah/hg-mono/issues/183)) | rider (`dispatch.confirm_pickup`) | none |
  | T13 | `READY_FOR_PICKUP` | `CANCELLED` | no-rider escalation cap reached | system | refund customer, pay restaurant |
  | T14 | `PICKED_UP` | `ARRIVED` | dispatch → `AT_CUSTOMER` (geofence or rider tap) | rider | none |
  | T15 | `PICKED_UP` | `DELIVERED` | rider completes without an arrival ping | rider (`dispatch.complete`) | none |
  | T16 | `ARRIVED` | `DELIVERED` | rider completes handover with the customer's delivery code, or a photo plus statement for leave-at-door | rider (`dispatch.complete`) | none |
  | T17 | `PICKED_UP`/`ARRIVED` | `DISPUTED` | support opens an incident mid-delivery | support/admin | none yet |
  | T18 | `DELIVERED` | `COMPLETED` | settlement batch posted successfully | system | **settle** (P-13) |
  | T19 | `DELIVERED`/`COMPLETED` | `DISPUTED` | customer or restaurant raises a dispute within the window | customer, restaurant staff, support | none yet |
  | T20 | `DISPUTED` | `RESOLVED` | support resolves (refund / partial / no action) | support/admin (`dispute.resolve`) | refund + adjustment batch |
  | T21 | `PREPARING`/`READY_FOR_PICKUP` | `DISPUTED` | restaurant reports an unrecoverable problem | restaurant staff | none yet |

  Terminal: `COMPLETED`, `CANCELLED`, `REJECTED`, `FAILED`, `RESOLVED`. `DISPUTED` is non-terminal.

  **The dispatch sub-machine** (table `dispatch`, one row per order, created at T6):

  ```
  PENDING → SEARCHING → OFFERED → ASSIGNED → AT_RESTAURANT → CARRYING → AT_CUSTOMER → COMPLETED
                 ▲          │         │            │             │
                 └──────────┘         └────────────┴─────────────┴──► UNASSIGNED → SEARCHING
                 └───────────────────────────────────────────────────► NO_RIDER_FOUND
  ```
  Dispatch may push the order forward **only** through T12 (`CARRYING` ⟹ `PICKED_UP`), T14 (`AT_CUSTOMER` ⟹ `ARRIVED`) and T15/T16 (`COMPLETED` ⟹ `DELIVERED`). It may never cancel an order; `NO_RIDER_FOUND` arms the order's `READY_FOR_PICKUP` escalation instead (T13).

  **Enforcement.** A single function owns every transition:
  ```go
  func (s *OrderService) Transition(ctx, tx, orderID uuid, to OrderState, by Actor, reason string, effects ...Effect) error
  ```
  It (a) `SELECT … FOR UPDATE` the order, (b) looks the pair up in a compile-time transition table that also declares the required `authz.Action` and the permitted actor kinds, (c) rejects illegal pairs with `409 illegal_transition{from,to,allowed}`, (d) writes the new state, the new `deadline_at` (P-15) and an `order_transition` row, (e) enqueues outbox events, all in **one** transaction. There is no other writer of `order.state` — arch-lint bans `UPDATE "order" SET state` outside this file, and the DB grants no direct `UPDATE(state)` to any other code path. The old `PUT /orders/:id/status` with `as any` and no auth (B57) has no successor endpoint; admins move orders only through named actions.

- **Data**:

```sql
CREATE TYPE order_state AS ENUM (
  'CREATED','AUTHORIZED','RESTAURANT_PENDING','PREPARING','READY_FOR_PICKUP',
  'PICKED_UP','ARRIVED','DELIVERED','COMPLETED','CANCELLED','REJECTED','FAILED','DISPUTED','RESOLVED'
);

CREATE TABLE "order" (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,                    -- human-readable, e.g. 'HG-8F3K2Q'
  quote_id uuid NOT NULL REFERENCES quote(id),
  account_id uuid NOT NULL REFERENCES account(id),      -- the customer
  restaurant_id uuid NOT NULL REFERENCES restaurant(id),
  delivery_address_id uuid REFERENCES address(id),
  state order_state NOT NULL,
  state_since timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  deadline_action text,
  deadline_escalations int NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'CAD',
  subtotal_cents bigint NOT NULL, discount_cents bigint NOT NULL,
  delivery_fee_cents bigint NOT NULL, service_fee_cents bigint NOT NULL,
  tax_total_cents bigint NOT NULL, tip_cents bigint NOT NULL, total_cents bigint NOT NULL,
  commission_cents bigint NOT NULL, restaurant_net_cents bigint NOT NULL,
  rider_earnings_cents bigint NOT NULL, platform_gross_cents bigint NOT NULL,
  prep_eta_minutes int,
  delivery_instructions text[] NOT NULL DEFAULT '{}',
  cancel_reason text, reject_reason text,
  receipt_snapshot jsonb,
  placed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz, ready_at timestamptz, picked_up_at timestamptz,
  delivered_at timestamptz, completed_at timestamptz,
  CONSTRAINT order_deadline_required CHECK (
    (state IN ('COMPLETED','CANCELLED','REJECTED','FAILED','RESOLVED') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state NOT IN ('COMPLETED','CANCELLED','REJECTED','FAILED','RESOLVED') AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  )
);
CREATE INDEX order_due ON "order"(deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX order_by_restaurant ON "order"(restaurant_id, state, placed_at DESC);
CREATE INDEX order_by_customer ON "order"(account_id, placed_at DESC);

CREATE TABLE order_transition (
  id bigserial PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES "order"(id),
  from_state order_state, to_state order_state NOT NULL,
  actor_kind text NOT NULL,            -- 'CUSTOMER'|'RESTAURANT'|'RIDER'|'SUPPORT'|'ADMIN'|'SYSTEM'
  actor_account_id uuid,
  reason text,
  request_id text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_transition_order ON order_transition(order_id, at);

CREATE TYPE dispatch_state AS ENUM (
  'PENDING','SEARCHING','OFFERED','ASSIGNED','AT_RESTAURANT','CARRYING','AT_CUSTOMER',
  'COMPLETED','UNASSIGNED','NO_RIDER_FOUND'
);

CREATE TABLE dispatch (
  order_id uuid PRIMARY KEY REFERENCES "order"(id),
  state dispatch_state NOT NULL DEFAULT 'PENDING',
  state_since timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz, deadline_action text, deadline_escalations int NOT NULL DEFAULT 0,
  rider_account_id uuid REFERENCES account(id),
  assigned_at timestamptz, wave int NOT NULL DEFAULT 0, radius_m int NOT NULL DEFAULT 0,
  pickup_eta_at timestamptz, dropoff_eta_at timestamptz,
  pod_object_id uuid,
  CONSTRAINT dispatch_deadline_required CHECK (
    (state IN ('COMPLETED','NO_RIDER_FOUND') AND deadline_at IS NULL)
    OR (state NOT IN ('COMPLETED','NO_RIDER_FOUND') AND deadline_at IS NOT NULL)
  ),
  CONSTRAINT dispatch_rider_when_assigned CHECK (
    state NOT IN ('ASSIGNED','AT_RESTAURANT','CARRYING','AT_CUSTOMER','COMPLETED') OR rider_account_id IS NOT NULL
  )
);

CREATE TABLE dispatch_offer (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES "order"(id),
  rider_account_id uuid NOT NULL REFERENCES account(id),
  wave int NOT NULL, distance_m int NOT NULL, earnings_cents bigint NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  outcome text,                        -- NULL | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'WITHDRAWN'
  outcome_at timestamptz, reject_reason text
);
CREATE UNIQUE INDEX dispatch_offer_unique ON dispatch_offer(order_id, rider_account_id);
```

  Redis: `order:{id}:live` may cache the tracking projection for 60 s (**disposable**; rebuilt from `order` + `dispatch` + `rider_position`). No order state is ever *only* in Redis. In particular, the old `order_checkout_mapping:{orderId}:{restaurantId}` Redis key that authorised restaurant accept/reject (B62 — anyone knowing two ids could accept an order) **does not exist**: acceptance is authorised by `account_role` scope in Postgres.

- **Rules & invariants**:
  - **I-14.1** `order.state` is only ever written by `OrderService.Transition`.
  - **I-14.2** Every state change appends exactly one `order_transition` row in the same transaction; the row count equals the number of state changes.
  - **I-14.3** No transition exists that reaches `PREPARING` without a successful capture; no transition reaches `COMPLETED` without a balanced settlement batch.
  - **I-14.4** `dispatch` can only be created for orders in `PREPARING` or later, and only one dispatch row per order.
  - **I-14.5** A rider may only act on a dispatch where `dispatch.rider_account_id = principal`.
  - **I-14.6** Terminal states never transition again (`order_state_is_terminal(from)` ⟹ reject).
  - **I-14.7** The transition table in Go and the state list in Postgres are generated from one source; a test asserts they agree.
- **Acceptance criteria**:
  1. Given an order in `RESTAURANT_PENDING`, When a `PUT` attempts to set it to `DELIVERED`, Then 409 `illegal_transition` listing `["PREPARING","REJECTED","CANCELLED"]`, and no row changes.
  2. Given restaurant staff scoped to R1 and an order for R2 in `RESTAURANT_PENDING`, When they accept it, Then 404 and no transition occurs. (Old system: any caller with two ids could accept.)
  3. Given an order accepted by the restaurant, When capture fails permanently, Then the order does not enter `PREPARING`; it reaches `CANCELLED` with `cancel_reason='capture_failed'` and the restaurant is notified.
  4. Given an order in `PREPARING`, When the rider marks pickup before the restaurant marks ready, Then 409 — `PREPARING → PICKED_UP` is not in the table; the rider sees "waiting for the kitchen".
  5. Given the state machine, When the exhaustive transition test runs (all 14 × 14 ordered pairs × 6 actor kinds), Then exactly the 21 rows above are permitted and all 1155 other combinations are rejected.
  6. Given an order reaching `DELIVERED`, When settlement fails, Then the order stays `DELIVERED` with an armed deadline and retries; it never silently sits without a deadline.

- **Version**: V1 · **Size**: L

---

### P-15 — Deadlines and timeout actions ("waits forever" is unrepresentable)

- **Behaviour**: Every non-terminal state carries `deadline_at NOT NULL` and a named `deadline_action`. A single in-process **deadline runner** claims due rows with `FOR UPDATE SKIP LOCKED` and executes the action inside the same transaction that re-arms or clears the deadline. There is no external orchestrator, no workflow engine, no `await condition()` without a timeout. The database `CHECK` constraint in P-14 is the enforcement: a non-terminal order with a NULL deadline **cannot be committed**.

  **Order deadlines:**

  | State | `deadline_at` | Action | Escalation cap | On cap |
  |---|---|---|---|---|
  | `CREATED` | `+15 min` | `EXPIRE_PAYMENT` — cancel the PaymentIntent, transition T3 | 0 | — |
  | `AUTHORIZED` | `+60 s` | `OFFER_RESTAURANT` — emit the offer, transition T4 (or T5 if the restaurant is closed/paused) | 3 (retry every 60 s) | T5 `CANCELLED` + void |
  | `RESTAURANT_PENDING` | `+180 s` | `RESTAURANT_TIMEOUT` — transition T8, void auth, notify customer, decrement the restaurant's acceptance SLA | 0 | — |
  | `PREPARING` | `accepted_at + prep_eta + 10 min` | `PREP_OVERDUE` — notify customer with a new ETA, alert ops, re-arm `+10 min` | 3 | T11 `CANCELLED`, full customer refund, restaurant paid per policy |
  | `READY_FOR_PICKUP` | `ready_at + 15 min` | `PICKUP_OVERDUE` — escalate dispatch (widen radius / manual assign), alert ops, re-arm `+10 min` | 3 | T13 `CANCELLED`, full customer refund, restaurant paid in full, cost to `PLATFORM_ABSORBED` |
  | `PICKED_UP` | `picked_up_at + 75 min` | `DELIVERY_OVERDUE` — ping rider, alert ops, re-arm `+15 min` | 3 | T17 `DISPUTED` + ops case. **Never auto-delivers.** |
  | `ARRIVED` | `+15 min` | `HANDOVER_OVERDUE` — notify customer, alert ops, re-arm `+10 min` | 2 | T17 `DISPUTED` + ops case |
  | `DELIVERED` | `+2 min` | `SETTLE` — post the settlement batch, transition T18; on failure re-arm with exponential backoff (2 m, 4 m, 8 m, …) | 8 | page on-call; order stays `DELIVERED` with an armed deadline, never abandoned |
  | `DISPUTED` | `+48 h` | `DISPUTE_SLA_BREACH` — escalate to senior ops, re-arm `+24 h` | 3 | auto-resolve in the customer's favour per policy, transition T20 |

  **Dispatch deadlines:**

  | State | `deadline_at` | Action | Cap | On cap |
  |---|---|---|---|---|
  | `PENDING` | `+10 s` | `START_SEARCH` → `SEARCHING` | 3 | `NO_RIDER_FOUND` |
  | `SEARCHING` | `+20 s` | `NEXT_WAVE` — widen radius (3 → 6 → 10 km), re-offer | 3 waves | `NO_RIDER_FOUND` |
  | `OFFERED` | `offered_at + 30 s` | `EXPIRE_OFFERS` — mark offers `EXPIRED`, back to `SEARCHING` | — | via `SEARCHING` cap |
  | `ASSIGNED` | `+20 min` | `RIDER_NOT_ARRIVING` — nudge rider, then `UNASSIGNED` and re-search | 2 | `NO_RIDER_FOUND` |
  | `AT_RESTAURANT` | `+15 min` | `PICKUP_STALLED` — ops alert, re-arm | 3 | `UNASSIGNED` + re-search |
  | `CARRYING` | `+60 min` | `IN_TRANSIT_STALLED` — ops alert, re-arm | 3 | order T17 `DISPUTED` |
  | `AT_CUSTOMER` | `+15 min` | `HANDOVER_STALLED` — ops alert | 2 | order T17 `DISPUTED` |
  | `UNASSIGNED` | `+5 s` | `RESUME_SEARCH` → `SEARCHING` | 3 | `NO_RIDER_FOUND` |

  Also deadline-governed with the same mechanism: `payment_intent` rows (7-day Stripe auth expiry, re-armed daily), `kyc_document` review SLA (72 h), `payout` execution (retry ladder), `stored_object` unconfirmed uploads (1 h → delete), `otp_challenge` (window close), `quote` (expiry sweep).

  **Runner mechanics:**
  ```sql
  UPDATE "order" SET lease_until = now() + interval '30 seconds', lease_owner = $worker
   WHERE id IN (
     SELECT id FROM "order"
      WHERE deadline_at <= now() AND (lease_until IS NULL OR lease_until < now())
      ORDER BY deadline_at
      FOR UPDATE SKIP LOCKED LIMIT 50)
  RETURNING *;
  ```
  Each claimed row's action runs in its own transaction; the transaction ends by either transitioning (which sets a new deadline or NULLs it for terminal) or re-arming. A crash mid-action releases the lease after 30 s and the action re-runs — so **every deadline action must be idempotent**, keyed by `(order_id, state, escalation_no)` in `ledger_batch.idempotency_key` and in any outbound side effect.

  **Outages.** A deadline that fell while no runner was running (a failover, a restore, a reboot, a crash) is not a miss by the restaurant or the rider, and must not be fired as one. So:
  - every runner tick first writes a heartbeat row (`deadline_runner_heartbeat`, once a second);
  - a runner that finds the newest heartbeat of any runner more than **2 minutes** old records the gap `(last heartbeat, now]` as a `deadline_outage` window and alerts ops (`admin.alert` on `admin:ops`, kind `DEADLINE_OUTAGE`), in the same transaction. A shorter gap (one replica restarting, a rolling deploy) is not an outage: its deadlines fire normally;
  - a due row whose `deadline_at` lies inside a window takes the **outage path**. An order not yet accepted (`CREATED`, `AUTHORIZED`, `RESTAURANT_PENDING`) is cancelled with `PLATFORM_ERROR` — its authorisation is voided, the customer is told it was a problem on our side, and nothing counts against the restaurant's acceptance rate. An accepted, paid order fires its action once **without using up an escalation** and re-arms from now;
  - each outage action is written to `deadline_audit` with outcome `OUTAGE_VOIDED` or `OUTAGE_RE_ARMED` and the `outage_id` of its window; the schema refuses one without the other;
  - `HG_DEADLINE_RUNNER_HOLD=true` starts the runner **held** — no heartbeat, no fires — until ops inserts a `deadline_runner_release` row, so a failover can finish its catch-up first. Nobody edits `deadline_at` by hand: the gap is handled by the outage path.

- **Data**: `deadline_at`, `deadline_action`, `deadline_escalations`, `lease_until`, `lease_owner` on `order`, `dispatch`, `payment_intent`, `payout`, `kyc_document`, `stored_object`. A `deadline_audit` table records every fired action `(subject_type, subject_id, action, escalation_no, fired_at, outcome, duration_ms)` for SLA reporting. Outages add `deadline_runner_heartbeat` (one row per runner), `deadline_outage` (one row per gap, windows may not overlap) and `deadline_runner_release`, and tag `deadline_audit.outage_id`.

  Redis: none. Scheduling is entirely in Postgres — this is deliberate, so a Redis flush cannot lose a timeout (the old system's timeouts lived in Temporal + Redis TTLs and the 30-minute mapping key was the only thing holding a checkout together).

- **Rules & invariants**:
  - **I-15.1** `SELECT count(*) FROM "order" WHERE state NOT IN (terminal) AND deadline_at IS NULL` = 0 — guaranteed by `CHECK`, not by a job.
  - **I-15.2** No wait anywhere in the codebase is unbounded. Arch-lint bans `context.Background()` in request/step paths and requires every `ctx` in `internal/orders`, `internal/dispatch`, `internal/payments` to carry a deadline.
  - **I-15.3** Every deadline action is idempotent; running it twice produces one state change and one set of side effects.
  - **I-15.4** `deadline_escalations` is monotonic and capped; reaching the cap always drives the row toward a terminal state or a human queue — never back into an unbounded loop.
  - **I-15.5** Deadline lag (`now() − deadline_at` at fire time) p99 < 5 s; an alert fires above 30 s.
  - **I-15.6** No timeout results in "money kept, no food, no refund": every cancelling action posts a refund/void batch in the same transaction as the transition.
- **Acceptance criteria**:
  1. Given an attempt to insert an order in `PREPARING` with `deadline_at = NULL`, When committed, Then the statement fails with `order_deadline_required`.
  2. Given an order in `RESTAURANT_PENDING` and the restaurant never responds, When 180 s elapse, Then the order is `CANCELLED`, the PaymentIntent is cancelled, `SUM(ledger_entry) = 0` for the order, and the customer receives a push + email. (Old system: relied on a 15-minute workflow timeout that crashed without refunding — finding 4/§7.4.)
  3. Given the runner process is SIGKILLed mid-action, When it restarts, Then the action re-runs and the end state and ledger are identical to the uninterrupted case.
  4. Given two runner replicas, When 1000 orders come due simultaneously, Then each action executes exactly once (assert via `deadline_audit` uniqueness on `(subject_id, action, escalation_no)`).
  5. Given `READY_FOR_PICKUP` with no rider for 45 minutes, Then after 3 escalations the order is `CANCELLED`, the customer is fully refunded, the restaurant's payable is credited in full, and the difference lands in `PLATFORM_ABSORBED`.
  6. Given Redis is flushed while 200 orders are mid-flight, Then every deadline still fires and every order reaches a terminal state.
  7. Given the runner stopped more than 2 minutes ago and deadlines fell in the gap, When it restarts, Then each unaccepted order is `CANCELLED` with `PLATFORM_ERROR`, each paid order is re-armed from now with `deadline_escalations` unchanged, each action has exactly one `deadline_audit` row tagged with the outage, and exactly one ops alert is raised.
  8. Given a gap under 2 minutes, When the runner restarts, Then the deadlines in it fire normally and no outage is recorded.
- **Version**: V1 · **Size**: L

> **Decided:** 180 s; expiry cancels and voids the authorisation ([acceptance window](../decisions/README.md#settled--reconciliations)). Closing the tablet dialog still never rejects an order.

> **Decided:** customer fully refunded, restaurant paid in full, the platform absorbs the cost ([refund liability](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

> **Open:** is the customer offered a pickup option before the order is cancelled?

> **DECISION REQUIRED — prep overdue cancellation**: When a kitchen blows through three escalations, is the restaurant still paid? · **Proposed default**: no — full customer refund, no restaurant payout, incident recorded against the restaurant's SLA. · **Why**: unlike the no-rider case, the failure is the restaurant's.

> **Decided:** free until the restaurant accepts; after that, staff may cancel without a support case, reason on the audit log ([cancellation policy](../decisions/README.md#settled--client-decisions)).

> **DECISION REQUIRED — dispute window**: How long after delivery may a dispute be raised? · **Proposed default**: 72 hours for the customer, 7 days for the restaurant, with a 48-hour support SLA. · **Why**: it bounds the period during which a settled payout can be clawed back.

---

# 5. Payments (Stripe, CAD, Canada)

### P-16 — PaymentIntent lifecycle and capture timing

- **Behaviour**: **Auth-then-capture.** The PaymentIntent is created with `capture_method: 'manual'` when the order is created; funds are *authorised* immediately and *captured* only when the restaurant accepts. If the restaurant rejects or times out, the authorisation is cancelled and the customer is never charged — no refund is needed, so there is no refund to fail. This is the single most important payment design choice: it removes the entire "we charged them and then failed to refund" class that the old system lived in.

  `POST /v1/orders` (idempotent, `MONEY`):
  1. Validate + re-execute the quote (P-09).
  2. In one transaction: create `order` in `CREATED`, `order_line`(+addons), `dispatch` deferred, `payment_intent` row, outbox event.
  3. Create the Stripe PaymentIntent:
     ```
     amount               = quote.total_cents            // integer, CAD
     currency             = 'cad'
     capture_method       = 'manual'
     confirmation_method  = 'automatic'
     customer             = account.stripe_customer_id
     payment_method       = <saved pm> | automatic_payment_methods
     setup_future_usage   = 'off_session'                 // only when the customer opted to save the card
     metadata             = { order_id, order_code, quote_id, account_id, restaurant_id, env }
     statement_descriptor_suffix = 'HALALGOES'
     idempotency_key      = 'pi:' || order_id
     ```
  4. Return `{order, client_secret}`. The client confirms with Stripe.js / the Stripe React Native SDK — the card never touches our servers (SAQ-A scope).
  5. `payment_intent.amount_capturable_updated` (status `requires_capture`) → T1 `AUTHORIZED`.
  6. Restaurant accepts → `POST /v1/payments/{id}/capture` internally, `capture` with `amount_to_capture = order.total_cents` and `idempotency_key = 'cap:' || order_id`. Success → T6 `PREPARING`.
  7. Restaurant rejects / times out / customer cancels pre-acceptance → `PaymentIntent.cancel(cancellation_reason='abandoned')`, `idempotency_key = 'cancel:' || order_id`.

  **3-D Secure / SCA**: Canada has no PSD2 mandate, but 3DS is used opportunistically via `request_three_d_secure: 'automatic'` and Radar rules. `requires_action` is a **normal** path: the order stays `CREATED`, the client is handed the action, and the 15-minute `CREATED` deadline covers abandonment.

  **Payment methods at launch**: card (Visa/Mastercard/Amex), Apple Pay, Google Pay — all through the same PaymentIntent. Interac Debit is available in Canada through Apple Pay/Google Pay wallets. No cash on delivery in V1.

  **Amount immutability**: an uncaptured PaymentIntent's amount may be *reduced* at capture (partial capture) but never increased. Consequences that are designed for, not discovered:
  - an item that turns out to be unavailable ⟹ re-quote, capture the **lower** amount, and post the difference as never-charged;
  - a **post-delivery tip** cannot be added to the original PI ⟹ it is a **new** off-session PaymentIntent against the saved payment method (P-18 note), never an incremental authorisation (incremental auth is card-present only).

  **Auth expiry**: Stripe auto-cancels uncaptured PaymentIntents after 7 days. Our longest pre-capture window is 180 s + 60 s, so this never binds in practice; a daily reconciliation job nonetheless re-arms `payment_intent.deadline_at` and alerts on any PI uncaptured for > 1 hour.

- **Data**:

```sql
CREATE TYPE payment_state AS ENUM (
  'REQUIRES_PAYMENT_METHOD','REQUIRES_CONFIRMATION','REQUIRES_ACTION','PROCESSING',
  'REQUIRES_CAPTURE','SUCCEEDED','CANCELED','FAILED'
);

CREATE TABLE payment_intent (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES "order"(id),
  kind text NOT NULL DEFAULT 'ORDER',        -- 'ORDER' | 'POST_DELIVERY_TIP' | 'ADJUSTMENT'
  stripe_payment_intent_id text NOT NULL UNIQUE,
  stripe_customer_id text,
  stripe_payment_method_id text,
  state payment_state NOT NULL,
  amount_authorized_cents bigint NOT NULL,
  amount_captured_cents bigint NOT NULL DEFAULT 0,
  amount_refunded_cents bigint NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'CAD',
  psp_fee_cents bigint,
  card_brand text, card_last4 text, card_country char(2), wallet text,
  failure_code text, failure_message text, decline_code text,
  authorized_at timestamptz, captured_at timestamptz, canceled_at timestamptz,
  deadline_at timestamptz, deadline_action text, deadline_escalations int NOT NULL DEFAULT 0,
  lease_until timestamptz, lease_owner text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capture_le_auth CHECK (amount_captured_cents <= amount_authorized_cents),
  CONSTRAINT refund_le_capture CHECK (amount_refunded_cents <= amount_captured_cents)
);
CREATE UNIQUE INDEX payment_intent_order_primary ON payment_intent(order_id) WHERE kind='ORDER';

CREATE TABLE saved_payment_method (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(id),
  stripe_payment_method_id text NOT NULL UNIQUE,
  brand text NOT NULL, last4 text NOT NULL, exp_month int NOT NULL, exp_year int NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
```
  No PAN, no CVV, no expiry beyond display fields, ever. The old `UserPaymentMethod` stored only an enum naming a *category* and could not be charged (B46); this stores a Stripe PaymentMethod id and nothing sensitive.

  Redis: none. Payment state is never read from Redis.

- **Rules & invariants**:
  - **I-16.1** Every Stripe write call carries a deterministic `Idempotency-Key` derived from `(operation, order_id[, sequence])`. No random keys.
  - **I-16.2** `amount` sent to Stripe always equals `quote.total_cents` of the order's quote. Test asserts equality on every created PI.
  - **I-16.3** An order never reaches `PREPARING` unless `payment_intent.state='SUCCEEDED'` and `amount_captured_cents = order.total_cents`.
  - **I-16.4** `stripe_payment_intent_id` is unique; there is exactly one `kind='ORDER'` PI per order.
  - **I-16.5** No fabricated payment identifiers exist. Arch-lint bans any string literal beginning `pi_`, `ch_`, `re_`, `acct_` outside test fixtures — the old code minted `stripe_${nanoid()}` (B43).
  - **I-16.6** Boot probe: the configured Stripe key's livemode must match `HG_ENV` (`production` ⟺ live key), else the process exits.
- **Acceptance criteria**:
  1. Given an order is created, Then a PaymentIntent exists with `capture_method=manual`, `currency=cad`, `amount = quote.total_cents`, and `metadata.order_id` set.
  2. Given the restaurant rejects, Then the PI is cancelled, `amount_captured_cents = 0`, the customer's statement shows no charge, and **no refund object is created**.
  3. Given the same `POST /v1/orders` request is retried with the same `Idempotency-Key`, Then exactly one order and one PaymentIntent exist and the second call replays the first response.
  4. Given a 3DS challenge, Then the order remains `CREATED` with a live 15-minute deadline and `payment.action_required` is delivered over the realtime channel with the client secret.
  5. Given a capture attempt for an amount greater than the authorisation, Then it is rejected before reaching Stripe by the `capture_le_auth` constraint path.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — capture timing**: Authorise at checkout and capture on restaurant acceptance, or capture immediately? · **Proposed default**: auth-then-capture as specified. · **Why**: a rejected or timed-out order then requires no refund at all, which deletes the failure mode that dominated the old system.

---

### P-17 — Webhooks, idempotency and reconciliation

- **Behaviour**: `POST /v1/webhooks/stripe` is a `Public` route (no session) protected by **signature verification** — `Stripe-Signature` checked against `STRIPE_WEBHOOK_SECRET` with a 300-second tolerance. Unverified requests are 400 and are not logged with their body.

  Processing is **store-then-process**:
  1. Verify signature. Insert `webhook_event {stripe_event_id UNIQUE, type, payload, received_at}`. A duplicate `stripe_event_id` returns `200` immediately — this is the idempotency boundary, and it is a Postgres unique index, not a Redis key.
  2. Commit, return `200` within the request. Processing happens in the deadline-runner loop (`webhook_event.deadline_at`), so a slow handler never causes Stripe to retry against a half-done state.
  3. The handler processes the event under `FOR UPDATE SKIP LOCKED`, applies it, sets `processed_at`, and re-arms on failure with backoff (1 m, 2 m, 4 m … cap 8 attempts, then ops page).
  4. **Out-of-order safety**: every handler is a *state assertion*, not a delta. `handleAmountCapturableUpdated` sets state to `REQUIRES_CAPTURE` only if the local state is earlier in the lifecycle; it never moves a PI backwards. Each `payment_intent` row carries `last_stripe_event_created_at`; events older than the last applied one are recorded and skipped.

  **Handled events:**

  | Event | Effect |
  |---|---|
  | `payment_intent.amount_capturable_updated` | → `REQUIRES_CAPTURE`, order T1 `AUTHORIZED` |
  | `payment_intent.requires_action` | → `REQUIRES_ACTION`, emit `payment.action_required` |
  | `payment_intent.succeeded` | → `SUCCEEDED`, set `amount_captured_cents`, post the CAPTURE ledger batch, order T6 |
  | `payment_intent.payment_failed` | → `FAILED`, order T2/T3 per retry policy, notify |
  | `payment_intent.canceled` | → `CANCELED` |
  | `charge.refunded` | reconcile `refund` rows, post the REFUND batch if not already posted |
  | `charge.dispute.created` / `.closed` | open/close a chargeback record, freeze affected payouts |
  | `balance.available` | trigger payout reconciliation |
  | `account.updated` (Connect) | update `connect_account` capabilities, `charges_enabled`, `payouts_enabled`, requirements |
  | `capability.updated` | same |
  | `transfer.created` / `transfer.reversed` | reconcile payout ledger |
  | `payout.paid` / `payout.failed` | update partner payout state, notify |

  **Reconciliation** (nightly, and on demand): pull Stripe balance transactions for the day and compare against `ledger_entry` on `PSP_CLEARING` and `PSP_FEES`. Any order present in one and not the other, or with an amount mismatch, is written to `reconciliation_exception` and paged. This is the backstop for a webhook that never arrived.

  **Catch-up after a failover or a restore** (on demand): a failover or a restore from backup loses the last moments of writes, and with them any webhook stored in that window. `hg stripe-catchup --since <time>` closes the gap without waiting for the nightly run. It lists the Stripe events created since `<time>` and stores each one through the same store step a delivered webhook takes, so the unique index on the event id drops the ones already here, then applies every stored event in that window that has not been applied yet, oldest first. Next it reads back from Stripe every payment intent written in the last 24 hours (or since `<time>`, if that is earlier) and asserts its state through the same handlers; it never writes a payment state directly. It applies only the event types that have a payment intent effect; any other stored event (a refund, a dispute, a Connect account or a payout) stays pending for the handler that will own it. It prints the transitions it applied. Each disagreement it will not settle by itself (a payment Stripe knows and the database does not, one the database has further along than Stripe, or a captured payment Stripe reports cancelled or the other way round, which it never moves by itself) is written to `reconciliation_exception` in the same transaction that marks its event applied, at most one open row per kind and payment. A late decline for a payment already captured or cancelled is an old event, not a disagreement. Every run lists all the open ones and exits non-zero while any remain, until a person resolves them. It is a command of the `hg` binary, not an HTTP route, so only someone holding the server's own secrets can run it. A second run changes nothing.

- **Data**:

```sql
CREATE TABLE webhook_event (
  id uuid PRIMARY KEY,
  provider text NOT NULL DEFAULT 'stripe',
  stripe_event_id text NOT NULL,
  type text NOT NULL,
  api_version text,
  payload jsonb NOT NULL,
  livemode boolean NOT NULL,
  event_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  deadline_at timestamptz, deadline_action text, lease_until timestamptz, lease_owner text
);
CREATE UNIQUE INDEX webhook_event_dedupe ON webhook_event(provider, stripe_event_id);

CREATE TABLE reconciliation_exception (
  id uuid PRIMARY KEY, kind text NOT NULL, order_id uuid, payout_id uuid,
  stripe_object_id text, expected_cents bigint, actual_cents bigint,
  detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, resolution text
);
```
  Redis: none in the webhook path. Idempotency must survive a Redis flush, so it lives in Postgres.

- **Rules & invariants**:
  - **I-17.1** Processing an event twice produces exactly one state change and one ledger batch.
  - **I-17.2** An unsigned or badly-signed webhook never mutates any row.
  - **I-17.3** `livemode` on the event must match the environment, or the event is rejected and alerted (prevents test events touching production).
  - **I-17.4** No webhook handler blocks the HTTP response on business work; p99 response < 200 ms.
  - **I-17.5** Every order that has ever had a captured PI appears in the daily reconciliation with zero variance, or a `reconciliation_exception` exists.
- **Acceptance criteria**:
  1. Given Stripe redelivers the same event 5 times, Then `webhook_event` has one row, the ledger has one CAPTURE batch, and all 5 responses are 200.
  2. Given `payment_intent.succeeded` arrives **before** `amount_capturable_updated`, Then the final state is `SUCCEEDED` and the order is in `PREPARING`; the late event is recorded and skipped.
  3. Given a forged webhook with a valid-looking body and no signature, Then 400 and zero rows change.
  4. Given a webhook handler panics, Then the event is retried with backoff and the 8th failure pages on-call; the HTTP response was 200 throughout.
  5. Given a capture that Stripe processed but whose webhook never arrived, When reconciliation runs, Then the discrepancy is detected and the CAPTURE batch is posted idempotently.
- **Version**: V1 · **Size**: L

---

### P-18 — Refunds, cancellations and compensation

- **Behaviour**: Two mechanisms, never confused:
  - **Void** — pre-capture. `PaymentIntent.cancel`. No money moved, no refund object, no ledger charge/refund pair (only a `CANCELLED` order transition). Used for T5, T7, T8, T9.
  - **Refund** — post-capture. `Refund.create(payment_intent, amount, reason, metadata, idempotency_key='rf:'||refund_id)`. Full or partial.

  A refund is always requested through `POST /v1/refunds` with `{order_id, kind, lines?, reason_code, note}` where `kind ∈ {FULL, PARTIAL_ITEMS, FEES_ONLY, GOODWILL}`. **The caller never sends an amount for `FULL`/`PARTIAL_ITEMS`/`FEES_ONLY`** — the server computes it from the order:

  ```
  FULL           → order.total_cents (minus any prior refunds)
  PARTIAL_ITEMS  → Σ(refunded line totals) + proportional tax + proportional service fee
                   (delivery fee refunded only if the whole order is refunded; tip refunded only
                    when the rider did not deliver)
  FEES_ONLY      → delivery_fee + service_fee + their tax
  GOODWILL       → an explicit admin-entered amount, capped at the remaining captured balance,
                   requiring `refund.issue_goodwill` and, above $50.00, a second admin approval
  ```
  Tax on a partial refund is computed by re-running the tax engine on the refunded base, then reconciled by largest-remainder allocation so the sum of all refunds' tax never exceeds the original tax collected.

  **Who is charged back** is explicit per reason code, and is what makes the ledger balance:

  | Reason | Customer refunded | Restaurant charged back | Rider charged back | Platform absorbs |
  |---|---|---|---|---|
  | `RESTAURANT_REJECTED` (pre-capture) | n/a — voided | — | — | — |
  | `ITEM_MISSING` / `WRONG_ITEM` | item + its tax | item net + its commission reversed | — | — |
  | `FOOD_QUALITY` | per support judgement | yes, if substantiated | — | remainder |
  | `HALAL_CONCERN` (filed by staff with evidence) | item + its tax | item net, only when substantiated | — | all of it otherwise, as goodwill |
  | `NEVER_DELIVERED` (no POD) | full | — | rider earnings reversed, minus a proven-effort payment | remainder |
  | `LATE_DELIVERY` | fees only | — | — | full |
  | `NO_RIDER_FOUND` | full | — | — | full (restaurant still paid) |
  | `CUSTOMER_CHANGED_MIND` (post-accept) | full or none per policy | — | — | full when refunded |
  | `PLATFORM_ERROR` | full | — | — | full |

  **Compensation is transactional, not best-effort.** Every cancelling transition writes the refund request, the ledger batch and the state change in **one** Postgres transaction; the Stripe call happens afterwards from the outbox with retries. A Stripe refund that fails permanently leaves `refund.state='FAILED'`, pages on-call, and keeps the order out of `COMPLETED` — it is never silently swallowed. This is the direct replacement for the old `"Payment refund would be initiated here"` TODO and the saga branch that fell through to rider assignment when compensation returned false (B48, §7.6).

  **Chargebacks** (`charge.dispute.created`): freeze the restaurant's and rider's next payout up to the disputed amount, open a `chargeback` row with the evidence-due deadline, auto-attach the receipt, POD photo, delivery GPS track and timeline as evidence, and notify ops.

  **Post-delivery tip** is the mirror image: a new `payment_intent` with `kind='POST_DELIVERY_TIP'` charged off-session against the saved payment method, posting a `TIP` ledger batch that credits `RIDER_PAYABLE` in full.

- **Data**:

```sql
CREATE TABLE refund (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES "order"(id),
  payment_intent_id uuid NOT NULL REFERENCES payment_intent(id),
  stripe_refund_id text UNIQUE,
  kind text NOT NULL, reason_code text NOT NULL, note text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  tax_cents bigint NOT NULL DEFAULT 0,
  restaurant_chargeback_cents bigint NOT NULL DEFAULT 0,
  rider_chargeback_cents bigint NOT NULL DEFAULT 0,
  platform_absorbed_cents bigint NOT NULL DEFAULT 0,
  state text NOT NULL,                 -- 'REQUESTED'|'APPROVED'|'SUBMITTED'|'SUCCEEDED'|'FAILED'
  requested_by uuid NOT NULL, approved_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz,
  deadline_at timestamptz, deadline_action text, attempts int NOT NULL DEFAULT 0, last_error text
);
CREATE TABLE refund_line (
  refund_id uuid NOT NULL REFERENCES refund(id) ON DELETE CASCADE,
  order_line_no int NOT NULL, quantity int NOT NULL, amount_cents bigint NOT NULL,
  PRIMARY KEY (refund_id, order_line_no)
);
CREATE TABLE chargeback (
  id uuid PRIMARY KEY, order_id uuid NOT NULL, stripe_dispute_id text UNIQUE NOT NULL,
  amount_cents bigint NOT NULL, reason text, state text NOT NULL,
  evidence_due_at timestamptz, submitted_at timestamptz, outcome text,
  deadline_at timestamptz, deadline_action text
);
```

- **Rules & invariants**:
  - **I-18.1** `Σ refund.amount_cents per order ≤ payment_intent.amount_captured_cents`. DB constraint + application check.
  - **I-18.2** Every refund posts a balanced ledger batch; after it, `SUM(ledger_entry) per order = 0` still holds.
  - **I-18.3** No refund amount comes from the client except `GOODWILL`, which requires a distinct action and dual approval above threshold.
  - **I-18.4** A failed refund never allows the order to reach a terminal money state; `refund.state='FAILED'` is an alerting condition with a deadline.
  - **I-18.5** Voids and refunds are distinct code paths; a pre-capture cancellation never calls the refund API.
  - **I-18.6** Refunding a tip is only permitted when the rider did not complete delivery.
- **Acceptance criteria**:
  1. Given the worked example order, When a `PARTIAL_ITEMS` refund for one $12.00 dish is issued, Then the customer is refunded $12.00 + its proportional HST, the restaurant's payable drops by the dish net and its commission is reversed, the rider keeps their earnings and tip, and `SUM(ledger_entry) per order = 0`.
  2. Given Stripe returns a permanent error on refund, Then `refund.state='FAILED'`, on-call is paged, the order does not reach `COMPLETED`, and the customer sees "refund in progress" not "refunded".
  3. Given a cancelled pre-capture order, Then zero `refund` rows exist and zero Stripe refund API calls were made.
  4. Given two concurrent `FULL` refund requests with different idempotency keys, Then the second fails `refund_exceeds_captured` and exactly one refund exists.
  5. Given a chargeback is created, Then the restaurant's and rider's next payouts are held up to the disputed amount and evidence is assembled automatically.
- **Version**: V1 · **Size**: L

> **Decided:** by fault, per reason code, as tabled; a halal concern charges the restaurant only when substantiated ([refund liability](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1), [halal complaint](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

> **Decided:** a second approver above CAD 50, for every role ([goodwill approval](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).

---

### P-19 — Stripe Connect: onboarding and payouts (Canada)

- **Behaviour**: **Separate charges and transfers.** The customer's money is charged on the platform account; the platform then creates `Transfer` objects to the restaurant's and rider's connected accounts. This is chosen over destination charges because the platform must control the exact split across four parties (restaurant, rider, tax, platform) and must be able to hold, delay or reverse a partner's share independently — which a destination charge cannot express.

  **Account type**: **Express** connected accounts with Stripe-hosted onboarding, `country: 'CA'`, `default_currency: 'cad'`, `capabilities: { card_payments: {requested: false}, transfers: {requested: true} }` (transfers only — connected accounts never take card payments directly).

  **Onboarding flow** (identical shape for restaurants and riders):
  1. `POST /v1/connect/account` — creates the Express account, stores `connect_account`. Requires the partner to be admin-approved first (restaurant KYC verified / rider approved).
  2. `POST /v1/connect/onboarding-link` `{return_url, refresh_url}` → Stripe `AccountLink` (TTL ~5 min). The **return and refresh URLs are server-generated** from a configured base; the client cannot supply arbitrary URLs. (The old restaurant-web error path redirected to `/auth/login`, a route that does not exist — R23; here the return handler resolves the partner's onboarding state from the server and routes accordingly.)
  3. `GET /v1/connect/status` → `{charges_enabled, payouts_enabled, details_submitted, requirements: {currently_due, eventually_due, past_due, disabled_reason}, deadline}`.
  4. `account.updated` webhooks keep `connect_account` current. `payouts_enabled=false` blocks payout execution. A partner whose payouts worked before keeps taking orders and offers while Stripe restricts payouts; a new partner finishes Stripe setup before a first order ([restricted payouts](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01); contract change: [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)).

  **Canadian KYC requirements Stripe will demand** (surfaced verbatim to the partner, never guessed at):
  - *Individual / sole proprietor (most riders)*: legal name, DOB, home address, phone, email, **SIN** (Stripe may request the full SIN or last 4 for identity verification), a government photo ID when verification fails automatically.
  - *Company (most restaurants)*: legal business name, **Business Number (BN)**, business address, industry (MCC 5812 restaurants / 5814 fast food), a **representative** with full personal details and attested authority, **directors**, and **beneficial owners holding ≥ 25%**, plus the ownership-declaration attestation.
  - *Bank account for CAD payouts*: **transit number (5 digits) + institution number (3 digits) + account number (7–12 digits)**, account holder name and type. Validated client-side for shape and by Stripe on submission.
  - Riders under 18 cannot be onboarded (`rider_profile.date_of_birth` gate).

  **Payout execution**: connected accounts are set to `payout_schedule: manual` so the platform controls timing; we create `Transfer` (platform → connected account) on a schedule, then `Payout` (connected balance → bank) per the partner's preference. Each `payout` row aggregates ledger entries and is executed once, keyed by `idempotency_key = 'po:' || payout_id`.

  ```
  payout.amount_cents = SUM(ledger_entry.amount_cents)
                        WHERE account = 'RESTAURANT_PAYABLE' (or 'RIDER_PAYABLE')
                          AND counterparty_id = <partner>
                          AND payout_id IS NULL
                          AND order settled before the cutoff
                          AND not frozen by a chargeback or dispute hold
  ```
  Posting a payout batch stamps `payout_id` on exactly those entries, so a ledger row can never be paid twice (unique partial index).

  **Schedules**: restaurants and riders are paid weekly, every Monday, automatically, with no minimum ([payout cadence](../decisions/README.md#settled--client-decisions)); a held payout is released on the next Monday run ([held payout](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)). **Instant cash-out** is a V2 feature. Negative partner balances (from chargebacks/refund chargebacks) are carried and netted against future payouts; a balance negative for more than 30 days escalates to collections and blocks new orders for that restaurant.

  **Cross-border**: platform and all connected accounts are Canadian; payouts are CAD to Canadian bank accounts only in V1. Non-CA partners are rejected at onboarding.

- **Data**:

```sql
CREATE TABLE connect_account (
  id uuid PRIMARY KEY,
  owner_type text NOT NULL,               -- 'RESTAURANT' | 'RIDER'
  owner_id uuid NOT NULL,
  stripe_account_id text NOT NULL UNIQUE,
  country char(2) NOT NULL DEFAULT 'CA',
  default_currency char(3) NOT NULL DEFAULT 'CAD',
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  requirements jsonb NOT NULL DEFAULT '{}',
  disabled_reason text,
  payout_interval text NOT NULL DEFAULT 'WEEKLY',   -- 'DAILY'|'WEEKLY'
  payout_anchor int NOT NULL DEFAULT 1,
  minimum_payout_cents bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX connect_account_owner ON connect_account(owner_type, owner_id);

CREATE TABLE payout (
  id uuid PRIMARY KEY,
  connect_account_id uuid NOT NULL REFERENCES connect_account(id),
  period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  amount_cents bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'CAD',
  state text NOT NULL,                    -- 'DRAFT'|'READY'|'TRANSFERRING'|'TRANSFERRED'|'PAID'|'FAILED'|'HELD'
  stripe_transfer_id text UNIQUE, stripe_payout_id text UNIQUE,
  hold_reason text,
  attempts int NOT NULL DEFAULT 0, last_error text,
  deadline_at timestamptz, deadline_action text, lease_until timestamptz, lease_owner text,
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
ALTER TABLE ledger_entry ADD COLUMN payout_id uuid REFERENCES payout(id);
CREATE UNIQUE INDEX ledger_entry_paid_once ON ledger_entry(id) WHERE payout_id IS NOT NULL;
```

- **Rules & invariants**:
  - **I-19.1** A ledger entry belongs to at most one payout. Enforced by the partial unique index plus `UPDATE … WHERE payout_id IS NULL`.
  - **I-19.2** `payout.amount_cents = SUM(ledger_entry.amount_cents WHERE payout_id = payout.id)` exactly.
  - **I-19.3** No transfer is created for an account with `payouts_enabled=false`; the payout goes `HELD` with a reason surfaced in the partner dashboard, and is released on the next Monday run after Stripe re-enables payouts.
  - **I-19.4** Every Stripe transfer/payout call is idempotency-keyed by `payout.id`.
  - **I-19.5** No partner takes a first order or offer before Stripe onboarding completes; a partner restricted later keeps working, and its balance accrues until payouts are re-enabled.
  - **I-19.6** Rider `date_of_birth` implies age ≥ 18 at onboarding.
- **Acceptance criteria**:
  1. Given a restaurant completes Express onboarding, Then `charges_enabled` remains false, `payouts_enabled` becomes true, and `capabilities.transfers` is `active`.
  2. Given a weekly payout run, Then every included ledger entry is stamped with the payout id and a second run produces `amount_cents = 0` for the same period.
  3. Given the transfer API call is retried after a timeout, Then exactly one Stripe transfer exists.
  4. Given a partner with `payouts_enabled=false`, Then the payout is `HELD`, the partner sees the exact Stripe `currently_due` requirement list, and no transfer is attempted.
  5. Given a rider with a $12.00 balance, When the Monday run executes, Then a $12.00 payout is created; there is no minimum.
  6. Given a chargeback of $30 against a restaurant with a $200 pending payout, Then the payout is reduced by $30 and the hold is visible with its reason.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — Connect account type**: Express (Stripe-hosted onboarding and dashboard) or Custom (fully white-label, platform owns all KYC UX and liability)? · **Proposed default**: **Express**. · **Why**: Stripe handles Canadian KYC collection, SIN/BN handling and the requirements UI, which removes the highest-liability screens from our scope; Custom can be adopted later without changing the ledger.

> **Decided:** weekly, every Monday, automatic, no minimum, for restaurants and riders ([payout cadence](../decisions/README.md#settled--client-decisions), [payout minimum](../decisions/README.md#settled--reconciliations)).

> **Decided (riders):** no automatic block at launch; operations follow up by hand ([rider balance below zero](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

> **Open:** is a restaurant negative for 30 days blocked from new orders, and is a partner's bank account never debited?

---

# 6. Realtime

### P-20 — WebSocket connection authentication

- **Behaviour**: The old gateway trusted a client-sent `connect_user {userId, userType}` frame and let `join_channel` auto-authenticate from the message body (B77). Any client could impersonate any restaurant and drain another user's notifications. The replacement has **no client-asserted identity at any point**.

  The socket is served by the same binary at `wss://api.halalgoes.com/v1/ws` behind Traefik (TLS terminated at Traefik; no separate port 9080, no plaintext WS, no wildcard CORS).

  **Ticket handshake** (browsers cannot set `Authorization` on a WebSocket upgrade):
  1. `POST /v1/realtime/ticket` — a normal authenticated REST call through the full middleware chain (P-06). Returns `{ticket, expires_at}` where `ticket` is 32 random bytes base64url.
  2. Server stores the ticket **in Postgres** (`realtime_ticket`) with `account_id`, `session_id`, `roles_snapshot`, `expires_at = now() + 30s`, `consumed_at NULL`. Redis mirrors it for lookup speed only.
  3. Client connects `wss://…/v1/ws?ticket=<t>&client=customer-app&v=1`.
  4. On upgrade the server consumes the ticket with a conditional `UPDATE … SET consumed_at=now() WHERE consumed_at IS NULL AND expires_at > now() RETURNING account_id, session_id, roles_snapshot`. Zero rows ⟹ the upgrade is refused with HTTP 401 before any frame is exchanged.
  5. Native clients may instead pass the access token in the `Sec-WebSocket-Protocol` header (`hg.v1, bearer.<jwt>`); the server validates it exactly as the HTTP path does.
  6. The server immediately sends `hello` containing the resolved principal, the channels the principal is *allowed* to subscribe to, the server time and the negotiated protocol version.

  **Session binding**: the connection carries `session_id`. When that session is revoked, the connection is closed with code `4401 session_revoked` within 10 s (same deny-set as P-04). Access-token expiry does **not** close the socket; instead the client must send a `reauth {access_token}` frame every ≤10 minutes, and a socket that has not reauthenticated within 15 minutes is closed `4401`. This keeps long-lived sockets bound to live sessions.

  **Limits per connection**: 64 KiB max frame, 20 inbound frames/second, 50 subscriptions, 4 concurrent connections per session, 10 per account. Heartbeat: server `ping` every 25 s, client must `pong` within 10 s or the socket is terminated. Origin is checked against the CORS allowlist on upgrade.

  **Back-pressure**: fan-out never waits on a socket. Each connection has its own writer and a queue of 64 unsent frames; a connection that falls further behind is closed `1013 slow_consumer` and resumes from Postgres. Each replica holds at most `HG_REALTIME_MAX_SOCKETS` sockets (default 2,000); an upgrade beyond that is closed `1013 at_capacity`, so the client retries and may land on the other replica.

- **Data**:

```sql
CREATE TABLE realtime_ticket (
  id uuid PRIMARY KEY,
  ticket_hash bytea NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES account(id),
  session_id uuid NOT NULL REFERENCES session(id),
  roles_snapshot jsonb NOT NULL,
  client text NOT NULL,
  issued_ip inet,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE realtime_connection (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL, session_id uuid NOT NULL,
  node_id text NOT NULL, client text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz, close_code int, close_reason text
);
```
  Redis (all **disposable**): `ws:ticket:{hash}` (TTL 30 s, mirror of Postgres), `ws:presence:{account_id}` (set of `node_id:conn_id`, TTL 90 s, refreshed by heartbeat), `ws:node:{node_id}:conns` (counter). Presence is a hint used to choose push vs socket delivery; if it is wrong or missing, the notification router falls back to push, which is safe (P-24). **Nothing about identity or subscription rights is read from Redis.**

- **Rules & invariants**:
  - **I-20.1** No frame from a client can establish, change or elevate identity. The inbound frame schema has no `user_id`/`user_type` field at all — it is not merely ignored, it is unrepresentable.
  - **I-20.2** A ticket is single-use and expires in 30 s.
  - **I-20.3** A revoked session's sockets close within 10 s.
  - **I-20.4** Upgrade with a bad/absent ticket returns HTTP 401 and no WebSocket is established.
  - **I-20.5** Presence data loss (Redis flush) degrades to push-first delivery and never causes a missed or misrouted notification.
- **Acceptance criteria**:
  1. Given a socket connected as customer C1, When it sends any frame claiming to be restaurant R1, Then the frame is rejected `unknown_field`/`invalid_frame` and the connection's principal is unchanged.
  2. Given a ticket, When it is used twice, Then the second upgrade is refused 401 and an audit event `realtime.ticket_reuse` is written.
  3. Given a session is revoked, When 10 s pass, Then every socket bound to it is closed with 4401.
  4. Given Redis is flushed, When a status change occurs, Then the customer still receives it (over the live socket if the node holds it, else via push).
  5. Given 21 frames in one second, Then the 21st receives `error{code:"rate_limited"}` and the socket stays open; 100 frames in one second closes it with 4429.
  6. Given one subscriber that stops reading, When events are published to its channel, Then every other subscriber still receives each one without waiting on it, and the stalled one is closed with 1013 once 64 frames are queued for it.
- **Version**: V1 · **Size**: L

---

### P-21 — Channels and subscriptions

- **Behaviour**: Channels are **server-derived**. `hello` lists the principal's currently allowed channels; a `subscribe` frame naming anything else is rejected. Every `subscribe` is authorised by a Postgres query against the same ownership predicates as HTTP (P-07) — the socket is not a second, weaker authorization surface.

  | Channel | Who may subscribe | Carries |
  |---|---|---|
  | `account:{account_id}` | that account only (auto-subscribed) | personal notifications, account/security events |
  | `order:{order_id}` | order's customer; staff of the order's restaurant; the assigned rider; support/admin | order + payment + dispatch + rider-location events, projected per role |
  | `restaurant:{restaurant_id}` | staff with a live scoped grant; support/admin | new-order offers, restaurant status |
  | `rider:{account_id}` | that rider; support/admin | dispatch offers, availability, earnings |
  | `admin:ops` | `ADMIN`, `SUPER_ADMIN`, `SUPPORT_AGENT` | platform alerts, dispatch failures, reconciliation exceptions |

  Membership is **derived, never stored as a mutable set**. The old system kept two parallel Redis membership schemes (`subscriptions:*` and `channel:*:members`) that drifted, and `leaveChannel` never told the server (R25/§7.12). Here, a subscription exists only for the lifetime of a connection, in that node's memory, and every publish re-checks nothing because subscription time already checked — with one exception: an `order:{id}` subscription is re-validated whenever the order's participant set changes (rider assigned/unassigned), and a rider who loses the dispatch is force-unsubscribed with `unsubscribed{reason:"no_longer_authorized"}`.

  Frames the client may send: `subscribe`, `unsubscribe`, `resume`, `reauth`, `pong`. That is the complete inbound vocabulary.

- **Data**: no persisted subscription table. `realtime_connection` (P-20) records the connection; in-memory per-node maps hold `conn → set[channel]` and `channel → set[conn]`.
  Redis: `ws:chan:{channel}` (set of `node_id`, TTL 120 s) is a **routing hint** so a publisher can skip nodes with no subscribers. Losing it means fan-out goes to all nodes — slower, still correct.
- **Rules & invariants**:
  - **I-21.1** Every `subscribe` performs a fresh Postgres authorization check; there is no cached allow-list beyond the current frame.
  - **I-21.2** A principal can never receive an event for a channel it is not subscribed to, and can never subscribe to a channel it cannot pass the ownership check for.
  - **I-21.3** Losing dispatch of an order revokes the rider's `order:{id}` subscription within 2 s.
  - **I-21.4** Payloads are projected per role by the same projection types as HTTP (P-07); there is one serializer per (event, role), not a shared struct with conditional blanking.
- **Acceptance criteria**:
  1. Given customer C2, When C2 subscribes to `order:{X}` belonging to C1, Then `subscribe_error{code:"not_found"}` and no events are ever delivered.
  2. Given a rider is unassigned, When 2 s pass, Then the rider's socket receives `unsubscribed{channel:"order:X", reason:"no_longer_authorized"}` and subsequent events for X are not delivered to it.
  3. Given a restaurant socket subscribed to `order:{X}`, When `rider.location` events are published, Then the restaurant receives them without the customer's phone or exact address; the customer receives the rider's public profile only.
  4. Given a socket subscribes to 51 channels, Then the 51st returns `subscribe_error{code:"subscription_limit"}`.
- **Version**: V1 · **Size**: M

---

### P-22 — Event catalogue and envelope

- **Behaviour**: Every server→client message is one envelope:

```json
{
  "id":  "01K4S9ZC0F8V7Q2R3T5Y6M8N9P",
  "seq": 1487,
  "channel": "order:6b1f…",
  "type": "order.state_changed",
  "v": 1,
  "ts": "2026-08-10T14:03:11.412Z",
  "data": { }
}
```
  `id` is a ULID. `seq` is a **per-channel monotonic int64** allocated by Postgres (`channel_cursor`), which is what makes gap detection and replay possible. `v` is the payload schema version; a client that does not understand `v` ignores the event rather than crashing. Control frames (`hello`, `pong`, `error`, `subscribed`, `unsubscribed`, `resume_complete`) carry `seq: 0` and no channel.

  **The complete catalogue.** Every event, its channels, its audience, and its payload.

  **Control (connection-scoped, no channel)**

  | Type | Payload |
  |---|---|
  | `hello` | `{account_id, roles:[{r,s}], session_id, allowed_channels:[…], server_time, heartbeat_s:25, protocol:1}` |
  | `subscribed` | `{channel, cursor_seq}` |
  | `unsubscribed` | `{channel, reason}` |
  | `subscribe_error` | `{channel, code, message}` |
  | `resume_complete` | `{channel, from_seq, to_seq, replayed, truncated}` |
  | `ping` / `pong` | `{t}` |
  | `error` | `{code, message, retryable}` |
  | `reauth_required` | `{deadline}` |

  **Order (channel `order:{id}`)**

  | Type | Audience | Payload |
  |---|---|---|
  | `order.created` | customer | `{order_id, code, state, restaurant:{id,name}, total_cents, currency, placed_at, deadline_at}` |
  | `order.state_changed` | all participants | `{order_id, from, to, at, reason, actor_kind, deadline_at, eta_at}` |
  | `order.eta_updated` | customer, restaurant | `{order_id, pickup_eta_at, dropoff_eta_at, source}` |
  | `order.items_adjusted` | customer, restaurant | `{order_id, removed:[{line_no,name,qty}], new_total_cents, new_quote_id}` |
  | `order.cancelled` | all | `{order_id, reason_code, by, refund:{kind, amount_cents, state}}` |
  | `order.completed` | customer, restaurant, rider | `{order_id, delivered_at, receipt_url}` |
  | `order.note_added` | restaurant, rider, support | `{order_id, author_kind, text, at}` |

  **Payment (channel `order:{id}` for the customer; `account:{id}` for out-of-order charges)**

  | Type | Audience | Payload |
  |---|---|---|
  | `payment.authorized` | customer | `{order_id, amount_cents, card:{brand,last4}}` |
  | `payment.action_required` | customer | `{order_id, client_secret, expires_at}` |
  | `payment.captured` | customer | `{order_id, amount_cents, captured_at}` |
  | `payment.failed` | customer | `{order_id, code, decline_code, message, retryable}` |
  | `refund.created` | customer | `{order_id, refund_id, amount_cents, reason_code, state}` |
  | `refund.settled` | customer | `{order_id, refund_id, amount_cents, settled_at}` |
  | `refund.failed` | customer, support | `{order_id, refund_id, message}` |

  **Restaurant (channel `restaurant:{id}`)**

  | Type | Payload |
  |---|---|
  | `restaurant.order_offered` | `{order_id, code, expires_at, deadline_at, customer_first_name, lines:[{name,variant,addons,qty,note}], subtotal_cents, total_cents, prep_eta_suggestion_min, fulfilment}` |
  | `restaurant.order_offer_expired` | `{order_id, reason:"timeout"}` |
  | `restaurant.order_offer_withdrawn` | `{order_id, reason:"customer_cancelled"|"payment_failed"}` |
  | `restaurant.order_accepted` | `{order_id, accepted_by, prep_eta_minutes}` (fan-out to the restaurant's other tablets) |
  | `restaurant.order_rejected` | `{order_id, rejected_by, reason_code}` |
  | `restaurant.status_changed` | `{restaurant_id, is_accepting_orders, is_open, reason, changed_by}` |
  | `restaurant.payout_updated` | `{payout_id, state, amount_cents, period}` |

  **Dispatch / rider (channel `rider:{account_id}` for offers; `order:{id}` for progress)**

  | Type | Audience | Payload |
  |---|---|---|
  | `dispatch.offer` | rider | `{order_id, offer_id, expires_at, pickup:{restaurant_name, address_short, lat, lng}, dropoff:{area, lat, lng}, distance_m, est_duration_s, earnings_cents, tip_cents_estimate, items_count}` |
  | `dispatch.offer_withdrawn` | rider | `{order_id, offer_id, reason:"taken"|"expired"|"cancelled"}` |
  | `dispatch.assigned` | customer, restaurant, rider | `{order_id, rider:{first_name, photo_url, vehicle_type, rating_avg}, pickup_eta_at}` |
  | `dispatch.unassigned` | customer, restaurant, rider | `{order_id, reason}` |
  | `dispatch.state_changed` | customer, restaurant, rider | `{order_id, from, to, at}` |
  | `rider.location` | customer, restaurant (coarse), support | `{order_id, lat, lng, heading_deg, speed_mps, accuracy_m, recorded_at}` |
  | `rider.availability_changed` | rider, admin | `{account_id, is_online, at}` |
  | `rider.earnings_updated` | rider | `{account_id, period, earnings_cents, deliveries}` |

  **Account / onboarding (channel `account:{id}`)**

  | Type | Payload |
  |---|---|
  | `account.security_event` | `{kind:"new_device_login"|"password_changed"|"session_revoked", at, ip_city}` |
  | `document.review_state_changed` | `{document_id, doc_type, state, reason, reviewed_at}` |
  | `onboarding.state_changed` | `{subject_type, subject_id, from, to, next_action}` |
  | `connect.requirements_changed` | `{currently_due:[…], past_due:[…], payouts_enabled, deadline}` |
  | `notification.created` | `{notification_id, kind, title, body, deep_link, created_at}` |
  | `notification.read` | `{notification_id, read_at}` |

  **Admin (channel `admin:ops`)**

  | Type | Payload |
  |---|---|
  | `admin.alert` | `{severity, kind, subject_type, subject_id, message, at}` |
  | `admin.dispatch_failure` | `{order_id, waves, riders_offered, radius_m}` |
  | `admin.reconciliation_exception` | `{kind, order_id, expected_cents, actual_cents}` |
  | `admin.queue_depth` | `{pending_restaurant_reviews, pending_rider_reviews, open_disputes, failed_refunds}` |

  Payload schemas are generated from Go structs into a versioned JSON-Schema bundle served at `GET /v1/realtime/schema` and consumed by the generated TypeScript client, so a field rename cannot silently break four apps (which is exactly how the old `CHANNEL_JOIN`-wrapped-in-`order_request` mess arose, §7.16).

- **Data**:

```sql
CREATE TABLE channel_cursor (
  channel text PRIMARY KEY,
  last_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE realtime_event (
  id uuid PRIMARY KEY,                    -- uuidv7
  ulid text NOT NULL,
  channel text NOT NULL,
  seq bigint NOT NULL,
  type text NOT NULL,
  v int NOT NULL DEFAULT 1,
  audience text[] NOT NULL,               -- role kinds allowed to receive this event
  payload jsonb NOT NULL,                 -- unprojected; projection happens at send time
  order_id uuid, account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX realtime_event_channel_seq ON realtime_event(channel, seq);
CREATE INDEX realtime_event_created ON realtime_event(created_at);
```
  Retention: 7 days, dropped by a daily partition-drop (`realtime_event` is `PARTITION BY RANGE (created_at)`, one partition per day).

- **Rules & invariants**:
  - **I-22.1** `seq` is strictly increasing and gapless per channel, allocated inside the same transaction as the state change that caused the event.
  - **I-22.2** Every event type in the catalogue has a Go struct, a JSON-Schema entry and at least one integration test that observes it end-to-end. A test enumerates the catalogue and fails on any type with no producer or no test (the "every write has a reader" check).
  - **I-22.3** No event payload contains a raw customer phone number, a full address for an unauthorised audience, a card number, a token, or any monetary value not sourced from the order/quote.
  - **I-22.4** `rider.location` is throttled to at most one event per 5 s per order and is only published while the order is in `PICKED_UP`/`ARRIVED` or dispatch is `ASSIGNED`+.
- **Acceptance criteria**:
  1. Given the catalogue test, When it runs, Then every listed type is produced by at least one integration scenario and validated against its schema.
  2. Given an order progresses from creation to completion, Then the customer's socket observes a strictly increasing `seq` with no gaps.
  3. Given a `rider.location` event, When received on a restaurant socket, Then coordinates are rounded to ~100 m and no customer address is present.
  4. Given a payload field is renamed in Go, When CI runs, Then the schema-diff gate fails unless `v` is incremented and the old version is still emitted for the deprecation window.
- **Version**: V1 · **Size**: L

---

### P-23 — Delivery guarantees, replay and multi-replica fan-out

- **Behaviour**: **At-least-once, ordered per channel, deduplicated by the client on `id`.**

  Publish path — the transactional outbox, so an event can never exist without its state change and vice versa:
  1. A handler mutates state and, **in the same transaction**, allocates `seq` (`UPDATE channel_cursor … RETURNING last_seq+1`) and inserts `realtime_event` + `outbox_message`.
  2. A relay goroutine reads unpublished `outbox_message` rows with `FOR UPDATE SKIP LOCKED`, publishes to Redis `PUBLISH rt:{channel}` and marks them published.
  3. Every API replica subscribes to `rt:*` via a single Redis pub/sub connection and delivers to its local sockets, applying the per-role projection.

  **Redis pub/sub is fan-out only.** If Redis is down or flushed: the relay backs off and retries; events accumulate in `outbox_message`; clients see no live updates but the REST tracking endpoint is unaffected; when Redis returns, the backlog publishes and every client's `resume` fills the gap. **No event is lost, no state is wrong.** If a replica misses a pub/sub message entirely (pub/sub has no delivery guarantee), the client's gap detection recovers it.

  **Gap detection and replay** — the client's contract:
  - It tracks `last_seq` per channel.
  - On any received event with `seq > last_seq + 1`, or on reconnect, it sends `resume {channel, after_seq}`.
  - The server replays from `realtime_event` (Postgres) in `seq` order, up to 1000 events, then sends `resume_complete{from_seq, to_seq, replayed, truncated}`.
  - `truncated: true` (gap older than 7 days, or more than 1000 events) instructs the client to **refetch the resource over REST** and reset its cursor — the always-correct fallback.
  - `subscribed{cursor_seq}` gives the current head so a fresh subscriber knows where it starts.

  This replaces the old destructive offline queue, where reading queued notifications deleted them and an impersonated socket could permanently consume another user's messages (B83). Replay here is a **read** of an immutable table; it is non-destructive and idempotent, and any number of clients can replay the same range.

- **Data**:

```sql
CREATE TABLE outbox_message (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                     -- 'REALTIME' | 'NOTIFICATION' | 'STRIPE' | 'AUDIT_SINK'
  channel text,
  realtime_event_id uuid,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  published_at timestamptz,
  last_error text,
  lease_until timestamptz, lease_owner text
);
CREATE INDEX outbox_pending ON outbox_message(available_at) WHERE published_at IS NULL;
```
  Redis: `rt:{channel}` pub/sub channels (no persistence), `ws:chan:{channel}` routing hints. Rebuild source for both: `realtime_event` + live connections.

- **Rules & invariants**:
  - **I-23.1** An event exists in `realtime_event` if and only if the state change that produced it committed. Same transaction, no exceptions.
  - **I-23.2** Publishing is at-least-once; clients must be idempotent on `id`. The client SDK enforces this with a bounded LRU of seen ids.
  - **I-23.3** Ordering is guaranteed per channel by `seq`, not by arrival time.
  - **I-23.4** Replay is non-destructive; the same range may be replayed any number of times with identical results.
  - **I-23.5** Outbox lag p99 < 500 ms; > 30 s pages on-call. Depth of unpublished messages is a first-class metric.
  - **I-23.6** `FLUSHALL` on Redis during an active order loses zero events; a chaos test asserts the client's final observed event set is complete after resume.
- **Acceptance criteria**:
  1. Given a customer's app is backgrounded for 3 minutes across 6 state changes, When it reconnects and resumes, Then it receives exactly those 6 events in order and `resume_complete.replayed = 6`.
  2. Given Redis is flushed mid-order, Then no event is lost: after reconnection the client's event set equals the server's `realtime_event` rows for that channel.
  3. Given three API replicas and one customer socket, When an event is published, Then the customer receives it exactly once (dedup by `id` covers the duplicate-delivery case).
  4. Given a client resumes from a seq 8 days old, Then `truncated: true` is returned and the client refetches over REST.
  5. Given the outbox relay is stopped for 10 minutes, When restarted, Then all pending events publish in `seq` order and no `realtime_event` row lacks a corresponding published outbox row.
- **Version**: V1 · **Size**: L

---

# 7. Notifications

### P-24 — Notification router: which event, which role, which channel

- **Behaviour**: One router consumes domain events from the outbox and decides, per (event, recipient role), which delivery channels to use. Channels: `REALTIME` (P-23), `PUSH` (Expo), `SMS`, `EMAIL`, `INAPP` (a persisted, listable inbox). A notification is a **row first** (`notification` in Postgres) and a delivery attempt second — so an offline user's notifications are never "queued in Redis and destroyed on read" (B83); they are simply rows they have not read yet.

  **The matrix.** `RT` = realtime socket, `P` = push, `S` = SMS, `E` = email, `I` = in-app inbox. Bracketed = only on fallback.

  | Event | Customer | Restaurant | Rider | Admin/Support |
  |---|---|---|---|---|
  | OTP code | S | — | S | — |
  | Email verification / password reset | — | E | — | E |
  | New-device login / password changed | P, E | E | P, E | E |
  | `order.created` / `payment.authorized` | RT, I | — | — | — |
  | `payment.action_required` | RT, P | — | — | — |
  | `restaurant.order_offered` | — | **RT, P, [S after 60 s], [voice call after 120 s]** | — | — |
  | `order.state_changed → PREPARING` (accepted) | RT, P, I | RT, I | — | — |
  | `order.state_changed → REJECTED` / timeout cancel | RT, P, E, I | RT, I | — | [admin.alert] |
  | `dispatch.offer` | — | — | **RT, P (high priority, sound, TTL 30 s)** | — |
  | `dispatch.assigned` | RT, P, I | RT, I | RT, I | — |
  | `order.state_changed → READY_FOR_PICKUP` | RT, I | RT, I | RT, P | — |
  | `order.state_changed → PICKED_UP` | RT, P, I | RT, I | RT, I | — |
  | `order.state_changed → ARRIVED` | RT, P, I | — | RT, I | — |
  | `order.state_changed → DELIVERED` | RT, P, E (receipt), I | RT, I | RT, P, I | — |
  | `order.cancelled` (any) | RT, P, E, I | RT, P, I | RT, P, I | RT |
  | `refund.created` / `refund.settled` | RT, P, E, I | RT, I (if charged back) | — | — |
  | `refund.failed` | — | — | — | **RT, E, page** |
  | `document.review_state_changed` | — | P, E, I | — (only the application decision notifies a rider: [one message per review](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) | — |
  | `onboarding.state_changed` | — | E, I | P, I | — |
  | Paused rider reinstated ([reinstatement notice](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) | — | — | P, I | — |
  | `connect.requirements_changed` / `payouts_enabled=false` | — | P, E, I | P, E, I | RT |
  | `payout.paid` / `payout.failed` | — | E, I | P, E, I | RT (on failed) |
  | `chargeback.created` | — | E, I | — | RT, E |
  | Dispatch failure / reconciliation exception / queue depth | — | — | — | RT, E, page |
  | Marketing / promotions | P, E (**opt-in only**) | E (opt-in) | — | — |

  **Fallback ladder**: try `REALTIME` if the recipient has a live socket for the relevant channel; if the notification is marked `must_reach` and no realtime **acknowledgement** arrives within its `ack_window`, escalate to `PUSH`; if no push receipt within the window, escalate to `SMS`; `EMAIL` is always sent for its listed events regardless of socket state (receipts, security, payouts are records, not alerts). `INAPP` rows are always written for anything a user should be able to find later.

  `must_reach` notifications (the only ones that escalate to SMS): OTP, `restaurant.order_offered`, `dispatch.offer`, `order.cancelled` for the customer, `payouts_enabled=false`.

  **Acknowledgement**: realtime delivery is only counted as delivered when the client sends back an `ack {notification_id}`; push counts as delivered on an Expo receipt of `ok`. This closes the old gap where "connected" meant "seen in the last 5 minutes" and a stale socket silently swallowed an order offer.

  **Quiet hours** 22:00–08:00 in the recipient's timezone suppress `PUSH` and `SMS` for non-transactional notifications only; transactional and `must_reach` always send. **CASL** (Canada's Anti-Spam Legislation) governs marketing: express opt-in recorded with timestamp, source and IP; every commercial message carries the sender identification and a one-click unsubscribe honoured within 10 business days (we honour immediately); `customer_profile.marketing_consent_at` gates every marketing send and a withdrawal is a hard stop.

  **Deduplication and grouping**: `notification.dedupe_key` (e.g. `order:{id}:state:PREPARING`) is unique per recipient, so a retried event produces one notification. `group_key` (e.g. `order:{id}`) lets a whole group be dismissed when the order is taken — the rider whose offer was won gets the group removed rather than a stale badge.

- **Data**:

```sql
CREATE TABLE notification (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(id),
  role_context text NOT NULL,             -- 'CUSTOMER'|'RESTAURANT'|'RIDER'|'ADMIN'
  kind text NOT NULL,                     -- maps to the matrix row
  dedupe_key text, group_key text,
  title text NOT NULL, body text NOT NULL, deep_link text,
  data jsonb NOT NULL DEFAULT '{}',
  priority text NOT NULL DEFAULT 'NORMAL',-- 'CRITICAL'|'HIGH'|'NORMAL'|'LOW'
  must_reach boolean NOT NULL DEFAULT false,
  ack_window_s int NOT NULL DEFAULT 60,
  order_id uuid, restaurant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz, dismissed_at timestamptz,
  deadline_at timestamptz, deadline_action text, escalation_step int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX notification_dedupe ON notification(account_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_inbox ON notification(account_id, created_at DESC) WHERE dismissed_at IS NULL;

CREATE TABLE notification_delivery (
  id bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notification(id),
  channel text NOT NULL,                  -- 'REALTIME'|'PUSH'|'SMS'|'EMAIL'
  target text NOT NULL,                   -- device token id, phone, email (hashed in logs)
  provider text, provider_message_id text,
  state text NOT NULL,                    -- 'QUEUED'|'SENT'|'DELIVERED'|'ACKED'|'FAILED'|'SUPPRESSED'
  attempts int NOT NULL DEFAULT 0, error_code text, error_message text,
  cost_cents bigint,
  queued_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, settled_at timestamptz
);
```
  Redis (**disposable**): `notif:throttle:{account}:{kind}` (TTL 60 s) to suppress bursts, `notif:ack:{notification_id}` (TTL = ack window) as a fast ack signal. Both rebuild from `notification_delivery`. Losing them causes at most a duplicate push, never a lost notification.

- **Rules & invariants**:
  - **I-24.1** Reading the inbox is non-destructive. There is no code path that deletes a notification on read.
  - **I-24.2** Every notification has at least one `notification_delivery` row per attempted channel with a terminal state; a notification with no terminal delivery after its deadline is an alert.
  - **I-24.3** A `must_reach` notification that reaches `FAILED` on every channel raises an ops alert; it is never silently dropped.
  - **I-24.4** No marketing message is sent without a `marketing_consent_at` and a working unsubscribe link.
  - **I-24.5** No notification body contains an OTP code except the OTP SMS itself, and no notification body contains a full address, card details or a token.
  - **I-24.6** Every notification kind in the matrix has a producer and a template in both `en-CA` and `fr-CA`.
- **Acceptance criteria**:
  1. Given a restaurant with no live socket and no push token, When an order is offered, Then an SMS is sent within 60 s and `notification_delivery` records the escalation chain RT→P→S.
  2. Given a customer reads their inbox twice, Then both reads return the same notifications and none are deleted. (Old system: the second reader got nothing.)
  3. Given the same order-accepted event is processed twice, Then exactly one notification exists (dedupe key) and at most one push is sent.
  4. Given a rider wins an offer, Then the other riders' offer notifications are dismissed by `group_key` and their devices' badges clear.
  5. Given a marketing send to a customer without consent, Then it is `SUPPRESSED` with reason `no_consent` and a test asserts zero provider calls.
  6. Given quiet hours, When a transactional "your order is here" fires at 23:40, Then it is still delivered.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — restaurant offer escalation**: Should an unanswered order offer escalate to SMS and then an automated voice call? · **Proposed default**: SMS at 60 s, automated voice call at 120 s (before the 180 s expiry). · **Why**: a missed offer is a lost paid order and a bad customer experience; a kitchen tablet asleep is the single most common cause.

---

### P-25 — Push notifications (Expo)

> **2026-10-01:** [The self-hosted, open-source rule](../decisions/README.md#settled--platform-decisions-owner-2026-10-01) allows Apple and Google push services. Expo Push is a hosted relay in front of them and is not on the exception list. Whether it stays is tracked in [#199](https://github.com/shaiknoorullah/hg-mono/issues/199).

- **Behaviour**: Expo Push (`https://exp.host/--/api/v2/push/send`) fronts both FCM and APNs, which matches the Expo SDK 53 apps. Tokens are registered by the app after an explicit permission prompt and are bound to `(account_id, device_id, role_context)`.

  `POST /v1/devices` `{expo_push_token, device_id, platform, app_version, os_version, locale}` — upsert on `(account_id, device_id)`. `DELETE /v1/devices/{device_id}` on logout. **Logout always deletes the token**, so a shared phone never receives the previous user's orders.

  Send: batched up to 100 messages per request, with `to`, `title`, `body`, `data` (deep link + ids), `sound` (`default` for HIGH/CRITICAL), `priority: 'high'` for CRITICAL/HIGH, `ttl` (30 s for `dispatch.offer`, 300 s otherwise), `channelId` (Android channel `orders` / `offers` / `account`), `badge`, and `categoryId` for iOS actions (Accept/Decline on offers).

  Receipts: Expo returns ticket ids; a follow-up job fetches receipts and maps errors — `DeviceNotRegistered` deletes the token, `MessageTooBig`/`InvalidCredentials` alert, `MessageRateExceeded` backs off. This is the only way `notification_delivery` reaches a truthful terminal state.

  iOS critical path: order offers for riders use a time-sensitive interruption level; the app requests the entitlement. Android uses a high-importance notification channel created at first launch.

- **Data**:

```sql
CREATE TABLE device (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account(id),
  device_id text NOT NULL,
  role_context text NOT NULL,
  expo_push_token text NOT NULL,
  platform text NOT NULL,                 -- 'ios'|'android'|'web'
  app_version text, os_version text, locale text NOT NULL DEFAULT 'en-CA',
  push_enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE UNIQUE INDEX device_unique ON device(account_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX device_token ON device(expo_push_token) WHERE revoked_at IS NULL;
```
  Redis: none required.

- **Rules & invariants**:
  - **I-25.1** A push token is never shared across accounts; registering a token already bound to another account revokes the old binding.
  - **I-25.2** Logout revokes the device row; a revoked device receives nothing.
  - **I-25.3** Every send has its receipt checked; `DeviceNotRegistered` prunes the token within one job cycle.
  - **I-25.4** `dispatch.offer` pushes carry `ttl ≤ 30 s` so a phone that wakes late never shows a dead offer.
- **Acceptance criteria**:
  1. Given a rider logs out and another rider logs in on the same phone, Then the first rider receives no further pushes on that device.
  2. Given Expo returns `DeviceNotRegistered`, Then the device row is revoked and no further sends target it.
  3. Given an offer push with TTL 30 s, When the phone comes online 60 s later, Then the push is not delivered and the in-app inbox shows the offer as expired.
- **Version**: V1 · **Size**: M

---

### P-26 — SMS and email

- **Behaviour**:
  - **SMS**: one provider behind a `SMSSender` interface (Twilio at launch; sign-in codes through Twilio Verify, as in the phone sign-in feature above), Canadian long code or toll-free number **registered for A2P/short-code compliance**, which is still open ([SMS registration](../decisions/README.md#open--blocking)); Canadian carriers require pre-registration for application-to-person traffic. Messages: OTP, `must_reach` escalations, critical account/security. Every SMS includes the brand name; no marketing SMS in V1. Per-message cost is recorded in `notification_delivery.cost_cents`, with a daily spend circuit breaker.
  - **Email**: one provider behind an `EmailSender` interface ([Resend](https://resend.com), on HalalGoes's Resend accounts: [email decision](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)) on a subdomain (`mail.halalgoes.com`) with **SPF, DKIM and DMARC** configured and a boot-time DNS probe that alerts if any is missing. Transactional and marketing streams are separated so a marketing complaint cannot damage transactional deliverability.
  - **Templates**: built with [React Email](https://react.email) and stored in the repo, exported to HTML + plaintext, versioned, rendered server-side, localised `en-CA` / `fr-CA`, with a golden-file test per template per locale. Admin-editable templates (`A37`) are V2 and, when added, are stored as `email_template` rows with a version history and a preview/approval step — never free-form HTML injected without sanitisation.
  - Required templates at launch: email verification, password reset, security alert, order receipt, order cancelled + refund, refund settled, restaurant application approved/rejected, rider application approved/rejected, payout statement, Connect requirements due, monthly commission invoice.

- **Data**: `notification_delivery` (P-24) carries provider ids and cost. `email_suppression (email, reason, at)` records bounces and complaints; a suppressed address is never emailed again for marketing and only for critical transactional mail.
  Redis: `sms:spend:{yyyymmdd}` (disposable; the authoritative spend figure is `SUM(cost_cents)` from Postgres).
- **Rules & invariants**:
  - **I-26.1** No provider credentials or message bodies containing OTPs are logged.
  - **I-26.2** A hard bounce suppresses the address and raises the account's `email_verified_at` to NULL for restaurant/admin accounts (they must re-verify).
  - **I-26.3** Both providers are behind interfaces with a `NoopSender` used in tests; no test ever hits a live provider.
  - **I-26.4** Boot probe verifies SPF/DKIM/DMARC records and the SMS sender identity; failure alerts but does not block boot (except in production, where it blocks).
- **Acceptance criteria**:
  1. Given the templates, When the golden-file test runs, Then every template renders in both locales with no unresolved variables.
  2. Given a hard bounce webhook, Then the address is suppressed and subsequent marketing sends are `SUPPRESSED`.
  3. Given the daily SMS budget is exceeded, Then non-OTP SMS is suppressed and an alert fires; OTP SMS continues.
- **Version**: V1 · **Size**: M

---

# 8. Files and documents (Silo object storage)

### P-27 — Bucket layout and private-by-default

- **Behaviour**: Five buckets, explicit policies, and a **boot-time probe that refuses to start if a private bucket is publicly readable or writable**. The old platform uploaded restaurant licences and halal certificates to a bucket that was world-readable *and* world-writable (R9), and the backend's own `FilesModule` was commented out with mismatched env var names (B93). Both failure modes are made impossible here: the module is mandatory, and the privacy probe is a boot gate.

  The store is [Silo](https://github.com/pgsty/silo), which keeps MinIO's S3 API ([object storage decision](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)). Every bucket is private, and neither the console nor the S3 API is reachable from the public internet ([#200](https://github.com/shaiknoorullah/hg-mono/issues/200)).

  | Bucket | Visibility | Contents | Versioning | Retention |
  |---|---|---|---|---|
  | `hg-kyc` | **private** | restaurant business licence, halal certificate, food-safety cert, owner ID; rider licence, vehicle registration, insurance, profile photo | on | 7 years after account closure |
  | `hg-pod` | **private** | proof-of-delivery photos and signatures | off | 90 days, then delete |
  | `hg-media` | **private**, read through presigned URLs | menu item photos, restaurant logos and covers, rider profile photos (the cropped public one) | off | lifetime of the entity |
  | `hg-exports` | **private** | admin CSV/PDF exports, payout statements, monthly invoices | off | 30 days |
  | `hg-tmp` | **private** | unconfirmed uploads | off | 24 h lifecycle rule |

  Object keys are server-generated and unguessable:
  ```
  hg-kyc/{subject_type}/{subject_id}/{doc_type}/{ulid}{ext}
  hg-pod/{yyyy}/{mm}/{order_id}/{ulid}.jpg
  hg-media/menu-item/{menu_item_id}/{ulid}_{variant}.webp
  ```
  Clients never choose a key, a bucket or a filename.

  **Boot probe** (`G-7`): for each private bucket, the process (a) asserts the anonymous policy is `none` via the admin API, and (b) performs an unauthenticated `GET` of a canary object and asserts `403`, and (c) performs an unauthenticated `PUT` and asserts `403`. Any success ⟹ exit non-zero with a clear message. The probe result is exposed at `GET /internal/deps`.

  **Env var names** are asserted at boot against the compose file by a CI check that parses both — the exact class of bug that made MinIO unreachable before (`MINIO_ACCESS_SECRET` vs `MINIO_SECRET_KEY`).

- **Data**:

```sql
CREATE TABLE stored_object (
  id uuid PRIMARY KEY,
  bucket text NOT NULL, object_key text NOT NULL,
  purpose text NOT NULL,                  -- 'KYC_DOCUMENT'|'MENU_IMAGE'|'POD'|'EXPORT'|'AVATAR'
  owner_account_id uuid, restaurant_id uuid, order_id uuid,
  content_type text NOT NULL,
  byte_size bigint NOT NULL,
  sha256 bytea NOT NULL,
  state text NOT NULL,                    -- 'PENDING'|'READY'|'REJECTED'|'DELETED'
  reject_reason text,
  virus_scan_state text NOT NULL DEFAULT 'PENDING',
  uploaded_by uuid NOT NULL REFERENCES account(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz, deleted_at timestamptz,
  retention_until timestamptz,
  deadline_at timestamptz, deadline_action text
);
CREATE UNIQUE INDEX stored_object_key ON stored_object(bucket, object_key);

CREATE TABLE kyc_document (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL,             -- 'RESTAURANT'|'RIDER'
  subject_id uuid NOT NULL,
  doc_type text NOT NULL,                 -- 'BUSINESS_LICENCE'|'HALAL_CERTIFICATE'|'FOOD_SAFETY'|'OWNER_ID'|'DRIVERS_LICENCE'|'VEHICLE_REGISTRATION'|'INSURANCE'|'PROFILE_PHOTO'
  stored_object_id uuid NOT NULL REFERENCES stored_object(id),
  state text NOT NULL,                    -- 'SUBMITTED'|'IN_REVIEW'|'APPROVED'|'REJECTED'|'EXPIRED'|'SUPERSEDED'
  issuer text, certificate_number text, issued_on date, valid_until date,
  reviewed_by uuid, reviewed_at timestamptz, reject_reason text,
  deadline_at timestamptz, deadline_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyc_document_subject ON kyc_document(subject_type, subject_id, doc_type);
```
  Redis: none. Presigned URLs are generated on demand and never cached.

- **Rules & invariants**:
  - **I-27.1** No private bucket is anonymously readable or writable — asserted at boot and by a nightly probe.
  - **I-27.2** No client-supplied string ever becomes part of an object key; keys are ULID-based.
  - **I-27.3** Every object in a private bucket is reachable only through a presigned URL issued after an authorization check.
  - **I-27.4** `stored_object.state='READY'` requires a server-side verification of size, content type and SHA-256.
- **Acceptance criteria**:
  1. Given the anonymous policy on `hg-kyc` is set to `download`, When the binary starts, Then it exits non-zero naming the bucket.
  2. Given a KYC object key, When fetched without a presigned signature, Then Silo returns 403.
  3. Given a compose file whose MinIO secret var is renamed, When CI runs, Then the env-name consistency check fails.
- **Version**: V1 · **Size**: M

---

### P-28 — Presigned upload and download

- **Behaviour**: **Three-call upload**, with the server in control of everything except the bytes.

  1. `POST /v1/uploads` `{purpose, content_type, byte_size, sha256}` →
     server validates the purpose against the principal's role and against the per-purpose allowlist (below), allocates bucket + key, inserts `stored_object` in `PENDING` with `deadline_at = now() + 1 hour`, and returns a presigned `PUT` (TTL **300 s**) whose signature **binds `Content-Type` and `Content-Length`** so the client cannot upload something other than what it declared, plus the required `x-amz-checksum-sha256` header.
  2. Client `PUT`s the bytes directly to Silo.
  3. `POST /v1/uploads/{id}/confirm` → server `HEAD`s the object, verifies size, content type and checksum, sniffs magic bytes (a `.pdf` that is really a `.exe` is rejected), enqueues a virus scan for KYC uploads, and sets `state='READY'` (or `REJECTED` with a reason). Only a `READY` object may be attached to a `kyc_document` or a menu item.

  Unconfirmed objects are deleted by the deadline runner after 1 hour.

  **Per-purpose limits:**

  | Purpose | Types | Max size | Who may upload |
  |---|---|---|---|
  | `KYC_DOCUMENT` | `image/jpeg`, `image/png`, `image/heic`, `application/pdf` | 10 MiB | the subject's owner account |
  | `MENU_IMAGE` | `image/jpeg`, `image/png`, `image/webp` | 5 MiB | restaurant staff with `menu_item.update` |
  | `POD` | `image/jpeg` | 1 MiB (the rider app shrinks the photo before upload) | the assigned rider only, only while dispatch is `AT_CUSTOMER`/`CARRYING` |
  | `AVATAR` | `image/jpeg`, `image/png` | 2 MiB | the account itself |
  | `EXPORT` | server-generated only | — | no client uploads |

  **Download**: `GET /v1/documents/{kyc_document_id}/download-url` → ownership/permission check (`kyc_document.download`, always audited), returns a presigned `GET` with TTL **120 s**, `response-content-disposition: attachment`, and a single-use nonce recorded in the audit trail. A customer's view of a restaurant's halal certificate (`POST /v1/restaurants/{restaurantId}/certificate-url`) is a presigned `GET` with TTL **300 s**, issued per request and audited, as the contract has it. Media objects (`hg-media`) are private too and are read through presigned URLs ([#200](https://github.com/shaiknoorullah/hg-mono/issues/200)).

  **Image processing**: menu images are transcoded server-side to WebP at three sizes on confirm, EXIF stripped (including GPS), and the derived objects placed in `hg-media`; the original stays private in `hg-tmp` for 24 h. The old `fixImageUrl()` client hack that stripped malformed `host:0/path` URLs (R40) has no counterpart — URLs are built from a configured public base and validated by a test.

- **Data**: `stored_object`, `kyc_document` (P-27); `document_access_log` folds into `audit_event` (P-35).
- **Rules & invariants**:
  - **I-28.1** A presigned upload URL is bound to exactly one object key, content type and length; altering any of them invalidates the signature.
  - **I-28.2** No object is usable before `confirm` verifies the checksum server-side.
  - **I-28.3** Presigned download URLs expire in ≤120 s for KYC documents and ≤300 s for a halal certificate view, and every issuance is audited with actor, subject and request id.
  - **I-28.4** A rider may upload a POD only for their own in-flight dispatch.
  - **I-28.5** EXIF GPS is stripped from every image before it enters `hg-media`.
- **Acceptance criteria**:
  1. Given an upload URL issued for `image/jpeg` at 1 MiB, When the client PUTs a 9 MiB PDF, Then Silo rejects the request on signature mismatch and `stored_object` stays `PENDING`.
  2. Given a confirmed upload whose bytes do not match the declared SHA-256, Then confirm returns 422 and the object is marked `REJECTED` and deleted.
  3. Given an admin fetches a KYC download URL, Then an audit row exists with the admin id, the document id and the request id, and the URL 403s after 120 s.
  4. Given a restaurant owner requests a download URL for another restaurant's document, Then 404 and no URL is issued.
  5. Given an upload is never confirmed, When 1 h passes, Then the object is deleted from Silo and the row is `DELETED`.
- **Version**: V1 · **Size**: L

---

### P-29 — Document lifecycle, review and retention

- **Behaviour**: A KYC document moves `SUBMITTED → IN_REVIEW → APPROVED | REJECTED`, with `EXPIRED` and `SUPERSEDED` as time/replacement outcomes. Review has a **72-hour SLA** carried on `kyc_document.deadline_at`; breach escalates to `admin:ops` and appears in `admin.queue_depth`.

  Halal certificates carry `valid_until`; a daily job moves expired certificates to `EXPIRED`, which flips the restaurant's `halal_status` (P-34) and removes it from every listing. Restaurants are warned at 30, 14, 7 and 1 days before expiry ([renewal reminders](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).

  Retention: KYC documents are kept **7 years** after the partner relationship ends (a defensible default for Canadian business records and CRA requirements), then deleted from Silo with a tombstone left in `stored_object`. POD photos are deleted at 90 days. A privacy request (PIPEDA access/deletion) produces an export of everything tied to the account and deletes what is not legally required to retain, replacing audit payloads with tombstones while preserving the hash chain (P-35).

- **Data**: `kyc_document`, `stored_object.retention_until`; `privacy_request (id, account_id, kind, state, requested_at, completed_at, export_object_id)`.
- **Rules & invariants**:
  - **I-29.1** A restaurant cannot reach `ACTIVE` without an `APPROVED`, unexpired halal certificate plus the other required document types.
  - **I-29.2** Approving or rejecting a document is always attributed to a real admin account (`reviewed_by NOT NULL`) — the old approve endpoint took `admin_id` from the request body with no auth (B96).
  - **I-29.3** Expiry is enforced by a job **and** by a read-time check, so a stale row never presents an expired certificate as valid.
  - **I-29.4** Deleted objects leave a tombstone row; the audit chain never loses an entry.
- **Acceptance criteria**:
  1. Given a halal certificate expires overnight, Then the restaurant's `halal_status` changes, it disappears from search and browse, and the owner is notified.
  2. Given a document is rejected with a reason, Then the partner sees the exact reason and can re-upload, creating a new document that `SUPERSEDES` the old one rather than mutating it.
  3. Given a review is untouched for 72 h, Then it escalates and appears in the admin queue-depth event.
  4. Given a PIPEDA deletion request, Then the account's KYC objects outside the legal retention window are deleted and the audit chain still verifies.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — KYC retention period**: How long are partner identity documents kept after the relationship ends? · **Proposed default**: 7 years, matching CRA business-record expectations, then hard delete. · **Why**: shorter risks non-compliance; longer increases breach exposure. Needs a privacy-counsel confirmation.

> **Decided:** on expiry the restaurant leaves every listing at once; only certified restaurants are listed ([self-declared listing](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

> **Open:** is the restaurant also suspended after 14 days expired?

---

# 9. Geo and dispatch primitives

### P-30 — Canonical geography schema (one column, no split brain)

- **Behaviour**: **There is exactly one location column per locatable entity, of type `geography(Point,4326)`, and it is `NOT NULL` wherever the entity is operational.** The old schema carried a legacy `location POINT` *and* a PostGIS `coords geometry(Point,4326)` on both `restaurant` and `rider`; `POST /restaurants` wrote one and dispatch read the other, so every checkout for a normally-onboarded restaurant died at rider assignment with "Restaurant location not found" (B16, §4.9). There is no migration path that keeps two columns: the rebuild has one.

  `geography` rather than `geometry` is deliberate: `ST_Distance` returns **metres** and `ST_DWithin` takes **metres**, on the spheroid. This deletes the `POINT <-> POINT × 111` degrees-to-kilometres approximation that mis-priced delivery fees and mis-ranked the feed (B31/B38).

  Address capture: the client types into a map search and drags the pin, then sends a structured address plus coordinates; the server geocodes/validates and **stores its own resolved point**, never the client's raw value alone. Address search, place details and reverse geocoding go through our API, which forwards to Mapbox and keeps the secret key on the server; map tiles also come from Mapbox ([map address search](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [#57](https://github.com/shaiknoorullah/hg-mono/issues/57)). `province` is derived from the resolved address and is what drives tax (P-11).

- **Data**:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE address (
  id uuid PRIMARY KEY,
  account_id uuid REFERENCES account(id),          -- NULL for restaurant addresses
  label text,                                       -- 'Home' | 'Work' | free text
  line1 text NOT NULL, line2 text,
  city text NOT NULL,
  province char(2) NOT NULL CHECK (province IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  postal_code text NOT NULL CHECK (postal_code ~ '^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$'),
  country char(2) NOT NULL DEFAULT 'CA' CHECK (country='CA'),
  location geography(Point,4326) NOT NULL,
  timezone text NOT NULL,
  buzzer text, unit text, delivery_notes text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX address_location_gix ON address USING GIST (location);
CREATE UNIQUE INDEX address_one_default ON address(account_id) WHERE is_default AND deleted_at IS NULL;

ALTER TABLE restaurant
  ADD COLUMN location geography(Point,4326),
  ADD COLUMN province char(2),
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Toronto',
  ADD COLUMN delivery_radius_m int NOT NULL DEFAULT 8000,
  ADD CONSTRAINT restaurant_active_needs_location
    CHECK (status <> 'ACTIVE' OR (location IS NOT NULL AND province IS NOT NULL));
CREATE INDEX restaurant_location_gix ON restaurant USING GIST (location);

CREATE TABLE rider_position (
  account_id uuid PRIMARY KEY REFERENCES account(id),
  location geography(Point,4326) NOT NULL,
  accuracy_m real, heading_deg real, speed_mps real,
  battery_pct int, is_moving boolean,
  recorded_at timestamptz NOT NULL,          -- device clock, clamped to server time ±5 min
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_position_gix ON rider_position USING GIST (location);
CREATE INDEX rider_position_fresh ON rider_position(received_at DESC);

CREATE TABLE rider_position_history (
  account_id uuid NOT NULL, order_id uuid,
  location geography(Point,4326) NOT NULL,
  accuracy_m real, heading_deg real, speed_mps real,
  recorded_at timestamptz NOT NULL
) PARTITION BY RANGE (recorded_at);
CREATE INDEX ON rider_position_history (order_id, recorded_at);
```

  Redis (**disposable**): `geo:riders:online` — a GEO set of online rider ids, `GEOADD geo:riders:online <lng> <lat> <account_id>` (longitude first; the old code swapped the arguments in one of two writers, B68). It is a **read accelerator only**: every dispatch query has a PostGIS path, and the PostGIS path is the one used for correctness. A `FLUSHALL` triggers a rebuild from `rider_position` on the next dispatch tick. Going offline `ZREM`s the member **and** clears `rider_profile.is_online` in Postgres in the same transaction; the Postgres flag is what the query filters on, so a stale Redis member can never cause an offline rider to be offered work (the old system's `zrem` was commented out — B69).

  Position ingestion: `POST /v1/riders/me/position` `{lat, lng, accuracy_m, heading_deg, speed_mps, recorded_at, order_id?}` at ≤1 Hz, batched up to 10 points per request. Writes `rider_position` (upsert) + `rider_position_history` (append, only while on an active dispatch) + optional `rider.location` realtime event throttled to 5 s.

- **Rules & invariants**:
  - **I-30.1** Exactly one location column per entity. A schema test asserts no table has more than one `geography`/`geometry`/`point` column, and that no column named `coords` exists.
  - **I-30.2** A restaurant cannot be `ACTIVE` without a location and a province — DB `CHECK`.
  - **I-30.3** Every `GEOADD` in the codebase is longitude-first; a unit test round-trips a known Toronto point through Redis and PostGIS and asserts they agree within 1 m.
  - **I-30.4** Dispatch never reads Redis without a PostGIS fallback, and correctness tests run with Redis disabled.
  - **I-30.5** Positions older than 90 s are not eligible for dispatch.
  - **I-30.6** `rider_position_history` is retained 30 days (payout distance evidence + dispute evidence), then partitions are dropped.
- **Acceptance criteria**:
  1. Given a restaurant created through the normal onboarding path, When dispatch searches for riders, Then the restaurant's location is present and the search succeeds — no manual location back-fill is possible or necessary.
  2. Given a rider goes offline, Then `rider_profile.is_online=false` and the Redis GEO member is removed in the same commit; When Redis is flushed and rebuilt, Then the offline rider is still absent.
  3. Given a known point (43.6532, −79.3832), When written through the rider position endpoint and read back from both Redis GEO and PostGIS, Then both return the same coordinates within 1 m.
  4. Given a migration that adds a second geometry column to `restaurant`, When CI runs, Then the schema test fails.
- **Version**: V1 · **Size**: M

---

### P-31 — Distance, duration and ETA

- **Behaviour**: Two distances, used for different things, never confused:
  - **Geodesic distance** — `ST_Distance(a, b)` on `geography`, in metres. Used for eligibility (delivery radius, rider search radius) and as the fallback for pricing.
  - **Route distance and duration** — from a self-hosted, open-source routing engine (engine not chosen yet) behind a `Router` interface; the Mapbox exception covers maps and address search, not routing ([self-hosted rule](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)). Used for delivery-fee `billable_km`, rider earnings distance, and ETA. Cached in `route_estimate` keyed by rounded origin/destination geohashes for 24 h, because the same restaurant→neighbourhood pair repeats constantly.
  - When the routing provider is unavailable, `billable_km = ceil(geodesic_m × 1.30 / 1000)` (a detour factor), the quote records `route_source='FALLBACK'`, and an alert fires. The fee is never silently zero and never derived from a degrees×111 approximation.

  **ETA** = `now + prep_eta_remaining + pickup_route_duration + handover_buffer + dropoff_route_duration`, recomputed on every relevant state change and on rider-position updates at most once per 30 s. Published as `order.eta_updated`. Each component is stored so a late delivery can be attributed.

- **Data**:

```sql
CREATE TABLE route_estimate (
  id uuid PRIMARY KEY,
  origin_geohash7 text NOT NULL, dest_geohash7 text NOT NULL,
  distance_m int NOT NULL, duration_s int NOT NULL,
  provider text NOT NULL, computed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX route_estimate_pair ON route_estimate(origin_geohash7, dest_geohash7);
```
  Redis: `route:{o7}:{d7}` (TTL 24 h) mirrors `route_estimate`. Disposable — a miss re-reads Postgres, then the provider.

- **Rules & invariants**:
  - **I-31.1** `billable_km` on a quote always has a recorded `route_source ∈ {ROUTED, CACHED, FALLBACK}`.
  - **I-31.2** Delivery distance is always measured to **the order's** delivery address, never the customer's default address.
  - **I-31.3** No distance computation uses a degrees-to-kilometres constant. Arch-lint bans the literal `111` in `internal/geo` and `internal/pricing`.
  - **I-31.4** Provider calls are rate-limited and budgeted; exceeding the budget switches to `FALLBACK` with an alert rather than failing checkout.
- **Acceptance criteria**:
  1. Given a quote to a non-default address, Then `billable_km` reflects that address; a regression test uses two addresses 12 km apart and asserts different fees.
  2. Given the routing provider returns 5xx, Then the quote still succeeds with `route_source='FALLBACK'` and an alert is recorded.
  3. Given a known Toronto pair, Then `ST_Distance` on `geography` returns metres within 0.5% of a reference value (no ÷111 anywhere).
- **Version**: V1 · **Size**: M

---

### P-32 — Rider search and offer

- **Behaviour**: Dispatch runs waves. Each wave selects candidates with **one PostGIS query** (Redis GEO may pre-filter, but the SQL is authoritative), offers to the top N simultaneously, and waits for the first acceptance.

```sql
-- $1 = restaurant location (geography), $2 = order_id, $3 = radius metres, $4 = limit
SELECT r.account_id,
       ST_Distance(p.location, $1) AS meters
  FROM rider_profile r
  JOIN rider_position p ON p.account_id = r.account_id
  JOIN account a        ON a.id = r.account_id
 WHERE r.approved_at IS NOT NULL
   AND r.is_online
   AND a.status = 'ACTIVE'
   AND p.received_at > now() - interval '90 seconds'
   AND ST_DWithin(p.location, $1, $3)
   AND NOT EXISTS (SELECT 1 FROM dispatch d
                    WHERE d.rider_account_id = r.account_id
                      AND d.state IN ('ASSIGNED','AT_RESTAURANT','CARRYING','AT_CUSTOMER'))
   AND NOT EXISTS (SELECT 1 FROM dispatch_offer o
                    WHERE o.rider_account_id = r.account_id
                      AND o.order_id = $2
                      AND o.outcome IN ('REJECTED','EXPIRED'))
 ORDER BY meters
 LIMIT $4;
```
  `ST_DWithin` on `geography` uses the GiST index. Waves: **3 000 m → 6 000 m → 10 000 m**, 20 s each, `LIMIT 8` per wave, offers broadcast **in parallel** (the old code looped riders sequentially, B71/B82). Exhausting all three waves sets `dispatch.state='NO_RIDER_FOUND'`, which arms the order's `READY_FOR_PICKUP` escalation (P-15) and raises `admin.dispatch_failure`.

  **Acceptance is a race resolved in Postgres**, not in a workflow signal:
```sql
UPDATE dispatch
   SET state='ASSIGNED', rider_account_id=$rider, assigned_at=now(),
       deadline_at=now()+interval '20 minutes', deadline_action='RIDER_NOT_ARRIVING'
 WHERE order_id=$order AND state IN ('SEARCHING','OFFERED') AND rider_account_id IS NULL
RETURNING *;
```
  Zero rows ⟹ `409 offer_taken`, and the losing rider receives `dispatch.offer_withdrawn{reason:"taken"}`. Exactly one rider can win, by construction.

  **Rejection is recorded** (`dispatch_offer.outcome='REJECTED'` with a reason from a fixed taxonomy: `TOO_FAR`, `TOO_LONG_WAIT`, `VEHICLE_UNSUITABLE`, `ENDING_SHIFT`, `OTHER`), so a rider is never re-offered the same order — the old `rejectOrder` only logged (B73).

- **Data**: `dispatch`, `dispatch_offer` (P-14). Redis `geo:riders:online` as a pre-filter only.
- **Rules & invariants**:
  - **I-32.1** Exactly one rider can be assigned to an order; guaranteed by the conditional `UPDATE`, not by application ordering.
  - **I-32.2** An offline, unapproved, suspended, busy or stale-position rider is never offered an order.
  - **I-32.3** A rider who rejected or let an offer expire is never re-offered the same order.
  - **I-32.4** Every offer has `expires_at`; expiry is driven by the deadline runner, not by a client timer.
  - **I-32.5** Dispatch produces a decision (assigned or `NO_RIDER_FOUND`) within a bounded time: 3 waves × 20 s + slack ≤ 90 s.
- **Acceptance criteria**:
  1. Given 8 riders offered one order and all 8 accept within 50 ms, Then exactly one `dispatch.rider_account_id` is set, the other 7 receive 409 and `dispatch.offer_withdrawn`, and no duplicate assignment exists.
  2. Given a rider goes offline mid-search, Then they receive no offer in the next wave even if Redis still lists them.
  3. Given no rider is found in 3 waves, Then `NO_RIDER_FOUND`, an `admin.dispatch_failure` event, and the order's escalation ladder begins — the order never sits silently.
  4. Given a rider rejects with `TOO_FAR`, Then the rejection is persisted with its reason and the rider is excluded from later waves for that order.
- **Version**: V1 · **Size**: L

> **DECISION REQUIRED — offer strategy**: Broadcast to the nearest N simultaneously, or offer sequentially to the single best rider? · **Proposed default**: broadcast to 8 per wave with a 30 s offer TTL. · **Why**: sequential offers were the old design and produce unacceptable time-to-assign at low rider density; broadcast plus a database-resolved race is simpler and faster.

---

# 10. Search and discovery

### P-33 — Restaurant and dish search

- **Behaviour**: Postgres-native. `tsvector` full-text for meaning, `pg_trgm` for typos, blended and re-ranked by distance and quality. No Elasticsearch in V1, and **no Redis-cached result objects** — the old cache wrote a JS object through a string-typed `set` and returned the literal `[object Object]`, with a cache key that ignored user, page and limit and a `.replace(' ','_')` that replaced only the first space (B32).

  `GET /v1/search?q=&lat=&lng=&…` returns two blocks: restaurants and dishes. Query construction:
  ```sql
  WITH q AS (SELECT websearch_to_tsquery('english', unaccent($1)) AS tsq, unaccent(lower($1)) AS raw)
  SELECT r.id,
         ts_rank_cd(r.search_tsv, q.tsq)                       AS text_rank,
         similarity(unaccent(lower(r.name)), q.raw)            AS trgm_rank,
         ST_Distance(r.location, $2)                            AS meters
    FROM restaurant r, q
   WHERE r.status='ACTIVE'
     AND ST_DWithin(r.location, $2, $3)
     AND (r.search_tsv @@ q.tsq OR unaccent(lower(r.name)) % q.raw)
   ORDER BY (0.55*ts_rank_cd(r.search_tsv, q.tsq)
           + 0.25*similarity(unaccent(lower(r.name)), q.raw)
           + 0.20*exp(-ST_Distance(r.location,$2)/5000.0)) DESC
   LIMIT $4 OFFSET $5;
  ```
  with
  ```sql
  ALTER TABLE restaurant ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', unaccent(coalesce(name,''))), 'A') ||
      setweight(to_tsvector('english', unaccent(coalesce(cuisine_text,''))), 'B') ||
      setweight(to_tsvector('english', unaccent(coalesce(tags_text,''))), 'C') ||
      setweight(to_tsvector('english', unaccent(coalesce(description,''))), 'D')
  ) STORED;
  CREATE INDEX restaurant_tsv_gin  ON restaurant USING GIN (search_tsv);
  CREATE INDEX restaurant_name_trgm ON restaurant USING GIN (name gin_trgm_ops);
  ```
  and the equivalent on `menu_item` (name A, description B, category/cuisine C), with dish results always carrying their restaurant so a dish hit is actionable.

  Empty query (`q` absent) = **browse**, which is the discovery feed: nearby, open now, trending (orders in the last 7 days, decayed), new, order-again (the requester's past restaurants), and per-cuisine rails. All radii, windows and rail sizes come from `discovery_config`, not from constants (the old feed hardcoded 10 km / 3 months / top 8/10/6 — B31).

  Pagination is **keyset** (`after` cursor encoding the sort tuple), not offset, for stable paging.

- **Data**: generated `search_tsv` columns; `discovery_config`; `search_query_log (id, account_id, q, filters jsonb, result_count, clicked_result_id, at)` for future ranking work and zero-result monitoring.
  Redis: optional `search:v1:{sha256(normalized_query_json)}` with a 60 s TTL storing **JSON-serialized, schema-versioned** results including a `schema_v` field; a mismatch or parse error is treated as a miss. The key includes every input: q, lat/lng rounded to geohash7, all filters, sort, page cursor, and the requesting account's id when personalised. Disposable by construction.

- **Rules & invariants**:
  - **I-33.1** No cache key omits any input that changes the result. A test enumerates the request struct's fields and asserts each participates in the key.
  - **I-33.2** Cached values are typed JSON with a schema version; a `[object Object]`-style value is impossible because the cache API accepts only `encoding/json`-marshalled typed values.
  - **I-33.3** Search never returns a non-`ACTIVE` restaurant, a soft-deleted item, or an item from a restaurant outside its delivery radius of the query point.
  - **I-33.4** Query validation: `q` is optional; if present it must be 1–128 characters after trimming. `page_size` is 1–50, `NaN`/absent falls back to the default. (The old validator's message said "greater than 3 characters" while the check was `<= 3`, and NaN passed silently.)
  - **I-33.5** p95 search latency < 250 ms at 100k menu items with a cold cache.
- **Acceptance criteria**:
  1. Given two users search the same term at different locations, Then they get different, correctly-ordered results — a cross-user cache collision is impossible.
  2. Given a search for "biriyani" (misspelt), Then "Chicken Biryani" is returned via trigram similarity.
  3. Given a two-word query with multiple spaces, Then the cache key is stable and correct and page 2 differs from page 1.
  4. Given Redis is flushed mid-session, Then results are identical, only slower.
  5. Given a restaurant is suspended, Then it disappears from search within one cache TTL (≤60 s) and immediately on a cache miss.
- **Version**: V1 · **Size**: L

---

### P-34 — Filters and halal certification

- **Behaviour**: Filters are a typed struct, validated at the boundary, each mapping to an indexed predicate:

  | Filter | Predicate |
  |---|---|
  | no `halal` filter: halal is a precondition for listing, and the contract has no such parameter | `restaurant.halal_status` is always applied |
  | `certifier_ids[]` | the approved certificate's issuing authority |
  | `cuisine_ids[]` | join on restaurant cuisines |
  | `open_now` | trading-hours window evaluated in the restaurant's timezone **and** `is_accepting_orders` |
  | `max_delivery_minutes` | ETA estimate from route + prep |
  | `price_band` (`$`–`$$$$`) | restaurant median item price bucket |
  | `min_rating` | `rating_avg >= x AND rating_count >= 5` |
  | `dietary[]` (`VEGETARIAN`, `VEGAN`, `GLUTEN_FREE`, `NO_ALCOHOL_SERVED`) | item/restaurant flags |
  | `max_distance_m` | `ST_DWithin` |
  | `free_delivery` | promo availability |

  **Halal status is derived, never hand-set**:
  ```
  CERTIFIED       ⟺ ∃ kyc_document(doc_type='HALAL_CERTIFICATE', state='APPROVED', valid_until >= today)
  SELF_DECLARED   ⟺ the owner attested halal but no approved, unexpired certificate exists
  NOT_HALAL       ⟺ neither
  ```
  computed by a trigger on `kyc_document` plus a daily expiry sweep, and re-checked at read time. The restaurant page shows the certifying authority, the certificate number, the issue and expiry dates, and a link to the (redacted) certificate image — the platform's core promise made inspectable.

  **Listing rule**: only certified restaurants (including those expiring soon) are listed; self-declared and non-halal restaurants are hidden entirely and there is no way to relax this ([self-declared listing](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

- **Data**: `restaurant.halal_status` (derived), `halal_certifier (id, name, country, website, is_recognised, recognised_by_admin_id, notes)`, `kyc_document.issuer` FK to `halal_certifier`.
- **Rules & invariants**:
  - **I-34.1** `halal_status='CERTIFIED'` is impossible without an approved, unexpired certificate from a `is_recognised` certifier. Enforced by trigger + a nightly consistency check that must return zero rows.
  - **I-34.2** Search and browse exclude non-certified restaurants, always.
  - **I-34.3** The word "certified" never appears in any UI string for a `SELF_DECLARED` restaurant — a copy lint over the i18n bundles.
  - **I-34.4** Filter combinations are all index-backed; the query planner test asserts no sequential scan on `restaurant` or `menu_item` for any single-filter query at production data volume.
- **Acceptance criteria**:
  1. Given a restaurant whose certificate expired yesterday, Then it is absent from search and browse and its badge reads "Certification expired".
  2. Given self-declared and non-halal restaurants near the customer, Then none of them appears in any search or browse result.
  3. Given `open_now` at 02:00 in Toronto for a restaurant whose hours are 11:00–22:00 America/Toronto, Then it is excluded — hours are evaluated in the restaurant's timezone, not the server's.
  4. Given an admin marks a certifier as not recognised, Then every restaurant relying on it drops to `SELF_DECLARED` within the nightly sweep and owners are notified.
- **Version**: V1 · **Size**: M

> **Decided:** the three accepted Canadian bodies, in a seeded registry a super admin can extend ([accepted certifying bodies](../decisions/README.md#settled--client-decisions)).

> **Decided:** hidden entirely; no filter shows them ([self-declared listing](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

---

# 11. Audit log

### P-35 — Append-only audit trail

- **Behaviour**: Every privileged, money, identity, moderation or PII action writes one `audit_event` row **in the same transaction as the change it describes**. The old system had only `approved_by_admin_id` and `deleted_by` columns and no audit entity at all (B103), while admin endpoints took `admin_id` from the request body.

  **What is recorded** (non-exhaustive, but each of these is mandatory):
  - authentication: login success/failure, OTP issue/verify, session issue/refresh/revoke, refresh-token reuse, MFA enrol/disable, password change/reset;
  - authorization denials (`authz.denied`) with the required action and the subject;
  - every admin/support action: restaurant verify/reject/suspend/reinstate/ban, rider approve/reject, document approve/reject, KYC document download, user suspension/deletion, role grants and revocations, platform/pricing config changes, email-template changes;
  - money: quote → order creation, capture, refund request/approval/settlement, goodwill refunds, payout creation/execution/hold, ledger adjustments, chargeback handling;
  - order state transitions triggered by a human (system transitions live in `order_transition`, which the audit references rather than duplicates);
  - data access: any cross-tenant read (`*.read_any`), any export, any PII export;
  - configuration: feature flags, pricing config, tax rates, certifier list.

  **Immutability**: `REVOKE INSERT(…), UPDATE, DELETE ON audit_event FROM hg_app` except `INSERT`; a `BEFORE UPDATE OR DELETE` trigger raises `audit_is_append_only`. Each row carries `prev_hash` and `hash = sha256(prev_hash || canonical_json(row_without_hash))`, chained per UTC day with the day's head published to an append-only external sink (an S3 object with object-lock, or a signed daily digest emailed to the security contact). A `verify_audit_chain(date)` function walks a day and returns the first broken link.

  **Actor attribution** always comes from the verified session, never the body. `on_behalf_of_account_id` records support impersonation, which is a first-class, time-boxed, always-audited mode (`support.impersonate` action, max 30 min, banner shown in the UI, no money actions permitted while impersonating).

  **Retention**: money and KYC events **7 years**; security and authz events **24 months**; everything else **24 months**. Beyond retention, rows are not deleted but their `before`/`after` payloads are replaced with `{"redacted": true, "sha256": "…"}` so the hash chain still verifies. A PIPEDA deletion redacts payloads immediately for the requesting subject while preserving the chain.

- **Data**:

```sql
CREATE TABLE audit_event (
  id uuid PRIMARY KEY,                      -- uuidv7
  at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL,
  seq bigint NOT NULL,                       -- per-day monotonic
  actor_kind text NOT NULL,                  -- 'ACCOUNT'|'SYSTEM'|'WEBHOOK'|'JOB'
  actor_account_id uuid,
  actor_roles jsonb,
  on_behalf_of_account_id uuid,
  action text NOT NULL,                      -- 'restaurant.verify', 'refund.issue', …
  subject_type text NOT NULL, subject_id uuid,
  outcome text NOT NULL,                     -- 'SUCCESS'|'DENIED'|'FAILED'
  reason text,
  before jsonb, after jsonb,
  amount_cents bigint,                       -- set for money actions
  request_id text, session_id uuid, ip inet, user_agent text,
  prev_hash bytea NOT NULL, hash bytea NOT NULL
);
CREATE UNIQUE INDEX audit_event_day_seq ON audit_event(day, seq);
CREATE INDEX audit_event_subject ON audit_event(subject_type, subject_id, at DESC);
CREATE INDEX audit_event_actor ON audit_event(actor_account_id, at DESC);
CREATE INDEX audit_event_action ON audit_event(action, at DESC);
```
  Partitioned monthly by `at`. Redis: none — audit never touches Redis.

- **Rules & invariants**:
  - **I-35.1** Zero successful `UPDATE`/`DELETE` on `audit_event`, ever.
  - **I-35.2** The audit row and the change it describes commit together or not at all.
  - **I-35.3** Actor identity is derived from the session; a lint bans reading `admin_id`/`user_id` from a request body anywhere.
  - **I-35.4** `before`/`after` payloads never contain passwords, OTP codes, tokens, card data or full SINs (a redaction allowlist is applied at write time).
  - **I-35.5** `verify_audit_chain` passes for every day; a nightly job runs it and pages on failure.
  - **I-35.6** Every action in the mandatory list has a producing code path and a test that asserts the row exists.
- **Acceptance criteria**:
  1. Given an admin approves a restaurant, Then exactly one `audit_event` exists with `action='restaurant.verify'`, `actor_account_id` from the session, `before.status='DOCUMENTS_REVIEW'`, `after.status='ACTIVE'`, and the approval and the audit row share a transaction (verified by rolling back the approval and asserting no audit row).
  2. Given any attempt to update an audit row, Then the statement raises and the row is unchanged.
  3. Given a tampered row (direct superuser edit), When `verify_audit_chain` runs, Then it returns the exact offending `(day, seq)`.
  4. Given support impersonates a customer, Then every subsequent action carries `on_behalf_of_account_id`, and any money action is refused.
  5. Given a KYC document download, Then an audit row names the document, the admin and the request id.
- **Version**: V1 · **Size**: M

> **DECISION REQUIRED — audit retention**: 7 years for money/KYC and 24 months for the rest? · **Proposed default**: as specified, with payload redaction rather than row deletion at expiry. · **Why**: CRA and PIPEDA pull in opposite directions; redaction satisfies both while keeping the chain verifiable.

---

# 12. Boundary: validation, idempotency, rate limiting

### P-36 — Request validation and the response envelope

- **Behaviour**: Every endpoint has an explicit Go request struct and an explicit response struct. There is no path from raw JSON to a database write. The old backend typed handler bodies as erased TypeScript `Prisma.*Input` interfaces, so its one validation pipe was inert and every controller accepted arbitrary JSON — which is how mass-assignment of `is_approved` and `total_earnings` was possible (B9, B10).

  Decoding: `json.Decoder` with `DisallowUnknownFields()`. An unknown field is a **422**, not a silent drop — this is what catches `is_accepting` vs `isAccepting` (R32/B27) at the boundary instead of returning a cheerful 200 with an unchanged row.

  Validation layers, in order: (1) struct tags (`validate:"required,e164"`, `min`, `max`, `oneof`, `uuid4`, `dive`); (2) domain validators (postal code shape, province enum, opening < closing, quantity ≤ 99, enum membership for `delivery_instructions` — the old code wrote raw client strings straight into a Prisma enum array and threw whenever a chip was tapped, B42); (3) cross-field and referential checks in the handler.

  Errors are a single shape with per-field detail:
  ```json
  { "error": { "code": "validation_failed", "message": "Request could not be processed",
    "request_id": "01K4…",
    "details": [ {"field":"delivery_instructions[0]","code":"enum","message":"must be one of LEAVE_AT_DOOR, DO_NOT_RING_BELL, DO_NOT_CALL, MEET_AT_DOOR, MEET_IN_LOBBY"} ] } }
  ```

  Output: every 2xx is `{"data": …}` plus `{"meta": {…}}` for paginated collections (`{"next_cursor", "has_more", "total?"}`). Never a bare array. Pagination is keyset by default; `limit` is 1–100, default 20; a non-numeric `limit` is a 422, not a silent NaN.

  **Mass-assignment protection** is structural: request structs contain only client-settable fields. `is_approved`, `status`, `total_earnings`, `rating_avg`, `commission_rate`, `created_at`, `deleted_at`, `stripe_*` and every `*_cents` field simply do not exist on any inbound DTO, so there is nothing to filter.

  The OpenAPI document is **generated from the request/response structs and the route registry** and published at `/v1/openapi.json`; the TypeScript client for all four frontends is generated from it. A drift check fails CI if the committed spec differs. This deletes the ghost-endpoint class (frontends calling routes that do not exist) that the old system had at scale.

- **Data**: none. `testdata/openapi.json` is the committed contract.
- **Rules & invariants**:
  - **I-36.1** Unknown fields are rejected on every mutating endpoint.
  - **I-36.2** No inbound DTO contains a server-controlled field — arch-lint over the request package.
  - **I-36.3** No response is a bare array or a bare scalar.
  - **I-36.4** HTTP status and body always agree; `{"success": false}` with 200 is unrepresentable because the response type is a union.
  - **I-36.5** The generated OpenAPI spec matches the committed one; every route appears in it.
- **Acceptance criteria**:
  1. Given `PUT /v1/restaurants/{id}` with `{"is_accepting": true}` while the DTO field is `is_accepting_orders`, Then 422 naming the unknown field. (Old system: 200 with an unchanged row and a snapping toggle.)
  2. Given `{"is_approved": true}` on any partner-facing endpoint, Then 422 `unknown_field`.
  3. Given `delivery_instructions: ["door"]`, Then 422 listing the valid enum values; no order is created.
  4. Given `limit=abc`, Then 422; given `limit=1000`, Then 422 with `max=100`.
  5. Given the route registry, When the OpenAPI drift check runs, Then it passes, and adding a route without regenerating fails CI.
- **Version**: V1 · **Size**: M

---

### P-37 — Idempotency keys

- **Behaviour**: Every `MONEY`-class route and every route that creates a durable resource requires an `Idempotency-Key` header (a client-generated UUID/ULID, 16–128 chars). Scope is `(account_id, method, path_template, key)`.

  Algorithm:
  1. `INSERT INTO idempotency_record (…, state='IN_PROGRESS', request_hash) ON CONFLICT DO NOTHING`. Insert succeeded ⟹ this is the first attempt; proceed.
  2. Conflict ⟹ read the existing row.
     - `state='COMPLETED'` and `request_hash` matches ⟹ **replay** the stored status and body verbatim with `Idempotency-Replayed: true`.
     - `state='COMPLETED'` and `request_hash` differs ⟹ `409 idempotency_key_reuse`.
     - `state='IN_PROGRESS'` and the lease is live ⟹ `409 idempotency_in_progress`, `Retry-After: 1`.
     - `state='IN_PROGRESS'` and the lease expired (crash) ⟹ take over the lease and re-execute; because the underlying operation is itself idempotent (deterministic Stripe keys, conditional updates), re-execution is safe.
  3. On completion, store status + body + headers, set `state='COMPLETED'`, `expires_at = now() + 24 h`.

  The record is written in the **same transaction** as the business effect, so "money moved but the idempotency record did not commit" cannot happen.

  Routes requiring a key: `POST /v1/orders`, `POST /v1/quotes`, `POST /v1/payments/*`, `POST /v1/refunds`, `POST /v1/payouts/*`, `POST /v1/tips`, `POST /v1/connect/account`, `POST /v1/uploads`, `POST /v1/disputes`, and every admin money action.

- **Data**:

```sql
CREATE TABLE idempotency_record (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  method text NOT NULL, path_template text NOT NULL, key text NOT NULL,
  request_hash bytea NOT NULL,
  state text NOT NULL,                        -- 'IN_PROGRESS'|'COMPLETED'
  response_status int, response_body jsonb, response_headers jsonb,
  resource_type text, resource_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX idempotency_unique ON idempotency_record(account_id, method, path_template, key);
```
  Redis: none. Idempotency must survive a Redis flush; it is a correctness mechanism, not a cache.

- **Rules & invariants**:
  - **I-37.1** Two concurrent requests with the same key produce exactly one business effect.
  - **I-37.2** A replay returns byte-identical status and body to the original.
  - **I-37.3** The same key with a different body is always a 409, never a silent replay of the wrong result.
  - **I-37.4** Every `MONEY` route is registered `Idempotent: true` (boot check, P-06).
  - **I-37.5** Records expire after 24 h; expiry is a pure cleanup and never resurrects an effect.
- **Acceptance criteria**:
  1. Given `POST /v1/orders` sent twice concurrently with the same key, Then one order, one PaymentIntent, one ledger batch, and both responses identical.
  2. Given the process is killed between the Stripe call and the response, When the client retries with the same key, Then no second charge occurs and the stored/derived result is returned.
  3. Given the same key with a changed cart, Then 409 `idempotency_key_reuse`.
  4. Given a `MONEY` route called without the header, Then 400 `idempotency_key_required`.
  5. Given Redis is flushed between the two attempts, Then behaviour is unchanged.
- **Version**: V1 · **Size**: M

---

### P-38 — Rate limiting

- **Behaviour**: Token bucket in Redis (`GCRA`/leaky-bucket via a Lua script for atomicity), keyed by class. Every route declares a `RateClass` (P-06) and the limiter picks the key: authenticated routes key on `account_id`, unauthenticated on `RealIP` (+`device_id` when present).

  | Class | Limit | Burst | Key |
  |---|---|---|---|
  | `AUTH` (login, OTP request/verify, reset) | 10 / 15 min | 3 | ip + identifier |
  | `READ` | 300 / min | 60 | account or ip |
  | `WRITE` | 60 / min | 15 | account |
  | `MONEY` (quote, order, refund, payout) | 10 / min | 3 | account |
  | `UPLOAD` | 20 / hour | 5 | account |
  | `REALTIME` (ticket issue) | 30 / min | 10 | account |
  | `SEARCH` | 60 / min | 20 | account or ip |
  | `WEBHOOK` | 1000 / min | 200 | provider ip |
  | `POSITION` (rider position ingest) | 120 / min | 30 | account |

  Additional domain limits: one active order per customer at launch, where an order under review after a problem report does not count (`409 ACTIVE_ORDER_EXISTS`; [one active order](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28), [narrowed](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)); 3 orders per customer per 5 minutes; 1 restaurant accept/reject per order (enforced by the state machine, not the limiter); 5 refund requests per order per day.

  Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and, on 429, `Retry-After`.

  **Redis-down policy** is explicit per class, and this is where the disposability rule needs care: rate limiting is *protection*, not *correctness*, so losing counters is acceptable — but not for authentication.
  - `AUTH`: **fail closed** (503). A brute-force window is worse than a brief outage, and the Postgres-backed lockout in P-03 still applies.
  - `MONEY`: fail open, because idempotency (P-37) and the state machine already prevent duplicate effects; an alert fires.
  - All other classes: fail open with an alert.

  Traefik additionally applies a coarse per-IP limit and connection caps in front of the application, so an application-level Redis outage is never the only defence.

- **Data**: none in Postgres. Redis keys: `rl:{class}:{key}` (TTL = window), `rl:block:{ip}` for temporary bans after sustained abuse (TTL 15 min). Both disposable.
- **Rules & invariants**:
  - **I-38.1** Every route resolves to exactly one `RateClass`; boot check.
  - **I-38.2** Rate limiting never affects the correctness of a completed request — a 429 means the request was not executed at all.
  - **I-38.3** Limits are configurable per environment without a redeploy and are recorded in `audit_event` when changed.
  - **I-38.4** Webhook endpoints are never rate-limited below Stripe's retry rate.
- **Acceptance criteria**:
  1. Given 11 OTP requests in 15 minutes from one IP, Then the 11th is 429 with `Retry-After` and no SMS is sent.
  2. Given Redis is stopped, When a login is attempted, Then 503 `rate_limiter_unavailable`; When a search is attempted, Then it succeeds with an alert recorded.
  3. Given a 429, Then no partial effect exists — no order row, no Stripe call, no ledger entry.
  4. Given the rate-limit headers, Then `RateLimit-Remaining` decreases monotonically within a window and resets exactly at `RateLimit-Reset`.
- **Version**: V1 · **Size**: M

---

### P-39 — Background runtime (deadline runner, outbox relay, schedulers)

- **Behaviour**: The same binary runs HTTP, WebSocket and background work; a `--role` flag (`api`, `worker`, `all`) selects which loops start, so compose can scale them independently without a second image. There is **no external orchestrator**. The old system ran ten Temporal workers in one process, used Temporal as an RPC wrapper for plain DB reads, built workflow ids from `Date.now()`, and registered services twice (B107) — none of that is reproduced.

  Loops, all built on `FOR UPDATE SKIP LOCKED` claim-lease-execute:

  | Loop | Interval | Claims |
  |---|---|---|
  | Deadline runner | 1 s | `order`, `dispatch`, `payment_intent`, `refund`, `payout`, `kyc_document`, `stored_object`, `webhook_event`, `notification` rows with `deadline_at <= now()` |
  | Outbox relay | 200 ms | `outbox_message WHERE published_at IS NULL` |
  | Notification sender | 500 ms | `notification_delivery WHERE state='QUEUED'` |
  | Push receipt poller | 30 s | Expo receipts |
  | Reconciliation | daily 03:00 ET | Stripe balance transactions vs ledger |
  | Payout run | per schedule | `RESTAURANT_PAYABLE` / `RIDER_PAYABLE` balances |
  | Expiry sweeps | hourly | quotes, tickets, OTP challenges, certificates, unconfirmed uploads |
  | Partition maintenance | at start-up, then hourly | create `realtime_event`, `rider_position_history`, `audit_event` partitions ahead of the clock, drop the expired ones (`audit_event` never), and alert on any row in a `*_default` partition |
  | Audit chain verification | daily | `verify_audit_chain(yesterday)` |

  Every loop exposes `hg_worker_lag_seconds`, `hg_worker_claimed_total`, `hg_worker_failed_total` and a per-loop health entry in `GET /internal/health`. `GET /health` (liveness) and `GET /health/ready` (readiness: Postgres, Redis, Silo, Stripe reachable) exist from day one — the old Dockerfile probed a `/health` that did not exist, so every container was permanently unhealthy (B104).

- **Data**: lease columns on the claimed tables; `job_run (id, job, started_at, finished_at, claimed, succeeded, failed, error)` for observability.
- **Rules & invariants**:
  - **I-39.1** Every background action is idempotent and safe to re-run after a crash.
  - **I-39.2** No loop uses `SELECT … FOR UPDATE` without `SKIP LOCKED`; no loop uses `KEYS` against Redis (the old notification store used blocking `KEYS` on production Redis — B89); `SCAN` with a cursor is the only enumeration permitted, and only over disposable keys.
  - **I-39.3** Running N worker replicas produces the same effects as running one, only faster.
  - **I-39.4** A loop that fails repeatedly opens a circuit and pages, rather than spinning.
- **Acceptance criteria**:
  1. Given three worker replicas and 5 000 due deadlines, Then each deadline action executes exactly once.
  2. Given `GET /health/ready` with Silo stopped, Then 503 naming the object store, and Traefik removes the replica from rotation.
  3. Given a worker is killed mid-claim, When the lease expires, Then another worker completes the work and the final state is identical.
- **Version**: V1 · **Size**: M

---

## 13. Remaining business rules that cannot be derived

> **Decided:** Ontario only at launch; the tax engine still carries every province ([launch province](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)).

> **Decided:** the customer's 4-digit delivery code, never shown to the rider; for leave-at-door, photo plus statement at once ([handover](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01); contract change: [#183](https://github.com/shaiknoorullah/hg-mono/issues/183)).

> **DECISION REQUIRED — rider location retention**: How long is a rider's GPS track kept? · **Proposed default**: 30 days in `rider_position_history` (payout distance evidence and dispute evidence), aggregated to per-order distance thereafter, raw points dropped. · **Why**: it is employee-adjacent location data under PIPEDA; keeping it indefinitely is an unnecessary liability.

> **Decided:** record the consent at sign-up; send nothing until the email is confirmed ([marketing consent](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)).

> **DECISION REQUIRED — trading-hours enforcement**: Are orders rejected outside a restaurant's opening hours? · **Proposed default**: yes — quoting outside the trading window fails with `restaurant_closed`, and `is_accepting_orders=false` does the same, both evaluated in the restaurant's timezone. · **Why**: hours are stored today and enforced nowhere, so orders can be placed at 03:00 (B28).

> **DECISION REQUIRED — scheduled orders**: Can a customer order for later? · **Proposed default**: not in V1; the quote's `scheduled_for` field exists and is rejected as non-null. · **Why**: scheduling multiplies the state machine's deadline logic and can be added additively.

> **Decided:** at launch staff delete accounts by hand on request; in-app deletion ships before the store release ([account deletion](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01), [#67](https://github.com/shaiknoorullah/hg-mono/issues/67)).

> **Open:** what does deletion do for each role, and how long is each kind of data kept?

> **DECISION REQUIRED — support impersonation**: May support act as a user? · **Proposed default**: yes, time-boxed to 30 minutes, always audited with `on_behalf_of`, with money actions and KYC downloads blocked while impersonating. · **Why**: it is the fastest way to resolve a customer issue and the most dangerous capability in the system.

---

## 14. Version map

| Version | Contents |
|---|---|
| **V1** (must exist before any domain code ships) | P-01 … P-39 as written. Everything above is V1 unless noted. |
| **V2** | Postgres RLS as a redundant authorization layer; OIDC/social login; admin-editable email templates (A37) with approval; instant rider cash-out; scheduled orders; multi-currency scaffolding; in-app chat over the existing realtime channels; alcohol tax handling; admin-configurable permission matrix with change review; Redis-Stream-backed realtime fan-out if pub/sub proves insufficient. |
| **V3** | Multi-market (province/country expansion with per-market tax and payout configuration); dynamic pricing/surge as a first-class quote component; fraud scoring on the money path; read replicas and search extraction if Postgres FTS ceases to hold; per-tenant data residency. |

## 15. Invariant index (the executable contract)

| ID | One-line invariant |
|---|---|
| G-1 | Flushing Redis degrades performance and never changes outcomes. |
| G-2 | No float, `money` or `numeric` in any monetary path. |
| G-3 | No inbound DTO carries a price, total, fee or server-controlled field. |
| G-4 | A route without a policy fails at boot. |
| G-5 | Every non-terminal row has a `deadline_at` and a timeout action. |
| I-09.4 | `total = subtotal − discounts + delivery + service + tax + tip` (DB `CHECK`). |
| I-13.1 | Every ledger batch sums to zero (deferred DB trigger). |
| I-13.2 | Every order's ledger entries sum to zero — the decomposition invariant. |
| I-13.5 | 100% of every tip reaches `RIDER_PAYABLE`. |
| I-13.6 | The ledger is append-only. |
| I-14.1 | `order.state` has exactly one writer. |
| I-15.1 | No non-terminal order exists without a deadline. |
| I-16.3 | No order cooks before its money is captured. |
| I-17.1 | Webhook replay produces one effect. |
| I-18.2 | Every refund keeps the order's ledger at zero. |
| I-20.1 | Identity is never client-asserted on the socket. |
| I-21.2 | No event reaches a principal that could not subscribe to its channel. |
| I-23.1 | An event exists iff its state change committed. |
| I-24.1 | Reading the inbox never destroys a notification. |
| I-27.1 | No private bucket is anonymously readable or writable. |
| I-30.1 | Exactly one location column per entity. |
| I-32.1 | Exactly one rider can be assigned to an order. |
| I-34.1 | "Certified" requires an approved, unexpired certificate from a recognised body. |
| I-35.1 | Audit rows are never updated or deleted. |
| I-37.1 | One idempotency key, one business effect. |

---

## 16. Decisions required — consolidated

| # | Topic | Question | Proposed default |
|---|---|---|---|
| 1 | One account across roles | Can one person hold customer, rider and restaurant roles on one account? | One account, many roles |
| 2 | Restaurant staff granularity | How many restaurant sub-roles at launch? | **Decided:** owner only at launch ([staff accounts](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) |
| 3 | Admin MFA | Mandatory TOTP for admin, super-admin, support? | **Decided:** mandatory; no recovery codes, a super admin resets a lost authenticator ([manual reset](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
| 4 | Session lifetimes | Per-role idle and absolute TTLs? | **Decided** for staff: 30 min idle, 12 h total ([staff session length](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)); open: customer 30/180 d, restaurant 14/90 d |
| 5 | Variant pricing semantics | Does a variant replace or adjust the base price? | Explicit per variant: `ABSOLUTE` \| `DELTA`, default `ABSOLUTE` |
| 6 | Fee parameters | Launch delivery/service/commission values? | **Decided:** delivery $2.99 + $1.00/km, service fee $0.00, commission 0% ([delivery fee](../decisions/README.md#settled--client-decisions), [service fee](../decisions/README.md#settled--reconciliations)); open: included km, min/max, small-order surcharge |
| 7 | Quote TTL | How long is a quoted price honoured? | 10 minutes, re-confirmation on change |
| 8 | **GST/HST supplier position** | Is the platform the deemed supplier for non-registrant restaurants? | Platform is deemed supplier for non-registrants; registrants remain supplier. **Tax counsel sign-off required.** Open, blocking: [HST registration](../decisions/README.md#open--blocking) |
| 9 | QST / Quebec | Register for QST and launch in QC? | **Decided:** no Quebec at launch ([launch province](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)) |
| 10 | Tip taxation | Tips untaxed and 100% to the rider? | Yes to both |
| 11 | Commission tax invoicing | How is GST/HST on commission billed to restaurants? | Accrued per order, self-billed monthly invoice netted from payouts |
| 12 | Stripe fee absorption | Who bears the ~2.9% + $0.30? | Platform absorbs entirely |
| 13 | Commission base | Before or after a restaurant-funded discount? | After |
| 14 | Rider earnings formula | Base, per-km, minimum? | **Decided:** pass-through: the delivery fee plus 100% of tips, no floor ([rider pay](../decisions/README.md#settled--reconciliations)) |
| 15 | Restaurant acceptance window | How long to accept? | **Decided:** 180 s ([acceptance window](../decisions/README.md#settled--reconciliations)); dismissing the dialog never rejects |
| 16 | No-rider-found policy | Who pays for cooked food nobody collects? | **Decided:** customer refunded, restaurant paid, platform absorbs ([refund liability](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)) |
| 17 | Prep-overdue cancellation | Is the restaurant paid when the kitchen blows its SLA? | No; full customer refund, SLA incident recorded |
| 18 | Customer cancellation | Until when is cancellation free, and what after? | **Decided:** free until acceptance; after it, staff cancel without a support case, reason audited ([cancellation policy](../decisions/README.md#settled--client-decisions)) |
| 19 | Dispute window | How long after delivery? | 72 h customer, 7 days restaurant, 48 h support SLA |
| 20 | Capture timing | Auth-then-capture or immediate capture? | Auth at checkout, capture on restaurant acceptance |
| 21 | Refund liability matrix | Who is charged back per reason code? | **Decided:** by fault, per reason code; a halal concern charges the restaurant only when substantiated ([refund liability](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1), [halal complaint](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
| 22 | Goodwill refund authority | What can a support agent refund unaided? | **Decided:** second approver above CAD 50, for every role ([goodwill approval](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) |
| 23 | Connect account type | Express or Custom? | Express |
| 24 | Payout schedule and minimum | Cadence and floor? | **Decided:** weekly, Monday, automatic, no minimum ([payout cadence](../decisions/README.md#settled--client-decisions)) |
| 25 | Negative partner balances | What if refunds exceed earnings? | **Decided** for riders: no automatic block ([rider balance below zero](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)); open for restaurants: carry and net, block after 30 days, never debit |
| 26 | Restaurant offer escalation | Escalate an unanswered offer to SMS/voice? | SMS at 60 s, automated voice call at 120 s |
| 27 | KYC retention | How long after the relationship ends? | 7 years, then hard delete |
| 28 | Halal certificate expiry grace | What happens on expiry day? | **Decided:** leaves every listing at once ([self-declared listing](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)); open: suspended after 14 days |
| 29 | Offer strategy | Broadcast or sequential? | Broadcast to 8 per wave, 30 s TTL |
| 30 | Recognised halal certifiers | Which bodies count as "certified"? | **Decided:** three accepted Canadian bodies, in a registry a super admin can extend ([accepted certifying bodies](../decisions/README.md#settled--client-decisions)) |
| 31 | Self-declared restaurants | List them at all? | **Decided:** no, hidden entirely ([self-declared listing](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)) |
| 32 | Audit retention | How long? | 7 years money/KYC, 24 months otherwise, redaction not deletion |
| 33 | Provinces served at launch | Where do we take orders? | **Decided:** Ontario only; engine supports all provinces ([launch province](../decisions/README.md#settled--launch-decisions-sep-2026-client-confirmed-at-rc1)) |
| 34 | Proof of delivery | Photo or code required? | **Decided:** 4-digit delivery code; photo plus statement for leave-at-door ([handover](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)) |
| 35 | Rider location retention | How long is the GPS track kept? | 30 days raw, then per-order aggregates only |
| 36 | CASL marketing consent | Single or double opt-in? | **Decided:** record consent; send nothing until the email is confirmed ([marketing consent](../decisions/README.md#settled--redesign-decisions-owner-2026-09-28)) |
| 37 | Trading-hours enforcement | Reject orders outside opening hours? | Yes, evaluated in the restaurant's timezone |
| 38 | Scheduled orders | Order-for-later in V1? | No; field exists, rejected as non-null |
| 39 | Account deletion | What does deletion do per role? | **Decided:** staff delete by hand at launch; in-app deletion before the store release ([account deletion](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)); open: per-role effects |
| 40 | Support impersonation | May support act as a user? | Yes, 30-minute box, always audited, money and KYC actions blocked |

**Blocking for launch**: #8 (tax counsel; [HST registration](../decisions/README.md#open--blocking)), #23 (Connect account type) and the restaurant half of #25. Rows #6, #14, #21, #24 and #30 are now decided. Everything else can ship on its proposed default and be changed as configuration.
