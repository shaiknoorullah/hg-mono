/**
 * `TimeField` (approval packet P20; drawn on `restaurant/menu-hours/HoursView`): a clock time
 * typed in 12-hour form (constitution gate item 10) as hour, minute and am/pm. Proposed:
 * exported from `@hg/ui-web/proposed` until the owner approves the packet.
 *
 * - A `<fieldset role="group">` named by its legend: Hour (1–12) and Minute (00–59) numeric
 *   fields with visible labels, and an am/pm SegmentedControl.
 * - `value` is 24-hour `HH:mm` (the wire form) or null; `onValueChange` gets `HH:mm` only when
 *   the time is complete and valid, otherwise null.
 * - The set time is read back through the one shared 12-hour formatter (`formatTime12h`), so
 *   it cannot drift from every other time on screen.
 * - `minuteStep` (e.g. 15) rejects minutes off the step with a message.
 */

import { useEffect, useState, type CSSProperties } from 'react';

import { Input as LibInput, fieldShellVariants } from '../lib/ui/input.js';
import { Label } from '../lib/ui/label.js';
import { cn } from '../lib/utils.js';
import { FieldMessage, describedBy, useFieldIds } from '../ds/field-parts.js';
import { SegmentedControl } from '../ds/SegmentedControl.js';
import { formatTime12h } from '../ds/time.js';

/** Props of the proposed `TimeField` (P20). */
export interface TimeFieldProps {
  label: string;
  /** 24-hour HH:mm, or null. */
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Minutes must be a multiple of this (e.g. 15). */
  minuteStep?: number;
  helperText?: string;
  errorText?: string | null;
  required?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg' | 'field';
  testId?: string;
  style?: CSSProperties;
}

interface TimeParts {
  hour: string;
  minute: string;
  period: 'am' | 'pm';
}

function split(value: string | null): TimeParts {
  const m = value ? /^(\d{2}):(\d{2})$/.exec(value) : null;
  if (!m) return { hour: '', minute: '', period: 'am' };
  const h24 = Number(m[1]);
  return { hour: String(h24 % 12 === 0 ? 12 : h24 % 12), minute: m[2]!, period: h24 >= 12 ? 'pm' : 'am' };
}

/** The result of checking typed 12-hour parts. */
export interface TimeCheck {
  value: string | null;
  error: string | null;
  invalid: Array<'hour' | 'minute'>;
}

/** Validates 12-hour parts and converts them to 24-hour HH:mm. */
export function checkTimeParts(parts: TimeParts, minuteStep?: number): TimeCheck {
  const { hour, minute, period } = parts;
  if (!hour && !minute) return { value: null, error: null, invalid: [] };
  const h = hour ? Number(hour) : null;
  const m = minute ? Number(minute) : null;
  if (h !== null && (h < 1 || h > 12)) return { value: null, error: 'Hour must be 1 to 12.', invalid: ['hour'] };
  if (m !== null && m > 59) return { value: null, error: 'Minutes must be 00 to 59.', invalid: ['minute'] };
  if (h === null || m === null) return { value: null, error: null, invalid: [] };
  if (minuteStep && m % minuteStep !== 0) {
    return { value: null, error: `Use ${minuteStep}-minute steps, like :00 or :${String(minuteStep).padStart(2, '0')}.`, invalid: ['minute'] };
  }
  const h24 = (h % 12) + (period === 'pm' ? 12 : 0);
  return { value: `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`, error: null, invalid: [] };
}

/** "9:30 pm" for a wall-clock HH:mm, through the shared 12-hour formatter. */
export function formatClockTime(value: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return formatTime12h(Date.UTC(1970, 0, 1, Number(m[1]), Number(m[2])), { timeZone: 'UTC' });
}

/** A 12-hour time typed as hour, minute and am/pm. */
export function TimeField({
  label,
  value,
  onValueChange,
  minuteStep,
  helperText,
  errorText,
  required = false,
  disabled = false,
  size = 'md',
  testId,
  style,
}: TimeFieldProps) {
  const ids = useFieldIds(undefined, 'timefield');
  const [parts, setParts] = useState<TimeParts>(() => split(value));
  const check = checkTimeParts(parts, minuteStep);

  useEffect(() => {
    if (value !== check.value && (value !== null || check.value !== null)) setParts(split(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const message = errorText ?? check.error;
  const invalid = errorText ? (['hour', 'minute'] as const) : check.invalid;
  const readback = check.value ? formatClockTime(check.value) : null;
  const readbackId = `${ids.control}-readback`;

  const update = (next: TimeParts) => {
    if (disabled) return;
    setParts(next);
    const result = checkTimeParts(next, minuteStep).value;
    if (result !== value) onValueChange(result);
  };

  const field = (key: 'hour' | 'minute', partLabel: string, placeholder: string) => {
    const partId = `${ids.control}-${key}`;
    const bad = (invalid as readonly string[]).includes(key);
    return (
      <div className="grid gap-1">
        <Label htmlFor={partId} className="text-body-sm font-normal">
          {partLabel}
        </Label>
        <div data-hg-state={bad ? 'error' : undefined} className={cn(fieldShellVariants({ size, invalid: bad, disabled }), 'w-16')}>
          <LibInput
            id={partId}
            inputMode="numeric"
            autoComplete="off"
            maxLength={2}
            placeholder={placeholder}
            value={parts[key]}
            readOnly={disabled}
            required={required}
            aria-required={required || undefined}
            aria-invalid={bad || undefined}
            aria-disabled={disabled || undefined}
            aria-describedby={describedBy(message && ids.error, readback && readbackId)}
            onChange={(e) => update({ ...parts, [key]: e.target.value.replace(/\D+/g, '').slice(0, 2) })}
            className="tabular-nums"
          />
        </div>
      </div>
    );
  };

  return (
    <fieldset
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={describedBy(helperText && ids.helper, message && ids.error)}
      aria-disabled={disabled || undefined}
      data-testid={testId ?? 'TimeField'}
      className="m-0 grid min-w-0 gap-1 border-0 p-0"
      style={style}
    >
      <legend id={ids.label} className="mb-1 p-0 text-label-md font-semibold text-fg-secondary">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-line-brand">
            {' *'}
          </span>
        ) : null}
      </legend>
      <FieldMessage id={ids.helper}>{helperText}</FieldMessage>
      <div className="flex flex-wrap items-end gap-2">
        {field('hour', 'Hour', 'hh')}
        <span aria-hidden="true" className="pb-2.5 text-heading-sm text-fg-secondary">
          :
        </span>
        {field('minute', 'Minute', 'mm')}
        <SegmentedControl
          label={`${label}: am or pm`}
          value={parts.period}
          size={size === 'md' ? 'md' : 'lg'}
          onValueChange={(period) => update({ ...parts, period: period as 'am' | 'pm' })}
          options={[
            { value: 'am', label: 'am', disabled },
            { value: 'pm', label: 'pm', disabled },
          ]}
          style={{ marginInlineStart: 8 }}
        />
      </div>
      {readback ? (
        <p id={readbackId} className="sr-only">
          {`Set to ${readback}`}
        </p>
      ) : null}
      {message ? (
        <FieldMessage id={ids.error} error>
          {message}
        </FieldMessage>
      ) : null}
    </fieldset>
  );
}
