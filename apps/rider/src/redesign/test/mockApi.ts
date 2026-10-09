/**
 * Screen tests against the contract's own fixtures, in process.
 *
 * `mockApi({ getCurrentOffer: 'offer_pending', acceptOffer: 'error_offer_expired' })` answers
 * every request the app makes from `contracts/fixtures`, choosing the fixture per operation
 * (rider manifest §6: "set the scenario per operation, not one header for the whole app"). An
 * operation not named gets its contract default (`fixtures/index.json` `defaults`), exactly as
 * `pnpm mock` would. The route table is read from `contracts/openapi.yaml`, so a path the
 * contract does not have is a 404 here too.
 *
 * A scenario may also be:
 * - `'offline'`: the fetch rejects (transport failure);
 * - `'pending'`: the fetch never settles (loading states);
 * - `{ status, body }`: a literal answer, for a state the fixture set does not have yet. Build it
 *   from a real fixture (`payload('rider_me')` with one field changed) and file the fixture
 *   request; never invent a shape;
 * - a function of the request, returning any of the above, for sequences ("first 422, then 200").
 *
 * Moved to `@hg/ui-native/testing` when the orchestrator ships the shared shim (§5.1).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, enc: 'utf8'): string };
const path = require('path') as { join(...p: string[]): string };

const REPO = path.join(__dirname, '..', '..', '..', '..', '..');
const CONTRACT = path.join(REPO, 'contracts', 'openapi.yaml');
const FIXTURES = path.join(REPO, 'contracts', 'fixtures');

export type OperationId = string;

export interface MockCall {
  operationId: OperationId;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

/** A literal answer, for a state the fixture set lacks: derive it from a real fixture (`payload`). */
export interface Literal {
  status: number;
  body: unknown;
}

export type ScenarioChoice = string | Literal | ((call: MockCall, nth: number) => string | Literal);

interface Route {
  method: string;
  regexp: RegExp;
  operationId: string;
}

interface FixtureMeta {
  scenario: string;
  operations: string[];
  status: number;
  schema: string;
  file: string;
}

let routes: Route[] | null = null;
let index: { defaults: Record<string, string>; fixtures: FixtureMeta[] } | null = null;
const loaded = new Map<string, { status: number; schema: string; payload: unknown; meta?: unknown }>();

function loadRoutes(): Route[] {
  if (routes) return routes;
  const lines = fs.readFileSync(CONTRACT, 'utf8').split('\n');
  const out: Route[] = [];
  let currentPath: string | null = null;
  let currentMethod: string | null = null;
  let inPaths = false;
  for (const line of lines) {
    if (line === 'paths:') {
      inPaths = true;
      continue;
    }
    if (inPaths && /^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      currentPath = p[1]!;
      currentMethod = null;
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) {
      currentMethod = m[1]!.toUpperCase();
      continue;
    }
    const o = /^ {6}operationId:\s*(\w+)/.exec(line);
    if (o && currentPath && currentMethod) {
      const source = currentPath.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{[^}]+\\?\}/g, '[^/]+');
      out.push({ method: currentMethod, regexp: new RegExp(`^${source}$`), operationId: o[1]! });
    }
  }
  // Literal segments beat parameters: `/offers/current` before `/offers/{id}`.
  const params = (r: Route) => r.regexp.source.split('[^/]+').length;
  out.sort((a, b) => params(a) - params(b));
  routes = out;
  return out;
}

function loadIndex(): NonNullable<typeof index> {
  index ??= JSON.parse(fs.readFileSync(path.join(FIXTURES, 'index.json'), 'utf8'));
  return index!;
}

export function fixture(scenario: string): { status: number; schema: string; payload: any; meta?: unknown } {
  const hit = loaded.get(scenario);
  if (hit) return hit;
  const meta = loadIndex().fixtures.find((f) => f.scenario === scenario);
  if (!meta) throw new Error(`mockApi: no fixture named \`${scenario}\``);
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, meta.file), 'utf8'));
  const f = { status: raw.status ?? meta.status, schema: raw.schema ?? meta.schema, payload: raw.payload, meta: raw.meta };
  loaded.set(scenario, f);
  return f;
}

/** The payload of a fixture, for building expectations or `useApiQuery` seeds. */
export function payload<T = any>(scenario: string): T {
  return JSON.parse(JSON.stringify(fixture(scenario).payload)) as T;
}

function queryOf(url: URL): Record<string, string> {
  const q: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    q[k] = v;
  });
  return q;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export interface MockApi {
  calls: MockCall[];
  /** Calls to one operation, in order. */
  callsTo(operationId: OperationId): MockCall[];
  /** Change a scenario mid-test. */
  set(operationId: OperationId, choice: ScenarioChoice): void;
  restore(): void;
}

export function mockApi(choices: Record<OperationId, ScenarioChoice> = {}): MockApi {
  const table = loadRoutes();
  const { defaults } = loadIndex();
  const current = { ...choices };
  const calls: MockCall[] = [];
  const counts = new Map<string, number>();

  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const req: Request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const route = table.find((r) => r.method === req.method && r.regexp.test(url.pathname));
    if (!route) {
      return json(404, { error: { code: 'NOT_FOUND', message: `${req.method} ${url.pathname} is not in the contract` } });
    }
    let body: unknown;
    const text = req.method === 'GET' || req.method === 'DELETE' ? '' : await req.clone().text();
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = text;
    }
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const call: MockCall = {
      operationId: route.operationId,
      method: req.method,
      path: url.pathname,
      query: queryOf(url),
      headers,
      body,
    };
    calls.push(call);
    const nth = counts.get(route.operationId) ?? 0;
    counts.set(route.operationId, nth + 1);

    const choice = current[route.operationId];
    const scenario = typeof choice === 'function' ? choice(call, nth) : choice ?? defaults[route.operationId];
    if (typeof scenario === 'object') return json(scenario.status, scenario.body);
    if (scenario === 'offline') throw new TypeError('Network request failed');
    if (scenario === 'pending') return new Promise<Response>(() => {});
    if (!scenario) return new Response(null, { status: 204 });
    const f = fixture(scenario);
    if (f.schema === 'ErrorEnvelope') return json(f.status, f.payload);
    const out: Record<string, unknown> = { data: f.payload };
    if (f.meta != null) out.meta = f.meta;
    else if (Array.isArray(f.payload)) out.meta = { next_cursor: null, has_more: false, total: f.payload.length };
    return json(f.status >= 200 && f.status < 300 ? f.status : 200, out);
  });

  return {
    calls,
    callsTo: (op) => calls.filter((c) => c.operationId === op),
    set: (op, choice) => {
      current[op] = choice;
    },
    restore: () => spy.mockRestore(),
  };
}
