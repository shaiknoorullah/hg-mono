-- The platform-wide pause on new orders, for use during an incident
-- (https://github.com/shaiknoorullah/hg-mono/issues/244).
--
-- Staff turn it on from Admin with a reason (setOrderingPause). While it is on,
-- createQuote and createOrder answer 409 ORDERING_PAUSED; orders already placed
-- carry on to the end. The admin store writes the audit row in the same
-- transaction as the change.
--
-- One row, and only one: the primary key is a boolean that must be true, the
-- row is inserted here, and the application role may not delete or truncate
-- it. Postgres is the only place this lives. Every API replica reads it on each
-- quote, order and cart, so a pause applies on the next request and Redis has
-- nothing to do with it (AGENTS.md, "Architecture in one picture": flushing
-- Redis may never make the system wrong).
--
-- createOrder reads the row FOR SHARE inside the transaction that inserts the
-- order, and setOrderingPause's UPDATE needs the row exclusively. So a pause
-- that commits while an order is being created either waits for that order to
-- commit, or makes it see the pause and refuse; no order is created after the
-- pause has committed.

-- +goose Up

CREATE TABLE ordering_pause (
  id           boolean PRIMARY KEY DEFAULT true CHECK (id),
  paused       boolean NOT NULL DEFAULT false,
  -- When the current pause began; kept when a pause is re-stated with a new
  -- reason, cleared on resume.
  paused_at    timestamptz,
  -- The reason given with the latest change, pause or resume.
  reason       text,
  changed_by   uuid REFERENCES account(id) ON DELETE SET NULL,
  changed_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- A pause always says when it began and why. Silence is never a pause
  -- nobody can explain.
  CONSTRAINT ordering_pause_explained CHECK (
    NOT paused OR (paused_at IS NOT NULL AND reason IS NOT NULL AND changed_at IS NOT NULL)
  ),
  CONSTRAINT ordering_pause_since_only_while_paused CHECK (paused OR paused_at IS NULL),
  CONSTRAINT ordering_pause_reason_length CHECK (reason IS NULL OR length(reason) BETWEEN 10 AND 500)
);
SELECT attach_updated_at('ordering_pause');

INSERT INTO ordering_pause (id, paused) VALUES (true, false);

-- The row must always exist: a missing row would leave createOrder nothing to
-- lock. The application role may update it, never remove it.
REVOKE DELETE, TRUNCATE ON ordering_pause FROM hg_app;

-- +goose Down
DROP TABLE IF EXISTS ordering_pause;
