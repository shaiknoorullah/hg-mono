/**
 * The trip's data: one assignment, polled, merged with the steps the rider has tapped that have
 * not reached us yet, and the route each state belongs to.
 *
 * Every trip screen (this WP's pickup steps, WP5's drop-off, WP6's endings) reads the delivery
 * through `useTripAssignment(id)` and follows it with `useFollowTrip`, so the polling, the
 * "steps saved offline" view and the routing rule live in one place:
 *
 * - `GET /v1/riders/me/assignments/{id}` every 5 s while the delivery is live (no socket yet,
 *   #29), paused in the background, and once on return to the foreground.
 * - The last answer is kept per assignment, so moving from one step screen to the next never
 *   flashes a loading state, and a transition's own 200 answer shows at once.
 * - `state` is the server's state advanced by the steps still waiting in the outbox (they are
 *   accepted up to 2 h late with their original `occurred_at`), so an offline rider keeps moving
 *   through the boards. A step the server refused on replay, and anything queued behind it, does
 *   not count.
 *
 * Steps go through `sendStep` (the WP0 outbox): sent now, or queued on a transport failure; API
 * errors are thrown for the screen that owns the board.
 */
import * as React from 'react';
import { Linking } from 'react-native';
import { idempotencyKey, unwrap, type Schema } from '@hg/api-client';

import { getFreshFix } from '../../location';
import { rider } from '../data/client';
import { toRiderError, type RiderError } from '../data/errors';
import { outbox, type OutboxEntry, type SendResult, type TransitionInput } from '../data/outbox';
import { useApiQuery } from '../data/query';
import { useOutbox } from '../data/useOutbox';
import { useNav } from '../nav/Navigator';

export type Assignment = Schema['Assignment'];
export type AssignmentState = Schema['AssignmentState'];

declare module '../nav/routes' {
  interface RedesignRoutes {
    /** Step 1: ASSIGNED, EN_ROUTE_TO_PICKUP (this WP). */
    tripPickup: { assignmentId: string };
    /** Step 2: ARRIVED_AT_PICKUP, waiting, then items and the pickup code (this WP). */
    tripAtRestaurant: { assignmentId: string };
    /** R33 calls and notes, pushed from any trip step (this WP). */
    tripContact: { assignmentId: string };
    /** Steps 3 and 4, from PICKED_UP on. WP5 registers it; until then the fallback shows. */
    tripDropoff: { assignmentId: string };
    /** Delivered, returned, cancelled, moved to another rider. WP6 registers it. */
    tripEnded: { assignmentId: string };
  }
}

/**
 * `PickupTransitionInput` from contract PR #290: PICKED_UP carries the 4-digit `pickup_code`.
 * Typed here as a narrow extension of the generated input until #290 merges and the client is
 * regenerated; then this becomes `Schema['PickupTransitionInput']`.
 */
export type TripStepInput = Omit<TransitionInput, 'occurred_at'> & {
  occurred_at?: string;
  /** Until #290 merges: `^[0-9]{4}$`, PICKED_UP only, never echoed back. */
  pickup_code?: string;
};

export const TRIP_POLL_MS = 5_000;
/** How long a step waits for a GPS fix before it goes without one (the fields are optional). */
export const FIX_TIMEOUT_MS = 5_000;

export type TripRoute = 'tripPickup' | 'tripAtRestaurant' | 'tripDropoff' | 'tripEnded';

/** Forward order of the dispatch machine; repeating a state is a no-op, going back is a 409. */
const RANK: Record<AssignmentState, number> = {
  ASSIGNED: 0,
  EN_ROUTE_TO_PICKUP: 1,
  ARRIVED_AT_PICKUP: 2,
  PICKED_UP: 3,
  EN_ROUTE_TO_DROPOFF: 4,
  ARRIVED_AT_DROPOFF: 5,
  UNDELIVERABLE: 6,
  DELIVERED: 7,
  RETURNING: 7,
  RETURNED: 8,
  CANCELLED_BY_PLATFORM: 9,
  REASSIGNED: 9,
};

export const ENDED: ReadonlySet<AssignmentState> = new Set(['DELIVERED', 'RETURNED', 'CANCELLED_BY_PLATFORM', 'REASSIGNED']);

/** Which screen a state belongs to. */
export function routeFor(state: AssignmentState): TripRoute {
  switch (state) {
    case 'ASSIGNED':
    case 'EN_ROUTE_TO_PICKUP':
      return 'tripPickup';
    case 'ARRIVED_AT_PICKUP':
      return 'tripAtRestaurant';
    default:
      return ENDED.has(state) ? 'tripEnded' : 'tripDropoff';
  }
}

/**
 * The server's state advanced by the steps still waiting to send (up to the first refused one),
 * and by `floor`: the furthest step the outbox has already replayed, which the next poll has not
 * caught up with yet (so a replay never bounces the rider back a screen for up to 5 s).
 */
export function effectiveState(server: AssignmentState, entries: readonly OutboxEntry[], floor?: AssignmentState): AssignmentState {
  if (ENDED.has(server)) return server;
  let state = floor && RANK[floor] > RANK[server] ? floor : server;
  for (const entry of entries) {
    if (entry.status === 'rejected') break;
    const next = entry.input.to_state;
    if (RANK[next] > RANK[state]) state = next;
  }
  return state;
}

/* ------------------------------------------------------------------ the shared answer store */

interface Cached {
  data: Assignment;
  at: number;
}

const cache = new Map<string, Cached>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Keep a newer answer for an assignment (a poll, a transition's 200, the dashboard's copy), under
 * the id it was asked for. The machine only moves forward, so an answer behind the one kept (a
 * poll that left before a step's 200 and landed after it) is dropped rather than shown.
 */
export function putAssignment(a: Assignment, at: number = Date.now(), id: string = a.id): void {
  const prev = cache.get(id);
  if (prev && (prev.at > at || RANK[a.state] < RANK[prev.data.state])) return;
  cache.set(id, { data: a, at });
  emit();
}

export function cachedAssignment(id: string): Assignment | undefined {
  return cache.get(id)?.data;
}

/* Steps the outbox replayed: a pending entry that left the queue was accepted (a refused one is
 * marked `rejected` first, and `dismiss` only drops refused ones). */
const floors = new Map<string, AssignmentState>();
let lastEntries: readonly OutboxEntry[] = outbox.snapshot();
outbox.subscribe(() => {
  const now = outbox.snapshot();
  const still = new Set(now.map((e) => e.id));
  for (const gone of lastEntries) {
    if (gone.status === 'rejected' || still.has(gone.id)) continue;
    const prev = floors.get(gone.assignmentId);
    if (!prev || RANK[gone.input.to_state] > RANK[prev]) floors.set(gone.assignmentId, gone.input.to_state);
  }
  lastEntries = now;
  emit();
});

/** What a 409 left for the next screen to say (DL/TripOutOfDate). */
export interface TripNotice {
  kind: 'out-of-date';
  state: AssignmentState;
}

const notices = new Map<string, TripNotice>();

export function setTripNotice(id: string, notice: TripNotice | null): void {
  if (notice) notices.set(id, notice);
  else notices.delete(id);
  emit();
}

export function useTripNotice(id: string): TripNotice | null {
  return React.useSyncExternalStore(
    subscribe,
    () => notices.get(id) ?? null,
    () => notices.get(id) ?? null,
  );
}

/** Test seam, and a sign-out. */
export function resetTripState(): void {
  cache.clear();
  notices.clear();
  floors.clear();
  lastEntries = outbox.snapshot();
  autoStarted.clear();
  emit();
}

/* ------------------------------------------------------------------ reading */

export async function fetchAssignment(id: string): Promise<Assignment> {
  const body = await unwrap(rider.GET('/v1/riders/me/assignments/{assignmentId}', { params: { path: { assignmentId: id } } }));
  return (body as { data: Assignment }).data;
}

export interface TripAssignmentView {
  /** The assignment asked for (the route's id: key every per-trip store by this, not `assignment.id`). */
  id: string | null;
  status: 'loading' | 'error' | 'success';
  /** The server's last answer. */
  assignment: Assignment | undefined;
  /** The state to show: the server's, advanced by steps still waiting to send. */
  state: AssignmentState | undefined;
  /** Steps for this assignment not yet confirmed, oldest first (pending and refused). */
  saved: readonly OutboxEntry[];
  /** The last failure: alone (`status: 'error'`) or with older data (a refetch failed). */
  error: RiderError | null;
  /** When the shown answer arrived (ms epoch), or 0. */
  updatedAt: number;
  refetch: () => Promise<void>;
}

const NO_ID = '__none__';

/** The delivery, polled every 5 s while it is live. `null` holds the request. */
export function useTripAssignment(assignmentId: string | null): TripAssignmentView {
  const id = assignmentId ?? NO_ID;
  const query = useApiQuery(`assignment-${id}`, () => fetchAssignment(id), {
    enabled: assignmentId !== null,
    pollMs: (d) => (d && ENDED.has(d.state) ? null : TRIP_POLL_MS),
  });
  React.useEffect(() => {
    if (query.data && query.updatedAt) putAssignment(query.data, query.updatedAt, id);
  }, [query.data, query.updatedAt, id]);
  const cached = React.useSyncExternalStore(
    subscribe,
    () => cache.get(id),
    () => cache.get(id),
  );
  const saved = useOutbox(id);
  const floor = React.useSyncExternalStore(
    subscribe,
    () => floors.get(id),
    () => floors.get(id),
  );
  const assignment = cached?.data ?? query.data;
  // The delivery ended (delivered, cancelled, moved to another rider): its saved steps are moot.
  // Left in the queue they would replay into a 409 and open QueuedRejected over Home.
  const ended = !!assignment && ENDED.has(assignment.state);
  React.useEffect(() => {
    if (ended && assignmentId && saved.length) void outbox.clearAssignment(assignmentId);
  }, [ended, assignmentId, saved.length]);
  return {
    id: assignmentId,
    status: assignment ? 'success' : query.status,
    assignment,
    state: assignment ? effectiveState(assignment.state, saved, floor) : undefined,
    saved,
    error: query.error,
    updatedAt: cached?.at ?? query.updatedAt,
    refetch: query.refetch,
  };
}

/**
 * Keep the screen in step with the delivery: when the state belongs to another screen, replace
 * this one with it. `hold` keeps the rider on a board that must be read first (the pickup saved
 * offline: "Go to the customer" moves on).
 */
export function useFollowTrip(assignmentId: string, view: TripAssignmentView, here: TripRoute, hold = false): void {
  const nav = useNav();
  const target = view.state ? routeFor(view.state) : null;
  React.useEffect(() => {
    if (!hold && target && target !== here) nav.replace(target, { assignmentId });
    // Follow a change of target only; `nav` is a fresh object on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, hold, here, assignmentId]);
}

/* ------------------------------------------------------------------ steps */

/** One attempt at a step: its key and body are kept, so "Try again" is the same request. */
export interface PreparedStep {
  key: string;
  input: TripStepInput & { occurred_at: string };
}

async function currentFix(): Promise<Pick<TransitionInput, 'latitude' | 'longitude' | 'accuracy_m'>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
  });
  const outcome = await Promise.race([getFreshFix(true).catch(() => null), timeout]).finally(() => clearTimeout(timer));
  if (!outcome || !outcome.ok) return {};
  const { latitude, longitude, accuracy_m } = outcome.fix;
  return accuracy_m == null ? { latitude, longitude } : { latitude, longitude, accuracy_m };
}

/** Stamp a step with the time of the tap and a real position (when the phone has one). */
export async function prepareStep(input: Omit<TripStepInput, 'occurred_at'>): Promise<PreparedStep> {
  const occurred_at = new Date().toISOString();
  const fix = await currentFix();
  return { key: idempotencyKey(), input: { ...fix, ...input, occurred_at } };
}

/** Send a prepared step (or queue it offline). A 200 shows at once. */
export async function sendStep(assignmentId: string, step: PreparedStep): Promise<SendResult> {
  const result = await outbox.send(assignmentId, step.input as TransitionInput, { key: step.key });
  if (!result.queued) putAssignment(result.assignment, Date.now(), assignmentId);
  return result;
}

/**
 * Post a step straight away, outside the queue: a saved pickup whose code was refused holds the
 * queue (DL/PickupCodeRejectedLater), so the corrected code has to go first. Never queued.
 */
export async function postNow(assignmentId: string, step: PreparedStep): Promise<Assignment> {
  const body = await unwrap(
    rider.POST('/v1/riders/me/assignments/{assignmentId}/transitions', {
      params: { path: { assignmentId }, header: { 'Idempotency-Key': step.key } },
      body: step.input as TransitionInput,
    }),
  );
  const assignment = (body as { data: Assignment }).data;
  putAssignment(assignment, Date.now(), assignmentId);
  return assignment;
}

/** How a step failed, by the contract code: each kind has its own board. */
export type StepFailure =
  | { kind: 'geofence' }
  | { kind: 'code-incorrect'; attemptsRemaining: number | null }
  | { kind: 'code-locked' }
  | { kind: 'out-of-date'; state: AssignmentState | null }
  | { kind: 'failed'; error: RiderError };

export function classifyStepError(e: unknown): StepFailure {
  const error = toRiderError(e);
  const details = (error.details ?? {}) as { attempts_remaining?: unknown; current_state?: unknown };
  switch (error.code) {
    case 'GEOFENCE_REQUIRED':
      return { kind: 'geofence' };
    case 'PICKUP_CODE_INCORRECT':
      return {
        kind: 'code-incorrect',
        attemptsRemaining: typeof details.attempts_remaining === 'number' ? details.attempts_remaining : null,
      };
    case 'PICKUP_CODE_LOCKED':
      return { kind: 'code-locked' };
    case 'INVALID_TRANSITION':
    case 'ILLEGAL_TRANSITION':
      return {
        kind: 'out-of-date',
        state: typeof details.current_state === 'string' && details.current_state in RANK ? (details.current_state as AssignmentState) : null,
      };
    default:
      return { kind: 'failed', error };
  }
}

/**
 * A 409: the delivery moved on elsewhere. Say so on the step it lands on, and re-read it so the
 * screen follows (DL/TripOutOfDate).
 */
export async function resyncAfterConflict(assignmentId: string, state: AssignmentState | null, refetch: () => Promise<void>): Promise<void> {
  const known = state ?? cachedAssignment(assignmentId)?.state ?? null;
  if (known) setTripNotice(assignmentId, { kind: 'out-of-date', state: known });
  await refetch();
  const after = cachedAssignment(assignmentId)?.state;
  if (!state && after) setTripNotice(assignmentId, { kind: 'out-of-date', state: after });
}

/* ------------------------------------------------------------------ EN_ROUTE_TO_PICKUP on accept */

const autoStarted = new Set<string>();

/**
 * EN_ROUTE_TO_PICKUP has no button: it is posted once, as soon as the trip opens on an ASSIGNED
 * delivery (DL note "EN_ROUTE_TO_PICKUP is posted on accept"). `true` the first time per
 * assignment in this app run.
 */
export function claimAutoStart(assignmentId: string): boolean {
  if (autoStarted.has(assignmentId)) return false;
  autoStarted.add(assignmentId);
  return true;
}

/* ------------------------------------------------------------------ calls and maps */

export function dial(phone: string): void {
  void Linking.openURL(`tel:${phone}`);
}

/** The OS maps app, turn-by-turn to a point (Navigate). */
export function openDirections(latitude: number, longitude: number): void {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`);
}

/** Whole minutes since an ISO time, re-rendering every 30 s (the wait timer). */
export function useMinutesSince(iso: string | null | undefined): number | null {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now - at) / 60_000));
}

/** The order's items counted the way the bag is counted: quantities summed. */
export function itemCount(a: Assignment): number {
  return a.items.reduce((n, item) => n + item.quantity, 0);
}
