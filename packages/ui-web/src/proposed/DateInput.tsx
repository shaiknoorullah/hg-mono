/**
 * `DateInput` (approval packet P20): a date typed as day / month / year in three labelled
 * fields, never a picker-only control. Drawn on `rider/sign-in-onboarding/Profile-Underage`,
 * `rider/payouts-account/Account-Replace-TooSoon` and `admin/orders/OrdersGrid`. Proposed:
 * exported from `@hg/ui-web/proposed` until the owner approves the packet.
 *
 * - A `<fieldset role="group">` named by its visible legend; the three fields are Day, Month
 *   and Year, numeric, with their own visible labels.
 * - `value` is `YYYY-MM-DD` or null. `onValueChange` receives a date only when all three parts
 *   make a real calendar date inside `min`/`max`; otherwise null.
 * - States: empty, partial (no error while typing), sub-field invalid (that field marked, the
 *   message on the group), not a real date, out of range, server error (`errorText`, e.g. the
 *   422 UNDERAGE response), disabled (focusable, `aria-disabled`).
 */

import { useEffect, useState, type CSSProperties } from 'react';

import { Input as LibInput, fieldShellVariants } from '../lib/ui/input.js';
import { Label } from '../lib/ui/label.js';
import { cn } from '../lib/utils.js';
import { FieldMessage, describedBy, useFieldIds } from '../ds/field-parts.js';

/** Props of the proposed `DateInput` (P20). */
export interface DateInputProps {
  label: string;
  /** YYYY-MM-DD, or null. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Earliest allowed date, YYYY-MM-DD. */
  min?: string;
  /** Latest allowed date, YYYY-MM-DD. */
  max?: string;
  helperText?: string;
  /** A server error (e.g. 422 UNDERAGE); shown on the group and marks every part. */
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Shown, focusable and not editable. */
  readOnly?: boolean;
  /** Visually hides the legend (it still names the group), e.g. in a filter row. */
  hideLabel?: boolean;
  /** Adds a hidden form input carrying the YYYY-MM-DD value. */
  name?: string;
  /** Base id; the parts are `{id}-day`, `{id}-month`, `{id}-year`. Defaults to a useId() value. */
  id?: string;
  size?: 'md' | 'lg' | 'field';
  testId?: string;
  style?: CSSProperties;
}

interface Parts {
  day: string;
  month: string;
  year: string;
}

type PartKey = keyof Parts;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function split(value: string | null): Parts {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return { day: '', month: '', year: '' };
  return { day: String(Number(m[3])), month: String(Number(m[2])), year: m[1]! };
}

/** "20 Oct 2026" for a YYYY-MM-DD string (the form the canvases write dates in messages). */
export function formatDateShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`;
}

/** The result of checking three typed parts. */
export interface DateCheck {
  /** The ISO date when the parts are complete, real and in range. */
  value: string | null;
  /** The message for the group, or null (empty and partial input have none). */
  error: string | null;
  /** The parts to mark invalid. */
  invalid: PartKey[];
}

/** Validates typed day/month/year parts against the calendar and `min`/`max`. */
export function checkDateParts(parts: Parts, min?: string, max?: string): DateCheck {
  const { day, month, year } = parts;
  const none: DateCheck = { value: null, error: null, invalid: [] };
  if (!day && !month && !year) return none;
  const d = day ? Number(day) : null;
  const mo = month ? Number(month) : null;
  if (d !== null && (d < 1 || d > 31)) return { value: null, error: 'Day must be 1 to 31.', invalid: ['day'] };
  if (mo !== null && (mo < 1 || mo > 12)) return { value: null, error: 'Month must be 1 to 12.', invalid: ['month'] };
  if (!day || !month || !year) return none;
  if (year.length !== 4) return { value: null, error: 'Year must have 4 digits, like 1990.', invalid: ['year'] };
  const y = Number(year);
  const probe = new Date(Date.UTC(y, mo! - 1, d!));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo! - 1 || probe.getUTCDate() !== d) {
    return { value: null, error: `${MONTHS[mo! - 1]} ${y} has no day ${d}.`, invalid: ['day'] };
  }
  const iso = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (min && iso < min) return { value: null, error: `Enter a date on or after ${formatDateShort(min)}.`, invalid: ['day', 'month', 'year'] };
  if (max && iso > max) return { value: null, error: `Enter a date on or before ${formatDateShort(max)}.`, invalid: ['day', 'month', 'year'] };
  return { value: iso, error: null, invalid: [] };
}

const PARTS: Array<{ key: PartKey; label: string; length: number; width: string; placeholder: string }> = [
  { key: 'day', label: 'Day', length: 2, width: 'w-16', placeholder: 'DD' },
  { key: 'month', label: 'Month', length: 2, width: 'w-16', placeholder: 'MM' },
  { key: 'year', label: 'Year', length: 4, width: 'w-24', placeholder: 'YYYY' },
];

/** A date typed as day / month / year, validated against the calendar and a range. */
export function DateInput({
  label,
  value,
  onValueChange,
  min,
  max,
  helperText,
  errorText,
  required = false,
  disabled = false,
  readOnly = false,
  hideLabel = false,
  name,
  id,
  size = 'md',
  testId,
  style,
}: DateInputProps) {
  const ids = useFieldIds(id, 'dateinput');
  const [parts, setParts] = useState<Parts>(() => split(value));
  const check = checkDateParts(parts, min, max);

  // Follow a new value from outside (a reset, a server load), not our own echo of it.
  useEffect(() => {
    if (value !== check.value && (value !== null || check.value !== null)) setParts(split(value));
  }, [value]);

  const message = errorText ?? check.error;
  const invalidParts = errorText ? (['day', 'month', 'year'] as PartKey[]) : check.invalid;

  const update = (key: PartKey, raw: string, length: number) => {
    if (disabled || readOnly) return;
    const next = { ...parts, [key]: raw.replace(/\D+/g, '').slice(0, length) };
    setParts(next);
    const result = checkDateParts(next, min, max).value;
    if (result !== value) onValueChange(result);
  };

  return (
    <fieldset
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={describedBy(helperText && ids.helper, message && ids.error)}
      aria-disabled={disabled || undefined}
      data-testid={testId ?? 'DateInput'}
      className="m-0 grid min-w-0 gap-1 border-0 p-0"
      style={style}
    >
      <legend id={ids.label} className={cn('mb-1 p-0 text-label-md font-semibold text-fg-secondary', hideLabel && 'sr-only')}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-line-brand">
            {' *'}
          </span>
        ) : null}
      </legend>
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      <div className="flex flex-wrap items-end gap-3">
        {PARTS.map((p) => {
          const partId = `${ids.control}-${p.key}`;
          const bad = invalidParts.includes(p.key);
          return (
            <div key={p.key} className="grid gap-1">
              <Label htmlFor={partId} className="text-body-sm font-normal">
                {p.label}
              </Label>
              <div
                data-hg-state={bad ? 'error' : undefined}
                className={cn(fieldShellVariants({ size, invalid: bad, disabled }), p.width)}
              >
                <LibInput
                  id={partId}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={p.length}
                  placeholder={p.placeholder}
                  value={parts[p.key]}
                  readOnly={disabled || readOnly}
                  required={required}
                  aria-required={required || undefined}
                  aria-invalid={bad || undefined}
                  aria-disabled={disabled || undefined}
                  aria-describedby={describedBy(message && ids.error)}
                  onChange={(e) => update(p.key, e.target.value, p.length)}
                  className="tabular-nums"
                />
              </div>
            </div>
          );
        })}
      </div>
      {message ? (
        <FieldMessage id={ids.error} error>
          {message}
        </FieldMessage>
      ) : null}
      {name ? <input type="hidden" name={name} value={check.value ?? ''} /> : null}
    </fieldset>
  );
}
