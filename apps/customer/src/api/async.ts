/**
 * The one async shape every screen in this app renders against.
 *
 * `03-patterns.md` §0 makes empty, loading and error mandatory on every screen. Encoding the
 * fetch as a discriminated union — rather than three loose booleans — makes "loading AND error"
 * unrepresentable and lets each screen's body be a single exhaustive switch. `error.code` is the
 * contract's stable `ErrorCode`, kept as a string so an unrecognised value is data, not a crash;
 * it feeds straight into `ErrorState errorCode=` for keyed copy.
 */
import * as React from 'react';
import { isApiError } from '@hg/api-client';

export type Async<T> =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null }
  | { kind: 'ready'; data: T };

/** Pull the stable error code out of anything a fetch can throw. */
export function errorCodeOf(e: unknown): string | null {
  return isApiError(e) ? String(e.code) : null;
}

/**
 * Drive an `Async` state through loading → ready/error from a thunk that resolves to the already
 * unwrapped payload. Returns a stable `reload` for retry. The caller owns freshness via `deps`.
 */
export function useAsync<T>(
  run: () => Promise<T>,
  deps: React.DependencyList,
): { state: Async<T>; reload: () => void } {
  const [state, setState] = React.useState<Async<T>>({ kind: 'loading' });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    run()
      .then((data) => {
        if (!cancelled) setState({ kind: 'ready', data });
      })
      .catch((e) => {
        if (!cancelled) setState({ kind: 'error', code: errorCodeOf(e) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  return { state, reload };
}
