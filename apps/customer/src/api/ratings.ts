/**
 * Post-delivery ratings — food and rider, submitted together.
 *
 * `PUT /v1/orders/{orderId}/rating` (C-38). Both halves are optional in the contract; the screen
 * sends the food score always and the rider score when the order had a rider. The free-text
 * comment goes to the food `review`. The last submitted rating per order is cached in memory
 * only so the screen can show "Update rating" for the rest of the session; the server is the
 * record.
 */
import { idempotencyKey, unwrap } from '@hg/api-client';

import { api } from './client';

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
  const comment = input.comment.trim();
  await unwrap(
    api.PUT('/v1/orders/{orderId}/rating', {
      params: {
        path: { orderId: input.orderId },
        header: { 'Idempotency-Key': idempotencyKey() },
      },
      body: {
        food: { score: input.foodRating, ...(comment ? { review: comment } : {}) },
        ...(input.riderRating ? { rider: { score: input.riderRating } } : {}),
      },
    }),
  );
  const rating: OrderRating = { ...input, submittedAt: new Date().toISOString() };
  store.set(input.orderId, rating);
  notify();
  return rating;
}
