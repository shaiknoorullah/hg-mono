/**
 * Test double for `expo-font`. Jest runs neither the native module registry nor a browser, so
 * the real package (which resolves through `expo-modules-core`'s native `EventEmitter`) cannot
 * load. `useHgFonts()` (`@hg/ui-native/fonts`) only calls `useFonts`, so only that is stubbed —
 * returning "loaded" immediately means App.tsx's font gate never blocks a test render, matching
 * a real device once the four faces resolve.
 */
export function useFonts(): [boolean, Error | null] {
  return [true, null];
}
