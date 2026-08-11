/**
 * Shared internals for the navigation and feedback tiers (both owned by the same author).
 *
 * These are the handful of structural glyphs the two tiers draw for themselves: a close cross, a
 * chevron, a tick, a bang. They are drawn from `View` borders rather than typed as text, because
 * `allowFontScaling={false}` is banned by lint (04-accessibility.md §5) and a text glyph that
 * scales with dynamic type would break the chrome it sits in. Product iconography is Lucide and
 * belongs to the caller — every public prop that takes an icon accepts a `ReactNode`, so an app
 * passes `lucide-react-native` nodes straight through and these are only the fallback.
 *
 * Directional glyphs carry `rtlFlip` by role, per 04-accessibility.md §7.2: chevrons mirror, the
 * tick does not.
 */
import { I18nManager, View } from 'react-native';
import type { ViewStyle } from 'react-native';

export interface GlyphProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

const bar = (color: string, w: number, h: number, rotate: string): ViewStyle => ({
  position: 'absolute',
  width: w,
  height: h,
  backgroundColor: color,
  borderRadius: h / 2,
  transform: [{ rotate }],
});

/** A close cross. Never mirrored. */
export function CloseGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={bar(color, size * 0.8, strokeWidth, '45deg')} />
      <View style={bar(color, size * 0.8, strokeWidth, '-45deg')} />
    </View>
  );
}

/**
 * A chevron. `direction` is logical: `back` points to the start edge, `forward` to the end edge.
 * Both mirror under RTL, which is the whole reason this takes a logical direction and not a side.
 */
export function ChevronGlyph({
  size = 20,
  color,
  strokeWidth = 2,
  direction = 'forward',
}: GlyphProps & { direction?: 'back' | 'forward' | 'up' | 'down' }) {
  const mirrored = I18nManager.isRTL;
  let deg: number;
  switch (direction) {
    case 'back':
      deg = mirrored ? 45 : -135;
      break;
    case 'forward':
      deg = mirrored ? -135 : 45;
      break;
    case 'up':
      deg = -45;
      break;
    default:
      deg = 135;
      break;
  }
  const box = size * 0.5;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: box,
          height: box,
          borderTopWidth: strokeWidth,
          borderEndWidth: strokeWidth,
          borderColor: color,
          transform: [{ rotate: `${deg}deg` }],
        }}
      />
    </View>
  );
}

/** A tick. Explicitly NOT mirrored under RTL (04-accessibility.md §7.2). */
export function CheckGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.5,
          height: size * 0.26,
          borderBottomWidth: strokeWidth,
          borderStartWidth: strokeWidth,
          borderColor: color,
          transform: [{ rotate: '-45deg' }, { translateY: -size * 0.06 }],
        }}
      />
    </View>
  );
}

/** An exclamation mark: the shape that carries `warning`/`danger` so colour is never alone. */
export function BangGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: strokeWidth,
          height: size * 0.45,
          backgroundColor: color,
          borderRadius: strokeWidth,
        }}
      />
      <View
        style={{
          width: strokeWidth,
          height: strokeWidth,
          marginTop: size * 0.1,
          backgroundColor: color,
          borderRadius: strokeWidth,
        }}
      />
    </View>
  );
}

/** A lower-case i: the shape that carries `info`. */
export function InfoGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: strokeWidth,
          height: strokeWidth,
          backgroundColor: color,
          borderRadius: strokeWidth,
        }}
      />
      <View
        style={{
          width: strokeWidth,
          height: size * 0.4,
          marginTop: size * 0.08,
          backgroundColor: color,
          borderRadius: strokeWidth,
        }}
      />
    </View>
  );
}

/** A filled disc, used for the `current` timeline node and for dot badges. */
export function DotGlyph({ size = 8, color }: GlyphProps) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
