import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type ChangeEvent,
} from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS_WITHIN } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * Input — 02-components.md §3.
 *
 * `label` is required and always visible. Placeholder-as-label is banned;
 * the type below makes it impossible to omit the label.
 *
 * States (all implemented): default (border.interactive 1px) · hover
 * (border.strong) · focus-visible (2px border.brand + two-layer ring) ·
 * active/pressed n/a for a text field, stated explicitly · disabled
 * (surface.subtle fill + disabledOpacity) · loading (trailing spinner, field
 * stays editable unless readOnly) · error (2px danger border, errorText below
 * with an alert-circle icon, role=alert, aria-invalid, aria-describedby) ·
 * success (a check in success.text — NO green fill, RULE H-1).
 */

export type InputVariant =
  | 'text'
  | 'email'
  | 'tel'
  | 'numeric'
  | 'password'
  | 'search'
  | 'otp';

const OTP_LENGTH = 6;

/** variant → DOM type / inputMode / autoComplete defaults. */
const VARIANT_ATTRS: Record<
  InputVariant,
  { type: string; inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']; autoComplete?: string }
> = {
  text: { type: 'text' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  tel: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
  numeric: { type: 'text', inputMode: 'numeric' },
  password: { type: 'password', autoComplete: 'current-password' },
  search: { type: 'search' },
  // 04-accessibility.md §10.2 — OTP fields accept paste.
  otp: { type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code' },
};

interface InputOwnProps {
  /** Required and always rendered. Never a placeholder standing in for a label. */
  label: string;
  variant?: InputVariant;
  size?: 'md' | 'lg';
  helperText?: string;
  /** Presence of `errorText` IS the error state. */
  errorText?: string;
  /** Renders a check in success.text. Never a green fill (RULE H-1). */
  success?: boolean;
  loading?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  characterCount?: boolean;
  fullWidth?: boolean;
  className?: string;
  /** Visually hides the label. It stays in the accessibility tree. */
  labelHidden?: boolean;
  /** Alias of `labelHidden`, matching the name the other tiers use. */
  hideLabel?: boolean;
  /**
   * Value-first, matching every other control in the inventory (`Select`,
   * `Checkbox`, `Switch`). The raw event is passed second for the rare caller
   * that needs it.
   */
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
}

export type InputProps = InputOwnProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, keyof InputOwnProps | 'type' | 'onChange'>;

const SIZE: Record<'md' | 'lg', string> = {
  md: 'h-11 text-body-md',
  lg: 'h-13 text-body-lg',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    variant = 'text',
    size = 'md',
    helperText,
    errorText,
    success = false,
    loading = false,
    disabled = false,
    readOnly = false,
    required = false,
    prefix,
    suffix,
    characterCount = false,
    fullWidth = true,
    className,
    labelHidden = false,
    hideLabel = false,
    maxLength,
    value,
    onChange,
    id: idProp,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `hg-input-${autoId}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;

  const invalid = Boolean(errorText);
  const attrs = VARIANT_ATTRS[variant];
  const length = typeof value === 'string' ? value.length : 0;
  const otp = variant === 'otp';
  const limit = otp ? (maxLength ?? OTP_LENGTH) : maxLength;

  const describedBy =
    cx(
      helperText ? helperId : '',
      invalid ? errorId : '',
      characterCount && limit ? countId : '',
    ).trim() || undefined;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (otp) {
      // Paste-aware: strip anything that is not a digit before it reaches state.
      event.target.value = event.target.value.replace(/\D/g, '').slice(0, limit);
    }
    onChange?.(event.target.value, event);
  };

  const field = (
    <input
      ref={ref}
      id={id}
      type={attrs.type}
      inputMode={attrs.inputMode}
      autoComplete={attrs.autoComplete}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      readOnly={readOnly}
      required={required}
      maxLength={limit}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      aria-busy={loading || undefined}
      data-testid="hg-input"
      data-variant={variant}
      className={cx(
        'w-full bg-transparent outline-none',
        'text-fg-primary placeholder:text-fg-placeholder',
        'disabled:cursor-not-allowed',
        otp && 'text-center font-mono tracking-[0.75em] caret-transparent',
      )}
      {...rest}
    />
  );

  return (
    <div
      className={cx('flex flex-col gap-1', fullWidth && 'w-full', className)}
      data-testid="hg-input-field"
    >
      <label
        htmlFor={id}
        className={cx(
          'text-label-md text-fg-secondary',
          (labelHidden || hideLabel) && 'sr-only',
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
        data-hg-state={
          invalid ? 'error' : disabled ? 'disabled' : loading ? 'loading' : 'default'
        }
        className={cx(
          'group relative flex items-center gap-2 rounded-sm px-3',
          'bg-control-bg text-fg-primary',
          'border transition-colors duration-[var(--hg-duration-fast)] ease-standard',
          SIZE[size],
          HG_FOCUS_WITHIN,
          'focus-within:border-2 focus-within:border-line-brand focus-within:px-[calc(var(--hg-space-3)-1px)]',
          invalid
            ? 'border-2 border-feedback-danger-border px-[calc(var(--hg-space-3)-1px)]'
            : 'border-line-interactive hover:border-line-strong',
          disabled &&
            'cursor-not-allowed bg-surface-subtle opacity-(--hg-state-disabled-opacity) hover:border-line-interactive',
        )}
      >
        {prefix ? (
          <span aria-hidden="true" className="shrink-0 text-fg-tertiary">
            {prefix}
          </span>
        ) : null}

        {otp ? (
          <span className="relative flex w-full items-center">
            {field}
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex gap-2">
              {Array.from({ length: limit ?? OTP_LENGTH }, (_, i) => (
                <span
                  key={i}
                  data-hg-otp-cell={i}
                  className="flex-1 rounded-xs border border-line-interactive"
                />
              ))}
            </span>
          </span>
        ) : (
          field
        )}

        {loading ? <Spinner size="sm" decorative /> : null}
        {invalid ? (
          <AlertCircle
            aria-hidden="true"
            className="shrink-0 text-feedback-danger-icon"
            size={20}
          />
        ) : null}
        {success && !invalid ? (
          <Check aria-hidden="true" className="shrink-0 text-feedback-success-text" size={20} />
        ) : null}
        {suffix ? (
          <span aria-hidden="true" className="shrink-0 text-fg-tertiary">
            {suffix}
          </span>
        ) : null}
      </div>

      {helperText && !invalid ? (
        <p id={helperId} className="text-body-sm text-fg-tertiary">
          {helperText}
        </p>
      ) : null}

      {invalid ? (
        // Never colour-only: icon + text, and assertive so it is heard.
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-body-sm text-feedback-danger-text"
        >
          <AlertCircle aria-hidden="true" size={16} className="shrink-0" />
          {errorText}
        </p>
      ) : null}

      {characterCount && limit ? (
        <p
          id={countId}
          // Announces remaining characters at 80% and at the limit; silent below.
          aria-live={length >= limit * 0.8 ? 'polite' : 'off'}
          className="text-body-sm text-fg-tertiary self-end"
          data-hg-numeric="tabular"
        >
          {length} / {limit}
        </p>
      ) : null}
    </div>
  );
});
