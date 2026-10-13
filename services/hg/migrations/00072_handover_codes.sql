-- Handover codes: the 4-digit pickup code the kitchen reads to the rider at the
-- counter, and the 4-digit delivery code the customer reads to the rider at a
-- met handover (MEET_AT_DOOR or MEET_IN_LOBBY). They replace the package-seal
-- scan at launch and are the rider's only way through either handover.
--
--   Contract: contracts/README.md, "Neither code can be bypassed"
--   https://github.com/shaiknoorullah/hg-mono/pull/290
--   Backend:  https://github.com/shaiknoorullah/hg-mono/issues/310
--             https://github.com/shaiknoorullah/hg-mono/issues/259
--   Storage:  https://github.com/shaiknoorullah/hg-mono/issues/289
--
-- Stored encrypted, not hashed, because the server shows each code again: the
-- pickup code on the restaurant's order view, the delivery code on the
-- customer's. AES-256-GCM under APP_DATA_KEY, like account.totp_secret_enc
-- (00004_identity.sql). The application binds each ciphertext to its order and
-- to which code it is (GCM associated data), so a sealed code copied to another
-- order, or from one column to the other, does not open.
--
-- Wrong attempts are counted on the order, not on the assignment, so
-- reassigning the order to the same rider does not give five fresh guesses
-- (#289). The application counts with one conditional increment under the
-- order's row lock; the CHECKs below are the backstop, so no bug can count past
-- five.

-- +goose Up

CREATE TYPE handover_code_kind AS ENUM ('PICKUP', 'DELIVERY');

ALTER TABLE "order"
  ADD COLUMN pickup_code_enc        bytea,
  ADD COLUMN pickup_code_attempts   smallint NOT NULL DEFAULT 0,
  ADD COLUMN delivery_code_enc      bytea,
  ADD COLUMN delivery_code_attempts smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT order_pickup_code_attempts_bounded
    CHECK (pickup_code_attempts BETWEEN 0 AND 5),
  ADD CONSTRAINT order_delivery_code_attempts_bounded
    CHECK (delivery_code_attempts BETWEEN 0 AND 5);

-- The audit record overrideHandoverCode writes in the same transaction as the
-- transition it performs: support or an admin confirmed a handover without its
-- code. It names who, why, the support case and how many wrong codes had been
-- tried. It never holds a code.
CREATE TABLE handover_override (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id            uuid NOT NULL REFERENCES "order"(id),
  handover            handover_code_kind NOT NULL,
  reason              text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  case_id             uuid NOT NULL,
  actor_account_id    uuid NOT NULL REFERENCES account(id),
  actor_kind          order_actor_kind NOT NULL CHECK (actor_kind IN ('SUPPORT', 'ADMIN')),
  wrong_code_attempts smallint NOT NULL CHECK (wrong_code_attempts BETWEEN 0 AND 5),
  order_state         order_state NOT NULL,
  -- The key of the request that wrote the record, so a retry of that same
  -- request is answered with this record rather than a conflict.
  idempotency_key     text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- A handover happens once, so it is overridden at most once.
  CONSTRAINT handover_override_once UNIQUE (order_id, handover),
  CONSTRAINT handover_override_state_matches CHECK (
    (handover = 'PICKUP' AND order_state = 'PICKED_UP')
    OR (handover = 'DELIVERY' AND order_state = 'DELIVERED')
  )
);
CREATE INDEX handover_override_actor ON handover_override (actor_account_id, created_at DESC);

-- Append-only, in two layers like the ledger (00017_ledger.sql): the REVOKE
-- below and this trigger, which also stops the table owner.
-- +goose StatementBegin
CREATE FUNCTION handover_override_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'handover_override_is_append_only: % on handover_override is never permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;
-- +goose StatementEnd

CREATE TRIGGER handover_override_append_only
  BEFORE UPDATE OR DELETE ON handover_override
  FOR EACH ROW EXECUTE FUNCTION handover_override_reject_mutation();
CREATE TRIGGER handover_override_no_truncate
  BEFORE TRUNCATE ON handover_override
  FOR EACH STATEMENT EXECUTE FUNCTION handover_override_reject_mutation();

GRANT SELECT, INSERT ON handover_override TO hg_app;
REVOKE UPDATE, DELETE, TRUNCATE ON handover_override FROM hg_app;
GRANT SELECT ON handover_override TO hg_readonly;

-- +goose Down

DROP TABLE IF EXISTS handover_override;
DROP FUNCTION IF EXISTS handover_override_reject_mutation();
ALTER TABLE "order"
  DROP CONSTRAINT IF EXISTS order_delivery_code_attempts_bounded,
  DROP CONSTRAINT IF EXISTS order_pickup_code_attempts_bounded,
  DROP COLUMN IF EXISTS delivery_code_attempts,
  DROP COLUMN IF EXISTS delivery_code_enc,
  DROP COLUMN IF EXISTS pickup_code_attempts,
  DROP COLUMN IF EXISTS pickup_code_enc;
DROP TYPE IF EXISTS handover_code_kind;
