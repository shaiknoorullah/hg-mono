/**
 * shadcn/ui `Switch` on Radix (`role="switch"` + `aria-checked` on a real button), restyled to
 * HalalGoes roles. Off is `control-track-off`, on is `control-track-on` (brand): never green.
 * Sizes: sm 40×24 and md 48×28, each with a 44px hit area through an invisible overlay. The
 * focus ring is the two-layer `hg-focus` ring on the track.
 */

import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

import { cn } from '../utils.js';

/** Class recipe for the track. */
export const switchVariants = cva(
  [
    'hg-focus peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-0 p-0.75',
    'transition-colors duration-(--hg-duration-base) ease-standard motion-reduce:transition-none',
    'data-[state=checked]:bg-control-track-on data-[state=unchecked]:bg-control-track-off',
    'aria-disabled:cursor-not-allowed aria-busy:cursor-progress',
    "after:absolute after:top-1/2 after:left-1/2 after:min-h-11 after:min-w-11 after:size-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
  ],
  {
    variants: { size: { sm: 'h-6 w-10', md: 'h-7 w-12' } },
    defaultVariants: { size: 'md' },
  },
);

/** The Radix switch with the HalalGoes track; `thumbContent` sits inside the thumb (a spinner). */
export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & VariantProps<typeof switchVariants> & { thumbContent?: ReactNode }
>(function Switch({ className, size, thumbContent, ...props }, ref) {
  return (
    <SwitchPrimitive.Root ref={ref} data-slot="switch" className={cn(switchVariants({ size }), className)} {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none grid place-items-center rounded-full bg-control-thumb text-fg-secondary shadow-e1',
          'transition-transform duration-(--hg-duration-base) ease-standard motion-reduce:transition-none',
          size === 'sm'
            ? 'size-4.5 data-[state=checked]:translate-x-4'
            : 'size-5.5 data-[state=checked]:translate-x-5',
          'data-[state=unchecked]:translate-x-0 rtl:data-[state=checked]:-translate-x-5',
        )}
      >
        {thumbContent}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
});
