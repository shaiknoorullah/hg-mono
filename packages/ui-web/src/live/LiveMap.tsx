/**
 * The live map for the web apps — `mapbox-gl`, fed by realtime rider fixes.
 *
 * One component for the restaurant's "rider approaching" map and the admin's order and
 * operations maps. It draws places (restaurant, delivery address) as fixed pins and riders as
 * markers that glide between fixes instead of jumping. A coarse fix (the restaurant's ~100 m
 * projection, websocket.md "Per-role projection rules") is drawn as a translucent disc of that
 * radius, never a pin: a pin would claim precision the restaurant was deliberately not given.
 *
 * `mapbox-gl` is injected (`loadMapbox`) rather than imported, so this package carries no
 * runtime dependency on it and an app that never shows a map never downloads it.
 *
 * Colours come from `color.map.*` only. Green on a map belongs to the rider pin, the one
 * registered exception to "solid green is reserved for halal status" (AGENTS.md
 * "Non-negotiable invariants"; docs/design/01-foundations.md "Data-visualisation and map
 * colours") — a rider carries no certification claim. Places carry no halal state at all, so
 * a pin here never implies one.
 *
 * States: no token → an empty state naming the missing configuration (no tile request, ever);
 * no coordinates → an empty state; the map engine failing to load → an error with retry; the
 * engine loading → a skeleton. The caller's `children` (ETA text, rider name) render in every
 * state, so the facts survive without the picture.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type MapboxDefault from 'mapbox-gl';
import type { Map as MapboxMap, Marker as MapboxMarker } from 'mapbox-gl';
import { Button } from '../primitives/Button.js';
import { EmptyState } from '../feedback/EmptyState.js';
import { ErrorState } from '../feedback/ErrorState.js';
import { COARSE_RADIUS_M, isStale, lastUpdatedLabel, type RiderFix } from './riderFix.js';

/** What `loadMapbox` resolves to: `import('mapbox-gl')`. */
export type MapboxModule = { default: typeof MapboxDefault };

/** A fixed place on the map. */
export interface LiveMapPlace {
  id: string;
  kind: 'restaurant' | 'customer';
  label: string;
  latitude: number;
  longitude: number;
}

/** A rider whose marker follows its latest fix. A rider with no fix is not drawn. */
export interface LiveMapRider {
  id: string;
  label: string;
  fix: RiderFix | null;
}

/** Props for `LiveMap`. */
export interface LiveMapProps {
  /** The public `pk.` token (`VITE_MAPBOX_TOKEN`). Empty or missing renders the empty state. */
  accessToken: string | undefined;
  /** `() => import('mapbox-gl')`. */
  loadMapbox: () => Promise<MapboxModule>;
  places: readonly LiveMapPlace[];
  riders: readonly LiveMapRider[];
  /** Names the map for assistive technology, e.g. "Map of the rider approaching". */
  ariaLabel: string;
  /** Shown when there is nothing to draw. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** Called with a marker's id when it is clicked. */
  onMarkerClick?: (id: string) => void;
  /** Facts shown over the map in every state (ETA, rider name, connection status). */
  children?: ReactNode;
  /** Map height in CSS units. Default 280px. */
  height?: string;
  className?: string;
  /** Injected for tests. */
  now?: () => number;
}

/** `color.map.*` — the tokens that exist for exactly this. */
const PIN_COLOUR: Record<LiveMapPlace['kind'] | 'rider', string> = {
  restaurant: 'var(--hg-color-map-pin-restaurant)',
  customer: 'var(--hg-color-map-pin-customer)',
  rider: 'var(--hg-color-map-pin-rider)',
};

/** Equatorial circumference over Mapbox GL's 512 px world tile. */
const METRES_PER_PIXEL_AT_Z0 = 40_075_016.686 / 512;

/** Pixels that `metres` span at `latitude` and `zoom`. */
export function metresToPixels(metres: number, latitude: number, zoom: number): number {
  const mpp = (METRES_PER_PIXEL_AT_Z0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
  return metres / mpp;
}

/** The point `t` (0…1) of the way from `a` to `b`, eased. */
export function interpolate(a: [number, number], b: [number, number], t: number): [number, number] {
  const k = Math.min(1, Math.max(0, t));
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease-in-out
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
}

/** How long a marker takes to glide to a new fix: about the 5 s publish interval. */
const GLIDE_MAX_MS = 4_500;
const GLIDE_MIN_MS = 600;

interface RiderMarkerState {
  marker: MapboxMarker;
  el: HTMLDivElement;
  shown: [number, number];
  target: [number, number];
  frame: number | null;
  lastFixAt: number;
  coarse: boolean;
  latitude: number;
  recordedAt: string;
}

function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function placeElement(place: LiveMapPlace, onClick?: (id: string) => void): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '16px';
  el.style.height = '16px';
  el.style.borderRadius = '50%';
  el.style.border = '2px solid white';
  el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.35)';
  el.style.background = PIN_COLOUR[place.kind];
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', place.label);
  el.title = place.label;
  if (onClick) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => onClick(place.id));
  }
  return el;
}

function riderElement(rider: LiveMapRider, onClick?: (id: string) => void): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'img');
  el.dataset['hgRider'] = rider.id;
  if (onClick) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => onClick(rider.id));
  }
  return el;
}

/** Styles a rider marker for its fix: a solid dot, or a translucent disc for a coarse fix. */
function styleRider(el: HTMLDivElement, rider: LiveMapRider, fix: RiderFix, zoom: number, now: number) {
  const stale = isStale(fix, now);
  const label = `${rider.label} — ${lastUpdatedLabel(fix, now).toLowerCase()}`;
  el.setAttribute('aria-label', label);
  el.title = label;
  el.style.opacity = stale ? '0.55' : '1';
  el.dataset['coarse'] = String(fix.coarse);
  el.dataset['stale'] = String(stale);
  if (fix.coarse) {
    const px = Math.max(18, 2 * metresToPixels(Math.max(COARSE_RADIUS_M, fix.accuracyM ?? 0), fix.latitude, zoom));
    el.style.width = `${px}px`;
    el.style.height = `${px}px`;
    el.style.borderRadius = '50%';
    el.style.background = `color-mix(in srgb, ${PIN_COLOUR.rider} 22%, transparent)`;
    el.style.border = `2px solid ${PIN_COLOUR.rider}`;
    el.style.boxShadow = 'none';
    el.style.transform = '';
    return;
  }
  el.style.width = '18px';
  el.style.height = '18px';
  el.style.borderRadius = '50%';
  el.style.background = PIN_COLOUR.rider;
  el.style.border = '3px solid white';
  el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.4)';
}

/** The live map. See the module comment for states and colour rules. */
export function LiveMap({
  accessToken,
  loadMapbox,
  places,
  riders,
  ariaLabel,
  emptyTitle = 'Nothing to show on the map yet',
  emptyDescription = 'The map appears once there is a location to show.',
  onMarkerClick,
  children,
  height = '280px',
  className,
  now = Date.now,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const moduleRef = useRef<typeof MapboxDefault | null>(null);
  const placeMarkers = useRef(new Map<string, MapboxMarker>());
  const riderMarkers = useRef(new Map<string, RiderMarkerState>());
  /** The marker ids the current framing includes; a new one re-frames the map. */
  const framedRef = useRef<string | null>(null);
  /** Set once the user pans or zooms: from then on only "Recenter" re-frames. */
  const userMovedRef = useRef(false);
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [tick, setTick] = useState(0);

  const drawnRiders = useMemo(() => riders.filter((r) => r.fix), [riders]);
  const hasAnything = places.length > 0 || drawnRiders.length > 0;
  const token = accessToken?.trim() ?? '';
  const onClick = useCallback((id: string) => clickRef.current?.(id), []);

  // Ages tick every second so "last updated Ns ago" stays true without a new fix.
  useEffect(() => {
    if (drawnRiders.length === 0) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [drawnRiders.length]);

  // Create the map once there is something to draw; tear it down on unmount or retry.
  useEffect(() => {
    if (!token || !hasAnything || !containerRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    setPhase('loading');
    const placeMap = placeMarkers.current;
    const riderMap = riderMarkers.current;

    loadMapbox()
      .then((mod) => {
        if (cancelled || !containerRef.current) return;
        const gl = mod.default;
        moduleRef.current = gl;
        gl.accessToken = token;
        const first = places[0] ?? { latitude: drawnRiders[0]!.fix!.latitude, longitude: drawnRiders[0]!.fix!.longitude };
        const prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const map = new gl.Map({
          container: containerRef.current,
          style: prefersDark ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/navigation-day-v1',
          center: [first.longitude, first.latitude],
          zoom: 13,
          attributionControl: true,
        });
        mapRef.current = map;
        // Keep the canvas matched to its box when the layout changes (expand, sidebar, window).
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          resizeObserver = new ResizeObserver(() => map.resize());
          resizeObserver.observe(containerRef.current);
        }
        map.on('load', () => {
          if (!cancelled) setPhase('ready');
        });
        map.on('zoom', () => setTick((n) => n + 1));
        // Only gestures carry `originalEvent`; our own fitBounds/easeTo do not.
        const markMoved = (e: object) => {
          if ('originalEvent' in e && e.originalEvent) userMovedRef.current = true;
        };
        map.on('dragstart', markMoved);
        map.on('zoomstart', markMoved);
        map.on('error', () => {
          if (!cancelled && !map.loaded()) setPhase('error');
        });
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      placeMap.forEach((m) => m.remove());
      placeMap.clear();
      riderMap.forEach((s) => {
        if (s.frame !== null) cancelAnimationFrame(s.frame);
        s.marker.remove();
      });
      riderMap.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      framedRef.current = null;
      userMovedRef.current = false;
    };
    // The map is created once per token/attempt; markers are reconciled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, hasAnything, attempt, loadMapbox]);

  // Reconcile places.
  useEffect(() => {
    const map = mapRef.current;
    const gl = moduleRef.current;
    if (phase !== 'ready' || !map || !gl) return;
    const seen = new Set<string>();
    for (const place of places) {
      seen.add(place.id);
      const existing = placeMarkers.current.get(place.id);
      if (existing) {
        existing.setLngLat([place.longitude, place.latitude]);
        continue;
      }
      const marker = new gl.Marker({ element: placeElement(place, onMarkerClick ? onClick : undefined) })
        .setLngLat([place.longitude, place.latitude])
        .addTo(map);
      placeMarkers.current.set(place.id, marker);
    }
    for (const [id, marker] of placeMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        placeMarkers.current.delete(id);
      }
    }
  }, [phase, places, onClick, onMarkerClick]);

  // Reconcile riders: glide existing markers to their new fix, add new ones, drop gone ones.
  useEffect(() => {
    const map = mapRef.current;
    const gl = moduleRef.current;
    if (phase !== 'ready' || !map || !gl) return;
    const zoom = map.getZoom();
    const t = now();
    const seen = new Set<string>();
    for (const rider of drawnRiders) {
      const fix = rider.fix!;
      seen.add(rider.id);
      const target: [number, number] = [fix.longitude, fix.latitude];
      let state = riderMarkers.current.get(rider.id);
      if (!state) {
        const el = riderElement(rider, onMarkerClick ? onClick : undefined);
        const marker = new gl.Marker({ element: el }).setLngLat(target).addTo(map);
        state = {
          marker,
          el,
          shown: target,
          target,
          frame: null,
          lastFixAt: t,
          coarse: fix.coarse,
          latitude: fix.latitude,
          recordedAt: fix.recordedAt,
        };
        riderMarkers.current.set(rider.id, state);
      } else if (state.recordedAt !== fix.recordedAt || state.target[0] !== target[0] || state.target[1] !== target[1]) {
        const s = state;
        const from = s.shown;
        const duration = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, t - s.lastFixAt));
        s.target = target;
        s.lastFixAt = t;
        s.recordedAt = fix.recordedAt;
        if (s.frame !== null) cancelAnimationFrame(s.frame);
        s.frame = null;
        if (prefersReducedMotion()) {
          s.shown = target;
          s.marker.setLngLat(target);
        } else {
          const start = performance.now();
          const step = (ts: number) => {
            const p = (ts - start) / duration;
            s.shown = interpolate(from, target, p);
            s.marker.setLngLat(s.shown);
            s.frame = p < 1 ? requestAnimationFrame(step) : null;
          };
          s.frame = requestAnimationFrame(step);
        }
      }
      styleRider(state.el, rider, fix, zoom, t);
    }
    for (const [id, s] of riderMarkers.current) {
      if (!seen.has(id)) {
        if (s.frame !== null) cancelAnimationFrame(s.frame);
        s.marker.remove();
        riderMarkers.current.delete(id);
      }
    }
  }, [phase, drawnRiders, tick, now, onClick, onMarkerClick]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    const gl = moduleRef.current;
    if (!map || !gl) return;
    const points: [number, number][] = [
      ...places.map((p) => [p.longitude, p.latitude] as [number, number]),
      ...drawnRiders.map((r) => [r.fix!.longitude, r.fix!.latitude] as [number, number]),
    ];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.easeTo({ center: points[0], zoom: 14 });
      return;
    }
    const bounds = new gl.LngLatBounds(points[0], points[0]);
    for (const p of points) bounds.extend(p);
    map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 0 });
  }, [places, drawnRiders]);

  // Frame everything when the map first has its markers, and again whenever a new marker
  // appears (a rider's first fix arrives after the map opened) — unless the user has taken
  // over the view. Moving markers never re-frame: that would fight the user every 5 s.
  const markerKey = [...places.map((p) => p.id), ...drawnRiders.map((r) => r.id)].sort().join('|');
  useEffect(() => {
    if (phase !== 'ready') return;
    const previous = framedRef.current;
    const grew = previous === null || markerKey.split('|').some((id) => !previous.split('|').includes(id));
    framedRef.current = markerKey;
    if (grew && (previous === null || !userMovedRef.current)) fitAll();
  }, [phase, markerKey, fitAll]);

  const recenter = useCallback(() => {
    userMovedRef.current = false;
    fitAll();
  }, [fitAll]);

  const stale = drawnRiders.filter((r) => isStale(r.fix!, now()));
  const staleLine =
    stale.length === 0
      ? null
      : drawnRiders.length === 1
        ? lastUpdatedLabel(stale[0]!.fix!, now())
        : `${stale.length} of ${drawnRiders.length} riders not updated in the last 30s`;

  const frameStyle = { position: 'relative' as const, height, minHeight: '200px', overflow: 'hidden' };
  const frameClass = ['rounded-md border border-line-decorative bg-surface-sunken', className].filter(Boolean).join(' ');
  const overlay = children || staleLine ? (
    <div
      className="pointer-events-none absolute start-3 top-3 max-w-[85%] rounded-sm bg-surface-raised/95 px-3 py-2 text-label-md text-fg-primary shadow-sm"
      style={{ zIndex: 2 }}
    >
      {children}
      {staleLine ? (
        <p className="m-0 text-body-sm text-fg-secondary" data-testid="live-map-stale">
          {staleLine}
        </p>
      ) : null}
    </div>
  ) : null;

  if (!token) {
    return (
      <div className={frameClass} style={{ ...frameStyle, height: 'auto' }} data-live-map="no-token">
        <EmptyState
          variant="inline"
          title="Live map not configured"
          description="Set VITE_MAPBOX_TOKEN to show the live map. Without it no map is requested."
        />
        {children ? <div className="px-4 pb-4 text-label-md text-fg-primary">{children}</div> : null}
      </div>
    );
  }

  if (!hasAnything) {
    return (
      <div className={frameClass} style={{ ...frameStyle, height: 'auto' }} data-live-map="empty">
        <EmptyState variant="inline" title={emptyTitle} description={emptyDescription} />
        {children ? <div className="px-4 pb-4 text-label-md text-fg-primary">{children}</div> : null}
      </div>
    );
  }

  return (
    <div className={frameClass} style={frameStyle} data-live-map={phase} role="region" aria-label={ariaLabel}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} aria-hidden="true" />
      {phase === 'loading' ? (
        <div className="absolute inset-0 animate-pulse bg-surface-sunken" style={{ zIndex: 1 }} aria-busy="true" aria-label="Loading the map" />
      ) : null}
      {phase === 'error' ? (
        <div className="absolute inset-0 overflow-auto bg-surface-raised" style={{ zIndex: 3 }}>
          <ErrorState
            variant="inline"
            title="The map could not load"
            description="Check the connection. The order details still update without the map."
            onRetry={() => setAttempt((n) => n + 1)}
            focusOnMount={false}
          />
        </div>
      ) : null}
      {overlay}
      {phase === 'ready' ? (
        <div className="absolute bottom-3 end-3" style={{ zIndex: 2 }}>
          <Button variant="secondary" size="sm" onPress={recenter}>
            Recenter
          </Button>
        </div>
      ) : null}
    </div>
  );
}
