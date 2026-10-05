---
covers: []
reviewed: 2026-10-04
---

# Specification overview

Derived from the client Statement of Work (`00-sow-source.txt`), which is deliberately non-technical. Every vague term in it has been constrained here into states, rules and testable acceptance criteria.

## Scope totals

| Domain | Features | Spec lines |
|---|---:|---:|
| Platform (cross-cutting) | 39 | 2,850 |
| Admin / Super Admin / Support | 42 | 2,951 |
| Restaurant | 36 | 2,399 |
| Customer | 40 | 1,225 |
| Rider | 41 | 1,100 |
| **Total** | **198** | **10,525** |

## Versions

| Version | Count | Meaning |
|---|---:|---|
| **V0** | 43 | One real paid order, end to end. Nothing else. |
| **V1** | 73 | The rest of the contracted launch scope. |
| **V2 / V3** | 82 | Contracted but not launch-blocking; enhancements. |

### V0 — the 43

**Platform (11)** — phone-OTP + email/password identity; deny-by-default authorization with ownership checks; money model (int64 cents, quote flow); Canadian tax table; 14-state order machine with `deadline_at` CHECK; deadline ticker; Stripe authorise→capture→void; double-entry ledger; WebSocket (ticket auth, outbox, per-channel `seq`); push notifications; private object-storage buckets ([Silo](https://github.com/pgsty/silo), the maintained MinIO fork: [object storage](../decisions/README.md#settled--platform-decisions-owner-2026-10-01)).

**Customer (12)** — OTP sign-in; profile; address + geocode; halal-gated restaurant list; halal badge + certification panel; restaurant detail + menu with variants/addons; single-restaurant cart; quote display; checkout + payment; live tracking; cancel before acceptance; order history + receipt.

**Restaurant (6)** — email/password sign-in; onboarding + four Canadian documents; menu view; order offer + accept/reject within 180s; preparing → ready; open/closed toggle with heartbeat.

**Rider (7)** — OTP sign-in; onboarding + documents + Stripe Connect; online/offline; location streaming; offer receipt + race-free accept; pickup → delivered with proof of delivery; earnings ledger.

**Admin (7)** — staff sign-in + RBAC; onboarding queue; **halal 7-check verification**; restaurant approve/reject; rider approve/reject; menu creation on behalf; order lookup + refund.

Release 1.0 ([#103](https://github.com/shaiknoorullah/hg-mono/issues/103)) is wider than this cut: the owner moved some later operations into launch, among them restaurants editing their own menu with every save reviewed ([launch scope and menu editing](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).

## Binding conventions

Apply to every domain spec. Domain specs do not re-litigate these.

- **Market**: Canada. Currency CAD. Launch province Ontario (engine supports all provinces, table-driven).
- **Money**: `int64` minor units. Postgres `BIGINT` named `*_cents`. `money`, `double precision` and `real` are banned by a migration linter. JSON money fields are integers with a `_cents` suffix.
- **Identity**: customers and riders authenticate by phone OTP; restaurants and admins by email + password. One `users` table, many roles.
- **Time**: all timestamps UTC in storage; rendered in the restaurant's or user's local zone, in 12-hour form such as "7:42 pm" ([time format](../decisions/README.md#settled--redesign-decisions-round-2-owner-2026-10-01)).
- **Order fulfilment** lives on the order. **Rider assignment is a subordinate `dispatch` machine** that may advance the order but may never cancel it.
- **Realtime** identity is server-derived from a single-use ticket. The inbound WebSocket frame schema contains no `user_id` field, so client-asserted identity is unrepresentable.
- **Redis is disposable.** It holds cache, pub/sub fan-out, rate-limit counters and OTP codes. Nothing else. Event replay reads Postgres.

## Money model at launch

| Setting | Value | Notes |
|---|---|---|
| Platform commission | **0%** | Per-restaurant `commission_rate_bps` field exists; switchable without a release |
| Delivery fee | **$2.99 + $1.00/km** | Charged to customer |
| Rider earnings | **= delivery fee** (pass-through) + 100% of tips | No separate rate card, no floor |
| Service fee | **$0.00** | Mechanism built and wired; set to zero. Checkout shows the line as "Service fee $0.00" ([service fee](../decisions/README.md#settled--reconciliations)) |
| Discounts | **Restaurant-funded** | Platform-funded requires admin |
| Payouts | **Weekly, Monday, automatic, no minimum** | Stripe Connect Express |
| Capture | **Authorise at checkout, capture on acceptance** | Reject/timeout voids |
| Cancellation | **Free before acceptance** (voids auth); after, support-mediated | Staff may cancel after acceptance without a support case; the reason is audited ([cancellation policy](../decisions/README.md#settled--client-decisions)) |
| Tax | Ontario 13% HST, effective-dated table | Requires registration — see decisions |

> **Known consequence:** at 0% commission with a $0 service fee, the platform has no revenue line while Stripe still charges ~2.9% + $0.30. Roughly **−$1.30 per order**. This is an accepted launch-time acquisition cost, not an oversight. The service-fee mechanism exists so it can be corrected by configuration.

## Timeouts

| State | Deadline | On expiry |
|---|---|---|
| `CREATED` | 15 min | Cancel payment intent |
| `AUTHORIZED` | 60 s | Offer to restaurant (3 attempts → cancel + void) |
| `RESTAURANT_PENDING` | **180 s** | Cancel, **void authorisation**, no re-offer |
| `PREPARING` | prep ETA + 10 min | Notify + ops; 3 escalations → cancel + full refund |
| `READY_FOR_PICKUP` | 15 min | Escalate dispatch; 3 → refund customer, **pay restaurant** |
| `PICKED_UP` | 75 min | Ping rider + ops; never auto-delivers |
| Dispatch offer | 30 s per wave | Next wave (3 → 6 → 10 km, 3 waves) |

## Traceability

Every feature entry carries a **SOW trace** quoting the contract line it derives from, so scope disputes resolve against the document rather than memory.
