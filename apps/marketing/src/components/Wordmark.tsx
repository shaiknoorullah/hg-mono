/**
 * The Halalgoes wordmark.
 *
 * Traced from the supplied artwork rather than shipped as a raster: the source
 * is 556x186, which is under 2x the size the footer renders it at, so a PNG
 * would be visibly soft on any phone. The geometry is in `lib/wordmark-art.ts`
 * and is generated; `brand/README.md` has the provenance and how to redo it.
 *
 * ONE MARK, BOTH THEMES, NO SECOND FILE.
 *
 * The artwork arrived as a reversed lockup: #D0D0D1 letterforms, drawn for a
 * dark background. On our cream that measures 1.48:1 — not low contrast,
 * invisible. The light version is normally where somebody opens the PNG and
 * repaints it, and then there are two binaries to keep in step.
 *
 * There are none here, because the mark is geometry: the letterforms take
 * `--hg-mk-wordmark`, which is #232323 on cream and the supplied #D0D0D1 on
 * #171717. Switching theme repaints the same paths. `currentColor` is the
 * fallback for a surface outside the token scope, so the mark still cannot come
 * out invisible.
 *
 * The swash is `--hg-mk-accent`, not the #F05023 it arrives as. Those two
 * oranges differ by under 2 units per channel — indistinguishable, and that is
 * the point: carrying the sampled hex would put a second near-identical orange
 * in the palette, and the next person to change the brand orange would move one
 * of them. It is the same orange in both themes; it passes on each.
 *
 * The gradient is NOT a stylisation. The supplied artwork ramps the swash from
 * the letterform colour to the orange, linearly in y, between y=119.5 and
 * y=154.9 — measured off the 572 interior blend pixels, and reproduced here to
 * the same numbers. Without it the g descender gets a hard horizontal cut.
 */

import { WORDMARK } from '@/lib/wordmark-art';

const { viewBox, ramp } = WORDMARK;

export function Wordmark({
  height = 32,
  id,
  className,
  title = 'Halal Goes',
}: {
  /** Height in px. Width follows the 556:186 artwork; nothing here is cropped. */
  height?: number;
  /**
   * Document-unique. The gradient is a paint server: two wordmarks sharing an
   * id both resolve to whichever rendered first, so the second would inherit
   * the first one's stops rather than its own. Harmless while every instance is
   * painted the same, a silent bug the day one is not.
   */
  id: string;
  className?: string;
  /** Empty string renders it decorative, for when adjacent text already names us. */
  title?: string;
}) {
  const gradient = `${id}-swash`;

  return (
    <svg
      width={Math.round((height * viewBox.width) / viewBox.height)}
      height={height}
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      // `block` in the class list rather than a style attribute: an inline style
      // outranks every utility, which is how the Seal's size pair broke once.
      className={`block ${className ?? ''}`}
    >
      <defs>
        <linearGradient
          id={gradient}
          x1="0"
          y1={ramp.top}
          x2="0"
          y2={ramp.bottom}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--hg-mk-wordmark, currentColor)" />
          <stop offset="1" stopColor="var(--hg-mk-accent)" />
        </linearGradient>
      </defs>

      {/* evenodd, so the counters (the bowls of a, o, e and the eye of g) drop
          out without the tracer having to get winding direction right. */}
      <path fill="var(--hg-mk-wordmark, currentColor)" fillRule="evenodd" d={WORDMARK.silhouette} />
      <path fill={`url(#${gradient})`} fillRule="evenodd" d={WORDMARK.swash} />
    </svg>
  );
}
