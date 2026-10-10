/**
 * The dispatch offer, as data: where it comes from, how long it has left, what the rider may see
 * before accepting, and the small state machine the layer runs (live → accepting / declining →
 * accepted or a result).
 *
 * Time. The countdown is `expires_at − server_time`, read when the offer arrives, never a local
 * 30 s and never the device clock against `expires_at` (contract `getCurrentOffer`: "a device
 * whose clock is ten minutes fast still shows ~30 seconds"). So the deadline is held in device
 * time: `received_at + (expires_at − server_time)`. The ring's total is that same remaining time
 * at the first render, because the contract has no `offered_at` / `window_seconds` (gap 13).
 *
 * Arrival. Offers come from the dashboard poll and from `getCurrentOffer`; the same offer
 * arriving twice (or again after it was answered) is ignored by `offer_id`. An offer already
 * past its deadline when it arrives renders nothing.
 *
 * Privacy. Before accepting, the rider sees the drop-off *area* only (#312: `dropoff.area` and
 * the centre of a ~500 m cell, with `radius_m` for a shaded circle when the server sends one).
 * Never a street, never a pin on a house; the full address comes with the `Assignment`.
 */
import { HgApiError, HgTransportError, unwrap, type Schema } from '@hg/api-client';

import { rider } from '../data/client';
import { toRiderError, type RiderError } from '../data/errors';
import type { RejectReason, ResultKind } from './copy';

type ContractOffer = Schema['DispatchOffer'];

/** `radius_m` lands with #312 (round-2 contract): typed here until #312 merges. */
export type DispatchOffer = Omit<ContractOffer, 'dropoff'> & {
  dropoff: ContractOffer['dropoff'] & { radius_m?: number | null };
};
export type Assignment = Schema['Assignment'];

/* ------------------------------------------------------------------ requests */

export async function fetchCurrentOffer(): Promise<DispatchOffer | null> {
  const body = await unwrap(rider.GET('/v1/riders/me/offers/current'));
  return ((body as { data: DispatchOffer | null }).data ?? null) as DispatchOffer | null;
}

/** `acceptOffer`. The caller owns the key: a retry of the same offer sends the same one. */
export async function acceptOffer(offerId: string, key: string): Promise<Assignment> {
  const body = await unwrap(
    rider.POST('/v1/riders/me/offers/{offerId}/accept', {
      params: { path: { offerId }, header: { 'Idempotency-Key': key } },
    }),
  );
  return (body as { data: Assignment }).data;
}

/** `rejectOffer`: 204 on success, so it is not `unwrap`ped (no body to return). */
export async function rejectOffer(offerId: string, reason: RejectReason, key: string): Promise<void> {
  let res: Awaited<ReturnType<typeof rider.POST>>;
  try {
    res = await rider.POST('/v1/riders/me/offers/{offerId}/reject', {
      params: { path: { offerId }, header: { 'Idempotency-Key': key } },
      body: { reason_code: reason },
    });
  } catch (cause) {
    throw new HgTransportError(cause);
  }
  if (!res.response.ok) throw new HgApiError(res.response.status, res.error as never);
}

/* ------------------------------------------------------------------ time */

/** Milliseconds the server gave this offer at the moment it was read. Skew-free. */
export function windowMs(offer: Pick<DispatchOffer, 'expires_at' | 'server_time'>): number {
  const ms = Date.parse(offer.expires_at) - Date.parse(offer.server_time);
  return Number.isFinite(ms) ? ms : 0;
}

export type Urgency = 'calm' | 'urgent' | 'critical';

/** SH/OfferUrgent under 25% left, SH/OfferCritical under 10%. */
export function urgencyOf(remainingMs: number, totalMs: number): Urgency {
  if (totalMs <= 0) return 'critical';
  const f = remainingMs / totalMs;
  if (f < 0.1) return 'critical';
  if (f < 0.25) return 'urgent';
  return 'calm';
}

/* ------------------------------------------------------------------ what the rider sees */

export interface BreakdownRow {
  key: 'base' | 'distance' | 'surge' | 'tip';
  cents: number;
}

/**
 * The breakdown rows that render: a field that is absent, null or 0 has no row (never "$0.00",
 * never derived from the total; SH/OfferBreakdownPartial, SH/OfferTipHidden).
 */
export function breakdownRows(earnings: DispatchOffer['earnings']): BreakdownRow[] {
  const rows: BreakdownRow[] = [];
  const add = (key: BreakdownRow['key'], v: number | null | undefined) => {
    if (v != null && Number(v) !== 0) rows.push({ key, cents: Number(v) });
  };
  add('base', earnings.base_cents);
  add('distance', earnings.distance_cents);
  add('surge', earnings.surge_cents);
  add('tip', earnings.tip_so_far_cents);
  return rows;
}

export interface DropoffArea {
  /** "Harbourfront, Toronto": the neighbourhood only. */
  name: string;
  /** Eight-point direction from the pickup to the area's centre, e.g. "south-west". */
  direction: string | null;
  /** The shaded circle, only when the server sends `radius_m`; otherwise none is drawn. */
  circle: { latitude: number; longitude: number; radiusM: number } | null;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

function directionFrom(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): string | null {
  const dLat = to.latitude - from.latitude;
  const dLng = (to.longitude - from.longitude) * Math.cos(((from.latitude + to.latitude) / 2) * (Math.PI / 180));
  if (Math.abs(dLat) < 1e-4 && Math.abs(dLng) < 1e-4) return null;
  const bearing = (Math.atan2(dLng, dLat) * 180) / Math.PI;
  return COMPASS[Math.round(((bearing + 360) % 360) / 45) % 8]!;
}

export function dropoffArea(offer: DispatchOffer): DropoffArea {
  const { area, latitude, longitude, radius_m } = offer.dropoff;
  return {
    name: area,
    direction: directionFrom(offer.pickup, offer.dropoff),
    circle: radius_m != null && radius_m > 0 ? { latitude, longitude, radiusM: radius_m } : null,
  };
}

/** The map's accessible text (and its fallback when tiles cannot draw). Area only, no street. */
export function mapSummary(offer: DispatchOffer): string {
  const a = dropoffArea(offer);
  const where = a.direction ? `, ${a.direction} of the pickup` : '';
  const circle = a.circle ? `, within about ${a.circle.radiusM} m` : '';
  return `Pickup: ${offer.pickup.restaurant_name}, ${offer.pickup.address_short}. Drop-off area: ${a.name}${where}${circle}.`;
}

/** The full drop-off address, only ever from the accepted `Assignment`. */
export function fullAddress(a: Assignment): string {
  const unit = a.dropoff.unit ? ` · Unit ${a.dropoff.unit}` : '';
  return `${a.dropoff.address}${unit}`;
}

/* ------------------------------------------------------------------ state machine */

export type Step = 'idle' | 'accepting' | 'accept-failed' | 'decline' | 'declining' | 'decline-failed';

export type OfferState =
  | { kind: 'none'; seen: readonly string[] }
  | {
      kind: 'live';
      seen: readonly string[];
      offer: DispatchOffer;
      /** Device-clock ms at which the offer ends. */
      deadline: number;
      /** The ring's total: the remaining time when the offer arrived. */
      total: number;
      step: Step;
      /** The reason being sent, or the one whose send failed. */
      reason: RejectReason | null;
      more: boolean;
      error: RiderError | null;
    }
  | { kind: 'accepted'; seen: readonly string[]; offer: DispatchOffer; assignment: Assignment }
  | { kind: 'result'; seen: readonly string[]; result: ResultKind };

export type OfferEvent =
  /**
   * `receivedAt`: when the response carrying the offer arrived (the query's `updatedAt`), which
   * can be earlier than `now` when the answer was cached (the shared dashboard store). The
   * deadline counts from the receipt, not from when the layer happened to read it.
   * `acceptNew: false` (on a delivery) only follows the offer already on screen.
   */
  | { type: 'receive'; offer: DispatchOffer | null | undefined; now: number; receivedAt?: number; acceptNew?: boolean }
  | { type: 'tick'; now: number }
  | { type: 'accept-start' }
  | { type: 'accept-ok'; assignment: Assignment }
  | { type: 'accept-fail'; error: unknown }
  | { type: 'decline-open' }
  | { type: 'decline-keep' }
  | { type: 'decline-more' }
  | { type: 'decline-start'; reason: RejectReason }
  | { type: 'decline-ok' }
  | { type: 'decline-fail'; error: unknown }
  | { type: 'dismiss' };

export const INITIAL: OfferState = { kind: 'none', seen: [] };

const ACCEPT_RESULTS: Record<string, ResultKind> = {
  OFFER_EXPIRED: 'accept-expired',
  OFFER_ALREADY_TAKEN: 'taken',
  OFFER_WITHDRAWN: 'cancelled',
  ORDER_CANCELLED: 'cancelled',
  RIDER_NOT_AVAILABLE: 'not-available',
};

/** What the poll says happened to the offer on screen, when it is no longer PENDING. */
const POLLED_RESULTS: Partial<Record<string, ResultKind | 'gone'>> = {
  WITHDRAWN: 'withdrawn',
  ACCEPTED: 'taken',
  EXPIRED: 'expired',
  REJECTED: 'gone',
};

function seenWith(s: OfferState, id: string): readonly string[] {
  return s.seen.includes(id) ? s.seen : [...s.seen.slice(-49), id];
}

function busy(step: Step): boolean {
  return step === 'accepting' || step === 'declining';
}

function receive(s: OfferState, offer: DispatchOffer | null | undefined, now: number, receivedAt: number, acceptNew: boolean): OfferState {
  if (!offer) return s;
  const id = offer.offer_id;
  if (s.kind === 'live' && s.offer.offer_id === id) {
    // The answer to our own request decides while one is in flight. After a failed accept,
    // ACCEPTED may be our own accept whose answer was lost: the retry (same key) will tell.
    if (busy(s.step) || !offer.state || offer.state === 'PENDING') return s;
    if (offer.state === 'ACCEPTED' && s.step === 'accept-failed') return s;
    const next = POLLED_RESULTS[offer.state];
    if (!next) return s;
    return next === 'gone' ? { kind: 'none', seen: s.seen } : { kind: 'result', seen: s.seen, result: next };
  }
  if (s.seen.includes(id) || !acceptNew) return s;
  if (offer.state && offer.state !== 'PENDING') return s;
  const given = windowMs(offer);
  const deadline = Math.min(receivedAt, now) + given;
  const remaining = deadline - now;
  // Already over when it reached us (or when a cached answer is read late): nothing renders
  // (SH note: "an offer already past expires_at renders nothing").
  if (given <= 0 || remaining <= 0) return { ...s, seen: seenWith(s, id) };
  // One offer at a time; a new one replaces a result at once (SH/OfferReplacesResult).
  if (s.kind === 'live' || s.kind === 'accepted') return s;
  return {
    kind: 'live',
    seen: seenWith(s, id),
    offer,
    deadline,
    total: remaining,
    step: 'idle',
    reason: null,
    more: false,
    error: null,
  };
}

export function offerReducer(s: OfferState, e: OfferEvent): OfferState {
  switch (e.type) {
    case 'receive':
      return receive(s, e.offer, e.now, e.receivedAt ?? e.now, e.acceptNew ?? true);
    case 'dismiss':
      return { kind: 'none', seen: s.seen };
    default:
      break;
  }
  return s.kind === 'live' ? live(s, e) : s;
}

type Live = Extract<OfferState, { kind: 'live' }>;

function live(s: Live, e: OfferEvent): OfferState {
  switch (e.type) {
    case 'tick':
      if (e.now < s.deadline) return s;
      // A decline still out when time runs out: the offer is over either way, which is what the
      // rider asked for. Close silently, like a 409 on decline (SH/OfferDeclining).
      if (s.step === 'declining') return { kind: 'none', seen: s.seen };
      // Time is up, unless our accept is still out: its answer decides.
      return s.step === 'accepting' ? s : { kind: 'result', seen: s.seen, result: 'expired' };
    case 'accept-start':
      return { ...s, step: 'accepting', error: null };
    case 'accept-ok':
      return { kind: 'accepted', seen: s.seen, offer: s.offer, assignment: e.assignment };
    case 'accept-fail': {
      const error = toRiderError(e.error);
      const result = error.code ? ACCEPT_RESULTS[error.code] : undefined;
      return result ? { kind: 'result', seen: s.seen, result } : { ...s, step: 'accept-failed', error };
    }
    case 'decline-open':
      return busy(s.step) ? s : { ...s, step: 'decline', error: null };
    case 'decline-keep':
      return s.step === 'declining' ? s : { ...s, step: 'idle', reason: null, error: null, more: false };
    case 'decline-more':
      return { ...s, more: true };
    case 'decline-start':
      return { ...s, step: 'declining', reason: e.reason, error: null };
    case 'decline-ok':
      return { kind: 'none', seen: s.seen };
    case 'decline-fail': {
      const error = toRiderError(e.error);
      // 409 (OFFER_EXPIRED and the rest): the offer is over either way, and declining it was the
      // rider's wish. Silent (SH/OfferDeclining).
      if (error.status === 409) return { kind: 'none', seen: s.seen };
      return { ...s, step: 'decline-failed', error };
    }
    default:
      return s;
  }
}
