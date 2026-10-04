import { describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSource, isReservedGreenSolid, COLOR_BY_UTILITY } from '../l4-no-green-solids.js';
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

  it('a misspelt halal var is not a halal var — its fallback is what paints', () => {
    // The admin live map shipped `var(--hg-color-halal-verified, <green>)`. That
    // name does not exist, so every pin painted the fallback. The prefix used to
    // exempt it; resolution now has to succeed before the allowlist applies.
    const green = color.success['600'];
    // l4-allow: fixture for the rule itself
    const css = lintSource('x.css', `.pin { background: var(--hg-color-halal-verified, ${green}); }`);
    expect(css).toHaveLength(1);
    expect(css[0]?.hex).toBe(green.toUpperCase());

    // A real halal token keeps its exemption, fallback and all.
    const seal = color.halal.certified.seal;
    expect(
      lintSource('x.css', `.pin { background: var(--hg-color-halal-certified-seal, ${seal}); }`),
    ).toEqual([]);
  });

  it('flags a green painted imperatively through a variable', () => {
    // Declarative scanners cannot see `el.style.background = c`; the colour
    // arrives through a variable. Files that paint imperatively are swept.
    const green = color.success['600'];
    const src = [
      // l4-allow: fixture for the rule itself
      `const c = '${green}';`,
      `el.style.background = c;`,
    ].join('\n');
    const found = lintSource('Map.tsx', src);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('imperatively');

    // The same literal in a file that never paints imperatively is left alone —
    // the sweep is scoped so it does not fire on every hex in the codebase.
    expect(lintSource('Tokens.tsx', `const c = '${green}';`)).toEqual([]);
  });

  it('camelCase token leaves resolve by their kebab var name', () => {
    // flattenColors used to lowercase the path before the camelCase→kebab pass,
    // so color.map.pinRider was indexed only as `map-pinrider` and
    // --hg-color-map-pin-rider resolved to nothing. The registered rider-pin
    // exception survived on prefix-matching alone. Asserted on the table itself:
    // a behavioural test cannot see this, because an unresolved var with no
    // fallback also lints clean.
    expect(COLOR_BY_UTILITY.get('map-pin-rider')).toBe(color.map.pinRider.toUpperCase());
    expect(COLOR_BY_UTILITY.get('map-pin-restaurant')).toBe(color.map.pinRestaurant.toUpperCase());
    expect(COLOR_BY_UTILITY.get('map-pin-customer')).toBe(color.map.pinCustomer.toUpperCase());
  });

  it('the foundation tier itself is clean', () => {
    expect(lintPaths([join(PKG, 'src')])).toEqual([]);
  });
});
