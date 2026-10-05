#!/usr/bin/env node
/**
 * Token generator for @hg/ui-web.
 *
 * Single source of truth: docs/design/tokens.json (W3C DTCG draft format).
 * NOTHING in this file, and nothing in src/tokens/**, may contain a hand-copied
 * colour value. Every hex, size, duration and curve below is read out of
 * tokens.json at generate time and written through mechanically.
 *
 * Emits, into src/tokens/:
 *   tokens.ts   typed TS theme object (raw ramps + resolved role maps)
 *   themes.ts   the `restaurant` and `admin` themes, light + dark
 *   tokens.css  CSS custom properties (:root, dark scheme, density, theme)
 *   theme.css   Tailwind v4 `@theme inline` block
 *   grid-theme.css  LyteNyte Grid's `--ln-*` variables pointed at our roles
 *   index.ts    barrel
 *
 * Usage:
 *   node scripts/generate-tokens.mjs          write
 *   node scripts/generate-tokens.mjs --check  fail (exit 1) if the tree is stale
 *
 * Unit conventions (documented so consumers can rely on them):
 *   rem (÷16) : space.*, density.*, typography fontSize
 *   px        : radius.*, icon.*, target.*, breakpoint.*
 *   raw       : zIndex, font weights, opacities
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(PKG, '..', '..');
const SOURCE = join(REPO, 'docs', 'design', 'tokens.json');
const OUT = join(PKG, 'src', 'tokens');

const CHECK = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// 1. Read + flatten DTCG
// ---------------------------------------------------------------------------

const raw = JSON.parse(readFileSync(SOURCE, 'utf8'));

/** path (dot-joined, group keys themselves split on '.') -> raw $value */
const flat = new Map();

function walk(node, path) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;
  if ('$value' in node) {
    flat.set(path.join('.'), node.$value);
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    walk(child, [...path, ...key.split('.')]);
  }
}
walk(raw, []);

const REF = /^\{([^}]+)\}$/;

/** Resolve `{a.b.c}` references, recursively, through objects and arrays. */
function resolve(value, seen = new Set()) {
  if (typeof value === 'string') {
    const m = REF.exec(value.trim());
    if (!m) return value;
    const key = m[1];
    if (seen.has(key)) throw new Error(`Circular token reference at {${key}}`);
    if (!flat.has(key)) throw new Error(`Unknown token reference {${key}}`);
    return resolve(flat.get(key), new Set([...seen, key]));
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, seen));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, seen)]));
  }
  return value;
}

/** Resolved value at a token path. Throws if the path does not exist. */
function tok(path) {
  if (!flat.has(path)) throw new Error(`Missing token: ${path}`);
  return resolve(flat.get(path));
}

/** Every leaf under a group, as { leafKey: resolvedValue }. */
function group(prefix) {
  const out = {};
  for (const key of flat.keys()) {
    if (!key.startsWith(prefix + '.')) continue;
    out[key.slice(prefix.length + 1)] = resolve(flat.get(key));
  }
  return out;
}

/** Nested object of resolved values under a group. */
function nested(prefix) {
  const out = {};
  for (const [leaf, value] of Object.entries(group(prefix))) {
    const parts = leaf.split('.');
    let cursor = out;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
    cursor[parts.at(-1)] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Colour maths (WCAG 2.1 relative luminance + HSL hue)
// ---------------------------------------------------------------------------

function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  const lin = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// 3. Role maps
// ---------------------------------------------------------------------------

const SCHEMES = ['light', 'dark'];

/**
 * Component-level roles. 02-components.md describes primitive fills in terms of
 * ramp *steps* (`color.brand.500`, `color.accent.600`, `color.danger.500`),
 * but lint L-2 forbids a component from naming a step. These entries are the
 * theme layer that is allowed to do the mapping: they are written as token
 * *references* and resolved from tokens.json, never as literals.
 *
 * Note the deliberate absence of `feedback.success.solid` / `.onSolid`:
 * RULE H-1 (the green-solid monopoly) is expressed here as a missing token,
 * so a `success` fill cannot be written even by accident.
 */
function componentRoles(scheme) {
  const t = (p) => `{theme.${scheme}.${p}}`;
  const dark = scheme === 'dark';
  return {
    'action.primary.bg': '{color.brand.500}',
    // Lighter on press, not darker. With the label now dark ink (4.63:1 on
    // brand.500), brand.600 would drop it to 3.63:1 — and white on brand.600 is
    // 4.48:1, so darkening the press has no accessible label at all. brand.400
    // gives 5.58:1. The resting brand orange is unchanged.
    'action.primary.bgPressed': '{color.brand.400}',
    'action.primary.fg': t('text.onBrand'),
    'action.secondary.bg': '{color.accent.600}',
    'action.secondary.bgPressed': '{color.accent.700}',
    'action.secondary.fg': t('text.onAccent'),
    'action.tertiary.border': t('border.interactive'),
    'action.tertiary.fg': t('text.primary'),
    'action.danger.bg': '{color.danger.500}',
    'action.danger.bgPressed': '{color.danger.600}',
    'action.danger.fg': '{color.neutral.0}',

    'control.bg': t('surface.base'),
    'control.border': t('border.interactive'),
    'control.borderHover': t('border.strong'),
    'control.selectedBg': '{color.brand.500}',
    'control.selectedFg': t('text.onBrand'),
    'control.trackOff': t('border.strong'),
    'control.trackOn': '{color.brand.600}',
    'control.thumb': '{color.neutral.0}',

    'feedback.success.tint': dark ? '{color.success.900}' : '{color.success.50}',
    'feedback.success.tintText': dark ? '{color.success.300}' : '{color.success.700}',
    'feedback.success.text': dark ? '{color.success.300}' : '{color.success.600}',
    'feedback.success.icon': dark ? '{color.success.300}' : '{color.success.500}',
    'feedback.success.border': dark ? '{color.success.300}' : '{color.success.600}',

    'feedback.warning.tint': dark ? '{color.warning.900}' : '{color.warning.50}',
    'feedback.warning.tintText': dark ? '{color.warning.300}' : '{color.warning.700}',
    'feedback.warning.text': dark ? '{color.warning.300}' : '{color.warning.600}',
    'feedback.warning.icon': dark ? '{color.warning.300}' : '{color.warning.600}',
    'feedback.warning.border': dark ? '{color.warning.300}' : '{color.warning.600}',
    'feedback.warning.solid': '{color.warning.600}',
    'feedback.warning.onSolid': '{color.neutral.0}',

    'feedback.danger.tint': dark ? '{color.danger.900}' : '{color.danger.50}',
    'feedback.danger.tintText': dark ? '{color.danger.300}' : '{color.danger.700}',
    'feedback.danger.text': dark ? '{color.danger.300}' : '{color.danger.600}',
    'feedback.danger.icon': dark ? '{color.danger.300}' : '{color.danger.500}',
    'feedback.danger.border': '{color.danger.500}',
    'feedback.danger.solid': '{color.danger.500}',
    'feedback.danger.onSolid': '{color.neutral.0}',

    'feedback.info.tint': dark ? '{color.info.900}' : '{color.info.50}',
    'feedback.info.tintText': dark ? '{color.info.300}' : '{color.info.700}',
    'feedback.info.text': dark ? '{color.info.300}' : '{color.info.600}',
    'feedback.info.icon': dark ? '{color.info.300}' : '{color.info.500}',
    'feedback.info.border': '{color.info.500}',
    'feedback.info.solid': '{color.info.500}',
    'feedback.info.onSolid': '{color.neutral.0}',

    'skeleton.base': dark ? '{color.neutral.800}' : '{color.neutral.300}',
    'skeleton.highlight': dark ? '{color.neutral.700}' : '{color.neutral.200}',
  };
}

/**
 * The two-layer focus ring (01-foundations.md §4.1 / 04-accessibility.md §4.1).
 * A single-layer `info.500` ring measures 2.84:1 on brand yellow, 2.33:1 on the
 * halal seal, 1.05:1 on danger and 2.24:1 on accent — all below the 3:1 that
 * WCAG 1.4.11 requires of a focus indicator. So the ring is 2px offset in the
 * container's own colour + 3px ring in focus.ring, and the ring flips to
 * focus.onColor on any container where it measures < 3:1.
 *
 * Which containers flip is COMPUTED here, not asserted.
 */
const RING_CONTAINERS = {
  brand: 'color.brand.500',
  accent: 'color.accent.600',
  danger: 'color.danger.500',
  warning: 'color.warning.600',
  info: 'color.info.500',
  halal: 'color.halal.certified.seal',
  inverse: 'color.neutral.900',
};

function focusRoles(scheme) {
  const ring = tok(`theme.${scheme}.focus.ring`);
  const onColor = tok(`theme.${scheme}.focus.onColor`);
  const out = {};
  const report = {};
  for (const [name, path] of Object.entries(RING_CONTAINERS)) {
    const container = tok(path);
    const ratio = contrast(ring, container);
    const flipped = ratio < 3;
    out[name] = flipped ? onColor : ring;
    report[name] = { container, ratio: Math.round(ratio * 100) / 100, flipped };
  }
  return { out, report };
}

// ---------------------------------------------------------------------------
// 4. Themes
// ---------------------------------------------------------------------------

/**
 * 01-foundations.md §10 defines three themes: consumer, operational, field.
 * Restaurant web and admin web both run the `operational` role map (Midnight
 * chrome, brand yellow restricted to primary CTAs, status colours carrying more
 * of the load). They differ only in density: the restaurant queue is a kitchen
 * tablet read at arm's length and runs `compact`; admin runs `comfortable` at
 * the page level and drops to `compact` inside DataTable regions via
 * [data-hg-density="compact"].
 */
const THEMES = {
  restaurant: { density: 'compact', register: 'operational' },
  admin: { density: 'comfortable', register: 'operational' },
};

// ---------------------------------------------------------------------------
// 5. Formatting helpers
// ---------------------------------------------------------------------------

const rem = (px) => (px === 0 ? '0' : `${+(px / 16).toFixed(6)}rem`);
const px = (v) => (v === 0 ? '0' : `${v}px`);
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase();
const fontStack = (families) =>
  families.map((f) => (/[\s]/.test(f) ? `"${f}"` : f)).join(', ');
const bezier = (c) => `cubic-bezier(${c.join(', ')})`;

const BANNER = (from) =>
  `/* GENERATED FILE — DO NOT EDIT.\n * Source: ${from}\n * Regenerate: pnpm --filter @hg/ui-web generate:tokens\n */\n`;

const SOURCE_REL = relative(REPO, SOURCE).split('\\').join('/');

// ---------------------------------------------------------------------------
// 6. Build the value tree
// ---------------------------------------------------------------------------

const color = nested('color');
const font = nested('font');
const typography = nested('typography');
const space = group('space');
const density = nested('density');
const radius = group('radius');
const elevation = nested('elevation');
const motion = nested('motion');
const icon = group('icon');
const target = group('target');
const zIndex = group('zIndex');
const breakpoint = group('breakpoint');

const roles = {};
const ringReports = {};
for (const scheme of SCHEMES) {
  const base = nested(`theme.${scheme}`);
  const extra = {};
  for (const [path, ref] of Object.entries(componentRoles(scheme))) {
    const parts = path.split('.');
    let cursor = extra;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
    cursor[parts.at(-1)] = resolve(ref);
  }
  const { out: ring, report } = focusRoles(scheme);
  ringReports[scheme] = report;
  roles[scheme] = { ...base, ...extra, focus: { ...base.focus, ringOn: ring } };
}

// ---------------------------------------------------------------------------
// 7. Emit — tokens.ts
// ---------------------------------------------------------------------------

const j = (v) => JSON.stringify(v, null, 2);

const tokensTs = `${BANNER(SOURCE_REL)}
/**
 * Raw palette ramps and scales, resolved from ${SOURCE_REL}.
 *
 * Components must NOT read the numbered ramp steps (lint L-2) — read a role
 * from \`themes\` / \`roles\` instead, or a CSS custom property from tokens.css.
 * The ramps are exported because the theme layer, the token-drift test and the
 * L-4 lint rule all need them.
 */

export const color = ${j(color)} as const;

export const font = ${j(font)} as const;

export const typography = ${j(typography)} as const;

export const space = ${j(space)} as const;

export const density = ${j(density)} as const;

export const radius = ${j(radius)} as const;

export const elevation = ${j(elevation)} as const;

export const motion = ${j(motion)} as const;

export const icon = ${j(icon)} as const;

export const target = ${j(target)} as const;

export const zIndex = ${j(zIndex)} as const;

export const breakpoint = ${j(breakpoint)} as const;

/**
 * Role maps, one per colour scheme. \`focus.ringOn\` records which container
 * colours force the ring to flip to \`focus.onColor\`; the flip set is computed
 * from measured contrast at generate time, not asserted by hand:
 *
${Object.entries(ringReports)
  .map(
    ([scheme, report]) =>
      ` *   ${scheme}: ` +
      Object.entries(report)
        .map(([k, v]) => `${k} ${v.ratio}:1${v.flipped ? ' → flipped' : ''}`)
        .join(', '),
  )
  .join('\n')}
 */
export const roles = ${j(roles)} as const;

export const tokens = {
  color,
  font,
  typography,
  space,
  density,
  radius,
  elevation,
  motion,
  icon,
  target,
  zIndex,
  breakpoint,
  roles,
} as const;

export type Tokens = typeof tokens;
export type ColorScheme = keyof typeof roles;
export type SurfaceRole = keyof typeof roles.light.surface;
export type TextRole = keyof typeof roles.light.text;
export type BorderRole = keyof typeof roles.light.border;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;
export type TypographyToken = keyof typeof typography;
export type DensityMode = keyof typeof density;
`;

// ---------------------------------------------------------------------------
// 8. Emit — themes.ts
// ---------------------------------------------------------------------------

const themeObjects = {};
for (const [name, cfg] of Object.entries(THEMES)) {
  themeObjects[name] = {};
  for (const scheme of SCHEMES) {
    themeObjects[name][scheme] = {
      name,
      scheme,
      register: cfg.register,
      density: cfg.density,
      metrics: density[cfg.density],
      color: roles[scheme],
      typography,
      space,
      radius,
      elevation: elevation,
      motion,
      icon,
      target,
      zIndex,
      breakpoint,
    };
  }
}

const themesTs = `${BANNER(SOURCE_REL)}
import type { ColorScheme } from './tokens.js';

/**
 * The two web themes. Both run the \`operational\` register of
 * 01-foundations.md §10 (Midnight chrome, brand yellow restricted to primary
 * CTAs, status colour carrying more of the visual load). They differ only in
 * density: \`restaurant\` is a kitchen tablet read at arm's length and runs
 * \`compact\`; \`admin\` runs \`comfortable\` and drops to \`compact\` inside table
 * regions via [data-hg-density="compact"].
 *
 * A surface never defines a colour. It selects a theme and, at most, overrides
 * density.
 */
export const themes = ${j(themeObjects)} as const;

export type ThemeName = keyof typeof themes;
export type Theme = (typeof themes)[ThemeName][ColorScheme];

export const restaurant = themes.restaurant;
export const admin = themes.admin;

export function getTheme(name: ThemeName, scheme: ColorScheme): Theme {
  return themes[name][scheme];
}

/** Attributes to spread on the document root (or any subtree) for a theme. */
export function themeAttributes(
  name: ThemeName,
  scheme?: ColorScheme,
): Record<string, string> {
  const attrs: Record<string, string> = {
    'data-hg-theme': name,
    'data-hg-density': themes[name].light.density,
  };
  if (scheme) attrs['data-theme'] = scheme;
  return attrs;
}
`;

// ---------------------------------------------------------------------------
// 9. Emit — tokens.css
// ---------------------------------------------------------------------------

const lines = [];
const push = (s = '') => lines.push(s);

function colourVars(prefix, tree, out) {
  for (const [key, value] of Object.entries(tree)) {
    const name = `${prefix}-${kebab(key)}`;
    if (value && typeof value === 'object' && !Array.isArray(value)) colourVars(name, value, out);
    else out.push(`  ${name}: ${value};`);
  }
}

push(BANNER(SOURCE_REL));
push('/* Primitive ramps. Do not consume these directly from a component (lint L-2). */');
push(':root {');
{
  const out = [];
  colourVars('--hg-color', color, out);
  push(out.join('\n'));
}
push('');
push('  /* Type */');
// Every declared family gets a var — hardcoding three meant a new family (display)
// silently produced var(--hg-font-display) with nothing behind it.
for (const [k, stack] of Object.entries(font.family)) push(`  --hg-font-${kebab(k)}: ${fontStack(stack)};`);
for (const [k, v] of Object.entries(font.weight)) push(`  --hg-weight-${kebab(k)}: ${v};`);
push(`  --hg-numeric-tabular: ${font.numeric.tabular};`);
for (const [name, t] of Object.entries(flattenTypography(typography))) {
  push(`  --hg-text-${name}-size: ${rem(t.fontSize)};`);
  push(`  --hg-text-${name}-line: ${t.lineHeight};`);
  push(`  --hg-text-${name}-line-px: ${px(t.lineHeightPx)};`);
  push(`  --hg-text-${name}-weight: ${t.fontWeight};`);
  push(`  --hg-text-${name}-tracking: ${t.letterSpacing};`);
  // Resolve by identity against every declared family. A silent fallback to --hg-font-ui
  // is exactly the bug 01-foundations.md warns about, so an unknown family fails the build.
  const sameStack = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const familyVar = Object.entries(font.family).find(([, stack]) => sameStack(stack, t.fontFamily))?.[0];
  if (!familyVar) {
    throw new Error(
      `typography.${name}.fontFamily does not match any font.family.* entry — ` +
        `add the family or fix the reference. Got: ${JSON.stringify(t.fontFamily)}`,
    );
  }
  push(`  --hg-text-${name}-family: var(--hg-font-${kebab(familyVar)});`);
}
push('');
push('  /* Space, radius, sizing */');
for (const [k, v] of Object.entries(space)) push(`  --hg-space-${k}: ${rem(v)};`);
for (const [k, v] of Object.entries(radius)) push(`  --hg-radius-${kebab(k)}: ${px(v)};`);
for (const [k, v] of Object.entries(icon)) push(`  --hg-icon-${kebab(k)}: ${px(v)};`);
for (const [k, v] of Object.entries(target)) push(`  --hg-target-${kebab(k)}: ${px(v)};`);
for (const [k, v] of Object.entries(breakpoint)) push(`  --hg-breakpoint-${kebab(k)}: ${px(v)};`);
for (const [k, v] of Object.entries(zIndex)) push(`  --hg-z-${kebab(k)}: ${v};`);
push('');
push('  /* Motion */');
for (const [k, v] of Object.entries(motion.duration)) push(`  --hg-duration-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(motion.easing)) push(`  --hg-ease-${kebab(k)}: ${bezier(v)};`);
push('');
push('  /* Elevation (light: shadows) */');
for (const [k, v] of Object.entries(elevation)) push(`  --hg-elevation-${kebab(k)}: ${v.web};`);
push('}');
push('');

function flattenTypography(tree, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(tree)) {
    const name = prefix ? `${prefix}-${kebab(key)}` : kebab(key);
    if (value && typeof value === 'object' && 'fontSize' in value) out[name] = value;
    else if (value && typeof value === 'object') flattenTypography(value, name, out);
  }
  return out;
}

function roleVars(scheme, indent = '  ') {
  const out = [];
  const r = roles[scheme];
  const emit = (prefix, tree) => {
    for (const [key, value] of Object.entries(tree)) {
      const name = `${prefix}-${kebab(key)}`;
      if (value && typeof value === 'object') emit(name, value);
      else out.push(`${indent}${name}: ${value};`);
    }
  };
  emit('--hg-surface', r.surface);
  emit('--hg-text', r.text);
  emit('--hg-border', r.border);
  emit('--hg-focus', r.focus);
  emit('--hg-state', r.state);
  emit('--hg-action', r.action);
  emit('--hg-control', r.control);
  emit('--hg-feedback', r.feedback);
  emit('--hg-skeleton', r.skeleton);
  // Default the two focus-ring layers so `.hg-focus` works with no override.
  out.push(`${indent}--hg-focus-ring-color: var(--hg-focus-ring);`);
  out.push(`${indent}--hg-focus-ring-offset: var(--hg-focus-offset);`);
  return out.join('\n');
}

push('/* Light role map — the default. */');
push(':root {');
push(roleVars('light'));
push('}');
push('');
push('/* Dark role map. Explicit [data-theme] wins in both directions; the bare');
push('   media query only decides the "system" case. */');
push('@media (prefers-color-scheme: dark) {');
push('  :root:not([data-theme="light"]) {');
push(roleVars('dark', '    '));
push('  }');
push('  :root:not([data-theme="light"]) {');
for (const k of Object.keys(elevation)) push(`    --hg-elevation-${kebab(k)}: none;`);
push('  }');
push('}');
push('');
push(':root[data-theme="dark"] {');
push(roleVars('dark'));
push('}');
push(':root[data-theme="dark"] {');
push('  /* 01-foundations.md §6: dark mode does not use shadows for hierarchy.');
push('     Elevation resolves to a surface step plus a hairline instead. */');
for (const k of Object.keys(elevation)) push(`  --hg-elevation-${kebab(k)}: none;`);
push('}');
push('');
push('/* Density. Set by the theme, overridable on any subtree. */');
for (const [mode, metrics] of Object.entries(density)) {
  push(`[data-hg-density="${mode}"] {`);
  for (const [k, v] of Object.entries(metrics)) push(`  --hg-density-${kebab(k)}: ${rem(v)};`);
  push('}');
}
push('');
push('/* Themes. Both web surfaces run the operational register; they differ in density. */');
for (const [name, cfg] of Object.entries(THEMES)) {
  push(`[data-hg-theme="${name}"] {`);
  for (const [k, v] of Object.entries(density[cfg.density]))
    push(`  --hg-density-${kebab(k)}: ${rem(v)};`);
  push('}');
}
push('');
push(':root {');
for (const [k, v] of Object.entries(density[THEMES.restaurant.density]))
  push(`  --hg-density-${kebab(k)}: ${rem(v)};`);
push('}');

const tokensCss = lines.join('\n') + '\n';

// ---------------------------------------------------------------------------
// 10. Emit — theme.css (Tailwind v4)
// ---------------------------------------------------------------------------

const t = [];
t.push(BANNER(SOURCE_REL));
t.push('/* Tailwind v4 theme. `inline` because every value forwards to a custom');
t.push('   property that flips between light and dark — without `inline` the');
t.push('   utilities would freeze the light value at build time. */');
t.push('@theme inline {');
t.push('  /* Spacing: one 4px base unit; Tailwind derives the whole scale from it,');
t.push('     which reproduces space.1..space.24 exactly (all multiples of 4). */');
t.push('  --spacing: var(--hg-space-1);');
t.push('');
// Loop, don't list. tokens.css already derives its --hg-font-* block from
// font.family; hardcoding the three known families HERE is what left
// --font-display declared in tokens.css but absent from the Tailwind theme,
// so the `font-display` utility silently did not exist.
for (const k of Object.keys(font.family)) t.push(`  --font-${kebab(k)}: var(--hg-font-${kebab(k)});`);
t.push('');
for (const [name] of Object.entries(flattenTypography(typography))) {
  t.push(`  --text-${name}: var(--hg-text-${name}-size);`);
  t.push(`  --text-${name}--line-height: var(--hg-text-${name}-line);`);
  t.push(`  --text-${name}--font-weight: var(--hg-text-${name}-weight);`);
  t.push(`  --text-${name}--letter-spacing: var(--hg-text-${name}-tracking);`);
}
t.push('');
for (const k of Object.keys(radius)) t.push(`  --radius-${kebab(k)}: var(--hg-radius-${kebab(k)});`);
t.push('');
for (const k of Object.keys(elevation))
  t.push(`  --shadow-e${kebab(k)}: var(--hg-elevation-${kebab(k)});`);
t.push('');
for (const k of Object.keys(motion.duration))
  t.push(`  --animate-duration-${kebab(k)}: var(--hg-duration-${kebab(k)});`);
for (const k of Object.keys(motion.easing)) t.push(`  --ease-${kebab(k)}: var(--hg-ease-${kebab(k)});`);
t.push('');
// Breakpoints must be LITERAL: Tailwind v4 resolves --breakpoint-* at build
// time to generate `@media (min-width: …)`. A `var()` here is emitted verbatim
// into the media condition (`@media (width >= var(--hg-breakpoint-md))`), which
// is illegal CSS, so every responsive variant silently dies. Breakpoints don't
// theme-flip, so a literal is correct. (--hg-breakpoint-* stays for runtime JS.)
for (const [k, v] of Object.entries(breakpoint))
  t.push(`  --breakpoint-${kebab(k)}: ${px(v)};`);
t.push('');
/** `--color-<twPath>: var(--hg-<hgPrefix>-<path>)` for every leaf of `tree`. */
function forwardColors(twPrefix, hgPrefix, tree, out = []) {
  for (const [key, value] of Object.entries(tree)) {
    const tw = twPrefix ? `${twPrefix}-${kebab(key)}` : kebab(key);
    const hg = `${hgPrefix}-${kebab(key)}`;
    if (value && typeof value === 'object' && !Array.isArray(value))
      forwardColors(tw, hg, value, out);
    else out.push(`  --color-${tw}: var(--hg-${hg});`);
  }
  return out;
}

t.push('  /* Ramps. Exposed so the theme layer and the certification tier can reach');
t.push('     them; components use the role names below instead (lint L-2). */');
t.push(forwardColors('', 'color', color).join('\n'));
t.push('');
t.push('  /* Roles — what components are allowed to name. */');
t.push(forwardColors('surface', 'surface', roles.light.surface).join('\n'));
t.push(forwardColors('fg', 'text', roles.light.text).join('\n'));
t.push(forwardColors('line', 'border', roles.light.border).join('\n'));
t.push(forwardColors('action', 'action', roles.light.action).join('\n'));
t.push(forwardColors('control', 'control', roles.light.control).join('\n'));
t.push(forwardColors('feedback', 'feedback', roles.light.feedback).join('\n'));
t.push(forwardColors('skeleton', 'skeleton', roles.light.skeleton).join('\n'));
t.push('  --color-focus-ring: var(--hg-focus-ring);');
t.push('  --color-transparent: transparent;');
t.push('  --color-current: currentColor;');
t.push('}');

const themeCss = t.join('\n') + '\n';

// ---------------------------------------------------------------------------
// 10b. Emit — grid-theme.css (LyteNyte Grid, themed with our roles)
// ---------------------------------------------------------------------------
//
// LyteNyte Core ships its structure (`grid.css`, every rule scoped under
// `.ln-grid` inside `@layer ln-grid`) separately from its themes. Its themes
// (light-dark.css, design.css, …) write ~90 `--ln-*` variables onto :root,
// load Inter, include a solid green and key dark mode on a `.dark` class we
// never set — so we never load them. This file is the theme instead: every
// `--ln-*` variable grid.css reads, pointed at a role, plus the few rules where
// LyteNyte's own choice breaks ours (focus, selection, header type).
//
// It is generated, not hand-kept, so a renamed or removed token fails here at
// generate time instead of leaving the grid silently unstyled — the failure in
// https://github.com/shaiknoorullah/hg-mono/issues/145. Every `var()` below
// goes through `hg()`, which refuses a custom property tokens.css does not
// declare.

const declared = new Set([...tokensCss.matchAll(/^\s*(--hg-[a-z0-9-]+):/gm)].map((m) => m[1]));

function hg(name) {
  if (!declared.has(name)) {
    throw new Error(
      `grid-theme.css: ${name} is not declared in tokens.css. A token was renamed or removed; ` +
        'point the LyteNyte variable at the role that replaced it.',
    );
  }
  return `var(${name})`;
}

/** The focusable parts LyteNyte outlines on :focus (grid.css, last block). */
const LN_FOCUSABLE =
  ":is([data-ln-cell='true'], [data-ln-header-cell='true'], [data-ln-header-group='true'], [data-ln-rowtype='full-width'] > div)";

const gridThemeCss = `${BANNER(SOURCE_REL)}
/*
 * LyteNyte Grid, themed with HalalGoes roles.
 *
 * A grid needs exactly two stylesheets and one class:
 *
 *   import '@1771technologies/lytenyte-core/grid.css'; // structure only
 *   import '@hg/ui-web/grid-theme.css';                 // this file
 *
 *   <div className="ln-grid">  <Grid … />  </div>
 *
 * Every rule in grid.css is scoped under \`.ln-grid\`. Without that class on an
 * ancestor of <Grid>, none of it applies and the grid renders unstyled
 * (https://github.com/shaiknoorullah/hg-mono/issues/145).
 *
 * Do not also load one of LyteNyte's themes (light-dark.css, light.css, dark.css,
 * design.css, …). This file replaces them.
 *
 * Deliberately UNLAYERED. grid.css sits in \`@layer ln-grid\`, and an unlayered
 * rule beats every layer, so these win whichever order the two files load in.
 * Dark mode needs nothing here: every value is a role, and roles flip on :root.
 */

/* The variables grid.css reads. Set on the wrapper, never on :root, so nothing
   leaks into the rest of the page. */
.ln-grid {
  --ln-typeface: ${hg('--hg-font-ui')};
  --ln-font-md: ${hg('--hg-text-body-sm-size')};
  --ln-padding-horizontal-cell: ${hg('--hg-density-card-padding')};
  --ln-bg-ui-panel: ${hg('--hg-surface-base')};
  /* No zebra banding: a second cream reads as a selected row. Rules separate rows. */
  --ln-bg-row-alternate: ${hg('--hg-surface-base')};
  --ln-bg-row-hover: ${hg('--hg-state-hover-overlay')};
  /* LyteNyte's accent. Focus and selection are re-drawn below, so the only thing
     left reading it is the column-resize handle. */
  --ln-primary-50: ${hg('--hg-border-interactive')};
  --ln-text-dark: ${hg('--hg-text-primary')};
  --ln-text: ${hg('--hg-text-secondary')};
  --ln-border: ${hg('--hg-border-decorative')};
  --ln-border-row: ${hg('--hg-border-decorative')};
  --ln-border-strong: ${hg('--hg-border-interactive')};
  --ln-border-xstrong: ${hg('--hg-border-strong')};

  /* The frame, as DataTable draws it. The wrapper owns it (rounded, clipped), so
     the viewport's own square border is dropped below. */
  border: 1px solid ${hg('--hg-border-decorative')};
  border-radius: ${hg('--hg-radius-md')};
  overflow: hidden;
  background-color: ${hg('--hg-surface-base')};
}

.ln-grid [data-ln-viewport='true'] {
  border: 0;
}

/* grid.css turns text selection off for the whole grid. Body cells turn it back on,
   so an order code or a name can still be copied. */
.ln-grid [data-ln-cell='true'] {
  user-select: text;
  -webkit-user-select: text;
}

/* Header: DataTable's header — the subtle surface, label type, secondary text. */
.ln-grid [data-ln-header='true'],
.ln-grid :is([data-ln-header-cell='true'], [data-ln-header-group='true']) {
  background-color: ${hg('--hg-surface-subtle')};
}

.ln-grid :is([data-ln-header-cell='true'], [data-ln-header-group='true']) {
  color: ${hg('--hg-text-secondary')};
  font-size: ${hg('--hg-text-label-md-size')};
  font-weight: ${hg('--hg-text-label-md-weight')};
  letter-spacing: ${hg('--hg-text-label-md-tracking')};
}

/* Selected row: a fill, never a bar. LyteNyte paints selection as a translucent
   overlay in its own blue; the selected tint is opaque, so it goes on the cells
   (under their text) and the overlay is cleared. */
.ln-grid [data-ln-row='true'][data-ln-selected='true']::before {
  background: transparent;
}

.ln-grid [data-ln-row='true'][data-ln-selected='true'] [data-ln-cell='true'] {
  background-color: ${hg('--hg-state-selected-tint')};
}

.ln-grid [data-ln-row='true'][data-ln-selected='true']:hover::before {
  background: ${hg('--hg-state-hover-overlay')};
}

/* Focus (docs/decisions/focus-indicator.md): a cell is a borderless control in a
   clipping container, so it takes the inset two-layer ring — the .hg-focus-inset
   recipe — on :focus-visible only. LyteNyte draws a 1px ring in its own blue on
   every :focus, a mouse click included; that one is removed. */
.ln-grid ${LN_FOCUSABLE}:focus::before {
  border: 0;
}

.ln-grid ${LN_FOCUSABLE}:focus-visible {
  /* Drawn only in forced-colors mode, which strips box-shadow. */
  outline: 2px solid transparent;
  outline-offset: -2px;
}

.ln-grid ${LN_FOCUSABLE}:focus-visible::before {
  box-shadow:
    inset 0 0 0 2px ${hg('--hg-focus-ring-offset')},
    inset 0 0 0 5px ${hg('--hg-focus-ring-color')};
}

/* The viewport is the grid's one Tab stop; arrow keys move between cells from
   there. The cells would cover an inset ring, so the ring goes round the frame. */
.ln-grid [data-ln-viewport='true']:focus-visible {
  outline: 2px solid transparent;
}

.ln-grid:has([data-ln-viewport='true']:focus-visible) {
  box-shadow:
    0 0 0 2px ${hg('--hg-focus-ring-offset')},
    0 0 0 5px ${hg('--hg-focus-ring-color')};
}
`;

// ---------------------------------------------------------------------------
// 11. Emit — index.ts
// ---------------------------------------------------------------------------

const indexTs = `${BANNER(SOURCE_REL)}
export * from './tokens.js';
export * from './themes.js';
`;

// ---------------------------------------------------------------------------
// 12. Write / check
// ---------------------------------------------------------------------------

const artifacts = {
  'tokens.ts': tokensTs,
  'themes.ts': themesTs,
  'tokens.css': tokensCss,
  'theme.css': themeCss,
  'grid-theme.css': gridThemeCss,
  'index.ts': indexTs,
};

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

let stale = 0;
for (const [file, content] of Object.entries(artifacts)) {
  const path = join(OUT, file);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === content) continue;
  if (CHECK) {
    stale += 1;
    console.error(`stale: src/tokens/${file}`);
  } else {
    writeFileSync(path, content, 'utf8');
    console.log(`wrote  src/tokens/${file}`);
  }
}

if (CHECK) {
  if (stale > 0) {
    console.error(`\n${stale} generated token file(s) are out of date. Run: pnpm generate:tokens`);
    process.exit(1);
  }
  console.log('tokens are up to date');
} else {
  console.log(`\n${Object.keys(artifacts).length} files generated from ${SOURCE_REL}`);
  for (const [scheme, report] of Object.entries(ringReports)) {
    const flipped = Object.entries(report)
      .filter(([, v]) => v.flipped)
      .map(([k, v]) => `${k} (${v.ratio}:1)`);
    console.log(
      `focus ring ${scheme}: flips to focus.onColor on ${flipped.length ? flipped.join(', ') : 'nothing'}`,
    );
  }
}
