/**
 * The capture entry: how a design board's screen is opened in its state, for the native captures
 * (https://github.com/shaiknoorullah/hg-mono/issues/1141). Dev builds only; see `./index.ts`.
 *
 *   hgcustomer://__capture?board=<area>/<Board>&route=<name>&params=<json>&scenario=<map>&clock=<iso>
 *
 * It is a navigator and session shim, not a screen. It does four things and renders nothing:
 *
 *   1. puts a fixture session in the token holder (or none, for the signed-out screens);
 *   2. sets the mock scenario the API client sends (`api/mockScenario.ts`), a name or a
 *      per-operation map (tools/mock-server/README.md, "Picking a state");
 *   3. moves the app's clock to the fixtures' frozen clock (`clock`, else the mock's own answer);
 *   4. hands the route to the shell, which opens it with the app's own navigation, exactly as it
 *      opens a deep link.
 *
 * Every screen, hook and request after that is the real one. A route that does not exist, or that
 * lacks a param, opens nothing and logs why. `board` only names the capture in that log.
 */
import { API_BASE_URL } from '../../api/config';
import { setMockScenario } from '../../api/mockScenario';
import { setToken } from '../../api/token';
import { clearForced } from '../session/forced';
import { enterApp, enterProfileCapture } from '../session/session';
import type { Route, RouteName } from '../navigation/routes';
import { offsetClockTo } from './clock';

/** The scheme's host that means "capture", as in `hgcustomer://__capture?...`. */
const CAPTURE_URL = /^hgcustomer:\/\/__capture(?:\?([^#]*))?(?:#.*)?$/;

/** The token the mock accepts for any bearer; the scenario decides who the principal is. */
const FIXTURE_ACCESS_TOKEN = 'capture-fixture-access';
const FIXTURE_REFRESH_TOKEN = 'capture-fixture-refresh';

/** Every route, so that adding one to `Route` fails the type check here until it is decided. */
const ROUTES: Record<RouteName, true> = {
  signIn: true,
  code: true,
  yourDetails: true,
  addressStep: true,
  signedOut: true,
  terms: true,
  home: true,
  search: true,
  orders: true,
  account: true,
  browse: true,
  howWeCheck: true,
  restaurant: true,
  certificate: true,
  cart: true,
  checkout: true,
  tracking: true,
  receipt: true,
  reportProblem: true,
  addresses: true,
  addressForm: true,
  notificationSettings: true,
  appSettings: true,
  whatsNew: true,
  emailVerify: true,
};

/** Params a route cannot be opened without. */
const REQUIRED: Partial<Record<RouteName, readonly string[]>> = {
  restaurant: ['restaurantId'],
  certificate: ['restaurantId'],
  tracking: ['orderId'],
  receipt: ['orderId'],
  reportProblem: ['orderId'],
  emailVerify: ['token'],
};

/** Steps inside the sign-in flow, which owns their state: they cannot be opened from outside it. */
const INSIDE_SIGN_IN: ReadonlySet<RouteName> = new Set(['code', 'signedOut', 'terms']);

export interface CaptureRequest {
  board: string | null;
  route: Route;
  scenario: string | undefined;
  clock: string | undefined;
}

export type Parsed = { ok: true; request: CaptureRequest } | { ok: false; why: string };

/** Read a capture link. Pure: no side effect, so a bad link changes nothing. */
export function parseCaptureUrl(url: string | null | undefined): Parsed | null {
  const match = url ? CAPTURE_URL.exec(url.trim()) : null;
  if (!match) return null;
  const query = new URLSearchParams(match[1] ?? '');
  const board = query.get('board');
  const fail = (why: string): Parsed => ({ ok: false, why: `${board ?? 'capture link'}: ${why}` });

  const name = query.get('route');
  if (!name) return fail('no `route` in the link');
  if (!Object.prototype.hasOwnProperty.call(ROUTES, name)) return fail(`there is no route called "${name}"`);
  if (INSIDE_SIGN_IN.has(name as RouteName)) {
    return fail(`"${name}" is a step inside the sign-in flow and cannot be opened from outside it`);
  }

  let params: Record<string, unknown> = {};
  const raw = query.get('params');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      params = parsed as Record<string, unknown>;
    } catch {
      return fail('`params` is not a JSON object');
    }
  }
  const missing = (REQUIRED[name as RouteName] ?? []).filter((key) => typeof params[key] !== 'string' || params[key] === '');
  if (missing.length > 0) return fail(`route "${name}" needs ${missing.map((m) => `\`${m}\``).join(', ')}`);

  const clock = query.get('clock') ?? undefined;
  if (clock !== undefined && Number.isNaN(Date.parse(clock))) return fail('`clock` is not a date');

  return {
    ok: true,
    request: {
      board,
      route: { name, ...params } as Route,
      scenario: query.get('scenario') || undefined,
      clock,
    },
  };
}

/** The instant the mock's fixtures are relative to (`GET /__mock/health`), or null if it cannot be read. */
async function mockFrozenClock(): Promise<string | null> {
  try {
    const res = await globalThis.fetch(`${API_BASE_URL}/__mock/health`);
    const body = (await res.json()) as { data?: { frozen_clock?: string | null } };
    return body.data?.frozen_clock ?? null;
  } catch {
    return null;
  }
}

/**
 * Do what a capture link asks and return the route for the shell to open (null when the link is
 * not a capture link, or is refused). Signed-out routes sign out and return null: the shell then
 * shows its own signed-out flow, and the sign-in screen is the first of it.
 */
export async function openCapture(url: string | null | undefined): Promise<Route | null> {
  const parsed = parseCaptureUrl(url);
  if (!parsed) return null;
  if (!parsed.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[capture] nothing opened. ${parsed.why}`);
    return null;
  }
  const { board, route, scenario, clock } = parsed.request;

  setMockScenario(scenario);
  const at = clock ?? (await mockFrozenClock());
  if (at && !Number.isNaN(Date.parse(at))) offsetClockTo(Date.parse(at));
  // eslint-disable-next-line no-console
  else console.warn('[capture] the clock stays the phone\'s: no `clock` in the link and the mock gave none');

  clearForced();
  if (route.name === 'signIn') {
    setToken(null);
    return null;
  }
  setToken(FIXTURE_ACCESS_TOKEN, FIXTURE_REFRESH_TOKEN);
  if (route.name === 'yourDetails') {
    enterProfileCapture();
    return null;
  }
  // The landing is Home; the shell opens `route` over it, the way it opens a deep link.
  enterApp();
  // eslint-disable-next-line no-console
  console.info(`[capture] ${board ?? route.name}: ${JSON.stringify(route)}${scenario ? ` · ${scenario}` : ''}`);
  return route;
}
