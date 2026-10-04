-- One owner for every change of an account's state, held by the database.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/253 (the security review
-- of https://github.com/shaiknoorullah/hg-mono/pull/335).
--
-- Migration 00034 gave the admin account actions their gates: an admin or super
-- admin, two-step sign-in, a second super admin to confirm a ban, and never your
-- own account. But the states are plain columns (restaurant.account_state and
-- delist_reasons, rider_profile.account_status, account.status), so any other code
-- that can UPDATE them could suspend, list, ban or lift a ban with none of those
-- gates and leave no history. This migration closes that:
--
--   1. account_state_rule lists every transition the account's history may record
--      and who may take it: an admin (or super admin), a super admin only, or a
--      named system principal with the one reason it gives. It is the same list as
--      accountstate.Transitions() in Go; internal/admin's tests hold them equal.
--      hg_app may read it, never change it.
--   2. account_state_event names its actor: a staff member (actor_kind STAFF and
--      actor_account_id) or a system principal (actor_kind SYSTEM and
--      system_actor). A BEFORE INSERT trigger refuses a row whose transition is not
--      in account_state_rule, whose staff actor does not hold the role it needs,
--      who acts on their own account or their own restaurant, or who acts on a
--      staff account as if it were a customer's. Its created_at is the
--      transaction's clock, so a row can never be backdated into the 7-day window
--      of a ban proposal.
--   3. A deferred constraint trigger on each state column refuses, at commit, any
--      change with no history row for exactly that change (same subject, same
--      from and to state) written in the same transaction. The one change without
--      a history row is completing onboarding: a restaurant leaves PENDING (for
--      LIVE or DELISTED) and a rider leaves PENDING (for ACTIVE) only in the same
--      row update that moves its onboarding_state to ACTIVE. That is the ONBOARDING
--      system principal's one transition (accountstate.GoLive), and it can never
--      lift a suspension or a ban, because none of those states is PENDING.
--   4. A restaurant moves into LIVE only with a current halal certificate
--      (halal_status CERTIFIED or EXPIRING_SOON): "a restaurant may never reach
--      account_state = LIVE without an approved, non-expired halal certificate"
--      (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling,
--      rule R4 and acceptance criterion 4), whichever path lists it.
--   5. A restaurant's delisting reasons only shrink with a history row in the same
--      transaction, or when the only reasons cleared are the halal certificate's
--      own and the certificate is current again (the renewal clearing its lapse).
--      Adding a reason needs nothing: it only ever restricts.
--
-- Two-step sign-in is a property of the caller's session, which the database
-- cannot see; ApplyAccountAction checks it itself, not only its HTTP handler, so
-- every staff path in Go meets it. A test in internal/accountstate fails if any
-- other Go file writes these columns or the history.
--
-- A superuser can still bypass every trigger (session_replication_role = replica);
-- the application never connects as one.

-- +goose Up

-- 1. Who may take which transition.
CREATE TABLE account_state_rule (
  subject_type account_subject_type NOT NULL,
  action       account_action NOT NULL,
  from_state   text NOT NULL,
  to_state     text NOT NULL,
  -- ADMIN: an admin or a super admin. SUPER_ADMIN: a super admin only.
  -- SYSTEM:<name>: the system principal accountstate.System names.
  principal    text NOT NULL,
  -- The one reason a system principal gives; NULL for staff, whose reasons the
  -- event's own CHECK and the API hold to each action.
  reason_code  text,
  PRIMARY KEY (subject_type, action, from_state, to_state, principal),
  CONSTRAINT account_state_rule_principal
    CHECK (principal IN ('ADMIN', 'SUPER_ADMIN', 'SYSTEM:HALAL_EXPIRY', 'SYSTEM:HALAL_RENEWAL')),
  CONSTRAINT account_state_rule_system_reason
    CHECK ((principal LIKE 'SYSTEM:%') = (reason_code IS NOT NULL))
);

INSERT INTO account_state_rule (subject_type, action, from_state, to_state, principal, reason_code) VALUES
  -- Restaurants (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-22--restaurant-account-state-actions-suspend--ban--deactivate--reinstate--delist).
  ('RESTAURANT', 'SUSPEND',     'LIVE',        'SUSPENDED',   'ADMIN', NULL),
  ('RESTAURANT', 'SUSPEND',     'DELISTED',    'SUSPENDED',   'ADMIN', NULL),
  ('RESTAURANT', 'DELIST',      'LIVE',        'DELISTED',    'ADMIN', NULL),
  ('RESTAURANT', 'PROPOSE_BAN', 'LIVE',        'SUSPENDED',   'ADMIN', NULL),
  ('RESTAURANT', 'PROPOSE_BAN', 'DELISTED',    'SUSPENDED',   'ADMIN', NULL),
  ('RESTAURANT', 'PROPOSE_BAN', 'SUSPENDED',   'SUSPENDED',   'ADMIN', NULL),
  ('RESTAURANT', 'CONFIRM_BAN', 'SUSPENDED',   'BANNED',      'SUPER_ADMIN', NULL),
  ('RESTAURANT', 'DEACTIVATE',  'LIVE',        'DEACTIVATED', 'ADMIN', NULL),
  ('RESTAURANT', 'DEACTIVATE',  'DELISTED',    'DEACTIVATED', 'ADMIN', NULL),
  -- Reinstating lands on DELISTED instead of LIVE while a delisting reason
  -- remains or the halal certificate is not current.
  ('RESTAURANT', 'REINSTATE',   'SUSPENDED',   'LIVE',        'ADMIN', NULL),
  ('RESTAURANT', 'REINSTATE',   'SUSPENDED',   'DELISTED',    'ADMIN', NULL),
  ('RESTAURANT', 'REINSTATE',   'DEACTIVATED', 'LIVE',        'ADMIN', NULL),
  ('RESTAURANT', 'REINSTATE',   'DEACTIVATED', 'DELISTED',    'ADMIN', NULL),
  ('RESTAURANT', 'REINSTATE',   'DELISTED',    'LIVE',        'ADMIN', NULL),
  ('RESTAURANT', 'REINSTATE',   'BANNED',      'LIVE',        'SUPER_ADMIN', NULL),
  ('RESTAURANT', 'REINSTATE',   'BANNED',      'DELISTED',    'SUPER_ADMIN', NULL),
  -- Riders (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-27--rider-account-state-actions).
  ('RIDER',      'SUSPEND',     'ACTIVE',      'SUSPENDED',   'ADMIN', NULL),
  ('RIDER',      'PROPOSE_BAN', 'ACTIVE',      'SUSPENDED',   'ADMIN', NULL),
  ('RIDER',      'PROPOSE_BAN', 'SUSPENDED',   'SUSPENDED',   'ADMIN', NULL),
  ('RIDER',      'CONFIRM_BAN', 'SUSPENDED',   'BANNED',      'SUPER_ADMIN', NULL),
  ('RIDER',      'DEACTIVATE',  'ACTIVE',      'DEACTIVATED', 'ADMIN', NULL),
  ('RIDER',      'DEACTIVATE',  'SUSPENDED',   'DEACTIVATED', 'ADMIN', NULL),
  ('RIDER',      'REINSTATE',   'SUSPENDED',   'ACTIVE',      'ADMIN', NULL),
  ('RIDER',      'REINSTATE',   'DEACTIVATED', 'ACTIVE',      'ADMIN', NULL),
  ('RIDER',      'REINSTATE',   'BANNED',      'ACTIVE',      'SUPER_ADMIN', NULL),
  -- Customers (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-28--customer-account-state-actions).
  ('CUSTOMER',   'SUSPEND',     'ACTIVE',      'SUSPENDED',   'ADMIN', NULL),
  ('CUSTOMER',   'PROPOSE_BAN', 'ACTIVE',      'SUSPENDED',   'ADMIN', NULL),
  ('CUSTOMER',   'PROPOSE_BAN', 'SUSPENDED',   'SUSPENDED',   'ADMIN', NULL),
  ('CUSTOMER',   'CONFIRM_BAN', 'SUSPENDED',   'BANNED',      'SUPER_ADMIN', NULL),
  ('CUSTOMER',   'REINSTATE',   'SUSPENDED',   'ACTIVE',      'ADMIN', NULL),
  ('CUSTOMER',   'REINSTATE',   'BANNED',      'ACTIVE',      'SUPER_ADMIN', NULL),
  -- System principals (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling):
  -- the expiry only delists; the renewal only lists a delisted restaurant again.
  ('RESTAURANT', 'DELIST',      'LIVE',        'DELISTED',    'SYSTEM:HALAL_EXPIRY',  'HALAL_CERTIFICATE_EXPIRED'),
  ('RESTAURANT', 'REINSTATE',   'DELISTED',    'LIVE',        'SYSTEM:HALAL_RENEWAL', 'ISSUE_RESOLVED');

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON account_state_rule FROM hg_app;

-- 2. The history names its actor.
ALTER TABLE account_state_event
  ADD COLUMN actor_kind   text NOT NULL DEFAULT 'STAFF',
  ADD COLUMN system_actor text,
  ALTER COLUMN actor_account_id DROP NOT NULL,
  ALTER COLUMN idempotency_key DROP NOT NULL,
  ALTER COLUMN request_hash DROP NOT NULL,
  -- A staff row names the person and carries the request's idempotency key; a
  -- system row names the principal and no person.
  ADD CONSTRAINT account_state_event_actor CHECK (
    (actor_kind = 'STAFF' AND actor_account_id IS NOT NULL AND system_actor IS NULL
       AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
    OR (actor_kind = 'SYSTEM' AND actor_account_id IS NULL
       AND system_actor IN ('HALAL_EXPIRY', 'HALAL_RENEWAL'))
  );

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_event_guard_actor() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  needs_super boolean;
BEGIN
  -- History is written when it happens, on the transaction's clock: never
  -- backdated into a ban proposal's 7-day window, and matched to the state
  -- change in the same transaction by the subject guards below.
  NEW.created_at := now();

  IF NEW.actor_kind = 'SYSTEM' THEN
    IF NOT EXISTS (
      SELECT 1 FROM account_state_rule k
       WHERE k.subject_type = NEW.subject_type AND k.action = NEW.action
         AND k.from_state = NEW.from_state AND k.to_state = NEW.to_state
         AND k.principal = 'SYSTEM:' || NEW.system_actor
         AND k.reason_code = NEW.reason_code) THEN
      RAISE EXCEPTION 'account_state_system_not_allowed: the % principal may not % a % from % to % with reason %',
        NEW.system_actor, NEW.action, NEW.subject_type, NEW.from_state, NEW.to_state, NEW.reason_code
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- A staff member: the transition must be one staff may take ...
  SELECT bool_and(k.principal = 'SUPER_ADMIN')
    INTO needs_super
    FROM account_state_rule k
   WHERE k.subject_type = NEW.subject_type AND k.action = NEW.action
     AND k.from_state = NEW.from_state AND k.to_state = NEW.to_state
     AND k.principal IN ('ADMIN', 'SUPER_ADMIN');
  IF needs_super IS NULL THEN
    RAISE EXCEPTION 'account_state_illegal_transition: staff cannot % a % from % to %',
      NEW.action, NEW.subject_type, NEW.from_state, NEW.to_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- ... and they must hold the role it needs, now.
  IF NOT EXISTS (
    SELECT 1 FROM account_role ar
     WHERE ar.account_id = NEW.actor_account_id
       AND ar.scope_type = 'GLOBAL' AND ar.revoked_at IS NULL
       AND (ar.role = 'SUPER_ADMIN' OR (ar.role = 'ADMIN' AND NOT needs_super))) THEN
    RAISE EXCEPTION 'account_state_actor_not_permitted: % % a % from % to % needs %',
      NEW.actor_account_id, NEW.action, NEW.subject_type, NEW.from_state, NEW.to_state,
      CASE WHEN needs_super THEN 'a super admin' ELSE 'an admin or a super admin' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Staff never act on their own account, nor on a restaurant they work for.
  IF (NEW.subject_type IN ('RIDER', 'CUSTOMER') AND NEW.subject_id = NEW.actor_account_id)
     OR (NEW.subject_type = 'RESTAURANT' AND EXISTS (
          SELECT 1 FROM account_role ar
           WHERE ar.account_id = NEW.actor_account_id AND ar.scope_type = 'RESTAURANT'
             AND ar.scope_id = NEW.subject_id AND ar.revoked_at IS NULL)) THEN
    RAISE EXCEPTION 'account_state_own_account: staff cannot act on their own account or their own restaurant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A staff account is never suspended or banned as a customer: that would let an
  -- admin lock a super admin out.
  IF NEW.subject_type = 'CUSTOMER' AND EXISTS (
       SELECT 1 FROM account_role ar
        WHERE ar.account_id = NEW.subject_id AND ar.revoked_at IS NULL
          AND ar.role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'account_state_staff_subject: a staff account is not changed by a customer action'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- Named to sort before account_state_event_ban_two_person, so the ban guard sees
-- the forced created_at.
CREATE TRIGGER account_state_event_actor_guard
  BEFORE INSERT ON account_state_event
  FOR EACH ROW EXECUTE FUNCTION account_state_event_guard_actor();

-- 3-5. Every state change has its history row.

-- True when this transaction wrote a history row for exactly this change.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_change_recorded(
  p_subject account_subject_type, p_subject_id uuid, p_from text, p_to text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM account_state_event e
     WHERE e.subject_type = p_subject AND e.subject_id = p_subject_id
       AND e.from_state = p_from AND e.to_state = p_to
       AND e.created_at = now())
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION restaurant_account_state_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  lost text[];
BEGIN
  IF OLD.account_state IS DISTINCT FROM NEW.account_state THEN
    IF NOT account_state_change_recorded('RESTAURANT', NEW.id, OLD.account_state::text, NEW.account_state::text)
       -- Completing onboarding (the ONBOARDING principal, accountstate.GoLive).
       AND NOT (OLD.account_state = 'PENDING' AND NEW.account_state IN ('LIVE', 'DELISTED')
                AND OLD.onboarding_state <> 'ACTIVE' AND NEW.onboarding_state = 'ACTIVE') THEN
      RAISE EXCEPTION 'account_state_change_unrecorded: restaurant % moved from % to % with no history row; only internal/admin ApplyAccountAction, onboarding and the halal principals change it',
        NEW.id, OLD.account_state, NEW.account_state
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.account_state = 'LIVE' AND NEW.halal_status NOT IN ('CERTIFIED', 'EXPIRING_SOON') THEN
      RAISE EXCEPTION 'account_state_live_needs_halal_certificate: restaurant % cannot be listed with halal status %',
        NEW.id, NEW.halal_status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT coalesce(array_agg(r), '{}') INTO lost
    FROM unnest(OLD.delist_reasons) AS r
   WHERE NOT (r = ANY (NEW.delist_reasons));
  IF cardinality(lost) > 0
     AND NOT account_state_change_recorded('RESTAURANT', NEW.id, OLD.account_state::text, NEW.account_state::text)
     AND NOT (lost <@ ARRAY['HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED']
              AND NEW.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')) THEN
    RAISE EXCEPTION 'account_state_delist_reason_unrecorded: restaurant % lost the delisting reasons % with no history row',
      NEW.id, lost
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER restaurant_account_state_owned
  AFTER UPDATE OF account_state, delist_reasons ON restaurant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.account_state IS DISTINCT FROM NEW.account_state
        OR OLD.delist_reasons IS DISTINCT FROM NEW.delist_reasons)
  EXECUTE FUNCTION restaurant_account_state_guard();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION rider_account_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT account_state_change_recorded('RIDER', NEW.account_id, OLD.account_status::text, NEW.account_status::text)
     -- Completing onboarding: the rider becomes dispatchable.
     AND NOT (OLD.account_status = 'PENDING' AND NEW.account_status = 'ACTIVE'
              AND OLD.onboarding_state <> 'ACTIVE' AND NEW.onboarding_state = 'ACTIVE') THEN
    RAISE EXCEPTION 'account_state_change_unrecorded: rider % moved from % to % with no history row; only internal/admin ApplyAccountAction and onboarding change it',
      NEW.account_id, OLD.account_status, NEW.account_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER rider_account_status_owned
  AFTER UPDATE OF account_status ON rider_profile
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.account_status IS DISTINCT FROM NEW.account_status)
  EXECUTE FUNCTION rider_account_status_guard();

-- account.status is one person's status. Only a customer action changes it today;
-- erasing an account (DELETED) needs its own principal and rule when it ships.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT account_state_change_recorded('CUSTOMER', NEW.id, OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'account_state_change_unrecorded: account % moved from % to % with no history row; only internal/admin ApplyAccountAction changes it',
      NEW.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER account_status_owned
  AFTER UPDATE OF status ON account
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION account_status_guard();

-- +goose Down
DROP TRIGGER IF EXISTS account_status_owned ON account;
DROP FUNCTION IF EXISTS account_status_guard();
DROP TRIGGER IF EXISTS rider_account_status_owned ON rider_profile;
DROP FUNCTION IF EXISTS rider_account_status_guard();
DROP TRIGGER IF EXISTS restaurant_account_state_owned ON restaurant;
DROP FUNCTION IF EXISTS restaurant_account_state_guard();
DROP FUNCTION IF EXISTS account_state_change_recorded(account_subject_type, uuid, text, text);
DROP TRIGGER IF EXISTS account_state_event_actor_guard ON account_state_event;
DROP FUNCTION IF EXISTS account_state_event_guard_actor();
-- A system row has no person to restore NOT NULL with. Rolling back is a
-- development reset, so those rows go (the append-only trigger is lifted for it).
ALTER TABLE account_state_event DISABLE TRIGGER account_state_event_append_only;
DELETE FROM account_state_event WHERE actor_kind = 'SYSTEM';
ALTER TABLE account_state_event ENABLE TRIGGER account_state_event_append_only;
ALTER TABLE account_state_event
  DROP CONSTRAINT IF EXISTS account_state_event_actor,
  DROP COLUMN IF EXISTS system_actor,
  DROP COLUMN IF EXISTS actor_kind,
  ALTER COLUMN actor_account_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL;
DROP TABLE IF EXISTS account_state_rule;
