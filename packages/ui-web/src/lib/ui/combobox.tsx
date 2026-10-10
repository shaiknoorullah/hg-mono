/**
 * The shadcn combobox trigger: a borderless button that fills its field shell and opens the
 * listbox popover (`role="combobox"` is set by the caller with `aria-expanded` and
 * `aria-controls`). Room is left at the end for the chevron.
 */

import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** The button inside a listbox Select's field shell. */
export const ComboboxTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function ComboboxTrigger({ className, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        data-slot="combobox-trigger"
        className={cn(
          'flex h-full min-w-0 flex-1 cursor-pointer items-center self-stretch border-0 bg-transparent p-0 pe-8 text-start',
          'font-ui text-body-md outline-none aria-disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    );
  },
);
