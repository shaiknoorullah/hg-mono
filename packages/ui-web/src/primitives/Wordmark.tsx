import { useId } from 'react';
import { BRAND_NAME, WORDMARK } from '@hg/brand';

/**
 * `Wordmark` — the HalalGoes logo, drawn from `@hg/brand`.
 *
 * The geometry is the traced artwork the marketing site ships (`packages/brand/README.md`
 * has the provenance). It is imported, never copied, so the restaurant and admin apps, the
 * native apps and the marketing site cannot drift apart on a curve.
 *
 * Two colours, both theme roles, so light and dark are the same paths repainted:
 *   - letterforms: `--hg-text-primary`, falling back to `currentColor` outside the token
 *     scope so the mark can never come out invisible;
 *   - swash: `--hg-action-primary-bg`, the brand orange (the same in both schemes).
 * No green anywhere: solid green is reserved to the halal colours.
 *
 * The swash ramps from the letterform colour to the orange between the two measured `y`
 * values in `WORDMARK.ramp` — that is the artwork, not a stylisation; without it the g
 * descender meets the swash at a hard cut.
 *
 * This is the brand mark, not the halal seal: it certifies nothing and must never stand in
 * for `HalalSeal` / `HalalBadge`.
 */
export interface WordmarkProps {
  /** Height in px. Width follows the artwork's 556:186 ratio. Default 32. */
  height?: number;
  /**
   * Accessible name. Default "HalalGoes". Pass `''` when adjacent text already names the
   * business, and the mark is hidden from assistive tech.
   */
  title?: string;
  className?: string;
}

const { viewBox, ramp } = WORDMARK;
const INK = 'var(--hg-text-primary, currentColor)';
const SWASH = 'var(--hg-action-primary-bg, currentColor)';

export function Wordmark({ height = 32, title = BRAND_NAME, className }: WordmarkProps) {
  // The gradient is a paint server with a document-global id: two wordmarks on one page
  // sharing an id would both resolve to whichever rendered first.
  const gradient = `hg-wordmark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      data-hg-wordmark=""
      width={Math.round((height * viewBox.width) / viewBox.height)}
      height={height}
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={['block shrink-0', className].filter(Boolean).join(' ')}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1={ramp.top} x2="0" y2={ramp.bottom} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={INK} />
          <stop offset="1" stopColor={SWASH} />
        </linearGradient>
      </defs>
      {/* evenodd, so the counters drop out without the tracer having to get winding right. */}
      <path fill={INK} fillRule="evenodd" d={WORDMARK.silhouette} />
      <path fill={`url(#${gradient})`} fillRule="evenodd" d={WORDMARK.swash} />
    </svg>
  );
}
