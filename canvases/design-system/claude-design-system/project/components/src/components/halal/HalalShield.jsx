import React from 'react';

/* HalalShield — the BESPOKE verification glyph (01-foundations.md §11). Never a Solar or any
   other icon-set shield, never a font glyph (a font glyph fails silently and would render a blank
   certification badge). Geometry is identical to packages/ui-web/src/certification/HalalShield.tsx.

   Four variants — the SHAPE channel of 04-accessibility.md A-0 (a halal state must survive the
   loss of any two of colour, shape and text):
     solid        CERTIFIED / EXPIRING_SOON — filled shield, tick knocked out of it
     outline      EXPIRED — hollow shield, stroked tick
     dashed       UNVERIFIED (operational surfaces only) — dashed shield, dashed tick
     solid-clock  the renewal note inside HalalCertificationPanel — filled shield, clock knocked out
   Ink is currentColor (the parent sets a halal token); `knockout` is the plate colour the tick is
   cut against on filled variants — a halal token, never a raw colour. Decorative (aria-hidden):
   the owning badge carries the name. Never RTL-mirrored. Never animated. */

const SHIELD = 'M12 2.25 4.5 5.35v6.02c0 4.4 3.02 8.5 7.5 9.88 4.48-1.38 7.5-5.48 7.5-9.88V5.35L12 2.25Z';
const CHECK = 'M8.4 12.1l2.5 2.5 4.7-4.9';
const CLOCK_HAND = 'M12 8.8v3.6l2.4 1.5';

export function HalalShield({ variant = 'solid', size = 'var(--icon-sm)', knockout = 'var(--color-halal-certified-seal)', testId, style, ...rest }) {
  const filled = variant === 'solid' || variant === 'solid-clock';
  const dashed = variant === 'dashed';
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="presentation" aria-hidden="true" focusable="false"
      data-testid={testId || 'HalalShield'} data-variant={variant}
      style={{ display: 'block', flexShrink: 0, ...style }} {...rest}>
      <path d={SHIELD} fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
        strokeWidth={dashed ? 1.5 : 1.75} strokeLinejoin="round" strokeDasharray={dashed ? '3 2.5' : undefined} />
      {variant === 'solid-clock' ? (
        <>
          <circle cx={12} cy={11.6} r={4.1} fill="none" stroke={knockout} strokeWidth={1.6} />
          <path d={CLOCK_HAND} fill="none" stroke={knockout} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <path d={CHECK} fill="none" stroke={filled ? knockout : 'currentColor'} strokeWidth={dashed ? 1.5 : 1.9}
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? '2.5 2' : undefined} />
      )}
    </svg>
  );
}
