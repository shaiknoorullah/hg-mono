-- P-14 / P-15 — the 14-state order machine and the deadline constraint.
--
-- The constraint below is the point of this file. "An order waits forever" is
-- not prevented by a job that might not run; it is unrepresentable, because a
-- non-terminal order with a NULL deadline_at or a NULL deadline_action cannot
-- be committed. The deadline runner claims due rows with FOR UPDATE SKIP
-- LOCKED and either transitions (setting a new deadline, or NULLing it on the
-- way into a terminal state) or re-arms.

-- +goose Up

CREATE TABLE "order" (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code                  text NOT NULL UNIQUE,          -- 'HG-8F3K2Q'
  quote_id              uuid NOT NULL REFERENCES quote(id),
  account_id            uuid NOT NULL REFERENCES account(id),
  restaurant_id         uuid NOT NULL REFERENCES restaurant(id),
  delivery_address_id   uuid REFERENCES address(id),
  fulfilment            fulfilment NOT NULL DEFAULT 'DELIVERY',

  state                 order_state NOT NULL,
  state_since           timestamptz NOT NULL DEFAULT now(),

  -- G-5 deadline machinery
  deadline_at           timestamptz,
  deadline_action       text,
  deadline_escalations  int NOT NULL DEFAULT 0,
  lease_until           timestamptz,
  lease_owner           text,

  currency              currency_code NOT NULL DEFAULT 'CAD',
  subtotal_cents        bigint NOT NULL,
  discount_cents        bigint NOT NULL DEFAULT 0,
  delivery_fee_cents    bigint NOT NULL DEFAULT 0,
  service_fee_cents     bigint NOT NULL DEFAULT 0,
  tax_total_cents       bigint NOT NULL DEFAULT 0,
  tip_cents             bigint NOT NULL DEFAULT 0,
  total_cents           bigint NOT NULL,
  commission_cents      bigint NOT NULL DEFAULT 0,
  restaurant_net_cents  bigint NOT NULL DEFAULT 0,
  rider_earnings_cents  bigint NOT NULL DEFAULT 0,
  platform_gross_cents  bigint NOT NULL DEFAULT 0,

  prep_eta_minutes      int,
  promised_ready_at     timestamptz,
  eta_at                timestamptz,
  delivery_instructions delivery_instruction[] NOT NULL DEFAULT '{}',
  special_instructions  text,

  cancel_reason         order_cancellation_reason_code,
  customer_cancel_reason customer_cancellation_reason_code,
  reject_reason         restaurant_reject_reason_code,
  reject_note           text,
  receipt_snapshot      jsonb,                          -- written once, at COMPLETED

  placed_at             timestamptz NOT NULL DEFAULT now(),
  authorized_at         timestamptz,
  offered_at            timestamptz,
  accepted_at           timestamptz,
  ready_at              timestamptz,
  picked_up_at          timestamptz,
  arrived_at            timestamptz,
  delivered_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- =====================================================================
  -- THE constraint (P-15 / I-15.1). Terminal states carry no deadline;
  -- every other state carries both a deadline and a named action.
  -- =====================================================================
  CONSTRAINT order_deadline_required CHECK (
    (state IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')
       AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')
       AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  ),
  CONSTRAINT order_money_non_negative CHECK (
    subtotal_cents >= 0 AND discount_cents >= 0 AND delivery_fee_cents >= 0
    AND service_fee_cents >= 0 AND tax_total_cents >= 0 AND tip_cents >= 0
    AND total_cents >= 0
  ),
  CONSTRAINT order_total_identity CHECK (
    total_cents = subtotal_cents - discount_cents + delivery_fee_cents
                + service_fee_cents + tax_total_cents + tip_cents
  ),
  CONSTRAINT order_reject_has_reason CHECK (state <> 'REJECTED' OR reject_reason IS NOT NULL),
  CONSTRAINT order_cancel_has_reason CHECK (state <> 'CANCELLED' OR cancel_reason IS NOT NULL),
  CONSTRAINT order_delivery_needs_address CHECK (
    fulfilment <> 'DELIVERY' OR delivery_address_id IS NOT NULL
  ),
  CONSTRAINT order_escalations_bounded CHECK (deadline_escalations BETWEEN 0 AND 32)
);
SELECT attach_updated_at('order');

CREATE INDEX order_due ON "order" (deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX order_claimable ON "order" (deadline_at)
  WHERE deadline_at IS NOT NULL AND lease_until IS NULL;
CREATE INDEX order_by_restaurant ON "order" (restaurant_id, state, placed_at DESC);
CREATE INDEX order_by_customer ON "order" (account_id, placed_at DESC);
CREATE UNIQUE INDEX order_one_per_quote ON "order" (quote_id);

ALTER TABLE stored_object
  ADD CONSTRAINT stored_object_order_fk FOREIGN KEY (order_id) REFERENCES "order"(id);

-- I-09.2: order.total_cents always equals its quote's total_cents.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION order_assert_quote_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  q_total bigint;
BEGIN
  SELECT total_cents INTO q_total FROM quote WHERE id = NEW.quote_id;
  IF q_total IS DISTINCT FROM NEW.total_cents THEN
    RAISE EXCEPTION
      'order_total_diverges_from_quote: order % has total % but quote % has %',
      NEW.id, NEW.total_cents, NEW.quote_id, q_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER order_total_matches_quote
  BEFORE INSERT OR UPDATE OF total_cents, quote_id ON "order"
  FOR EACH ROW EXECUTE FUNCTION order_assert_quote_total();

-- I-10.3: the receipt snapshot is written once and never rewritten, so a later
-- config change cannot alter a historical receipt.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION order_receipt_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.receipt_snapshot IS NOT NULL AND NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot THEN
    RAISE EXCEPTION 'receipt_snapshot_is_immutable: order %', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER order_receipt_write_once
  BEFORE UPDATE OF receipt_snapshot ON "order"
  FOR EACH ROW EXECUTE FUNCTION order_receipt_snapshot_immutable();

-- Order lines snapshot price AND content at creation. `item_version_id` pins
-- the reviewed descriptive version, so nothing that later happens to the menu
-- can change what an existing order said it was.
CREATE TABLE order_line (
  order_id          uuid NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  line_no           int NOT NULL,
  menu_item_id      uuid NOT NULL REFERENCES menu_item(id),
  item_version_id   uuid REFERENCES menu_item_version(id),
  name_snapshot     text NOT NULL,
  variant_id        uuid REFERENCES variant(id),
  variant_name      text,
  variant_pricing_mode variant_pricing_mode,
  quantity          int NOT NULL CHECK (quantity > 0),
  base_price_cents  bigint NOT NULL,
  variant_part_cents bigint NOT NULL,
  addons_part_cents bigint NOT NULL,
  line_unit_cents   bigint NOT NULL,
  line_total_cents  bigint NOT NULL,
  special_request   text,
  tax_category      tax_category NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, line_no),
  CONSTRAINT order_line_identity CHECK (
    line_unit_cents = variant_part_cents + addons_part_cents
    AND line_total_cents = line_unit_cents * quantity
  ),
  CONSTRAINT order_line_non_negative CHECK (
    base_price_cents >= 0 AND variant_part_cents >= 0 AND addons_part_cents >= 0
    AND line_unit_cents >= 0 AND line_total_cents >= 0
  )
);
CREATE INDEX order_line_item ON order_line (menu_item_id);

CREATE TABLE order_line_addon (
  order_id          uuid NOT NULL,
  line_no           int NOT NULL,
  addon_id          uuid NOT NULL REFERENCES addon(id),
  addon_name        text NOT NULL,
  addon_quantity    int NOT NULL CHECK (addon_quantity > 0),
  addon_price_cents bigint NOT NULL CHECK (addon_price_cents >= 0),
  PRIMARY KEY (order_id, line_no, addon_id),
  FOREIGN KEY (order_id, line_no) REFERENCES order_line(order_id, line_no) ON DELETE CASCADE
);

-- I-14.2: exactly one row per state change, in the same transaction.
CREATE TABLE order_transition (
  id               bigserial PRIMARY KEY,
  order_id         uuid NOT NULL REFERENCES "order"(id),
  from_state       order_state,
  to_state         order_state NOT NULL,
  actor_kind       order_actor_kind NOT NULL,
  actor_account_id uuid REFERENCES account(id),
  reason           text,
  request_id       text,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_transition_order ON order_transition (order_id, at);

-- Every deadline action that fired, for SLA reporting and for the
-- exactly-once assertion across worker replicas (I-15.3 / acceptance 4).
CREATE TABLE deadline_audit (
  id            bigserial PRIMARY KEY,
  subject_type  text NOT NULL,                     -- 'order' | 'dispatch' | 'payment_intent' | ...
  subject_id    uuid NOT NULL,
  action        text NOT NULL,
  escalation_no int NOT NULL,
  fired_at      timestamptz NOT NULL DEFAULT now(),
  lag_ms        int,
  outcome       text NOT NULL,
  duration_ms   int,
  error         text
);
CREATE UNIQUE INDEX deadline_audit_once
  ON deadline_audit (subject_type, subject_id, action, escalation_no);
CREATE INDEX deadline_audit_recent ON deadline_audit (fired_at DESC);

-- +goose Down
DROP TABLE IF EXISTS deadline_audit;
DROP TABLE IF EXISTS order_transition;
DROP TABLE IF EXISTS order_line_addon;
DROP TABLE IF EXISTS order_line;
DROP TRIGGER IF EXISTS order_receipt_write_once ON "order";
DROP FUNCTION IF EXISTS order_receipt_snapshot_immutable();
DROP TRIGGER IF EXISTS order_total_matches_quote ON "order";
DROP FUNCTION IF EXISTS order_assert_quote_total();
ALTER TABLE stored_object DROP CONSTRAINT IF EXISTS stored_object_order_fk;
DROP TABLE IF EXISTS "order";
