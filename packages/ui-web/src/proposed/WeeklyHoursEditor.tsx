/**
 * `WeeklyHoursEditor` — the restaurant's weekly trading hours (approval packet P23; Menu & Hours
 * canvas `HoursView` modes edit, dayclosed, overlap, overlapnight, twentyfour, limits, saving,
 * unsaved and closesnow, `Tablet-HoursEdit`; Onboarding `HoursBlock`). Proposed: awaiting the
 * owner's approval.
 *
 * - Seven days, Monday first. Each day is Closed (a Switch "Open / Closed", or the onboarding
 *   Checkbox "Closed") or has up to 3 ranges of two TimeFields, typed in 12-hour time.
 * - A closing time at or before the opening time runs past midnight and is labelled ("Past
 *   midnight"; the same time is "Open 24 hours").
 * - Closing a day keeps its ranges for Undo ("Closed all day. 1 time range removed (…)"); a
 *   Closed day saves no interval.
 * - Checks (`checkWeeklyHours`): times typed, 3 ranges a day, 21 in the week, and overlaps,
 *   including a range past midnight into the next day's. After a save attempt the error
 *   summary takes focus and links to each range; each message also sits under its field.
 *   Server errors (`errors`, mapped to the day) show the same way.
 * - Dirty tracking against `savedValue`: the save bar says how many days changed and offers
 *   "Save hours" only when something did. `onSave` receives the contract's intervals.
 * - `readOnly` draws the static two-column schedule (Day, Open) instead: a DEACTIVATED
 *   restaurant, or the Hours page before Edit hours.
 *
 * Fills and top rules only, never a left border; no danger tone outside the error messages.
 */

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Badge } from '../ds/Badge.js';
import { Button } from '../ds/Button.js';
import { Checkbox } from '../ds/Checkbox.js';
import { FieldMessage } from '../ds/field-parts.js';
import { IconButton } from '../ds/IconButton.js';
import { Switch } from '../ds/Switch.js';
import { cn } from '../lib/utils.js';
import { ErrorSummary, type ErrorSummaryItem } from './Field.js';
import { TimeField } from './TimeField.js';
import {
  MAX_RANGES_PER_DAY,
  MAX_RANGES_PER_WEEK,
  WEEKDAYS,
  changedDays,
  checkWeeklyHours,
  countRanges,
  crossesMidnight,
  formatRange,
  isAllDay,
  weeklyHoursToContract,
  type DayHours,
  type TradingInterval,
  type Weekday,
  type WeeklyHours,
  type WeeklyHoursIssue,
} from './weekly-hours.js';

/** Props of the proposed `WeeklyHoursEditor` (P23, plus the additions the boards need). */
export interface WeeklyHoursEditorProps {
  /** The week being edited (controlled). */
  value: WeeklyHours;
  onValueChange?: (value: WeeklyHours) => void;
  /** Ranges a day. Default 3. */
  maxRanges?: number;
  /** Server errors mapped to the day (a 422 from `setRestaurantHours`). */
  errors?: Partial<Record<Weekday, string>>;
  /** Addition: ranges in the week. Default 21 (`RestaurantHoursInput.intervals.maxItems`). */
  maxTotalRanges?: number;
  /** Addition: the hours as last saved, for dirty tracking. Default: `value` (nothing changed). */
  savedValue?: WeeklyHours;
  /** Addition: the static schedule, no controls (DEACTIVATED, or before Edit hours). */
  readOnly?: boolean;
  /** Addition: `switch` (Hours page, "Open / Closed") or `checkbox` (onboarding, "Closed"). */
  closedControl?: 'switch' | 'checkbox';
  /** Addition: shows the save bar. Called with the contract's intervals once the checks pass. */
  onSave?: (intervals: TradingInterval[], value: WeeklyHours) => void;
  /** Addition: "Discard changes" (or "Done" when nothing changed). */
  onDiscard?: () => void;
  /** Addition: a save is in flight: controls hold, Save shows "Saving…". */
  saving?: boolean;
  /** Addition: show the checks now, without a save attempt (an app with its own save button). */
  showErrors?: boolean;
  /** Addition: replaces the save bar's contents, e.g. the in-bar "Save and close now?" confirm. */
  barContent?: ReactNode;
  /** Addition: the heading. Default "Edit weekly hours" ("Weekly hours" when read-only); null for none. */
  heading?: string | null;
  /** Addition: the zone line, e.g. "Eastern time (America/Toronto)." */
  timeZoneNote?: string;
  /** Addition: marks today's row in the read-only schedule. */
  today?: Weekday;
  /** Addition: `pane` (raised card, the Hours page; default) or `plain` (inside an onboarding block). */
  appearance?: 'pane' | 'plain';
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
}

const DEFAULT_NOTE = 'Eastern time (America/Toronto).';

/** The pane chrome shared by the editor, the schedule and the special dates list. */
export const PANE_CLASS = 'rounded-lg border border-line-decorative bg-surface-raised px-4 py-3 sm:px-5';

/** Seven days, Closed or up to 3 ranges each, in 12-hour time, with checks and a save bar. */
export function WeeklyHoursEditor(props: WeeklyHoursEditorProps) {
  if (props.readOnly) return <WeeklySchedule {...props} />;
  return <WeeklyHoursForm {...props} />;
}

function WeeklySchedule({
  value,
  heading,
  timeZoneNote = DEFAULT_NOTE,
  today,
  appearance = 'pane',
  testId,
  style,
}: WeeklyHoursEditorProps) {
  const headingId = `${useId().replace(/:/g, '')}-weekly-h`;
  const title = heading === undefined ? 'Weekly hours' : heading;
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      aria-label={title ? undefined : 'Weekly hours'}
      data-testid={testId ?? 'WeeklyHoursEditor'}
      data-mode="read"
      className={cn('grid gap-2', appearance === 'pane' && PANE_CLASS)}
      style={style}
    >
      {title ? (
        <h2 id={headingId} className="m-0 text-heading-md text-fg-primary">
          {title}
        </h2>
      ) : null}
      <p className="m-0 text-body-sm text-fg-secondary">{timeZoneNote}</p>
      <table className="w-full border-collapse text-body-md text-fg-primary">
        <caption className="sr-only">Weekly opening hours</caption>
        <thead>
          <tr className="h-10 bg-surface-subtle text-start">
            <th scope="col" className="w-44 px-3 text-start text-label-md text-fg-secondary">
              Day
            </th>
            <th scope="col" className="px-3 text-start text-label-md text-fg-secondary">
              Open
            </th>
          </tr>
        </thead>
        <tbody>
          {WEEKDAYS.map((d) => {
            const day = value[d.key];
            const ranges = day.closed ? [] : day.ranges;
            return (
              <tr
                key={d.key}
                className={cn('h-11 border-t border-line-decorative', today === d.key && 'bg-surface-subtle')}
              >
                <th scope="row" className="px-3 py-2 text-start align-top font-semibold">
                  <span className="flex items-center gap-2">
                    {d.label}
                    {today === d.key ? (
                      <Badge variant="outline" size="sm">
                        Today
                      </Badge>
                    ) : null}
                  </span>
                </th>
                <td className="px-3 py-2">
                  {ranges.length === 0 ? <span className="text-fg-secondary">Closed</span> : null}
                  <div className="flex flex-wrap gap-4">
                    {ranges.map((r, i) => (
                      <span key={i} className="flex items-center gap-2 tabular-nums">
                        {formatRange(r)}
                        <RangeBadge open={r.open} close={r.close} />
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function RangeBadge({ open, close }: { open: string; close: string }) {
  const range = { open, close };
  if (isAllDay(range)) {
    return (
      <Badge variant="neutral" size="sm" icon="clock">
        Open 24 hours
      </Badge>
    );
  }
  if (!crossesMidnight(range)) return null;
  return (
    <Badge variant="neutral" size="sm" icon="clock">
      Past midnight
    </Badge>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function WeeklyHoursForm({
  value,
  onValueChange,
  maxRanges = MAX_RANGES_PER_DAY,
  errors,
  maxTotalRanges = MAX_RANGES_PER_WEEK,
  savedValue,
  closedControl = 'switch',
  onSave,
  onDiscard,
  saving = false,
  showErrors = false,
  barContent,
  heading,
  timeZoneNote = DEFAULT_NOTE,
  appearance = 'pane',
  testId,
  style,
}: WeeklyHoursEditorProps) {
  const base = `hg-hours-${useId().replace(/:/g, '')}`;
  const title = heading === undefined ? 'Edit weekly hours' : heading;
  const summaryRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);

  const checks = useMemo(
    () => checkWeeklyHours(value, { maxRanges, maxTotal: maxTotalRanges }),
    [value, maxRanges, maxTotalRanges],
  );
  const serverIssues: WeeklyHoursIssue[] = WEEKDAYS.flatMap((d) => {
    const message = errors?.[d.key];
    return message
      ? [
          {
            kind: 'server' as const,
            day: d.key,
            range: null,
            field: null,
            message,
            summary: `${d.label}: ${message}`,
          },
        ]
      : [];
  });
  const visible = [...serverIssues, ...(attempt > 0 || showErrors ? checks : [])];
  const serverKey = serverIssues.map((i) => i.summary).join('|');

  // The summary takes focus after a failed save or a new server refusal, never while typing.
  useEffect(() => {
    if (attempt > 0 || serverKey) summaryRef.current?.querySelector<HTMLElement>('[role="alert"]')?.focus();
  }, [attempt, serverKey]);

  const changed = changedDays(savedValue ?? value, value);
  const clean = changed.length === 0;
  const total = countRanges(value);
  const busy = saving;

  const setDay = (day: Weekday, next: DayHours) => onValueChange?.({ ...value, [day]: next });

  const rangeId = (day: Weekday, i: number) => `${base}-${day}-${i}`;
  const dayId = (day: Weekday) => `${base}-${day}`;
  const summaryItems = mergeByField(
    visible.map((issue) => ({
      fieldId:
        issue.day === null
          ? `${base}-ranges`
          : issue.range === null
            ? dayId(issue.day)
            : rangeId(issue.day, issue.range),
      message: issue.summary,
    })),
  );

  const save = () => {
    if (busy || clean) return;
    if (checks.length > 0) {
      setAttempt((n) => n + 1);
      return;
    }
    onSave?.(weeklyHoursToContract(value), value);
  };

  return (
    <section
      aria-labelledby={title ? `${base}-h` : undefined}
      aria-label={title ? undefined : 'Edit weekly hours'}
      aria-busy={busy || undefined}
      data-testid={testId ?? 'WeeklyHoursEditor'}
      data-mode="edit"
      className={cn('grid gap-3', appearance === 'pane' && PANE_CLASS)}
      style={style}
    >
      {title ? (
        <h2 id={`${base}-h`} className="m-0 text-heading-md text-fg-primary">
          {title}
        </h2>
      ) : null}
      <p id={`${base}-help`} className="m-0 text-body-sm text-fg-secondary">
        {`${timeZoneNote} 12-hour clock, am and pm. A closing time earlier than the opening time runs past midnight. Up to ${maxRanges} time ranges a day.`}
      </p>
      <div ref={summaryRef} id={`${base}-ranges`} tabIndex={-1} className="outline-none">
        <ErrorSummary
          errors={summaryItems}
          focusOnShow={false}
          title={`Fix ${plural(summaryItems.length, 'thing', 'things')} to save your hours`}
          testId="WeeklyHoursEditor-summary"
        />
      </div>
      <div className="@container grid">
        {WEEKDAYS.map((d) => (
          <DayRow
            key={d.key}
            id={dayId(d.key)}
            rangeId={(i) => rangeId(d.key, i)}
            dayKey={d.key}
            label={d.label}
            plural={d.plural}
            day={value[d.key]}
            issues={visible.filter((i) => i.day === d.key)}
            onChange={(next) => setDay(d.key, next)}
            control={closedControl}
            maxRanges={maxRanges}
            weekFull={total >= maxTotalRanges}
            maxTotalRanges={maxTotalRanges}
            busy={busy}
          />
        ))}
      </div>
      {onSave || onDiscard || barContent ? (
        <div
          role="group"
          aria-label="Hours actions"
          data-testid="WeeklyHoursEditor-bar"
          className="flex flex-wrap items-center gap-4 border-t border-line-decorative px-1 pt-3"
        >
          {barContent ?? (
            <>
              <div className="flex min-w-0 grow flex-col gap-0.5">
                <span className="text-label-lg text-fg-primary">
                  {clean ? 'No changes yet' : `Unsaved changes · ${plural(changed.length, 'day', 'days')} changed`}
                </span>
                <span className="text-body-sm text-fg-secondary tabular-nums">
                  {`Saving replaces your weekly hours. Special dates save as you change them. ${total} of ${maxTotalRanges} time ranges used.`}
                </span>
              </div>
              {clean ? <span className="text-body-sm text-fg-secondary">Nothing to save yet</span> : null}
              {onDiscard ? (
                <Button variant="tertiary" size="md" disabled={busy} onPress={() => onDiscard()}>
                  {clean ? 'Done' : 'Discard changes'}
                </Button>
              ) : null}
              {onSave ? (
                <Button variant="primary" size="md" loading={busy} disabled={clean} onPress={save}>
                  {busy ? 'Saving…' : 'Save hours'}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** One summary row per field: a range missing both times is one row, so each link is unique. */
function mergeByField(items: ErrorSummaryItem[]): ErrorSummaryItem[] {
  const out: ErrorSummaryItem[] = [];
  for (const item of items) {
    const prev = out.find((o) => o.fieldId === item.fieldId);
    if (prev) prev.message = `${prev.message}; ${item.message.replace(/^[^:]*: /, '')}`;
    else out.push({ ...item });
  }
  return out;
}

interface DayRowProps {
  id: string;
  rangeId: (i: number) => string;
  dayKey: Weekday;
  label: string;
  plural: string;
  day: DayHours;
  issues: WeeklyHoursIssue[];
  onChange: (next: DayHours) => void;
  control: 'switch' | 'checkbox';
  maxRanges: number;
  weekFull: boolean;
  maxTotalRanges: number;
  busy: boolean;
}

const EMPTY_RANGE = { open: '', close: '' };

function DayRow({
  id,
  rangeId,
  label,
  plural: pluralDay,
  day,
  issues,
  onChange,
  control,
  maxRanges,
  weekFull,
  maxTotalRanges,
  busy,
}: DayRowProps) {
  const open = !day.closed;
  const ranges = open ? day.ranges : [];
  const dayIssue = issues.find((i) => i.range === null);
  const setOpen = (next: boolean) => {
    if (busy) return;
    if (next)
      onChange({
        closed: false,
        ranges: day.ranges.length ? day.ranges : [EMPTY_RANGE],
      });
    else
      onChange({
        closed: true,
        ranges: day.ranges.filter((r) => r.open || r.close),
      });
  };
  const atDayLimit = ranges.length >= maxRanges;
  const addOff = atDayLimit || weekFull;
  const addWhy = weekFull ? `You’ve used all ${maxTotalRanges} time ranges` : `Up to ${maxRanges} time ranges a day`;
  const removed = day.closed ? day.ranges : [];
  const checkbox = control === 'checkbox';

  return (
    <fieldset
      id={id}
      tabIndex={-1}
      data-day={label}
      className="m-0 grid min-w-0 grid-cols-1 gap-3 border-0 border-t border-line-decorative px-0 py-2 outline-none @4xl:grid-cols-[12.5rem_minmax(0,1fr)]"
    >
      <legend className="sr-only">{label}</legend>
      {checkbox ? (
        <div className="grid content-start gap-1">
          <span className="text-label-lg text-fg-primary" aria-hidden="true">
            {label}
          </span>
          <Checkbox label="Closed" checked={day.closed} disabled={busy} onCheckedChange={(c) => setOpen(!c)} />
        </div>
      ) : (
        <div className="max-w-60">
          <Switch
            label={label}
            stateLabel={{ on: 'Open', off: 'Closed' }}
            checked={open}
            disabled={busy}
            onCheckedChange={setOpen}
          />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1.5">
        {day.closed ? (
          <span className="flex min-h-11 flex-wrap items-center gap-3 text-body-md text-fg-secondary">
            {removed.length
              ? `Closed all day. ${plural(removed.length, 'time range', 'time ranges')} removed (${removed.map(formatRange).join(', ')}).`
              : checkbox
                ? `No times. Customers can’t order on ${pluralDay}.`
                : 'Closed all day'}
            {removed.length ? (
              <Button
                variant="ghost"
                size="md"
                iconStart="undo"
                accessibilityLabel={`Undo closing ${label}`}
                disabled={busy}
                onPress={() => setOpen(true)}
              >
                Undo
              </Button>
            ) : null}
          </span>
        ) : null}
        {ranges.map((r, i) => {
          const many = ranges.length > 1;
          const openErr = issues.find((x) => x.range === i && x.field === 'open')?.message;
          const closeErr = issues.find((x) => x.range === i && x.field === 'close')?.message;
          const removeName =
            r.open && r.close
              ? `Remove ${formatRange(r).replace(' – ', ' to ')} on ${label}`
              : `Remove time range ${i + 1} on ${label}`;
          const update = (patch: Partial<typeof r>) =>
            onChange({
              closed: false,
              ranges: ranges.map((x, j) => (j === i ? { ...x, ...patch } : x)),
            });
          const remove = () => {
            const rest = ranges.filter((_, j) => j !== i);
            onChange(rest.length ? { closed: false, ranges: rest } : { closed: true, ranges: [] });
          };
          return (
            <div
              key={i}
              id={rangeId(i)}
              tabIndex={-1}
              role="group"
              aria-label={many ? `${label}, time range ${i + 1}` : `${label}, time range`}
              className="flex flex-wrap items-start gap-x-3 gap-y-1 outline-none"
            >
              <div className="min-w-0 max-w-80">
                <TimeField
                  label={many ? `Opens, range ${i + 1}` : 'Opens'}
                  value={r.open || null}
                  onValueChange={(v) => update({ open: v ?? '' })}
                  errorText={openErr ?? null}
                  disabled={busy}
                  compact
                  testId="WeeklyHoursEditor-opens"
                />
              </div>
              <div className="min-w-0 max-w-80">
                <TimeField
                  label={many ? `Closes, range ${i + 1}` : 'Closes'}
                  value={r.close || null}
                  onValueChange={(v) => update({ close: v ?? '' })}
                  errorText={closeErr ?? null}
                  disabled={busy}
                  compact
                  testId="WeeklyHoursEditor-closes"
                />
              </div>
              <div className="mt-7 flex min-h-11 items-center gap-2">
                {checkbox ? (
                  many ? (
                    <Button variant="ghost" size="md" accessibilityLabel={removeName} disabled={busy} onPress={remove}>
                      Remove
                    </Button>
                  ) : null
                ) : (
                  <IconButton icon="close" accessibilityLabel={removeName} disabled={busy} onPress={remove} />
                )}
              </div>
              {crossesMidnight(r) ? (
                <div className="basis-full">
                  <RangeBadge open={r.open} close={r.close} />
                </div>
              ) : null}
            </div>
          );
        })}
        {open ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant={checkbox ? 'tertiary' : 'ghost'}
              size="md"
              iconStart="plus"
              disabled={addOff || busy}
              accessibilityLabel={`${checkbox ? `Add another time on ${label}` : `Add hours on ${label}`}${addOff ? `. Not available: ${addWhy.toLowerCase()}.` : ''}`}
              onPress={() => onChange({ closed: false, ranges: [...ranges, EMPTY_RANGE] })}
            >
              {checkbox ? 'Add another time' : `Add hours on ${label}`}
            </Button>
            {addOff ? <span className="text-body-sm text-fg-secondary">{addWhy}</span> : null}
          </div>
        ) : null}
        {dayIssue ? (
          <FieldMessage id={`${id}-error`} error>
            {dayIssue.message}
          </FieldMessage>
        ) : null}
      </div>
    </fieldset>
  );
}
