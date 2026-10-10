/**
 * A native `<details>` disclosure, for content support needs but people rarely do (ErrorState's
 * "Technical details"). Native, so it works without script and is keyboard-operable for free;
 * the summary is a 44px target with the focus ring.
 */

import type { ComponentProps } from 'react';

import { cn } from '../utils.js';

/** The disclosure container. */
export function Details({ className, ...props }: ComponentProps<'details'>) {
  return <details data-slot="details" className={cn('w-full text-start', className)} {...props} />;
}

/** The always-visible toggle line. */
export function DetailsSummary({ className, ...props }: ComponentProps<'summary'>) {
  return (
    <summary
      data-slot="details-summary"
      className={cn('hg-focus min-h-11 cursor-pointer content-center rounded-sm text-label-md text-fg-secondary', className)}
      {...props}
    />
  );
}
