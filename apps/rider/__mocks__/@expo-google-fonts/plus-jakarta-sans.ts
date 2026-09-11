/**
 * Test double for `@expo-google-fonts/plus-jakarta-sans`. The real package's exports are asset
 * module ids (numbers `require()`d from `.ttf` files) that only resolve under Metro; under Jest
 * these four names just need to exist as keys, since the paired `expo-font` mock never inspects
 * their values.
 */
export const PlusJakartaSans_400Regular = 1;
export const PlusJakartaSans_500Medium = 2;
export const PlusJakartaSans_600SemiBold = 3;
export const PlusJakartaSans_700Bold = 4;
