/**
 * The admin console's one data-loading primitive.
 *
 * Every screen has exactly three non-happy states — loading, empty and error — and they are
 * cheap only if every screen reaches for the same machine. `useLoad` runs an async request on
 * mount (and on demand via `reload`), and hands back a discriminated `AsyncState` the screen
 * matches on. `HgApiError` is unwrapped into a stable `{ code, message }` so the feedback
 * components can drive their copy off the code.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HgApiError, isApiError } from '@hg/api-client';

export interface AsyncError {
  readonly code: string;
  readonly message: string;
}

export type AsyncState<T> =
  | { readonly status: 'loading'; readonly data: null; readonly error: null }
  | { readonly status: 'ready'; readonly data: T; readonly error: null }
  | { readonly status: 'error'; readonly data: null; readonly error: AsyncError };

export function toAsyncError(err: unknown): AsyncError {
  if (isApiError(err)) {
    return { code: String(err.code), message: err.message };
  }
  return { code: 'TRANSPORT_ERROR', message: 'Could not reach the admin API.' };
}

interface FetchResult<T> {
  data?: T | undefined;
  error?: unknown;
  response: Response;
}

/**
 * Unwrap an `openapi-fetch` call into its `data`, throwing an `HgApiError` on the error branch
 * so the caller's `try/catch` sees one shape. Accepts the promise `api.GET(...)` returns
 * directly, so a fetcher is a one-liner: `unwrap(api.GET(path, opts))`.
 */
export async function unwrap<T>(result: Promise<FetchResult<T>> | FetchResult<T>): Promise<T> {
  const settled = await result;
  if (settled.error || settled.data == null) {
    throw new HgApiError(settled.response.status, settled.error as never);
  }
  return settled.data;
}

/**
 * `reload` re-runs the request through the loading state; `refresh` re-runs it silently,
 * keeping the current data on screen and on failure — the live screens' path, so a realtime
 * signal or a poll never flashes a skeleton or replaces a good view with an error.
 */
export function useLoad<T>(fetcher: () => Promise<T>): AsyncState<T> & { reload: () => void; refresh: () => Promise<void> } {
  const [state, setState] = useState<AsyncState<T>>({
    status: 'loading',
    data: null,
    error: null,
  });

  // Callers memoise `fetcher` on the route parameter it reads (useCallback with `[certificateId]`
  // and the like), so a new fetcher means the screen moved to another record: load that one. Each
  // run takes a ticket and only the newest may set state, so a slower answer for the record the
  // screen left can never overwrite the one now on it.
  const latest = useRef(0);
  const run = useCallback(async () => {
    const ticket = ++latest.current;
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await fetcher();
      if (ticket === latest.current) setState({ status: 'ready', data, error: null });
    } catch (err) {
      if (ticket === latest.current) setState({ status: 'error', data: null, error: toAsyncError(err) });
    }
  }, [fetcher]);

  useEffect(() => {
    void run();
  }, [run]);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const data = await fetcher();
      if (ticket === latest.current) setState({ status: 'ready', data, error: null });
    } catch {
      /* keep the last good view; the next signal or poll tries again */
    }
  }, [fetcher]);

  return { ...state, reload: () => void run(), refresh };
}
