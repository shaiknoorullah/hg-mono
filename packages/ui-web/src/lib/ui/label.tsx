/**
 * shadcn/ui `Label` on Radix, restyled to HalalGoes roles: label-md in text-secondary, the
 * field label the live design system draws above every field. A required field gets a
 * decorative asterisk; `required` on the control itself is what assistive tech reads.
 */

import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** A `<label>` in the field-label type style. */
export function Label({
  className,
  required,
  children,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root> & { required?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-label-md font-semibold text-fg-secondary', className)}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="text-line-brand">
          {' *'}
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
}
