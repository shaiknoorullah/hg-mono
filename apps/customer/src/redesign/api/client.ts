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

async function observedFetch(input: Request): Promise<Response> {
  try {
    const res = await transport(input);
    markOnline();
    return res;
  } catch (e) {
    markOffline();
    throw e;
  }
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
  onError: (error) => {
    const kind = forcedKindForCode(error.code);
    if (kind) raiseForced({ kind });
  },
  clientSurface: 'customer-app',
  clientVersion: '0.0.0',
  mockScenario: devScenario || undefined,
  fetch: observedFetch,
});
