/**
 * shadcn/ui `Tooltip` on Radix. Radix makes the content hoverable, dismissible with Escape and
 * reachable through `aria-describedby` on the trigger (WCAG 1.4.13). The tooltip is never the
 * only place information lives. Inverse surface, our type and elevation.
 */

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** Shares the open delay between tooltips. Wrap a pointer surface once. */
export const TooltipProvider = TooltipPrimitive.Provider;
/** One tooltip's state. */
export const TooltipRoot = TooltipPrimitive.Root;
/** The element the tooltip describes; use `asChild` with a focusable child. */
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** The floating bubble, portalled, with an arrow. */
export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'z-(--hg-z-dropdown) max-w-72 rounded-md px-3 py-2',
          'bg-surface-inverse text-body-sm text-fg-on-inverse shadow-e3',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-surface-inverse" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
