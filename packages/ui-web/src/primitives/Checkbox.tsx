import { forwardRef, useId, type ReactNode } from 'react';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS, focusOn } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * Checkbox — 02-components.md §6. Independent booleans.
 *
 * The control is 20/24, but the HIT AREA IS THE WHOLE ROW and is ≥44 tall
 * (target.min). The label row is the target, not just the box — 04-a11y §2.
 *
 * Checked fill is `control.selectedBg` (brand yellow) with `control.selectedFg`
 * — deliberately NOT green. RULE H-1 reserves solid green to the halal
 * namespace, and a green tick on every add-on row would train exactly the
 * wrong association.
 *
 * States: default · hover · active (row overlay) · focus-visible (ring on the
 * CONTROL, not the row) · checked · indeterminate · disabled (+ disabledReason)
 * · loading · error.
 */

export interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  /**
   * Trailing slot for a price delta. Money is int64 cents and is rendered by
   * the content tier's <Price>; this primitive never formats money itself
   * (lint L-5 / rule 0.8).
   */
  trailing?: ReactNode;
  disabled?: boolean;
  /** Shown in text.tertiary when disabled, e.g. "Out of stock". */
  disabledReason?: string;
  loading?: boolean;
  /** Error state. String renders as an assertive message under the row. */
  error?: string | boolean;
  size?: 20 | 24;
  /** Visually hides the label. It stays as the control's accessible name. */
  hideLabel?: boolean;
  name?: string;
  value?: string;
  className?: string;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  {
    checked,
    defaultChecked,
    indeterminate = false,
    onChange,
    label,
    description,
    trailing,
    disabled = false,
    disabledReason,
    loading = false,
    error,
    size = 20,
    hideLabel = false,
    name,
    value,
    className,
  },
  ref,
) {
  const autoId = useId();
  const id = `hg-checkbox-${autoId}`;
  const descId = `${id}-desc`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const inert = disabled || loading;

  const state: RadixCheckbox.CheckedState | undefined = indeterminate
    ? 'indeterminate'
    : checked;

  const describedBy =
    cx(description || disabledReason ? descId : '', invalid ? errorId : '').trim() || undefined;

  return (
    <div className={cx('flex flex-col', className)} data-testid="hg-checkbox-row">
      <div
        className={cx(
          // min-h-11 == target.min 44. The whole row is the target.
          'group flex min-h-11 items-center gap-3 rounded-sm py-2 pe-2 ps-0',
          'transition-colors duration-[var(--hg-duration-fast)] ease-standard',
          !inert && 'hover:bg-[var(--hg-state-hover-overlay)] active:bg-[var(--hg-state-pressed-overlay)]',
          inert && 'opacity-(--hg-state-disabled-opacity)',
        )}
      >
        <RadixCheckbox.Root
          ref={ref}
          id={id}
          name={name}
          value={value}
          checked={state}
          defaultChecked={defaultChecked}
          disabled={inert}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-busy={loading || undefined}
          aria-label={hideLabel && typeof label === 'string' ? label : undefined}
          onCheckedChange={(next) => onChange?.(next === true)}
          data-testid="hg-checkbox"
          style={{ width: size, height: size }}
          className={cx(
            'flex shrink-0 items-center justify-center rounded-xs border',
            'transition-colors duration-[var(--hg-duration-instant)] ease-standard',
            'border-control-border bg-control-bg',
            'data-[state=checked]:border-control-selected-bg data-[state=checked]:bg-control-selected-bg',
            'data-[state=indeterminate]:border-control-selected-bg data-[state=indeterminate]:bg-control-selected-bg',
            invalid && 'border-2 border-feedback-danger-border',
            inert ? 'cursor-not-allowed' : 'hover:border-control-border-hover',
            HG_FOCUS,
            focusOn.control,
          )}
        >
          <RadixCheckbox.Indicator className="text-control-selected-fg">
            {indeterminate ? (
              <Minus aria-hidden="true" size={size - 4} strokeWidth={3} />
            ) : (
              <Check aria-hidden="true" size={size - 4} strokeWidth={3} />
            )}
          </RadixCheckbox.Indicator>
        </RadixCheckbox.Root>

        <label
          htmlFor={id}
          className={cx(
            'flex min-w-0 flex-1 flex-col text-body-md text-fg-primary',
            hideLabel && 'sr-only',
            inert ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          <span>{label}</span>
          {description || (disabled && disabledReason) ? (
            <span id={descId} className="text-body-sm text-fg-tertiary">
              {description}
              {disabled && disabledReason ? (
                <>
                  {description ? ' · ' : null}
                  {disabledReason}
                </>
              ) : null}
            </span>
          ) : null}
        </label>

        {loading ? <Spinner size="sm" decorative /> : null}
        {trailing ? <span className="shrink-0 text-body-md">{trailing}</span> : null}
      </div>

      {typeof error === 'string' ? (
        <p id={errorId} role="alert" className="text-body-sm text-feedback-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
});
