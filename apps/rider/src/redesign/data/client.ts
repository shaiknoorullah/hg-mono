/**
 * The API client every redesigned screen uses.
 *
 * Same session as the legacy client (`../../token`, the single-flight refresh in `../../api`),
 * plus a `fetch` that feeds `connectivity.ts`: a rejected fetch is "offline", any HTTP answer
 * is "online". `fetch` is looked up on each call, never captured, so tests can swap
 * `globalThis.fetch` at any time.
 *
 * Every request has a deadline (`REQUEST_TIMEOUT_MS`); past it the request is a transport
 * failure, like no signal. One call can take longer by passing its own fetch:
 * `rider.POST(path, { ..., fetch: trackedFetchWithin(60_000) })`.
 *
 * No `mockScenario` here: scenario switching belongs to tests (`test/mockApi.ts`), never to a
 * screen (rider manifest WP0: "remove demo scenario pickers").
 */
import { createHgClient, type HgClient } from '@hg/api-client';

import { API_BASE_URL, onUnauthorized } from '../../api';
import { getToken } from '../../token';
import { reportReachable, reportTransportFailure } from './connectivity';

export const CLIENT_VERSION = '0.0.0';

/** How long one API request may take before it counts as a lost connection. */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A request that got no answer in time. A `TypeError`, like the one `fetch` throws when there is
 * no network, so every classifier treats it as a transport failure: `unwrap` wraps it in
 * `HgTransportError`, `toRiderError` shows the offline copy, and the outbox queues the step for
 * replay with the same Idempotency-Key (if the server did record it, the replay is a no-op).
 */
export class RequestTimeoutError extends TypeError {
  constructor(readonly timeoutMs: number) {
    super(`Network request timed out after ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * The JSON API fetch, with a deadline. Presigned upload PUTs do not come through here (they use
 * their own `fetch`), so a large photo on a slow line is never cut off by this.
 *
 * The request is aborted at the deadline and, in case a `fetch` ignores the signal, the race
 * rejects anyway: an accept or a step can never hang forever.
 */
export function trackedFetchWithin(timeoutMs: number): (input: Request) => Promise<Response> {
  return async (input) => {
    const controller = new AbortController();
    const outer = input.signal;
    const onOuterAbort = () => controller.abort(outer?.reason);
    if (outer?.aborted) controller.abort(outer.reason);
    else outer?.addEventListener?.('abort', onOuterAbort);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err = new RequestTimeoutError(timeoutMs);
        controller.abort(err);
        reject(err);
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([globalThis.fetch(new Request(input, { signal: controller.signal })), deadline]);
      reportReachable();
      return res;
    } catch (cause) {
      if (!outer?.aborted) reportTransportFailure(); // a caller's own cancel says nothing about the network
      throw cause;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener?.('abort', onOuterAbort);
    }
  };
}

const trackedFetch = trackedFetchWithin(REQUEST_TIMEOUT_MS);

export const rider: HgClient = createHgClient({
  baseUrl: API_BASE_URL,
  getToken,
  clientSurface: 'rider-app',
  clientVersion: CLIENT_VERSION,
  onUnauthorized,
  fetch: trackedFetch,
});
