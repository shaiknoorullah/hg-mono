/**
 * Token drift.
 *
 * `docs/design/tokens.json` is the system of record. This suite is what makes that sentence
 * enforceable rather than aspirational: it re-runs the generator in memory and byte-compares
 * against what is committed under `src/tokens/generated/`, then independently walks
 * `tokens.json` and checks the values that actually reach a component.
 *
 * Both halves matter. The byte comparison catches a hand edit to a generated file. The
 * semantic walk catches a generator that is faithfully reproducing the wrong thing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildFiles, hueOf, RESERVED_HUE } from '../build';
import { tokens } from '../generated/tokens';
import { themes } from '../generated/themes';

const GENERATED_DIR = path.join(__dirname, '..', 'generated');
const TOKENS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'docs',
  'design',
  'tokens.json',
);

const source = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as Record<string, any>;
const rebuilt = buildFiles(source);

describe('generated tokens match tokens.json', () => {
  it('emits exactly the files that are committed, and no others', () => {
    const onDisk = fs.readdirSync(GENERATED_DIR).sort();
    expect(onDisk).toEqual(Object.keys(rebuilt).sort());
  });

  it.each(Object.keys(rebuilt))('%s is byte-identical to a fresh generation', (name) => {
    const committed = fs.readFileSync(path.join(GENERATED_DIR, name), 'utf8');
    // If this fails: run `pnpm --filter @hg/ui-native generate:tokens`. Never hand-edit.
    expect(committed).toBe(rebuilt[name]);
  });
});

describe('the values that reach components are the values in the design document', () => {
  it('carries every colour ramp step verbatim, aliases resolved', () => {
    for (const [rampName, ramp] of Object.entries(source.color as Record<string, any>)) {
      if (rampName.startsWith('$')) continue;
      for (const [step, node] of Object.entries(ramp as Record<string, any>)) {
        if (step.startsWith('$')) continue;
        if (typeof node?.$value !== 'string') continue;
        expect((tokens.color as any)[rampName][step]).toBe(node.$value);
      }
    }
  });

  it('resolves theme role aliases rather than shipping the `{color.x.y}` string', () => {
    // theme.light.text.primary is authored as {color.neutral.900}.
    expect(source.theme.light.text.primary.$value).toBe('{color.neutral.900}');
    expect(tokens.theme.light.text.primary).toBe(source.color.neutral['900'].$value);
    expect(themes.customer.light.color.text.primary).toBe(source.color.neutral['900'].$value);
  });

  it('keeps typography RN-ready: px line-height and em×size letter-spacing', () => {
    const display = source.typography['display.lg'].$value;
    const generated = themes.customer.light.typography['display.lg'];
    expect(generated.fontSize).toBe(display.fontSize);
    expect(generated.lineHeight).toBe(display.lineHeightPx);
    // -0.02em at 36 is -0.72dp.
    expect(generated.letterSpacing).toBeCloseTo(-0.72, 5);
    expect(generated.fontFamily).toBe(source.font.family.ui.$value[0]);
  });

  it('applies the rider deltas at the theme root, not per component', () => {
    // §3.3: the field register runs one step up.
    expect(themes.rider.light.typography['body.md']).toEqual(
      themes.customer.light.typography['body.lg'],
    );
    expect(themes.rider.light.typography['label.md']).toEqual(
      themes.customer.light.typography['label.lg'],
    );
    expect(themes.rider.light.density).toEqual(tokens.density.roomy);
    expect(themes.rider.light.target.min).toBe(tokens.target.field);
    expect(themes.customer.light.target.min).toBe(tokens.target.min);
  });

  it('escalates rider tertiary text so every body string clears 7:1', () => {
    // text.tertiary measures 5.67:1 light and 5.26:1 dark, below the field-register floor.
    expect(themes.rider.light.color.text.tertiary).toBe(themes.rider.light.color.text.secondary);
    expect(themes.rider.dark.color.text.tertiary).toBe(themes.rider.dark.color.text.secondary);
    expect(themes.customer.light.color.text.tertiary).toBe(source.color.neutral['600'].$value);
  });

  it('keeps dark elevation as a surface step, never as an invisible shadow', () => {
    expect(themes.customer.dark.elevationMode).toBe('surface');
    expect(themes.customer.light.elevationMode).toBe('shadow');
    expect(tokens.elevation['3'].surfaceStep).toBe(tokens.theme.dark.surface.raised);
  });
});

describe('RULE H-1 survives the generator', () => {
  it('gives semantic success no solid in either scheme', () => {
    expect(themes.customer.light.color.feedback.success.solid).toBeNull();
    expect(themes.customer.dark.color.feedback.success.solid).toBeNull();
    expect(themes.rider.dark.color.feedback.success.solid).toBeNull();
    // The other three keep theirs.
    expect(themes.customer.light.color.feedback.danger.solid).toBe(source.color.danger['500'].$value);
  });

  it('keeps every avatar fill out of the reserved hue band', () => {
    for (const hex of themes.customer.light.color.avatarFills) {
      const hue = hueOf(hex);
      const inBand = hue !== null && hue >= RESERVED_HUE.min && hue <= RESERVED_HUE.max;
      expect(inBand).toBe(false);
    }
  });

  it('publishes the halal hexes the L-4 lint rule allowlists', () => {
    const lint = JSON.parse(
      fs.readFileSync(path.join(GENERATED_DIR, 'lint-tokens.json'), 'utf8'),
    ) as { halalHexes: string[]; exceptions: Record<string, string> };
    expect(lint.halalHexes).toContain(source.color.halal.certified.seal.$value);
    expect(lint.halalHexes).toContain(source.color.halal.certified.sealDark.$value);
    // The one registered non-halal use of a reserved green.
    expect(lint.exceptions['color.map.pinRider']).toBe(source.color.map.pinRider.$value);
  });
});
