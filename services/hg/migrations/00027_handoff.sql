-- Handoff verification — docs/design/handoff-verification.md.
--
-- Two guarantees layered on top of the order machine (P-14), which stays the
-- sole writer of order state (orders owns state; handoff owns proof):
--
--   1. Identity  — the rider picked up and delivered the *correct* order.
--   2. Integrity — the tamper-evident seal applied at the kitchen was still
--                  intact at the door.
--
-- The QR encodes an EdDSA-signed token {order_id, seal_id, nonce} minted with
-- auth's signing keys (P-04) — offline-verifiable, unforgeable, and bound to
-- one order so it cannot be moved to another. `nonce` carries a UNIQUE
-- constraint per seal: replay is a constraint violation, not a runtime check
-- that might be skipped (same "make the bug unrepresentable" discipline as
-- the deadline CHECK and the ledger trigger).
--
-- Only the rider ever scans — at both pickup and delivery. The customer's
-- proof is the OTP they already hold (recipient identity) plus an optional
-- visual seal check; there is no customer-facing scan actor. A tamper report
-- never auto-fails the order — it is evidence handed to the dispute flow
-- (A-33/A-35); orders/payments decide the money outcome, handoff only supplies
-- the scan history and photo.
--
-- Photos and any handoff geo pins are `stored_object` rows (00007_documents.sql)
-- in the private hg-pod bucket, behind short-TTL presigned URLs — the same
-- private-bucket-only path as KYC (invariant #7). No price, no PII, is ever
-- encoded in the QR payload itself.

-- +goose Up

CREATE TYPE package_seal_status AS ENUM (
  'ISSUED',            -- seal stock known to the platform, not yet bound
  'BOUND',              -- scanned at packing, bound to one order
  'PICKUP_VERIFIED',    -- rider scan matched at pickup
  'DELIVERY_VERIFIED',  -- rider scan matched at delivery
  'TAMPER_REPORTED'     -- seal_intact = false reported at any scan
);

CREATE TYPE handoff_event_type AS ENUM ('SEAL', 'PICKUP', 'DELIVERY', 'TAMPER_REPORT');

-- Who performed the step that produced this event. The customer never scans;
-- their only handoff-adjacent event is the tamper report, filed from their
-- side after a rider-completed DELIVERY scan.
CREATE TYPE handoff_actor AS ENUM ('RESTAURANT', 'RIDER', 'CUSTOMER');

CREATE TYPE handoff_method AS ENUM ('QR', 'OTP', 'PHOTO');

CREATE TABLE package_seal (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  seal_code        text NOT NULL UNIQUE,        -- printed/pre-coded on the physical label
  order_id         uuid REFERENCES "order"(id), -- NULL until bound at packing
  restaurant_id    uuid NOT NULL REFERENCES restaurant(id),
  signed_token     text,                        -- EdDSA-signed {order_id, seal_id, nonce}, set on bind
  status           package_seal_status NOT NULL DEFAULT 'ISSUED',
  bound_at         timestamptz,
  pickup_verified_at   timestamptz,
  delivery_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- A seal binds to exactly one order for its lifetime; ISSUED is the only
  -- status legally missing an order_id.
  CONSTRAINT package_seal_bound_has_order CHECK (
    (status = 'ISSUED' AND order_id IS NULL AND signed_token IS NULL)
    OR (status <> 'ISSUED' AND order_id IS NOT NULL AND signed_token IS NOT NULL)
  )
);
SELECT attach_updated_at('package_seal');
CREATE UNIQUE INDEX package_seal_order ON package_seal (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX package_seal_restaurant ON package_seal (restaurant_id);

-- Append-only chain of custody: every scan/attestation, evidence for disputes.
-- Nothing here is ever updated or deleted — a correction is a new row.
CREATE TABLE handoff_event (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id       uuid NOT NULL REFERENCES "order"(id),
  seal_id        uuid REFERENCES package_seal(id),
  type           handoff_event_type NOT NULL,
  actor          handoff_actor NOT NULL,
  actor_account_id uuid REFERENCES account(id),
  method         handoff_method NOT NULL,
  -- The single-use nonce from the signed token. NULL for OTP/PHOTO-method
  -- events (the customer's tamper report carries no token). UNIQUE makes
  -- replay of a QR scan a constraint violation, not a check someone forgot.
  nonce          text,
  seal_intact    boolean,
  geo            geography(Point, 4326),      -- server-resolved, never a client-supplied string
  photo_object_id uuid REFERENCES stored_object(id),
  note           text,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handoff_event_nonce_required_for_qr CHECK (
    method <> 'QR' OR nonce IS NOT NULL
  )
);
CREATE UNIQUE INDEX handoff_event_nonce_unique ON handoff_event (seal_id, nonce) WHERE nonce IS NOT NULL;
CREATE INDEX handoff_event_order ON handoff_event (order_id, at);
CREATE INDEX handoff_event_seal ON handoff_event (seal_id);

-- +goose Down

DROP TABLE IF EXISTS handoff_event;
DROP TABLE IF EXISTS package_seal;
DROP TYPE IF EXISTS handoff_method;
DROP TYPE IF EXISTS handoff_actor;
DROP TYPE IF EXISTS handoff_event_type;
DROP TYPE IF EXISTS package_seal_status;
