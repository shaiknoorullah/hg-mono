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
 * fix (for the PUT), one to report it on the positions endpoint, and one hook that keeps
 * reporting on an interval for as long as a screen wants a live shift.
 *
 * Works unchanged on web: `expo-location` shims to the browser Geolocation API there, so the
 * same call path drives both the Expo web target and native builds.
 */
import * as React from 'react';
import * as Location from 'expo-location';

import { api } from './api';

const REPORT_INTERVAL_MS = 20_000;

export interface Fix {
  latitude: number;
  longitude: number;
  accuracy_m?: number;
  recorded_at: string;
}

export type LocationOutcome =
  | { ok: true; fix: Fix }
  | { ok: false; reason: 'PERMISSION_DENIED' | 'UNAVAILABLE'; message: string };

/** Ask for foreground permission (if not already granted) and return one fresh fix. */
export async function getFreshFix(): Promise<LocationOutcome> {
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
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      ok: true,
      fix: {
        latitude: fix.coords.latitude,
        longitude: fix.coords.longitude,
        accuracy_m: fix.coords.accuracy ?? undefined,
        recorded_at: new Date(fix.timestamp).toISOString(),
      },
    };
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
export async function reportCurrentPosition(): Promise<LocationOutcome> {
  const outcome = await getFreshFix();
  if (!outcome.ok) return outcome;
  await api.POST('/v1/riders/me/positions', {
    body: { points: [outcome.fix] },
  });
  return outcome;
}

/**
 * Keeps reporting a fresh fix every `REPORT_INTERVAL_MS` while `active` is true. Used by the
 * availability screen so an online rider's fix never goes stale, and stopped the moment the
 * rider goes offline or leaves the screen — no location is collected while offline (per D-11).
 */
export function useLocationReporting(active: boolean): void {
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      void reportCurrentPosition();
    };
    tick();
    const id = setInterval(tick, REPORT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);
}
