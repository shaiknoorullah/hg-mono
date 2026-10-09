/**
 * `Price` — the ONLY component permitted to render money (live `index.d.ts`, `Price/README.md`,
 * 02-components.md §20, invariant 3).
 *
 * - `cents` is int64 minor units from the server. A missing or non-integer value renders
 *   NOTHING and reports `MONEY_NOT_INTEGER_CENTS`: never `$0.00`, never a guess.
 * - There is no `value`, `formatted` or float prop, so a caller cannot invent a price.
 * - `cents === 0` renders `free` when given, else `$0.00`; never blank.
 * - A negative amount uses a true minus (U+2212). No rounding happens here: the amount is split
 *   into whole dollars and cents with integer arithmetic only.
 * - The accessible name is spoken money ("12 dollars and 34 cents"); strikethrough says "was",
 *   `announceAs="now"` marks the current price beside it.
 * - `loading` is a skeleton at the glyph width, so totals do not jump. Numerals are tabular.
 */

import type { CSSProperties } from 'react';

import { SkeletonBlock } from '../lib/ui/skeleton.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from './client-error.js';

/** Price sizes: the live four plus `display-lg` (36px) for earnings and payout totals (#195). */
export type PriceSize = 'sm' | 'md' | 'lg' | 'xl' | 'display-lg';

/** Props of the live `Price` (index.d.ts), plus the planned `display-lg` size. */
export interface PriceProps {
  /** int64 minor units from the server. A missing or non-integer value renders nothing. */
  cents: number;
  /** Default and only value at V1. */
  currency?: 'CAD';
  size?: PriceSize;
  /** A previous price; announced "was …". */
  strikethrough?: boolean;
  /** 'always' for ledger and earnings deltas (+$18.50, −$3.00). */
  sign?: 'auto' | 'always' | 'never';
  /** Appends "CAD" — required on receipts and refund records. */
  showCode?: boolean;
  /** Label shown when cents === 0, e.g. "Free delivery". Without it, $0.00. */
  free?: string;
  /** Prefix for the spoken name; strikethrough implies "was". */
  announceAs?: 'was' | 'now';
  /** Skeleton at the glyph width. */
  loading?: boolean;
  /** On an inverse or chrome surface. */
  onDark?: boolean;
  /** Number grouping locale. */
  locale?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** U+2212 MINUS SIGN. A hyphen is not a minus. */
const TRUE_MINUS = '−';

const SIZE_CLASS: Readonly<Record<PriceSize, string>> = {
  sm: 'text-body-sm font-semibold',
  md: 'text-body-md font-semibold',
  lg: 'text-heading-sm font-bold',
  xl: 'text-display-md font-bold',
  'display-lg': 'text-display-lg font-bold',
};

function isIntegerCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function split(cents: number): { negative: boolean; dollars: number; rest: number } {
  const abs = Math.abs(cents);
  return { negative: cents < 0, dollars: Math.trunc(abs / 100), rest: abs % 100 };
}

function glyphs(cents: number, sign: PriceProps['sign'], showCode: boolean, locale: string): string {
  const { negative, dollars, rest } = split(cents);
  let whole: string;
  try {
    whole = dollars.toLocaleString(locale);
  } catch {
    whole = String(dollars);
  }
  let out = `$${whole}.${String(rest).padStart(2, '0')}`;
  if (negative && sign !== 'never') out = TRUE_MINUS + out;
  else if (!negative && cents !== 0 && sign === 'always') out = `+${out}`;
  return showCode ? `${out} CAD` : out;
}

function spoken(cents: number, sign: PriceProps['sign'], showCode: boolean): string {
  const { negative, dollars, rest } = split(cents);
  const parts: string[] = [];
  if (dollars > 0 || rest === 0) parts.push(`${dollars} ${dollars === 1 ? 'dollar' : 'dollars'}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'cent' : 'cents'}`);
  let out = parts.join(' and ');
  if (showCode) out += ' Canadian';
  if (negative && sign !== 'never') out = `minus ${out}`;
  else if (!negative && cents !== 0 && sign === 'always') out = `plus ${out}`;
  return out;
}

/** Money from integer cents, with a spoken accessible name. */
export function Price({
  cents,
  currency = 'CAD',
  size = 'md',
  strikethrough = false,
  sign = 'auto',
  showCode = false,
  free,
  announceAs,
  loading = false,
  onDark = false,
  locale = 'en-CA',
  testId = 'Price',
  style,
  className,
}: PriceProps) {
  if (currency !== 'CAD') {
    reportDsClientError('UNKNOWN_ENUM_VALUE', { component: 'Price', field: 'currency', received: currency });
  }
  const valid = isIntegerCents(cents);
  if (!valid && !loading) {
    reportDsClientError('MONEY_NOT_INTEGER_CENTS', { component: 'Price', received: cents });
    return null;
  }

  const isFree = valid && cents === 0 && typeof free === 'string' && free.length > 0;
  const shown = valid ? (isFree ? free : glyphs(cents, sign, showCode, locale)) : '$00.00';

  if (loading) {
    return (
      <span
        data-testid={`${testId}-loading`}
        aria-busy="true"
        aria-label="Loading price"
        className={cn('inline-flex align-middle', SIZE_CLASS[size], className)}
        style={style}
      >
        <SkeletonBlock className="h-[1em]" style={{ inlineSize: `${Math.max(shown.length, 4)}ch` }} />
      </span>
    );
  }

  const said = isFree ? free : spoken(cents, sign, showCode);
  const prefix = announceAs ?? (strikethrough ? 'was' : undefined);

  return (
    <span
      data-testid={testId}
      data-size={size}
      className={cn(
        'inline-flex items-baseline font-ui tabular-nums',
        SIZE_CLASS[size],
        onDark ? 'text-fg-on-inverse' : 'text-fg-primary',
        strikethrough && 'font-normal line-through',
        strikethrough && (onDark ? 'text-fg-on-inverse/75' : 'text-fg-secondary'),
        className,
      )}
      style={style}
    >
      {/* Screen readers read "$12.34" inconsistently: the glyphs are hidden and the spoken
          form is authoritative. */}
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{prefix ? `${prefix} ${said}` : said}</span>
    </span>
  );
}
