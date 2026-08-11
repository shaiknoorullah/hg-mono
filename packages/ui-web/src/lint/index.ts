/**
 * Lint rules owned by the foundation tier.
 *
 * L-4 (no green solids) is here because it needs the generated token map to
 * resolve a Tailwind utility or a custom property back to a hex. The other
 * rules in 01-foundations.md §9 belong to the surfaces they police:
 * L-1/L-2 (no raw colour, no ramp steps) and L-7 (no physical properties) run
 * over `apps/**`; L-5 (no float money) runs over the pricing paths; L-6
 * (contrast) is `docs/design/contrast.check.mjs`.
 */

export {
  lintSource,
  lintFile,
  isReservedGreenSolid,
  hsl,
  HALAL_HEXES,
  COLOR_BY_UTILITY,
  ALLOWED_TOKEN_PATHS,
  HUE_MIN,
  HUE_MAX,
  SATURATION_FLOOR,
  SOLID_CONTRAST_MIN,
} from './l4-no-green-solids.js';
export type { L4Violation } from './l4-no-green-solids.js';

export { lintPaths, collectFiles } from './run.js';
