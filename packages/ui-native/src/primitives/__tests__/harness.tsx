/**
 * Render helper for the primitive suites.
 *
 * Every primitive is theme-driven, so nothing renders outside a `ThemeProvider`. Rendering
 * in both themes is cheap here and catches the class of bug that only appears in the rider
 * register (56 targets, escalated tertiary text, one-step-larger body).
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react-native';

import { ThemeProvider, themes } from '../../tokens';
import type { ColorScheme, ThemeName } from '../../tokens';

export function renderThemed(
  ui: ReactElement,
  { theme = 'customer', scheme = 'light' }: { theme?: ThemeName; scheme?: ColorScheme } = {},
) {
  return render(
    <ThemeProvider theme={theme} scheme={scheme}>
      {ui}
    </ThemeProvider>,
  );
}

export { themes };

/**
 * Query a node that is deliberately hidden from the accessibility tree — spinners inside a
 * named control, skeletons, decorative glyphs, the focus ring. Testing Library excludes
 * those from its default queries, which is the correct default and exactly why asserting on
 * them needs to be explicit.
 */
export function getHidden(testID: string) {
  return screen.getByTestId(testID, { includeHiddenElements: true });
}

/** Flattened style of a node, whatever shape RN handed back. */
export function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  const style = node.props.style;
  const flatten = (input: unknown): Record<string, unknown> => {
    if (Array.isArray(input)) return Object.assign({}, ...input.map(flatten));
    if (input && typeof input === 'object') return input as Record<string, unknown>;
    return {};
  };
  return flatten(style);
}
