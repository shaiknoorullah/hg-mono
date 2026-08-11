/**
 * The certification and content tiers' single doorway to `src/tokens`.
 *
 * Why it exists, and why it lives under `certification/`:
 *
 *  - Concentrating every read of the generated token package in one file means a change
 *    there is a one-file fix here rather than a sweep through fifteen components.
 *  - The content tier already depends on the certification tier (`RestaurantCard` renders
 *    `HalalBadge`, C-09 card anatomy), so putting the shared adapter here keeps the
 *    dependency edge pointing one way: content → certification → tokens. A copy under
 *    `content/` would have created a second edge back.
 *
 * It re-exports the theme runtime rather than wrapping it — the primitives use the same
 * `useTheme`/`useTypeStyle`/`focusRing`, and two tiers resolving a colour by different
 * routes is how a design system drifts. What it adds is the handful of raw scales that live
 * on `tokens` rather than on `Theme` (`space`, `radius`, `icon`).
 *
 * Nothing here touches `color.halal.*`. That namespace is reachable only through
 * `./halalTokens`, which only `HalalBadge` and `HalalCertificationPanel` import (lint L-3).
 */
export {
  elevationStyle as elevation,
  focusRing,
  tabularNumbers,
  typeStyle,
  useDuration,
  useFontScale,
  useReducedMotion,
  useTheme,
  useTypeStyle,
} from '../../tokens';
export type { ColorScheme, ElevationLevel, Theme, TypeName } from '../../tokens';

import { tokens } from '../../tokens';

/** Raw scales. These are theme-independent and therefore not on `Theme`. */
export const space = tokens.space;
export const radius = tokens.radius;
export const iconSize = tokens.icon;
export const target = tokens.target;
