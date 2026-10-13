/**
 * `FilterChip` — one filter you switch on or off above a list (approval packet P22, #193).
 * A Radix toggle: `aria-pressed`, 44px tall. Pressed is a filled tile plus a bold check, so the
 * state never rests on colour alone. A count is shown after the label and folded into the name
 * ("Overdue, 3"). Disabled stays focusable (`aria-disabled`) and refuses the change. While the
 * list reloads after a change, `loading` sets `aria-busy`; the chip stays usable.
 */

import type { CSSProperties } from 'react';

import { Toggle } from '../lib/ui/toggle.js';
import { Icon } from '../ds/index.js';

/** Props of `FilterChip` (packet P22), plus the admin stub's `disabled` and `className`. */
export interface FilterChipProps {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** Matching records, shown after the label and read as part of the name. */
  count?: number;
  /** Stays focusable with aria-disabled; presses are ignored. */
  disabled?: boolean;
  /** The list is reloading after this chip changed. */
  loading?: boolean;
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** A toggle chip for one filter. */
export function FilterChip({
  label,
  pressed,
  onPressedChange,
  count,
  disabled = false,
  loading = false,
  className,
  testId = 'FilterChip',
  style,
}: FilterChipProps) {
  const hasCount = typeof count === 'number';
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={(next) => {
        if (!disabled) onPressedChange(next);
      }}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      aria-label={hasCount ? `${label}, ${count}` : undefined}
      data-testid={testId}
      className={className}
      style={style}
    >
      {pressed ? <Icon name="check" size="sm" weight="bold" /> : null}
      <span aria-hidden={hasCount || undefined}>{label}</span>
      {hasCount ? (
        <span aria-hidden="true" className="tabular-nums">
          {count}
        </span>
      ) : null}
    </Toggle>
  );
}
