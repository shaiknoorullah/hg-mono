/**
 * A contract-shaped stand-in for the API, installed as the global `fetch`.
 *
 *     let api: MockApi;
 *     beforeEach(() => { api = mockApi({ listOrdersAdmin: 'order_list_active' }); });
 *
 * Each request is matched to a contract operation with the mock server's own route table
 * (`tools/mock-server/src/routes.ts`) and answered from `contracts/fixtures` in the same
 * envelope `pnpm mock` serves: `{ data }` (+ `meta` for collections), error fixtures as-is
 * with their own status, 204 with no body, and a path that is not in the contract gets a 404
 * `NOT_FOUND`. Every request is recorded, so a test can assert on what was SENT.
 *
 * The redesign client (`data/api.ts`) looks `fetch` up per call, so stubbing it after the
 * module loaded is enough.
 */
import { vi } from 'vitest';

import { contractRoutes, fixtureStore, type Route } from './contract';

export interface MockRequest {
  readonly operationId: string;
  readonly method: string;
  /** The request path, e.g. `/v1/admin/orders/0f…/cancel`. */
  readonly path: string;
  /** Path parameters by the contract's names, e.g. `{ orderId: '0f…' }`. */
  readonly params: Record<string, string>;
  /** Query parameters; a repeated key becomes an array. */
  readonly query: Record<string, string | string[]>;
  /** The parsed JSON body (raw text when it is not JSON; `undefined` when there is none). */
  readonly body: unknown;
  /** Request headers, lower-cased names (`idempotency-key`, `authorization`, …). */
  readonly headers: Record<string, string>;
}

/** An explicit response: any status, any body. `body: undefined` sends no body. */
export interface StatusReply {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** A success envelope served with the operation's success status. */
export interface DataReply {
  readonly data: unknown;
  readonly meta?: unknown;
}

/** Never answers: the screen stays in its loading state. */
export interface PendingReply {
  readonly pending: true;
}

/** Answers `reply` (default: the operation's default fixture) after `delay` ms. */
export interface DelayedReply {
  readonly delay: number;
  readonly reply?: Exclude<Reply, DelayedReply>;
}

/** A fixture scenario name from `contracts/fixtures/index.json`. */
export type ScenarioName = string;

export type Reply = ScenarioName | StatusReply | DataReply | PendingReply | DelayedReply;

export type ReplyFn = (req: MockRequest) => Reply | undefined | Promise<Reply | undefined>;

/** `undefined` from a function means "serve the operation's default fixture". */
export type Override = Reply | ReplyFn;

export type Overrides = Partial<Record<string, Override>>;

export interface MockCall extends MockRequest {}

export interface MockApi {
  /** Every request, in order. Unknown routes are recorded with `operationId: '(not in contract)'`. */
  readonly calls: MockCall[];
  /** Calls to one operation, in order. */
  callsTo(operationId: string): MockCall[];
  /** Adds or replaces overrides (merged over the current ones). `undefined` restores the default. */
  set(overrides: Overrides): void;
  /** The installed `fetch` mock. */
  readonly fetch: ReturnType<typeof vi.fn>;
}

export const NOT_IN_CONTRACT = '(not in contract)';

let requestSeq = 0;
const requestId = () => `01JTESTREQ${String(++requestSeq).padStart(16, '0')}`;

function errorEnvelope(code: string, message: string) {
  return { error: { code, message, request_id: requestId() } };
}

function json(status: number, body: unknown, url: string, extra?: Record<string, string>): Response {
  const noBody = body === undefined || status === 204 || status === 205 || status === 304;
  const response = new Response(noBody ? null : JSON.stringify(body), {
    status,
    headers: { ...(noBody ? {} : { 'content-type': 'application/json' }), ...extra },
  });
  // A real response carries its URL (`data/api.ts` reads it on a 401).
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

function assertKnownScenario(operationId: string, override: Override | undefined): void {
  if (typeof override === 'string' && !fixtureStore().get(override)) {
    throw new Error(`mockApi(): \`${operationId}\` names unknown scenario \`${override}\` (see contracts/fixtures/index.json)`);
  }
  if (override && typeof override === 'object' && 'delay' in override) {
    assertKnownScenario(operationId, override.reply);
  }
}

function assertKnownOperation(operationId: string): void {
  if (!contractRoutes().some((r) => r.operationId === operationId)) {
    throw new Error(`mockApi(): \`${operationId}\` is not an operationId in contracts/openapi.yaml`);
  }
}

/** The answer `pnpm mock` gives for `scenario` (or the operation's default when undefined). */
function fromFixture(route: Route, scenario: string | undefined, url: string): Response {
  const store = fixtureStore();
  const fixture = scenario ? store.get(scenario) : store.resolve(route.operationId, undefined).fixture;
  const headers: Record<string, string> = { 'X-Mock-Operation-Id': route.operationId };

  if (!fixture) {
    if (route.noContent) return json(route.successStatus === 204 ? 204 : route.successStatus, undefined, url, headers);
    if (route.acknowledgement) return json(route.successStatus, { data: { acknowledged: true } }, url, headers);
    return json(
      501,
      errorEnvelope('INTERNAL_ERROR', `no fixture is registered for \`${route.operationId}\``),
      url,
      headers,
    );
  }
  headers['X-Mock-Scenario'] = fixture.scenario;

  if (fixture.schema === 'ErrorEnvelope') return json(fixture.status, structuredClone(fixture.payload), url, headers);

  const status = scenario ? fixture.status : route.successStatus;
  if (status === 204 || route.noContent) return json(204, undefined, url, headers);

  const body: Record<string, unknown> = { data: structuredClone(fixture.payload) };
  if (fixture.meta !== undefined && fixture.meta !== null) body.meta = structuredClone(fixture.meta);
  else if (route.isCollection && Array.isArray(fixture.payload)) {
    body.meta = { next_cursor: null, has_more: false, total: fixture.payload.length };
  }
  return json(status, body, url, headers);
}

function never(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });
}

async function answer(
  route: Route,
  reply: Reply | undefined,
  url: string,
  signal: AbortSignal | null | undefined,
): Promise<Response> {
  if (reply === undefined) return fromFixture(route, undefined, url);
  if (typeof reply === 'string') {
    if (!fixtureStore().get(reply)) {
      return json(500, errorEnvelope('INTERNAL_ERROR', `mockApi: unknown scenario \`${reply}\``), url);
    }
    return fromFixture(route, reply, url);
  }
  if ('pending' in reply) return never(signal);
  if ('delay' in reply) {
    await new Promise((resolve) => setTimeout(resolve, reply.delay));
    return answer(route, reply.reply, url, signal);
  }
  if ('status' in reply) return json(reply.status, reply.body, url, reply.headers);
  const body: Record<string, unknown> = { data: reply.data };
  if (reply.meta !== undefined) body.meta = reply.meta;
  else if (route.isCollection && Array.isArray(reply.data)) {
    body.meta = { next_cursor: null, has_more: false, total: reply.data.length };
  }
  return json(route.noContent ? 200 : route.successStatus, body, url);
}

function parseQuery(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of params) {
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

function parseBody(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Installs the mock as the global `fetch` (via `vi.stubGlobal`; `vi.unstubAllGlobals()` or the
 * next `mockApi()` replaces it). Overrides are keyed by operationId; an operation with no
 * override serves its default fixture, exactly as `pnpm mock` does.
 */
export function mockApi(overrides: Overrides = {}): MockApi {
  let current: Overrides = {};
  const calls: MockCall[] = [];

  const set = (next: Overrides) => {
    for (const [op, override] of Object.entries(next)) {
      assertKnownOperation(op);
      assertKnownScenario(op, override);
    }
    current = { ...current, ...next };
  };
  set(overrides);

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request && init === undefined ? input : new Request(input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const body = method === 'GET' || method === 'HEAD' ? undefined : parseBody(await request.clone().text());
    const query = parseQuery(url.searchParams);

    const route = contractRoutes().find((r) => r.method === method && r.regexp.test(url.pathname));
    if (!route) {
      calls.push({ operationId: NOT_IN_CONTRACT, method, path: url.pathname, params: {}, query, body, headers });
      return json(
        404,
        errorEnvelope('NOT_FOUND', `\`${method} ${url.pathname}\` is not an operation in contracts/openapi.yaml`),
        request.url,
      );
    }

    const match = route.regexp.exec(url.pathname);
    const params: Record<string, string> = {};
    route.paramNames.forEach((name, i) => {
      params[name] = decodeURIComponent(match?.[i + 1] ?? '');
    });

    const call: MockCall = { operationId: route.operationId, method, path: url.pathname, params, query, body, headers };
    calls.push(call);

    const override = current[route.operationId];
    const reply = typeof override === 'function' ? await override(call) : override;
    return answer(route, reply, request.url, request.signal);
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    calls,
    callsTo: (operationId) => calls.filter((c) => c.operationId === operationId),
    set,
    fetch: fetchMock,
  };
}
