/**
 * The drawn parts shared by `MapView` and `MapPinPicker`: pins, the rider's bearing arrow, and the
 * two pure helpers (bounds, GeoJSON line). Plain `View`s on purpose: the halal shield and the
 * structural glyphs are `View`-drawn too (docs/design/01-foundations.md §11), and a marker needs
 * no SVG.
 */
import { View } from 'react-native';

/** A WGS84 point, structurally the contract's `GeoPoint`. */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/** `ne`/`sw` as `[lng, lat]`, the shape `Camera` takes; null for no points. */
export function boundsOf(points: readonly LatLng[]): { ne: [number, number]; sw: [number, number] } | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  return {
    ne: [Math.max(...lngs), Math.max(...lats)],
    sw: [Math.min(...lngs), Math.min(...lats)],
  };
}

/** A GeoJSON `LineString` feature through `points`, the shape a `ShapeSource` takes. */
export function lineShape(points: readonly LatLng[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: points.map((p) => [p.longitude, p.latitude]) },
  };
}

/** A round pin in a `color.map.*` token, ringed in the raised-surface role so it reads on dark. */
export function MapPin({ color, casing, size = 18, testID }: { color: string; casing: string; size?: number; testID?: string }) {
  return (
    <View
      testID={testID}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 2, borderColor: casing }}
    />
  );
}

/** The rider: an arrow rotated to `headingDeg`, or an undirected dot when there is no heading. */
export function MapRiderArrow({
  color,
  casing,
  headingDeg,
  testID,
}: {
  color: string;
  casing: string;
  headingDeg: number | null;
  testID?: string;
}) {
  if (headingDeg == null) return <MapPin color={color} casing={casing} size={20} {...(testID ? { testID } : {})} />;
  return (
    <View
      testID={testID}
      style={{
        width: 0,
        height: 0,
        borderLeftWidth: 10,
        borderRightWidth: 10,
        borderBottomWidth: 22,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: color,
        transform: [{ rotate: `${headingDeg}deg` }],
      }}
    />
  );
}
