/**
 * `Radio` / `RadioGroup` — exactly one from a set (single-select variants, refund reason
 * codes).
 *
 * A `RadioGroup` is one tab stop and carries the group label; required-group validation
 * announces on the *group*, not on the last option, because "this field is required" read
 * out after option six tells the user nothing about which field.
 *
 * Never use a `Select` for a binary and never a `Radio` for an independent boolean.
 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

import { focusRing, tokens, useFontScale, useTheme, useTypeStyle } from '../tokens';
import { StateOverlay, useGuardedPress, useInteraction } from './internal/interaction';
import { formatCentsDelta } from './Checkbox';

/** "$45.99" from int64 cents, for an option that carries its own price. */
function formatCentsAbsolute(cents: number): string {
  const abs = Math.abs(Math.trunc(cents));
  return `${cents < 0 ? '-' : ''}$${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

interface RadioGroupContextValue {
  name: string;
  value: string | null;
  onChange: (next: string) => void;
  disabled: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  name: string;
  label: string;
  value: string | null;
  onChange: (next: string) => void;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  /** Announced on the group, assertively — never on an individual option. */
  errorText?: string;
  children: ReactNode;
  testID?: string;
}

export function RadioGroup({
  name,
  label,
  value,
  onChange,
  orientation = 'vertical',
  required = false,
  disabled = false,
  errorText,
  children,
  testID = 'RadioGroup',
}: RadioGroupProps) {
  const theme = useTheme();
  const labelType = useTypeStyle('label.md');
  const captionType = useTypeStyle('caption');

  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{ gap: tokens.space['2'] }}
    >
      <Text style={{ ...labelType, color: theme.color.text.secondary }}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <View
        style={{
          flexDirection: orientation === 'horizontal' ? 'row' : 'column',
          gap: orientation === 'horizontal' ? tokens.space['3'] : 0,
          // Wrapping only applies across a row. A wrapping column shrinks each option to its
          // content on web, which strands an option's price mid-row instead of at the end.
          flexWrap: orientation === 'horizontal' ? 'wrap' : 'nowrap',
        }}
      >
        <RadioGroupContext.Provider value={{ name, value, onChange, disabled }}>
          {children}
        </RadioGroupContext.Provider>
      </View>
      {errorText ? (
        <Text
          testID={`${testID}-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ ...captionType, color: theme.color.feedback.danger.text }}
        >
          {'⚠ '}
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}

export interface RadioProps {
  value: string;
  label: string;
  description?: string;
  /** int64 cents. Never a float (L-5). */
  priceDeltaCents?: number;
  /**
   * An option's own price, not a difference — a variant that *replaces* the base price
   * (`pricing_mode: ABSOLUTE`) shows "$45.99", never "+$21.00". Joins the accessible name
   * ("For two, $45.99") so the price is not a separate node. int64 cents.
   */
  priceCents?: number;
  disabled?: boolean;
  disabledReason?: string;
  error?: boolean;
  size?: 20 | 24;
  /** Only when used outside a `RadioGroup`. */
  selected?: boolean;
  onChange?: (value: string) => void;
  testID?: string;
}

export function Radio({
  value,
  label,
  description,
  priceDeltaCents,
  priceCents,
  disabled: disabledProp = false,
  disabledReason,
  error = false,
  size = 20,
  selected: selectedProp,
  onChange,
  testID = 'Radio',
}: RadioProps) {
  const theme = useTheme();
  const scale = useFontScale();
  const group = useContext(RadioGroupContext);
  const bodyType = useTypeStyle('body.md');
  const captionType = useTypeStyle('caption');

  const selected = selectedProp ?? (group ? group.value === value : false);
  const disabled = disabledProp || Boolean(group?.disabled);
  const { pressed, focused, inert, handlers, accessibilityState } = useInteraction({ disabled });
  const press = useGuardedPress(() => {
    group?.onChange(value);
    onChange?.(value);
  }, inert);

  const dot: ViewStyle = {
    width: size,
    height: size,
    borderRadius: tokens.radius.full,
    borderWidth: 2,
    borderColor: error
      ? theme.color.feedback.danger.border
      : selected
        ? theme.color.action.control
        : theme.color.border.interactive,
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
      accessibilityRole="radio"
      accessibilityLabel={
        priceCents !== undefined ? `${label}, ${formatCentsAbsolute(priceCents)}` : label
      }
      accessibilityHint={
        [description, disabled ? disabledReason : undefined].filter(Boolean).join('. ') ||
        undefined
      }
      accessibilityState={{ ...accessibilityState, checked: selected, selected }}
      style={{
        minHeight: Math.round(theme.target.min * scale),
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
        <View testID={`${testID}-dot`} style={dot}>
          {selected ? (
            <View
              style={{
                width: size / 2,
                height: size / 2,
                borderRadius: tokens.radius.full,
                backgroundColor: theme.color.action.control,
              }}
            />
          ) : null}
        </View>
        {focused ? (
          <View
            pointerEvents="none"
            testID={`${testID}-focus-ring`}
            style={focusRing(theme, { radius: size / 2 })}
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
            // Secondary, not tertiary: the reason carries a decision ("Sold out"), and
            // tertiary misses 4.5:1 on the raised surface in dark mode.
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
      ) : priceCents !== undefined ? (
        <Text
          testID={`${testID}-price`}
          style={{
            ...bodyType,
            color: theme.color.text.primary,
            marginStart: 'auto',
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatCentsAbsolute(priceCents)}
        </Text>
      ) : null}
    </Pressable>
  );
}
