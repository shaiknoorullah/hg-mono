-- Stored Stripe webhooks are processed, retried and, when they keep failing,
-- set aside for a person (#231, #249).
--
-- docs/spec/01-platform.md, "P-17 — Webhooks, idempotency and reconciliation":
-- a stored event is applied by a worker, retried with backoff (1 m, 2 m, 4 m …)
-- and, after its eighth failure, paged to on-call. Until now nothing applied a
-- stored event at all, so processed_at was never set.
--
-- 1. Dead letters. An event that failed eight times stops retrying and waits
--    for a person, who is alerted (admin.alert on the admin:ops channel) in the
--    same transaction. It is the one unprocessed state with no clock, so the
--    deadline check below allows it, and only with the error that put it there.
--
-- 2. Out-of-order guards. Stripe does not deliver events in order. A Connect
--    account or a dispute is a snapshot with no lifecycle rank of its own, so
--    each row remembers the creation time of the newest event applied to it,
--    and an older snapshot that arrives later is recorded and skipped.
--    (payment_intent already has last_stripe_event_created_at, from 00016.)
--
-- 3. A chargeback is on a clock while it is open (its evidence deadline) and
--    off it once Stripe closes it, like every other row the deadline rule
--    covers (README, "What the database refuses", row 2).

-- +goose Up

ALTER TABLE webhook_event ADD COLUMN dead_lettered_at timestamptz;

ALTER TABLE webhook_event DROP CONSTRAINT webhook_event_deadline_required;
ALTER TABLE webhook_event ADD CONSTRAINT webhook_event_deadline_required CHECK (
  processed_at IS NOT NULL
  OR dead_lettered_at IS NOT NULL
  OR (deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
);
ALTER TABLE webhook_event ADD CONSTRAINT webhook_event_dead_letter_has_error CHECK (
  dead_lettered_at IS NULL OR last_error IS NOT NULL
);

-- The worker's claim: due, unapplied, not set aside, oldest Stripe event first.
CREATE INDEX webhook_event_due ON webhook_event (deadline_at)
  WHERE processed_at IS NULL AND dead_lettered_at IS NULL;
-- What a person has to look at.
CREATE INDEX webhook_event_dead_letters ON webhook_event (dead_lettered_at)
  WHERE processed_at IS NULL AND dead_lettered_at IS NOT NULL;

ALTER TABLE connect_account ADD COLUMN last_stripe_event_created_at timestamptz;
ALTER TABLE chargeback ADD COLUMN last_stripe_event_created_at timestamptz;

ALTER TABLE chargeback ADD CONSTRAINT chargeback_deadline_required CHECK (
  (outcome IS NULL AND deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
  OR
  (outcome IS NOT NULL AND deadline_at IS NULL AND deadline_action IS NULL)
);

-- +goose Down

ALTER TABLE chargeback DROP CONSTRAINT IF EXISTS chargeback_deadline_required;
ALTER TABLE chargeback DROP COLUMN IF EXISTS last_stripe_event_created_at;
ALTER TABLE connect_account DROP COLUMN IF EXISTS last_stripe_event_created_at;
DROP INDEX IF EXISTS webhook_event_dead_letters;
DROP INDEX IF EXISTS webhook_event_due;
ALTER TABLE webhook_event DROP CONSTRAINT IF EXISTS webhook_event_dead_letter_has_error;
ALTER TABLE webhook_event DROP CONSTRAINT IF EXISTS webhook_event_deadline_required;
-- A dead letter has no deadline; give it one again so the old check holds.
UPDATE webhook_event SET deadline_at = now(), deadline_action = 'process_webhook'
 WHERE processed_at IS NULL AND deadline_at IS NULL;
ALTER TABLE webhook_event ADD CONSTRAINT webhook_event_deadline_required CHECK (
  processed_at IS NOT NULL OR (deadline_at IS NOT NULL AND deadline_action IS NOT NULL)
);
ALTER TABLE webhook_event DROP COLUMN IF EXISTS dead_lettered_at;
