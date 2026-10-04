---
covers:
  - services/hg/internal/retention/**
reviewed: 2026-10-04
---

# Decision: how long rows are kept in the tables that only grow

_October 2026. **Proposed**, waiting for the owner to confirm. Asked for by
[Delete old rows from the tables that only grow (#221)](https://github.com/shaiknoorullah/hg-mono/issues/221)._

## Why

Several tables are only ever added to: published outbox messages, socket and
ticket records, sign-in records, idempotency records, sessions, Stripe
webhooks, the search log, notifications and quotes. The
[background runtime spec](../spec/01-platform.md#p-39--background-runtime-deadline-runner-outbox-relay-schedulers)
asks for hourly expiry sweeps, and none existed. The production hosting plan
([#207](https://github.com/shaiknoorullah/hg-mono/issues/207)) sizes the disk on
the assumption that these tables stop growing.

The hourly retention sweep in
[`services/hg/internal/retention`](../../services/hg/internal/retention/rules.go)
now deletes their rows once they pass a retention period. Where a spec gives
the period, the sweep uses it. Where no spec does, the period below is a
proposal, chosen on the conservative side, and it changes by editing one line
in `rules.go`.

## The periods

The clock for each row starts when the row stops being needed, not when it was
written.

| Table | Deleted | Source |
|---|---|---|
| `realtime_event` | 7 days after it was written | [Event catalogue spec](../spec/01-platform.md#p-22--event-catalogue-and-envelope): 7 days |
| `outbox_message` | 7 days after it was published, and only once its realtime event is gone. **Never while unpublished**: those rows are the backlog a Redis outage leaves | Follows the event it carried |
| `realtime_ticket` | 1 day after it expired (a ticket lives 30 seconds) | **Proposed.** [WebSocket authentication spec](../spec/01-platform.md#p-20--websocket-connection-authentication) gives none |
| `realtime_connection` | 30 days after the socket closed, or was last seen if its replica died | **Proposed.** None in the spec |
| `login_attempt` | 90 days after the attempt. Lockout reads only the last 15 minutes | **Proposed.** [Email and password sign-in spec](../spec/01-platform.md#p-03--email--password-authentication-restaurants-admins-support) gives none |
| `otp_challenge` | 30 days after its 15-minute window closed | **Proposed.** [Phone OTP spec](../spec/01-platform.md#p-02--phone-otp-authentication-customers-riders) gives none |
| `idempotency_record` | 1 hour after it expired (a record expires 24 hours after completion). Never while a request still holds its lease | [Idempotency keys spec](../spec/01-platform.md#p-37--idempotency-keys): expiry is cleanup |
| `session` | 90 days after every session in its family stopped being usable. A rotated session outlives its family, because presenting it again is how token theft is caught | **Proposed.** [Sessions spec](../spec/01-platform.md#p-04--sessions-token-format-lifetime-refresh-revocation) gives none |
| `webhook_event` | 1 year after it was processed. **Never while unprocessed** | **Proposed.** [Webhooks spec](../spec/01-platform.md#p-17--webhooks-idempotency-and-reconciliation) gives none. A year is far past Stripe's 3-day redelivery window, the catch-up window ([#223](https://github.com/shaiknoorullah/hg-mono/issues/223)) and the time a cardholder has to dispute a charge, and the row is the raw record of a money event. Inert until the deadline runner processes stored webhooks and sets processed_at; see [#231](https://github.com/shaiknoorullah/hg-mono/issues/231) |
| `search_query_log` | 180 days | **Proposed.** [Search spec](../spec/01-platform.md#p-33--restaurant-and-dish-search) keeps it for ranking work with no period. A query tied to an account is personal data |
| `notification_delivery` | 30 days after it was queued. Never while still queued | [Restaurant notifications spec](../spec/03-restaurant.md#r-34--notifications-and-alerts), rule 6: 30 days |
| `notification` | 90 days after it was created, with its deliveries. Never while its escalation deadline is inside the retention period | [Restaurant spec decisions](../spec/03-restaurant.md#5-decisions-required) and [rider notifications spec](../spec/04-rider.md#d-33--notifications--alerts): 90 days |
| `quote`, with its lines, add-ons and tax lines | 30 days after it expired (a quote lives 10 minutes). **Never a quote an order was placed from**: it is part of that order's record | **Proposed.** [Quote spec](../spec/01-platform.md#p-09--canonical-price-computation-the-quote) gives none |
| `job_run`, the sweep's own rows | 90 days | **Proposed.** Pass history for observability |

## What is never deleted

The ledger, orders, the audit trail, KYC records, and payments, refunds and
payouts. The law keeps them for years
([ledger spec](../spec/01-platform.md#p-13--the-ledger-and-the-zero-residual-invariant),
[audit trail spec](../spec/01-platform.md#p-35--append-only-audit-trail),
[document retention spec](../spec/01-platform.md#p-29--document-lifecycle-review-and-retention)).
The audit trail and the ledger are trimmed, when they are, by redaction or by
dropping partitions, never by this sweep. A test in
[`rules_test.go`](../../services/hg/internal/retention/rules_test.go) fails if a
rule ever names one of these tables.

## How it runs

Every replica runs the sweep, but a pass runs on one replica per hour: the pass
claims a `job_run` row under a transaction-scoped advisory lock. Each table is
deleted in batches of 2,000 rows, one short statement each, with a pause
between batches, so there are no long locks and no write-ahead-log spike. Every
pass logs the rows it deleted per table and records its outcome in `job_run`.
