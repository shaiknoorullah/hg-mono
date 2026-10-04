-- Halal certificate expiry: the derived halal state follows the calendar, the
-- listing follows the halal state, and each renewal reminder is sent once.
-- Issue: https://github.com/shaiknoorullah/hg-mono/issues/252
--
-- Before this migration restaurant.halal_status was recomputed only by the
-- trigger on halal_certificate writes, against the database's own current_date.
-- No job called it, so a certificate that expired overnight kept its badge
-- until someone edited the row. Spec: docs/spec/05-admin.md, "A-17 — Halal
-- certificate expiry monitoring and lapse handling".
--
-- What changes:
--
--   1. halal_refresh_restaurant_status(restaurant, at) derives the state as of
--      an explicit instant, in the restaurant's own timezone. The one-argument
--      form the trigger calls is now that function at now(). The expiry job
--      (internal/halalexpiry) calls the two-argument form, which is what makes
--      the job testable with an injected clock.
--   2. A certificate the job has moved to EXPIRED still counts as the
--      restaurant's certificate, so the restaurant reads EXPIRED ("we can't
--      currently vouch", cool slate), not UNVERIFIED.
--   3. The same function keeps the listing in step with the halal state: an
--      expired certificate adds HALAL_CERTIFICATE_EXPIRED to delist_reasons and
--      moves a LIVE restaurant to DELISTED; a valid certificate (a renewal
--      approved, or a grace extension) removes the reason and returns a DELISTED
--      restaurant with no other reason to LIVE. A SUSPENDED or BANNED restaurant
--      keeps its state but still records the reason, so reinstatement cannot
--      bypass the lapse. Because the certificate trigger calls this function,
--      approving a renewal relists in the approval's own transaction.
--   4. "LIVE with an expired halal state" becomes unrepresentable (CHECK).
--   5. halal_certificate_reminder records each renewal reminder (30, 14, 7 and
--      1 days before expiry: docs/decisions/README.md, "Settled — redesign
--      decisions (owner, 2026-09-28)") once per certificate and threshold.

-- +goose Up

CREATE TABLE halal_certificate_reminder (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  halal_certificate_id  uuid NOT NULL REFERENCES halal_certificate(id),
  restaurant_id         uuid NOT NULL REFERENCES restaurant(id),
  days_before           int NOT NULL CHECK (days_before > 0),
  expires_on            date NOT NULL,             -- the expiry date the reminder named
  sent_on               date NOT NULL,             -- the restaurant-local date it was due on
  recipients            int NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- One reminder per certificate per threshold, as a database fact: two job
  -- replicas racing the same day both try this insert and one of them loses.
  CONSTRAINT halal_certificate_reminder_once UNIQUE (halal_certificate_id, days_before)
);
CREATE INDEX halal_certificate_reminder_restaurant ON halal_certificate_reminder (restaurant_id, created_at DESC);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_refresh_restaurant_status(p_restaurant_id uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r         record;
  c         record;
  today     date;
  v_status  halal_display_state;
  v_cert    uuid;
  v_state   restaurant_account_state;
  v_reasons text[];
  lapse     constant text := 'HALAL_CERTIFICATE_EXPIRED';
BEGIN
  SELECT id, timezone, halal_status, halal_certificate_id, account_state, delist_reasons,
         onboarding_state = 'ACTIVE' AND location IS NOT NULL AND province IS NOT NULL AS can_go_live
    INTO r
    FROM restaurant
   WHERE id = p_restaurant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  today := (p_at AT TIME ZONE r.timezone)::date;

  -- The restaurant's certificate: an APPROVED one wins over an EXPIRED one, and
  -- the later expiry wins within each. Only ACCEPTED issuing bodies count.
  SELECT hc.id, hc.status, hc.expires_on, hc.grace_until
    INTO c
    FROM halal_certificate hc
    JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
   WHERE hc.restaurant_id = p_restaurant_id
     AND hc.status IN ('APPROVED', 'EXPIRED')
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
    -- 00:00 local the day after. Amber "expiring soon" from 30 days out.
    v_status := CASE
      WHEN c.status = 'EXPIRED' OR COALESCE(c.grace_until, c.expires_on) < today
        THEN 'EXPIRED'::halal_display_state
      WHEN c.expires_on <= today + 30
        THEN 'EXPIRING_SOON'::halal_display_state
      ELSE 'CERTIFIED'::halal_display_state
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

-- The trigger's entry point: the same derivation at the transaction's clock.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION halal_refresh_restaurant_status(p_restaurant_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM halal_refresh_restaurant_status(p_restaurant_id, now());
END
$$;
-- +goose StatementEnd

-- The consistency check now also catches the amber badge, and asks the
-- question in the restaurant's timezone: any row here is a badge shown for a
-- certificate that no longer vouches.
CREATE OR REPLACE VIEW halal_status_inconsistency AS
  SELECT r.id AS restaurant_id, r.halal_status, r.halal_certificate_id
    FROM restaurant r
   WHERE r.halal_status IN ('CERTIFIED', 'EXPIRING_SOON')
     AND NOT EXISTS (
       SELECT 1 FROM halal_certificate hc
       JOIN halal_issuing_body b ON b.id = hc.issuing_body_id
        WHERE hc.id = r.halal_certificate_id
          AND hc.status = 'APPROVED'
          AND b.status = 'ACCEPTED'
          AND COALESCE(hc.grace_until, hc.expires_on) >= (now() AT TIME ZONE r.timezone)::date
     );

-- Bring every existing row up to date (this delists any restaurant already
-- past its expiry), then forbid the combination for good.
SELECT halal_refresh_restaurant_status(id, now()) FROM restaurant;

ALTER TABLE restaurant
  ADD CONSTRAINT restaurant_live_not_halal_expired
  CHECK (account_state <> 'LIVE' OR halal_status <> 'EXPIRED');

-- +goose Down
ALTER TABLE restaurant DROP CONSTRAINT IF EXISTS restaurant_live_not_halal_expired;

CREATE OR REPLACE VIEW halal_status_inconsistency AS
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

DROP FUNCTION IF EXISTS halal_refresh_restaurant_status(uuid, timestamptz);
DROP TABLE IF EXISTS halal_certificate_reminder;
