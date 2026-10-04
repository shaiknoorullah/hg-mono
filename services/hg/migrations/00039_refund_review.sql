-- Staff review refund requests, and keep evidence notes on chargebacks (#172).
--
-- docs/spec/05-admin.md, "A-33 — Refund issuance and authority limits": a
-- customer's refund request waits for staff (docs/spec/02-customer.md, "C-37 —
-- Refund requests and refund tracking": human-reviewed at launch). A member of
-- staff approves it within their rolling 24-hour limit, or sends it up for a
-- second person; or declines it with a reason. Every refund state change is
-- audited (A-33 R7). Until now nothing read or decided a request
-- (https://github.com/shaiknoorullah/hg-mono/issues/172).
--
-- 1. Who decided, when and why. approved_at dates an approval, so a person's
--    rolling 24-hour total counts the refunds they approved in that window
--    (A-33 R3), not the ones they merely asked for. escalated_by and
--    escalated_at name whoever sent a request up for a second person;
--    declined_by, declined_at and decision_reason record a decline.
--
-- 2. A second person is a second person: whoever sent a refund up for
--    approval never approves it (the contract's approveRefund:
--    SELF_APPROVAL_FORBIDDEN). The service refuses it first; this check refuses
--    it if the service ever does not.
--
-- 3. A declined refund names who declined it, when, and why.
--
-- 4. Evidence notes on a chargeback (a dispute the customer raised with their
--    bank, 00016 and 00034): the evidence staff gathered for it, in order,
--    append-only like the audit trail. Sending that evidence to Stripe is #319.

-- +goose Up

ALTER TABLE refund
  ADD COLUMN approved_at     timestamptz,
  ADD COLUMN escalated_by    uuid REFERENCES account(id),
  ADD COLUMN escalated_at    timestamptz,
  ADD COLUMN declined_by     uuid REFERENCES account(id),
  ADD COLUMN declined_at     timestamptz,
  ADD COLUMN decision_reason text;

-- A refund already approved was approved when it was asked for: every path
-- that approved one before this migration (issueRefund within the caller's
-- limit, the admin cancel after acceptance) did it in the request itself, and
-- an approval request approved since #318 is dated no earlier than that. The
-- refund triggers deferred to COMMIT run at once here, because a table with
-- trigger events still pending cannot be altered below (as in 00035).
SET CONSTRAINTS ALL IMMEDIATE;
UPDATE refund SET approved_at = requested_at WHERE approved_by IS NOT NULL AND approved_at IS NULL;

ALTER TABLE refund ADD CONSTRAINT refund_escalation_named CHECK (
  (escalated_by IS NULL) = (escalated_at IS NULL)
);

ALTER TABLE refund ADD CONSTRAINT refund_second_person CHECK (
  escalated_by IS NULL OR approved_by IS NULL OR approved_by <> escalated_by
);

ALTER TABLE refund ADD CONSTRAINT refund_decline_recorded CHECK (
  state <> 'DECLINED'
  OR (declined_by IS NOT NULL AND declined_at IS NOT NULL AND decision_reason IS NOT NULL)
);

-- A person's rolling 24-hour total, summed while the authorising transaction
-- holds their lock.
CREATE INDEX refund_approved_by_at ON refund (approved_by, approved_at) WHERE approved_by IS NOT NULL;
-- The review queue: what waits for a person, oldest first.
CREATE INDEX refund_review_queue ON refund (requested_at, id) WHERE state IN ('REQUESTED', 'PENDING_APPROVAL');

CREATE TABLE chargeback_evidence_note (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  chargeback_id     uuid NOT NULL REFERENCES chargeback(id),
  author_account_id uuid NOT NULL REFERENCES account(id),
  body              text NOT NULL CHECK (length(body) BETWEEN 10 AND 4000),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chargeback_evidence_note_chargeback ON chargeback_evidence_note (chargeback_id, created_at, id);

-- Append-only at the privilege level, like the audit trail (00023).
-- +goose StatementBegin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hg_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON chargeback_evidence_note FROM hg_app;
  END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down

DROP TABLE IF EXISTS chargeback_evidence_note;
DROP INDEX IF EXISTS refund_review_queue;
DROP INDEX IF EXISTS refund_approved_by_at;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_decline_recorded;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_second_person;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_escalation_named;
ALTER TABLE refund
  DROP COLUMN IF EXISTS decision_reason,
  DROP COLUMN IF EXISTS declined_at,
  DROP COLUMN IF EXISTS declined_by,
  DROP COLUMN IF EXISTS escalated_at,
  DROP COLUMN IF EXISTS escalated_by,
  DROP COLUMN IF EXISTS approved_at;
