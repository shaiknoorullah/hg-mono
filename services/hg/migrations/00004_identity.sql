-- P-01..P-04 — one account per human, roles as grants, credentials as grants.
-- A restaurant is not an account; restaurant staff are accounts holding a
-- RESTAURANT_* role scoped to a restaurant_id.

-- +goose Up

CREATE TABLE account (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_e164          text UNIQUE,
  email               citext UNIQUE,
  phone_verified_at   timestamptz,
  email_verified_at   timestamptz,
  password_hash       text,                       -- argon2id encoded string
  password_set_at     timestamptz,
  totp_secret_enc     bytea,                      -- AES-GCM under APP_DATA_KEY
  totp_enrolled_at    timestamptz,
  status              account_status NOT NULL DEFAULT 'ACTIVE',
  status_reason       text,
  locale              locale_code NOT NULL DEFAULT 'en-CA',
  timezone            text NOT NULL DEFAULT 'America/Toronto',
  stripe_customer_id  text UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT account_has_identifier CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL),
  -- I-02.5: no country prefix is ever inferred; the client sends full E.164.
  CONSTRAINT account_phone_e164_shape CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);
SELECT attach_updated_at('account');
CREATE INDEX account_live ON account (status) WHERE deleted_at IS NULL;

CREATE TABLE account_role (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id  uuid NOT NULL REFERENCES account(id),
  role        role_name NOT NULL,
  scope_type  role_scope_type NOT NULL,
  scope_id    uuid,                                -- restaurant_id when RESTAURANT
  granted_by  uuid REFERENCES account(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES account(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_role_scope_shape CHECK (
    (scope_type = 'GLOBAL'     AND scope_id IS NULL) OR
    (scope_type = 'RESTAURANT' AND scope_id IS NOT NULL)
  )
);
SELECT attach_updated_at('account_role');
CREATE UNIQUE INDEX account_role_live
  ON account_role (account_id, role, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE revoked_at IS NULL;
CREATE INDEX account_role_scope ON account_role (scope_type, scope_id) WHERE revoked_at IS NULL;

CREATE TABLE customer_profile (
  account_id            uuid PRIMARY KEY REFERENCES account(id),
  first_name            text NOT NULL,
  last_name             text,
  avatar_object_id      uuid,                      -- FK added in 00010 (stored_object)
  default_address_id    uuid,                      -- FK added in 00007 (address)
  marketing_consent_at  timestamptz,               -- CASL: express consent, timestamped
  marketing_consent_source text,
  marketing_consent_ip  inet,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
SELECT attach_updated_at('customer_profile');

-- P-02 — OTP challenges. All state in Postgres: a Redis flush can reset the
-- request-rate counters but can never reset attempts, consumed_at or
-- expires_at, so no code becomes re-guessable or re-usable.
CREATE TABLE otp_challenge (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_e164     text NOT NULL,
  purpose        otp_purpose NOT NULL,
  code_hash      bytea NOT NULL,                   -- HMAC-SHA256(code, OTP_PEPPER)
  attempts       int NOT NULL DEFAULT 0,
  max_attempts   int NOT NULL DEFAULT 5,
  sends          int NOT NULL DEFAULT 1,
  last_sent_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,             -- last_sent_at + 5 min
  window_ends_at timestamptz NOT NULL,             -- created_at + 15 min
  consumed_at    timestamptz,
  request_ip     inet,
  device_id      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_attempts_bounded CHECK (attempts >= 0 AND attempts <= max_attempts),
  CONSTRAINT otp_sends_bounded CHECK (sends BETWEEN 1 AND 3)
);
SELECT attach_updated_at('otp_challenge');
CREATE INDEX otp_challenge_open ON otp_challenge (phone_e164, purpose) WHERE consumed_at IS NULL;
CREATE INDEX otp_challenge_expiry ON otp_challenge (window_ends_at) WHERE consumed_at IS NULL;

-- P-03 — email verification / password reset tokens (SHA-256, single use).
CREATE TABLE credential_token (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id  uuid NOT NULL REFERENCES account(id),
  kind        text NOT NULL CHECK (kind IN ('EMAIL_VERIFY', 'PASSWORD_RESET', 'EMAIL_CHANGE')),
  token_hash  bytea NOT NULL UNIQUE,
  new_email   citext,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_ip  inet,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('credential_token');
CREATE INDEX credential_token_account ON credential_token (account_id, kind);

-- Lockout truth lives here, not in Redis: 10 consecutive BAD_PASSWORD inside
-- 15 minutes is computed by query, so FLUSHALL does not unlock an account.
CREATE TABLE login_attempt (
  id         bigserial PRIMARY KEY,
  email      citext,
  account_id uuid,
  ip         inet NOT NULL,
  outcome    text NOT NULL CHECK (outcome IN ('SUCCESS', 'BAD_PASSWORD', 'NO_ACCOUNT', 'LOCKED', 'BAD_TOTP')),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempt_recent ON login_attempt (email, at DESC);
CREATE INDEX login_attempt_ip ON login_attempt (ip, at DESC);

-- P-04 — sessions. The refresh token's SHA-256 only; rotation with reuse
-- detection revokes the whole family.
CREATE TABLE session (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  family_id           uuid NOT NULL,
  account_id          uuid NOT NULL REFERENCES account(id),
  amr                 auth_method NOT NULL,
  roles_snapshot      jsonb NOT NULL,
  client              client_surface NOT NULL,
  device_id           text,
  user_agent          text,
  ip                  inet,
  ip_city             text,
  refresh_hash        bytea NOT NULL UNIQUE,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  rotated_at          timestamptz,
  rotated_to          uuid REFERENCES session(id),
  revoked_at          timestamptz,
  revoke_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('session');
CREATE INDEX session_family ON session (family_id);
CREATE INDEX session_account_live ON session (account_id) WHERE revoked_at IS NULL;
CREATE INDEX session_recent_revocations ON session (revoked_at) WHERE revoked_at IS NOT NULL;

CREATE TABLE signing_key (
  kid             text PRIMARY KEY,
  alg             text NOT NULL DEFAULT 'EdDSA',
  public_key      bytea NOT NULL,
  private_key_enc bytea NOT NULL,                  -- sealed with APP_DATA_KEY
  not_before      timestamptz NOT NULL,
  not_after       timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signing_key_window CHECK (not_after > not_before)
);
SELECT attach_updated_at('signing_key');

-- +goose Down
DROP TABLE IF EXISTS signing_key;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS login_attempt;
DROP TABLE IF EXISTS credential_token;
DROP TABLE IF EXISTS otp_challenge;
DROP TABLE IF EXISTS customer_profile;
DROP TABLE IF EXISTS account_role;
DROP TABLE IF EXISTS account;
