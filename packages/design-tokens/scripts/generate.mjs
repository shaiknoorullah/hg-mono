#!/usr/bin/env node
/**
 * Token generator for @hg/design-tokens.
 *
 * Single source of truth: tokens/tokens.json (W3C DTCG draft format).
 * Nothing downstream may hand-copy a hex, a px value or a cubic-bezier —
 * every consumer (Tailwind preset, NativeWind preset, CSS vars, typed TS)
 * is written mechanically from this one file.
 *
 * Emits, into src/generated/:
 *   tokens.css              CSS custom properties (:root light + dark-scheme + [data-theme])
 *   theme.css               Tailwind v4 `@theme inline` block (for apps on Tailwind v4)
 *   tailwind.preset.cjs     Tailwind v3 preset (for NativeWind, which is pinned to v3)
 *   tokens.ts               typed TS constants (raw values, both themes)
 *
 * Usage:
 *   node scripts/generate.mjs           write
 *   node scripts/generate.mjs --check   fail (exit 1) if the tree is stale
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const SOURCE = join(PKG, 'tokens', 'tokens.json');
const OUT = join(PKG, 'src', 'generated');

const CHECK = process.argv.includes('--check');

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));

// ---------------------------------------------------------------------------
// 1. Flatten + resolve {a.b.c} references (DTCG alias syntax)
// ---------------------------------------------------------------------------

const flat = new Map();

function isLeaf(node) {
  return node && typeof node === 'object' && ('$value' in node || 'light' in node);
}

function walk(node, path) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  if (isLeaf(node)) {
    flat.set(path.join('.'), node);
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    walk(child, [...path, key]);
  }
}
walk(raw, []);

const REF = /^\{([^}]+)\}$/;

function resolveValue(value, mode, seen = new Set()) {
  if (typeof value === 'string') {
    const m = REF.exec(value.trim());
    if (!m) return value;
    const key = m[1];
    if (seen.has(key)) throw new Error(`Circular token reference at {${key}}`);
    if (!flat.has(key)) throw new Error(`Unknown token reference {${key}}`);
    return resolveValue(pick(flat.get(key), mode), mode, new Set([...seen, key]));
  }
  return value;
}

/** A leaf is either `{ $value }` (theme-invariant) or `{ light: {$value}, dark: {$value} }`. */
function pick(leaf, mode) {
  if ('$value' in leaf) return leaf.$value;
  const themed = leaf[mode] ?? leaf.light;
  return themed.$value;
}

function resolved(path, mode) {
  if (!flat.has(path)) throw new Error(`Unknown token path "${path}"`);
  return resolveValue(pick(flat.get(path), mode), mode);
}

const allPaths = [...flat.keys()];

// ---------------------------------------------------------------------------
// 2. Group tokens by top-level family for the emitters below
// ---------------------------------------------------------------------------

const colorPrimitivePaths = allPaths.filter((p) => p.startsWith('color.primitive.'));
const colorSemanticPaths = allPaths.filter((p) => p.startsWith('color.semantic.'));
const radiusPaths = allPaths.filter((p) => p.startsWith('radius.'));
const fontSizePaths = allPaths.filter((p) => p.startsWith('typography.fontSize.'));
const fontWeightPaths = allPaths.filter((p) => p.startsWith('typography.fontWeight.'));
const letterSpacingPaths = allPaths.filter((p) => p.startsWith('typography.letterSpacing.'));
const durationPaths = allPaths.filter((p) => p.startsWith('motion.duration.'));
const easingPaths = allPaths.filter((p) => p.startsWith('motion.easing.'));
const iconSizePaths = allPaths.filter((p) => p.startsWith('icon.size.'));

const cssVarName = (path) =>
  '--hg-' +
  path
    .replace(/^color\.primitive\./, 'color-')
    .replace(/^color\.semantic\./, 'color-')
    .replace(/^radius\./, 'radius-')
    .replace(/^typography\.fontSize\./, 'text-')
    .replace(/^typography\.letterSpacing\./, 'tracking-')
    .replace(/^icon\.size\./, 'icon-')
    .replace(/\./g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

const camelLeaf = (path) => path.split('.').pop();

// ---------------------------------------------------------------------------
// 3. tokens.css — CSS custom properties, light + dark
// ---------------------------------------------------------------------------

function cssBlock(paths, mode) {
  return paths
    .map((p) => `  ${cssVarName(p)}: ${JSON.stringify(resolved(p, mode)).replace(/^"|"$/g, '')};`)
    .join('\n');
}

const fontFamilySans = resolveValue(flat.get('typography.fontFamily.sans').$value, 'light');
const easingCss = (path) => `cubic-bezier(${resolved(path, 'light').join(', ')})`;

const tokensCss = `/* GENERATED — do not hand-edit. Run \`node scripts/generate.mjs\` in @hg/design-tokens. */
:root {
  --hg-font-sans: ${fontFamilySans.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ')};

${cssBlock(colorPrimitivePaths, 'light')}

${cssBlock(radiusPaths, 'light')}

${fontSizePaths.map((p) => `  ${cssVarName(p)}: ${resolved(p, 'light')};`).join('\n')}

${fontWeightPaths.map((p) => `  --hg-weight-${camelLeaf(p)}: ${resolved(p, 'light')};`).join('\n')}

${letterSpacingPaths.map((p) => `  ${cssVarName(p)}: ${resolved(p, 'light')};`).join('\n')}

${durationPaths.map((p) => `  --hg-duration-${camelLeaf(p)}: ${resolved(p, 'light')}ms;`).join('\n')}

${easingPaths.map((p) => `  --hg-easing-${camelLeaf(p)}: ${easingCss(p)};`).join('\n')}

${iconSizePaths.map((p) => `  ${cssVarName(p)}: ${resolved(p, 'light')};`).join('\n')}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${cssBlock(colorPrimitivePaths, 'dark')}
  }
}

:root[data-theme="dark"] {
${cssBlock(colorPrimitivePaths, 'dark')}
}
`;

// ---------------------------------------------------------------------------
// 4. theme.css — Tailwind v4 `@theme inline` (maps CSS vars to utility names)
// ---------------------------------------------------------------------------

const themeCss = `/* GENERATED — do not hand-edit. Run \`node scripts/generate.mjs\` in @hg/design-tokens. */
@theme inline {
  --font-sans: var(--hg-font-sans);

${colorPrimitivePaths.map((p) => `  --color-hg-${camelLeaf(p).toLowerCase()}: var(${cssVarName(p)});`).join('\n')}

  --radius-hg-md: var(--hg-radius-md);
  --radius-hg-sm: var(--hg-radius-sm);
  --radius-hg-pill: var(--hg-radius-pill);

${fontSizePaths.map((p) => `  --text-hg-${camelLeaf(p)}: var(${cssVarName(p)});`).join('\n')}

${durationPaths.map((p) => `  --duration-hg-${camelLeaf(p)}: var(--hg-duration-${camelLeaf(p)});`).join('\n')}

${easingPaths.map((p) => `  --ease-hg-${camelLeaf(p)}: var(--hg-easing-${camelLeaf(p)});`).join('\n')}
}
`;

// ---------------------------------------------------------------------------
// 5. tailwind.preset.cjs — Tailwind v3 preset consumed by NativeWind (pinned v3)
// ---------------------------------------------------------------------------

const colorsObjLines = colorPrimitivePaths
  .map((p) => `      '${camelLeaf(p)}': { DEFAULT: 'var(${cssVarName(p)})' },`)
  .join('\n');

const preset = `// GENERATED — do not hand-edit. Run \`node scripts/generate.mjs\` in @hg/design-tokens.
// Tailwind v3 preset — consumed directly by NativeWind (pinned to Tailwind v3) and by
// any web app still on Tailwind v3. Apps on Tailwind v4 should import theme.css instead.
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        sans: [${fontFamilySans.map((f) => `'${f}'`).join(', ')}],
      },
      colors: {
${colorsObjLines}
      },
      borderRadius: {
        hg: 'var(--hg-radius-md)',
        'hg-sm': 'var(--hg-radius-sm)',
        'hg-pill': 'var(--hg-radius-pill)',
      },
      fontSize: {
${fontSizePaths.map((p) => `        '${camelLeaf(p)}': 'var(${cssVarName(p)})',`).join('\n')}
      },
      transitionDuration: {
${durationPaths.map((p) => `        '${camelLeaf(p)}': '${resolved(p, 'light')}ms',`).join('\n')}
      },
      transitionTimingFunction: {
${easingPaths.map((p) => `        '${camelLeaf(p)}': '${easingCss(p)}',`).join('\n')}
      },
    },
  },
};
`;

// ---------------------------------------------------------------------------
// 6. tokens.ts — typed TS constants (both themes, raw values)
// ---------------------------------------------------------------------------

const isValidIdent = (name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
const tsKey = (name) => (isValidIdent(name) ? name : JSON.stringify(name));

function tsObject(paths, mode) {
  return paths.map((p) => `  ${tsKey(camelLeaf(p))}: ${JSON.stringify(resolved(p, mode))},`).join('\n');
}

const tokensTs = `// GENERATED — do not hand-edit. Run \`node scripts/generate.mjs\` in @hg/design-tokens.

export const fontFamily = {
  sans: ${JSON.stringify(fontFamilySans)},
} as const;

export const colorLight = {
${tsObject(colorPrimitivePaths, 'light')}
} as const;

export const colorDark = {
${tsObject(colorPrimitivePaths, 'dark')}
} as const;

export const radius = {
${tsObject(radiusPaths, 'light')}
} as const;

export const fontSize = {
${tsObject(fontSizePaths, 'light')}
} as const;

export const fontWeight = {
${tsObject(fontWeightPaths, 'light')}
} as const;

export const letterSpacing = {
${tsObject(letterSpacingPaths, 'light')}
} as const;

export const iconSize = {
${tsObject(iconSizePaths, 'light')}
} as const;

export const duration = {
${tsObject(durationPaths, 'light')}
} as const;

export const easing = {
${easingPaths.map((p) => `  ${tsKey(camelLeaf(p))}: ${JSON.stringify(resolved(p, 'light'))} as [number, number, number, number],`).join('\n')}
} as const;

export type ColorToken = keyof typeof colorLight;
export type RadiusToken = keyof typeof radius;
export type DurationToken = keyof typeof duration;
export type EasingToken = keyof typeof easing;
`;

// ---------------------------------------------------------------------------
// 7. write / check
// ---------------------------------------------------------------------------

const files = {
  'tokens.css': tokensCss,
  'theme.css': themeCss,
  'tailwind.preset.cjs': preset,
  'tokens.ts': tokensTs,
};

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let stale = false;
for (const [name, content] of Object.entries(files)) {
  const path = join(OUT, name);
  if (CHECK) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current !== content) {
      console.error(`stale: src/generated/${name}`);
      stale = true;
    }
  } else {
    writeFileSync(path, content);
    console.log(`wrote src/generated/${name}`);
  }
}

if (CHECK && stale) {
  console.error('\nsrc/generated/ is stale — run `node scripts/generate.mjs`.');
  process.exit(1);
}
