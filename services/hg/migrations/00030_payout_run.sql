-- The weekly payout run: its schedule, its audit trail, one payout per partner
-- per period, and the order block on a restaurant whose balance stays negative.
--
-- Issue #251: nothing scheduled the weekly payout and nothing could trigger
-- one. Rules: docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding and
-- payouts (Canada)" (weekly, every Monday, automatic, no minimum; a held payout
-- is released on the next Monday run; negative balances are carried and
-- netted) and "P-39 — Background runtime" (a payout run per schedule, safe on
-- any number of replicas). No workflow engine: payout_run.due_at is the
-- schedule column and a ticker in internal/payments/payout_run.go claims due
-- rows under a session advisory lock.

-- +goose Up

CREATE TYPE payout_run_kind AS ENUM ('SCHEDULED', 'ADMIN');

CREATE TYPE payout_run_state AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TYPE payout_run_outcome AS ENUM (
  'PAID',
  'HELD',
  'STILL_HELD',
  'RELEASED',
  'TRANSFER_FAILED',
  'ALREADY_PAID',
  'NOTHING_DUE',
  'CARRIED_NEGATIVE',
  'NO_PAYOUT_ACCOUNT',
  'PARTNER_SUSPENDED',
  'ORDERS_BLOCKED',
  'ORDERS_UNBLOCKED',
  'ERROR'
);

-- One row per run. A scheduled run is inserted for each closed period, due on
-- Monday 09:00 America/Toronto; an admin run is due the moment it is
-- requested. The ticker runs every unfinished row whose due_at has passed, so
-- a run a worker abandoned mid-way (a crash, a deploy) is finished by the next
-- one; every step it repeats is idempotent.
CREATE TABLE payout_run (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  kind             payout_run_kind NOT NULL,
  state            payout_run_state NOT NULL DEFAULT 'QUEUED',
  -- The period paid: [period_start, period_end). period_end is the cutoff,
  -- Monday 00:00 America/Toronto; earnings created before it are due.
  period_start     timestamptz NOT NULL,
  period_end       timestamptz NOT NULL,
  as_of            timestamptz NOT NULL,
  due_at           timestamptz NOT NULL,
  -- NULL for every partner; set for a run requested for one partner.
  payee_type       text CHECK (payee_type IN ('RESTAURANT', 'RIDER')),
  payee_id         uuid,
  requested_by     uuid REFERENCES account(id),
  idempotency_key  text,
  -- Why the admin asked, for the audit trail.
  request_reason   text,
  -- The request body in canonical form, so a replayed key with a different
  -- body is refused rather than answered with the wrong run.
  request_fingerprint text,
  attempts         int NOT NULL DEFAULT 0,
  started_at       timestamptz,
  finished_at      timestamptz,
  partners         int NOT NULL DEFAULT 0,
  paid             int NOT NULL DEFAULT 0,
  held             int NOT NULL DEFAULT 0,
  released         int NOT NULL DEFAULT 0,
  carried          int NOT NULL DEFAULT 0,
  failed           int NOT NULL DEFAULT 0,
  paid_cents       bigint NOT NULL DEFAULT 0,
  held_cents       bigint NOT NULL DEFAULT 0,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_run_period CHECK (period_end > period_start),
  CONSTRAINT payout_run_one_payee CHECK ((payee_type IS NULL) = (payee_id IS NULL)),
  CONSTRAINT payout_run_scheduled_shape CHECK (
    kind <> 'SCHEDULED' OR (payee_type IS NULL AND requested_by IS NULL AND idempotency_key IS NULL)),
  CONSTRAINT payout_run_admin_shape CHECK (
    kind <> 'ADMIN'
    OR (requested_by IS NOT NULL AND idempotency_key IS NOT NULL AND request_fingerprint IS NOT NULL
        AND COALESCE(length(request_reason), 0) >= 10)),
  CONSTRAINT payout_run_finished CHECK ((state IN ('SUCCEEDED', 'FAILED')) = (finished_at IS NOT NULL))
);
SELECT attach_updated_at('payout_run');
-- One scheduled run per period, however many replicas insert it.
CREATE UNIQUE INDEX payout_run_scheduled_once ON payout_run (period_end) WHERE kind = 'SCHEDULED';
-- An admin's retried request (same Idempotency-Key) finds its first run.
CREATE UNIQUE INDEX payout_run_request_once ON payout_run (requested_by, idempotency_key)
  WHERE kind = 'ADMIN';
CREATE INDEX payout_run_due ON payout_run (due_at) WHERE finished_at IS NULL;
CREATE INDEX payout_run_recent ON payout_run (id DESC);

-- What a run did for each partner, one line per action: the audit trail.
-- Append-only, like the ledger.
CREATE TABLE payout_run_line (
  id            bigserial PRIMARY KEY,
  run_id        uuid NOT NULL REFERENCES payout_run(id),
  attempt       int NOT NULL,
  payee_type    text NOT NULL CHECK (payee_type IN ('RESTAURANT', 'RIDER')),
  payee_id      uuid NOT NULL,
  outcome       payout_run_outcome NOT NULL,
  payout_id     uuid REFERENCES payout(id),
  amount_cents  bigint NOT NULL DEFAULT 0,
  detail        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_run_line_run ON payout_run_line (run_id, id);
CREATE INDEX payout_run_line_payee ON payout_run_line (payee_type, payee_id, id DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON payout_run_line FROM hg_app;

-- At most one payout per partner per period: a second run for the same period
-- finds this one instead of paying again.
CREATE UNIQUE INDEX payout_once_per_period ON payout (connect_account_id, period_end);

-- A payout is never zero or negative: a balance at or below zero is carried,
-- not paid. DRAFT is exempt, as it is from the amount-matches-entries check.
ALTER TABLE payout ADD CONSTRAINT payout_amount_positive CHECK (state = 'DRAFT' OR amount_cents > 0);

-- A restaurant whose balance has been below zero for longer than the
-- configured limit takes no new orders until the balance recovers. Whether
-- the platform blocks at all is still the owner's open question (#164); the
-- limit is HG_RESTAURANT_NEGATIVE_BALANCE_BLOCK_DAYS and 0 turns it off.
CREATE TABLE restaurant_collection (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  restaurant_id   uuid NOT NULL REFERENCES restaurant(id),
  balance_cents   bigint NOT NULL CHECK (balance_cents < 0),
  negative_since  timestamptz NOT NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  opened_by_run   uuid NOT NULL REFERENCES payout_run(id),
  closed_at       timestamptz,
  closed_by_run   uuid REFERENCES payout_run(id),
  close_reason    text CHECK (close_reason IN ('BALANCE_RECOVERED', 'BLOCK_TURNED_OFF')),
  CONSTRAINT restaurant_collection_closed CHECK (
    (closed_at IS NULL) = (close_reason IS NULL) AND (closed_at IS NULL) = (closed_by_run IS NULL))
);
CREATE UNIQUE INDEX restaurant_collection_open ON restaurant_collection (restaurant_id)
  WHERE closed_at IS NULL;

-- +goose Down
DROP TABLE IF EXISTS restaurant_collection;
ALTER TABLE payout DROP CONSTRAINT IF EXISTS payout_amount_positive;
DROP INDEX IF EXISTS payout_once_per_period;
DROP TABLE IF EXISTS payout_run_line;
DROP TABLE IF EXISTS payout_run;
DROP TYPE IF EXISTS payout_run_outcome;
DROP TYPE IF EXISTS payout_run_state;
DROP TYPE IF EXISTS payout_run_kind;
