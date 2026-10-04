# HalalGoes — realtime contract

**Status: normative.** This document is part of `contracts/` and carries the same authority as
`openapi.yaml`. Generated clients are produced from both; hand-edited clients are forbidden.

Source of record: `docs/spec/01-platform.md` §P-20 … §P-23 (connection, channels, catalogue,
delivery guarantees), with per-role projection rules from §P-07.

Endpoint: `wss://api.halalgoes.com/v1/ws`

**Mocked, end to end.** `pnpm mock` serves this contract at
`ws://localhost:4010/v1/ws?ticket=dev` and can play a scripted event sequence — pass
`&scenario=realtime_order_happy_path` to drive a tracking screen through a whole order
lifecycle with no backend. The scripts are listed in `contracts/fixtures/README.md`.

---

## 0. The three rules this document exists to enforce

1. **Identity is never client-asserted.** The inbound frame schema has no `user_id`,
   `user_type`, `restaurant_id` or `role` field — not "ignored", *unrepresentable*. The
   principal is resolved once, at upgrade, from a server-issued ticket.
2. **The socket is not a second, weaker authorization surface.** Every `subscribe` runs a fresh
   Postgres authorization check against the same ownership predicates as the HTTP surface.
3. **The socket is an optimisation, never the only delivery path.** Every event that requires
   action is also delivered by push, and every realtime state is readable over REST. A client
   on the polling path is less fresh, never wrong.

---

## 1. Handshake

### 1.1 Ticket flow (browsers and native)

```
POST /v1/realtime/ticket          → { ticket, expires_at, websocket_url, allowed_channels }
GET  wss://…/v1/ws?ticket=<t>&client=<surface>&v=1
                                  ← HTTP 101, then a `hello` frame
```

* `createRealtimeTicket` is a normal authenticated REST call through the full middleware chain
  (auth → policy → rate limit → audit). Browsers cannot set `Authorization` on a WebSocket
  upgrade, which is the entire reason the ticket exists.
* The ticket is 32 random bytes base64url. It is stored **in Postgres** (`realtime_ticket`) with
  `account_id`, `session_id`, `roles_snapshot` and `expires_at = now() + 30s`. Redis mirrors it
  for lookup speed only; nothing about identity or subscription rights is ever read from Redis.
* On upgrade the server consumes it with a conditional update:
  `UPDATE realtime_ticket SET consumed_at = now() WHERE ticket_hash = $1 AND consumed_at IS NULL
  AND expires_at > now() RETURNING account_id, session_id, roles_snapshot`.
  **Zero rows ⇒ the upgrade is refused with HTTP 401 before any frame is exchanged**, and a
  `realtime.ticket_reuse` audit event is written.
* Origin is checked against the CORS allowlist on upgrade.

### 1.2 Native alternative

Native clients may skip the ticket and pass the access token in the upgrade's
`Sec-WebSocket-Protocol` header:

```
Sec-WebSocket-Protocol: hg.v1, bearer.<access-jwt>
```

The server validates it exactly as the HTTP path does. Both paths converge on the same
`Principal`.

### 1.3 Session binding and re-authentication

* The connection carries `session_id`. When that session is revoked the socket is closed with
  **4401 `session_revoked` within 10 seconds** — the same deny set as the HTTP surface, refreshed
  from Postgres every 10 s and invalidated immediately over Redis pub/sub. Redis makes revocation
  instant; Postgres makes it *correct*.
* Access-token expiry does **not** close the socket. The client must send a `reauth` frame at
  least every 10 minutes; a socket that has not re-authenticated within 15 minutes is closed
  `4401`. The server signals this with a `reauth_required` control frame carrying a deadline.

### 1.4 Limits

| Limit | Value |
|---|---|
| Max frame size | 64 KiB |
| Inbound frames | 20 / second (soft: `error{code:"RATE_LIMITED"}`, socket stays open) |
| Inbound flood | 100 / second ⇒ close `4429` |
| Subscriptions per connection | 50 |
| Connections per session | 4 |
| Connections per account | 10 |
| Connections per server replica | 2,000 by default (`HG_REALTIME_MAX_SOCKETS`) ⇒ close `1013 at_capacity` |
| Unsent server frames per connection | 64 ⇒ close `1013 slow_consumer` |
| Heartbeat | server `ping` every 25 s; client must `pong` within 10 s |

### 1.5 Close codes

| Code | Meaning | Client action |
|---|---|---|
| `1000` | Normal closure | Reconnect if the app is still foregrounded |
| `1001` | Server going away (deploy) | Reconnect with backoff |
| `1013` | Try again later: `slow_consumer` (the client fell 64 frames behind) or `at_capacity` (this replica is full) | Reconnect with backoff, then `resume` every channel from its `last_seq` ([gap detection](#63-gap-detection--the-clients-contract)). Nothing is lost: missed events are in Postgres |
| `4400` | Malformed frame or unknown field | Fix the client; do not retry blindly |
| `4401` | `session_revoked`, `reauth_timeout`, or ticket invalid | Re-authenticate over REST, mint a new ticket |
| `4403` | Origin not allowed | Fatal; do not retry |
| `4429` | Frame flood | Back off, then reconnect |

Reconnect backoff: 1 s → 2 s → 4 s → 8 s → 15 s cap, full jitter.

---

## 2. Envelope

Every **server → client** message is exactly this object:

```json
{
  "id":  "01K4S9ZC0F8V7Q2R3T5Y6M8N9P",
  "seq": 1487,
  "channel": "order:6b1f0a3c-2f4e-7c1a-9f00-3a1b2c3d4e5f",
  "type": "order.state_changed",
  "v": 1,
  "ts": "2026-08-10T14:03:11.412Z",
  "data": { }
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | ULID | Unique per event. **Clients must deduplicate on this** — delivery is at-least-once. |
| `seq` | int64 | Per-channel monotonic, gapless, allocated by Postgres in the same transaction as the state change. This is what makes gap detection and replay possible. |
| `channel` | string | The channel this event belongs to. `""` for control frames. |
| `type` | string | From the catalogue in §4. |
| `v` | int | Payload schema version. **A client that does not understand `v` ignores the event rather than crashing.** |
| `ts` | RFC3339 ms, UTC | Server time at emission. |
| `data` | object | The typed payload. Schemas are served at `GET /v1/realtime/schema`, keyed `{type}@v{version}`. |

Control frames (`hello`, `pong`, `error`, `subscribed`, `unsubscribed`, `subscribe_error`,
`resume_complete`, `reauth_required`) carry `seq: 0` and no channel.

A field rename in a payload fails CI unless `v` is incremented and the old version is still
emitted for the deprecation window.

---

## 3. Channels and the inbound vocabulary

### 3.1 Channels

Channels are **server-derived**. `hello` lists the channels this principal is allowed to
subscribe to; a `subscribe` naming anything else is refused. Membership is derived, never stored
as a mutable set — a subscription exists only for the lifetime of a connection.

| Channel | Who may subscribe | Carries |
|---|---|---|
| `account:{account_id}` | that account only (**auto-subscribed** at `hello`) | personal notifications, account and security events, onboarding and payout state |
| `order:{order_id}` | the order's customer; staff of the order's restaurant; the assigned rider; support and admin | order, payment, dispatch and rider-location events — **projected per role** (§5) |
| `restaurant:{restaurant_id}` | staff holding a live scoped grant; support and admin | new-order offers, restaurant status, payout updates |
| `rider:{account_id}` | that rider; support and admin | dispatch offers, availability, earnings |
| `admin:ops` | `ADMIN`, `SUPER_ADMIN`, `SUPPORT_AGENT` | platform alerts, dispatch failures, reconciliation exceptions, queue depth |

Re-validation: an `order:{id}` subscription is re-checked whenever the order's participant set
changes. **A rider who loses the dispatch is force-unsubscribed within 2 seconds** with
`unsubscribed{reason:"no_longer_authorized"}`, and receives no further events for that order.

### 3.2 Inbound frames — the complete vocabulary

Five frame types. There is nothing else, and **none of them carries identity**.

```jsonc
// subscribe
{ "type": "subscribe",   "channel": "order:6b1f…" }

// unsubscribe
{ "type": "unsubscribe", "channel": "order:6b1f…" }

// resume — gap recovery, see §6
{ "type": "resume",      "channel": "order:6b1f…", "after_seq": 1487 }

// reauth — keeps a long-lived socket bound to a live session
{ "type": "reauth",      "access_token": "<jwt>" }

// pong — answer to the server's ping
{ "type": "pong",        "t": 1786000000123 }
```

Any other `type`, or any unknown field on these five, is rejected with
`error{code:"UNKNOWN_FIELD"}` and **the connection's principal is unchanged**.

> **Note.** Earlier drafts of this document named an `invalid_frame` code here. There is no
> `INVALID_FRAME` member in `ErrorCode`, and `error.code` is typed `ErrorCode` (§4.1), so a
> malformed frame uses `VALIDATION_FAILED` and an unknown field uses `UNKNOWN_FIELD`. If a
> distinct code is wanted, it has to be added to the enum in `openapi.yaml` first. A frame claiming to be another user is not "rejected as unauthorized" — the
field it would need does not exist in the schema.

---

## 4. Event catalogue

`v: 1` for every type below unless stated. **Audience** names which roles receive the event on
that channel; the payload each role receives is the projection described in §5.

### 4.1 Control (connection-scoped, `seq: 0`, no channel)

| `type` | `data` |
|---|---|
| `hello` | `{account_id: uuid, roles: [{r: Role, s: uuid\|null}], session_id: uuid, allowed_channels: string[], server_time: Timestamp, heartbeat_s: 25, protocol: 1}` |
| `subscribed` | `{channel: string, cursor_seq: int64}` — the current head, so a fresh subscriber knows where it starts |
| `unsubscribed` | `{channel: string, reason: "client_request" \| "no_longer_authorized" \| "order_terminal"}` |
| `subscribe_error` | `{channel: string, code: "not_found" \| "forbidden" \| "subscription_limit" \| "invalid_channel", message: string}` — **its own** closed set, deliberately lower case and **not** `ErrorCode` |
| `resume_complete` | `{channel: string, from_seq: int64, to_seq: int64, replayed: int, truncated: bool}` |
| `ping` / `pong` | `{t: int64}` (epoch ms) |
| `error` | `{code: ErrorCode, message: string, retryable: bool}` — SCREAMING_SNAKE, from the closed enum |
| `reauth_required` | `{deadline: Timestamp}` |

> A `subscribe` for an order belonging to someone else returns `subscribe_error{code:"not_found"}`
> — not `forbidden`. The socket obeys the same 404-vs-403 rule as HTTP: an unrelated principal
> must not learn that the order exists.

### 4.2 Order — channel `order:{order_id}`

| `type` | Audience | `data` |
|---|---|---|
| `order.created` | customer | `{order_id, code, state: OrderState, restaurant: {id, name}, total_cents, currency, placed_at, deadline_at}` |
| `order.state_changed` | all participants | `{order_id, from: OrderState\|null, to: OrderState, at, reason: string\|null, actor_kind: OrderActorKind, deadline_at: Timestamp\|null, eta_at: Timestamp\|null}` |
| `order.eta_updated` | customer, restaurant | `{order_id, pickup_eta_at, dropoff_eta_at, source: "ROUTED"\|"CACHED"\|"FALLBACK"}` |
| `order.items_adjusted` | customer, restaurant | `{order_id, removed: [{line_no, name, qty}], new_total_cents, new_quote_id}` |
| `order.cancelled` | all participants | `{order_id, reason_code: OrderCancellationReasonCode, by: OrderActorKind, refund: {kind, amount_cents, state} \| null}` |
| `order.completed` | customer, restaurant, rider | `{order_id, delivered_at, receipt_url: string\|null}` |
| `order.note_added` | restaurant, rider, support | `{order_id, author_kind: OrderActorKind, text, at}` |
| `order.rider_arrived` | **customer only** | `{order_id, at, delivery_code: string\|null}` |

`deadline_at` is non-null on every non-terminal state. A client rendering a countdown derives it
from `deadline_at` minus `server_time`, never from a local constant.

`order.rider_arrived` is the arrival event: it is emitted in the same transaction as
`order.state_changed` to `ARRIVED`, and it is also sent as a push, because the customer has to
act on it. The push is an ordinary `Notification` ("Your rider has arrived") that deep-links to
the order. Like every notification body it never contains the code; the app shows the code from
`OrderCustomerView`/`OrderTracking` or the socket event.

`delivery_code` is the 4-digit code the customer reads to the rider at a met handover
(`MEET_AT_DOOR` or `MEET_IN_LOBBY`), so the rider can record proof of delivery. It is `null` for an unattended drop, where proof is a photo, and once five wrong codes have locked it.
The same value is `delivery_code` on `OrderCustomerView` and `OrderTracking` over REST, so a
client on the polling path still shows it. **No serializer for the rider, the restaurant or
support carries this event:** the rider is never shown the delivery code
([round-2 decisions, "Orders and delivery"](../docs/decisions/README.md#orders-and-delivery), [#180](https://github.com/shaiknoorullah/hg-mono/issues/180)).

### 4.3 Payment — channel `order:{order_id}` (out-of-order charges use `account:{id}`)

| `type` | Audience | `data` |
|---|---|---|
| `payment.authorized` | customer | `{order_id, amount_cents, currency, card: {brand, last4}}` |
| `payment.action_required` | customer | `{order_id, client_secret, expires_at}` — 3-D Secure is a **normal** path; the order stays `CREATED` under its 15-minute deadline |
| `payment.captured` | customer | `{order_id, amount_cents, currency, captured_at}` |
| `payment.failed` | customer | `{order_id, code, decline_code: string\|null, message, retryable: bool}` |
| `refund.created` | customer | `{order_id, refund_id, amount_cents, currency, reason_code: RefundReasonCode, state: RefundState}` |
| `refund.settled` | customer | `{order_id, refund_id, amount_cents, currency, settled_at}` |
| `refund.failed` | customer, support | `{order_id, refund_id, message}` — the customer-facing copy reads "refund in progress", never "refunded" |

### 4.4 Restaurant — channel `restaurant:{restaurant_id}`

| `type` | Audience | `data` |
|---|---|---|
| `restaurant.order_offered` | restaurant staff | `{order_id, code, expires_at, deadline_at, customer_first_name, lines: [{name, variant, addons, qty, note}], subtotal_cents, total_cents, currency, prep_eta_suggestion_min, fulfilment: Fulfilment}` |
| `restaurant.order_offer_expired` | restaurant staff | `{order_id, reason: "timeout"}` |
| `restaurant.order_offer_withdrawn` | restaurant staff | `{order_id, reason: "customer_cancelled" \| "payment_failed"}` |
| `restaurant.order_accepted` | restaurant staff | `{order_id, accepted_by, prep_eta_minutes, pickup_code: string\|null}` — fan-out to the restaurant's other tablets. `pickup_code` is the 4-digit code the kitchen reads to the rider at the counter (`OrderRestaurantView.pickup_code`); `null` when the customer collects the order |
| `restaurant.order_rejected` | restaurant staff | `{order_id, rejected_by, reason_code: RestaurantRejectReasonCode}` |
| `restaurant.status_changed` | restaurant staff | `{restaurant_id, is_accepting_orders, open_state: RestaurantOpenState, reason, changed_by}` |
| `restaurant.payout_updated` | restaurant owner | `{payout_id, state: PayoutState, amount_cents, currency, period: {start, end}}` |

`restaurant.order_offered` carries the **pre-acceptance** projection: the customer's first name,
no phone, no street address, no pickup code. The full address arrives on the next
`order.state_changed` after acceptance, and the pickup code on `restaurant.order_accepted`.
The `restaurant:{id}` channel is restaurant staff, support and admin only, so the pickup code
never reaches the rider: the rider hears it from the kitchen and types it in to confirm pickup
([round-2 decisions, "Orders and delivery"](../docs/decisions/README.md#orders-and-delivery), [#178](https://github.com/shaiknoorullah/hg-mono/issues/178)).

Losing this frame never loses the order. The offer is also delivered by push, escalates to SMS at
60 s and to an automated voice call at 120 s, and the order stays `RESTAURANT_PENDING` until the
**server-side** 180-second deadline. Closing a dialog, refreshing, or dropping the socket does
not reject anything.

### 4.5 Dispatch and rider — channel `rider:{account_id}` for offers, `order:{order_id}` for progress

| `type` | Channel | Audience | `data` |
|---|---|---|---|
| `dispatch.offer` | `rider:{id}` | rider | `{order_id, offer_id, expires_at, server_time, pickup: {restaurant_name, address_short, lat, lng}, dropoff: {area, lat, lng}, distance_m, est_duration_s, earnings_cents, tip_cents_estimate, items_count}` |
| `dispatch.offer_withdrawn` | `rider:{id}` | rider | `{order_id, offer_id, reason: "taken" \| "expired" \| "cancelled"}` |
| `dispatch.assigned` | `order:{id}` | customer, restaurant, rider | `{order_id, rider: {first_name, photo_url, vehicle_type, rating_avg}, pickup_eta_at}` |
| `dispatch.unassigned` | `order:{id}` | customer, restaurant, rider | `{order_id, reason}` |
| `dispatch.state_changed` | `order:{id}` | customer, restaurant, rider | `{order_id, from: DispatchState, to: DispatchState, at}` |
| `rider.location` | `order:{id}` | customer, restaurant (**coarse**), support | `{order_id, lat, lng, heading_deg, speed_mps, accuracy_m, recorded_at}` |
| `rider.availability_changed` | `rider:{id}` | rider, admin | `{account_id, is_online, availability_state: RiderAvailabilityState, at}` |
| `rider.earnings_updated` | `rider:{id}` | rider | `{account_id, period, earnings_cents, currency, deliveries}` |

`dispatch.offer` never carries the customer's unit number or phone alias — those exist only after
the offer is accepted. The countdown is computed from `expires_at` minus `server_time`, corrected
for device clock skew, so a phone whose clock is ten minutes fast still shows ~30 seconds.

`rider.location` is throttled to **at most one event per 5 seconds per order** and is published
only while the order is `PICKED_UP` or `ARRIVED`, or dispatch is `ASSIGNED` or later.

### 4.6 Account and onboarding — channel `account:{account_id}`

| `type` | `data` |
|---|---|
| `account.security_event` | `{kind: "new_device_login" \| "password_changed" \| "session_revoked", at, ip_city}` |
| `document.review_state_changed` | `{document_id, doc_type, state: KycDocumentState, reason: string\|null, reviewed_at}` |
| `onboarding.state_changed` | `{subject_type: "RESTAURANT"\|"RIDER", subject_id, from, to, next_action}` |
| `connect.requirements_changed` | `{currently_due: string[], past_due: string[], payouts_enabled: bool, deadline: Timestamp\|null}` |
| `notification.created` | `{notification_id, kind, title, body, deep_link, created_at}` |
| `notification.read` | `{notification_id, read_at}` |

`account.security_event` carries `ip_city`, a coarse location — never a raw IP.

### 4.7 Admin — channel `admin:ops`

| `type` | `data` |
|---|---|
| `admin.alert` | `{severity, kind, subject_type, subject_id, message, at}` |
| `admin.dispatch_failure` | `{order_id, waves, riders_offered, radius_m}` |
| `admin.reconciliation_exception` | `{kind, order_id, expected_cents, actual_cents}` |
| `admin.queue_depth` | `{pending_restaurant_reviews, pending_rider_reviews, open_disputes, failed_refunds}` |

---

## 5. Per-role projection rules

Projection is part of ownership, not a separate concern. There is **one serializer per (event,
role)** — never a shared struct with conditional field blanking, because a blanking branch is a
leak waiting to be forgotten.

| Audience | What is added | What is withheld |
|---|---|---|
| **Customer** | rider's *public* profile: first name, last initial, photo, vehicle type, rating average; the **delivery code** while the order is out for delivery | the rider's earnings, phone, record or exact pre-pickup position; the pickup code |
| **Restaurant** | customer's first name + last initial; masked phone (`+1 416 ••• 0123`); the **pickup code** from acceptance until pickup | the customer's full phone, always; the **delivery address until the order is `ACCEPTED`**; the rider's phone; the rider's precise coordinates; the delivery code |
| **Rider** | pickup details from assignment; drop-off street and neighbourhood | the customer's **full address and unit until `PICKED_UP`**; the customer's raw phone at any time (a platform proxy alias is sent instead); every item price and the order total; **both handover codes, always** — the rider hears each one and types it in |
| **Support / admin** | everything, with PII masked by default | nothing — but every privileged cross-tenant read writes an audit event *before* returning, and unmasking requires a recorded justification |

Two projections deserve to be spelled out because they are the ones most often got wrong:

* **`rider.location` to a restaurant** is *coarse*: coordinates are rounded to roughly 100 m, and
  the payload contains no customer address and no customer phone. The customer receives the
  precise position; the restaurant receives only enough to know the rider is close.
* **The rider's view of the customer address** is progressive. Before `PICKED_UP` the rider sees
  street and neighbourhood. After `PICKED_UP` the full address, unit and buzzer appear. Thirty
  minutes after the assignment terminates the address is redacted back to street level in the
  rider's history and the phone alias is deactivated.

Three invariants back this up:

* No event payload contains a raw customer phone number, a full address for an unauthorised
  audience, card data, a token, or any monetary value not sourced from the order or its quote.
* A handover code reaches only the party who reads it out: the pickup code only the
  restaurant, the delivery code only the customer. The rider, who types each one in, is never
  sent either.
* A principal can never receive an event for a channel it is not subscribed to, and can never
  subscribe to a channel whose ownership check it cannot pass.

---

## 6. Delivery, ordering and replay

**At-least-once, ordered per channel, deduplicated by the client on `id`.**

### 6.1 Publish path — the transactional outbox

1. A handler mutates state and, **in the same transaction**, allocates `seq`
   (`UPDATE channel_cursor … RETURNING last_seq + 1`) and inserts `realtime_event` +
   `outbox_message`.
2. A relay goroutine claims unpublished outbox rows with `FOR UPDATE SKIP LOCKED`, publishes to
   Redis `PUBLISH rt:{channel}`, and marks them published.
3. Every API replica subscribes to `rt:*` and delivers to its local sockets, applying the
   per-role projection at send time.

An event exists in `realtime_event` **if and only if** the state change that produced it
committed. Same transaction, no exceptions.

### 6.2 What happens when Redis dies

Redis pub/sub is fan-out only. If it is down or flushed: the relay backs off and retries, events
accumulate in `outbox_message`, clients see no live updates, and the REST endpoints are
unaffected. When Redis returns the backlog publishes and every client's `resume` fills the gap.
**No event is lost and no state is wrong.** A chaos test flushes Redis mid-order and asserts the
client's final observed event set equals the server's rows for that channel.

### 6.3 Gap detection — the client's contract

* Track `last_seq` per channel.
* On any received event with `seq > last_seq + 1`, **or on any reconnect**, send
  `resume {channel, after_seq}`.
* The server replays from `realtime_event` (Postgres, an immutable table) in `seq` order, up to
  **1000 events**, then sends `resume_complete`.
* `truncated: true` — the gap is older than the 7-day retention, or wider than 1000 events —
  instructs the client to **refetch the resource over REST and reset its cursor**. That is the
  always-correct fallback.
* `subscribed{cursor_seq}` gives the current head so a fresh subscriber knows where it starts.

Replay is a **read** of an immutable table. It is non-destructive and idempotent, any number of
clients may replay the same range any number of times, and reading a queued notification never
consumes it.

### 6.4 Operational budgets

| Measure | Target |
|---|---|
| Outbox lag | p99 < 500 ms; > 30 s pages on-call |
| Commit → client render | p95 ≤ 3 s |
| Revocation propagation | ≤ 10 s, with Redis down |
| `realtime_event` retention | 7 days (daily partition drop) |

---

## 7. Client checklist

A conforming client:

1. Mints a fresh ticket for every connection attempt; never caches or reuses one.
2. Deduplicates on `id` with a bounded LRU.
3. Tracks `seq` per channel and sends `resume` on any gap and on every reconnect.
4. Treats `truncated: true` as "refetch over REST".
5. Ignores any event whose `v` it does not understand, and never crashes on an unknown `type` or
   an unknown enum value.
6. Sends `reauth` at least every 10 minutes with a current access token.
7. Reduces events into a single state object — it does **not** append every message to an
   unbounded array.
8. Falls back to polling the REST tracking endpoint every 15 s whenever the socket is not `OPEN`,
   and renders identically on both paths.
9. Never derives money, distance, ETA or availability from an event payload by arithmetic. Every
   such number is server-computed and rendered verbatim.
