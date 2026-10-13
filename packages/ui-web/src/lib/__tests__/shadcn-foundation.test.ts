import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { HALAL_HEXES, isReservedGreenSolid, lintSource } from '../../lint/l4-no-green-solids.js';
import { color } from '../../tokens/tokens.js';
import { cn } from '../utils.js';

/**
 * The shadcn foundation's two promises.
 *
 * 1. cn() merges OUR class names correctly. tailwind-merge reads an unknown
 *    `text-*` as a colour, so without the extended config a type style and a
 *    text colour cancel each other out.
 * 2. shadcn-aliases.css is aliases only, and none of them can put a halal or
 *    success solid on screen, or point shadcn's `--accent` (a hover wash) at
 *    our forest accent ramp. Checked by resolving every alias through the
 *    generated tokens.css in both colour schemes.
 */

describe('cn()', () => {
  it('keeps a type style and a text colour together', () => {
    expect(cn('text-body-md', 'text-fg-primary')).toBe('text-body-md text-fg-primary');
    expect(cn('text-label-lg text-fg-secondary', 'text-heading-sm')).toBe(
      'text-fg-secondary text-heading-sm',
    );
  });

  it('lets the later class of the same kind win', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-body-md', 'text-label-sm')).toBe('text-label-sm');
    expect(cn('text-fg-primary', 'text-fg-secondary')).toBe('text-fg-secondary');
    expect(cn('shadow-e1', 'shadow-e3')).toBe('shadow-e3');
    expect(cn('bg-primary', false && 'bg-secondary', 'bg-muted')).toBe('bg-muted');
  });
});

// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '..', '..', 'tokens');
const ALIASES_FILE = join(TOKENS, 'shadcn-aliases.css');
const aliasesCss = readFileSync(ALIASES_FILE, 'utf8');
const tokensCss = readFileSync(join(TOKENS, 'tokens.css'), 'utf8');

/** Declarations of every innermost block whose selector is exactly `selector`. */
function declarations(css: string, selector: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (block[1]?.trim() !== selector) continue;
    for (const decl of (block[2] ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out.set(decl[1] as string, (decl[2] as string).trim());
    }
  }
  return out;
}

const light = declarations(tokensCss, ':root');
const dark = new Map([...light, ...declarations(tokensCss, ':root[data-theme="dark"]')]);

/** The shadcn aliases, from the block that starts with `:root,`. */
const aliases = (() => {
  const block = /:root,[^{]*\{([^}]*)\}/.exec(aliasesCss)?.[1] ?? '';
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => ({
    name: m[1] as string,
    value: (m[2] as string).trim(),
  }));
})();

function resolve(scheme: Map<string, string>, value: string): string {
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (!ref) return value;
  const next = scheme.get(ref[1] as string);
  if (next === undefined) throw new Error(`${ref[1]} is not declared in tokens.css`);
  return resolve(scheme, next);
}

const hexes = (tree: unknown, into = new Set<string>()): Set<string> => {
  if (typeof tree === 'string' && tree.startsWith('#')) into.add(tree.toUpperCase());
  else if (tree && typeof tree === 'object') for (const v of Object.values(tree)) hexes(v, into);
  return into;
};
const ACCENT_RAMP = hexes(color.accent);
/** Colours only color.halal.* uses (it also borrows neutrals such as white, which are not a claim). */
const HALAL_ONLY = (() => {
  const elsewhere = hexes(Object.entries(color).filter(([group]) => group !== 'halal'));
  return new Set([...HALAL_HEXES].filter((hex) => !elsewhere.has(hex)));
})();
const SUCCESS_RAMP = hexes(color.success);

describe('shadcn-aliases.css', () => {
  it('declares the shadcn names, each an alias of a declared role and never a value', () => {
    const names = aliases.map((a) => a.name);
    for (const required of ['--background', '--primary', '--accent', '--muted-foreground', '--ring', '--radius']) {
      expect(names).toContain(required);
    }
    for (const { name, value } of aliases) {
      expect(value, name).toMatch(/^var\(--hg-[a-z0-9-]+\)$/);
      expect(() => resolve(light, value), name).not.toThrow();
    }
  });

  it('maps --accent to the selected wash, never to the accent ramp', () => {
    const accent = aliases.find((a) => a.name === '--accent');
    expect(accent?.value).toBe('var(--hg-state-selected-tint)');
    for (const scheme of [light, dark]) {
      expect(ACCENT_RAMP.has(resolve(scheme, accent!.value).toUpperCase())).toBe(false);
    }
    expect(aliases.filter((a) => a.value.startsWith('var(--hg-color-accent'))).toEqual([]);
  });

  it('maps --muted-foreground to text-secondary, not text-tertiary', () => {
    expect(aliases.find((a) => a.name === '--muted-foreground')?.value).toBe(
      'var(--hg-text-secondary)',
    );
  });

  it('never resolves an alias to a halal colour or a success solid, in either scheme', () => {
    for (const [schemeName, scheme] of [['light', light], ['dark', dark]] as const) {
      for (const { name, value } of aliases) {
        const resolved = resolve(scheme, value).toUpperCase();
        if (!resolved.startsWith('#')) continue;
        const where = `${name} (${schemeName}) → ${resolved}`;
        expect(HALAL_ONLY.has(resolved), where).toBe(false);
        expect(SUCCESS_RAMP.has(resolved) && isReservedGreenSolid(resolved) !== null, where).toBe(false);
        // The only green-band solid an alias may reach is the forest chrome
        // (color.accent.*, a registered L-4 exception), for --secondary and --sidebar.
        if (isReservedGreenSolid(resolved)) expect(ACCENT_RAMP.has(resolved), where).toBe(true);
      }
    }
  });

  it('is clean under lint L-4', () => {
    expect(lintSource(ALIASES_FILE, aliasesCss)).toEqual([]);
  });
});
