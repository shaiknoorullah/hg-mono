/**
 * The capture entry: how a design board's screen is opened in its state, for the native captures
 * (https://github.com/shaiknoorullah/hg-mono/issues/1141). Dev builds only; see `./index.ts`.
 *
 *   hgrider://__capture?board=<area>/<Board>&route=<name>&params=<json>&scenario=<map>&clock=<iso>
 *
 * It is a navigator and session shim, not a screen. It does four things and renders nothing:
 *
 *   1. puts a fixture session in the token holder (or none, for the sign-in screen);
 *   2. sets the mock scenario the API clients send (`../../mockScenario`), a name or a
 *      per-operation map (tools/mock-server/README.md, "Picking a state");
 *   3. moves the app's clock to the fixtures' frozen clock (`clock`, else the mock's own answer);
 *   4. hands the route to `CaptureFollower`, inside the navigator, which opens it with the app's
 *      own navigation (`useNav`): a tab root switches tab, a flow root opens the flow, any other
 *      registered screen is pushed.
 *
 * Every screen, hook and request after that is the real one. Which screen the rider sees first is
 * the session gate's, from `getRiderMe` under the scenario (suspended, update required and the
 * rest are scenarios, not routes). A route that has no registered screen opens nothing and logs
 * why. `board` only names the capture in that log.
 */
import * as React from 'react';
import { Linking } from 'react-native';

import { API_BASE_URL } from '../../api';
import { setMockScenario } from '../../mockScenario';
import { setToken } from '../../token';
import { useNav } from '../nav/Navigator';
import { screenFor } from '../nav/registry';
import { offsetClockTo } from './clock';

/** `hgrider://__capture?...`, the scheme in app.config.js. */
const CAPTURE_URL = /^hgrider:\/\/__capture(?:\?([^#]*))?(?:#.*)?$/;

/** The token the mock accepts for any bearer; the scenario decides who the rider is. */
const FIXTURE_ACCESS_TOKEN = 'capture-fixture-access';
const FIXTURE_REFRESH_TOKEN = 'capture-fixture-refresh';

/** Routes the session gate renders by itself, from `getRiderMe`; they are not navigated to. */
const GATE_ROUTES: ReadonlySet<string> = new Set(['splash', 'suspended', 'terminal']);
const TAB_ROUTES: ReadonlySet<string> = new Set(['home', 'earnings', 'account']);
const FLOW_ROUTES: ReadonlySet<string> = new Set(['trip', 'application']);

export interface CaptureTarget {
  name: string;
  params: Record<string, unknown> | undefined;
}

export interface CaptureRequest {
  board: string | null;
  /** null: the signed-out sign-in screen. */
  target: CaptureTarget | null;
  scenario: string | undefined;
  clock: string | undefined;
}

export type Parsed = { ok: true; request: CaptureRequest } | { ok: false; why: string };

/**
 * Read a capture link. Pure: no side effect, so a bad link changes nothing. A route is valid when
 * a screen is registered for it (`registerScreen`) or it is `signIn`; the registry is filled when
 * the app starts (`../screens`).
 */
export function parseCaptureUrl(url: string | null | undefined): Parsed | null {
  const match = url ? CAPTURE_URL.exec(url.trim()) : null;
  if (!match) return null;
  const query = new URLSearchParams(match[1] ?? '');
  const board = query.get('board');
  const fail = (why: string): Parsed => ({ ok: false, why: `${board ?? 'capture link'}: ${why}` });

  const name = query.get('route');
  if (!name) return fail('no `route` in the link');
  if (GATE_ROUTES.has(name)) {
    return fail(`"${name}" is shown by the session gate from \`getRiderMe\`; pick the scenario that leads there`);
  }
  if (name !== 'signIn' && !screenFor(name as never)) return fail(`no screen is registered for the route "${name}"`);

  let params: Record<string, unknown> | undefined;
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
  const clock = query.get('clock') ?? undefined;
  if (clock !== undefined && Number.isNaN(Date.parse(clock))) return fail('`clock` is not a date');

  return {
    ok: true,
    request: {
      board,
      target: name === 'signIn' ? null : { name, params },
      scenario: query.get('scenario') || undefined,
      clock,
    },
  };
}

/* The route waiting for the navigator. A one-slot store: the follower takes it and empties it. */
let pending: CaptureTarget | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const getPending = (): CaptureTarget | null => pending;
function setPending(next: CaptureTarget | null): void {
  pending = next;
  for (const fn of listeners) fn();
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
 * Do what a capture link asks. Returns whether it was one that was acted on (false for any other
 * link, or a refused one, which logs why).
 */
export async function openCapture(url: string | null | undefined): Promise<boolean> {
  const parsed = parseCaptureUrl(url);
  if (!parsed) return false;
  if (!parsed.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[capture] nothing opened. ${parsed.why}`);
    return false;
  }
  const { board, target, scenario, clock } = parsed.request;

  setMockScenario(scenario);
  const at = clock ?? (await mockFrozenClock());
  if (at && !Number.isNaN(Date.parse(at))) offsetClockTo(Date.parse(at));
  // eslint-disable-next-line no-console
  else console.warn('[capture] the clock stays the phone\'s: no `clock` in the link and the mock gave none');

  setPending(null);
  if (!target) {
    setToken(null);
    return true;
  }
  // The fixture session. The session gate then reads `getRiderMe` under the scenario.
  setToken(FIXTURE_ACCESS_TOKEN, FIXTURE_REFRESH_TOKEN);
  setPending(target);
  // eslint-disable-next-line no-console
  console.info(`[capture] ${board ?? target.name}: ${JSON.stringify(target)}${scenario ? ` · ${scenario}` : ''}`);
  return true;
}

/** Listens for capture links for the life of the app. Rendered once, at the root, in a capture build. */
export function CaptureLink(): null {
  React.useEffect(() => {
    let live = true;
    void Linking.getInitialURL()
      .then((url) => (live ? openCapture(url) : undefined))
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({ url }) => {
      void openCapture(url);
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return null;
}

/** Opens the waiting route with the navigator. Rendered inside it, in a capture build. */
export function CaptureFollower(): null {
  const nav = useNav();
  const target = React.useSyncExternalStore(subscribe, getPending, getPending);
  React.useEffect(() => {
    if (!target) return;
    setPending(null);
    const { name, params } = target;
    if (TAB_ROUTES.has(name)) {
      nav.closeFlow();
      nav.switchTab(name as never);
    } else if (FLOW_ROUTES.has(name)) {
      nav.openFlow(name as never, params as never);
    } else {
      nav.closeFlow();
      nav.switchTab('home');
      nav.popToRoot();
      nav.push(name as never, params as never);
    }
    // Only a new target is acted on, not every navigation it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return null;
}
