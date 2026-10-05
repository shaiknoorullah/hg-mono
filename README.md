# hg-mono

HalalGoes — the whole platform in one repository.

A halal food-delivery marketplace for Canada. Customers find and order from **verified halal-certified** restaurants; riders deliver; restaurants manage orders; admins verify certification.

## What this is

One Go modular monolith, one database, five containers. Not microservices — the previous architecture was eight services with a workflow engine, and it is being replaced deliberately.

```
Traefik  →  hg (single Go binary: HTTP + WebSocket)
                ├── Postgres + PostGIS   (only source of truth)
                ├── Valkey (Redis)       (cache, pub/sub, rate limits — disposable)
                └── Silo (MinIO fork)    (documents, images — private buckets)
```

**Load-bearing rule:** Postgres is the only source of truth. Redis is disposable — flush it at any moment and the system must still be *correct*, just slower. Every Redis bug in the previous system came from violating this.

## Layout

| Path | Contents |
|---|---|
| `docs/spec/` | The specification of record — 198 features with states, rules and acceptance criteria |
| `docs/decisions/` | Decision log: what is settled, what is still open |
| `docs/analysis/` | Feature inventory of the previous system (what existed, what was broken) |
| `contracts/` | OpenAPI contract, realtime contract and 310 fixtures. **Single source of truth for every API shape** |
| `packages/api-client/` | The generated TypeScript client and the money helpers. The only place a frontend gets a type |
| `tools/mock-server/` | The whole API with no backend running — `pnpm mock` |
| `tools/contract-tools/` | Contract and fixture validators (`pnpm validate:contract`, `pnpm validate:fixtures`) |
| `services/` | The Go binary |
| `apps/` | Customer (Expo), Rider (Expo), Restaurant (web), Admin (web) |
| `deploy/` | docker compose, Traefik config |

## Reading order

1. `docs/spec/00-overview.md` — conventions, scope totals, the V0 cut
2. `docs/spec/01-platform.md` — money model, order state machine, realtime. **Read this before any domain spec**
3. Domain specs: `02-customer`, `03-restaurant`, `04-rider`, `05-admin`
4. `docs/decisions/README.md` — what still needs a human answer

## Non-negotiables

These are invariants, not preferences. They exist because each one was violated in the previous system and cost real money or real safety.

1. **The server prices every order.** Clients send item IDs and a tip. Never a price. Inbound DTOs may not contain price fields.
2. **Deny by default.** A route is unauthenticated only if explicitly marked public.
3. **Money is `int64` minor units.** No floats, anywhere, ever.
4. **Every non-terminal order state carries a `deadline_at`,** enforced by a Postgres `CHECK`. "Waits forever" is unrepresentable.
5. **Authorise then capture.** Capture on restaurant acceptance; reject and timeout *void* the authorisation. There is no refund to fail.
6. **Every order's money decomposes to zero residual** across restaurant, rider, platform, tax and tip. Enforced by a double-entry ledger.
7. **KYC and certificates live in private buckets** with short-lived presigned URLs. Never public.
8. **A missing halal field renders no badge** — never an optimistic one. Silence is never consent on a halal claim.

## Building a frontend against this

No backend is required, and none exists yet.

```bash
pnpm install
pnpm generate     # the typed client, from contracts/openapi.yaml
pnpm mock         # the entire API at http://localhost:4010
```

```ts
import { createHgClient, unwrap, formatCents } from '@hg/api-client';

const api = createHgClient({ baseUrl: 'http://localhost:4010/v1' });
const order = await unwrap(api.GET('/v1/orders/{orderId}', { params: { path: { orderId } } }));
```

Pick any state in the contract by name — `?scenario=order_arrived`,
`?scenario=cart_at_quantity_cap`, `?scenario=rider_dashboard_zero_earnings` — and drive a
tracking screen through a whole order lifecycle over the WebSocket with
`ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_order_happy_path`.

**Read [`contracts/fixtures/README.md`](contracts/fixtures/README.md) first.** It lists all
310 scenarios and what state each represents. `packages/api-client/README.md` covers the
client and the money rules; `tools/mock-server/README.md` covers the mock.

| Command | What it does |
|---|---|
| `pnpm generate` | Regenerate the TypeScript client from the contract |
| `pnpm mock` | Start the mock server (REST + WebSocket) |
| `pnpm validate:contract` | Every contract invariant CI enforces |
| `pnpm validate:fixtures` | Every fixture against its schema |
| `pnpm fixtures:build` | Regenerate the fixture set |
| `pnpm check` | All of the above, plus the no-hand-edit drift checks |

## Status

Specification complete. **Contract kit complete**: normalised contract, generated client,
310-scenario fixture set, mock server with scripted realtime. Server implementation and the
four apps not yet started.
