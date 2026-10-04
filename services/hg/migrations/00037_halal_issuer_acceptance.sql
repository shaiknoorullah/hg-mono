-- A certificate counts only while its issuing body is accepted now.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/346
--
-- Both derivations of a restaurant's halal state count a certificate only when
-- its issuing body has status ACCEPTED: halal_refresh_restaurant_status
-- (00009_halal.sql), which writes the stored restaurant.halal_status, and
-- halal_certification_at (00033_halal_certified_now.sql), which the order path
-- and the catalog read as of now. Neither looks at the body's deleted_at, so a
-- soft-deleted body still marked ACCEPTED would keep vouching for its
-- certificates. Rather than teach every reader a second condition, this makes
-- that row impossible: "status = 'ACCEPTED'" then means "accepted now",
-- everywhere it is written. The registry has no acceptance dates to compare:
-- status, decided_by and decided_at are the whole record of a decision. A body
-- is never deleted, only retired (the issuing-body registry spec,
-- docs/spec/05-admin.md, "A-16 — Halal issuing-body registry", rule 4), so no
-- existing row can break this.
--
-- When a super admin changes a body's status, internal/admin
-- (SetIssuingBodyStatus) re-derives, in the same transaction, the halal state
-- of every restaurant holding a certificate from it, delists the ones the
-- platform can no longer vouch for, and lists them again when the body is
-- accepted again. The index below is how it finds them.

-- +goose Up

ALTER TABLE halal_issuing_body
  ADD CONSTRAINT halal_issuing_body_deleted_not_accepted
  CHECK (deleted_at IS NULL OR status <> 'ACCEPTED');

CREATE INDEX halal_certificate_issuing_body
  ON halal_certificate (issuing_body_id, restaurant_id)
  WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS halal_certificate_issuing_body;
ALTER TABLE halal_issuing_body DROP CONSTRAINT IF EXISTS halal_issuing_body_deleted_not_accepted;
