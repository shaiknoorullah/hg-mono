/**
 * The redesign's API client. It shares the session store with the legacy app (`lib/api.ts`),
 * so signing in on one is signing in on the other, but it handles a 401 the way a kitchen
 * screen must (manifest §0, WP1):
 *
 *   1. try `refreshSession` silently (web: `hg_rt` cookie + `X-HG-CSRF` double submit) and
 *      replay the request once;
 *   2. only if refresh fails, raise the in-page "Signed out" alert — never a hard redirect,
 *      so the orders on screen are not cleared.
 *
 * Every response's `Date` header feeds the server clock (countdowns use server time).
 */
import { createHgClient, type HgClient, type Schema } from '@hg/api-client';
import { getSession, setSession } from '../../lib/api';
import { observeServerDate } from './serverClock';

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
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
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
      setSession({ ...current, accessToken: body.data.access_token, accountId: body.data.principal.account_id });
      return true;
    }
    let code: string | undefined;
    try {
      code = ((await response.json()) as { error?: { code?: string } }).error?.code;
    } catch {
      /* non-JSON */
    }
    signOutLocally(code === 'REFRESH_REUSE_DETECTED' ? 'reuse-detected' : 'expired');
    return false;
  } catch {
    // Offline: the access token is dead and the refresh could not be tried. That is "signed
    // out" for the purpose of the next request; the alert offers Sign in again.
    signOutLocally('expired');
    return false;
  }
}

let signedOutRaised = false;

function signOutLocally(reason: SignedOutReason) {
  if (signedOutRaised) return;
  signedOutRaised = true;
  setSession(null);
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
