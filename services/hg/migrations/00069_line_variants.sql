-- A cart, quote or order line carries one chosen variant per variant group.
-- Issues: https://github.com/shaiknoorullah/hg-mono/issues/628
--         https://github.com/shaiknoorullah/hg-mono/issues/629
--
-- A menu item can have several variant groups (00010: size, rice, heat level),
-- but cart_line, quote_line and order_line each held one variant_id, so a dish
-- with two groups could not be ordered as chosen. The chosen variants move to
-- one row each, the same way add-ons already live in *_line_addon:
--
--   cart_line_variant    the customer's choice; prices are read live
--   quote_line_variant   snapshotted name and money, copied to ...
--   order_line_variant   ... the order, so a menu edit never changes it
--
-- Pricing (docs/spec/01-platform.md, P-09 step 1) generalises the one-variant
-- rule: variant_part_cents is the chosen ABSOLUTE variant's price (else the
-- item's base price) plus every chosen DELTA variant's delta. At most one
-- chosen variant per line is ABSOLUTE (a partial unique index), and a deferred
-- trigger checks each quote and order line's variant_part_cents against its
-- variant rows, so a line whose variant money does not add up cannot commit.
--
-- quote_line and order_line keep variant_id, variant_name and
-- variant_pricing_mode: variant_name is what the restaurant ticket, the rider
-- and the admin read, and it now joins every chosen name ("For two, Kabuli
-- pulao, Hot"); variant_id and variant_pricing_mode are set only for a line
-- with exactly one variant. cart_line.variant_id is no longer written: its rows
-- move to cart_line_variant and a CHECK keeps it empty.

-- +goose Up

-- A chosen variant names its group, and the pair must be a real one.
ALTER TABLE variant ADD CONSTRAINT variant_id_group_unique UNIQUE (id, variant_group_id);

CREATE TABLE cart_line_variant (
  cart_line_id     uuid NOT NULL REFERENCES cart_line(id) ON DELETE CASCADE,
  variant_id       uuid NOT NULL,
  variant_group_id uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_line_id, variant_id),
  -- One variant per group: the group is single-select (C-16).
  CONSTRAINT cart_line_variant_one_per_group UNIQUE (cart_line_id, variant_group_id),
  CONSTRAINT cart_line_variant_real_pair FOREIGN KEY (variant_id, variant_group_id)
    REFERENCES variant(id, variant_group_id)
);

CREATE TABLE quote_line_variant (
  quote_id         uuid NOT NULL,
  line_no          int NOT NULL,
  variant_id       uuid NOT NULL,
  variant_group_id uuid NOT NULL,
  group_name       text NOT NULL,
  variant_name     text NOT NULL,
  pricing_mode     variant_pricing_mode NOT NULL,
  price_cents      bigint,
  delta_cents      bigint,
  sort_no          int NOT NULL,
  PRIMARY KEY (quote_id, line_no, variant_id),
  CONSTRAINT quote_line_variant_one_per_group UNIQUE (quote_id, line_no, variant_group_id),
  FOREIGN KEY (quote_id, line_no) REFERENCES quote_line(quote_id, line_no) ON DELETE CASCADE,
  CONSTRAINT quote_line_variant_real_pair FOREIGN KEY (variant_id, variant_group_id)
    REFERENCES variant(id, variant_group_id),
  CONSTRAINT quote_line_variant_pricing_shape CHECK (
    (pricing_mode = 'ABSOLUTE' AND price_cents IS NOT NULL AND price_cents >= 0 AND delta_cents IS NULL) OR
    (pricing_mode = 'DELTA'    AND delta_cents IS NOT NULL AND price_cents IS NULL)
  )
);
CREATE UNIQUE INDEX quote_line_variant_one_absolute
  ON quote_line_variant (quote_id, line_no) WHERE pricing_mode = 'ABSOLUTE';

CREATE TABLE order_line_variant (
  order_id         uuid NOT NULL,
  line_no          int NOT NULL,
  variant_id       uuid NOT NULL,
  variant_group_id uuid NOT NULL,
  group_name       text NOT NULL,
  variant_name     text NOT NULL,
  pricing_mode     variant_pricing_mode NOT NULL,
  price_cents      bigint,
  delta_cents      bigint,
  sort_no          int NOT NULL,
  PRIMARY KEY (order_id, line_no, variant_id),
  CONSTRAINT order_line_variant_one_per_group UNIQUE (order_id, line_no, variant_group_id),
  FOREIGN KEY (order_id, line_no) REFERENCES order_line(order_id, line_no) ON DELETE CASCADE,
  CONSTRAINT order_line_variant_real_pair FOREIGN KEY (variant_id, variant_group_id)
    REFERENCES variant(id, variant_group_id),
  CONSTRAINT order_line_variant_pricing_shape CHECK (
    (pricing_mode = 'ABSOLUTE' AND price_cents IS NOT NULL AND price_cents >= 0 AND delta_cents IS NULL) OR
    (pricing_mode = 'DELTA'    AND delta_cents IS NOT NULL AND price_cents IS NULL)
  )
);
CREATE UNIQUE INDEX order_line_variant_one_absolute
  ON order_line_variant (order_id, line_no) WHERE pricing_mode = 'ABSOLUTE';

-- Existing lines keep their one variant. The money comes from the line itself,
-- so the backfilled rows satisfy the trigger below exactly.
INSERT INTO cart_line_variant (cart_line_id, variant_id, variant_group_id)
SELECT cl.id, v.id, v.variant_group_id
  FROM cart_line cl JOIN variant v ON v.id = cl.variant_id;
UPDATE cart_line SET variant_id = NULL WHERE variant_id IS NOT NULL;
ALTER TABLE cart_line ADD CONSTRAINT cart_line_variant_moved CHECK (variant_id IS NULL);

INSERT INTO quote_line_variant (quote_id, line_no, variant_id, variant_group_id, group_name,
                                variant_name, pricing_mode, price_cents, delta_cents, sort_no)
SELECT ql.quote_id, ql.line_no, v.id, v.variant_group_id, vg.name,
       COALESCE(ql.variant_name, v.name), COALESCE(ql.variant_pricing_mode, v.pricing_mode),
       CASE WHEN COALESCE(ql.variant_pricing_mode, v.pricing_mode) = 'ABSOLUTE' THEN ql.variant_part_cents END,
       CASE WHEN COALESCE(ql.variant_pricing_mode, v.pricing_mode) = 'DELTA'
            THEN ql.variant_part_cents - ql.base_price_cents END,
       1
  FROM quote_line ql
  JOIN variant v ON v.id = ql.variant_id
  JOIN variant_group vg ON vg.id = v.variant_group_id;

INSERT INTO order_line_variant (order_id, line_no, variant_id, variant_group_id, group_name,
                                variant_name, pricing_mode, price_cents, delta_cents, sort_no)
SELECT ol.order_id, ol.line_no, v.id, v.variant_group_id, vg.name,
       COALESCE(ol.variant_name, v.name), COALESCE(ol.variant_pricing_mode, v.pricing_mode),
       CASE WHEN COALESCE(ol.variant_pricing_mode, v.pricing_mode) = 'ABSOLUTE' THEN ol.variant_part_cents END,
       CASE WHEN COALESCE(ol.variant_pricing_mode, v.pricing_mode) = 'DELTA'
            THEN ol.variant_part_cents - ol.base_price_cents END,
       1
  FROM order_line ol
  JOIN variant v ON v.id = ol.variant_id
  JOIN variant_group vg ON vg.id = v.variant_group_id;

-- variant_part_cents = the ABSOLUTE variant's price (else the base price)
--                      + the sum of the DELTA variants' deltas.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION quote_line_assert_variant_part() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  qid uuid := COALESCE(NEW.quote_id, OLD.quote_id);
  lno int := COALESCE(NEW.line_no, OLD.line_no);
  base bigint;
  declared bigint;
  absolute_price bigint;
  deltas bigint;
BEGIN
  SELECT base_price_cents, variant_part_cents INTO base, declared
    FROM quote_line WHERE quote_id = qid AND line_no = lno;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT max(price_cents) FILTER (WHERE pricing_mode = 'ABSOLUTE'),
         COALESCE(sum(delta_cents) FILTER (WHERE pricing_mode = 'DELTA'), 0)
    INTO absolute_price, deltas
    FROM quote_line_variant WHERE quote_id = qid AND line_no = lno;
  IF declared <> COALESCE(absolute_price, base) + deltas THEN
    RAISE EXCEPTION
      'quote_line_variant_part_mismatch: quote % line % declares variant_part_cents % but its variants give %',
      qid, lno, declared, COALESCE(absolute_price, base) + deltas
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION order_line_assert_variant_part() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ordid uuid := COALESCE(NEW.order_id, OLD.order_id);
  lno int := COALESCE(NEW.line_no, OLD.line_no);
  base bigint;
  declared bigint;
  absolute_price bigint;
  deltas bigint;
BEGIN
  SELECT base_price_cents, variant_part_cents INTO base, declared
    FROM order_line WHERE order_id = ordid AND line_no = lno;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT max(price_cents) FILTER (WHERE pricing_mode = 'ABSOLUTE'),
         COALESCE(sum(delta_cents) FILTER (WHERE pricing_mode = 'DELTA'), 0)
    INTO absolute_price, deltas
    FROM order_line_variant WHERE order_id = ordid AND line_no = lno;
  IF declared <> COALESCE(absolute_price, base) + deltas THEN
    RAISE EXCEPTION
      'order_line_variant_part_mismatch: order % line % declares variant_part_cents % but its variants give %',
      ordid, lno, declared, COALESCE(absolute_price, base) + deltas
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER quote_line_variant_part_balanced
  AFTER INSERT OR UPDATE ON quote_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION quote_line_assert_variant_part();

CREATE CONSTRAINT TRIGGER quote_line_variant_rows_balanced
  AFTER INSERT OR UPDATE OR DELETE ON quote_line_variant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION quote_line_assert_variant_part();

CREATE CONSTRAINT TRIGGER order_line_variant_part_balanced
  AFTER INSERT OR UPDATE ON order_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION order_line_assert_variant_part();

CREATE CONSTRAINT TRIGGER order_line_variant_rows_balanced
  AFTER INSERT OR UPDATE OR DELETE ON order_line_variant
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION order_line_assert_variant_part();

-- +goose Down
DROP TRIGGER IF EXISTS order_line_variant_rows_balanced ON order_line_variant;
DROP TRIGGER IF EXISTS order_line_variant_part_balanced ON order_line;
DROP TRIGGER IF EXISTS quote_line_variant_rows_balanced ON quote_line_variant;
DROP TRIGGER IF EXISTS quote_line_variant_part_balanced ON quote_line;
DROP FUNCTION IF EXISTS order_line_assert_variant_part();
DROP FUNCTION IF EXISTS quote_line_assert_variant_part();
-- A line with several variants keeps the first one, in group order.
ALTER TABLE cart_line DROP CONSTRAINT IF EXISTS cart_line_variant_moved;
UPDATE cart_line cl SET variant_id = (
  SELECT clv.variant_id FROM cart_line_variant clv
    JOIN variant_group vg ON vg.id = clv.variant_group_id
   WHERE clv.cart_line_id = cl.id
   ORDER BY vg.sort_order, vg.id LIMIT 1);
DROP TABLE IF EXISTS order_line_variant;
DROP TABLE IF EXISTS quote_line_variant;
DROP TABLE IF EXISTS cart_line_variant;
ALTER TABLE variant DROP CONSTRAINT IF EXISTS variant_id_group_unique;
