/**
 * Post-delivery ratings — food and rider, separately.
 *
 * **Known contract gap**: `contracts/openapi.yaml` has no rating-submission endpoint at any
 * version (there is `rating_avg`/`rating_count` on the restaurant and rider read models, but
 * nothing a customer can `POST` to produce them). Rather than invent an endpoint the generated
 * `@hg/api-client` doesn't have — hand-writing a type the generator would emit is forbidden by
 * `AGENTS.md` §6 — this module holds submitted ratings in memory only, the same in-memory-only
 * pattern `token.ts` uses for the session. The screen is fully real: star input, comment, the
 * submitted state persisting for the rest of the session. Wiring it to a server round-trip is a
 * one-line change in `submitRating` once `POST /v1/orders/{orderId}/rating` (or similar) lands
 * in the contract and the client regenerates.
 */
export interface OrderRating {
  orderId: string;
  foodRating: number;
  riderRating: number | null;
  comment: string;
  submittedAt: string;
}

const store = new Map<string, OrderRating>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeRatings(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRating(orderId: string): OrderRating | null {
  return store.get(orderId) ?? null;
}

export async function submitRating(input: {
  orderId: string;
  foodRating: number;
  riderRating: number | null;
  comment: string;
}): Promise<OrderRating> {
  const rating: OrderRating = { ...input, submittedAt: new Date().toISOString() };
  store.set(input.orderId, rating);
  notify();
  return rating;
}
