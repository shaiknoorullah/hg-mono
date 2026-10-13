/**
 * shadcn/ui `ToggleGroup` on Radix, restyled to HalalGoes roles, for the SegmentedControl.
 * With `type="single"` Radix gives each item `role="radio"` + `aria-checked` and a roving
 * tab stop; the caller names the root and gives it `role="radiogroup"`.
 *
 * Two tones, role tokens only: `light` (sunken track, raised selected segment) and `chrome`
 * (on the forest chrome bar; selected segment is the raised surface). Selection is a fill,
 * never a left border. Sizes: sm 36 (44 hit area), md 44, lg 52.
 */

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** Class recipe for the track. */
export const toggleGroupVariants = cva('box-border gap-0.5 rounded-full border p-0.75', {
  variants: {
    tone: {
      light: 'border-line-decorative bg-surface-sunken',
      chrome:
        'border-transparent bg-[color-mix(in_srgb,var(--hg-surface-chrome)_78%,var(--hg-text-primary))] [--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-focus-ring-on-accent)]',
    },
    fullWidth: { true: 'flex w-full', false: 'inline-flex' },
  },
  defaultVariants: { tone: 'light', fullWidth: false },
});

/** Class recipe for one segment. */
export const toggleGroupItemVariants = cva(
  [
    'hg-focus relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-0 font-ui font-semibold',
    'cursor-pointer transition-colors duration-(--hg-duration-fast) ease-standard motion-reduce:transition-none',
    'disabled:cursor-not-allowed disabled:opacity-(--hg-state-disabled-opacity)',
    'data-[state=on]:bg-surface-raised data-[state=on]:text-fg-primary data-[state=on]:shadow-e1',
  ],
  {
    variants: {
      tone: {
        light: 'text-fg-secondary data-[state=off]:hover:bg-[var(--hg-state-hover-overlay)]',
        chrome: 'text-fg-on-accent data-[state=off]:hover:bg-[color-mix(in_srgb,var(--hg-text-on-accent)_12%,transparent)]',
      },
      size: {
        sm: "min-h-9 px-3 text-label-md after:absolute after:top-1/2 after:left-1/2 after:min-h-11 after:min-w-11 after:size-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        md: 'min-h-11 px-4 text-label-lg',
        lg: 'min-h-13 px-4 text-label-lg',
      },
      fullWidth: { true: 'flex-1', false: '' },
    },
    defaultVariants: { tone: 'light', size: 'md', fullWidth: false },
  },
);

/** The Radix toggle group root with the track recipe. */
export const ToggleGroup = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof toggleGroupVariants>
>(function ToggleGroup({ className, tone, fullWidth, ...props }, ref) {
  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      data-slot="toggle-group"
      className={cn(toggleGroupVariants({ tone, fullWidth }), className)}
      {...props}
    />
  );
});

/** One segment. */
export const ToggleGroupItem = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleGroupItemVariants>
>(function ToggleGroupItem({ className, tone, size, fullWidth, ...props }, ref) {
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ tone, size, fullWidth }), className)}
      {...props}
    />
  );
});
