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
      <circle cx="120" cy="120" r="117" fill="none" stroke="var(--hg-mk-seal-ring)" strokeWidth="3" />
      <circle cx="120" cy="120" r="106" fill="none" stroke="var(--hg-mk-seal-ring)" strokeWidth="1" />
      <circle cx="120" cy="120" r="92" fill="var(--hg-mk-seal)" />

      <defs>
        <path id={`${uid}-top`} d="M44,120 a76,76 0 0,1 152,0" />
        <path id={`${uid}-bot`} d="M36,120 a84,84 0 0,0 168,0" />
      </defs>

      {/* aria-hidden: the words are already in the svg's aria-label, and a
          textPath read letter-by-letter is worse than silence. */}
      <g aria-hidden="true" fill="var(--hg-mk-on-seal)">
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
          d={SHIELD_D}
          fill="var(--hg-mk-on-seal)"
          stroke="var(--hg-mk-on-seal)"
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
        <path
          d="M8.4 12.1l2.5 2.5 4.7-4.9"
          fill="none"
          stroke="var(--hg-mk-seal)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/* The shield is the one mark both seals share. Kept as a constant so the brand
   seal and the document stamp below cannot drift apart. */
const SHIELD_D = 'M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z';

/**
 * The stamp on the verification sheet.
 *
 * A different artefact from the brand seal above and deliberately so: this one
 * is a rubber stamp on a form — thinner, green on white rather than white on
 * green, rotated off-axis, and captioned with the count rather than the claim.
 * It reads as something a reviewer applied, which is the point of the section.
 */
export function StampSeal({ size = 168, className }: { size?: number; className?: string }) {
  const uid = `stamp-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      role="img"
      aria-label="Halal Goes verified seal — issued only when all seven checks pass"
      className={`block ${className ?? ''}`}
    >
      <circle cx="120" cy="120" r="116" fill="none" stroke="var(--hg-mk-seal-ring)" strokeWidth="2.5" />
      <circle cx="120" cy="120" r="106" fill="none" stroke="var(--hg-mk-seal)" strokeWidth="3" />
      <defs>
        <path id={`${uid}-top`} d="M34,120 a86,86 0 0,1 172,0" />
        <path id={`${uid}-bot`} d="M26,120 a94,94 0 0,0 188,0" />
      </defs>
      <g aria-hidden="true" fill="var(--hg-mk-seal)">
        <text fontFamily="var(--font-mono)" fontSize="13.5" fontWeight="600" letterSpacing="2.4" textAnchor="middle">
          <textPath href={`#${uid}-top`} startOffset="50%">
            HALAL GOES · VERIFIED
          </textPath>
        </text>
        <text fontFamily="var(--font-mono)" fontSize="13.5" fontWeight="600" letterSpacing="2.4" textAnchor="middle">
          <textPath href={`#${uid}-bot`} startOffset="50%">
            7 OF 7 CHECKS PASSED
          </textPath>
        </text>
        <circle cx="30" cy="120" r="2.6" />
        <circle cx="210" cy="120" r="2.6" />
      </g>
      <circle
        cx="120"
        cy="120"
        r="72"
        fill="none"
        stroke="var(--hg-mk-seal)"
        strokeWidth="1.25"
        strokeDasharray="3 3"
      />
      <circle cx="120" cy="120" r="58" fill="var(--hg-mk-seal)" />
      <g aria-hidden="true" transform="translate(84 84) scale(3)">
        <path
          d={SHIELD_D}
          fill="var(--hg-mk-on-seal)"
          stroke="var(--hg-mk-on-seal)"
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
        <path
          d="M8.4 12.1l2.5 2.5 4.7-4.9"
          fill="none"
          stroke="var(--hg-mk-seal)"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
