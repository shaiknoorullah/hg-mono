import { useId, type KeyboardEvent, type ReactNode } from 'react';
import * as RadixRadioGroup from '@radix-ui/react-radio-group';
import { cx } from './utils/cx.js';
import { HG_FOCUS, focusOn } from './utils/focus.js';

/**
 * Radio / RadioGroup — 02-components.md §7. Exactly one from a set.
 *
 * The group is a SINGLE TAB STOP and arrows move within it (04-a11y §4.3).
 * That is Radix's roving-tabindex implementation, not ours — a hand-rolled
 * arrow handler is where keyboard support quietly rots.
 *
 * Required-group validation announces on the GROUP, not on the last option.
 *
 * SELECTION FOLLOWS FOCUS, which is the WAI-ARIA radio pattern and what a
 * keyboard user expects: ArrowDown both moves and selects. Radix moves focus
 * but does not reliably select — its "select on arrow" path hangs off a
 * `document` keydown listener, and React attaches its own handlers at the root
 * container, a DESCENDANT of document, so by the time Radix's listener runs the
 * item has already been focused and the flag it checks is still false. The
 * observable result is a group where arrows move and nothing gets selected.
 *
 * So we select explicitly, in the capture phase, by clicking the target item —
 * which works for a controlled and an uncontrolled group alike, because it goes
 * through Radix's own state. Clicking an already-selected radio is a no-op, so
 * this stays correct if Radix's path ever does fire.
 *
 * States: default · hover · active · focus-visible (ring on the control) ·
 * selected (brand fill, not green) · disabled (+ disabledReason) · error.
 * `loading` is a group-level concern and is expressed by the caller replacing
 * the group with a Skeleton — a half-loaded radio group has no correct state.
 */

export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** Trailing slot, e.g. the content tier's <Price> for a variant delta. */
  trailing?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

export interface RadioGroupProps {
  label: string;
  name?: string;
  options: RadioOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  error?: string;
  labelHidden?: boolean;
  size?: 20 | 24;
  className?: string;
}

export function RadioGroup({
  label,
  name,
  options,
  value,
  defaultValue,
  onChange,
  orientation = 'vertical',
  required = false,
  disabled = false,
  error,
  labelHidden = false,
  size = 20,
  className,
}: RadioGroupProps) {
  const autoId = useId();
  const id = `hg-radiogroup-${autoId}`;
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);

  const selectable = options.filter((o) => !(disabled || o.disabled));

  const handleArrow = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const backward = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const step = event.key === forward ? 1 : event.key === backward ? -1 : 0;
    if (step === 0 || selectable.length === 0) return;

    const focusedId = (event.target as HTMLElement | null)?.id ?? '';
    const from = selectable.findIndex((o) => `${id}-${o.value}` === focusedId);
    if (from === -1) return;

    // Loop, matching Radix's roving focus.
    const next = selectable[(from + step + selectable.length) % selectable.length];
    if (!next) return;
    document.getElementById(`${id}-${next.value}`)?.click();
  };

  return (
    <div className={cx('flex flex-col gap-1', className)} data-testid="hg-radiogroup-field">
      <span id={labelId} className={cx('text-label-md text-fg-secondary', labelHidden && 'sr-only')}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-feedback-danger-text">
            {' *'}
          </span>
        ) : null}
      </span>

      <RadixRadioGroup.Root
        name={name}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onChange}
        disabled={disabled}
        required={required}
        orientation={orientation}
        aria-labelledby={labelId}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onKeyDownCapture={handleArrow}
        data-testid="hg-radiogroup"
        className={cx('flex gap-1', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
      >
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          const descId = `${optionId}-desc`;
          const inert = disabled || option.disabled;
          return (
            <div
              key={option.value}
              className={cx(
                'group flex min-h-11 items-center gap-3 rounded-sm py-2 pe-2',
                'transition-colors duration-[var(--hg-duration-fast)] ease-standard',
                !inert &&
                  'hover:bg-[var(--hg-state-hover-overlay)] active:bg-[var(--hg-state-pressed-overlay)]',
                inert && 'opacity-(--hg-state-disabled-opacity)',
              )}
            >
              <RadixRadioGroup.Item
                id={optionId}
                value={option.value}
                disabled={inert}
                aria-describedby={option.description || option.disabledReason ? descId : undefined}
                data-testid="hg-radio"
                style={{ width: size, height: size }}
                className={cx(
                  'flex shrink-0 items-center justify-center rounded-full border',
                  'transition-colors duration-[var(--hg-duration-instant)] ease-standard',
                  'border-control-border bg-control-bg',
                  'data-[state=checked]:border-control-selected-bg data-[state=checked]:bg-control-selected-bg',
                  invalid && 'border-2 border-feedback-danger-border',
                  inert ? 'cursor-not-allowed' : 'hover:border-control-border-hover',
                  HG_FOCUS,
                  focusOn.control,
                )}
              >
                <RadixRadioGroup.Indicator
                  className="block rounded-full bg-control-selected-fg"
                  style={{ width: size / 2.5, height: size / 2.5 }}
                />
              </RadixRadioGroup.Item>

              <label
                htmlFor={optionId}
                className={cx(
                  'flex min-w-0 flex-1 flex-col text-body-md text-fg-primary',
                  inert ? 'cursor-not-allowed' : 'cursor-pointer',
                )}
              >
                <span>{option.label}</span>
                {option.description || (option.disabled && option.disabledReason) ? (
                  <span id={descId} className="text-body-sm text-fg-tertiary">
                    {option.description}
                    {option.disabled && option.disabledReason ? (
                      <>
                        {option.description ? ' · ' : null}
                        {option.disabledReason}
                      </>
                    ) : null}
                  </span>
                ) : null}
              </label>

              {option.trailing ? (
                <span className="shrink-0 text-body-md">{option.trailing}</span>
              ) : null}
            </div>
          );
        })}
      </RadixRadioGroup.Root>

      {invalid ? (
        <p id={errorId} role="alert" className="text-body-sm text-feedback-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
