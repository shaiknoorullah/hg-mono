/**
 * `Checkbox` — independent booleans (multi-select add-ons, admin bulk selection).
 *
 * The control is 20 or 24, but **the whole row is the target**: padding the row is what
 * gets a 20px box to a 44pt hit area without drawing a 44px box. The focus ring goes on the
 * control, not on the row.
 *
 * Checked is `action.control` (brand) with a tick in `text.onBrand` — **not green**. A
 * filled green tick would be the second filled green in the system, and there is only one.
 */
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import { focusRing, tokens, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { StateOverlay, useGuardedPress, useInteraction } from './internal/interaction';

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  /** Mixed state for a parent of a partially-selected set. */
  indeterminate?: boolean;
  /** int64 cents. Add-on and variant rows show what choosing this costs. Never a float. */
  priceDeltaCents?: number;
  disabled?: boolean;
  /** Shown in `text.tertiary` next to a disabled row — "Out of stock", not silence. */
  disabledReason?: string;
  error?: boolean;
  size?: 20 | 24;
  testID?: string;
}

/** int64 cents -> `+$1.50`. Integer arithmetic only: no float ever touches a price (L-5). */
export function formatCentsDelta(cents: number): string {
  const sign = cents < 0 ? '-' : '+';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  priceDeltaCents,
  disabled = false,
  disabledReason,
  error = false,
  size = 20,
  testID = 'Checkbox',
}: CheckboxProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const bodyType = useTypeStyle('body.md');
  const captionType = useTypeStyle('caption');
  const { pressed, focused, inert, handlers, accessibilityState } = useInteraction({ disabled });
  const press = useGuardedPress(() => onChange(!checked), inert);

  const rowMinHeight = Math.round(theme.target.min * scale);
  const on = checked || indeterminate;

  const box: ViewStyle = {
    width: size,
    height: size,
    borderRadius: tokens.radius.xs,
    borderWidth: on ? 0 : 2,
    borderColor: error ? theme.color.feedback.danger.border : theme.color.border.interactive,
    backgroundColor: on ? theme.color.action.control : 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  };

  return (
    <Pressable
      testID={testID}
      onPress={press}
      onPressIn={handlers.onPressIn}
      onPressOut={handlers.onPressOut}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={
        [description, disabled ? disabledReason : undefined].filter(Boolean).join('. ') ||
        undefined
      }
      accessibilityState={{
        ...accessibilityState,
        checked: indeterminate ? 'mixed' : checked,
      }}
      style={{
        minHeight: rowMinHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space['3'],
        paddingVertical: tokens.space['2'],
        paddingHorizontal: tokens.space['2'],
        borderRadius: tokens.radius.sm,
        opacity: disabled ? theme.color.state.disabledOpacity : 1,
      }}
    >
      <StateOverlay
        color={theme.color.state.pressedOverlay}
        radius={tokens.radius.sm}
        visible={pressed}
      />
      <View>
        <View testID={`${testID}-box`} style={box}>
          {indeterminate ? (
            <View
              style={{
                width: size / 2,
                height: 2,
                backgroundColor: theme.color.text.onBrand,
              }}
            />
          ) : checked ? (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ color: theme.color.text.onBrand, fontSize: size - 6, lineHeight: size }}
            >
              {'✓'}
            </Text>
          ) : null}
        </View>
        {focused ? (
          <View
            pointerEvents="none"
            testID={`${testID}-focus-ring`}
            style={focusRing(theme, { radius: tokens.radius.xs })}
          />
        ) : null}
      </View>

      <View style={{ flexShrink: 1, gap: tokens.space['1'] }}>
        <Text style={{ ...bodyType, color: theme.color.text.primary }}>{label}</Text>
        {description ? (
          <Text style={{ ...captionType, color: theme.color.text.tertiary }}>{description}</Text>
        ) : null}
        {disabled && disabledReason ? (
          <Text
            testID={`${testID}-disabled-reason`}
            style={{ ...captionType, color: theme.color.text.secondary }}
          >
            {disabledReason}
          </Text>
        ) : null}
      </View>

      {priceDeltaCents !== undefined ? (
        <Text
          testID={`${testID}-price`}
          style={{
            ...bodyType,
            color: theme.color.text.secondary,
            marginStart: 'auto',
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatCentsDelta(priceDeltaCents)}
        </Text>
      ) : null}
    </Pressable>
  );
}
