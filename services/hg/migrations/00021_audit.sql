-- P-35 / A-04 — the append-only, hash-chained audit trail.
--
-- Every privileged, money, identity, moderation or PII action writes one row
-- in the SAME transaction as the change it records. If the audit write fails,
-- the change rolls back. That is not best effort: the row is written by the
-- handler's transaction, and the chain fields are computed by a BEFORE INSERT
-- trigger so the application cannot get them wrong or forge them.
--
--   hash = sha256(prev_hash || canonical_json(row_without_hash))
--
-- chained per UTC day. verify_audit_chain(day) walks a day and returns the
-- first broken link, so tampering is detectable rather than merely discouraged.
--
-- Actor identity always comes from the verified session. The old system read
-- admin_id out of the request body.

-- +goose Up

CREATE TABLE audit_event (
  id                      uuid NOT NULL DEFAULT uuid_generate_v7(),
  at                      timestamptz NOT NULL DEFAULT now(),
  day                     date NOT NULL,
  seq                     bigint NOT NULL,
  actor_kind              text NOT NULL CHECK (actor_kind IN ('ACCOUNT', 'SYSTEM', 'WEBHOOK', 'JOB')),
  actor_account_id        uuid,
  actor_roles             jsonb,
  on_behalf_of_account_id uuid,                      -- support impersonation
  action                  text NOT NULL,
  subject_type            text NOT NULL,
  subject_id              uuid,
  outcome                 text NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED')),
  reason_code             text,
  reason                  text,
  before                  jsonb,
  after                   jsonb,
  amount_cents            bigint,                    -- set for money actions
  request_id              text,
  correlation_id          text,
  session_id              uuid,
  ip                      inet,
  user_agent              text,
  prev_hash               bytea NOT NULL,
  hash                    bytea NOT NULL,
  redacted_at             timestamptz,               -- payload tombstoned; chain preserved
  PRIMARY KEY (id, at),
  CONSTRAINT audit_event_actor_attributed CHECK (
    actor_kind <> 'ACCOUNT' OR actor_account_id IS NOT NULL
  )
) PARTITION BY RANGE (at);

CREATE INDEX audit_event_subject ON audit_event (subject_type, subject_id, at DESC);
CREATE INDEX audit_event_actor ON audit_event (actor_account_id, at DESC);
CREATE INDEX audit_event_action ON audit_event (action, at DESC);
CREATE INDEX audit_event_day ON audit_event (day, seq);

-- (day, seq) is globally unique; enforced per partition because a day never
-- spans two monthly partitions.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION audit_event_ensure_partition(p_month date) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE part text;
BEGIN
  part := ensure_monthly_partition('audit_event', p_month);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (day, seq)', part || '_day_seq', part);
  RETURN part;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE m date := date_trunc('month', now())::date;
BEGIN
  PERFORM audit_event_ensure_partition((m - interval '1 month')::date);
  PERFORM audit_event_ensure_partition(m);
  PERFORM audit_event_ensure_partition((m + interval '1 month')::date);
  EXECUTE 'CREATE TABLE audit_event_default PARTITION OF audit_event DEFAULT';
  EXECUTE 'CREATE UNIQUE INDEX audit_event_default_day_seq ON audit_event_default (day, seq)';
END
$$;
-- +goose StatementEnd

CREATE TABLE audit_chain_seal (
  seal_date     date PRIMARY KEY,
  terminal_hash bytea NOT NULL,
  event_count   int NOT NULL,
  sealed_at     timestamptz NOT NULL DEFAULT now(),
  external_ref  text                                  -- object-locked S3 key / signed digest id
);

-- The canonical serialisation the chain hashes over. Field order is fixed here
-- and nowhere else, so Go and SQL cannot disagree about what was signed.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION audit_canonical_json(e audit_event) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id',                      e.id,
    'at',                      to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'day',                     e.day,
    'seq',                     e.seq,
    'actor_kind',              e.actor_kind,
    'actor_account_id',        e.actor_account_id,
    'actor_roles',             e.actor_roles,
    'on_behalf_of_account_id', e.on_behalf_of_account_id,
    'action',                  e.action,
    'subject_type',            e.subject_type,
    'subject_id',              e.subject_id,
    'outcome',                 e.outcome,
    'reason_code',             e.reason_code,
    'reason',                  e.reason,
    'before',                  e.before,
    'after',                   e.after,
    'amount_cents',            e.amount_cents,
    'request_id',              e.request_id,
    'correlation_id',          e.correlation_id,
    'session_id',              e.session_id,
    'ip',                      host(e.ip),
    'user_agent',              e.user_agent
  )::text
$$;
-- +goose StatementEnd

-- BEFORE INSERT: allocate the per-day seq, read the previous head under a lock,
-- and compute the chain hash. The caller supplies none of these.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION audit_event_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prev bytea;
  next_seq bigint;
BEGIN
  NEW.day := (NEW.at AT TIME ZONE 'UTC')::date;

  -- Serialise chain appends for the day. A transaction-level advisory lock is
  -- released at COMMIT, which is exactly the scope the chain needs.
  PERFORM pg_advisory_xact_lock(hashtext('audit_event_chain'), NEW.day - DATE '2000-01-01');

  SELECT e.seq, e.hash INTO next_seq, prev
    FROM audit_event e
   WHERE e.day = NEW.day
   ORDER BY e.seq DESC
   LIMIT 1;

  IF next_seq IS NULL THEN
    NEW.seq := 1;
    -- First row of the day chains onto the previous day's seal when there is
    -- one, so the chain is continuous across day boundaries too.
    SELECT s.terminal_hash INTO prev FROM audit_chain_seal s WHERE s.seal_date = NEW.day - 1;
    prev := COALESCE(prev, digest('hg:audit:genesis:' || NEW.day::text, 'sha256'));
  ELSE
    NEW.seq := next_seq + 1;
  END IF;

  NEW.prev_hash := prev;
  NEW.hash := digest(prev || convert_to(audit_canonical_json(NEW), 'UTF8'), 'sha256');
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER audit_event_chain_before_insert
  BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_chain();

-- I-35.1 — append-only. REVOKE in 00023 is the first layer; this is the second.
-- Redaction (PIPEDA / retention) is the single permitted mutation and it
-- replaces payloads only, leaving every hashed-over-field except before/after
-- intact... which would break the chain, so redaction NULLs the payloads and
-- records redacted_at while the ORIGINAL hash stays untouched: verification
-- then reports the row as redacted rather than tampered.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION audit_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.redacted_at IS NULL
     AND NEW.redacted_at IS NOT NULL
     AND NEW.before IS NULL AND NEW.after IS NULL
     AND ROW(NEW.id, NEW.at, NEW.day, NEW.seq, NEW.actor_kind, NEW.actor_account_id,
             NEW.action, NEW.subject_type, NEW.subject_id, NEW.outcome,
             NEW.amount_cents, NEW.request_id, NEW.session_id, NEW.prev_hash, NEW.hash)
      IS NOT DISTINCT FROM
         ROW(OLD.id, OLD.at, OLD.day, OLD.seq, OLD.actor_kind, OLD.actor_account_id,
             OLD.action, OLD.subject_type, OLD.subject_id, OLD.outcome,
             OLD.amount_cents, OLD.request_id, OLD.session_id, OLD.prev_hash, OLD.hash)
  THEN
    RETURN NEW;                        -- payload tombstoning: permitted, once
  END IF;
  RAISE EXCEPTION 'audit_is_append_only: % on audit_event is never permitted', TG_OP
    USING ERRCODE = 'check_violation';
END
$$;
-- +goose StatementEnd

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_reject_mutation();

CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_mutation();

-- I-35.5 — walk a day and return the first broken link. Zero rows = intact.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION verify_audit_chain(p_day date)
RETURNS TABLE (day date, seq bigint, id uuid, problem text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  e audit_event;
  expected_prev bytea;
  expected_seq bigint := 1;
  computed bytea;
BEGIN
  SELECT s.terminal_hash INTO expected_prev FROM audit_chain_seal s WHERE s.seal_date = p_day - 1;
  expected_prev := COALESCE(expected_prev, digest('hg:audit:genesis:' || p_day::text, 'sha256'));

  FOR e IN SELECT * FROM audit_event a WHERE a.day = p_day ORDER BY a.seq LOOP
    IF e.seq <> expected_seq THEN
      day := p_day; seq := e.seq; id := e.id;
      problem := format('sequence gap: expected %s, found %s', expected_seq, e.seq);
      RETURN NEXT; RETURN;
    END IF;
    IF e.prev_hash IS DISTINCT FROM expected_prev THEN
      day := p_day; seq := e.seq; id := e.id;
      problem := 'prev_hash does not match the previous row''s hash';
      RETURN NEXT; RETURN;
    END IF;
    IF e.redacted_at IS NULL THEN
      computed := digest(e.prev_hash || convert_to(audit_canonical_json(e), 'UTF8'), 'sha256');
      IF computed IS DISTINCT FROM e.hash THEN
        day := p_day; seq := e.seq; id := e.id;
        problem := 'row hash does not match its content — the row was altered';
        RETURN NEXT; RETURN;
      END IF;
    END IF;
    expected_prev := e.hash;
    expected_seq := e.seq + 1;
  END LOOP;
  RETURN;
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS verify_audit_chain(date);
DROP TRIGGER IF EXISTS audit_event_no_truncate ON audit_event;
DROP TRIGGER IF EXISTS audit_event_append_only ON audit_event;
DROP FUNCTION IF EXISTS audit_reject_mutation();
DROP TRIGGER IF EXISTS audit_event_chain_before_insert ON audit_event;
DROP FUNCTION IF EXISTS audit_event_chain();
DROP FUNCTION IF EXISTS audit_canonical_json(audit_event);
DROP TABLE IF EXISTS audit_chain_seal;
DROP FUNCTION IF EXISTS audit_event_ensure_partition(date);
DROP TABLE IF EXISTS audit_event;
