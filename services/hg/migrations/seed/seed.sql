-- Launch seed. Run after `goose up`:
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/seed.sql
--
-- Every file is idempotent, so this is safe to re-run against an existing
-- database — it inserts what is missing and touches nothing else.

\set ON_ERROR_STOP on
BEGIN;

\ir 001_tax.sql
\ir 002_halal_issuing_bodies.sql
\ir 003_pricing_and_settings.sql
\ir 004_reference_data.sql

COMMIT;

-- A short receipt, so a seed run says what it did.
\echo ''
\echo 'seeded:'
SELECT 'tax_jurisdiction' AS table_name, count(*) FROM tax_jurisdiction
UNION ALL SELECT 'tax_rate (Ontario)', count(*) FROM tax_rate WHERE jurisdiction_code = 'CA-ON'
UNION ALL SELECT 'halal_issuing_body (ACCEPTED)', count(*) FROM halal_issuing_body WHERE status = 'ACCEPTED'
UNION ALL SELECT 'pricing_config', count(*) FROM pricing_config
UNION ALL SELECT 'platform_setting', count(*) FROM platform_setting
UNION ALL SELECT 'platform_setting_version (ACTIVE)', count(*) FROM platform_setting_version WHERE status = 'ACTIVE'
UNION ALL SELECT 'cuisine', count(*) FROM cuisine
ORDER BY 1;
