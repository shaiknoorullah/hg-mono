/**
 * The sign-in screens' pure helpers (ported from #635 `signin/phone.ts`): the Canadian phone rule,
 * how a number reads on screen, and when a server wait ends. No React, no network.
 *
 * Clock times are formatted by `lib/time.ts` (the only formatter); this file only does arithmetic.
 */

export type PhoneCheck = { ok: true; e164: string } | { ok: false; reason: 'incomplete' | 'unsupported' };

/**
 * The DS `tel` Input hands back national digits (`4165550134`); a number pasted or autofilled with
 * another country code arrives as more digits (`+44 7700 900123` → `447700900123`), or with its
 * `+` when the field passes it through. HalalGoes takes Canadian mobiles (+1) only.
 */
export function checkPhone(value: string): PhoneCheck {
  const trimmed = value.trim();
  if (trimmed.startsWith('+') && !/^\+1(\D|$)/.test(trimmed)) return { ok: false, reason: 'unsupported' };
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length > 10) return { ok: false, reason: 'unsupported' };
  // Ten digits with a real area code (not starting 0 or 1). The exchange is the server's call: the
  // local fixed-code test numbers (+1 555 010 01NN) have an exchange a strict NANP rule refuses.
  if (!/^[2-9]\d{9}$/.test(digits)) return { ok: false, reason: 'incomplete' };
  return { ok: true, e164: `+1${digits}` };
}

/** The national digits of a `+1…` number, to fill the field again ("Start again" keeps the number). */
export function nationalDigits(e164: string): string {
  return /^\+1\d{10}$/.test(e164) ? e164.slice(2) : e164;
}

/** `+14165550134` → `+1 416 555 0134`; anything else is shown as stored. */
export function displayPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+1 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/**
 * The moment a server wait ends: `from` (the server's `Date` when it sent one, else when the
 * response arrived) plus `seconds`, rounded up to the next whole minute so the time shown is never
 * early. A static time, never a ticking count (Sign-in canvas, DS issue 5).
 */
export function waitUntil(from: number, seconds: number): number {
  const end = from + Math.max(0, seconds) * 1000;
  return Math.ceil(end / 60000) * 60000;
}
