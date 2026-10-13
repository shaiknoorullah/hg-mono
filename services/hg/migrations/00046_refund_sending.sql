-- Approved refunds are sent to Stripe (#318), and only approved ones.
--
-- docs/spec/01-platform.md, "P-18 — Refunds, cancellations and compensation":
-- the refund, its REFUND ledger batch and the state change commit in one
-- transaction, and the Stripe call happens afterwards, with retries. Until now
-- nothing made that call. The refund sender (internal/payments/refund_sender.go)
-- now does, and these constraints make the rules it relies on facts of the
-- schema rather than habits of the code:
--
-- 1. A refund moves money only once a named member of staff approved it. A
--    customer's own request waits in REQUESTED for staff review
--    (docs/spec/02-customer.md, "C-37 — Refund requests and refund tracking":
--    always human-reviewed at launch), and an approval request waits in
--    PENDING_APPROVAL; neither carries an approver, so neither can be sent.
--
-- 2. A goodwill refund above CAD 50 needs a second person: whoever approved it
--    is not whoever asked for it (docs/decisions/README.md, "Goodwill refund
--    that needs a second approver": above CAD 50, for every role). Raising the
--    limit is a migration as well as a constant (GoodwillApprovalThresholdCents
--    in internal/payments/types.go). If the two ever disagree, this check
--    refuses the refund rather than sending it.
--
-- 3. A refund the database records as at Stripe carries Stripe's id, so the
--    webhooks that finalise it (#323) always find it.
--
-- 4. An approval request names the role that must decide it, as the 202
--    response told the person who asked (the contract's RefundApprovalRequest
--    required_role), so the approver is checked against what was promised.

-- +goose Up

ALTER TABLE refund ADD COLUMN approval_required_role role_name;

-- An approval request already waiting gets the role it was escalated to, as
-- the service decides it (escalationRole in internal/payments/service.go):
-- one level above the person who asked, so a super admin when an admin asked,
-- and an admin otherwise. The refund triggers that are deferred to COMMIT
-- (refund_within_capture) run at once here instead, because a table with
-- trigger events still pending cannot be altered below.
SET CONSTRAINTS ALL IMMEDIATE;
UPDATE refund r
   SET approval_required_role = CASE
         WHEN EXISTS (SELECT 1 FROM account_role ar
                       WHERE ar.account_id = r.requested_by AND ar.role = 'ADMIN' AND ar.revoked_at IS NULL)
         THEN 'SUPER_ADMIN' ELSE 'ADMIN' END::role_name
 WHERE r.state = 'PENDING_APPROVAL';

ALTER TABLE refund ADD CONSTRAINT refund_money_needs_approver CHECK (
  state NOT IN ('APPROVED', 'AUTHORISED', 'SUBMITTED', 'SUCCEEDED', 'SETTLED', 'FAILED')
  OR approved_by IS NOT NULL
);

ALTER TABLE refund ADD CONSTRAINT refund_goodwill_second_approver CHECK (
  kind <> 'GOODWILL'
  OR amount_cents <= 5000
  OR state IN ('REQUESTED', 'PENDING_APPROVAL', 'DECLINED', 'CANCELLED')
  OR approved_by <> requested_by
);

ALTER TABLE refund ADD CONSTRAINT refund_at_stripe_has_id CHECK (
  state NOT IN ('SUBMITTED', 'SUCCEEDED', 'SETTLED') OR stripe_refund_id IS NOT NULL
);

ALTER TABLE refund ADD CONSTRAINT refund_approval_names_role CHECK (
  state <> 'PENDING_APPROVAL' OR approval_required_role IS NOT NULL
);

-- The sender's claim: approved refunds waiting to be sent, soonest first.
CREATE INDEX refund_to_send ON refund (deadline_at) WHERE state = 'AUTHORISED';

-- +goose Down

DROP INDEX IF EXISTS refund_to_send;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_approval_names_role;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_at_stripe_has_id;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_goodwill_second_approver;
ALTER TABLE refund DROP CONSTRAINT IF EXISTS refund_money_needs_approver;
ALTER TABLE refund DROP COLUMN IF EXISTS approval_required_role;
