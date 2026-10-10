-- A dish has at most one variant group that sets its full price.
-- Owner decision, 2026-10-09: a restaurant may not save a dish where more than
-- one variant group sets the full price.
--
-- A variant's pricing_mode is ABSOLUTE (its price replaces the dish's base
-- price) or DELTA (an add-on amount). A group with an ABSOLUTE variant sets the
-- full price. Two such groups on one dish ("Size: Large $21" and "Box: Gift
-- $25") have no single price: 00069 lets a cart, quote or order line carry one
-- ABSOLUTE variant, and the cart refuses the combination with
-- 409 ITEM_UNAVAILABLE. That refusal reaches the customer, after the menu was
-- saved. This migration refuses the menu instead; the cart's 409 stays as a
-- backstop.
--
-- pricing_mode lives on variant and the dish on variant_group, so no one index
-- can see both. variant_group.sets_full_price carries the fact onto the group:
-- triggers derive it from the group's live variants on every write to either
-- table, and a value a writer supplies is ignored. A partial unique index then
-- allows one live full-price group per dish. An index, not a counting trigger,
-- so two transactions that each add an ABSOLUTE variant to a different group of
-- one dish cannot both commit.
--
-- The violation is a unique_violation on variant_group_one_full_price. No API
-- writes variant groups yet (variant editing is R-20, V2; the restaurant portal
-- shows them read-only), so today the index guards the catalogue loaders and
-- direct writes. The API that edits variants maps it to 422 VALIDATION_FAILED
-- with a field error on the group: "Only one option group can set the full
-- price; make the others add-on amounts."

-- +goose Up

ALTER TABLE variant_group ADD COLUMN sets_full_price boolean NOT NULL DEFAULT false;

-- The group's flag is whatever its live variants say, never what a writer sent.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION variant_group_derive_full_price() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.sets_full_price := EXISTS (
    SELECT 1 FROM variant v
     WHERE v.variant_group_id = NEW.id
       AND v.pricing_mode = 'ABSOLUTE'
       AND v.deleted_at IS NULL);
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- A variant written, moved, deleted or switched between ABSOLUTE and DELTA
-- re-derives its group's flag (and its old group's, when it moved). The UPDATE
-- is what meets the unique index below.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION variant_rederive_group_full_price() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  gid uuid;
BEGIN
  FOR gid IN
    SELECT DISTINCT g FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.variant_group_id END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.variant_group_id END]) AS g
     WHERE g IS NOT NULL
  LOOP
    UPDATE variant_group vg
       SET sets_full_price = EXISTS (
             SELECT 1 FROM variant v
              WHERE v.variant_group_id = vg.id
                AND v.pricing_mode = 'ABSOLUTE'
                AND v.deleted_at IS NULL)
     WHERE vg.id = gid
       AND vg.sets_full_price IS DISTINCT FROM EXISTS (
             SELECT 1 FROM variant v
              WHERE v.variant_group_id = vg.id
                AND v.pricing_mode = 'ABSOLUTE'
                AND v.deleted_at IS NULL);
  END LOOP;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER variant_group_derive_full_price
  BEFORE INSERT OR UPDATE ON variant_group
  FOR EACH ROW EXECUTE FUNCTION variant_group_derive_full_price();

CREATE TRIGGER variant_rederive_group_full_price
  AFTER INSERT OR DELETE OR UPDATE OF variant_group_id, pricing_mode, deleted_at ON variant
  FOR EACH ROW EXECUTE FUNCTION variant_rederive_group_full_price();

-- Existing groups take their flag from their variants (the BEFORE trigger).
UPDATE variant_group SET sets_full_price = sets_full_price;

CREATE UNIQUE INDEX variant_group_one_full_price
  ON variant_group (menu_item_id)
  WHERE sets_full_price AND deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS variant_group_one_full_price;
DROP TRIGGER IF EXISTS variant_rederive_group_full_price ON variant;
DROP TRIGGER IF EXISTS variant_group_derive_full_price ON variant_group;
DROP FUNCTION IF EXISTS variant_rederive_group_full_price();
DROP FUNCTION IF EXISTS variant_group_derive_full_price();
ALTER TABLE variant_group DROP COLUMN IF EXISTS sets_full_price;
