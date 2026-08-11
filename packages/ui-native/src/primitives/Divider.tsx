/**
 * `Divider` — a rule in `border.decorative`.
 *
 * Decorative dividers measure 1.28:1 against the page and that is a documented exemption:
 * they carry no information and never delimit an interactive control. Anything that bounds
 * a control uses `border.interactive` instead.
 *
 * Hidden from the accessibility tree unless it carries a `label`, in which case it becomes
 * a named separator.
 */
import { View, Text, type ViewStyle } from 'react-native';

import { tokens, useTheme, useTypeStyle } from '../tokens';

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  /** Indent from the leading edge — `true` uses the default gutter. Logical, never `left`. */
  inset?: boolean | number;
  /** Turns the rule into a labelled separator ("or", "Today"). */
  label?: string;
  testID?: string;
}

export function Divider({
  orientation = 'horizontal',
  inset = false,
  label,
  testID = 'Divider',
}: DividerProps) {
  const theme = useTheme();
  const labelStyle = useTypeStyle('caption');
  const insetValue = inset === true ? theme.density.gutter : inset === false ? 0 : inset;
  const line: ViewStyle =
    orientation === 'horizontal'
      ? { height: 1, flexGrow: 1, flexShrink: 1, backgroundColor: theme.color.border.decorative }
      : { width: 1, alignSelf: 'stretch', backgroundColor: theme.color.border.decorative };

  if (!label) {
    return (
      <View
        testID={testID}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={
          orientation === 'horizontal'
            ? { ...line, marginStart: insetValue, marginEnd: insetValue }
            : { ...line, marginTop: insetValue, marginBottom: insetValue }
        }
      />
    );
  }

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: tokens.space['3'],
        marginStart: insetValue,
        marginEnd: insetValue,
      }}
    >
      <View style={line} />
      <Text style={{ ...labelStyle, color: theme.color.text.tertiary }}>{label}</Text>
      <View style={line} />
    </View>
  );
}
