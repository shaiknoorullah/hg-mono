/**
 * The order-detail live-tracking map box — `docs/design/admin-order-detail.md`.
 *
 * Engine: `mapbox-gl-js`, brand-tinted styles. The **only** green on the map is the
 * verified-halal restaurant pin (the halal-green reservation, rule 10); the active route
 * line is brand crimson, never a halal colour. Rider position is live over the realtime
 * channel where available; this box takes whatever coordinates the caller can give it and
 * degrades honestly when it can't.
 *
 * `OrderAdminView` was widened to carry `restaurant_location` / `destination_location` /
 * `rider_location` directly (the admin-scoped counterpart to the customer-only
 * `getOrderTracking` shape — admin oversight is not subject to the customer's
 * PICKED_UP/ARRIVED rider-visibility gate). This box still renders only the pins it has
 * real coordinates for and says plainly what it does not have — a rider pin is absent,
 * honestly, until a rider is assigned and has reported a position, never fabricated.
 *
 * Without `VITE_MAPBOX_TOKEN` configured this renders the box's empty state instead of a
 * silently broken map — no token, no tile request, ever.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@hg/ui-web';

export interface MapPin {
  kind: 'restaurant' | 'customer' | 'rider';
  label: string;
  latitude: number;
  longitude: number;
}

export interface LiveMapBoxProps {
  pins: readonly MapPin[];
  etaLabel: string | null;
  countdownLabel: string | null;
  missingLabel: string | null;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export function LiveMapBox({ pins, etaLabel, countdownLabel, missingLabel }: LiveMapBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('mapbox-gl').Map | null>(null);
  const markersRef = useRef<import('mapbox-gl').Marker[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || pins.length === 0) return;
    let cancelled = false;

    void import('mapbox-gl').then((mapboxgl) => {
      if (cancelled || !containerRef.current) return;
      mapboxgl.default.accessToken = MAPBOX_TOKEN;
      const prefersDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
      const map = new mapboxgl.default.Map({
        container: containerRef.current,
        style: prefersDark ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/navigation-day-v1',
        center: [pins[0]!.longitude, pins[0]!.latitude],
        zoom: 12,
      });
      mapRef.current = map;

      const bounds = new mapboxgl.default.LngLatBounds();
      for (const pin of pins) {
        // Rule 10: the halal-green pin is the only solid green on the map. Everything else
        // (customer, rider, the route) is brand crimson or neutral — never halal green.
        const color = pin.kind === 'restaurant' ? 'var(--hg-color-halal-verified, #067A55)' : '#B42318';
        const el = document.createElement('div');
        el.style.width = '14px';
        el.style.height = '14px';
        el.style.borderRadius = '50%';
        el.style.border = '2px solid white';
        el.style.background = color;
        el.setAttribute('aria-label', pin.label);
        const marker = new mapboxgl.default.Marker({ element: el }).setLngLat([pin.longitude, pin.latitude]).addTo(map);
        markersRef.current.push(marker);
        bounds.extend([pin.longitude, pin.latitude]);
      }
      if (pins.length > 1) map.fitBounds(bounds, { padding: 48 });
      map.on('load', () => !cancelled && setReady(true));
    });

    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins.map((p) => `${p.kind}:${p.latitude},${p.longitude}`).join('|'), expanded]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="adm-map-box" data-expanded={expanded}>
        <EmptyState
          title="Live map not configured"
          description="Set VITE_MAPBOX_TOKEN to enable the live-tracking map. No token, no map request."
        />
      </div>
    );
  }

  if (pins.length === 0) {
    return (
      <div className="adm-map-box" data-expanded={expanded}>
        <EmptyState
          title="No coordinates available"
          description={missingLabel ?? 'This order has no locatable parties yet.'}
        />
      </div>
    );
  }

  return (
    <div className="adm-map-box" data-expanded={expanded}>
      <div ref={containerRef} className="adm-map-canvas" aria-hidden={!ready} />
      {etaLabel || countdownLabel ? (
        <div className="adm-map-eta text-label-md text-fg-primary">
          {etaLabel ? <div>{etaLabel}</div> : null}
          {countdownLabel ? <div className="text-body-sm text-fg-secondary">{countdownLabel}</div> : null}
        </div>
      ) : null}
      <div className="adm-map-expand">
        <Button variant="secondary" size="sm" onPress={() => setExpanded((v) => !v)}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>
      {missingLabel ? (
        <div className="adm-map-eta text-body-sm text-fg-secondary" style={{ insetBlockStart: 'auto', insetBlockEnd: 'var(--hg-space-3)' }}>
          {missingLabel}
        </div>
      ) : null}
    </div>
  );
}
