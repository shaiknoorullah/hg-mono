/**
 * An inline text link in the link role colour, underlined, with the two-layer focus ring and
 * a 44px minimum row height when `block` (a link in a list, such as ErrorSummary's).
 */

import { forwardRef, type AnchorHTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** An `<a>` styled as a text link. */
export const TextLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { block?: boolean }>(
  function TextLink({ className, block = false, ...props }, ref) {
    return (
      <a
        ref={ref}
        data-slot="text-link"
        className={cn(
          'hg-focus rounded-sm text-fg-link underline underline-offset-4',
          block && 'flex min-h-11 items-center px-1 text-body-md',
          className,
        )}
        {...props}
      />
    );
  },
);
