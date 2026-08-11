/**
 * `QuantityStepper` — the cart's line-quantity control.
 *
 * The important decision here is that `loading` **freezes the value** rather than moving it
 * optimistically. Cart mutations are server-authoritative; a stepper that jumps to 3 and
 * snaps back to 2 tells the customer their basket is lying to them, and a 200 ms wait is a
 * far smaller cost than that. Both buttons block while a mutation is in flight.
 *
 * The `−`/`+` disable *individually* at their bounds, each carrying its own reason, because
 * a control that refuses to act and will not say why is a defect.
 */
import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import {
  radius,
  tabularNumbers,
  typeStyle,
  useTheme,
} from '../certification/internal/theme';
import type { TypeName } from '../certification/internal/theme';
import { Spinner } from '../primitives';
import { MinusGlyph, PlusGlyph, TrashGlyph } from './internal/glyphs';

export type QuantityStepperSize = 'sm' | 'md' | 'lg';

export interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  size?: QuantityStepperSize;
  loading?: boolean;
  disabled?: boolean;
  /** At `value === min + 1` the `−` becomes a trash glyph and announces "Remove {item}". */
  removeAtZero?: boolean;
  /** Names the group and the remove action: "Quantity for Chicken shawarma". */
  itemName?: string;
  /** Explains a hard `max`, e.g. "Only 4 left today". Read out with the disabled `+`. */
  maxReason?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT: Readonly<Record<QuantityStepperSize, number>> = { sm: 32, md: 40, lg: 48 };
const VALUE_TYPE: Readonly<Record<QuantityStepperSize, TypeName>> = {
  sm: 'label.md',
  md: 'label.lg',
  lg: 'heading.sm',
};

export function QuantityStepper({
  value,
  min = 0,
  max,
  onChange,
  size = 'md',
  loading = false,
  disabled = false,
  removeAtZero = false,
  itemName,
  maxReason,
  style,
  testID = 'QuantityStepper',
}: QuantityStepperProps): React.ReactElement {
  const theme = useTheme();
  const height = HEIGHT[size];
  const glyph = size === 'sm' ? 14 : 18;

  const atMin = value <= min;
  const atMax = typeof max === 'number' && value >= max;
  const willRemove = removeAtZero && value === min + 1;

  // `loading` is not `disabled`: the control keeps its accessible name, announces busy, and
  // blocks re-entry by ignoring the event rather than going grey and losing its label.
  const blocked = loading || disabled;

  const decrementLabel = willRemove
    ? itemName
      ? `Remove ${itemName}`
      : 'Remove item'
    : 'Decrease quantity';

  return (
    <View
      testID={testID}
      role="group"
      accessibilityLabel={itemName ? `Quantity for ${itemName}` : 'Quantity'}
      style={[
        styles.root,
        {
          height,
          borderRadius: radius.sm,
          borderColor: theme.color.border.interactive,
          backgroundColor: theme.color.surface.base,
          opacity: disabled ? theme.color.state.disabledOpacity : 1,
        },
        style,
      ]}
    >
      <StepperButton
        testID={`${testID}-decrement`}
        label={decrementLabel}
        disabled={blocked || (atMin && !removeAtZero)}
        busy={loading}
        height={height}
        onPress={() => {
          if (blocked) return;
          if (atMin && !removeAtZero) return;
          onChange(value - 1);
        }}
      >
        {willRemove ? (
          <TrashGlyph size={glyph} color={theme.color.text.primary} />
        ) : (
          <MinusGlyph size={glyph} color={theme.color.text.primary} />
        )}
      </StepperButton>

      <View style={[styles.value, { minWidth: height }]}>
        {loading ? (
          <Spinner testID={`${testID}-busy`} size="sm" label="Updating quantity" />
        ) : (
          <Text
            testID={`${testID}-value`}
            // Polite, not assertive: the number changing is confirmation, not an alert.
            accessibilityLiveRegion="polite"
            aria-live="polite"
            style={[
              typeStyle(theme, VALUE_TYPE[size]),
              tabularNumbers,
              { color: theme.color.text.primary },
            ]}
          >
            {value}
          </Text>
        )}
      </View>

      <StepperButton
        testID={`${testID}-increment`}
        label="Increase quantity"
        hint={atMax ? maxReason : undefined}
        disabled={blocked || atMax}
        busy={loading}
        height={height}
        onPress={() => {
          if (blocked || atMax) return;
          onChange(value + 1);
        }}
      >
        <PlusGlyph size={glyph} color={theme.color.text.primary} />
      </StepperButton>
    </View>
  );
}

function StepperButton({
  testID,
  label,
  hint,
  disabled,
  busy,
  height,
  onPress,
  children,
}: {
  testID: string;
  label: string;
  hint?: string;
  disabled: boolean;
  busy: boolean;
  height: number;
  onPress: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  const theme = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      // `aria-disabled`, not `disabled`: a disabled button is not focusable and cannot
      // explain itself, and the reason is exactly what a user at a bound needs.
      accessibilityState={{ disabled, busy }}
      aria-disabled={disabled}
      // Each button keeps a ≥44 hit area even at the 32 size.
      hitSlop={Math.max(0, Math.ceil((theme.target.min - height) / 2))}
      style={({ pressed }) => [
        styles.button,
        { width: height, height, opacity: disabled ? theme.color.state.disabledOpacity : 1 },
        pressed && !disabled ? { backgroundColor: theme.color.state.pressedOverlay } : null,
        focused ? { borderWidth: 3, borderColor: theme.color.focus.ring } : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    overflow: 'hidden',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
