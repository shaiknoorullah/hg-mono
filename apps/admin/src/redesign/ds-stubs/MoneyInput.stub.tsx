/**
 * TEMPORARY stub until @hg/ui-web/ds ships MoneyInput (ds-request issue TBD; tracked under #193).
 * Props follow the canvases' drawing (the refund panel's goodwill amount: dollars typed,
 * integer cents sent).
 *
 * The admin types dollars ("12.40", "12.4", "$1,250", "12"); the component reports INTEGER
 * CENTS through `onValueChange(cents | null)`. Parsing is string arithmetic on the digits:
 * there is never a float in the value. A fraction of a cent ("12.405"), a negative, letters
 * or an empty field report `null`. Its own format message shows only when `showErrors` is
 * set (after submit) or the caller passes `errorText`. This is the ONLY amount the client
 * ever sends (goodwill `amount_cents`); never compute a refund or residual with it.
 */
import { forwardRef, useEffect, useId, useState } from 'react';

import { cx } from './internal/cx';

export interface MoneyInputProps {
  label: string;
  /** Integer cents, or null for empty/invalid. */
  valueCents: number | null;
  onValueChange: (cents: number | null) => void;
  helperText?: string;
  /** A caller error (e.g. "More than the order total"), shown as given. */
  errorText?: string | null;
  /** Show the built-in format error (set after submit). */
  showErrors?: boolean;
  /** Message for an unreadable amount. */
  formatErrorText?: string;
  /** Upper bound in cents (validation stays the form's job; used for aria-describedby copy only). */
  maxCents?: number;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  id?: string;
  className?: string;
  testId?: string;
}

const MAX_DOLLAR_DIGITS = 9;

/**
 * "12.40" -> 1240, "12.4" -> 1240, "$1,250" -> 125000, "0.05" -> 5. Returns null for
 * anything else, including "12.405", "-3", "1e3" and "". No floating point is involved.
 */
export function parseDollarsToCents(input: string): number | null {
  const s = input.trim().replace(/^\$\s*/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  if (whole === '' && frac === '') return null;
  if (whole.length > MAX_DOLLAR_DIGITS) return null;
  const dollars = whole === '' ? 0 : Number.parseInt(whole, 10);
  const centsPart = frac === '' ? 0 : Number.parseInt(frac.padEnd(2, '0'), 10);
  return dollars * 100 + centsPart;
}

/** 1240 -> "12.40" for display in the field (no currency sign; the field has a "$" prefix). */
export function centsToDollarsText(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  {
    label,
    valueCents,
    onValueChange,
    helperText,
    errorText,
    showErrors = false,
    formatErrorText = 'Enter an amount in dollars and cents, like 12.40.',
    required,
    disabled,
    readOnly,
    name,
    id: idProp,
    className,
    testId = 'MoneyInput',
  },
  ref,
) {
  const auto = useId();
  const id = idProp ?? `money-${auto}`;
  const [text, setText] = useState(() => (valueCents === null ? '' : centsToDollarsText(valueCents)));

  // Follow an outside reset without rewriting what the admin is typing.
  useEffect(() => {
    if (valueCents === null) {
      if (parseDollarsToCents(text) !== null) setText('');
    } else if (parseDollarsToCents(text) !== valueCents) {
      setText(centsToDollarsText(valueCents));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCents]);

  const unreadable = text.trim() !== '' && parseDollarsToCents(text) === null;
  const shownError = errorText || (showErrors && unreadable ? formatErrorText : null);
  const describedBy = [helperText ? `${id}-helper` : '', shownError ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div data-testid={testId} className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-label-md text-fg-primary">
        {label}
        {required ? <span aria-hidden="true">{' *'}</span> : null}
      </label>
      {helperText ? (
        <p id={`${id}-helper`} className="text-body-sm text-fg-secondary">
          {helperText}
        </p>
      ) : null}
      <div
        className={cx(
          'flex h-11 items-center gap-1 rounded-md border bg-control-bg px-3 focus-within:outline-2 focus-within:outline-focus-ring',
          shownError ? 'border-feedback-danger-border' : 'border-control-border',
          readOnly && 'bg-surface-subtle',
        )}
      >
        <span aria-hidden="true" className="text-body-md text-fg-secondary">
          $
        </span>
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            setText(e.target.value);
            onValueChange(parseDollarsToCents(e.target.value));
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-body-md tabular-nums text-fg-primary outline-none"
        />
        <span aria-hidden="true" className="text-body-sm text-fg-tertiary">
          CAD
        </span>
      </div>
      {shownError ? (
        <p id={`${id}-error`} className="text-body-sm text-feedback-danger-text">
          {shownError}
        </p>
      ) : null}
    </div>
  );
});
