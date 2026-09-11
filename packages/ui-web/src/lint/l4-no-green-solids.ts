import { readFileSync } from 'node:fs';
import { color } from '../tokens/index.js';

/**
 * LINT L-4 — no green solids.  RULE H-1 in executable form.
 *
 * 01-foundations.md §2.5:
 *
 *   "`halal.certified.seal` is the ONLY filled solid green surface in the
 *    entire design system. Semantic success is tint-only: a light background
 *    with dark green text, an icon, or a 2px accent border. No component may
 *    render a filled green pill, chip, button, or badge outside the `halal.*`
 *    namespace."
 *
 * The rule as written in §9 is "no filled background may resolve to a colour
 * whose hue is 100°–180° unless it comes from `color.halal.*`". Two things have
 * to be pinned down to make that executable:
 *
 * 1. WHAT COUNTS AS "FILLED". Only background properties (`background`,
 *    `background-color`, `fill` on a shape) and Tailwind `bg-*` utilities.
 *    Text, borders and icons in the success ramp are explicitly ALLOWED — the
 *    spec's own remedy for success is "dark green text, an icon, or a 2px
 *    accent border".
 *
 * 2. WHAT COUNTS AS "SOLID" RATHER THAN A TINT. `success.50 #E7F7F0` is hue
 *    154° and IS a legal background — it is the tint the rule prescribes. The
 *    separator is luminance: a *solid* is a green dark enough to read as its
 *    own surface. So: a background is a violation when it is in the hue band,
 *    is actually chromatic (saturation ≥ SATURATION_FLOOR, so warm/cool greys
 *    that happen to compute a green hue are not flagged), and separates from
 *    white by ≥3:1 (SOLID_CONTRAST_MIN). success.50/100/300 stay legal; the
 *    moment the fill darkens to success.500 or beyond it is a violation.
 *
 * ALLOWED: anything resolving to a `color.halal.*` token, and the one
 * registered exception in §2.6 — `color.map.pinRider`, a rider pin, which is
 * not a certification claim and carries no shield.
 *
 * SUPPRESSION: a line carrying `l4-allow: <reason>` (on the line itself or the
 * line above) is skipped. It exists for the rule's own fixtures and for any
 * future registered exception, and it demands a written reason so that an
 * exception is a decision on the record rather than a silent edit.
 */

export const HUE_MIN = 100;
export const HUE_MAX = 180;
export const SATURATION_FLOOR = 0.1;
/**
 * A background counts as a SOLID once it separates from white by ≥3:1 — the
 * WCAG 1.4.11 threshold at which a fill reads as its own surface rather than a
 * tint of the page. Below it, the colour is the tint the rule prescribes as
 * the legal way to signal success.
 */
export const SOLID_CONTRAST_MIN = 3;

export interface L4Violation {
  file: string;
  line: number;
  column: number;
  snippet: string;
  hex: string;
  hue: number;
  message: string;
}

// --------------------------------------------------------------------------
// Colour maths
// --------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] | null {
  const raw = hex.replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** HSL hue in degrees and saturation in 0..1. */
export function hsl(hex: string): { hue: number; saturation: number; lightness: number } | null {
  const parsed = rgb(hex);
  if (!parsed) return null;
  const [r, g, b] = parsed.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation, lightness };
}

function luminance(hex: string): number {
  const parsed = rgb(hex);
  if (!parsed) return 0;
  const [r, g, b] = parsed
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

/** Is this colour a *solid* green in the reserved band? */
export function isReservedGreenSolid(hex: string): { hue: number } | null {
  const parsed = hsl(hex);
  if (!parsed) return null;
  if (parsed.hue < HUE_MIN || parsed.hue > HUE_MAX) return null;
  if (parsed.saturation < SATURATION_FLOOR) return null;
  if (contrastWithWhite(hex) < SOLID_CONTRAST_MIN) return null; // a tint, which is legal
  return { hue: parsed.hue };
}

// --------------------------------------------------------------------------
// The allowlist: every colour that legitimately reaches a green fill
// --------------------------------------------------------------------------

function collectHexes(tree: unknown, into: Set<string>): void {
  if (typeof tree === 'string') {
    if (tree.startsWith('#')) into.add(tree.toUpperCase());
    return;
  }
  if (tree && typeof tree === 'object') {
    for (const value of Object.values(tree)) collectHexes(value, into);
  }
}

/** color.halal.* — the namespace that owns solid green (RULE H-1). */
export const HALAL_HEXES: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  collectHexes(color.halal, set);
  return set;
})();

/**
 * Registered exceptions to RULE H-1:
 *  - `color.map.pinRider` (01-foundations.md §2.6): the rider map pin is a Halal Goes
 *    rider, not a certification claim. It carries no shield.
 *  - `color.accent.*` — the forest brand chrome. The amended invariant #10
 *    (docs/decisions/palette-and-invariant-10.md) classifies the deep forest as a dark,
 *    low-chroma green NEUTRAL used as chrome (app bars, headers), NOT the verified-halal
 *    signal. The verified signal is the brighter emerald in color.halal.* alone. Allowing
 *    the chrome here keeps L-4 forbidding the seal emerald and every other bright solid
 *    green outside color.halal.*.
 */
export const ALLOWED_TOKEN_PATHS = ['color.halal.', 'color.map.pinRider', 'color.accent.'] as const;

const ALLOWED_VAR_NAMES = new Set(
  [
    '--hg-color-halal',
    '--hg-halal',
    '--color-halal',
    '--hg-color-map-pin-rider',
    '--color-map-pin-rider',
    '--hg-color-accent',
    '--color-accent',
    '--hg-surface-chrome',
    '--surface-chrome',
  ].map((s) => s.toLowerCase()),
);

/** Tailwind utility names whose colour is allowed to be a green solid. */
function isAllowedUtility(name: string): boolean {
  return name.startsWith('halal-') || name === 'map-pin-rider' || name.startsWith('accent-');
}

function isAllowedVar(name: string): boolean {
  const lower = name.toLowerCase();
  for (const prefix of ALLOWED_VAR_NAMES) if (lower.startsWith(prefix)) return true;
  return false;
}

// --------------------------------------------------------------------------
// Resolution: Tailwind utility / CSS var name → hex
// --------------------------------------------------------------------------

function flattenColors(tree: unknown, path: string[], into: Map<string, string>): void {
  if (typeof tree === 'string') {
    into.set(path.join('-').toLowerCase(), tree.toUpperCase());
    return;
  }
  if (tree && typeof tree === 'object') {
    for (const [key, value] of Object.entries(tree)) flattenColors(value, [...path, key], into);
  }
}

/** e.g. "brand-500" → "#FFC220", "halal-certified-seal" → "#0F7A43". */
export const COLOR_BY_UTILITY: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  flattenColors(color, [], map);
  // Also index camelCase leaves in kebab form (pinRider → pin-rider).
  for (const [key, value] of [...map]) {
    const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    if (!map.has(kebab)) map.set(kebab, value);
  }
  return map;
})();

// --------------------------------------------------------------------------
// Scanners
// --------------------------------------------------------------------------

/** `background: #0F7A43`, `background-color: var(--hg-...)`, `fill: #...` */
const CSS_BACKGROUND = /\b(background|background-color|fill)\s*:\s*([^;{}]+)/g;
/** Tailwind `bg-<name>` / `fill-<name>` in a class string. */
const TW_BACKGROUND = /(?:^|[\s"'`:])(?:bg|fill)-([a-z0-9][a-z0-9-]*)/g;
/** `backgroundColor: '#0F7A43'` in a style object. */
const JSX_BACKGROUND = /background(?:Color)?\s*:\s*['"`](#[0-9a-fA-F]{3,8})['"`]/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const VAR_REF = /var\(\s*(--[a-z0-9-]+)/i;

function positionOf(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  const column = index - before.lastIndexOf('\n');
  return { line, column };
}

const SUPPRESS = /l4-allow:/;

/** `l4-allow: reason` on the offending line or the line immediately above. */
function isSuppressed(source: string, index: number): boolean {
  const start = source.lastIndexOf('\n', index) + 1;
  const end = source.indexOf('\n', index);
  const line = source.slice(start, end === -1 ? undefined : end);
  if (SUPPRESS.test(line)) return true;
  const prevStart = source.lastIndexOf('\n', Math.max(start - 2, 0)) + 1;
  return SUPPRESS.test(source.slice(prevStart, Math.max(start - 1, 0)));
}

function lineAt(source: string, index: number): string {
  const start = source.lastIndexOf('\n', index) + 1;
  const end = source.indexOf('\n', index);
  return source.slice(start, end === -1 ? undefined : end).trim();
}

/** Resolve whatever a declaration's value is to a hex, if we can. */
function resolveValue(value: string): { hex: string; allowed: boolean } | null {
  const varMatch = VAR_REF.exec(value);
  if (varMatch?.[1]) {
    const name = varMatch[1];
    if (isAllowedVar(name)) return null; // allowlisted by name
    const utility = name.replace(/^--(hg-)?(color-)?/, '');
    const hex = COLOR_BY_UTILITY.get(utility.toLowerCase());
    return hex ? { hex, allowed: false } : null;
  }
  const hexMatch = HEX.exec(value);
  if (hexMatch) return { hex: hexMatch[0].toUpperCase(), allowed: false };
  return null;
}

export function lintSource(file: string, source: string): L4Violation[] {
  const violations: L4Violation[] = [];
  const isStyle = /\.css$/.test(file);

  const record = (index: number, hex: string, hue: number, why: string) => {
    if (isSuppressed(source, index)) return;
    const { line, column } = positionOf(source, index);
    violations.push({
      file,
      line,
      column,
      snippet: lineAt(source, index),
      hex,
      hue: Math.round(hue),
      message: why,
    });
  };

  if (isStyle) {
    for (const match of source.matchAll(CSS_BACKGROUND)) {
      const value = match[2] ?? '';
      const resolved = resolveValue(value);
      if (!resolved) continue;
      if (HALAL_HEXES.has(resolved.hex)) continue;
      const green = isReservedGreenSolid(resolved.hex);
      if (!green) continue;
      record(
        match.index ?? 0,
        resolved.hex,
        green.hue,
        `L-4: filled background resolves to ${resolved.hex} (hue ${Math.round(green.hue)}°), a solid green outside color.halal.*`,
      );
    }
    return violations;
  }

  for (const match of source.matchAll(TW_BACKGROUND)) {
    const utility = match[1];
    if (!utility) continue;
    if (isAllowedUtility(utility)) continue;
    // Arbitrary value: bg-[#0F7A43] / bg-[var(--x)]
    const hex = COLOR_BY_UTILITY.get(utility.toLowerCase());
    if (!hex) continue;
    if (HALAL_HEXES.has(hex)) continue;
    const green = isReservedGreenSolid(hex);
    if (!green) continue;
    record(
      match.index ?? 0,
      hex,
      green.hue,
      `L-4: \`bg-${utility}\` resolves to ${hex} (hue ${Math.round(green.hue)}°), a solid green outside color.halal.*`,
    );
  }

  // bg-[#0F7A43] and bg-[var(--…)] arbitrary values.
  for (const match of source.matchAll(/(?:bg|fill)-\[([^\]]+)\]/g)) {
    const inner = match[1] ?? '';
    const resolved = resolveValue(inner);
    if (!resolved) continue;
    if (HALAL_HEXES.has(resolved.hex)) continue;
    const green = isReservedGreenSolid(resolved.hex);
    if (!green) continue;
    record(
      match.index ?? 0,
      resolved.hex,
      green.hue,
      `L-4: arbitrary background \`${inner}\` resolves to ${resolved.hex} (hue ${Math.round(green.hue)}°), a solid green outside color.halal.*`,
    );
  }

  for (const match of source.matchAll(JSX_BACKGROUND)) {
    const hex = (match[1] ?? '').toUpperCase();
    if (HALAL_HEXES.has(hex)) continue;
    const green = isReservedGreenSolid(hex);
    if (!green) continue;
    record(
      match.index ?? 0,
      hex,
      green.hue,
      `L-4: inline background ${hex} (hue ${Math.round(green.hue)}°) is a solid green outside color.halal.*`,
    );
  }

  return violations;
}

export function lintFile(file: string): L4Violation[] {
  return lintSource(file, readFileSync(file, 'utf8'));
}
