/**
 * Fixture-backed API for redesign screen tests (manifest WP0 test kit; MASTER-PLAN §5.1 layer A).
 *
 * `mockApi({ getOrder: 'order_preparing' })` routes every request the redesign client makes to the
 * contract's fixtures by operationId, exactly as `tools/mock-server` does: the route table comes
 * from `contracts/openapi.yaml`, the fixtures and per-operation defaults from
 * `contracts/fixtures/index.json`. An operation can instead answer with an error that has no
 * fixture yet (`{ status: 403, code: 'ACCOUNT_SUSPENDED' }`), with a raw body, or never (`'hang'`,
 * for loading states). Every call is recorded for assertions ("the request never carries a
 * price").
 *
 * When the orchestrator's shared `@hg/ui-native/testing` `mockApi` lands (MASTER-PLAN §5.1), this
 * file becomes a re-export of it.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { setApiFetch } from '../api/client';

// The app has no Node type declarations (it ships to phones); the few Node calls jest makes here
// are typed by hand.
declare const __dirname: string;
declare const require: (id: string) => any;
const fs = require('fs') as { readFileSync: (p: string, enc: 'utf8') => string };
const path = require('path') as { resolve: (...p: string[]) => string; join: (...p: string[]) => string };

const REPO = path.resolve(__dirname, '../../../../..');
const CONTRACT = path.join(REPO, 'contracts/openapi.yaml');
const FIXTURES = path.join(REPO, 'contracts/fixtures');

interface RouteEntry {
  operationId: string;
  method: string;
  regexp: RegExp;
  noContent: boolean;
  isCollection: boolean;
  successStatus: number;
}

interface FixtureFile {
  scenario: string;
  schema: string;
  status: number;
  meta?: unknown;
  payload: unknown;
}

let routes: RouteEntry[] | null = null;
let manifest: { fixtures: { scenario: string; file: string }[]; by_operation: Record<string, string[]>; defaults: Record<string, string> } | null =
  null;

function loadRoutes(): RouteEntry[] {
  if (routes) return routes;
  // Parse the contract in a plain Node child: the `yaml` package ships as ESM for jest's resolver.
  const { execFileSync } = require('child_process') as {
    execFileSync: (file: string, args: string[], opts: { encoding: 'utf8'; maxBuffer: number }) => string;
  };
  const script =
    "const {parse}=require(require.resolve('yaml',{paths:[process.argv[1]]}));" +
    "process.stdout.write(JSON.stringify(parse(require('fs').readFileSync(process.argv[2],'utf8'))))";
  const spec = JSON.parse(
    execFileSync((process as unknown as { execPath: string }).execPath, ['-e', script, path.join(REPO, 'tools/mock-server'), CONTRACT], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
  const base = new URL(spec.servers?.[0]?.url ?? 'http://x/v1').pathname.replace(/\/$/, '');
  const out: RouteEntry[] = [];
  for (const [template, methods] of Object.entries<any>(spec.paths ?? {})) {
    for (const [method, op] of Object.entries<any>(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const full = template.startsWith(base) ? template : `${base}${template}`;
      const regexp = new RegExp(`^${full.replace(/\{[^}]+\}/g, '[^/]+')}$`);
      const code = Object.keys(op.responses ?? {}).filter((c) => /^2\d\d$/.test(c)).sort()[0] ?? '200';
      const schema = op.responses?.[code]?.content?.['application/json']?.schema;
      out.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        regexp,
        successStatus: Number(code),
        noContent: !schema,
        isCollection: schema?.properties?.data?.type === 'array',
      });
    }
  }
  // Fewer path parameters first: `/v1/orders/active` must win over `/v1/orders/{orderId}`.
  const params = (r: RouteEntry) => r.regexp.source.split('[^/]+').length;
  out.sort((a, b) => params(a) - params(b));
  routes = out;
  return out;
}

function loadManifest(): NonNullable<typeof manifest> {
  manifest ??= JSON.parse(fs.readFileSync(path.join(FIXTURES, 'index.json'), 'utf8'));
  return manifest!;
}

export function fixture(scenario: string): FixtureFile {
  const entry = loadManifest().fixtures.find((f) => f.scenario === scenario);
  if (!entry) throw new Error(`mockApi: no fixture named ${scenario}`);
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, entry.file), 'utf8')) as FixtureFile;
}

/** The fixture's payload, for building props or expectations in a test. */
export function payloadOf<T = any>(scenario: string): T {
  return fixture(scenario).payload as T;
}

export type MockAnswer =
  /** A fixture scenario name. */
  | string
  /** An error envelope that has no fixture yet (optionally with response headers, e.g. Retry-After). */
  | { status: number; code: string; message?: string; details?: unknown; headers?: Record<string, string> }
  /** A raw body. */
  | { status: number; body: unknown; headers?: Record<string, string> }
  /** Never answers (loading states). */
  | 'hang'
  /** A transport failure (offline). */
  | 'offline'
  /** Different answers for successive calls. */
  | MockAnswer[];

export interface RecordedCall {
  operationId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockApi {
  calls: RecordedCall[];
  callsTo: (operationId: string) => RecordedCall[];
  /** Change an operation's answer mid-test. */
  answer: (operationId: string, answer: MockAnswer) => void;
  restore: () => void;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function mockApi(answers: Record<string, MockAnswer> = {}): MockApi {
  const table = { ...answers };
  const seen = new Map<string, number>();
  const calls: RecordedCall[] = [];

  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const route = loadRoutes().find((r) => r.method === request.method && r.regexp.test(url.pathname));
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => {
      headers[k] = v;
    });
    if (!route) return json(404, { error: { code: 'NOT_FOUND', message: `not in contract: ${request.method} ${url.pathname}` } });
    calls.push({ operationId: route.operationId, method: request.method, url: request.url, headers, body: text ? JSON.parse(text) : undefined });

    let answer: MockAnswer | undefined = table[route.operationId];
    if (Array.isArray(answer)) {
      const n = seen.get(route.operationId) ?? 0;
      seen.set(route.operationId, n + 1);
      answer = answer[Math.min(n, answer.length - 1)];
    }
    if (answer === 'hang') return new Promise<Response>(() => {});
    if (answer === 'offline') throw new TypeError('Network request failed');
    if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
      if ('body' in answer) return json(answer.status, answer.body, answer.headers);
      return json(
        answer.status,
        { error: { code: answer.code, message: answer.message ?? answer.code, request_id: 'TEST', details: answer.details } },
        answer.headers,
      );
    }
    const m = loadManifest();
    const scenario =
      (typeof answer === 'string' ? answer : undefined) ??
      m.defaults[route.operationId] ??
      m.by_operation[route.operationId]?.find((s) => fixture(s).status < 300);
    if (!scenario) {
      if (route.noContent) return json(204, null);
      return json(501, { error: { code: 'INTERNAL_ERROR', message: `no fixture for ${route.operationId}` } });
    }
    const f = fixture(scenario);
    if (f.schema === 'ErrorEnvelope') return json(f.status, f.payload);
    if (route.noContent || route.successStatus === 204) return json(204, null);
    const body: Record<string, unknown> = { data: f.payload };
    if (f.meta != null) body.meta = f.meta;
    else if (route.isCollection && Array.isArray(f.payload)) body.meta = { next_cursor: null, has_more: false, total: f.payload.length };
    return json(route.successStatus, body);
  };

  setApiFetch(respond);
  // openapi-fetch retries after a 401 through the global fetch; keep that inside the mock too.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    respond(input instanceof Request ? input : new Request(String(input), init))) as typeof fetch;

  return {
    calls,
    callsTo: (op) => calls.filter((c) => c.operationId === op),
    answer: (op, a) => {
      table[op] = a;
      seen.delete(op);
    },
    restore: () => {
      setApiFetch(null);
      globalThis.fetch = realFetch;
    },
  };
}
