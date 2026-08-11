/**
 * `Skeleton` — the shape of what is arriving.
 *
 * A skeleton matches the **real geometry** of the thing it stands in for, not a generic
 * grey box (components §33). The `card` variant therefore ships a hero, a badge-sized
 * block, a title line and two metadata lines.
 *
 * **Hard rule.** The halal seal's slot is reserved at full size in any skeleton that will
 * contain one. A card that reflows when the badge arrives makes the badge feel like an
 * afterthought, and the badge is the product.
 *
 * Skeletons never announce individually — they are hidden, and the containing region
 * carries `accessibilityState.busy` and says "Loading {thing}" once.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, View, type ViewStyle } from 'react-native';

import { tokens, useReducedMotion, useTheme } from '../tokens';

export type SkeletonVariant = 'text' | 'circle' | 'rect' | 'card';

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: number | `${number}%`;
  height?: number;
  /** `text` only: how many lines; the last one is short, as real text is. */
  lines?: number;
  animated?: boolean;
  /** `card` only: reserve the seal slot. Defaults to true — see the hard rule above. */
  reserveSealSlot?: boolean;
  testID?: string;
}

/** The seal is `radius.md`, 22 high at `label.sm` plus its padding — reserved, not guessed. */
const SEAL_SLOT = { width: 116, height: 24 };

export function Skeleton({
  variant = 'rect',
  width,
  height,
  lines = 1,
  animated = true,
  reserveSealSlot = true,
  testID = 'Skeleton',
}: SkeletonProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const shimmer = useRef(new Animated.Value(0)).current;
  const active = animated && !reducedMotion;

  useEffect(() => {
    if (!active) return;
    shimmer.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, shimmer]);

  const fill = active
    ? shimmer.interpolate({
        inputRange: [0, 1],
        outputRange: [theme.color.skeleton.base, theme.color.skeleton.highlight],
      })
    : theme.color.skeleton.base;

  const block = (style: ViewStyle, key?: string) => (
    <Animated.View key={key} style={[style, { backgroundColor: fill }]} />
  );

  const hidden = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  };

  if (variant === 'text') {
    const lineHeight = height ?? theme.typography['body.md'].fontSize;
    return (
      <View testID={testID} {...hidden} style={{ gap: tokens.space['2'], width: width ?? '100%' }}>
        {Array.from({ length: lines }, (_, i) =>
          block(
            {
              height: lineHeight,
              borderRadius: tokens.radius.xs,
              width: i === lines - 1 && lines > 1 ? '60%' : '100%',
            },
            `line-${i}`,
          ),
        )}
      </View>
    );
  }

  if (variant === 'circle') {
    const d = height ?? 40;
    return (
      <View testID={testID} {...hidden}>
        {block({ width: d, height: d, borderRadius: tokens.radius.full })}
      </View>
    );
  }

  if (variant === 'card') {
    return (
      <View
        testID={testID}
        {...hidden}
        style={{
          gap: tokens.space['3'],
          padding: theme.density.cardPadding,
          borderRadius: tokens.radius.lg,
          backgroundColor: theme.color.surface.raised,
          width: width ?? '100%',
        }}
      >
        {/* hero, 16:9 */}
        {block({ height: height ?? 160, borderRadius: tokens.radius.md }, 'hero')}
        {/* the halal seal's slot, at full size, always */}
        {reserveSealSlot
          ? block({ ...SEAL_SLOT, borderRadius: tokens.radius.md }, 'seal')
          : null}
        {/* title */}
        {block(
          { height: theme.typography['heading.md'].fontSize, borderRadius: tokens.radius.xs },
          'title',
        )}
        {/* two metadata lines */}
        {block(
          {
            height: theme.typography['body.sm'].fontSize,
            width: '70%',
            borderRadius: tokens.radius.xs,
          },
          'meta-1',
        )}
        {block(
          {
            height: theme.typography['body.sm'].fontSize,
            width: '45%',
            borderRadius: tokens.radius.xs,
          },
          'meta-2',
        )}
      </View>
    );
  }

  return (
    <View testID={testID} {...hidden}>
      {block({
        width: width ?? '100%',
        height: height ?? tokens.space['16'],
        borderRadius: tokens.radius.sm,
      })}
    </View>
  );
}
