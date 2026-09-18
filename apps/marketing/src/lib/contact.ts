/**
 * Validation for the one field the waitlist asks for.
 *
 * Deliberately permissive. The purpose is to catch a typo before it costs us a
 * signup, not to prove the number is reachable — only sending to it proves
 * that, and we send once, at launch. Every rejection message names the fix.
 */

export type ContactKind = 'tel' | 'email';

export type ContactCheck = { ok: true; normalised: string } | { ok: false; message: string };

/** North American numbers: ten digits, or eleven beginning with the country code. */
export function checkPhone(raw: string): ContactCheck {
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (national.length === 0) return { ok: false, message: 'Enter your mobile number.' };
  if (national.length !== 10) {
    return { ok: false, message: 'That doesn’t look like a Canadian mobile number — ten digits, e.g. 416 555 0134.' };
  }
  // Area codes and exchange codes never start with 0 or 1.
  if (/^[01]/.test(national) || /^[01]/.test(national.slice(3))) {
    return { ok: false, message: 'That doesn’t look like a Canadian mobile number. Check the area code.' };
  }
  return { ok: true, normalised: `+1${national}` };
}

export function checkEmail(raw: string): ContactCheck {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, message: 'Enter your email address.' };
  // One @, something either side, a dot in the domain. Anything stricter starts
  // rejecting addresses that work.
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value)) {
    return { ok: false, message: 'That doesn’t look like an email address.' };
  }
  return { ok: true, normalised: value.toLowerCase() };
}

export function checkContact(kind: ContactKind, raw: string): ContactCheck {
  return kind === 'tel' ? checkPhone(raw) : checkEmail(raw);
}
