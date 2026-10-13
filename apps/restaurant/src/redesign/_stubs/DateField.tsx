/**
 * TEMPORARY STUB for the proposed DS `DateField` (ds-request(web): #674 or #675; DS plan
 * #193: shadcn Calendar in a Popover plus typed entry). Delete when `@hg/ui-web/proposed`
 * exports it.
 *
 * Until then: the DS `Input` as the browser's date entry (typed or picked), value
 * "YYYY-MM-DD" in and out, with `min`/`max` for the allowed window.
 */
import { Input } from '@hg/ui-web/primitives';

export interface DateFieldProps {
  label: string;
  /** "YYYY-MM-DD" or ''. */
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  helperText?: string;
  errorText?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  className?: string;
  testId?: string;
}

export function DateField({ label, value, onChange, min, max, helperText, errorText, required, disabled, readOnly, id, className, testId }: DateFieldProps) {
  return (
    <div className={className} data-testid={testId}>
      <Input
        id={id}
        // The DS Input types `type` by `variant` and has no date variant; it spreads the rest.
        {...({ type: 'date' } as object)}
        label={label}
        value={value}
        min={min}
        max={max}
        helperText={helperText}
        errorText={errorText}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(next: string) => onChange(next)}
      />
    </div>
  );
}
