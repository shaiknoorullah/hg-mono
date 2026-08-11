/**
 * `IconButton` — a control whose only content is an icon.
 *
 * `accessibilityLabel` is a **required prop and the type system enforces it**: an icon-only
 * control with no name is a control no screen-reader user can use, and "we'll add it later"
 * has never once happened. The icon itself is always hidden from the accessibility tree —
 * the button carries the name.
 *
 * The hit area is never smaller than the size token even when the glyph is 20px.
 *
 * Icons are Lucide, injected by the app as nodes (`lucide-react-native`); this library does
 * not depend on an icon set. A string is accepted as a name and rendered as a placeholder
 * glyph so a call site can be written before the icon package is wired up.
 */
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { focusRing, tokens, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { StateOverlay, hitSlopFor, useGuardedPress, useInteraction } from './internal/interaction';
import { Spinner } from './Spinner';

export type IconButtonVariant = 'plain' | 'filled' | 'tonal';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<IconButtonSize, number> = { sm: 36, md: 44, lg: 56 };

/** Placeholder glyphs for name-only icons. Replaced by real nodes at the call site. */
const GLYPHS: Record<string, string> = {
  plus: '+',
  minus: '−',
  heart: '♥',
  close: '✕',
  search: '⌕',
  check: '✓',
  chevron: '›',
  back: '‹',
  more: '⋯',
};

export interface IconButtonProps {
  icon: ReactNode;
  /** Required. No default, ever. */
  accessibilityLabel: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  /**
   * A dot, or a count. The count belongs **inside** the button's accessible name
   * ("Cart, 3 items"), never as a separate node a screen reader meets on its own.
   */
  badge?: { count?: number; max?: number } | true;
  accessibilityHint?: string;
  testID?: string;
}

export function IconButton({
  icon,
  accessibilityLabel,
  variant = 'plain',
  size = 'md',
  onPress,
  loading = false,
  disabled = false,
  badge,
  accessibilityHint,
  testID = 'IconButton',
}: IconButtonProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const labelType = useTypeStyle('label.md');
  const badgeType = useTypeStyle('label.sm');
  const { pressed, focused, inert, handlers, accessibilityState } = useInteraction({
    disabled,
    loading,
  });
  const press = useGuardedPress(onPress, inert);

  const dimension = Math.round(SIZES[size] * scale);
  const radius = tokens.radius.full;

  const fills: Record<IconButtonVariant, { background: string; tint: string }> = {
    plain: { background: 'transparent', tint: theme.color.text.primary },
    filled: { background: theme.color.action.secondary, tint: theme.color.text.onAccent },
    tonal: { background: theme.color.surface.subtle, tint: theme.color.text.primary },
  };
  const fill = fills[variant];

  const count = badge && badge !== true ? badge.count : undefined;
  const max = (badge && badge !== true ? badge.max : undefined) ?? 99;
  const countLabel = count === undefined ? null : count > max ? `${max}+` : String(count);

  const container: ViewStyle = {
    width: dimension,
    height: dimension,
    borderRadius: radius,
    backgroundColor: fill.background,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? theme.color.state.disabledOpacity : 1,
  };

  return (
    <Pressable
      testID={testID}
      onPress={press}
      onPressIn={handlers.onPressIn}
      onPressOut={handlers.onPressOut}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      accessibilityRole="button"
      // The count is part of the name, not a sibling node.
      accessibilityLabel={
        countLabel ? `${accessibilityLabel}, ${countLabel}` : accessibilityLabel
      }
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      hitSlop={hitSlopFor(dimension, theme.target.min)}
      style={container}
    >
      <StateOverlay color={theme.color.state.pressedOverlay} radius={radius} visible={pressed} />
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ alignItems: 'center', justifyContent: 'center' }}
      >
        {loading ? (
          <Spinner size="sm" color={fill.tint} testID={`${testID}-spinner`} />
        ) : typeof icon === 'string' ? (
          <Text style={{ ...labelType, color: fill.tint }}>{GLYPHS[icon] ?? '□'}</Text>
        ) : (
          icon
        )}
      </View>

      {badge ? (
        <View
          testID={`${testID}-badge`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: 'absolute',
            top: tokens.space['1'],
            end: tokens.space['1'],
            minWidth: countLabel ? 16 : 8,
            height: countLabel ? 16 : 8,
            paddingHorizontal: countLabel ? tokens.space['1'] : 0,
            borderRadius: tokens.radius.full,
            backgroundColor: theme.color.action.danger,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {countLabel ? (
            <Text style={{ ...badgeType, color: theme.color.text.onAccent }}>{countLabel}</Text>
          ) : null}
        </View>
      ) : null}

      {focused ? (
        <View
          pointerEvents="none"
          testID={`${testID}-focus-ring`}
          style={focusRing(theme, { radius, onColor: variant === 'filled' })}
        />
      ) : null}
    </Pressable>
  );
}
