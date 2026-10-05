/**
 * Pure geometry and text for the rider's live map: distances, the Mapbox Directions request and
 * its parse, the camera box, and the words the map's text fallback reads out. No React, no
 * network — `route.ts` does the fetching — so all of it is unit-tested directly.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Leg {
  distance_m: number;
  duration_s: number;
}

/** A route as the map draws it: the line, its road distance and driving time, and one leg per
 *  pair of consecutive stops. */
export interface Route extends Leg {
  coordinates: LatLng[];
  legs: Leg[];
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * When the road route is unavailable, the distance is the straight line × 1.35 and the time
 * assumes 25 km/h through town (docs/spec/04-rider.md, "Navigation": the route-unavailable
 * fallback). Shown as an estimate, never as a route.
 */
export const DETOUR_FACTOR = 1.35;
const FALLBACK_SPEED_MPS = 25_000 / 3600;

export function estimateRoute(points: readonly LatLng[]): Omit<Route, 'coordinates'> {
  const legs: Leg[] = [];
  for (let i = 1; i < points.length; i++) {
    const distance_m = haversineM(points[i - 1]!, points[i]!) * DETOUR_FACTOR;
    legs.push({ distance_m, duration_s: distance_m / FALLBACK_SPEED_MPS });
  }
  return {
    legs,
    distance_m: legs.reduce((t, l) => t + l.distance_m, 0),
    duration_s: legs.reduce((t, l) => t + l.duration_s, 0),
  };
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** "Last updated 42s ago" once a fix is older than 30 s; null while it is fresh. */
export const STALE_AFTER_MS = 30_000;

export function staleLabel(recordedAt: string | null | undefined, now: number): string | null {
  if (!recordedAt) return null;
  const age = now - Date.parse(recordedAt);
  if (!(age > STALE_AFTER_MS)) return null;
  const s = Math.round(age / 1000);
  return s < 120 ? `Last updated ${s}s ago` : `Last updated ${Math.round(s / 60)} min ago`;
}

export type DirectionsProfile = 'driving' | 'cycling' | 'walking';

/** The Mapbox Directions request. The token is the public `pk.` tile token, as Mapbox requires. */
export function directionsUrl(
  points: readonly LatLng[],
  token: string,
  profile: DirectionsProfile = 'driving',
): string {
  const coords = points
    .map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`)
    .join(';');
  return (
    `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}` +
    `?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`
  );
}

/** First route of a Directions response, or null when there is none or the body is malformed. */
export function parseDirections(body: unknown): Route | null {
  const route = (body as { routes?: unknown[] } | null)?.routes?.[0] as
    | {
        geometry?: { coordinates?: unknown };
        distance?: unknown;
        duration?: unknown;
        legs?: { distance?: unknown; duration?: unknown }[];
      }
    | undefined;
  const coords = route?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (typeof route?.distance !== 'number' || typeof route.duration !== 'number') return null;
  const coordinates: LatLng[] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
    coordinates.push({ longitude: c[0], latitude: c[1] });
  }
  const legs: Leg[] = [];
  for (const l of Array.isArray(route.legs) ? route.legs : []) {
    if (typeof l?.distance !== 'number' || typeof l.duration !== 'number') return null;
    legs.push({ distance_m: l.distance, duration_s: l.duration });
  }
  const total = { distance_m: route.distance, duration_s: route.duration };
  return { coordinates, ...total, legs: legs.length ? legs : [total] };
}

/** The smallest box holding every point, as Mapbox's camera wants it: `[lng, lat]` corners. */
export function boundsOf(
  points: readonly LatLng[],
): { ne: [number, number]; sw: [number, number] } | null {
  if (points.length === 0) return null;
  let n = -90;
  let s = 90;
  let e = -180;
  let w = 180;
  for (const p of points) {
    n = Math.max(n, p.latitude);
    s = Math.min(s, p.latitude);
    e = Math.max(e, p.longitude);
    w = Math.min(w, p.longitude);
  }
  // A single point (or two on top of each other) still needs a box to zoom to: ~300 m around it.
  const pad = 0.0015;
  if (n - s < pad) {
    n += pad;
    s -= pad;
  }
  if (e - w < pad) {
    e += pad;
    w -= pad;
  }
  return { ne: [e, n], sw: [w, s] };
}

/** Linear step between two fixes, for the marker's glide; `t` in 0..1. */
export function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * k,
    longitude: a.longitude + (b.longitude - a.longitude) * k,
  };
}
