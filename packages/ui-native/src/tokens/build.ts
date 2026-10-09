/**
 * The token generator's pure core.
 *
 * `docs/design/tokens.json` (W3C DTCG) is the system of record. Nothing in this package
 * may hand-copy a hex out of the design documents: if a value is not in `tokens.json` it
 * does not exist, and if it is, it arrives here by generation.
 *
 * This module does no I/O and reads no clock, so `src/tokens/__tests__/token-drift.test.ts`
 * can call `buildFiles()` and byte-compare the result against what is committed under
 * `src/tokens/generated/`. A hand edit there cannot survive CI.
 *
 * The CLI wrapper is `generate.ts` (`pnpm --filter @hg/ui-native generate:tokens`).
 */

export type Dtcg = Record<string, any>;

/* ------------------------------------------------------------ DTCG resolve */

const ALIAS = /^\{([^}]+)\}$/;

function resolveAlias(doc: Dtcg, ref: string, seen: readonly string[]): unknown {
  if (seen.includes(ref)) throw new Error(`token alias cycle: ${[...seen, ref].join(' -> ')}`);
  const node = ref.split('.').reduce<any>((acc, k) => (acc == null ? undefined : acc[k]), doc);
  if (node == null) throw new Error(`unresolvable token alias {${ref}}`);
  const value = typeof node === 'object' && '$value' in node ? node.$value : node;
  return resolveValue(doc, value, [...seen, ref]);
}

/** Deep-resolve a DTCG value: strings may be aliases, objects and arrays recurse. */
export function resolveValue(doc: Dtcg, value: unknown, seen: readonly string[] = []): unknown {
  if (typeof value === 'string') {
    const m = ALIAS.exec(value.trim());
    return m ? resolveAlias(doc, m[1] as string, seen) : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(doc, v, seen));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Dtcg)) out[k] = resolveValue(doc, v, seen);
    return out;
  }
  return value;
}

/**
 * A DTCG subtree with every `$value` resolved and every `$`-prefixed key dropped, i.e. the
 * plain data an application wants. Group nesting is preserved exactly as authored, so the
 * result is a faithful mirror of `tokens.json` rather than a reinterpretation of it.
 */
export function plain(doc: Dtcg, node: Dtcg): any {
  if (node === null || typeof node !== 'object') return node;
  if ('$value' in node) return resolveValue(doc, node.$value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    out[k] = plain(doc, v as Dtcg);
  }
  return out;
}

/** Flatten a resolved subtree to `dotted.path -> value` for leaves only. */
function flatten(node: any, prefix = '', out: Record<string, unknown> = {}) {
  for (const [k, v] of Object.entries(node ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

/* ---------------------------------------------------------------- printing */

const BANNER = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source:    docs/design/tokens.json (W3C DTCG, the system of record)
 * Generator: packages/ui-native/src/tokens/build.ts
 * Command:   pnpm --filter @hg/ui-native generate:tokens
 *
 * src/tokens/__tests__/token-drift.test.ts re-runs the generator and byte-compares, so a
 * hand edit to this file fails CI rather than quietly diverging from the design system.
 */

`;

function keyOf(k: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${k}'`;
}

/** Deterministic literal printer — insertion-ordered, 2-space indent, single quotes. */
export function lit(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => `${padIn}${lit(v, indent + 1)}`).join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return `{\n${entries
    .map(([k, v]) => `${padIn}${keyOf(k)}: ${lit(v, indent + 1)}`)
    .join(',\n')},\n${pad}}`;
}

/* ------------------------------------------------------------- derivations */

/**
 * The two themes that run on React Native.
 *
 * Foundations §10 names three registers. `operational` (restaurant + admin web) is not
 * this package's concern; `consumer` is the customer app and `field` is the rider app.
 * A theme never invents a colour — it selects the scheme's roles and overrides density,
 * the type-scale defaults and the touch-target floor.
 */
export const THEME_SPEC = {
  customer: {
    register: 'consumer',
    density: 'comfortable',
    targetMin: 'min',
    /** the customer app runs the scale as authored */
    typeBump: {} as Record<string, string>,
    textOverrides: {} as Record<string, string>,
  },
  rider: {
    register: 'field',
    density: 'roomy',
    targetMin: 'field',
    /** §3.3 rider deltas: one step up, applied at the theme root, never per component */
    typeBump: { 'body.md': 'body.lg', 'label.md': 'label.lg' },
    /**
     * §10 field: all body text ≥7:1. `text.tertiary` measures 5.67:1 light and 5.26:1
     * dark, so the field theme resolves tertiary to the secondary role. A role remap, not
     * a new colour — the rider app still ships zero bespoke hexes.
     */
    textOverrides: { tertiary: 'secondary' },
  },
} as const;

export type ThemeName = keyof typeof THEME_SPEC;

/** RN needs an absolute lineHeight and a dp letterSpacing; the web forms are kept alongside. */
export function textStyleOf(raw: any) {
  const stack = raw.fontFamily as string[];
  const size = raw.fontSize as number;
  const em = Number.parseFloat(String(raw.letterSpacing)) || 0;
  return {
    fontFamily: stack[0] as string,
    fontFamilyStack: stack,
    fontSize: size,
    fontWeight: String(raw.fontWeight),
    lineHeight: raw.lineHeightPx as number,
    lineHeightRatio: raw.lineHeight as number,
    letterSpacing: Math.round(em * size * 1000) / 1000,
  };
}

const cssVar = (group: string, leaf: string) =>
  `--hg-${group}-${leaf.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`;

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Hue in degrees, or `null` for an achromatic or unparseable value. */
export function hueOf(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return null;
  const int = Number.parseInt(m[1] as string, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return null;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

/** The reserved band of RULE H-1 / lint L-4: filled greens belong to `color.halal.*`. */
export const RESERVED_HUE = { min: 100, max: 180 } as const;

const inReservedHue = (hex: string) => {
  const h = hueOf(hex);
  return h !== null && h >= RESERVED_HUE.min && h <= RESERVED_HUE.max;
};

/**
 * The role groups `tokens.json` leaves to the theme layer.
 *
 * Foundations §2.0 is explicit that components consume roles and that "only the theme
 * files map steps to roles" — but `theme.light`/`theme.dark` stop at surface/text/border/
 * focus/state, so an action fill and the semantic feedback set have nowhere to come from
 * except a ramp step. Doing that mapping *here*, in the generated theme, is what keeps
 * lint L-2 true of every component: a Button asks for `color.action.primary`, not for
 * `color.brand[500]`.
 *
 * `success.solid` is `null` in both schemes and that is not an oversight — it is RULE H-1
 * in the type system. There is no filled green outside `color.halal.*`, so `Button` has no
 * `success` variant and a success `Toast` is a tint.
 */
function derivedRoles(color: any, scheme: 'light' | 'dark') {
  const dark = scheme === 'dark';
  const semantic = (name: 'success' | 'warning' | 'danger' | 'info', solidStep: string | null) => {
    const ramp = color[name];
    return {
      tint: dark ? ramp['900'] : ramp['50'],
      tintText: dark ? ramp['300'] : ramp['700'],
      text: dark ? ramp['300'] : ramp['600'],
      icon: dark ? ramp['300'] : ramp['500'],
      border: ramp['500'],
      solid: solidStep === null ? null : ramp[solidStep],
      onSolid: solidStep === null ? null : color.neutral['0'],
    };
  };

  return {
    action: {
      /** brand fill; the label on it is always `text.onBrand` — white is 1.62:1 and banned */
      primary: color.brand['500'],
      secondary: color.accent['600'],
      danger: color.danger['500'],
      /** checkbox tick, radio dot, selected chip — brand, never green (RULE H-1) */
      control: color.brand['500'],
      /** switch track when on; 3:1 against the surface is required by WCAG 1.4.11 */
      trackOn: color.brand['600'],
    },
    feedback: {
      success: semantic('success', null),
      warning: semantic('warning', '600'),
      danger: semantic('danger', '500'),
      info: semantic('info', '500'),
    },
    /**
     * `Skeleton` shimmer. Foundations §2.3 assigns `neutral.300` as the skeleton base and
     * `neutral.500` as the dark-scheme highlight; the dark base is not stated, and
     * `neutral.800` (the raised surface) is the only value that reads as a resting block
     * rather than as content.
     */
    skeleton: {
      base: dark ? color.neutral['800'] : color.neutral['300'],
      highlight: dark ? color.neutral['500'] : color.neutral['200'],
    },
    /**
     * Deterministic `Avatar` initials fills, drawn from the chart categoricals so they can
     * never land on a reserved meaning. Any `viz` entry inside the reserved hue band is
     * dropped here rather than in `Avatar`, so the exclusion is recomputed from the palette
     * every time tokens change instead of being a comment someone forgets.
     */
    avatarFills: Object.entries(color.viz as Record<string, string>)
      .filter(([, hex]) => !inReservedHue(hex))
      .map(([, hex]) => hex),
  };
}

/* --------------------------------------------- shadcn / RNR semantic aliases */

/**
 * The semantic variable names React Native Reusables (and shadcn/ui) components are written
 * against, each an ALIAS of one of our roles — never a new value. The table is the plan's
 * §3.2 mapping (design-system plan, "Mapping to Tailwind v4 and NativeWind v4").
 *
 * Two deliberate departures from RNR's defaults:
 *   - values are hex, not `hsl()` channel triples: RNR's `hsl(var(--x))` template is rewritten
 *     to `var(--x)` on copy-in, so the variable holds a complete colour;
 *   - `--accent` is the selected-state TINT, not our forest `color.accent.*` ramp. shadcn's
 *     "accent" is a hover/selected wash; mapping it to the forest ramp would paint forest
 *     washes on hover.
 *
 * `--primary-foreground` is `text.onBrand` (#0F241C), never white (1.62:1 on brand 500).
 */
type ThemeColorsLoose = Record<string, Record<string, any>>;
export const RNR_ALIASES: Record<string, (c: ThemeColorsLoose) => string> = {
  '--background': (c) => c.surface!.base,
  '--foreground': (c) => c.text!.primary,
  '--card': (c) => c.surface!.raised,
  '--card-foreground': (c) => c.text!.primary,
  '--popover': (c) => c.surface!.raised,
  '--popover-foreground': (c) => c.text!.primary,
  '--primary': (c) => c.action!.primary,
  '--primary-foreground': (c) => c.text!.onBrand,
  '--secondary': (c) => c.action!.secondary,
  '--secondary-foreground': (c) => c.text!.onAccent,
  '--muted': (c) => c.surface!.subtle,
  '--muted-foreground': (c) => c.text!.secondary,
  '--accent': (c) => c.state!.selectedTint,
  '--accent-foreground': (c) => c.text!.primary,
  '--destructive': (c) => c.action!.danger,
  '--destructive-foreground': (c) => c.feedback!.danger.onSolid,
  '--border': (c) => c.border!.decorative,
  '--input': (c) => c.border!.interactive,
  '--ring': (c) => c.focus!.ring,
};

/** Tailwind colour utilities for the aliases above (`bg-primary`, `text-muted-foreground`). */
const RNR_PRESET_COLORS = {
  background: 'var(--background)',
  foreground: 'var(--foreground)',
  card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
  popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
  primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
  secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
  muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
  destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
  input: 'var(--input)',
  ring: 'var(--ring)',
} as const;

/**
 * `global.<theme>.css` — what an app hands to `withNativeWind(config, { input })` and imports
 * once at its root. `:root` holds the light scheme, `.dark:root` the dark one (NativeWind 4's
 * class dark mode), each as resolved hex: the `--hg-*` role variables the preset's role
 * utilities read (`bg-surface-base`), then the RNR aliases (`bg-primary`).
 */
export function nativewindGlobalCss(
  themeName: string,
  vars: Record<'light' | 'dark', Record<string, string>>,
  colors: Record<'light' | 'dark', ThemeColorsLoose>,
): string {
  const block = (selector: string, scheme: 'light' | 'dark') => {
    const lines = Object.entries(vars[scheme]).map(([k, v]) => `  ${k}: ${v};`);
    lines.push('');
    for (const [name, pick] of Object.entries(RNR_ALIASES)) {
      lines.push(`  ${name}: ${pick(colors[scheme])};`);
    }
    return `${selector} {\n${lines.join('\n')}\n}\n`;
  };
  return [
    '/*',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ' * Source:    docs/design/tokens.json (W3C DTCG, the system of record)',
    ' * Generator: packages/ui-native/src/tokens/build.ts (nativewindGlobalCss)',
    ' * Command:   pnpm --filter @hg/ui-native generate:tokens',
    ' *',
    ` * NativeWind 4 input for the ${themeName} theme. Hex values, never hsl().`,
    ' */',
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
    block(':root', 'light'),
    block('.dark:root', 'dark'),
  ].join('\n');
}

/* ----------------------------------------------------------------- builder */

export function buildFiles(doc: Dtcg): Record<string, string> {
  const files: Record<string, string> = {};

  /* ------------------------------------------------------------ tokens.ts */

  /**
   * The faithful mirror. Every group of `tokens.json`, aliases resolved, `$`-keys dropped,
   * shapes untouched — `tokens.typography['body.md'].lineHeightPx`, `tokens.elevation[3].rn`,
   * `tokens.theme.light.surface.base` are all exactly what the design document specifies.
   * Every other generated artefact, and every consumer tier, derives from this one object.
   */
  const tokens = {
    color: plain(doc, doc.color),
    theme: plain(doc, doc.theme),
    font: plain(doc, doc.font),
    typography: plain(doc, doc.typography),
    space: plain(doc, doc.space),
    density: plain(doc, doc.density),
    radius: plain(doc, doc.radius),
    elevation: plain(doc, doc.elevation),
    motion: plain(doc, doc.motion),
    icon: plain(doc, doc.icon),
    target: plain(doc, doc.target),
    zIndex: plain(doc, doc.zIndex),
    breakpoint: plain(doc, doc.breakpoint),
  };

  files['tokens.ts'] =
    BANNER +
    [
      '/**',
      ' * The design system, resolved. A faithful mirror of `docs/design/tokens.json`:',
      ' * aliases followed, `$`-prefixed metadata dropped, group shapes untouched.',
      ' *',
      ' * Components consume ROLES (`tokens.theme.light.text.primary`), never ramp steps',
      ' * (`tokens.color.neutral[900]`) — lint L-2. `tokens.color.halal.*` is the reserved',
      ' * namespace of lint L-3 and belongs to the certification components alone.',
      ' */',
      `export const tokens = ${lit(tokens)} as const;`,
      '',
      'export type Tokens = typeof tokens;',
      "export type ColorScheme = 'light' | 'dark';",
      "export type Roles = Tokens['theme']['light'];",
      "export type TypographyToken = keyof Tokens['typography'];",
      "export type SpaceToken = keyof Tokens['space'];",
      "export type RadiusToken = keyof Tokens['radius'];",
      "export type IconSizeToken = keyof Tokens['icon'];",
      "export type ElevationLevel = keyof Tokens['elevation'];",
      "export type DensityMode = keyof Tokens['density'];",
      '',
    ].join('\n');

  /* ------------------------------------------------------------ themes.ts */

  const typography: Record<string, ReturnType<typeof textStyleOf>> = {};
  for (const [name, value] of Object.entries(tokens.typography as Record<string, any>)) {
    typography[name] = textStyleOf(value);
  }

  const schemes = ['light', 'dark'] as const;
  const themes: Record<string, Record<string, unknown>> = {};

  for (const [themeName, spec] of Object.entries(THEME_SPEC)) {
    themes[themeName] = {};
    for (const scheme of schemes) {
      const roles = (tokens.theme as any)[scheme];
      const derived = derivedRoles(tokens.color, scheme);
      const color: Record<string, unknown> = {
        surface: { ...roles.surface },
        text: { ...roles.text },
        border: { ...roles.border },
        focus: { ...roles.focus },
        state: { ...roles.state },
        action: derived.action,
        feedback: derived.feedback,
        skeleton: derived.skeleton,
        avatarFills: derived.avatarFills,
      };
      const textRoles = color.text as Record<string, unknown>;
      for (const [from, to] of Object.entries(spec.textOverrides)) {
        textRoles[from] = textRoles[to];
      }

      const themeType: Record<string, unknown> = { ...typography };
      for (const [from, to] of Object.entries(spec.typeBump)) themeType[from] = typography[to];

      themes[themeName]![scheme] = {
        name: themeName,
        scheme,
        register: spec.register,
        color,
        typography: themeType,
        density: (tokens.density as any)[spec.density],
        densityMode: spec.density,
        target: {
          min: (tokens.target as any)[spec.targetMin],
          critical: (tokens.target as any).criticalField,
          spacing: (tokens.target as any).spacing,
        },
        /** light carries depth with a shadow; dark steps the surface (a black shadow on a
         *  near-black surface is invisible) */
        elevationMode: scheme === 'dark' ? 'surface' : 'shadow',
      };
    }
  }

  files['themes.ts'] =
    BANNER +
    [
      '/**',
      ' * The two themes that run on React Native, each in both colour schemes.',
      ' *',
      ' *   customer — consumer register: comfortable density, 44 targets, scale as authored',
      ' *   rider    — field register:    roomy density, 56 targets, body.lg / label.lg',
      ' *              defaults, and text.tertiary escalated to secondary so that every',
      ' *              body string clears 7:1 outdoors (foundations §10).',
      ' *',
      ' * `typography` entries are RN-ready: `lineHeight` is the resolved px value and',
      ' * `letterSpacing` is em×fontSize in dp. The web forms survive as `lineHeightRatio`',
      ' * and `fontFamilyStack`.',
      ' */',
      `export const themes = ${lit(themes)} as const;`,
      '',
      'export type Themes = typeof themes;',
      'export type ThemeName = keyof Themes;',
      "export type ColorScheme = 'light' | 'dark';",
      'export type Theme = Themes[ThemeName][ColorScheme];',
      "export type ThemeColors = Theme['color'];",
      "export type SurfaceRole = keyof ThemeColors['surface'];",
      "export type TextRole = keyof ThemeColors['text'];",
      "export type BorderRole = keyof ThemeColors['border'];",
      "export type TypeStyle = Theme['typography']['body.md'];",
      '',
      '/**',
      ' * One semantic feedback role. Written out rather than derived, because indexing the',
      ' * theme union with a variant union collapses to `never`, and because `solid: null` is',
      ' * load-bearing: it is RULE H-1 in the type system — semantic success has no fill.',
      ' */',
      'export interface FeedbackRole {',
      '  readonly tint: string;',
      '  readonly tintText: string;',
      '  readonly text: string;',
      '  readonly icon: string;',
      '  readonly border: string;',
      '  readonly solid: string | null;',
      '  readonly onSolid: string | null;',
      '}',
      '',
      "export type FeedbackName = 'success' | 'warning' | 'danger' | 'info';",
      '',
      '/** Narrows the theme union to one concrete feedback role. */',
      'export function feedbackRole(theme: Theme, name: FeedbackName): FeedbackRole {',
      '  return (theme.color.feedback as Record<FeedbackName, FeedbackRole>)[name];',
      '}',
      '',
    ].join('\n');

  /* -------------------------------------------------------------- vars.ts */

  const varsOut: Record<string, Record<string, Record<string, string>>> = {};
  for (const themeName of Object.keys(THEME_SPEC)) {
    varsOut[themeName] = {};
    for (const scheme of schemes) {
      const t = themes[themeName]![scheme] as any;
      const map: Record<string, string> = {};
      for (const group of ['surface', 'text', 'border', 'focus', 'state'] as const) {
        for (const [leaf, value] of Object.entries(t.color[group] as Record<string, unknown>)) {
          if (typeof value !== 'string') continue;
          map[cssVar(group === 'text' ? 'fg' : group, leaf)] = value;
        }
      }
      varsOut[themeName]![scheme] = map;
    }
  }

  files['vars.ts'] =
    BANNER +
    [
      '/**',
      ' * NativeWind 4 CSS-variable maps — one per theme × scheme. An app roots itself with:',
      ' *',
      " *     import { vars } from 'nativewind';",
      ' *     <View style={vars(themeVars.rider.dark)}>…</View>',
      ' *',
      ' * The preset points every role utility at these variables, which is what lets one',
      ' * class name stay correct across customer/rider × light/dark without a `dark:`',
      ' * variant on every element.',
      ' *',
      ' * Naming: `theme.*.text.*` is exposed as `fg-*` (so `text-fg-primary`), because',
      ' * Tailwind already owns the `text-` prefix for colour.',
      ' */',
      `export const themeVars = ${lit(varsOut)} as const;`,
      '',
      'export type ThemeVars = typeof themeVars;',
      '',
    ].join('\n');

  /* ------------------------------------------------- global.<theme>.css */

  for (const themeName of Object.keys(THEME_SPEC)) {
    const t = themes[themeName] as any;
    files[`global.${themeName}.css`] = nativewindGlobalCss(
      themeName,
      varsOut[themeName] as Record<'light' | 'dark', Record<string, string>>,
      { light: t.light.color, dark: t.dark.color },
    );
  }

  /* ------------------------------------------------- nativewind-preset.cjs */

  const presetColors: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(tokens.color as Record<string, any>)) {
    presetColors[name] = value;
  }
  for (const group of ['surface', 'text', 'border', 'focus'] as const) {
    const leafs = Object.keys((themes.customer as any).light.color[group]);
    presetColors[group === 'text' ? 'fg' : group] = Object.fromEntries(
      leafs.map((leaf) => [kebab(leaf), `var(${cssVar(group === 'text' ? 'fg' : group, leaf)})`]),
    );
  }
  /*
   * RNR aliases (`global.<theme>.css`). Two names already exist as our groups and gain a
   * DEFAULT rather than being replaced: `border` (so `border-border` works beside
   * `border-border-interactive`) and `accent` (the forest ramp keeps its numbered steps;
   * bare `bg-accent` is shadcn's selected wash, `--accent`).
   */
  Object.assign(presetColors, RNR_PRESET_COLORS);
  presetColors.border = { DEFAULT: 'var(--border)', ...(presetColors.border as object) };
  presetColors.accent = {
    ...(presetColors.accent as object),
    DEFAULT: 'var(--accent)',
    foreground: 'var(--accent-foreground)',
  };

  const preset = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: presetColors,
        spacing: Object.fromEntries(
          Object.entries(tokens.space as Record<string, number>).map(([k, v]) => [k, `${v}px`]),
        ),
        borderRadius: Object.fromEntries(
          Object.entries(tokens.radius as Record<string, number>).map(([k, v]) => [k, `${v}px`]),
        ),
        fontFamily: tokens.font.family,
        fontWeight: Object.fromEntries(
          Object.entries(tokens.font.weight as Record<string, number>).map(([k, v]) => [
            k,
            String(v),
          ]),
        ),
        fontSize: Object.fromEntries(
          Object.entries(typography).map(([name, t]) => [
            name.replace('.', '-'),
            [
              `${t.fontSize}px`,
              {
                lineHeight: `${t.lineHeight}px`,
                fontWeight: t.fontWeight,
                letterSpacing: `${t.letterSpacing}px`,
              },
            ],
          ]),
        ),
        minHeight: Object.fromEntries(
          Object.entries(tokens.target as Record<string, number>).map(([k, v]) => [
            `target-${kebab(k)}`,
            `${v}px`,
          ]),
        ),
        minWidth: Object.fromEntries(
          Object.entries(tokens.target as Record<string, number>).map(([k, v]) => [
            `target-${kebab(k)}`,
            `${v}px`,
          ]),
        ),
        zIndex: Object.fromEntries(
          Object.entries(tokens.zIndex as Record<string, number>).map(([k, v]) => [k, String(v)]),
        ),
        transitionDuration: Object.fromEntries(
          Object.entries(tokens.motion.duration as Record<string, string>).map(([k, v]) => [k, v]),
        ),
        screens: Object.fromEntries(
          Object.entries(tokens.breakpoint as Record<string, number>).map(([k, v]) => [
            k,
            `${v}px`,
          ]),
        ),
      },
    },
  };

  files['nativewind-preset.cjs'] =
    BANNER +
    [
      '/**',
      ' * NativeWind 4 preset. Apps extend it with:',
      ' *',
      " *     presets: [require('@hg/ui-native/preset')]",
      ' *',
      ' * Role utilities (`bg-surface-base`, `text-fg-primary`, `border-border-interactive`)',
      ' * resolve through the CSS variables in `vars.ts`. Ramp utilities (`bg-brand-500`)',
      ' * exist for theme files only — lint L-2 keeps them out of components, and lint L-4',
      ' * refuses any filled green outside `halal-*`.',
      ' *',
      ' * `.cjs` on purpose: the package is ESM, but Tailwind configs are still `require`d.',
      ' */',
      `module.exports = ${lit(preset)};`,
      '',
    ].join('\n');

  /* --------------------------------------------------- lint-tokens.json */

  /**
   * Everything lint L-4 needs, generated so the rule can never drift from the palette:
   *   byPath      dotted token path -> hex, for `tokens.color.success[500]` references
   *   byUtility   Tailwind colour utility suffix -> hex, for `bg-success-500` classNames
   *   halalHexes  the only hexes that may legally fill a green surface (RULE H-1)
   *   exceptions  registered non-halal uses of a reserved green (foundations §2.6)
   */
  const byPath: Record<string, string> = {};
  for (const [p, v] of Object.entries(flatten(tokens.color, 'color'))) {
    if (typeof v === 'string') byPath[p] = v;
  }
  for (const [p, v] of Object.entries(flatten(tokens.theme, 'theme'))) {
    if (typeof v === 'string') byPath[p] = v;
  }

  const byUtility: Record<string, string> = {};
  for (const [p, hex] of Object.entries(byPath)) {
    if (!p.startsWith('color.')) continue;
    byUtility[kebab(p.slice('color.'.length).split('.').join('-'))] = hex;
  }

  const halalHexes = Array.from(
    new Set(
      Object.entries(byPath)
        .filter(([p]) => p.startsWith('color.halal.'))
        .map(([, hex]) => hex),
    ),
  ).sort();

  /**
   * The forest brand chrome (color.accent.*) is a dark, low-chroma green NEUTRAL, not a
   * verified-halal signal (amended invariant #10, docs/decisions/palette-and-invariant-10.md).
   * Its darker steps fall inside the reserved hue band, so they are registered here as
   * allowed neutrals — exactly like the pinRider exception — so L-4 keeps forbidding the
   * seal emerald and any other bright solid green outside color.halal.* while letting the
   * chrome through. Generated from the palette so it can never drift.
   */
  const forestExceptions: Record<string, string> = {};
  for (const [p, hex] of Object.entries(byPath)) {
    if (/^color\.accent\.\d+$/.test(p) && inReservedHue(hex)) forestExceptions[p] = hex;
  }

  files['lint-tokens.json'] = `${JSON.stringify(
    {
      $comment:
        'GENERATED from docs/design/tokens.json by packages/ui-native/src/tokens/build.ts. ' +
        'Consumed by the L-4 ESLint rule: no filled background may resolve to a hue in ' +
        '[100,180] unless it comes from color.halal.* or is a registered exception ' +
        '(color.map.pinRider, or the forest chrome neutrals color.accent.*).',
      hueBand: { min: 100, max: 180 },
      minSaturation: 0.15,
      halalHexes,
      exceptions: {
        'color.map.pinRider': byPath['color.map.pinRider'],
        ...forestExceptions,
      },
      byPath,
      byUtility,
    },
    null,
    2,
  )}\n`;

  /* ------------------------------------------------------------ index.ts */

  files['index.ts'] =
    BANNER +
    [
      "export { tokens } from './tokens';",
      'export type {',
      '  Tokens,',
      '  Roles,',
      '  TypographyToken,',
      '  SpaceToken,',
      '  RadiusToken,',
      '  IconSizeToken,',
      '  ElevationLevel,',
      '  DensityMode,',
      "} from './tokens';",
      "export { themes, feedbackRole } from './themes';",
      'export type {',
      '  Themes,',
      '  Theme,',
      '  ThemeName,',
      '  ColorScheme,',
      '  ThemeColors,',
      '  SurfaceRole,',
      '  TextRole,',
      '  BorderRole,',
      '  TypeStyle,',
      '  FeedbackRole,',
      '  FeedbackName,',
      "} from './themes';",
      "export { themeVars } from './vars';",
      "export type { ThemeVars } from './vars';",
      '',
    ].join('\n');

  return files;
}
