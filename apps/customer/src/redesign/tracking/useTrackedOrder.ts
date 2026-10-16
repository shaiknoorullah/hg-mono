/**
 * The tracked order, kept fresh: read once, then re-read every 15 seconds (the contract's polling
 * fallback) for as long as the screen is open.
 *
 * The server is the only source of state and time. A failed re-read never blanks the page: the last
 * good copy stays on screen and `failedAt` says when the page last could not reach the server, so
 * the screen can say "this is what we knew at 7:04 pm". Only the newest read may land, and none
 * lands after the screen has gone.
 */
import * as React from 'react';

import { getNow } from '../lib/now';
import { errorCodeOf, errorStatusOf } from '../lib/query';
import { ACTIVE_ORDER_POLL_MS } from './useActiveOrder';
import { readTrackedOrder, type TrackedOrder } from './trackingApi';

export type TrackedState =
  | { kind: 'loading' }
  | { kind: 'error'; code: string | null; status: number | null }
  | {
      kind: 'ready';
      data: TrackedOrder;
      /** When the data was last read (epoch ms). */
      asOf: number;
      /** True when the last re-read failed, so `data` is older than the page would like. */
      failed: boolean;
    };

export function useTrackedOrder(orderId: string, pollMs: number = ACTIVE_ORDER_POLL_MS): { state: TrackedState; reload: () => void } {
  const [state, setState] = React.useState<TrackedState>({ kind: 'loading' });
  const [nonce, setNonce] = React.useState(0);
  const latest = React.useRef(0);

  React.useEffect(() => {
    let live = true;
    const refresh = async () => {
      const ticket = ++latest.current;
      try {
        const data = await readTrackedOrder(orderId);
        if (live && ticket === latest.current) setState({ kind: 'ready', data, asOf: getNow(), failed: false });
      } catch (e) {
        if (!live || ticket !== latest.current) return;
        // The first read failing is an error page; a later one keeps the last good copy on screen.
        setState((prev) =>
          prev.kind === 'ready'
            ? { ...prev, failed: true }
            : { kind: 'error', code: errorCodeOf(e), status: errorStatusOf(e) },
        );
      }
    };
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [orderId, pollMs, nonce]);

  const reload = React.useCallback(() => {
    setState((prev) => (prev.kind === 'error' ? { kind: 'loading' } : prev));
    setNonce((n) => n + 1);
  }, []);
  return { state, reload };
}
