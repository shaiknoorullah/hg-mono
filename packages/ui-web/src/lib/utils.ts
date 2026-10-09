/**
 * `cn()` — the class-name joiner every shadcn/ui component in `src/lib/ui`
 * calls: clsx for the conditionals, tailwind-merge so a later class wins over
 * an earlier one of the same kind (`px-2` then `px-4` keeps `px-4`).
 *
 * tailwind-merge only knows Tailwind's default theme. Our theme names its own
 * type styles (`text-body-md`, `text-label-lg`, …), shadows (`shadow-e1`),
 * easings and density spacing, and an unknown `text-*` reads as a COLOUR. Left
 * alone, `cn('text-body-md', 'text-fg-primary')` would drop the type style as
 * a colour clash. So the merge config is extended with our names — read from
 * the generated tokens, never listed by hand, so a new type style needs no
 * edit here.
 */

import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { density, elevation, motion, typography } from '../tokens/tokens.js';

const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** `typography.body.md` → `body-md`: the name theme.css gives the type style. */
function typeStyleNames(tree: Record<string, unknown>, prefix = ''): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const name = prefix ? `${prefix}-${kebab(key)}` : kebab(key);
    if (value && typeof value === 'object' && 'fontSize' in value) names.push(name);
    else if (value && typeof value === 'object')
      names.push(...typeStyleNames(value as Record<string, unknown>, name));
  }
  return names;
}

/** Font-size utilities: `text-<name>` (theme.css `--text-<name>`). */
export const TYPE_STYLES: readonly string[] = typeStyleNames(typography);
/** Shadow utilities: `shadow-e<key>` (theme.css `--shadow-e<key>`). */
const SHADOWS = Object.keys(elevation).map((k) => `e${kebab(k)}`);
/** Easing utilities: `ease-<name>`. */
const EASINGS = Object.keys(motion.easing).map(kebab);
/** Spacing utilities from shadcn.css: `h-density-row-height`, `p-density-card-padding`, … */
const DENSITY_SPACING = Object.keys(Object.values(density)[0] ?? {}).map(
  (k) => `density-${kebab(k)}`,
);

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...TYPE_STYLES],
      shadow: SHADOWS,
      ease: EASINGS,
      spacing: DENSITY_SPACING,
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
