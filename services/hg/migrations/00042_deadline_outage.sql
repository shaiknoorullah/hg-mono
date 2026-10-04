-- Deadlines that fell during an outage — docs/spec/01-platform.md, "P-15 —
-- Deadlines and timeout actions", the "Outages" paragraph.
--
-- The deadline runner fires every row whose deadline_at has passed. After a gap
-- (a failover, a restore, a reboot, a crash) that would fire every deadline in
-- the gap as if the restaurant or the rider had missed it. These tables let the
-- runner tell a gap from a normal tick, and make the handling of a gap a
-- database fact rather than a log line:
--
--   deadline_runner_heartbeat  one row per runner, rewritten every second.
--   deadline_outage            one row per gap: (last heartbeat, the moment a
--                              runner came back]. A deadline inside a window is
--                              handled as an outage action, never as a miss.
--   deadline_runner_release    the release for a runner started held
--                              (HG_DEADLINE_RUNNER_HOLD=true), so a failover can
--                              finish its catch-up before any deadline fires.
--   deadline_audit.outage_id   which outage an action belongs to. An outage
--                              outcome without it, or it without an outage
--                              outcome, cannot be committed.

-- +goose Up

CREATE TABLE deadline_runner_heartbeat (
  owner   text PRIMARY KEY,
  beat_at timestamptz NOT NULL
);

CREATE TABLE deadline_outage (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  gap_start   timestamptz NOT NULL,   -- the last heartbeat before the gap
  gap_end     timestamptz NOT NULL,   -- when a runner came back and saw the gap
  detected_by text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deadline_outage_window CHECK (gap_end > gap_start),
  -- One deadline belongs to at most one outage. Two replicas that come back
  -- together both see the same gap; the second insert is refused here and the
  -- runner treats that as "already recorded" (ON CONFLICT DO NOTHING).
  CONSTRAINT deadline_outage_no_overlap
    EXCLUDE USING gist (tstzrange(gap_start, gap_end, '(]') WITH &&)
);

CREATE TABLE deadline_runner_release (
  id          bigserial PRIMARY KEY,
  released_by text NOT NULL CHECK (length(btrim(released_by)) > 0),
  reason      text,
  released_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE deadline_audit ADD COLUMN outage_id uuid REFERENCES deadline_outage(id);
ALTER TABLE deadline_audit ADD CONSTRAINT deadline_audit_outage_tagged
  CHECK ((outage_id IS NOT NULL) = starts_with(outcome, 'OUTAGE_'));

-- Exactly once per (subject, action, escalation) — and, separately, once per
-- outage. An outage action does not use up an escalation, so the normal fire
-- that follows it carries the same escalation_no and must not collide with it.
DROP INDEX deadline_audit_once;
CREATE UNIQUE INDEX deadline_audit_once
  ON deadline_audit (subject_type, subject_id, action, escalation_no, outage_id) NULLS NOT DISTINCT;

-- The outage record and its release are evidence; the application only adds to
-- them. (The heartbeat is rewritten every second, so it keeps UPDATE.)
REVOKE UPDATE, DELETE, TRUNCATE ON deadline_outage FROM hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON deadline_runner_release FROM hg_app;

-- +goose Down
DROP INDEX IF EXISTS deadline_audit_once;
DELETE FROM deadline_audit WHERE outage_id IS NOT NULL;
ALTER TABLE deadline_audit DROP CONSTRAINT IF EXISTS deadline_audit_outage_tagged;
ALTER TABLE deadline_audit DROP COLUMN IF EXISTS outage_id;
CREATE UNIQUE INDEX deadline_audit_once
  ON deadline_audit (subject_type, subject_id, action, escalation_no);
DROP TABLE IF EXISTS deadline_runner_release;
DROP TABLE IF EXISTS deadline_outage;
DROP TABLE IF EXISTS deadline_runner_heartbeat;
