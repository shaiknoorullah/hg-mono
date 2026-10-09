// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compareParity,
  normalise,
  resolveGeneratedCss,
  resolveSnapshot,
  type AllowEntry,
  type DtcgSnapshot,
} from '../../../../../scripts/design-sync.mjs';
import { findRawElements, lintComposition } from '../../lint/composition.js';

/**
 * The live Claude Design tokens against what @hg/ui-web ships.
 *
 * Two things must hold: the sync script reads the live file's nested {light, dark}
 * values as the same-scheme value (a wrong flatten would silently swap a light role
 * for a dark one), and every live action, control, feedback and focus-ring-on role
 * exists in the generated CSS with the live value, in both themes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..', '..', '..');
const read = (path: string): string => readFileSync(join(REPO, path), 'utf8');

describe('design-sync normalise', () => {
  const live = {
    color: {
      tokens: [
        { name: 'color-ink-100', value: '#111111' },
        { name: 'color-ink-900', value: '#999999' },
        { name: 'text-primary', value: { light: '{color-ink-900}', dark: '{color-ink-100}' } },
        // A role that references a themed role: resolves to a nested pair.
        { name: 'control-fg', value: { light: '{text-primary}', dark: '{text-primary}' } },
        // A value written nested outright.
        {
          name: 'action-fg',
          value: {
            light: { light: '{color-ink-900}', dark: '{color-ink-100}' },
            dark: { light: '{color-ink-900}', dark: '{color-ink-100}' },
          },
        },
        { name: 'surface-base', value: { light: '{color-ink-100}', dark: '{color-ink-900}' } },
      ],
    },
  };

  it('flattens nested {light, dark} values to light.light and dark.dark, and reports them', () => {
    const { dtcg, malformed } = normalise(live);
    expect(malformed.map((m) => m.name)).toEqual(['control-fg', 'action-fg']);

    const resolved = resolveSnapshot(dtcg);
    expect(resolved.light['control-fg']).toBe('#999999');
    expect(resolved.dark['control-fg']).toBe('#111111');
    expect(resolved.light['action-fg']).toBe('#999999');
    expect(resolved.dark['action-fg']).toBe('#111111');
    // A plain role is not reported.
    expect(resolved.dark['surface-base']).toBe('#999999');
  });

  it('flags exactly the 15 malformed tokens in the pinned live snapshot', () => {
    const snapshot = JSON.parse(read('design/claude-design/tokens.json')) as DtcgSnapshot;
    const meta = snapshot.$extensions?.['com.halalgoes.design-sync'] as { flattened: string[] };
    expect(meta.flattened).toHaveLength(15);
    expect(meta.flattened).toContain('elev-surface-0');
  });
});

describe('web output parity with the live design system', () => {
  const snapshot = JSON.parse(read('design/claude-design/tokens.json')) as DtcgSnapshot;
  const live = resolveSnapshot(snapshot);
  const web = resolveGeneratedCss(read('packages/ui-web/src/tokens/tokens.css'));
  const allowlist = (JSON.parse(read('design/claude-design/parity-allowlist.json')) as { entries: AllowEntry[] })
    .entries;

  it.each(['light', 'dark'] as const)(
    'emits every live action, control, feedback and focus-ring-on role with its live value (%s)',
    (scheme) => {
      const roles = Object.keys(live[scheme]).filter((n) =>
        /^(action|control|feedback|focus-ring-on)-/.test(n),
      );
      expect(roles.length).toBeGreaterThan(50);
      for (const role of roles) {
        expect({ role, value: web[scheme][role] }).toEqual({ role, value: live[scheme][role] });
      }
    },
  );

  it('has no unexplained drift and no stale allow-list entry', () => {
    const result = compareParity(live, web, allowlist);
    expect(result.drift).toEqual([]);
    expect(result.stale).toEqual([]);
  });
});

describe('composition lint', () => {
  it('finds raw interactive elements, including a multi-line <a onClick>, and nothing composed', () => {
    const source = [
      '<Button onClick={go}>Go</Button>',
      '<button type="button">x</button>',
      '<input value={v} />',
      '<a',
      '  href="#"',
      '  onClick={() => go()}',
      '>link</a>',
      '<a href="/plain">plain</a>',
      '<Select />',
    ].join('\n');
    expect(findRawElements(source)).toEqual([
      { line: 2, element: '<button>' },
      { line: 3, element: '<input>' },
      { line: 4, element: '<a onClick>' },
    ]);
  });

  it('reports new component files and raw elements outside the legacy baselines, and nothing inside', () => {
    const repo = mkdtempSync(join(tmpdir(), 'hg-composition-'));
    const put = (path: string, text: string): void => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    };
    try {
      put('apps/admin/src/components/Legacy.tsx', 'export const A = () => <button>x</button>;');
      put('apps/admin/src/components/New.tsx', 'export const B = () => null;');
      put('apps/restaurant/src/routes/Fresh.tsx', 'export const C = () => <input />;');
      put('apps/restaurant/src/redesign/Board.tsx', 'export const D = () => <select />;');
      put('packages/ui-web/src/lib/ui/button.tsx', 'export const E = () => <button />;');

      const findings = lintComposition(repo, {
        files: ['apps/admin/src/components/Legacy.tsx'],
        // A redesign file is reported even if someone lists it in the baseline.
        rawElementFiles: ['apps/admin/src/components/Legacy.tsx', 'apps/restaurant/src/redesign/Board.tsx'],
      });
      expect(findings.map((f) => `${f.rule} ${f.file}`).sort()).toEqual([
        'C-1 apps/admin/src/components/New.tsx',
        'C-2 apps/restaurant/src/redesign/Board.tsx',
        'C-2 apps/restaurant/src/routes/Fresh.tsx',
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('pins the raw-element baseline taken when the lint landed: 8 admin and restaurant files', () => {
    // Warn mode: live findings are not asserted here, so a new raw element warns, never fails.
    const baseline = JSON.parse(read('packages/ui-web/src/lint/composition-baseline.json')) as {
      rawElementFiles: string[];
    };
    expect(baseline.rawElementFiles).toHaveLength(8);
  });
});
