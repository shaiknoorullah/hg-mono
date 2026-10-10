/**
 * `@hg/ui-native/lib` — the React Native Reusables tier (redesign, N0 spike).
 *
 * NativeWind-styled (`className`), so it renders correctly only in an app that wires
 * NativeWind's Babel preset, Metro wrapper and `global.<theme>.css`. Deliberately NOT
 * re-exported from the package root: the StyleSheet components there are what every
 * flag-off screen renders, and the two `Button`s must not collide.
 */
export { cn } from './utils';
export { Button, buttonVariants, buttonTextVariants } from './ui/button';
export type { ButtonProps } from './ui/button';
export { Text, TextClassContext } from './ui/text';
export type { TextProps } from './ui/text';
export { useHgColorScheme, HgColorSchemeBridge } from './useHgColorScheme';
