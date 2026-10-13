/**
 * The one time formatter for the customer redesign (manifest global rule 4, gate item 10).
 *
 * Every clock time is 12-hour and lowercase ("7:42 pm"), in Toronto time whatever the phone's
 * zone, because restaurants, riders and support all work in Ontario time. Dates are written
 * out ("28 September 2026") or short ("20 Oct"). Nothing here ticks: callers pass absolute times.
 */
export const APP_TIME_ZONE = 'America/Toronto';

type DateLike = Date | string | number;

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

const clockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function clock(value: DateLike): { hm: string; period: 'am' | 'pm' } {
  const parts = clockParts.formatToParts(toDate(value));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const period = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toLowerCase().startsWith('p')
    ? 'pm'
    : 'am';
  return { hm: `${hour}:${minute}`, period };
}

/** "7:42 pm", "12:00 pm". */
export function formatTime(value: DateLike): string {
  const { hm, period } = clock(value);
  return `${hm} ${period}`;
}

/**
 * A window between two times: "7:10–7:20 pm" when both share a period, "11:50 am–12:10 pm" when
 * the window crosses noon or midnight. The dash is an en dash.
 */
export function formatTimeWindow(from: DateLike, to: DateLike): string {
  const a = clock(from);
  const b = clock(to);
  if (a.period === b.period) return `${a.hm}–${b.hm} ${b.period}`;
  return `${a.hm} ${a.period}–${b.hm} ${b.period}`;
}

/** The spoken form of a window, for a hidden accessibility sentence: "between 7:10 and 7:20 pm". */
export function spokenTimeWindow(from: DateLike, to: DateLike): string {
  const a = clock(from);
  const b = clock(to);
  if (a.period === b.period) return `between ${a.hm} and ${b.hm} ${b.period}`;
  return `between ${a.hm} ${a.period} and ${b.hm} ${b.period}`;
}

const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const shortDateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

/**
 * A calendar date from the contract (`format: date`, "2026-10-20") has no time zone: it is that
 * day. Parse it at UTC noon so formatting in Toronto never shifts it to the day before.
 */
function fromCalendarDate(value: DateLike): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`);
  }
  return toDate(value);
}

/** "28 September 2026". */
export function formatDate(value: DateLike): string {
  return longDate.format(fromCalendarDate(value));
}

/** "20 Oct" (no full stop after the month). */
export function formatShortDate(value: DateLike): string {
  return shortDateFmt.format(fromCalendarDate(value)).replace('.', '');
}

/** A server instant plus a number of seconds, for "You can ask for a new code at 6:48 pm". */
export function timeAfter(base: DateLike, seconds: number): Date {
  return new Date(toDate(base).getTime() + seconds * 1000);
}

/* WP4 (restaurant page): wall-clock times and calendar days. */

/**
 * A contract wall-clock time ("13:00", `TradingInterval.opens_at`) as "1:00 pm". It is a time of
 * day in the restaurant's own zone, not an instant, so it is formatted as written, never shifted.
 */
export function formatWallClock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  const period = h >= 12 && h < 24 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${period}`;
}

/** "11:00 am–10:00 pm": a wall-clock range, both ends with their period. The dash is an en dash. */
export function formatWallClockRange(from: string, to: string): string {
  return `${formatWallClock(from)}–${formatWallClock(to)}`;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The weekday (0 = Sunday) of an instant in a zone, for "Monday (today)". */
export function weekdayIn(value: DateLike, timeZone: string = APP_TIME_ZONE): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(toDate(value));
  return WEEKDAY_SHORT.indexOf(name);
}

/** Whole calendar days from `from` to `to` in a zone: 0 the same day, 1 tomorrow. */
export function calendarDaysBetween(from: DateLike, to: DateLike, timeZone: string = APP_TIME_ZONE): number {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (v: DateLike) => Date.parse(`${ymd.format(toDate(v))}T00:00:00Z`);
  return Math.round((day(to) - day(from)) / 86_400_000);
}

/** "Friday": the weekday name of an instant in a zone. */
export function formatWeekday(value: DateLike, timeZone: string = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(toDate(value));
}
