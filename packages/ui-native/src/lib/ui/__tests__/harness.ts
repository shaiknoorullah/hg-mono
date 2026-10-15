/**
 * Render harness for the className tier: the REAL generated stylesheet, compiled the way Metro
 * compiles it in an app (jest.nativewind.cjs), registered with react-native-css-interop's test
 * runtime, and the colour scheme set on both NativeWind and the StyleSheet `ThemeProvider`.
 *
 * Call `loadThemeCss()` in a `beforeAll`; then `renderNw(ui, { theme, scheme })`.
 */
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { act } from '@testing-library/react-native';

import { renderThemed } from '../../../primitives/__tests__/harness';
import { themes, tokens, type ColorScheme, type ThemeName } from '../../../tokens';

const interop = require('react-native-css-interop/test') as {
  resetData: () => void;
  setupAllComponents: () => void;
  injectData: (data: unknown) => void;
};
const { colorScheme } = require('react-native-css-interop') as { colorScheme: { set: (s: ColorScheme) => void } };
const { cssToReactNativeRuntime } = require('react-native-css-interop/dist/css-to-rn') as {
  cssToReactNativeRuntime: (css: string, options: object) => unknown;
};
const { compileThemeCss } = require('../../../../jest.nativewind.cjs') as {
  compileThemeCss: (theme: ThemeName, content?: string[]) => Promise<{ css: string; options: object }>;
};

const compiled: Partial<Record<ThemeName, unknown>> = {};

/** Compiles both themes' stylesheets once (slow: Tailwind runs over the lib tier). */
export async function loadThemeCss(): Promise<void> {
  for (const theme of ['customer', 'rider'] as const) {
    const { css, options } = await compileThemeCss(theme);
    compiled[theme] = cssToReactNativeRuntime(css, options);
  }
}

/**
 * `loadThemeCss` over a wider scan: also the files that pass classes into `lib/` (the `/ds` and
 * `/proposed` composites), as an app's Tailwind config scans the whole package.
 */
export async function loadThemeCssFor(content: string[]): Promise<void> {
  for (const theme of ['customer', 'rider'] as const) {
    const { css, options } = await compileThemeCss(theme, content);
    compiled[theme] = cssToReactNativeRuntime(css, options);
  }
}

/** Every theme × scheme pair the native apps run. */
export const SCHEMES: Array<[ThemeName, ColorScheme]> = [
  ['customer', 'light'],
  ['customer', 'dark'],
  ['rider', 'light'],
  ['rider', 'dark'],
];

/** Registers `theme`'s stylesheet, puts NativeWind on `scheme`, and renders under `ThemeProvider`. */
export function renderNw(
  ui: ReactElement,
  { theme = 'customer', scheme = 'light' }: { theme?: ThemeName; scheme?: ColorScheme } = {},
) {
  interop.resetData();
  interop.setupAllComponents();
  interop.injectData(compiled[theme]);
  act(() => colorScheme.set(scheme));
  return renderThemed(ui, { theme, scheme });
}

/** Every danger colour of one theme × scheme (the feedback danger roles and the danger action). */
export function dangerSet(theme: ThemeName, scheme: ColorScheme): Set<string> {
  const c = themes[theme][scheme].color;
  const d = c.feedback.danger as Record<string, string | null | undefined>;
  // `onSolid` is the white label on a danger fill, not a danger colour itself.
  const values = Object.entries(d)
    .filter(([k, v]) => k !== 'onSolid' && typeof v === 'string')
    .map(([, v]) => hex(v));
  return new Set([...values, hex(c.action.danger)]);
}

/** The halal seal's green: it may appear only inside a `HalalBadge` for CERTIFIED. */
export const SEAL_GREEN = tokens.color.halal.certified.seal.toUpperCase();
/** The seal's green in each scheme (dark draws `sealDark`). */
export const sealGreen = (scheme: ColorScheme) =>
  (scheme === 'dark' ? tokens.color.halal.certified.sealDark : tokens.color.halal.certified.seal).toUpperCase();

/** One `--hg-*` value of a theme × scheme, read from the generated stylesheet (roles not in `themes`). */
export function cssVar(theme: ThemeName, scheme: ColorScheme, name: string): string | undefined {
  const css = require('node:fs').readFileSync(`${__dirname}/../../../tokens/generated/global.${theme}.css`, 'utf8') as string;
  const block = css.split(/\.dark:root\s*\{/)[scheme === 'dark' ? 1 : 0] ?? '';
  return new RegExp(`${name}:\\s*(#[0-9A-Fa-f]+);`).exec(block)?.[1]?.toUpperCase();
}

/** Flattened style of a rendered node. */
export function flat(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/** NativeWind's compiler lower-cases hex; tokens.json writes upper case. */
export const hex = (value: unknown) => String(value).toUpperCase();

/** Every colour any node in a rendered tree paints (style colours and SVG/indicator colour props). */
export function paintedColours(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    if (n.props) {
      const s = flat(n as { props: { style?: unknown } });
      for (const key of ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'tintColor']) {
        if (typeof s[key] === 'string') out.push(hex(s[key]));
      }
      for (const key of ['color', 'fill', 'stroke']) {
        if (typeof n.props[key] === 'string') out.push(hex(n.props[key]));
      }
    }
    walk(n.children);
  };
  walk(tree);
  return out;
}
