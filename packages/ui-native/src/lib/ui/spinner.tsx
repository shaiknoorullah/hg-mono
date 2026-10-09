/**
 * `Spinner` for the className tier (design-system N1) — RNR's choice, the platform
 * `ActivityIndicator`, so it needs no Reanimated and follows the system's reduced-motion handling.
 *
 * The colour is a `text-*` role class, which NativeWind hands to the indicator's `color` prop:
 * inside a Button the spinner takes the label's role, so a loading button keeps its colours.
 * With a `label` it is a named, polite progress indicator; without one it is hidden, because the
 * control around it already carries the name and `accessibilityState.busy`.
 */
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { cn } from '../utils';

/** sm and md use the platform's small indicator, lg its large one. */
export type SpinnerSize = 'sm' | 'md' | 'lg';

/** Box sizes in points, so a spinner swapped in for an icon keeps the icon's footprint. */
export const SPINNER_BOX: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 40 };

/** Props of the className-tier `Spinner`. */
export interface SpinnerProps {
  size?: SpinnerSize;
  /** A real label ("Loading your orders"), announced politely. Omit inside a named control. */
  label?: string;
  /** A `text-*` role class for the indicator's colour; defaults to the secondary text role. */
  className?: string;
  /** Deprecated alias for one release: an explicit colour (a theme role value), wins over `className`. */
  color?: string;
  testID?: string;
}

/** Indeterminate progress in a fixed box. */
export function Spinner({ size = 'md', label, className, color, testID = 'Spinner' }: SpinnerProps): React.ReactElement {
  const box = SPINNER_BOX[size];
  const a11y = label
    ? { accessible: true, accessibilityLabel: label, accessibilityLiveRegion: 'polite' as const }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      {...a11y}
      style={{ width: box, height: box }}
      className="items-center justify-center"
    >
      <ActivityIndicator
        size={size === 'lg' ? 'large' : 'small'}
        {...(color ? { color } : { className: cn('text-muted-foreground', className) })}
      />
    </View>
  );
}
