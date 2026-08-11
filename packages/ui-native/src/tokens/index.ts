/**
 * `@hg/ui-native/tokens` — the design system, generated.
 *
 * `tokens` is a faithful mirror of `docs/design/tokens.json`; `themes` is the derived
 * customer/rider × light/dark role map the primitives consume. Both come out of
 * `pnpm --filter @hg/ui-native generate:tokens` and are guarded by a drift test, so the
 * only way to change a value in this library is to change the design document.
 *
 * Lint L-1 (no raw colour) and L-2 (roles, never ramp steps) both assume this is the only
 * door: a component that needs a colour imports a role from here, or it is wrong.
 */

import { tokens as generatedTokens } from './generated/tokens';

export { tokens } from './generated/tokens';

/**
 * The theme-independent scales, unpacked for call sites that want `space['4']` rather than
 * `tokens.space['4']`. `palette` is the raw ramps — theme files only; components read roles
 * (lint L-2).
 */
export const palette = generatedTokens.color;
export const space = generatedTokens.space;
export const radius = generatedTokens.radius;
export const icon = generatedTokens.icon;
export const target = generatedTokens.target;
export const zIndex = generatedTokens.zIndex;
export const motion = generatedTokens.motion;
export const density = generatedTokens.density;
export const breakpoint = generatedTokens.breakpoint;
export const font = generatedTokens.font;
export const typography = generatedTokens.typography;

export type {
  Tokens,
  Roles,
  TypographyToken,
  SpaceToken,
  RadiusToken,
  IconSizeToken,
  DensityMode,
} from './generated/tokens';

export { themes, feedbackRole } from './generated/themes';
export type {
  Themes,
  Theme,
  ThemeName,
  ColorScheme,
  ThemeColors,
  SurfaceRole,
  TextRole,
  BorderRole,
  TypeStyle,
  FeedbackRole,
  FeedbackName,
} from './generated/themes';

export { themeVars } from './generated/vars';
export type { ThemeVars } from './generated/vars';

export {
  ThemeProvider,
  useTheme,
  typeStyle,
  useTypeStyle,
  tabularNumbers,
  elevationStyle,
  focusRing,
  useFontScale,
  useReducedMotion,
  useDuration,
} from './ThemeProvider';
export type { ThemeProviderProps, TypeName, ElevationLevel } from './ThemeProvider';
