-- Virus scanning of KYC uploads (docs/spec/01-platform.md, P-28 "Presigned
-- upload and download": confirm "enqueues a virus scan for KYC uploads").
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/218
--
-- Before this migration confirmUpload set virus_scan_state = 'PENDING' and
-- nothing ever moved it, while the admin review approved documents without
-- looking at it — so an unscanned file could be approved. Now:
--
--   * internal/files.ScanWorker streams each PENDING object to clamd and
--     records CLEAN, INFECTED, TOO_LARGE or UNSCANNABLE, with the signature or
--     reason in virus_scan_detail. It hashes what it streamed and records ERROR,
--     never CLEAN, when the bytes are not the ones confirmed.
--   * TOO_LARGE and UNSCANNABLE are new: a file over a scan limit, or with
--     encrypted content, was never fully read by the scanner, so it is flagged,
--     never passed.
--   * An object the store cannot serve is retried with backoff
--     (virus_scan_attempts, virus_scan_next_at) so it cannot block the queue,
--     and is marked ERROR after repeated failures.
--   * The database refuses to APPROVE a KYC document whose file is not CLEAN.
--     The admin handler checks first and answers 409; this trigger is what
--     makes the bug unrepresentable for every other writer.
--   * A verdict is written once. Changing it again needs the transaction-local
--     setting hg.rescan_reason, which only internal/files sets, alongside the
--     audit row that names who and why.
--   * If a CLEAN file's verdict changes, every APPROVED document on it goes back
--     to IN_REVIEW on the 72-hour review clock, each with an audit row, and ops
--     is told on the ops_alert channel. Approval is not a one-time check.

-- +goose Up

ALTER TABLE stored_object
  DROP CONSTRAINT stored_object_virus_scan_state_check,
  ADD CONSTRAINT stored_object_virus_scan_state_check
    CHECK (virus_scan_state IN
      ('PENDING', 'CLEAN', 'INFECTED', 'TOO_LARGE', 'UNSCANNABLE', 'SKIPPED', 'ERROR')),
  ADD COLUMN virus_scan_detail   text,
  ADD COLUMN virus_scanned_at    timestamptz,
  -- Failed attempts to read the object from the store, and when to try next.
  ADD COLUMN virus_scan_attempts int NOT NULL DEFAULT 0 CHECK (virus_scan_attempts >= 0),
  ADD COLUMN virus_scan_next_at  timestamptz;

-- The scan queue: confirmed objects still waiting for a verdict, ready ones first.
CREATE INDEX stored_object_scan_queue ON stored_object (virus_scan_next_at NULLS FIRST, confirmed_at)
  WHERE state = 'READY' AND virus_scan_state = 'PENDING' AND deleted_at IS NULL;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION kyc_document_assert_scanned() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  scan text;
BEGIN
  IF NEW.state <> 'APPROVED' THEN
    RETURN NEW;
  END IF;
  -- Already approved and still pointing at the same file: nothing new to check.
  IF TG_OP = 'UPDATE' AND OLD.state = 'APPROVED' AND OLD.stored_object_id = NEW.stored_object_id THEN
    RETURN NEW;
  END IF;
  SELECT virus_scan_state INTO scan FROM stored_object WHERE id = NEW.stored_object_id;
  IF scan IS DISTINCT FROM 'CLEAN' THEN
    RAISE EXCEPTION
      'kyc_document_virus_scan_clean: document % cannot be APPROVED while its file''s virus scan is %',
      NEW.id, COALESCE(scan, 'missing')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kyc_document_virus_scan_clean';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER kyc_document_virus_scan_clean
  BEFORE INSERT OR UPDATE OF state, stored_object_id ON kyc_document
  FOR EACH ROW EXECUTE FUNCTION kyc_document_assert_scanned();

-- A verdict is written once: PENDING may become anything, but a recorded
-- verdict changes only inside a transaction that set hg.rescan_reason with
-- set_config(..., true). internal/files does that in the same transaction as
-- the audit row naming the actor and the reason, so an unexplained change to a
-- verdict is not a state the system can reach.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION stored_object_verdict_write_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('hg.rescan_reason', true), '') = '' THEN
    RAISE EXCEPTION
      'stored_object_verdict_write_once: the virus scan verdict of % is already %; change it only through a recorded re-scan',
      NEW.id, OLD.virus_scan_state
      USING ERRCODE = 'check_violation', CONSTRAINT = 'stored_object_verdict_write_once';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER stored_object_verdict_write_once
  BEFORE UPDATE OF virus_scan_state ON stored_object
  FOR EACH ROW
  WHEN (OLD.virus_scan_state <> 'PENDING' AND NEW.virus_scan_state IS DISTINCT FROM OLD.virus_scan_state)
  EXECUTE FUNCTION stored_object_verdict_write_once();

-- Approval is checked continuously, not once: when a CLEAN file stops being
-- CLEAN (a re-scan found something, or the bytes no longer match), every
-- APPROVED document on it goes back to IN_REVIEW on the 72-hour review clock,
-- with an audit row each, and ops is told on the ops_alert channel.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION stored_object_scan_regressed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  reopened int;
BEGIN
  WITH r AS (
    UPDATE kyc_document
       SET state = 'IN_REVIEW', reviewed_by = NULL, reviewed_at = NULL,
           deadline_at = now() + interval '72 hours', deadline_action = 'ESCALATE'
     WHERE stored_object_id = NEW.id AND state = 'APPROVED' AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO audit_event
    (actor_kind, action, subject_type, subject_id, outcome, reason_code, reason,
     day, seq, prev_hash, hash)
  SELECT 'SYSTEM', 'kyc_document.reopen_virus_scan', 'KYC_DOCUMENT', r.id, 'SUCCESS',
         NEW.virus_scan_state, NEW.virus_scan_detail,
         current_date, 0, '\x00'::bytea, '\x00'::bytea
    FROM r;
  GET DIAGNOSTICS reopened = ROW_COUNT;

  PERFORM pg_notify('ops_alert', json_build_object(
    'kind', 'virus_scan_regressed',
    'stored_object_id', NEW.id,
    'virus_scan_state', NEW.virus_scan_state,
    'detail', NEW.virus_scan_detail,
    'documents_reopened', reopened)::text);
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER stored_object_scan_regressed
  AFTER UPDATE OF virus_scan_state ON stored_object
  FOR EACH ROW
  WHEN (OLD.virus_scan_state = 'CLEAN' AND NEW.virus_scan_state <> 'CLEAN')
  EXECUTE FUNCTION stored_object_scan_regressed();

-- +goose Down

DROP TRIGGER IF EXISTS stored_object_scan_regressed ON stored_object;
DROP FUNCTION IF EXISTS stored_object_scan_regressed();
DROP TRIGGER IF EXISTS stored_object_verdict_write_once ON stored_object;
DROP FUNCTION IF EXISTS stored_object_verdict_write_once();
DROP TRIGGER IF EXISTS kyc_document_virus_scan_clean ON kyc_document;
DROP FUNCTION IF EXISTS kyc_document_assert_scanned();
DROP INDEX IF EXISTS stored_object_scan_queue;
UPDATE stored_object SET virus_scan_state = 'ERROR' WHERE virus_scan_state IN ('TOO_LARGE', 'UNSCANNABLE');
ALTER TABLE stored_object
  DROP COLUMN IF EXISTS virus_scan_next_at,
  DROP COLUMN IF EXISTS virus_scan_attempts,
  DROP COLUMN IF EXISTS virus_scanned_at,
  DROP COLUMN IF EXISTS virus_scan_detail,
  DROP CONSTRAINT stored_object_virus_scan_state_check,
  ADD CONSTRAINT stored_object_virus_scan_state_check
    CHECK (virus_scan_state IN ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR'));
