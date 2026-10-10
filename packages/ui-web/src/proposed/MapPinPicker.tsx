/**
 * `MapPinPicker` (proposed, #193 / #150): "Address and pin for riders" on the restaurant's
 * business profile and address settings (`restaurant/onboarding/ProfilePanes` pin-placed and
 * pin-moved modes, `restaurant/settings/Edit-AddressPin`). Riders come to the pin, so the pin's
 * final position is what is saved, not the geocoded point (C-31 rule 7).
 *
 * - **Draggable** over Mapbox GL (injected `loadMapbox`; no token means no map request).
 * - **Keyboard:** the pin is a 44px button; the arrow keys move it 1 m (Shift: 10 m). Each
 *   move calls `onChange`. `reverseGeocode(point)` runs when a drag ends and when keyboard
 *   moves pause, never on every step, and its result is the caller's to show.
 * - **Without a map** (no token, engine failed): the same pin and the same keys on a plain
 *   panel, with the coordinates in words. Address entry never becomes impossible.
 * - Mapbox attribution stays visible: nothing is drawn over the map's bottom strip.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Marker as MapboxMarker } from 'mapbox-gl';

import { Button } from '../ds/Button.js';
import { MapPinHandle } from '../lib/ui/map-pin.js';
import { cn } from '../lib/utils.js';
import { distanceMetres, formatLatLng, offsetMetres, useMapboxMap, type LatLng, type MapboxModule } from './map-engine.js';

/** How the pin last moved. */
export type MapPinMoveSource = 'drag' | 'keyboard';

/** Props of `MapPinPicker`. */
export interface MapPinPickerProps {
  /** The public `pk.` token. Empty or missing: the text fallback, and no tile request. */
  accessToken: string | undefined;
  /** `() => import('mapbox-gl')` (and its CSS). */
  loadMapbox: () => Promise<MapboxModule>;
  /** The pin. `null` until an address is picked. */
  value: LatLng | null;
  /** Every move: each drag end and each arrow-key step. */
  onChange: (next: LatLng, source: MapPinMoveSource) => void;
  /** `reverseGeocode` from the caller, after a drag ends or keyboard moves pause. */
  reverseGeocode?: (point: LatLng) => void | Promise<unknown>;
  /** Where the address search put the pin; the "moved N m" line measures from here. */
  origin?: LatLng | null;
  /** Metres per arrow key. Default 1; Shift moves ten times as far. */
  stepMetres?: number;
  /** Pause after keyboard moves before `reverseGeocode`. Default 600 ms. */
  geocodeDelayMs?: number;
  /** Replaces the derived status line under the map. */
  description?: ReactNode;
  disabled?: boolean;
  /** Map height in px. Default 300. */
  height?: number;
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [1, 0],
  ArrowDown: [-1, 0],
  ArrowRight: [0, 1],
  ArrowLeft: [0, -1],
};

/** A draggable map pin with a keyboard and a no-map fallback. See the module comment. */
export function MapPinPicker({
  accessToken,
  loadMapbox,
  value,
  onChange,
  reverseGeocode,
  origin,
  stepMetres = 1,
  geocodeDelayMs = 600,
  description,
  disabled = false,
  height = 300,
  className,
  testId = 'MapPinPicker',
  style,
}: MapPinPickerProps) {
  const engine = useMapboxMap({ accessToken, loadMapbox, enabled: value !== null, center: value, zoom: 17 });
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const marker = useRef<MapboxMarker | null>(null);
  const handlers = useRef({ onChange, reverseGeocode });
  handlers.current = { onChange, reverseGeocode };
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const geocodeSoon = useCallback(
    (point: LatLng, delay: number) => {
      if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
      geocodeTimer.current = setTimeout(() => void handlers.current.reverseGeocode?.(point), delay);
    },
    [],
  );
  useEffect(() => () => {
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
  }, []);

  /* The marker hosts the React pin through a portal, so the map and the fallback share it. */
  const ready = engine.phase === 'ready';
  useEffect(() => {
    const map = engine.map.current;
    const gl = engine.gl.current;
    if (!ready || !map || !gl || !value) return;
    const element = document.createElement('div');
    const created = new gl.Marker({ element, draggable: !disabled }).setLngLat([value.longitude, value.latitude]).addTo(map);
    created.on('dragend', () => {
      const { lng, lat } = created.getLngLat();
      const point = { latitude: Number(lat.toFixed(6)), longitude: Number(lng.toFixed(6)) };
      handlers.current.onChange(point, 'drag');
      geocodeSoon(point, 0);
    });
    marker.current = created;
    setHost(element);
    return () => {
      created.remove();
      marker.current = null;
      setHost(null);
    };
    // The marker is created once per map; `value` moves it below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, disabled, value === null]);

  useEffect(() => {
    if (!value) return;
    marker.current?.setLngLat([value.longitude, value.latitude]);
    const map = engine.map.current;
    if (map && ready && !map.getBounds()?.contains([value.longitude, value.latitude])) {
      map.easeTo({ center: [value.longitude, value.latitude] });
    }
  }, [value, ready, engine.map]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = KEYS[event.key];
    if (!step || !value) return;
    event.preventDefault();
    if (disabled) return;
    const metres = stepMetres * (event.shiftKey ? 10 : 1);
    const next = offsetMetres(value, step[0] * metres, step[1] * metres);
    onChange(next, 'keyboard');
    geocodeSoon(next, geocodeDelayMs);
  };

  const pin = value ? (
    <MapPinHandle
      aria-label={`Pin for riders at ${formatLatLng(value)}. Drag it, or use the arrow keys to move it.`}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      data-testid={`${testId}-pin`}
    />
  ) : null;

  const moved = value && origin ? Math.round(distanceMetres(origin, value)) : 0;
  const line =
    description ??
    (!value
      ? 'No pin yet. Search your address, then drag the pin onto your entrance.'
      : moved >= 1
        ? `You moved the pin ${moved} m. Save to keep it.`
        : 'Pin placed at the address. Drag it onto your entrance so riders find your door.');
  const fallback = engine.phase === 'off' || engine.phase === 'error';

  return (
    <div data-testid={testId} data-map={engine.phase} style={style} className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div
        className="relative overflow-hidden rounded-md border-[1.5px] border-line-interactive bg-surface-sunken"
        style={{ height }}
      >
        <div ref={engine.containerRef} className="absolute inset-0" aria-hidden={!ready || undefined} />
        {host && pin ? createPortal(pin, host) : null}
        {!value ? (
          <p className="absolute inset-0 m-0 flex items-center justify-center p-6 text-center text-body-md text-fg-secondary">
            The map shows your pin once you pick your address.
          </p>
        ) : null}
        {value && engine.phase === 'loading' ? (
          <div role="status" className="absolute inset-0 flex animate-pulse items-center justify-center bg-skeleton-base text-body-md text-fg-primary motion-reduce:animate-none">
            Loading the map…
          </div>
        ) : null}
        {value && fallback ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center" data-testid={`${testId}-fallback`}>
            {pin}
            <p className="m-0 max-w-sm text-body-sm text-fg-secondary">
              {engine.phase === 'off'
                ? 'The map isn’t set up here, so the pin is shown without one. The arrow keys still move it.'
                : 'The map didn’t load. The arrow keys still move the pin, and the address fields still work.'}
            </p>
            {engine.phase === 'error' ? (
              <Button variant="tertiary" size="sm" iconStart="refresh" onPress={engine.retry}>
                Try again
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <span className="text-body-sm text-fg-primary" aria-live="polite" data-testid={`${testId}-status`}>
        {line}
      </span>
      {value ? <span className="font-mono text-body-sm text-fg-secondary">{formatLatLng(value)}</span> : null}
    </div>
  );
}
