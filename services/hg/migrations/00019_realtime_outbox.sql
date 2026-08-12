-- P-20..P-23 — realtime tickets, the event log, per-channel seq, the outbox.
--
-- Identity is server-derived from a single-use ticket; there is no client-
-- asserted identity anywhere, and no subscription right is ever read from
-- Redis. `seq` is allocated from channel_cursor inside the same transaction as
-- the state change, which is what makes gap detection and non-destructive
-- replay possible. Redis pub/sub is fan-out only: if it is flushed, events
-- accumulate in outbox_message and every client's `resume` fills the gap.

-- +goose Up

CREATE TABLE realtime_ticket (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  ticket_hash    bytea NOT NULL UNIQUE,
  account_id     uuid NOT NULL REFERENCES account(id),
  session_id     uuid NOT NULL REFERENCES session(id),
  roles_snapshot jsonb NOT NULL,
  client         client_surface NOT NULL,
  issued_ip      inet,
  expires_at     timestamptz NOT NULL,               -- issued + 30 s
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX realtime_ticket_expiry ON realtime_ticket (expires_at) WHERE consumed_at IS NULL;

CREATE TABLE realtime_connection (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id      uuid NOT NULL REFERENCES account(id),
  session_id      uuid NOT NULL REFERENCES session(id),
  node_id         text NOT NULL,
  client          client_surface NOT NULL,
  connected_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  reauthed_at     timestamptz,
  disconnected_at timestamptz,
  close_code      int,
  close_reason    text
);
CREATE INDEX realtime_connection_live ON realtime_connection (account_id) WHERE disconnected_at IS NULL;
CREATE INDEX realtime_connection_session ON realtime_connection (session_id) WHERE disconnected_at IS NULL;

-- The seq allocator. One row per channel; UPDATE ... RETURNING inside the
-- state-change transaction is what makes the sequence gapless.
CREATE TABLE channel_cursor (
  channel    text PRIMARY KEY,
  last_seq   bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION next_channel_seq(p_channel text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  INSERT INTO channel_cursor (channel, last_seq) VALUES (p_channel, 1)
  ON CONFLICT (channel) DO UPDATE SET last_seq = channel_cursor.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO s;
  RETURN s;
END
$$;
-- +goose StatementEnd

-- Immutable event log; replay is a read of this table, so any number of
-- clients may replay the same range with identical results. Retention 7 days
-- by daily partition drop.
CREATE TABLE realtime_event (
  id         uuid NOT NULL DEFAULT uuid_generate_v7(),
  ulid       text NOT NULL,
  channel    text NOT NULL,
  seq        bigint NOT NULL,
  type       text NOT NULL,
  v          int NOT NULL DEFAULT 1,
  audience   text[] NOT NULL DEFAULT '{}',
  payload    jsonb NOT NULL,                          -- unprojected; projection at send time
  order_id   uuid,
  account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX realtime_event_channel ON realtime_event (channel, seq);
CREATE INDEX realtime_event_created ON realtime_event (created_at);

-- (channel, seq) is globally unique because seq comes from channel_cursor;
-- a partitioned table cannot declare that without the partition key, so it is
-- enforced per partition by the helper below.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION realtime_event_ensure_partition(p_day date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE part text;
BEGIN
  part := ensure_daily_partition('realtime_event', p_day);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (channel, seq)',
                 part || '_channel_seq', part);
  RETURN part;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE d date := current_date;
BEGIN
  PERFORM realtime_event_ensure_partition(d - 1);
  PERFORM realtime_event_ensure_partition(d);
  PERFORM realtime_event_ensure_partition(d + 1);
  EXECUTE 'CREATE TABLE realtime_event_default PARTITION OF realtime_event DEFAULT';
  EXECUTE 'CREATE UNIQUE INDEX realtime_event_default_channel_seq ON realtime_event_default (channel, seq)';
END
$$;
-- +goose StatementEnd

-- The transactional outbox. An event cannot exist without its state change and
-- vice versa: both are written in one transaction, and the relay publishes
-- afterwards with FOR UPDATE SKIP LOCKED.
CREATE TABLE outbox_message (
  id                bigserial PRIMARY KEY,
  kind              text NOT NULL CHECK (kind IN ('REALTIME', 'NOTIFICATION', 'STRIPE', 'AUDIT_SINK', 'PUSH')),
  channel           text,
  realtime_event_id uuid,
  seq               bigint,
  payload           jsonb NOT NULL,
  available_at      timestamptz NOT NULL DEFAULT now(),
  attempts          int NOT NULL DEFAULT 0,
  published_at      timestamptz,
  last_error        text,
  lease_until       timestamptz,
  lease_owner       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending ON outbox_message (available_at) WHERE published_at IS NULL;
CREATE INDEX outbox_channel_order ON outbox_message (channel, seq) WHERE published_at IS NULL;

-- I-23.1, as a query that must return zero rows: no realtime event lacks a
-- corresponding outbox row.
CREATE VIEW realtime_event_without_outbox AS
  SELECT e.id, e.channel, e.seq, e.created_at
    FROM realtime_event e
   WHERE NOT EXISTS (
     SELECT 1 FROM outbox_message o
      WHERE o.realtime_event_id = e.id AND o.kind = 'REALTIME');

-- +goose Down
DROP VIEW IF EXISTS realtime_event_without_outbox;
DROP TABLE IF EXISTS outbox_message;
DROP FUNCTION IF EXISTS realtime_event_ensure_partition(date);
DROP TABLE IF EXISTS realtime_event;
DROP FUNCTION IF EXISTS next_channel_seq(text);
DROP TABLE IF EXISTS channel_cursor;
DROP TABLE IF EXISTS realtime_connection;
DROP TABLE IF EXISTS realtime_ticket;
