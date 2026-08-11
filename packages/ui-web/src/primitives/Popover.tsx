import type { ReactElement, ReactNode } from 'react';
import * as RadixPopover from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { cx } from './utils/cx.js';
import { HG_FOCUS } from './utils/focus.js';

/**
 * Popover — 02-components.md §41.
 *
 * Radix, not hand-rolled. 04-accessibility.md §4.2 requires that focus enters
 * on open, is trapped while open, and RETURNS TO THE TRIGGER on close, and
 * that Escape dismisses. Every one of those is a place where a hand-rolled
 * focus trap leaks; Radix's is the tested implementation.
 *
 * States: closed/open. The trigger keeps its own states. A popover is never
 * itself disabled or in error — the control inside it is.
 */

export interface PopoverProps {
  children: ReactElement;
  content: ReactNode;
  title?: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Renders a real 44px dismiss target inside the panel. */
  dismissible?: boolean;
  className?: string;
}

export function Popover({
  children,
  content,
  title,
  placement = 'bottom',
  align = 'start',
  open,
  defaultOpen,
  onOpenChange,
  dismissible = true,
  className,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{children}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={placement}
          align={align}
          sideOffset={6}
          data-testid="hg-popover"
          role="dialog"
          aria-label={title}
          className={cx(
            'z-(--hg-z-dropdown) w-80 max-w-[calc(100vw-var(--hg-space-8))] rounded-md p-4',
            'border border-line-decorative bg-surface-raised text-body-md text-fg-primary shadow-e3',
            className,
          )}
        >
          {title || dismissible ? (
            <div className="mb-2 flex items-start justify-between gap-2">
              {title ? (
                <h2 className="text-heading-sm text-fg-primary">{title}</h2>
              ) : (
                <span />
              )}
              {dismissible ? (
                <RadixPopover.Close
                  aria-label="Close"
                  className={cx(
                    'inline-flex size-11 shrink-0 items-center justify-center rounded-sm',
                    'text-fg-tertiary hover:bg-[var(--hg-state-hover-overlay)]',
                    HG_FOCUS,
                  )}
                >
                  <X aria-hidden="true" size={20} />
                </RadixPopover.Close>
              ) : null}
            </div>
          ) : null}
          {content}
          <RadixPopover.Arrow className="fill-[var(--hg-surface-raised)]" />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
