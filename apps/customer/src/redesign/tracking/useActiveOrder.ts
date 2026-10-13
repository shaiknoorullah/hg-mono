/**
 * The customer's one active order, for Home's "order in progress" strip (DO/Home-order-in-progress).
 * Ported from #634 `tracking/useActiveOrder.ts`.
 *
 * Read from `getActiveOrder`; the arrival time comes from `getOrderTracking` (the same projection
 * the socket carries), falling back to the order's own `eta_at`. The server stays the only source
 * of state and time: the hook re-reads every 15 s while Home is open. (#634 also re-read on every
 * realtime `order.*` event; the redesign's realtime layer belongs to WP7 and plugs in here.) Null
 * when there is no active order or the read fails: the strip is then simply absent.
 */
import * as React from 'react';
import { unwrap, type Schema } from '@hg/api-client';

import { api } from '../api/client';

export type ActiveOrder = Schema['OrderCustomerView'];

/** How often the order is re-read while Home is open. */
export const ACTIVE_ORDER_POLL_MS = 15_000;

export interface ActiveOrderView {
  order: ActiveOrder;
  /** When it should arrive (one time, not a window), or null when the server has none yet. */
  etaAt: string | null;
}

export async function readActiveOrder(): Promise<ActiveOrderView | null> {
  const body = await unwrap(api.GET('/v1/orders/active'));
  const order = (body.data ?? null) as ActiveOrder | null;
  if (!order) return null;
  let etaAt = order.eta_at ?? null;
  try {
    const tracking = await unwrap(api.GET('/v1/orders/{orderId}/tracking', { params: { path: { orderId: order.id } } }));
    etaAt = tracking.data.eta_at ?? etaAt;
  } catch {
    // The order's own eta_at stands in; the strip never guesses one.
  }
  return { order, etaAt };
}

export function useActiveOrder(pollMs: number = ACTIVE_ORDER_POLL_MS): ActiveOrderView | null {
  const [view, setView] = React.useState<ActiveOrderView | null>(null);
  const latest = React.useRef(0);

  React.useEffect(() => {
    let live = true;
    const refresh = async () => {
      const ticket = ++latest.current;
      let next: ActiveOrderView | null;
      try {
        next = await readActiveOrder();
      } catch {
        next = null;
      }
      // Only the newest read may land, and none after Home has gone.
      if (live && ticket === latest.current) setView(next);
    };
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return view;
}

/** The badge word and how the spoken label says it (the Orders canvas's words). */
export const ACTIVE_STATE_WORDS: Record<string, { word: string; spoken: string }> = {
  CREATED: { word: 'Placing', spoken: 'is being placed' },
  AUTHORIZED: { word: 'Sending', spoken: 'is being sent to the restaurant' },
  RESTAURANT_PENDING: { word: 'Waiting to accept', spoken: 'is waiting for the restaurant' },
  PREPARING: { word: 'Being prepared', spoken: 'is being prepared' },
  READY_FOR_PICKUP: { word: 'Ready', spoken: 'is ready' },
  PICKED_UP: { word: 'On the way', spoken: 'is on the way' },
  ARRIVED: { word: 'At your door', spoken: 'has arrived' },
};
export const IN_PROGRESS_WORDS = { word: 'In progress', spoken: 'is in progress' };
