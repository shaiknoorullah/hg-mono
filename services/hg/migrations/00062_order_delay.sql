-- A restaurant's prep delay is a row of its own, written by the orders module.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/351
--
-- The restaurant's delay step moved a PREPARING order's deadline_at itself and
-- logged the delay as a PREPARING -> PREPARING order_transition row with the
-- minutes packed into the reason text ('delay:<minutes>:<reason>'). The limits
-- (at most 3 delays and 45 minutes in total, docs/spec/03-restaurant.md "R-26 —
-- Delay handling and rider communication") were read back by parsing that text.
--
-- order_delay is the delay record the spec names. internal/orders Store.DelayInTx
-- is its only writer: it counts and sums these rows for the limits, moves the
-- deadline and the promised ready time, writes the transition row and tells the
-- customer, in one transaction.

-- +goose Up
CREATE TABLE order_delay (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                   uuid NOT NULL REFERENCES "order"(id),
  added_minutes              integer NOT NULL CHECK (added_minutes IN (5, 10, 15, 20)),
  reason_code                delay_reason_code NOT NULL,
  previous_deadline_at       timestamptz,
  new_deadline_at            timestamptz NOT NULL,
  previous_promised_ready_at timestamptz,
  new_promised_ready_at      timestamptz,
  created_by                 uuid REFERENCES account(id),
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_delay_order ON order_delay (order_id, created_at);

-- Delays recorded the old way, so an order delayed before this migration keeps
-- counting them toward its limits. The deadline before each one was not kept.
INSERT INTO order_delay (order_id, added_minutes, reason_code, new_deadline_at, created_by, created_at)
SELECT t.order_id,
       split_part(t.reason, ':', 2)::int,
       CASE WHEN split_part(t.reason, ':', 3) IN ('HIGH_VOLUME', 'INGREDIENT_PREP', 'EQUIPMENT_ISSUE',
                                                  'STAFF_SHORTAGE', 'ORDER_COMPLEXITY', 'OTHER')
            THEN split_part(t.reason, ':', 3)::delay_reason_code
            ELSE 'OTHER' END,
       t.at,
       t.actor_account_id,
       t.at
  FROM order_transition t
 WHERE t.from_state = 'PREPARING' AND t.to_state = 'PREPARING'
   AND t.reason ~ '^delay:(5|10|15|20):';

-- +goose Down
DROP TABLE order_delay;
