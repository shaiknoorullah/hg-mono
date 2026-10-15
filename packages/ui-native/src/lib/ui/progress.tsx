/**
 * RNR `Progress`, adapted (redesign, N5): a track and an indicator, determinate or not.
 *
 * Adaptations from the RNR template, all deliberate:
 *   - no Reanimated: React Native's `Animated` drives the indeterminate sweep, so this tier adds
 *     no worklet to a screen that only waits;
 *   - the indicator is the neutral progress role (`bg-progress-fill`, #197), never brand, green
 *     or an urgency colour: progress here reports, it does not alarm;
 *   - under reduced motion the indeterminate sweep stops and the whole track fills at half
 *     strength, so "something is happening" survives without movement;
 *   - `role="progressbar"` with `accessibilityValue`: `now` only when determinate, and `text`
 *     when the caller has words ("Restaurant replies by 6:52 p.m.") better than a percentage.
 */
import * as React from 'react';
import { Animated, Easing, View } from 'react-native';

import { useReducedMotion } from '../../tokens';
import { cn } from '../utils';

/** Props of the bar. */
export type ProgressProps = {
  /** 0..max. Omitted or `indeterminate` = no known amount. */
  value?: number | null;
  max?: number;
  indeterminate?: boolean;
  /** The accessible name ("Waiting for Zaytoun Grill to reply"). */
  accessibilityLabel: string;
  /** Spoken value instead of a percentage. */
  accessibilityValueText?: string;
  className?: string;
  indicatorClassName?: string;
  testID?: string;
};

const SWEEP_MS = 1_400;

/** A progress bar on the generated roles. */
export function Progress({
  value,
  max = 100,
  indeterminate = false,
  accessibilityLabel,
  accessibilityValueText,
  className,
  indicatorClassName,
  testID,
}: ProgressProps): React.ReactElement {
  const reduced = useReducedMotion();
  const unknown = indeterminate || value == null || !Number.isFinite(value) || max <= 0;
  const fraction = unknown ? 0 : Math.min(1, Math.max(0, (value as number) / max));
  const sweep = React.useRef(new Animated.Value(0)).current;
  const [width, setWidth] = React.useState(0);
  const sweeping = unknown && !reduced;

  React.useEffect(() => {
    if (!sweeping) return undefined;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: SWEEP_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweeping, sweep]);

  const indicator = cn('h-full rounded-full bg-progress-fill', indicatorClassName);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={
        unknown
          ? accessibilityValueText
            ? { text: accessibilityValueText }
            : undefined
          : { min: 0, max, now: Math.round(fraction * max), ...(accessibilityValueText ? { text: accessibilityValueText } : {}) }
      }
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
    >
      {!unknown ? (
        <View testID={testID ? `${testID}-indicator` : undefined} style={{ width: `${fraction * 100}%` }} className={indicator} />
      ) : reduced ? (
        <View testID={testID ? `${testID}-indicator` : undefined} className={cn(indicator, 'w-full opacity-50')} />
      ) : (
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '40%',
            transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-0.4 * width, width] }) }],
          }}
        >
          <View testID={testID ? `${testID}-indicator` : undefined} className={indicator} />
        </Animated.View>
      )}
    </View>
  );
}
