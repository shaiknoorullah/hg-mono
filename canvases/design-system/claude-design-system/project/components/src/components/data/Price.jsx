import React from 'react';
import { formatCents, spokenCents, isIntegerCents } from '../internal/format.js';
import { reportClientError } from '../internal/report.js';
import '../internal/css.js';

/* Price — 02-components.md §20. The ONLY component permitted to render money.
   - `cents` is REQUIRED and must be an integer (int64 minor units from the server). A missing
     or non-integer value renders NOTHING and reports MONEY_NOT_INTEGER_CENTS — never "$0.00".
   - No `value`, no `formatted`, no float: a caller can never invent a price.
   - cents === 0 renders `free` when given ("Free delivery"), else "$0.00" — never blank.
   - Negative uses a true minus (U+2212). No rounding happens here.
   - Accessible name is spoken money ("12 dollars and 34 cents"); strikethrough is prefixed
     "was", and `announceAs="now"` prefixes the current price beside it.
   - loading renders a skeleton at the glyph width so totals do not jump. */

const SIZES = { sm: 'var(--type-body-sm-size)', md: 'var(--type-body-md-size)', lg: 'var(--type-heading-sm-size)', xl: 'var(--type-display-md-size)' };

export function Price({
  cents, currency = 'CAD', size = 'md', strikethrough = false, sign = 'auto', showCode = false,
  free, announceAs, loading = false, onDark = false, testId, style, ...rest
}) {
  if (currency !== 'CAD') reportClientError('UNKNOWN_ENUM_VALUE', { component: 'Price', field: 'currency', received: currency });
  const valid = isIntegerCents(cents);
  if (!valid && !loading) {
    reportClientError('MONEY_NOT_INTEGER_CENTS', { component: 'Price', received: cents });
    return null;
  }
  const isFree = valid && cents === 0 && typeof free === 'string' && free.length > 0;
  const glyphs = valid ? (isFree ? free : formatCents(cents, { sign, showCode })) : '$00.00';
  const fontSize = SIZES[size] || SIZES.md;
  if (loading) {
    return (
      <span data-testid={(testId || 'Price') + '-loading'} aria-busy="true" aria-label="Loading price" className="hg-skel"
        style={{ display: 'inline-block', verticalAlign: 'middle', inlineSize: Math.max(glyphs.length, 4) + 'ch', blockSize: '1em', fontSize, ...style }} {...rest} />
    );
  }
  const said = isFree ? free : spokenCents(cents, { sign, showCode });
  const prefix = announceAs || (strikethrough ? 'was' : null);
  return (
    <span data-testid={testId || 'Price'} style={{
      display: 'inline-flex', alignItems: 'baseline', fontFamily: 'var(--font-ui)', fontSize,
      fontWeight: strikethrough ? 'var(--font-weight-regular)' : size === 'xl' || size === 'lg' ? 'var(--font-weight-bold)' : 'var(--font-weight-semibold)',
      fontVariantNumeric: 'var(--numeric-tabular)',
      color: strikethrough ? (onDark ? 'var(--color-neutral-300)' : 'var(--text-tertiary)') : (onDark ? 'var(--color-neutral-0)' : 'var(--text-primary)'),
      textDecoration: strikethrough ? 'line-through' : 'none', ...style,
    }} {...rest}>
      <span aria-hidden="true">{glyphs}</span>
      <span className="hg-sr">{prefix ? prefix + ' ' + said : said}</span>
    </span>
  );
}
