-- The three accepted halal issuing bodies (decision S-11, formerly O-02).
--
--   HMA Canada · HFSAA · ISNA Canada
--
-- A certificate from ANY ONE of these satisfies check H2_ISSUER_ACCEPTED. The
-- registry is seeded, not closed: a super admin may accept further bodies at
-- runtime, and each addition is audited, because adding a body directly widens
-- what the platform will call halal.
--
-- Until this seed runs, `halal_issuing_bodies_empty` is the launch-day reality
-- the contract fixture describes: no accepted issuer, so H2 fails for every
-- certificate and no restaurant can be certified.
--
-- NOTE: docs/decisions/README.md S-11 cites
-- `contracts/fixtures/halal/halal_issuing_bodies_seed.json` as the source
-- fixture. That file does not exist in the repository — the halal fixture
-- directory has certificate and per-status body fixtures but no seed list. The
-- three names below are taken from the decision log entry itself, which is the
-- authority the fixture would have been generated from.
--
-- Idempotent: safe to re-run.

INSERT INTO halal_issuing_body
  (name, aliases, country, region, website, accreditation_ref,
   requires_issuer_confirmation, status, notes, decided_at)
VALUES
  ('Halal Monitoring Authority (HMA Canada)',
   ARRAY['HMA', 'HMA Canada', 'Halal Monitoring Authority'],
   'CA', 'ON', 'https://hmacanada.org', NULL,
   false, 'ACCEPTED',
   'Accepted per decision S-11. Hand-slaughter (zabihah) monitoring body operating '
   'nationally from Ontario.',
   now()),

  ('Halal Food Standards Alliance of America (HFSAA)',
   ARRAY['HFSAA', 'Halal Food Standards Alliance of America'],
   'US', NULL, 'https://hfsaa.org', NULL,
   false, 'ACCEPTED',
   'Accepted per decision S-11. US-headquartered; certificates issued to Canadian '
   'establishments are accepted.',
   now()),

  ('Islamic Society of North America Canada (ISNA Canada)',
   ARRAY['ISNA', 'ISNA Canada', 'Islamic Society of North America Canada'],
   'CA', 'ON', 'https://isnacanada.com', NULL,
   false, 'ACCEPTED',
   'Accepted per decision S-11.',
   now())
ON CONFLICT DO NOTHING;
