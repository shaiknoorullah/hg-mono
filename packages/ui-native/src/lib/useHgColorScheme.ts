/**
 * Bridges the colour scheme from `ThemeProvider` (the source of truth) to NativeWind, so
 * `className` utilities resolve against `:root` or `.dark:root` of `global.<theme>.css` in step
 * with every StyleSheet component reading `useTheme()`.
 *
 * Call it once, inside the `ThemeProvider`, in a redesign root only. NativeWind's
 * `setColorScheme` also sets React Native's `Appearance` override for the whole app, which is
 * why the legacy (flag-off) tree never calls it.
 */
import * as React from 'react';
import { useColorScheme } from 'nativewind';

import { useTheme } from '../tokens/ThemeProvider';

/**
 * Sets NativeWind's colour scheme to the enclosing `ThemeProvider`'s and returns it. Redesign
 * roots only: it overrides React Native's `Appearance` for the whole app.
 */
export function useHgColorScheme(): 'light' | 'dark' {
  const { scheme } = useTheme();
  const { colorScheme, setColorScheme } = useColorScheme();
  React.useEffect(() => {
    if (colorScheme !== scheme) setColorScheme(scheme);
  }, [scheme, colorScheme, setColorScheme]);
  return scheme;
}

/** `useHgColorScheme` as an element, for a root that renders the provider itself. */
export function HgColorSchemeBridge(): null {
  useHgColorScheme();
  return null;
}
