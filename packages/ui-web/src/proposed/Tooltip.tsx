/**
 * `Tooltip` — pointer surfaces only (approval packet P13, #195): the full absolute date behind a
 * short date cell, a label for an icon button. Built on the shadcn `Tooltip` (Radix).
 *
 * Radix makes it hoverable, dismissible with Escape, and reachable without hover through
 * `aria-describedby` on the trigger. It never holds the only copy of information a task needs.
 * The trigger keeps its own states; the tooltip itself is only open or closed.
 *
 * Takes the packet's `side` and, unchanged, the pre-rebuild `placement`, `trigger`, `delay`,
 * `open` and `onOpenChange`. Each tooltip carries its own provider (as current shadcn does), so it
 * works without a `TooltipProvider` above it. `TooltipProvider` stays exported so code written
 * against the pre-rebuild export keeps compiling; it no longer changes the delay.
 */

import type { CSSProperties, ReactElement, ReactNode } from 'react';

import {
  TooltipContent,
  TooltipProvider as LibTooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '../lib/ui/tooltip.js';

/** Props of the proposed `Tooltip` (packet P13), plus the pre-rebuild ones. */
export interface TooltipProps {
  content: ReactNode;
  /** One focusable element: the tooltip describes it. */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Pre-rebuild name for `side`. */
  placement?: 'top' | 'right' | 'bottom' | 'left';
  /** `hover` also opens on keyboard focus; `focus` opens at once. */
  trigger?: 'hover' | 'focus';
  /** Open delay in ms. */
  delay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** data-testid of the bubble; defaults to the component name. */
  testId?: string;
  /** Style of the bubble. */
  style?: CSSProperties;
  className?: string;
}

/** Kept for compatibility with the pre-rebuild export; each Tooltip has its own provider. */
export function TooltipProvider({ children, delayDuration = 300 }: { children: ReactNode; delayDuration?: number }) {
  return (
    <LibTooltipProvider delayDuration={delayDuration} skipDelayDuration={0}>
      {children}
    </LibTooltipProvider>
  );
}

/** A short description of its trigger, on hover and on focus. */
export function Tooltip({
  content,
  children,
  side,
  placement,
  trigger = 'hover',
  delay,
  open,
  onOpenChange,
  testId = 'Tooltip',
  style,
  className,
}: TooltipProps) {
  return (
    <LibTooltipProvider delayDuration={300} skipDelayDuration={0}>
      <TooltipRoot
        delayDuration={trigger === 'focus' ? 0 : delay}
        open={open}
        onOpenChange={onOpenChange}
        disableHoverableContent={false}
      >
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side ?? placement ?? 'top'} data-testid={testId} className={className} style={style}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </LibTooltipProvider>
  );
}
