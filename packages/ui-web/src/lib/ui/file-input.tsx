/**
 * A visually hidden `<input type="file">` for the FileDrop: never a tab stop of its own (the
 * visible Upload button opens it), so the dropzone has exactly one control.
 */

import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** The hidden native file picker a design-system button opens. */
export const HiddenFileInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function HiddenFileInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="file"
        data-slot="file-input"
        tabIndex={-1}
        aria-hidden="true"
        className={cn('sr-only', className)}
        {...props}
      />
    );
  },
);
