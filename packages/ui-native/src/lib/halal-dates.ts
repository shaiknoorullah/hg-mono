/**
 * Wire dates for the halal family (design-system N4), read the way the live design system reads
 * them (`components/bundle.js`, `parseWireDate` / `formatShortDate`): a date-only value
 * (`2026-10-14`) is a calendar day and is printed as written. A date-time (`verified_at`) is an
 * instant, printed as its calendar day in America/Toronto, the launch market: 21:00 on 1 October
 * in Toronto is 1 October, never the next day's UTC date.
 *
 * Toronto's offset is computed from the Canadian daylight-saving rule (second Sunday of March to
 * first Sunday of November, 02:00 local), not `Intl`'s `timeZone`, which not every Hermes build
 * honours.
 *
 * The month names are a fixed English table, not `Intl`: no locale turns "Sep" into "Sept.", and
 * an engine without full `Intl` (Hermes builds vary) cannot drop the month. A value that does not
 * parse returns `null`, and the caller then shows NO date. Nothing here ever echoes the raw
 * string or invents a date.
 */

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const LONG_MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `YYYY-MM-DD` as UTC midnight, or an ISO date-time; `null` for anything else. */
export function parseWireDate(value: string | null | undefined): Date | null {
  if (!value || typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  // Some engines roll "2026-02-30" over to 2 March; a date that does not round-trip is not a date.
  return date.toISOString().slice(0, 10) === value.slice(0, 10) || !dateOnly ? date : null;
}

/** First Sunday on or after `day` of `month` (0-based) in `year`, as a UTC day of month. */
function sundayOnOrAfter(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
  return day + ((7 - weekday) % 7);
}

/** America/Toronto's UTC offset in hours at `date`: -4 in daylight time, -5 otherwise. */
function torontoOffsetHours(date: Date): number {
  const year = date.getUTCFullYear();
  // 02:00 EST = 07:00 UTC on the second Sunday of March; 02:00 EDT = 06:00 UTC on the first Sunday of November.
  const start = Date.UTC(year, 2, sundayOnOrAfter(year, 2, 8), 7);
  const end = Date.UTC(year, 10, sundayOnOrAfter(year, 10, 1), 6);
  const t = date.getTime();
  return t >= start && t < end ? -4 : -5;
}

/** The calendar day to print: as written for a date-only value, the Toronto day for a date-time. */
function calendarDay(value: string | null | undefined): Date | null {
  const date = parseWireDate(value);
  if (!date || /^\d{4}-\d{2}-\d{2}$/.test(value as string)) return date;
  return new Date(date.getTime() + torontoOffsetHours(date) * 3_600_000);
}

/** "14 Oct": the badge's one-line label (an owner-approved exception to the written-out rule). */
export function formatShortDate(value: string | null | undefined): string | null {
  const date = calendarDay(value);
  return date ? `${date.getUTCDate()} ${SHORT_MONTH[date.getUTCMonth()]}` : null;
}

/** "14 October 2026": every other place a halal date is shown or spoken. Never relative. */
export function formatLongDate(value: string | null | undefined): string | null {
  const date = calendarDay(value);
  return date ? `${date.getUTCDate()} ${LONG_MONTH[date.getUTCMonth()]} ${date.getUTCFullYear()}` : null;
}
