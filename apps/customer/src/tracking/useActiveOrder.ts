import * as React from 'react';

import { getActiveOrder, type OrderCustomerView } from '../api/orders';
import { openOrderSocket } from '../realtime/orderSocket';

/** How often the order is re-read while its socket is down. */
export const ACTIVE_ORDER_POLL_MS = 15_000;

/**
 * The customer's one active order, for Home's "order in progress" strip (the Discover & Order
 * canvas's Home-order-in-progress board). Read from `getActiveOrder`, then kept current over the
 * order's realtime channel, the same socket tracking uses (realtime/orderSocket.ts): every
 * `order.*` event and every (re)subscribe re-reads it, so the server stays the only source of its
 * state and ETA. While the socket is down it is re-read every 15 s instead. Null when there is no
 * active order or the read fails; the strip is then simply absent, as Home's rows are.
 */
export function useActiveOrder(): OrderCustomerView | null {
  const [order, setOrder] = React.useState<OrderCustomerView | null>(null);
  const latest = React.useRef(0);
  const mounted = React.useRef(true);

  const refresh = React.useCallback(async () => {
    const ticket = ++latest.current;
    let next: OrderCustomerView | null;
    try {
      next = await getActiveOrder();
    } catch {
      next = null;
    }
    // Only the newest read may land, and none after Home has gone.
    if (mounted.current && ticket === latest.current) setOrder(next);
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const orderId = order?.id ?? null;
  React.useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stopPolling = () => {
      if (poll) clearInterval(poll);
      poll = undefined;
    };
    const startPolling = () => {
      if (!poll) poll = setInterval(() => void refresh(), ACTIVE_ORDER_POLL_MS);
    };
    startPolling();
    const close = openOrderSocket(orderId, {
      onLink: (open) => {
        if (stopped) return;
        if (open) {
          stopPolling();
          // Catch up on whatever changed while the socket was down.
          void refresh();
        } else {
          startPolling();
        }
      },
      onRiderLocation: () => undefined,
      onOrderEvent: () => {
        if (!stopped) void refresh();
      },
    });
    return () => {
      // Closing reports the link down; `stopped` keeps that from restarting the poll.
      stopped = true;
      close();
      stopPolling();
    };
  }, [orderId, refresh]);

  return order;
}
