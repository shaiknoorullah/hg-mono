/**
 * shadcn/ui `NativeSelect`: a real `<select>` inside the field shell, so phones get the
 * platform picker. The chevron is the caller's (an Icon), drawn over the trailing padding.
 */

import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** A borderless `<select>` that fills its field shell, with room for a trailing chevron. */
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, ...props }, ref) {
    return (
      <select
        ref={ref}
        data-slot="native-select"
        className={cn(
          'h-full min-w-0 flex-1 self-stretch appearance-none border-0 bg-transparent py-0 ps-0 pe-8',
          'font-ui text-body-md text-fg-primary outline-none cursor-pointer aria-disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />
    );
  },
);
