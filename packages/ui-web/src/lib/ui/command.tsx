/**
 * shadcn/ui `Command` on cmdk, restyled to HalalGoes roles. cmdk gives the combobox pattern:
 * the input is `role="combobox"` with `aria-activedescendant`, the list is `role="listbox"`,
 * items are `role="option"`, and ArrowUp/ArrowDown, Home/End and Enter work from the root.
 *
 * The highlighted option is drawn as a 2px inset brand outline over the hover wash, never as a
 * left border (constitution: fills, not left borders). Options are at least 44px tall.
 */

import { Command as CommandPrimitive } from 'cmdk';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '../utils.js';

/** The cmdk root: owns the highlighted value and the keyboard model. */
export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(function Command({ className, ...props }, ref) {
  return (
    <CommandPrimitive
      ref={ref}
      data-slot="command"
      className={cn('flex w-full flex-col text-fg-primary outline-none', className)}
      {...props}
    />
  );
});

/** The filter field, styled as a small bordered field inside the popover. */
export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(function CommandInput({ className, ...props }, ref) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="hg-focus-field mb-1 flex min-h-11 items-center gap-2 rounded-md border border-control-border bg-surface-raised px-2"
    >
      <CommandPrimitive.Input
        ref={ref}
        data-slot="command-input"
        className={cn(
          'h-10 min-w-0 flex-1 border-0 bg-transparent p-0 font-ui text-body-md text-fg-primary outline-none placeholder:text-fg-placeholder',
          className,
        )}
        {...props}
      />
    </div>
  );
});

/** The listbox, scrolling past 280px. */
export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(function CommandList({ className, ...props }, ref) {
  return (
    <CommandPrimitive.List
      ref={ref}
      data-slot="command-list"
      className={cn('max-h-70 overflow-y-auto overscroll-contain outline-none', className)}
      {...props}
    />
  );
});

/** Shown by cmdk when the filter matches nothing. */
export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(function CommandEmpty({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Empty
      ref={ref}
      data-slot="command-empty"
      className={cn('p-3 text-body-sm text-fg-secondary', className)}
      {...props}
    />
  );
});

/** A labelled group of options (`role="group"`, heading in label-sm). */
export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(function CommandGroup({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Group
      ref={ref}
      data-slot="command-group"
      className={cn(
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1',
        '[&_[cmdk-group-heading]]:text-label-sm [&_[cmdk-group-heading]]:text-fg-secondary',
        className,
      )}
      {...props}
    />
  );
});

/** One option. `data-selected` is cmdk's highlight; `aria-selected` follows it. */
export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(function CommandItem({ className, ...props }, ref) {
  return (
    <CommandPrimitive.Item
      ref={ref}
      data-slot="command-item"
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-body-md outline-none select-none',
        'data-[selected=true]:bg-[var(--hg-state-hover-overlay)] data-[selected=true]:shadow-[inset_0_0_0_2px_var(--hg-focus-ring-color)]',
        'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-(--hg-state-disabled-opacity)',
        className,
      )}
      {...props}
    />
  );
});
