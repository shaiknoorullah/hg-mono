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
import {
  CAPTURE_ACCESS_TOKEN,
  CAPTURE_REFRESH_TOKEN,
  adoptCaptureClock,
  captureRefusal,
  readCaptureQuery,
} from '@hg/api-client/capture';

import { API_BASE_URL } from '../../api/config';
import { setMockScenario } from '../../api/mockScenario';
import { setToken } from '../../api/token';
import { clearForced } from '../session/forced';
import { enterApp, enterProfileCapture } from '../session/session';
import type { Route, RouteName } from '../navigation/routes';

/** The scheme's host that means "capture", as in `hgcustomer://__capture?...`. */
const CAPTURE_URL = /^hgcustomer:\/\/__capture(?:\?([^#]*))?(?:#.*)?$/;

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
  hold: boolean;
}

export type Parsed = { ok: true; request: CaptureRequest } | { ok: false; why: string };

/** Read a capture link. Pure: no side effect, so a bad link changes nothing. */
export function parseCaptureUrl(url: string | null | undefined): Parsed | null {
  const match = url ? CAPTURE_URL.exec(url.trim()) : null;
  if (!match) return null;
  const query = new URLSearchParams(match[1] ?? '');
  const board = query.get('board');

  const name = query.get('route');
  if (!name) return captureRefusal(board, 'no `route` in the link');
  if (!Object.prototype.hasOwnProperty.call(ROUTES, name)) {
    return captureRefusal(board, `there is no route called "${name}"`);
  }
  if (INSIDE_SIGN_IN.has(name as RouteName)) {
    return captureRefusal(board, `"${name}" is a step inside the sign-in flow and cannot be opened from outside it`);
  }
  const read = readCaptureQuery(query);
  if (!read.ok) return read;
  const missing = (REQUIRED[name as RouteName] ?? []).filter((key) => typeof read.params?.[key] !== 'string' || read.params[key] === '');
  if (missing.length > 0) return captureRefusal(board, `route "${name}" needs ${missing.map((m) => `\`${m}\``).join(', ')}`);

  return { ok: true, request: { board, route: { name, ...read.params } as Route, scenario: read.scenario, clock: read.clock, hold: read.hold } };
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
  const { board, route, scenario, clock, hold } = parsed.request;

  setMockScenario(scenario);
  await adoptCaptureClock(API_BASE_URL, clock, hold);
  // Logged before any return below, signed-out routes included: the native capture runner
  // (tools/e2e/native/capture/run.mjs) reads this line from the phone's log to know the link was
  // acted on, and `nothing opened` above to know it was refused.
  // eslint-disable-next-line no-console
  console.info(`[capture] ${board ?? route.name}: ${JSON.stringify(route)}${scenario ? ` · ${scenario}` : ''}`);

  clearForced();
  if (route.name === 'signIn') {
    setToken(null);
    return null;
  }
  setToken(CAPTURE_ACCESS_TOKEN, CAPTURE_REFRESH_TOKEN);
  if (route.name === 'yourDetails') {
    enterProfileCapture();
    return null;
  }
  // The landing is Home; the shell opens `route` over it, the way it opens a deep link.
  enterApp();
  return route;
}
