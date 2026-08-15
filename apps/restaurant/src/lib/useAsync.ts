import { useCallback, useEffect, useState } from 'react';
import { isApiError } from '@hg/api-client';

export interface AsyncState<T> {
  status: 'loading' | 'error' | 'ready';
  data: T | null;
  error: string | null;
  reload: () => void;
}

/** Small fetch-on-mount hook shared by every screen so loading/error states are uniform. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; data: T | null; error: string | null }>(
    { status: 'loading', data: null, error: null },
  );
  const [tick, setTick] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    fn()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null });
      })
      .catch((e) => {
        if (cancelled) return;
        const message = isApiError(e) ? e.message : 'Could not reach the server. Check your connection and try again.';
        setState({ status: 'error', data: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => load(), [load, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, reload: () => setTick((t) => t + 1) };
}
