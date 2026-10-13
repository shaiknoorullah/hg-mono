/**
 * TEMPORARY stub until @hg/ui-web/ds ships KeyValueList (ds-request issue TBD; tracked under #195).
 * Props follow the canvases' drawing ("KeyValueList (approved for the system)": the facts
 * pane, e.g. Legal name / Display name / Premises).
 *
 * A `<dl>` of label/value rows: labels in secondary text, values in primary. `dense` tightens
 * the rows for side panes. A missing value shows `emptyValue` (default "Not provided"),
 * never a blank that reads as "none".
 */
import type { ReactNode } from 'react';

import { cx } from './internal/cx';

export interface KeyValueItem {
  /** Stable key; defaults to the label when it is a string. */
  key?: string;
  label: ReactNode;
  value: ReactNode;
  /** Value in mono (ids, certificate numbers). */
  mono?: boolean;
}

export interface KeyValueListProps {
  items: KeyValueItem[];
  dense?: boolean;
  /** Label column width (CSS length). Default 9rem. */
  labelWidth?: string;
  /** Shown for a null/undefined/'' value. Default "Not provided". */
  emptyValue?: ReactNode;
  className?: string;
  testId?: string;
}

export function KeyValueList({
  items,
  dense = false,
  labelWidth = '9rem',
  emptyValue = 'Not provided',
  className,
  testId = 'KeyValueList',
}: KeyValueListProps): React.JSX.Element {
  return (
    <dl
      data-testid={testId}
      className={cx('grid gap-x-4', dense ? 'gap-y-1 text-body-sm' : 'gap-y-2 text-body-md', className)}
      style={{ gridTemplateColumns: `${labelWidth} minmax(0, 1fr)` }}
    >
      {items.map((item, i) => {
        const empty = item.value === null || item.value === undefined || item.value === '';
        return (
          <div key={item.key ?? (typeof item.label === 'string' ? item.label : i)} className="contents">
            <dt className="text-fg-secondary">{item.label}</dt>
            <dd className={cx('min-w-0 break-words', empty ? 'text-fg-tertiary' : 'text-fg-primary', item.mono && !empty && 'font-mono')}>
              {empty ? emptyValue : item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
