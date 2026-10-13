/**
 * shadcn/ui `ScrollArea` on Radix, styled with our roles. A pane body scrolls inside it so the
 * pane's header and footer stay put. The viewport is focusable (tabIndex 0) when it scrolls, so
 * a keyboard user can scroll a pane that holds no focusable content.
 */

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** A scroll container with a thin token-coloured scrollbar. */
export function ScrollArea({
  className,
  children,
  viewportClassName,
  viewportLabel,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Classes for the scrolling viewport (padding goes here, not on the root). */
  viewportClassName?: string;
  /** Names the viewport when it is a keyboard stop ("Order details, scrollable"). */
  viewportLabel?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        tabIndex={viewportLabel ? 0 : undefined}
        aria-label={viewportLabel}
        role={viewportLabel ? 'region' : undefined}
        className={cn('size-full rounded-[inherit] hg-focus-inset', viewportClassName)}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

/** The scrollbar track and thumb. */
export function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' && 'h-full w-2.5',
        orientation === 'horizontal' && 'h-2.5 flex-col',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-line-interactive"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
