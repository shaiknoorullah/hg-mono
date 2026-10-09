/**
 * `Input` — single-line text entry (02-components.md §3; focus per
 * docs/decisions/focus-indicator.md), rebuilt on shadcn `Input` + `Label` + `InputOTP`.
 * Props are the live `index.d.ts`, plus the approval packet's field size (`size="field"`, 56px)
 * and the 4-cell OTP (`otpLength`), both additions.
 *
 * - `label` is required and always visible; the placeholder is never the label.
 * - Ids come from `useId`; `helperText`, `errorText` and the counter are linked through
 *   `aria-describedby`, merged with any `aria-describedby` the caller passes.
 * - `errorText` is `role="alert"` with an icon, and sets `aria-invalid`.
 * - `disabled` keeps the field focusable: `aria-disabled` + read-only, drawn disabled.
 * - `loading` is a trailing spinner (still editable unless read-only); `success` is a trailing
 *   check in the success text colour, never a green fill (invariant 10).
 * - `otp` is input-otp: one real field (`autoComplete="one-time-code"`, paste-aware) under 6
 *   drawn cells (or 4 with `otpLength={4}`).
 * - `characterCount` with `maxLength` shows "{n}/{max}" and announces at 80% and at the limit.
 */

import { useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';

import { Input as LibInput, fieldShellVariants } from '../lib/ui/input.js';
import { InputOTP, InputOTPSlot } from '../lib/ui/input-otp.js';
import { Label } from '../lib/ui/label.js';
import { cn } from '../lib/utils.js';
import { Spinner } from '../proposed/index.js';
import { reportDsClientError } from './client-error.js';
import {
  CharacterCounter,
  FieldMessage,
  LiveMessage,
  describedBy,
  useCountAnnouncement,
  useFieldIds,
} from './field-parts.js';
import { Icon, type DsIconName } from './index.js';

/** The kinds of single-line entry. */
export type InputVariant = 'text' | 'email' | 'tel' | 'numeric' | 'password' | 'search' | 'otp';

/** Props of the live `Input` (index.d.ts), plus the packet's `field` size and `otpLength`. */
export interface InputProps {
  /** Required, always visible: the placeholder is never the label. */
  label: string;
  variant?: InputVariant;
  /** md 44 · lg 52 · field 56 (approval packet P19). */
  size?: 'md' | 'lg' | 'field';
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** The cleaned value (digits only for numeric and otp). */
  onValueChange?: (value: string) => void;
  placeholder?: string;
  /** Linked via aria-describedby. */
  helperText?: string;
  /** Danger border + icon + text; role="alert"; linked; sets aria-invalid. */
  errorText?: string | null;
  required?: boolean;
  /** Drawn disabled, read-only and `aria-disabled`; stays focusable. */
  disabled?: boolean;
  readOnly?: boolean;
  /** Trailing spinner; still editable unless readOnly. */
  loading?: boolean;
  /** Trailing check in the success text colour, no green fill. */
  success?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  iconStart?: DsIconName;
  maxLength?: number;
  /** Visible counter; announces remaining characters at 80% and at the limit. */
  characterCount?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  /** Defaults to a useId() value, never derived from the label. */
  id?: string;
  name?: string;
  autoFocus?: boolean;
  /** `otp` only: 6 cells (sign-in, default) or 4 (rider handover). */
  otpLength?: 4 | 6;
  /** Alias of `otpLength` (the approval packet's name, P19). */
  length?: 4 | 6;
  /** Extra ids to describe the field by, merged with the helper, error and counter. */
  'aria-describedby'?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  testId?: string;
  style?: CSSProperties;
}

type VariantAttrs = Pick<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'autoComplete' | 'pattern'
>;

const VARIANT_ATTRS: Record<Exclude<InputVariant, 'otp'>, VariantAttrs> = {
  text: { type: 'text' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  tel: { type: 'tel', inputMode: 'tel', autoComplete: 'tel-national' },
  numeric: { type: 'text', inputMode: 'numeric', pattern: '[0-9]*' },
  password: { type: 'password', autoComplete: 'current-password' },
  search: { type: 'search', inputMode: 'search' },
};

/** Removes everything but digits (numeric and otp values). */
export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/** Single-line text entry with a visible label, linked helper and error, and every live state. */
export function Input({
  label,
  variant = 'text',
  size = 'md',
  value,
  defaultValue,
  onChange,
  onValueChange,
  placeholder,
  helperText,
  errorText,
  required = false,
  disabled = false,
  readOnly = false,
  loading = false,
  success = false,
  prefix,
  suffix,
  iconStart,
  maxLength,
  characterCount = false,
  autoComplete,
  inputMode,
  id,
  name,
  autoFocus,
  otpLength: otpLengthProp,
  length: lengthAlias,
  'aria-describedby': extraDescribedBy,
  onBlur,
  onFocus,
  testId,
  style,
}: InputProps) {
  if (!label) reportDsClientError('FIELD_UNLABELLED', { component: 'Input' });
  const otpLength = otpLengthProp ?? lengthAlias ?? 6;
  const ids = useFieldIds(id, 'input');
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = value ?? inner;
  const invalid = Boolean(errorText);
  const isOtp = variant === 'otp';
  const limit = isOtp ? otpLength : maxLength;
  const counted = Boolean(characterCount && limit && !isOtp);
  const announcement = useCountAnnouncement(current.length, limit, counted);
  const describedByIds = describedBy(
    extraDescribedBy,
    helperText && ids.helper,
    invalid && ids.error,
    counted && ids.count,
  );

  const commit = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (disabled || readOnly) return;
    const raw = e.target.value;
    const next = variant === 'numeric' ? digitsOnly(raw) : raw;
    onChange?.(e);
    commit(next);
  };

  const common = {
    id: ids.control,
    name,
    autoFocus,
    required,
    readOnly: readOnly || disabled,
    'aria-required': required || undefined,
    'aria-invalid': invalid || undefined,
    'aria-disabled': disabled || undefined,
    'aria-busy': loading || undefined,
    'aria-describedby': describedByIds,
    onBlur,
    onFocus,
  };

  let control: ReactNode;
  if (isOtp) {
    control = (
      <InputOTP
        {...common}
        maxLength={otpLength}
        value={current}
        inputMode="numeric"
        autoComplete={autoComplete ?? 'one-time-code'}
        pattern="^\d+$"
        pasteTransformer={(pasted) => digitsOnly(pasted).slice(0, otpLength)}
        onInput={(e) => onChange?.(e as unknown as ChangeEvent<HTMLInputElement>)}
        onChange={(next: string) => {
          if (disabled || readOnly) return;
          commit(digitsOnly(next).slice(0, otpLength));
        }}
        containerClassName={cn(
          fieldShellVariants({ size, invalid, disabled }),
          'gap-2 px-2',
          size === 'md' ? 'py-1.5' : 'py-2',
        )}
      >
        {Array.from({ length: otpLength }, (_, i) => (
          <InputOTPSlot key={i} index={i} invalid={invalid} />
        ))}
      </InputOTP>
    );
  } else {
    const attrs = VARIANT_ATTRS[variant] ?? VARIANT_ATTRS.text;
    const leading = iconStart ?? (variant === 'search' ? 'search' : undefined);
    control = (
      <div
        data-hg-state={invalid ? 'error' : undefined}
        data-disabled={disabled || undefined}
        className={fieldShellVariants({ size, invalid, disabled })}
      >
        {leading ? (
          <span className="inline-flex shrink-0 text-fg-tertiary">
            <Icon name={leading} size="md" />
          </span>
        ) : null}
        {variant === 'tel' && !prefix ? (
          <span aria-hidden="true" className="shrink-0 text-body-md text-fg-secondary tabular-nums">
            +1
          </span>
        ) : null}
        {prefix ? <span className="inline-flex shrink-0 text-body-md text-fg-secondary">{prefix}</span> : null}
        <LibInput
          {...common}
          {...attrs}
          value={current}
          onChange={handleChange}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete ?? attrs.autoComplete}
          inputMode={inputMode ?? attrs.inputMode}
          className={cn(variant === 'tel' || variant === 'numeric' ? 'tabular-nums' : undefined)}
        />
        {loading ? (
          <span className="inline-flex shrink-0 text-fg-tertiary">
            <Spinner size="sm" decorative />
          </span>
        ) : null}
        {success && !loading && !invalid ? (
          <span className="inline-flex shrink-0 text-feedback-success-text">
            <Icon name="check" size="md" accessibilityLabel="Valid" />
          </span>
        ) : null}
        {suffix ? <span className="inline-flex shrink-0 text-body-md text-fg-secondary">{suffix}</span> : null}
      </div>
    );
  }

  return (
    <div data-testid={testId ?? 'Input'} data-variant={variant} className="grid gap-1" style={style}>
      <Label htmlFor={ids.control} id={ids.label} required={required}>
        {label}
      </Label>
      {control}
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {errorText}
        </FieldMessage>
      ) : null}
      {counted && limit ? <CharacterCounter id={ids.count} length={current.length} limit={limit} /> : null}
      <LiveMessage>{announcement}</LiveMessage>
    </div>
  );
}
