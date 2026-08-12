# Backend module briefs

Seven domain modules remain. The foundation (`services/hg` skeleton, compose stack, 91-table schema) is in place, so these can run **in parallel** — they own disjoint packages.

Dispatch these as separate agents. Each brief is written to be handed over verbatim.

## Rules that apply to every module

Put these at the top of every brief.

- **The contract is authoritative.** `contracts/openapi.yaml` defines every wire shape. If a spec contradicts it, the contract wins — or the contract changes first, deliberately, and clients regenerate. Never invent a path, a field or an enum value.
- **Own only your package.** `services/hg/internal/<module>/`. Do not edit `cmd/hg/main.go` except to register your routes at the single designated registration point; do not touch `migrations/` or another module's package.
- **Verify by running.** `go build ./... && go vet ./... && go test ./...` must pass. Integration tests use the real Postgres via `HG_TEST_POSTGRES_DSN`, skipping with a clear message when unavailable — never silently.
- **Conformance is the acceptance test.** Your handlers must satisfy the same contract the mock server satisfies. Where a fixture exists in `contracts/fixtures/` for your operation, your response must match its shape.
- **Money is `int64` cents.** No floats, ever. Server computes every price; reject any inbound body carrying one.
- **Deny by default.** Register a route as public only if the contract marks it so.
- `git pull --rebase` before pushing. Commit messages end with the project's co-author trailer.

---

## B3 — Auth & identity
`internal/auth`, `internal/session`

Phone OTP for customers and riders; email + password for restaurants and admins; one `account` table, many roles (platform spec P-01). Sessions, refresh, revocation. OTP generation, delivery via an `SMSSender` interface (no provider wired yet — O-03 is unresolved), attempt limits and Redis rate limiting. Replace `AnonymousAuthenticator` and `DenyAllAuthorizer` in `cmd/hg/main.go` with real implementations — **every non-public route currently 401s until this lands**. Ownership checks are part of this module's contract: the previous system had total IDOR.

Spec: `01-platform.md` P-01…P-08 · `05-admin.md` for staff/RBAC.

## B4 — Catalogue & discovery
`internal/catalog`

Restaurants, menus, categories, items, variants, addons, item versions. Halal certificates and issuing bodies. **The halal-gated listing predicate** — one shared SQL predicate; only `CERTIFIED` and `EXPIRING_SOON` restaurants are visible anywhere. Discovery, search, the nine filters, sorting. PostGIS proximity. Restaurant open/closed state with heartbeat.

Spec: `02-customer.md` C-04, C-12…C-16 · `03-restaurant.md` R-13…R-19.

## B5 — Cart, quote & orders
`internal/orders`

Cart (one restaurant enforced server-side). **The quote flow**: `POST /v1/quotes` persists a quote with `input_hash`/`state_hash`; `POST /v1/orders` takes only a `quote_id`, re-executes it, and 409s on any difference. The 14-state order machine with its transition table. **The deadline ticker** — `FOR UPDATE SKIP LOCKED`, advancing or cancelling expired states. Canadian tax computation from the effective-dated rate table.

This is the module where the old system lost money. Read `docs/analysis/legacy-system/crosscut-order-flow.md` before starting.

Spec: `01-platform.md` P-09…P-16 (the money model and state machine are normative).

## B6 — Payments, ledger & payouts
`internal/payments`

Stripe: **authorise at checkout, capture on restaurant acceptance, void on reject or timeout.** Webhooks with idempotency. Refunds (full and partial). The **double-entry ledger** — every posting balanced, enforced by the deferred trigger already in the schema. Stripe Connect payouts, weekly Monday, no minimum. Earnings ledger for riders.

Payments in the previous system were entirely fabricated (`stripe_<nanoid>` strings) and every refund path was a TODO log line. Nothing here may be stubbed.

Spec: `01-platform.md` P-17…P-21 · decisions S-01…S-05.

## B7 — Dispatch
`internal/dispatch`

PostGIS `ST_DWithin` rider search on the single `location` column, with the radius ladder. Offer waves, expiry, escalation. **Race-free accept**: one conditional `UPDATE ... WHERE rider_id IS NULL AND status = 'AWAITING_RIDER'`; zero rows means another rider won. No Redis lock, no distributed coordination — it must work with **Redis entirely down**. Availability transitions in the same transaction as assignment; restoration after terminal states, with a reconciliation sweep as backstop.

Read `docs/analysis/legacy-system/gap-realtime-dispatch.md` — it catalogues every way the previous dispatch broke, including a Redis fallback that iterated permanently empty sets.

Spec: `04-rider.md` D-10…D-20 · `01-platform.md` P-14.

## B8 — Realtime
`internal/realtime`

WebSocket gateway. **Server-derived identity only** — a single-use ticket exchanged over authenticated HTTP; the inbound frame schema has no `user_id` field, so client-asserted identity is unrepresentable. Channels with per-subscribe ownership re-checks. The **transactional outbox**: `realtime_event` + `outbox_message` + per-channel `seq` committed with the state change. Redis pub/sub for multi-replica fan-out only; replay reads Postgres. Resume by `after_seq`.

`contracts/websocket.md` is the contract. The old gateway trusted client-declared identity — anyone could join any order channel.

Spec: `01-platform.md` P-22…P-27.

## B9 — Admin, RBAC & files
`internal/admin`, `internal/files`

Staff accounts, the RBAC permission matrix, hash-chained audit log. Restaurant and rider onboarding queues. **The halal seven-check verification** — H1…H7, with H5 (dates) and H7 (certificate uniqueness) server-computed and non-overridable; approval impossible unless all seven `PASS`. Menu approval for claim-bearing fields (never auto-approved). Refund authority caps. MinIO: private buckets, presigned upload and download, KYC retention.

Spec: `05-admin.md` in full · `01-platform.md` P-28…P-33.

---

## After the modules

**Conformance harness.** Point the existing contract tests at the running Go server and require the same responses the mock produces for the same fixtures. This is the acceptance gate for the backend as a whole, and it needs no new judgement — the contract and fixtures already exist.

**Then the four apps** — customer, rider, restaurant web, admin web. Split each by flow (auth, browse, cart+checkout, tracking) rather than one agent per app; two over-scoped agents already failed this session for exactly that reason.
