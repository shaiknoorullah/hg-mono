import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Our font-size scale, from @hg/ui-web's generated theme plus the marketing
 * roles in styles/marketing-tokens.css.
 *
 * tailwind-merge has to be told about these. Its default config knows only
 * Tailwind's built-in sizes (text-sm, text-lg, …), so an unknown `text-*` is
 * classified as a text COLOUR — which means passing `text-label-lg` to a
 * shadcn Button silently deleted its `text-primary-foreground` as a conflict,
 * and the label fell back to inheriting the page colour.
 *
 * That was not theoretical: the header CTA measured 4.46:1 in light and 3.07:1
 * in dark, both under AA, because the dark ink we chose for the orange had been
 * dropped. Teaching the merger the scale fixes every such collision at once
 * rather than one className at a time.
 */
const FONT_SIZES = [
  'display-lg',
  'display-md',
  'heading-xl',
  'heading-lg',
  'heading-md',
  'heading-sm',
  'body-lg',
  'body-md',
  'body-sm',
  'label-lg',
  'label-md',
  'label-sm',
  'caption',
  'mono-md',
  'mono-sm',
  'marketing-hero',
  'marketing-hero-phone',
  'marketing-section',
  'marketing-section-phone',
  'marketing-lede',
  'marketing-lede-phone',
  'marketing-eyebrow',
  'marketing-eyebrow-phone',
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
    },
  },
});

/**
 * The class merger the shadcn components expect. twMerge is the load-bearing
 * half: it resolves Tailwind conflicts by group, so passing `h-14` to a Button
 * whose variant sets `h-9` REPLACES the height rather than relying on source
 * order — which is what makes "a base component styled to our requirements"
 * work without fighting specificity.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
