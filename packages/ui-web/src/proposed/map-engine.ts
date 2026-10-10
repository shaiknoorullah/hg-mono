/**
 * What the two proposed maps share (`LiveMap`, `MapPinPicker`): the Mapbox GL lifecycle and a
 * little geometry.
 *
 * `mapbox-gl` is never imported here. The caller injects `loadMapbox` (`() =>
 * import('mapbox-gl')`, plus its stylesheet), so importing `@hg/ui-web/proposed` downloads no
 * map engine, server rendering and tests never touch WebGL, and an app without a map never
 * pays for one. Without a token, nothing is requested at all.
 *
 * Attribution: the map is created with Mapbox's attribution control on, bottom-right, and
 * neither component draws anything over the bottom 40px strip it lives in.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type MapboxDefault from 'mapbox-gl';
import type { Map as MapboxMap } from 'mapbox-gl';

import type { MapboxModule } from '../live/LiveMap.js';

export type { MapboxModule };
export { interpolate, metresToPixels } from '../live/LiveMap.js';

/** A point on the map, in degrees. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Where a map is in its life. `off` is "no token": nothing was or will be requested. */
export type MapPhase = 'off' | 'loading' | 'ready' | 'error';

/** Metres in one degree of latitude (and of longitude at the equator). */
const METRES_PER_DEGREE = 111_320;

/** `point` moved `north` and `east` metres. Six decimals: about 0.1 m. */
export function offsetMetres(point: LatLng, north: number, east: number): LatLng {
  const lat = point.latitude + north / METRES_PER_DEGREE;
  const cos = Math.cos((point.latitude * Math.PI) / 180) || 1e-9;
  const lng = point.longitude + east / (METRES_PER_DEGREE * cos);
  return { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
}

/** Straight-line metres between two points (equirectangular; exact enough under a kilometre). */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const meanLat = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dy = (b.latitude - a.latitude) * METRES_PER_DEGREE;
  const dx = (b.longitude - a.longitude) * METRES_PER_DEGREE * Math.cos(meanLat);
  return Math.hypot(dx, dy);
}

/** "43.7309, -79.2641": four decimals, about 10 m, as the boards print a pin. */
export function formatLatLng(point: LatLng): string {
  return `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`;
}

/** Options of `useMapboxMap`. */
export interface UseMapboxMapOptions {
  /** The public `pk.` token; empty means `off`. */
  accessToken: string | undefined;
  loadMapbox: () => Promise<MapboxModule>;
  /** False while there is nothing to draw: the map is not created. */
  enabled: boolean;
  /** Where the map opens; read once per creation. */
  center: LatLng | null;
  zoom?: number;
}

/** What `useMapboxMap` returns. */
export interface MapboxMapHandle {
  phase: MapPhase;
  containerRef: RefObject<HTMLDivElement | null>;
  map: RefObject<MapboxMap | null>;
  gl: RefObject<typeof MapboxDefault | null>;
  /** Tears the map down and tries again (the error state's "Try again"). */
  retry: () => void;
}

/** Creates one Mapbox GL map in `containerRef` and keeps it sized; removes it on unmount. */
export function useMapboxMap({ accessToken, loadMapbox, enabled, center, zoom = 14 }: UseMapboxMapOptions): MapboxMapHandle {
  const token = accessToken?.trim() ?? '';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  const gl = useRef<typeof MapboxDefault | null>(null);
  const centerRef = useRef(center);
  centerRef.current = center;
  const [phase, setPhase] = useState<MapPhase>(token ? 'loading' : 'off');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      setPhase('off');
      return;
    }
    if (!enabled || !containerRef.current) return;
    let live = true;
    let observer: ResizeObserver | null = null;
    setPhase('loading');
    loadMapbox()
      .then(({ default: engine }) => {
        const host = containerRef.current;
        if (!live || !host) return;
        gl.current = engine;
        engine.accessToken = token;
        const start = centerRef.current;
        const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
        const created = new engine.Map({
          container: host,
          style: dark ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/navigation-day-v1',
          center: start ? [start.longitude, start.latitude] : undefined,
          zoom,
          attributionControl: true,
        });
        map.current = created;
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => created.resize());
          observer.observe(host);
        }
        created.on('load', () => live && setPhase('ready'));
        created.on('error', () => {
          if (live && !created.loaded()) setPhase('error');
        });
      })
      .catch(() => live && setPhase('error'));
    return () => {
      live = false;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // `zoom` and `center` are read at creation only; moving them must not rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled, attempt, loadMapbox]);

  return { phase, containerRef, map, gl, retry: () => setAttempt((n) => n + 1) };
}

/** True when the viewer asked for less motion. */
export function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
