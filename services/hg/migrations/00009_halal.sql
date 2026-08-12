-- A-15 / A-16 / P-34 — the product itself.
--
-- A halal certificate is not a document with a yes/no toggle. It is a
-- first-class entity with admin-transcribed structured fields and a closed
-- seven-check verification list. Approval requires all seven PASS. Nothing is
-- OCR'd, inferred or auto-approved: R-05 in the decision log says silence must
-- never become consent on a halal claim.
--
-- restaurant.halal_status is derived by trigger from the certificate state and
-- never written directly (I-34.1).

-- +goose Up

CREATE TABLE halal_issuing_body (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name                        text NOT NULL,
  aliases                     text[] NOT NULL DEFAULT '{}',
  country                     text NOT NULL,
  region                      text,
  website                     text,
  accreditation_ref           text,
  requires_issuer_confirmation boolean NOT NULL DEFAULT false,
  status                      halal_issuing_body_status NOT NULL DEFAULT 'PROPOSED',
  notes                       text,
  proposed_by                 uuid REFERENCES account(id),
  decided_by                  uuid REFERENCES account(id),
  decided_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  deleted_at                  timestamptz
);
SELECT attach_updated_at('halal_issuing_body');
CREATE UNIQUE INDEX halal_issuing_body_name ON halal_issuing_body (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX halal_issuing_body_accepted ON halal_issuing_body (status) WHERE status = 'ACCEPTED';

ALTER TABLE kyc_document
  ADD CONSTRAINT kyc_document_issuing_body_fk
  FOREIGN KEY (halal_issuing_body_id) REFERENCES halal_issuing_body(id);

CREATE TABLE halal_certificate (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  restaurant_id           uuid NOT NULL REFERENCES restaurant(id),
  document_id             uuid NOT NULL REFERENCES kyc_document(id),
  certificate_number      text NOT NULL,
  issuing_body_id         uuid NOT NULL REFERENCES halal_issuing_body(id),
  certified_legal_name    text NOT NULL,
  certified_address       text NOT NULL,
  scope                   halal_certificate_scope NOT NULL,
  issued_on               date NOT NULL,
  expires_on              date NOT NULL,
  status                  halal_certificate_status NOT NULL DEFAULT 'PENDING',
  checklist_version       int NOT NULL,
  verified_by             uuid REFERENCES account(id),
  verified_at             timestamptz,
  rejection_reason_code   halal_rejection_reason_code,
  rejection_reason_text   text,
  revoked_by              uuid REFERENCES account(id),
  revoked_at              timestamptz,
  revocation_reason_code  text,
  superseded_by_id        uuid REFERENCES halal_certificate(id),
  grace_until             date,                      -- A-17, granted once, max 7 days
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT halal_certificate_dates CHECK (expires_on >= issued_on),
  CONSTRAINT halal_certificate_decision_attributed CHECK (
    status NOT IN ('APPROVED', 'REJECTED') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT halal_certificate_rejection_has_reason CHECK (
    status <> 'REJECTED' OR rejection_reason_code IS NOT NULL
  ),
  CONSTRAINT halal_certificate_revocation_attributed CHECK (
    status <> 'REVOKED' OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  )
);
SELECT attach_updated_at('halal_certificate');

-- H7_UNIQUE_NOT_REUSED, as a database fact: one approved certificate number per
-- issuing body across the whole platform.
CREATE UNIQUE INDEX halal_certificate_unique_approved
  ON halal_certificate (issuing_body_id, certificate_number)
  WHERE status = 'APPROVED';
CREATE INDEX halal_certificate_restaurant ON halal_certificate (restaurant_id, status);
CREATE INDEX halal_certificate_expiry ON halal_certificate (expires_on) WHERE status = 'APPROVED';

ALTER TABLE restaurant
  ADD CONSTRAINT restaurant_halal_certificate_fk
  FOREIGN KEY (halal_certificate_id) REFERENCES halal_certificate(id);

-- The seven checks. `computed_result` is what the server calculated; `result`
-- is what the admin recorded. H5 and H7 are not overridable (A-15 R1), which is
-- enforced here as well as in the handler.
CREATE TABLE halal_certificate_check (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  halal_certificate_id  uuid NOT NULL REFERENCES halal_certificate(id) ON DELETE CASCADE,
  check_key             halal_check_key NOT NULL,
  result                halal_check_result NOT NULL DEFAULT 'NOT_ASSESSED',
  computed_result       halal_check_result NOT NULL DEFAULT 'NOT_ASSESSED',
  overridable           boolean NOT NULL,
  note                  text,
  checked_by            uuid REFERENCES account(id),
  checked_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT halal_check_non_overridable_matches_computation CHECK (
    overridable OR result = computed_result
  ),
  CONSTRAINT halal_check_hard_computed_flags CHECK (
    (check_key IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED') AND overridable = false)
    OR check_key NOT IN ('H5_DATES_VALID', 'H7_UNIQUE_NOT_REUSED')
  ),
  CONSTRAINT halal_check_assessed_is_attributed CHECK (
    result = 'NOT_ASSESSED' OR (checked_by IS NOT NULL AND checked_at IS NOT NULL)
  )
);
SELECT attach_updated_at('halal_certificate_check');
CREATE UNIQUE INDEX halal_certificate_check_key
  ON halal_certificate_check (halal_certificate_id, check_key);

-- An APPROVED certificate must carry all seven checks at PASS. Deferred so the
-- checks and the decision may be written in any order inside one transaction,
-- but the transaction cannot commit an approval that is not fully checked.
-- +goose StatementBegin
-- Shared by the certificate table and the check table, which have different row
-- shapes; the trigger argument names the column holding the certificate id.
CREATE OR REPLACE FUNCTION halal_assert_approval_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  cert_id uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  st halal_certificate_status;
  passing int;
BEGIN
  SELECT status INTO st FROM halal_certificate WHERE id = cert_id;
  IF st IS DISTINCT FROM 'APPROVED' THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO passing
    FROM halal_certificate_check
   WHERE halal_certificate_id = cert_id AND result = 'PASS';
  IF passing <> 7 THEN
    RAISE EXCEPTION
      'halal_checklist_incomplete: certificate % is APPROVED with % of 7 checks at PASS', cert_id, passing
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE CONSTRAINT TRIGGER halal_certificate_approval_complete
  AFTER INSERT OR UPDATE ON halal_certificate
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION halal_assert_approval_complete('id');

CREATE CONSTRAINT TRIGGER halal_check_approval_complete
  AFTER INSERT OR UPDATE ON halal_certificate_check
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION halal_assert_approval_complete('halal_certificate_id');

-- restaurant.halal_status is derived, never hand-set (I-34.1). CERTIFIED is
-- impossible without an APPROVED, unexpired certificate from an ACCEPTED body.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_refresh_restaurant_status(p_restaurant_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c record;
BEGIN
  SELECT hc.id, hc.expires_on, hc.grace_until
    INTO c
    FROM halal_certificate hc
    JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
   WHERE hc.restaurant_id = p_restaurant_id
     AND hc.status = 'APPROVED'
     AND b.status = 'ACCEPTED'
     AND hc.deleted_at IS NULL
   ORDER BY hc.expires_on DESC
   LIMIT 1;

  IF NOT FOUND THEN
    UPDATE restaurant
       SET halal_status = 'UNVERIFIED'::halal_display_state, halal_certificate_id = NULL
     WHERE id = p_restaurant_id;
    RETURN;
  END IF;

  UPDATE restaurant
     SET halal_certificate_id = c.id,
         halal_status = (CASE
           WHEN COALESCE(c.grace_until, c.expires_on) < current_date THEN 'EXPIRED'
           WHEN c.expires_on <= current_date + 30                    THEN 'EXPIRING_SOON'
           ELSE 'CERTIFIED'
         END)::halal_display_state
   WHERE id = p_restaurant_id;
END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_certificate_status_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM halal_refresh_restaurant_status(COALESCE(NEW.restaurant_id, OLD.restaurant_id));
  RETURN NULL;
END
$$;
-- +goose StatementEnd

CREATE TRIGGER halal_certificate_sync_restaurant
  AFTER INSERT OR UPDATE OR DELETE ON halal_certificate
  FOR EACH ROW EXECUTE FUNCTION halal_certificate_status_sync();

-- I-34.1's nightly consistency check, as one query that must return zero rows.
CREATE VIEW halal_status_inconsistency AS
  SELECT r.id AS restaurant_id, r.halal_status, r.halal_certificate_id
    FROM restaurant r
   WHERE r.halal_status = 'CERTIFIED'
     AND NOT EXISTS (
       SELECT 1 FROM halal_certificate hc
       JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
        WHERE hc.id = r.halal_certificate_id
          AND hc.status = 'APPROVED'
          AND b.status = 'ACCEPTED'
          AND COALESCE(hc.grace_until, hc.expires_on) >= current_date
     );

-- +goose Down
DROP VIEW IF EXISTS halal_status_inconsistency;
DROP TRIGGER IF EXISTS halal_certificate_sync_restaurant ON halal_certificate;
DROP FUNCTION IF EXISTS halal_certificate_status_sync();
DROP FUNCTION IF EXISTS halal_refresh_restaurant_status(uuid);
DROP TRIGGER IF EXISTS halal_check_approval_complete ON halal_certificate_check;
DROP TRIGGER IF EXISTS halal_certificate_approval_complete ON halal_certificate;
DROP FUNCTION IF EXISTS halal_assert_approval_complete();
DROP TABLE IF EXISTS halal_certificate_check;
ALTER TABLE restaurant DROP CONSTRAINT IF EXISTS restaurant_halal_certificate_fk;
DROP TABLE IF EXISTS halal_certificate;
ALTER TABLE kyc_document DROP CONSTRAINT IF EXISTS kyc_document_issuing_body_fk;
DROP TABLE IF EXISTS halal_issuing_body;
