/**
 * `Price` — component 20, `02-components.md` Tier 3. The **only** component permitted to render
 * money.
 *
 * `cents` is the branded `Cents` from `@hg/api-client`, not a `number`. That is the whole point:
 *
 *     <Price cents={1250} />          // type error — a bare number is not money
 *     <Price cents={12.5} />          // type error — and a float is certainly not money
 *     <Price cents={cents(1250)} />   // fine
 *     <Price cents={order.money.total_cents} />   // fine, already branded by the client
 *
 * `cents()` is an assert-and-brand: it throws on a non-integer. So the only two ways to obtain a
 * `Cents` are "it came from the server" and "it passed an integer check", and lint L-5's
 * "documented int64 cents" obligation is discharged by the type rather than by a comment.
 *
 * There is no `value: number` prop and no `formatted: string` prop. A component that accepted a
 * formatted string would let a caller invent a price.
 *
 * Rounding never happens here. All rounding is server-side (`money.Round`, half-down to the
 * cent, ties toward the customer). This component divides by 100 exactly once, at the last step
 * before rendering, inside `formatCents`.
 */
import { type Cents, centsToSpokenString, formatCents } from '@hg/api-client';
import { cx, TABULAR } from '../certification/internal/token-style';

export type PriceSize = 'sm' | 'md' | 'lg' | 'xl';

export interface PriceProps {
  /** int64 minor units. Branded — never a float, never a bare number. */
  cents: Cents;
  /** `CAD` is the default and the only value at V1. */
  currency?: 'CAD';
  size?: PriceSize;
  strikethrough?: boolean;
  /** `always` prefixes positives with `+`, for ledger and earnings deltas. */
  sign?: 'auto' | 'always' | 'never';
  /** Appends `CAD`. Required on receipts and refund records (C-08 §0.1). */
  showCode?: boolean;
  /** Label when `cents === 0`, e.g. `Free delivery`. Never renders blank. */
  free?: string;
  /**
   * Prefixes the accessible name. `strikethrough` implies `was`; pass `now` on the live price
   * beside it so the pair reads as a comparison rather than as two unrelated amounts.
   */
  announceAs?: 'was' | 'now';
  loading?: boolean;
  locale?: string;
  className?: string;
}

const SIZE_CLASS: Readonly<Record<PriceSize, string>> = {
  sm: 'text-body-sm',
  md: 'text-body-md',
  lg: 'text-heading-sm',
  xl: 'text-display-md',
};

/** U+2212 MINUS SIGN. A hyphen is not a minus and reads badly at small sizes. */
const TRUE_MINUS = '−';

export function Price({
  cents,
  size = 'md',
  strikethrough = false,
  sign = 'auto',
  showCode = false,
  free,
  announceAs,
  loading = false,
  locale = 'en-CA',
  className,
}: PriceProps): React.JSX.Element {
  const isFree = cents === 0 && free !== undefined;

  const formatted = isFree
    ? free
    : decorate(
        formatCents(cents, { locale, signed: sign === 'always' }),
        sign,
        showCode,
      );

  const spoken = isFree
    ? free
    : `${centsToSpokenString(cents, locale)}${showCode ? ' Canadian' : ''}`;

  const prefix = announceAs ?? (strikethrough ? 'was' : undefined);
  const accessibleName = prefix ? `${prefix} ${spoken}` : spoken;

  if (loading) {
    // A skeleton at the exact glyph width, so a total does not jump during a quote refresh.
    return (
      <span
        data-testid="Price-loading"
        aria-busy="true"
        aria-label="Loading price"
        className={cx('inline-block rounded-sm bg-skeleton-base align-middle', SIZE_CLASS[size], className)}
        style={{ inlineSize: `${Math.max(formatted.length, 4)}ch`, blockSize: '1em' }}
      />
    );
  }

  return (
    <span
      data-testid="Price"
      className={cx(
        'inline-flex items-baseline',
        SIZE_CLASS[size],
        strikethrough && 'line-through text-fg-tertiary',
        className,
      )}
      style={TABULAR}
    >
      {/* Screen readers read "$12.34" inconsistently, so the glyph string is hidden and the
          spoken form is authoritative (`02-components.md` §20). */}
      <span aria-hidden="true">{formatted}</span>
      <span className="sr-only">{accessibleName}</span>
    </span>
  );
}

function decorate(formatted: string, sign: PriceProps['sign'], showCode: boolean): string {
  let out = formatted;

  if (sign === 'never') {
    out = out.replace(/^[-+−]/, '');
  } else {
    out = out.replace(/^-/, TRUE_MINUS);
  }

  return showCode ? `${out} CAD` : out;
}
