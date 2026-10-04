# Transactional notification infrastructure (core system, v1)

_HalalGoes. **Reliability-critical, OLTP-side, ships with the core product (v1) — not v2.**
This is the delivery path for messages a user must receive: sign-in OTP, order accepted,
payment captured, rider assigned, arriving, delivered, refund issued. It is **completely
separate** from the marketing/engagement plane (`growth-stack.md` / Dittofeed), because the
reliability requirements are the opposite._

## Why it is not an external notification tool (Novu et al.)

A transactional notification must be **as reliable as the order machine itself**. Routing it
through an external notification service (Novu/Dittofeed/SaaS) introduces a second failure
domain, a network hop, and a **dual-write race**: the order transaction commits but the
"notify" call fails (or vice-versa) → "your order was accepted" never arrives, or arrives for
an order that rolled back. Unacceptable. So the transactional path lives **in the monolith,
anchored to Postgres**, using the transactional outbox pattern.

## Design: transactional outbox via River

- **River** (Postgres-backed Go job queue) enqueues the notification job **inside the same
  `pgx` transaction** as the order-state write. If the business transaction commits, the
  notification is guaranteed enqueued; if it rolls back, so does the notification. The
  dual-write race is **unrepresentable** — same "make the bug impossible" philosophy as the
  `CHECK` constraints and the ledger `SUM=0` trigger.
- **Postgres-backed, not Redis.** A Redis flush must never lose a transactional notification —
  this path does not touch Redis. (Asynq and other Redis-backed queues are therefore out.)
- **Low latency:** River uses `LISTEN/NOTIFY` to wake the worker immediately; a periodic poll is
  the fallback — the same ticker discipline already used for `deadline_at`.

## Reliability requirements (each one non-negotiable)

1. **Atomicity** — notification intent is written in the business transaction, never after it.
2. **At-least-once + idempotent** — the worker may retry; delivery is keyed by a stable
   `notification_id` (+ provider idempotency key) so retries never double-send.
3. **Provider failover** — per channel, a primary + fallback provider (SMS: Twilio → fallback;
   push: FCM/APNs). Email has one provider, Resend
   ([email decision](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)).
   Retry with exponential backoff, then **dead-letter + alert** (never silent-drop a
   transactional message).
4. **Channel fallback** — critical types escalate: push → if undelivered/unregistered, fall back
   to SMS. Configured per notification type.
5. **Consent independence** — transactional/OTP/legal messages send regardless of marketing
   consent (contractual necessity / legitimate interest under PIPEDA). Marketing suppression and
   quiet-hours apply **only** to non-critical types. This is enforced in code, not left to a
   marketing tool's preference state.
6. **Delivery tracking + audit** — status per message (queued → sent → delivered → failed) with
   provider receipts, retained and auditable (matters in order disputes: "we notified the
   customer at 18:42").
7. **Ordering where it matters** — per-order notifications don't leapfrog (e.g. "delivered"
   before "picked up"); enforced by the order state machine that emits them (P-14: only orders
   writes order.state).

## Channels & adapters

Generalise the existing **`SMSSender` seam** (today: phone OTP) into a multi-channel
`Notifier` with adapters: **SMS** (Twilio + fallback), **Push** (FCM/APNs), **Email**
(Resend, templates built with React Email), **in-app/WebSocket** (already have the WS hub). Each adapter is behind an
interface with a fake for local/dev (like the fake Stripe), so the pipeline is testable without
live creds.

## Boundaries

- Lives with the source of truth; emits from the order/dispatch/auth modules only.
- Shares **nothing** with the marketing plane — no CDP, no Dittofeed, no marketing consent.
- No PII leakage into logs/telemetry (message bodies with codes/addresses stay out of spans).

## Timing

**v1.** OTP sign-in and order lifecycle notifications are core UX — the system isn't launchable
without reliable delivery. Build the `Notifier` + River outbox with the order machine; the
marketing plane (`growth-stack.md`) is a separate, later (v2) effort.
