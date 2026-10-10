/**
 * HalalShield specimens. The live components/HalalShield/preview.html is one row (its `full`
 * shot): the four variants at 40px in their halal inks.
 */

import { HalalShield, type HalalShieldVariant } from './HalalShield.js';

/** The live design system's component name. */
export const component = 'HalalShield';

const CELLS: Array<{ variant: HalalShieldVariant; ink: string; knockout: string; name: string }> = [
  { variant: 'solid', ink: 'var(--hg-color-halal-certified-seal)', knockout: 'var(--hg-surface-base)', name: 'solid · certified' },
  { variant: 'outline', ink: 'var(--hg-color-halal-expired-seal)', knockout: 'transparent', name: 'outline · expired' },
  { variant: 'dashed', ink: 'var(--hg-color-halal-unverified-text)', knockout: 'transparent', name: 'dashed · unverified' },
  { variant: 'solid-clock', ink: 'var(--hg-color-halal-expiring-icon)', knockout: 'var(--hg-surface-base)', name: 'solid-clock · renewal note' },
];

/** All four variants, as the live preview draws them. */
export function Full() {
  return (
    <div className="hg-specimen-row" style={{ gap: 28 }}>
      {CELLS.map((c) => (
        <div key={c.variant} style={{ display: 'grid', justifyItems: 'center', gap: 6, color: c.ink }}>
          <HalalShield variant={c.variant} size={40} knockout={c.knockout} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--hg-text-tertiary)' }}>{c.name}</span>
        </div>
      ))}
    </div>
  );
}

/** The default size is the icon.sm token, set as a style (the legacy SVG width bug, fixed). */
export function DefaultSize() {
  return (
    <div className="hg-specimen-row" style={{ color: 'var(--hg-color-halal-certified-seal)' }}>
      <HalalShield variant="solid" />
      <HalalShield variant="solid" size="var(--hg-icon-md)" />
      <HalalShield variant="solid" size={24} />
    </div>
  );
}
