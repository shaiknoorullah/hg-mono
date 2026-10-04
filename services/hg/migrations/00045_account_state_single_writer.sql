-- One owner for every change of an account's state, held by privileges.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/253 (the security reviews
-- of https://github.com/shaiknoorullah/hg-mono/pull/335).
--
-- Migration 00044 gave the admin account actions their gates: an admin or super
-- admin, two-step sign-in, a second super admin to confirm a ban, and never your
-- own account. But the states were plain columns any code could UPDATE. This
-- migration makes the state columns unwritable by the application role and gives
-- it, instead, a handful of functions that are the only writers:
--
--   1. Privileges. hg_app may not UPDATE restaurant.account_state or
--      delist_reasons, rider_profile.account_status, or account.status and
--      status_reason, nor any of those tables' keys; it may not name a state column
--      in an INSERT (a new row starts in its default state: PENDING, PENDING,
--      ACTIVE); and it may not DELETE from those tables, so a banned account cannot
--      be removed and created again. It keeps UPDATE and INSERT on every other
--      column. It may not write the history (account_state_event) or the rules.
--   2. account_state_apply(): the one writer for a staff member's action. It takes
--      the raw access token of the request, not an account id: it hashes the token
--      itself and finds the session the token was issued for, which must be live
--      (not revoked, not expired) and signed in with two-step sign-in. That
--      session's account is the actor. The application role holds only token
--      hashes (session.access_hash, written when the token is issued) and cannot
--      rewrite a session's account, sign-in method, expiry or hashes, so it cannot
--      name an actor of its choosing. The function then reads the actor's grants
--      as they stand (a global, unrevoked grant already in force, carried by the
--      token, on an active account whose staff profile is not suspended), checks
--      the transition against account_state_rule (the same list as
--      accountstate.Transitions() in Go; a test holds them equal), refuses the
--      actor's own account or restaurant and a staff account treated as a rider or
--      a customer, enforces the two-person ban (a different person, who did not
--      grant the proposer's staff role or receive theirs from the proposer, and
--      who was a super admin before the proposal), decides a restaurant's listing
--      from its halal certificate itself, and writes the state, the history row and
--      the audit row (naming the proven session) together.
--   3. The system principals take no actor and no action: completing onboarding,
--      the halal certificate lapsing, a renewal clearing it, and a certifying
--      body's acceptance withdrawn or given back are each a function that decides
--      the change from the data and can make only that change.
--   4. A listed restaurant carries no delisting reason (CHECK).
--
-- No trigger guards the state: the privileges do. Every function is owned by the
-- migrations' role, pins search_path (pg_catalog, public, then pg_temp last, so a
-- temporary table cannot stand in for a real one) and names every object with its
-- schema; none is executable by PUBLIC, and hg_app may execute only the five
-- writers. What the database cannot know is whether the second factor was really
-- checked: the password (argon2id) and the TOTP secret (sealed with APP_DATA_KEY)
-- are verified by the application, which also writes the session rows at sign-in.
-- A connection that can INSERT a whole session row can still mint one; a single
-- injected query cannot (https://github.com/shaiknoorullah/hg-mono/issues/372).

-- +goose Up

-- Who may take which transition. ADMIN: an admin or a super admin. SUPER_ADMIN: a
-- super admin only. SYSTEM:<name>: the system principal accountstate.System names.
CREATE TABLE account_state_rule (
  subject_type account_subject_type NOT NULL,
  action       account_action NOT NULL,
  from_state   text NOT NULL,
  to_state     text NOT NULL,
  principal    text NOT NULL,
  -- The permission the admin spec names for the transition; also the audit action.
  permission   text NOT NULL,
  -- The one reason a system principal gives; NULL for staff.
  reason_code  text,
  CONSTRAINT account_state_rule_principal
    CHECK (principal IN ('ADMIN', 'SUPER_ADMIN', 'SYSTEM:HALAL_EXPIRY', 'SYSTEM:HALAL_RENEWAL',
                         'SYSTEM:HALAL_ISSUER')),
  CONSTRAINT account_state_rule_system_reason
    CHECK ((principal LIKE 'SYSTEM:%') = (reason_code IS NOT NULL))
);
CREATE UNIQUE INDEX account_state_rule_unique
  ON account_state_rule (subject_type, action, from_state, to_state, principal, coalesce(reason_code, ''));

INSERT INTO account_state_rule (subject_type, action, from_state, to_state, principal, permission, reason_code) VALUES
  -- Restaurants (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-22--restaurant-account-state-actions-suspend--ban--deactivate--reinstate--delist).
  ('RESTAURANT', 'SUSPEND',     'LIVE',        'SUSPENDED',   'ADMIN',       'restaurant.suspend', NULL),
  ('RESTAURANT', 'SUSPEND',     'DELISTED',    'SUSPENDED',   'ADMIN',       'restaurant.suspend', NULL),
  ('RESTAURANT', 'DELIST',      'LIVE',        'DELISTED',    'ADMIN',       'restaurant.delist', NULL),
  ('RESTAURANT', 'PROPOSE_BAN', 'LIVE',        'SUSPENDED',   'ADMIN',       'restaurant.propose_ban', NULL),
  ('RESTAURANT', 'PROPOSE_BAN', 'DELISTED',    'SUSPENDED',   'ADMIN',       'restaurant.propose_ban', NULL),
  ('RESTAURANT', 'PROPOSE_BAN', 'SUSPENDED',   'SUSPENDED',   'ADMIN',       'restaurant.propose_ban', NULL),
  ('RESTAURANT', 'CONFIRM_BAN', 'SUSPENDED',   'BANNED',      'SUPER_ADMIN', 'restaurant.confirm_ban', NULL),
  ('RESTAURANT', 'DEACTIVATE',  'LIVE',        'DEACTIVATED', 'ADMIN',       'restaurant.deactivate_on_request', NULL),
  ('RESTAURANT', 'DEACTIVATE',  'DELISTED',    'DEACTIVATED', 'ADMIN',       'restaurant.deactivate_on_request', NULL),
  -- Reinstating lands on DELISTED instead of LIVE while a delisting reason
  -- remains or the halal certificate is not current.
  ('RESTAURANT', 'REINSTATE',   'SUSPENDED',   'LIVE',        'ADMIN',       'restaurant.reinstate', NULL),
  ('RESTAURANT', 'REINSTATE',   'SUSPENDED',   'DELISTED',    'ADMIN',       'restaurant.reinstate', NULL),
  ('RESTAURANT', 'REINSTATE',   'DEACTIVATED', 'LIVE',        'ADMIN',       'restaurant.reinstate', NULL),
  ('RESTAURANT', 'REINSTATE',   'DEACTIVATED', 'DELISTED',    'ADMIN',       'restaurant.reinstate', NULL),
  ('RESTAURANT', 'REINSTATE',   'DELISTED',    'LIVE',        'ADMIN',       'restaurant.reinstate', NULL),
  ('RESTAURANT', 'REINSTATE',   'BANNED',      'LIVE',        'SUPER_ADMIN', 'restaurant.unban', NULL),
  ('RESTAURANT', 'REINSTATE',   'BANNED',      'DELISTED',    'SUPER_ADMIN', 'restaurant.unban', NULL),
  -- Riders (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-27--rider-account-state-actions).
  ('RIDER',      'SUSPEND',     'ACTIVE',      'SUSPENDED',   'ADMIN',       'rider.suspend', NULL),
  ('RIDER',      'PROPOSE_BAN', 'ACTIVE',      'SUSPENDED',   'ADMIN',       'rider.propose_ban', NULL),
  ('RIDER',      'PROPOSE_BAN', 'SUSPENDED',   'SUSPENDED',   'ADMIN',       'rider.propose_ban', NULL),
  ('RIDER',      'CONFIRM_BAN', 'SUSPENDED',   'BANNED',      'SUPER_ADMIN', 'rider.confirm_ban', NULL),
  ('RIDER',      'DEACTIVATE',  'ACTIVE',      'DEACTIVATED', 'ADMIN',       'rider.deactivate_on_request', NULL),
  ('RIDER',      'DEACTIVATE',  'SUSPENDED',   'DEACTIVATED', 'ADMIN',       'rider.deactivate_on_request', NULL),
  ('RIDER',      'REINSTATE',   'SUSPENDED',   'ACTIVE',      'ADMIN',       'rider.reinstate', NULL),
  ('RIDER',      'REINSTATE',   'DEACTIVATED', 'ACTIVE',      'ADMIN',       'rider.reinstate', NULL),
  ('RIDER',      'REINSTATE',   'BANNED',      'ACTIVE',      'SUPER_ADMIN', 'rider.unban', NULL),
  -- Customers (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-28--customer-account-state-actions).
  ('CUSTOMER',   'SUSPEND',     'ACTIVE',      'SUSPENDED',   'ADMIN',       'customer.suspend', NULL),
  ('CUSTOMER',   'PROPOSE_BAN', 'ACTIVE',      'SUSPENDED',   'ADMIN',       'customer.propose_ban', NULL),
  ('CUSTOMER',   'PROPOSE_BAN', 'SUSPENDED',   'SUSPENDED',   'ADMIN',       'customer.propose_ban', NULL),
  ('CUSTOMER',   'CONFIRM_BAN', 'SUSPENDED',   'BANNED',      'SUPER_ADMIN', 'customer.confirm_ban', NULL),
  ('CUSTOMER',   'REINSTATE',   'SUSPENDED',   'ACTIVE',      'ADMIN',       'customer.reinstate', NULL),
  ('CUSTOMER',   'REINSTATE',   'BANNED',      'ACTIVE',      'SUPER_ADMIN', 'customer.unban', NULL),
  -- System principals (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling):
  -- the expiry only delists; the renewal only lists a delisted restaurant again.
  ('RESTAURANT', 'DELIST',      'LIVE',        'DELISTED',    'SYSTEM:HALAL_EXPIRY',  'restaurant.delisted', 'HALAL_CERTIFICATE_EXPIRED'),
  ('RESTAURANT', 'REINSTATE',   'DELISTED',    'LIVE',        'SYSTEM:HALAL_RENEWAL', 'restaurant.relisted', 'ISSUE_RESOLVED'),
  -- A certifying body's acceptance withdrawn or given back
  -- (https://github.com/shaiknoorullah/hg-mono/issues/355): delist when no
  -- certificate from an accepted body vouches any more, relist when one does.
  ('RESTAURANT', 'DELIST',      'LIVE',        'DELISTED',    'SYSTEM:HALAL_ISSUER',  'restaurant.delisted', 'HALAL_CERTIFICATE_UNVERIFIED'),
  ('RESTAURANT', 'DELIST',      'LIVE',        'DELISTED',    'SYSTEM:HALAL_ISSUER',  'restaurant.delisted', 'HALAL_CERTIFICATE_EXPIRED'),
  ('RESTAURANT', 'REINSTATE',   'DELISTED',    'LIVE',        'SYSTEM:HALAL_ISSUER',  'restaurant.relisted', 'ISSUE_RESOLVED');

-- The history names its actor: a staff member, or a system principal.
ALTER TABLE account_state_event
  ADD COLUMN actor_kind   text NOT NULL DEFAULT 'STAFF',
  ADD COLUMN system_actor text,
  ALTER COLUMN actor_account_id DROP NOT NULL,
  ALTER COLUMN idempotency_key DROP NOT NULL,
  ALTER COLUMN request_hash DROP NOT NULL,
  ADD CONSTRAINT account_state_event_actor CHECK (
    (actor_kind = 'STAFF' AND actor_account_id IS NOT NULL AND system_actor IS NULL
       AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
    OR (actor_kind = 'SYSTEM' AND actor_account_id IS NULL
       AND system_actor IN ('HALAL_EXPIRY', 'HALAL_RENEWAL', 'HALAL_ISSUER'))
  ),
  -- A restaurant can also be delisted because no certificate counts at all.
  DROP CONSTRAINT account_state_event_reason_code,
  ADD CONSTRAINT account_state_event_reason_code CHECK (CASE subject_type
    WHEN 'RESTAURANT' THEN reason_code IN (
      'COMPLIANCE_THRESHOLD', 'HALAL_INTEGRITY', 'FOOD_SAFETY_RISK', 'FRAUD_SUSPECTED',
      'PAYMENT_OR_SETTLEMENT_ISSUE', 'ABUSIVE_CONDUCT', 'LEGAL_ORDER', 'REPEATED_VIOLATIONS',
      'HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED', 'DOCUMENT_EXPIRED',
      'NO_APPROVED_MENU', 'MERCHANT_REQUEST', 'ISSUE_RESOLVED', 'APPEAL_UPHELD',
      'ACTIONED_IN_ERROR', 'OTHER')
    WHEN 'RIDER' THEN reason_code IN (
      'DOCUMENT_EXPIRED', 'INCIDENT_UNDER_INVESTIGATION', 'SAFETY_RISK', 'FRAUD_SUSPECTED',
      'REPEATED_CANCELLATIONS', 'ABUSIVE_CONDUCT', 'LOW_PERFORMANCE', 'ACCOUNT_SHARING',
      'LEGAL_ORDER', 'RIDER_REQUEST', 'ISSUE_RESOLVED', 'APPEAL_UPHELD', 'ACTIONED_IN_ERROR',
      'OTHER')
    WHEN 'CUSTOMER' THEN reason_code IN (
      'PAYMENT_FAILURE_UNRESOLVED', 'REFUND_ABUSE', 'FRAUDULENT_CHARGEBACK',
      'ABUSIVE_CONDUCT_TO_RIDER', 'ABUSIVE_CONDUCT_TO_RESTAURANT', 'FAKE_REVIEWS',
      'ACCOUNT_TAKEOVER_RISK', 'PROMOTION_ABUSE', 'LEGAL_ORDER', 'ISSUE_RESOLVED',
      'APPEAL_UPHELD', 'ACTIONED_IN_ERROR', 'OTHER')
  END);

-- A listed restaurant carries no delisting reason.
ALTER TABLE restaurant
  ADD CONSTRAINT restaurant_live_has_no_delist_reasons
  CHECK (account_state <> 'LIVE' OR cardinality(delist_reasons) = 0);

-- 00044's guards read the history by name: pin their search_path.
ALTER FUNCTION account_state_event_guard_ban() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION account_state_event_reject_mutation() SET search_path = pg_catalog, public, pg_temp;

-- The application role's rights on the account tables: UPDATE on every column but
-- the state and the key, INSERT on every column but the state, no DELETE. A
-- migration that adds a column to restaurant, rider_profile or account calls this
-- again, or the column is not writable by the API (a test in internal/admin fails).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_grant_app_columns() RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t       record;
  upd     text;
  ins     text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('restaurant',    ARRAY['account_state', 'delist_reasons'], ARRAY['id']),
      ('rider_profile', ARRAY['account_status'],                 ARRAY['account_id']),
      ('account',       ARRAY['status', 'status_reason'],         ARRAY['id'])
    ) AS v(tbl, state_cols, key_cols)
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM hg_app', t.tbl);
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
             FILTER (WHERE NOT (a.attname = ANY (t.state_cols || t.key_cols))),
           string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
             FILTER (WHERE NOT (a.attname = ANY (t.state_cols)))
      INTO upd, ins
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = ('public.' || t.tbl)::pg_catalog.regclass
       AND a.attnum > 0 AND NOT a.attisdropped;
    EXECUTE format('GRANT UPDATE (%s) ON public.%I TO hg_app', upd, t.tbl);
    EXECUTE format('GRANT INSERT (%s) ON public.%I TO hg_app', ins, t.tbl);
  END LOOP;
END
$$;
-- +goose StatementEnd

SELECT account_state_grant_app_columns();
-- The history and the rules are written only by the functions below.
REVOKE INSERT ON account_state_event FROM hg_app;
REVOKE ALL ON account_state_rule FROM PUBLIC, hg_app;
GRANT SELECT ON account_state_rule TO hg_readonly;

-- Close the back door the column REVOKEs above would otherwise leave open: an
-- updatable view onto a guarded table. A view runs its reads and writes with
-- the view owner's rights, not the caller's, unless it is told to use the
-- caller's (security_invoker). halal_status_inconsistency (00009) is a simple,
-- therefore auto-updatable, view SELECTing from restaurant, and 00023 granted
-- hg_app INSERT/UPDATE/DELETE on every table in the schema, views included. So
-- hg_app, which the REVOKEs above forbid from writing restaurant directly,
-- could still DELETE a restaurant through this view (deleting and recreating a
-- banned one -- the very thing the no-DELETE rule exists to stop) or rewrite
-- its primary key, none of it touching restaurant by name. Two locks, either
-- of which alone is enough: the view now runs with the caller's own rights, so
-- a write through it is the app role's write on restaurant and the column
-- REVOKEs catch it; and the app role is granted no write on the view at all.
-- It is the only updatable view onto any guarded table (restaurant,
-- rider_profile, account, session); a test in internal/admin holds that true,
-- so a later updatable view onto one of them is caught.
ALTER VIEW halal_status_inconsistency SET (security_invoker = on);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON halal_status_inconsistency FROM hg_app;

-- The proof a staff action rides on. When the API signs an access token it writes
-- the token's SHA-256 onto the session row it signs it for (internal/auth,
-- issueSession and Refresh); the token itself is stored nowhere, so the
-- application's role reads only hashes. account_state_apply() takes the raw token
-- and hashes it itself.
ALTER TABLE session ADD COLUMN access_hash bytea;
CREATE UNIQUE INDEX session_access_hash ON session (access_hash) WHERE access_hash IS NOT NULL;
-- The application role may rotate and end a session, nothing else: it cannot
-- change whose session it is, how it was signed in, when it expires, or its hashes.
REVOKE UPDATE ON session FROM hg_app;
GRANT UPDATE (rotated_at, rotated_to, last_used_at, revoked_at, revoke_reason) ON session TO hg_app;

-- Whether a restaurant's admin-verified halal certificate is current today, in
-- its timezone: CURRENT, EXPIRED, or UNVERIFIED (none). The same reading as
-- internal/admin and the order path: APPROVED (or later EXPIRED), verified by an
-- admin, from an ACCEPTED issuing body; valid through its last day (grace_until
-- when a super admin granted one); an unknown zone takes the latest date anywhere.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_certificate(p_restaurant_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c     record;
  tz    text;
  today date;
BEGIN
  SELECT x.timezone INTO tz FROM public.restaurant x WHERE x.id = p_restaurant_id;
  SELECT hc.status::text AS status, hc.expires_on, hc.grace_until INTO c
    FROM public.halal_certificate hc
    JOIN public.halal_issuing_body b ON b.id = hc.issuing_body_id
   WHERE hc.restaurant_id = p_restaurant_id
     AND hc.status IN ('APPROVED', 'EXPIRED')
     AND hc.verified_by IS NOT NULL AND hc.verified_at IS NOT NULL
     AND b.status = 'ACCEPTED' AND hc.deleted_at IS NULL
   ORDER BY (hc.status = 'APPROVED') DESC, hc.expires_on DESC, hc.id DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'UNVERIFIED';
  END IF;
  BEGIN
    today := (pg_catalog.now() AT TIME ZONE tz)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    today := NULL;
  END;
  IF today IS NULL THEN
    today := ((pg_catalog.now() AT TIME ZONE 'UTC') + interval '14 hours')::date;
  END IF;
  RETURN CASE WHEN c.status = 'APPROVED' AND coalesce(c.grace_until, c.expires_on) >= today
              THEN 'CURRENT' ELSE 'EXPIRED' END;
END
$$;
-- +goose StatementEnd

-- One audit row, as internal/admin's writeAudit writes it; the audit trigger
-- computes the day, the sequence and the hash chain.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_audit(
  p_actor_kind text, p_actor uuid, p_roles jsonb, p_action text, p_subject_type text,
  p_subject_id uuid, p_reason_code text, p_reason text, p_before jsonb, p_after jsonb, p_request jsonb)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, public, pg_temp AS $$
  INSERT INTO public.audit_event
    (actor_kind, actor_account_id, actor_roles, action, subject_type, subject_id, outcome,
     reason_code, reason, before, after, request_id, session_id, ip, user_agent,
     day, seq, prev_hash, hash)
  VALUES
    (p_actor_kind, p_actor, p_roles, p_action, p_subject_type, p_subject_id, 'SUCCESS',
     p_reason_code, p_reason, p_before, p_after,
     nullif(p_request ->> 'request_id', ''), nullif(p_request ->> 'session_id', '')::uuid,
     nullif(p_request ->> 'ip', '')::inet, nullif(p_request ->> 'user_agent', ''),
     current_date, 0, '\x00'::bytea, '\x00'::bytea)
$$;
-- +goose StatementEnd

-- The one writer for a staff member's account action. internal/admin's
-- ApplyAccountAction settles the work in progress, then calls this in the same
-- transaction with the request's access token; this decides and writes the state.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_apply(
  p_subject_type     account_subject_type,
  p_subject_id       uuid,
  p_action           account_action,
  p_access_token     text,
  p_reason_code      text,
  p_reason_text      text,
  p_idempotency_key  text,
  p_request_hash     bytea,
  p_in_flight        jsonb,
  p_request          jsonb)
RETURNS TABLE (event_id uuid, from_state text, to_state text, delist_reasons text[],
               sessions_revoked int, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  halal       constant text[] := ARRAY['HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED'];
  claims      jsonb;
  expires     timestamptz;
  v_actor     uuid;
  v_session   uuid;
  is_admin    boolean;
  is_super    boolean;
  roles       jsonb;
  v_from      text;
  v_to        text;
  v_reasons   text[] := '{}';
  v_new       text[];
  v_onboard   text;
  v_located   boolean;
  last_action text;
  last_actor  uuid;
  last_at     timestamptz;
  proposed    boolean;
  rule_super  boolean;
  permission  text;
  cert        text;
  lapse       text;
  v_event     uuid;
  v_at        timestamptz;
  v_sessions  int := 0;
BEGIN
  -- The actor is the account whose live two-step session this access token was
  -- issued for. The token is hashed here: the application's role holds only the
  -- hashes, so it cannot present a token it did not receive. Its claims (read,
  -- not verified: the hash already ties this exact token to its session row) must
  -- name that session, and the token must be unexpired; the roles it carries are
  -- the most the actor may use.
  BEGIN
    claims := pg_catalog.convert_from(pg_catalog.decode(pg_catalog.rpad(
                pg_catalog.translate(pg_catalog.split_part(p_access_token, '.', 2), '-_', '+/'),
                ((pg_catalog.length(pg_catalog.split_part(p_access_token, '.', 2)) + 3) / 4) * 4, '='),
              'base64'), 'UTF8')::jsonb;
    expires := pg_catalog.to_timestamp((claims ->> 'exp')::double precision);
  EXCEPTION WHEN data_exception THEN
    claims := NULL;
    expires := NULL;
  END;
  SELECT s.id, s.account_id INTO v_session, v_actor
    FROM public.session s
   WHERE s.access_hash = pg_catalog.sha256(pg_catalog.convert_to(p_access_token, 'UTF8'))
     AND s.amr = 'pwd+totp'
     AND s.revoked_at IS NULL
     AND s.idle_expires_at > pg_catalog.now() AND s.absolute_expires_at > pg_catalog.now()
     AND expires > pg_catalog.now()
     AND claims ->> 'sid' = s.id::text
     FOR SHARE OF s;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'account_state_session_required: the access token is not one of a live session signed in with two-step sign-in'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Their grants as they stand now: global, not revoked, in force, carried by the
  -- token, on an active account whose staff profile is not suspended or deactivated.
  SELECT bool_or(ar.role = 'ADMIN'), bool_or(ar.role = 'SUPER_ADMIN'),
         jsonb_agg(DISTINCT ar.role::text)
    INTO is_admin, is_super, roles
    FROM public.account_role ar
    JOIN public.account a ON a.id = ar.account_id
   WHERE ar.account_id = v_actor
     AND ar.scope_type = 'GLOBAL' AND ar.revoked_at IS NULL AND ar.granted_at <= pg_catalog.now()
     AND (claims -> 'roles') ? ar.role::text
     AND a.status = 'ACTIVE' AND a.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.staff_profile sp
                      WHERE sp.account_id = v_actor AND sp.status IN ('SUSPENDED', 'DEACTIVATED'));
  IF NOT (coalesce(is_admin, false) OR coalesce(is_super, false)) THEN
    RAISE EXCEPTION 'account_state_actor_not_permitted: % holds no admin or super admin grant', v_actor
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The subject, locked; never the actor's own account or restaurant, never a staff
  -- account treated as a rider or a customer.
  IF p_subject_type IN ('RIDER', 'CUSTOMER') AND p_subject_id = v_actor THEN
    RAISE EXCEPTION 'account_state_own_account: staff cannot act on their own account'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_subject_type = 'RESTAURANT' THEN
    SELECT x.account_state::text, x.delist_reasons, x.onboarding_state::text, x.location IS NOT NULL
      INTO v_from, v_reasons, v_onboard, v_located
      FROM public.restaurant x WHERE x.id = p_subject_id AND x.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_state_subject_not_found: no restaurant %', p_subject_id USING ERRCODE = 'no_data_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.account_role ar
                WHERE ar.account_id = v_actor AND ar.scope_type = 'RESTAURANT'
                  AND ar.scope_id = p_subject_id AND ar.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'account_state_own_account: staff cannot act on their own restaurant'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF p_subject_type = 'RIDER' THEN
    SELECT x.account_status::text, x.onboarding_state::text INTO v_from, v_onboard
      FROM public.rider_profile x WHERE x.account_id = p_subject_id AND x.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_state_subject_not_found: no rider %', p_subject_id USING ERRCODE = 'no_data_found';
    END IF;
  ELSE
    SELECT x.status::text INTO v_from
      FROM public.account x WHERE x.id = p_subject_id AND x.deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.account_role ar
                                 WHERE ar.account_id = p_subject_id AND ar.role = 'CUSTOMER'
                                   AND ar.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'account_state_subject_not_found: no customer %', p_subject_id USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  -- A rider's ban or a customer's ends every session of the account, staff
  -- sessions included: a staff account is managed through the staff operations.
  IF p_subject_type IN ('RIDER', 'CUSTOMER')
     AND EXISTS (SELECT 1 FROM public.account_role ar
                  WHERE ar.account_id = p_subject_id AND ar.revoked_at IS NULL
                    AND ar.role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN')) THEN
    RAISE EXCEPTION 'account_state_staff_subject: a staff account is not changed by a % action',
      pg_catalog.lower(p_subject_type::text)
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The two-person ban: a confirmation needs a proposal by somebody else, less
  -- than 7 days old; a proposal is not made twice. (That the somebody else is
  -- another person is checked below, once the confirmer is known to be a super
  -- admin.)
  SELECT e.action::text, e.actor_account_id, e.created_at INTO last_action, last_actor, last_at
    FROM public.account_state_event e
   WHERE e.subject_type = p_subject_type AND e.subject_id = p_subject_id
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 1;
  proposed := coalesce(last_action = 'PROPOSE_BAN' AND last_at > pg_catalog.now() - interval '7 days', false);
  IF p_action = 'CONFIRM_BAN' AND NOT proposed THEN
    RAISE EXCEPTION 'account_ban_needs_proposal: % % has no ban proposal less than 7 days old', p_subject_type, p_subject_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_action = 'CONFIRM_BAN' AND last_actor = v_actor THEN
    RAISE EXCEPTION 'account_ban_two_person: the person who proposed a ban cannot confirm it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_action = 'PROPOSE_BAN' AND proposed THEN
    RAISE EXCEPTION 'account_state_illegal_transition: a ban is already proposed for % %', p_subject_type, p_subject_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Where the action leads. A restaurant's listing is decided here from its own
  -- halal certificate and delisting reasons, never by the caller.
  v_new := v_reasons;
  IF p_subject_type = 'RESTAURANT' AND p_action = 'DELIST' THEN
    v_to := 'DELISTED';
    IF NOT (p_reason_code = ANY (v_reasons)) THEN
      v_new := v_reasons || p_reason_code;
    END IF;
  ELSIF p_subject_type = 'RESTAURANT' AND p_action = 'REINSTATE' THEN
    IF v_onboard <> 'ACTIVE' OR NOT v_located THEN
      RAISE EXCEPTION 'account_state_precondition_not_met: restaurant % has not finished onboarding', p_subject_id
        USING ERRCODE = 'check_violation';
    END IF;
    cert := public.account_state_certificate(p_subject_id);
    IF v_from = 'DELISTED' THEN
      IF cert <> 'CURRENT' THEN
        RAISE EXCEPTION 'account_state_halal_certificate_required: restaurant % has no current halal certificate (%)', p_subject_id, cert
          USING ERRCODE = 'check_violation';
      END IF;
      v_new := '{}';
    ELSE
      v_new := ARRAY(SELECT x FROM pg_catalog.unnest(v_reasons) AS x
                      WHERE NOT (cert = 'CURRENT' AND x = ANY (halal)));
      IF cert <> 'CURRENT' THEN
        lapse := CASE cert WHEN 'UNVERIFIED' THEN 'HALAL_CERTIFICATE_UNVERIFIED' ELSE 'HALAL_CERTIFICATE_EXPIRED' END;
        IF NOT (lapse = ANY (v_new)) THEN
          v_new := v_new || lapse;
        END IF;
      END IF;
    END IF;
    v_to := CASE WHEN pg_catalog.cardinality(v_new) = 0 THEN 'LIVE' ELSE 'DELISTED' END;
  ELSE
    IF p_subject_type = 'RIDER' AND p_action = 'REINSTATE' AND v_onboard <> 'ACTIVE' THEN
      RAISE EXCEPTION 'account_state_precondition_not_met: rider % has not finished onboarding', p_subject_id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT k.to_state INTO v_to
      FROM public.account_state_rule k
     WHERE k.subject_type = p_subject_type AND k.action = p_action AND k.from_state = v_from
       AND k.principal IN ('ADMIN', 'SUPER_ADMIN')
     LIMIT 1;
  END IF;

  -- The transition must be one staff may take, and the actor must hold its role.
  SELECT bool_and(k.principal = 'SUPER_ADMIN'), min(k.permission)
    INTO rule_super, permission
    FROM public.account_state_rule k
   WHERE k.subject_type = p_subject_type AND k.action = p_action
     AND k.from_state = v_from AND k.to_state = v_to
     AND k.principal IN ('ADMIN', 'SUPER_ADMIN');
  IF rule_super IS NULL THEN
    RAISE EXCEPTION 'account_state_illegal_transition: staff cannot % a % from % (to %)',
      p_action, p_subject_type, v_from, coalesce(v_to, 'nothing')
      USING ERRCODE = 'check_violation';
  END IF;
  IF rule_super AND NOT coalesce(is_super, false) THEN
    RAISE EXCEPTION 'account_state_actor_not_permitted: % needs a super admin (permission %)', p_action, permission
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- A ban's confirmer must be another person, not a second account of the
  -- proposer's: neither made the other staff (a role grant or a staff profile),
  -- and the confirmer was already a super admin when the ban was proposed.
  IF p_action = 'CONFIRM_BAN'
     AND (EXISTS (SELECT 1 FROM public.account_role ar
                   WHERE ar.role IN ('SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN')
                     AND ((ar.account_id = v_actor AND ar.granted_by = last_actor)
                       OR (ar.account_id = last_actor AND ar.granted_by = v_actor)))
          OR EXISTS (SELECT 1 FROM public.staff_profile sp
                      WHERE (sp.account_id = v_actor AND sp.created_by = last_actor)
                         OR (sp.account_id = last_actor AND sp.created_by = v_actor))) THEN
    RAISE EXCEPTION 'account_ban_two_person: the proposer and the confirmer made one another staff'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_action = 'CONFIRM_BAN'
     AND NOT EXISTS (SELECT 1 FROM public.account_role ar
                      WHERE ar.account_id = v_actor AND ar.role = 'SUPER_ADMIN' AND ar.scope_type = 'GLOBAL'
                        AND ar.revoked_at IS NULL AND ar.granted_at <= last_at) THEN
    RAISE EXCEPTION 'account_ban_two_person: the confirmer became a super admin after the ban was proposed'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The state, the sessions a ban ends, the history and the audit, together.
  IF p_subject_type = 'RESTAURANT' THEN
    UPDATE public.restaurant
       SET account_state = v_to::public.restaurant_account_state, delist_reasons = v_new
     WHERE id = p_subject_id;
  ELSIF p_subject_type = 'RIDER' THEN
    UPDATE public.rider_profile SET account_status = v_to::public.rider_account_status
     WHERE account_id = p_subject_id;
  ELSE
    UPDATE public.account SET status = v_to::public.account_status, status_reason = p_reason_code
     WHERE id = p_subject_id;
  END IF;

  IF p_action = 'CONFIRM_BAN' THEN
    IF p_subject_type = 'RESTAURANT' THEN
      UPDATE public.session s SET revoked_at = pg_catalog.now(), revoke_reason = 'restaurant_banned'
       WHERE s.revoked_at IS NULL
         AND s.account_id IN (SELECT ar.account_id FROM public.account_role ar
                               WHERE ar.scope_type = 'RESTAURANT' AND ar.scope_id = p_subject_id
                                 AND ar.revoked_at IS NULL);
    ELSE
      UPDATE public.session s SET revoked_at = pg_catalog.now(),
             revoke_reason = pg_catalog.lower(p_subject_type::text) || '_banned'
       WHERE s.account_id = p_subject_id AND s.revoked_at IS NULL;
    END IF;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
  END IF;

  INSERT INTO public.account_state_event
    (subject_type, subject_id, action, from_state, to_state, reason_code, reason_text,
     actor_kind, actor_account_id, idempotency_key, request_hash, in_flight, delist_reasons, sessions_revoked)
  VALUES (p_subject_type, p_subject_id, p_action, v_from, v_to, p_reason_code, p_reason_text,
          'STAFF', v_actor, p_idempotency_key, p_request_hash,
          coalesce(p_in_flight, '{}'::jsonb),
          CASE WHEN p_subject_type = 'RESTAURANT' THEN v_new ELSE '{}'::text[] END, v_sessions)
  RETURNING id, account_state_event.created_at INTO v_event, v_at;

  -- The audit row names the session proven above, whatever the caller says.
  PERFORM public.account_state_audit(
    'ACCOUNT', v_actor, roles, permission, p_subject_type::text, p_subject_id,
    p_reason_code, p_reason_text,
    pg_catalog.jsonb_build_object('state', v_from),
    pg_catalog.jsonb_build_object('state', v_to, 'event_id', v_event,
      'delist_reasons', pg_catalog.to_jsonb(CASE WHEN p_subject_type = 'RESTAURANT' THEN v_new ELSE '{}'::text[] END),
      'in_flight', coalesce(p_in_flight, '{}'::jsonb), 'sessions_revoked', v_sessions),
    pg_catalog.jsonb_build_object('request_id', p_request ->> 'request_id', 'ip', p_request ->> 'ip',
      'user_agent', p_request ->> 'user_agent', 'session_id', v_session::text));

  RETURN QUERY SELECT v_event, v_from, v_to,
                      CASE WHEN p_subject_type = 'RESTAURANT' THEN v_new ELSE '{}'::text[] END,
                      v_sessions, v_at;
END
$$;
-- +goose StatementEnd

-- A system principal's change of a restaurant: the state, the history row when
-- the state changes, and the audit row. Called only by the three functions below.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_system_write(
  p_restaurant_id uuid, p_system text, p_from text, p_to text, p_before text[], p_after text[],
  p_action account_action, p_reason_code text, p_reason_text text, p_audit_action text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.restaurant
     SET account_state = p_to::public.restaurant_account_state, delist_reasons = p_after
   WHERE id = p_restaurant_id;
  IF p_to IS DISTINCT FROM p_from AND p_action IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.account_state_rule k
                    WHERE k.subject_type = 'RESTAURANT' AND k.action = p_action
                      AND k.from_state = p_from AND k.to_state = p_to
                      AND k.principal = 'SYSTEM:' || p_system AND k.reason_code = p_reason_code) THEN
      RAISE EXCEPTION 'account_state_system_not_allowed: % may not % a restaurant from % to %', p_system, p_action, p_from, p_to
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO public.account_state_event
      (subject_type, subject_id, action, from_state, to_state, reason_code, reason_text,
       actor_kind, system_actor, delist_reasons)
    VALUES ('RESTAURANT', p_restaurant_id, p_action, p_from, p_to, p_reason_code, p_reason_text,
            'SYSTEM', p_system, p_after);
  END IF;
  PERFORM public.account_state_audit(
    'SYSTEM', NULL, pg_catalog.jsonb_build_array('SYSTEM:' || p_system), p_audit_action, 'RESTAURANT',
    p_restaurant_id, p_reason_code, p_reason_text,
    pg_catalog.jsonb_build_object('account_state', p_from, 'delist_reasons', pg_catalog.to_jsonb(p_before)),
    pg_catalog.jsonb_build_object('account_state', p_to, 'delist_reasons', pg_catalog.to_jsonb(p_after)),
    NULL);
END
$$;
-- +goose StatementEnd

-- The ONBOARDING principal: completing a restaurant's onboarding takes it out of
-- PENDING, to LIVE only with a current certificate and no delisting reason (the
-- rule an admin reinstating it follows, accountstate.ReinstatedState), otherwise
-- to DELISTED with the certificate's reason. It checks the gates itself; a
-- restaurant that is not PENDING keeps its state. It also records the onboarding
-- step, so it is the whole of the last step.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_complete_onboarding(p_restaurant_id uuid)
RETURNS TABLE (from_state text, to_state text, delist_before text[], delist_after text[], halal_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  halal   constant text[] := ARRAY['HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED'];
  r       record;
  cert    text;
  reasons text[];
  lapse   text;
  v_to    text;
BEGIN
  SELECT x.onboarding_state::text AS onboarding, x.account_state::text AS state, x.delist_reasons AS reasons,
         x.halal_status::text AS halal,
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
    RAISE EXCEPTION 'account_state_subject_not_found: no restaurant %', p_restaurant_id USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (r.onboarding IN ('DOCUMENTS_APPROVED', 'PAYOUT_PENDING', 'MENU_PENDING')
          OR (r.onboarding = 'ACTIVE' AND r.state = 'PENDING'))
     OR NOT (r.payout_ready AND r.has_live_item AND r.has_hours) THEN
    RAISE EXCEPTION 'account_state_onboarding_incomplete: restaurant % is %, payout ready %, live item %, hours %',
      p_restaurant_id, r.onboarding, r.payout_ready, r.has_live_item, r.has_hours
      USING ERRCODE = 'check_violation';
  END IF;

  IF r.onboarding <> 'ACTIVE' THEN
    UPDATE public.restaurant SET onboarding_state = 'ACTIVE', updated_at = pg_catalog.now() WHERE id = p_restaurant_id;
    INSERT INTO public.restaurant_onboarding_transition (restaurant_id, from_state, to_state, actor_kind, reason)
    VALUES (p_restaurant_id, r.onboarding::public.restaurant_onboarding_state, 'ACTIVE', 'SYSTEM', 'auto-advance');
  END IF;
  IF r.state <> 'PENDING' THEN
    RETURN QUERY SELECT r.state, r.state, r.reasons, r.reasons, r.halal;
    RETURN;
  END IF;

  cert := public.account_state_certificate(p_restaurant_id);
  reasons := ARRAY(SELECT x FROM pg_catalog.unnest(r.reasons) AS x
                    WHERE NOT (cert = 'CURRENT' AND x = ANY (halal)));
  IF cert <> 'CURRENT' THEN
    lapse := CASE cert WHEN 'UNVERIFIED' THEN 'HALAL_CERTIFICATE_UNVERIFIED' ELSE 'HALAL_CERTIFICATE_EXPIRED' END;
    IF NOT (lapse = ANY (reasons)) THEN
      reasons := reasons || lapse;
    END IF;
  END IF;
  v_to := CASE WHEN pg_catalog.cardinality(reasons) = 0 THEN 'LIVE' ELSE 'DELISTED' END;
  PERFORM public.account_state_system_write(
    p_restaurant_id, 'ONBOARDING', 'PENDING', v_to, r.reasons, reasons, NULL, NULL, 'onboarding completed',
    CASE v_to WHEN 'LIVE' THEN 'restaurant.listed' ELSE 'restaurant.delisted' END);
  RETURN QUERY SELECT 'PENDING'::text, v_to, r.reasons, reasons, r.halal;
END
$$;
-- +goose StatementEnd

-- The HALAL_EXPIRY principal: when a restaurant's certificate has lapsed, the
-- lapse is recorded as a delisting reason and a LIVE restaurant is delisted. A
-- suspended, banned or deactivated one keeps its state and gains the reason, so
-- reinstating it cannot skip the lapse. Nothing happens while the certificate is
-- current, or when there is none to lapse. It never suspends, bans or lists.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_halal_expiry(p_restaurant_id uuid)
RETURNS TABLE (from_state text, to_state text, delist_reasons text[], changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  v_from    text;
  v_reasons text[];
  v_new     text[];
  v_to      text;
BEGIN
  SELECT x.account_state::text, x.delist_reasons INTO v_from, v_reasons
    FROM public.restaurant x WHERE x.id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_state_subject_not_found: no restaurant %', p_restaurant_id USING ERRCODE = 'no_data_found';
  END IF;
  v_new := v_reasons;
  IF public.account_state_certificate(p_restaurant_id) = 'EXPIRED'
     AND NOT ('HALAL_CERTIFICATE_EXPIRED' = ANY (v_reasons)) THEN
    v_new := v_reasons || 'HALAL_CERTIFICATE_EXPIRED'::text;
  END IF;
  v_to := CASE WHEN v_from = 'LIVE' AND v_new <> v_reasons THEN 'DELISTED' ELSE v_from END;
  IF v_new = v_reasons THEN
    RETURN QUERY SELECT v_from, v_from, v_reasons, false;
    RETURN;
  END IF;
  PERFORM public.account_state_system_write(
    p_restaurant_id, 'HALAL_EXPIRY', v_from, v_to, v_reasons, v_new,
    CASE WHEN v_to <> v_from THEN 'DELIST'::public.account_action END, 'HALAL_CERTIFICATE_EXPIRED',
    'The halal certificate expired.', 'restaurant.delisted');
  RETURN QUERY SELECT v_from, v_to, v_new, true;
END
$$;
-- +goose StatementEnd

-- The HALAL_RENEWAL principal: once the certificate is current again, its lapse
-- reasons are cleared, and a DELISTED restaurant with no other reason is listed
-- again. It never lifts a suspension, a ban or a deactivation, and never clears
-- another reason.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_halal_renewal(p_restaurant_id uuid)
RETURNS TABLE (from_state text, to_state text, delist_reasons text[], changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  halal     constant text[] := ARRAY['HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED'];
  v_from    text;
  v_reasons text[];
  v_new     text[];
  v_to      text;
  v_ready   boolean;
BEGIN
  SELECT x.account_state::text, x.delist_reasons, x.onboarding_state = 'ACTIVE' AND x.location IS NOT NULL
    INTO v_from, v_reasons, v_ready
    FROM public.restaurant x WHERE x.id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_state_subject_not_found: no restaurant %', p_restaurant_id USING ERRCODE = 'no_data_found';
  END IF;
  IF public.account_state_certificate(p_restaurant_id) <> 'CURRENT' THEN
    RETURN QUERY SELECT v_from, v_from, v_reasons, false;
    RETURN;
  END IF;
  v_new := ARRAY(SELECT x FROM pg_catalog.unnest(v_reasons) AS x WHERE NOT (x = ANY (halal)));
  IF v_new = v_reasons THEN
    RETURN QUERY SELECT v_from, v_from, v_reasons, false;
    RETURN;
  END IF;
  v_to := CASE WHEN v_from = 'DELISTED' AND pg_catalog.cardinality(v_new) = 0 AND v_ready
               THEN 'LIVE' ELSE v_from END;
  PERFORM public.account_state_system_write(
    p_restaurant_id, 'HALAL_RENEWAL', v_from, v_to, v_reasons, v_new,
    CASE WHEN v_to <> v_from THEN 'REINSTATE'::public.account_action END, 'ISSUE_RESOLVED',
    'A renewed halal certificate is current.', 'restaurant.relisted');
  RETURN QUERY SELECT v_from, v_to, v_new, true;
END
$$;
-- +goose StatementEnd

-- The HALAL_ISSUER principal: a certifying body's acceptance was withdrawn
-- (p_accepted false) or given back (true), or a certificate was approved. Only a
-- LIVE or DELISTED restaurant moves. Withdrawn: when no current certificate from an
-- accepted body vouches any more, the certificate's reason is added
-- (HALAL_CERTIFICATE_UNVERIFIED with no certificate, HALAL_CERTIFICATE_EXPIRED when
-- the one that counts has lapsed) and a LIVE restaurant is delisted. Accepted: when
-- a current certificate from an accepted body exists, those reasons are cleared
-- and a DELISTED restaurant with no other reason is listed again. Nothing else:
-- the flag only says which way it may move, and the data decides whether it does.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_issuer_listing(p_restaurant_id uuid, p_accepted boolean)
RETURNS TABLE (from_state text, to_state text, delist_reasons text[], changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
#variable_conflict use_variable
DECLARE
  halal     constant text[] := ARRAY['HALAL_CERTIFICATE_EXPIRED', 'HALAL_CERTIFICATE_UNVERIFIED'];
  v_from    text;
  v_reasons text[];
  v_new     text[];
  v_to      text;
  v_ready   boolean;
  cert      text;
  lapse     text;
BEGIN
  IF p_accepted IS NULL THEN
    RAISE EXCEPTION 'account_state_issuer_listing: say whether the body was accepted or withdrawn'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;
  SELECT x.account_state::text, x.delist_reasons, x.onboarding_state = 'ACTIVE' AND x.location IS NOT NULL
    INTO v_from, v_reasons, v_ready
    FROM public.restaurant x WHERE x.id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_state_subject_not_found: no restaurant %', p_restaurant_id USING ERRCODE = 'no_data_found';
  END IF;
  cert := public.account_state_certificate(p_restaurant_id);
  v_new := v_reasons;
  v_to := v_from;
  IF v_from IN ('LIVE', 'DELISTED') AND NOT p_accepted AND cert <> 'CURRENT' THEN
    lapse := CASE cert WHEN 'UNVERIFIED' THEN 'HALAL_CERTIFICATE_UNVERIFIED' ELSE 'HALAL_CERTIFICATE_EXPIRED' END;
    IF NOT (lapse = ANY (v_reasons)) THEN
      v_new := v_reasons || lapse;
    END IF;
    v_to := 'DELISTED';
  ELSIF v_from IN ('LIVE', 'DELISTED') AND p_accepted AND cert = 'CURRENT' THEN
    v_new := ARRAY(SELECT x FROM pg_catalog.unnest(v_reasons) AS x WHERE NOT (x = ANY (halal)));
    IF v_from = 'DELISTED' AND v_new <> v_reasons AND pg_catalog.cardinality(v_new) = 0 AND v_ready THEN
      v_to := 'LIVE';
    END IF;
  END IF;
  IF v_new = v_reasons AND v_to = v_from THEN
    RETURN QUERY SELECT v_from, v_from, v_reasons, false;
    RETURN;
  END IF;
  PERFORM public.account_state_system_write(
    p_restaurant_id, 'HALAL_ISSUER', v_from, v_to, v_reasons, v_new,
    CASE WHEN v_to = v_from THEN NULL WHEN p_accepted THEN 'REINSTATE'::public.account_action
         ELSE 'DELIST'::public.account_action END,
    CASE WHEN p_accepted THEN 'ISSUE_RESOLVED' ELSE lapse END,
    CASE WHEN p_accepted THEN 'A current certificate from an accepted certifying body vouches again.'
         ELSE 'No current certificate from an accepted certifying body vouches any more.' END,
    CASE WHEN p_accepted THEN 'restaurant.relisted' ELSE 'restaurant.delisted' END);
  RETURN QUERY SELECT v_from, v_to, v_new, true;
END
$$;
-- +goose StatementEnd

-- Nothing here is executable by PUBLIC; hg_app may execute the five writers only.
REVOKE ALL ON FUNCTION account_state_grant_app_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_certificate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_audit(text, uuid, jsonb, text, text, uuid, text, text, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_apply(account_subject_type, uuid, account_action, text, text, text, text, bytea, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_system_write(uuid, text, text, text, text[], text[], account_action, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_complete_onboarding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_halal_expiry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_halal_renewal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_issuer_listing(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_state_event_guard_ban() FROM PUBLIC, hg_app;
REVOKE ALL ON FUNCTION account_state_event_reject_mutation() FROM PUBLIC, hg_app;
GRANT EXECUTE ON FUNCTION account_state_apply(account_subject_type, uuid, account_action, text, text, text, text, bytea, jsonb, jsonb) TO hg_app;
GRANT EXECUTE ON FUNCTION account_state_complete_onboarding(uuid) TO hg_app;
GRANT EXECUTE ON FUNCTION account_state_halal_expiry(uuid) TO hg_app;
GRANT EXECUTE ON FUNCTION account_state_halal_renewal(uuid) TO hg_app;
GRANT EXECUTE ON FUNCTION account_state_issuer_listing(uuid, boolean) TO hg_app;

-- +goose Down
DROP FUNCTION IF EXISTS account_state_issuer_listing(uuid, boolean);
DROP FUNCTION IF EXISTS account_state_halal_renewal(uuid);
DROP FUNCTION IF EXISTS account_state_halal_expiry(uuid);
DROP FUNCTION IF EXISTS account_state_complete_onboarding(uuid);
DROP FUNCTION IF EXISTS account_state_system_write(uuid, text, text, text, text[], text[], account_action, text, text, text);
DROP FUNCTION IF EXISTS account_state_apply(account_subject_type, uuid, account_action, text, text, text, text, bytea, jsonb, jsonb);
DROP FUNCTION IF EXISTS account_state_audit(text, uuid, jsonb, text, text, uuid, text, text, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS account_state_certificate(uuid);
DROP FUNCTION IF EXISTS account_state_grant_app_columns();
-- The application role gets back the table rights 00023 gave it.
GRANT INSERT, UPDATE, DELETE ON restaurant, rider_profile, account TO hg_app;
-- And the view goes back to the owner's rights with the app's write on it.
ALTER VIEW IF EXISTS halal_status_inconsistency RESET (security_invoker);
GRANT INSERT, UPDATE, DELETE ON halal_status_inconsistency TO hg_app;
REVOKE UPDATE (rotated_at, rotated_to, last_used_at, revoked_at, revoke_reason) ON session FROM hg_app;
GRANT UPDATE ON session TO hg_app;
DROP INDEX IF EXISTS session_access_hash;
ALTER TABLE session DROP COLUMN IF EXISTS access_hash;
GRANT INSERT ON account_state_event TO hg_app;
ALTER FUNCTION account_state_event_reject_mutation() RESET search_path;
ALTER FUNCTION account_state_event_guard_ban() RESET search_path;
GRANT EXECUTE ON FUNCTION account_state_event_guard_ban() TO PUBLIC;
GRANT EXECUTE ON FUNCTION account_state_event_reject_mutation() TO PUBLIC;
ALTER TABLE restaurant DROP CONSTRAINT IF EXISTS restaurant_live_has_no_delist_reasons;
-- A system row has no person to restore NOT NULL with. Rolling back is a
-- development reset, so those rows go (the append-only trigger is lifted for it).
ALTER TABLE account_state_event DISABLE TRIGGER account_state_event_append_only;
DELETE FROM account_state_event WHERE actor_kind = 'SYSTEM';
ALTER TABLE account_state_event ENABLE TRIGGER account_state_event_append_only;
ALTER TABLE account_state_event
  DROP CONSTRAINT IF EXISTS account_state_event_reason_code,
  ADD CONSTRAINT account_state_event_reason_code CHECK (CASE subject_type
    WHEN 'RESTAURANT' THEN reason_code IN (
      'COMPLIANCE_THRESHOLD', 'HALAL_INTEGRITY', 'FOOD_SAFETY_RISK', 'FRAUD_SUSPECTED',
      'PAYMENT_OR_SETTLEMENT_ISSUE', 'ABUSIVE_CONDUCT', 'LEGAL_ORDER', 'REPEATED_VIOLATIONS',
      'HALAL_CERTIFICATE_EXPIRED', 'DOCUMENT_EXPIRED', 'NO_APPROVED_MENU', 'MERCHANT_REQUEST',
      'ISSUE_RESOLVED', 'APPEAL_UPHELD', 'ACTIONED_IN_ERROR', 'OTHER')
    WHEN 'RIDER' THEN reason_code IN (
      'DOCUMENT_EXPIRED', 'INCIDENT_UNDER_INVESTIGATION', 'SAFETY_RISK', 'FRAUD_SUSPECTED',
      'REPEATED_CANCELLATIONS', 'ABUSIVE_CONDUCT', 'LOW_PERFORMANCE', 'ACCOUNT_SHARING',
      'LEGAL_ORDER', 'RIDER_REQUEST', 'ISSUE_RESOLVED', 'APPEAL_UPHELD', 'ACTIONED_IN_ERROR',
      'OTHER')
    WHEN 'CUSTOMER' THEN reason_code IN (
      'PAYMENT_FAILURE_UNRESOLVED', 'REFUND_ABUSE', 'FRAUDULENT_CHARGEBACK',
      'ABUSIVE_CONDUCT_TO_RIDER', 'ABUSIVE_CONDUCT_TO_RESTAURANT', 'FAKE_REVIEWS',
      'ACCOUNT_TAKEOVER_RISK', 'PROMOTION_ABUSE', 'LEGAL_ORDER', 'ISSUE_RESOLVED',
      'APPEAL_UPHELD', 'ACTIONED_IN_ERROR', 'OTHER')
  END),
  DROP CONSTRAINT IF EXISTS account_state_event_actor,
  DROP COLUMN IF EXISTS system_actor,
  DROP COLUMN IF EXISTS actor_kind,
  ALTER COLUMN actor_account_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_hash SET NOT NULL;
DROP TABLE IF EXISTS account_state_rule;
