/**
 * How many new orders are waiting for an answer (RESTAURANT_PENDING offers on screen), for the
 * rail's "Live orders, N new" count. The strip (WP3) owns the offers and publishes the count;
 * until it lands the count is zero and no badge shows.
 */
import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

export function publishWaitingCount(next: number): void {
  if (next === count) return;
  count = next;
  listeners.forEach((l) => l());
}

export function useWaitingCount(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count,
  );
}
