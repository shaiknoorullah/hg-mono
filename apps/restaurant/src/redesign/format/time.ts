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

// ── Wall-clock times and calendar dates (Hours, WP9) ─────────────────────────────────────
// The API keeps opening hours as 24-hour "HH:MM" strings and special dates as "YYYY-MM-DD";
// people only ever see 12-hour times and absolute dates.

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a valid "HH:MM" (the contract's pattern). */
export function isClock(value: string): boolean {
  return HHMM.test(value);
}

/** "HH:MM" → minutes after midnight (NaN when not a valid time). */
export function clockMinutes(value: string): number {
  const m = HHMM.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
}

/** "17:30" → "5:30 pm"; "00:00" → "12:00 am"; "12:00" → "12:00 pm". */
export function formatClock(value: string): string {
  const mins = clockMinutes(value);
  if (Number.isNaN(mins)) return value;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/** "11:00 am – 3:00 pm" (en dash with spaces). */
export function formatClockRange(opens: string, closes: string): string {
  return `${formatClock(opens)} – ${formatClock(closes)}`;
}

/**
 * What a person typed → "HH:MM", or null when it is not a time. Accepts "5:30 pm", "5pm",
 * "5:30pm", "12 am", "17:30", "0930" and "9" (a bare hour without am/pm is 24-hour).
 */
export function parseClock(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const period = m[3]?.[0];
  if (min > 59) return null;
  if (period) {
    if (h < 1 || h > 12) return null;
    if (period === 'a') h = h === 12 ? 0 : h;
    else h = h === 12 ? 12 : h + 12;
  } else if (h > 23) {
    return null;
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** The calendar date ("YYYY-MM-DD") of an instant in a timezone. */
export function isoDateIn(at: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): string {
  const date = at instanceof Date ? at : new Date(at);
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes after midnight of an instant on the wall clock of a timezone. */
export function minutesIn(at: Date | number | string, timeZone: string = DEFAULT_TIMEZONE): number {
  const date = at instanceof Date ? at : new Date(at);
  const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

/** "2026-10-12" + n days (calendar arithmetic, no timezone). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days, 12));
  return date.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12)).getUTCDay();
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** "Monday 12 October 2026" (weekday day month year, no commas) for a calendar date. */
export function formatDayDate(isoDate: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(isoDate)]} ${formatCalendarDate(isoDate, 'long')}`;
}

/** "Eastern time" for America/Toronto: the zone's generic name, as the Hours caption says it. */
export function timezoneName(timeZone: string = DEFAULT_TIMEZONE): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date());
    const name = p.find((x) => x.type === 'timeZoneName')?.value;
    if (name) return name.replace(/ Time$/, ' time');
  } catch {
    /* an unknown zone falls through to its id */
  }
  return timeZone;
}
