import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { Cents } from '@hg/api-client';

import { Price } from '../ds/Content';
import { isoOfParts, nameWithPrice, partsOfIso, type DateParts } from '../ds/formLogic';
import { type DsCommon, isFieldTheme, resolveTestId } from '../ds/shared';
import { CheckboxRow, ChoiceGroup, ErrorSummaryBox, FieldLabel, FieldMessage, Stepper, TextField } from '../lib';
import { useTheme } from '../tokens';

/*
 * The proposed form parts (design-system N3; plan §2.2, issue #193), on the React Native
 * Reusables tier: Field (helper and error), ErrorSummary, Textarea, CheckboxGroup, DateInput and
 * QuantityStepper. Not in the live index.d.ts yet: redesigned screens only, behind the flag.
 * This file keeps React's own JSX runtime and maps props; every `className` is inside `lib/`.
 */

/* ───── Field ───── */

/** Props of `Field`: the label and the helper or error line around a custom control. */
export interface FieldProps extends DsCommon {
  label: string;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  /** `false` when an ErrorSummary already announced the form's errors. */
  announceError?: boolean;
  children: React.ReactNode;
}

/**
 * The field wrapper for a control the design system does not draw itself (a map pin, an upload
 * row): visible label above, helper or error below, the error an alert with its glyph. Input,
 * Textarea, Select and DateInput already include it.
 */
export function Field(props: FieldProps) {
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'Field');
  return (
    <View testID={testID} style={[{ gap: 4 }, props.style]}>
      <FieldLabel required={props.required} field={field} testID={`${testID}-label`}>
        {props.label}
      </FieldLabel>
      {props.children}
      <FieldMessage error={props.errorText} helper={props.helperText} field={field} announce={props.announceError} testID={testID} />
    </View>
  );
}

/* ───── ErrorSummary ───── */

/** One problem in an `ErrorSummary`. */
export interface ErrorSummaryError {
  /** What is wrong, in the field's words ("Enter your date of birth"). */
  message: string;
  /** Takes the person to the field (focus its input, scroll to it). */
  onPress?: () => void;
}

/** Props of `ErrorSummary`. */
export interface ErrorSummaryProps extends DsCommon {
  /** Default "There is a problem". */
  title?: string;
  errors: readonly ErrorSummaryError[];
}

/**
 * The form-level summary after a failed submit (rider `Profile-Required`): one assertive alert
 * with the count, then a row per problem (44, 56 on rider) that goes to the field. Render it at
 * the top of the form and pass `announceError={false}` to the fields, so one submit is one
 * announcement. Renders nothing when there are no errors.
 */
export function ErrorSummary(props: ErrorSummaryProps) {
  const theme = useTheme();
  if (props.errors.length === 0) return null;
  const box = (
    <ErrorSummaryBox
      title={props.title ?? 'There is a problem'}
      items={props.errors}
      field={isFieldTheme(theme)}
      testID={resolveTestId(props, 'ErrorSummary')}
    />
  );
  return props.style ? <View style={props.style}>{box}</View> : box;
}

/* ───── Textarea ───── */

/** Props of `Textarea`. */
export interface TextareaProps extends DsCommon {
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** The limit; with it the counter shows unless `characterCount` is false. */
  maxLength?: number;
  characterCount?: boolean;
  /** Visible lines before it grows (default 3). */
  minRows?: number;
  announceError?: boolean;
}

/** Several lines of text with a counter (geofence override reason, rider statement: 500). */
export function Textarea(props: TextareaProps) {
  const theme = useTheme();
  const [own, setOwn] = React.useState(props.defaultValue ?? '');
  const value = props.value ?? own;
  const node = (
    <TextField
      testID={resolveTestId(props, 'Textarea')}
      label={props.label}
      value={value}
      onChangeText={(next) => {
        if (props.value === undefined) setOwn(next);
        props.onValueChange?.(next);
        props.onChange?.(next);
      }}
      multiline
      minRows={props.minRows}
      field={isFieldTheme(theme)}
      placeholder={props.placeholder}
      helper={props.helperText}
      error={props.errorText}
      announceError={props.announceError}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      maxLength={props.maxLength}
      counter={props.characterCount ?? props.maxLength !== undefined}
    />
  );
  return props.style ? <View style={props.style}>{node}</View> : node;
}

/* ───── CheckboxGroup ───── */

/** One option of a `CheckboxGroup`. */
export interface CheckboxGroupOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Add-on rows: through Price with sign always. Integer cents. */
  priceDeltaCents?: number;
}

/** Props of `CheckboxGroup`. */
export interface CheckboxGroupProps extends DsCommon {
  /** The visible legend; names the group. */
  label: string;
  hideLabel?: boolean;
  options: readonly CheckboxGroupOption[];
  /** The chosen values. */
  value: readonly string[];
  onValueChange?: (value: string[]) => void;
  onChange?: (value: string[]) => void;
  /** At least this many (said in the hint; validation and its error are the screen's). */
  min?: number;
  /** At most this many: the rest are disabled with `maxReason` while the group is full. */
  max?: number;
  /** Why an unchosen option is disabled at the maximum. Default "You can choose up to {max}". */
  maxReason?: string;
  required?: boolean;
  disabled?: boolean;
  /** Announced ONCE, on the group. */
  error?: string | null;
}

function choiceHint(min?: number, max?: number): string | undefined {
  if (min && max) return min === max ? `Choose ${max}` : `Choose ${min} to ${max}`;
  if (max) return `Choose up to ${max}`;
  if (min) return `Choose at least ${min}`;
  return undefined;
}

/**
 * Several from a set, with a group error and an optional maximum (the item sheet's add-ons,
 * PR #644; restaurant cuisines 1 to 5). Rows are 44, 56 on rider.
 */
export function CheckboxGroup(props: CheckboxGroupProps) {
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'CheckboxGroup');
  const chosen = new Set(props.value);
  const full = props.max !== undefined && chosen.size >= props.max;
  const reason = props.maxReason ?? `You can choose up to ${props.max}`;
  const node = (
    <ChoiceGroup
      testID={testID}
      legend={props.label}
      hideLegend={props.hideLabel}
      role="group"
      required={props.required}
      hint={choiceHint(props.min, props.max)}
      error={props.error}
      disabled={props.disabled}
      field={field}
    >
      {props.options.map((o) => {
        const on = chosen.has(o.value);
        const overMax = full && !on;
        const disabled = Boolean(props.disabled || o.disabled || overMax);
        const optionID = `${testID}-${o.value}`;
        return (
          <CheckboxRow
            key={o.value}
            testID={optionID}
            label={o.label}
            description={o.description}
            accessibilityLabel={nameWithPrice(o.label, o.priceDeltaCents)}
            checked={on}
            disabled={disabled}
            disabledReason={o.disabled ? o.disabledReason : overMax ? reason : undefined}
            invalid={Boolean(props.error)}
            rowSize={field ? 'field' : 'default'}
            field={field}
            trailing={
              o.priceDeltaCents !== undefined ? (
                <Price cents={o.priceDeltaCents as Cents} sign="always" size="sm" testID={`${optionID}-price`} />
              ) : undefined
            }
            onPress={() => {
              const next = on ? props.value.filter((v) => v !== o.value) : [...props.value, o.value];
              props.onValueChange?.(next);
              props.onChange?.(next);
            }}
          />
        );
      })}
    </ChoiceGroup>
  );
  return props.style ? <View style={props.style}>{node}</View> : node;
}

/* ───── DateInput ───── */

/** Props of `DateInput`. */
export interface DateInputProps extends DsCommon {
  /** The legend ("Date of birth"). */
  label: string;
  /** ISO `YYYY-MM-DD`, or null. Controlled when set. */
  value?: string | null;
  defaultValue?: string | null;
  /** The ISO date when the parts make a real date in range, else null. */
  onValueChange?: (iso: string | null) => void;
  onChange?: (iso: string | null) => void;
  helperText?: string;
  /** The screen's own error; wins over the built-in validation message. */
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Inclusive ISO bounds (a date of birth's 18-year rule, an expiry in the future). */
  min?: string;
  max?: string;
  announceError?: boolean;
}

/**
 * A typed day, month and year (never a calendar, rider.md R06/R09/R49), validated as a real date
 * in range and returned as ISO `YYYY-MM-DD`. The part that is wrong takes the danger border; the
 * message is one alert under the group, shown once the person has left a part or typed a
 * four-digit year.
 */
export function DateInput(props: DateInputProps) {
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'DateInput');
  const [parts, setParts] = React.useState<DateParts>(() => partsOfIso(props.value ?? props.defaultValue));
  const [touched, setTouched] = React.useState(false);
  const lastIso = React.useRef<string | null>(props.value ?? props.defaultValue ?? null);

  // A controlled value that changes from outside (a reset, a prefill) replaces the parts.
  const external = props.value;
  React.useEffect(() => {
    if (external !== undefined && external !== lastIso.current) {
      lastIso.current = external;
      setParts(partsOfIso(external));
    }
  }, [external]);

  const { problem } = isoOfParts(parts, { min: props.min, max: props.max });
  const showProblem = Boolean(problem) && (touched || parts.year.length === 4);
  const error = props.errorText ?? (showProblem ? problem!.message : null);

  const update = (key: keyof DateParts, raw: string) => {
    const next = { ...parts, [key]: raw.replace(/\D/g, '') };
    setParts(next);
    const { iso } = isoOfParts(next, { min: props.min, max: props.max });
    if (iso !== lastIso.current) {
      lastIso.current = iso;
      props.onValueChange?.(iso);
      props.onChange?.(iso);
    }
  };

  const part = (key: keyof DateParts, label: string, maxLength: number, flex: number) => (
    <View style={{ flex }}>
      <TextField
        testID={`${testID}-${key}`}
        label={label}
        value={parts[key]}
        onChangeText={(raw) => update(key, raw)}
        onBlur={() => setTouched(true)}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={maxLength}
        field={field}
        disabled={props.disabled}
        invalid={Boolean(props.errorText) || (showProblem && (problem!.part === key || problem!.part === 'all'))}
        autoComplete={key === 'day' ? 'birthdate-day' : key === 'month' ? 'birthdate-month' : 'birthdate-year'}
      />
    </View>
  );

  return (
    <View testID={testID} role="group" accessibilityLabel={props.required ? `${props.label}, required` : props.label} style={[{ gap: 4 }, props.style as StyleProp<ViewStyle>]}>
      <FieldLabel required={props.required} field={field} testID={`${testID}-legend`}>
        {props.label}
      </FieldLabel>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {part('day', 'Day', 2, 1)}
        {part('month', 'Month', 2, 1)}
        {part('year', 'Year', 4, 1.6)}
      </View>
      <FieldMessage error={error} helper={props.helperText} field={field} announce={props.announceError} testID={testID} />
    </View>
  );
}

/* ───── QuantityStepper ───── */

/** Props of `QuantityStepper` (today's names, plus the cart's `variant` from PR #639). */
export interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  /** sm 36 (44 hit area) · md 44 · lg 56; every size is 56 on rider. */
  size?: 'sm' | 'md' | 'lg';
  /** outlined (the item sheet's bordered segment) · tonal (the cart line's round buttons). */
  variant?: 'outlined' | 'tonal';
  /** The value FREEZES while the server answers: no optimistic jump that snaps back. */
  loading?: boolean;
  disabled?: boolean;
  /** At `value === min + 1` the minus becomes the remove action: "Remove {itemName}". */
  removeAtZero?: boolean;
  /** Names the group and the remove action ("Quantity for Chicken shawarma"). */
  itemName?: string;
  /** Why the plus stops at `max` ("Only 4 left today"): read with it and shown under the control. */
  maxReason?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  testId?: string;
}

/** The quantity control: minus becomes Remove at the last unit; the plus stops at `max` and says why. */
export function QuantityStepper(props: QuantityStepperProps) {
  const { value, min = 0, max, size = 'md', removeAtZero = false, itemName } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;
  const removing = removeAtZero && value === min + 1;
  const node = (
    <Stepper
      testID={resolveTestId(props, 'QuantityStepper')}
      value={value}
      min={min}
      max={max}
      groupLabel={itemName ? `Quantity for ${itemName}` : 'Quantity'}
      decrementLabel={removing ? (itemName ? `Remove ${itemName}` : 'Remove item') : 'Decrease quantity'}
      removing={removing}
      decrementDisabled={atMin}
      incrementDisabled={atMax}
      limitReason={props.maxReason}
      showLimit={atMax}
      loading={props.loading}
      disabled={props.disabled}
      size={field ? 'lg' : size}
      variant={props.variant}
      onDecrement={() => props.onChange(value - 1)}
      onIncrement={() => props.onChange(value + 1)}
    />
  );
  return props.style ? <View style={props.style}>{node}</View> : node;
}
