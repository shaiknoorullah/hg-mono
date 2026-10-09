/**
 * `Skeleton` — a loading placeholder that keeps the layout's shape (approval packet P2, #191).
 * Built on the shadcn `Skeleton` block.
 *
 * Always `aria-hidden`: the region that is loading carries `aria-busy` and says what is loading,
 * once. Shimmer stops under reduced motion (globals.css). The `card` shape reserves the halal
 * seal's slot at full size, so a card does not reflow when its badge arrives.
 *
 * Takes the packet's `shape` and, unchanged, the pre-rebuild `variant`.
 */

import type { CSSProperties } from 'react';

import { SkeletonBlock } from '../lib/ui/skeleton.js';
import { cn } from '../lib/utils.js';

/** Skeleton shapes. `card` is the pre-rebuild card placeholder. */
export type SkeletonShape = 'text' | 'rect' | 'circle' | 'card';

/** Props of the proposed `Skeleton` (packet P2), plus the pre-rebuild ones. */
export interface SkeletonProps {
  /** text (default), rect, circle, or card. */
  shape?: SkeletonShape;
  /** Pre-rebuild name for `shape`. */
  variant?: SkeletonShape;
  width?: number | string;
  height?: number | string;
  /** `text` only: the last line is short, the way wrapped text ends. */
  lines?: number;
  /** Shimmer on (default) or a static tint. */
  animated?: boolean;
  /** `card` only — reserve the halal seal's slot at full size. */
  sealSlot?: boolean;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** A placeholder at the geometry of what is loading. */
export function Skeleton({
  shape,
  variant,
  width,
  height,
  lines = 1,
  animated = true,
  sealSlot = true,
  testId = 'Skeleton',
  style,
  className,
}: SkeletonProps) {
  const kind: SkeletonShape = shape ?? variant ?? 'text';
  const common = { 'aria-hidden': true as const, 'data-testid': testId, 'data-shape': kind };

  if (kind === 'text') {
    return (
      <span {...common} className={cn('flex flex-col gap-2', className)} style={{ width, ...style }}>
        {Array.from({ length: Math.max(1, lines) }, (_, i) => (
          <SkeletonBlock
            key={i}
            animated={animated}
            className="h-4"
            style={{ width: i === lines - 1 && lines > 1 ? '60%' : '100%', height }}
          />
        ))}
      </span>
    );
  }

  if (kind === 'circle') {
    const size = width ?? height ?? 40;
    return (
      <SkeletonBlock
        {...common}
        animated={animated}
        className={cn('rounded-full', className)}
        style={{ width: size, height: size, ...style }}
      />
    );
  }

  if (kind === 'rect') {
    return (
      <SkeletonBlock
        {...common}
        animated={animated}
        className={className}
        style={{ width, height: height ?? 16, ...style }}
      />
    );
  }

  return (
    <span {...common} className={cn('flex flex-col gap-3 rounded-lg p-4', className)} style={{ width, ...style }}>
      <SkeletonBlock animated={animated} className="aspect-video w-full rounded-md" />
      {sealSlot ? <SkeletonBlock animated={animated} data-hg-seal-slot="reserved" className="h-6 w-32 rounded-md" /> : null}
      <SkeletonBlock animated={animated} className="h-5 w-3/5" />
      <SkeletonBlock animated={animated} className="h-4 w-4/5" />
      <SkeletonBlock animated={animated} className="h-4 w-2/5" />
    </span>
  );
}
