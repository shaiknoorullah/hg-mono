/**
 * `MoneyInput` (approval packet P21; drawn on `admin/refunds/Refunds` and
 * `admin/orders/Refunds`): a dollars-and-cents amount that the caller receives as INTEGER CENTS
 * only ([money is int64 minor units, invariant 3](AGENTS.md §3)). Proposed: exported from
 * `@hg/ui-web/proposed` until the owner approves the packet.
 *
 * - The text is parsed as two digit strings split on the decimal point, never through
 *   `parseFloat` or `Number("12.5")`, so "0.29" is exactly 29 and no input can produce a
 *   fractional value. Anything that is not `digits[.d|.dd]` is a format error and yields null.
 * - The limit (`maxCents`) is shown through `Price` in the helper line; above it the field
 *   shows an error and yields null.
 * - On blur a valid amount is rewritten in full ("12.5" → "12.50").
 * - Display only: the server still prices and limits every refund.
 */

import { useEffect, useState, type CSSProperties } from 'react';

import type { Cents } from '@hg/api-client';

import { Input as LibInput, fieldShellVariants } from '../lib/ui/input.js';
import { Label } from '../lib/ui/label.js';
import { FieldMessage, describedBy, useFieldIds } from '../ds/field-parts.js';
import { Price } from '../ds/index.js';

/** Props of the proposed `MoneyInput` (P21). */
export interface MoneyInputProps {
  label: string;
  valueCents: Cents | null;
  /** Integer cents, or null when the field is empty or invalid. Never a fraction. */
  onValueChange: (cents: Cents | null) => void;
  /** The largest amount allowed, in cents. */
  maxCents?: Cents;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg' | 'field';
  id?: string;
  name?: string;
  testId?: string;
  style?: CSSProperties;
}

/** The outcome of parsing typed money. */
export type MoneyParse =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'ok'; cents: Cents };

const MONEY_PATTERN = /^(\d{1,9})?(?:\.(\d{0,2}))?$/;

/**
 * Parses "12", "12.5", "12.50", ".75" or "$12.50" into integer cents using integer arithmetic
 * on the digit strings only. Commas, signs, exponents, more than two decimals or more than nine
 * whole digits are invalid.
 */
export function parseMoneyInput(text: string): MoneyParse {
  const trimmed = text.trim().replace(/^\$/, '').trim();
  if (trimmed === '') return { kind: 'empty' };
  const m = MONEY_PATTERN.exec(trimmed);
  if (!m || (m[1] === undefined && (m[2] === undefined || m[2] === ''))) return { kind: 'invalid' };
  const whole = m[1] === undefined ? 0 : Number.parseInt(m[1], 10);
  const fraction = m[2] ? Number.parseInt(m[2].padEnd(2, '0'), 10) : 0;
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return { kind: 'invalid' };
  return { kind: 'ok', cents: cents as Cents };
}

/** "12.50" for 1250 cents: integer division and remainder, no float. */
export function formatCentsPlain(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `${whole}.${String(rest).padStart(2, '0')}`;
}

/** A dollars-and-cents field that only ever emits integer cents. */
export function MoneyInput({
  label,
  valueCents,
  onValueChange,
  maxCents,
  helperText,
  errorText,
  required = false,
  disabled = false,
  size = 'md',
  id,
  name,
  testId,
  style,
}: MoneyInputProps) {
  const ids = useFieldIds(id, 'money');
  const [text, setText] = useState(valueCents === null ? '' : formatCentsPlain(valueCents));
  const parsed = parseMoneyInput(text);

  // Follow a new value from outside, not our own echo of it.
  useEffect(() => {
    const own = parsed.kind === 'ok' ? parsed.cents : null;
    if (valueCents !== own) setText(valueCents === null ? '' : formatCentsPlain(valueCents));
  }, [valueCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const overMax = parsed.kind === 'ok' && typeof maxCents === 'number' && parsed.cents > maxCents;
  const ownError =
    parsed.kind === 'invalid'
      ? 'Enter dollars and cents, like 12.50.'
      : overMax
        ? `The most you can enter is $${formatCentsPlain(maxCents!)}.`
        : null;
  const message = errorText ?? ownError;
  const invalid = Boolean(message);
  const limitId = `${ids.control}-limit`;

  const change = (next: string) => {
    if (disabled) return;
    setText(next);
    const p = parseMoneyInput(next);
    const over = p.kind === 'ok' && typeof maxCents === 'number' && p.cents > maxCents;
    const result = p.kind === 'ok' && !over ? p.cents : null;
    if (result !== valueCents) onValueChange(result);
  };

  return (
    <div data-testid={testId ?? 'MoneyInput'} className="grid gap-1" style={style}>
      <Label htmlFor={ids.control} id={ids.label} required={required}>
        {label}
      </Label>
      <div
        data-hg-state={invalid ? 'error' : undefined}
        data-disabled={disabled || undefined}
        className={fieldShellVariants({ size, invalid, disabled })}
      >
        <span aria-hidden="true" className="shrink-0 text-body-md text-fg-secondary">
          $
        </span>
        <LibInput
          id={ids.control}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          readOnly={disabled}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-disabled={disabled || undefined}
          aria-describedby={describedBy(helperText && ids.helper, typeof maxCents === 'number' && limitId, invalid && ids.error)}
          onChange={(e) => change(e.target.value)}
          onBlur={() => {
            if (parsed.kind === 'ok') setText(formatCentsPlain(parsed.cents));
          }}
          className="tabular-nums"
        />
        <span aria-hidden="true" className="shrink-0 text-body-sm text-fg-secondary">
          CAD
        </span>
      </div>
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      {typeof maxCents === 'number' ? (
        <p id={limitId} className="m-0 flex items-center gap-1 text-body-sm text-fg-secondary">
          Up to <Price cents={maxCents} size="sm" />
        </p>
      ) : null}
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {message}
        </FieldMessage>
      ) : null}
    </div>
  );
}
