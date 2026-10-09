/**
 * Toast parts for the design-system `Toast` (src/ds/Toast.tsx): the in-toast action and the
 * viewport the provider stacks toasts in. Raw interactive elements live here, in the library
 * layer, never in a design-system component.
 *
 * The toast itself is not Radix `Toast.Root`: Radix only renders a toast inside its viewport,
 * and the live design system renders `<Toast>` inline too (its own preview stacks them in a
 * column). The two behaviours Radix gave us are kept by hand in `Toast`: the timer pauses on
 * hover and on focus, and the viewport is a labelled landmark.
 */

import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** The toast's one action ("Undo"): a real 44px button, underlined text in the toast's colour. */
export function ToastAction({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      data-slot="toast-action"
      className={cn(
        'hg-focus min-h-11 shrink-0 self-center rounded-sm bg-transparent px-3 text-label-lg font-semibold text-current underline',
        'cursor-pointer hover:bg-[var(--hg-state-hover-overlay)]',
        className,
      )}
      {...props}
    />
  );
}

/** Where provider toasts stack: a labelled region at the logical end of the viewport. */
export function ToastViewport({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      data-slot="toast-viewport"
      tabIndex={-1}
      className={cn(
        'pointer-events-none fixed end-0 bottom-0 z-(--hg-z-toast) m-0 flex w-full max-w-110 flex-col gap-2 p-4',
        'pb-[max(var(--hg-space-4),env(safe-area-inset-bottom))] [&>*]:pointer-events-auto',
        className,
      )}
      {...props}
    />
  );
}
