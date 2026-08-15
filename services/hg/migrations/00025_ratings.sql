-- Order ratings (C-38, scoped): the customer rates the order's food (bound to
-- the restaurant) and, separately, the rider — two distinct resources per the
-- spec ("One flow, three targets"; dish-level ratings are out of scope for
-- this pass and remain a V2 gap, tracked in docs/decisions/).
--
-- Both tables are keyed one-row-per-order (rule C-38.2: one review per
-- (order_id, target)); PRIMARY KEY(order_id) enforces it structurally rather
-- than by a unique index a caller could forget. Every score is an integer 1-5,
-- enforced by a CHECK — "the current API accepts any number with no clamp" is
-- exactly the defect this closes.
--
-- This replaces the in-memory ratings the customer app previously held: the
-- rating is now durable, survives a restart, and feeds the restaurant's and
-- rider's rating_avg/rating_count aggregates (recomputed in the same
-- transaction as the write, from PUBLISHED rows only — C-38 rule 5).

-- +goose Up

CREATE TYPE rating_status AS ENUM (
  'PUBLISHED',
  'PENDING_MODERATION',
  'REMOVED'
);

CREATE TABLE order_food_rating (
  order_id       uuid PRIMARY KEY REFERENCES "order"(id),
  customer_id    uuid NOT NULL REFERENCES account(id),
  restaurant_id  uuid NOT NULL REFERENCES restaurant(id),
  score          smallint NOT NULL,
  review         text,
  tags           text[] NOT NULL DEFAULT '{}',
  status         rating_status NOT NULL DEFAULT 'PUBLISHED',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_food_rating_score_range CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT order_food_rating_review_len CHECK (review IS NULL OR char_length(review) <= 1000)
);
SELECT attach_updated_at('order_food_rating');
CREATE INDEX order_food_rating_restaurant ON order_food_rating (restaurant_id) WHERE status = 'PUBLISHED';

CREATE TABLE order_rider_rating (
  order_id          uuid PRIMARY KEY REFERENCES "order"(id),
  customer_id       uuid NOT NULL REFERENCES account(id),
  rider_account_id  uuid NOT NULL REFERENCES account(id),
  score             smallint NOT NULL,
  comment           text,
  tags              text[] NOT NULL DEFAULT '{}',
  status            rating_status NOT NULL DEFAULT 'PUBLISHED',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_rider_rating_score_range CHECK (score BETWEEN 1 AND 5),
  CONSTRAINT order_rider_rating_comment_len CHECK (comment IS NULL OR char_length(comment) <= 500)
);
SELECT attach_updated_at('order_rider_rating');
CREATE INDEX order_rider_rating_rider ON order_rider_rating (rider_account_id) WHERE status = 'PUBLISHED';

-- +goose Down
DROP TABLE IF EXISTS order_rider_rating;
DROP TABLE IF EXISTS order_food_rating;
DROP TYPE IF EXISTS rating_status;
