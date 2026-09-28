-- The trending qualification threshold, as configuration.
--
-- The home feed spec (docs/spec/02-customer.md "Home feed", rule 2) defines
-- trending_in_your_area as restaurants ranked by delivered order count in the
-- window, "minimum 10 orders to qualify". Without a floor, one delivered order
-- makes a restaurant "trending", which at launch volumes would label nearly
-- every restaurant that has served anyone.
--
-- It is a column rather than a constant because the discovery config spec
-- (docs/spec/01-platform.md "Restaurant and dish search") requires every feed
-- radius, window and rail size to come from discovery_config, and calls the old
-- feed's hard-coded numbers a bug. A threshold is the same kind of number and
-- belongs beside trending_window_days.

-- +goose Up
ALTER TABLE discovery_config
  ADD COLUMN trending_min_orders int NOT NULL DEFAULT 10,
  ADD CONSTRAINT discovery_config_trending_min_orders_positive CHECK (trending_min_orders >= 1);

-- +goose Down
ALTER TABLE discovery_config
  DROP CONSTRAINT discovery_config_trending_min_orders_positive,
  DROP COLUMN trending_min_orders;
