/**
 * shadcn/ui `DropdownMenu` on Radix, styled with our role utilities. The design-system `Menu`
 * (src/ds/Menu.tsx) is the only intended caller; it owns the trigger so the menu-button wiring
 * (aria-haspopup, aria-expanded, aria-controls, a unique name) cannot be forgotten.
 *
 * Differences from stock shadcn, all from the live Menu README (owner decision C-25):
 * - rows are at least 44px (`target.min`);
 * - the highlighted row gets the hover overlay, never a left border;
 * - a destructive row is danger TEXT, never a fill;
 * - a disabled row stays focusable (`aria-disabled`) so its reason can be read. Radix's own
 *   `disabled` would skip it in the roving focus, so callers pass `unavailable` instead, which keeps it
 *   focusable and refuses activation.
 */

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentProps, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** The Radix root: open state, modality. */
export const DropdownMenu = DropdownMenuPrimitive.Root;
/** Portals the popup to the end of `body`. */
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
/** A group of `menuitemradio` rows sharing one value. */
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/** Trigger looks: icon-only or text, plain / tonal / filled. */
export const dropdownMenuTriggerVariants = cva(
  [
    'hg-focus inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md',
    'border text-label-lg font-semibold select-none',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        plain: 'border-transparent bg-transparent text-fg-primary hover:bg-[var(--hg-state-hover-overlay)]',
        tonal: 'border-transparent bg-surface-subtle text-fg-primary hover:bg-[var(--hg-state-hover-overlay)]',
        filled: 'border-transparent bg-action-primary-bg text-action-primary-fg hover:bg-action-primary-bg-pressed',
      },
      text: {
        true: 'border-line-interactive px-3',
        false: 'p-0',
      },
    },
    defaultVariants: { variant: 'plain', text: false },
  },
);

/** The menu button. `aria-disabled` keeps it focusable while refusing to open. */
export const DropdownMenuTrigger = forwardRef<
  ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger> & VariantProps<typeof dropdownMenuTriggerVariants>
>(function DropdownMenuTrigger({ className, variant, text, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      data-slot="dropdown-menu-trigger"
      className={cn(dropdownMenuTriggerVariants({ variant, text }), className)}
      {...props}
    />
  );
});

/** The popup (`role="menu"`), placed with logical start/end alignment. */
export function DropdownMenuContent({
  className,
  sideOffset = 4,
  portal = true,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content> & { portal?: boolean }) {
  const content = (
    <DropdownMenuPrimitive.Content
      data-slot="dropdown-menu-content"
      sideOffset={sideOffset}
      className={cn(
        'z-(--hg-z-dropdown) min-w-52 overflow-hidden rounded-md border border-line-decorative bg-surface-raised p-1',
        'text-fg-primary shadow-e3',
        className,
      )}
      {...props}
    />
  );
  return portal ? <DropdownMenuPrimitive.Portal>{content}</DropdownMenuPrimitive.Portal> : content;
}

const ITEM =
  'hg-focus-inset relative flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-3 text-start text-body-md outline-none select-none data-[highlighted]:bg-[var(--hg-state-hover-overlay)]';

/** One `menuitem`. `destructive` is danger text; `unavailable` is aria-disabled and cannot be chosen. */
export function DropdownMenuItem({
  className,
  destructive = false,
  unavailable = false,
  onSelect,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.Item>, 'disabled'> & { destructive?: boolean; unavailable?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-destructive={destructive || undefined}
      aria-disabled={unavailable || undefined}
      className={cn(
        ITEM,
        destructive ? 'text-feedback-danger-text' : 'text-fg-primary',
        unavailable && 'cursor-not-allowed',
        className,
      )}
      onSelect={(event) => {
        if (unavailable) {
          // Stays open and focused: the reason is still being read.
          event.preventDefault();
          return;
        }
        onSelect?.(event);
      }}
      {...props}
    />
  );
}

/** One `menuitemradio` (aria-checked) inside a `DropdownMenuRadioGroup`. */
export function DropdownMenuRadioItem({
  className,
  unavailable = false,
  onSelect,
  children,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, 'disabled'> & { unavailable?: boolean }) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      aria-disabled={unavailable || undefined}
      className={cn(ITEM, 'ps-9 text-fg-primary', unavailable && 'cursor-not-allowed', className)}
      onSelect={(event) => {
        if (unavailable) {
          event.preventDefault();
          return;
        }
        onSelect?.(event);
      }}
      {...props}
    >
      <span aria-hidden="true" className="absolute start-3 inline-flex size-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <span className="block size-2 rounded-full bg-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

/** A `role="separator"` rule between groups of rows. */
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('my-1 h-px bg-line-decorative', className)}
      {...props}
    />
  );
}
