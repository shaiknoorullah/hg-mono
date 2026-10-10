/**
 * `RadioGroup` + `Radio` — exactly one from a set (02-components.md §7): variants, refund
 * reasons, tip amount. Props are the live `index.d.ts`, plus the packet's `size="roomy"`
 * (72px rows, P19) as an addition.
 *
 * - The group is a `<fieldset role="radiogroup">` named by its visible legend. The native
 *   radios share a name, so the group is one tab stop and the arrow keys move and select.
 * - Options come from `options` or as `<Radio>` children.
 * - The drawn ring follows its input, so the focus ring lands on the control. The whole row is
 *   the target (44px, or 72px roomy). Selected is brand, never green.
 * - `error` is announced on the GROUP (role=alert, linked from the fieldset), not on the last
 *   option. A disabled option shows and links its `disabledReason`.
 * - `priceDeltaCents` renders through `Price` with the sign always shown.
 * - A disabled group stays focusable (`aria-disabled`) and ignores changes.
 */

import {
  createContext,
  useContext,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { ChoiceInput, RadioDot, choiceControlVariants } from '../lib/ui/checkbox.js';
import { cn } from '../lib/utils.js';
import { ChoiceRowText, DisabledReasonLine } from './Checkbox.js';
import { FieldMessage, describedBy, useFieldIds } from './field-parts.js';

/** One option of a RadioGroup. */
export interface RadioOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** e.g. "Out of stock". */
  disabledReason?: string;
  /** Variant rows: rendered through Price with the sign always shown. */
  priceDeltaCents?: number;
}

/** Props of the live `RadioGroup` (index.d.ts), plus `roomy`. */
export interface RadioGroupProps {
  /** The visible legend; names the radiogroup. Required. */
  label: ReactNode;
  hideLabel?: boolean;
  name?: string;
  value: string | null;
  onChange?: (value: string, e: ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (value: string) => void;
  /** Either options or <Radio> children. */
  options?: RadioOption[];
  children?: ReactNode;
  orientation?: 'vertical' | 'horizontal';
  required?: boolean;
  disabled?: boolean;
  /** Announced on the group, not on the last option. */
  error?: string | null;
  size?: 20 | 24;
  /** 72px rows (approval packet P19; customer and rider). */
  roomy?: boolean;
  testId?: string;
  style?: CSSProperties;
}

/** Props of the live `Radio` (index.d.ts): one option, always inside a RadioGroup. */
export interface RadioProps extends RadioOption {
  id?: string;
  testId?: string;
  style?: CSSProperties;
}

interface GroupContext {
  name: string;
  value: string | null;
  select: (value: string, e: ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  invalid: boolean;
  size: 20 | 24;
  roomy: boolean;
}

const RadioContext = createContext<GroupContext | null>(null);

/** A one-of-many choice, named by its legend, with a group-level error. */
export function RadioGroup({
  label,
  hideLabel = false,
  name,
  value,
  onChange,
  onValueChange,
  options,
  children,
  orientation = 'vertical',
  required = false,
  disabled = false,
  error,
  size = 20,
  roomy = false,
  testId,
  style,
}: RadioGroupProps) {
  const ids = useFieldIds(undefined, 'radiogroup');
  const invalid = Boolean(error);
  const select = (next: string, e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    onChange?.(next, e);
    onValueChange?.(next);
  };
  return (
    <RadioContext.Provider
      value={{ name: name ?? ids.control, value, select, disabled, invalid, size, roomy }}
    >
      <fieldset
        role="radiogroup"
        aria-labelledby={ids.label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        aria-describedby={describedBy(invalid && ids.error)}
        data-testid={testId ?? 'RadioGroup'}
        className="m-0 min-w-0 border-0 p-0"
        style={style}
        onKeyDown={(e) => {
          if (disabled && e.key.startsWith('Arrow')) e.preventDefault();
        }}
      >
        <legend
          id={ids.label}
          className={cn('mb-1 p-0 text-label-md font-semibold text-fg-secondary', hideLabel && 'sr-only')}
        >
          {label}
          {required ? (
            <span aria-hidden="true" className="text-line-brand">
              {' *'}
            </span>
          ) : null}
        </legend>
        <div className={cn('flex flex-wrap gap-x-4', orientation === 'horizontal' ? 'flex-row' : 'flex-col')}>
          {options ? options.map((o) => <Radio key={o.value} {...o} />) : children}
        </div>
        {invalid ? (
          <FieldMessage id={ids.error} error>
            {error}
          </FieldMessage>
        ) : null}
      </fieldset>
    </RadioContext.Provider>
  );
}

/** One option row of a RadioGroup. */
export function Radio({
  value,
  label,
  description,
  disabled: optionDisabled = false,
  disabledReason,
  priceDeltaCents,
  id,
  testId,
  style,
}: RadioProps) {
  const group = useContext(RadioContext);
  const ids = useFieldIds(id, 'radio');
  const size = group?.size ?? 20;
  const checked = group ? group.value === value : false;
  const groupDisabled = group?.disabled ?? false;
  const disabled = optionDisabled || groupDisabled;
  const descId = `${ids.control}-desc`;
  const reasonId = `${ids.control}-reason`;
  return (
    <div data-testid={testId ?? 'Radio'} style={style}>
      <label
        htmlFor={ids.control}
        data-disabled={disabled || undefined}
        className={cn(
          'relative flex gap-3 py-2',
          group?.roomy ? 'min-h-18' : 'min-h-11',
          description ? 'items-start' : 'items-center',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <ChoiceInput
          id={ids.control}
          type="radio"
          name={group?.name}
          value={value}
          checked={checked}
          // A single unavailable option is skipped by the arrow keys; a disabled group stays focusable.
          disabled={optionDisabled}
          aria-disabled={groupDisabled || undefined}
          aria-describedby={describedBy(description != null && descId, disabled && disabledReason && reasonId)}
          onClick={(e) => {
            if (!disabled) return;
            e.preventDefault();
            // Browsers revert a cancelled click; restore explicitly so every engine agrees.
            const el = e.currentTarget;
            queueMicrotask(() => {
              el.checked = checked;
            });
          }}
          onChange={(e) => {
            if (!disabled) group?.select(value, e);
          }}
        />
        <span
          aria-hidden="true"
          className={cn(
            choiceControlVariants({ kind: 'radio', size, on: checked, invalid: group?.invalid ?? false }),
            description ? 'mt-0.5' : undefined,
            disabled && 'opacity-(--hg-state-disabled-opacity)',
          )}
        >
          {checked ? <RadioDot size={size} /> : null}
        </span>
        <ChoiceRowText
          label={label}
          description={description}
          descId={descId}
          priceDeltaCents={priceDeltaCents}
          disabled={disabled}
        />
      </label>
      {disabled && disabledReason ? (
        <DisabledReasonLine id={reasonId} indent={size + 12}>
          {disabledReason}
        </DisabledReasonLine>
      ) : null}
    </div>
  );
}
