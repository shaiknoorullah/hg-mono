-- Menu: categories, items, versions, variants, add-ons.
--
-- Two axes, deliberately separated (R-15/R-17):
--   * price and availability live on the item and change instantly;
--   * claim-bearing descriptive fields (name, description, ingredients,
--     dietary/allergen tags, image) live in `menu_item_version` and require
--     admin review. R-05 in the decision log: never auto-approve a
--     claim-bearing field, because silence must not become consent on a halal
--     claim.
--
-- `order_line` snapshots `item_version_id` (00013), so no menu edit can
-- retroactively change what an order said it was.

-- +goose Up

CREATE TABLE menu_category (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
SELECT attach_updated_at('menu_category');
CREATE UNIQUE INDEX menu_category_name ON menu_category (restaurant_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX menu_category_order ON menu_category (restaurant_id, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE menu_item (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  restaurant_id       uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  category_id         uuid NOT NULL REFERENCES menu_category(id),
  live_version_id     uuid,                          -- FK added below
  pending_version_id  uuid,
  price_cents         bigint NOT NULL CHECK (price_cents >= 0),
  currency            currency_code NOT NULL DEFAULT 'CAD',
  availability_state  menu_item_availability_state NOT NULL DEFAULT 'AVAILABLE',
  out_of_stock_until  timestamptz,
  tax_category        tax_category NOT NULL DEFAULT 'PREPARED_FOOD',
  prep_minutes        int,
  sort_order          int NOT NULL DEFAULT 0,
  blocked_by          uuid REFERENCES account(id),
  blocked_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  -- BEVERAGE_ALCOHOL is out of scope for V1 (P-11); rejected at publish.
  CONSTRAINT menu_item_tax_category_v1 CHECK (tax_category <> 'BEVERAGE_ALCOHOL'),
  CONSTRAINT menu_item_blocked_attributed CHECK (
    availability_state <> 'BLOCKED' OR blocked_by IS NOT NULL
  )
);
SELECT attach_updated_at('menu_item');
CREATE INDEX menu_item_by_category ON menu_item (category_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX menu_item_by_restaurant ON menu_item (restaurant_id, availability_state) WHERE deleted_at IS NULL;

CREATE TABLE menu_item_version (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  menu_item_id           uuid NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  restaurant_id          uuid NOT NULL REFERENCES restaurant(id),
  version                int NOT NULL,
  name                   text NOT NULL,
  description            text,
  ingredients_text       text,
  dietary_tags           dietary_tag[] NOT NULL DEFAULT '{}',
  allergen_tags          allergen_tag[] NOT NULL DEFAULT '{}',
  allergens_declared     boolean NOT NULL DEFAULT false,
  spice_level            int CHECK (spice_level IS NULL OR spice_level BETWEEN 0 AND 5),
  contains_alcohol       boolean NOT NULL DEFAULT false,
  image_object_id        uuid REFERENCES stored_object(id),
  review_status          menu_review_status NOT NULL DEFAULT 'DRAFT',
  rejection_reason_code  menu_rejection_reason_code,
  review_note            text,
  submitted_at           timestamptz,
  reviewed_by            uuid REFERENCES account(id),
  reviewed_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- R-05: an approval or rejection is always a named human act. There is no
  -- auto-approve path for a claim-bearing field.
  CONSTRAINT menu_item_version_decision_attributed CHECK (
    review_status NOT IN ('APPROVED', 'REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT menu_item_version_rejection_has_reason CHECK (
    review_status <> 'REJECTED' OR rejection_reason_code IS NOT NULL
  ),
  CONSTRAINT menu_item_version_no_alcohol_v1 CHECK (contains_alcohol = false)
);
SELECT attach_updated_at('menu_item_version');
CREATE UNIQUE INDEX menu_item_version_no ON menu_item_version (menu_item_id, version);
CREATE INDEX menu_item_version_queue ON menu_item_version (review_status, submitted_at)
  WHERE review_status = 'PENDING_REVIEW';
-- At most one version awaiting review per item.
CREATE UNIQUE INDEX menu_item_version_one_pending ON menu_item_version (menu_item_id)
  WHERE review_status = 'PENDING_REVIEW';

ALTER TABLE menu_item
  ADD CONSTRAINT menu_item_live_version_fk FOREIGN KEY (live_version_id) REFERENCES menu_item_version(id),
  ADD CONSTRAINT menu_item_pending_version_fk FOREIGN KEY (pending_version_id) REFERENCES menu_item_version(id);

-- Search over dishes, same mechanism as restaurants.
ALTER TABLE menu_item_version ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', hg_unaccent(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('english', hg_unaccent(coalesce(description, ''))), 'B') ||
    setweight(to_tsvector('english', hg_unaccent(coalesce(ingredients_text, ''))), 'C')
) STORED;
CREATE INDEX menu_item_version_tsv_gin ON menu_item_version USING GIN (search_tsv);
CREATE INDEX menu_item_version_name_trgm ON menu_item_version USING GIN (name gin_trgm_ops);

-- Variants. `pricing_mode` is explicit data (P-09 step 1): ABSOLUTE replaces
-- the base price, DELTA adjusts it. The old system's cart-adds vs
-- order-replaces contradiction is unrepresentable once the intent is a column.
CREATE TABLE variant_group (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  menu_item_id  uuid NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  name          text NOT NULL,
  required      boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
SELECT attach_updated_at('variant_group');
CREATE INDEX variant_group_item ON variant_group (menu_item_id) WHERE deleted_at IS NULL;

CREATE TABLE variant (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  variant_group_id uuid NOT NULL REFERENCES variant_group(id) ON DELETE CASCADE,
  name             text NOT NULL,
  pricing_mode     variant_pricing_mode NOT NULL,
  price_cents      bigint,                            -- ABSOLUTE: replaces base
  delta_cents      bigint,                            -- DELTA: adjusts base
  is_default       boolean NOT NULL DEFAULT false,
  is_available     boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT variant_pricing_shape CHECK (
    (pricing_mode = 'ABSOLUTE' AND price_cents IS NOT NULL AND price_cents >= 0 AND delta_cents IS NULL) OR
    (pricing_mode = 'DELTA'    AND delta_cents IS NOT NULL AND price_cents IS NULL)
  )
);
SELECT attach_updated_at('variant');
CREATE UNIQUE INDEX variant_one_default ON variant (variant_group_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX variant_group_idx ON variant (variant_group_id) WHERE deleted_at IS NULL;

CREATE TABLE addon_group (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  menu_item_id  uuid NOT NULL REFERENCES menu_item(id) ON DELETE CASCADE,
  name          text NOT NULL,
  min_select    int NOT NULL DEFAULT 0,
  max_select    int NOT NULL DEFAULT 1,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT addon_group_select_range CHECK (min_select >= 0 AND max_select >= min_select)
);
SELECT attach_updated_at('addon_group');
CREATE INDEX addon_group_item ON addon_group (menu_item_id) WHERE deleted_at IS NULL;

CREATE TABLE addon (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  addon_group_id uuid NOT NULL REFERENCES addon_group(id) ON DELETE CASCADE,
  name           text NOT NULL,
  price_cents    bigint NOT NULL CHECK (price_cents >= 0),
  is_available   boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
SELECT attach_updated_at('addon');
CREATE INDEX addon_group_idx ON addon (addon_group_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS addon;
DROP TABLE IF EXISTS addon_group;
DROP TABLE IF EXISTS variant;
DROP TABLE IF EXISTS variant_group;
ALTER TABLE menu_item
  DROP CONSTRAINT IF EXISTS menu_item_live_version_fk,
  DROP CONSTRAINT IF EXISTS menu_item_pending_version_fk;
DROP TABLE IF EXISTS menu_item_version;
DROP TABLE IF EXISTS menu_item;
DROP TABLE IF EXISTS menu_category;
