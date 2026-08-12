-- Tax jurisdictions and the launch rate table.
--
-- Every Canadian province exists as a jurisdiction so the engine is
-- table-driven from day one, but ONLY Ontario carries effective rates. That is
-- deliberate: I-11.4 says a quote for a province with no effective rate must
-- fail loudly with tax_profile_missing rather than default to zero tax, so
-- seeding the other provinces would silently open them for business before
-- their receipts have been verified (decision O-05, default Ontario only).
--
-- The remaining provinces' rates are recorded in 01-platform.md P-11 and are
-- one INSERT away when a launch decision is made.
--
-- Idempotent: safe to re-run.

INSERT INTO tax_jurisdiction (code, country, province, display_name) VALUES
  ('CA-AB', 'CA', 'AB', 'Alberta'),
  ('CA-BC', 'CA', 'BC', 'British Columbia'),
  ('CA-MB', 'CA', 'MB', 'Manitoba'),
  ('CA-NB', 'CA', 'NB', 'New Brunswick'),
  ('CA-NL', 'CA', 'NL', 'Newfoundland and Labrador'),
  ('CA-NS', 'CA', 'NS', 'Nova Scotia'),
  ('CA-NT', 'CA', 'NT', 'Northwest Territories'),
  ('CA-NU', 'CA', 'NU', 'Nunavut'),
  ('CA-ON', 'CA', 'ON', 'Ontario'),
  ('CA-PE', 'CA', 'PE', 'Prince Edward Island'),
  ('CA-QC', 'CA', 'QC', 'Quebec'),
  ('CA-SK', 'CA', 'SK', 'Saskatchewan'),
  ('CA-YT', 'CA', 'YT', 'Yukon')
ON CONFLICT (code) DO NOTHING;

-- Ontario, effective 2026-08-10 (the launch epoch used throughout the specs).
--
-- HST 13% applies to prepared food, to the delivery fee (it is part of the
-- supply of a taxable good), to the service fee, and to the platform's
-- commission to the restaurant. Basic groceries are zero-rated.
--
-- HST_FEDERAL_PART at 5% is the Ontario point-of-sale rebate path: qualifying
-- prepared food and beverages sold for <= $4.00 are taxed at the 5% federal
-- part with the 8% provincial part rebated at point of sale. Both rows exist so
-- the remittance report can reconstruct the rebate claim rather than inferring
-- it (P-11).
INSERT INTO tax_rate (jurisdiction_code, tax_kind, tax_category, rate, effective_from, statutory_label, notes) VALUES
  ('CA-ON', 'HST', 'PREPARED_FOOD',       0.13000000, DATE '2026-08-10', 'HST',
   'Ontario HST 13% on prepared food and beverages.'),
  ('CA-ON', 'HST', 'DELIVERY',            0.13000000, DATE '2026-08-10', 'HST',
   'Delivery is taxable at the rate of the supply it delivers.'),
  ('CA-ON', 'HST', 'SERVICE_FEE',         0.13000000, DATE '2026-08-10', 'HST',
   'Service fee is a taxable supply of services to the customer.'),
  ('CA-ON', 'HST', 'COMMISSION',          0.13000000, DATE '2026-08-10', 'HST',
   'Commission is a taxable supply of services by the platform to the restaurant; '
   'invoiced separately and never part of the customer total.'),
  ('CA-ON', 'HST', 'ZERO_RATED_GROCERY',  0.00000000, DATE '2026-08-10', 'HST',
   'Basic groceries are zero-rated.'),
  ('CA-ON', 'HST_FEDERAL_PART', 'PREPARED_FOOD', 0.05000000, DATE '2026-08-10', 'HST',
   'Ontario point-of-sale rebate: qualifying prepared food and beverages sold for '
   '<= $4.00 are taxed at the 5% federal part, the 8% provincial part rebated.')
ON CONFLICT (jurisdiction_code, tax_kind, tax_category, effective_from) DO NOTHING;
