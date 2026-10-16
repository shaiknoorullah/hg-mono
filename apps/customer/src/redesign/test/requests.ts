/**
 * Helpers for tests that read the requests a screen sent: every key of a body, and the pattern that
 * names a money field. A screen's request must never contain one (the server prices every order).
 */

/** Every key at every depth of a request body. */
export function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** The names of money fields on the wire. */
export const MONEY_KEY = /price|subtotal|total|amount|fee|discount|tax/i;
