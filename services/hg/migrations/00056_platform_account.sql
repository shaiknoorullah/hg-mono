-- The platform's own account, for money the platform moves on its own.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/336
--
-- A ready order nobody collects is cancelled at the pickup escalation cap,
-- and the customer is refunded in full in the same transaction
-- (docs/spec/01-platform.md, "P-15 — Deadlines and timeout actions", the
-- READY_FOR_PICKUP row). A refund names the account that asked for it
-- (refund.requested_by, NOT NULL) and, once it moves money, the account that
-- approved it (refund_money_needs_approver). A deadline has no person behind
-- it, so the platform asks and approves under the policy the owner decided:
-- the customer is refunded, the restaurant is paid, the platform absorbs.
--
-- The account can never sign in: it has no phone, no password and no TOTP,
-- its address is on the reserved .invalid domain, and it is SUSPENDED. It holds
-- no role, so no route authorises it. internal/payments names its id as
-- PlatformAccountID.

-- +goose Up

INSERT INTO account (id, email, status, status_reason)
VALUES ('00000000-0000-7000-8000-00000000a001', 'platform@halalgoes.invalid', 'SUSPENDED',
        'The platform itself: requests and approves refunds a deadline owes. Cannot sign in.')
ON CONFLICT (id) DO NOTHING;

-- +goose Down

-- Refunds it requested keep their reference; the account stays while any do.
DELETE FROM account a
 WHERE a.id = '00000000-0000-7000-8000-00000000a001'
   AND NOT EXISTS (SELECT 1 FROM refund r WHERE r.requested_by = a.id OR r.approved_by = a.id);
