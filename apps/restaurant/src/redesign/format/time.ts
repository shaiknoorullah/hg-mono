/**
 * The one 12-hour formatter (manifest rule 4, constitution gate 10): "7:42 pm", "11:00 pm",
 * "12:05 am". Times show in the restaurant's own timezone, not the device's.
 */
export const DEFAULT_TIMEZONE = 'America/Toronto';

function parts(at: Date | number | string, timeZone: string) {
  const date = at instanceof Date ? at : new Date(at);
  const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
  const p = fmt.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '';
  return { hour: get('hour'), minute: get('minute'), period: get('dayPeriod').toLowerCase() };
}

/** "7:42 pm" */
export function formatTime(at: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
  const { hour, minute, period } = parts(at, timeZone);
  return `${hour}:${minute} ${period}`;
}

/** "14 October 2026" (absolute dates on halal and document copy). */
export function formatLongDate(at: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(date);
}

/** "14 Oct" (short absolute date, e.g. "Halal certified · expires 14 Oct"). */
export function formatShortDate(at: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(date);
}

/**
 * A plain date from the API (`YYYY-MM-DD`, no time) formatted without a timezone shift:
 * "2026-10-14" is 14 October everywhere.
 */
export function formatCalendarDate(isoDate: string, style: 'long' | 'short' = 'long'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
  return style === 'long' ? formatLongDate(date, 'UTC') : formatShortDate(date, 'UTC');
}

/** "2 minutes 12 seconds" for accessible names; never spoken per second. */
export function spokenDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const mins = m ? `${m} minute${m === 1 ? '' : 's'}` : '';
  const secs = s || !m ? `${s} second${s === 1 ? '' : 's'}` : '';
  return [mins, secs].filter(Boolean).join(' ');
}
