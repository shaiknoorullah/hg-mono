/**
 * shadcn/ui `Skeleton`: one placeholder block on the `skeleton-base` role, with the shared
 * `hg-shimmer` (globals.css stops it under reduced motion). Always `aria-hidden`: the region
 * that is loading carries `aria-busy` and says what is loading, once.
 */

import type { HTMLAttributes } from 'react';

import { cn } from '../utils.js';

/** Props of one skeleton block. */
export interface SkeletonBlockProps extends HTMLAttributes<HTMLSpanElement> {
  /** Shimmer on (default) or a static tint. */
  animated?: boolean;
}

/** A single skeleton block. Size it with classes or `style`. */
export function SkeletonBlock({ className, animated = true, ...props }: SkeletonBlockProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('block rounded-sm bg-skeleton-base', animated && 'hg-shimmer', className)}
      {...props}
    />
  );
}
