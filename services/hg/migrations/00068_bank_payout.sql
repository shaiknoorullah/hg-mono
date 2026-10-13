-- Partners' money reaches their bank (#301).
--
-- Connected accounts are on Stripe's manual payout schedule
-- (internal/payments/stripe.go, CreateConnectAccount), so Stripe never moves a
-- partner's balance to their bank by itself. The weekly payout run made the
-- transfer (platform → connected account) and stopped there: the money sat in
-- the partner's Stripe balance and the payout was marked PAID.
-- docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding and payouts
-- (Canada)", payout execution: a Transfer on the schedule, "then Payout
-- (connected balance → bank)".
--
-- Now a payout is TRANSFERRED once its transfer is made, the run then asks
-- Stripe for the bank payout on the partner's account, and the payout is PAID
-- only when Stripe reports that bank payout paid (payout.paid). A bank payout
-- that fails puts the money back in the partner's Stripe balance; the payout
-- goes back to TRANSFERRED, a person is told, and the next run asks again.
--
-- The platform's ledger does not move for a bank payout: the money is already
-- the partner's, in the partner's own Stripe balance. What the platform owed
-- was discharged when the run stamped the payout on its ledger entries, and
-- payout_amount_matches_entries (00018_payouts_earnings.sql) keeps that
-- exact through every state below.

-- +goose Up

-- One row per bank payout asked of Stripe for a payout. Written before the
-- Stripe call, so a call whose answer was lost (a timeout, a crash) is found
-- again by its attempt number instead of being made twice.
CREATE TABLE payout_bank_attempt (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  payout_id         uuid NOT NULL REFERENCES payout(id),
  -- 1, 2, …: the idempotency key and the Stripe metadata carry it.
  attempt           int NOT NULL CHECK (attempt > 0),
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  -- REQUESTED: asked of Stripe, or about to be; PAID: Stripe reports it
  -- reached the bank; FAILED: failed or cancelled, the money is back in the
  -- partner's Stripe balance.
  state             text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'PAID', 'FAILED')),
  stripe_payout_id  text UNIQUE,
  failure_code      text,
  failure_message   text,
  -- Which worker is calling Stripe for it, and until when.
  lease_owner       text,
  lease_until       timestamptz,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_bank_attempt_once UNIQUE (payout_id, attempt),
  CONSTRAINT payout_bank_attempt_settled_has_id CHECK (state = 'REQUESTED' OR stripe_payout_id IS NOT NULL)
);
SELECT attach_updated_at('payout_bank_attempt');

-- Never two bank payouts in flight for one payout: a new attempt is possible
-- only once every earlier one has failed. A second bank payout for the same
-- money cannot be recorded, so it cannot be asked for.
CREATE UNIQUE INDEX payout_bank_attempt_one_live ON payout_bank_attempt (payout_id)
  WHERE state <> 'FAILED';

-- The attempts are the history of a payout's money: never deleted.
REVOKE DELETE, TRUNCATE ON payout_bank_attempt FROM hg_app;

-- A payout past its transfer has the transfer's id.
ALTER TABLE payout ADD CONSTRAINT payout_transferred_has_transfer
  CHECK (state NOT IN ('TRANSFERRED', 'PAID') OR stripe_transfer_id IS NOT NULL) NOT VALID;

-- What a run did about a bank payout, in its audit trail. Added here, used by
-- later transactions only.
ALTER TYPE payout_run_outcome ADD VALUE IF NOT EXISTS 'BANK_PAYOUT';
ALTER TYPE payout_run_outcome ADD VALUE IF NOT EXISTS 'BANK_PAYOUT_FAILED';

-- +goose Down
-- The two payout_run_outcome values stay: Postgres cannot drop an enum value,
-- and a run line may use them.
ALTER TABLE payout DROP CONSTRAINT IF EXISTS payout_transferred_has_transfer;
DROP TABLE IF EXISTS payout_bank_attempt;
