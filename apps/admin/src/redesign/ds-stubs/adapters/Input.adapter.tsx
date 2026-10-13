/**
 * ADAPTER: live design-system `Input` -> `@hg/ui-web` `Input`.
 *
 * Live differences handled here: `onChange(event)` is the DOM event and `onValueChange(value)`
 * the cleaned value (digits only for `numeric` / `otp`), where legacy has a single
 * `onChange(value, event)`; `errorText: null` means no error; `iconStart` is a Solar name
 * (drawn in the legacy prefix slot); `testId`. The label is always visible.
 *
 * Drawing differences handled here, so fields match the live DS and the boards:
 * - the field fill is `surface.raised` (white), not the legacy cream `control.bg`; a read-only
 *   field (the in-flight state) is `surface.subtle`; helper text is `text.secondary` (contrast);
 * - `otp` is drawn as the live DS draws it: ONE outlined field, fit to its content (~270px),
 *   holding six filled `surface.sunken` cells over ONE real `<input>` (autoComplete
 *   one-time-code, paste-aware, digits only). The outline takes the danger colour on error.
 *   Legacy draws six separately outlined inputs across the full width.
 */
import {
  forwardRef,
  useId,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Input as LegacyInput } from '@hg/ui-web';

import { cx } from '../internal/cx';
import { Icon, type AnyIconName } from './Icon.adapter';

export interface InputProps {
  label: string;
  variant?: 'text' | 'email' | 'tel' | 'numeric' | 'password' | 'search' | 'otp';
  size?: 'md' | 'lg';
  value?: string;
  defaultValue?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
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
  iconStart?: AnyIconName;
  maxLength?: number;
  characterCount?: boolean;
  autoComplete?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  id?: string;
  testId?: string;
  style?: CSSProperties;
  className?: string;
  /** App-side extensions until the DS ships them. */
  name?: string;
  hideLabel?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  'aria-describedby'?: string;
}

export function cleanInputValue(variant: InputProps['variant'], raw: string): string {
  return variant === 'numeric' || variant === 'otp' ? raw.replace(/\D/g, '') : raw;
}

/**
 * White fill on every enabled field; read-only (in flight) reads as `surface.subtle`. Helper
 * text is `text.secondary`: legacy `text.tertiary` is under 4.5:1 on the white card.
 */
const FIELD_FILL = cx(
  '[&_[data-hg-state]:not([data-hg-state=disabled])]:bg-surface-raised',
  '[&_[data-hg-state]:has(input:read-only)]:bg-surface-subtle',
  '[&_[id$=-helper]]:text-fg-secondary',
);

const OTP_LENGTH = 6;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { onChange, onValueChange, errorText, iconStart, prefix, testId = 'Input', variant = 'text', className, ...rest },
  ref,
) {
  if (variant === 'otp') {
    return (
      <div data-testid={testId} className="contents">
        <OtpField ref={ref} {...rest} className={className} errorText={errorText} onChange={onChange} onValueChange={onValueChange} />
      </div>
    );
  }
  return (
    <div data-testid={testId} className="contents">
      <LegacyInput
        ref={ref}
        {...rest}
        className={cx(FIELD_FILL, className)}
        variant={variant}
        {...(errorText ? { errorText } : {})}
        prefix={iconStart ? <Icon name={iconStart} size="md" /> : prefix}
        onChange={(value, event) => {
          onChange?.(event);
          onValueChange?.(cleanInputValue(variant, value));
        }}
      />
    </div>
  );
});

type OtpFieldProps = Omit<InputProps, 'variant' | 'iconStart' | 'prefix' | 'suffix' | 'testId'>;

/** The live DS `otp` drawing: six cells over one real field. */
const OtpField = forwardRef<HTMLInputElement, OtpFieldProps>(function OtpField(
  {
    label,
    value,
    defaultValue,
    onChange,
    onValueChange,
    helperText,
    errorText,
    required = false,
    disabled = false,
    readOnly = false,
    hideLabel = false,
    id: idProp,
    name,
    autoFocus,
    onBlur,
    style,
    className,
    'aria-describedby': describedByProp,
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `hg-input-${autoId}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const [inner, setInner] = useState(() => cleanInputValue('otp', defaultValue ?? '').slice(0, OTP_LENGTH));
  const val = value ?? inner;
  const invalid = Boolean(errorText);
  const describedBy =
    [describedByProp, helperText && !invalid ? helperId : null, invalid ? errorId : null].filter(Boolean).join(' ') ||
    undefined;
  const quiet = disabled || readOnly;

  return (
    <div className={cx('flex flex-col gap-1', className)} style={style}>
      <label
        id={`${id}-label`}
        htmlFor={id}
        className={cx(
          'text-label-md text-fg-secondary',
          hideLabel && 'sr-only',
          disabled && 'opacity-(--hg-state-disabled-opacity)',
        )}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-feedback-danger-text">
            {' *'}
          </span>
        ) : null}
      </label>
      <div
        data-hg-state={invalid ? 'error' : disabled ? 'disabled' : 'default'}
        className={cx(
          'hg-focus-field relative flex h-11 w-fit items-center gap-2 rounded-md px-2',
          'border transition-colors duration-[var(--hg-duration-fast)] ease-standard',
          quiet ? 'bg-surface-subtle' : 'bg-surface-raised',
          invalid
            ? 'border-2 border-feedback-danger-border px-[calc(var(--hg-space-2)-1px)]'
            : 'border-line-interactive hover:border-line-strong',
          disabled && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity) hover:border-line-interactive',
        )}
      >
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            data-hg-otp-cell={i}
            className={cx(
              'grid h-8 w-9 place-items-center rounded-sm text-heading-md font-semibold tabular-nums',
              quiet ? 'text-fg-secondary' : 'bg-surface-sunken text-fg-primary',
            )}
          >
            {val[i] ?? ''}
          </span>
        ))}
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={OTP_LENGTH}
          value={val}
          onChange={(event) => {
            const next = cleanInputValue('otp', event.target.value).slice(0, OTP_LENGTH);
            if (value === undefined) setInner(next);
            onChange?.(event);
            onValueChange?.(next);
          }}
          onBlur={onBlur}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          autoFocus={autoFocus}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          data-testid="hg-input"
          data-variant="otp"
          className="absolute inset-0 h-full w-full cursor-text border-0 bg-transparent text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
        />
      </div>
      {helperText && !invalid ? (
        <p id={helperId} className="m-0 text-body-sm text-fg-secondary">
          {helperText}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} role="alert" className="m-0 flex items-center gap-1 text-body-sm text-feedback-danger-text">
          <Icon name="error" size="sm" />
          {errorText}
        </p>
      ) : null}
    </div>
  );
});
