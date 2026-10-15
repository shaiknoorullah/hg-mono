-- The halal refresh writes an account's state only through the database's
-- writers.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/253
--
-- 00049's halal_refresh_restaurant_status UPDATEd restaurant.account_state and
-- delist_reasons itself, as its caller. Migration 00045 takes those columns away
-- from the application role (the trigger on halal_certificate runs this as
-- hg_app), so the refresh derives the halal state as before but leaves the
-- listing to account_state_halal_expiry() and account_state_halal_renewal(),
-- which write the state, the history row and the audit row together and follow
-- the same rules (a lapse delists a LIVE restaurant and is recorded on any other;
-- a valid certificate clears the lapse and lists a DELISTED restaurant with no
-- other reason; neither ever suspends, bans or lifts a penalty). Both read the
-- certificate at the same instant the refresh does, and refuse one earlier than
-- five minutes ago.

-- +goose Up
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_refresh_restaurant_status(p_restaurant_id uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r          record;
  c          record;
  today      date;
  last_valid date;
  v_status   halal_display_state;
  v_cert     uuid;
BEGIN
  IF p_restaurant_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'halal_refresh_restaurant_status: restaurant (%) and instant (%) are required',
      p_restaurant_id, p_at USING ERRCODE = 'null_value_not_allowed';
  END IF;
  -- An instant in the past could only ever make a lapsed certificate look
  -- valid again. Five minutes covers clock skew between the API and Postgres.
  IF p_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'halal_refresh_restaurant_status: % is in the past', p_at
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT id, timezone, halal_status, halal_certificate_id
    INTO r
    FROM restaurant
   WHERE id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'halal_refresh_restaurant_status: no restaurant %', p_restaurant_id
      USING ERRCODE = 'no_data_found';
  END IF;
  today := halal_local_date(r.timezone, p_at);

  -- The restaurant's certificate: an APPROVED one wins over an EXPIRED one, and
  -- the later expiry wins within each. Only ACCEPTED issuing bodies count.
  --
  -- Only what an admin verified decides: an APPROVED certificate's fields were
  -- transcribed and checked by staff and are immutable once approved, and an
  -- EXPIRED one was APPROVED first. A PENDING upload's claimed expiry, the
  -- uploaded document's valid_until, or anything from a request never counts.
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
    v_status := 'UNVERIFIED'::halal_display_state;
    v_cert := NULL;
  ELSE
    v_cert := c.id;
    -- Valid through the whole of its last day (expires_on, or grace_until when
    -- a super admin granted one), in the restaurant's timezone; expired from
    -- 00:00 local the day after. Amber "expiring soon" from 30 days out. Only
    -- the two positive branches can give a badge; any other answer, a NULL
    -- comparison included, falls through to EXPIRED.
    last_valid := COALESCE(c.grace_until, c.expires_on);
    v_status := CASE
      WHEN c.status = 'APPROVED' AND last_valid >= today AND c.expires_on > today + 30
        THEN 'CERTIFIED'::halal_display_state
      WHEN c.status = 'APPROVED' AND last_valid >= today
        THEN 'EXPIRING_SOON'::halal_display_state
      ELSE 'EXPIRED'::halal_display_state
    END;
  END IF;

  -- The listing follows the halal state, but only through the database's
  -- writers (00045): hg_app cannot write an account's state or its delisting
  -- reasons itself. A lapse is recorded, and a LIVE restaurant delisted, BEFORE
  -- the halal state turns EXPIRED, so the LIVE-never-EXPIRED check sees a
  -- consistent row; a valid certificate's state is written first and the lapse
  -- cleared (and a DELISTED restaurant with no other reason listed again) after.
  IF v_status = 'EXPIRED' THEN
    PERFORM account_state_halal_expiry(p_restaurant_id, p_at);
  END IF;
  IF (v_status, v_cert) IS DISTINCT FROM (r.halal_status, r.halal_certificate_id) THEN
    UPDATE restaurant
       SET halal_status = v_status,
           halal_certificate_id = v_cert
     WHERE id = p_restaurant_id;
  END IF;
  IF v_status IN ('CERTIFIED', 'EXPIRING_SOON') THEN
    PERFORM account_state_halal_renewal(p_restaurant_id, p_at);
  END IF;
END
$$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_refresh_restaurant_status(p_restaurant_id uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r          record;
  c          record;
  today      date;
  last_valid date;
  v_status   halal_display_state;
  v_cert     uuid;
  v_state    restaurant_account_state;
  v_reasons  text[];
  lapse      constant text := 'HALAL_CERTIFICATE_EXPIRED';
BEGIN
  IF p_restaurant_id IS NULL OR p_at IS NULL THEN
    RAISE EXCEPTION 'halal_refresh_restaurant_status: restaurant (%) and instant (%) are required',
      p_restaurant_id, p_at USING ERRCODE = 'null_value_not_allowed';
  END IF;
  -- An instant in the past could only ever make a lapsed certificate look
  -- valid again. Five minutes covers clock skew between the API and Postgres.
  IF p_at < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'halal_refresh_restaurant_status: % is in the past', p_at
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT id, timezone, halal_status, halal_certificate_id, account_state, delist_reasons,
         onboarding_state = 'ACTIVE' AND location IS NOT NULL AND province IS NOT NULL AS can_go_live
    INTO r
    FROM restaurant
   WHERE id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'halal_refresh_restaurant_status: no restaurant %', p_restaurant_id
      USING ERRCODE = 'no_data_found';
  END IF;
  today := halal_local_date(r.timezone, p_at);

  -- The restaurant's certificate: an APPROVED one wins over an EXPIRED one, and
  -- the later expiry wins within each. Only ACCEPTED issuing bodies count.
  --
  -- Only what an admin verified decides: an APPROVED certificate's fields were
  -- transcribed and checked by staff and are immutable once approved, and an
  -- EXPIRED one was APPROVED first. A PENDING upload's claimed expiry, the
  -- uploaded document's valid_until, or anything from a request never counts.
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
    v_status := 'UNVERIFIED'::halal_display_state;
    v_cert := NULL;
  ELSE
    v_cert := c.id;
    -- Valid through the whole of its last day (expires_on, or grace_until when
    -- a super admin granted one), in the restaurant's timezone; expired from
    -- 00:00 local the day after. Amber "expiring soon" from 30 days out. Only
    -- the two positive branches can give a badge; any other answer, a NULL
    -- comparison included, falls through to EXPIRED.
    last_valid := COALESCE(c.grace_until, c.expires_on);
    v_status := CASE
      WHEN c.status = 'APPROVED' AND last_valid >= today AND c.expires_on > today + 30
        THEN 'CERTIFIED'::halal_display_state
      WHEN c.status = 'APPROVED' AND last_valid >= today
        THEN 'EXPIRING_SOON'::halal_display_state
      ELSE 'EXPIRED'::halal_display_state
    END;
  END IF;

  v_state := r.account_state;
  v_reasons := r.delist_reasons;
  IF v_status = 'EXPIRED' THEN
    IF NOT (lapse = ANY (v_reasons)) THEN
      v_reasons := array_append(v_reasons, lapse);
    END IF;
    IF v_state = 'LIVE' THEN
      v_state := 'DELISTED';
    END IF;
  ELSIF v_status IN ('CERTIFIED', 'EXPIRING_SOON') AND lapse = ANY (v_reasons) THEN
    -- Only a valid certificate clears the lapse. UNVERIFIED (no certificate
    -- left, or its body no longer accepted) clears nothing.
    v_reasons := array_remove(v_reasons, lapse);
    IF v_state = 'DELISTED' AND cardinality(v_reasons) = 0 AND r.can_go_live THEN
      v_state := 'LIVE';
    END IF;
  END IF;

  IF (v_status, v_cert, v_state, v_reasons)
     IS NOT DISTINCT FROM (r.halal_status, r.halal_certificate_id, r.account_state, r.delist_reasons) THEN
    RETURN;
  END IF;

  -- One statement, so the LIVE-never-EXPIRED check below sees the final row.
  UPDATE restaurant
     SET halal_status = v_status,
         halal_certificate_id = v_cert,
         account_state = v_state,
         delist_reasons = v_reasons
   WHERE id = p_restaurant_id;

  IF v_state IS DISTINCT FROM r.account_state THEN
    INSERT INTO audit_event
      (actor_kind, action, subject_type, subject_id, outcome, reason_code, before, after,
       day, seq, prev_hash, hash)
    VALUES
      ('SYSTEM',
       CASE WHEN v_state = 'LIVE' THEN 'restaurant.relisted' ELSE 'restaurant.delisted' END,
       'RESTAURANT', p_restaurant_id, 'SUCCESS', lapse,
       jsonb_build_object('account_state', r.account_state, 'delist_reasons', to_jsonb(r.delist_reasons),
                          'halal_status', r.halal_status),
       jsonb_build_object('account_state', v_state, 'delist_reasons', to_jsonb(v_reasons),
                          'halal_status', v_status),
       -- placeholders: the audit chain trigger computes day, seq and both hashes
       current_date, 0, '\x00'::bytea, '\x00'::bytea);
  END IF;
END
$$;
-- +goose StatementEnd
