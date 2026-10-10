/**
 * Load / stale / error for one server read (manifest WP1). The states every screen draws:
 *
 * - `loading`: first load, nothing to show yet (skeleton);
 * - `ready`: data on screen;
 * - `stale`: data on screen, but the latest refresh failed (keep showing it, say so);
 * - `error`: first load failed, nothing on screen (error state with Try again).
 *
 * `refresh()` re-reads silently (no skeleton); `reload()` goes back through `loading`.
 * A response that arrives after a newer request started is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HgApiError, isApiError } from '@hg/api-client';

export type ResourceStatus = 'loading' | 'ready' | 'stale' | 'error';

export interface ServerResource<T> {
  status: ResourceStatus;
  data: T | null;
  error: unknown;
  /** True while a silent refresh is in flight. */
  refreshing: boolean;
  refresh: () => Promise<void>;
  reload: () => void;
  /** Replace the data locally (an event or a mutation's response already told us). */
  mutate: (fn: (prev: T | null) => T | null) => void;
}

export function useServerResource<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): ServerResource<T> {
  const [state, setState] = useState<{ status: ResourceStatus; data: T | null; error: unknown; refreshing: boolean }>({
    status: 'loading',
    data: null,
    error: null,
    refreshing: false,
  });
  const ticket = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (silent: boolean) => {
    const mine = ++ticket.current;
    setState((s) => (silent ? { ...s, refreshing: true } : { status: 'loading', data: null, error: null, refreshing: false }));
    try {
      const data = await fetcherRef.current();
      if (mine !== ticket.current) return;
      setState({ status: 'ready', data, error: null, refreshing: false });
    } catch (error) {
      if (mine !== ticket.current) return;
      setState((s) =>
        s.data !== null && silent
          ? { status: 'stale', data: s.data, error, refreshing: false }
          : { status: 'error', data: null, error, refreshing: false },
      );
    }
  }, []);

  useEffect(() => {
    void run(false);
    return () => {
      ticket.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => run(true), [run]);
  const reload = useCallback(() => void run(false), [run]);
  const mutate = useCallback((fn: (prev: T | null) => T | null) => {
    setState((s) => {
      const data = fn(s.data);
      return { ...s, data, status: data === null ? s.status : s.status === 'stale' ? 'stale' : 'ready' };
    });
  }, []);

  return { ...state, refresh, reload, mutate };
}

/** The error code of a failed call, or `NETWORK` when the request never got an answer. */
export function errorCode(error: unknown): string {
  if (isApiError(error)) return (error as HgApiError).code;
  return 'NETWORK';
}

export function errorStatus(error: unknown): number | null {
  return isApiError(error) ? (error as HgApiError).status : null;
}
