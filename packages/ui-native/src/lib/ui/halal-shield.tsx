/**
 * The halal shield for the className tier (design-system N4). Internal to the halal family: it is
 * exported from neither `/ds` nor `/proposed`, and only `halal-badge.tsx` and `halal-panel.tsx`
 * draw it (live HalalShield README: "do not place it yourself").
 *
 * It is the legacy View-drawn shield (`certification/internal/HalalShield.tsx`), reused, not
 * redrawn: never SVG, never a font glyph, never an icon-set shield (AGENTS.md §8, foundations
 * §11). Registering it with css-interop, as `Glyph` registers the Solar icon, lets a `text-*`
 * class become its `color` prop, so the ink follows the scheme through `dark:` like every other
 * class. The registration only affects elements created in this tier (NativeWind's JSX
 * runtime); the legacy badge keeps rendering it exactly as before.
 *
 * Four variants carry the state in the shape channel alone (04-accessibility.md §3.2):
 * `solid` (certified), `outline` (expired), `dashed` (unverified) and `solid-clock` (the expiring
 * seal and the renewal note). `solid-clock` is new in N4: the solid shield with a clock knocked
 * out of it in the plate's own colour, as the live `HalalShield` draws it. It never animates and
 * is never mirrored.
 */
import * as React from 'react';
import { View } from 'react-native';
import { cssInterop } from 'nativewind';

import { HalalShield as LegacyShield, SealChevron as LegacyChevron } from '../../certification/internal/HalalShield';
import { cn } from '../utils';

cssInterop(LegacyShield, { className: { target: false, nativeStyleToProp: { color: true } } });
cssInterop(LegacyChevron, { className: { target: false, nativeStyleToProp: { color: true } } });

/** The interactive seal's affordance (detail surface only), inked by a `text-*` class. */
export const HalalChevron = LegacyChevron as unknown as React.ComponentType<{
  size: number;
  direction?: 'forward' | 'back';
  color?: string;
  className?: string;
}>;

/** The registered shield, typed with the `className` css-interop now maps onto `color`. */
const Shield = LegacyShield as unknown as React.ComponentType<{
  form: 'solid' | 'outline' | 'dashed';
  size: number;
  color?: string;
  className?: string;
}>;

/** The four shapes of the halal state. */
export type HalalShieldVariant = 'solid' | 'outline' | 'dashed' | 'solid-clock';

/**
 * What the clock is knocked out in: the plate it sits on. A closed set, because a knockout is a
 * halal token and never a free colour (live README: "There is no raw colour default").
 */
export type HalalKnockout = 'expiring';

/**
 * Knockout classes (border for the dial, fill for the hands). The dark values are the existing
 * `*Dark` primitives: in-component dark mapping, recorded debt until the themed halal roles are
 * approved (design-system plan §2.3 step 2).
 */
const KNOCKOUT: Record<HalalKnockout, { dial: string; hand: string }> = {
  expiring: {
    dial: 'border-halal-expiring-tint dark:border-halal-expiring-tintDark',
    hand: 'bg-halal-expiring-tint dark:bg-halal-expiring-tintDark',
  },
};

/** Props of the className-tier shield. */
export interface HalalShieldMarkProps {
  variant: HalalShieldVariant;
  /** Points. */
  size: number;
  /** A `text-halal-*` class (and its `dark:` pair): the ink. */
  className: string;
  /** `solid-clock` only: the plate the clock is knocked out of. */
  knockout?: HalalKnockout;
  testID?: string;
}

/** The decorative halal shield; the owning badge or note carries the name. */
export function HalalShieldMark({
  variant,
  size,
  className,
  knockout = 'expiring',
  testID = 'HalalShield',
}: HalalShieldMarkProps): React.ReactElement {
  const form = variant === 'solid-clock' ? 'solid' : variant;
  // The live clock: a dial of radius 4.1 at (12, 11.6) on a 24 box, stroke 1.6, two hands.
  const dial = size * 0.36;
  const stroke = Math.max(1, size * 0.07);
  const k = KNOCKOUT[knockout];
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: size, height: size }}
    >
      <Shield form={form} size={size} className={className} />
      {variant === 'solid-clock' ? (
        <View
          testID={`${testID}-clock`}
          style={{ position: 'absolute', left: (size - dial) / 2, top: size * 0.42 - dial / 2, width: dial, height: dial }}
        >
          <View className={cn('absolute inset-0 rounded-full', k.dial)} style={{ borderWidth: stroke }} />
          {/* Hour hand straight up from the centre, minute hand to the right: never mirrored. */}
          <View
            className={cn('absolute rounded-full', k.hand)}
            style={{ left: dial / 2 - stroke / 2, top: dial * 0.22, width: stroke, height: dial * 0.32 }}
          />
          <View
            className={cn('absolute rounded-full', k.hand)}
            style={{ left: dial / 2 - stroke / 2, top: dial / 2 - stroke / 2, width: dial * 0.28, height: stroke }}
          />
        </View>
      ) : null}
    </View>
  );
}
