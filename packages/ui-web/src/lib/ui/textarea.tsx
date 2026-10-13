/**
 * shadcn/ui `Textarea`, restyled to HalalGoes roles. It carries the field look itself (unlike
 * `Input`, nothing sits beside the text), so the border, focus and invalid treatment from
 * `fieldShellVariants` apply to the `<textarea>` directly.
 */

import { forwardRef, type TextareaHTMLAttributes } from 'react';

import { cn } from '../utils.js';
import { fieldShellVariants, type FieldShellVariantProps } from './input.js';

/** A `<textarea>` in the bordered-field recipe. */
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldShellVariantProps, 'size'>
>(function Textarea({ className, invalid, disabled: drawDisabled, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      data-hg-state={invalid ? 'error' : undefined}
      className={cn(
        fieldShellVariants({ invalid, disabled: drawDisabled }),
        'block min-h-35 resize-y px-3 py-2 font-ui text-body-md text-fg-primary outline-none',
        'placeholder:text-fg-placeholder',
        className,
      )}
      {...props}
    />
  );
});
