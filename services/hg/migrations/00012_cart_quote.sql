-- Carts and quotes.
--
-- P-09: there is exactly one function that turns a cart into money, and its
-- output is a persisted `quote` row that every surface reads — cart screen,
-- checkout, payment, order creation, receipt, refund, settlement. The client
-- sends item identifiers and quantities only; `tip_cents` is the single
-- monetary value it may supply.
--
-- Lines are keyed by (quote_id, line_no), never by menu_item_id: two lines of
-- the same dish with different variants or add-on sets must be representable.

-- +goose Up

CREATE TABLE cart (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id          uuid NOT NULL REFERENCES account(id),
  restaurant_id       uuid NOT NULL REFERENCES restaurant(id),
  delivery_address_id uuid REFERENCES address(id),
  fulfilment          fulfilment NOT NULL DEFAULT 'DELIVERY',
  currency            currency_code NOT NULL DEFAULT 'CAD',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
SELECT attach_updated_at('cart');
-- Single-restaurant carts: one open cart per account.
CREATE UNIQUE INDEX cart_one_open ON cart (account_id) WHERE deleted_at IS NULL;

CREATE TABLE cart_line (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  cart_id         uuid NOT NULL REFERENCES cart(id) ON DELETE CASCADE,
  menu_item_id    uuid NOT NULL REFERENCES menu_item(id),
  variant_id      uuid REFERENCES variant(id),
  quantity        int NOT NULL CHECK (quantity > 0),
  special_request text CHECK (special_request IS NULL OR length(special_request) <= 140),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('cart_line');
CREATE INDEX cart_line_cart ON cart_line (cart_id);

CREATE TABLE cart_line_addon (
  cart_line_id   uuid NOT NULL REFERENCES cart_line(id) ON DELETE CASCADE,
  addon_id       uuid NOT NULL REFERENCES addon(id),
  addon_quantity int NOT NULL DEFAULT 1 CHECK (addon_quantity > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cart_line_id, addon_id)
);

-- ---------------------------------------------------------------------------
-- Quote
-- ---------------------------------------------------------------------------
CREATE TABLE quote (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id              uuid NOT NULL REFERENCES account(id),
  cart_id                 uuid NOT NULL REFERENCES cart(id),
  restaurant_id           uuid NOT NULL REFERENCES restaurant(id),
  delivery_address_id     uuid REFERENCES address(id),
  fulfilment              fulfilment NOT NULL,
  currency                currency_code NOT NULL DEFAULT 'CAD',
  pricing_config_id       uuid NOT NULL REFERENCES pricing_config(id),
  tax_jurisdiction_code   text NOT NULL REFERENCES tax_jurisdiction(code),

  subtotal_cents          bigint NOT NULL,
  discount_items_cents    bigint NOT NULL DEFAULT 0,
  discount_delivery_cents bigint NOT NULL DEFAULT 0,
  discount_service_cents  bigint NOT NULL DEFAULT 0,
  delivery_fee_cents      bigint NOT NULL DEFAULT 0,
  service_fee_cents       bigint NOT NULL DEFAULT 0,
  tax_total_cents         bigint NOT NULL DEFAULT 0,
  tip_cents               bigint NOT NULL DEFAULT 0,
  total_cents             bigint NOT NULL,

  -- internal split, frozen onto the order at acceptance
  commission_cents        bigint NOT NULL DEFAULT 0,
  restaurant_net_cents    bigint NOT NULL DEFAULT 0,
  rider_earnings_cents    bigint NOT NULL DEFAULT 0,
  platform_gross_cents    bigint NOT NULL DEFAULT 0,
  restaurant_funded_discount_cents bigint NOT NULL DEFAULT 0,
  platform_funded_discount_cents   bigint NOT NULL DEFAULT 0,

  billable_km             int NOT NULL DEFAULT 0,
  route_meters            int NOT NULL DEFAULT 0,
  route_source            route_source NOT NULL DEFAULT 'ROUTED',

  promo_code              text,
  promo_id                uuid,
  discount_target         discount_target,
  discount_funded_by      discount_funded_by,
  discount_reimbursable   boolean NOT NULL DEFAULT false,

  input_hash              bytea NOT NULL,             -- sha256 of the canonical QuoteInput
  state_hash              bytea NOT NULL,             -- sha256 of every price/rate/config row read
  rounding_log            jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at              timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- I-09.4 (conservation), as a CHECK rather than a test. A discount can never
  -- be mistaken for the payable amount here: the two are distinct columns and
  -- this identity fails instantly if they are swapped.
  CONSTRAINT quote_total_identity CHECK (
    total_cents = subtotal_cents - discount_items_cents
                + delivery_fee_cents - discount_delivery_cents
                + service_fee_cents  - discount_service_cents
                + tax_total_cents + tip_cents
  ),
  CONSTRAINT quote_non_negative CHECK (
    subtotal_cents >= 0 AND delivery_fee_cents >= 0 AND service_fee_cents >= 0
    AND tax_total_cents >= 0 AND tip_cents >= 0 AND total_cents >= 0
    AND discount_items_cents >= 0 AND discount_delivery_cents >= 0 AND discount_service_cents >= 0
  ),
  CONSTRAINT quote_discount_bounded CHECK (
    discount_items_cents <= subtotal_cents
    AND discount_delivery_cents <= delivery_fee_cents
    AND discount_service_cents <= service_fee_cents
  ),
  CONSTRAINT quote_delivery_needs_address CHECK (
    fulfilment <> 'DELIVERY' OR delivery_address_id IS NOT NULL
  )
);
SELECT attach_updated_at('quote');
CREATE INDEX quote_account ON quote (account_id, created_at DESC);
CREATE INDEX quote_expiry ON quote (expires_at);
CREATE INDEX quote_replay ON quote (cart_id, input_hash, state_hash);

CREATE TABLE quote_line (
  quote_id             uuid NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  line_no              int NOT NULL,
  menu_item_id         uuid NOT NULL REFERENCES menu_item(id),
  menu_item_version_id uuid REFERENCES menu_item_version(id),
  menu_item_name       text NOT NULL,                 -- snapshotted
  variant_id           uuid REFERENCES variant(id),
  variant_name         text,
  variant_pricing_mode variant_pricing_mode,
  quantity             int NOT NULL CHECK (quantity > 0),
  base_price_cents     bigint NOT NULL,
  variant_part_cents   bigint NOT NULL,
  addons_part_cents    bigint NOT NULL,
  line_unit_cents      bigint NOT NULL,
  line_total_cents     bigint NOT NULL,
  special_request      text,
  tax_category         tax_category NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quote_id, line_no),
  CONSTRAINT quote_line_identity CHECK (
    line_unit_cents = variant_part_cents + addons_part_cents
    AND line_total_cents = line_unit_cents * quantity
  ),
  CONSTRAINT quote_line_non_negative CHECK (
    base_price_cents >= 0 AND variant_part_cents >= 0 AND addons_part_cents >= 0
    AND line_unit_cents >= 0 AND line_total_cents >= 0
  )
);
CREATE INDEX quote_line_item ON quote_line (menu_item_id);

CREATE TABLE quote_line_addon (
  quote_id          uuid NOT NULL,
  line_no           int NOT NULL,
  addon_id          uuid NOT NULL REFERENCES addon(id),
  addon_name        text NOT NULL,
  addon_quantity    int NOT NULL CHECK (addon_quantity > 0),
  addon_price_cents bigint NOT NULL CHECK (addon_price_cents >= 0),
  PRIMARY KEY (quote_id, line_no, addon_id),
  FOREIGN KEY (quote_id, line_no) REFERENCES quote_line(quote_id, line_no) ON DELETE CASCADE
);

CREATE TABLE quote_tax_line (
  quote_id          uuid NOT NULL REFERENCES quote(id) ON DELETE CASCADE,
  seq               int NOT NULL,
  jurisdiction_code text NOT NULL REFERENCES tax_jurisdiction(code),
  tax_kind          tax_kind NOT NULL,
  statutory_label   text NOT NULL,
  rate              numeric(12, 8) NOT NULL,
  base_cents        bigint NOT NULL CHECK (base_cents >= 0),
  amount_cents      bigint NOT NULL CHECK (amount_cents >= 0),
  rebate_applied    boolean NOT NULL DEFAULT false,
  remittable_by     remittable_by NOT NULL,
  PRIMARY KEY (quote_id, seq)
);

-- I-11.1: quote.tax_total_cents = sum of its tax lines. Deferred, so the header
-- and its lines may be written in either order inside one transaction.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION quote_assert_tax_total() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  qid uuid := COALESCE(NEW.quote_id, OLD.quote_id);
  declared bigint;
  summed bigint;
BEGIN
  SELECT tax_total_cents INTO declared FROM quote WHERE id = qid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO summed FROM quote_tax_line WHERE quote_id = qid;
  IF declared <> summed THEN
    RAISE EXCEPTION
      'quote_tax_total_mismatch: quote % declares % but its tax lines sum to %', qid, declared, summed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION quote_assert_tax_total_header() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  summed bigint;
BEGIN
  SELECT COALESCE(sum(amount_cents), 0) INTO summed FROM quote_tax_line WHERE quote_id = NEW.id;
  IF NEW.tax_total_cents <> summed THEN
    RAISE EXCEPTION
      'quote_tax_total_mismatch: quote % declares % but its tax lines sum to %',
      NEW.id, NEW.tax_total_cents, summed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER quote_tax_line_total_balanced
  AFTER INSERT OR UPDATE OR DELETE ON quote_tax_line
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION quote_assert_tax_total();

CREATE CONSTRAINT TRIGGER quote_tax_total_balanced
  AFTER INSERT OR UPDATE ON quote
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION quote_assert_tax_total_header();

-- I-11.2, as a query that must return zero rows: the tip never enters a tax base.
CREATE VIEW quote_tip_taxed AS
  SELECT q.id AS quote_id, q.tip_cents, sum(t.base_cents)::bigint AS taxed_base_cents
    FROM quote q JOIN quote_tax_line t ON t.quote_id = q.id
   WHERE q.tip_cents > 0
   GROUP BY q.id, q.tip_cents
  HAVING sum(t.base_cents) > (q.subtotal_cents - q.discount_items_cents
                            + q.delivery_fee_cents - q.discount_delivery_cents
                            + q.service_fee_cents - q.discount_service_cents);

-- +goose Down
DROP VIEW IF EXISTS quote_tip_taxed;
DROP TRIGGER IF EXISTS quote_tax_total_balanced ON quote;
DROP TRIGGER IF EXISTS quote_tax_line_total_balanced ON quote_tax_line;
DROP FUNCTION IF EXISTS quote_assert_tax_total_header();
DROP FUNCTION IF EXISTS quote_assert_tax_total();
DROP TABLE IF EXISTS quote_tax_line;
DROP TABLE IF EXISTS quote_line_addon;
DROP TABLE IF EXISTS quote_line;
DROP TABLE IF EXISTS quote;
DROP TABLE IF EXISTS cart_line_addon;
DROP TABLE IF EXISTS cart_line;
DROP TABLE IF EXISTS cart;
