import * as React from 'react';
import { View } from 'react-native';
import type { Cents } from '@hg/api-client';

import {
  affix,
  CheckboxRow,
  ChoiceGroup,
  FieldMessage,
  Glyph,
  OtpField,
  RadioRow,
  Segmented,
  SelectField,
  SwitchRow,
  TextField,
  type ChoiceRowSize,
} from '../lib';
import { useTheme } from '../tokens';
import { Price } from './Content';
import { cleanInputValue, nameWithPrice, telDisplay, isInternationalTel, type InputVariant } from './formLogic';
import { type AnyIconName, type DsCommon, isFieldTheme, resolveTestId } from './shared';

/*
 * Input, Checkbox, RadioGroup/Radio, Switch, Select (design-system N3) and SegmentedControl: the
 * live props, rendered by the React Native Reusables tier (`lib/ui/field.tsx`, `input.tsx`,
 * `choice.tsx`, `switch.tsx`, `select.tsx`, `segmented.tsx`). This file keeps React's own JSX
 * runtime and only maps props and applies the rules (`formLogic.ts`); every `className` is
 * applied inside `lib/`.
 *
 * Native has no change event: every `onChange` here receives the value, exactly like
 * `onValueChange`. Both are accepted so code written against the live API compiles.
 *
 * On the rider (field) theme every control grows to the 56pt field target and its text steps up
 * one (body.md -> body.lg), whatever size was asked, like Button.
 *
 * Money: option prices are DISPLAYED through `Price` (sign `always` for a delta). Forms never
 * compute a price (invariant 1); a non-integer amount renders nothing and is reported by Price.
 */

export type { InputVariant };

/** Wraps a node in a View only when a style is given. */
function styled(style: DsCommon['style'], node: React.ReactElement): React.ReactElement {
  return style ? <View style={style}>{node}</View> : node;
}

/** A Price for an option: a signed delta, or an absolute price. */
function optionPrice(delta?: number, absolute?: number, testID?: string): React.ReactNode {
  if (delta !== undefined) return <Price cents={delta as Cents} sign="always" size="sm" testID={testID} />;
  if (absolute !== undefined) return <Price cents={absolute as Cents} size="sm" testID={testID} />;
  return undefined;
}

/* ───── Input ───── */

/** Props of the live `Input`; `onChange` receives the value on native. */
export interface InputProps extends DsCommon {
  /** REQUIRED, always visible — placeholder is never the label. */
  label: string;
  variant?: InputVariant;
  /** md 44 · lg 52. The rider (field) theme renders every size at 56. */
  size?: 'md' | 'lg';
  value?: string;
  defaultValue?: string;
  /** Receives the cleaned value on native (there is no change event). */
  onChange?: (value: string) => void;
  /** The cleaned value (digits only for numeric and otp; national digits for tel). */
  onValueChange?: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Trailing spinner; still editable unless readOnly. */
  loading?: boolean;
  /** Trailing check in the success text role — no green fill. */
  success?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  iconStart?: AnyIconName;
  maxLength?: number;
  /** Visible counter; announces what is left from 80% and at the limit. Needs maxLength. */
  characterCount?: boolean;
  autoComplete?: string;
  /** otp only: 6 cells (sign-in, default) or 4 (the rider's handover code). */
  cells?: 4 | 6;
  /** `false` when an ErrorSummary already announced the form's errors: the line stays, silent. */
  announceError?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}

const KEYBOARD = {
  text: 'default',
  email: 'email-address',
  tel: 'phone-pad',
  numeric: 'number-pad',
  password: 'default',
  search: 'default',
  otp: 'number-pad',
} as const;

const AUTOCOMPLETE: Partial<Record<InputVariant, string>> = {
  email: 'email',
  tel: 'tel-national',
  password: 'current-password',
};

/** Single-line text entry, controlled or uncontrolled. */
export function Input(props: InputProps) {
  const {
    label,
    variant = 'text',
    size = 'md',
    value,
    defaultValue,
    onChange,
    onValueChange,
    errorText,
    iconStart,
    prefix,
    suffix,
    cells = 6,
    style,
  } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'Input');
  const [own, setOwn] = React.useState(() => cleanInputValue(variant, defaultValue ?? '', cells));
  const current = value !== undefined ? value : own;

  const handle = (raw: string) => {
    const next = cleanInputValue(variant, raw, cells);
    if (value === undefined) setOwn(next);
    onValueChange?.(next);
    onChange?.(next);
  };

  if (variant === 'otp') {
    return styled(
      style,
      <OtpField
        label={label}
        cells={cells}
        value={current}
        onChangeText={handle}
        field={field}
        helper={props.helperText}
        error={errorText}
        announceError={props.announceError}
        required={props.required}
        disabled={props.disabled}
        loading={props.loading}
        testID={testID}
      />,
    );
  }

  const iconPx = field ? 22 : 20;
  const icon = iconStart ?? (variant === 'search' ? 'search' : undefined);
  const telPrefix = variant === 'tel' && prefix === undefined && !isInternationalTel(current) ? '+1' : undefined;
  // A string prefix is wrapped in Text by the field; an icon and a prefix share one slot.
  const text = prefix ?? telPrefix;
  const leading = icon ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Glyph name={icon} size={iconPx} className="text-muted-foreground" />
      {affix(text, field)}
    </View>
  ) : (
    text
  );

  return styled(
    style,
    <TextField
      label={label}
      value={variant === 'tel' ? telDisplay(current) : current}
      onChangeText={handle}
      size={size}
      field={field}
      placeholder={props.placeholder}
      helper={props.helperText}
      error={errorText}
      announceError={props.announceError}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      loading={props.loading}
      success={props.success}
      leading={leading}
      trailing={suffix}
      maxLength={props.maxLength}
      counter={props.characterCount}
      secure={variant === 'password'}
      keyboardType={KEYBOARD[variant]}
      inputMode={variant === 'numeric' ? 'numeric' : variant === 'tel' ? 'tel' : variant === 'email' ? 'email' : undefined}
      autoComplete={(props.autoComplete ?? AUTOCOMPLETE[variant]) as never}
      autoCapitalize={variant === 'email' || variant === 'password' ? 'none' : undefined}
      autoCorrect={variant === 'email' || variant === 'password' || variant === 'tel' ? false : undefined}
      returnKeyType={variant === 'search' ? 'search' : 'done'}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      testID={testID}
    />,
  );
}

/* ───── Checkbox ───── */

/** Props of the live `Checkbox`. */
export interface CheckboxProps extends DsCommon {
  label: string;
  description?: string;
  /** Controlled when set; otherwise the box keeps its own state. */
  checked?: boolean;
  /** Announced as "mixed". */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** e.g. "Out of stock". */
  disabledReason?: string;
  /** Add-on rows: rendered through Price with sign always. Integer cents. */
  priceDeltaCents?: number;
  /** Announced as an alert under the control. */
  error?: string;
  /** Control size; the row is always at least 44 (56 on the rider theme). */
  size?: 20 | 24;
  /** Accepted for API parity (a form field name on web). */
  name?: string;
  value?: string;
}

/** An independent boolean; `error` is announced under the control. */
export function Checkbox(props: CheckboxProps) {
  const { label, checked, onChange, onCheckedChange, error, style } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'Checkbox');
  const [own, setOwn] = React.useState(false);
  const on = checked ?? own;
  return (
    <View style={style}>
      <CheckboxRow
        testID={testID}
        label={label}
        description={props.description}
        accessibilityLabel={nameWithPrice(label, props.priceDeltaCents)}
        checked={on}
        indeterminate={props.indeterminate}
        disabled={props.disabled}
        disabledReason={props.disabledReason}
        invalid={Boolean(error)}
        size={props.size}
        rowSize={field ? 'field' : 'default'}
        field={field}
        trailing={optionPrice(props.priceDeltaCents, undefined, `${testID}-price`)}
        onPress={() => {
          const next = props.indeterminate ? true : !on;
          if (checked === undefined) setOwn(next);
          onChange?.(next);
          onCheckedChange?.(next);
        }}
      />
      <FieldMessage error={error} field={field} testID={testID} />
    </View>
  );
}

/* ───── RadioGroup / Radio ───── */

/** One option of a `RadioGroup`. */
export interface RadioOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Variant rows: rendered through Price with sign always. Integer cents. */
  priceDeltaCents?: number;
  /**
   * An option's own price, not a difference: a variant that REPLACES the base price
   * (`pricing_mode: ABSOLUTE`) shows "$45.99", never "+$21.00" (customer PR #634). Integer cents.
   */
  priceCents?: number;
}

/** Props of the live `RadioGroup`. */
export interface RadioGroupProps extends DsCommon {
  /** The visible legend; names the group. REQUIRED. */
  label: string;
  /** Hides the legend visually; the group keeps it as its accessible name. */
  hideLabel?: boolean;
  /** Accepted for API parity (the web form name). */
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
  /** Announced ONCE, on the GROUP, not on the last option. */
  error?: string | null;
  /** @deprecated The legacy name of `error`; kept for one release. */
  errorText?: string | null;
  size?: 20 | 24;
  /**
   * 72pt rows (`target.criticalField`) for the item sheet's variant groups and the rider's
   * handover method: one roomy group per screen (PR #644). Default rows are 44 (56 on rider).
   */
  roomy?: boolean;
}

interface RadioContextValue {
  value: string | null;
  select: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  size?: 20 | 24;
  rowSize: ChoiceRowSize;
  field: boolean;
  groupTestID: string;
}

const RadioContext = React.createContext<RadioContextValue | null>(null);

/** One choice from a set; the error is announced on the group. */
export function RadioGroup(props: RadioGroupProps) {
  const { label, value, onChange, onValueChange, options, children, size, style } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'RadioGroup');
  const error = props.error ?? props.errorText ?? null;
  const ctx: RadioContextValue = {
    value,
    select: (next) => {
      onChange?.(next);
      onValueChange?.(next);
    },
    disabled: Boolean(props.disabled),
    invalid: Boolean(error),
    size,
    rowSize: props.roomy ? 'roomy' : field ? 'field' : 'default',
    field,
    groupTestID: testID,
  };
  return styled(
    style,
    <ChoiceGroup
      testID={testID}
      legend={label}
      hideLegend={props.hideLabel}
      role="radiogroup"
      required={props.required}
      error={error}
      disabled={props.disabled}
      horizontal={props.orientation === 'horizontal'}
      field={field}
    >
      <RadioContext.Provider value={ctx}>
        {options ? options.map((o) => <Radio key={o.value} {...o} testID={`${testID}-${o.value}`} />) : children}
      </RadioContext.Provider>
    </ChoiceGroup>,
  );
}

/** Props of the live `Radio`. */
export interface RadioProps extends RadioOption {
  size?: 20 | 24;
  testId?: string;
  testID?: string;
}

/** Always used inside RadioGroup. */
export function Radio(props: RadioProps) {
  const ctx = React.useContext(RadioContext);
  const testID = resolveTestId(props, ctx ? `${ctx.groupTestID}-${props.value}` : `Radio-${props.value}`);
  const disabled = Boolean(props.disabled || ctx?.disabled);
  return (
    <RadioRow
      testID={testID}
      label={props.label}
      description={props.description}
      accessibilityLabel={nameWithPrice(props.label, props.priceDeltaCents, props.priceCents)}
      checked={ctx?.value === props.value}
      disabled={disabled}
      disabledReason={props.disabledReason}
      invalid={ctx?.invalid}
      size={props.size ?? ctx?.size}
      rowSize={ctx?.rowSize}
      field={ctx?.field}
      trailing={optionPrice(props.priceDeltaCents, props.priceCents, `${testID}-price`)}
      onPress={() => ctx?.select(props.value)}
    />
  );
}

/* ───── Switch ───── */

/** Props of the live `Switch`; the state words are required. */
export interface SwitchProps extends DsCommon {
  label: string;
  description?: string;
  /** REQUIRED visible state words — state is never thumb position alone. */
  stateLabel: { on: string; off: string };
  /** @deprecated The legacy name of `stateLabel`; kept for one release, ignored when `stateLabel` is set. */
  stateLabels?: { on: string; off: string };
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: (checked: boolean) => void;
  /** The switch STAYS in its old position until the server confirms. */
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  /** Accepted for API parity (a hidden form input on web). */
  name?: string;
  /** Track sm 40×24 or md 52×32 (default); the row is 44, 56 on the rider theme. */
  size?: 'sm' | 'md';
}

/** An immediate, self-applying binary that says its state in words. */
export function Switch(props: SwitchProps) {
  const { label, checked, onCheckedChange, onChange, error, style } = props;
  const theme = useTheme();
  const field = isFieldTheme(theme);
  const testID = resolveTestId(props, 'Switch');
  const words = props.stateLabel ?? props.stateLabels ?? { on: 'On', off: 'Off' };
  return (
    <View style={style}>
      <SwitchRow
        testID={testID}
        label={label}
        description={props.description}
        stateWord={checked ? words.on : words.off}
        checked={checked}
        loading={props.loading}
        disabled={props.disabled}
        size={props.size}
        field={field}
        onPress={() => {
          onCheckedChange?.(!checked);
          onChange?.(!checked);
        }}
      />
      <FieldMessage error={error} field={field} testID={testID} />
    </View>
  );
}

/* ───── Select ───── */

/** One option of a `Select`. */
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Props of the live `Select`. */
export interface SelectProps extends DsCommon {
  /** REQUIRED, visible. */
  label: string;
  /**
   * native (default): the list opens full height · listbox: the same, plus a filter field when
   * `searchable` (the live API's `sheet` on native). `sheet` is the deprecated legacy name.
   */
  variant?: 'native' | 'listbox' | 'sheet';
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
  /** md 44 · lg 52; 56 on the rider theme. */
  size?: 'md' | 'lg';
  /** `false` when an ErrorSummary already announced the form's errors. */
  announceError?: boolean;
  /** Starts with the list open (galleries and tests). */
  defaultOpen?: boolean;
}

/** A choice from a closed, server-defined set. */
export function Select(props: SelectProps) {
  const { variant = 'native', onChange, onValueChange, style } = props;
  const theme = useTheme();
  const listbox = variant === 'listbox' || variant === 'sheet';
  return styled(
    style,
    <SelectField
      testID={resolveTestId(props, 'Select')}
      label={props.label}
      options={props.options}
      value={props.value ?? null}
      onSelect={(next) => {
        onChange?.(next);
        onValueChange?.(next);
      }}
      placeholder={props.placeholder}
      searchable={listbox && (props.searchable ?? variant === 'sheet')}
      helper={props.helperText}
      error={props.errorText}
      announceError={props.announceError}
      required={props.required}
      disabled={props.disabled}
      loading={props.loading}
      emptyText={props.emptyText}
      size={props.size}
      field={isFieldTheme(theme)}
      defaultOpen={props.defaultOpen}
    />,
  );
}

/* ───── SegmentedControl ───── */

/** One segment of a `SegmentedControl`. */
export interface SegmentedControlOption {
  value: string;
  label: string;
  /** Swaps to the bold weight when selected. */
  icon?: AnyIconName;
  disabled?: boolean;
}

/** Props of the live `SegmentedControl`. */
export interface SegmentedControlProps extends DsCommon {
  /** REQUIRED — names the radiogroup. */
  label: string;
  options: SegmentedControlOption[];
  value: string;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  /** light (cream/white) · chrome (forest bar). Role tokens only. */
  tone?: 'light' | 'chrome';
  /** sm 36 visual (44 hit area) · md 44 · lg 52; 56 on the rider theme. */
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

/** Two or three exclusive options that switch a view in place. A radiogroup, not tabs. */
export function SegmentedControl(props: SegmentedControlProps) {
  const theme = useTheme();
  return styled(
    props.style,
    <Segmented
      testID={resolveTestId(props, 'SegmentedControl')}
      label={props.label}
      options={props.options}
      value={props.value}
      onSelect={(next) => {
        props.onChange?.(next);
        props.onValueChange?.(next);
      }}
      tone={props.tone}
      size={props.size}
      field={isFieldTheme(theme)}
      fullWidth={props.fullWidth}
    />,
  );
}
