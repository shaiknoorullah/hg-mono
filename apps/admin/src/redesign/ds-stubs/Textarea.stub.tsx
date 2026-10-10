/**
 * TEMPORARY stub until @hg/ui-web/ds ships Textarea (ds-request issue TBD; tracked under #193).
 * Props follow the canvases' drawing ("Textarea with counter": label, helper, counter, error,
 * read-only).
 *
 * The label is always visible. `maxLength` gives a visible "n / max" counter whose remaining
 * count is announced politely at 80% and at the limit; `minLength` adds a visible hint ("At
 * least 20 characters.") linked to the field. `errorText` sets aria-invalid and is linked
 * (show it only after submit). `readOnly` keeps the text selectable and focusable.
 */
import { forwardRef, useId, type ChangeEvent } from 'react';

import { cx } from './internal/cx';

export interface TextareaProps {
  label: string;
  value: string;
  onValueChange?: (value: string) => void;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  helperText?: string;
  /** Show only after submit. */
  errorText?: string | null;
  maxLength?: number;
  /** Minimum length; drawn as a hint. Validation is the form's job. */
  minLength?: number;
  /** Override the minimum hint. Default "At least {n} characters." */
  minLengthHint?: string;
  /** Show the counter (default: when maxLength is set). */
  characterCount?: boolean;
  rows?: number;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  name?: string;
  id?: string;
  hideLabel?: boolean;
  className?: string;
  testId?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    value,
    onValueChange,
    onChange,
    helperText,
    errorText,
    maxLength,
    minLength,
    minLengthHint,
    characterCount,
    rows = 4,
    required,
    disabled,
    readOnly,
    placeholder,
    name,
    id: idProp,
    hideLabel,
    className,
    testId = 'Textarea',
  },
  ref,
) {
  const auto = useId();
  const id = idProp ?? `ta-${auto}`;
  const helperId = `${id}-helper`;
  const minId = `${id}-min`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  const showCount = (characterCount ?? maxLength !== undefined) && maxLength !== undefined;
  const length = value.length;
  const remaining = maxLength !== undefined ? maxLength - length : null;
  const announce = remaining !== null && maxLength !== undefined && length >= Math.floor(maxLength * 0.8);
  const describedBy = [helperText ? helperId : '', minLength ? minId : '', errorText ? errorId : '', showCount ? countId : '']
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <div data-testid={testId} className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className={cx('text-label-md text-fg-primary', hideLabel && 'sr-only')}>
        {label}
        {required ? <span aria-hidden="true">{' *'}</span> : null}
      </label>
      {helperText ? (
        <p id={helperId} className="text-body-sm text-fg-secondary">
          {helperText}
        </p>
      ) : null}
      <textarea
        ref={ref}
        id={id}
        name={name}
        rows={rows}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-required={required || undefined}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        className={cx(
          'hg-focus-field min-h-24 w-full resize-y rounded-md border bg-control-bg px-3 py-2 text-body-md text-fg-primary',
          errorText ? 'border-feedback-danger-border' : 'border-control-border hover:border-control-border-hover',
          readOnly && 'bg-surface-subtle',
          disabled && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          {minLength ? (
            <p id={minId} className="text-body-sm text-fg-secondary">
              {minLengthHint ?? `At least ${minLength} characters.`}
            </p>
          ) : null}
          {errorText ? (
            <p id={errorId} className="text-body-sm text-feedback-danger-text">
              {errorText}
            </p>
          ) : null}
        </div>
        {showCount ? (
          <p id={countId} className="shrink-0 text-body-sm tabular-nums text-fg-secondary">
            <span aria-hidden="true">
              {length} / {maxLength}
            </span>
            <span className="sr-only" aria-live="polite">
              {announce ? `${Math.max(0, remaining ?? 0)} characters left` : ''}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
});
