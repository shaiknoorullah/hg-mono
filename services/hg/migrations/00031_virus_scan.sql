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
--   * TOO_LARGE and UNSCANNABLE are new: a file over a scan limit (oversized),
--     or with encrypted content, was never fully read by the scanner, so it is
--     flagged, never passed.
--   * An object the store cannot serve is retried with backoff
--     (virus_scan_attempts, virus_scan_next_at) so it cannot block the queue,
--     and is marked ERROR after repeated failures.
--   * A verdict is bound to the bytes it is about. The worker records the
--     SHA-256 of the bytes it read (virus_scan_sha256) and the object's
--     content_version when it read them (virus_scan_version), and a CLEAN
--     verdict must match the object's current sha256 and content_version
--     (CHECK stored_object_clean_is_bound).
--   * content_version counts the object's contents. Any new upload or
--     overwrite moves it on: a change of bucket, key, type, size or SHA-256,
--     or internal/files bumping it after finding different bytes at the key.
--     Either way the verdict goes back to PENDING and its binding is cleared
--     (trigger stored_object_content_changed), so the file is scanned again.
--   * virus_scan_passed(stored_object) is the one test of "this file may back
--     an approval": CLEAN and bound to the current hash and version. Every
--     other state fails it: PENDING, ERROR, TOO_LARGE, UNSCANNABLE, INFECTED,
--     SKIPPED, and NULL. Unknown verdicts cannot be stored at all (CHECK
--     stored_object_virus_scan_state_check), and the column is NOT NULL.
--   * The database refuses to APPROVE a KYC document whose file does not pass
--     (trigger kyc_document_virus_scan_clean). It locks the file's row first,
--     so a verdict change cannot slip in between the check and the commit. The
--     admin handler checks first and answers 409; the trigger is what makes the
--     bug unrepresentable for every other writer.
--   * Approval keeps being checked after it is given. When a file stops passing
--     (a re-scan, a new verdict, new bytes), every APPROVED document on it goes
--     back to IN_REVIEW on the 72-hour review clock, each with an audit row,
--     and ops is told on the ops_alert channel (trigger
--     stored_object_scan_regressed). Pointing an APPROVED document at another
--     file sends it back to review too: the reviewer approved other bytes.
--   * A verdict is written once. Changing it again needs the transaction-local
--     setting hg.rescan_reason, which only internal/files sets, alongside the
--     audit row that names who and why. The one exception is the reset to
--     PENDING that new content causes: it can only close, never open.

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
  ADD COLUMN virus_scan_next_at  timestamptz,
  -- Which contents the row describes: moves on with every new upload or
  -- overwrite (trigger stored_object_content_changed below).
  ADD COLUMN content_version     int NOT NULL DEFAULT 1 CHECK (content_version >= 1),
  -- What the verdict is about: the SHA-256 of the bytes the scanner read, and
  -- the content_version they were read at.
  ADD COLUMN virus_scan_sha256   bytea,
  ADD COLUMN virus_scan_version  int;

-- Nothing scanned anything before this migration, so no recorded CLEAN says
-- which bytes it was about. Start each one over.
UPDATE stored_object SET virus_scan_state = 'PENDING' WHERE virus_scan_state = 'CLEAN';

-- A CLEAN verdict is about the object's current bytes, or it is not CLEAN.
ALTER TABLE stored_object
  ADD CONSTRAINT stored_object_clean_is_bound CHECK (
    virus_scan_state <> 'CLEAN'
    OR (virus_scan_sha256 IS NOT NULL AND virus_scan_version IS NOT NULL
        AND virus_scan_sha256 = sha256 AND virus_scan_version = content_version));

-- The scan queue: confirmed objects still waiting for a verdict, ready ones first.
CREATE INDEX stored_object_scan_queue ON stored_object (virus_scan_next_at NULLS FIRST, confirmed_at)
  WHERE state = 'READY' AND virus_scan_state = 'PENDING' AND deleted_at IS NULL;

-- Revoking approvals finds the documents on a file by its id.
CREATE INDEX kyc_document_stored_object ON kyc_document (stored_object_id);

-- The one definition of "this file may back an approval". NULL anywhere is
-- false, never true: the check fails closed.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION virus_scan_passed(o stored_object) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(o.virus_scan_state = 'CLEAN'
                  AND o.virus_scan_sha256 = o.sha256
                  AND o.virus_scan_version = o.content_version, false)
$$;
-- +goose StatementEnd

-- Sends every APPROVED document on a file back to IN_REVIEW on the 72-hour
-- review clock, each with an audit row, and returns how many it reopened.
--
-- It locks every document on the file first, whatever its state. Under READ
-- COMMITTED, which the API uses, that is only a cost. Under REPEATABLE READ or
-- SERIALIZABLE it is what keeps a verdict change from missing an approval that
-- committed after the transaction's snapshot: locking a row changed since the
-- snapshot fails with a serialization error, so the change rolls back rather
-- than leaving the document approved.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION kyc_document_reopen_on_file(p_object uuid, p_code text, p_reason text)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  reopened int;
BEGIN
  PERFORM 1 FROM kyc_document WHERE stored_object_id = p_object FOR UPDATE;
  WITH r AS (
    UPDATE kyc_document
       SET state = 'IN_REVIEW', reviewed_by = NULL, reviewed_at = NULL,
           deadline_at = now() + interval '72 hours', deadline_action = 'ESCALATE'
     WHERE stored_object_id = p_object AND state = 'APPROVED' AND deleted_at IS NULL
    RETURNING id
  )
  INSERT INTO audit_event
    (actor_kind, action, subject_type, subject_id, outcome, reason_code, reason,
     day, seq, prev_hash, hash)
  SELECT 'SYSTEM', 'kyc_document.reopen_virus_scan', 'KYC_DOCUMENT', r.id, 'SUCCESS',
         p_code, p_reason, current_date, 0, '\x00'::bytea, '\x00'::bytea
    FROM r;
  GET DIAGNOSTICS reopened = ROW_COUNT;
  RETURN reopened;
END
$$;
-- +goose StatementEnd

-- Approvals made before this migration were made without a scan: they go back
-- to review like any other approval whose file does not pass.
SELECT kyc_document_reopen_on_file(so.id, so.virus_scan_state,
                                   'approved before virus scanning existed (migration 00031_virus_scan)')
  FROM stored_object so
 WHERE NOT virus_scan_passed(so)
   AND EXISTS (SELECT 1 FROM kyc_document kd
                WHERE kd.stored_object_id = so.id AND kd.state = 'APPROVED' AND kd.deleted_at IS NULL);

-- Approval: refused unless the file passes, checked under a lock on the
-- file's row that is held until the approving transaction ends. FOR SHARE is
-- enough: it blocks any verdict or content change to the file until then, and
-- the change, once it runs, sees the approval and revokes it
-- (stored_object_scan_regressed). A change that got there first holds the row,
-- so the approval waits for it and then sees the new verdict.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION kyc_document_assert_scanned() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f stored_object;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'APPROVED' THEN
    -- Still approved, same file: the file has passed since the approval, or
    -- stored_object_scan_regressed would have reopened the document.
    IF OLD.stored_object_id = NEW.stored_object_id THEN
      RETURN NEW;
    END IF;
    -- Pointed at another file: the reviewer approved other bytes.
    NEW.state := 'IN_REVIEW';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.deadline_at := now() + interval '72 hours';
    NEW.deadline_action := 'ESCALATE';
    INSERT INTO audit_event
      (actor_kind, action, subject_type, subject_id, outcome, reason_code, reason,
       day, seq, prev_hash, hash)
    VALUES ('SYSTEM', 'kyc_document.reopen_virus_scan', 'KYC_DOCUMENT', NEW.id, 'SUCCESS',
            'FILE_REPLACED', 'the approved document was pointed at another file',
            current_date, 0, '\x00'::bytea, '\x00'::bytea);
    RETURN NEW;
  END IF;

  SELECT * INTO f FROM stored_object WHERE id = NEW.stored_object_id FOR SHARE;
  IF NOT FOUND OR NOT virus_scan_passed(f) THEN
    RAISE EXCEPTION
      'kyc_document_virus_scan_clean: document % cannot be APPROVED while its file''s virus scan is % (it must be CLEAN and about the file''s current bytes)',
      NEW.id, COALESCE(f.virus_scan_state, 'missing')
      USING ERRCODE = 'check_violation', CONSTRAINT = 'kyc_document_virus_scan_clean';
  END IF;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- No column list: a column-specific trigger does not fire for changes other
-- triggers make, and this check must not depend on how a row got APPROVED.
CREATE TRIGGER kyc_document_virus_scan_clean
  BEFORE INSERT OR UPDATE ON kyc_document
  FOR EACH ROW
  WHEN (NEW.state = 'APPROVED')
  EXECUTE FUNCTION kyc_document_assert_scanned();

-- New contents, new scan. A change to what the row says the object is — its
-- bucket, key, type, size or SHA-256 — or an explicit bump of content_version
-- (internal/files does that when the bytes at the key are not the bytes that
-- were scanned) moves content_version on, sends the verdict back to PENDING and
-- clears its binding. Objects that are never scanned stay SKIPPED.
-- content_version only moves forward, whatever the writer set.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION stored_object_content_changed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_version := greatest(NEW.content_version, OLD.content_version + 1);
  IF OLD.virus_scan_state <> 'SKIPPED' THEN
    NEW.virus_scan_state := 'PENDING';
  END IF;
  NEW.virus_scan_sha256   := NULL;
  NEW.virus_scan_version  := NULL;
  NEW.virus_scan_detail   := NULL;
  NEW.virus_scanned_at    := NULL;
  NEW.virus_scan_attempts := 0;
  NEW.virus_scan_next_at  := NULL;
  RETURN NEW;
END
$$;
-- +goose StatementEnd

-- BEFORE UPDATE triggers fire in name order, so this one runs before
-- stored_object_verdict_write_once sees the row.
CREATE TRIGGER stored_object_content_changed
  BEFORE UPDATE ON stored_object
  FOR EACH ROW
  WHEN ((OLD.bucket, OLD.object_key, OLD.content_type, OLD.byte_size, OLD.sha256, OLD.content_version)
        IS DISTINCT FROM
        (NEW.bucket, NEW.object_key, NEW.content_type, NEW.byte_size, NEW.sha256, NEW.content_version))
  EXECUTE FUNCTION stored_object_content_changed();

-- A verdict is written once: PENDING may become anything, but a recorded
-- verdict changes only inside a transaction that set hg.rescan_reason with
-- set_config(..., true). internal/files does that in the same transaction as
-- the audit row naming the actor and the reason, so an unexplained change to a
-- verdict is not a state the system can reach. New contents resetting it to
-- PENDING (above) needs no reason: that change only ever closes.
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
  WHEN (OLD.virus_scan_state <> 'PENDING'
        AND NEW.virus_scan_state IS DISTINCT FROM OLD.virus_scan_state
        AND NOT (NEW.virus_scan_state = 'PENDING' AND NEW.content_version > OLD.content_version))
  EXECUTE FUNCTION stored_object_verdict_write_once();

-- Approval is checked continuously, not once: when a file stops passing — a
-- re-scan, a new verdict, new contents — every APPROVED document on it goes
-- back to IN_REVIEW on the 72-hour review clock, with an audit row each, and
-- ops is told on the ops_alert channel. No column list, for the same reason as
-- kyc_document_virus_scan_clean: the reset above changes the verdict without
-- naming it in the UPDATE.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION stored_object_scan_regressed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  code     text := NEW.virus_scan_state;
  reopened int;
BEGIN
  IF NEW.content_version <> OLD.content_version THEN
    code := 'CONTENT_CHANGED';
  END IF;
  reopened := kyc_document_reopen_on_file(NEW.id, code, NEW.virus_scan_detail);

  PERFORM pg_notify('ops_alert', json_build_object(
    'kind', 'virus_scan_regressed',
    'stored_object_id', NEW.id,
    'virus_scan_state', NEW.virus_scan_state,
    'reason', code,
    'detail', NEW.virus_scan_detail,
    'documents_reopened', reopened)::text);
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER stored_object_scan_regressed
  AFTER UPDATE ON stored_object
  FOR EACH ROW
  WHEN (virus_scan_passed(OLD) AND NOT virus_scan_passed(NEW))
  EXECUTE FUNCTION stored_object_scan_regressed();

-- +goose Down

DROP TRIGGER IF EXISTS stored_object_scan_regressed ON stored_object;
DROP FUNCTION IF EXISTS stored_object_scan_regressed();
DROP TRIGGER IF EXISTS stored_object_verdict_write_once ON stored_object;
DROP FUNCTION IF EXISTS stored_object_verdict_write_once();
DROP TRIGGER IF EXISTS stored_object_content_changed ON stored_object;
DROP FUNCTION IF EXISTS stored_object_content_changed();
DROP TRIGGER IF EXISTS kyc_document_virus_scan_clean ON kyc_document;
DROP FUNCTION IF EXISTS kyc_document_assert_scanned();
DROP FUNCTION IF EXISTS kyc_document_reopen_on_file(uuid, text, text);
DROP FUNCTION IF EXISTS virus_scan_passed(stored_object);
DROP INDEX IF EXISTS kyc_document_stored_object;
DROP INDEX IF EXISTS stored_object_scan_queue;
UPDATE stored_object SET virus_scan_state = 'ERROR' WHERE virus_scan_state IN ('TOO_LARGE', 'UNSCANNABLE');
ALTER TABLE stored_object
  DROP CONSTRAINT IF EXISTS stored_object_clean_is_bound,
  DROP COLUMN IF EXISTS virus_scan_version,
  DROP COLUMN IF EXISTS virus_scan_sha256,
  DROP COLUMN IF EXISTS content_version,
  DROP COLUMN IF EXISTS virus_scan_next_at,
  DROP COLUMN IF EXISTS virus_scan_attempts,
  DROP COLUMN IF EXISTS virus_scanned_at,
  DROP COLUMN IF EXISTS virus_scan_detail,
  DROP CONSTRAINT stored_object_virus_scan_state_check,
  ADD CONSTRAINT stored_object_virus_scan_state_check
    CHECK (virus_scan_state IN ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR'));
