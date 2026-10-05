/**
 * Rider positions as the live maps hold them, from either delivery path: the socket's
 * `rider.location` event or the REST `rider_location` field. Both normalise to `RiderFix`, so
 * a screen renders identically on the socket and on the polling path (websocket.md "Client
 * checklist").
 */
import type { RiderLocationData, Schema } from '@hg/api-client';

/** One rider position. `coarse` marks the restaurant's ~100 m projection. */
export interface RiderFix {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  accuracyM: number | null;
  /** RFC3339, when the phone took the fix — never when it arrived. */
  recordedAt: string;
  coarse: boolean;
}

/** After this long without a new fix the map says how old the position is. */
export const STALE_FIX_MS = 30_000;

/** The radius drawn for a coarse position: the contract rounds it to about 100 m. */
export const COARSE_RADIUS_M = 100;

/** A `rider.location` event payload as a fix. The restaurant passes `coarse: true`. */
export function fixFromEvent(data: RiderLocationData, coarse = false): RiderFix {
  return {
    latitude: data.lat,
    longitude: data.lng,
    headingDeg: data.heading_deg ?? null,
    accuracyM: data.accuracy_m ?? null,
    recordedAt: data.recorded_at,
    coarse,
  };
}

/** A REST `RiderLocation` as a fix, or `null` when there is none. */
export function fixFromRest(location: Schema['RiderLocation'] | null | undefined): RiderFix | null {
  if (!location) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    headingDeg: location.heading_deg ?? null,
    accuracyM: location.accuracy_m ?? null,
    recordedAt: location.recorded_at,
    coarse: location.is_coarse ?? false,
  };
}

/**
 * Keeps whichever fix was recorded later. Delivery is at-least-once and a resume replays old
 * events, so an arriving fix can be older than the one on screen — it must not move the pin
 * backwards.
 */
export function newerFix(current: RiderFix | null, next: RiderFix | null): RiderFix | null {
  if (!next) return current;
  if (!current) return next;
  return Date.parse(next.recordedAt) >= Date.parse(current.recordedAt) ? next : current;
}

/** Whole seconds since the fix was recorded, never negative (device clocks drift). */
export function fixAgeSeconds(fix: RiderFix, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(fix.recordedAt)) / 1000));
}

/** `true` once the fix is older than `STALE_FIX_MS`. */
export function isStale(fix: RiderFix, now: number = Date.now()): boolean {
  return now - Date.parse(fix.recordedAt) > STALE_FIX_MS;
}

/** "Last updated 42s ago" / "Last updated 3 min ago". */
export function lastUpdatedLabel(fix: RiderFix, now: number = Date.now()): string {
  const s = fixAgeSeconds(fix, now);
  if (s < 120) return `Last updated ${s}s ago`;
  return `Last updated ${Math.floor(s / 60)} min ago`;
}
