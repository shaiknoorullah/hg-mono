-- Rider earnings follow the ledger (https://github.com/shaiknoorullah/hg-mono/issues/306).
--
-- An earning_entry is the rider-facing line for one RIDER_PAYABLE posting: the
-- delivery fee, the tip, or a platform-funded adjustment. The payments module
-- writes the posting and the line in the transaction that moves the order to
-- DELIVERED (internal/payments/rider_earnings.go). This migration makes the
-- pairing a database fact rather than a convention:
--
--   * earning_entry.ledger_entry_id names the posting a line mirrors. One line
--     per posting, and a line whose amount, rider or order disagrees with its
--     posting cannot be written.
--   * An order has at most one DELIVERY line and one TIP line. A post-delivery
--     tip, which would be a second TIP line, is out of scope at launch
--     (docs/spec/02-customer.md, "C-36 — Tipping the rider"); the feature that
--     adds it narrows this index.
--   * When a payout run stamps payout_id on a posting (the one ledger mutation,
--     00018_payouts_earnings.sql), its line is stamped in the same statement,
--     and when the payout is paid its lines become PAID
--     (docs/spec/04-rider.md, "D-28 — Payouts").

-- +goose Up

-- No foreign key: the trigger below checks the posting exists and matches,
-- and ledger_entry rows are never deleted. A foreign key would also make
-- TRUNCATE on ledger_entry fail on the reference before its append-only
-- trigger could refuse it.
ALTER TABLE earning_entry
  ADD COLUMN ledger_entry_id bigint UNIQUE;

CREATE UNIQUE INDEX earning_entry_once_per_order
  ON earning_entry (order_id, type)
  WHERE order_id IS NOT NULL AND type IN ('DELIVERY', 'TIP');

-- A line mirrors its posting exactly: the rider's payable account, the same
-- rider, the same order and the same amount.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION earning_entry_matches_ledger() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  le ledger_entry%ROWTYPE;
BEGIN
  IF NEW.ledger_entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO le FROM ledger_entry WHERE id = NEW.ledger_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'earning_entry_ledger_mismatch: earning % names ledger entry %, which does not exist',
      NEW.id, NEW.ledger_entry_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF le.account <> 'RIDER_PAYABLE'
     OR le.counterparty_type IS DISTINCT FROM 'RIDER'
     OR le.counterparty_id IS DISTINCT FROM NEW.account_id
     OR le.order_id IS DISTINCT FROM NEW.order_id
     OR le.amount_cents <> NEW.gross_cents
  THEN
    RAISE EXCEPTION
      'earning_entry_ledger_mismatch: earning % (% cents for rider %) does not mirror ledger entry % (% %, % cents for %)',
      NEW.id, NEW.gross_cents, NEW.account_id, le.id, le.account, le.counterparty_type,
      le.amount_cents, le.counterparty_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER earning_entry_matches_ledger
  BEFORE INSERT OR UPDATE OF ledger_entry_id, account_id, order_id, gross_cents ON earning_entry
  FOR EACH ROW EXECUTE FUNCTION earning_entry_matches_ledger();

-- The payout run's stamp on a posting carries over to its line.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION earning_entry_follow_payout_stamp() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE earning_entry e
     SET payout_id = NEW.payout_id,
         status = CASE WHEN p.state = 'PAID' THEN 'PAID'::earning_entry_status ELSE e.status END
    FROM payout p
   WHERE p.id = NEW.payout_id
     AND e.ledger_entry_id = NEW.id
     AND e.payout_id IS NULL;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER ledger_entry_stamps_earning
  AFTER UPDATE OF payout_id ON ledger_entry
  FOR EACH ROW
  WHEN (OLD.payout_id IS NULL AND NEW.payout_id IS NOT NULL)
  EXECUTE FUNCTION earning_entry_follow_payout_stamp();

-- A paid payout pays its lines. A reversed line stays reversed.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION earning_entry_follow_payout_paid() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE earning_entry
     SET status = 'PAID'
   WHERE payout_id = NEW.id
     AND status IN ('PENDING', 'AVAILABLE');
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER payout_pays_earnings
  AFTER UPDATE OF state ON payout
  FOR EACH ROW
  WHEN (NEW.state = 'PAID' AND OLD.state IS DISTINCT FROM 'PAID')
  EXECUTE FUNCTION earning_entry_follow_payout_paid();

-- +goose Down
DROP TRIGGER IF EXISTS payout_pays_earnings ON payout;
DROP FUNCTION IF EXISTS earning_entry_follow_payout_paid();
DROP TRIGGER IF EXISTS ledger_entry_stamps_earning ON ledger_entry;
DROP FUNCTION IF EXISTS earning_entry_follow_payout_stamp();
DROP TRIGGER IF EXISTS earning_entry_matches_ledger ON earning_entry;
DROP FUNCTION IF EXISTS earning_entry_matches_ledger();
DROP INDEX IF EXISTS earning_entry_once_per_order;
ALTER TABLE earning_entry DROP COLUMN IF EXISTS ledger_entry_id;
