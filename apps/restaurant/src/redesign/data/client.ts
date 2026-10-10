/**
 * The redesign's API client. It shares the in-memory session with the legacy screens it still
 * hosts (`lib/api.ts`), but it handles a 401 the way a kitchen screen must (manifest §0, WP1):
 *
 *   1. try `refreshSession` silently (web: `hg_rt` cookie + `X-HG-CSRF` double submit) and
 *      replay the request once;
 *   2. only if refresh fails, raise the in-page "Signed out" alert — never a hard redirect,
 *      so the orders on screen are not cleared.
 *
 * Every response's `Date` header feeds the server clock (countdowns use server time).
 */
import { createHgClient, type HgClient, type Schema } from '@hg/api-client';
import { getSession, setSession, type StoredSession } from '../../lib/api';
import { observeServerDate } from './serverClock';

/**
 * The access token lives in memory only (WP2 spec §1.12, "Access token in memory only"). The
 * legacy store (`lib/api.ts`) mirrors every session into `localStorage` for development against
 * the mock server; the redesign drops that mirror whenever it stores a session, and once at
 * start-up after `lib/api.ts` has read it, so a token never outlives the tab on a shared kitchen
 * tablet and no script on the origin can read it back. A reload restores the session from the
 * `hg_rt` cookie instead (`restoreSession`; on `services/hg` today that refresh cannot read the
 * `hg_csrf` cookie cross-origin, #740, so a reload means signing in again).
 */
const LEGACY_MIRROR_KEY = 'hg_restaurant_session_v1';

function dropStoredMirror(): void {
  try {
    localStorage.removeItem(LEGACY_MIRROR_KEY);
  } catch {
    /* storage blocked: nothing was stored */
  }
}

dropStoredMirror();

/** Stores (or clears) the session in memory, never in `localStorage`. */
export function keepSession(next: StoredSession | null): void {
  setSession(next);
  dropStoredMirror();
}

export const API_BASE_URL: string = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:4010';

export type SignedOutReason = 'expired' | 'reuse-detected';

type SignedOutListener = (reason: SignedOutReason) => void;
const signedOutListeners = new Set<SignedOutListener>();

/** The shell subscribes to raise the blocking "Signed out" alert. */
export function onSignedOut(fn: SignedOutListener): () => void {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

function readCookie(name: string): string | null {
  try {
    const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
  } catch {
    return null;
  }
}

/** Cookies (`hg_rt`, `hg_csrf`) only travel on the auth routes, so only those carry credentials. */
const fetchWithCookies: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const req = url.pathname.startsWith('/v1/auth/') ? new Request(request, { credentials: 'include' }) : request;
  const response = await fetch(req);
  observeServerDate(response.headers.get('Date'));
  return response;
};

let refreshInFlight: Promise<boolean> | null = null;

/**
 * One refresh at a time: a burst of 401s (the strip, the board and the heartbeat all fire at
 * once when the access token expires) shares a single `refreshSession` call, because the
 * refresh token rotates and a second concurrent use would trip reuse detection.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(true).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * A fresh visit with no session in memory (a reload, a new tab): try the `hg_rt` cookie once,
 * quietly. Nothing was on screen, so a refusal raises no "Signed out" alert; the caller sends
 * the visit to sign-in instead.
 */
export function restoreSession(): Promise<boolean> {
  if (getSession()) return Promise.resolve(true);
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(false).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(raiseSignedOut: boolean): Promise<boolean> {
  const csrf = readCookie('hg_csrf');
  try {
    const response = await fetchWithCookies(`${API_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-HG-Client': 'restaurant-web',
        ...(csrf ? { 'X-HG-CSRF': csrf } : {}),
      },
      body: '{}',
    });
    if (response.ok) {
      const body = (await response.json()) as { data: Schema['SessionGrant'] };
      const current = getSession();
      keepSession({ ...current, accessToken: body.data.access_token, accountId: body.data.principal.account_id });
      return true;
    }
    let code: string | undefined;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code;
    } catch {
      /* non-JSON */
    }
    if (raiseSignedOut) signOutLocally(code === 'REFRESH_REUSE_DETECTED' ? 'reuse-detected' : 'expired');
    return false;
  } catch {
    // Offline: the access token is dead and the refresh could not be tried. That is "signed
    // out" for the purpose of the next request; the alert offers Sign in again.
    if (raiseSignedOut) signOutLocally('expired');
    return false;
  }
}

let signedOutRaised = false;

function signOutLocally(reason: SignedOutReason) {
  if (signedOutRaised) return;
  signedOutRaised = true;
  keepSession(null);
  signedOutListeners.forEach((l) => l(reason));
}

/** Called after a fresh sign-in so a later expiry raises the alert again. */
export function resetSignedOut(): void {
  signedOutRaised = false;
}

export function createRedesignClient(fetchImpl: typeof fetch = fetchWithCookies): HgClient {
  return createHgClient({
    baseUrl: API_BASE_URL,
    clientSurface: 'restaurant-web',
    clientVersion: '0.1.0',
    fetch: fetchImpl,
    getToken: () => getSession()?.accessToken ?? null,
    onUnauthorized: async () => {
      // A 401 with no session is a wrong password on the sign-in form: not ours to handle.
      if (!getSession()) return false;
      return refreshAccessToken();
    },
  });
}

export const client: HgClient = createRedesignClient();
