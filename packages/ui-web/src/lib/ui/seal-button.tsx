/**
 * A `<button type="button">` around a small visual that must keep a 44px hit area (the pressable
 * halal seal on the detail surface, 32px tall at `lg`): the visual stays its size and an
 * invisible `::after` box grows the target. The look comes from the caller's classes.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** A button whose hit area is at least 44 by 44px, whatever its visual size. */
export const SealButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function SealButton(
  { className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-slot="seal-button"
      className={cn(
        'hg-focus relative cursor-pointer',
        "after:absolute after:top-1/2 after:left-1/2 after:min-h-11 after:min-w-11 after:size-full after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
        className,
      )}
      {...props}
    />
  );
});
