/**
 * The Solar glyph for the className tier (design-system N1).
 *
 * The same generated Solar map and `react-native-svg` drawing as the `/ds` `Icon`, with one
 * difference: the colour comes from a `text-*` role class (`text-primary-foreground`), which
 * NativeWind turns into the SVG's `color` prop. So an icon inside a Button follows the label's
 * role in every theme and scheme, with no colour passed by hand. RNR's lucide icons are never used.
 *
 * Registering the legacy `Icon` with css-interop only affects elements created in this tier
 * (NativeWind's JSX runtime); the StyleSheet tier keeps rendering it exactly as before.
 */
import * as React from 'react';
import { View } from 'react-native';
import { cssInterop } from 'nativewind';

import { Icon as SolarIcon, type IconName, type IconWeight } from '../../primitives/Icon';
import { cn } from '../utils';

cssInterop(SolarIcon, { className: { target: false, nativeStyleToProp: { color: true } } });

/** The registered glyph, typed with the `className` css-interop now maps onto `color`. */
const Svg = SolarIcon as React.ComponentType<React.ComponentProps<typeof SolarIcon> & { className?: string }>;

/** Props of `Glyph`: a Solar name, a point size, a weight and a `text-*` colour class. */
export interface GlyphProps {
  name: IconName;
  /** Points. */
  size: number;
  weight?: IconWeight;
  /** A `text-*` role class; the glyph paints in that colour. */
  className?: string;
}

/**
 * A decorative Solar glyph, hidden from assistive technology: the control around it carries
 * the name.
 */
export function Glyph({ name, size, weight = 'linear', className }: GlyphProps): React.ReactElement {
  return (
    // The class also sits on the wrapper: on react-native-web the glyph paints in `currentColor`,
    // which it inherits from there; on native css-interop hands the colour to the SVG directly.
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className={cn('text-foreground', className)}>
      <Svg name={name} size={size} weight={weight} className={cn('text-foreground', className)} />
    </View>
  );
}
