/**
 * The HalalGoes mock server.
 *
 *     pnpm mock            # http://localhost:4010, ws://localhost:4010/v1/ws
 *
 * Serves every operation in `contracts/openapi.yaml` from the fixture set, in the
 * `{data, meta?}` / `{error}` envelope the contract mandates, with scenario selection and a
 * scriptable WebSocket. See README.md.
 *
 * Why not Prism: evaluated and rejected. Prism synthesises responses from schema `example`
 * keywords, which gives one shape per operation — it cannot serve *this* fixture set, where
 * the whole point is 310 named states per operation (14 order states, 10 dispatch states,
 * 8 payment states, every empty and overflow edge). Scenario selection would have meant
 * one Prism instance per scenario. The realtime contract is out of Prism's scope entirely.
 */
import { createServer } from 'node:http';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { FixtureStore } from './fixtures.js';
import { loadRoutes, matchRoute, type Route } from './routes.js';
import { attachRealtime } from './ws.js';

const PORT = Number(process.env.PORT ?? 4010);
const HOST = process.env.HOST ?? '0.0.0.0';
const LATENCY_MS = Number(process.env.MOCK_LATENCY_MS ?? 0);
const SPEED = Number(process.env.MOCK_WS_SPEED ?? 1);
const STRICT = process.env.MOCK_STRICT === '1';
// websocket.md §1: `wss://api.halalgoes.com/v1/ws`. Not derived from `servers[]`, which
// carries no base path in this contract.
const WS_PATH = '/v1/ws';

const store = new FixtureStore();
const { routes, basePath } = loadRoutes();

const app = express();
app.use(cors({ origin: true, credentials: true, exposedHeaders: ['*'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: '*/*', limit: '1mb' }));

const log = (message: string) => console.log(`  ${message}`);

const ulid = (): string => {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < 26; i += 1) out += alphabet[Math.floor(Math.random() * 32)]!;
  return out;
};

function errorEnvelope(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details ? { details } : {}), request_id: ulid() } };
}

/** `?scenario=` wins over `X-Mock-Scenario:`, which wins over the `mock_scenario` cookie. */
function requestedScenario(req: Request): string | undefined {
  const query = req.query.scenario;
  if (typeof query === 'string' && query) return query;
  const header = req.get('X-Mock-Scenario');
  if (header) return header;
  const cookie = /(?:^|;\s*)mock_scenario=([^;]+)/.exec(req.get('cookie') ?? '');
  return cookie?.[1];
}

/* -------------------------------------------------------------------------- */
/* Introspection endpoints — everything under /__mock is the mock's own API.   */
/* -------------------------------------------------------------------------- */

app.get('/__mock/scenarios', (req, res) => {
  const domain = typeof req.query.domain === 'string' ? req.query.domain : undefined;
  const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
  const op = typeof req.query.operation === 'string' ? req.query.operation : undefined;
  let list = store.manifest.fixtures;
  if (domain) list = list.filter((f) => f.domain === domain);
  if (tag) list = list.filter((f) => (f.tags ?? []).includes(tag));
  if (op) list = list.filter((f) => f.operations.includes(op));
  res.json({
    data: list.map((f) => ({
      scenario: f.scenario,
      domain: f.domain,
      schema: f.schema,
      status: f.status,
      tags: f.tags ?? [],
      operations: f.operations,
      describes: f.describes,
    })),
    meta: { next_cursor: null, has_more: false, total: list.length },
  });
});

app.get('/__mock/scenarios/:scenario', (req, res) => {
  const fixture = store.get(req.params.scenario!);
  if (!fixture) {
    res.status(404).json(errorEnvelope('NOT_FOUND', `no scenario \`${req.params.scenario}\``));
    return;
  }
  res.json({ data: fixture });
});

app.get('/__mock/operations', (_req, res) => {
  res.json({
    data: routes.map((r) => ({
      operation_id: r.operationId,
      method: r.method,
      path: r.fullPath,
      version: r.version,
      roles: r.roles,
      success_status: r.successStatus,
      requires_idempotency_key: r.requiresIdempotencyKey,
      scenarios: store.byOperation.get(r.operationId) ?? [],
      default_scenario: store.defaultFor(r.operationId) ?? null,
    })),
    meta: { next_cursor: null, has_more: false, total: routes.length },
  });
});

app.post('/__mock/reload', (_req, res) => {
  store.load();
  res.json({ data: { reloaded: store.manifest.count } });
});

app.get('/__mock/health', (_req, res) => {
  res.json({
    data: {
      status: 'ok',
      fixtures: store.manifest.count,
      operations: routes.length,
      base_path: basePath,
      websocket: WS_PATH,
    },
  });
});

/* -------------------------------------------------------------------------- */
/* The contract surface                                                        */
/* -------------------------------------------------------------------------- */

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/__mock')) return next();

  const route = matchRoute(routes, req.method, req.path);
  if (!route) {
    // A route that is not in the contract does not exist. This is the ghost-endpoint gate:
    // a frontend that invents a path finds out here, not in staging.
    res
      .status(404)
      .json(
        errorEnvelope(
          'NOT_FOUND',
          `\`${req.method} ${req.path}\` is not an operation in contracts/openapi.yaml`,
        ),
      );
    return;
  }

  res.set('X-Mock-Operation-Id', route.operationId);
  res.set('X-Mock-Contract-Version', route.version);

  // Idempotency-Key is `required: true` on every money-mutating and durable-creating
  // operation, so a client that omits it must fail here rather than in production.
  if (STRICT && route.requiresIdempotencyKey && !req.get('Idempotency-Key')) {
    res
      .status(400)
      .json(
        errorEnvelope(
          'IDEMPOTENCY_KEY_REQUIRED',
          `\`${route.operationId}\` requires an Idempotency-Key header (16–128 chars).`,
        ),
      );
    return;
  }

  const requested = requestedScenario(req);
  const { fixture, source, warning } = store.resolve(route.operationId, requested);
  // A diagnostic must never take down the response it is diagnosing. Header values
  // are latin-1 only, so one typographic dash in a warning string threw
  // ERR_INVALID_CHAR inside res.set() and Express turned it into a 500 — on EVERY
  // request an app made, because the app sets its scenario once and globally. The
  // admin console could not sign in against fixtures for exactly this reason.
  if (warning) res.set('X-Mock-Warning', warning.replace(/[^\x20-\x7E]/g, '-'));

  if (!fixture) {
    if (route.noContent) {
      res.status(route.successStatus === 204 ? 204 : route.successStatus).end();
      return;
    }
    if (route.acknowledgement) {
      res.status(route.successStatus).json({ data: { acknowledged: true } });
      return;
    }
    res
      .status(501)
      .json(
        errorEnvelope(
          'INTERNAL_ERROR',
          `no fixture is registered for \`${route.operationId}\`. ` +
            (warning ?? 'Add one in contracts/fixtures/_build and run `pnpm fixtures:build`.'),
        ),
      );
    return;
  }

  res.set('X-Mock-Scenario', fixture.scenario);
  res.set('X-Mock-Scenario-Source', source);

  const respond = () => {
    // An error fixture is served with its own status and its own envelope shape.
    if (fixture.schema === 'ErrorEnvelope') {
      res.status(fixture.status).json(fixture.payload);
      return;
    }

    const status = requested ? fixture.status : route.successStatus;
    if (status === 204 || route.noContent) {
      res.status(204).end();
      return;
    }

    const body: Record<string, unknown> = { data: fixture.payload };
    if (fixture.meta !== undefined && fixture.meta !== null) {
      body.meta = fixture.meta;
    } else if (route.isCollection && Array.isArray(fixture.payload)) {
      // Every collection response carries meta. A fixture that forgot one still gets a
      // well-formed envelope rather than a body the client's types reject.
      body.meta = { next_cursor: null, has_more: false, total: fixture.payload.length };
    }

    // Replays are byte-identical and flagged. Nothing here is stateful — it is a hint so
    // the client's replay branch is reachable in development.
    if (req.get('Idempotency-Key') && req.get('X-Mock-Replay') === '1') {
      res.set('Idempotency-Replayed', 'true');
    }

    res.status(status).json(body);
  };

  if (LATENCY_MS > 0) setTimeout(respond, LATENCY_MS);
  else respond();
});

/* -------------------------------------------------------------------------- */

const server = createServer(app);
attachRealtime(server, {
  store,
  path: WS_PATH,
  speed: Number.isFinite(SPEED) ? SPEED : 1,
  log,
});

server.listen(PORT, HOST, () => {
  const origin = `http://localhost:${PORT}`;
  console.log('');
  console.log('HalalGoes mock server');
  console.log(`  REST         ${origin}${basePath || '/v1'}`);
  console.log(`  WebSocket    ws://localhost:${PORT}${WS_PATH}?ticket=dev`);
  console.log(`  operations   ${routes.length} from contracts/openapi.yaml`);
  console.log(`  fixtures     ${store.manifest.count} across ${Object.keys(store.manifest.counts_by_domain).length} domains`);
  console.log('');
  console.log(`  scenarios    ${origin}/__mock/scenarios`);
  console.log(`  operations   ${origin}/__mock/operations`);
  console.log(`  reload       curl -XPOST ${origin}/__mock/reload`);
  console.log('');
  console.log(`  pick a state: ${origin}/v1/orders/any?scenario=order_arrived`);
  console.log(`  or a header:  X-Mock-Scenario: order_arrived`);
  console.log('');
});
