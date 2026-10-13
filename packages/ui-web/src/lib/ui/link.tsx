/**
 * The library link part behind the proposed `TextLink` (#737): an `<a>`, or with `asChild` the
 * one element it wraps (a router's link), styled as a text link in the link role colour with its
 * hover role, the underline, and the two-layer DS focus ring (`hg-focus`).
 *
 * - `inline` sits inside a sentence: weight 600, the sentence's own size, no minimum height
 *   (WCAG 2.5.8 exempts a link inside a line of text).
 * - `standalone` is a link on its own line ("Back to sign in"): weight 500 and a 44px minimum
 *   target, with 4px inside the focus ring (a negative margin keeps the text on the column's
 *   edge). The type style comes from `textStyle`.
 *
 * Raw interactive elements live only in `src/lib/ui`, so the design-system layer renders links
 * through this part.
 */

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type AnchorHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Class recipe for a text link. */
export const linkVariants = cva(
  [
    'hg-focus rounded-xs text-fg-link underline underline-offset-4',
    'hover:text-fg-link-hover visited:text-fg-link',
    'transition-colors duration-(--hg-duration-instant) ease-standard motion-reduce:transition-none',
  ],
  {
    variants: {
      variant: {
        inline: 'font-semibold',
        standalone: '-mx-1 inline-flex min-h-11 items-center self-start px-1 font-medium',
      },
      textStyle: {
        inherit: '',
        'body-sm': 'text-body-sm',
        'body-md': 'text-body-md',
        'label-lg': 'text-label-lg',
        'heading-sm': 'text-heading-sm',
      },
    },
    defaultVariants: { variant: 'inline', textStyle: 'inherit' },
  },
);

/** The variant props `linkVariants` takes. */
export type LinkVariantProps = VariantProps<typeof linkVariants>;

/** Props of the library link part. */
export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, LinkVariantProps {
  /** Style the single child element (a router's link) instead of rendering an `<a>`. */
  asChild?: boolean;
}

/** A text link: an `<a>`, or the child element when `asChild`. */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { className, variant, textStyle, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp
      ref={ref}
      data-slot="link"
      className={cn(linkVariants({ variant, textStyle }), className)}
      {...props}
    />
  );
});
