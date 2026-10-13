/**
 * The skip link anchor: off-screen until focused, then a raised 44px tile with the focus ring
 * at the top-start corner of the page (canvas `admin/staff/SkipLinkFocus`, ".hg-skip").
 */

import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** An in-page link that is visible only while it has keyboard focus. */
export function SkipLinkAnchor({ className, ...props }: ComponentProps<'a'>) {
  return (
    <a
      data-slot="skip-link"
      className={cn(
        'absolute start-4 top-3 z-[var(--hg-z-modal)] inline-flex min-h-11 items-center rounded-md px-4',
        'bg-surface-raised text-label-lg font-semibold text-fg-primary no-underline shadow-e2',
        // Off-screen (not display:none, so it stays in the tab order) until focused.
        'not-focus:sr-only',
        'hg-focus',
        className,
      )}
      {...props}
    />
  );
}
