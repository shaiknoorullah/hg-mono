/**
 * `KeyValueList` — label and value pairs in detail panes (owner-approved, decisions row
 * 28 Sep; #195). Drawn on the admin order, application and staff panels and the restaurant
 * order, payout and settings panes as `<dl class="hg-kv">`.
 *
 * - Description-list semantics: `<dl>`, one `<dt>`/`<dd>` pair per row, so a screen reader
 *   reads "Restaurant, Zaytoun Grill".
 * - Two layouts: `columns` (labels in a fixed 150px column, the canvases' default) and
 *   `stacked` (label above value, for narrow panes and 200% text).
 * - A missing value (`null`/`undefined`) renders `emptyValue` ("Not on file") as plain text.
 *   It never renders a badge or a guess: for a halal row, the page passes the HalalBadge as the
 *   value only when the state exists (invariant 8).
 * - `loading` keeps the labels and puts a skeleton where each value goes; the list is
 *   `aria-busy`.
 * - An empty `items` array renders `empty` (default "Nothing to show yet.").
 */

import type { CSSProperties, ReactNode } from 'react';

import { SkeletonBlock } from '../lib/ui/skeleton.js';
import { cn } from '../lib/utils.js';

/** One row of a KeyValueList. */
export interface KeyValueItem {
  /** React key; defaults to the label when it is a string. */
  key?: string;
  label: ReactNode;
  /** null or undefined renders `emptyValue`, never a placeholder badge. */
  value?: ReactNode;
  /** Secondary line under the value. */
  helper?: ReactNode;
}

/** Props of the approved `KeyValueList`. */
export interface KeyValueListProps {
  items: KeyValueItem[];
  /** `columns` (default): label column + value; `stacked`: label above value. */
  layout?: 'columns' | 'stacked';
  /** Width of the label column in `columns` layout (CSS length). Default 150px. */
  labelWidth?: string;
  /** Rendered for a missing value. Default "Not on file". */
  emptyValue?: ReactNode;
  /** Rendered when `items` is empty. */
  empty?: ReactNode;
  /** Labels stay; values become skeletons; the list is aria-busy. */
  loading?: boolean;
  /** Names the list when the heading above it does not. */
  accessibilityLabel?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** Label and value pairs as a description list. */
export function KeyValueList({
  items,
  layout = 'columns',
  labelWidth = '150px',
  emptyValue = 'Not on file',
  empty = 'Nothing to show yet.',
  loading = false,
  accessibilityLabel,
  testId = 'KeyValueList',
  style,
  className,
}: KeyValueListProps) {
  if (items.length === 0 && !loading) {
    return (
      <p data-testid={testId} data-state="empty" className={cn('m-0 text-body-md text-fg-secondary', className)} style={style}>
        {empty}
      </p>
    );
  }

  return (
    <dl
      data-testid={testId}
      data-layout={layout}
      aria-busy={loading || undefined}
      aria-label={accessibilityLabel}
      className={cn(
        'm-0 grid text-body-md text-fg-primary',
        layout === 'columns' ? 'gap-x-3 gap-y-2' : 'grid-cols-1 gap-y-1',
        className,
      )}
      style={layout === 'columns' ? { gridTemplateColumns: `${labelWidth} minmax(0, 1fr)`, ...style } : style}
    >
      {items.map((item, index) => {
        const missing = item.value === null || item.value === undefined || item.value === '';
        return (
          <div key={item.key ?? (typeof item.label === 'string' ? item.label : index)} className="contents">
            <dt className={cn('text-label-md text-fg-secondary', layout === 'columns' ? 'pt-1' : 'pt-2')}>{item.label}</dt>
            <dd className="m-0 flex min-w-0 flex-col items-start gap-1 break-words">
              {loading ? (
                <SkeletonBlock className="mt-1 h-4 w-3/5" />
              ) : missing ? (
                <span className="text-fg-secondary">{emptyValue}</span>
              ) : (
                item.value
              )}
              {!loading && item.helper ? <span className="text-body-sm text-fg-secondary">{item.helper}</span> : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
