/**
 * The `@hg/api-client` instance(s) for the rider app.
 *
 * Base URL defaults to the local mock (`http://localhost:4010`, origin-only — every generated
 * path already carries the `/v1` prefix). Override with EXPO_PUBLIC_API_BASE_URL for a real
 * backend. `clientSurface: 'rider-app'` is what the contract's force-upgrade / role checks key
 * off.
 *
 * `clientFor(scenario)` returns a client pinned to a mock fixture via the `X-Mock-Scenario`
 * header (ignored by the real API). The rider work loop uses it to demo the three required
 * states off real fixtures — e.g. `offer_none` for the empty offer, `offer_taken_by_another`
 * for the accept-race error — without a real dispatcher pushing work.
 */
import { createHgClient, type HgClient } from '@hg/api-client';

import { getRefreshToken, getToken, setToken, setTokens } from './token';

const DEFAULT_BASE_URL = 'http://localhost:4010';

// Written as plain `process.env.EXPO_PUBLIC_…` on purpose: Expo swaps that exact expression for
// the build's value. Optional chaining (`process.env?.…`) is not swapped, so a release build
// read nothing at run time and fell back to the mock.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_BASE_URL;

/**
 * Are we pointed at the local Prism mock, or a real backend? The demo scenario switchers and the
 * `X-Mock-Scenario` header only make sense against the mock — a real backend's CORS policy rejects
 * that header, and its dispatcher is what actually drives the offer/assignment. When this is false
 * every request goes through the single authenticated `api` client and no mockScenario is ever
 * sent.
 */
export const IS_MOCK = API_BASE_URL === DEFAULT_BASE_URL;

/** A client with no 401 handler, used only to call the refresh operation itself. */
const refreshClient = createHgClient({
  baseUrl: API_BASE_URL,
  getToken: () => null,
  clientSurface: 'rider-app',
  clientVersion: '0.0.0',
});

let refreshing: Promise<boolean> | null = null;

/**
 * On a 401: exchange the refresh token once (single-flight, so parallel 401s share one rotation —
 * the server revokes the family on reuse). `true` tells the client to retry the request once;
 * on failure the session is cleared, which sends the rider back to sign-in.
 */
async function onUnauthorized(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) {
    // Signed in without a refresh token (or not signed in): a 401 means the session is over.
    if (getToken()) setToken(null);
    return false;
  }
  refreshing ??= (async () => {
    try {
      const { data } = await refreshClient.POST('/v1/auth/refresh', { body: { refresh_token: rt } });
      const grant = data?.data;
      if (!grant) {
        setToken(null);
        return false;
      }
      setTokens(grant.access_token, grant.refresh_token ?? null);
      return true;
    } catch {
      return false; // transient transport failure: keep the session, the next call retries
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'rider-app',
  clientVersion: '0.0.0',
  onUnauthorized,
});

const scenarioClients = new Map<string, HgClient>();

/**
 * A client pinned to a named mock scenario. Memoised so the same scenario reuses one client.
 * Passing `undefined` — or running against a real backend (`!IS_MOCK`) — returns the default,
 * authenticated client, so no `X-Mock-Scenario` header ever reaches a real API.
 */
export function clientFor(scenario?: string): HgClient {
  if (!scenario || !IS_MOCK) return api;
  const existing = scenarioClients.get(scenario);
  if (existing) return existing;
  const client = createHgClient({
    baseUrl: API_BASE_URL,
    getToken,
    clientSurface: 'rider-app',
    clientVersion: '0.0.0',
    onUnauthorized,
    mockScenario: scenario,
  });
  scenarioClients.set(scenario, client);
  return client;
}
