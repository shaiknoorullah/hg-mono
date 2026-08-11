/**
 * The bespoke halal shield.
 *
 * Foundations §11: this is **not** `lucide/shield-check`. It is a custom asset precisely so
 * it cannot be reused accidentally and cannot collide with a security icon elsewhere in the
 * product, and it is **never a font glyph** — a font glyph fails silently on a missing face
 * and would render a blank certification badge, which is the one failure this component
 * cannot be allowed to have.
 *
 * It is composed from `View` geometry rather than an SVG asset. The package takes no
 * drawing dependency (see `feedback/internal/glyphs.tsx`, same convention), and a shape
 * built from layout primitives cannot fail to resolve at runtime: if React Native renders
 * at all, the shield is there. That is the property foundations §11 is actually asking for.
 *
 * Three forms carry the state in the shape channel alone (04-accessibility.md §3.2):
 * solid = certified, outline = expired, dashed = unverified. Read in greyscale with the
 * text removed, the three are still distinguishable.
 *
 * Nothing here animates (foundations §7.4 rule 4): a moving trust mark reads as an
 * advertisement, and motion-sensitive users lose access to it.
 */
import * as React from 'react';
import { I18nManager, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { ShieldForm } from './halalTokens';

export interface HalalShieldProps {
  form: ShieldForm;
  /** Ink colour. On a filled seal this is the label colour, so glyph and text agree. */
  color: string;
  size: number;
}

/**
 * The escutcheon: flat shoulders over a chamfered point.
 *
 * `w` is the shield's width and the diagonal of the rotated square that forms its point, so
 * the point's left and right vertices land exactly on the shoulders' edges and the two
 * pieces read as one silhouette rather than as a box with a diamond under it.
 */
function geometry(size: number) {
  const w = size * 0.84;
  const h = size * 0.94;
  const point = w / Math.SQRT2; // side of the rotated square
  return {
    w,
    h,
    point,
    shoulderHeight: h - w / 2,
    pointTop: h - w,
    pointInset: (w - point) / 2,
  };
}

/**
 * The two edges of a 45°-rotated square that meet at its lowest vertex.
 *
 * Under LTR that is `bottom` + `end`; under RTL `end` resolves to the left edge, so the
 * pair becomes `bottom` + `start` and the V still points down. Logical properties only
 * (lint L-7) — this is what keeps RTL a config flip rather than a redraw.
 */
function pointEdges(stroke: number): ViewStyle {
  return I18nManager.isRTL
    ? { borderBottomWidth: stroke, borderStartWidth: stroke }
    : { borderBottomWidth: stroke, borderEndWidth: stroke };
}

export function HalalShield({ form, color, size }: HalalShieldProps): React.ReactElement {
  const g = geometry(size);
  const stroke = size <= 16 ? 1.75 : 2;
  const filled = form === 'solid';
  const borderStyle = form === 'dashed' ? ('dashed' as const) : ('solid' as const);
  const radius = size * 0.1;

  return (
    <View
      // Decorative in every use: the seal's label carries the meaning, and the seal is
      // never the sole content of a link (04-accessibility.md §3.6).
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: 'center' }}
    >
      {/* Shoulders. */}
      <View
        style={{
          width: g.w,
          height: g.shoulderHeight,
          borderTopStartRadius: radius,
          borderTopEndRadius: radius,
          ...(filled
            ? { backgroundColor: color }
            : {
                borderTopWidth: stroke,
                borderStartWidth: stroke,
                borderEndWidth: stroke,
                borderColor: color,
                borderStyle,
              }),
        }}
      />
      {/* Point. */}
      <View
        style={{
          position: 'absolute',
          top: g.pointTop,
          width: g.point,
          height: g.point,
          transform: [{ rotate: '45deg' }],
          borderEndEndRadius: radius * 0.8,
          ...(filled
            ? { backgroundColor: color }
            : { ...pointEdges(stroke), borderColor: color, borderStyle }),
        }}
      />
    </View>
  );
}

/**
 * The affordance marker on an interactive seal (detail surface only).
 *
 * `direction` is logical — `forward` points at the end edge — so it mirrors under RTL while
 * the shield beside it does not.
 */
export function SealChevron({
  color,
  size,
  direction = 'forward',
}: {
  color: string;
  size: number;
  direction?: 'forward' | 'back';
}): React.ReactElement {
  const mirrored = I18nManager.isRTL;
  const forward = direction === 'forward';
  const deg = forward === !mirrored ? 45 : -135;
  const box = size * 0.5;
  const stroke = size <= 16 ? 1.75 : 2;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <View
        style={{
          width: box,
          height: box,
          borderTopWidth: stroke,
          borderEndWidth: stroke,
          borderColor: color,
          transform: [{ rotate: `${deg}deg` }],
        }}
      />
    </View>
  );
}

/**
 * The fourth shield variant: shield-with-clock, used only by the renewal note row inside
 * `HalalCertificationPanel`.
 *
 * It is the shield again, in brass-ochre, rather than a warning triangle — because
 * `EXPIRING_SOON` is a renewal signal about a certificate that is valid today, not an
 * alert about one that is not.
 */
export function HalalRenewalGlyph({
  color,
  size,
}: {
  color: string;
  size: number;
}): React.ReactElement {
  const stroke = 2;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <HalalShield form="outline" color={color} size={size} />
      {/* Clock hands, centred on the shoulders where the shield is widest. */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.3,
          width: stroke,
          height: size * 0.2,
          backgroundColor: color,
          borderRadius: stroke / 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.46,
          width: size * 0.18,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke / 2,
        }}
      />
    </View>
  );
}
