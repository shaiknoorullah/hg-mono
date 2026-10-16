-- Why a restaurant's pause ends when it does.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/973
--
-- restaurant.pause_until says when a pause ends but not why. A pause the owner
-- set "until closing" (the server resolves the time) and one the owner timed by
-- picking a length look identical, so a console that reloads, or a second
-- device, could not word the first one correctly. pause_kind is stored with the
-- pause and returned beside pause_until (contract: RestaurantPauseKind).
--
-- There is no value for the toggle being off (that is CLOSED_TOGGLE, not a
-- pause) and none for an admin pause (no operation pauses a single restaurant;
-- setOrderingPause is platform-wide and suspension is CLOSED_SUSPENDED).
--
-- The two columns travel together. The CHECK makes a pause_until with no kind,
-- and a kind with no pause_until, unrepresentable, so no writer can forget one.

-- +goose Up

CREATE TYPE restaurant_pause_kind AS ENUM ('UNTIL_CLOSING', 'DURATION');

ALTER TABLE restaurant ADD COLUMN pause_kind restaurant_pause_kind;

-- Every pause that exists before this migration was timed by the owner: until
-- closing could not be asked of the server until now.
UPDATE restaurant SET pause_kind = 'DURATION' WHERE pause_until IS NOT NULL;

ALTER TABLE restaurant
  ADD CONSTRAINT restaurant_pause_kind_pairs_pause_until
    CHECK ((pause_until IS NULL) = (pause_kind IS NULL));

-- +goose Down

ALTER TABLE restaurant
  DROP CONSTRAINT IF EXISTS restaurant_pause_kind_pairs_pause_until,
  DROP COLUMN IF EXISTS pause_kind;
DROP TYPE IF EXISTS restaurant_pause_kind;
