-- The waitlist table. Already applied to the marketing database:
--
--   Neon project  halalgoes-marketing  (frosty-scene-41439298)
--   Region        aws-us-east-1        — same region as the Vercel deploy;
--                                        the analytics project is in Singapore
--                                        and a cross-Pacific hop on every form
--                                        submit is not a thing to accept.
--   Database      halalgoes            branch main
--
-- Kept in its own project, deliberately. The old site's Payload CMS database
-- holds the current halalgoes.com; the Umami database is Prisma-managed and
-- exists for analytics. A consent record has a different retention obligation
-- and a different access policy from either, and it should not be lost the day
-- one of those is decommissioned.
--
-- Re-run it anywhere with: psql "$DATABASE_URL" -f this-file
--
-- Three columns here are not optional and not decoration. CASL asks what the
-- person agreed to, not merely that they agreed: the exact sentence, the moment
-- they agreed to it, and which audience they were signing up as. A row that
-- keeps only an email address throws away the defence the record exists to
-- provide, which is why `consent_text` and `consented_at` are NOT NULL.

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 'customer' | 'restaurant' | 'rider'. Constrained rather than free text:
  -- the server action already refuses a track that drifts, and the database
  -- should not be the place a fourth audience quietly appears.
  audience     text        NOT NULL CHECK (audience IN ('customer', 'restaurant', 'rider')),

  -- Lower-cased email while O-03 is open. `kind` is carried so a phone signup
  -- needs no migration on the day SMS opens.
  contact      text        NOT NULL,
  kind         text        NOT NULL CHECK (kind IN ('email', 'tel')),

  consent_text text        NOT NULL,
  consented_at timestamptz NOT NULL,

  -- Which form on which page: hero | final | footer | sticky.
  context      text        NOT NULL,

  -- Session-scoped campaign parameters; {} for a direct visit.
  utm          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One consent per person per track. Somebody may legitimately be both a
-- customer and a restaurant, so the pair is the key rather than the address.
--
-- The insert does ON CONFLICT DO NOTHING, so pressing the button twice is a
-- silent success rather than a duplicate. It deliberately does NOT refresh
-- `consented_at`: the record we want to keep is the FIRST consent, and
-- overwriting it would quietly destroy the evidence.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_audience_contact_key
  ON waitlist_signups (audience, contact);

-- The only query anyone runs at launch: "who is waiting, in which city, by
-- track". Ordering is by arrival.
CREATE INDEX IF NOT EXISTS waitlist_signups_created_at_idx
  ON waitlist_signups (created_at DESC);
