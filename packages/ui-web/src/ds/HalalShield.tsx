/**
 * `HalalShield` — the bespoke verification mark (live `index.d.ts`, `HalalShield/README.md`,
 * 01-foundations.md §11). Only `HalalBadge` and `HalalCertificationPanel` draw it.
 *
 * - Four variants are the **shape channel** of the halal state (it must survive the loss of any
 *   two of colour, shape and text): `solid` (certified), `outline` (expired), `dashed`
 *   (unverified) and `solid-clock` (the renewal note and the amber expiring seal).
 * - An inline SVG, never a font glyph and never an icon-set shield; never RTL-mirrored, never
 *   animated, always decorative (`aria-hidden`): the owning badge carries the name.
 * - The ink is `currentColor`; the knockout (the tick or clock cut out of a filled shield) is a
 *   halal token, never a raw colour.
 * - Fixes the legacy bug where a CSS length (`var(--hg-icon-sm)`) went into the SVG `width`
 *   attribute, which browsers ignore: a CSS length is applied as a style, a number as both.
 *
 * The geometry is the legacy `certification/HalalShield.tsx`, unchanged.
 */

import type { CSSProperties } from 'react';

/** The four shapes of the halal state. */
export type HalalShieldVariant = 'solid' | 'outline' | 'dashed' | 'solid-clock';

/** Props of the live `HalalShield` (index.d.ts). */
export interface HalalShieldProps {
  /** solid (certified) · outline (expired) · dashed (unverified) · solid-clock (renewal note). */
  variant: HalalShieldVariant;
  /** px or a CSS length; default `var(--hg-icon-sm)` (16px). */
  size?: number | string;
  /** Plate colour the tick or clock is knocked out against on filled variants: a halal token. */
  knockout?: string;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  /** Layout only. */
  className?: string;
}

/** 24×24 grid, matching `icon.*` sizing. */
const SHIELD =
  'M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z';
const CHECK = 'M8.4 12.1l2.5 2.5 4.7-4.9';
const CLOCK_HAND = 'M12 8.8v3.6l2.4 1.5';
const CLOCK_FACE = 'M12 7.5a4.1 4.1 0 1 1 0 8.2a4.1 4.1 0 1 1 0-8.2Z';

/** The default knockout: the certified seal plate, a halal role (never a raw colour). */
const DEFAULT_KNOCKOUT = 'var(--hg-color-halal-certified-seal)';

/** One stroke of the mark: its path, what it is painted with, and its line. */
interface Mark {
  d: string;
  /** `ink` is currentColor; `knockout` is the plate colour the mark is cut out of. */
  paint: 'ink' | 'knockout';
  width: number;
  dash?: string;
  /** The shield outline itself is filled on the solid variants. */
  fill?: boolean;
}

/** The marks drawn over the shield, per variant (geometry identical to the legacy glyph). */
const MARKS: Record<HalalShieldVariant, Mark[]> = {
  solid: [{ d: SHIELD, paint: 'ink', width: 1.75, fill: true }, { d: CHECK, paint: 'knockout', width: 1.9 }],
  outline: [{ d: SHIELD, paint: 'ink', width: 1.75 }, { d: CHECK, paint: 'ink', width: 1.9 }],
  dashed: [
    { d: SHIELD, paint: 'ink', width: 1.5, dash: '3 2.5' },
    { d: CHECK, paint: 'ink', width: 1.5, dash: '2.5 2' },
  ],
  'solid-clock': [
    { d: SHIELD, paint: 'ink', width: 1.75, fill: true },
    { d: CLOCK_FACE, paint: 'knockout', width: 1.6 },
    { d: CLOCK_HAND, paint: 'knockout', width: 1.6 },
  ],
};

/** The verification glyph in one of its four shapes. Decorative. */
export function HalalShield({
  variant,
  size = 'var(--hg-icon-sm)',
  knockout = DEFAULT_KNOCKOUT,
  testId = 'HalalShield',
  style,
  className,
}: HalalShieldProps) {
  // A number is a valid SVG attribute; a CSS length (`var(…)`, `1.25rem`) is not, so it goes to
  // the style, where the browser resolves it.
  const px = typeof size === 'number' ? size : undefined;
  const marks = MARKS[variant] ?? MARKS.outline;
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      aria-hidden="true"
      focusable="false"
      data-testid={testId}
      data-variant={variant}
      className={className}
      style={{ display: 'block', flexShrink: 0, inlineSize: size, blockSize: size, ...style }}
    >
      {marks.map((m, i) => {
        const color = m.paint === 'ink' ? 'currentColor' : knockout;
        return (
          <path
            key={i}
            d={m.d}
            fill={m.fill ? color : 'none'}
            stroke={color}
            strokeWidth={m.width}
            strokeDasharray={m.dash}
            strokeLinecap={i === 0 ? undefined : 'round'}
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
