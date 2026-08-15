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
const _onboardingStatus = () => unwrap(clientFor().GET('/v1/riders/me/onboarding/status'));
const _documents = () => unwrap(clientFor().GET('/v1/riders/me/documents'));
const _profile = () =>
  unwrap(
    clientFor().POST('/v1/riders/me/onboarding/profile', {
      body: { first_name: '', last_name: '', date_of_birth: '2000-01-01' },
    }),
  );
const _vehicle = () =>
  unwrap(
    clientFor().POST('/v1/riders/me/onboarding/vehicle', { body: { vehicle_type: 'BICYCLE' } }),
  );
const _earningsSummary = () =>
  unwrap(clientFor().GET('/v1/riders/me/earnings/summary', { params: { query: { period: 'WEEK' } } }));
const _earningEntries = () => unwrap(clientFor().GET('/v1/riders/me/earnings/entries'));
const _payouts = () => unwrap(clientFor().GET('/v1/riders/me/payouts'));
const _payoutDetail = () =>
  unwrap(
    clientFor().GET('/v1/riders/me/payouts/{payoutId}', { params: { path: { payoutId: '' } } }),
  );

export type DispatchOffer = NonNullable<Awaited<ReturnType<typeof _offer>>['data']>;
export type Assignment = NonNullable<Awaited<ReturnType<typeof _assignment>>['data']>;
export type RiderAvailability = NonNullable<Awaited<ReturnType<typeof _availability>>['data']>;
export type RiderOnboardingStatus = Awaited<ReturnType<typeof _onboardingStatus>>['data'];
export type KycDocument = RiderOnboardingStatus['documents'][number];
export type RiderDocumentList = Awaited<ReturnType<typeof _documents>>['data'];
export type RiderProfile = Awaited<ReturnType<typeof _profile>>['data'];
export type RiderVehicle = Awaited<ReturnType<typeof _vehicle>>['data'];
export type EarningsSummary = Awaited<ReturnType<typeof _earningsSummary>>['data'];
export type EarningEntry = Awaited<ReturnType<typeof _earningEntries>>['data'][number];
export type Payout = Awaited<ReturnType<typeof _payouts>>['data'][number];
export type PayoutDetail = Awaited<ReturnType<typeof _payoutDetail>>['data'];
