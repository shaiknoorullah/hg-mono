import {
  forwardRef,
  useId,
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertCircle } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS_WITHIN } from './utils/focus.js';

/**
 * Textarea — 02-components.md §4. Same contract as `Input`, plus `rows`,
 * `autoGrow` and a visible counter.
 *
 * Used for delivery instructions ≤280 chars (C-33/D-19), restaurant rejection
 * reasons, and admin halal check notes.
 *
 * `minLength` is a REAL minimum, not a silent disable: the counter shows the
 * shortfall and the caller is expected to block submit with an explanatory
 * message (A-15 R5). This component never disables a submit on the caller's
 * behalf, because a disabled control that cannot explain itself is the defect
 * 04-accessibility.md §5 exists to prevent.
 *
 * States: default · hover · focus-visible · disabled · loading · error.
 * `active` n/a for a text field — stated explicitly.
 */

interface TextareaOwnProps {
  label: string;
  value?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  helperText?: string;
  errorText?: string;
  rows?: number;
  autoGrow?: boolean;
  characterCount?: boolean;
  /** Enforced by the counter and announced; never by a silent disable. */
  minLength?: number;
  maxLength?: number;
  loading?: boolean;
  hideLabel?: boolean;
  className?: string;
}

export type TextareaProps = TextareaOwnProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, keyof TextareaOwnProps | 'onChange'>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    value = '',
    onChange,
    helperText,
    errorText,
    rows = 3,
    autoGrow = false,
    characterCount = false,
    minLength,
    maxLength,
    loading = false,
    disabled = false,
    required = false,
    hideLabel = false,
    className,
    id: idProp,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? `hg-textarea-${autoId}`;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  const invalid = Boolean(errorText);
  const inner = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!autoGrow || !inner.current) return;
    inner.current.style.height = 'auto';
    inner.current.style.height = `${inner.current.scrollHeight}px`;
  }, [autoGrow, value]);

  const describedBy =
    cx(
      helperText ? helperId : '',
      invalid ? errorId : '',
      characterCount || minLength ? countId : '',
    ).trim() || undefined;

  const short = typeof minLength === 'number' && value.length < minLength;

  return (
    <div className={cx('flex w-full flex-col gap-1', className)} data-testid="hg-textarea-field">
      <label
        htmlFor={id}
        className={cx('text-label-md text-fg-secondary', hideLabel && 'sr-only')}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-feedback-danger-text">
            {' *'}
          </span>
        ) : null}
      </label>

      <div
        data-hg-state={invalid ? 'error' : disabled ? 'disabled' : loading ? 'loading' : 'default'}
        className={cx(
          'flex rounded-sm border bg-control-bg px-3 py-2',
          'transition-colors duration-[var(--hg-duration-fast)] ease-standard',
          HG_FOCUS_WITHIN,
          'focus-within:border-2 focus-within:border-line-brand',
          invalid
            ? 'border-2 border-feedback-danger-border'
            : 'border-line-interactive hover:border-line-strong',
          disabled && 'cursor-not-allowed bg-surface-subtle opacity-(--hg-state-disabled-opacity)',
        )}
      >
        <textarea
          ref={(node) => {
            inner.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          id={id}
          rows={rows}
          value={value}
          disabled={disabled}
          required={required}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-busy={loading || undefined}
          onChange={(event) => onChange?.(event.target.value, event)}
          data-testid="hg-textarea"
          className={cx(
            'w-full resize-y bg-transparent text-body-md text-fg-primary outline-none',
            'placeholder:text-fg-placeholder',
            autoGrow && 'resize-none overflow-hidden',
          )}
          {...rest}
        />
      </div>

      {helperText && !invalid ? (
        <p id={helperId} className="text-body-sm text-fg-tertiary">
          {helperText}
        </p>
      ) : null}

      {invalid ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-body-sm text-feedback-danger-text"
        >
          <AlertCircle aria-hidden="true" size={16} className="shrink-0" />
          {errorText}
        </p>
      ) : null}

      {characterCount || minLength ? (
        <p
          id={countId}
          aria-live={
            short || (maxLength ? value.length >= maxLength * 0.8 : false) ? 'polite' : 'off'
          }
          data-hg-numeric="tabular"
          className={cx(
            'self-end text-body-sm',
            short ? 'text-feedback-warning-text' : 'text-fg-tertiary',
          )}
        >
          {short
            ? `${minLength - value.length} more character${minLength - value.length === 1 ? '' : 's'} needed`
            : maxLength
              ? `${value.length} / ${maxLength}`
              : `${value.length}`}
        </p>
      ) : null}
    </div>
  );
});
