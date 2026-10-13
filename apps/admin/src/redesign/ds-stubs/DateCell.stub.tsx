/**
 * TEMPORARY stub until @hg/ui-web/ds ships DateCell (ds-request issue TBD; tracked under #141).
 * Props follow the canvases' drawing ("Tooltip (shadcn Tooltip) · the full absolute date
 * behind a short date cell").
 *
 * A short date in a grid cell ("26 Sep, 5:55 pm"; the year only when not this year), with the
 * full date ("Saturday 26 September 2026, 5:55 pm EDT") in a Tooltip AND in the accessible
 * name, so the tooltip never carries the only copy. Toronto time, 12-hour, via
 * `data/format.ts`. Needs a `TooltipProvider` above it (the redesign root has one).
 */
import { Tooltip } from '@hg/ui-web';

import { formatFullDateTime, formatLongDate, formatShortDate, formatShortDateTime } from '../data/format';
import { cx } from './internal/cx';
import { FOCUS } from './internal/focus';

export interface DateCellProps {
  /** ISO date-time (or date) from the server. */
  value: string | null | undefined;
  /** datetime (default): "26 Sep, 5:55 pm" · date: "26 Sep". */
  mode?: 'datetime' | 'date';
  /** Make the cell a tab stop so keyboard users can open the tooltip. Default false (grids rove by row). */
  focusable?: boolean;
  /** Shown when there is no value. Default "Not set". */
  emptyText?: string;
  /** Clock for the "this year" rule (tests). */
  now?: Date;
  className?: string;
  testId?: string;
}

export function DateCell({ value, mode = 'datetime', focusable = false, emptyText = 'Not set', now, className, testId = 'DateCell' }: DateCellProps): React.JSX.Element {
  const short = mode === 'date' ? formatShortDate(value, now) : formatShortDateTime(value, now);
  if (!short) {
    return (
      <span data-testid={testId} className={cx('text-fg-tertiary', className)}>
        {emptyText}
      </span>
    );
  }
  const full = mode === 'date' ? formatLongDate(value) : formatFullDateTime(value);
  return (
    <Tooltip content={full}>
      <time
        dateTime={value ?? undefined}
        aria-label={full}
        tabIndex={focusable ? 0 : undefined}
        data-testid={testId}
        className={cx('whitespace-nowrap tabular-nums', focusable && FOCUS, focusable && 'rounded-xs', className)}
      >
        {short}
      </time>
    </Tooltip>
  );
}
