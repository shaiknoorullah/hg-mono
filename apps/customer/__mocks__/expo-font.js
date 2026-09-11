/**
 * Manual Jest mock for `expo-font`.
 *
 * `expo-font` pulls in `expo-modules-core`'s native `EventEmitter`, which only exists under a
 * real Expo native/dev-client runtime (or the `jest-expo` preset, not used in this repo — see
 * `jest.config.cjs`). This app's plain `react-native` jest preset has no such native module, so
 * importing `expo-font` at the App root (`useHgFonts()`, wired per CLAUDE.md's design-system
 * sweep) throws `Cannot read properties of undefined (reading 'EventEmitter')` before any test
 * body runs.
 *
 * Auto-applied by Jest for every `import ... from 'expo-font'` in this package (no `jest.mock()`
 * call needed — Jest auto-mocks node_modules packages that have a same-named file under
 * `<rootDir>/__mocks__/`). `useFonts` resolves as "already loaded" so screens render past the
 * font gate in `App.tsx` immediately; this only stands in for the *jest environment's* missing
 * native module, not for `useHgFonts()`'s real behaviour, which is unverified here the same way
 * `packages/ui-native/src/tokens/useHgFonts.ts`'s own docstring already flags it — the first real
 * test is an Expo dev build.
 */
module.exports = {
  useFonts: () => [true, null],
  loadAsync: () => Promise.resolve(),
  isLoaded: () => true,
};
