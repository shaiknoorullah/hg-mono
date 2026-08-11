/**
 * `MapView` — 02-components.md §26, the `Map` entry.
 *
 * A deliberately thin wrapper over `react-native-maps` that exposes only what the specs need:
 * a restaurant pin, a customer pin, a rider position, and a route line. The underlying API is not
 * re-exported and not passed through — no `provider`, no `region`, no `children`, no
 * `onRegionChangeComplete`. A screen that needs something else asks for it to be added here, so
 * the four apps cannot each grow their own private map dialect.
 *
 * The rules that make this component non-obvious, all from the specs:
 *
 *  - **The map is never the only way to know where the order is.** `summary` is a required prop
 *    and is the actual accessible content; the map itself is hidden from assistive technology
 *    (04-accessibility.md, 02-components.md §26). If tiles fail, or the native module is not
 *    installed at all, the summary and `fallbackDetail` are what render.
 *  - **`stale` freezes the rider marker.** No position for 45 s means the last known point stays
 *    exactly where it is. It must not drift or interpolate (customer spec §0.4), so this component
 *    holds the last non-stale coordinate and never animates a marker between positions.
 *  - **`permission-denied` is not an error.** It is an explanation plus a route to settings.
 *  - **Camera moves never fight a user's pan**, so `follow` only re-centres when it changes or when
 *    the followed point changes, and never while the user is interacting.
 */
import { useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';
import type { ViewStyle } from 'react-native';

import { useTheme, type, palette, radius } from './internal/theme';
import { Skeleton, renderAction } from './internal/primitives';
import { Banner } from './Banner';
import { resolveNativeMaps } from './internal/maps';

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

function regionFor(points: readonly MapPoint[]) {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.01),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.01),
  };
}

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
  fallbackDetail,
  onOpenSettings,
  onRetry,
  style,
  testID = 'MapView',
}: MapViewProps) {
  const theme = useTheme();
  const maps = resolveNativeMaps();

  /* The frozen rider position. While `stale`, the last good point is what renders — the marker
   * does not move, and it certainly does not interpolate toward a guess. */
  const lastGoodRider = useRef<MapRider | null>(null);
  if (state !== 'stale' && rider) lastGoodRider.current = rider;
  const shownRider = state === 'stale' ? lastGoodRider.current : (rider ?? null);

  const points = useMemo(() => {
    const p: MapPoint[] = [];
    if (restaurant) p.push(restaurant);
    if (customer) p.push(customer);
    if (shownRider) p.push(shownRider);
    return p;
  }, [restaurant, customer, shownRider]);

  const mapRef = useRef<any>(null);
  const followTarget = follow === 'rider' ? shownRider : null;

  useEffect(() => {
    const ref = mapRef.current;
    if (!ref || !maps) return;
    if (follow === 'none') return;
    if (follow === 'rider' && followTarget && typeof ref.animateCamera === 'function') {
      ref.animateCamera({ center: { latitude: followTarget.latitude, longitude: followTarget.longitude } });
      return;
    }
    if (follow === 'fit-all' && points.length > 1 && typeof ref.fitToCoordinates === 'function') {
      ref.fitToCoordinates(points, {
        edgePadding: { top: 48, bottom: 48, left: 48, right: 48 },
        animated: true,
      });
    }
    // `points` is intentionally not a dependency: re-fitting on every position tick would fight a
    // user's pan, which 02-components.md §26 forbids.
  }, [follow, followTarget?.latitude, followTarget?.longitude, maps]);

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

  if (state === 'error' || !maps) {
    return (
      <View testID={`${testID}-fallback`} style={[{ gap: theme.target.spacing * 2 }, style]}>
        <Banner
          variant="info"
          title="Map unavailable"
          description="We can't draw the map right now. Everything you need is below."
          testID={`${testID}-banner`}
        />
        <TextPanel summary={summary} detail={fallbackDetail} testID={testID} />
        {onRetry ? renderAction({ label: 'Try the map again', onPress: onRetry }, { variant: 'tertiary', size: 'sm' }) : null}
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

  const { MapView: NativeMap, Marker, Polyline } = maps;
  const initialRegion = regionFor(points);

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
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={initialRegion ?? undefined}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          testID={`${testID}-native`}
        >
          {travelled && travelled.length > 1 ? (
            <Polyline coordinates={travelled} strokeWidth={4} strokeColor={MAP_COLORS.routeTravelled} />
          ) : null}
          {route && route.length > 1 ? (
            <Polyline coordinates={route} strokeWidth={5} strokeColor={MAP_COLORS.routeActive} />
          ) : null}
          {restaurant ? (
            <Marker coordinate={restaurant} pinColor={MAP_COLORS.pinRestaurant} title="Restaurant" />
          ) : null}
          {customer ? (
            <Marker coordinate={customer} pinColor={MAP_COLORS.pinCustomer} title="Delivery address" />
          ) : null}
          {shownRider ? (
            <Marker
              coordinate={{ latitude: shownRider.latitude, longitude: shownRider.longitude }}
              pinColor={MAP_COLORS.pinRider}
              title="Rider"
              // A bearing arrow, not an animated position. Freezing is the point.
              rotation={shownRider.headingDeg ?? 0}
              flat
            />
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
