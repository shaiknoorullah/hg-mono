-- P-13 — the double-entry ledger and the zero-residual invariant.
--
-- Every cent that moves is a posting. This is the mechanism that makes "the
-- charge decomposes exactly with zero residual" a database fact rather than an
-- aspiration:
--
--   * a batch that does not sum to zero cannot commit (deferred constraint
--     trigger, checked at COMMIT so the rows may be written in any order);
--   * ledger_entry is append-only by REVOKE *and* by trigger — corrections are
--     new ADJUSTMENT batches, never edits;
--   * the decomposition invariant is one query returning zero rows
--     (view ledger_order_residual, below).

-- +goose Up

CREATE TABLE ledger_batch (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  kind            ledger_batch_kind NOT NULL,
  order_id        uuid REFERENCES "order"(id),
  payout_id       uuid,                              -- FK added in 00018
  refund_id       uuid REFERENCES refund(id),
  -- Deadline actions are keyed by (subject, state, escalation_no), so a
  -- re-run after a crash reuses the same key and posts once.
  idempotency_key text NOT NULL UNIQUE,
  posted_at       timestamptz NOT NULL DEFAULT now(),
  posted_by       text NOT NULL,                     -- 'system:capture', 'admin:<uuid>'
  memo            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_batch_order ON ledger_batch (order_id);
CREATE INDEX ledger_batch_kind ON ledger_batch (kind, posted_at DESC);

CREATE TABLE ledger_entry (
  id                bigserial PRIMARY KEY,
  batch_id          uuid NOT NULL REFERENCES ledger_batch(id),
  order_id          uuid REFERENCES "order"(id),
  account           ledger_account NOT NULL,
  counterparty_type ledger_counterparty_type,
  counterparty_id   uuid,
  amount_cents      bigint NOT NULL,                 -- signed; sum per batch = 0
  currency          currency_code NOT NULL DEFAULT 'CAD',
  component         ledger_component NOT NULL,
  memo              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entry_order ON ledger_entry (order_id);
CREATE INDEX ledger_entry_batch ON ledger_entry (batch_id);
CREATE INDEX ledger_entry_cp ON ledger_entry (counterparty_type, counterparty_id, account);
CREATE INDEX ledger_entry_component ON ledger_entry (component, account);

-- ---------------------------------------------------------------------------
-- I-13.1 — batch balance, enforced at COMMIT.
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ledger_assert_batch_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  residual bigint;
  n int;
BEGIN
  SELECT COALESCE(sum(amount_cents), 0), count(*)
    INTO residual, n
    FROM ledger_entry
   WHERE batch_id = NEW.batch_id;

  IF n = 0 THEN
    RETURN NULL;                     -- batch emptied inside the same tx
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION
      'ledger_batch_unbalanced: batch % has a single entry; a posting always has a counter-posting',
      NEW.batch_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF residual <> 0 THEN
    RAISE EXCEPTION
      'ledger_batch_unbalanced: batch % sums to % cents, must be 0', NEW.batch_id, residual
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER ledger_entry_batch_balanced
  AFTER INSERT ON ledger_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_batch_balanced();

-- A batch with no entries at all is also rejected at COMMIT.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION ledger_assert_batch_nonempty() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM ledger_entry WHERE batch_id = NEW.id;
  IF n = 0 THEN
    RAISE EXCEPTION 'ledger_batch_empty: batch % has no entries', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER ledger_batch_has_entries
  AFTER INSERT ON ledger_batch
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_assert_batch_nonempty();

-- ---------------------------------------------------------------------------
-- I-13.6 — append-only. Two layers: the trigger below, and the REVOKE in
-- 00023 which withholds UPDATE/DELETE from hg_app entirely. The trigger is
-- what stops a superuser session or a future GRANT from quietly rewriting
-- financial history.
-- ---------------------------------------------------------------------------
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

CREATE TRIGGER ledger_entry_append_only
  BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();

CREATE TRIGGER ledger_entry_no_truncate
  BEFORE TRUNCATE ON ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_reject_mutation();

CREATE TRIGGER ledger_batch_append_only
  BEFORE DELETE ON ledger_batch
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();

-- ---------------------------------------------------------------------------
-- The invariants, each as one query that must return zero rows.
-- ---------------------------------------------------------------------------

-- I-13.1
CREATE VIEW ledger_batch_imbalance AS
  SELECT batch_id, sum(amount_cents)::bigint AS residual_cents
    FROM ledger_entry
   GROUP BY batch_id
  HAVING sum(amount_cents) <> 0;

-- I-13.2 — THE decomposition invariant. For an order in a terminal money
-- state, every cent the customer paid is accounted for across restaurant,
-- rider, platform and tax, with nothing left over.
CREATE VIEW ledger_order_residual AS
  SELECT le.order_id, sum(le.amount_cents)::bigint AS residual_cents
    FROM ledger_entry le
    JOIN "order" o ON o.id = le.order_id
   WHERE o.state IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')
   GROUP BY le.order_id
  HAVING sum(le.amount_cents) <> 0;

-- I-13.7 — global balance.
CREATE VIEW ledger_global_residual AS
  SELECT sum(amount_cents)::bigint AS residual_cents
    FROM ledger_entry
  HAVING sum(amount_cents) <> 0;

-- I-13.3 — charge identity: what the customer was charged equals captured
-- minus refunded.
CREATE VIEW ledger_charge_identity_breach AS
  SELECT o.id AS order_id,
         (-COALESCE(sum(le.amount_cents) FILTER (WHERE le.account = 'CUSTOMER_CHARGES'), 0))::bigint AS ledger_net_cents,
         (COALESCE(max(pi.amount_captured_cents), 0) - COALESCE(max(pi.amount_refunded_cents), 0))::bigint AS psp_net_cents
    FROM "order" o
    LEFT JOIN ledger_entry le ON le.order_id = o.id
    LEFT JOIN payment_intent pi ON pi.order_id = o.id AND pi.kind = 'ORDER'
   GROUP BY o.id
  HAVING -COALESCE(sum(le.amount_cents) FILTER (WHERE le.account = 'CUSTOMER_CHARGES'), 0)
      <> COALESCE(max(pi.amount_captured_cents), 0) - COALESCE(max(pi.amount_refunded_cents), 0);

-- I-13.5 — tips pass through to the rider in full.
CREATE VIEW ledger_tip_passthrough_breach AS
  SELECT o.id AS order_id, o.tip_cents,
         COALESCE(sum(le.amount_cents) FILTER (
           WHERE le.component = 'TIP' AND le.account = 'RIDER_PAYABLE'), 0)::bigint AS rider_tip_cents
    FROM "order" o
    LEFT JOIN ledger_entry le ON le.order_id = o.id
   WHERE o.state = 'COMPLETED' AND o.tip_cents > 0
   GROUP BY o.id, o.tip_cents
  HAVING COALESCE(sum(le.amount_cents) FILTER (
           WHERE le.component = 'TIP' AND le.account = 'RIDER_PAYABLE'), 0) <> o.tip_cents;

-- Convenience: a party's balance is the sum over their payable account.
CREATE VIEW ledger_party_balance AS
  SELECT counterparty_type, counterparty_id, account,
         sum(amount_cents)::bigint AS balance_cents
    FROM ledger_entry
   WHERE account IN ('RESTAURANT_PAYABLE', 'RIDER_PAYABLE')
     AND counterparty_id IS NOT NULL
   GROUP BY counterparty_type, counterparty_id, account;

-- One call, for the nightly job and for tests: raises on any breach.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION assert_ledger_invariants() RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE n bigint; msg text := '';
BEGIN
  SELECT count(*) INTO n FROM ledger_batch_imbalance;
  IF n > 0 THEN msg := msg || format(E'\n  I-13.1 batch balance: %s unbalanced batch(es)', n); END IF;
  SELECT count(*) INTO n FROM ledger_order_residual;
  IF n > 0 THEN msg := msg || format(E'\n  I-13.2 order decomposition: %s order(s) with a non-zero residual', n); END IF;
  SELECT count(*) INTO n FROM ledger_global_residual;
  IF n > 0 THEN msg := msg || E'\n  I-13.7 global balance: SUM(ledger_entry) <> 0'; END IF;
  SELECT count(*) INTO n FROM ledger_charge_identity_breach;
  IF n > 0 THEN msg := msg || format(E'\n  I-13.3 charge identity: %s order(s) disagree with the PSP', n); END IF;
  SELECT count(*) INTO n FROM ledger_tip_passthrough_breach;
  IF n > 0 THEN msg := msg || format(E'\n  I-13.5 tip pass-through: %s order(s) short-paid a tip', n); END IF;
  IF msg <> '' THEN
    RAISE EXCEPTION 'ledger invariants breached:%', msg USING ERRCODE = 'check_violation';
  END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS assert_ledger_invariants();
DROP VIEW IF EXISTS ledger_party_balance;
DROP VIEW IF EXISTS ledger_tip_passthrough_breach;
DROP VIEW IF EXISTS ledger_charge_identity_breach;
DROP VIEW IF EXISTS ledger_global_residual;
DROP VIEW IF EXISTS ledger_order_residual;
DROP VIEW IF EXISTS ledger_batch_imbalance;
DROP TRIGGER IF EXISTS ledger_batch_append_only ON ledger_batch;
DROP TRIGGER IF EXISTS ledger_entry_no_truncate ON ledger_entry;
DROP TRIGGER IF EXISTS ledger_entry_append_only ON ledger_entry;
DROP FUNCTION IF EXISTS ledger_reject_mutation();
DROP TRIGGER IF EXISTS ledger_batch_has_entries ON ledger_batch;
DROP FUNCTION IF EXISTS ledger_assert_batch_nonempty();
DROP TRIGGER IF EXISTS ledger_entry_batch_balanced ON ledger_entry;
DROP FUNCTION IF EXISTS ledger_assert_batch_balanced();
DROP TABLE IF EXISTS ledger_entry;
DROP TABLE IF EXISTS ledger_batch;
