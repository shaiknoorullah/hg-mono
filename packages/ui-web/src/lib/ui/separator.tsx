/**
 * shadcn/ui `Separator` on Radix. `border-decorative` is a documented contrast exemption:
 * a separator carries no information and never bounds a control.
 */

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** A horizontal or vertical rule; decorative (hidden from assistive tech) by default. */
export const Separator = forwardRef<
  ElementRef<typeof SeparatorPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(function Separator({ className, orientation = 'horizontal', decorative = true, ...props }, ref) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-line-decorative',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full min-h-4 w-px',
        className,
      )}
      {...props}
    />
  );
});
