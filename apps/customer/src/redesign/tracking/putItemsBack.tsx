/**
 * "Put these items back in your cart" for an order that ended before it was cooked.
 *
 * One add per order line, each with its own Idempotency-Key, none added twice if the customer taps
 * again after a failure. The request carries ids and quantities, never a price: the server prices
 * every line again when the customer checks out. A line that can no longer be added (sold out,
 * removed, the restaurant closed) is skipped here and shows its own state in the cart.
 */
import * as React from 'react';
import { idempotencyKey, isApiError } from '@hg/api-client';

import { lineToInput } from '../checkout/model';
import { errorCodeOf } from '../lib/query';
import { useNav } from '../navigation/context';
import { addCartLine } from '../ordering/cart';
import type { OrderCustomerView } from '../orders/ordersApi';

export type PutBack =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'failed' }
  /** The cart holds another restaurant's items; putting these back replaces them. */
  | { kind: 'replace'; restaurant: string | null; count: number | null };

export function usePutItemsBack(order: OrderCustomerView): {
  state: PutBack;
  run: (replace: boolean) => void;
  cancelReplace: () => void;
} {
  const nav = useNav();
  const [state, setState] = React.useState<PutBack>({ kind: 'idle' });
  const keys = React.useRef(new Map<number, string>());
  const done = React.useRef(new Set<number>());
  const live = React.useRef(true);
  React.useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const run = React.useCallback(
    (replace: boolean) => {
      void (async () => {
        setState({ kind: 'busy' });
        let first = true;
        for (const line of order.lines) {
          if (done.current.has(line.line_no)) continue;
          let key = keys.current.get(line.line_no);
          if (!key) {
            key = idempotencyKey();
            keys.current.set(line.line_no, key);
          }
          try {
            await addCartLine(lineToInput(line), { idempotencyKey: key, replace: replace && first });
            done.current.add(line.line_no);
          } catch (e) {
            if (!live.current) return;
            if (errorCodeOf(e) === 'DIFFERENT_RESTAURANT') {
              const d = (e as { details?: { current_restaurant_name?: string; current_line_count?: number } }).details;
              setState({ kind: 'replace', restaurant: d?.current_restaurant_name ?? null, count: d?.current_line_count ?? null });
              return;
            }
            if (isApiError(e) && e.status === 409) {
              done.current.add(line.line_no);
            } else {
              setState({ kind: 'failed' });
              return;
            }
          }
          first = false;
        }
        if (live.current) {
          setState({ kind: 'idle' });
          nav.replace({ name: 'cart' });
        }
      })();
    },
    [order.lines, nav],
  );

  return { state, run, cancelReplace: () => setState({ kind: 'idle' }) };
}
