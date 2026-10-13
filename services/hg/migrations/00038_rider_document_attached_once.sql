-- A rider's uploaded file is attached once per document type.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/229
--
-- POST /v1/riders/me/documents (attachRiderDocument) looked for an existing
-- row for the file and then inserted one, in two statements with nothing
-- holding them together. Two requests for the same file at the same time both
-- found nothing and both inserted: two kyc_document rows, and two review-queue
-- items, for one upload.
--
-- The rule is about the file. One uploaded file is one submission, so it backs
-- at most one live row per rider and document type. internal/rider
-- Repo.AttachDocument inserts with ON CONFLICT on this index and returns the
-- existing row, so attaching a file again, or twice at once, is the same
-- attach. Soft-deleted rows are not counted.
--
-- A different file of the same type is a new upload and still gets its own
-- row. Superseding the previous upload of that type is the re-upload rule in
-- docs/spec/04-rider.md "D-05 — Document upload", and is its own change:
-- https://github.com/shaiknoorullah/hg-mono/issues/358

-- +goose Up

-- A database that ran the race before this migration has duplicate rows. Keep
-- one row per file, preferring one a reviewer has decided and then the oldest,
-- and soft-delete the copies so the index can be built. No row is removed.
UPDATE kyc_document d
   SET deleted_at = now()
  FROM (SELECT id,
               row_number() OVER (PARTITION BY subject_id, rider_doc_type, stored_object_id
                                  ORDER BY reviewed_at IS NULL, created_at, id) AS n
          FROM kyc_document
         WHERE subject_type = 'RIDER' AND deleted_at IS NULL) dup
 WHERE d.id = dup.id AND dup.n > 1;

CREATE UNIQUE INDEX kyc_document_rider_file_once
  ON kyc_document (subject_id, rider_doc_type, stored_object_id)
  WHERE subject_type = 'RIDER' AND deleted_at IS NULL;

-- +goose Down

DROP INDEX IF EXISTS kyc_document_rider_file_once;
