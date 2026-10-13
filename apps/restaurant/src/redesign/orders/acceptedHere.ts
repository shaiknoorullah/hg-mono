/**
 * Hook for the strip (WP3): after `acceptOrder` succeeds on THIS screen, the strip calls
 * `noteAcceptedHere(order)` with the returned view. The In progress list draws it at the top
 * with "Just accepted" (LO §1.2; the toast says "It’s at the top of In progress."), and a
 * `restaurant.order_accepted` event for an order not noted here reads "Accepted on another
 * screen".
 */
import type { Order } from './model';

type Listener = (order: Order) => void;

const accepted = new Set<string>();
const listeners = new Set<Listener>();

export function noteAcceptedHere(order: Order): void {
  accepted.add(order.id);
  listeners.forEach((l) => l(order));
}

export function wasAcceptedHere(orderId: string): boolean {
  return accepted.has(orderId);
}

export function onAcceptedHere(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
