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
  Button as LegacyButton,
  Checkbox as LegacyCheckbox,
  Icon as LegacyIcon,
  IconButton as LegacyIconButton,
  Input as LegacyInput,
  RadioGroup as LegacyRadioGroup,
  Select as LegacySelect,
  Switch as LegacySwitch,
  SOLAR_ICON_IDS,
  type IconName as LegacyIconName,
} from '../primitives/index.js';
import { Price } from '../content/index.js';
import { TopBar } from '../navigation/index.js';
import { reportDsClientError } from './client-error.js';

/* ───── Icon ───── */

/** The 14 names in the repo map. */
export type IconName = LegacyIconName;
/** Named by the live design system; their glyphs land with the Icon rebuild (W1, #198). */
export type IconExtensionName =
  | 'chevron-down'
  | 'chevron-right'
  | 'minus'
  | 'lock'
  | 'info'
  | 'warning'
  | 'error'
  | 'more'
  | 'refresh';
/** linear (inactive, default) or bold (active: selected tab, chip, nav item). */
export type IconWeight = 'linear' | 'bold';
/** Every name the design-system Icon accepts: the repo map plus the live extension names. */
export type DsIconName = IconName | IconExtensionName;

const ICON_SIZE = { sm: 16, md: 20, lg: 24, xl: 32, '2xl': 48 } as const;

/** Props of the live `Icon` (index.d.ts). */
export interface IconProps {
  name: DsIconName;
  weight?: IconWeight;
  /** sm 16 · md 20 · lg 24 · xl 32 · 2xl 48, or a px number. */
  size?: keyof typeof ICON_SIZE | number;
  accessibilityLabel?: string;
  /** Any CSS colour — use a role token. Glyphs paint in currentColor. */
  color?: string;
  testId?: string;
  style?: CSSProperties;
}

function hasGlyph(name: string): name is LegacyIconName {
  return Object.prototype.hasOwnProperty.call(SOLAR_ICON_IDS, name);
}

/** Unknown names render nothing and report ICON_NAME_UNKNOWN. */
export function Icon({ name, weight, size = 'lg', accessibilityLabel, color, testId, style }: IconProps) {
  if (!hasGlyph(name)) {
    reportDsClientError('ICON_NAME_UNKNOWN', { received: name });
    return null;
  }
  const px = typeof size === 'number' ? size : ICON_SIZE[size];
  return (
    <span data-testid={testId ?? 'Icon'} style={{ display: 'inline-flex', color, ...style }}>
      <LegacyIcon name={name} size={px} weight={weight} accessibilityLabel={accessibilityLabel} />
    </span>
  );
}

function glyph(icon: DsIconName | ReactNode | undefined, size?: number): ReactNode {
  if (typeof icon === 'string') return <Icon name={icon as DsIconName} size={size ?? 'md'} />;
  return icon;
}

/* ───── Button ───── */

/** Props of the live `Button` (index.d.ts). Action is orange; there is no success button. */
export interface ButtonProps {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** 72px critical target — restaurant Accept order only on web. */
  critical?: boolean;
  fullWidth?: boolean;
  iconStart?: DsIconName;
  iconEnd?: DsIconName;
  loading?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  href?: string;
  type?: 'button' | 'submit' | 'reset';
  accessibilityLabel?: string;
  testId?: string;
  style?: CSSProperties;
}

/** The single affordance for an action, with the live props, rendered by the legacy Button. */
export function Button({ iconStart, iconEnd, critical, testId, onPress, size, ...rest }: ButtonProps) {
  return (
    <LegacyButton
      {...rest}
      size={critical ? 'xl' : size}
      className={critical ? 'min-h-18' : undefined}
      iconStart={iconStart ? glyph(iconStart) : undefined}
      iconEnd={iconEnd ? glyph(iconEnd) : undefined}
      onPress={onPress as (() => void) | undefined}
      data-testid={testId ?? 'Button'}
    />
  );
}

/* ───── IconButton ───── */

/** Props of the live `IconButton` (index.d.ts). */
export interface IconButtonProps {
  icon: DsIconName | ReactNode;
  /** Required. A count badge is appended to it ("Cart, 3 items"). */
  accessibilityLabel: string;
  variant?: 'plain' | 'filled' | 'tonal';
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circle';
  weight?: IconWeight;
  badge?: number | boolean;
  badgeNoun?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress?: (e: React.MouseEvent) => void;
  testId?: string;
  style?: CSSProperties;
}

const ICON_BUTTON_GLYPH = { sm: 16, md: 20, lg: 24 } as const;

/** A control whose only content is an icon, with the live props, rendered by the legacy IconButton. */
export function IconButton({
  icon,
  accessibilityLabel,
  badge,
  badgeNoun,
  shape,
  weight,
  size = 'md',
  testId,
  onPress,
  ...rest
}: IconButtonProps) {
  // The live name is "{label}, {n} {noun}" ("Cart, 3 items"); the legacy control writes
  // "{label}, {n}", so the full name is set here and wins over the legacy one.
  const name =
    typeof badge === 'number'
      ? `${accessibilityLabel}, ${badge > 99 ? '99+' : badge}${badgeNoun ? ` ${badgeNoun}` : ''}`
      : accessibilityLabel;
  const node =
    typeof icon === 'string' ? (
      <Icon name={icon as DsIconName} size={ICON_BUTTON_GLYPH[size]} weight={weight} />
    ) : (
      icon
    );
  return (
    <LegacyIconButton
      {...rest}
      {...({ 'aria-label': name } as object)}
      size={size}
      icon={node}
      badge={badge}
      accessibilityLabel={accessibilityLabel}
      className={shape === 'square' ? 'rounded-md' : undefined}
      onPress={onPress as (() => void) | undefined}
      data-testid={testId ?? 'IconButton'}
    />
  );
}

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
