/**
 * TEMPORARY stub until @hg/ui-web/ds ships FilterBar and FilterChip (ds-request issue TBD;
 * tracked under #193). Props follow the canvases' drawing ("FilterBar": a row of filters
 * above a grid, with "Clear filters").
 *
 * `FilterBar` is a labelled `role="group"` row; "Clear filters" appears only while a filter
 * is active. `FilterChip` is a toggle (`aria-pressed`); pressed is a filled tile with a bold
 * check, so the state is never colour alone. 44px targets.
 */
import type { ReactNode } from 'react';

import { Button } from './adapters/Button.adapter';
import { Icon } from './adapters/Icon.adapter';
import { cx } from './internal/cx';
import { FOCUS } from './internal/focus';

export interface FilterBarProps {
  /** Names the group (visible when `showLabel`). Default "Filters". */
  label?: string;
  showLabel?: boolean;
  children: ReactNode;
  /** True while any filter differs from its default: shows "Clear filters". */
  active?: boolean;
  onClear?: () => void;
  clearLabel?: string;
  /** Trailing content (a result count, a refresh button). */
  end?: ReactNode;
  className?: string;
  testId?: string;
}

export function FilterBar({
  label = 'Filters',
  showLabel = false,
  children,
  active = false,
  onClear,
  clearLabel = 'Clear filters',
  end,
  className,
  testId = 'FilterBar',
}: FilterBarProps): React.JSX.Element {
  return (
    <div role="group" aria-label={label} data-testid={testId} className={cx('flex flex-wrap items-end gap-3', className)}>
      {showLabel ? <span className="self-center text-label-md text-fg-secondary">{label}</span> : null}
      {children}
      {active && onClear ? (
        <Button variant="ghost" size="md" onPress={() => onClear()}>
          {clearLabel}
        </Button>
      ) : null}
      {end ? <div className="ms-auto flex items-center gap-2">{end}</div> : null}
    </div>
  );
}

export interface FilterChipProps {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** Count shown after the label and folded into the name ("Overdue, 3"). */
  count?: number;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function FilterChip({ label, pressed, onPressedChange, count, disabled, className, testId = 'FilterChip' }: FilterChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      aria-label={typeof count === 'number' ? `${label}, ${count}` : undefined}
      data-testid={testId}
      onClick={() => {
        if (!disabled) onPressedChange(!pressed);
      }}
      className={cx(
        'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-label-md',
        FOCUS,
        pressed
          ? 'border-surface-chrome bg-surface-chrome text-fg-on-accent font-semibold'
          : 'border-line-interactive bg-surface-raised text-fg-primary hover:bg-surface-subtle',
        disabled && 'cursor-not-allowed opacity-(--hg-state-disabled-opacity)',
        className,
      )}
    >
      {pressed ? <Icon name="check" size="sm" weight="bold" /> : null}
      <span aria-hidden={typeof count === 'number' ? true : undefined}>{label}</span>
      {typeof count === 'number' ? (
        <span aria-hidden="true" className="tabular-nums">
          {count}
        </span>
      ) : null}
    </button>
  );
}
