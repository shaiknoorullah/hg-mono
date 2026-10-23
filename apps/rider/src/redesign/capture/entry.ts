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

import {
  CAPTURE_ACCESS_TOKEN,
  CAPTURE_REFRESH_TOKEN,
  adoptCaptureClock,
  captureRefusal,
  readCaptureQuery,
} from '@hg/api-client/capture';

import { API_BASE_URL } from '../../api';
import { setMockScenario } from '../../mockScenario';
import { setToken } from '../../token';
import { useNav } from '../nav/Navigator';
import { screenFor } from '../nav/registry';

/** `hgrider://__capture?...`, the scheme in app.config.js. */
const CAPTURE_URL = /^hgrider:\/\/__capture(?:\?([^#]*))?(?:#.*)?$/;

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

  const name = query.get('route');
  if (!name) return captureRefusal(board, 'no `route` in the link');
  if (GATE_ROUTES.has(name)) {
    return captureRefusal(board, `"${name}" is shown by the session gate from \`getRiderMe\`; pick the scenario that leads there`);
  }
  if (name !== 'signIn' && !screenFor(name as never)) {
    return captureRefusal(board, `no screen is registered for the route "${name}"`);
  }
  const read = readCaptureQuery(query);
  if (!read.ok) return read;
  const target = name === 'signIn' ? null : { name, params: read.params };
  return { ok: true, request: { board, target, scenario: read.scenario, clock: read.clock } };
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
  await adoptCaptureClock(API_BASE_URL, clock);
  // Logged before any return below, the sign-in screen included: the native capture runner
  // (tools/e2e/native/capture/run.mjs) reads this line from the phone's log to know the link was
  // acted on, and `nothing opened` above to know it was refused.
  // eslint-disable-next-line no-console
  console.info(`[capture] ${board ?? target?.name ?? 'signIn'}: ${JSON.stringify(target ?? { name: 'signIn' })}${scenario ? ` · ${scenario}` : ''}`);

  setPending(null);
  if (!target) {
    setToken(null);
    return true;
  }
  // The fixture session. The session gate then reads `getRiderMe` under the scenario.
  setToken(CAPTURE_ACCESS_TOKEN, CAPTURE_REFRESH_TOKEN);
  setPending(target);
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
