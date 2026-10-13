/**
 * The redesign's one place for dates, times and money on screen.
 *
 * Rules from the canvases: 12-hour times ("2:48 pm"); short dates in grid cells
 * ("26 Sep, 5:55 pm", the year only when it is not this year); the full date, with weekday
 * and zone, in a tooltip and in detail views. Everything renders in Toronto time, the zone
 * the platform runs in, whatever the browser's own zone.
 */
import { cents, formatCents } from '@hg/api-client';

export const ZONE = 'America/Toronto';

function parse(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, ...options }).formatToParts(d)) {
    out[p.type] = p.value;
  }
  return out;
}

/** "2:48 pm". */
export function formatTime(value: string | Date | null | undefined): string {
  const d = parse(value);
  if (!d) return '';
  const p = parts(d, { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p['hour']}:${p['minute']} ${(p['dayPeriod'] ?? '').toLowerCase().replace(/\./g, '')}`;
}

/** "9:14:05 am", for announcements that need the second ("API not ready, 9:14:05 am"). */
export function formatTimeWithSeconds(value: string | Date | null | undefined): string {
  const d = parse(value);
  if (!d) return '';
  const p = parts(d, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  return `${p['hour']}:${p['minute']}:${p['second']} ${(p['dayPeriod'] ?? '').toLowerCase().replace(/\./g, '')}`;
}

/** "26 Sep" (or "26 Sep 2025" when not this year). */
export function formatShortDate(value: string | Date | null | undefined, now: Date = new Date()): string {
  const d = parse(value);
  if (!d) return '';
  const p = parts(d, { day: 'numeric', month: 'short', year: 'numeric' });
  const thisYear = parts(now, { year: 'numeric' })['year'];
  const month = (p['month'] ?? '').replace('.', '');
  return p['year'] === thisYear ? `${p['day']} ${month}` : `${p['day']} ${month} ${p['year']}`;
}

/** "26 Sep, 5:55 pm": the grid-cell form. */
export function formatShortDateTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  const d = parse(value);
  if (!d) return '';
  return `${formatShortDate(d, now)}, ${formatTime(d)}`;
}

/** "14 October 2026". */
export function formatLongDate(value: string | Date | null | undefined): string {
  const d = parse(value);
  if (!d) return '';
  const p = parts(d, { day: 'numeric', month: 'long', year: 'numeric' });
  return `${p['day']} ${p['month']} ${p['year']}`;
}

/** "Saturday 26 September 2026, 5:55 pm EDT": tooltips and detail views. */
export function formatFullDateTime(value: string | Date | null | undefined): string {
  const d = parse(value);
  if (!d) return '';
  const p = parts(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZoneName: 'short' });
  return `${p['weekday']} ${p['day']} ${p['month']} ${p['year']}, ${formatTime(d)} ${p['timeZoneName'] ?? ''}`.trim();
}

/** Whole days from `now` to `value`, rounded down; negative when `value` is past. */
export function daysUntil(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  const d = parse(value);
  if (!d) return null;
  return Math.floor((d.getTime() - now.getTime()) / 86_400_000);
}

/** Integer cents straight off the wire as "$12.40". Never a float. */
export function formatMoney(value: number | null | undefined): string {
  if (value == null) return '';
  return formatCents(cents(value));
}
