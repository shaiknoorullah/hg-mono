-- P-37 / P-39 — idempotency records, background-loop bookkeeping, search log,
-- and the order_visibility view that ownership checks push into SQL.

-- +goose Up

-- P-37. Written in the same transaction as the business effect, so "money
-- moved but the idempotency record did not commit" cannot happen. Postgres,
-- not Redis: idempotency is a correctness mechanism, not a cache.
CREATE TABLE idempotency_record (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id       uuid NOT NULL,
  method           text NOT NULL,
  path_template    text NOT NULL,
  key              text NOT NULL,
  request_hash     bytea NOT NULL,
  state            text NOT NULL CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  response_status  int,
  response_body    jsonb,
  response_headers jsonb,
  resource_type    text,
  resource_id      uuid,
  lease_until      timestamptz,
  completed_at     timestamptz,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_key_length CHECK (length(key) BETWEEN 16 AND 128),
  CONSTRAINT idempotency_completed_has_response CHECK (
    state <> 'COMPLETED' OR (response_status IS NOT NULL AND completed_at IS NOT NULL)
  )
);
SELECT attach_updated_at('idempotency_record');
CREATE UNIQUE INDEX idempotency_unique
  ON idempotency_record (account_id, method, path_template, key);
CREATE INDEX idempotency_expiry ON idempotency_record (expires_at);

CREATE TABLE job_run (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  claimed     int NOT NULL DEFAULT 0,
  succeeded   int NOT NULL DEFAULT 0,
  failed      int NOT NULL DEFAULT 0,
  error       text
);
CREATE INDEX job_run_recent ON job_run (job, started_at DESC);

CREATE TABLE search_query_log (
  id               bigserial PRIMARY KEY,
  account_id       uuid,
  q                text,
  filters          jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_count     int NOT NULL DEFAULT 0,
  clicked_result_id uuid,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_query_log_zero_results ON search_query_log (at DESC) WHERE result_count = 0;

-- P-07 — one view expresses order visibility. Every order read joins it unless
-- the principal holds a global order.read_any, in which case the access is
-- audited. Pushing the ownership predicate into SQL is what makes the
-- "load then forget to compare" IDOR class unwriteable.
CREATE VIEW order_visibility AS
  SELECT o.id AS order_id, o.account_id, 'CUSTOMER'::text AS via
    FROM "order" o
  UNION ALL
  SELECT o.id, ar.account_id, 'RESTAURANT'
    FROM "order" o
    JOIN account_role ar
      ON ar.scope_type = 'RESTAURANT'
     AND ar.scope_id = o.restaurant_id
     AND ar.revoked_at IS NULL
  UNION ALL
  SELECT o.id, d.rider_account_id, 'RIDER'
    FROM "order" o
    JOIN dispatch d ON d.order_id = o.id
   WHERE d.rider_account_id IS NOT NULL
     AND d.state <> 'UNASSIGNED';

-- I-15.1, as a query that must return zero rows. The CHECK already makes it
-- impossible; this is the assertion a test or an ops dashboard runs to prove it.
CREATE VIEW order_without_deadline AS
  SELECT id, code, state
    FROM "order"
   WHERE state NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED', 'RESOLVED')
     AND (deadline_at IS NULL OR deadline_action IS NULL);

CREATE VIEW dispatch_without_deadline AS
  SELECT order_id, state
    FROM dispatch
   WHERE state NOT IN ('COMPLETED', 'NO_RIDER_FOUND')
     AND (deadline_at IS NULL OR deadline_action IS NULL);

-- +goose Down
DROP VIEW IF EXISTS dispatch_without_deadline;
DROP VIEW IF EXISTS order_without_deadline;
DROP VIEW IF EXISTS order_visibility;
DROP TABLE IF EXISTS search_query_log;
DROP TABLE IF EXISTS job_run;
DROP TABLE IF EXISTS idempotency_record;
