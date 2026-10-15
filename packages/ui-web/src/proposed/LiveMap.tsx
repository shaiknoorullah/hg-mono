/**
 * `LiveMap` (proposed; `admin/orders/LiveMapPane` and its `LiveMap*` boards, admin WP-7): the
 * legacy `live/LiveMap` ported onto the design system's tokens and parts, with its props kept.
 *
 * - **Pins** are the board's label chips (`lib/ui/map-pin`), portalled into Mapbox markers:
 *   restaurant and destination tiles, a round rider tile. A stale rider keeps full opacity with a
 *   dashed outline and a "Stale" badge; a coarse fix (the restaurant's ~100 m projection) is a
 *   translucent disc of that radius, never a pin that claims precision.
 *   TODO(packet T5a-T5c): dark map-pin tokens do not exist yet; the light `map-pin-*` roles are
 *   used in both themes.
 * - **Riders glide** between fixes (about the 5 s publish interval), or jump under reduced
 *   motion. The view frames every marker once, and again when a new one appears, until the
 *   person pans or zooms; then only "Recenter" re-frames.
 * - **Text equivalent:** the same places and riders as a list, in words ("Last position 6:52:40
 *   pm, 8 seconds ago"). It *is* the map when there is no token or the engine fails (today's
 *   graceful degrade: the facts survive without the picture), and `showEntityList` shows it
 *   under a working map too. The map region is described by it.
 * - **Controls:** Zoom in, Zoom out and Recenter (44px tonal icon buttons) sit above the
 *   bottom strip, so Mapbox's attribution is never covered.
 * - `mapbox-gl` is injected (`loadMapbox`), never imported: see `map-engine.ts`.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Marker as MapboxMarker } from 'mapbox-gl';

import { Badge } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { IconButton } from '../ds/IconButton.js';
import { formatTime12h } from '../ds/time.js';
import { MapPinMarker } from '../lib/ui/map-pin.js';
import { cn } from '../lib/utils.js';
import { COARSE_RADIUS_M, fixAgeSeconds, isStale, type RiderFix } from '../live/riderFix.js';
import { EmptyState } from './EmptyState.js';
import { interpolate, metresToPixels, reducedMotion, useMapboxMap, type MapboxModule } from './map-engine.js';
import { StatePanel } from './state-panel.js';

/** A fixed place on the map. */
export interface LiveMapPlace {
  id: string;
  kind: 'restaurant' | 'customer';
  label: string;
  latitude: number;
  longitude: number;
  /** Extra words for the text equivalent ("the address is hidden until revealed"). */
  description?: string;
}

/** A rider whose marker follows its latest fix. A rider with no fix is listed, not drawn. */
export interface LiveMapRider {
  id: string;
  label: string;
  fix: RiderFix | null;
  /** Extra words for the text equivalent ("bicycle"). */
  description?: string;
}

/** Props of `LiveMap`: the legacy props, plus the list, labels and the common props. */
export interface LiveMapProps {
  /** The public `pk.` token. Empty or missing: the text equivalent, and no tile request. */
  accessToken: string | undefined;
  /** `() => import('mapbox-gl')` (and its CSS). */
  loadMapbox: () => Promise<MapboxModule>;
  places: readonly LiveMapPlace[];
  riders: readonly LiveMapRider[];
  /** Names the map, e.g. "Map of order HG-6RN4KP". */
  ariaLabel: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Called with a marker's id when it is clicked. */
  onMarkerClick?: (id: string) => void;
  /** Facts shown over the map in every state (ETA, connection). */
  children?: ReactNode;
  /** Map height in CSS units. Default 280px. */
  height?: string;
  /** Show the text equivalent under a working map too. It always shows when there is no map. */
  showEntityList?: boolean;
  /** Heading of the text equivalent. */
  entityListTitle?: string;
  recenterLabel?: string;
  className?: string;
  /** Injected for tests. */
  now?: () => number;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const GLIDE_MS = { min: 600, max: 4_500 };

interface RiderTrack {
  shown: [number, number];
  frame: number | null;
  lastFixAt: number;
  recordedAt: string;
}

/** "8 seconds ago", "4 minutes ago". */
function ageWords(seconds: number): string {
  if (seconds < 90) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'} ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minutes ago`;
}

/** The rider's line in the text equivalent. */
export function riderSentence(rider: LiveMapRider, now: number): string {
  const who = rider.description ? `${rider.label}, ${rider.description}.` : `${rider.label}.`;
  const fix = rider.fix;
  if (!fix) return `${who} No position has arrived yet.`;
  const at = formatTime12h(fix.recordedAt, { seconds: true });
  const where = `Last position ${at ? `${at}, ` : ''}${ageWords(fixAgeSeconds(fix, now))}.`;
  const coarse = fix.coarse ? ` Approximate, within about ${COARSE_RADIUS_M} m.` : '';
  const stale = isStale(fix, now) ? ' This may not be where the rider is now.' : '';
  return `${who} ${where}${coarse}${stale}`;
}

const KIND_WORD: Record<LiveMapPlace['kind'], string> = { restaurant: 'Restaurant', customer: 'Destination' };

/** The places and riders in words. */
function EntityList({
  id,
  title,
  places,
  riders,
  now,
}: {
  id: string;
  title: string;
  places: readonly LiveMapPlace[];
  riders: readonly LiveMapRider[];
  now: number;
}) {
  return (
    <div className="flex flex-col gap-2 p-4" data-slot="live-map-text">
      <h3 className="m-0 text-heading-sm font-semibold text-fg-primary">{title}</h3>
      <ul id={id} className="m-0 flex list-none flex-col gap-2 p-0 text-body-md text-fg-primary">
        {places.map((place) => (
          <li key={place.id}>
            <strong>{KIND_WORD[place.kind]}.</strong> {place.label}.{place.description ? ` ${place.description}` : ''}
          </li>
        ))}
        {riders.map((rider) => (
          <li key={rider.id} className="flex flex-wrap items-center gap-x-2">
            <span>
              <strong>Rider.</strong> {riderSentence(rider, now)}
            </span>
            {rider.fix && isStale(rider.fix, now) ? (
              <Badge variant="warning" icon="clock" size="sm">
                Stale
              </Badge>
            ) : null}
          </li>
        ))}
        {places.length === 0 && riders.length === 0 ? <li>Nothing to show yet.</li> : null}
      </ul>
    </div>
  );
}

/** The live map. See the module comment. */
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
  showEntityList = false,
  entityListTitle = 'Text equivalent',
  recenterLabel = 'Recenter the map',
  className,
  now = Date.now,
  testId = 'LiveMap',
  style,
}: LiveMapProps) {
  const listId = useId();
  const drawn = useMemo(() => riders.filter((r) => r.fix), [riders]);
  const hasAnything = places.length > 0 || drawn.length > 0;
  const firstPoint = places[0] ?? (drawn[0]?.fix ? { latitude: drawn[0].fix.latitude, longitude: drawn[0].fix.longitude } : null);
  const engine = useMapboxMap({ accessToken, loadMapbox, enabled: hasAnything, center: firstPoint, zoom: 13 });
  const ready = engine.phase === 'ready';

  const [, setTick] = useState(0);
  const [zoom, setZoom] = useState(13);
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(new Map());
  const markers = useRef(new Map<string, MapboxMarker>());
  const tracks = useRef(new Map<string, RiderTrack>());
  const userMoved = useRef(false);
  const framed = useRef<string | null>(null);
  const clickRef = useRef(onMarkerClick);
  clickRef.current = onMarkerClick;

  /* Ages tick every second, so "8 seconds ago" stays true between fixes. */
  useEffect(() => {
    if (drawn.length === 0) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [drawn.length]);

  /* Map events: zoom (coarse discs scale with it) and the person taking over the view. */
  useEffect(() => {
    const map = engine.map.current;
    if (!ready || !map) return;
    const onZoom = () => setZoom(map.getZoom());
    // Only gestures carry `originalEvent`; our own fitBounds and easeTo do not.
    const onGesture = (event: object) => {
      if ('originalEvent' in event && event.originalEvent) userMoved.current = true;
    };
    map.on('zoom', onZoom);
    map.on('dragstart', onGesture);
    map.on('zoomstart', onGesture);
    onZoom();
    return () => {
      map.off('zoom', onZoom);
      map.off('dragstart', onGesture);
      map.off('zoomstart', onGesture);
    };
  }, [ready, engine.map]);

  /* Reconcile markers: one Mapbox marker per place and drawn rider, hosting a React pin. */
  const entityKey = [...places.map((p) => p.id), ...drawn.map((r) => r.id)].join('|');
  useEffect(() => {
    const map = engine.map.current;
    const gl = engine.gl.current;
    if (!ready || !map || !gl) return;
    const wanted = new Map<string, [number, number]>();
    for (const p of places) wanted.set(p.id, [p.longitude, p.latitude]);
    for (const r of drawn) wanted.set(r.id, [r.fix!.longitude, r.fix!.latitude]);
    let changed = false;
    for (const [id, lngLat] of wanted) {
      if (markers.current.has(id)) continue;
      const element = document.createElement('div');
      element.addEventListener('click', () => clickRef.current?.(id));
      if (clickRef.current) element.style.cursor = 'pointer';
      markers.current.set(id, new gl.Marker({ element }).setLngLat(lngLat).addTo(map));
      changed = true;
    }
    for (const [id, marker] of markers.current) {
      if (wanted.has(id)) continue;
      marker.remove();
      markers.current.delete(id);
      const track = tracks.current.get(id);
      if (track?.frame != null) cancelAnimationFrame(track.frame);
      tracks.current.delete(id);
      changed = true;
    }
    if (changed) setHosts(new Map([...markers.current].map(([id, m]) => [id, m.getElement() as HTMLDivElement])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, entityKey]);

  /* Places sit still; riders glide to each new fix. */
  useEffect(() => {
    if (!ready) return;
    for (const p of places) markers.current.get(p.id)?.setLngLat([p.longitude, p.latitude]);
    const t = now();
    for (const rider of drawn) {
      const marker = markers.current.get(rider.id);
      const fix = rider.fix!;
      if (!marker) continue;
      const target: [number, number] = [fix.longitude, fix.latitude];
      const track = tracks.current.get(rider.id);
      if (!track) {
        tracks.current.set(rider.id, { shown: target, frame: null, lastFixAt: t, recordedAt: fix.recordedAt });
        marker.setLngLat(target);
        continue;
      }
      if (track.recordedAt === fix.recordedAt) continue;
      if (track.frame !== null) cancelAnimationFrame(track.frame);
      track.frame = null;
      const from = track.shown;
      const duration = Math.min(GLIDE_MS.max, Math.max(GLIDE_MS.min, t - track.lastFixAt));
      track.lastFixAt = t;
      track.recordedAt = fix.recordedAt;
      if (reducedMotion()) {
        track.shown = target;
        marker.setLngLat(target);
        continue;
      }
      const started = performance.now();
      const step = (stamp: number) => {
        const progress = (stamp - started) / duration;
        track.shown = interpolate(from, target, progress);
        marker.setLngLat(track.shown);
        track.frame = progress < 1 ? requestAnimationFrame(step) : null;
      };
      track.frame = requestAnimationFrame(step);
    }
  }, [ready, places, drawn, now, hosts]);

  /* Tear-down of everything this component added to the map. */
  useEffect(() => {
    const markerMap = markers.current;
    const trackMap = tracks.current;
    return () => {
      for (const track of trackMap.values()) if (track.frame !== null) cancelAnimationFrame(track.frame);
      for (const marker of markerMap.values()) marker.remove();
      markerMap.clear();
      trackMap.clear();
    };
  }, [engine.phase]);

  const frameAll = useCallback(() => {
    const map = engine.map.current;
    const gl = engine.gl.current;
    if (!map || !gl) return;
    const points: [number, number][] = [
      ...places.map((p): [number, number] => [p.longitude, p.latitude]),
      ...drawn.map((r): [number, number] => [r.fix!.longitude, r.fix!.latitude]),
    ];
    const [first, ...rest] = points;
    if (!first) return;
    if (rest.length === 0) {
      map.easeTo({ center: first, zoom: 14 });
      return;
    }
    const bounds = rest.reduce((b, p) => b.extend(p), new gl.LngLatBounds(first, first));
    map.fitBounds(bounds, { padding: 56, maxZoom: 15, duration: 0 });
  }, [engine.map, engine.gl, places, drawn]);

  /* Frame on first draw and when a marker appears, unless the person has taken over. */
  useEffect(() => {
    if (!ready) return;
    const before = framed.current;
    const grew = before === null || entityKey.split('|').some((id) => !before.split('|').includes(id));
    framed.current = entityKey;
    if (grew && (before === null || !userMoved.current)) frameAll();
  }, [ready, entityKey, frameAll]);

  const recenter = () => {
    userMoved.current = false;
    frameAll();
  };

  const t = now();
  const list = <EntityList id={listId} title={entityListTitle} places={places} riders={riders} now={t} />;
  const overlay = children ? (
    <div className="pointer-events-none absolute start-3 top-3 z-[2] max-w-[85%] rounded-sm bg-surface-raised px-3 py-2 text-label-md text-fg-primary shadow-e1">
      {children}
    </div>
  ) : null;
  const frameClass = cn('relative overflow-hidden rounded-lg border border-line-decorative bg-surface-sunken', className);

  if (engine.phase === 'off' || !hasAnything) {
    return (
      <div data-testid={testId} data-live-map={!hasAnything ? 'empty' : 'no-token'} style={style} className={frameClass}>
        {!hasAnything ? (
          <EmptyState variant="inline" icon="map" title={emptyTitle} description={emptyDescription} headingLevel={3} />
        ) : (
          <p className="m-0 border-b border-line-decorative bg-surface-raised px-4 py-3 text-body-sm text-fg-secondary">
            The live map isn’t set up here (no map token), so the positions are listed in words.
          </p>
        )}
        {children ? <div className="px-4 pt-3 text-label-md text-fg-primary">{children}</div> : null}
        {hasAnything ? list : null}
      </div>
    );
  }

  return (
    <div data-testid={testId} data-live-map={engine.phase} style={style} className="flex min-w-0 flex-col gap-2">
      <div className={frameClass} style={{ height, minHeight: '200px' }}>
        <div
          ref={engine.containerRef}
          role="region"
          aria-label={ariaLabel}
          aria-describedby={listId}
          className="absolute inset-0"
        />
        {[...hosts].map(([id, host]) => {
          const place = places.find((p) => p.id === id);
          if (place) return createPortal(<MapPinMarker kind={place.kind} label={place.label} />, host, id);
          const rider = drawn.find((r) => r.id === id);
          if (!rider?.fix) return null;
          const fix = rider.fix;
          if (fix.coarse) {
            const px = Math.max(18, 2 * metresToPixels(Math.max(COARSE_RADIUS_M, fix.accuracyM ?? 0), fix.latitude, zoom));
            return createPortal(
              <span
                aria-hidden="true"
                title={rider.label}
                className="block rounded-full border-2 border-map-pin-rider bg-map-pin-rider/20"
                style={{ width: px, height: px }}
              />,
              host,
              id,
            );
          }
          const stale = isStale(fix, t);
          return createPortal(
            <MapPinMarker
              kind="rider"
              label={rider.label}
              stale={stale}
              trailing={
                stale ? (
                  <Badge variant="warning" icon="clock" size="sm">
                    Stale
                  </Badge>
                ) : null
              }
            />,
            host,
            id,
          );
        })}
        {engine.phase === 'loading' ? (
          <div role="status" className="absolute inset-0 z-[1] flex animate-pulse items-center justify-center bg-skeleton-base text-body-md text-fg-primary motion-reduce:animate-none">
            Loading the map…
          </div>
        ) : null}
        {engine.phase === 'error' ? (
          <div className="absolute inset-0 z-[3] overflow-auto bg-surface-raised">
            <StatePanel
              role="alert"
              icon="warning"
              tone="warning"
              title="The map didn’t load"
              body="Nothing was changed. The places and riders are listed in words below the map."
              action={
                <Button variant="primary" iconStart="refresh" onPress={engine.retry}>
                  Try again
                </Button>
              }
            />
          </div>
        ) : null}
        {overlay}
        {ready ? (
          <div role="group" aria-label="Map controls" className="absolute end-3 bottom-10 z-[2] flex flex-col gap-1 rounded-md bg-surface-raised p-1 shadow-e2">
            <IconButton icon="plus" accessibilityLabel="Zoom in" variant="tonal" size="md" onPress={() => engine.map.current?.zoomIn()} />
            <IconButton icon="minus" accessibilityLabel="Zoom out" variant="tonal" size="md" onPress={() => engine.map.current?.zoomOut()} />
            <IconButton icon="map" accessibilityLabel={recenterLabel} variant="tonal" size="md" onPress={recenter} />
          </div>
        ) : null}
      </div>
      {showEntityList || engine.phase === 'error' ? (
        <div className="rounded-lg border border-line-decorative bg-surface-raised">{list}</div>
      ) : (
        <div className="sr-only">{list}</div>
      )}
    </div>
  );
}
