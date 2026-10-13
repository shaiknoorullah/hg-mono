// Local checks that keep a journey off real phones and off production.
// These functions do not call the network.

const FICTIONAL_PHONE = /^\+1[2-9]\d{2}55501\d{2}$/;

/** True for +1 NPA 555 0100 through 0199. Any other number is refused. */
export function assertFictionalPhone(phone) {
  if (!FICTIONAL_PHONE.test(String(phone))) {
    const err = new Error('refusing a phone number outside the fictional 555-0100 to 555-0199 range');
    err.code = 'PHONE_NOT_FICTIONAL';
    throw err;
  }
}

/**
 * Build one fictional number. `line` is 100 through 199 (0100 through 0199).
 * `npa` is the three-digit area code.
 */
export function fictionalPhone(npa, line) {
  if (!/^[2-9]\d{2}$/.test(String(npa))) {
    const err = new Error('area code must be three digits');
    err.code = 'PHONE_NOT_FICTIONAL';
    throw err;
  }
  const text = String(line).padStart(4, '0');
  const phone = `+1${npa}555${text}`;
  assertFictionalPhone(phone);
  return phone;
}

/** `count` distinct lines in 0100-0199, starting at `start` (0-99). */
export function fictionalLines(count, start) {
  const origin = Number(start) % 100;
  return Array.from({ length: count }, (_, i) => String(100 + ((origin + i) % 100)).padStart(4, '0'));
}

/**
 * The only values the journey may continue with.
 * Anything else, including a missing value, throws.
 */
export function classifyEnvironment(value) {
  if (value === 'local' || value === 'staging') return value;
  const err = new Error(
    value ? `refusing environment ${value}` : 'the API did not report its environment',
  );
  err.code = value ? 'ENV_REFUSED' : 'ENV_UNKNOWN';
  throw err;
}
