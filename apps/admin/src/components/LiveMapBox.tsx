/**
 * The order-detail live-tracking map box — `docs/design/admin-order-detail.md`.
 *
 * Engine: `mapbox-gl-js`, brand-tinted styles. The **only** green on the map is the
 * rider pin, the registered exception to the rule that solid green is reserved for halal
 * status (AGENTS.md "Non-negotiable invariants"), because a HalalGoes rider is not a
 * certification claim. The restaurant pin is the brand orange: this box knows a
 * restaurant's coordinates, never its halal state, so it cannot and does not make a
 * verification claim. Rider position is live over the realtime channel where available;
 * this box takes whatever coordinates the caller can give it and degrades honestly when
 * it can't.
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

/**
 * Pin colours, from `color.map.*` — the tokens that exist for exactly this.
 *
 * This used to paint every restaurant pin with
 * `var(--hg-color-halal-verified, #067A55)`. That custom property does not
 * exist, so the fallback painted unconditionally: a solid green dot on every
 * restaurant whatever its certification state, including expired ones. A
 * missing halal field renders no badge, never an optimistic one (AGENTS.md
 * "Non-negotiable invariants"), and `MapPin` carries no halal state at all — `kind`, `label`, and a
 * coordinate. A dot on a map cannot know the thing it was claiming, so it must
 * not claim it.
 *
 * Green on this map belongs to the RIDER pin, the one registered exception to
 * the no-green lint (docs/design/01-foundations.md "Data-visualisation and map
 * colours": a rider is not a certification claim, and carries no shield). The
 * restaurant pin is the action orange.
 */
const PIN_COLOUR: Record<MapPin['kind'], string> = {
  restaurant: 'var(--hg-color-map-pin-restaurant, #F1521E)',
  customer: 'var(--hg-color-map-pin-customer, #1B3B31)',
  rider: 'var(--hg-color-map-pin-rider, #0F7A43)',
};

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
        const color = PIN_COLOUR[pin.kind];
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
