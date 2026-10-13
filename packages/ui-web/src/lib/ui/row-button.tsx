/**
 * A full-width, unpadded row button (44px minimum) for list rows whose content draws itself,
 * such as a Stepper step: no fill of its own, the hover overlay and the two-layer focus ring.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** A `<button type="button">` that fills its row. */
export const RowButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function RowButton(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="row-button"
      className={cn(
        'hg-focus flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md border-0 bg-transparent p-0 text-start font-ui',
        'hover:bg-[var(--hg-state-hover-overlay)]',
        className,
      )}
      {...props}
    />
  );
});
