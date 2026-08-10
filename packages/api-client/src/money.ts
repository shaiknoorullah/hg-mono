/**
 * Money. Integer Canadian cents, everywhere, forever.
 *
 * `contracts/README.md` §Money: every monetary field on the wire is an integer count of
 * cents with a `_cents` suffix and `format: int64`. This module is the only place a
 * frontend is allowed to touch money, and it deliberately exposes **no float API**:
 *
 *   - there is no `toDollars(): number`
 *   - there is no `fromDollars(n: number)`
 *   - there is no arithmetic that leaves the integer domain
 *
 * Anything that wants a human-readable amount gets a `string`. Anything that wants to do
 * arithmetic does it in cents. A float never enters the money path, so the classic
 * `0.1 + 0.2` and `Math.round(x * 100)` families of bug cannot occur.
 */

declare const CENTS: unique symbol;

/**
 * A signed count of Canadian cents. Branded so a bare `number` cannot be passed where
 * money is expected: `takesCents(1999)` is a type error, `takesCents(cents(1999))` is not.
 *
 * The brand is erased at runtime — a `Cents` *is* a number, it just cannot be produced by
 * accident.
 */
export type Cents = number & { readonly [CENTS]: 'Cents' };

/** Thrown when a value that must be integer cents is not. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

/**
 * Assert-and-brand. The single entry point into the money domain.
 *
 * Use this on values that did **not** come from the generated client (test data, a config
 * constant, a tip stepper's output). Values that came from the client are already typed.
 */
export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`money must be an integer count of cents, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`money out of safe integer range: ${value}`);
  }
  return value as Cents;
}

/**
 * Parse a user-typed amount ("12.50", "12", "$12.50", "1 234,50") into integer cents
 * **without** going through a float. The string is split on its decimal separator and each
 * half is parsed as an integer, so "0.29" is exactly 29 and never 28.999999999999996.
 *
 * Returns `null` on anything unparseable — callers render a field error, they do not guess.
 */
export function parseAmountToCents(input: string): Cents | null {
  const trimmed = input.trim().replace(/[$\s ]/g, '');
  if (trimmed === '') return null;

  const m = /^(-)?(\d*)(?:[.,](\d{0,2}))?$/.exec(trimmed.replace(/(\d)[ ',](?=\d{3}\b)/g, '$1'));
  if (!m) return null;

  const [, sign, whole = '', frac = ''] = m;
  if (whole === '' && frac === '') return null;

  const wholeCents = (whole === '' ? 0 : Number.parseInt(whole, 10)) * 100;
  const fracCents = frac === '' ? 0 : Number.parseInt(frac.padEnd(2, '0'), 10);
  const total = wholeCents + fracCents;
  if (!Number.isSafeInteger(total)) return null;
  return cents(sign === '-' ? -total : total);
}

/** Addition in the integer domain. */
export function addCents(...values: Cents[]): Cents {
  let sum = 0;
  for (const v of values) sum += v;
  if (!Number.isSafeInteger(sum)) throw new MoneyError('money overflow');
  return sum as Cents;
}

/** Subtraction in the integer domain. */
export function subtractCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

/**
 * Multiply money by a **whole** count (a line quantity, a number of items). There is
 * deliberately no `multiplyByRate` — rates cross the wire as exact decimal strings
 * precisely so that no client multiplies money by a parsed float. The server prices
 * everything; if you find yourself needing a rate here, you are re-implementing pricing.
 */
export function multiplyCents(amount: Cents, quantity: number): Cents {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(`quantity must be a whole number, got ${quantity}`);
  }
  const product = amount * quantity;
  if (!Number.isSafeInteger(product)) throw new MoneyError('money overflow');
  return product as Cents;
}

export function sumCents(values: readonly Cents[]): Cents {
  return addCents(...values);
}

export function negateCents(value: Cents): Cents {
  return cents(-value);
}

export function absCents(value: Cents): Cents {
  return cents(Math.abs(value));
}

export const ZERO_CENTS: Cents = 0 as Cents;

export function isZero(value: Cents): boolean {
  return value === 0;
}

export function compareCents(a: Cents, b: Cents): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface FormatMoneyOptions {
  /** BCP-47 locale. Defaults to `en-CA`. Pass `fr-CA` for Quebec surfaces. */
  locale?: string;
  /** Render `$0.00` as the caller's placeholder (e.g. `'Free'`, `'—'`). */
  zeroAs?: string;
  /** Drop the `.00` on whole-dollar amounts. Off by default; totals should keep it. */
  compactWholeDollars?: boolean;
  /** Prefix positive amounts with `+`. Used for tips and adjustments in ledgers. */
  signed?: boolean;
}

/**
 * Format cents for display. Returns a `string` — never a number — so the formatted value
 * can never be fed back into arithmetic.
 *
 * The division by 100 here is the *only* place cents meet a non-integer, it happens at the
 * very last step before rendering, and its result is immediately consumed by
 * `Intl.NumberFormat`. Amounts up to 2^53 cents format exactly.
 */
export function formatCents(value: Cents, options: FormatMoneyOptions = {}): string {
  const { locale = 'en-CA', zeroAs, compactWholeDollars = false, signed = false } = options;

  if (value === 0 && zeroAs !== undefined) return zeroAs;

  const isWhole = value % 100 === 0;
  const fractionDigits = compactWholeDollars && isWhole ? 0 : 2;

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);

  return signed && value > 0 ? `+${formatted}` : formatted;
}

/**
 * `"12.50"` — a bare decimal string with no currency symbol, for input fields that are
 * being pre-filled from a server amount.
 */
export function centsToDecimalString(value: Cents): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Screen-reader text for an amount: `"12 dollars and 50 cents"`. `formatCents` output reads
 * poorly in VoiceOver/TalkBack because of the narrow currency symbol.
 */
export function centsToSpokenString(value: Cents, locale = 'en-CA'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'name',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

/**
 * Rates (tax, surge, commission) cross the wire as **exact decimal strings** so no client
 * parses one into a float. This renders such a string as a percentage for display only.
 * There is no function that applies a rate to an amount — that is the server's job.
 */
export function formatRateAsPercent(rate: string, locale = 'en-CA'): string {
  const [whole = '0', frac = ''] = rate.replace(/^-/, '').split('.');
  const negative = rate.startsWith('-');
  // shift two places left-to-right without floating point: 0.13 -> 13
  const digits = (whole + frac).replace(/^0+(?=\d)/, '');
  const pointFromRight = frac.length - 2;
  let percent: string;
  if (pointFromRight <= 0) {
    percent = digits + '0'.repeat(-pointFromRight);
  } else {
    const padded = digits.padStart(pointFromRight + 1, '0');
    percent = `${padded.slice(0, -pointFromRight)}.${padded.slice(-pointFromRight)}`.replace(
      /\.?0+$/,
      '',
    );
  }
  return `${negative ? '-' : ''}${percent || '0'}%`;
}

/** Commission and other basis-point fields: 1500 bps -> "15%". */
export function formatBasisPoints(bps: number): string {
  if (!Number.isInteger(bps)) throw new MoneyError(`basis points must be an integer, got ${bps}`);
  const whole = Math.trunc(bps / 100);
  const frac = Math.abs(bps % 100);
  return frac === 0 ? `${whole}%` : `${whole}.${frac.toString().padStart(2, '0')}%`.replace(/0$/, '');
}
