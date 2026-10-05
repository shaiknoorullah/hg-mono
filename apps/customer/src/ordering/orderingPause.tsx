/**
 * Whether staff have paused new orders platform-wide (#244, customer app #388).
 *
 * `getPublicConfig.ordering.paused` is read at launch and again whenever the app returns to the
 * foreground, so the customer hears "ordering is paused" on home, the restaurant page and the
 * cart instead of at a refused checkout. The server still decides: while paused, `createQuote`
 * and `createOrder` answer `409 ORDERING_PAUSED`, and a screen that gets one calls `markPaused`
 * so every other screen agrees without waiting for the next foreground.
 *
 * A failed config read keeps the last known value (open at launch): the 409 is the backstop, and
 * a flaky read must never make the app claim a pause staff did not make.
 *
 * The copy is fixed. The API sends customers no reason (the reason staff type is for staff), and
 * the notice is never red: a pause is not a failure of the customer's order, and red reads as
 * haram on this platform (AGENTS.md "Non-negotiable invariants").
 */
import * as React from 'react';
import { AppState } from 'react-native';
import { isApiError, unwrap } from '@hg/api-client';
import { Banner } from '@hg/ui-native';

import { api } from '../api/client';

export const ORDERING_PAUSED = 'ORDERING_PAUSED';

/** True for the `409 ORDERING_PAUSED` that `createQuote` and `createOrder` answer while paused. */
export function isOrderingPausedError(e: unknown): boolean {
  return isApiError(e) && e.code === ORDERING_PAUSED;
}

export async function getOrderingPaused(): Promise<boolean> {
  const body = await unwrap(api.GET('/v1/config/public'));
  return body.data.ordering.paused;
}

interface OrderingPauseValue {
  paused: boolean;
  /** A screen saw `ORDERING_PAUSED` from the server: show the pause everywhere. */
  markPaused: () => void;
}

const OrderingPauseContext = React.createContext<OrderingPauseValue>({
  paused: false,
  markPaused: () => {},
});

export function OrderingPauseProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    const read = () => {
      getOrderingPaused()
        .then((value) => {
          if (live) setPaused(value);
        })
        .catch(() => {
          /* keep the last known value; the server's 409 is the backstop */
        });
    };
    read();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') read();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const markPaused = React.useCallback(() => setPaused(true), []);
  const value = React.useMemo(() => ({ paused, markPaused }), [paused, markPaused]);
  return <OrderingPauseContext.Provider value={value}>{children}</OrderingPauseContext.Provider>;
}

export function useOrderingPause(): OrderingPauseValue {
  return React.useContext(OrderingPauseContext);
}

/** The one notice every screen shows while ordering is paused. */
export function OrderingPausedNotice({ refused = false }: { refused?: boolean }): React.ReactElement {
  return (
    <Banner
      variant="info"
      title="Ordering is paused for now"
      description={
        (refused ? 'Your order was not placed and nothing was charged. ' : '') +
        'We have paused new orders for a short while. Orders already placed carry on as normal. Please check back soon.'
      }
      testID="ordering-paused"
    />
  );
}
