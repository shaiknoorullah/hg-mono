/**
 * Hours, pure logic (WP9, spec wp9-hours §4–§5): the weekly table as the editor holds it,
 * the client-side checks the server does not make (overlap, including a late range running
 * past midnight into the next day and Sunday into Monday; 3 ranges a day; 21 in all; 90
 * special dates; the one-year window), and the mapping of a 422 back to the day it names.
 *
 * Data stays 24-hour "HH:MM" (the contract); every label goes through `format/time.ts`.
 */
import type { Schema } from '@hg/api-client';
import {
  WEEKDAY_NAMES,
  addDays,
  clockMinutes,
  formatClock,
  formatClockRange,
  formatDayDate,
  isClock,
  weekdayOf,
} from '../format/time';

export type RestaurantHours = Schema['RestaurantHours'];
export type TradingInterval = Schema['TradingInterval'];
export type HoursOverride = Schema['HoursOverride'];

/** The contract's limits (RestaurantHoursInput maxItems) and the canvas's per-day limit. */
export const MAX_RANGES = 21;
export const MAX_RANGES_PER_DAY = 3;
export const MAX_SPECIAL_DATES = 90;

/** Monday first, as the canvas draws the week. Values are `day_of_week` (0 = Sunday). */
export const UI_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
/** Fieldset ids the error summary links to. */
export const DAY_IDS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const dayName = (day: number): string => WEEKDAY_NAMES[((day % 7) + 7) % 7]!;

export interface Range {
  /** Stable React key. */
  key: string;
  /** "HH:MM", '' when empty, or the raw text when it is not a time. */
  opens: string;
  closes: string;
}

/** Seven days indexed by `day_of_week`; an empty list is "Closed all day". */
export type Week = Range[][];

let keySeq = 0;
export const newKey = (): string => `r${++keySeq}`;

export function emptyWeek(): Week {
  return [[], [], [], [], [], [], []];
}

export function weekFromIntervals(intervals: readonly TradingInterval[]): Week {
  const week = emptyWeek();
  for (const iv of intervals) {
    week[iv.day_of_week]?.push({ key: newKey(), opens: iv.opens_at, closes: iv.closes_at });
  }
  for (const day of week) day.sort((a, b) => clockMinutes(a.opens) - clockMinutes(b.opens));
  return week;
}

/** Same opening and closing time is a full 24 hours, not an error (`HoursTwentyFour`). */
export const isTwentyFour = (opens: string, closes: string): boolean => isClock(opens) && opens === closes;
/** A closing time earlier than (or equal to) the opening time runs past midnight. */
export const crossesMidnight = (opens: string, closes: string): boolean =>
  isClock(opens) && isClock(closes) && clockMinutes(closes) <= clockMinutes(opens);

/** The body's `intervals`, Monday first, and where each one came from (to map a 422 back). */
export function intervalsFromWeek(week: Week): { intervals: TradingInterval[]; origin: { day: number; range: number }[] } {
  const intervals: TradingInterval[] = [];
  const origin: { day: number; range: number }[] = [];
  for (const day of UI_DAYS) {
    week[day]!.forEach((r, range) => {
      intervals.push({ day_of_week: day, opens_at: r.opens, closes_at: r.closes, crosses_midnight: crossesMidnight(r.opens, r.closes) });
      origin.push({ day, range });
    });
  }
  return { intervals, origin };
}

const dayKey = (ranges: readonly Range[]) =>
  ranges
    .map((r) => `${r.opens}-${r.closes}`)
    .sort()
    .join(',');

/** Days whose ranges differ from the version the edit started from. */
export function changedDays(start: Week, now: Week): number {
  let n = 0;
  for (let d = 0; d < 7; d++) if (dayKey(start[d]!) !== dayKey(now[d]!)) n++;
  return n;
}

/** Two server versions of the weekly hours are the same table (order-insensitive). */
export function sameIntervals(a: readonly TradingInterval[], b: readonly TradingInterval[]): boolean {
  const key = (xs: readonly TradingInterval[]) =>
    xs
      .map((x) => `${x.day_of_week}@${x.opens_at}-${x.closes_at}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}

export const rangeCount = (week: Week): number => week.reduce((n, d) => n + d.length, 0);

/** "11:00 am – 10:00 pm" or "11:00 am – 3:00 pm, 5:00 pm – 2:00 am" or "Closed". */
export function describeDay(ranges: readonly { opens: string; closes: string }[]): string {
  if (ranges.length === 0) return 'Closed';
  return ranges.map((r) => formatClockRange(r.opens, r.closes)).join(', ');
}

// ── Validation ───────────────────────────────────────────────────────────────────────────

export interface HoursIssue {
  day: number;
  range: number;
  field: 'opens' | 'closes';
  /** Under the field. */
  message: string;
  /** The link text in the error summary. */
  summary: string;
  /** The fieldset the summary link jumps to. */
  target: string;
}

const WEEK = 7 * 1440;

/** Validates the editor's week; issues ordered Monday first, as the summary lists them. */
export function validateWeek(week: Week): HoursIssue[] {
  const issues: HoursIssue[] = [];
  const has = new Set<string>();
  const push = (i: HoursIssue) => {
    const k = `${i.day}:${i.range}:${i.field}`;
    if (has.has(k)) return;
    has.add(k);
    issues.push(i);
  };

  type Span = { day: number; range: number; start: number; end: number; opens: string; closes: string };
  const spans: Span[] = [];
  for (let day = 0; day < 7; day++) {
    week[day]!.forEach((r, range) => {
      const name = dayName(day);
      for (const field of ['opens', 'closes'] as const) {
        const v = r[field];
        const what = field === 'opens' ? 'an opening time' : 'a closing time';
        if (v === '') push({ day, range, field, message: `Enter ${what}.`, summary: `${name}: enter ${what}`, target: DAY_IDS[day]! });
        else if (!isClock(v)) push({ day, range, field, message: 'Enter a time like 11:00 am.', summary: `${name}: enter a time like 11:00 am`, target: DAY_IDS[day]! });
      }
      if (isClock(r.opens) && isClock(r.closes)) {
        const o = clockMinutes(r.opens);
        const c = clockMinutes(r.closes);
        const len = c > o ? c - o : c + 1440 - o;
        const start = day * 1440 + o;
        spans.push({ day, range, start, end: start + len, opens: r.opens, closes: r.closes });
      }
    });
  }

  const overlaps = (a: Span, b: Span) =>
    [-WEEK, 0, WEEK].some((shift) => a.start < b.end + shift && b.start + shift < a.end);

  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const a = spans[i]!;
      const b = spans[j]!;
      if (!overlaps(a, b)) continue;
      if (a.day === b.day) {
        // The later range (by opening time) carries the error.
        const [first, later] = clockMinutes(a.opens) <= clockMinutes(b.opens) ? [a, b] : [b, a];
        push({
          day: later.day,
          range: later.range,
          field: 'closes',
          message: `Overlaps ${formatClockRange(first.opens, first.closes)}. Change one of them.`,
          summary: `${dayName(later.day)}: two time ranges overlap`,
          target: DAY_IDS[later.day]!,
        });
      } else {
        // A late range running past midnight into the next day (Saturday → Sunday and
        // Sunday → Monday wrap the week).
        const next = (d: number) => (d + 1) % 7;
        const [early, late] = next(a.day) === b.day ? [a, b] : [b, a];
        const runsTo = formatClock(early.closes);
        push({
          day: late.day,
          range: late.range,
          field: 'closes',
          message: `Overlaps ${dayName(early.day)} ${formatClockRange(early.opens, early.closes)}, which runs to ${runsTo} on ${dayName(late.day)}. Change one of them.`,
          summary: `${dayName(early.day)} and ${dayName(late.day)}: ${dayName(early.day)} ${formatClockRange(early.opens, early.closes)} runs into ${dayName(late.day)} ${formatClockRange(late.opens, late.closes)}`,
          target: DAY_IDS[late.day]!,
        });
      }
    }
  }

  const order = (d: number) => (d + 6) % 7; // Monday first
  return issues.sort((x, y) => order(x.day) - order(y.day) || x.range - y.range);
}

/** "Fix 1 thing to save your hours" / "Fix 2 things to save your hours". */
export const fixTitle = (n: number, what: string): string => `Fix ${n} thing${n === 1 ? '' : 's'} to ${what}`;

/** A 422's `details[].field` (`intervals[3].closes_at`) → the issue on that day and range. */
export function issuesFromServer(
  details: readonly { field: string; message?: string }[] | undefined,
  origin: readonly { day: number; range: number }[],
): HoursIssue[] {
  const out: HoursIssue[] = [];
  for (const d of details ?? []) {
    const m = /^intervals\[(\d+)\]\.?(\w+)?/.exec(d.field);
    if (!m) continue;
    const at = origin[Number(m[1])];
    if (!at) continue;
    const field = m[2] === 'opens_at' ? 'opens' : 'closes';
    out.push({
      day: at.day,
      range: at.range,
      field,
      message: 'HalalGoes couldn’t accept this time. Enter a time like 11:00 am.',
      summary: `${dayName(at.day)}: HalalGoes couldn’t accept a time`,
      target: DAY_IDS[at.day]!,
    });
  }
  return out;
}

// ── "Right now" helpers ──────────────────────────────────────────────────────────────────

/** Whether the weekly hours cover a minute of the week (`day * 1440 + minutes`). */
export function weekCovers(week: Week, day: number, minutes: number): boolean {
  const at = day * 1440 + minutes;
  for (let d = 0; d < 7; d++) {
    for (const r of week[d]!) {
      if (!isClock(r.opens) || !isClock(r.closes)) continue;
      const o = clockMinutes(r.opens);
      const c = clockMinutes(r.closes);
      const start = d * 1440 + o;
      const end = start + (c > o ? c - o : c + 1440 - o);
      if ([-WEEK, 0, WEEK].some((s) => at >= start + s && at < end + s)) return true;
    }
  }
  return false;
}

// ── Special dates ────────────────────────────────────────────────────────────────────────

/** The hours line of a special date: "Closed all day" | "12:00 pm – 8:00 pm" | "… (past midnight)". */
export function describeOverride(o: HoursOverride): string {
  if (o.is_closed || !o.opens_at || !o.closes_at) return 'Closed all day';
  if (isTwentyFour(o.opens_at, o.closes_at)) return `Open 24 hours from ${formatClock(o.opens_at)}`;
  const range = formatClockRange(o.opens_at, o.closes_at);
  return crossesMidnight(o.opens_at, o.closes_at) ? `${range} (past midnight)` : range;
}

/** "Runs to 1:00 am on Friday 1 January 2027." for special hours past midnight. */
export function overrideNightNote(o: HoursOverride): string | null {
  if (o.is_closed || !o.opens_at || !o.closes_at || isTwentyFour(o.opens_at, o.closes_at)) return null;
  if (!crossesMidnight(o.opens_at, o.closes_at)) return null;
  return `Runs to ${formatClock(o.closes_at)} on ${formatDayDate(addDays(o.date, 1))}.`;
}

/**
 * A closed special date after a weekday whose hours run past midnight:
 * "Friday’s hours still run to 2:00 am on Saturday. You’re closed from 2:00 am."
 */
export function closedAfterLateNote(o: HoursOverride, week: Week): string | null {
  if (!o.is_closed) return null;
  const day = weekdayOf(o.date);
  const prev = (day + 6) % 7;
  const late = week[prev]!.filter((r) => crossesMidnight(r.opens, r.closes) && !isTwentyFour(r.opens, r.closes));
  if (late.length === 0) return null;
  const closes = late.map((r) => r.closes).sort((a, b) => clockMinutes(b) - clockMinutes(a))[0]!;
  return `${dayName(prev)}’s hours still run to ${formatClock(closes)} on ${dayName(day)}. You’re closed from ${formatClock(closes)}.`;
}

export function sortOverrides(list: readonly HoursOverride[]): HoursOverride[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date));
}
