/**
 * Absolute date rendering.
 *
 * C-12 surface 2 and `04-accessibility.md` §3.3: certification dates are **always absolute**
 * ("Valid until 14 March 2027"), never relative ("expires in 7 months"), in both the visible
 * label and the accessible name. A relative expiry invites the reader to estimate; a
 * certification date is a fact.
 */

const LONG_PARTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
};

/**
 * A wire date (`2027-03-14`) or date-time is rendered as `14 March 2027`.
 *
 * Date-only values are anchored to UTC so a device west of Greenwich does not render the day
 * before the certificate expires.
 */
export function formatAbsoluteDate(value: string | null | undefined, locale = 'en-CA'): string | null {
  const date = parseWireDate(value);
  if (!date) return null;

  const parts = new Intl.DateTimeFormat(locale, LONG_PARTS).formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const year = parts.find((p) => p.type === 'year')?.value;
  if (!day || !month || !year) return null;
  return `${day} ${month} ${year}`;
}

/** `2027-03-14T18:04:00Z` → `14 March 2027`. Used for `verified_at` in the standing line. */
export function formatAbsoluteDateTime(
  value: string | null | undefined,
  locale = 'en-CA',
): string | null {
  return formatAbsoluteDate(value, locale);
}

/** The value for a `<time datetime>` attribute — the wire value, untouched. */
export function isoAttribute(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function parseWireDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
