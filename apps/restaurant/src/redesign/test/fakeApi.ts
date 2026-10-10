/**
 * Test kit for redesigned screens: contract fixtures served through a fake `fetch`, so a test
 * exercises the real redesign client (auth header, 401 refresh-and-replay, `Date` header
 * clock) and the screen together. Keyed by `METHOD /path` (no query string); a handler may
 * be a fixture name, a `{ status, body }`, or a function of the request.
 *
 * Fixtures are the contract's own (`contracts/fixtures/**`): `{ status, payload }`, served as
 * the `{ data: payload }` envelope (or the error envelope for a 4xx/5xx fixture).
 */
import { vi } from 'vitest';

const FIXTURES = import.meta.glob('../../../../../contracts/fixtures/**/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { status?: number; payload?: unknown; scenario?: string }
>;

const BY_NAME = new Map<string, { status?: number; payload?: unknown }>();
for (const [path, fx] of Object.entries(FIXTURES)) {
  const name = path.split('/').pop()!.replace(/\.json$/, '');
  BY_NAME.set(name, fx);
}

/** The payload of a contract fixture, deep-copied so a test may patch it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are JSON; tests patch them freely
export function fixture(name: string): any {
  const fx = BY_NAME.get(name);
  if (!fx) throw new Error(`No contract fixture named ${name}`);
  return structuredClone(fx.payload);
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  /** `body` is wrapped as `{ data: body }` unless this is false. */
  envelope?: boolean;
  headers?: Record<string, string>;
}

export type Handler = string | FakeResponse | ((req: Request, call: number) => FakeResponse | Promise<FakeResponse>);

export interface FakeApi {
  calls: Request[];
  /** Calls to one route, e.g. `callsTo('POST /v1/restaurant/heartbeat')`. */
  callsTo: (route: string) => Request[];
  set: (route: string, handler: Handler) => void;
}

function toResponse(r: FakeResponse): Response {
  const status = r.status ?? 200;
  const body = status === 204 ? null : JSON.stringify(r.envelope === false || status >= 400 ? r.body : { data: r.body });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', Date: new Date().toUTCString(), ...(r.headers ?? {}) },
  });
}

export function errorBody(code: string, message = code) {
  return { error: { code, message, request_id: 'req_test' } };
}

/** Installs the fake `fetch`. Unknown routes answer 404 so a missing stub is loud. */
export function installFakeApi(routes: Record<string, Handler>): FakeApi {
  const table = new Map(Object.entries(routes));
  const calls: Request[] = [];
  const count = new Map<string, number>();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    calls.push(req.clone());
    const url = new URL(req.url);
    const key = `${req.method} ${url.pathname}`;
    const n = (count.get(key) ?? 0) + 1;
    count.set(key, n);
    const handler = table.get(key);
    if (handler === undefined) return toResponse({ status: 404, body: errorBody('NOT_FOUND', `no fake for ${key}`) });
    if (typeof handler === 'string') {
      const fx = BY_NAME.get(handler);
      if (!fx) throw new Error(`No contract fixture named ${handler}`);
      return toResponse({ status: fx.status ?? 200, body: structuredClone(fx.payload) });
    }
    if (typeof handler === 'function') return toResponse(await handler(req, n));
    return toResponse(handler);
  });
  vi.stubGlobal('fetch', fetchImpl);
  return {
    calls,
    callsTo: (route) => {
      const [method, path] = route.split(' ');
      return calls.filter((c) => c.method === method && new URL(c.url).pathname === path);
    },
    set: (route, handler) => table.set(route, handler),
  };
}

/** A restaurant owner's principal: the customer fixture re-scoped to a restaurant. */
export function restaurantPrincipal(restaurantId: string = fixture('restaurant_profile').id) {
  const p = fixture('principal_customer');
  return {
    ...p,
    amr: 'pwd',
    roles: [{ role: 'RESTAURANT_OWNER', scope_type: 'RESTAURANT', scope_id: restaurantId }],
  };
}

/** The routes every console page reads, from the contract fixtures. */
export function consoleRoutes(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    'GET /v1/auth/me': { body: restaurantPrincipal() },
    'GET /v1/restaurant/onboarding/status': 'restaurant_onboarding_active',
    'GET /v1/restaurant/profile': 'restaurant_profile',
    'GET /v1/config/public': 'public_config',
    'GET /v1/restaurant/availability': 'restaurant_open_state_open',
    'POST /v1/restaurant/heartbeat': 'restaurant_heartbeat',
    'POST /v1/realtime/ticket': { status: 503, body: errorBody('SERVICE_UNAVAILABLE') },
    ...overrides,
  };
}
