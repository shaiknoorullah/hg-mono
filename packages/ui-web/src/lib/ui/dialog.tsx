/**
 * shadcn/ui `Dialog` on Radix, styled with our role utilities. The design-system `Modal`
 * (src/ds/Modal.tsx) is the intended caller, for confirm and alert on web (no modals for working
 * tasks: those are in-page panels, constitution gate item 11).
 *
 * Radix supplies the focus trap, Escape, `aria-modal`, the title/description wiring and the
 * return of focus to the trigger on close. Two additions:
 * - `contained` positions the scrim and panel inside the nearest positioned ancestor and skips
 *   the portal (docs and previews);
 * - the content takes a `role` override, so a confirm or alert is an `alertdialog`.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** The Radix root: open state and `onOpenChange`. */
export const Dialog = DialogPrimitive.Root;
/** The accessible name (aria-labelledby). */
export const DialogTitle = DialogPrimitive.Title;
/** The accessible description (aria-describedby). */
export const DialogDescription = DialogPrimitive.Description;

/** Scrim plus panel. `contained` renders in place, absolutely positioned, without a portal. */
export function DialogContent({
  className,
  contained = false,
  overlayClassName,
  overlayTestId,
  onOverlayClick,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  contained?: boolean;
  overlayClassName?: string;
  overlayTestId?: string;
  /** Called when the scrim itself is clicked (Radix already closes on an outside pointer-down). */
  onOverlayClick?: () => void;
}) {
  const position = contained ? 'absolute' : 'fixed';
  const body = (
    <>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        data-testid={overlayTestId}
        onClick={onOverlayClick}
        className={cn(position, 'inset-0 z-(--hg-z-modal) bg-surface-scrim', overlayClassName)}
      />
      <div className={cn(position, 'pointer-events-none inset-0 z-(--hg-z-modal) grid place-items-center p-4')}>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'pointer-events-auto max-h-full w-full overflow-auto rounded-xl bg-surface-raised p-6 text-fg-primary shadow-e4 outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </>
  );
  return contained ? body : <DialogPrimitive.Portal>{body}</DialogPrimitive.Portal>;
}
