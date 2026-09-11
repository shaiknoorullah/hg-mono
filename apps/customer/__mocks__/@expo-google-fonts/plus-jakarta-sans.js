/**
 * Manual Jest mock for `@expo-google-fonts/plus-jakarta-sans`.
 *
 * The real package's entry re-exports `.ttf` asset modules, which Jest's transformer has no
 * loader for outside a real Metro/Expo build (`SyntaxError: Invalid or unexpected token` on the
 * binary font file). Paired with `__mocks__/expo-font.js`, which no longer reads these values
 * for anything (the mocked `useFonts` reports "loaded" unconditionally) — placeholder strings
 * are enough to satisfy `useHgFonts.ts`'s import.
 */
module.exports = {
  PlusJakartaSans_400Regular: 'PlusJakartaSans_400Regular-mock',
  PlusJakartaSans_500Medium: 'PlusJakartaSans_500Medium-mock',
  PlusJakartaSans_600SemiBold: 'PlusJakartaSans_600SemiBold-mock',
  PlusJakartaSans_700Bold: 'PlusJakartaSans_700Bold-mock',
};
