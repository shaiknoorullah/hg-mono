import {
  forwardRef,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS_FIELD } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * Input — 02-components.md §3.
 *
 * `label` is required and always visible. Placeholder-as-label is banned;
 * the type below makes it impossible to omit the label.
 *
 * States (all implemented): default (border.interactive 1px) · hover
 * (border.strong) · focus-visible (the field's own border turns 2px in the
 * focus colour, no ring; an invalid field keeps its danger border and gets the
 * two-layer ring instead — docs/decisions/focus-indicator.md) ·
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

/**
 * The one-time-code field: `length` real one-digit boxes. Every box is its own
 * <input>, so a digit can only ever sit in the box it was typed into (the old
 * single input with letter-spacing drew digits across cells it did not own).
 *
 * Typing fills the box and advances · paste / OS one-time-code autofill spreads
 * across the boxes · Backspace clears (and steps back from an empty box) ·
 * arrows move · anything but 0-9 is dropped. A hidden input carries the joined
 * digits, so a <form> submits one value under `name`.
 */
function OtpBoxes({
  id,
  length,
  value,
  onChange,
  name,
  label,
  invalid,
  disabled,
  readOnly,
  required,
  describedBy,
  size,
  autoFocus,
}: {
  id: string;
  length: number;
  value: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  name?: string;
  label: string;
  invalid: boolean;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
  describedBy?: string;
  size: 'md' | 'lg';
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [cells, setCells] = useState<string[]>(() =>
    Array.from({ length }, (_, i) => value[i] ?? ''),
  );
  // Controlled from outside (reset, restore): adopt the prop when it differs.
  const joined = cells.join('');
  if (value !== joined && /^\d*$/.test(value)) {
    setCells(Array.from({ length }, (_, i) => value[i] ?? ''));
  }

  const focusBox = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string[], event: ChangeEvent<HTMLInputElement>) => {
    setCells(next);
    onChange?.(next.join(''), event);
  };

  /** Write `digits` into the boxes from `start`, then focus the next empty one. */
  const spread = (digits: string, start: number, event: ChangeEvent<HTMLInputElement>) => {
    const from = digits.length >= length ? 0 : start;
    const next = [...cells];
    let last = from;
    for (let k = 0; k < digits.length && from + k < length; k++) {
      next[from + k] = digits[k] as string;
      last = from + k;
    }
    commit(next, event);
    focusBox(last + 1);
  };

  const handleChange = (i: number) => (event: ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '');
    if (digits === '') {
      const next = [...cells];
      next[i] = '';
      commit(next, event);
      return;
    }
    // A box that already held a digit now holds two: keep the newly typed one.
    if (digits.length === 2 && cells[i] !== '' && length > 1) {
      const typed = digits[0] === cells[i] ? digits[1] : digits[0];
      spread(typed as string, i, event);
      return;
    }
    spread(digits, i, event);
  };

  const handlePaste = (i: number) => (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (digits === '') return;
    const from = digits.length >= length ? 0 : i;
    const next = [...cells];
    for (let k = 0; k < digits.length && from + k < length; k++) {
      next[from + k] = digits[k] as string;
    }
    setCells(next);
    // No ChangeEvent exists for a paste; hand the caller the target's own event shape.
    onChange?.(next.join(''), event as unknown as ChangeEvent<HTMLInputElement>);
    focusBox(Math.min(from + digits.length, length - 1));
  };

  const handleKeyDown = (i: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const target = cells[i] !== '' ? i : i - 1;
      if (target >= 0) {
        const next = [...cells];
        next[target] = '';
        setCells(next);
        onChange?.(next.join(''), event as unknown as ChangeEvent<HTMLInputElement>);
        focusBox(target);
      }
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(i - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(i + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusBox(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusBox(length - 1);
    }
  };

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex w-full gap-2">
      {name ? <input type="hidden" name={name} value={cells.join('')} /> : null}
      {cells.map((digit, i) => (
        <div
          key={i}
          data-hg-otp-cell={i}
          data-hg-state={invalid ? 'error' : disabled ? 'disabled' : 'default'}
          className={cx(
            'flex min-w-0 flex-1 items-center justify-center rounded-sm px-0',
            'bg-control-bg text-fg-primary border transition-colors duration-[var(--hg-duration-fast)] ease-standard',
            SIZE[size],
            HG_FOCUS_FIELD,
            invalid
              ? 'border-2 border-feedback-danger-border'
              : 'border-line-interactive hover:border-line-strong',
            disabled && 'cursor-not-allowed bg-surface-subtle opacity-(--hg-state-disabled-opacity)',
          )}
        >
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={i === 0 ? id : `${id}-${i}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={`${label}, digit ${i + 1} of ${length}`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            data-testid="hg-input"
            data-variant="otp"
            value={digit}
            onChange={handleChange(i)}
            onPaste={handlePaste(i)}
            onKeyDown={handleKeyDown(i)}
            onFocus={(e) => e.currentTarget.select()}
            disabled={disabled}
            readOnly={readOnly}
            required={required}
            autoFocus={autoFocus && i === 0}
            className="h-full w-full min-w-0 bg-transparent text-center font-mono outline-none disabled:cursor-not-allowed"
          />
        </div>
      ))}
    </div>
  );
}

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
        id={`${id}-label`}
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

      {otp ? (
        <OtpBoxes
          id={id}
          length={limit ?? OTP_LENGTH}
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          name={rest.name}
          label={label}
          invalid={invalid}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          describedBy={describedBy}
          size={size}
          autoFocus={rest.autoFocus}
        />
      ) : (
      <div
        data-hg-state={
          invalid ? 'error' : disabled ? 'disabled' : loading ? 'loading' : 'default'
        }
        className={cx(
          'group relative flex items-center gap-2 rounded-sm px-3',
          'bg-control-bg text-fg-primary',
          'border transition-colors duration-[var(--hg-duration-fast)] ease-standard',
          SIZE[size],
          HG_FOCUS_FIELD,
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

        {field}

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
      )}

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
