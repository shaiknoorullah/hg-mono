import { forwardRef, useId, type ReactNode } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import { cx } from './utils/cx.js';
import { HG_FOCUS } from './utils/focus.js';
import { Spinner } from './Spinner.js';

/**
 * Switch — 02-components.md §8. Immediate, self-applying binary state.
 *
 * Used for exactly: rider online/offline (D-10), restaurant accepting-orders
 * (R-22), item availability (R-18), admin feature flags.
 *
 * THE LOADING RULE IS THE POINT. `loading` keeps the switch in its OLD position
 * until the server confirms. An optimistic switch that snaps back is the single
 * worst pattern for a rider toggling offline, so this component structurally
 * cannot do it: while `loading` is true the control is inert and `checked` is
 * whatever the caller last had confirmed.
 *
 * State is never conveyed by thumb position alone — `stateLabel` renders the
 * word ("Online" / "Offline") next to it and is required.
 *
 * States: default · hover · active · focus-visible · checked · disabled ·
 * loading · error.
 */

export interface SwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  /** The word for the current state. Required — position alone is not a signal. */
  stateLabel: { on: string; off: string };
  loading?: boolean;
  disabled?: boolean;
  error?: string;
  name?: string;
  className?: string;
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, label, description, stateLabel, loading = false, disabled = false, error, name, className },
  ref,
) {
  const autoId = useId();
  const id = `hg-switch-${autoId}`;
  const descId = `${id}-desc`;
  const errorId = `${id}-error`;
  const stateId = `${id}-state`;
  const inert = disabled || loading;
  const invalid = Boolean(error);

  const describedBy =
    cx(stateId, description ? descId : '', invalid ? errorId : '').trim() || undefined;

  return (
    <div className={cx('flex flex-col', className)} data-testid="hg-switch-row">
      <div
        className={cx(
          'flex min-h-11 items-center gap-3 py-2',
          inert && 'opacity-(--hg-state-disabled-opacity)',
        )}
      >
        <label
          htmlFor={id}
          className={cx(
            'flex min-w-0 flex-1 flex-col text-body-md text-fg-primary',
            inert ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
        >
          <span>{label}</span>
          {description ? (
            <span id={descId} className="text-body-sm text-fg-tertiary">
              {description}
            </span>
          ) : null}
        </label>

        <span id={stateId} className="shrink-0 text-label-md text-fg-secondary">
          {checked ? stateLabel.on : stateLabel.off}
        </span>

        {loading ? <Spinner size="sm" decorative /> : null}

        <RadixSwitch.Root
          ref={ref}
          id={id}
          name={name}
          checked={checked}
          disabled={inert}
          aria-describedby={describedBy}
          aria-busy={loading || undefined}
          aria-invalid={invalid || undefined}
          onCheckedChange={(next) => {
            // Inert while a change is in flight: the server decides, not the UI.
            if (inert) return;
            onChange?.(next);
          }}
          data-testid="hg-switch"
          className={cx(
            // Track vs surface must clear 3:1 (WCAG 1.4.11) — both track colours
            // are role tokens chosen for that, not decorative greys.
            'relative h-6 w-11 shrink-0 rounded-full border-2 border-transparent',
            'transition-colors duration-[var(--hg-duration-fast)] ease-standard',
            'bg-control-track-off data-[state=checked]:bg-control-track-on',
            inert ? 'cursor-not-allowed' : 'cursor-pointer',
            HG_FOCUS,
          )}
        >
          <RadixSwitch.Thumb
            className={cx(
              'block size-5 rounded-full bg-control-thumb',
              'transition-transform duration-[var(--hg-duration-fast)] ease-standard',
              // Direction-aware: the thumb travels toward the inline end, so
              // the control survives the RTL flip (lint L-7 / D8).
              'translate-x-0 data-[state=checked]:translate-x-5',
              'rtl:data-[state=checked]:-translate-x-5',
            )}
          />
        </RadixSwitch.Root>
      </div>

      {invalid ? (
        <p id={errorId} role="alert" className="text-body-sm text-feedback-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
});
