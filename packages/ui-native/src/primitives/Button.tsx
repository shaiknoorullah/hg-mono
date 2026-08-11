/**
 * `Button` — the single affordance for an action.
 *
 * **There is no `success` variant.** RULE H-1 reserves solid green to the halal namespace;
 * a "confirm" action is `primary`. This is not a styling preference — no two accessible
 * greens are 3:1 apart, so the halal seal is separated from semantic success by *form*, and
 * the form is "only the seal is a filled green".
 *
 * If it navigates it announces as a link, not a button.
 */
import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import type { ReactNode } from 'react';

import { focusRing, tokens, useFontScale, useTheme, useTypeStyle, type TypeName } from '../tokens';
import { StateOverlay, hitSlopFor, useGuardedPress, useInteraction } from './internal/interaction';
import { Spinner } from './Spinner';

/** `success` is absent on purpose — see the file header. */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<ButtonSize, { height: number; type: TypeName; paddingX: number }> = {
  sm: { height: 36, type: 'label.md', paddingX: tokens.space['3'] },
  md: { height: 44, type: 'label.lg', paddingX: tokens.space['4'] },
  lg: { height: 52, type: 'label.lg', paddingX: tokens.space['5'] },
  /** rider primary actions only */
  xl: { height: 60, type: 'heading.sm', paddingX: tokens.space['6'] },
};

export interface ButtonProps {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  /**
   * Marks the action irreversible. Renders as `danger` and, per components §1, obliges the
   * caller to put the verb in the label ("Cancel order", never "Confirm") — colour carries
   * no meaning on its own.
   */
  destructive?: boolean;
  /**
   * An irreversible action taken under a deadline (rider Accept/Decline, restaurant
   * Accept-order) must clear `target.criticalField` (72) and sit ≥24 from its opposite.
   */
  critical?: boolean;
  onPress?: () => void;
  /** Link mode: announces as a link and opens the URL when no `onPress` is supplied. */
  href?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  children,
  variant: variantProp,
  size = 'md',
  fullWidth = false,
  iconStart,
  iconEnd,
  loading = false,
  disabled = false,
  destructive = false,
  critical = false,
  onPress,
  href,
  accessibilityLabel,
  accessibilityHint,
  testID = 'Button',
}: ButtonProps) {
  const theme = useTheme();
  const variant: ButtonVariant = variantProp ?? (destructive ? 'danger' : 'primary');
  const spec = SIZES[size];
  const labelStyle = useTypeStyle(spec.type);
  const scale = useFontScale();
  const { pressed, focused, inert, handlers, accessibilityState } = useInteraction({
    disabled,
    loading,
  });
  const press = useRef(new Animated.Value(0)).current;
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null);

  const fills: Record<ButtonVariant, { background: string; label: string; border?: string }> = {
    primary: { background: theme.color.action.primary, label: theme.color.text.onBrand },
    secondary: { background: theme.color.action.secondary, label: theme.color.text.onAccent },
    tertiary: {
      background: 'transparent',
      label: theme.color.text.primary,
      border: theme.color.border.interactive,
    },
    ghost: { background: 'transparent', label: theme.color.text.primary },
    danger: {
      background: theme.color.action.danger,
      label: theme.color.feedback.danger.onSolid ?? theme.color.text.onAccent,
    },
  };
  const fill = fills[variant];
  /** `info.500` measures below 3:1 on brand, danger and accent fills, so the ring flips. */
  const ringOnColor = variant === 'primary' || variant === 'secondary' || variant === 'danger';

  const minHeight = Math.round((critical ? theme.target.critical : spec.height) * scale);
  const radius = tokens.radius.md;

  // The label stays visible while loading, so the box must not resize when the spinner
  // takes the icon slot: freeze the measured width for the duration.
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!loading) setFrozenWidth(e.nativeEvent.layout.width);
    },
    [loading],
  );

  const handlePress = useGuardedPress(
    onPress ?? (href ? () => void Linking.openURL(href) : undefined),
    inert,
  );

  const container: ViewStyle = {
    minHeight,
    minWidth: loading && frozenWidth !== null ? frozenWidth : undefined,
    paddingHorizontal: spec.paddingX,
    borderRadius: radius,
    backgroundColor: fill.background,
    borderWidth: fill.border ? 1 : 0,
    borderColor: fill.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: tokens.space['2'],
    alignSelf: fullWidth ? 'stretch' : 'flex-start',
    opacity: disabled ? theme.color.state.disabledOpacity : 1,
  };

  return (
    <Animated.View
      style={{
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
        transform: [
          {
            scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.98] }),
          },
        ],
      }}
    >
      <Pressable
        testID={testID}
        onLayout={onLayout}
        onPress={handlePress}
        onPressIn={() => {
          handlers.onPressIn();
          Animated.timing(press, {
            toValue: 1,
            duration: Number.parseInt(tokens.motion.duration.instant, 10),
            useNativeDriver: true,
          }).start();
        }}
        onPressOut={() => {
          handlers.onPressOut();
          Animated.timing(press, {
            toValue: 0,
            duration: Number.parseInt(tokens.motion.duration.instant, 10),
            useNativeDriver: true,
          }).start();
        }}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
        // Never RN's `disabled`: that drops the control out of the accessibility tree, and
        // a disabled button that cannot explain itself is worse than no button.
        accessibilityRole={href ? 'link' : 'button'}
        accessibilityLabel={accessibilityLabel ?? children}
        accessibilityHint={accessibilityHint}
        accessibilityState={accessibilityState}
        hitSlop={hitSlopFor(minHeight, theme.target.min)}
        style={container}
      >
        <StateOverlay
          color={theme.color.state.pressedOverlay}
          radius={radius}
          visible={pressed}
        />
        {loading ? (
          <Spinner size={size === 'sm' ? 'sm' : 'md'} color={fill.label} testID={`${testID}-spinner`} />
        ) : (
          iconStart
        )}
        <Text
          testID={`${testID}-label`}
          numberOfLines={2}
          style={{ ...labelStyle, color: fill.label, textAlign: 'center' }}
        >
          {children}
        </Text>
        {iconEnd}
        {focused ? (
          <View
            pointerEvents="none"
            testID={`${testID}-focus-ring`}
            style={focusRing(theme, { onColor: ringOnColor, radius })}
          />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
