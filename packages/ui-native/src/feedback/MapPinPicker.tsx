/**
 * `MapPinPicker` — a draggable pin for address entry (customer C-31, restaurant address pin),
 * on `@rnmapbox/maps`. The native sibling of `packages/ui-web/src/proposed/MapPinPicker.tsx`.
 *
 * The caller owns the pin: it passes `value` and gets `onChange(next, source)` with the pin's
 * FINAL coordinate each time the user finishes dragging it, or taps the map to place it. Riders go
 * to the pin, so the pin's position is what is saved, not the geocoded point.
 *
 * Without a map (no SDK in this build, no public token, tiles failed) the picker draws the
 * `summary` text on a plain panel and never pretends to be draggable: the `onChange` stream then
 * comes from whatever else the screen offers (the address form's "Move pin" north / south / east /
 * west buttons, which also exist for keyboard, switch and screen-reader users and so are not
 * duplicated here). Address entry never becomes impossible because a map is missing.
 *
 * The map is hidden from assistive technology; `summary` ("Pin on 12 King St", "Pin moved. Check
 * it before you save") is the accessible content and is always rendered.
 *
 * Replaces the placeholder `MapRegion` in the customer address form's pin step: pass its `pin`
 * as `value`, its `onPinChange` as `onChange` and its summary text as `summary`.
 */
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme, type, palette, radius } from './internal/theme';
import { resolveMapbox } from './internal/maps';
import { MapPin, type LatLng } from './internal/mapParts';

/** How the pin last moved. */
export type MapPinMoveSource = 'drag' | 'tap';

export interface MapPinPickerProps {
  /** The pin. `null` until an address is picked or the user taps the map. */
  value: LatLng | null;
  /** The pin's final coordinate: each drag end and each tap. */
  onChange: (next: LatLng, source: MapPinMoveSource) => void;
  /** REQUIRED. The equivalent text; the map's accessible content and its fallback. */
  summary: string;
  /** Where the map opens when there is no pin yet (`PublicConfig.default_map_center`). */
  center?: LatLng | null;
  /** The pin cannot be moved (the form is saving). */
  disabled?: boolean;
  /** Draws the border in the danger role, for a pin error shown under the map. */
  hasError?: boolean;
  /** The public Mapbox token; defaults to `EXPO_PUBLIC_MAPBOX_TOKEN`. */
  accessToken?: string;
  height?: number;
  style?: ViewStyle;
  testID?: string;
}

const PIN_ZOOM = 17;
const AREA_ZOOM = 12;

function coordinatesOf(event: unknown): LatLng | null {
  const c = (event as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates;
  if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
  return { latitude: c[1], longitude: c[0] };
}

export function MapPinPicker({
  value,
  onChange,
  summary,
  center,
  disabled = false,
  hasError = false,
  accessToken,
  height = 240,
  style,
  testID = 'MapPinPicker',
}: MapPinPickerProps) {
  const theme = useTheme();
  const { mapbox } = resolveMapbox(accessToken);
  const [tileFailed, setTileFailed] = useState(false);

  const target = value ?? center ?? null;
  const camera = useMemo(
    () =>
      target
        ? { centerCoordinate: [target.longitude, target.latitude], zoomLevel: value ? PIN_ZOOM : AREA_ZOOM, animationDuration: 300 }
        : {},
    // Re-centre only when the pin lands somewhere new: a user's own pan is not fought on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target?.latitude, target?.longitude, Boolean(value)],
  );

  const frame: ViewStyle = {
    height,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: hasError ? 2 : 0,
    borderColor: theme.color.feedback.danger.border,
  };
  const casing = theme.color.surface.raised;
  const pinColor = (palette.map as Record<string, string>).pinCustomer!;

  const text = (
    <Text testID={`${testID}-summary`} accessibilityRole="summary" style={[type(theme, 'body.md'), { color: theme.color.text.primary }]}>
      {summary}
    </Text>
  );

  if (!mapbox || tileFailed) {
    return (
      <View testID={`${testID}-fallback`} style={[{ gap: theme.target.spacing * 2 }, style]}>
        <View style={[frame, { backgroundColor: theme.color.surface.sunken, alignItems: 'center', justifyContent: 'center', gap: theme.target.spacing }]}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ opacity: value ? 1 : 0.6 }}>
            <MapPin color={pinColor} casing={casing} size={28} />
          </View>
          <Text style={[type(theme, 'body.sm'), { color: theme.color.text.secondary, textAlign: 'center', paddingHorizontal: theme.target.spacing * 2 }]}>
            Map unavailable. Use the buttons to place the pin.
          </Text>
        </View>
        {text}
      </View>
    );
  }

  const { MapView: NativeMap, Camera, PointAnnotation } = mapbox;
  return (
    <View testID={testID} style={[{ gap: theme.target.spacing * 2 }, style]}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={frame}>
        <NativeMap
          style={{ flex: 1 }}
          styleURL={mapbox.StyleURL.Street}
          rotateEnabled={false}
          pitchEnabled={false}
          compassEnabled={false}
          scaleBarEnabled={false}
          onDidFailLoadingMap={() => setTileFailed(true)}
          onPress={(e: unknown) => {
            const at = coordinatesOf(e);
            if (at && !disabled) onChange(at, 'tap');
          }}
          testID={`${testID}-native`}
        >
          <Camera {...camera} />
          {value ? (
            <PointAnnotation
              id="hg-pin"
              // A new key per committed position: the annotation snaps to the value the caller holds.
              key={`${value.latitude},${value.longitude}`}
              coordinate={[value.longitude, value.latitude]}
              draggable={!disabled}
              onDragEnd={(e: unknown) => {
                const at = coordinatesOf(e);
                if (at) onChange(at, 'drag');
              }}
            >
              <MapPin color={pinColor} casing={casing} size={28} testID={`${testID}-pin`} />
            </PointAnnotation>
          ) : null}
        </NativeMap>
      </View>
      {text}
    </View>
  );
}
