/**
 * An indeterminate 2pt progress line for the className tier (design-system N2): the AppBar's
 * `loading` state.
 *
 * React Native `Animated` only, never Reanimated, so it runs in every build with no worklets.
 * Under reduced motion the segment stands still: the bar still says "working" and the
 * `progressbar` role and its name still announce it.
 */
import * as React from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReduceMotion } from '../../feedback/internal/a11y';
import { cn } from '../utils';
import './animated';

/** Props of `IndeterminateBar`. */
export interface IndeterminateBarProps {
  /** The progress bar's name, announced with its role. */
  label?: string;
  /** A `bg-*` role class for the moving segment. */
  className?: string;
  testID?: string;
}

/** A 2pt track with a segment that sweeps across it, pinned to the bottom edge of its parent. */
export function IndeterminateBar({
  label = 'Loading',
  className,
  testID = 'IndeterminateBar',
}: IndeterminateBarProps): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const sweep = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (reduceMotion) return undefined;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, sweep]);
  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-160, 400] });
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      className="absolute bottom-0 end-0 start-0 h-0.5 overflow-hidden"
    >
      <Animated.View
        className={cn('h-0.5 w-2/5 bg-primary', className)}
        style={reduceMotion ? undefined : { transform: [{ translateX }] }}
      />
    </View>
  );
}
