/**
 * The route line for the rider's map, from the Mapbox Directions API with the public token.
 *
 * Re-fetched when the stops change, and otherwise at most every 30 s, and only once the rider has
 * moved more than 200 m from where the last route started (docs/spec/04-rider.md, "Navigation").
 * A rider standing still costs no requests. When there is no token, or Mapbox fails, `route` is
 * null and the caller shows the straight-line estimate labelled as such.
 */
import * as React from 'react';

import { directionsUrl, haversineM, parseDirections, type LatLng, type Route } from './geo';

/** Written as plain `process.env.EXPO_PUBLIC_…` so Expo inlines the build's value (see api.ts). */
export const MAPBOX_PUBLIC_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

const REFRESH_MS = 30_000;
const DEVIATION_M = 200;

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export async function fetchRoute(points: readonly LatLng[], token: string): Promise<Route | null> {
  if (!token || points.length < 2) return null;
  try {
    const res = await fetch(directionsUrl(points, token));
    if (!res.ok) return null;
    return parseDirections(await res.json());
  } catch {
    return null;
  }
}

/**
 * `origin` is the rider's live position (may be null before the first fix); `stops` are the
 * fixed points after it (the pickup, then the drop-off).
 */
export function useRoute(
  origin: LatLng | null,
  stops: readonly LatLng[],
  token: string = MAPBOX_PUBLIC_TOKEN,
): { route: Route | null; status: RouteStatus } {
  const [route, setRoute] = React.useState<Route | null>(null);
  const [status, setStatus] = React.useState<RouteStatus>('idle');
  const last = React.useRef<{ at: number; from: LatLng | null; key: string } | null>(null);
  // Each request gets a number; only the newest one may set state, and none after unmount. Not
  // aborted on a new fix, because fixes arrive every second and would cancel every request.
  const seq = React.useRef(0);
  React.useEffect(
    () => () => {
      seq.current = -1;
    },
    [],
  );

  const stopsKey = stops.map((s) => `${s.latitude},${s.longitude}`).join(';');

  React.useEffect(() => {
    if (!token) {
      setStatus('unavailable');
      return;
    }
    const prev = last.current;
    const now = Date.now();
    const stopsChanged = !prev || prev.key !== stopsKey;
    const gainedOrigin = !!prev && !prev.from && !!origin;
    const moved =
      !!prev?.from &&
      !!origin &&
      haversineM(prev.from, origin) > DEVIATION_M &&
      now - prev.at >= REFRESH_MS;
    if (!stopsChanged && !gainedOrigin && !moved) return;

    last.current = { at: now, from: origin, key: stopsKey };
    const points = origin ? [origin, ...stops] : [...stops];
    if (points.length < 2) return;
    const mine = ++seq.current;
    if (stopsChanged) {
      // A line to the previous stop would point the rider the wrong way while the new one loads.
      setRoute(null);
      setStatus('loading');
    }
    void fetchRoute(points, token).then((r) => {
      if (seq.current !== mine) return;
      if (r) {
        setRoute(r);
        setStatus('ready');
      } else {
        setStatus('unavailable');
      }
    });
    // `stops` is read through `stopsKey`; `origin` matters only through the checks above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, stopsKey, origin?.latitude, origin?.longitude]);

  return { route, status };
}
