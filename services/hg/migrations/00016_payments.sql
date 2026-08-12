-- P-16..P-18 — Stripe PaymentIntents, webhooks, refunds, chargebacks.
--
-- Auth-then-capture. The PaymentIntent is created with capture_method=manual;
-- funds are authorised at checkout and captured only when the restaurant
-- accepts. A rejected or timed-out order therefore needs no refund at all,
-- which deletes the entire "we charged them and then failed to refund" class.
--
-- No PAN, no CVV, no fabricated identifiers. The store-then-process webhook
-- boundary is a Postgres unique index, not a Redis key, so idempotency survives
-- a flush.

-- +goose Up

CREATE TABLE payment_intent (
  id                        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                  uuid NOT NULL REFERENCES "order"(id),
  kind                      payment_intent_kind NOT NULL DEFAULT 'ORDER',
  stripe_payment_intent_id  text NOT NULL UNIQUE,
  stripe_customer_id        text,
  stripe_payment_method_id  text,
  state                     payment_state NOT NULL,
  amount_authorized_cents   bigint NOT NULL CHECK (amount_authorized_cents >= 0),
  amount_captured_cents     bigint NOT NULL DEFAULT 0 CHECK (amount_captured_cents >= 0),
  amount_refunded_cents     bigint NOT NULL DEFAULT 0 CHECK (amount_refunded_cents >= 0),
  currency                  currency_code NOT NULL DEFAULT 'CAD',
  psp_fee_cents             bigint,
  card_brand                text,
  card_last4                text,
  card_country              char(2),
  wallet                    text,
  failure_code              text,
  failure_message           text,
  decline_code              text,
  last_stripe_event_created_at timestamptz,           -- out-of-order webhook guard
  authorized_at             timestamptz,
  captured_at               timestamptz,
  canceled_at               timestamptz,
  deadline_at               timestamptz,
  deadline_action           text,
  deadline_escalations      int NOT NULL DEFAULT 0,
  lease_until               timestamptz,
  lease_owner               text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capture_le_auth CHECK (amount_captured_cents <= amount_authorized_cents),
  CONSTRAINT refund_le_capture CHECK (amount_refunded_cents <= amount_captured_cents),
  CONSTRAINT payment_intent_deadline_required CHECK (
    (state IN ('SUCCEEDED', 'CANCELED', 'FAILED') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'CANCELED', 'FAILED') AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  )
);
SELECT attach_updated_at('payment_intent');
CREATE UNIQUE INDEX payment_intent_order_primary ON payment_intent (order_id) WHERE kind = 'ORDER';
CREATE INDEX payment_intent_due ON payment_intent (deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX payment_intent_order ON payment_intent (order_id);

CREATE TABLE saved_payment_method (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id               uuid NOT NULL REFERENCES account(id),
  stripe_payment_method_id text NOT NULL UNIQUE,
  brand                    text NOT NULL,
  last4                    text NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month                int NOT NULL CHECK (exp_month BETWEEN 1 AND 12),
  exp_year                 int NOT NULL CHECK (exp_year BETWEEN 2000 AND 2100),
  is_default               boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz
);
SELECT attach_updated_at('saved_payment_method');
CREATE UNIQUE INDEX saved_payment_method_one_default ON saved_payment_method (account_id)
  WHERE is_default AND deleted_at IS NULL;

-- P-17 — store-then-process. The unique index below IS the idempotency
-- boundary; a redelivered event returns 200 without touching business state.
CREATE TABLE webhook_event (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider          text NOT NULL DEFAULT 'stripe',
  stripe_event_id   text NOT NULL,
  type              text NOT NULL,
  api_version       text,
  payload           jsonb NOT NULL,
  livemode          boolean NOT NULL,
  event_created_at  timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  deadline_at       timestamptz,
  deadline_action   text,
  lease_until       timestamptz,
  lease_owner       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_event_deadline_required CHECK (
    processed_at IS NOT NULL OR (deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  )
);
SELECT attach_updated_at('webhook_event');
CREATE UNIQUE INDEX webhook_event_dedupe ON webhook_event (provider, stripe_event_id);
CREATE INDEX webhook_event_pending ON webhook_event (deadline_at) WHERE processed_at IS NULL;

CREATE TABLE reconciliation_exception (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  kind             text NOT NULL,
  order_id         uuid REFERENCES "order"(id),
  payout_id        uuid,                              -- FK added in 00018
  stripe_object_id text,
  expected_cents   bigint,
  actual_cents     bigint,
  detected_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolution       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('reconciliation_exception');
CREATE INDEX reconciliation_exception_open ON reconciliation_exception (detected_at) WHERE resolved_at IS NULL;

-- P-18 — refunds. The caller never sends an amount except for GOODWILL.
CREATE TABLE refund (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id                    uuid NOT NULL REFERENCES "order"(id),
  payment_intent_id           uuid NOT NULL REFERENCES payment_intent(id),
  stripe_refund_id            text UNIQUE,
  kind                        refund_kind NOT NULL,
  scope                       refund_scope NOT NULL DEFAULT 'FULL',
  reason_code                 refund_reason_code NOT NULL,
  note                        text,
  amount_cents                bigint NOT NULL CHECK (amount_cents > 0),
  tax_cents                   bigint NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  restaurant_chargeback_cents bigint NOT NULL DEFAULT 0 CHECK (restaurant_chargeback_cents >= 0),
  rider_chargeback_cents      bigint NOT NULL DEFAULT 0 CHECK (rider_chargeback_cents >= 0),
  platform_absorbed_cents     bigint NOT NULL DEFAULT 0 CHECK (platform_absorbed_cents >= 0),
  state                       refund_state NOT NULL DEFAULT 'REQUESTED',
  approval_status             text CHECK (approval_status IS NULL OR approval_status IN ('PENDING', 'APPROVED', 'DECLINED')),
  requested_by                uuid NOT NULL REFERENCES account(id),
  approved_by                 uuid REFERENCES account(id),
  requested_at                timestamptz NOT NULL DEFAULT now(),
  settled_at                  timestamptz,
  failure_message             text,
  attempts                    int NOT NULL DEFAULT 0,
  last_error                  text,
  deadline_at                 timestamptz,
  deadline_action             text,
  lease_until                 timestamptz,
  lease_owner                 text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  -- I-18.3: only GOODWILL carries an operator-entered amount, and it needs a
  -- named approver.
  CONSTRAINT refund_goodwill_needs_approval CHECK (
    kind <> 'GOODWILL' OR approved_by IS NOT NULL OR state IN ('REQUESTED', 'PENDING_APPROVAL', 'DECLINED', 'CANCELLED')
  ),
  -- I-18.4: an unfinished refund is always on a clock; it is never silently
  -- swallowed the way the old "refund would be initiated here" TODO was.
  CONSTRAINT refund_deadline_required CHECK (
    (state IN ('SUCCEEDED', 'SETTLED', 'DECLINED', 'CANCELLED') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state NOT IN ('SUCCEEDED', 'SETTLED', 'DECLINED', 'CANCELLED') AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  ),
  CONSTRAINT refund_liability_split CHECK (
    restaurant_chargeback_cents + rider_chargeback_cents + platform_absorbed_cents <= amount_cents
  )
);
SELECT attach_updated_at('refund');
CREATE INDEX refund_order ON refund (order_id);
CREATE INDEX refund_due ON refund (deadline_at) WHERE deadline_at IS NOT NULL;

CREATE TABLE refund_line (
  refund_id      uuid NOT NULL REFERENCES refund(id) ON DELETE CASCADE,
  order_line_no  int NOT NULL,
  quantity       int NOT NULL CHECK (quantity > 0),
  amount_cents   bigint NOT NULL CHECK (amount_cents > 0),
  PRIMARY KEY (refund_id, order_line_no)
);

-- I-18.1: the sum of an order's refunds may never exceed what was captured.
-- Deferred so a refund and its ledger batch can be written together.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION refund_assert_within_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  captured bigint;
  refunded bigint;
BEGIN
  SELECT COALESCE(sum(amount_captured_cents), 0) INTO captured
    FROM payment_intent WHERE order_id = NEW.order_id;
  SELECT COALESCE(sum(amount_cents), 0) INTO refunded
    FROM refund
   WHERE order_id = NEW.order_id
     AND state NOT IN ('DECLINED', 'CANCELLED', 'FAILED');
  IF refunded > captured THEN
    RAISE EXCEPTION
      'refund_exceeds_captured: order % has captured % but refunds total %',
      NEW.order_id, captured, refunded
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER refund_within_capture
  AFTER INSERT OR UPDATE ON refund
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION refund_assert_within_capture();

CREATE TABLE chargeback (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id          uuid NOT NULL REFERENCES "order"(id),
  stripe_dispute_id text NOT NULL UNIQUE,
  amount_cents      bigint NOT NULL CHECK (amount_cents > 0),
  reason            text,
  state             text NOT NULL,
  evidence_due_at   timestamptz,
  submitted_at      timestamptz,
  outcome           text,
  deadline_at       timestamptz,
  deadline_action   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('chargeback');
CREATE INDEX chargeback_order ON chargeback (order_id);
CREATE INDEX chargeback_due ON chargeback (deadline_at) WHERE deadline_at IS NOT NULL;

-- +goose Down
DROP TABLE IF EXISTS chargeback;
DROP TRIGGER IF EXISTS refund_within_capture ON refund;
DROP FUNCTION IF EXISTS refund_assert_within_capture();
DROP TABLE IF EXISTS refund_line;
DROP TABLE IF EXISTS refund;
DROP TABLE IF EXISTS reconciliation_exception;
DROP TABLE IF EXISTS webhook_event;
DROP TABLE IF EXISTS saved_payment_method;
DROP TABLE IF EXISTS payment_intent;
