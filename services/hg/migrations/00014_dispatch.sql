-- Dispatch: the subordinate machine.
--
-- The order has one fulfilment track; rider assignment runs concurrently and
-- may push the order forward through exactly three transitions (CARRYING =>
-- PICKED_UP, AT_CUSTOMER => ARRIVED, COMPLETED => DELIVERED). It may never
-- cancel an order — NO_RIDER_FOUND arms the order's READY_FOR_PICKUP
-- escalation instead.
--
-- Acceptance is a race resolved by a conditional UPDATE in Postgres, not by a
-- workflow signal: exactly one rider can win, by construction.

-- +goose Up

CREATE TABLE dispatch (
  order_id             uuid PRIMARY KEY REFERENCES "order"(id),
  state                dispatch_state NOT NULL DEFAULT 'PENDING',
  state_since          timestamptz NOT NULL DEFAULT now(),
  deadline_at          timestamptz,
  deadline_action      text,
  deadline_escalations int NOT NULL DEFAULT 0,
  lease_until          timestamptz,
  lease_owner          text,
  rider_account_id     uuid REFERENCES account(id),
  assigned_at          timestamptz,
  wave                 int NOT NULL DEFAULT 0,
  radius_m             int NOT NULL DEFAULT 0,
  pickup_eta_at        timestamptz,
  dropoff_eta_at       timestamptz,
  pod_object_id        uuid REFERENCES stored_object(id),
  pod_method           pod_method,
  handover_method      handover_method,
  tracking_health      tracking_health NOT NULL DEFAULT 'HEALTHY',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- G-5 again: a dispatch in flight is always on a clock.
  CONSTRAINT dispatch_deadline_required CHECK (
    (state IN ('COMPLETED', 'NO_RIDER_FOUND') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state NOT IN ('COMPLETED', 'NO_RIDER_FOUND') AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  ),
  CONSTRAINT dispatch_rider_when_assigned CHECK (
    state NOT IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING', 'AT_CUSTOMER', 'COMPLETED')
    OR rider_account_id IS NOT NULL
  )
);
SELECT attach_updated_at('dispatch');
CREATE INDEX dispatch_due ON dispatch (deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX dispatch_rider_active ON dispatch (rider_account_id)
  WHERE state IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING', 'AT_CUSTOMER');
CREATE INDEX dispatch_searching ON dispatch (state, state_since) WHERE state IN ('PENDING', 'SEARCHING', 'OFFERED');

-- A rider can hold at most one live dispatch. The old system had no such guard
-- and double assignment was inevitable.
CREATE UNIQUE INDEX dispatch_one_live_per_rider ON dispatch (rider_account_id)
  WHERE rider_account_id IS NOT NULL
    AND state IN ('ASSIGNED', 'AT_RESTAURANT', 'CARRYING', 'AT_CUSTOMER');

CREATE TABLE dispatch_wave (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id      uuid NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  wave_no       int NOT NULL,
  radius_m      int NOT NULL,
  candidates    int NOT NULL DEFAULT 0,
  offers_sent   int NOT NULL DEFAULT 0,
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  outcome       text,                               -- 'ACCEPTED'|'EXHAUSTED'|'CANCELLED'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_wave_bounds CHECK (wave_no > 0 AND radius_m > 0)
);
SELECT attach_updated_at('dispatch_wave');
CREATE UNIQUE INDEX dispatch_wave_no ON dispatch_wave (order_id, wave_no);

CREATE TABLE dispatch_offer (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id              uuid NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  dispatch_wave_id      uuid REFERENCES dispatch_wave(id),
  rider_account_id      uuid NOT NULL REFERENCES account(id),
  wave                  int NOT NULL,
  distance_m            int NOT NULL,
  est_duration_s        int,
  earnings_cents        bigint NOT NULL CHECK (earnings_cents >= 0),
  tip_estimate_cents    bigint NOT NULL DEFAULT 0 CHECK (tip_estimate_cents >= 0),
  surge_multiplier_bps  int NOT NULL DEFAULT 10000, -- frozen onto the offer; bps, never a float
  score                 int,
  rank_in_wave          int,
  state                 offer_state NOT NULL DEFAULT 'PENDING',
  outcome               dispatch_offer_outcome,
  reject_reason_code    offer_reject_reason_code,
  offered_at            timestamptz NOT NULL DEFAULT now(),
  delivered_to_device_at timestamptz,
  seen_at               timestamptz,
  expires_at            timestamptz NOT NULL,
  outcome_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- state and outcome are the same fact in two vocabularies (the contract
  -- exposes both OfferState and DispatchOfferOutcome); keep them consistent.
  CONSTRAINT dispatch_offer_outcome_agrees CHECK (
    (state = 'PENDING'   AND outcome IS NULL AND outcome_at IS NULL) OR
    (state = 'ACCEPTED'  AND outcome = 'ACCEPTED'  AND outcome_at IS NOT NULL) OR
    (state = 'REJECTED'  AND outcome = 'REJECTED'  AND outcome_at IS NOT NULL) OR
    (state = 'EXPIRED'   AND outcome = 'EXPIRED'   AND outcome_at IS NOT NULL) OR
    (state = 'WITHDRAWN' AND outcome = 'WITHDRAWN' AND outcome_at IS NOT NULL)
  ),
  CONSTRAINT dispatch_offer_reject_has_reason CHECK (
    state <> 'REJECTED' OR reject_reason_code IS NOT NULL
  )
);
SELECT attach_updated_at('dispatch_offer');

-- I-32.3: a rider is offered a given order at most once, so a rejection or an
-- expiry can never be re-offered in a later wave.
CREATE UNIQUE INDEX dispatch_offer_unique ON dispatch_offer (order_id, rider_account_id);
-- A rider holds at most one pending offer at a time.
CREATE UNIQUE INDEX dispatch_offer_one_pending ON dispatch_offer (rider_account_id)
  WHERE state = 'PENDING';
CREATE INDEX dispatch_offer_expiry ON dispatch_offer (expires_at) WHERE state = 'PENDING';

-- The rider-facing delivery record. `dispatch` is the platform's routing state;
-- `assignment` is the rider's leg of it, with the finer-grained state the rider
-- contract exposes (AssignmentState).
CREATE TABLE assignment (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id             uuid NOT NULL REFERENCES "order"(id) ON DELETE CASCADE,
  rider_account_id     uuid NOT NULL REFERENCES account(id),
  dispatch_offer_id    uuid REFERENCES dispatch_offer(id),
  state                assignment_state NOT NULL DEFAULT 'ASSIGNED',
  state_since          timestamptz NOT NULL DEFAULT now(),
  required_pod_method  pod_method,
  pod_recorded         boolean NOT NULL DEFAULT false,
  pod_object_id        uuid REFERENCES stored_object(id),
  handover_method      handover_method,
  tracking_health      tracking_health NOT NULL DEFAULT 'HEALTHY',
  billable_distance_m  int,
  distance_source      route_source,
  pickup_wait_seconds  int,
  last_location_at     timestamptz,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  arrived_pickup_at    timestamptz,
  picked_up_at         timestamptz,
  arrived_dropoff_at   timestamptz,
  delivered_at         timestamptz,
  terminated_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignment_delivered_needs_pod CHECK (
    state <> 'DELIVERED' OR required_pod_method IS NULL OR pod_recorded
  )
);
SELECT attach_updated_at('assignment');
CREATE UNIQUE INDEX assignment_live_per_order ON assignment (order_id)
  WHERE terminated_at IS NULL;
CREATE INDEX assignment_rider ON assignment (rider_account_id, assigned_at DESC);

CREATE TABLE assignment_transition (
  id               bigserial PRIMARY KEY,
  assignment_id    uuid NOT NULL REFERENCES assignment(id) ON DELETE CASCADE,
  from_state       assignment_state,
  to_state         assignment_state NOT NULL,
  actor_kind       order_actor_kind NOT NULL,
  actor_account_id uuid REFERENCES account(id),
  reason           text,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignment_transition_a ON assignment_transition (assignment_id, at);

-- +goose Down
DROP TABLE IF EXISTS assignment_transition;
DROP TABLE IF EXISTS assignment;
DROP TABLE IF EXISTS dispatch_offer;
DROP TABLE IF EXISTS dispatch_wave;
DROP TABLE IF EXISTS dispatch;
