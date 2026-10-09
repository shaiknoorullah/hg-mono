/**
 * The one 12-hour time formatter for the web design system (constitution gate item 10: times
 * are 12-hour everywhere). Every component and screen that shows a clock time calls this, so the
 * format cannot drift between surfaces.
 *
 * Output: "9:14 am", "12:05 pm", or with seconds "9:14:05 am". Lower-case am/pm without dots,
 * as the approved canvases write it. Times are shown in the restaurant's zone
 * (America/Toronto at launch, Ontario) unless a zone is passed.
 */

/** Options for `formatTime12h`. */
export interface FormatTime12hOptions {
  /** IANA zone; defaults to America/Toronto (launch province: Ontario). */
  timeZone?: string;
  /** Include seconds ("9:14:05 am"), for "checked at" lines. */
  seconds?: boolean;
}

/** The zone every launch surface shows times in. */
export const DEFAULT_TIME_ZONE = 'America/Toronto';

/**
 * A wire timestamp (ISO 8601), epoch milliseconds or a Date → "9:14 am". Returns null for an
 * unparseable value, so a caller renders nothing rather than "Invalid Date".
 */
export function formatTime12h(value: string | number | Date, options: FormatTime12hOptions = {}): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: options.seconds ? '2-digit' : undefined,
      hour12: true,
      timeZone: options.timeZone ?? DEFAULT_TIME_ZONE,
    }).formatToParts(date);
  } catch {
    return null;
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const hour = get('hour');
  const minute = get('minute');
  const period = get('dayPeriod')?.toLowerCase().replace(/\./g, '');
  if (!hour || !minute || !period) return null;
  const second = options.seconds ? `:${get('second') ?? '00'}` : '';
  return `${hour}:${minute}${second} ${period}`;
}
