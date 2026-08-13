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

const DEFAULT_BASE_URL = 'http://localhost:4010';

export const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_API_BASE_URL) || DEFAULT_BASE_URL;

export const api = createHgClient({
  baseUrl: API_BASE_URL,
  clientSurface: 'rider-app',
  clientVersion: '0.0.0',
});

const scenarioClients = new Map<string, HgClient>();

/**
 * A client pinned to a named mock scenario. Memoised so the same scenario reuses one client.
 * Passing `undefined` returns the default, un-pinned client.
 */
export function clientFor(scenario?: string): HgClient {
  if (!scenario) return api;
  const existing = scenarioClients.get(scenario);
  if (existing) return existing;
  const client = createHgClient({
    baseUrl: API_BASE_URL,
    clientSurface: 'rider-app',
    clientVersion: '0.0.0',
    mockScenario: scenario,
  });
  scenarioClients.set(scenario, client);
  return client;
}
