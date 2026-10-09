/**
 * `Checkbox` — independent booleans (02-components.md §6): add-ons, consent, bulk selection.
 * Props are the live `index.d.ts`.
 *
 * - A real `<input type="checkbox">` carries the semantics; the drawn box is its next sibling,
 *   so the two-layer focus ring lands on the control. The whole row (at least 44px) is the
 *   target.
 * - `indeterminate` sets the DOM property, so assistive tech announces "mixed".
 * - Checked is the brand fill with an on-brand tick, never green. The control is 20 or 24px.
 * - `disabled` keeps the box focusable (`aria-disabled`) and ignores clicks;
 *   `disabledReason` ("Out of stock") is shown and linked.
 * - `error` is linked (`aria-describedby`), sets `aria-invalid` and is announced (role=alert).
 * - `priceDeltaCents` renders through `Price` with the sign always shown.
 * - `onChange` receives the change event; `onCheckedChange` the next boolean.
 */

import { useEffect, useRef, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';

import type { Cents } from '@hg/api-client';

import { ChoiceInput, MixedBar, Tick, choiceControlVariants } from '../lib/ui/checkbox.js';
import { cn } from '../lib/utils.js';
import { FieldMessage, describedBy, useFieldIds } from './field-parts.js';
import { Price } from './index.js';

/** Props of the live `Checkbox` (index.d.ts). */
export interface CheckboxProps {
  label: ReactNode;
  description?: ReactNode;
  checked?: boolean;
  /** Sets the DOM property: assistive tech announces "mixed". */
  indeterminate?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Shown in text.tertiary and linked to the control, e.g. "Out of stock". */
  disabledReason?: string;
  /** Add-on rows: rendered through Price with the sign always shown. */
  priceDeltaCents?: number;
  /** Linked (aria-describedby) and announced (role=alert). */
  error?: string;
  /** Control size 20 (default) or 24; the row is always at least 44px. */
  size?: 20 | 24;
  name?: string;
  value?: string;
  id?: string;
  testId?: string;
  style?: CSSProperties;
}

/** The signed price delta beside an add-on or variant row. */
export function PriceDelta({ cents }: { cents: number }) {
  return (
    <span className="shrink-0 text-body-sm text-fg-secondary">
      <Price cents={cents as Cents} sign="always" size="sm" />
    </span>
  );
}

/** An independent boolean with a visible label, on a real checkbox input. */
export function Checkbox({
  label,
  description,
  checked = false,
  indeterminate = false,
  onChange,
  onCheckedChange,
  disabled = false,
  disabledReason,
  priceDeltaCents,
  error,
  size = 20,
  name,
  value,
  id,
  testId,
  style,
}: CheckboxProps) {
  const ids = useFieldIds(id, 'checkbox');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;
  const descId = `${ids.control}-desc`;
  const reasonId = `${ids.control}-reason`;
  return (
    <div data-testid={testId ?? 'Checkbox'} style={style}>
      <label
        htmlFor={ids.control}
        data-disabled={disabled || undefined}
        className={cn(
          'relative flex min-h-11 gap-3 py-2',
          description ? 'items-start' : 'items-center',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <ChoiceInput
          ref={ref}
          id={ids.control}
          type="checkbox"
          name={name}
          value={value}
          checked={checked}
          aria-checked={indeterminate ? 'mixed' : undefined}
          aria-disabled={disabled || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(description != null && descId, disabled && disabledReason && reasonId, error && ids.error)}
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
            if (disabled) return;
            onChange?.(e);
            onCheckedChange?.(e.target.checked);
          }}
        />
        <span
          aria-hidden="true"
          className={cn(
            choiceControlVariants({ kind: 'checkbox', size, on, invalid: Boolean(error) }),
            description ? 'mt-0.5' : undefined,
            disabled && 'opacity-(--hg-state-disabled-opacity)',
          )}
        >
          {indeterminate ? <MixedBar size={size - 6} /> : checked ? <Tick size={size - 6} /> : null}
        </span>
        <span className={cn('grid flex-1 gap-0.5', disabled && 'opacity-(--hg-state-disabled-opacity)')}>
          <span className="text-body-md text-fg-primary">{label}</span>
          {description != null ? (
            <span id={descId} className="text-body-sm text-fg-secondary">
              {description}
            </span>
          ) : null}
        </span>
        {typeof priceDeltaCents === 'number' ? <PriceDelta cents={priceDeltaCents} /> : null}
      </label>
      {disabled && disabledReason ? (
        <p id={reasonId} className="m-0 text-body-sm text-fg-tertiary" style={{ paddingInlineStart: size + 12 }}>
          {disabledReason}
        </p>
      ) : null}
      {error ? (
        <FieldMessage id={ids.error} error>
          {error}
        </FieldMessage>
      ) : null}
    </div>
  );
}
