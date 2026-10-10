# `tools/mock-server` — the whole API, with no backend

```bash
pnpm mock
```

That is the one command. It serves **all 144 operations** from `contracts/openapi.yaml`,
backed by the 310 fixtures in `contracts/fixtures/`, plus the WebSocket from
`contracts/websocket.md`.

```
REST         http://localhost:4010/v1
WebSocket    ws://localhost:4010/v1/ws?ticket=dev
scenarios    http://localhost:4010/__mock/scenarios
operations   http://localhost:4010/__mock/operations
```

Point a frontend at it and delete nothing else:

```ts
createHgClient({ baseUrl: 'http://localhost:4010/v1' });
```

---

## Picking a state

Every fixture has a globally unique `scenario` name. Three ways to ask for one, in
precedence order:

```bash
# 1. query param — one request
curl 'localhost:4010/v1/orders/any?scenario=order_arrived'

# 2. header — a whole session (the generated client's `mockScenario` option sends this)
curl -H 'X-Mock-Scenario: order_arrived' localhost:4010/v1/orders/any

# 3. cookie — a whole browser tab
document.cookie = 'mock_scenario=order_arrived';
```

One name applies to **every** request that carries it. A screen calls several operations, so
any of the three may instead carry a **per-operation map**: `operationId=scenario` pairs,
comma-separated. Each operation gets its own fixture; one the map does not name gets its
default (or a bare name in the list that is registered for it):

```bash
curl -H 'X-Mock-Scenario: getCurrentPrincipal=principal_admin,refreshSession=error_session_revoked' \
  localhost:4010/v1/auth/me          # principal_admin; POST /v1/auth/refresh answers 401
```

The naming rules and the devworld equivalents of each state are in
[`contracts/fixtures/SCENARIOS.md`](../../contracts/fixtures/SCENARIOS.md).

With no scenario named you get the operation's **default** — the plainest healthy shape,
declared in `contracts/fixtures/_build/registry.py` and published in
`contracts/fixtures/index.json`, so the mock and the fixture set cannot disagree.

The catalogue is `contracts/fixtures/README.md`, or live:

```bash
curl 'localhost:4010/__mock/scenarios?tag=edge'
curl 'localhost:4010/__mock/scenarios?domain=orders'
curl 'localhost:4010/__mock/scenarios?operation=getOrder'
curl 'localhost:4010/__mock/scenarios/order_arrived'    # the whole fixture
```

Every response carries what it decided:

| Header | Meaning |
|---|---|
| `X-Mock-Operation-Id` | which contract operation matched |
| `X-Mock-Contract-Version` | `V0` or `V1` |
| `X-Mock-Scenario` | the fixture actually served |
| `X-Mock-Scenario-Source` | `scenario` (you asked) or `default` |
| `X-Mock-Warning` | you named a scenario that does not exist, or one registered for a different operation |

A path that is **not** in the contract returns `404 NOT_FOUND` naming the fact. That is the
point: a frontend that invents an endpoint finds out here, not in staging.

## Driving the WebSocket through a lifecycle

The `realtime/` fixtures are scripted event sequences. Name one on the upgrade and the mock
plays it, paced by each event's recorded delay. It re-stamps `ts` to wall clock and moves
every timestamp inside `data` (`expires_at`, `deadline_at`, ...) from the fixtures' frozen
clock to the moment playback starts, so countdowns in the client are live:

```
ws://localhost:4010/v1/ws?ticket=dev&scenario=realtime_order_happy_path
```

Playback starts on your first `subscribe` frame (or immediately with `&autoplay=1`).

| Script | What it drives |
|---|---|
| `realtime_order_happy_path` | 24 events, 58 s: created → authorized → offered → accepted → captured → dispatch → assigned → ready → picked up → 3 location pings → arrived → delivered → completed |
| `realtime_order_restaurant_rejects` | Rejection at 14 s; the authorisation is voided, not refunded |
| `realtime_order_timeout_no_rider` | Three waves, no rider, order fails, full refund, `admin.dispatch_failure` |
| `realtime_payment_action_required` | 3-D Secure as a normal path |
| `realtime_payment_failed` | Declined at capture; offer withdrawn from the restaurant |
| `realtime_rider_reassigned` | Rider drops out mid-delivery, a second one is assigned |
| `realtime_gap_and_resume` | A deliberate `seq` gap (3 → 7) so you can prove your gap detection works |
| `realtime_control_frames` | Every control frame, including `subscribe_error{not_found}` and `resume_complete{truncated:true}` |
| `realtime_restaurant_offer_one` / `_burst` | One `restaurant.order_offered`; four inside six seconds |
| `realtime_restaurant_offer_expired` / `_withdrawn` / `_withdrawn_payment_failed` / `_accepted_elsewhere` | How an offer ends without this screen answering it |
| `realtime_admin_ops_queue_depth` / `_alerts` / `_dispatch_failure` / `_reconciliation_exception` / `_all` / `_unknown_type` | The `admin:ops` channel |

The mock implements what a client can observe: the ticket-bearing upgrade (**a connection
with no ticket is refused with HTTP 401**, as in production), the `hello` frame with
`allowed_channels`, all five inbound frame types, 25-second `ping`, per-channel `seq`, and
`resume` replay.

It deliberately does **not** implement authorization — every `subscribe` is granted. The real
server runs a fresh Postgres check per subscribe; a mock that pretended to enforce it would
be teaching frontends to trust the socket, which is exactly what `websocket.md` §0 rule 2
forbids.

## Options

| Env var | Default | Effect |
|---|---|---|
| `PORT` | `4010` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | bind address |
| `MOCK_LATENCY_MS` | `0` | delay every response — use it to find missing loading states |
| `MOCK_WS_SPEED` | `1` | multiply scripted delays; `0.2` is 5× speed, `0` fires everything at once |
| `MOCK_STRICT` | unset | reject money-mutating calls that omit `Idempotency-Key`, exactly as production will |

`MOCK_STRICT=1 pnpm mock` is worth running before you open a PR: the contract marks
`Idempotency-Key` `required: true` on every money-mutating and durable-creating operation,
and this is the cheapest way to find out you forgot one.

## Live-reloading fixtures

The mock reads fixtures at boot. After `pnpm fixtures:build` in another terminal:

```bash
curl -XPOST localhost:4010/__mock/reload
```

No restart, no lost WebSocket connections.

## Why not Prism

`@stoplight/prism-cli` was evaluated and rejected. Prism synthesises a response from the
schema's `example` keywords, which gives **one shape per operation**. This fixture set exists
precisely because one shape per operation is not enough: 14 order states, 10 dispatch states,
8 payment states, 10 refund states, plus every empty list, overflowing name and missing
image. Scenario selection under Prism would have meant one process per scenario and a
separate document per scenario, and the realtime contract is outside Prism's scope entirely.

What Prism gives that this does not is request validation against the schema. If that becomes
valuable, the right move is to add Ajv request validation to this server (the schemas are
already loaded), not to swap the server out.

## Layout

| File | Responsibility |
|---|---|
| `src/index.ts` | Express app, envelope, scenario resolution, `/__mock/*` |
| `src/routes.ts` | Route table built from `contracts/openapi.yaml` at boot |
| `src/fixtures.ts` | Fixture loading and default resolution from `index.json` |
| `src/ws.ts` | The `websocket.md` mock and the script player |
| `src/scenarios.test.ts` | Scenario selection and re-stamping, against the real fixture set (`pnpm --filter @hg/mock-server test:unit`) |

Nothing here hardcodes a path, a schema or a scenario name: change the contract or the
fixtures and the mock follows.
