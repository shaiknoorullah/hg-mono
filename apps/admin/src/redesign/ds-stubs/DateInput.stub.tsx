/**
 * TEMPORARY stub until @hg/ui-web/ds ships DateInput (ds-request issue TBD; tracked under #193).
 * Props follow the canvases' drawing (transcription "Issued on" / "Expires on", order date
 * filters: a date typed as day, month and year in one field, never a picker alone).
 *
 * A `<fieldset>` whose legend is the label, with three numeric boxes (Day, Month, Year).
 * The value is an ISO calendar date `yyyy-mm-dd`, or `null` while incomplete or impossible
 * (31 February). `errorText` (after submit) sets aria-invalid on the boxes and is linked.
 */
import { useEffect, useId, useState } from 'react';

import { cx } from './internal/cx';

export interface DateInputProps {
  label: string;
  /** ISO `yyyy-mm-dd`, or '' / null for empty. */
  value: string | null;
  /** The ISO date when the three parts make a real date, else null. */
  onValueChange: (value: string | null) => void;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Prefix for the three inputs' names (`{name}-day` …). */
  name?: string;
  hideLabel?: boolean;
  className?: string;
  testId?: string;
}

interface Parts {
  day: string;
  month: string;
  year: string;
}

function split(value: string | null): Parts {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return m ? { year: m[1]!, month: String(Number(m[2])), day: String(Number(m[3])) } : { day: '', month: '', year: '' };
}

/** The ISO date for day/month/year strings, or null if incomplete or not a real date. */
export function composeIsoDate(parts: Parts): string | null {
  if (!/^\d{1,2}$/.test(parts.day) || !/^\d{1,2}$/.test(parts.month) || !/^\d{4}$/.test(parts.year)) return null;
  const d = Number(parts.day);
  const m = Number(parts.month);
  const y = Number(parts.year);
  if (m < 1 || m > 12 || d < 1) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function DateInput({
  label,
  value,
  onValueChange,
  helperText,
  errorText,
  required,
  disabled,
  readOnly,
  name,
  hideLabel,
  className,
  testId = 'DateInput',
}: DateInputProps): React.JSX.Element {
  const id = useId();
  const [parts, setParts] = useState<Parts>(() => split(value));

  // Follow an outside change (a reset, a loaded record) without fighting the user's typing.
  useEffect(() => {
    if ((value || null) !== composeIsoDate(parts)) setParts(split(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (key: keyof Parts, raw: string) => {
    const next = { ...parts, [key]: raw.replace(/\D/g, '').slice(0, key === 'year' ? 4 : 2) };
    setParts(next);
    onValueChange(composeIsoDate(next));
  };

  const describedBy = [helperText ? `${id}-helper` : '', errorText ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const box = (key: keyof Parts, text: string, width: string) => (
    <label className="flex flex-col gap-1 text-body-sm text-fg-secondary">
      {text}
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        name={name ? `${name}-${key}` : undefined}
        value={parts[key]}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={describedBy}
        maxLength={key === 'year' ? 4 : 2}
        onChange={(e) => update(key, e.target.value)}
        className={cx(
          'hg-focus-field h-11 rounded-md border bg-control-bg px-3 text-body-md text-fg-primary',
          width,
          errorText ? 'border-feedback-danger-border' : 'border-control-border',
          readOnly && 'bg-surface-subtle',
        )}
      />
    </label>
  );

  return (
    <fieldset data-testid={testId} className={cx('flex flex-col gap-1 border-0 p-0', className)} aria-describedby={describedBy}>
      <legend className={cx('mb-1 text-label-md text-fg-primary', hideLabel && 'sr-only')}>
        {label}
        {required ? <span aria-hidden="true">{' *'}</span> : null}
      </legend>
      {helperText ? (
        <p id={`${id}-helper`} className="text-body-sm text-fg-secondary">
          {helperText}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        {box('day', 'Day', 'w-16')}
        {box('month', 'Month', 'w-16')}
        {box('year', 'Year', 'w-24')}
      </div>
      {errorText ? (
        <p id={`${id}-error`} className="text-body-sm text-feedback-danger-text">
          {errorText}
        </p>
      ) : null}
    </fieldset>
  );
}
