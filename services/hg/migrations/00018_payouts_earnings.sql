-- P-19 — Stripe Connect, payouts and rider earnings.
--
-- Separate charges and transfers: the platform controls the exact split across
-- four parties and can hold or reverse one partner's share independently.
-- Posting a payout stamps payout_id on exactly the entries it pays, so a
-- ledger row can never be paid twice.
--
-- Launch settings (S-03/S-04): rider earnings = delivery fee pass-through plus
-- 100% of tips; weekly Monday payouts, automatic, no minimum.

-- +goose Up

CREATE TABLE connect_account (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  owner_type           text NOT NULL CHECK (owner_type IN ('RESTAURANT', 'RIDER')),
  owner_id             uuid NOT NULL,
  stripe_account_id    text NOT NULL UNIQUE,
  country              char(2) NOT NULL DEFAULT 'CA',
  default_currency     currency_code NOT NULL DEFAULT 'CAD',
  charges_enabled      boolean NOT NULL DEFAULT false,
  payouts_enabled      boolean NOT NULL DEFAULT false,
  details_submitted    boolean NOT NULL DEFAULT false,
  requirements         jsonb NOT NULL DEFAULT '{}'::jsonb,
  disabled_reason      text,
  payout_interval      payout_interval NOT NULL DEFAULT 'WEEKLY',
  payout_anchor        int NOT NULL DEFAULT 1,        -- 1 = Monday (S-04)
  minimum_payout_cents bigint NOT NULL DEFAULT 0,     -- R-03: no minimum at launch
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connect_account_country_ca CHECK (country = 'CA'),
  CONSTRAINT connect_account_anchor CHECK (payout_anchor BETWEEN 1 AND 28),
  CONSTRAINT connect_account_minimum CHECK (minimum_payout_cents >= 0)
);
SELECT attach_updated_at('connect_account');
CREATE UNIQUE INDEX connect_account_owner ON connect_account (owner_type, owner_id);

CREATE TABLE payout (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  connect_account_id  uuid NOT NULL REFERENCES connect_account(id),
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  amount_cents        bigint NOT NULL,
  currency            currency_code NOT NULL DEFAULT 'CAD',
  state               payout_state NOT NULL DEFAULT 'DRAFT',
  stripe_transfer_id  text UNIQUE,
  stripe_payout_id    text UNIQUE,
  hold_reason         text,
  entry_count         int NOT NULL DEFAULT 0,
  attempts            int NOT NULL DEFAULT 0,
  last_error          text,
  failure_message     text,
  deadline_at         timestamptz,
  deadline_action     text,
  deadline_escalations int NOT NULL DEFAULT 0,
  lease_until         timestamptz,
  lease_owner         text,
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_period CHECK (period_end > period_start),
  CONSTRAINT payout_held_has_reason CHECK (state <> 'HELD' OR hold_reason IS NOT NULL),
  CONSTRAINT payout_deadline_required CHECK (
    (state IN ('PAID', 'FAILED') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state NOT IN ('PAID', 'FAILED') AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  )
);
SELECT attach_updated_at('payout');
CREATE INDEX payout_account ON payout (connect_account_id, period_end DESC);
CREATE INDEX payout_due ON payout (deadline_at) WHERE deadline_at IS NOT NULL;

ALTER TABLE ledger_batch
  ADD CONSTRAINT ledger_batch_payout_fk FOREIGN KEY (payout_id) REFERENCES payout(id);
ALTER TABLE reconciliation_exception
  ADD CONSTRAINT reconciliation_exception_payout_fk FOREIGN KEY (payout_id) REFERENCES payout(id);

-- I-19.1: a ledger entry belongs to at most one payout. Adding the column here
-- rather than in 00017 keeps the FK direction honest.
ALTER TABLE ledger_entry ADD COLUMN payout_id uuid REFERENCES payout(id);
CREATE INDEX ledger_entry_payable_unpaid ON ledger_entry (counterparty_type, counterparty_id, account)
  WHERE payout_id IS NULL AND account IN ('RESTAURANT_PAYABLE', 'RIDER_PAYABLE');
CREATE INDEX ledger_entry_payout ON ledger_entry (payout_id) WHERE payout_id IS NOT NULL;

-- ledger_entry is append-only, so stamping payout_id must be an explicit,
-- narrow exception rather than a general UPDATE grant. This is the only
-- mutation the ledger permits, and only from NULL.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ledger_entry' THEN
    IF OLD.payout_id IS NULL
       AND NEW.payout_id IS NOT NULL
       AND ROW(NEW.id, NEW.batch_id, NEW.order_id, NEW.account, NEW.counterparty_type,
               NEW.counterparty_id, NEW.amount_cents, NEW.currency, NEW.component,
               NEW.memo, NEW.created_at)
        IS NOT DISTINCT FROM
           ROW(OLD.id, OLD.batch_id, OLD.order_id, OLD.account, OLD.counterparty_type,
               OLD.counterparty_id, OLD.amount_cents, OLD.currency, OLD.component,
               OLD.memo, OLD.created_at)
    THEN
      RETURN NEW;                      -- claim by a payout run: permitted once
    END IF;
  END IF;
  RAISE EXCEPTION
    'ledger_is_append_only: % on % is never permitted; post an ADJUSTMENT batch instead',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END
$$;
-- +goose StatementEnd

-- I-19.2: payout.amount_cents equals the sum of the entries it claims.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION payout_assert_amount_matches_entries() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  claimed bigint;
  n int;
BEGIN
  IF NEW.state IN ('DRAFT') THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(amount_cents), 0), count(*) INTO claimed, n
    FROM ledger_entry WHERE payout_id = NEW.id;
  IF claimed <> NEW.amount_cents THEN
    RAISE EXCEPTION
      'payout_amount_mismatch: payout % declares % but claims entries summing to %',
      NEW.id, NEW.amount_cents, claimed
      USING ERRCODE = 'check_violation';
  END IF;
  IF n <> NEW.entry_count THEN
    RAISE EXCEPTION
      'payout_entry_count_mismatch: payout % declares % entries but claims %',
      NEW.id, NEW.entry_count, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER payout_amount_matches_entries
  AFTER INSERT OR UPDATE ON payout
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION payout_assert_amount_matches_entries();

-- Rider earnings ledger, as the rider app renders it. Money here mirrors
-- RIDER_PAYABLE postings; the ledger remains the source of truth.
CREATE TABLE earning_entry (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id             uuid NOT NULL REFERENCES account(id),
  assignment_id          uuid REFERENCES assignment(id),
  order_id               uuid REFERENCES "order"(id),
  order_code             text,
  type                   earning_entry_type NOT NULL,
  status                 earning_entry_status NOT NULL DEFAULT 'PENDING',
  base_cents             bigint NOT NULL DEFAULT 0,
  distance_cents         bigint NOT NULL DEFAULT 0,
  wait_cents             bigint NOT NULL DEFAULT 0,
  surge_multiplier_bps   int NOT NULL DEFAULT 10000,
  guarantee_topup_cents  bigint NOT NULL DEFAULT 0,
  tip_cents              bigint NOT NULL DEFAULT 0,
  adjustment_cents       bigint NOT NULL DEFAULT 0,
  gross_cents            bigint NOT NULL,
  currency               currency_code NOT NULL DEFAULT 'CAD',
  billable_distance_m    int,
  distance_source        route_source,
  formula_version        int NOT NULL DEFAULT 1,
  payout_id              uuid REFERENCES payout(id),
  ledger_batch_id        uuid REFERENCES ledger_batch(id),
  earned_at              timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT earning_entry_gross_identity CHECK (
    gross_cents = base_cents + distance_cents + wait_cents
                + guarantee_topup_cents + tip_cents + adjustment_cents
  ),
  CONSTRAINT earning_entry_paid_has_payout CHECK (status <> 'PAID' OR payout_id IS NOT NULL)
);
SELECT attach_updated_at('earning_entry');
CREATE INDEX earning_entry_rider ON earning_entry (account_id, earned_at DESC);
CREATE INDEX earning_entry_unpaid ON earning_entry (account_id) WHERE payout_id IS NULL;
CREATE UNIQUE INDEX earning_entry_one_delivery_per_assignment
  ON earning_entry (assignment_id, type) WHERE assignment_id IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS earning_entry;
DROP TRIGGER IF EXISTS payout_amount_matches_entries ON payout;
DROP FUNCTION IF EXISTS payout_assert_amount_matches_entries();
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'ledger_is_append_only: % on % is never permitted; post an ADJUSTMENT batch instead',
    TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END
$$;
-- +goose StatementEnd
DROP INDEX IF EXISTS ledger_entry_payout;
DROP INDEX IF EXISTS ledger_entry_payable_unpaid;
ALTER TABLE ledger_entry DROP COLUMN IF EXISTS payout_id;
ALTER TABLE reconciliation_exception DROP CONSTRAINT IF EXISTS reconciliation_exception_payout_fk;
ALTER TABLE ledger_batch DROP CONSTRAINT IF EXISTS ledger_batch_payout_fk;
DROP TABLE IF EXISTS payout;
DROP TABLE IF EXISTS connect_account;
