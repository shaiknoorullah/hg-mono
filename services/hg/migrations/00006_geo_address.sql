-- P-30 — canonical geography. ONE location column per locatable entity, always
-- geography(Point,4326).
--
-- geography, not geometry: ST_Distance returns metres and ST_DWithin takes
-- metres on the spheroid. There is no lat/lng pair stored alongside it, because
-- a second representation is a second truth — the API derives lat/lng with
-- ST_Y/ST_X at read time.
--
-- `address` holds customer delivery addresses. A restaurant's premises address
-- lives inline on `restaurant` with its own single `location` column (00008):
-- giving a restaurant both an address_id and a location would recreate exactly
-- the split brain P-30 exists to prevent.

-- +goose Up

CREATE TABLE address (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id      uuid NOT NULL REFERENCES account(id),
  label           text,
  line1           text NOT NULL,
  line2           text,
  unit            text,
  buzzer          text,
  city            text NOT NULL,
  province        province NOT NULL,
  postal_code     text NOT NULL,
  country         char(2) NOT NULL DEFAULT 'CA',
  location        geography(Point, 4326) NOT NULL, -- server-resolved, never the client's raw value
  timezone        text NOT NULL,
  delivery_notes  text,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT address_country_ca CHECK (country = 'CA'),
  CONSTRAINT address_postal_shape CHECK (postal_code ~ '^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$')
);
SELECT attach_updated_at('address');

-- The index dispatch and discovery need.
CREATE INDEX address_location_gix ON address USING GIST (location);
CREATE INDEX address_account ON address (account_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX address_one_default ON address (account_id) WHERE is_default AND deleted_at IS NULL;

ALTER TABLE customer_profile
  ADD CONSTRAINT customer_profile_default_address_fk
  FOREIGN KEY (default_address_id) REFERENCES address(id);

-- P-31 — route cache. Geodesic distance (ST_Distance) decides eligibility;
-- routed distance decides money. They are never confused.
CREATE TABLE route_estimate (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  origin_geohash7 text NOT NULL,
  dest_geohash7   text NOT NULL,
  distance_m      int NOT NULL,
  duration_s      int NOT NULL,
  provider        text NOT NULL,
  route_source    route_source NOT NULL DEFAULT 'ROUTED',
  computed_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_estimate_positive CHECK (distance_m >= 0 AND duration_s >= 0)
);
SELECT attach_updated_at('route_estimate');
CREATE UNIQUE INDEX route_estimate_pair ON route_estimate (origin_geohash7, dest_geohash7);
CREATE INDEX route_estimate_expiry ON route_estimate (expires_at);

-- +goose Down
DROP TABLE IF EXISTS route_estimate;
ALTER TABLE customer_profile DROP CONSTRAINT IF EXISTS customer_profile_default_address_fk;
DROP TABLE IF EXISTS address;
