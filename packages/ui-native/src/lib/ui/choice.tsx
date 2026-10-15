/**
 * RNR `Checkbox` and `RadioGroup`, adapted (design-system N3) as rows.
 *
 * RNR draws the control with `@rn-primitives/checkbox` / `radio-group`. Here the WHOLE ROW is
 * the one press target (at least 44, 56 on the field register, 72 for the item sheet's roomy
 * variant rows), so the 20 or 24pt control never has to be the target itself, and there is a
 * single accessible element per option: no extra dependency, no nested focus stops.
 *
 * Selected is the `action.control` fill (brand) with an on-brand tick or dot, never green
 * (invariant 10). A disabled row stays focusable, says it is disabled and why
 * (`disabledReason`, in text.secondary: tertiary misses 4.5:1 on the raised surface in dark,
 * PR #634), and swallows presses. The price slot is a node: the `/ds` layer puts a `Price` there,
 * because only `Price` may render money.
 */
import * as React from 'react';
import { Pressable, View } from 'react-native';

import { cn } from '../utils';
import { Glyph } from './icon';
import { Text } from './text';

/** default 44 · field 56 · roomy 72 (the item sheet's variant rows, PR #644). */
export type ChoiceRowSize = 'default' | 'field' | 'roomy';

const ROW_MIN_H: Record<ChoiceRowSize, string> = {
  default: 'min-h-target-min py-2',
  field: 'min-h-target-field py-3',
  roomy: 'min-h-target-critical-field py-3',
};

/** Props shared by `CheckboxRow` and `RadioRow`. */
export interface ChoiceRowProps {
  label: string;
  description?: string;
  /** The full accessible name (label, plus a spoken price when there is one). */
  accessibilityLabel: string;
  checked: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Marks the control's border with the danger role (the error TEXT lives on the group or row). */
  invalid?: boolean;
  /** Control size in points: 20 (default) or 24. */
  size?: 20 | 24;
  rowSize?: ChoiceRowSize;
  /** The rider (field) register's one-step type bump. */
  field?: boolean;
  /** A trailing node, usually the option's `Price`. */
  trailing?: React.ReactNode;
  onPress: () => void;
  testID: string;
}

/** The label column: label, description, and the reason a disabled row cannot be chosen. */
function RowText({ label, description, disabled, disabledReason, field, testID }: Pick<ChoiceRowProps, 'label' | 'description' | 'disabled' | 'disabledReason' | 'field' | 'testID'>) {
  return (
    <View className="flex-1 gap-0.5">
      <Text variant={field ? 'body.lg' : 'body.md'} className={cn(disabled && 'opacity-60 dark:opacity-50')}>
        {label}
      </Text>
      {description ? (
        <Text variant={field ? 'body.md' : 'body.sm'} tone="secondary" className={cn(disabled && 'opacity-60 dark:opacity-50')}>
          {description}
        </Text>
      ) : null}
      {disabled && disabledReason ? (
        <Text testID={`${testID}-disabled-reason`} variant={field ? 'body.sm' : 'caption'} tone="secondary">
          {disabledReason}
        </Text>
      ) : null}
    </View>
  );
}

function useFocus() {
  const [focused, setFocused] = React.useState(false);
  return { focused, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}

/** Row classes: the target height, the pressed overlay (dropped when inert), the layout. */
function rowClasses(rowSize: ChoiceRowSize, inert: boolean): string {
  return cn('flex-row items-center gap-3 rounded-sm px-1', ROW_MIN_H[rowSize], !inert && 'active:bg-state-pressed-overlay');
}

/** Props of `CheckboxRow`. */
export interface CheckboxRowProps extends ChoiceRowProps {
  /** Announced as "mixed"; drawn as a bar. */
  indeterminate?: boolean;
}

/** One checkbox row. */
export function CheckboxRow(props: CheckboxRowProps): React.ReactElement {
  const { checked, indeterminate = false, disabled = false, invalid = false, size = 20, rowSize = 'default', trailing, onPress, testID } = props;
  const { focused, onFocus, onBlur } = useFocus();
  const on = checked || indeterminate;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={[props.description, disabled ? props.disabledReason : undefined].filter(Boolean).join('. ') || undefined}
      accessibilityState={{ checked: indeterminate ? 'mixed' : checked, disabled }}
      onPress={() => {
        if (!disabled) onPress();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      className={rowClasses(rowSize, disabled)}
    >
      <View
        testID={`${testID}-box`}
        style={{ width: size, height: size }}
        className={cn(
          'items-center justify-center rounded-xs',
          on ? 'bg-action-control' : 'border-2 bg-card',
          !on && (invalid ? 'border-feedback-danger-border' : focused ? 'border-focus-ring' : 'border-input'),
          on && focused && 'border-2 border-focus-ring',
          disabled && 'opacity-60 dark:opacity-50',
        )}
      >
        {indeterminate ? (
          <View className="h-0.5 w-2.5 rounded-full bg-primary-foreground" />
        ) : checked ? (
          <Tick size={size} />
        ) : null}
      </View>
      <RowText {...props} />
      {trailing ? <View className={cn('ml-auto', disabled && 'opacity-60 dark:opacity-50')}>{trailing}</View> : null}
    </Pressable>
  );
}

/** The tick: two on-brand strokes drawn from `View`s (the Solar check is a ringed glyph). */
function Tick({ size }: { size: number }) {
  const s = size / 20;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 11 * s, height: 6 * s, borderLeftWidth: 2, borderBottomWidth: 2, transform: [{ rotate: '-45deg' }, { translateY: -1 }] }}
      className="border-primary-foreground"
    />
  );
}

/** Props of `RadioRow`. */
export type RadioRowProps = ChoiceRowProps;

/** One radio row: a ring, filled with the control role's dot when selected. */
export function RadioRow(props: RadioRowProps): React.ReactElement {
  const { checked, disabled = false, invalid = false, size = 20, rowSize = 'default', trailing, onPress, testID } = props;
  const { focused, onFocus, onBlur } = useFocus();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={[props.description, disabled ? props.disabledReason : undefined].filter(Boolean).join('. ') || undefined}
      accessibilityState={{ checked, selected: checked, disabled }}
      onPress={() => {
        if (!disabled) onPress();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      className={rowClasses(rowSize, disabled)}
    >
      <View
        testID={`${testID}-ring`}
        style={{ width: size, height: size }}
        className={cn(
          'items-center justify-center rounded-full border-2 bg-card',
          invalid ? 'border-feedback-danger-border' : focused ? 'border-focus-ring' : checked ? 'border-action-control' : 'border-input',
          disabled && 'opacity-60 dark:opacity-50',
        )}
      >
        {checked ? <View style={{ width: size / 2, height: size / 2 }} className="rounded-full bg-action-control" /> : null}
      </View>
      <RowText {...props} />
      {trailing ? <View className={cn('ml-auto', disabled && 'opacity-60 dark:opacity-50')}>{trailing}</View> : null}
    </Pressable>
  );
}

/** Props of `ChoiceGroup`. */
export interface ChoiceGroupProps {
  /** The visible legend; also the group's accessible name. */
  legend: string;
  hideLegend?: boolean;
  /** `radiogroup` for RadioGroup; `group` for CheckboxGroup. */
  role: 'radiogroup' | 'group';
  required?: boolean;
  /** A line under the legend ("Choose up to 2"). */
  hint?: string;
  /** The group's error: ONE alert, on the group, never repeated per option. */
  error?: string | null;
  disabled?: boolean;
  horizontal?: boolean;
  field?: boolean;
  children: React.ReactNode;
  testID: string;
}

/** The fieldset: legend, options, and the single group-level error. */
export function ChoiceGroup({ legend, hideLegend, role, required, hint, error, disabled, horizontal, field, children, testID }: ChoiceGroupProps): React.ReactElement {
  const name = required ? `${legend}, required` : legend;
  return (
    <View
      testID={testID}
      role={role}
      accessibilityLabel={name}
      accessibilityHint={[hint, error].filter(Boolean).join('. ') || undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
      className="gap-1"
    >
      {hideLegend ? null : (
        <Text testID={`${testID}-legend`} variant={field ? 'heading.sm' : 'label.lg'}>
          {legend}
          {required ? ' *' : ''}
        </Text>
      )}
      {hint ? (
        <Text testID={`${testID}-hint`} variant={field ? 'body.md' : 'body.sm'} tone="secondary">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <View
          testID={`${testID}-error`}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={error}
          className="flex-row items-start gap-1"
        >
          <Glyph name="error" size={field ? 18 : 16} className="text-feedback-danger-text" />
          <Text variant={field ? 'body.sm' : 'caption'} className="shrink text-feedback-danger-text">
            {error}
          </Text>
        </View>
      ) : null}
      <View className={horizontal ? 'flex-row flex-wrap gap-3' : 'flex-col'}>{children}</View>
    </View>
  );
}
