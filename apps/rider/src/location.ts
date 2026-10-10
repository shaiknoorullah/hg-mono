/**
 * Device geolocation for the rider's shift (P-30 / D-11 / D-12).
 *
 * `setRiderAvailability` itself carries `latitude` / `longitude` / `accuracy_m` — the server
 * treats a fix on that same request as fresh (`SetAvailability`, `service.go`: "the toggle
 * carried a fresh fix"). Positions are refused server-side while a rider is OFFLINE (D-11: no
 * collection offline), so the go-online PUT is the only place a fix can be established from
 * cold; `POST /v1/riders/me/positions` (`reportRiderPositions`) then keeps that fix from going
 * stale for as long as the shift stays online.
 *
 * This module is the only place in the app that touches `expo-location` — one function to get a
 * fix (for the PUT), one to report it on the positions endpoint, one hook that keeps reporting on
 * an interval for as long as a screen wants a live shift, and one hook that watches the device's
 * position for the live map.
 *
 * Reporting cadence: every 5 s while the rider holds an active assignment (heading to the
 * restaurant or carrying the order), because each report is what moves the rider on the
 * customer's and the restaurant's live maps (`rider.location`, at most one per 5 s per order);
 * every 20 s when online and idle, which is enough to keep the dispatch fix fresh.
 *
 * Works unchanged on web: `expo-location` shims to the browser Geolocation API there, so the
 * same call path drives both the Expo web target and native builds.
 */
import * as React from 'react';
import * as Location from 'expo-location';

import type { Schema } from '@hg/api-client';

import { api } from './api';

/** Online and idle: keeps the dispatch fix fresh. */
export const REPORT_INTERVAL_MS = 20_000;
/** Holding an active assignment: one report per `rider.location` slot the server can publish. */
export const DELIVERY_REPORT_INTERVAL_MS = 5_000;

/** The assignment states in which the rider is heading to the restaurant or carrying the order. */
const ACTIVE_ASSIGNMENT_STATES: ReadonlySet<Schema['AssignmentState']> = new Set([
  'ASSIGNED',
  'EN_ROUTE_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'PICKED_UP',
  'EN_ROUTE_TO_DROPOFF',
  'ARRIVED_AT_DROPOFF',
  'RETURNING',
]);

/** The assignment the reports belong to, when there is one and it is still being worked. */
export interface ActiveAssignmentRef {
  id: string;
  state: Schema['AssignmentState'];
}

export function isActiveAssignment(a: ActiveAssignmentRef | null | undefined): boolean {
  return !!a && ACTIVE_ASSIGNMENT_STATES.has(a.state);
}

export function reportIntervalMs(a: ActiveAssignmentRef | null | undefined): number {
  return isActiveAssignment(a) ? DELIVERY_REPORT_INTERVAL_MS : REPORT_INTERVAL_MS;
}

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy_m?: number;
  /** Degrees clockwise from north, 0–360; absent when the device has no valid course. */
  heading_deg?: number;
  speed_mps?: number;
  recorded_at: string;
}

type DeviceFix = {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp: number;
};

/** A device fix in the contract's shape. iOS reports -1 for an unknown course or speed; those
 *  are dropped rather than sent, since the contract bounds both at 0. */
function toFix(fix: DeviceFix): Fix {
  const { heading, speed, accuracy } = fix.coords;
  return {
    latitude: fix.coords.latitude,
    longitude: fix.coords.longitude,
    accuracy_m: accuracy != null && accuracy >= 0 ? accuracy : undefined,
    heading_deg: heading != null && heading >= 0 && heading <= 360 ? heading : undefined,
    speed_mps: speed != null && speed >= 0 ? speed : undefined,
    recorded_at: new Date(fix.timestamp).toISOString(),
  };
}

export type LocationOutcome =
  | { ok: true; fix: Fix }
  | { ok: false; reason: 'PERMISSION_DENIED' | 'UNAVAILABLE'; message: string };

/** Ask for foreground permission (if not already granted) and return one fresh fix; `precise`
 *  asks for GPS accuracy instead of the cheaper balanced fix. */
export async function getFreshFix(precise = false): Promise<LocationOutcome> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return {
        ok: false,
        reason: 'PERMISSION_DENIED',
        message: 'Allow location access so dispatch can find you.',
      };
    }
    const fix = await Location.getCurrentPositionAsync({
      // GPS-grade while delivering: the customer watches this point move.
      accuracy: precise ? Location.Accuracy.High : Location.Accuracy.Balanced,
    });
    return { ok: true, fix: toFix(fix) };
  } catch (e) {
    return {
      ok: false,
      reason: 'UNAVAILABLE',
      message: e instanceof Error ? e.message : 'Could not get a location fix.',
    };
  }
}

/** Get a fresh fix and report it on `POST /v1/riders/me/positions`. Used while already online to
 *  keep the server's fix from going stale — going online itself uses `getFreshFix` directly on
 *  the availability PUT, since positions are dropped server-side while offline. */
export async function reportCurrentPosition(assignmentId?: string | null): Promise<LocationOutcome> {
  const outcome = await getFreshFix(!!assignmentId);
  if (!outcome.ok) return outcome;
  try {
    await api.POST('/v1/riders/me/positions', {
      body: { points: [{ ...outcome.fix, assignment_id: assignmentId ?? null }] },
    });
  } catch {
    // A dropped report is replaced by the next tick; the shift must not stop over one.
  }
  return outcome;
}

/**
 * Keeps reporting a fresh fix while `active` is true: every `DELIVERY_REPORT_INTERVAL_MS` while
 * `assignment` is being worked, every `REPORT_INTERVAL_MS` otherwise. Used by the shell (and the
 * availability screen) so an online rider's fix never goes stale, and stopped the moment the
 * rider goes offline — no location is collected while offline (per D-11).
 */
export function useLocationReporting(
  active: boolean,
  assignment?: ActiveAssignmentRef | null,
  /** Optional: told each tick's outcome (the redesign shows a banner when permission is refused). */
  onOutcome?: (outcome: LocationOutcome) => void,
): void {
  const intervalMs = reportIntervalMs(assignment);
  const assignmentId = isActiveAssignment(assignment) ? assignment!.id : null;
  const onOutcomeRef = React.useRef(onOutcome);
  onOutcomeRef.current = onOutcome;
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    const tick = () => {
      // A slow GPS fix must not stack reports up behind it.
      if (cancelled || inFlight) return;
      inFlight = true;
      void reportCurrentPosition(assignmentId)
        .then((outcome) => {
          if (!cancelled) onOutcomeRef.current?.(outcome);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, intervalMs, assignmentId]);
}

export type LiveFix =
  | { status: 'waiting' }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'ok'; fix: Fix };

/**
 * Watches the device's position for the live map while `active`: a new fix roughly every second
 * or every 5 m. Nothing is reported from here — `useLocationReporting` owns the server side — so
 * watching never sends more than the cadence above.
 */
export function useLiveFix(active: boolean): LiveFix {
  const [state, setState] = React.useState<LiveFix>({ status: 'waiting' });
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setState({ status: 'denied' });
          return;
        }
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
          (fix) => {
            if (!cancelled) setState({ status: 'ok', fix: toFix(fix) });
          },
        );
        if (cancelled) s.remove();
        else sub = s;
      } catch {
        if (!cancelled) setState({ status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);
  return state;
}
