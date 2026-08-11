import type { ReactElement, ReactNode } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cx } from './utils/cx.js';

/**
 * Tooltip — 02-components.md §41.
 *
 * Pointer surfaces only (restaurant web, admin). The RN apps use inline
 * helperText or a Sheet — hover does not exist there and long-press discovery
 * is unreliable.
 *
 * Radix, not hand-rolled, because WCAG 1.4.13 requires the content to be
 * hoverable, dismissible and persistent, and because the content must reach
 * `aria-describedby` on the trigger so it is available WITHOUT hover. Radix
 * wires both; a hand-rolled title-on-hover does neither.
 *
 * NEVER the sole location of information required to complete a task.
 *
 * States: the tooltip itself has closed/open only. The trigger keeps its own
 * states. It is never disabled, never loading, never in error.
 */

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  /** `hover` implies focus as well — Radix opens on keyboard focus regardless. */
  trigger?: 'hover' | 'focus';
  delay?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** Wrap the app (or the pointer-surface subtree) once. */
export function TooltipProvider({
  children,
  delayDuration = 300,
}: {
  children: ReactNode;
  delayDuration?: number;
}) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={0}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  placement = 'top',
  trigger = 'hover',
  delay,
  open,
  onOpenChange,
  className,
}: TooltipProps) {
  return (
    <RadixTooltip.Root
      delayDuration={trigger === 'focus' ? 0 : delay}
      open={open}
      onOpenChange={onOpenChange}
      // Escape closes; the content stays reachable via aria-describedby.
      disableHoverableContent={false}
    >
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={placement}
          sideOffset={6}
          data-testid="hg-tooltip"
          className={cx(
            'z-(--hg-z-dropdown) max-w-72 rounded-md px-3 py-2',
            'bg-surface-inverse text-body-sm text-fg-on-inverse shadow-e3',
            className,
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-[var(--hg-surface-inverse)]" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
