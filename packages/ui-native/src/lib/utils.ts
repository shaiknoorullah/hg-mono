/**
 * `cn()` — the React Native Reusables class combiner: `clsx` for conditionals, then
 * `tailwind-merge` so a caller's `className` overrides a variant's (`bg-primary` + `bg-muted`
 * keeps `bg-muted`). tailwind-merge 2.x is the Tailwind 3 line, which is what NativeWind 4
 * runs on.
 *
 * The merge is taught the preset's type scale (`text-body-md`, `text-label-lg`, …), named
 * exactly as the generator names them. Without that, tailwind-merge reads `text-body-md` as a
 * COLOUR and drops it as soon as a `text-foreground` follows.
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { tokens } from '../tokens/generated/tokens';

const typeScale = Object.keys(tokens.typography).map((name) => name.replace('.', '-'));

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: typeScale }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
