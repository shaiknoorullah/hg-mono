import { describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSource, isReservedGreenSolid } from '../l4-no-green-solids.js';
import { lintPaths } from '../run.js';
import { color } from '../../tokens/index.js';

/**
 * L-4 — the green-solid monopoly, in executable form.
 *
 * The interesting cases are the two the rule must NOT flag: the halal seal
 * (which owns solid green) and the semantic success TINT (which is the
 * prescribed remedy, not the violation).
 */

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('L-4 no green solids', () => {
  it('classifies the seal as a solid and the success tint as a tint', () => {
    expect(isReservedGreenSolid(color.halal.certified.seal)).not.toBeNull();
    expect(isReservedGreenSolid(color.success['600'])).not.toBeNull();
    // The tint is a legal background — "a light background with dark green text".
    expect(isReservedGreenSolid(color.success['50'])).toBeNull();
    // Warm neutrals and brand yellow are nowhere near the band.
    expect(isReservedGreenSolid(color.neutral['500'])).toBeNull();
    expect(isReservedGreenSolid(color.brand['500'])).toBeNull();
  });

  it('flags a filled success green in CSS and in a Tailwind class', () => {
    // l4-allow: fixture for the rule itself
    const css = lintSource('x.css', `.badge { background-color: ${color.success['600']}; }`);
    expect(css).toHaveLength(1);
    expect(css[0]?.message).toContain('L-4');

    // l4-allow: fixture for the rule itself
    const tsx = lintSource('x.tsx', `const c = 'inline-flex bg-success-600 text-white';`);
    expect(tsx).toHaveLength(1);
  });

  it('does not flag success used as text, icon or border', () => {
    expect(lintSource('x.tsx', `const c = 'text-success-600 border-success-600';`)).toEqual([]);
    expect(lintSource('x.css', `.note { color: ${color.success['600']}; }`)).toEqual([]);
  });

  it('does not flag the halal namespace — it owns solid green', () => {
    expect(
      lintSource('HalalBadge.tsx', `const c = 'bg-halal-certified-seal text-halal-certified-on-seal';`),
    ).toEqual([]);
    expect(
      lintSource('halal.css', `.seal { background: var(--hg-color-halal-certified-seal); }`),
    ).toEqual([]);
    // Including when written as a raw hex — the value itself is allowlisted.
    expect(
      lintSource('HalalBadge.tsx', `<div style={{ backgroundColor: '${color.halal.certified.seal}' }} />`),
    ).toEqual([]);
  });

  it('honours the one registered exception: the rider map pin (§2.6)', () => {
    expect(lintSource('MapPin.tsx', `const c = 'bg-map-pin-rider';`)).toEqual([]);
  });

  it('a suppression demands a written reason', () => {
    expect(lintSource('x.tsx', `/* l4-allow: registered exception */ 'bg-success-600'`)).toEqual([]);
  });

  it('the foundation tier itself is clean', () => {
    expect(lintPaths([join(PKG, 'src')])).toEqual([]);
  });
});
