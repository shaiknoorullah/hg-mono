package retention

import "time"

const day = 24 * time.Hour

// rule is one table's retention: how long a row is kept past the moment it
// stopped being needed, and the statement that deletes one batch of rows past
// that point.
//
// sql takes two parameters: $1 is the cutoff (the pass's start time minus
// keep, as timestamptz) and $2 is the batch size. It must be a single DELETE
// FROM table, picking at most $2 rows, so each batch is one short statement.
// It picks them in the order of an index on the age column it filters by
// (migrations/00028_retention_indexes.sql adds the ones that were missing),
// so a batch reads only rows past the cutoff: the last, short batch of every
// pass would otherwise scan the whole table to learn there is nothing left.
type rule struct {
	table string
	keep  time.Duration
	sql   string
}

// rules is the whole retention policy, in the order a pass runs it. The order
// matters twice: realtime tickets and connections go before sessions, because
// they hold foreign keys to sessions, and realtime events go before the outbox,
// because an outbox row is only deleted once its event is gone.
//
// Nothing here may delete from the ledger, orders, the audit trail or KYC
// records; rules_test.go enforces it.
var rules = []rule{
	{
		// A ticket lives 30 seconds and is single-use (docs/spec/01-platform.md,
		// "P-20 — WebSocket connection authentication"); "P-39 — Background
		// runtime" lists tickets in the hourly expiry sweep but gives no period.
		// A day past expiry is ample for investigating a refused upgrade. The
		// table never holds much more than a day of tickets, so id order (a
		// version 7 UUID, which sorts by issue time) needs no extra index.
		table: "realtime_ticket",
		keep:  1 * day,
		sql: `DELETE FROM realtime_ticket WHERE id IN (
			SELECT id FROM realtime_ticket
			 WHERE expires_at < $1
			 ORDER BY id LIMIT $2)`,
	},
	{
		// The spec gives no period ("P-20 — WebSocket connection
		// authentication"). Thirty days after a socket closes. A socket whose
		// replica died never gets disconnected_at, so it counts as closed when it
		// was last seen: a live socket re-authenticates at least every 15 minutes
		// (internal/realtime/gateway.go), which moves last_seen_at.
		table: "realtime_connection",
		keep:  30 * day,
		sql: `DELETE FROM realtime_connection WHERE id IN (
			SELECT id FROM realtime_connection
			 WHERE COALESCE(disconnected_at, last_seen_at) < $1
			 ORDER BY COALESCE(disconnected_at, last_seen_at) LIMIT $2)`,
	},
	{
		// Seven days ("P-22 — Event catalogue and envelope": retention 7 days).
		// The spec drops whole daily partitions; until partition maintenance
		// exists every event lands in the default partition, so the same
		// retention is applied by delete. Replay already answers a gap older
		// than this with truncated: true ("P-23 — Delivery guarantees, replay
		// and multi-replica fan-out").
		table: "realtime_event",
		keep:  7 * day,
		sql: `DELETE FROM realtime_event WHERE (id, created_at) IN (
			SELECT id, created_at FROM realtime_event
			 WHERE created_at < $1
			 ORDER BY created_at LIMIT $2)`,
	},
	{
		// The relay only flags a row published (internal/realtime/relay.go).
		// Kept as long as the event it carried ("P-22", 7 days), and deleted
		// only once that event is gone, so "every realtime event has an outbox
		// row" ("P-23 — Delivery guarantees, replay and multi-replica fan-out",
		// the realtime_event_without_outbox view) stays true. Unpublished rows
		// are never deleted: they are the backlog a Redis outage leaves behind.
		table: "outbox_message",
		keep:  7 * day,
		sql: `DELETE FROM outbox_message WHERE id IN (
			SELECT o.id FROM outbox_message o
			 WHERE o.published_at IS NOT NULL
			   AND o.published_at < $1
			   AND (o.realtime_event_id IS NULL OR NOT EXISTS (
			         SELECT 1 FROM realtime_event e WHERE e.id = o.realtime_event_id))
			 ORDER BY o.published_at LIMIT $2)`,
	},
	{
		// Lockout reads only the last 15 minutes ("P-03 — Email + password
		// authentication"); the spec gives no period. Ninety days keeps enough
		// for investigating a credential-stuffing incident. The security events
		// themselves live in the audit trail, which this never touches.
		table: "login_attempt",
		keep:  90 * day,
		sql: `DELETE FROM login_attempt WHERE id IN (
			SELECT id FROM login_attempt
			 WHERE at < $1
			 ORDER BY at LIMIT $2)`,
	},
	{
		// A challenge is usable for 15 minutes ("P-02 — Phone OTP
		// authentication"); "P-39" lists OTP challenges in the expiry sweep but
		// gives no period. Thirty days past the window keeps enough to
		// investigate SMS-pumping abuse.
		table: "otp_challenge",
		keep:  30 * day,
		sql: `DELETE FROM otp_challenge WHERE id IN (
			SELECT id FROM otp_challenge
			 WHERE window_ends_at < $1 AND expires_at < $1
			 ORDER BY window_ends_at LIMIT $2)`,
	},
	{
		// Records expire 24 hours after completion, and expiry is pure cleanup
		// ("P-37 — Idempotency keys", rule I-37.5); expires_at already carries
		// that. One hour of grace past it, and never a record whose lease is
		// still held by a request in flight.
		table: "idempotency_record",
		keep:  1 * time.Hour,
		sql: `DELETE FROM idempotency_record WHERE id IN (
			SELECT id FROM idempotency_record
			 WHERE expires_at < $1
			   AND (lease_until IS NULL OR lease_until < $1)
			 ORDER BY expires_at LIMIT $2)`,
	},
	{
		// The spec gives no period ("P-04 — Sessions: token format, lifetime,
		// refresh, revocation"). A session is deleted 90 days after every session
		// in its family stopped being usable (revoked, or past its idle or
		// absolute expiry), never earlier: a rotated session must outlive its
		// family, because presenting it again is how token theft is detected
		// (reuse revokes the whole family). Within a dead family the oldest go
		// first, so a remaining row never points at a deleted one through
		// rotated_to. A family any socket or ticket still refers to waits for
		// those rows' own rules above. The liveness test is an expression over
		// three columns, so this one reads the whole table each pass; an account
		// keeps a handful of sessions, which keeps that cheap.
		table: "session",
		keep:  90 * day,
		sql: `DELETE FROM session WHERE id IN (
			SELECT c.id FROM session c
			 WHERE LEAST(COALESCE(c.revoked_at, 'infinity'), c.idle_expires_at, c.absolute_expires_at) < $1
			   AND NOT EXISTS (
			         SELECT 1 FROM session m
			          WHERE m.family_id = c.family_id
			            AND LEAST(COALESCE(m.revoked_at, 'infinity'), m.idle_expires_at, m.absolute_expires_at) >= $1)
			   AND NOT EXISTS (
			         SELECT 1 FROM session m JOIN realtime_connection rc ON rc.session_id = m.id
			          WHERE m.family_id = c.family_id)
			   AND NOT EXISTS (
			         SELECT 1 FROM session m JOIN realtime_ticket rt ON rt.session_id = m.id
			          WHERE m.family_id = c.family_id)
			 ORDER BY c.issued_at, c.id LIMIT $2)`,
	},
	{
		// The spec gives no period ("P-17 — Webhooks, idempotency and
		// reconciliation"). The row is the dedupe boundary for redeliveries, and
		// Stripe stops redelivering after 3 days, but it is also the raw record
		// of a money event, so it is kept a full year after processing. An event
		// not yet processed is never deleted.
		table: "webhook_event",
		keep:  365 * day,
		sql: `DELETE FROM webhook_event WHERE id IN (
			SELECT id FROM webhook_event
			 WHERE processed_at IS NOT NULL AND processed_at < $1
			 ORDER BY processed_at LIMIT $2)`,
	},
	{
		// Kept "for future ranking work and zero-result monitoring" ("P-33 —
		// Restaurant and dish search"), with no period. Six months covers two
		// seasons of ranking data; a query tied to an account is personal data,
		// so it is not kept indefinitely.
		table: "search_query_log",
		keep:  180 * day,
		sql: `DELETE FROM search_query_log WHERE id IN (
			SELECT id FROM search_query_log
			 WHERE at < $1
			 ORDER BY at LIMIT $2)`,
	},
	{
		// "notification_delivery retained 30 days" (docs/spec/03-restaurant.md,
		// "R-34 — Notifications and alerts", rule 6). A delivery still QUEUED is
		// stuck, not finished, and is kept for the alert it should raise.
		table: "notification_delivery",
		keep:  30 * day,
		sql: `DELETE FROM notification_delivery WHERE id IN (
			SELECT id FROM notification_delivery
			 WHERE state <> 'QUEUED' AND queued_at < $1
			 ORDER BY queued_at LIMIT $2)`,
	},
	{
		// Ninety days (docs/spec/03-restaurant.md, "5. Decisions required",
		// data retention: "notifications 90 days"; docs/spec/04-rider.md,
		// "D-33 — Notifications & alerts": "Notifications older than 90 days are
		// pruned from the inbox"). A notification still escalating on a deadline
		// is never deleted. Its delivery rows go with it (ON DELETE CASCADE).
		table: "notification",
		keep:  90 * day,
		sql: `DELETE FROM notification WHERE id IN (
			SELECT id FROM notification
			 WHERE created_at < $1 AND deadline_at IS NULL
			 ORDER BY created_at LIMIT $2)`,
	},
	{
		// A quote expires after 10 minutes ("P-09 — Canonical price computation
		// (the Quote)"); the spec gives no period for deleting it. Thirty days
		// past expiry. A quote an order was placed from is part of that order's
		// record and is never deleted (the order's foreign key would refuse it
		// anyway). Its lines, line add-ons and tax lines go with it (ON DELETE
		// CASCADE).
		table: "quote",
		keep:  30 * day,
		sql: `DELETE FROM quote WHERE id IN (
			SELECT q.id FROM quote q
			 WHERE q.expires_at < $1
			   AND NOT EXISTS (SELECT 1 FROM "order" o WHERE o.quote_id = q.id)
			 ORDER BY q.expires_at LIMIT $2)`,
	},
	{
		// The sweep's own bookkeeping ("P-39 — Background runtime": job_run is
		// for observability). Ninety days of pass history; other jobs' rows are
		// theirs to prune.
		table: "job_run",
		keep:  90 * day,
		sql: `DELETE FROM job_run WHERE id IN (
			SELECT id FROM job_run
			 WHERE job = '` + jobName + `' AND started_at < $1
			 ORDER BY started_at LIMIT $2)`,
	},
}
