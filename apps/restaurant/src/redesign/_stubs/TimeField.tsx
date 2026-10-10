/**
 * TEMPORARY STUB for the proposed DS `TimeField` (ds-request(web): #674 or #675; DS plan
 * #193). Delete when `@hg/ui-web/proposed` exports it.
 *
 * A 12-hour time entry over the DS `Input`: the person types "5:30 pm", "5pm" or "17:30",
 * and sees "5:30 pm" once they leave the field. The value in and out is the contract's
 * 24-hour "HH:MM"; '' when empty; the raw text when it is not a time (so the screen can
 * say "Enter a time like 11:00 am.").
 */
import { useEffect, useState } from 'react';
import { Input } from '@hg/ui-web/primitives';
import { formatClock, isClock, parseClock } from '../format/time';

export interface TimeFieldProps {
  label: string;
  /** "HH:MM", '' or the raw text the person typed. */
  value: string;
  onChange: (value: string) => void;
  errorText?: string;
  helperText?: string;
  readOnly?: boolean;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  className?: string;
  testId?: string;
}

const shown = (value: string) => (isClock(value) ? formatClock(value) : value);

export function TimeField({ label, value, onChange, errorText, helperText, readOnly, disabled, required, id, className, testId }: TimeFieldProps) {
  const [text, setText] = useState(() => shown(value));
  useEffect(() => {
    // Follow the value when it changes from outside (Undo, Discard, a fresh load).
    const parsed = parseClock(text) ?? text.trim();
    if (parsed !== value) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={className} data-testid={testId}>
      <Input
        id={id}
        label={label}
        value={text}
        placeholder="e.g. 11:00 am"
        autoComplete="off"
        errorText={errorText}
        helperText={helperText}
        readOnly={readOnly}
        disabled={disabled}
        required={required}
        onChange={(next: string) => {
          setText(next);
          onChange(parseClock(next) ?? next.trim());
        }}
        onBlur={() => {
          const parsed = parseClock(text);
          if (parsed) setText(formatClock(parsed));
        }}
      />
    </div>
  );
}
