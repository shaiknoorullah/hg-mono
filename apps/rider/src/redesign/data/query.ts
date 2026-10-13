/**
 * A small read hook: load, poll, refetch on foreground, keep the last good answer.
 *
 * The rider app polls (no socket yet, #29), so polling is a first-class option: `pollMs` may be
 * a number, or a function of the latest data so a screen can poll fast while something is live
 * and slow (or not at all, `null`) otherwise. Polling pauses while the app is in the background
 * and fires once on return to the foreground.
 *
 * A failed refetch keeps the previous data and sets `error`: a rider mid-shift keeps seeing the
 * last good screen with a "may be out of date" line rather than a blank error page. Only a
 * failure with no data yet is `status: 'error'`.
 */
import * as React from 'react';
import { AppState } from 'react-native';

import { toRiderError, type RiderError } from './errors';

export type QueryStatus = 'loading' | 'error' | 'success';

export interface QueryResult<T> {
  status: QueryStatus;
  data: T | undefined;
  /** The last failure. Set alongside `data` when a refetch failed after a success. */
  error: RiderError | null;
  /** A refetch is in flight (the first load is `status: 'loading'` instead). */
  refreshing: boolean;
  /** When `data` last arrived (ms epoch), or 0. */
  updatedAt: number;
  refetch: () => Promise<void>;
}

export interface QueryOptions<T> {
  /** `false` holds the query (no request, status stays loading). Default true. */
  enabled?: boolean;
  /** Poll interval, or a function of the latest data. `null`/0 = no polling. */
  pollMs?: number | null | ((data: T | undefined) => number | null);
  /** Refetch when the app returns to the foreground. Default true. */
  refetchOnForeground?: boolean;
}

export function useApiQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: QueryOptions<T> = {},
): QueryResult<T> {
  const { enabled = true, pollMs = null, refetchOnForeground = true } = options;
  const [state, setState] = React.useState<{
    data: T | undefined;
    error: RiderError | null;
    loaded: boolean;
    refreshing: boolean;
    updatedAt: number;
  }>({ data: undefined, error: null, loaded: false, refreshing: false, updatedAt: 0 });

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;
  const mounted = React.useRef(true);
  const seq = React.useRef(0);

  // A new key is a different resource: forget the old answer.
  React.useEffect(() => {
    setState({ data: undefined, error: null, loaded: false, refreshing: false, updatedAt: 0 });
  }, [key]);

  const run = React.useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, refreshing: s.loaded }));
    try {
      const data = await fetcherRef.current();
      if (!mounted.current || mine !== seq.current) return;
      setState({ data, error: null, loaded: true, refreshing: false, updatedAt: Date.now() });
    } catch (e) {
      if (!mounted.current || mine !== seq.current) return;
      const error = toRiderError(e);
      setState((s) => ({ ...s, error, loaded: true, refreshing: false }));
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (enabled) void run();
  }, [enabled, key, run]);

  const interval = typeof pollMs === 'function' ? pollMs(state.data) : pollMs;
  React.useEffect(() => {
    if (!enabled || !interval) return;
    const id = setInterval(() => {
      if (AppState.currentState === 'active' || AppState.currentState == null) void run();
    }, interval);
    return () => clearInterval(id);
  }, [enabled, interval, run]);

  React.useEffect(() => {
    if (!enabled || !refetchOnForeground) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run();
    });
    return () => sub.remove();
  }, [enabled, refetchOnForeground, run]);

  const status: QueryStatus = !state.loaded ? 'loading' : state.data === undefined && state.error ? 'error' : 'success';
  return {
    status,
    data: state.data,
    error: state.error,
    refreshing: state.refreshing,
    updatedAt: state.updatedAt,
    refetch: run,
  };
}
