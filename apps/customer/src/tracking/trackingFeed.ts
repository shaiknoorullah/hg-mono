/**
 * One order's live tracking state, from two sources that render identically
 * (contracts/websocket.md, client rules 7-8): the socket's `rider.location` events, and the
 * REST tracking endpoint, which is polled every 5 s whenever the socket is not open. Framework
 * free, so it is tested with fake timers. The newest fix by `recorded_at` wins, whichever source
 * delivered it. Polling stops once the order is finished.
 */
import type { RiderLocationData } from '@hg/api-client';

import type { OrderTracking } from '../api/orders';

export const POLL_MS = 5_000;
/** A rider fix older than this is shown as "updated Ns ago". */
export const STALE_AFTER_MS = 30_000;

const FINISHED: ReadonlySet<string> = new Set([
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'RESOLVED',
]);

export type RiderFix = {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  /** Epoch ms of the fix itself (not of its arrival). */
  recordedAtMs: number;
};

export type TrackingSnapshot = {
  /** The last REST response: ETA, restaurant and drop-off. Null until the first one arrives. */
  tracking: OrderTracking | null;
  rider: RiderFix | null;
  /** `live` while the socket is open, else `polling`. */
  link: 'live' | 'polling';
  /** The latest REST fetch failed and there is nothing to show yet. */
  error: boolean;
  /** Counts `order.*` / `payment.*` events from the socket; a change means "re-read the order". */
  orderEvents: number;
  /** Epoch ms of the last successful REST read, for "Updated 7:05 pm" while polling. */
  updatedAtMs: number | null;
};


export type TrackingFeedDeps = {
  fetchTracking: () => Promise<OrderTracking>;
  /** Opens the order channel; see realtime/orderSocket.ts. Returns its stop function. */
  openSocket: (handlers: {
    onLink: (open: boolean) => void;
    onRiderLocation: (fix: RiderLocationData) => void;
    onOrderEvent?: (type: string) => void;
  }) => () => void;
};

function fixFromRest(t: OrderTracking): RiderFix | null {
  const r = t.rider_location;
  if (!r) return null;
  const at = Date.parse(r.recorded_at);
  if (Number.isNaN(at)) return null;
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    headingDeg: r.heading_deg ?? null,
    recordedAtMs: at,
  };
}

function fixFromSocket(d: RiderLocationData): RiderFix | null {
  const at = Date.parse(d.recorded_at);
  if (Number.isNaN(at) || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return null;
  return { latitude: d.lat, longitude: d.lng, headingDeg: d.heading_deg ?? null, recordedAtMs: at };
}

export function createTrackingFeed(deps: TrackingFeedDeps) {
  let snap: TrackingSnapshot = {
    tracking: null,
    rider: null,
    link: 'polling',
    error: false,
    orderEvents: 0,
    updatedAtMs: null,
  };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closeSocket: (() => void) | undefined;
  let stopped = false;
  let finished = false;
  let inflight = false;

  const set = (next: Partial<TrackingSnapshot>) => {
    snap = { ...snap, ...next };
    listeners.forEach((l) => l());
  };

  const take = (fix: RiderFix | null) => {
    if (!fix || (snap.rider && fix.recordedAtMs < snap.rider.recordedAtMs)) return;
    set({ rider: fix });
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    // Poll only while the socket is down; one REST read happens on every (re)connect instead.
    if (stopped || finished || snap.link === 'live') return;
    timer = setTimeout(() => void poll(), POLL_MS);
  };

  const poll = async () => {
    if (stopped || inflight) return;
    inflight = true;
    try {
      const t = await deps.fetchTracking();
      if (stopped) return;
      finished = FINISHED.has(t.state);
      set({ tracking: t, error: false, updatedAtMs: Date.now() });
      take(fixFromRest(t));
    } catch {
      if (!stopped && !snap.tracking) set({ error: true });
    } finally {
      inflight = false;
      schedule();
    }
  };

  return {
    start() {
      void poll();
      closeSocket = deps.openSocket({
        onLink: (open) => {
          if (stopped) return;
          set({ link: open ? 'live' : 'polling' });
          // Catch up on whatever the socket missed while it was down, then (if it is down) keep polling.
          if (open) void poll();
          else schedule();
        },
        onRiderLocation: (d) => take(fixFromSocket(d)),
        onOrderEvent: () => {
          if (stopped) return;
          set({ orderEvents: snap.orderEvents + 1 });
          // The REST projection carries the new state, ETA and timeline.
          void poll();
        },
      });
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      closeSocket?.();
      listeners.clear();
    },
    /** Retry now (after an error). */
    retry() {
      set({ error: false });
      void poll();
    },
    getSnapshot: () => snap,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Whole seconds since a fix, or null while it is fresh enough not to mention. */
export function staleSeconds(fix: RiderFix | null, nowMs: number): number | null {
  if (!fix) return null;
  const age = nowMs - fix.recordedAtMs;
  return age > STALE_AFTER_MS ? Math.floor(age / 1000) : null;
}

/** Linear blend between two fixes' positions, for animating the marker between updates. */
export function lerpPoint(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
  t: number,
): { latitude: number; longitude: number } {
  const k = Math.min(1, Math.max(0, t));
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * k,
    longitude: from.longitude + (to.longitude - from.longitude) * k,
  };
}

/** The box around every known point, as Mapbox wants it ([longitude, latitude] corners), or null with none. */
export function boundsOf(
  points: ReadonlyArray<{ latitude: number; longitude: number } | null | undefined>,
): { ne: [number, number]; sw: [number, number] } | null {
  const ps = points.filter((p): p is { latitude: number; longitude: number } => Boolean(p));
  if (ps.length === 0) return null;
  const lats = ps.map((p) => p.latitude);
  const lngs = ps.map((p) => p.longitude);
  return {
    sw: [Math.min(...lngs), Math.min(...lats)],
    ne: [Math.max(...lngs), Math.max(...lats)],
  };
}
