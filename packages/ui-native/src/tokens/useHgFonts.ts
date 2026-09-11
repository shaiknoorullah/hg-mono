/**
 * `useHgFonts` — loads Plus Jakarta Sans via `expo-font`, the RN counterpart to web's
 * `--hg-font-ui` (`packages/ui-web/src/styles/globals.css`, backed by
 * `@fontsource-variable/plus-jakarta-sans`).
 *
 * Published at its own subpath (`@hg/ui-native/fonts`), NOT re-exported from the package root
 * or from `./tokens`: `expo-font` and `@expo-google-fonts/plus-jakarta-sans` are both optional
 * peer dependencies (a multi-megabyte asset package), and importing this module is what pulls
 * them into a consumer's module graph. An app that has not installed them should be able to
 * import anything else from `@hg/ui-native` without Metro failing to resolve a font package it
 * never asked for.
 *
 * Usage, once at the app root, before the splash screen is dismissed:
 *
 *   import { useHgFonts } from '@hg/ui-native/fonts';
 *
 *   function Root() {
 *     const { fontsLoaded, fontError } = useHgFonts();
 *     if (!fontsLoaded) return null; // keep the Expo splash screen up
 *     if (fontError) { ... }         // render is still safe: RN falls back to the system font
 *     return <ThemeProvider>...</ThemeProvider>;
 *   }
 *
 * The four face names loaded here (`PlusJakartaSans_400Regular` etc.) are exactly the strings
 * `ThemeProvider.tsx`'s `UI_FAMILY_BY_WEIGHT` emits into every `typeStyle()` result — the two
 * files must agree on spelling, which is why both are owned by this package rather than left to
 * each app to wire separately.
 *
 * NOT RUNTIME-VERIFIED. There is no Expo dev client in this environment (CLAUDE.md §8 — the
 * compose stack has never been brought up either, same constraint), so this has been checked
 * for correct typing and correct `expo-font`/`@expo-google-fonts` API usage only. The first real
 * test is an Expo dev build calling `useHgFonts()`.
 */
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

/**
 * The exact face-name -> asset-module map handed to `expo-font`'s `useFonts`. Exported so an app
 * that wants to fold this into a larger `useFonts({ ...HG_UI_FONTS, ...otherStuff })` call (e.g.
 * to load a brand wordmark font alongside it) does not have to re-list these four by hand.
 */
export const HG_UI_FONTS = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} as const;

export interface UseHgFontsResult {
  /** `true` once all four weights are registered with the RN font system. */
  fontsLoaded: boolean;
  /** Set if `expo-font` failed to load a face. Rendering is still safe (system-font fallback). */
  fontError: Error | null;
}

export function useHgFonts(): UseHgFontsResult {
  const [fontsLoaded, fontError] = useFonts(HG_UI_FONTS);
  return { fontsLoaded, fontError: fontError ?? null };
}
