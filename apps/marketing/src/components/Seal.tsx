/**
 * The verified-halal seal.
 *
 * This is the product's own instrument, not a marketing illustration — the same
 * green, the same gold ring, the same shield the apps show on a certified
 * restaurant. It is drawn rather than imported as an asset so it stays on the
 * tokens: change `color.halal.certified.*` and the seal follows.
 *
 * It renders ONLY where the page is talking about a restaurant we have actually
 * verified, or about the act of verifying. It is never decoration on a page
 * region that makes no halal claim (invariant 8: a missing halal field renders
 * no badge, never an optimistic one).
 */

/** Rendered at 240px in the desktop hero and 120px on phones. */
export function Seal({ size = 240, className }: { size?: number; className?: string }) {
  // The two textPath arcs need document-unique ids; the seal appears twice in the
  // DOM (phone + desktop lockups) and duplicate ids would make both arcs resolve
  // to whichever came first.
  const uid = `seal-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      role="img"
      aria-label="Halal Goes verified seal"
      // `block` belongs in the class list, not in a style attribute: an inline
      // style outranks every utility, which silently defeated the md:hidden /
      // hidden md:block pair that picks the phone or desktop size.
      className={`block ${className ?? ''}`}
    >
      <circle cx="120" cy="120" r="117" fill="none" stroke="var(--hg-color-halal-certified-ring)" strokeWidth="3" />
      <circle cx="120" cy="120" r="106" fill="none" stroke="var(--hg-color-halal-certified-ring)" strokeWidth="1" />
      <circle cx="120" cy="120" r="92" fill="var(--hg-color-halal-certified-seal)" />

      <defs>
        <path id={`${uid}-top`} d="M44,120 a76,76 0 0,1 152,0" />
        <path id={`${uid}-bot`} d="M36,120 a84,84 0 0,0 168,0" />
      </defs>

      {/* aria-hidden: the words are already in the svg's aria-label, and a
          textPath read letter-by-letter is worse than silence. */}
      <g aria-hidden="true" fill="var(--hg-color-halal-certified-on-seal)">
        <text
          fontFamily="var(--font-display)"
          fontSize="12"
          fontWeight="700"
          letterSpacing="2.6"
          textAnchor="middle"
        >
          <textPath href={`#${uid}-top`} startOffset="50%">
            HALAL GOES
          </textPath>
        </text>
        <text
          fontFamily="var(--font-display)"
          fontSize="12"
          fontWeight="700"
          letterSpacing="2.6"
          textAnchor="middle"
        >
          <textPath href={`#${uid}-bot`} startOffset="50%">
            VERIFIED HALAL
          </textPath>
        </text>
        <circle cx="40" cy="120" r="2.4" />
        <circle cx="200" cy="120" r="2.4" />
      </g>

      {/* The shield glyph stays hand-drawn rather than coming from the Icon
          primitive — docs/design/01-foundations.md §11 keeps the halal
          instrument off the Solar icon set on purpose. */}
      <g aria-hidden="true" transform="translate(78 78) scale(3.5)">
        <path
          d="M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z"
          fill="var(--hg-color-halal-certified-on-seal)"
          stroke="var(--hg-color-halal-certified-on-seal)"
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
        <path
          d="M8.4 12.1l2.5 2.5 4.7-4.9"
          fill="none"
          stroke="var(--hg-color-halal-certified-seal)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
