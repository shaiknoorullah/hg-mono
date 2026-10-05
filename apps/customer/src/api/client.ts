/**
 * The customer app's single `@hg/api-client` instance.
 *
 * `clientSurface: 'customer-app'` tags every request with the contract's X-HG-Client header;
 * `getToken` supplies the bearer once the customer has signed in via phone OTP. No mockScenario
 * is passed — a real backend's CORS policy rejects the X-Mock-Scenario header.
 *
 * On a 401 the client calls `onUnauthorized`: we exchange the refresh token once (`POST
 * /v1/auth/refresh`, rotating) and the client retries the request once with the new access token.
 * If the exchange fails the session is cleared, which sends the app back to sign-in.
 */
import { createHgClient } from '@hg/api-client';

import { API_BASE_URL } from './config';
import { getRefreshToken, getToken, setToken } from './token';

let inflight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) {
    setToken(null);
    return false;
  }
  try {
    // Raw fetch, not `api`: a 401 here must not re-enter onUnauthorized.
    const res = await fetch(`${API_BASE_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-HG-Client': 'customer-app',
      },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) throw new Error(`refresh ${res.status}`);
    const body = (await res.json()) as {
      data: { access_token: string; refresh_token?: string | null };
    };
    setToken(body.data.access_token, body.data.refresh_token ?? refresh);
    return true;
  } catch {
    setToken(null);
    return false;
  }
}

/** One refresh at a time: concurrent 401s share the same exchange (the token rotates). */
function onUnauthorized(): Promise<boolean> {
  inflight ??= refreshSession().finally(() => {
    inflight = null;
  });
  return inflight;
}

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  onUnauthorized,
  clientSurface: 'customer-app',
  clientVersion: '0.0.0',
});
