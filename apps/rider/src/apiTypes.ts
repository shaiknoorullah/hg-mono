/**
 * Response-body types, derived from an actual `unwrap(client…)` call.
 *
 * openapi-fetch applies a deep-readonly transform to response bodies, which turns the money
 * brand `number & {…}` into a brand-only object in *response position*. That makes the flat
 * `Schema['X']` / `operations[…]` aliases subtly incompatible with what `unwrap` actually
 * returns, so a screen that stores `await`ed data in state must type that state from the call
 * itself. These aliases capture exactly that shape via `typeof` on a never-executed sample
 * call. At the `Price` boundary the numeric value is re-branded with `cents(Number(x))` — a
 * runtime no-op that restores the real brand and is the one sanctioned entry point for money.
 */
import { unwrap } from '@hg/api-client';

import { clientFor } from './api';

// Never executed — declared only so `typeof` can read the awaited response shapes.
const _offer = () => unwrap(clientFor().GET('/v1/riders/me/offers/current'));
const _assignment = () =>
  unwrap(
    clientFor().GET('/v1/riders/me/assignments/{assignmentId}', {
      params: { path: { assignmentId: '' } },
    }),
  );
const _availability = () =>
  unwrap(clientFor().PUT('/v1/riders/me/availability', { body: { is_online: true } }));

export type DispatchOffer = NonNullable<Awaited<ReturnType<typeof _offer>>['data']>;
export type Assignment = NonNullable<Awaited<ReturnType<typeof _assignment>>['data']>;
export type RiderAvailability = NonNullable<Awaited<ReturnType<typeof _availability>>['data']>;
