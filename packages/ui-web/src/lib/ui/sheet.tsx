/**
 * shadcn/ui `Sheet` on Radix Dialog. In `@hg/ui-web` it is only the navigation drawer for
 * narrow or zoomed (200%) admin and restaurant screens: working tasks stay in-page
 * (DetailPanel), never in an overlay. Focus is trapped while open and returns to the trigger
 * on close; Escape closes.
 */

import * as SheetPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../utils.js';

/** State holder. */
export function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

/** The control that opens it (use `asChild` with a design-system IconButton). */
export function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

/** Closes the sheet (use `asChild`). */
export function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

/** The panel, with the scrim behind it. */
export function SheetContent({
  className,
  children,
  side = 'left',
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { side?: 'left' | 'right'; children?: ReactNode }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-[var(--hg-z-sheet)] bg-surface-scrim"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed inset-y-0 z-[var(--hg-z-sheet)] flex w-80 max-w-[85vw] flex-col shadow-e4 outline-none',
          side === 'left' ? 'start-0' : 'end-0',
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

/** The sheet's name (required by Radix for the dialog's accessible name). */
export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn('m-0 text-heading-sm', className)} {...props} />;
}

/** Optional supporting text. */
export function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn('text-body-sm', className)} {...props} />;
}
