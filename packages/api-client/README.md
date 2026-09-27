# `@hg/api-client`

The only way a HalalGoes frontend talks to the API.

```ts
import { createHgClient, unwrap, formatCents, idempotencyKey } from '@hg/api-client';

const api = createHgClient({
  baseUrl: 'http://localhost:4010/v1',   // the mock; swap for the real origin
  getToken: () => session.accessToken,
  clientSurface: 'customer-app',
});

const order = await unwrap(api.GET('/v1/orders/{orderId}', {
  params: { path: { orderId } },
}));

order.state;                    // OrderState — a closed union, not `string`
formatCents(order.money.total_cents);   // "$67.06"
```

---

## Do not edit `src/generated/`

`src/generated/openapi.d.ts` is produced by `pnpm generate` from
`contracts/openapi.yaml`. **Hand-editing it is forbidden**, and CI enforces that:

```bash
pnpm generate                 # regenerate
pnpm generate:check           # regenerate, then `git diff --exit-code` on src/generated
```

`pnpm generate:check` is part of the root `pnpm check`. If the generated client is wrong, the
**contract** is wrong — fix `contracts/openapi.yaml`, regenerate, and commit both.

The three hand-written files are `client.ts` (transport), `money.ts` (the money domain) and
`realtime.ts` (the WebSocket types, which have no generator yet — see below).

## Why `openapi-fetch` rather than a hand-rolled wrapper

`contracts/README.md` §"Regenerating clients" already names `openapi-typescript` +
`openapi-fetch` as the toolchain, and it is the right call for the reason stated there: types
only, plus a thin typed fetch — no heavyweight runtime, no hand-written wrapper layer.
Concretely:

* **Request and response types resolve per `operationId`, from the path literal.** There is no
  generated method-per-operation surface to keep in sync, and no place for a hand-written
  type to creep in. Calling a path that is not in the contract does not compile — which is
  exactly the ghost-endpoint gate the contract exists to provide.
* **~6 kB, `fetch`-based, no `axios`.** It runs unchanged in React Native, the browser, a
  service worker (MSW) and Node tests.
* **It never throws on an HTTP error.** `{ data, error }` is returned, so branching on
  `error.code` — which the contract mandates — is the natural way to write a call. `unwrap()`
  is provided for the cases where a thrown error is what you want (React Query, sagas).

A hand-rolled wrapper would have to re-derive the path→types mapping that `openapi-fetch`
already does at the type level, and would be a second place for the contract to drift.

## Money: there is no float API

`money.ts` deliberately exposes **no** `toDollars(): number` and **no**
`fromDollars(n: number)`. Every monetary value on the wire is an integer count of Canadian
cents (`contracts/README.md` §Money), and this package keeps it that way:

```ts
import { cents, addCents, multiplyCents, formatCents, parseAmountToCents, type Cents } from '@hg/api-client';

const tip: Cents = cents(700);                       // branded; a bare 700 will not type-check
const lineTotal = multiplyCents(cents(1695), 3);     // integer arithmetic only
formatCents(lineTotal);                              // "$50.85"  — a string, never a number
formatCents(cents(0), { zeroAs: 'Free' });           // "Free"
parseAmountToCents('12.50');                         // 1250 exactly — no float in the path
```

* `Cents` is a branded `number`. `takesCents(1999)` is a type error; `takesCents(cents(1999))`
  is not. The brand erases at runtime.
* `parseAmountToCents` splits the string on its decimal separator and parses each half as an
  integer, so `"0.29"` is exactly `29` and never `28.999999999999996`.
* `multiplyCents` takes a **whole count** (a quantity), never a rate. There is deliberately no
  `multiplyByRate`: rates cross the wire as exact decimal strings precisely so that no client
  parses one into a float and multiplies money by it. The server prices everything. If you
  need a rate here, you are re-implementing pricing.
* The single division by 100 lives in `formatCents`, immediately before `Intl.NumberFormat`,
  and its result is a `string` that cannot be fed back into arithmetic.

`formatRateAsPercent('0.13')` → `"13%"` and `formatBasisPoints(0)` → `"0%"` render rates
without parsing them into floats either.

## One place for base URL and auth

`createHgClient` is the only place transport concerns live:

| Config | Effect |
|---|---|
| `baseUrl` | e.g. `https://api.halalgoes.com/v1`, or `http://localhost:4010/v1` for the mock |
| `getToken` | called before every request; async, so it can await a refresh in flight |
| `clientSurface` | sent as `X-Client-Surface`; the contract's `ClientSurface` enum is the closed set |
| `clientVersion` | sent as `X-Client-Version` for the force-upgrade check |
| `onUnauthorized` | invoked on a 401; return `true` to retry the original request **exactly once** |
| `onError` | every non-2xx, for telemetry |
| `mockScenario` | sent as `X-Mock-Scenario`; ignored by the real API, honoured by the mock |

## Errors

```ts
import { hasCode, HgApiError, HgTransportError } from '@hg/api-client';

try {
  await unwrap(api.POST('/v1/orders', { body, params: { header: { 'Idempotency-Key': idempotencyKey() } } }));
} catch (e) {
  if (hasCode(e, 'QUOTE_STALE')) return refreshQuote();
  if (hasCode(e, 'ACTIVE_ORDER_EXISTS')) return goToActiveOrder();
  if (e instanceof HgTransportError) return showOfflineBanner();
  throw e;
}
```

Branch on `code`, **never** on `message`. `ErrorCode` is a closed SCREAMING_SNAKE_CASE set
(normalised — see `contracts/README.md` contradiction log #3, RESOLVED); an unknown value
means "unsupported — refresh the app", never a crash.

`idempotencyKey()` generates the UUID the contract marks `required: true` on every
money-mutating and durable-creating operation. The generated types will not let you omit it.

## Realtime

`realtime.ts` is hand-written from `contracts/websocket.md` and is the **one** exception to
the no-hand-written-types rule, because the realtime payload schemas live behind
`GET /v1/realtime/schema` and there is no committed JSON-Schema snapshot in `contracts/` yet.
It declares only the §2 envelope and the §4 catalogue's `data` shapes, and every enum inside
those shapes references a *generated* `components['schemas']` type rather than restating it.
When `contracts-gen-realtime` lands, this file is deleted and replaced by generated output.

It also carries the three pieces of client behaviour `websocket.md` §7 requires and that are
easy to get wrong:

```ts
import { hasGap, SeenEventIds, reconnectDelayMs, REALTIME_CLOSE } from '@hg/api-client';

const seen = new SeenEventIds(512);            // §7.2 bounded dedup on `id`
if (!seen.admit(event.id)) return;             // at-least-once delivery
if (hasGap(lastSeq[event.channel], event.seq)) send({ type: 'resume', channel, after_seq });
setTimeout(reconnect, reconnectDelayMs(attempt));   // 1→2→4→8→15 s cap, full jitter
```

## Scripts

| Script | What it does |
|---|---|
| `pnpm generate` | `openapi-typescript contracts/openapi.yaml → src/generated/openapi.d.ts` |
| `pnpm generate:check` | regenerate, then `git diff --exit-code` — the CI drift gate |
| `pnpm typecheck` | `tsc --noEmit` |
