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
