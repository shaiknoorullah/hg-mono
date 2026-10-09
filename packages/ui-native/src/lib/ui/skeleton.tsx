/**
 * RNR `Skeleton`, adapted (design-system N1) — the shape of what is arriving.
 *
 * Same contract as the StyleSheet tier's Skeleton: the geometry of the real thing (the `card`
 * variant ships a hero, the halal seal's slot at full size, a title line and two metadata
 * lines), hidden from assistive technology (the containing region says "Loading …" once).
 *
 * Differences: the fill is the generated `bg-skeleton-base` role, whose dark value is
 * `neutral.700` (#167; the old dark base matched the raised surface and was invisible), and the
 * pulse is an opacity fade on React Native's `Animated` (RNR's uses Reanimated, which this tier
 * avoids). Under reduced motion it holds still.
 */
import * as React from 'react';
import { Animated, Easing, View, type DimensionValue } from 'react-native';

import { tokens, useReducedMotion } from '../../tokens';
import { cn } from '../utils';

/** text lines · circle · rect · card (real card geometry, seal slot reserved). */
export type SkeletonVariant = 'text' | 'circle' | 'rect' | 'card';

/** Props of the className-tier `Skeleton` (the `/proposed` Skeleton's, plus `padding`). */
export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: number | `${number}%`;
  height?: number;
  /** `text` only: how many lines; the last one is short, as real text is. */
  lines?: number;
  animated?: boolean;
  /** `card` only: reserve the halal seal's slot at full size. Defaults to true. */
  reserveSealSlot?: boolean;
  /** `card` only: inner padding; the density's card padding by default. */
  padding?: number;
  testID?: string;
}

/** The seal's footprint: `radius.md`, 24 high at `label.sm` plus padding — reserved, not guessed. */
const SEAL_SLOT = { width: 116, height: 24 };
const type = tokens.typography;

/** One shimmer value per skeleton, looping 1 → 0.6 → 1 unless motion is reduced. */
function usePulse(active: boolean): Animated.Value {
  const pulse = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!active) return;
    const half = Number.parseInt(tokens.motion.duration.slow, 10) || 300;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.6, duration: half * 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: half * 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);
  return pulse;
}

/** A placeholder block sized like the content it stands in for. */
export function Skeleton({
  variant = 'rect',
  width,
  height,
  lines = 1,
  animated = true,
  reserveSealSlot = true,
  padding = tokens.density.comfortable.cardPadding,
  testID = 'Skeleton',
}: SkeletonProps): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const opacity = usePulse(animated && !reducedMotion);
  const block = (w: DimensionValue, h: number, rounded: string, key?: string) => (
    <View key={key} style={{ width: w, height: h }} className={cn('bg-skeleton-base', rounded)} />
  );
  const hidden = {
    testID,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  };

  let content: React.ReactElement;
  if (variant === 'text') {
    content = (
      <View className="gap-2" style={{ width: width ?? '100%' }}>
        {Array.from({ length: lines }, (_, i) =>
          block(i === lines - 1 && lines > 1 ? '60%' : '100%', height ?? type['body.md'].fontSize, 'rounded-xs', `line-${i}`),
        )}
      </View>
    );
  } else if (variant === 'circle') {
    const d = height ?? 40;
    content = block(d, d, 'rounded-full');
  } else if (variant === 'card') {
    content = (
      <View className="gap-3 rounded-lg bg-card" style={{ padding, width: width ?? '100%' }}>
        {block('100%', height ?? 160, 'rounded-md', 'hero')}
        {reserveSealSlot ? block(SEAL_SLOT.width, SEAL_SLOT.height, 'rounded-md', 'seal') : null}
        {block('100%', type['heading.md'].fontSize, 'rounded-xs', 'title')}
        {block('70%', type['body.sm'].fontSize, 'rounded-xs', 'meta-1')}
        {block('45%', type['body.sm'].fontSize, 'rounded-xs', 'meta-2')}
      </View>
    );
  } else {
    content = block(width ?? '100%', height ?? tokens.space['16'], 'rounded-sm');
  }
  return (
    <Animated.View {...hidden} style={{ opacity, width: variant === 'circle' ? undefined : width ?? '100%' }}>
      {content}
    </Animated.View>
  );
}
