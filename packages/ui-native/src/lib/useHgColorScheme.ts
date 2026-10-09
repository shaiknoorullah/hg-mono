/**
 * Keeps NativeWind's colour scheme (which `:root` / `.dark:root` block of `global.<theme>.css`
 * `className` utilities resolve against) in step with `ThemeProvider`'s, which every
 * StyleSheet component reads through `useTheme()`.
 *
 * Pass it the same `scheme` you pass `ThemeProvider`:
 *   - a fixed `'light'` / `'dark'` pins NativeWind to it;
 *   - `undefined` (ThemeProvider follows the phone) hands NativeWind back to the system, so both
 *     follow the OS together.
 *
 * Redesign roots only: NativeWind's `setColorScheme` also sets React Native's `Appearance`
 * override for the whole app, which is why the legacy (flag-off) tree never calls it.
 */
import * as React from 'react';
import { useColorScheme } from 'nativewind';

/**
 * Sets NativeWind's colour scheme from the `scheme` given to `ThemeProvider` (`undefined` means
 * follow the system) and returns the scheme NativeWind now resolves.
 */
export function useHgColorScheme(scheme?: 'light' | 'dark'): 'light' | 'dark' {
  const { colorScheme, setColorScheme } = useColorScheme();
  // Following the system is NativeWind's default, so only a pin (or leaving one) calls it.
  const pinned = React.useRef(false);
  React.useEffect(() => {
    if (scheme) {
      setColorScheme(scheme);
      pinned.current = true;
    } else if (pinned.current) {
      setColorScheme('system');
      pinned.current = false;
    }
  }, [scheme, setColorScheme]);
  return scheme ?? (colorScheme === 'dark' ? 'dark' : 'light');
}

/** `useHgColorScheme` as an element, for a root that renders `ThemeProvider` itself. */
export function HgColorSchemeBridge({ scheme }: { scheme?: 'light' | 'dark' }): null {
  useHgColorScheme(scheme);
  return null;
}
