-- Admin actions that suspend, reinstate, delist, deactivate or ban a
-- restaurant, a rider or a customer, and the history they leave behind.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/253
--
-- The states already exist (restaurant.account_state, rider_profile.account_status
-- and account.status). Until now nothing could change them. The actions live in
-- internal/admin (applyRestaurantAccountAction, applyRiderAccountAction and
-- applyCustomerAccountAction in contracts/openapi.yaml); the rules for which action
-- is legal from which state live in internal/accountstate. This migration adds:
--
--   1. BANNED as a rider account status. The admin spec bans riders
--      (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-27--rider-account-state-actions);
--      the status had no word for it. 00002_enums.sql is generated from the contract and
--      now carries it for a fresh database; ADD VALUE IF NOT EXISTS adds it to one that
--      already ran 00002. Postgres cannot drop an enum label, so Down leaves it in place,
--      and IF NOT EXISTS keeps Up re-runnable after a Down.
--   2. account_state_event: one append-only row per applied action, carrying the reason,
--      the person who acted, what happened to work in progress, and the idempotency key
--      that makes a retry return the first result instead of acting twice.
--   3. Two-person control for a ban, as a database fact: a CONFIRM_BAN row is refused
--      unless the subject's latest row is a PROPOSE_BAN by somebody else, less than
--      7 days old (the default the admin spec proposes for "who may ban":
--      https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#20-the-restaurant-lifecycle-normative-referenced-by-a-13a-22).
--      A ban is reachable only by confirming one, and a proposal always leaves the account
--      suspended.

-- +goose Up

ALTER TYPE rider_account_status ADD VALUE IF NOT EXISTS 'BANNED';

CREATE TYPE account_subject_type AS ENUM ('RESTAURANT', 'RIDER', 'CUSTOMER');

CREATE TYPE account_action AS ENUM (
  'SUSPEND',
  'REINSTATE',
  'DELIST',
  'PROPOSE_BAN',
  'CONFIRM_BAN',
  'DEACTIVATE'
);

CREATE TABLE account_state_event (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subject_type      account_subject_type NOT NULL,
  -- restaurant.id, or the rider's or customer's account.id. Not a foreign key
  -- because it points at one of two tables; the subject row is locked FOR UPDATE
  -- by the writer in the same transaction.
  subject_id        uuid NOT NULL,
  action            account_action NOT NULL,
  from_state        text NOT NULL,
  to_state          text NOT NULL,
  reason_code       text NOT NULL,
  reason_text       text NOT NULL,
  actor_account_id  uuid NOT NULL REFERENCES account(id),
  idempotency_key   text NOT NULL,
  -- sha256 of the request (subject, action, reason): a retry with the same key
  -- and a different request is refused rather than replayed.
  request_hash      bytea NOT NULL,
  -- What happened to work in progress: AccountActionInFlight in the contract.
  in_flight         jsonb NOT NULL DEFAULT '{}'::jsonb,
  delist_reasons    text[] NOT NULL DEFAULT '{}',
  sessions_revoked  int NOT NULL DEFAULT 0 CHECK (sessions_revoked >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_state_event_reason_text CHECK (char_length(reason_text) BETWEEN 10 AND 1000),
  CONSTRAINT account_state_event_idempotency_key CHECK (length(idempotency_key) BETWEEN 16 AND 128),

  -- Each subject moves only between its own states.
  CONSTRAINT account_state_event_states CHECK (CASE subject_type
    WHEN 'RESTAURANT' THEN
      from_state IN ('PENDING', 'LIVE', 'DELISTED', 'SUSPENDED', 'BANNED', 'DEACTIVATED', 'CLOSED')
      AND to_state IN ('PENDING', 'LIVE', 'DELISTED', 'SUSPENDED', 'BANNED', 'DEACTIVATED', 'CLOSED')
    WHEN 'RIDER' THEN
      from_state IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'BANNED')
      AND to_state IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'BANNED')
    WHEN 'CUSTOMER' THEN
      from_state IN ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED')
      AND to_state IN ('ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED')
  END),

  -- The reason vocabularies in contracts/openapi.yaml (RestaurantAccountReasonCode,
  -- RiderAccountReasonCode, CustomerAccountReasonCode).
  CONSTRAINT account_state_event_reason_code CHECK (CASE subject_type
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

  -- Only restaurants are delisted; customers are not deactivated here.
  CONSTRAINT account_state_event_action_applies CHECK (
    (action <> 'DELIST' OR subject_type = 'RESTAURANT')
    AND (action <> 'DEACTIVATE' OR subject_type <> 'CUSTOMER')
  ),

  -- A ban is reached only by confirming one; a proposal leaves the account suspended.
  CONSTRAINT account_state_event_ban_shape CHECK (
    (to_state = 'BANNED') = (action = 'CONFIRM_BAN')
    AND (action <> 'PROPOSE_BAN' OR to_state = 'SUSPENDED')
  )
);

CREATE UNIQUE INDEX account_state_event_idempotency
  ON account_state_event (actor_account_id, idempotency_key);
CREATE INDEX account_state_event_subject
  ON account_state_event (subject_type, subject_id, created_at DESC, id DESC);

-- Two-person control for a ban (see the header, point 3).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_event_guard_ban() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev record;
BEGIN
  IF NEW.action <> 'CONFIRM_BAN' THEN
    RETURN NEW;
  END IF;
  SELECT e.action, e.actor_account_id, e.created_at
    INTO prev
    FROM account_state_event e
   WHERE e.subject_type = NEW.subject_type AND e.subject_id = NEW.subject_id
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 1;
  IF NOT FOUND OR prev.action <> 'PROPOSE_BAN'
     OR prev.created_at <= NEW.created_at - interval '7 days' THEN
    RAISE EXCEPTION 'account_ban_needs_proposal: % % has no ban proposal less than 7 days old',
      NEW.subject_type, NEW.subject_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF prev.actor_account_id = NEW.actor_account_id THEN
    RAISE EXCEPTION 'account_ban_two_person: the person who proposed a ban cannot confirm it'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER account_state_event_ban_two_person
  BEFORE INSERT ON account_state_event
  FOR EACH ROW EXECUTE FUNCTION account_state_event_guard_ban();

-- Append-only: the history of what was done to an account, and to the orders in
-- flight at the time, is kept permanently and never rewritten
-- (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-29--in-flight-order-treatment-on-entity-state-change).
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION account_state_event_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'account_state_event_is_append_only: % on account_state_event is never permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
-- +goose StatementEnd

CREATE TRIGGER account_state_event_append_only
  BEFORE UPDATE OR DELETE ON account_state_event
  FOR EACH ROW EXECUTE FUNCTION account_state_event_reject_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON account_state_event FROM hg_app;

-- +goose Down
DROP TRIGGER IF EXISTS account_state_event_append_only ON account_state_event;
DROP FUNCTION IF EXISTS account_state_event_reject_mutation();
DROP TRIGGER IF EXISTS account_state_event_ban_two_person ON account_state_event;
DROP FUNCTION IF EXISTS account_state_event_guard_ban();
DROP TABLE IF EXISTS account_state_event;
DROP TYPE IF EXISTS account_action;
DROP TYPE IF EXISTS account_subject_type;
-- rider_account_status keeps 'BANNED': Postgres cannot drop an enum label. A
-- full reset drops the type itself in 00002.
