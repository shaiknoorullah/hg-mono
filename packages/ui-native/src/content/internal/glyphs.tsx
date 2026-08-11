/**
 * The content tier's structural glyphs.
 *
 * Drawn from `View` geometry rather than typed as text, for the same reason the navigation
 * and feedback tiers draw theirs (`feedback/internal/glyphs.tsx`): `allowFontScaling={false}`
 * is banned by lint (04-accessibility.md §5), and a text glyph that scales with Dynamic Type
 * would burst the fixed-height controls these sit in. The control grows through its own
 * token instead.
 *
 * Product iconography is Lucide and belongs to the app — every `icon` prop in this library
 * takes a `ReactNode`. These are the defaults the tier's own controls use so a card is
 * usable without the caller wiring an icon set.
 */
import * as React from 'react';
import { View } from 'react-native';

export interface GlyphProps {
  size?: number;
  color: string;
  strokeWidth?: number;
}

function box(size: number) {
  return { width: size, height: size, alignItems: 'center' as const, justifyContent: 'center' as const };
}

const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
  pointerEvents: 'none' as const,
};

/** `+` — the add-to-cart affordance. */
export function PlusGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps): React.ReactElement {
  return (
    <View {...hidden} style={box(size)}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: strokeWidth,
          borderRadius: strokeWidth / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: strokeWidth,
          height: size,
          borderRadius: strokeWidth / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** `−` — a true minus bar, matched in weight to the plus so the pair reads as one control. */
export function MinusGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps): React.ReactElement {
  return (
    <View {...hidden} style={box(size)}>
      <View
        style={{
          width: size,
          height: strokeWidth,
          borderRadius: strokeWidth / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** The remove affordance at quantity 1: a lid and a bin, nothing that could read as a cross. */
export function TrashGlyph({ size = 20, color, strokeWidth = 2 }: GlyphProps): React.ReactElement {
  return (
    <View {...hidden} style={{ width: size, height: size, alignItems: 'center' }}>
      <View
        style={{
          width: size,
          height: strokeWidth,
          borderRadius: strokeWidth / 2,
          backgroundColor: color,
          marginTop: size * 0.18,
        }}
      />
      <View
        style={{
          width: size * 0.72,
          height: size * 0.62,
          marginTop: strokeWidth,
          borderStartWidth: strokeWidth,
          borderEndWidth: strokeWidth,
          borderBottomWidth: strokeWidth,
          borderColor: color,
          borderBottomStartRadius: strokeWidth,
          borderBottomEndRadius: strokeWidth,
        }}
      />
    </View>
  );
}

/**
 * A heart, for the favourite control.
 *
 * The outline form is a second heart in the surface colour inset inside the first, rather
 * than a stroked path: three primitives stroked individually would show their seams where
 * the lobes meet the point. That also keeps filled and unfilled the *same* silhouette, so
 * the difference is shape-filled versus shape-hollow and not merely a colour swap — the
 * favourite state is legible without relying on hue (04-accessibility.md §1.4).
 */
export function HeartGlyph({
  size = 20,
  color,
  filled,
  hollowColor,
}: {
  size?: number;
  color: string;
  filled: boolean;
  /** The surface behind the glyph. Fills the inner heart to leave an outline. */
  hollowColor: string;
}): React.ReactElement {
  return (
    <View {...hidden} style={box(size)}>
      <HeartShape size={size} color={color} />
      {filled ? null : <HeartShape size={size - 3.5} color={hollowColor} />}
    </View>
  );
}

/** Two lobes and a point, composed so the silhouette closes without a visible seam. */
function HeartShape({ size, color }: { size: number; color: string }): React.ReactElement {
  const lobe = size * 0.56;
  const point = size * 0.62;
  return (
    <View style={{ position: 'absolute', width: size, height: size, alignItems: 'center' }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.3,
          width: point,
          height: point,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.18,
          start: size * 0.06,
          width: lobe,
          height: lobe,
          borderRadius: lobe / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.18,
          end: size * 0.06,
          width: lobe,
          height: lobe,
          borderRadius: lobe / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
