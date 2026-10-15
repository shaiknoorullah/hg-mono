/**
 * Render harness for the className tier: the REAL generated stylesheet, compiled the way Metro
 * compiles it in an app (jest.nativewind.cjs), registered with react-native-css-interop's test
 * runtime, and the colour scheme set on both NativeWind and the StyleSheet `ThemeProvider`.
 *
 * Call `loadThemeCss()` in a `beforeAll`; then `renderNw(ui, { theme, scheme })`.
 */
import { createElement, Fragment, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { PortalHost } from '@rn-primitives/portal';

import { ThemeProvider } from '../../../tokens';
import type { ColorScheme, ThemeName } from '../../../tokens';

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
  compileThemeCss: (theme: ThemeName) => Promise<{ css: string; options: object }>;
};

const compiled: Partial<Record<ThemeName, unknown>> = {};

/** Compiles both themes' stylesheets once (slow: Tailwind runs over the lib tier). */
export async function loadThemeCss(): Promise<void> {
  for (const theme of ['customer', 'rider'] as const) {
    const { css, options } = await compileThemeCss(theme);
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

/**
 * Registers `theme`'s stylesheet, puts NativeWind on `scheme`, and renders under `ThemeProvider`,
 * with the root `<PortalHost />` an app mounts, so portalled overlays (Sheet, Modal, Toast) render.
 */
export function renderNw(
  ui: ReactElement,
  { theme = 'customer', scheme = 'light' }: { theme?: ThemeName; scheme?: ColorScheme } = {},
) {
  interop.resetData();
  interop.setupAllComponents();
  interop.injectData(compiled[theme]);
  act(() => colorScheme.set(scheme));
  return render(
    createElement(ThemeProvider, { theme, scheme, children: createElement(Fragment, null, ui, createElement(PortalHost)) }),
  );
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
