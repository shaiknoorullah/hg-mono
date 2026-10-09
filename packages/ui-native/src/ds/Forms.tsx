import { useState } from 'react';
import { Text, View } from 'react-native';

import { Checkbox as LegacyCheckbox } from '../primitives/Checkbox';
import { Input as LegacyInput, type InputSize, type InputVariant } from '../primitives/Input';
import { Radio as LegacyRadio, RadioGroup as LegacyRadioGroup } from '../primitives/Radio';
import { Select as LegacySelect, type SelectOption } from '../primitives/Select';
import { Switch as LegacySwitch } from '../primitives/Switch';
import { useTheme, useTypeStyle } from '../tokens';
import { Icon } from './Icon';
import { type AnyIconName, type DsCommon, resolveTestId } from './shared';

/**
 * Native has no change event: every `onChange` here receives the value, exactly like
 * `onValueChange`. Both are accepted so code written against the live API compiles.
 */

/** A field error announced as an alert, under a control that only flags the error itself. */
function FieldError({ text, testID }: { text: string; testID: string }) {
  const theme = useTheme();
  const caption = useTypeStyle('caption');
  return (
    <Text
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{ ...caption, color: theme.color.feedback.danger.text }}
    >
      {'⚠ '}
      {text}
    </Text>
  );
}

/* ───── Input ───── */

export interface InputProps extends DsCommon {
  /** REQUIRED, always visible — placeholder is never the label. */
  label: string;
  variant?: InputVariant;
  /** md 44 · lg 52 (rider default). */
  size?: InputSize;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** The cleaned value (digits only for numeric and otp). */
  onValueChange?: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  /** Trailing check — no green fill. */
  success?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  iconStart?: AnyIconName;
  maxLength?: number;
  characterCount?: boolean;
  autoComplete?: string;
}

export function Input(props: InputProps) {
  const {
    value,
    defaultValue,
    onChange,
    onValueChange,
    errorText,
    iconStart,
    prefix,
    style,
    testId: _t,
    testID: _T,
    ...rest
  } = props;
  const theme = useTheme();
  const [own, setOwn] = useState(defaultValue ?? '');
  const controlled = value !== undefined;
  const field = (
    <LegacyInput
      {...rest}
      value={controlled ? value : own}
      onChange={(next) => {
        if (!controlled) setOwn(next);
        onChange?.(next);
        onValueChange?.(next);
      }}
      errorText={errorText ?? undefined}
      prefix={prefix ?? (iconStart ? <Icon name={iconStart} color={theme.color.text.secondary} /> : undefined)}
      testID={resolveTestId(props, 'Input')}
    />
  );
  return style ? <View style={style}>{field}</View> : field;
}

/* ───── Checkbox ───── */

export interface CheckboxProps extends DsCommon {
  label: string;
  description?: string;
  checked?: boolean;
  /** Announced as "mixed". */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** e.g. "Out of stock". */
  disabledReason?: string;
  /** Add-on rows: rendered through Price with sign always. */
  priceDeltaCents?: number;
  /** Announced as an alert under the control. */
  error?: string;
  size?: 20 | 24;
}

export function Checkbox(props: CheckboxProps) {
  const { checked = false, onChange, onCheckedChange, error, style, testId: _t, testID: _T, ...rest } = props;
  const testID = resolveTestId(props, 'Checkbox');
  return (
    <View style={style}>
      <LegacyCheckbox
        {...rest}
        checked={checked}
        error={Boolean(error)}
        onChange={(next) => {
          onChange?.(next);
          onCheckedChange?.(next);
        }}
        testID={testID}
      />
      {error ? <FieldError text={error} testID={`${testID}-error`} /> : null}
    </View>
  );
}

/* ───── RadioGroup / Radio ───── */

export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Variant rows: rendered through Price with sign always. */
  priceDeltaCents?: number;
}

export interface RadioGroupProps extends DsCommon {
  /** The visible legend; names the group. REQUIRED. */
  label: string;
  /** Accepted for API parity; the legend stays visible on native until N3. */
  hideLabel?: boolean;
  name?: string;
  value: string | null;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  /** Either options or <Radio> children. */
  options?: RadioOption[];
  children?: React.ReactNode;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  /** Announced on the GROUP, not the last option. */
  error?: string | null;
  size?: 20 | 24;
}

export function RadioGroup(props: RadioGroupProps) {
  const { label, name, value, onChange, onValueChange, options, children, error, size, style, hideLabel: _h, ...rest } =
    props;
  const testID = resolveTestId(props, 'RadioGroup');
  const group = (
    <LegacyRadioGroup
      name={name ?? label}
      label={label}
      value={value}
      orientation={rest.orientation}
      required={rest.required}
      disabled={rest.disabled}
      errorText={error ?? undefined}
      onChange={(next) => {
        onChange?.(next);
        onValueChange?.(next);
      }}
      testID={testID}
    >
      {options
        ? options.map((o) => (
            <LegacyRadio key={o.value} {...o} size={size} error={Boolean(error)} testID={`${testID}-${o.value}`} />
          ))
        : children}
    </LegacyRadioGroup>
  );
  return style ? <View style={style}>{group}</View> : group;
}

export interface RadioProps extends RadioOption {
  size?: 20 | 24;
  testId?: string;
  testID?: string;
}

/** Always used inside RadioGroup. */
export function Radio(props: RadioProps) {
  const { testId: _t, testID: _T, ...rest } = props;
  return <LegacyRadio {...rest} testID={resolveTestId(props, `Radio-${props.value}`)} />;
}

/* ───── Switch ───── */

export interface SwitchProps extends DsCommon {
  label: string;
  description?: string;
  /** REQUIRED visible state words — state is never thumb position alone. */
  stateLabel: { on: string; off: string };
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (checked: boolean) => void;
  /** The switch STAYS in its old position until the server confirms. */
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  /** Accepted for API parity (a hidden form input on web). */
  name?: string;
  /** Accepted for API parity; the row is sized by the theme's target. */
  size?: 'sm' | 'md';
}

export function Switch(props: SwitchProps) {
  const { stateLabel, onCheckedChange, onChange, error, style, name: _n, size: _s, testId: _t, testID: _T, ...rest } =
    props;
  const testID = resolveTestId(props, 'Switch');
  return (
    <View style={style}>
      <LegacySwitch
        {...rest}
        stateLabels={stateLabel}
        onChange={(next) => {
          onCheckedChange?.(next);
          onChange?.(next);
        }}
        testID={testID}
      />
      {error ? <FieldError text={error} testID={`${testID}-error`} /> : null}
    </View>
  );
}

/* ───── Select ───── */

export type { SelectOption };

export interface SelectProps extends DsCommon {
  /** REQUIRED, visible. */
  label: string;
  /** native (default, the platform picker) · listbox (a searchable list in a sheet on native). */
  variant?: 'native' | 'listbox';
  options: SelectOption[];
  value?: string | null;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** listbox: adds a filter field. */
  searchable?: boolean;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Skeleton rows inside the list — never an empty list. */
  loading?: boolean;
  /** Shown when there are no options. */
  emptyText?: string;
  /** Accepted for API parity; sized by the theme's target. */
  size?: 'md' | 'lg';
}

export function Select(props: SelectProps) {
  const {
    variant = 'native',
    value,
    onChange,
    onValueChange,
    errorText,
    helperText: _helper,
    size: _s,
    style,
    testId: _t,
    testID: _T,
    ...rest
  } = props;
  const field = (
    <LegacySelect
      {...rest}
      variant={variant === 'listbox' ? 'sheet' : 'native'}
      value={value ?? null}
      errorText={errorText ?? undefined}
      onChange={(next) => {
        onChange?.(next);
        onValueChange?.(next);
      }}
      testID={resolveTestId(props, 'Select')}
    />
  );
  return style ? <View style={style}>{field}</View> : field;
}
