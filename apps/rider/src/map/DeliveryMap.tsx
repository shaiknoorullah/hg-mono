/**
 * The rider's live map: own position, the restaurant and drop-off pins, and the road route between
 * them, with the distance and ETA always written out underneath.
 *
 * Used on the offer screen (`leg="preview"`: rider → pickup → drop-off area) and on the active
 * delivery screen (`leg="pickup"` until the order is picked up, then `leg="dropoff"`).
 *
 * The map is never the only way to know where to go. The text panel under it — distance, ETA,
 * "route unavailable", "last updated Ns ago" — always renders, and it is the whole component when
 * the build has no Mapbox SDK linked (no download token, see `react-native.config.js`), on web, or
 * when there is no public tile token. The map itself is hidden from assistive technology; the text
 * is its accessible content.
 *
 * Motion: the rider's marker glides between fixes (`RiderMarker`) instead of jumping. A fix older
 * than 30 s is labelled with its age, and the marker stays where it was.
 *
 * Colours: pins and route are `color.map.*`, the design tokens for map marks
 * (docs/design/tokens.json, `map`); the rider pin's green is the registered map-pin exception to
 * "solid green is halal only" (AGENTS.md "Non-negotiable invariants"; it carries no shield and
 * makes no claim).
 */
import * as React from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, palette, useTheme, useTypeStyle } from '@hg/ui-native';

import type { Fix, LiveFix } from '../location';
import { openNavigation } from '../navigate';
import {
  boundsOf,
  estimateRoute,
  formatDistance,
  formatDuration,
  lerp,
  staleLabel,
  type LatLng,
  type Leg,
} from './geo';
import { loadMapbox, type MapboxModule } from './mapbox';
import { MAPBOX_PUBLIC_TOKEN, useRoute } from './route';

const MAP_COLORS = palette.map as Record<
  'routeActive' | 'routeTravelled' | 'pinRestaurant' | 'pinCustomer' | 'pinRider',
  string
>;

export type DeliveryLeg = 'preview' | 'pickup' | 'dropoff';

export interface DeliveryMapProps {
  leg: DeliveryLeg;
  pickup: LatLng & { label: string };
  /** On the offer this is the drop-off *area* (the pre-accept projection is coarse). */
  dropoff: LatLng & { label: string };
  /** The rider's own position, from `useLiveFix`. */
  rider: LiveFix;
  height?: number;
  /** Shows a "Navigate" button that opens the phone's navigation app on the current leg. */
  navigable?: boolean;
  /** Test seam: the module loader and token, so the map branch can be exercised without a
   *  native build. Screens never pass these. */
  mapbox?: MapboxModule | null;
  token?: string;
}

let tokenSet = false;

/** The Mapbox module ready to draw, or null when this build or environment cannot. */
function useMapbox(override: MapboxModule | null | undefined, token: string): MapboxModule | null {
  const mb = override !== undefined ? override : loadMapbox();
  if (!mb || !token) return null;
  if (!tokenSet) {
    void mb.setAccessToken(token);
    tokenSet = true;
  }
  return mb;
}

/** Re-renders every 5 s so "last updated Ns ago" counts up between fixes. */
function useNow(periodMs = 5_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}

export function DeliveryMap({
  leg,
  pickup,
  dropoff,
  rider,
  height = 220,
  navigable = false,
  mapbox,
  token = MAPBOX_PUBLIC_TOKEN,
}: DeliveryMapProps): React.ReactElement {
  const theme = useTheme();
  const body = useTypeStyle('body.lg');
  const caption = useTypeStyle('caption');
  const MB = useMapbox(mapbox, token);
  const now = useNow();

  const fix: Fix | null = rider.status === 'ok' ? rider.fix : null;
  const origin = fix ? { latitude: fix.latitude, longitude: fix.longitude } : null;
  const stops = React.useMemo<LatLng[]>(
    () =>
      leg === 'preview'
        ? [strip(pickup), strip(dropoff)]
        : leg === 'pickup'
          ? [strip(pickup)]
          : [strip(dropoff)],
    [leg, pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude],
  );
  const { route, status: routeStatus } = useRoute(origin, stops, token);

  // The numbers: the road route when there is one for these exact stops, else the straight-line
  // estimate. (A route fetched before the first fix has one leg fewer than the stops now need.)
  const points = origin ? [origin, ...stops] : stops;
  const routed = route !== null && route.legs.length === points.length - 1;
  const legs: Leg[] = routed ? route.legs : estimateRoute(points).legs;
  const lines = summaryLines(leg, !!origin, legs, pickup.label, dropoff.label);
  const stale = staleLabel(fix?.recorded_at, now);

  // The customer's name never goes to the maps app; the restaurant's name labels the pin there.
  const target = leg === 'dropoff' ? strip(dropoff) : pickup;

  return (
    <View testID="delivery-map" style={{ gap: theme.target.spacing }}>
      {MB ? (
        <View
          testID="delivery-map-canvas"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height, borderRadius: 12, overflow: 'hidden' }}
        >
          <MapCanvas
            MB={MB}
            leg={leg}
            pickup={pickup}
            dropoff={dropoff}
            rider={fix}
            stale={stale !== null}
            route={routed ? route.coordinates : null}
            straight={points}
            casing={theme.color.surface.raised}
          />
        </View>
      ) : null}

      <View testID="delivery-map-summary" accessible accessibilityRole="summary" style={{ gap: 2 }}>
        {lines.map((l) => (
          <Text key={l} style={{ ...body, color: theme.color.text.primary }}>
            {l}
          </Text>
        ))}
        {!routed && routeStatus !== 'loading' && points.length >= 2 ? (
          <Text style={{ ...caption, color: theme.color.text.tertiary }}>
            Route unavailable: straight-line estimate
          </Text>
        ) : null}
        {routeStatus === 'loading' ? (
          <Text style={{ ...caption, color: theme.color.text.tertiary }}>Finding the route…</Text>
        ) : null}
        {rider.status === 'waiting' ? (
          <Text style={{ ...caption, color: theme.color.text.tertiary }}>
            Finding your location…
          </Text>
        ) : null}
        {rider.status === 'denied' ? (
          <Text style={{ ...caption, color: theme.color.text.secondary }}>
            Allow location access to see yourself on the map.
          </Text>
        ) : null}
        {rider.status === 'unavailable' ? (
          <Text style={{ ...caption, color: theme.color.text.secondary }}>
            Your location is unavailable right now.
          </Text>
        ) : null}
        {stale ? (
          <Text testID="delivery-map-stale" style={{ ...caption, color: theme.color.text.secondary }}>
            {stale}
          </Text>
        ) : null}
      </View>

      {navigable ? (
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => void openNavigation(target, Platform.OS)}
        >
          {leg === 'dropoff' ? 'Navigate to customer' : 'Navigate to restaurant'}
        </Button>
      ) : null}
    </View>
  );
}

function strip(p: LatLng): LatLng {
  return { latitude: p.latitude, longitude: p.longitude };
}

/** The distance-and-ETA lines; also what a build without the map shows on its own. */
export function summaryLines(
  leg: DeliveryLeg,
  hasOrigin: boolean,
  legs: readonly Leg[],
  pickupLabel: string,
  dropoffLabel: string,
): string[] {
  const fmt = (l: Leg | undefined) =>
    l ? `${formatDistance(l.distance_m)} · about ${formatDuration(l.duration_s)}` : null;
  if (leg === 'preview') {
    const toPickup = hasOrigin ? fmt(legs[0]) : null;
    const trip = fmt(hasOrigin ? legs[1] : legs[0]);
    return [
      ...(toPickup ? [`To ${pickupLabel}: ${toPickup}`] : []),
      ...(trip ? [`${pickupLabel} to ${dropoffLabel}: ${trip}`] : []),
    ];
  }
  const to = leg === 'pickup' ? pickupLabel : dropoffLabel;
  const line = hasOrigin ? fmt(legs[0]) : null;
  return line ? [`To ${to}: ${line}`] : [];
}

function MapCanvas({
  MB,
  leg,
  pickup,
  dropoff,
  rider,
  stale,
  route,
  straight,
  casing,
}: {
  MB: MapboxModule;
  leg: DeliveryLeg;
  pickup: LatLng;
  dropoff: LatLng;
  rider: Fix | null;
  stale: boolean;
  route: LatLng[] | null;
  straight: LatLng[];
  casing: string;
}): React.ReactElement {
  // The camera frames the stops and the rider once per leg and when the first fix arrives — not
  // on every fix, so it never fights a rider who has panned the map.
  const hasRider = rider !== null;
  const frame = React.useMemo(() => {
    const pts: LatLng[] = [];
    if (leg !== 'dropoff') pts.push(pickup);
    if (leg !== 'pickup') pts.push(dropoff);
    if (rider) pts.push(rider);
    return boundsOf(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leg, hasRider, pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude]);

  const line = route ?? straight;
  const lineShape = React.useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: line.map((p) => [p.longitude, p.latitude]),
      },
    }),
    [line],
  );

  return (
    <MB.MapView
      style={{ flex: 1 }}
      styleURL={MB.StyleURL.Street}
      compassEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
      scaleBarEnabled={false}
    >
      {frame ? (
        <MB.Camera
          bounds={frame}
          padding={{ paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 }}
          animationDuration={600}
        />
      ) : null}
      {line.length >= 2 ? (
        <MB.ShapeSource id="hg-route" shape={lineShape}>
          <MB.LineLayer
            id="hg-route-casing"
            style={{ lineColor: casing, lineWidth: 9, lineCap: 'round', lineJoin: 'round' }}
          />
          <MB.LineLayer
            id="hg-route-line"
            aboveLayerID="hg-route-casing"
            style={{
              lineColor: MAP_COLORS.routeActive,
              lineWidth: 5,
              lineCap: 'round',
              lineJoin: 'round',
              // A straight line is an estimate, so it is dashed: it is not a road.
              ...(route ? {} : { lineDasharray: [1.5, 1.5] }),
            }}
          />
        </MB.ShapeSource>
      ) : null}
      {leg !== 'dropoff' ? (
        <Pin MB={MB} id="hg-pickup" at={pickup} color={MAP_COLORS.pinRestaurant} casing={casing} />
      ) : null}
      {leg !== 'pickup' ? (
        <Pin MB={MB} id="hg-dropoff" at={dropoff} color={MAP_COLORS.pinCustomer} casing={casing} />
      ) : null}
      {rider ? <RiderMarker MB={MB} fix={rider} frozen={stale} casing={casing} /> : null}
    </MB.MapView>
  );
}

function pointShape(p: LatLng) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Point' as const, coordinates: [p.longitude, p.latitude] },
  };
}

function Pin({
  MB,
  id,
  at,
  color,
  casing,
  radius = 8,
}: {
  MB: MapboxModule;
  id: string;
  at: LatLng;
  color: string;
  casing: string;
  radius?: number;
}): React.ReactElement {
  const shape = React.useMemo(() => pointShape(at), [at.latitude, at.longitude]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <MB.ShapeSource id={id} shape={shape}>
      <MB.CircleLayer
        id={`${id}-dot`}
        style={{
          circleColor: color,
          circleRadius: radius,
          circleStrokeColor: casing,
          circleStrokeWidth: 2,
        }}
      />
    </MB.ShapeSource>
  );
}

const GLIDE_MS = 900;
const GLIDE_STEP_MS = 66;

/**
 * The rider's own marker, gliding from where it is drawn to each new fix over ~1 s instead of
 * jumping. A stale fix (`frozen`) does not move it. Kept in its own component so the per-frame
 * updates re-render only this source, not the map.
 */
function RiderMarker({
  MB,
  fix,
  frozen,
  casing,
}: {
  MB: MapboxModule;
  fix: Fix;
  frozen: boolean;
  casing: string;
}): React.ReactElement {
  const at = useGlide({ latitude: fix.latitude, longitude: fix.longitude }, frozen);
  return <Pin MB={MB} id="hg-rider" at={at} color={MAP_COLORS.pinRider} casing={casing} radius={9} />;
}

export function useGlide(target: LatLng, frozen = false): LatLng {
  const [drawn, setDrawn] = React.useState<LatLng>(target);
  const drawnRef = React.useRef(drawn);
  drawnRef.current = drawn;
  React.useEffect(() => {
    if (frozen) return;
    const from = drawnRef.current;
    if (from.latitude === target.latitude && from.longitude === target.longitude) return;
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) / GLIDE_MS;
      setDrawn(lerp(from, target, t));
      if (t >= 1) clearInterval(id);
    }, GLIDE_STEP_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.latitude, target.longitude, frozen]);
  return drawn;
}
