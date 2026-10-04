-- Indexes the retention sweep (internal/retention) needs.
--
-- 1. Deleting sessions. Deleting a session row makes Postgres check every
--    foreign key that points at it: session.rotated_to,
--    realtime_connection.session_id and realtime_ticket.session_id. With no
--    index on the referencing column, each of those checks is a full scan of
--    that table, once for every deleted row. The existing
--    realtime_connection_session index is partial (live connections only), so
--    a foreign-key check cannot use it.
--
-- 2. Finding old rows. Each rule picks a batch with "WHERE <age> < cutoff
--    ORDER BY <age> LIMIT n". With an index on <age> that reads only the rows
--    past the cutoff; without one, the last batch of every hourly pass scans
--    the whole table to find nothing. Each index below matches its rule's
--    filter in internal/retention/rules.go, partial where the rule is.
--    (realtime_event, quote, idempotency_record and job_run already have one.)

-- +goose Up

CREATE INDEX session_rotated_to ON session (rotated_to) WHERE rotated_to IS NOT NULL;
CREATE INDEX realtime_connection_session_any ON realtime_connection (session_id);
CREATE INDEX realtime_ticket_session ON realtime_ticket (session_id);

CREATE INDEX realtime_connection_ended ON realtime_connection ((COALESCE(disconnected_at, last_seen_at)));
CREATE INDEX outbox_published ON outbox_message (published_at) WHERE published_at IS NOT NULL;
CREATE INDEX login_attempt_at ON login_attempt (at);
CREATE INDEX otp_challenge_window_ends ON otp_challenge (window_ends_at);
CREATE INDEX webhook_event_processed ON webhook_event (processed_at) WHERE processed_at IS NOT NULL;
CREATE INDEX search_query_log_at ON search_query_log (at);
CREATE INDEX notification_delivery_finished ON notification_delivery (queued_at) WHERE state <> 'QUEUED';
CREATE INDEX notification_created ON notification (created_at);

-- +goose Down
DROP INDEX IF EXISTS notification_created;
DROP INDEX IF EXISTS notification_delivery_finished;
DROP INDEX IF EXISTS search_query_log_at;
DROP INDEX IF EXISTS webhook_event_processed;
DROP INDEX IF EXISTS otp_challenge_window_ends;
DROP INDEX IF EXISTS login_attempt_at;
DROP INDEX IF EXISTS outbox_published;
DROP INDEX IF EXISTS realtime_connection_ended;
DROP INDEX IF EXISTS realtime_ticket_session;
DROP INDEX IF EXISTS realtime_connection_session_any;
DROP INDEX IF EXISTS session_rotated_to;
