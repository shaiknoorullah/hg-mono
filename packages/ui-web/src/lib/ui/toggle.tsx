/**
 * shadcn/ui `Toggle` on Radix, styled with our role utilities. A two-state button that carries
 * `aria-pressed`. The design-system `FilterChip` (src/proposed/FilterChip.tsx) is its caller.
 *
 * Pressed is a filled tile (the forest chrome) plus a bold check from the caller, so the state
 * is never colour alone. Never a left border. 44px tall.
 */

import * as TogglePrimitive from '@radix-ui/react-toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** Class recipe for the toggle: a pill chip at 44px. */
export const toggleVariants = cva(
  [
    'hg-focus inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border px-4',
    'text-label-md whitespace-nowrap select-none',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        chip: [
          'border-line-interactive bg-surface-raised text-fg-primary hover:bg-surface-subtle',
          'data-[state=on]:border-surface-chrome data-[state=on]:bg-surface-chrome data-[state=on]:font-semibold data-[state=on]:text-fg-on-accent',
        ],
      },
    },
    defaultVariants: { variant: 'chip' },
  },
);

/** Props of the library toggle. */
export type ToggleProps = ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>;

/** shadcn `Toggle`: Radix Toggle with the recipe applied. */
export const Toggle = forwardRef<ElementRef<typeof TogglePrimitive.Root>, ToggleProps>(function Toggle(
  { className, variant, ...props },
  ref,
) {
  return (
    <TogglePrimitive.Root
      ref={ref}
      data-slot="toggle"
      className={cn(toggleVariants({ variant }), className)}
      {...props}
    />
  );
});
