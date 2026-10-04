-- One owner for every change of an account's state, held by the database.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/253 (the security reviews
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
--      The application role may read it, never change it.
--   2. account_state_event names its actor: a staff member (actor_kind STAFF and
--      actor_account_id) or a system principal (actor_kind SYSTEM and
--      system_actor). A BEFORE INSERT trigger refuses a row whose transition is not
--      in account_state_rule; whose staff actor does not hold, now, an unrevoked
--      global grant of the role it needs on an active account; who acts on their
--      own account or their own restaurant; or who acts on a staff account as if it
--      were a customer's. Only the schema owner writes a system row, so the
--      application role cannot pose as a system principal: a system path reaches it
--      through an owner-defined SECURITY DEFINER function that decides the change
--      from the data itself. Each row is stamped with its transaction's id and
--      clock: it cannot be backdated into a ban proposal's 7-day window.
--   3. A deferred constraint trigger on each subject table refuses, at commit, any
--      change of the state with no authority for exactly that change: a history
--      row of the same transaction with the same subject, from state and to state
--      (and, for a restaurant, the same delisting reasons) that no other change has
--      used. Each accepted change is recorded in account_state_change, which only
--      the guards write, and which is what makes a history row usable once.
--   4. The one change with no history row is completing a restaurant's onboarding
--      (the ONBOARDING principal): account_state_complete_onboarding() checks the
--      onboarding gates and the halal certificate itself, records its authority in
--      account_state_change, and leaves PENDING for LIVE, or for DELISTED when the
--      certificate is not current. The application role can call it, never write
--      its authority, and no UPDATE of its own can take a restaurant out of PENDING.
--   5. A restaurant moves into LIVE only with a current halal certificate
--      (halal_status CERTIFIED or EXPIRING_SOON) and no delisting reason: "a
--      restaurant may never reach account_state = LIVE without an approved,
--      non-expired halal certificate"
--      (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling,
--      rule R4 and acceptance criterion 4), whichever path lists it.
--   6. Delisting reasons only clear when something entitled to clear them does: a
--      staff reinstatement clears any; the halal renewal and onboarding clear only
--      the certificate's own; with no state change, only the certificate's own and
--      only while the certificate is current. Adding a reason needs nothing.
--   7. A subject's key never changes, and a deleted subject that has a history
--      comes back only in the state its history left it in, so deleting and
--      re-inserting a banned rider does not lift the ban.
--
-- Every guard function pins search_path (public, then pg_temp), so the
-- application role cannot shadow a table with a temporary one; the guards that
-- write account_state_change are SECURITY DEFINER; and none of them is executable
-- by the application role. Two-step sign-in is a property of the caller's
-- session, which the database cannot see; ApplyAccountAction checks it, and a test
-- in internal/accountstate fails if any other Go file writes these columns or the
-- history. A superuser can still switch triggers off
-- (session_replication_role = replica); the application never connects as one.

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

REVOKE ALL ON account_state_rule FROM PUBLIC, hg_app;
GRANT SELECT ON account_state_rule TO hg_app, hg_readonly;

-- 2. The history names its actor and its transaction.
ALTER TABLE account_state_event
  ADD COLUMN actor_kind   text NOT NULL DEFAULT 'STAFF',
  ADD COLUMN system_actor text,
  -- The writing transaction (top level, so savepoints share it), stamped by the
  -- guard: a history row authorises a change only in its own transaction.
  ADD COLUMN xact_id      xid8,
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

-- 3. Every accepted change of an account's state, and what authorised it: the one
-- history row it used (each is used at most once), or completing onboarding.
-- Written only by the guards and account_state_complete_onboarding().
CREATE TABLE account_state_change (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subject_type  account_subject_type NOT NULL,
  subject_id    uuid NOT NULL,
  from_state    text NOT NULL,
  to_state      text NOT NULL,
  event_id      uuid UNIQUE REFERENCES account_state_event(id),
  -- STAFF, or SYSTEM:<name> as account_state_rule spells it, or SYSTEM:ONBOARDING.
  principal     text NOT NULL,
  xact_id       xid8 NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_state_change_authority
    CHECK ((event_id IS NULL) = (principal = 'SYSTEM:ONBOARDING'))
);
CREATE INDEX account_state_change_subject
  ON account_state_change (subject_type, subject_id, created_at DESC, id DESC);

REVOKE ALL ON account_state_change FROM PUBLIC, hg_app;
GRANT SELECT ON account_state_change TO hg_readonly;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_change_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'account_state_change_is_append_only: % on account_state_change is never permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
-- +goose StatementEnd

CREATE TRIGGER account_state_change_append_only
  BEFORE UPDATE OR DELETE ON account_state_change
  FOR EACH ROW EXECUTE FUNCTION account_state_change_reject_mutation();

-- The schema owner: the only role that may write a system principal's history.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_owner() RETURNS name
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT pg_catalog.pg_get_userbyid(c.relowner)
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.account_state_event'::pg_catalog.regclass
$$;
-- +goose StatementEnd

-- The history guard. SECURITY INVOKER on purpose: it must see who is writing
-- (current_user) to keep system rows to the owner. Its search_path is pinned.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_event_guard_actor() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  needs_super boolean;
BEGIN
  -- History is written when it happens, in the transaction that makes the change.
  NEW.created_at := now();
  NEW.xact_id := pg_catalog.pg_current_xact_id();

  IF NEW.actor_kind = 'SYSTEM' THEN
    IF current_user <> public.account_state_owner() THEN
      RAISE EXCEPTION 'account_state_system_actor_forged: % may not write history as the % principal; system paths write it through an owner-defined function',
        current_user, NEW.system_actor
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.account_state_rule k
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
    FROM public.account_state_rule k
   WHERE k.subject_type = NEW.subject_type AND k.action = NEW.action
     AND k.from_state = NEW.from_state AND k.to_state = NEW.to_state
     AND k.principal IN ('ADMIN', 'SUPER_ADMIN');
  IF needs_super IS NULL THEN
    RAISE EXCEPTION 'account_state_illegal_transition: staff cannot % a % from % to %',
      NEW.action, NEW.subject_type, NEW.from_state, NEW.to_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- ... and they must hold the role it needs now: a global grant, already in
  -- force and not revoked, on an account that is active and not deleted. Nothing
  -- the row carries counts.
  IF NOT EXISTS (
    SELECT 1
      FROM public.account_role ar
      JOIN public.account a ON a.id = ar.account_id
     WHERE ar.account_id = NEW.actor_account_id
       AND ar.scope_type = 'GLOBAL'
       AND ar.revoked_at IS NULL
       AND ar.granted_at <= now()
       AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
       AND (ar.role = 'SUPER_ADMIN' OR (ar.role = 'ADMIN' AND NOT needs_super))) THEN
    RAISE EXCEPTION 'account_state_actor_not_permitted: % % a % from % to % needs %',
      NEW.actor_account_id, NEW.action, NEW.subject_type, NEW.from_state, NEW.to_state,
      CASE WHEN needs_super THEN 'a super admin' ELSE 'an admin or a super admin' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Staff never act on their own account, nor on a restaurant they work for.
  IF (NEW.subject_type IN ('RIDER', 'CUSTOMER') AND NEW.subject_id = NEW.actor_account_id)
     OR (NEW.subject_type = 'RESTAURANT' AND EXISTS (
          SELECT 1 FROM public.account_role ar
           WHERE ar.account_id = NEW.actor_account_id AND ar.scope_type = 'RESTAURANT'
             AND ar.scope_id = NEW.subject_id AND ar.revoked_at IS NULL)) THEN
    RAISE EXCEPTION 'account_state_own_account: staff cannot act on their own account or their own restaurant'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A staff account is never suspended or banned as a customer: that would let an
  -- admin lock a super admin out.
  IF NEW.subject_type = 'CUSTOMER' AND EXISTS (
       SELECT 1 FROM public.account_role ar
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
-- the stamped created_at.
CREATE TRIGGER account_state_event_actor_guard
  BEFORE INSERT ON account_state_event
  FOR EACH ROW EXECUTE FUNCTION account_state_event_guard_actor();

-- 00034's guards read the history by name: pin their search_path too, so a
-- temporary table cannot stand in for it.
ALTER FUNCTION account_state_event_guard_ban() SET search_path = public, pg_temp;
ALTER FUNCTION account_state_event_reject_mutation() SET search_path = public, pg_temp;

-- Uses one unused history row of this transaction for exactly this change, records
-- the change, and returns the row (NULL when there is none).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_use_event(
  p_subject account_subject_type, p_subject_id uuid, p_from text, p_to text, p_delist text[])
RETURNS public.account_state_event
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev public.account_state_event;
BEGIN
  SELECT e.* INTO ev
    FROM public.account_state_event e
   WHERE e.subject_type = p_subject AND e.subject_id = p_subject_id
     AND e.from_state = p_from AND e.to_state = p_to
     AND e.xact_id = pg_catalog.pg_current_xact_id()
     AND (p_delist IS NULL OR e.delist_reasons = p_delist)
     AND NOT EXISTS (SELECT 1 FROM public.account_state_change c WHERE c.event_id = e.id)
   ORDER BY e.created_at, e.id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.account_state_change (subject_type, subject_id, from_state, to_state, event_id, principal, xact_id)
  VALUES (p_subject, p_subject_id, p_from, p_to, ev.id,
          CASE ev.actor_kind WHEN 'STAFF' THEN 'STAFF' ELSE 'SYSTEM:' || ev.system_actor END,
          pg_catalog.pg_current_xact_id());
  RETURN ev;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION restaurant_account_state_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  halal_reasons constant text[] := ARRAY['HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED'];
  lost text[];
  ev   public.account_state_event;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'account_state_subject_key_changed: restaurant % cannot change its id', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT coalesce(array_agg(r), '{}') INTO lost
    FROM unnest(OLD.delist_reasons) AS r
   WHERE NOT (r = ANY (NEW.delist_reasons));

  IF OLD.account_state IS DISTINCT FROM NEW.account_state THEN
    ev := public.account_state_use_event('RESTAURANT', NEW.id, OLD.account_state::text,
                                         NEW.account_state::text, NEW.delist_reasons);
    IF ev.id IS NOT NULL THEN
      -- Only a reinstatement clears reasons: any, by staff; the certificate's own,
      -- by the halal renewal.
      IF cardinality(lost) > 0
         AND NOT (ev.action = 'REINSTATE' AND (ev.actor_kind = 'STAFF' OR lost <@ halal_reasons)) THEN
        RAISE EXCEPTION 'account_state_delist_reason_unrecorded: % cannot clear the delisting reasons % of restaurant %',
          ev.action, lost, NEW.id
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSIF NOT (OLD.account_state = 'PENDING' AND NEW.account_state IN ('LIVE', 'DELISTED')
               AND OLD.onboarding_state <> 'ACTIVE' AND NEW.onboarding_state = 'ACTIVE'
               AND lost <@ halal_reasons
               AND EXISTS (
                 SELECT 1 FROM public.account_state_change c
                  WHERE c.subject_type = 'RESTAURANT' AND c.subject_id = NEW.id
                    AND c.from_state = 'PENDING' AND c.to_state = NEW.account_state::text
                    AND c.principal = 'SYSTEM:ONBOARDING'
                    AND c.xact_id = pg_catalog.pg_current_xact_id())) THEN
      RAISE EXCEPTION 'account_state_change_unrecorded: restaurant % moved from % to % with no history row of this transaction for exactly that change; only internal/admin ApplyAccountAction, account_state_complete_onboarding() and the halal principals change it',
        NEW.id, OLD.account_state, NEW.account_state
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.account_state = 'LIVE' AND NEW.halal_status NOT IN ('CERTIFIED', 'EXPIRING_SOON') THEN
      RAISE EXCEPTION 'account_state_live_needs_halal_certificate: restaurant % cannot be listed with halal status %',
        NEW.id, NEW.halal_status
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF cardinality(lost) > 0
        AND NOT (lost <@ halal_reasons AND NEW.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')) THEN
    RAISE EXCEPTION 'account_state_delist_reason_unrecorded: restaurant % lost the delisting reasons % with no reinstatement',
      NEW.id, lost
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.account_state = 'LIVE' AND cardinality(NEW.delist_reasons) > 0 THEN
    RAISE EXCEPTION 'account_state_live_with_delist_reasons: restaurant % cannot be listed while delisted for %',
      NEW.id, NEW.delist_reasons
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

-- No column list: a column list would miss a value set by another BEFORE trigger.
CREATE CONSTRAINT TRIGGER restaurant_account_state_owned
  AFTER UPDATE ON restaurant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.account_state IS DISTINCT FROM NEW.account_state
        OR OLD.delist_reasons IS DISTINCT FROM NEW.delist_reasons
        OR OLD.id IS DISTINCT FROM NEW.id)
  EXECUTE FUNCTION restaurant_account_state_guard();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION rider_account_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev public.account_state_event;
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'account_state_subject_key_changed: rider % cannot change its account', OLD.account_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  ev := public.account_state_use_event('RIDER', NEW.account_id, OLD.account_status::text,
                                       NEW.account_status::text, NULL);
  IF ev.id IS NULL THEN
    RAISE EXCEPTION 'account_state_change_unrecorded: rider % moved from % to % with no history row of this transaction for exactly that change; only internal/admin ApplyAccountAction changes it',
      NEW.account_id, OLD.account_status, NEW.account_status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER rider_account_status_owned
  AFTER UPDATE ON rider_profile
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.account_status IS DISTINCT FROM NEW.account_status
        OR OLD.account_id IS DISTINCT FROM NEW.account_id)
  EXECUTE FUNCTION rider_account_status_guard();

-- account.status is one person's status. Only a customer action changes it today;
-- erasing an account (DELETED) needs its own principal and rule when it ships.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ev public.account_state_event;
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'account_state_subject_key_changed: account % cannot change its id', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  ev := public.account_state_use_event('CUSTOMER', NEW.id, OLD.status::text, NEW.status::text, NULL);
  IF ev.id IS NULL THEN
    RAISE EXCEPTION 'account_state_change_unrecorded: account % moved from % to % with no history row of this transaction for exactly that change; only internal/admin ApplyAccountAction changes it',
      NEW.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER account_status_owned
  AFTER UPDATE ON account
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.id IS DISTINCT FROM NEW.id)
  EXECUTE FUNCTION account_status_guard();

-- 7. A subject that has a history comes back, after a delete, only in the state
-- that history left it in. TG_ARGV: subject type, key column, state column.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_reinsert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id    uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  v_state text := to_jsonb(NEW) ->> TG_ARGV[2];
  last    text;
BEGIN
  SELECT c.to_state INTO last
    FROM public.account_state_change c
   WHERE c.subject_type = TG_ARGV[0]::public.account_subject_type AND c.subject_id = v_id
   ORDER BY c.created_at DESC, c.id DESC
   LIMIT 1;
  IF FOUND AND last IS DISTINCT FROM v_state THEN
    RAISE EXCEPTION 'account_state_reinsert: % % was % when it was removed and cannot come back %',
      TG_ARGV[0], v_id, last, v_state
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER restaurant_account_state_reinsert
  BEFORE INSERT ON restaurant
  FOR EACH ROW EXECUTE FUNCTION account_state_reinsert_guard('RESTAURANT', 'id', 'account_state');
CREATE TRIGGER rider_account_status_reinsert
  BEFORE INSERT ON rider_profile
  FOR EACH ROW EXECUTE FUNCTION account_state_reinsert_guard('RIDER', 'account_id', 'account_status');
CREATE TRIGGER account_status_reinsert
  BEFORE INSERT ON account
  FOR EACH ROW EXECUTE FUNCTION account_state_reinsert_guard('CUSTOMER', 'id', 'status');

-- 4. Completing a restaurant's onboarding: the ONBOARDING principal. The function
-- decides everything from the data (the onboarding gates, the account state, the
-- halal certificate), so the application role may call it but cannot steer it.
-- It lists the restaurant only with a current, admin-verified certificate and no
-- other delisting reason, the rule an admin reinstating it follows
-- (accountstate.ReinstatedState); otherwise it is DELISTED with the certificate's
-- reason. A restaurant that is not PENDING keeps its account state.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_complete_onboarding(p_restaurant_id uuid)
RETURNS TABLE (from_state text, to_state text, delist_before text[], delist_after text[], halal_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r        record;
  c        record;
  today    date;
  is_current boolean;
  lapse    text;
  reasons  text[];
  v_to     text;
BEGIN
  SELECT x.id, x.onboarding_state, x.account_state, x.delist_reasons, x.timezone, x.halal_status,
         EXISTS (SELECT 1 FROM public.connect_account ca
                  WHERE ca.owner_type = 'RESTAURANT' AND ca.owner_id = x.id
                    AND ca.payouts_enabled AND ca.details_submitted) AS payout_ready,
         EXISTS (SELECT 1 FROM public.menu_item mi
                  WHERE mi.restaurant_id = x.id AND mi.live_version_id IS NOT NULL
                    AND mi.deleted_at IS NULL) AS has_live_item,
         EXISTS (SELECT 1 FROM public.restaurant_hours h WHERE h.restaurant_id = x.id) AS has_hours
    INTO r
    FROM public.restaurant x
   WHERE x.id = p_restaurant_id
     FOR UPDATE OF x;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_state_complete_onboarding: no restaurant %', p_restaurant_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF r.onboarding_state NOT IN ('DOCUMENTS_APPROVED', 'PAYOUT_PENDING', 'MENU_PENDING')
     OR NOT (r.payout_ready AND r.has_live_item AND r.has_hours) THEN
    RAISE EXCEPTION 'account_state_onboarding_incomplete: restaurant % is %, payout ready %, live item %, hours %',
      p_restaurant_id, r.onboarding_state, r.payout_ready, r.has_live_item, r.has_hours
      USING ERRCODE = 'check_violation';
  END IF;

  IF r.account_state <> 'PENDING' THEN
    UPDATE public.restaurant SET onboarding_state = 'ACTIVE', updated_at = now() WHERE id = p_restaurant_id;
    RETURN QUERY SELECT r.account_state::text, r.account_state::text, r.delist_reasons, r.delist_reasons,
                        r.halal_status::text;
    RETURN;
  END IF;

  -- The certificate, as internal/admin and the order path read it: APPROVED (or
  -- later EXPIRED), verified by an admin, from an ACCEPTED issuing body.
  SELECT hc.status, hc.expires_on, hc.grace_until INTO c
    FROM public.halal_certificate hc
    JOIN public.halal_issuing_body b ON b.id = hc.issuing_body_id
   WHERE hc.restaurant_id = p_restaurant_id
     AND hc.status IN ('APPROVED', 'EXPIRED')
     AND hc.verified_by IS NOT NULL AND hc.verified_at IS NOT NULL
     AND b.status = 'ACCEPTED' AND hc.deleted_at IS NULL
   ORDER BY (hc.status = 'APPROVED') DESC, hc.expires_on DESC, hc.id DESC
   LIMIT 1;
  -- Valid through its last day in the restaurant's timezone; an unknown zone
  -- takes the latest date anywhere (UTC+14), as accountstate.LocalDate does.
  BEGIN
    today := (now() AT TIME ZONE r.timezone)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    today := ((now() AT TIME ZONE 'UTC') + interval '14 hours')::date;
  END;
  is_current := coalesce(c.status = 'APPROVED' AND coalesce(c.grace_until, c.expires_on) >= today, false);

  reasons := ARRAY(SELECT x FROM unnest(r.delist_reasons) AS x
                    WHERE NOT (is_current AND x IN ('HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED')));
  IF NOT is_current THEN
    lapse := CASE WHEN c.status IS NULL THEN 'HALAL_CERTIFICATE_UNVERIFIED' ELSE 'HALAL_CERTIFICATE_EXPIRED' END;
    IF NOT (lapse = ANY (reasons)) THEN
      reasons := reasons || lapse;
    END IF;
  END IF;
  v_to := CASE WHEN cardinality(reasons) = 0 THEN 'LIVE' ELSE 'DELISTED' END;

  INSERT INTO public.account_state_change (subject_type, subject_id, from_state, to_state, principal, xact_id)
  VALUES ('RESTAURANT', p_restaurant_id, 'PENDING', v_to, 'SYSTEM:ONBOARDING', pg_catalog.pg_current_xact_id());
  UPDATE public.restaurant
     SET onboarding_state = 'ACTIVE', account_state = v_to::public.restaurant_account_state,
         delist_reasons = reasons, updated_at = now()
   WHERE id = p_restaurant_id;
  RETURN QUERY SELECT 'PENDING'::text, v_to, r.delist_reasons, reasons, r.halal_status::text;
END
$$;
-- +goose StatementEnd

-- Privileges: the application role calls the onboarding function and nothing else
-- here directly; trigger functions run without EXECUTE.
REVOKE ALL ON FUNCTION account_state_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_event_guard_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_event_guard_ban() FROM PUBLIC, hg_app;
REVOKE ALL ON FUNCTION account_state_event_reject_mutation() FROM PUBLIC, hg_app;
REVOKE ALL ON FUNCTION account_state_change_reject_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_use_event(account_subject_type, uuid, text, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION restaurant_account_state_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION rider_account_status_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_status_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_reinsert_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_complete_onboarding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION account_state_complete_onboarding(uuid) TO hg_app;
-- The history guard runs as its caller and asks who the owner is.
GRANT EXECUTE ON FUNCTION account_state_owner() TO hg_app;

-- +goose Down
REVOKE ALL ON FUNCTION account_state_owner() FROM hg_app;
DROP FUNCTION IF EXISTS account_state_complete_onboarding(uuid);
DROP TRIGGER IF EXISTS account_status_reinsert ON account;
DROP TRIGGER IF EXISTS rider_account_status_reinsert ON rider_profile;
DROP TRIGGER IF EXISTS restaurant_account_state_reinsert ON restaurant;
DROP FUNCTION IF EXISTS account_state_reinsert_guard();
DROP TRIGGER IF EXISTS account_status_owned ON account;
DROP FUNCTION IF EXISTS account_status_guard();
DROP TRIGGER IF EXISTS rider_account_status_owned ON rider_profile;
DROP FUNCTION IF EXISTS rider_account_status_guard();
DROP TRIGGER IF EXISTS restaurant_account_state_owned ON restaurant;
DROP FUNCTION IF EXISTS restaurant_account_state_guard();
DROP FUNCTION IF EXISTS account_state_use_event(account_subject_type, uuid, text, text, text[]);
ALTER FUNCTION account_state_event_reject_mutation() RESET search_path;
ALTER FUNCTION account_state_event_guard_ban() RESET search_path;
GRANT EXECUTE ON FUNCTION account_state_event_guard_ban() TO PUBLIC;
GRANT EXECUTE ON FUNCTION account_state_event_reject_mutation() TO PUBLIC;
DROP TRIGGER IF EXISTS account_state_event_actor_guard ON account_state_event;
DROP FUNCTION IF EXISTS account_state_event_guard_actor();
DROP FUNCTION IF EXISTS account_state_owner();
DROP TABLE IF EXISTS account_state_change;
DROP FUNCTION IF EXISTS account_state_change_reject_mutation();
-- A system row has no person to restore NOT NULL with. Rolling back is a
-- development reset, so those rows go (the append-only trigger is lifted for it).
ALTER TABLE account_state_event DISABLE TRIGGER account_state_event_append_only;
DELETE FROM account_state_event WHERE actor_kind = 'SYSTEM';
ALTER TABLE account_state_event ENABLE TRIGGER account_state_event_append_only;
ALTER TABLE account_state_event
  DROP CONSTRAINT IF EXISTS account_state_event_actor,
  DROP COLUMN IF EXISTS xact_id,
  DROP COLUMN IF EXISTS system_actor,
  DROP COLUMN IF EXISTS actor_kind,
  ALTER COLUMN actor_account_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL;
DROP TABLE IF EXISTS account_state_rule;
