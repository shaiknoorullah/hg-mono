-- "Can the platform vouch for this restaurant's halal certificate right now?",
-- answered from admin-verified certificate data only, as one function that the
-- order path and the halal expiry job can share.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/292
--
-- restaurant.halal_status is derived by the certificate trigger (00009) when a
-- certificate row is written, so it goes stale as dates pass: a certificate
-- that expired overnight still reads CERTIFIED until something derives it
-- again (https://github.com/shaiknoorullah/hg-mono/issues/252). The order path
-- does not wait for that. It calls halal_certification_at(restaurant, now())
-- in the same transaction that adds a cart line, prices a quote or creates the
-- order (internal/orders/orderable.go), and refuses with RESTAURANT_UNAVAILABLE
-- unless the answer is CERTIFIED or EXPIRING_SOON.
--
-- One definition of "certified now". The derivation below is the one the halal
-- expiry job introduces inside halal_refresh_restaurant_status in
-- https://github.com/shaiknoorullah/hg-mono/pull/274: the same certificate is
-- chosen and the same date rule applied, in the restaurant's own timezone.
-- halal_local_date is that pull request's function, unchanged. When it lands it
-- can call halal_certification_at instead of carrying its own copy of the
-- selection and the CASE, and drop its own halal_local_date.
--
-- Fail closed: a missing halal field renders no badge, never an optimistic one
-- (https://github.com/shaiknoorullah/hg-mono/blob/main/AGENTS.md#3-non-negotiable-invariants).
--
--   * a NULL restaurant or instant, or a restaurant that does not exist, gives
--     NULL for both columns, and every caller reads NULL as "cannot vouch";
--   * only what an admin verified counts: a certificate APPROVED (or later
--     moved to EXPIRED) with verified_by and verified_at set, from an ACCEPTED
--     issuing body, not deleted. A PENDING upload, the uploaded document's own
--     dates, or anything a request carries never does;
--   * only an APPROVED certificate whose last valid day has not passed gives
--     CERTIFIED or EXPIRING_SOON. Any other answer, a NULL comparison included,
--     falls through to EXPIRED;
--   * an unknown timezone takes the latest date anywhere, so a certificate is
--     never treated as valid for longer than it is somewhere on Earth.
--
-- Nothing here writes, and nothing is SECURITY DEFINER: both functions run with
-- the caller's rights.

-- +goose Up

-- The calendar date at an instant in a restaurant's timezone. An unknown or
-- NULL timezone does not fail open: it takes the date in the zone furthest
-- ahead of UTC (UTC+14), the latest date anywhere, so a certificate is never
-- treated as valid for longer than it is somewhere on Earth.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_local_date(p_tz text, p_at timestamptz)
RETURNS date LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_at IS NULL THEN
    RAISE EXCEPTION 'halal_local_date: the instant is NULL' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF p_tz IS NOT NULL THEN
    BEGIN
      RETURN (p_at AT TIME ZONE p_tz)::date;
    EXCEPTION WHEN invalid_parameter_value THEN
      RAISE WARNING 'halal_local_date: unknown time zone %; using UTC+14', p_tz;
    END;
  END IF;
  RETURN ((p_at AT TIME ZONE 'UTC') + interval '14 hours')::date;
END
$$;
-- +goose StatementEnd

-- The restaurant's certificate and its halal display state as of p_at. STRICT:
-- a NULL argument returns NULL without running the body.
--
-- search_path is pinned so a temporary table named like one of these tables
-- cannot stand in for the real one when the order path asks.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_certification_at(
  p_restaurant_id uuid,
  p_at timestamptz,
  OUT certificate_id uuid,
  OUT halal_status halal_display_state
) LANGUAGE plpgsql STABLE STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz       text;
  v_today    date;
  c          record;
  last_valid date;
BEGIN
  SELECT r.timezone INTO v_tz FROM restaurant r WHERE r.id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN;  -- no such restaurant: both NULL
  END IF;
  v_today := halal_local_date(v_tz, p_at);

  -- The restaurant's certificate: an APPROVED one wins over an EXPIRED one, and
  -- the later expiry wins within each. Only ACCEPTED issuing bodies count, and
  -- only certificates an admin verified.
  SELECT hc.id, hc.status, hc.expires_on, hc.grace_until
    INTO c
    FROM halal_certificate hc
    JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
   WHERE hc.restaurant_id = p_restaurant_id
     AND hc.status IN ('APPROVED', 'EXPIRED')
     AND hc.verified_by IS NOT NULL
     AND hc.verified_at IS NOT NULL
     AND hc.expires_on IS NOT NULL
     AND b.status = 'ACCEPTED'
     AND hc.deleted_at IS NULL
   ORDER BY (hc.status = 'APPROVED') DESC, hc.expires_on DESC, hc.id DESC
   LIMIT 1;

  IF NOT FOUND THEN
    halal_status := 'UNVERIFIED';
    RETURN;
  END IF;

  -- Valid through the whole of its last day (expires_on, or grace_until when a
  -- super admin granted one), in the restaurant's timezone; expired from 00:00
  -- local the day after. Amber "expiring soon" from 30 days out.
  certificate_id := c.id;
  last_valid := COALESCE(c.grace_until, c.expires_on);
  halal_status := CASE
    WHEN c.status = 'APPROVED' AND last_valid >= v_today AND c.expires_on > v_today + 30
      THEN 'CERTIFIED'::halal_display_state
    WHEN c.status = 'APPROVED' AND last_valid >= v_today
      THEN 'EXPIRING_SOON'::halal_display_state
    ELSE 'EXPIRED'::halal_display_state
  END;
END
$$;
-- +goose StatementEnd

GRANT EXECUTE ON FUNCTION halal_local_date(text, timestamptz) TO hg_app;
GRANT EXECUTE ON FUNCTION halal_certification_at(uuid, timestamptz) TO hg_app;

-- +goose Down
DROP FUNCTION IF EXISTS halal_certification_at(uuid, timestamptz);
DROP FUNCTION IF EXISTS halal_local_date(text, timestamptz);
