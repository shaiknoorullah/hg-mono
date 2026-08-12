-- Staff and RBAC.
--
-- Reconciliation: 05-admin.md models staff as a standalone `staff_user` table
-- with its own credentials. 01-platform.md P-01 is normative and says one
-- account per human, roles as grants. Staff are therefore accounts holding
-- ADMIN / SUPER_ADMIN / SUPPORT_AGENT grants in `account_role`, and this table
-- holds only the staff-specific attributes the contract's StaffUser exposes —
-- notably `status`, whose INVITED state has no counterpart in account_status.
--
-- The permission matrix itself is NOT database-configurable (P-05): it ships as
-- internal/authz/matrix.go under a golden test. `permission_action` below is a
-- generated mirror for joins and for the audit trail, refreshed from Go on boot.

-- +goose Up

CREATE TABLE staff_profile (
  account_id          uuid PRIMARY KEY REFERENCES account(id),
  full_name           text NOT NULL,
  department          text,
  status              staff_status NOT NULL DEFAULT 'INVITED',
  mfa_enrolled        boolean NOT NULL DEFAULT false,
  mfa_recovery_codes  bytea,                       -- 10 codes, hashed
  failed_login_count  int NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  password_changed_at timestamptz,
  last_login_at       timestamptz,
  created_by          uuid REFERENCES account(id),
  status_changed_at   timestamptz,
  status_changed_by   uuid REFERENCES account(id),
  deactivated_reason  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT attach_updated_at('staff_profile');
CREATE INDEX staff_profile_status ON staff_profile (status) WHERE deleted_at IS NULL;

CREATE TABLE staff_invitation (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id    uuid NOT NULL REFERENCES account(id),
  token_hash    bytea NOT NULL UNIQUE,
  role          role_name NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_by    uuid NOT NULL REFERENCES account(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitation_role CHECK (role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'))
);
SELECT attach_updated_at('staff_invitation');

-- Mirror of the compile-time action set (P-05 I-05.1). Populated by
-- `hg migrate sync-actions` at boot; nothing reads it for authorization
-- decisions — it exists so audit rows and admin UIs can join on a real key.
CREATE TABLE permission_action (
  action      text PRIMARY KEY,                    -- 'order.accept', 'refund.issue', ...
  noun        text NOT NULL,
  verb        text NOT NULL,
  class       text NOT NULL,                       -- READ | WRITE | MONEY | DESTRUCTIVE
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('permission_action');

CREATE TABLE role_permission (
  role       role_name NOT NULL,
  action     text NOT NULL REFERENCES permission_action(action) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, action)
);

-- +goose Down
DROP TABLE IF EXISTS role_permission;
DROP TABLE IF EXISTS permission_action;
DROP TABLE IF EXISTS staff_invitation;
DROP TABLE IF EXISTS staff_profile;
