/**
 * `Skeleton` — a loading placeholder that keeps the layout's shape (approval packet P2, #191).
 * Built on the shadcn `Skeleton` block.
 *
 * Always `aria-hidden`: the region that is loading carries `aria-busy` and says what is loading,
 * once. Shimmer stops under reduced motion (globals.css). The `card` shape reserves the halal
 * seal's slot at full size, so a card does not reflow when its badge arrives.
 *
 * Takes the packet's `shape` and, unchanged, the pre-rebuild `variant`. `variant` also takes
 * the admin canvases' layouts (#699): `lines` (`count` text lines), `rows` (`count` 44px list
 * rows) and `block` (one block, 120px tall unless `height` says otherwise).
 *
 * `label` is the one exception to "always hidden": for a region that does not already say it
 * is loading, it adds a visually hidden `role="status"` line ("Loading orders"); the shapes
 * themselves stay hidden.
 */

import type { CSSProperties } from 'react';

import { SkeletonBlock } from '../lib/ui/skeleton.js';
import { cn } from '../lib/utils.js';

/** Skeleton shapes. `card` is the pre-rebuild card placeholder. */
export type SkeletonShape = 'text' | 'rect' | 'circle' | 'card';
/** Admin canvas layouts accepted by `variant`: text lines, 44px list rows, or one block. */
export type SkeletonLayout = 'lines' | 'rows' | 'block';

/** Props of the proposed `Skeleton` (packet P2), plus the pre-rebuild ones. */
export interface SkeletonProps {
  /** text (default), rect, circle, or card. */
  shape?: SkeletonShape;
  /** Pre-rebuild name for `shape`, or an admin layout (`lines`, `rows`, `block`). */
  variant?: SkeletonShape | SkeletonLayout;
  width?: number | string;
  height?: number | string;
  /** `text` only: the last line is short, the way wrapped text ends. */
  lines?: number;
  /** `lines` and `rows`: how many. Default 3. */
  count?: number;
  /** Announced once through a visually hidden status line. Omit inside a busy region. */
  label?: string;
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
  lines: linesProp,
  count = 3,
  label,
  animated = true,
  sealSlot = true,
  testId = 'Skeleton',
  style,
  className,
}: SkeletonProps) {
  const layout = shape ?? variant ?? 'text';
  // The admin layouts map onto the packet's shapes; `rows` is its own drawing.
  const kind: SkeletonShape | 'rows' =
    layout === 'lines' ? 'text' : layout === 'block' ? 'rect' : layout;
  const lines = linesProp ?? (layout === 'lines' ? count : 1);

  if (label) {
    // The status line must not sit inside aria-hidden, so wrap the hidden shape.
    return (
      <span data-testid={`${testId}-region`} className={cn(kind === 'text' || kind === 'rows' ? 'block' : 'inline-block', 'w-full')}>
        <span role="status" className="sr-only">
          {label}
        </span>
        <Skeleton
          shape={shape}
          variant={variant}
          width={width}
          height={height}
          lines={linesProp}
          count={count}
          animated={animated}
          sealSlot={sealSlot}
          testId={testId}
          style={style}
          className={className}
        />
      </span>
    );
  }

  const common = { 'aria-hidden': true as const, 'data-testid': testId, 'data-shape': kind };

  if (kind === 'rows') {
    return (
      <span {...common} className={cn('flex flex-col', className)} style={{ width, ...style }}>
        {Array.from({ length: Math.max(1, count) }, (_, i) => (
          <span key={i} className="flex h-11 items-center gap-3 border-b border-line-decorative px-3">
            <SkeletonBlock animated={animated} className="h-3 w-24" />
            <SkeletonBlock animated={animated} className="h-3 flex-1" />
            <SkeletonBlock animated={animated} className="h-3 w-16" />
          </span>
        ))}
      </span>
    );
  }

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
        style={{ width: width ?? (layout === 'block' ? '100%' : undefined), height: height ?? (layout === 'block' ? 120 : 16), ...style }}
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
