/**
 * shadcn/ui `Popover` on Radix, restyled to HalalGoes roles: a raised surface with the
 * decorative border and elevation 3, above page content (`z-dropdown`). Used for anchored
 * pickers (the listbox Select), never for a working task: those are in-page panels.
 */

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** The popover state root. */
export const Popover = PopoverPrimitive.Root;
/** The element the popover opens from. */
export const PopoverTrigger = PopoverPrimitive.Trigger;
/** A positioning anchor other than the trigger. */
export const PopoverAnchor = PopoverPrimitive.Anchor;

/** The popover surface, portalled to the body. */
export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = 'start', sideOffset = 4, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-(--hg-z-dropdown) rounded-md border border-line-decorative bg-popover p-1 text-popover-foreground shadow-e3 outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});
