-- Restaurant, onboarding, trading hours, cuisines.
--
-- ONE location column (P-30). The premises address is inline; `location` is the
-- only geographic representation. There is no `coords`, no `lat`/`lng` pair and
-- no legacy POINT — 03-restaurant.md §1.2 sketches all three, and 01-platform.md
-- P-30 (normative) forbids them. The lint in 00003 enforces the platform rule.
--
-- `commission_rate_bps` exists per restaurant and is switchable without a
-- release (decision S-01); it is seeded to 0 at launch.

-- +goose Up

CREATE TABLE cuisine (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('cuisine');

CREATE TABLE restaurant (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug                  text NOT NULL UNIQUE,
  legal_name            text NOT NULL,
  display_name          text NOT NULL,
  description           text,
  phone_e164            text,
  public_phone_e164     text,
  email                 citext,

  -- premises address (inline; see header note)
  line1                 text,
  line2                 text,
  city                  text,
  province              province,
  postal_code           text,
  country               char(2) NOT NULL DEFAULT 'CA',
  location              geography(Point, 4326),
  timezone              text NOT NULL DEFAULT 'America/Toronto',

  -- lifecycle
  onboarding_state      restaurant_onboarding_state NOT NULL DEFAULT 'REGISTERED',
  account_state         restaurant_account_state NOT NULL DEFAULT 'PENDING',
  delist_reasons        text[] NOT NULL DEFAULT '{}',

  -- trading
  is_accepting_orders   boolean NOT NULL DEFAULT false,
  pause_until           timestamptz,
  last_heartbeat_at     timestamptz,
  missed_order_count    int NOT NULL DEFAULT 0,
  avg_prep_minutes      int NOT NULL DEFAULT 20,
  delivery_radius_m     int NOT NULL DEFAULT 8000,
  minimum_order_cents   bigint NOT NULL DEFAULT 0,

  -- money / tax posture
  commission_rate_bps   int NOT NULL DEFAULT 0,     -- S-01: 0% at launch, per-restaurant switchable
  tax_role              text NOT NULL DEFAULT 'PLATFORM_IS_DEEMED_SUPPLIER'
                        CHECK (tax_role IN ('RESTAURANT_IS_SUPPLIER', 'PLATFORM_IS_DEEMED_SUPPLIER')),
  gst_hst_number        text,
  qst_number            text,

  -- halal (derived, never hand-set — see 00009 trigger)
  halal_status          halal_display_state NOT NULL DEFAULT 'UNVERIFIED',
  halal_certificate_id  uuid,                        -- FK added in 00009
  owner_attested_halal_at timestamptz,

  -- discovery
  cuisine_text          text,
  tags_text             text,
  logo_object_id        uuid REFERENCES stored_object(id),
  cover_object_id       uuid REFERENCES stored_object(id),
  rating_avg            numeric(3, 2),
  rating_count          int NOT NULL DEFAULT 0,
  price_band            price_band,

  approved_at           timestamptz,
  approved_by           uuid REFERENCES account(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  CONSTRAINT restaurant_country_ca CHECK (country = 'CA'),
  CONSTRAINT restaurant_commission_bps_range CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT restaurant_postal_shape CHECK (
    postal_code IS NULL OR postal_code ~ '^[A-Z][0-9][A-Z] ?[0-9][A-Z][0-9]$'),
  -- I-30.2: a live restaurant always has a location and a province. This is the
  -- constraint that makes "Restaurant location not found" at dispatch time
  -- unreachable for a normally onboarded restaurant.
  CONSTRAINT restaurant_live_needs_location CHECK (
    account_state <> 'LIVE' OR (location IS NOT NULL AND province IS NOT NULL)
  ),
  CONSTRAINT restaurant_live_needs_onboarding CHECK (
    account_state <> 'LIVE' OR onboarding_state = 'ACTIVE'
  )
);
SELECT attach_updated_at('restaurant');

-- The GiST index dispatch and discovery need for ST_DWithin / ST_Distance.
CREATE INDEX restaurant_location_gix ON restaurant USING GIST (location);
CREATE INDEX restaurant_live ON restaurant (account_state, province) WHERE deleted_at IS NULL;
CREATE INDEX restaurant_heartbeat ON restaurant (last_heartbeat_at) WHERE is_accepting_orders;

-- P-33 — Postgres-native search. Generated column, so it cannot drift from the
-- row it describes.
ALTER TABLE restaurant ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', hg_unaccent(coalesce(display_name, ''))), 'A') ||
    setweight(to_tsvector('english', hg_unaccent(coalesce(cuisine_text, ''))), 'B') ||
    setweight(to_tsvector('english', hg_unaccent(coalesce(tags_text, ''))), 'C') ||
    setweight(to_tsvector('english', hg_unaccent(coalesce(description, ''))), 'D')
) STORED;
CREATE INDEX restaurant_tsv_gin ON restaurant USING GIN (search_tsv);
CREATE INDEX restaurant_name_trgm ON restaurant USING GIN (display_name gin_trgm_ops);

ALTER TABLE stored_object
  ADD CONSTRAINT stored_object_restaurant_fk FOREIGN KEY (restaurant_id) REFERENCES restaurant(id);

CREATE TABLE restaurant_cuisine (
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  cuisine_id    uuid NOT NULL REFERENCES cuisine(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, cuisine_id)
);

-- Trading hours, evaluated in the restaurant's timezone (G-9) — never the
-- server's. An order at 03:00 against 11:00-22:00 hours is rejected.
CREATE TABLE restaurant_hours (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  restaurant_id   uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  day_of_week     int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),   -- 0 = Sunday
  opens_at        time NOT NULL,
  closes_at       time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_hours_ordering CHECK (crosses_midnight OR closes_at > opens_at)
);
SELECT attach_updated_at('restaurant_hours');
CREATE INDEX restaurant_hours_lookup ON restaurant_hours (restaurant_id, day_of_week);

CREATE TABLE restaurant_hours_override (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  restaurant_id uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  on_date       date NOT NULL,
  is_closed     boolean NOT NULL DEFAULT true,
  opens_at      time,
  closes_at     time,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_hours_override_shape CHECK (
    is_closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL)
  )
);
SELECT attach_updated_at('restaurant_hours_override');
CREATE UNIQUE INDEX restaurant_hours_override_day ON restaurant_hours_override (restaurant_id, on_date);

-- Onboarding as a state log, so "how did this restaurant get to ACTIVE" is a
-- query rather than an inference.
CREATE TABLE restaurant_onboarding_transition (
  id             bigserial PRIMARY KEY,
  restaurant_id  uuid NOT NULL REFERENCES restaurant(id) ON DELETE CASCADE,
  from_state     restaurant_onboarding_state,
  to_state       restaurant_onboarding_state NOT NULL,
  actor_kind     order_actor_kind NOT NULL,
  actor_account_id uuid REFERENCES account(id),
  decision_reason_code text,
  reason         text,
  request_id     text,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurant_onboarding_transition_r ON restaurant_onboarding_transition (restaurant_id, at);

-- Admin review queue metadata (assignment lock, SLA).
CREATE TABLE restaurant_application (
  restaurant_id           uuid PRIMARY KEY REFERENCES restaurant(id) ON DELETE CASCADE,
  submission_count        int NOT NULL DEFAULT 0,
  assigned_admin_id       uuid REFERENCES account(id),
  review_lock_expires_at  timestamptz,
  submitted_at            timestamptz,
  sla_due_at              timestamptz,
  decision                restaurant_decision,
  approve_reason_code     restaurant_approve_reason_code,
  reject_reason_code      restaurant_reject_application_reason_code,
  decided_by              uuid REFERENCES account(id),
  decided_at              timestamptz,
  address_pin_warning     boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('restaurant_application');
CREATE INDEX restaurant_application_queue ON restaurant_application (sla_due_at)
  WHERE decided_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS restaurant_application;
DROP TABLE IF EXISTS restaurant_onboarding_transition;
DROP TABLE IF EXISTS restaurant_hours_override;
DROP TABLE IF EXISTS restaurant_hours;
DROP TABLE IF EXISTS restaurant_cuisine;
ALTER TABLE stored_object DROP CONSTRAINT IF EXISTS stored_object_restaurant_fk;
DROP TABLE IF EXISTS restaurant;
DROP TABLE IF EXISTS cuisine;
