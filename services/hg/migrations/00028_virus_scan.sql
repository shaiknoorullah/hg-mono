-- Virus scanning of KYC uploads (docs/spec/01-platform.md, P-28 "Presigned
-- upload and download": confirm "enqueues a virus scan for KYC uploads").
--
-- Before this migration confirmUpload set virus_scan_state = 'PENDING' and
-- nothing ever moved it, while the admin review approved documents without
-- looking at it — so an unscanned file could be approved. Now:
--
--   * internal/files.ScanWorker streams each PENDING object to clamd and
--     records CLEAN, INFECTED or TOO_LARGE, with the signature or reason in
--     virus_scan_detail.
--   * TOO_LARGE is new: a file over the scan limit was never fully read by the
--     scanner, so it is flagged, never passed.
--   * The database refuses to APPROVE a KYC document whose file is not CLEAN.
--     The admin handler checks first and answers 409; this trigger is what
--     makes the bug unrepresentable for every other writer.

-- +goose Up

ALTER TABLE stored_object
  DROP CONSTRAINT stored_object_virus_scan_state_check,
  ADD CONSTRAINT stored_object_virus_scan_state_check
    CHECK (virus_scan_state IN ('PENDING', 'CLEAN', 'INFECTED', 'TOO_LARGE', 'SKIPPED', 'ERROR')),
  ADD COLUMN virus_scan_detail text,
  ADD COLUMN virus_scanned_at  timestamptz;

-- The scan queue: confirmed objects still waiting for a verdict.
CREATE INDEX stored_object_scan_queue ON stored_object (confirmed_at)
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

-- +goose Down

DROP TRIGGER IF EXISTS kyc_document_virus_scan_clean ON kyc_document;
DROP FUNCTION IF EXISTS kyc_document_assert_scanned();
DROP INDEX IF EXISTS stored_object_scan_queue;
UPDATE stored_object SET virus_scan_state = 'ERROR' WHERE virus_scan_state = 'TOO_LARGE';
ALTER TABLE stored_object
  DROP COLUMN IF EXISTS virus_scanned_at,
  DROP COLUMN IF EXISTS virus_scan_detail,
  DROP CONSTRAINT stored_object_virus_scan_state_check,
  ADD CONSTRAINT stored_object_virus_scan_state_check
    CHECK (virus_scan_state IN ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR'));
