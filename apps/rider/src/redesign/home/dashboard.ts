/**
 * The rider dashboard, read once for the whole signed-in app.
 *
 * `GET /v1/riders/me/dashboard` is the only source of `mode`, today's figures, tracking health,
 * blocking reasons, the active assignment and the current offer (SH note "Home and shift —
 * behaviour"). One poller (`DashboardPoller`, registered as a layer so it lives as long as the
 * signed-in shell) runs `useApiQuery` and publishes into this store; every reader —
 * Home, the resume strip, WP3's offer layer — calls `useRiderDashboard()` and shares that one
 * request. Polling is fast while online and slower offline, paused in the background.
 *
 * The same store holds the availability round trip (`setRiderAvailability`): what is in flight,
 * what the last answer was, and the notice it left (blocked rows, failed, refused). The mode the
 * rider sees never flips before the PUT answers: a confirmed answer is shown until a newer
 * dashboard arrives, and nothing is ever set locally on a tap.
 *
 * While the shift is online the poller also keeps positions flowing (`useLocationReporting`
 * from `src/location.ts`: every interval while online, nothing while offline), and asks once per
 * session to register the device for push (`registerDevice`, via `src/push.ts`).
 */
import * as React from 'react';
import { unwrap, type Schema } from '@hg/api-client';

import { useLocationReporting, type LocationOutcome } from '../../location';
import { registerForPush } from '../../push';
import { rider } from '../data/client';
import type { RiderError } from '../data/errors';
import { useApiQuery, type QueryResult } from '../data/query';
import type { BlockingReason } from './copy';

export type RiderDashboard = Schema['RiderDashboard'];
export type RiderAvailabilityState = Schema['RiderAvailabilityState'];
export type Assignment = Schema['Assignment'];

export const ONLINE_POLL_MS = 5_000;
export const OFFLINE_POLL_MS = 15_000;

/** What the last availability request left on screen. */
export type AvailabilityNotice =
  /** 422 CANNOT_GO_ONLINE, a 403 onboarding/account/payout code, or no location permission. */
  | { kind: 'blocked'; reasons: BlockingReason[] }
  /** Network or 5xx on Go online: still offline (SH/HomeOnlineFailed). */
  | { kind: 'online-failed' }
  /** Network or 5xx on Go offline: still online (SH/HomeOfflineFailed). */
  | { kind: 'offline-failed' }
  /** 409 ACTIVE_DELIVERY_IN_PROGRESS on Go offline (SH/HomeGoOfflineRefused). */
  | { kind: 'offline-refused' }
  /** "Go offline after this delivery" (or undoing it) did not reach us. */
  | { kind: 'after-failed'; error: RiderError };

export type PendingAvailability = 'online' | 'offline' | 'after' | null;

interface StoreState {
  query: QueryResult<RiderDashboard>;
  /** A confirmed `setRiderAvailability` answer, shown until a newer dashboard arrives. */
  confirmed: { mode: RiderAvailabilityState; at: number } | null;
  pending: PendingAvailability;
  notice: AvailabilityNotice | null;
  /** From the PUT answer: the dashboard does not carry it. */
  goOfflineAfter: boolean;
  /** The dashboard went OFFLINE without the rider asking (SH/OfflineNoReason). */
  forcedOffline: boolean;
  /** The OS refused location while online (client-side banner). */
  locationDenied: boolean;
}

const idleQuery: QueryResult<RiderDashboard> = {
  status: 'loading',
  data: undefined,
  error: null,
  refreshing: false,
  updatedAt: 0,
  refetch: async () => {},
};

const initial: StoreState = {
  query: idleQuery,
  confirmed: null,
  pending: null,
  notice: null,
  goOfflineAfter: false,
  forcedOffline: false,
  locationDenied: false,
};

let state: StoreState = initial;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

/** Internal to the home folder (availability actions); not exported from `home/index.ts`. */
export function getHomeState(): StoreState {
  return state;
}

export function updateHomeState(patch: Partial<StoreState>): void {
  state = { ...state, ...patch };
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam, and what a sign-out does (the poller unmounts with the shell). */
export function resetHomeState(): void {
  state = initial;
  pushAsked = false;
  openedTrips.clear();
  emit();
}

/** Assignments Home has already opened the trip for: once per assignment, so Back is not undone. */
const openedTrips = new Set<string>();

/** `true` the first time it is called for an assignment id, `false` after. */
export function claimTripOpen(assignmentId: string): boolean {
  if (openedTrips.has(assignmentId)) return false;
  openedTrips.add(assignmentId);
  return true;
}

const ONLINE_MODES: ReadonlySet<RiderAvailabilityState> = new Set(['ONLINE_IDLE', 'ONLINE_STALE', 'ON_DELIVERY']);

export function isOnlineMode(mode: RiderAvailabilityState | null | undefined): boolean {
  return !!mode && ONLINE_MODES.has(mode);
}

function effectiveMode(s: StoreState): RiderAvailabilityState | null {
  if (s.confirmed && s.confirmed.at >= s.query.updatedAt) return s.confirmed.mode;
  return s.query.data?.mode ?? null;
}

function deliveryOf(data: RiderDashboard | undefined): Assignment | null {
  return data?.active_assignment ?? null;
}

/** A new answer from the poller: apply it, and read what changed under the rider. */
function publish(query: QueryResult<RiderDashboard>): void {
  const prev = state;
  const fresh = query.updatedAt > prev.query.updatedAt && query.data !== undefined;
  if (!fresh) {
    state = { ...prev, query };
    emit();
    return;
  }
  const data = query.data!;
  const before = effectiveMode(prev);
  const onDelivery = data.mode === 'ON_DELIVERY' || deliveryOf(data) !== null;
  const wasOnDelivery = prev.query.data ? prev.query.data.mode === 'ON_DELIVERY' || deliveryOf(prev.query.data) !== null : false;
  // Online (or on a delivery) a moment ago, offline now, and the rider did not ask for it:
  // HalalGoes set them offline (`rider.availability_changed` carries no reason).
  const forced =
    data.mode === 'OFFLINE' &&
    isOnlineMode(before) &&
    prev.pending !== 'offline' &&
    !prev.goOfflineAfter &&
    (prev.confirmed === null || prev.confirmed.mode !== 'OFFLINE');
  state = {
    ...prev,
    query,
    confirmed: prev.confirmed && prev.confirmed.at >= query.updatedAt ? prev.confirmed : null,
    forcedOffline: data.mode === 'OFFLINE' ? prev.forcedOffline || forced : false,
    goOfflineAfter: onDelivery ? prev.goOfflineAfter : false,
    // The refusal stands until the delivery it was about has ended.
    notice: prev.notice?.kind === 'offline-refused' && wasOnDelivery && !onDelivery ? null : prev.notice,
  };
  emit();
}

export function fetchRiderDashboard(): Promise<RiderDashboard> {
  return unwrap(rider.GET('/v1/riders/me/dashboard')).then((body) => (body as { data: RiderDashboard }).data);
}

export interface RiderDashboardView extends QueryResult<RiderDashboard> {
  /** The mode to show: the server's, or a confirmed availability answer newer than it. */
  mode: RiderAvailabilityState | null;
  /** ON_DELIVERY, or an active assignment is in hand. */
  onDelivery: boolean;
  assignment: Assignment | null;
  pending: PendingAvailability;
  notice: AvailabilityNotice | null;
  goOfflineAfter: boolean;
  forcedOffline: boolean;
  locationDenied: boolean;
}

function view(s: StoreState): RiderDashboardView {
  const mode = effectiveMode(s);
  const assignment = deliveryOf(s.query.data);
  return {
    ...s.query,
    mode,
    assignment,
    onDelivery: mode === 'ON_DELIVERY' || assignment !== null,
    pending: s.pending,
    notice: s.notice,
    goOfflineAfter: s.goOfflineAfter,
    forcedOffline: s.forcedOffline,
    locationDenied: s.locationDenied,
  };
}

let cachedFor: StoreState | null = null;
let cachedView: RiderDashboardView | null = null;
function snapshot(): RiderDashboardView {
  if (cachedFor !== state || !cachedView) {
    cachedFor = state;
    cachedView = view(state);
  }
  return cachedView;
}

/**
 * The dashboard every redesigned rider screen reads (Home, the resume strip, the offer layer).
 * Re-renders on each poll and each availability step.
 */
export function useRiderDashboard(): RiderDashboardView {
  return React.useSyncExternalStore(subscribe, snapshot, snapshot);
}

let pushAsked = false;

/**
 * The one poller, mounted as a layer for the life of the signed-in shell. Renders nothing.
 */
export function DashboardPoller(): null {
  const query = useApiQuery('rider-dashboard', fetchRiderDashboard, {
    pollMs: (d) => (d && d.mode !== 'OFFLINE' ? ONLINE_POLL_MS : OFFLINE_POLL_MS),
  });

  React.useEffect(() => {
    publish(query);
    // `query` is a fresh object each render; these are the fields that change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.status, query.data, query.error, query.updatedAt, query.refreshing]);

  React.useEffect(() => {
    if (!pushAsked) {
      pushAsked = true;
      void registerForPush();
    }
    return () => resetHomeState();
  }, []);

  const dash = useRiderDashboard();
  const onOutcome = React.useCallback((o: LocationOutcome) => {
    const denied = !o.ok && o.reason === 'PERMISSION_DENIED';
    if (denied !== getHomeState().locationDenied) updateHomeState({ locationDenied: denied });
  }, []);
  // Positions every interval while online; nothing while offline (D-11).
  useLocationReporting(isOnlineMode(dash.mode), dash.assignment, onOutcome);
  return null;
}
