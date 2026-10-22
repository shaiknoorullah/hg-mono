/**
 * `MapView` — 02-components.md §26, the `Map` entry, drawn with `@rnmapbox/maps`: the library the
 * customer and rider apps already depend on (it is an optional peer of this package).
 *
 * A deliberately thin wrapper that exposes only what the specs need: a restaurant pin, a customer
 * pin, a rider position, and a route line. The underlying API is not re-exported and not passed
 * through. A screen that needs something else asks for it to be added here, so the apps cannot
 * each grow their own private map dialect. (`MapPinPicker` is the draggable-pin sibling for
 * address entry.)
 *
 * The rules that make this component non-obvious, all from the specs:
 *
 *  - **The map is never the only way to know where the order is.** `summary` is a required prop
 *    and is the actual accessible content; the map itself is hidden from assistive technology
 *    (04-accessibility.md, 02-components.md §26). If tiles fail, the SDK is not linked in this
 *    build (no download token), or there is no public token, the summary and `fallbackDetail`
 *    render with a "Map unavailable" note — never a crash and never a bare grey box
 *    (`internal/maps.ts` is the guard, the same one the apps use).
 *  - **`stale` freezes the rider marker.** No position for 45 s means the last known point stays
 *    exactly where it is. It must not drift or interpolate (customer spec §0.4), so this component
 *    holds the last non-stale coordinate and never animates a marker between positions.
 *  - **`permission-denied` is not an error.** It is an explanation plus a route to settings.
 *  - **Camera moves never fight a user's pan**: the camera is only handed a new target when the
 *    followed point (or the set of pins) changes, never on re-render.
 *  - Pins are the `color.map.*` tokens with a casing in the raised-surface role, so they read on
 *    both the light and dark map. The rider's green is the registered map-pin exception to "solid
 *    green is halal only": it carries no shield and makes no claim.
 */
import { useMemo, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type, palette, radius } from './internal/theme';
import { Skeleton, renderAction } from './internal/primitives';
import { Banner } from './Banner';
import { resolveMapbox } from './internal/maps';
import { MapPin, MapRiderArrow, boundsOf, lineShape } from './internal/mapParts';

/** Structurally compatible with the contract's `GeoPoint`. */
export interface MapPoint {
  latitude: number;
  longitude: number;
}

export interface MapRider extends MapPoint {
  /** `RiderLocation.heading_deg`. Rotates the arrow; absent means an undirected dot. */
  headingDeg?: number | null;
}

export type MapFollow = 'none' | 'rider' | 'fit-all';

export type MapState =
  | 'loading'
  | 'ready'
  /** No rider position for 45 s. The marker freezes and the map says so. */
  | 'stale'
  /** Socket down, polling instead. The map stays correct, only less fresh. */
  | 'degraded'
  | 'permission-denied'
  /** Tile failure. Collapses to the text panel. */
  | 'error';

export interface MapViewProps {
  /**
   * REQUIRED. The equivalent text — "Rider is 1.2 km away, about 6 minutes." This is the map's
   * accessible content and its fallback, so it is never optional.
   */
  summary: string;
  restaurant?: MapPoint | null;
  customer?: MapPoint | null;
  rider?: MapRider | null;
  /** The remaining route. Drawn in `color.map.routeActive`. */
  route?: readonly MapPoint[] | null;
  /** The part already covered. Drawn in `color.map.routeTravelled`. */
  travelled?: readonly MapPoint[] | null;
  follow?: MapFollow;
  /** `false` disables pan and zoom — a strip above a delivery step, not a map to explore. */
  interactive?: boolean;
  state?: MapState;
  height?: number;
  /**
   * The public Mapbox token. Defaults to `EXPO_PUBLIC_MAPBOX_TOKEN`, read at run time. With none
   * (or with no Mapbox SDK linked in this build) the map is not drawn and the text panel is.
   */
  accessToken?: string;
  /**
   * Addresses and ETA. Rendered under the map always, and on its own when the map cannot draw —
   * this is what makes "never the only way to know" true rather than aspirational.
   */
  fallbackDetail?: ReactNode;
  /** Deep link to system settings, shown only in `permission-denied`. */
  onOpenSettings?: () => void;
  onRetry?: () => void;
  style?: ViewStyle;
  testID?: string;
}


const MAP_COLORS = palette.map as Record<string, string>;
const PAD = { paddingTop: 40, paddingBottom: 40, paddingLeft: 40, paddingRight: 40 };

export function MapView({
  summary,
  restaurant,
  customer,
  rider,
  route,
  travelled,
  follow = 'fit-all',
  interactive = true,
  state = 'ready',
  height = 240,
  accessToken,
  fallbackDetail,
  onOpenSettings,
  onRetry,
  style,
  testID = 'MapView',
}: MapViewProps) {
  const theme = useTheme();
  const { mapbox } = resolveMapbox(accessToken);
  const [tileFailed, setTileFailed] = useState(false);

  /* The frozen rider position. While `stale`, the last good point is what renders: the marker
   * does not move, and it certainly does not interpolate toward a guess. */
  const lastGoodRider = useRef<MapRider | null>(null);
  if (state !== 'stale' && rider) lastGoodRider.current = rider;
  const shownRider = state === 'stale' ? lastGoodRider.current : (rider ?? null);

  const riderLat = shownRider?.latitude;
  const riderLng = shownRider?.longitude;
  const camera = useMemo(() => {
    const pts: MapPoint[] = [];
    if (restaurant) pts.push(restaurant);
    if (customer) pts.push(customer);
    if (follow === 'rider' && riderLat !== undefined && riderLng !== undefined) {
      return { centerCoordinate: [riderLng, riderLat], zoomLevel: 15, animationMode: 'easeTo', animationDuration: 600 };
    }
    if (riderLat !== undefined && riderLng !== undefined) pts.push({ latitude: riderLat, longitude: riderLng });
    const b = boundsOf(pts);
    if (follow === 'none' || !b) {
      return pts[0] ? { defaultSettings: { centerCoordinate: [pts[0].longitude, pts[0].latitude], zoomLevel: 14 } } : {};
    }
    if (pts.length === 1) return { centerCoordinate: [pts[0]!.longitude, pts[0]!.latitude], zoomLevel: 14 };
    return { bounds: { ...b, ...PAD }, animationDuration: 600 };
  }, [follow, restaurant?.latitude, restaurant?.longitude, customer?.latitude, customer?.longitude, riderLat, riderLng]);

  const banner =
    state === 'stale' ? (
      <Banner
        variant="warning"
        title="Location updating…"
        description="Showing the last known position. It will catch up on its own."
        testID={`${testID}-banner`}
      />
    ) : state === 'degraded' ? (
      <Banner
        variant="info"
        title="Updates may be delayed"
        description="We are checking every few seconds instead of live. The position is correct, just less fresh."
        testID={`${testID}-banner`}
      />
    ) : null;

  /* -------------------------------------------------- the states that do not draw a map */

  if (state === 'permission-denied') {
    return (
      <View testID={`${testID}-permission-denied`} style={[{ gap: theme.target.spacing * 2 }, style]}>
        <Banner
          variant="warning"
          title="Location access is off"
          description="Turn on location so the map can show where things are. You can still continue without it."
          {...(onOpenSettings
            ? { action: { label: 'Open settings', onPress: onOpenSettings } }
            : {})}
        />
        <TextPanel summary={summary} detail={fallbackDetail} testID={testID} />
      </View>
    );
  }

  if (state === 'error' || tileFailed || !mapbox) {
    return (
      <View testID={`${testID}-fallback`} style={[{ gap: theme.target.spacing * 2 }, style]}>
        <Banner
          variant="info"
          title="Map unavailable"
          description="We can't draw the map right now. Everything you need is below."
          testID={`${testID}-banner`}
        />
        <TextPanel summary={summary} detail={fallbackDetail} testID={testID} />
        {onRetry ? renderAction({ label: 'Try the map again', onPress: () => { setTileFailed(false); onRetry(); } }, { variant: 'tertiary', size: 'sm' }) : null}
      </View>
    );
  }

  if (state === 'loading') {
    return (
      <View testID={`${testID}-loading`} style={[{ gap: theme.target.spacing * 2 }, style]}>
        {/* The map frame with a skeleton tile pattern, never a blank white rectangle. */}
        <View
          aria-busy
          accessibilityLabel="Loading map"
          style={{ height, borderRadius: radius.md, overflow: 'hidden' }}
        >
          <Skeleton variant="rect" width="100%" height={height} />
        </View>
        <TextPanel summary={summary} detail={fallbackDetail} testID={testID} />
      </View>
    );
  }

  const { MapView: NativeMap, Camera, MarkerView, ShapeSource, LineLayer } = mapbox;
  const casing = theme.color.surface.raised;
  const lineStyle = (color: string, width: number) => ({ lineColor: color, lineWidth: width, lineCap: 'round', lineJoin: 'round' });

  return (
    <View testID={testID} style={[{ gap: theme.target.spacing * 2 }, style]}>
      {banner}
      <View
        // The map is not the accessible content; the summary below is.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ height, borderRadius: radius.md, overflow: 'hidden' }}
      >
        <NativeMap
          style={{ flex: 1 }}
          styleURL={mapbox.StyleURL.Street}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={false}
          pitchEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          onDidFailLoadingMap={() => setTileFailed(true)}
          testID={`${testID}-native`}
        >
          <Camera {...camera} />
          {travelled && travelled.length > 1 ? (
            <ShapeSource id="hg-travelled" shape={lineShape(travelled)}>
              <LineLayer id="hg-travelled-line" style={lineStyle(MAP_COLORS.routeTravelled!, 5)} />
            </ShapeSource>
          ) : null}
          {route && route.length > 1 ? (
            <ShapeSource id="hg-route" shape={lineShape(route)}>
              <LineLayer id="hg-route-casing" style={lineStyle(casing, 9)} />
              <LineLayer id="hg-route-line" aboveLayerID="hg-route-casing" style={lineStyle(MAP_COLORS.routeActive!, 5)} />
            </ShapeSource>
          ) : null}
          {restaurant ? (
            <MarkerView id="hg-restaurant" coordinate={[restaurant.longitude, restaurant.latitude]} allowOverlap>
              <MapPin color={MAP_COLORS.pinRestaurant!} casing={casing} testID={`${testID}-restaurant`} />
            </MarkerView>
          ) : null}
          {customer ? (
            <MarkerView id="hg-customer" coordinate={[customer.longitude, customer.latitude]} allowOverlap>
              <MapPin color={MAP_COLORS.pinCustomer!} casing={casing} testID={`${testID}-customer`} />
            </MarkerView>
          ) : null}
          {shownRider ? (
            <MarkerView id="hg-rider" coordinate={[shownRider.longitude, shownRider.latitude]} allowOverlap>
              {/* A bearing arrow, not an animated position. Freezing is the point. */}
              <MapRiderArrow
                color={MAP_COLORS.pinRider!}
                casing={casing}
                headingDeg={shownRider.headingDeg ?? null}
                testID={`${testID}-rider`}
              />
            </MarkerView>
          ) : null}
        </NativeMap>
      </View>
      <TextPanel summary={summary} detail={fallbackDetail} testID={testID} />
    </View>
  );
}

/** The equivalent text. Always rendered — this is the map's accessible content, not a fallback. */
function TextPanel({
  summary,
  detail,
  testID,
}: {
  summary: string;
  detail?: ReactNode;
  testID: string;
}) {
  const theme = useTheme();
  return (
    <View testID={`${testID}-summary`} accessibilityRole="summary" style={{ gap: theme.target.spacing }}>
      <Text style={[type(theme, 'body.md'), { color: theme.color.text.primary }]}>{summary}</Text>
      {detail}
    </View>
  );
}
