/**
 * shadcn/ui `Button`, restyled to HalalGoes roles. The library layer: raw `<button>` and `<a>`
 * live here and nowhere else in the design system. `@hg/ui-web/ds` `Button` and `IconButton`
 * compose these parts and own the behaviour (loading, aria-disabled, badges).
 *
 * Differences from upstream shadcn:
 * - no `success` variant, and the only green is the halal seal (invariant 10, lint L-4);
 * - sizes are our targets: 36 (hit area 44), 44, 52, 60 and the 72px critical size;
 * - focus is the two-layer `hg-focus` ring in `focus-ring` against the page, also on filled
 *   variants (the white "on colour" ring was 1.04:1 on the cream page, #167);
 * - hover and pressed are overlays on the fill, never a second set of colours;
 * - `aria-disabled` (not the `disabled` attribute) drives the disabled look, so a disabled
 *   control stays focusable.
 */

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Class recipe for every button-shaped control (variant, size, tone, shape). */
export const buttonVariants = cva(
  [
    'hg-focus relative isolate inline-flex shrink-0 select-none items-center justify-center',
    'rounded-md border border-transparent font-ui whitespace-nowrap no-underline',
    'transition-[transform,background-color,box-shadow] duration-(--hg-duration-instant) ease-standard',
    'cursor-pointer aria-disabled:cursor-not-allowed aria-busy:cursor-progress',
    'aria-disabled:opacity-(--hg-state-disabled-opacity)',
    // Hover only where a pointer hovers; pressed for mouse, touch and keyboard (data-pressed).
    'not-aria-disabled:not-aria-busy:hover:bg-[image:linear-gradient(var(--hg-state-hover-overlay),var(--hg-state-hover-overlay))]',
    'not-aria-disabled:not-aria-busy:active:bg-[image:linear-gradient(var(--hg-state-pressed-overlay),var(--hg-state-pressed-overlay))]',
    'not-aria-disabled:not-aria-busy:data-pressed:bg-[image:linear-gradient(var(--hg-state-pressed-overlay),var(--hg-state-pressed-overlay))]',
    'not-aria-disabled:not-aria-busy:active:scale-[0.98] not-aria-disabled:not-aria-busy:data-pressed:scale-[0.98]',
    'motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:data-pressed:scale-100',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-action-primary-bg text-action-primary-fg',
        secondary: 'bg-action-secondary-bg text-action-secondary-fg',
        tertiary: 'bg-transparent text-fg-primary border-line-interactive',
        ghost: 'bg-transparent text-fg-primary',
        danger: 'bg-action-danger-bg text-action-danger-fg',
        link: 'bg-transparent text-fg-link underline underline-offset-4 decoration-1',
        // IconButton variants.
        plain: 'bg-transparent text-fg-secondary',
        filled: 'bg-action-primary-bg text-action-primary-fg',
        tonal: 'bg-surface-subtle text-fg-primary',
      },
      size: {
        sm: 'min-h-9 gap-1.5 px-3 text-label-md',
        md: 'min-h-11 gap-2 px-4 text-label-lg',
        lg: 'min-h-13 gap-2 px-5 text-label-lg',
        xl: 'min-h-15 gap-2.5 px-6 text-heading-sm',
        critical: 'min-h-18 gap-2.5 px-6 text-heading-md',
        'icon-sm': 'size-9 p-0',
        'icon-md': 'size-11 p-0',
        'icon-lg': 'size-14 p-0',
      },
      /** `onChrome`: the control sits on the forest chrome (SideNav footer, admin app bar). */
      tone: { default: '', onChrome: '' },
      shape: { square: '', circle: 'rounded-full' },
      /** A 36px control keeps a 44px hit area through an invisible overlay. */
      hit: {
        none: '',
        expand:
          "after:absolute after:top-1/2 after:left-1/2 after:min-h-11 after:min-w-11 after:size-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
      },
    },
    compoundVariants: [
      { variant: 'link', className: 'px-1' },
      { tone: 'onChrome', className: '[--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)]' },
      { tone: 'onChrome', variant: ['tertiary', 'ghost', 'plain', 'tonal'], className: 'text-fg-on-accent' },
      { tone: 'onChrome', variant: 'tertiary', className: 'border-current' },
      { tone: 'onChrome', variant: 'link', className: 'text-fg-on-accent' },
    ],
    defaultVariants: { variant: 'primary', size: 'md', tone: 'default', shape: 'square', hit: 'none' },
  },
);

/** The variant props `buttonVariants` takes. */
export type ButtonVariantProps = VariantProps<typeof buttonVariants>;

/** A `<button>` with the button recipe. `asChild` hands the classes to its only child. */
export interface LibButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {
  asChild?: boolean;
}

/** shadcn `Button`: a native button (or, with `asChild`, its child) with the recipe applied. */
export const Button = forwardRef<HTMLButtonElement, LibButtonProps>(function Button(
  { className, variant, size, tone, shape, hit, asChild = false, type = 'button', ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      data-slot="button"
      {...(asChild ? {} : { type })}
      className={cn(buttonVariants({ variant, size, tone, shape, hit }), className)}
      {...props}
    />
  );
});

/** An `<a>` with the button recipe: link mode, announced as a link. */
export interface LibButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement>, ButtonVariantProps {}

/** A link that looks like a button. Navigation is a link, never a button with a click handler. */
export const ButtonLink = forwardRef<HTMLAnchorElement, LibButtonLinkProps>(function ButtonLink(
  { className, variant, size, tone, shape, hit, ...props },
  ref,
) {
  return (
    <a
      ref={ref}
      data-slot="button"
      className={cn(buttonVariants({ variant, size, tone, shape, hit }), className)}
      {...props}
    />
  );
});
