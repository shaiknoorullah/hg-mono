/**
 * Date formatting for the DataTable cells (DateCell, TimeCell, EventLog). Times go through the
 * one 12-hour formatter (`formatTime12h`, gate item 10); this file only adds the calendar part.
 *
 * - Short date in a cell: "26 Sep", with the year only when it is not the current year
 *   ("26 Sep 2025").
 * - Full date for the tooltip and for screen readers: "Saturday 26 September 2026".
 * - A date-only wire value ("2026-10-20", a certificate's `expires_on`) is a calendar date, so it
 *   is read in UTC and never shifted by the viewer's zone.
 */

import { DEFAULT_TIME_ZONE, formatTime12h } from './time.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Options shared by the date formatters. */
export interface DataDateOptions {
  /** IANA zone for date-times; defaults to America/Toronto. Date-only values always use UTC. */
  timeZone?: string;
  /** Clock for the "this year" rule (tests and previews). */
  now?: Date;
}

/** Parses a wire value; null when missing or unparseable (render nothing invented). */
export function parseWireDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function zoneFor(value: unknown, timeZone?: string): string {
  return typeof value === 'string' && DATE_ONLY.test(value) ? 'UTC' : (timeZone ?? DEFAULT_TIME_ZONE);
}

function part(date: Date, zone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-CA', {
    ...options,
    timeZone: zone,
  }).formatToParts(date);
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** "26 Sep" (this year) or "26 Sep 2025"; null for a missing or bad value. */
export function formatShortDate(
  value: string | number | Date | null | undefined,
  options: DataDateOptions = {},
): string | null {
  const date = parseWireDate(value);
  if (!date) return null;
  const zone = zoneFor(value, options.timeZone);
  const parts = part(date, zone, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const year = pick(parts, 'year');
  const nowYear = pick(part(options.now ?? new Date(), zone, { year: 'numeric' }), 'year');
  const month = pick(parts, 'month').replace(/\.$/, '');
  return `${pick(parts, 'day')} ${month}${year === nowYear ? '' : ` ${year}`}`;
}

/** "Saturday 26 September 2026"; null for a missing or bad value. */
export function formatFullDate(
  value: string | number | Date | null | undefined,
  options: DataDateOptions = {},
): string | null {
  const date = parseWireDate(value);
  if (!date) return null;
  const parts = part(date, zoneFor(value, options.timeZone), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return `${pick(parts, 'weekday')} ${pick(parts, 'day')} ${pick(parts, 'month')} ${pick(parts, 'year')}`;
}

/** "Saturday 26 September 2026, 5:55 pm"; null for a missing or bad value. */
export function formatFullDateTime(
  value: string | number | Date | null | undefined,
  options: DataDateOptions = {},
): string | null {
  const date = parseWireDate(value);
  if (!date) return null;
  const day = formatFullDate(date, options);
  const time = formatTime12h(date, { timeZone: options.timeZone });
  return day && time ? `${day}, ${time}` : null;
}

/** "12 min ago", "3 h ago", "2 days ago" (or "in 5 min"): a secondary line only, never the value. */
export function formatRelative(
  value: string | number | Date | null | undefined,
  now: string | number | Date,
): string | null {
  const date = parseWireDate(value);
  const reference = parseWireDate(now);
  if (!date || !reference) return null;
  const diffMin = Math.round((reference.getTime() - date.getTime()) / 60000);
  const abs = Math.abs(diffMin);
  let text: string;
  if (abs < 1) return 'just now';
  if (abs < 60) text = `${abs} min`;
  else if (abs < 60 * 24) text = `${Math.round(abs / 60)} h`;
  else {
    const days = Math.round(abs / (60 * 24));
    text = `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return diffMin >= 0 ? `${text} ago` : `in ${text}`;
}
