/**
 * `FilterBar` — the row of filters above a list (approval packet P22, #193).
 *
 * Two shapes, one export:
 *
 * - **Composed** (the packet's props): `children` are `FilterChip`s, Selects or a search Input;
 *   the bar is a labelled `role="group"`. "Clear filters" appears while a filter is active and
 *   does the same thing as the DataTable's filtered-to-nothing "Clear filters". The result count
 *   (`resultCountLabel`) is a polite live region: after a filter changes, it is the only
 *   feedback a screen-reader user gets while focus stays in the control.
 * - **Declarative** (the props the pre-rebuild `/proposed` FilterBar takes: `filters`, `value`,
 *   `onChange`, `onClear`, …). Passing `filters` renders that component unchanged, so redesign
 *   code written against the earlier export keeps compiling and behaving the same.
 */

import type { CSSProperties, ReactNode } from 'react';

import { FilterBar as DeclarativeFilterBar, type FilterBarProps as DeclarativeFilterBarProps } from '../data/index.js';
import { cn } from '../lib/utils.js';
import { Button } from '../ds/index.js';

/** Props of the composed bar (packet P22), plus the admin stub's names. */
export interface ComposedFilterBarProps {
  children: ReactNode;
  /** Shows "Clear filters"; pair with `active` (or pass it only while something is applied). */
  onClearAll?: () => void;
  /** The admin stub's name for `onClearAll`. */
  onClear?: () => void;
  /** False hides "Clear filters" even when a handler is passed. Default: shown when a handler is. */
  active?: boolean;
  clearLabel?: string;
  /** "128 orders": announced politely after a change. */
  resultCountLabel?: string;
  /** Names the group. Default "Filters". */
  label?: string;
  /** Shows the group's name as visible text. */
  showLabel?: boolean;
  /** Trailing content (a refresh button). */
  end?: ReactNode;
  /** True while the list reloads; controls stay usable. */
  busy?: boolean;
  filters?: never;
  className?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** Either the composed bar or the declarative one (selected by `filters`). */
export type FilterBarProps = ComposedFilterBarProps | DeclarativeFilterBarProps;

function isDeclarative(props: FilterBarProps): props is DeclarativeFilterBarProps {
  return Array.isArray((props as DeclarativeFilterBarProps).filters);
}

/** The filter row above a list. */
export function FilterBar(props: FilterBarProps) {
  if (isDeclarative(props)) return <DeclarativeFilterBar {...props} />;
  const {
    children,
    onClearAll,
    onClear,
    active,
    clearLabel = 'Clear filters',
    resultCountLabel,
    label = 'Filters',
    showLabel = false,
    end,
    busy = false,
    className,
    testId = 'FilterBar',
    style,
  } = props;
  const clear = onClearAll ?? onClear;
  const showClear = Boolean(clear) && active !== false;
  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={busy || undefined}
      data-testid={testId}
      style={style}
      className={cn('flex flex-wrap items-center gap-2 py-2', className)}
    >
      {showLabel ? <span className="text-label-md text-fg-secondary">{label}</span> : null}
      {children}
      {showClear ? (
        <Button variant="ghost" size="md" onPress={() => clear?.()}>
          {clearLabel}
        </Button>
      ) : null}
      <span className="ms-auto flex items-center gap-2">
        <span
          aria-live="polite"
          className="text-body-sm tabular-nums text-fg-secondary"
          data-testid={`${testId}-result-count`}
        >
          {resultCountLabel ?? ''}
        </span>
        {end}
      </span>
    </div>
  );
}
