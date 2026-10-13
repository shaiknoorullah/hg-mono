/**
 * `SpecialDatesList` — the restaurant's special dates (holidays, closures, one-off hours) beside
 * the weekly hours (Menu & Hours canvas `HoursView` modes view, specialempty, specialnight,
 * pastdates, holidaytoday, limits; `HoursSpecialEmpty`, `HoursPastDates`, `HoursHolidayToday`).
 * Proposed: drawn as "ListRow (44px minimum)" rows; awaiting the owner's approval.
 *
 * - Reads the contract's `HoursOverride[]` as returned. Upcoming dates in date order, each row:
 *   the full date, "In effect now" on today, the hours ("Closed all day", "12:00 pm – 8:00 pm",
 *   "6:00 pm – 1:00 am (past midnight)", "Open 24 hours"), the reason word for word, then Edit.
 * - While the weekly editor is open (`editing`), each row also has Remove and the footer counts
 *   "{n} of 90 special dates". At 90, Add date is unavailable and says why.
 * - Past dates are kept and listed behind "Past dates (n)".
 * - Adding and editing a date happen in the page's in-page panel (DetailPanel), not here: this
 *   list only calls `onAdd` / `onEdit` / `onRemove`. Special dates save straight away.
 * - Empty, loading and error states; a refused date shows its message on its row.
 */

import { useId, type CSSProperties } from 'react';

import { Badge } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { formatFullDate } from '../ds/data-format.js';
import { FieldMessage } from '../ds/field-parts.js';
import { IconButton } from '../ds/IconButton.js';
import { InlineAlert } from './Banner.js';
import { Disclosure } from './Disclosure.js';
import { cn } from '../lib/utils.js';
import { Skeleton } from './Skeleton.js';
import { formatClockTime } from './TimeField.js';
import { PANE_CLASS } from './WeeklyHoursEditor.js';
import { MAX_SPECIAL_DATES, crossesMidnight, isAllDay, type HoursOverride } from './weekly-hours.js';

/** Props of the proposed `SpecialDatesList`. */
export interface SpecialDatesListProps {
  /** `RestaurantHours.overrides`, as returned. */
  overrides: ReadonlyArray<HoursOverride> | null | undefined;
  /** Today in the restaurant's zone, YYYY-MM-DD: splits past from upcoming, marks "In effect now". */
  today: string;
  onAdd?: () => void;
  onEdit?: (date: string) => void;
  onRemove?: (date: string) => void;
  /** The weekly editor is open: rows get Remove and the footer counts the dates. */
  editing?: boolean;
  /** No Add, Edit or Remove (a DEACTIVATED restaurant). */
  readOnly?: boolean;
  /** Default 90 (`RestaurantHoursInput.overrides.maxItems`). */
  max?: number;
  /** A save is in flight: the row actions hold. */
  busy?: boolean;
  loading?: boolean;
  /** The hours failed to load. */
  error?: string | null;
  onRetry?: () => void;
  /** A refusal for one date (keyed by YYYY-MM-DD), shown on its row. */
  rowErrors?: Partial<Record<string, string>>;
  /** A second line for one date, e.g. "Friday's hours still run to 2:00 am on Saturday." */
  notes?: Partial<Record<string, string>>;
  /** `pane` (raised card beside the weekly hours; default) or `plain`. */
  appearance?: 'pane' | 'plain';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

/** "Closed all day", "12:00 pm – 8:00 pm", "6:00 pm – 1:00 am (past midnight)", "Open 24 hours". */
export function formatOverrideHours(o: HoursOverride): string {
  if (o.is_closed) return 'Closed all day';
  if (!o.opens_at || !o.closes_at) return 'Hours not set';
  const range = { open: o.opens_at, close: o.closes_at };
  if (isAllDay(range)) return 'Open 24 hours';
  const text = `${formatClockTime(o.opens_at)} – ${formatClockTime(o.closes_at)}`;
  return crossesMidnight(range) ? `${text} (past midnight)` : text;
}

function dateText(date: string): string {
  return formatFullDate(date) ?? date;
}

/** The special dates beside the weekly hours: list, empty, past, loading and error. */
export function SpecialDatesList({
  overrides,
  today,
  onAdd,
  onEdit,
  onRemove,
  editing = false,
  readOnly = false,
  max = MAX_SPECIAL_DATES,
  busy = false,
  loading = false,
  error,
  onRetry,
  rowErrors,
  notes,
  appearance = 'pane',
  testId,
  style,
}: SpecialDatesListProps) {
  const all = [...(overrides ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = all.filter((o) => o.date >= today);
  const past = all.filter((o) => o.date < today).reverse();
  const full = all.length >= max;
  const canChange = !readOnly && !loading && !error;
  const headingId = `hg-special-${useId().replace(/:/g, '')}`;
  const fullWhy = `You have ${max} special dates, the most allowed. Remove one to add another.`;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      data-testid={testId ?? 'SpecialDatesList'}
      className={cn('grid content-start gap-2', appearance === 'pane' && PANE_CLASS)}
      style={style}
    >
      <div className="flex min-h-11 items-center gap-3">
        <h2 id={headingId} className="m-0 grow text-heading-md text-fg-primary">
          Special dates
        </h2>
        {canChange && onAdd ? (
          <Button
            variant="tertiary"
            size="md"
            iconStart="plus"
            disabled={full || busy}
            accessibilityLabel={full ? `Add date. Not available: you have ${max} special dates, the most allowed.` : 'Add a special date'}
            onPress={() => onAdd()}
          >
            Add date
          </Button>
        ) : null}
      </div>
      <p className="m-0 text-body-sm text-fg-secondary">
        {editing
          ? 'Special dates save straight away, separately from your weekly hours.'
          : 'Holidays and one-off hours replace your weekly hours on that date.'}
      </p>
      {canChange && full ? <p className="m-0 text-body-sm text-fg-secondary">{fullWhy}</p> : null}

      {loading ? <Skeleton variant="rows" count={3} label="Loading your special dates…" /> : null}
      {error && !loading ? (
        <InlineAlert
          tone="warning"
          title="We couldn’t load your special dates"
          action={onRetry ? { label: 'Try again', onPress: onRetry } : undefined}
        >
          {error}
        </InlineAlert>
      ) : null}

      {!loading && !error && upcoming.length === 0 ? (
        <div className="grid gap-1.5 border-t border-line-decorative py-3">
          <span className="text-label-lg text-fg-primary">No special dates</span>
          <span className="text-body-md text-fg-secondary">
            Your weekly hours apply every day. Use Add date for a holiday, a closure or a day with different hours.
          </span>
        </div>
      ) : null}

      {!loading && !error && upcoming.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {upcoming.map((o) => {
            const label = dateText(o.date);
            const rowError = rowErrors?.[o.date];
            const note = notes?.[o.date];
            return (
              <li key={o.date} className="flex min-h-11 flex-col gap-1 border-t border-line-decorative py-2">
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 grow flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-label-lg text-fg-primary">
                      {o.date === today ? `${label} (today)` : label}
                      {o.date === today ? (
                        <Badge variant="outline" size="sm">
                          In effect now
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-body-md text-fg-primary tabular-nums">{formatOverrideHours(o)}</span>
                    {o.reason ? <span className="text-body-sm text-fg-secondary">{o.reason}</span> : null}
                    {note ? <span className="text-body-sm text-fg-primary">{note}</span> : null}
                  </div>
                  {canChange && onEdit ? (
                    <Button variant="ghost" size="md" accessibilityLabel={`Edit special date ${label}`} disabled={busy} onPress={() => onEdit(o.date)}>
                      Edit
                    </Button>
                  ) : null}
                  {canChange && editing && onRemove ? (
                    <IconButton icon="close" accessibilityLabel={`Remove special date ${label}`} disabled={busy} onPress={() => onRemove(o.date)} />
                  ) : null}
                </div>
                {rowError ? (
                  <FieldMessage id={`${headingId}-${o.date}-error`} error>
                    {rowError}
                  </FieldMessage>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!loading && !error && past.length > 0 ? (
        <Disclosure summary={`Past dates (${past.length})`} appearance="plain" headingLevel={3}>
          <ul className="m-0 list-none p-0">
            {past.map((o) => (
              <li key={o.date} className="flex flex-col gap-0.5 border-t border-line-decorative py-2">
                <span className="flex items-center gap-2 text-label-lg text-fg-primary">
                  {dateText(o.date)}
                  <Badge variant="outline" size="sm">
                    Past
                  </Badge>
                </span>
                <span className="text-body-md text-fg-secondary">
                  {o.reason ? `${formatOverrideHours(o)} · ${o.reason}` : formatOverrideHours(o)}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      {editing && !loading && !error ? (
        <p className="m-0 border-t border-line-decorative pt-2 text-body-sm text-fg-secondary tabular-nums">
          {`${all.length} of ${max} special dates`}
        </p>
      ) : null}
    </section>
  );
}
