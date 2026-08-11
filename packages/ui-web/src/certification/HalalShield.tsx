/**
 * The halal shield — a **bespoke** glyph, never `lucide/shield-check`
 * (`01-foundations.md` §11). Two reasons it is not from the icon set: it cannot then be reused
 * accidentally by a security or "verified user" feature, and it cannot collide with one.
 * It is an inline SVG and never a font glyph — a font glyph fails silently, and a silent
 * failure here renders a blank certification badge.
 *
 * The four variants are the **shape channel** of `04-accessibility.md` A-0: the halal state
 * must survive removal of any two of {colour, shape, text}. Read in greyscale with the label
 * stripped, a solid shield, a hollow shield and a dashed shield are still three different
 * things.
 *
 * The glyph is explicitly **not** RTL-mirrored (`04-accessibility.md` §7 rule 2).
 */
import type { CSSProperties } from 'react';

export type HalalShieldVariant = 'solid' | 'outline' | 'dashed' | 'solid-clock';

/** 24×24 grid, matching `icon.*` sizing. */
const SHIELD =
  'M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z';
const CHECK = 'M8.4 12.1l2.5 2.5 4.7-4.9';
const CLOCK_HAND = 'M12 8.8v3.6l2.4 1.5';

export interface HalalShieldProps {
  variant: HalalShieldVariant;
  /** Rendered size in px. Defaults to the `icon.sm` token. */
  size?: number | string;
  /**
   * The plate colour the glyph is knocked out against. Only used by the filled variants, where
   * the tick is cut *out* of the shield rather than drawn on top of it.
   */
  knockout?: string;
  className?: string;
  style?: CSSProperties;
}

export function HalalShield({
  variant,
  size = 'var(--hg-icon-sm)',
  knockout = 'transparent',
  className,
  style,
}: HalalShieldProps): React.JSX.Element {
  const filled = variant === 'solid' || variant === 'solid-clock';

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      data-testid="HalalShield"
      data-variant={variant}
      className={className}
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      <path
        d={SHIELD}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={variant === 'dashed' ? 1.5 : 1.75}
        strokeLinejoin="round"
        strokeDasharray={variant === 'dashed' ? '3 2.5' : undefined}
      />
      {variant === 'solid-clock' ? (
        <>
          <circle cx={12} cy={11.6} r={4.1} fill="none" stroke={knockout} strokeWidth={1.6} />
          <path
            d={CLOCK_HAND}
            fill="none"
            stroke={knockout}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <path
          d={CHECK}
          fill="none"
          stroke={filled ? knockout : 'currentColor'}
          strokeWidth={variant === 'dashed' ? 1.5 : 1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={variant === 'dashed' ? '2.5 2' : undefined}
        />
      )}
    </svg>
  );
}
