-- The customer address book: amina keeps Home (001_personas.sql, the default)
-- and gains Work, with a unit, a buzzer and delivery instructions, and Cottage,
-- in Ontario but outside every restaurant's delivery range. nour has no
-- address: the empty state. internal/devworld/addresses.go verifies all of it.
-- Not a goose migration. Loaded after 001_personas.sql, in one transaction.
--
-- The address list is newest first, and scenarios order from the first saved
-- address, so Work and Cottage are dated before Home and Home stays first.

BEGIN;

INSERT INTO address (
  id, account_id, label, line1, unit, buzzer, city, province, postal_code,
  location, timezone, delivery_notes, is_default, created_at
) VALUES
  ('c0000000-0000-4000-8000-000000000102', 'a0000000-0000-4000-8000-000000000101',
   'Work', '155 Wellington Street West', '1204', '1204', 'Toronto', 'ON', 'M5V 3H1',
   ST_SetSRID(ST_MakePoint(-79.3866, 43.6457), 4326)::geography, 'America/Toronto',
   'Concierge desk in the lobby. Take the north elevators to the 12th floor.', false,
   now() - interval '30 days'),
  ('c0000000-0000-4000-8000-000000000103', 'a0000000-0000-4000-8000-000000000101',
   'Cottage', '14 Main Street East', NULL, NULL, 'Huntsville', 'ON', 'P1H 2C9',
   ST_SetSRID(ST_MakePoint(-79.2163, 45.3269), 4326)::geography, 'America/Toronto',
   NULL, false,
   now() - interval '60 days')
ON CONFLICT (id) DO NOTHING;

COMMIT;
