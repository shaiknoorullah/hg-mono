-- A restaurant's uploaded file is attached once per document type.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/360
--
-- POST /v1/restaurant/documents (attachRestaurantDocument) inserted a
-- kyc_document row on every call and never looked for the same file. A retry
-- with a new idempotency key, or two requests at once, made two review-queue
-- items for one upload. For a halal certificate each repeat also wrote a new
-- halal_certificate and marked the one before it SUPERSEDED, so the
-- certificate history showed two submissions of one file.
--
-- The rule is about the file: one uploaded file backs at most one live row per
-- restaurant and document type. internal/restaurant Repo.AttachDocument inserts
-- with ON CONFLICT on this index and returns the existing row, writing nothing
-- else, so attaching a file again, or twice at once, is the same attach.
-- Soft-deleted rows are not counted. This is the restaurant twin of the rider
-- rule (https://github.com/shaiknoorullah/hg-mono/issues/229).

-- +goose Up

-- A database that ran the race before this migration has duplicate rows. Keep
-- one row per file, preferring one a reviewer has decided and then the oldest,
-- and soft-delete the copies so the index can be built. No row is removed.
--
-- A halal certificate written by a copy keeps its history and its status, and
-- now names the kept row: it is the same file, and a certificate must not point
-- at a document nobody can open.
WITH copy AS (
  SELECT id, kept_id
    FROM (SELECT id,
                 first_value(id) OVER (PARTITION BY subject_id, restaurant_doc_type, stored_object_id
                                       ORDER BY reviewed_at IS NULL, created_at, id) AS kept_id
            FROM kyc_document
           WHERE subject_type = 'RESTAURANT' AND deleted_at IS NULL) d
   WHERE id <> kept_id
), repointed AS (
  UPDATE halal_certificate hc
     SET document_id = copy.kept_id
    FROM copy
   WHERE hc.document_id = copy.id
  RETURNING hc.id
)
UPDATE kyc_document d
   SET deleted_at = now()
  FROM copy
 WHERE d.id = copy.id;

CREATE UNIQUE INDEX kyc_document_restaurant_file_once
  ON kyc_document (subject_id, restaurant_doc_type, stored_object_id)
  WHERE subject_type = 'RESTAURANT' AND deleted_at IS NULL;

-- +goose Down

DROP INDEX IF EXISTS kyc_document_restaurant_file_once;
