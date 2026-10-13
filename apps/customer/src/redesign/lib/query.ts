/**
 * The one async shape every redesigned screen renders against.
 *
 * Every screen ships loading, empty, error and populated (constitution §5 gate 2). A
 * discriminated union makes "loading and error at once" unrepresentable, and `asOf` records when
 * the data was fetched, which the offline states ("as of 6:42 pm") and the 15-minute halal rule
 * both need. A reload keeps the last data on screen (`refreshing`) instead of flashing a skeleton.
 */
import * as React from 'react';
import { isApiError } from '@hg/api-client';

import { getNow } from './now';

export type Query<T> =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null; status: number | null; error: unknown }
  | { kind: 'ready'; data: T; asOf: number; refreshing: boolean };

export function errorCodeOf(e: unknown): string | null {
  return isApiError(e) ? String(e.code) : null;
}

export function errorStatusOf(e: unknown): number | null {
  return isApiError(e) ? e.status : null;
}

export function useQuery<T>(
  run: () => Promise<T>,
  deps: React.DependencyList,
  { enabled = true }: { enabled?: boolean } = {},
): { query: Query<T>; reload: () => void } {
  const [query, setQuery] = React.useState<Query<T>>({ kind: 'loading' });
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setQuery((prev) => (prev.kind === 'ready' ? { ...prev, refreshing: true } : { kind: 'loading' }));
    run()
      .then((data) => {
        if (!cancelled) setQuery({ kind: 'ready', data, asOf: getNow(), refreshing: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setQuery({ kind: 'error', code: errorCodeOf(error), status: errorStatusOf(error), error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  return { query, reload };
}
