/**
 * Wire dates for the halal family (design-system N4), read the way the live design system reads
 * them (`components/bundle.js`, `parseWireDate` / `formatShortDate`): a date-only value
 * (`2026-10-14`) is midnight UTC, and both forms are printed in UTC, so the short label and the
 * absolute date can never disagree about the day.
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

/** "14 Oct": the badge's one-line label (an owner-approved exception to the written-out rule). */
export function formatShortDate(value: string | null | undefined): string | null {
  const date = parseWireDate(value);
  return date ? `${date.getUTCDate()} ${SHORT_MONTH[date.getUTCMonth()]}` : null;
}

/** "14 October 2026": every other place a halal date is shown or spoken. Never relative. */
export function formatLongDate(value: string | null | undefined): string | null {
  const date = parseWireDate(value);
  return date ? `${date.getUTCDate()} ${LONG_MONTH[date.getUTCMonth()]} ${date.getUTCFullYear()}` : null;
}
