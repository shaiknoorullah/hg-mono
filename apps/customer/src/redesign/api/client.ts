/**
 * The customer redesign's API client.
 *
 * It shares the session with the legacy app (the same in-memory tokens in `src/api/token.ts`) and
 * adds what the redesign needs from one place:
 *
 * - **Forced routes.** Every error envelope passes `onError`; a session or account code
 *   (`ACCOUNT_SUSPENDED`, `SESSION_REVOKED`, …) raises the matching full-screen route, whatever
 *   screen made the call.
 * - **Connectivity.** A transport failure marks the app offline; any response marks it online.
 * - **Refresh.** On a 401 the refresh token is exchanged once (concurrent 401s share it). A refusal
 *   that names a cause (`REFRESH_REUSE_DETECTED`, `SESSION_REVOKED`, `SESSION_EXPIRED`) raises its
 *   route; any other failure clears the session, which returns the app to sign-in.
 * - **Mock scenarios, dev only.** `EXPO_PUBLIC_MOCK_SCENARIO` is forwarded as `X-Mock-Scenario`
 *   against `pnpm mock` for review builds; never in a release build (`__DEV__` is false there).
 * - **Tests.** `setApiFetch` swaps the transport for the fixture-backed one in `test/mockApi.ts`.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL } from '../../api/config';
import { getRefreshToken, getToken, setToken } from '../../api/token';
import { markOffline, markOnline } from '../lib/connectivity';
import { forcedKindForCode, raiseForced } from '../session/forced';

type Fetch = (input: Request) => Promise<Response>;

const defaultFetch: Fetch = (input) => globalThis.fetch(input);
let transport: Fetch = defaultFetch;

/** Tests only: route every request through `fetch`. Pass `null` to restore the network. */
export function setApiFetch(fetch: Fetch | null): void {
  transport = fetch ?? defaultFetch;
}

/**
 * Responses to the two checkout calls (createQuote, createOrder). A 403 ACCOUNT_SUSPENDED from one
 * of them raises the blocked route with "That order wasn't placed." (board SI/Blocked-midcheckout).
 * `onError` only sees the response, so the request it answered is remembered here.
 */
const checkoutResponses = new WeakSet<Response>();

/** POST /v1/quotes (createQuote) or POST /v1/orders (createOrder). */
export function isCheckoutRequest(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split('?')[0] ?? url;
  }
  return /\/v1\/(quotes|orders)\/?$/.test(pathname);
}

async function observedFetch(input: Request): Promise<Response> {
  try {
    const res = await transport(input);
    markOnline();
    if (isCheckoutRequest(input.method, input.url)) checkoutResponses.add(res);
    return res;
  } catch (e) {
    markOffline();
    throw e;
  }
}

/**
 * A POST straight through the transport, outside the shared session: no bearer from the token
 * holder, no refresh on a 401 and no forced route from the error. For calls about a session this
 * phone has already let go of (finishing a sign-out). Throws on a transport failure.
 */
export async function postDirect(
  path: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: unknown; code: string | null }> {
  const res = await observedFetch(
    new Request(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-HG-Client': 'customer-app',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const parsed = (await res.json().catch(() => null)) as { data?: unknown; error?: { code?: string } } | null;
  return { status: res.status, data: parsed?.data ?? null, code: parsed?.error?.code ?? null };
}

let inflight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) {
    setToken(null);
    return false;
  }
  try {
    // Straight through the transport, not `api`: a 401 here must not re-enter onUnauthorized.
    const res = await observedFetch(
      new Request(`${API_BASE_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-HG-Client': 'customer-app',
        },
        body: JSON.stringify({ refresh_token: refresh }),
      }),
    );
    const body = (await res.json().catch(() => null)) as
      | { data?: { access_token: string; refresh_token?: string | null }; error?: { code?: string } }
      | null;
    if (!res.ok || !body?.data) {
      const kind = forcedKindForCode(body?.error?.code);
      if (kind) raiseForced({ kind });
      setToken(null);
      return false;
    }
    setToken(body.data.access_token, body.data.refresh_token ?? refresh);
    return true;
  } catch {
    // Offline: keep the session; the next call after reconnecting tries again.
    return false;
  }
}

function onUnauthorized(): Promise<boolean> {
  inflight ??= refreshSession().finally(() => {
    inflight = null;
  });
  return inflight;
}

const devScenario = typeof __DEV__ !== 'undefined' && __DEV__ ? process.env.EXPO_PUBLIC_MOCK_SCENARIO : undefined;

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  onUnauthorized,
  onError: (error, response) => {
    const kind = forcedKindForCode(error.code);
    if (!kind) return;
    raiseForced(kind === 'on-hold' && checkoutResponses.has(response) ? { kind, midCheckout: true } : { kind });
  },
  clientSurface: 'customer-app',
  clientVersion: '0.0.0',
  mockScenario: devScenario || undefined,
  fetch: observedFetch,
});
