/**
 * The sign-in screens' small pure helpers: the Canadian phone rule, how a number and a clock time
 * read on screen. No React, no network, so they are trivially testable.
 */
import { isInternationalTel } from '@hg/ui-native';

export type PhoneCheck =
  | { ok: true; e164: string }
  | { ok: false; reason: 'incomplete' | 'unsupported' };

/**
 * The value the `tel` Input hands back is national digits (`4165550134`), or an international
 * number kept as pasted (`+44 7700 900123`). HalalGoes takes Canadian mobiles (+1) only.
 */
export function checkPhone(value: string): PhoneCheck {
  if (isInternationalTel(value)) return { ok: false, reason: 'unsupported' };
  const digits = value.replace(/\D/g, '');
  // NANP: ten digits, and neither the area code nor the exchange starts with 0 or 1.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return { ok: false, reason: 'incomplete' };
  return { ok: true, e164: `+1${digits}` };
}

/** `+14165550134` → `+1 416 555 0134`; anything else is shown as stored. */
export function displayPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/**
 * A wall-clock time the way the canvases write it: `6:48 pm`. Waits are shown as a static time,
 * never a ticking count (the design system's Countdown numeral fails 4.5:1 — Sign-in canvas,
 * "DS issues" note 5).
 */
export function clockTime(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The moment a wait ends, rounded up to the next whole minute so the shown time is never early. */
export function waitUntil(from: number, seconds: number): number {
  const end = from + seconds * 1000;
  return Math.ceil(end / 60000) * 60000;
}
