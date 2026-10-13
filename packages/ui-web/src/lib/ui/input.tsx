/**
 * shadcn/ui `Input`, restyled to HalalGoes roles, plus the field shell every bordered field
 * shares (Input, Select, Textarea, DateInput, MoneyInput).
 *
 * Differences from upstream shadcn:
 * - the border lives on the shell (`fieldShellVariants`), not the `<input>`, so a prefix, an
 *   icon or a spinner sits inside the same 1px `control-border` box;
 * - focus is the field's own border at 2px in the focus colour (`hg-focus-field` in
 *   globals.css), with no ring and no glow; an invalid field keeps its 2px danger border and
 *   takes the two-layer ring when focused (docs/decisions/focus-indicator.md);
 * - sizes are our targets: md 44, lg 52, field 56;
 * - disabled is drawn from `data-disabled`, so the caller can keep the control focusable
 *   (`aria-disabled` + `readOnly`) instead of removing it from the tab order.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type InputHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Class recipe for the bordered box around a field's control. */
export const fieldShellVariants = cva(
  [
    'hg-focus-field relative flex w-full items-center gap-2 rounded-md border bg-surface-raised px-3',
    'transition-colors duration-(--hg-duration-fast) ease-standard motion-reduce:transition-none',
  ],
  {
    variants: {
      size: { md: 'min-h-11', lg: 'min-h-13', field: 'min-h-14' },
      invalid: {
        true: 'border-feedback-danger-border shadow-[inset_0_0_0_1px_var(--hg-feedback-danger-border)]',
        false: 'border-control-border hover:border-control-border-hover',
      },
      disabled: {
        true: 'cursor-not-allowed bg-surface-subtle opacity-(--hg-state-disabled-opacity) hover:border-control-border',
        false: '',
      },
    },
    defaultVariants: { size: 'md', invalid: false, disabled: false },
  },
);

/** The variant props `fieldShellVariants` takes. */
export type FieldShellVariantProps = VariantProps<typeof fieldShellVariants>;

/** A borderless `<input>` that fills its field shell. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={cn(
        'h-full min-w-0 flex-1 self-stretch border-0 bg-transparent p-0 font-ui text-body-md text-fg-primary outline-none',
        'placeholder:text-fg-placeholder read-only:cursor-default aria-disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
});
