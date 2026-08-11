import type { CSSProperties } from 'react';
import { cx } from './utils/cx.js';

/**
 * Skeleton — 02-components.md §33.
 *
 * Matches the REAL geometry of what is loading, not a generic grey box.
 * Shimmer neutral.300 → neutral.200 at 1.4s; under reduced motion it falls
 * back to a static tint (handled in globals.css, not here, so the fallback
 * cannot be forgotten at a call site).
 *
 * Non-interactive: no hover, focus, active, disabled or error state. Stated
 * explicitly per rule 0.1.
 *
 * Accessibility: always aria-hidden. The CONTAINING region carries
 * aria-busy="true" and announces "Loading {thing}" once — skeletons never
 * announce individually.
 *
 * Hard rule (§33): any skeleton that will contain a halal seal reserves the
 * seal's slot at full size. `sealSlot` on the `card` variant does that; a card
 * that reflows when the badge arrives makes the badge feel like an afterthought.
 */

export interface SkeletonProps {
  variant?: 'text' | 'circle' | 'rect' | 'card';
  width?: number | string;
  height?: number | string;
  /** `text` only. */
  lines?: number;
  animated?: boolean;
  /** `card` only — reserve the halal seal's slot at full size. */
  sealSlot?: boolean;
  className?: string;
}

const BLOCK = 'rounded-sm bg-skeleton-base';

export function Skeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
  animated = true,
  sealSlot = true,
  className,
}: SkeletonProps) {
  const shimmer = animated ? 'hg-shimmer' : '';
  const style: CSSProperties = { width, height };

  if (variant === 'text') {
    return (
      <span
        aria-hidden="true"
        data-testid="hg-skeleton"
        data-variant="text"
        className={cx('flex flex-col gap-2', className)}
        style={{ width }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={cx(BLOCK, shimmer, 'block h-4')}
            // Last line short, the way real wrapped text ends.
            style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%' }}
          />
        ))}
      </span>
    );
  }

  if (variant === 'circle') {
    const size = width ?? height ?? 40;
    return (
      <span
        aria-hidden="true"
        data-testid="hg-skeleton"
        data-variant="circle"
        className={cx('block rounded-full bg-skeleton-base', shimmer, className)}
        style={{ width: size, height: size }}
      />
    );
  }

  if (variant === 'rect') {
    return (
      <span
        aria-hidden="true"
        data-testid="hg-skeleton"
        data-variant="rect"
        className={cx(BLOCK, shimmer, 'block', className)}
        style={{ ...style, height: height ?? 16 }}
      />
    );
  }

  // card: hero + reserved seal slot + title + two metadata lines.
  return (
    <span
      aria-hidden="true"
      data-testid="hg-skeleton"
      data-variant="card"
      className={cx('flex flex-col gap-3 rounded-lg p-4', className)}
      style={{ width }}
    >
      <span className={cx(BLOCK, shimmer, 'block aspect-video w-full rounded-md')} />
      {sealSlot ? (
        <span
          data-hg-seal-slot="reserved"
          className={cx(BLOCK, shimmer, 'block h-6 w-32 rounded-md')}
        />
      ) : null}
      <span className={cx(BLOCK, shimmer, 'block h-5 w-3/5')} />
      <span className={cx(BLOCK, shimmer, 'block h-4 w-4/5')} />
      <span className={cx(BLOCK, shimmer, 'block h-4 w-2/5')} />
    </span>
  );
}
