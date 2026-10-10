/**
 * The rules behind the form components (design-system N3), kept out of the components so they
 * are tested as plain functions: what each `Input` variant hands to `onValueChange`, how a phone
 * number is shown, how a price joins an option's accessible name, and how a typed day, month and
 * year become an ISO date.
 *
 * Money here is only ever DISPLAYED (invariant 1: the server prices every order). A price delta
 * arrives as integer cents from the API and is passed to `Price`; nothing in this file adds,
 * multiplies or rounds an amount.
 */
import type { Cents } from '@hg/api-client';

import { spokenPrice } from '../content/Price';
import { formatTel } from '../primitives/Input';

/** The live `Input` variants. */
export type InputVariant = 'text' | 'email' | 'tel' | 'numeric' | 'password' | 'search' | 'otp';

/** A number that starts with `+` and a country code other than 1 (customer PR #635). */
export function isInternationalTel(raw: string): boolean {
  return /^\s*\+\s*[02-9]/.test(raw);
}

/**
 * What the field SHOWS for a stored phone value: the national format behind the field's own
 * fixed "+1" prefix. Reuses the legacy `formatTel` and drops its "+1 " (on main that gives
 * "(416) 555-0123"; after customer PR #635 it gives "416 555 0123"); an international number
 * stays as typed so the screen can say it is not supported instead of mangling it.
 */
export function telDisplay(value: string): string {
  if (isInternationalTel(value)) return value;
  return formatTel(value).replace(/^\+1\s*/, '');
}

/**
 * The cleaned value an `Input` hands to `onValueChange` (and `onChange`) for raw text:
 * digits only for `numeric` and `otp` (`otp` cut to its cell count), national digits for `tel`
 * (a pasted "+1 (416) 555-9999" becomes "4165559999"; an international number is kept as
 * typed), the text untouched otherwise.
 */
export function cleanInputValue(variant: InputVariant, raw: string, cells = 6): string {
  switch (variant) {
    case 'numeric':
      return raw.replace(/\D/g, '');
    case 'otp':
      return raw.replace(/\D/g, '').slice(0, cells);
    case 'tel':
      if (isInternationalTel(raw)) return raw.trim();
      return raw.replace(/\D/g, '').replace(/^1/, '').slice(0, 10);
    default:
      return raw;
  }
}

/** True for integer cents (the only money a component may render). */
export function isIntegerCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * An option's accessible name with its price folded in, so the price is not a separate stop:
 * "Large, plus 2 dollars and 50 cents" for a delta, "For two, 45 dollars and 99 cents" for an
 * absolute price. A non-integer amount adds nothing here (Price itself refuses and reports it).
 */
export function nameWithPrice(label: string, priceDeltaCents?: number, priceCents?: number): string {
  if (priceDeltaCents !== undefined && isIntegerCents(priceDeltaCents) && priceDeltaCents !== 0) {
    const spoken = spokenPrice(priceDeltaCents);
    return `${label}, ${priceDeltaCents > 0 ? `plus ${spoken}` : spoken}`;
  }
  if (priceCents !== undefined && isIntegerCents(priceCents)) return `${label}, ${spokenPrice(priceCents)}`;
  return label;
}

/** The three typed parts of a `DateInput`. */
export interface DateParts {
  day: string;
  month: string;
  year: string;
}

/** ISO `YYYY-MM-DD` -> its parts; anything else -> empty parts. */
export function partsOfIso(iso: string | null | undefined): DateParts {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? { year: m[1]!, month: String(Number(m[2])), day: String(Number(m[3])) } : { day: '', month: '', year: '' };
}

/** Which part is wrong, and why, for a typed date; `null` when the parts are a real date. */
export type DateProblem = { part: keyof DateParts | 'all'; message: string } | null;

/**
 * Validates typed parts as a real calendar date (31 April and 29 February 2026 are not), within
 * `min` and `max` (ISO, inclusive). Returns the ISO date, or the problem. Empty parts are
 * "incomplete", which the caller shows only after the person has left the field.
 */
export function isoOfParts(
  parts: DateParts,
  bounds: { min?: string; max?: string } = {},
): { iso: string | null; problem: DateProblem } {
  const { day, month, year } = parts;
  if (!day && !month && !year) return { iso: null, problem: null };
  if (!/^\d{1,2}$/.test(day)) return { iso: null, problem: { part: 'day', message: 'Enter the day as a number' } };
  if (!/^\d{1,2}$/.test(month)) return { iso: null, problem: { part: 'month', message: 'Enter the month as a number' } };
  if (!/^\d{4}$/.test(year)) return { iso: null, problem: { part: 'year', message: 'Enter the year as 4 digits' } };
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12) return { iso: null, problem: { part: 'month', message: 'The month must be between 1 and 12' } };
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) {
    return { iso: null, problem: { part: 'day', message: `The day must be between 1 and ${daysInMonth}` } };
  }
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (bounds.min && iso < bounds.min) return { iso: null, problem: { part: 'all', message: `The date must be on or after ${bounds.min}` } };
  if (bounds.max && iso > bounds.max) return { iso: null, problem: { part: 'all', message: `The date must be on or before ${bounds.max}` } };
  return { iso, problem: null };
}
