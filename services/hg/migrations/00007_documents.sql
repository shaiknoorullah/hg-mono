-- P-27..P-29 — MinIO objects and KYC documents.
--
-- Clients never choose a bucket, a key or a filename. `stored_object` is the
-- server's record of what it allocated; nothing may be attached to a document
-- or a menu item until confirm() has verified size, content type and SHA-256
-- server-side.

-- +goose Up

CREATE TABLE stored_object (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  bucket           text NOT NULL,
  object_key       text NOT NULL,
  purpose          stored_object_purpose NOT NULL,
  owner_account_id uuid REFERENCES account(id),
  restaurant_id    uuid,                            -- FK added in 00008
  order_id         uuid,                            -- FK added in 00013
  content_type     text NOT NULL,
  byte_size        bigint NOT NULL CHECK (byte_size > 0),
  sha256           bytea NOT NULL,
  state            stored_object_state NOT NULL DEFAULT 'PENDING',
  reject_reason    text,
  virus_scan_state text NOT NULL DEFAULT 'PENDING'
                   CHECK (virus_scan_state IN ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED', 'ERROR')),
  uploaded_by      uuid NOT NULL REFERENCES account(id),
  confirmed_at     timestamptz,
  retention_until  timestamptz,
  -- G-5: an unconfirmed upload is deadline-governed; the runner deletes it at 1 h.
  deadline_at      timestamptz,
  deadline_action  text,
  deadline_escalations int NOT NULL DEFAULT 0,
  lease_until      timestamptz,
  lease_owner      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT stored_object_deadline_required CHECK (
    (state IN ('READY', 'REJECTED', 'DELETED') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state = 'PENDING' AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  ),
  CONSTRAINT stored_object_ready_is_verified CHECK (state <> 'READY' OR confirmed_at IS NOT NULL)
);
SELECT attach_updated_at('stored_object');
CREATE UNIQUE INDEX stored_object_key ON stored_object (bucket, object_key);
CREATE INDEX stored_object_due ON stored_object (deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX stored_object_owner ON stored_object (owner_account_id, purpose);

CREATE TABLE kyc_document (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  subject_type            kyc_subject_type NOT NULL,
  subject_id              uuid NOT NULL,             -- restaurant_id or rider account_id
  restaurant_doc_type     restaurant_doc_type,
  rider_doc_type          rider_doc_type,
  stored_object_id        uuid NOT NULL REFERENCES stored_object(id),
  state                   kyc_document_state NOT NULL DEFAULT 'SUBMITTED',
  version                 int NOT NULL DEFAULT 1,
  supersedes_id           uuid REFERENCES kyc_document(id),
  -- Transcribed fields (halal certificates carry the structured detail in
  -- halal_certificate; these mirror the generic document header).
  issuer                  text,
  halal_issuing_body_id   uuid,                      -- FK added in 00009
  certificate_number      text,
  issued_on               date,
  valid_until             date,
  reviewed_by             uuid REFERENCES account(id),
  reviewed_at             timestamptz,
  rejection_reason_code   document_rejection_reason_code,
  review_note             text,
  -- 72-hour review SLA (P-29) carried as a deadline, not as a cron hope.
  deadline_at             timestamptz,
  deadline_action         text,
  deadline_escalations    int NOT NULL DEFAULT 0,
  lease_until             timestamptz,
  lease_owner             text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  -- exactly one of the two doc-type columns, matching subject_type
  CONSTRAINT kyc_document_type_shape CHECK (
    (subject_type = 'RESTAURANT' AND restaurant_doc_type IS NOT NULL AND rider_doc_type IS NULL) OR
    (subject_type = 'RIDER'      AND rider_doc_type IS NOT NULL AND restaurant_doc_type IS NULL)
  ),
  -- I-29.2: a decision is always attributable to a real reviewer account.
  CONSTRAINT kyc_document_decision_attributed CHECK (
    state NOT IN ('APPROVED', 'REJECTED') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT kyc_document_rejection_has_reason CHECK (
    state <> 'REJECTED' OR rejection_reason_code IS NOT NULL
  ),
  CONSTRAINT kyc_document_dates CHECK (valid_until IS NULL OR issued_on IS NULL OR valid_until >= issued_on),
  -- G-5: under review means on the clock.
  CONSTRAINT kyc_document_deadline_required CHECK (
    (state IN ('APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED') AND deadline_at IS NULL AND deadline_action IS NULL)
    OR
    (state IN ('SUBMITTED', 'IN_REVIEW') AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  )
);
SELECT attach_updated_at('kyc_document');
CREATE INDEX kyc_document_subject ON kyc_document (subject_type, subject_id);
CREATE INDEX kyc_document_queue ON kyc_document (state, deadline_at) WHERE state IN ('SUBMITTED', 'IN_REVIEW');
CREATE INDEX kyc_document_due ON kyc_document (deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX kyc_document_expiry ON kyc_document (valid_until) WHERE state = 'APPROVED' AND valid_until IS NOT NULL;

ALTER TABLE customer_profile
  ADD CONSTRAINT customer_profile_avatar_fk
  FOREIGN KEY (avatar_object_id) REFERENCES stored_object(id);

-- PIPEDA access / deletion requests (P-29).
CREATE TABLE privacy_request (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id       uuid NOT NULL REFERENCES account(id),
  kind             text NOT NULL CHECK (kind IN ('ACCESS', 'DELETION', 'CORRECTION')),
  state            text NOT NULL DEFAULT 'REQUESTED'
                   CHECK (state IN ('REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED')),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  export_object_id uuid REFERENCES stored_object(id),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT attach_updated_at('privacy_request');

-- +goose Down
DROP TABLE IF EXISTS privacy_request;
ALTER TABLE customer_profile DROP CONSTRAINT IF EXISTS customer_profile_avatar_fk;
DROP TABLE IF EXISTS kyc_document;
DROP TABLE IF EXISTS stored_object;
