/**
 * `CheckboxGroup` (approval packet P19; drawn on `admin/restaurant-verification/
 * Decision-ModalStates` and `admin/rider-onboarding/PanelDecision`): several independent
 * choices under one legend, with a group-level error and an optional minimum and maximum. It is
 * the planned replacement for MultiSelect ("Cuisines, choose 1 to 5"). Proposed: exported from
 * `@hg/ui-web/proposed` until the owner approves the packet.
 *
 * - A `<fieldset>` named by its visible legend; each option is a design-system `Checkbox`.
 * - `error` (or `errorText`) is announced on the GROUP (role=alert, linked from the fieldset).
 * - `max`: once that many are chosen, the others are disabled with the reason "You can choose
 *   up to {max}", and stay focusable. `min`/`max` are stated in the helper line.
 * - Whether too few are chosen is the caller's to judge on submit (pass `error`): the group
 *   never blocks on its own.
 */

import type { CSSProperties, ReactNode } from 'react';

import { Checkbox } from '../ds/Checkbox.js';
import { FieldMessage, describedBy, useFieldIds } from '../ds/field-parts.js';
import { cn } from '../lib/utils.js';

/** One option of a CheckboxGroup. */
export interface CheckboxGroupOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  /** Add-on rows: rendered through Price with the sign always shown. */
  priceDeltaCents?: number;
}

/** Props of the proposed `CheckboxGroup` (P19). */
export interface CheckboxGroupProps {
  /** The visible legend; names the group. */
  label: ReactNode;
  hideLabel?: boolean;
  options: CheckboxGroupOption[];
  value: string[];
  onValueChange?: (value: string[]) => void;
  /** Stated in the helper line; the caller passes `error` when it is not met. */
  min?: number;
  /** Further options are disabled (with a reason) once this many are chosen. */
  max?: number;
  required?: boolean;
  disabled?: boolean;
  helperText?: string;
  /** Announced on the group. */
  error?: string | null;
  /** Alias of `error` (the canvases call it errorText). */
  errorText?: string | null;
  name?: string;
  size?: 20 | 24;
  testId?: string;
  style?: CSSProperties;
}

/** "Choose 1 to 5", "Choose at least 1", "Choose up to 3", or nothing. */
export function rangeHint(min: number | undefined, max: number | undefined): string | null {
  if (min && max) return min === max ? `Choose ${min}` : `Choose ${min} to ${max}`;
  if (min) return `Choose at least ${min}`;
  if (max) return `Choose up to ${max}`;
  return null;
}

/** Independent choices under one legend, with a group error and a maximum. */
export function CheckboxGroup({
  label,
  hideLabel = false,
  options,
  value,
  onValueChange,
  min,
  max,
  required = false,
  disabled = false,
  helperText,
  error,
  errorText,
  name,
  size = 20,
  testId,
  style,
}: CheckboxGroupProps) {
  const ids = useFieldIds(undefined, 'checkboxgroup');
  const message = error ?? errorText ?? null;
  const invalid = Boolean(message);
  const atMax = typeof max === 'number' && value.length >= max;
  const hint = helperText ?? rangeHint(min, max);
  const toggle = (option: string, on: boolean) => {
    if (disabled) return;
    const next = on ? [...value.filter((v) => v !== option), option] : value.filter((v) => v !== option);
    if (on && typeof max === 'number' && next.length > max) return;
    onValueChange?.(options.map((o) => o.value).filter((v) => next.includes(v)));
  };
  return (
    <fieldset
      aria-labelledby={ids.label}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy(hint && ids.helper, invalid && ids.error)}
      data-testid={testId ?? 'CheckboxGroup'}
      className="m-0 grid min-w-0 gap-0 border-0 p-0"
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
      {hint ? <FieldMessage id={ids.helper}>{hint}</FieldMessage> : null}
      {options.map((o) => {
        const checked = value.includes(o.value);
        const capped = atMax && !checked;
        return (
          <Checkbox
            key={o.value}
            label={o.label}
            description={o.description}
            checked={checked}
            name={name}
            value={o.value}
            size={size}
            priceDeltaCents={o.priceDeltaCents}
            disabled={disabled || o.disabled || capped}
            disabledReason={o.disabled ? o.disabledReason : capped ? `You can choose up to ${max}` : undefined}
            onCheckedChange={(on) => toggle(o.value, on)}
            testId={`CheckboxGroup-option-${o.value}`}
          />
        );
      })}
      {invalid ? (
        <FieldMessage id={ids.error} error>
          {message}
        </FieldMessage>
      ) : null}
    </fieldset>
  );
}
