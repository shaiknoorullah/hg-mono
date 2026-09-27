import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { color, roles, space, radius, typography, motion } from '../index.js';
import { themes } from '../themes.js';

/**
 * TOKEN DRIFT.
 *
 * docs/design/tokens.json is the system of record; src/tokens/** is generated
 * from it. This suite is the thing that makes "never hand-copy a hex" true
 * rather than aspirational. It resolves tokens.json independently of the
 * generator — a second implementation of the reference resolver — so a bug in
 * the generator cannot hide behind the same bug in the test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..', '..', '..');
const SOURCE = join(PKG, '..', '..', 'docs', 'design', 'tokens.json');

const raw = JSON.parse(readFileSync(SOURCE, 'utf8')) as Record<string, unknown>;

/** Independent flatten + resolve. */
const flat = new Map<string, unknown>();
(function walk(node: unknown, path: string[]): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const record = node as Record<string, unknown>;
  if ('$value' in record) {
    flat.set(path.join('.'), record.$value);
    return;
  }
  for (const [key, child] of Object.entries(record)) {
    if (key.startsWith('$')) continue;
    walk(child, [...path, ...key.split('.')]);
  }
})(raw, []);

function deref(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = /^\{([^}]+)\}$/.exec(value.trim());
    if (!match?.[1]) return value;
    return deref(flat.get(match[1]));
  }
  if (Array.isArray(value)) return value.map(deref);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deref(v)]));
  }
  return value;
}

const source = (path: string): unknown => deref(flat.get(path));

describe('token drift — generated tokens match docs/design/tokens.json', () => {
  it('every colour ramp step matches the source, exactly', () => {
    const mismatches: string[] = [];
    for (const path of flat.keys()) {
      if (!path.startsWith('color.')) continue;
      const leaf = path.slice('color.'.length).split('.');
      let cursor: unknown = color;
      for (const key of leaf) cursor = (cursor as Record<string, unknown>)?.[key];
      if (cursor !== source(path)) mismatches.push(`${path}: ${String(cursor)} ≠ ${String(source(path))}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('scales match the source', () => {
    expect(space).toEqual(
      Object.fromEntries(
        [...flat.keys()]
          .filter((k) => k.startsWith('space.'))
          .map((k) => [k.slice('space.'.length), source(k)]),
      ),
    );
    expect(radius).toEqual(
      Object.fromEntries(
        [...flat.keys()]
          .filter((k) => k.startsWith('radius.'))
          .map((k) => [k.slice('radius.'.length), source(k)]),
      ),
    );
    expect(typography.body.md).toEqual(source('typography.body.md'));
    expect(typography.label.sm).toEqual(source('typography.label.sm'));
    expect(motion.duration.base).toEqual(source('motion.duration.base'));
  });

  it('role maps resolve their references — no dangling {refs} survive', () => {
    const dangling: string[] = [];
    (function scan(node: unknown, path: string): void {
      if (typeof node === 'string') {
        if (/^\{.+\}$/.test(node)) dangling.push(`${path} = ${node}`);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) scan(v, `${path}.${k}`);
      }
    })(roles, 'roles');
    expect(dangling).toEqual([]);

    expect(roles.light.text.primary).toBe(source('color.neutral.900'));
    expect(roles.dark.surface.base).toBe(source('color.neutral.950'));
    expect(roles.light.action.primary.bg).toBe(source('color.brand.500'));
    expect(roles.light.action.primary.fg).toBe(source('theme.light.text.onBrand'));
  });

  it('RULE H-1 survives into the theme layer: there is no success solid token', () => {
    // The absence is the enforcement. A `success` fill cannot be written
    // because there is no token to write it with.
    expect('solid' in roles.light.feedback.success).toBe(false);
    expect('solid' in roles.dark.feedback.success).toBe(false);
    expect('solid' in roles.light.feedback.danger).toBe(true);
  });

  it('the focus colour is the theme brand border, and flips where 04-accessibility.md §4.1 says', () => {
    // docs/decisions/focus-indicator.md: one indicator in the theme's colour. A focused
    // field's 2px border and a borderless control's ring are the same colour, so the
    // ring IS border.brand in both schemes.
    expect(roles.light.focus.ring).toBe(source('color.brand.600'));
    expect(roles.dark.focus.ring).toBe(source('color.brand.400'));
    // brand.600 measures below 3:1 on these fills (generator report) — the ring must
    // not be drawn in the focus colour on them.
    for (const container of ['brand', 'accent', 'danger', 'warning', 'info', 'halal'] as const) {
      expect(roles.light.focus.ringOn[container]).toBe(roles.light.focus.onColor);
    }
  });

  it('the restaurant and admin themes are concrete and differ only in density', () => {
    expect(themes.restaurant.light.density).toBe('compact');
    expect(themes.admin.light.density).toBe('comfortable');
    expect(themes.restaurant.light.register).toBe('operational');
    expect(themes.admin.light.register).toBe('operational');
    // Same operational role map, both schemes.
    expect(themes.restaurant.light.color).toEqual(themes.admin.light.color);
    expect(themes.restaurant.dark.color).toEqual(themes.admin.dark.color);
    expect(themes.restaurant.light.color).not.toEqual(themes.restaurant.dark.color);
    const densityFromSource = (mode: string) =>
      Object.fromEntries(
        [...flat.keys()]
          .filter((k) => k.startsWith(`density.${mode}.`))
          .map((k) => [k.split('.')[2] as string, source(k)]),
      );
    expect(themes.restaurant.light.metrics).toEqual(densityFromSource('compact'));
    expect(themes.admin.light.metrics).toEqual(densityFromSource('comfortable'));
  });

  it('tokens.css carries every colour in the source', () => {
    const css = readFileSync(join(PKG, 'src', 'tokens', 'tokens.css'), 'utf8');
    const missing: string[] = [];
    for (const path of flat.keys()) {
      if (!path.startsWith('color.')) continue;
      const hex = source(path);
      if (typeof hex !== 'string') continue;
      if (!css.includes(hex)) missing.push(`${path} (${hex})`);
    }
    expect(missing).toEqual([]);
  });

  it('regenerating produces no diff (the tree on disk is not hand-edited)', () => {
    expect(() =>
      execFileSync('node', [join(PKG, 'scripts', 'generate-tokens.mjs'), '--check'], {
        cwd: PKG,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('no primitive contains a hand-written colour literal (lint L-1)', () => {
    const offenders: string[] = [];
    const visit = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const full = join(path, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') visit(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        for (const match of readFileSync(full, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
          offenders.push(`${entry.name}: ${match[0]}`);
        }
      }
    };
    visit(join(PKG, 'src', 'primitives'));
    expect(offenders).toEqual([]);
  });
});
