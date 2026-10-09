import React from 'react';
import { SOLAR_ICON_MAP, SOLAR_GLYPHS } from './solar-glyphs.js';
import { reportClientError } from '../internal/report.js';

/* Icon — the Solar icon primitive. Solar (480 Design, CC BY 4.0) is the ONLY icon source
   (owner decision B-13, AGENTS.md §8). Same semantic names and Solar ids as
   packages/ui-web/src/primitives/solar-icon-map.json.

   Weights: linear = inactive, bold = active. A selected tab / chip / nav item swaps to bold;
   the shape carries the state, colour is secondary. Glyphs paint in currentColor.

   The halal shield is NOT an icon. It is the bespoke HalalShield glyph, drawn only by
   HalalBadge and HalalCertificationPanel. No Solar shield or check-badge glyph is mapped here,
   so nothing can borrow the verification mark by accident. */

const SIZES = { sm: 'var(--icon-sm)', md: 'var(--icon-md)', lg: 'var(--icon-lg)', xl: 'var(--icon-xl)', '2xl': 'var(--icon-2xl)' };

/** The 14 names shared with the repo map, then the extension names these components use. */
export const ICON_NAMES = Object.keys(SOLAR_ICON_MAP);
/** Semantic name -> { linear, bold } Solar ids (extension: true = not yet in the repo map). */
export const ICON_MAP = SOLAR_ICON_MAP;

export function Icon({ name, weight = 'linear', size = 'md', accessibilityLabel, color, style, testId, ...rest }) {
  const glyph = SOLAR_GLYPHS[name];
  if (!glyph) {
    reportClientError('ICON_NAME_UNKNOWN', { name });
    return null;
  }
  const body = glyph[weight === 'bold' ? 'bold' : 'linear'];
  const px = typeof size === 'number' ? size : (SIZES[size] || size);
  return (
    <svg viewBox="0 0 24 24" width={px} height={px}
      role={accessibilityLabel ? 'img' : undefined}
      aria-hidden={accessibilityLabel ? undefined : true}
      aria-label={accessibilityLabel || undefined}
      focusable="false"
      data-testid={testId || 'Icon'}
      data-hg-icon={name}
      data-hg-icon-weight={weight === 'bold' ? 'bold' : 'linear'}
      style={{ display: 'block', flex: '0 0 auto', color, ...style }}
      dangerouslySetInnerHTML={{ __html: body }} {...rest} />
  );
}
