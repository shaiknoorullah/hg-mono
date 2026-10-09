/**
 * The API client every redesigned screen uses.
 *
 * Same session as the legacy client (`../../token`, the single-flight refresh in `../../api`),
 * plus a `fetch` that feeds `connectivity.ts`: a rejected fetch is "offline", any HTTP answer
 * is "online". `fetch` is looked up on each call, never captured, so tests can swap
 * `globalThis.fetch` at any time.
 *
 * No `mockScenario` here: scenario switching belongs to tests (`test/mockApi.ts`), never to a
 * screen (rider manifest WP0: "remove demo scenario pickers").
 */
import { createHgClient, type HgClient } from '@hg/api-client';

import { API_BASE_URL, onUnauthorized } from '../../api';
import { getToken } from '../../token';
import { reportReachable, reportTransportFailure } from './connectivity';

export const CLIENT_VERSION = '0.0.0';

async function trackedFetch(input: Request): Promise<Response> {
  try {
    const res = await globalThis.fetch(input);
    reportReachable();
    return res;
  } catch (cause) {
    reportTransportFailure();
    throw cause;
  }
}

export const rider: HgClient = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'rider-app',
  clientVersion: CLIENT_VERSION,
  onUnauthorized,
  fetch: trackedFetch,
});
