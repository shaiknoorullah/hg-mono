import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { roles, type ColorScheme } from '@hg/ui-web/tokens';
import { isReservedGreenSolid } from '@hg/ui-web/lint';

import { KeysetGrid, type GridColumn } from '../src/components/KeysetGrid';

/**
 * The admin data grid has to render STYLED, and nothing else on the page notices when it
 * doesn't: the rows still render, they just render as bare text. That is how
 * https://github.com/shaiknoorullah/hg-mono/issues/145 shipped. These pin the three things
 * that have to stay true for LyteNyte's styles to apply, in the theme we designed:
 *
 *  1. the grid sits inside the `ln-grid` class every LyteNyte rule is scoped to;
 *  2. the app loads LyteNyte's structural stylesheet and our generated theme, and never one
 *     of LyteNyte's own themes (which write their palette onto `:root`, include a solid
 *     green, and switch to dark on a `.dark` class this app never sets);
 *  3. our theme gives a value to every variable LyteNyte's stylesheet reads (so an upgrade
 *     that starts reading a new one fails here, not on screen), and none of those values is
 *     a solid green — that colour belongs to the halal seal alone
 *     (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/design/01-foundations.md#9-token-pipeline-and-lint-rules).
 */

interface Row {
  id: string;
  code: string;
}

const COLUMNS: readonly GridColumn<Row>[] = [{ id: 'code', name: 'Order', width: 140, render: (row) => row.code }];

// Read from disk, resolved the way the app resolves them: the test runner stubs out
// stylesheet imports, so `?raw` would hand back an empty string.
const require = createRequire(import.meta.url);
const lyteNyteGridCss = readFileSync(require.resolve('@1771technologies/lytenyte-core/grid.css'), 'utf8');
const gridThemeCss = readFileSync(require.resolve('@hg/ui-web/grid-theme.css'), 'utf8');

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Every .ts/.tsx/.css file under apps/admin/src, keyed by its path from there. */
function appSources(dir = SRC, out: Record<string, string> = {}): Record<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) appSources(path, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out[relative(SRC, path)] = readFileSync(path, 'utf8');
  }
  return out;
}

/** Variables LyteNyte writes itself, as inline styles, so no theme has to supply them. */
const SET_BY_LYTENYTE = new Set(['--ln-row-height']);

/** `--hg-<group>-<role>` → hex, for one scheme, named exactly as tokens.css names them. */
function roleColours(scheme: ColorScheme): Map<string, string> {
  const out = new Map<string, string>();
  const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  const walk = (prefix: string, node: unknown) => {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const name = `${prefix}-${kebab(key)}`;
      if (typeof value === 'string') out.set(name, value);
      else if (value && typeof value === 'object') walk(name, value);
    }
  };
  for (const [group, tree] of Object.entries(roles[scheme])) walk(`--hg-${kebab(group)}`, tree);
  return out;
}

describe('admin data grid styles', () => {
  beforeAll(() => {
    // jsdom has no layout; LyteNyte only needs the observer to exist.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  });

  afterEach(cleanup);

  it('renders the grid inside the ln-grid class LyteNyte scopes its rules to', () => {
    render(
      <KeysetGrid<Row>
        columns={COLUMNS}
        rows={[{ id: 'o1', code: 'HG-8F3K2Q' }]}
        meta={{ next_cursor: null, has_more: false }}
        pagination={{
          cursor: null, limit: 20, setLimit: () => {}, canGoPrevious: false,
          next: () => {}, previous: () => {}, reset: () => {},
        }}
        loading={false}
        error={null}
        onRetry={() => {}}
        getRowId={(row) => row.id}
        unit="orders"
        emptyTitle="No orders"
        emptyDescription="Nothing matches."
      />,
    );

    expect(screen.getByRole('grid').closest('.ln-grid')).not.toBeNull();
  });

  it("loads LyteNyte's structure with our theme, and never one of LyteNyte's themes", () => {
    const sources = appSources();
    expect(sources['styles.css']).toContain('@import');

    const imports = (src: string) =>
      [...src.matchAll(/(?:@import|import)\s+['"]([^'"]+\.css)['"]/g)].map((m) => m[1]);

    const lyteNyteSheets = Object.entries(sources).flatMap(([file, src]) =>
      imports(src)
        .filter((sheet) => sheet?.startsWith('@1771technologies/'))
        .map((sheet) => `${file} → ${sheet}`),
    );
    expect(lyteNyteSheets).toEqual(['components/KeysetGrid.tsx → @1771technologies/lytenyte-core/grid.css']);

    for (const [file, src] of Object.entries(sources)) {
      if (imports(src).includes('@1771technologies/lytenyte-core/grid.css')) {
        expect(imports(src), `${file} loads LyteNyte's structure without our theme`).toContain(
          '@hg/ui-web/grid-theme.css',
        );
      }
    }
  });

  it("gives every variable LyteNyte's stylesheet reads a role, and none is a solid green", () => {
    const read = new Set([...lyteNyteGridCss.matchAll(/var\((--ln-[\w-]+)/g)].map((m) => m[1]!));
    expect(read.size).toBeGreaterThan(0);

    const block = /^\.ln-grid \{([\s\S]*?)^\}/m.exec(gridThemeCss)?.[1] ?? '';
    const themed = new Map(
      [...block.matchAll(/(--ln-[\w-]+):\s*var\((--hg-[\w-]+)\)/g)].map((m) => [m[1]!, m[2]!]),
    );

    const unthemed = [...read].filter((name) => !themed.has(name) && !SET_BY_LYTENYTE.has(name));
    expect(unthemed).toEqual([]);

    // Every colour the theme reaches for, ln-variables and the theme's own rules alike.
    const used = new Set([...gridThemeCss.matchAll(/var\((--hg-[\w-]+)\)/g)].map((m) => m[1]!));
    const greens: string[] = [];
    for (const scheme of Object.keys(roles) as ColorScheme[]) {
      const colours = roleColours(scheme);
      // Not vacuous: the surfaces and the selected tint must actually resolve to colours.
      expect(colours.get('--hg-surface-base')).toMatch(/^#/);
      expect(colours.get('--hg-state-selected-tint')).toMatch(/^#/);
      for (const name of used) {
        const hex = colours.get(name);
        if (hex && isReservedGreenSolid(hex)) greens.push(`${scheme} ${name} ${hex}`);
      }
    }
    expect(greens).toEqual([]);
  });
});
