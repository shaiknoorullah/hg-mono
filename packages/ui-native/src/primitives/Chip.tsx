/**
 * `Chip` / `FilterChip`.
 *
 * `static` is an attribute (cuisine, allergen, dietary note); `filter` toggles; `choice` is
 * single-select within a row; `input` is removable.
 *
 * The veg / non-veg marker is a chip with an **outline**, never a fill: `success` outline
 * for veg, `danger` outline for non-veg (RULE H-1 again — a filled green veg pill would
 * compete with the seal). Allergen chips use the `warning` tone and are warnings, not
 * filters: there is no allergen filter in scope.
 *
 * Selected state is border + tint + a check glyph — never fill alone, so it survives
 * greyscale and colour-blindness.
 */
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

import { focusRing, tokens, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { StateOverlay, hitSlopFor, useGuardedPress, useInteraction } from './internal/interaction';

export type ChipVariant = 'static' | 'filter' | 'choice' | 'input';
export type ChipSize = 'sm' | 'md';
export type ChipTone = 'neutral' | 'warning' | 'veg' | 'nonveg';

const HEIGHTS: Record<ChipSize, number> = { sm: 26, md: 32 };

export interface ChipProps {
  label: string;
  variant?: ChipVariant;
  size?: ChipSize;
  tone?: ChipTone;
  icon?: ReactNode;
  selected?: boolean;
  onPress?: () => void;
  /** `input` only. Renders its own dismiss target, sized to the floor. */
  onRemove?: () => void;
  count?: number;
  disabled?: boolean;
  testID?: string;
}

export function Chip({
  label,
  variant = 'static',
  size = 'md',
  tone = 'neutral',
  icon,
  selected = false,
  onPress,
  onRemove,
  count,
  disabled = false,
  testID = 'Chip',
}: ChipProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const labelType = useTypeStyle(size === 'sm' ? 'label.md' : 'label.lg');
  const { pressed, focused, inert, handlers, accessibilityState } = useInteraction({ disabled });
  const press = useGuardedPress(onPress, inert);

  const interactive = variant === 'filter' || variant === 'choice' || Boolean(onPress);
  const height = Math.round(HEIGHTS[size] * scale);
  const radius = tokens.radius.full;

  const tones: Record<ChipTone, { border: string; text: string }> = {
    neutral: { border: theme.color.border.interactive, text: theme.color.text.primary },
    warning: { border: theme.color.feedback.warning.border, text: theme.color.feedback.warning.text },
    veg: { border: theme.color.feedback.success.border, text: theme.color.feedback.success.text },
    nonveg: { border: theme.color.feedback.danger.border, text: theme.color.feedback.danger.text },
  };
  const palette = tones[tone];

  const container: ViewStyle = {
    minHeight: height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['1'],
    paddingHorizontal: tokens.space['3'],
    borderRadius: radius,
    borderWidth: selected ? 2 : 1,
    borderColor: selected ? theme.color.border.brand : palette.border,
    // Tint, never a solid — the selected chip is a state, not an action.
    backgroundColor: selected ? theme.color.state.selectedTint : 'transparent',
    alignSelf: 'flex-start',
    opacity: disabled ? theme.color.state.disabledOpacity : 1,
  };

  const content = (
    <>
      {icon}
      {selected ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ ...labelType, color: palette.text }}
        >
          {'✓'}
        </Text>
      ) : null}
      <Text style={{ ...labelType, color: palette.text }}>{label}</Text>
      {count !== undefined ? (
        <Text style={{ ...labelType, color: theme.color.text.tertiary }}>{count}</Text>
      ) : null}
      {variant === 'input' && onRemove ? (
        <Pressable
          testID={`${testID}-remove`}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          hitSlop={hitSlopFor(height, theme.target.min)}
        >
          <Text style={{ ...labelType, color: theme.color.text.tertiary }}>{'✕'}</Text>
        </Pressable>
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <View testID={testID} accessible accessibilityLabel={label} style={container}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={press}
      onPressIn={handlers.onPressIn}
      onPressOut={handlers.onPressOut}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      accessibilityRole="button"
      accessibilityLabel={label}
      // `selected` is how RN surfaces aria-pressed / aria-selected to both platforms.
      accessibilityState={{ ...accessibilityState, selected }}
      hitSlop={hitSlopFor(height, theme.target.min)}
      style={container}
    >
      <StateOverlay color={theme.color.state.pressedOverlay} radius={radius} visible={pressed} />
      {content}
      {focused ? (
        <View
          pointerEvents="none"
          testID={`${testID}-focus-ring`}
          style={focusRing(theme, { radius })}
        />
      ) : null}
    </Pressable>
  );
}

/** The toggleable filter of C-11, spelled out so call sites read as what they are. */
export function FilterChip(props: Omit<ChipProps, 'variant'>) {
  return <Chip {...props} variant="filter" testID={props.testID ?? 'FilterChip'} />;
}
