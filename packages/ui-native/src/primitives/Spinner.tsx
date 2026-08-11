/**
 * `Spinner` — indeterminate progress.
 *
 * For waits under about a second and for the inside of a `Button`. Skeletons beat spinners
 * for anything with known geometry (components §34), so this is deliberately small.
 *
 * Under reduced motion it stops rotating and becomes a static indeterminate bar: the
 * information ("something is happening") survives, the animation does not.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, View, type ViewStyle } from 'react-native';

import { useReducedMotion, useTheme } from '../tokens';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const DIAMETER: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 40 };
const STROKE: Record<SpinnerSize, number> = { sm: 2, md: 2, lg: 3 };

export interface SpinnerProps {
  size?: SpinnerSize;
  /**
   * A real label, not "Loading". Announced politely. Omit only when the spinner sits
   * inside a control that already carries the accessible name (a loading `Button`).
   */
  label?: string;
  /** Sits on a text baseline rather than centring in its own box. */
  inline?: boolean;
  /** Defaults to `text.secondary`; a spinner on a coloured fill passes the label colour. */
  color?: string;
  testID?: string;
}

export function Spinner({
  size = 'md',
  label,
  inline = false,
  color,
  testID = 'Spinner',
}: SpinnerProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const diameter = DIAMETER[size];
  const stroke = STROKE[size];
  const tint = color ?? theme.color.text.secondary;

  useEffect(() => {
    if (reducedMotion) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, spin]);

  const a11y = {
    accessibilityRole: 'progressbar' as const,
    ...(label
      ? { accessible: true, accessibilityLabel: label, accessibilityLiveRegion: 'polite' as const }
      : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const }),
    accessibilityState: { busy: true },
  };

  if (reducedMotion) {
    // A static indeterminate bar. No rotation, no pulse, no flash.
    const bar: ViewStyle = {
      width: diameter * 2,
      height: stroke * 2,
      borderRadius: stroke,
      backgroundColor: tint,
      opacity: 0.7,
    };
    return <View testID={testID} style={bar} {...a11y} />;
  }

  const style: Animated.WithAnimatedObject<ViewStyle> = {
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
    borderWidth: stroke,
    borderColor: theme.color.border.decorative,
    borderTopColor: tint,
    alignSelf: inline ? 'center' : 'auto',
    transform: [
      {
        rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
      },
    ],
  };

  return <Animated.View testID={testID} style={style} {...a11y} />;
}
