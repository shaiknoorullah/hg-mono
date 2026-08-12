-- Riders: profile, vehicle, availability, positions.
--
-- P-30 again: ONE geography column per entity. `rider_position` is the current
-- fix (one row per rider, upserted); `rider_position_history` is the track.
-- Neither carries a second lat/lng representation, and going offline clears
-- rider_profile.is_online in Postgres — the flag the dispatch query actually
-- filters on — so a stale Redis GEO member can never cause an offline rider to
-- be offered work.

-- +goose Up

CREATE TABLE rider_profile (
  account_id           uuid PRIMARY KEY REFERENCES account(id),
  first_name           text NOT NULL,
  last_name            text NOT NULL,
  date_of_birth        date NOT NULL,
  onboarding_state     rider_onboarding_state NOT NULL DEFAULT 'REGISTERED',
  account_status       rider_account_status NOT NULL DEFAULT 'PENDING',
  availability_state   rider_availability_state NOT NULL DEFAULT 'OFFLINE',
  availability_changed_at timestamptz,
  is_online            boolean NOT NULL DEFAULT false,
  go_offline_after_delivery boolean NOT NULL DEFAULT false,
  photo_object_id      uuid REFERENCES stored_object(id),
  approved_at          timestamptz,
  approved_by          uuid REFERENCES account(id),
  rating_avg           numeric(3, 2),
  rating_count         int NOT NULL DEFAULT 0,
  preferences          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  -- I-19.6: riders under 18 cannot be onboarded.
  CONSTRAINT rider_is_adult CHECK (date_of_birth <= (current_date - interval '18 years')),
  -- is_online is the denormalised flag dispatch filters on; keep it in step
  -- with availability_state so the two can never disagree.
  CONSTRAINT rider_online_agrees CHECK (
    is_online = (availability_state IN ('ONLINE_IDLE', 'ONLINE_STALE', 'ON_DELIVERY'))
  ),
  CONSTRAINT rider_active_is_approved CHECK (
    account_status <> 'ACTIVE' OR approved_at IS NOT NULL
  )
);
SELECT attach_updated_at('rider_profile');
CREATE INDEX rider_profile_dispatchable ON rider_profile (availability_state)
  WHERE is_online AND approved_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE rider_vehicle (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id    uuid NOT NULL REFERENCES account(id),
  vehicle_type  vehicle_type NOT NULL,
  make          text,
  model         text,
  year          int,
  colour        text,
  licence_plate text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT rider_vehicle_plate_when_motorised CHECK (
    vehicle_type IN ('BICYCLE', 'ON_FOOT') OR licence_plate IS NOT NULL
  )
);
SELECT attach_updated_at('rider_vehicle');
-- Exactly one active vehicle per rider.
CREATE UNIQUE INDEX rider_vehicle_one_active ON rider_vehicle (account_id)
  WHERE is_active AND deleted_at IS NULL;
CREATE UNIQUE INDEX rider_vehicle_plate ON rider_vehicle (upper(licence_plate))
  WHERE licence_plate IS NOT NULL AND is_active AND deleted_at IS NULL;

CREATE TABLE rider_application (
  account_id             uuid PRIMARY KEY REFERENCES account(id),
  submission_count       int NOT NULL DEFAULT 0,
  assigned_admin_id      uuid REFERENCES account(id),
  review_lock_expires_at timestamptz,
  submitted_at           timestamptz,
  sla_due_at             timestamptz,
  decided_by             uuid REFERENCES account(id),
  decided_at             timestamptz,
  reject_reason_code     document_rejection_reason_code,
  review_note            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('rider_application');
CREATE INDEX rider_application_queue ON rider_application (sla_due_at) WHERE decided_at IS NULL;

CREATE TABLE rider_availability_event (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES account(id),
  from_state  rider_availability_state,
  to_state    rider_availability_state NOT NULL,
  reason      text,
  actor_kind  order_actor_kind NOT NULL DEFAULT 'RIDER',
  location    geography(Point, 4326),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rider_availability_event_r ON rider_availability_event (account_id, occurred_at DESC);

-- Current position: one row per rider, upserted. THE location column.
CREATE TABLE rider_position (
  account_id  uuid PRIMARY KEY REFERENCES account(id),
  location    geography(Point, 4326) NOT NULL,
  accuracy_m  real,
  heading_deg real,
  speed_mps   real,
  battery_pct int,
  is_moving   boolean,
  recorded_at timestamptz NOT NULL,                 -- device clock, clamped +/-5 min
  received_at timestamptz NOT NULL DEFAULT now()
);
-- The GiST index the dispatch ST_DWithin query rides on.
CREATE INDEX rider_position_gix ON rider_position USING GIST (location);
CREATE INDEX rider_position_fresh ON rider_position (received_at DESC);

CREATE TABLE rider_position_history (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  account_id  uuid NOT NULL,
  order_id    uuid,
  assignment_id uuid,
  location    geography(Point, 4326) NOT NULL,
  accuracy_m  real,
  heading_deg real,
  speed_mps   real,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX rider_position_history_gix ON rider_position_history USING GIST (location);
CREATE INDEX rider_position_history_order ON rider_position_history (order_id, recorded_at);
CREATE INDEX rider_position_history_rider ON rider_position_history (account_id, recorded_at DESC);

-- +goose StatementBegin
DO $$
DECLARE m date := date_trunc('month', now())::date;
BEGIN
  PERFORM ensure_monthly_partition('rider_position_history', (m - interval '1 month')::date);
  PERFORM ensure_monthly_partition('rider_position_history', m);
  PERFORM ensure_monthly_partition('rider_position_history', (m + interval '1 month')::date);
  EXECUTE 'CREATE TABLE rider_position_history_default PARTITION OF rider_position_history DEFAULT';
END
$$;
-- +goose StatementEnd

CREATE TABLE rider_device (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id                  uuid NOT NULL REFERENCES account(id),
  device_id                   text NOT NULL,
  platform                    device_platform NOT NULL,
  os_version                  text,
  app_version                 text,
  background_permission_status text,
  battery_optimisation_exempt boolean,
  last_seen_at                timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('rider_device');
CREATE UNIQUE INDEX rider_device_unique ON rider_device (account_id, device_id);

-- +goose Down
DROP TABLE IF EXISTS rider_device;
DROP TABLE IF EXISTS rider_position_history;
DROP TABLE IF EXISTS rider_position;
DROP TABLE IF EXISTS rider_availability_event;
DROP TABLE IF EXISTS rider_application;
DROP TABLE IF EXISTS rider_vehicle;
DROP TABLE IF EXISTS rider_profile;
