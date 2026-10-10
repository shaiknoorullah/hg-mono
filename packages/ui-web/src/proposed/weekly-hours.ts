/**
 * The weekly hours model behind `WeeklyHoursEditor` (approval packet P23), as pure functions so
 * the screen, the tests and the save call share one reading of the rules.
 *
 * - The editor's value is the packet's per-day shape: each weekday is Closed or has up to 3
 *   ranges of 24-hour `HH:mm` (`''` while a time is not typed yet).
 * - The contract's shape is `RestaurantHoursInput.intervals`: one `TradingInterval` per range,
 *   `day_of_week` 0 = Sunday, `crosses_midnight` when the range closes at or before it opens.
 *   A Closed day sends no interval. The same opening and closing time is 24 hours (the server's
 *   `!end.After(start)` rule), so it also crosses midnight.
 * - `setRestaurantHours` replaces the intervals **and** the overrides: `toRestaurantHoursInput`
 *   always carries the special dates the screen read, or saving the week would delete them.
 * - Overlap is checked on one circular week of minutes, so a range past midnight that runs into
 *   the next day's first range is caught, including Sunday into Monday.
 */

import type { Schema } from '@hg/api-client';

import { formatClockTime } from './TimeField.js';

/** A weekday key, Monday first (the order the canvases list the week in). */
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** One time range: 24-hour `HH:mm`, or `''` while it is not typed yet. */
export interface HoursRange {
  open: string;
  close: string;
}

/**
 * One day. `closed` with ranges still listed means the day was just switched to Closed: the
 * ranges are kept only so Undo can bring them back, and none of them is saved.
 */
export interface DayHours {
  closed: boolean;
  ranges: HoursRange[];
}

/** The editor's value (packet P23). */
export type WeeklyHours = Record<Weekday, DayHours>;

/** The contract's interval (`TradingInterval`). */
export type TradingInterval = Schema['TradingInterval'];
/** The contract's special date (`HoursOverride`). */
export type HoursOverride = Schema['HoursOverride'];
/** The `setRestaurantHours` body (`RestaurantHoursInput`). */
export type RestaurantHoursInput = Schema['RestaurantHoursInput'];

/** The week, Monday first, with the label and the contract's `day_of_week` (0 = Sunday). */
export const WEEKDAYS: ReadonlyArray<{ key: Weekday; label: string; plural: string; dayOfWeek: number }> = [
  { key: 'mon', label: 'Monday', plural: 'Mondays', dayOfWeek: 1 },
  { key: 'tue', label: 'Tuesday', plural: 'Tuesdays', dayOfWeek: 2 },
  { key: 'wed', label: 'Wednesday', plural: 'Wednesdays', dayOfWeek: 3 },
  { key: 'thu', label: 'Thursday', plural: 'Thursdays', dayOfWeek: 4 },
  { key: 'fri', label: 'Friday', plural: 'Fridays', dayOfWeek: 5 },
  { key: 'sat', label: 'Saturday', plural: 'Saturdays', dayOfWeek: 6 },
  { key: 'sun', label: 'Sunday', plural: 'Sundays', dayOfWeek: 0 },
];

/** Up to 3 ranges a day (owner decision; HoursDayClosed). */
export const MAX_RANGES_PER_DAY = 3;
/** `RestaurantHoursInput.intervals.maxItems`. */
export const MAX_RANGES_PER_WEEK = 21;
/** `RestaurantHoursInput.overrides.maxItems`. */
export const MAX_SPECIAL_DATES = 90;

const DAY_MINUTES = 1440;
const WEEK_MINUTES = 7 * DAY_MINUTES;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function labelOf(day: Weekday): string {
  return WEEKDAYS.find((d) => d.key === day)!.label;
}

function minutes(value: string): number | null {
  const m = HHMM.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A week with every day Closed. */
export function emptyWeek(): WeeklyHours {
  return Object.fromEntries(WEEKDAYS.map((d) => [d.key, { closed: true, ranges: [] }])) as unknown as WeeklyHours;
}

/** True when the range closes at or before it opens: it runs past midnight (or is 24 hours). */
export function crossesMidnight(range: HoursRange): boolean {
  const o = minutes(range.open);
  const c = minutes(range.close);
  return o !== null && c !== null && c <= o;
}

/** True when the opening and closing times are the same: open 24 hours. */
export function isAllDay(range: HoursRange): boolean {
  return minutes(range.open) !== null && range.open === range.close;
}

/** The ranges that count: none for a Closed day. */
export function activeRanges(day: DayHours): HoursRange[] {
  return day.closed ? [] : day.ranges;
}

/** How many ranges the week would save (the 21 limit counts these). */
export function countRanges(week: WeeklyHours): number {
  return WEEKDAYS.reduce((n, d) => n + activeRanges(week[d.key]).length, 0);
}

/**
 * "11:00 am – 3:00 pm", "Open 24 hours from 9:00 am", through the shared 12-hour formatter.
 * A time not typed yet reads "–".
 */
export function formatRange(range: HoursRange): string {
  if (isAllDay(range)) return `Open 24 hours from ${formatClockTime(range.open)}`;
  return spanText(range);
}

function spanText(range: HoursRange): string {
  return `${formatClockTime(range.open) ?? '–'} – ${formatClockTime(range.close) ?? '–'}`;
}

/** The contract's intervals → the editor's week. A day with no interval is Closed. */
export function weeklyHoursFromContract(intervals: ReadonlyArray<TradingInterval> | null | undefined): WeeklyHours {
  const week = emptyWeek();
  const sorted = [...(intervals ?? [])].sort((a, b) => a.opens_at.localeCompare(b.opens_at));
  for (const iv of sorted) {
    const day = WEEKDAYS.find((d) => d.dayOfWeek === iv.day_of_week);
    if (!day) continue;
    week[day.key] = { closed: false, ranges: [...week[day.key].ranges, { open: iv.opens_at, close: iv.closes_at }] };
  }
  return week;
}

/**
 * The editor's week → the contract's intervals, Sunday first. A Closed day emits nothing; a
 * range missing a time is not sendable and is left out (the check refuses the save first).
 */
export function weeklyHoursToContract(week: WeeklyHours): TradingInterval[] {
  const out: TradingInterval[] = [];
  for (const d of [...WEEKDAYS].sort((a, b) => a.dayOfWeek - b.dayOfWeek)) {
    for (const r of activeRanges(week[d.key])) {
      if (minutes(r.open) === null || minutes(r.close) === null) continue;
      out.push({ day_of_week: d.dayOfWeek, opens_at: r.open, closes_at: r.close, crosses_midnight: crossesMidnight(r) });
    }
  }
  return out;
}

/**
 * The whole `setRestaurantHours` body. It replaces the special dates too, so pass the ones the
 * screen read (`RestaurantHours.overrides`), unchanged, or they are deleted.
 */
export function toRestaurantHoursInput(
  week: WeeklyHours,
  overrides: ReadonlyArray<HoursOverride> | null | undefined,
): RestaurantHoursInput {
  return { intervals: weeklyHoursToContract(week), overrides: [...(overrides ?? [])] };
}

function signature(day: DayHours): string {
  return activeRanges(day)
    .map((r) => `${r.open}-${r.close}`)
    .sort()
    .join(',');
}

/** The days whose saved hours would change (dirty tracking for the save bar). */
export function changedDays(saved: WeeklyHours, current: WeeklyHours): Weekday[] {
  return WEEKDAYS.filter((d) => signature(saved[d.key]) !== signature(current[d.key])).map((d) => d.key);
}

/** One problem that stops the save. */
export interface WeeklyHoursIssue {
  kind: 'missing-open' | 'missing-close' | 'overlap' | 'too-many-day' | 'too-many-week' | 'server';
  /** The day it belongs to, or null for the whole week (the 21 limit). */
  day: Weekday | null;
  /** The range it belongs to, or null for the day. */
  range: number | null;
  /** The field that shows it. */
  field: 'open' | 'close' | null;
  /** Under the field: "Overlaps 11:00 am – 3:00 pm. Change one of them." */
  message: string;
  /** In the summary: "Friday: two time ranges overlap". */
  summary: string;
}

/** Limits for `checkWeeklyHours`. */
export interface CheckWeeklyHoursOptions {
  maxRanges?: number;
  maxTotal?: number;
}

interface Placed {
  day: Weekday;
  index: number;
  range: HoursRange;
  start: number;
  end: number;
}

function place(week: WeeklyHours): Placed[] {
  const out: Placed[] = [];
  for (const d of WEEKDAYS) {
    activeRanges(week[d.key]).forEach((range, index) => {
      const o = minutes(range.open);
      const c = minutes(range.close);
      if (o === null || c === null) return;
      const start = d.dayOfWeek * DAY_MINUTES + o;
      out.push({ day: d.key, index, range, start, end: start + (c <= o ? c + DAY_MINUTES - o : c - o) });
    });
  }
  return out;
}

/** Overlap on a circular week: tries the pair as is and shifted by one week either way. */
function overlapOrder(a: Placed, b: Placed): [Placed, Placed] | null {
  for (const shift of [0, WEEK_MINUTES, -WEEK_MINUTES]) {
    const bs = b.start + shift;
    const be = b.end + shift;
    if (a.start < be && bs < a.end) return a.start < bs || (a.start === bs && a.index < b.index) ? [a, b] : [b, a];
  }
  return null;
}

/**
 * Every problem that stops the week saving: a time not typed, more than 3 ranges on a day, more
 * than 21 in the week, and overlapping ranges, including a range past midnight that runs into
 * the next day's (Sunday into Monday too). The message goes on the later range.
 */
export function checkWeeklyHours(week: WeeklyHours, options: CheckWeeklyHoursOptions = {}): WeeklyHoursIssue[] {
  const maxRanges = options.maxRanges ?? MAX_RANGES_PER_DAY;
  const maxTotal = options.maxTotal ?? MAX_RANGES_PER_WEEK;
  const issues: WeeklyHoursIssue[] = [];
  for (const d of WEEKDAYS) {
    const ranges = activeRanges(week[d.key]);
    const where = (i: number) => (ranges.length > 1 ? `${d.label}, time range ${i + 1}` : d.label);
    ranges.forEach((r, i) => {
      if (minutes(r.open) === null) {
        issues.push({ kind: 'missing-open', day: d.key, range: i, field: 'open', message: 'Enter an opening time.', summary: `${where(i)}: enter an opening time` });
      }
      if (minutes(r.close) === null) {
        issues.push({ kind: 'missing-close', day: d.key, range: i, field: 'close', message: 'Enter a closing time.', summary: `${where(i)}: enter a closing time` });
      }
    });
    if (ranges.length > maxRanges) {
      issues.push({
        kind: 'too-many-day',
        day: d.key,
        range: null,
        field: null,
        message: `Up to ${maxRanges} time ranges a day. Remove ${ranges.length - maxRanges}.`,
        summary: `${d.label}: up to ${maxRanges} time ranges a day`,
      });
    }
  }
  const total = countRanges(week);
  if (total > maxTotal) {
    issues.push({
      kind: 'too-many-week',
      day: null,
      range: null,
      field: null,
      message: `You have ${total} time ranges. The most is ${maxTotal}.`,
      summary: `You have ${total} time ranges. Remove ${total - maxTotal} to save.`,
    });
  }
  const placed = place(week);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const pair = overlapOrder(placed[i]!, placed[j]!);
      if (!pair) continue;
      const [first, later] = pair;
      const text = spanText(first.range);
      if (first.day === later.day) {
        issues.push({
          kind: 'overlap',
          day: later.day,
          range: later.index,
          field: 'close',
          message: `Overlaps ${text}. Change one of them.`,
          summary: `${labelOf(later.day)}: two time ranges overlap`,
        });
      } else {
        const runsTo = formatClockTime(first.range.close) ?? '';
        issues.push({
          kind: 'overlap',
          day: later.day,
          range: later.index,
          field: 'close',
          message: `Overlaps ${labelOf(first.day)} ${text}, which runs to ${runsTo} on ${labelOf(later.day)}. Change one of them.`,
          summary: `${labelOf(first.day)} and ${labelOf(later.day)}: ${labelOf(first.day)} ${text} runs into ${labelOf(later.day)} ${spanText(later.range)}`,
        });
      }
    }
  }
  return issues;
}
