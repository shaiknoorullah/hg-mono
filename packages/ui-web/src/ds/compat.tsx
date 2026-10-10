/**
 * `@hg/ui-web/ds` compatibility layer.
 *
 * The redesign's app code is written against the props of the live Claude Design system
 * (`components/index.d.ts`, artifact 1GwGVZz8Ju9wcz4HfCnzbv). Where a legacy component already
 * renders the right thing but names a prop differently, a thin adapter here translates the live
 * props to the legacy ones. The design-system work packages then replace each adapter with the
 * rebuilt component one at a time, with the same props, so app code never changes.
 *
 * Nothing here changes how a legacy component looks: the adapters only rename props.
 * Root exports (`@hg/ui-web`) are untouched, so the released apps are unaffected.
 */

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';

import {
  Checkbox as LegacyCheckbox,
  Input as LegacyInput,
  RadioGroup as LegacyRadioGroup,
  Select as LegacySelect,
  Switch as LegacySwitch,
} from '../primitives/index.js';
import { Price } from '../content/index.js';
import { TopBar } from '../navigation/index.js';
import { Icon, type DsIconName } from './Icon.js';

/* ───── Input ───── */

/** Props of the live `Input` (index.d.ts). */
export interface InputProps {
  label: string;
  variant?: 'text' | 'email' | 'tel' | 'numeric' | 'password' | 'search' | 'otp';
  size?: 'md' | 'lg';
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** The cleaned value (digits only for numeric and otp). */
  onValueChange?: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  loading?: boolean;
  success?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  iconStart?: DsIconName;
  maxLength?: number;
  characterCount?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  id?: string;
  name?: string;
  autoFocus?: boolean;
  testId?: string;
  style?: CSSProperties;
}

/** Single-line text entry with the live props (onChange gets the event, onValueChange the value). */
export function Input({ onChange, onValueChange, errorText, iconStart, prefix, testId, ...rest }: InputProps) {
  return (
    <LegacyInput
      {...rest}
      errorText={errorText ?? undefined}
      prefix={prefix ?? (iconStart ? <Icon name={iconStart} size="md" /> : undefined)}
      onChange={(value, event) => {
        onChange?.(event);
        onValueChange?.(value);
      }}
      data-testid={testId ?? 'Input'}
    />
  );
}

/* ───── Select ───── */

/** One option of a Select. */
export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Props of the live `Select` (index.d.ts); onChange receives the value until W3. */
export interface SelectProps {
  label: string;
  variant?: 'native' | 'listbox';
  options: SelectOption[];
  value?: string | null;
  /** Called with the selected value. */
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  size?: 'md' | 'lg';
  id?: string;
  name?: string;
  testId?: string;
  style?: CSSProperties;
}

/** Choice from a closed, server-defined set, with the live props, rendered by the legacy Select. */
export function Select({ onChange, onValueChange, value, errorText, size: _size, id: _id, testId, style, ...rest }: SelectProps) {
  return (
    <div data-testid={testId ?? 'Select'} style={style}>
      <LegacySelect
        {...rest}
        value={value ?? undefined}
        errorText={errorText ?? undefined}
        onChange={(v) => {
          onChange?.(v);
          onValueChange?.(v);
        }}
      />
    </div>
  );
}

/* ───── Checkbox ───── */

/** Props of the live `Checkbox` (index.d.ts); use onCheckedChange. */
export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Add-on rows: rendered through Price with the sign always shown. */
  priceDeltaCents?: number;
  error?: string;
  size?: 20 | 24;
  name?: string;
  value?: string;
  testId?: string;
  style?: CSSProperties;
}

/** Independent boolean, with the live props; priceDeltaCents renders through Price. */
export function Checkbox({ onCheckedChange, priceDeltaCents, testId, style, ...rest }: CheckboxProps) {
  return (
    <div data-testid={testId ?? 'Checkbox'} style={style}>
      <LegacyCheckbox
        {...rest}
        onChange={onCheckedChange}
        trailing={
          priceDeltaCents === undefined ? undefined : (
            <Price cents={priceDeltaCents as never} sign="always" size="sm" />
          )
        }
      />
    </div>
  );
}

/* ───── RadioGroup ───── */

/** One option of a RadioGroup; priceDeltaCents renders through Price with the sign shown. */
export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  /** Variant rows: rendered through Price with the sign always shown. */
  priceDeltaCents?: number;
}

/** Props of the live `RadioGroup` (index.d.ts), options form. */
export interface RadioGroupProps {
  /** The visible legend; names the radiogroup. */
  label: string;
  hideLabel?: boolean;
  name?: string;
  value: string | null;
  onChange?: (value: string) => void;
  onValueChange?: (value: string) => void;
  options: RadioOption[];
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  error?: string | null;
  size?: 20 | 24;
  testId?: string;
  style?: CSSProperties;
}

/** One choice from a set, with the live props, rendered by the legacy RadioGroup. */
export function RadioGroup({
  options,
  value,
  onChange,
  onValueChange,
  hideLabel,
  error,
  testId,
  style,
  ...rest
}: RadioGroupProps) {
  return (
    <div data-testid={testId ?? 'RadioGroup'} style={style}>
      <LegacyRadioGroup
        {...rest}
        labelHidden={hideLabel}
        error={error ?? undefined}
        value={value ?? undefined}
        options={options.map(({ priceDeltaCents, ...option }) => ({
          ...option,
          trailing:
            priceDeltaCents === undefined ? undefined : (
              <Price cents={priceDeltaCents as never} sign="always" size="sm" />
            ),
        }))}
        onChange={(v) => {
          onChange?.(v);
          onValueChange?.(v);
        }}
      />
    </div>
  );
}

/* ───── Switch ───── */

/** Props of the live `Switch` (index.d.ts). */
export interface SwitchProps {
  label: ReactNode;
  description?: ReactNode;
  /** Visible state words — state is never the thumb position alone. */
  stateLabel: { on: string; off: string };
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Holds the old position until the server confirms. */
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  name?: string;
  size?: 'sm' | 'md';
  testId?: string;
  style?: CSSProperties;
}

/** Immediate, self-applying binary with visible state words, rendered by the legacy Switch. */
export function Switch({ onCheckedChange, size: _size, testId, style, ...rest }: SwitchProps) {
  return (
    <div data-testid={testId ?? 'Switch'} style={style}>
      <LegacySwitch {...rest} onChange={onCheckedChange} />
    </div>
  );
}

/* ───── AppBar ───── */

/** Props of the live `AppBar` (index.d.ts). */
export interface AppBarProps {
  variant?: 'default' | 'large' | 'search' | 'contextual' | 'transparent';
  /** chrome is the restaurant and admin tone; tones land with the AppBar rebuild (W2). */
  tone?: 'cream' | 'raised' | 'chrome' | 'field';
  title?: ReactNode;
  subtitle?: ReactNode;
  /** "Back to {previous}". */
  backLabel?: string;
  onBack?: () => void;
  actions?: ReactNode;
  search?: ReactNode;
  loading?: boolean;
  elevated?: boolean;
  titleIsPageHeading?: boolean;
  sticky?: boolean;
  testId?: string;
  style?: CSSProperties;
}

/** The top bar with the live props, rendered by the legacy TopBar until W2. */
export function AppBar({
  variant = 'default',
  tone: _tone,
  title,
  subtitle,
  backLabel,
  onBack,
  sticky: _sticky,
  style,
  ...rest
}: AppBarProps) {
  const legacyVariant = variant === 'search' || variant === 'contextual' ? variant : 'default';
  return (
    <div style={style}>
      <TopBar
        {...rest}
        variant={legacyVariant}
        title={title as string}
        subtitle={subtitle as string | undefined}
        back={onBack ? { label: backLabel ?? 'Back', onPress: onBack } : undefined}
        onExitContextual={variant === 'contextual' ? onBack : undefined}
      />
    </div>
  );
}

/** Props the live design system declares on every component. */
export interface DsCommonProps {
  testId?: string;
  style?: CSSProperties;
}

export type { SyntheticEvent };
