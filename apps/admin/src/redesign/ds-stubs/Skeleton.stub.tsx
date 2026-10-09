/**
 * TEMPORARY stub until @hg/ui-web/ds ships Skeleton (ds-request issue TBD; tracked under #191).
 * Props follow the canvases' drawing ("Skeleton (shadcn Skeleton)", "Skeleton outside tables
 * (the DS .hg-skel style)").
 *
 * Placeholder shapes while something loads: `lines` of text, `rows` of a 44px list, or one
 * `block`. The shapes are hidden from assistive tech; one `role="status"` line carries
 * `label` ("Loading orders"). Motion stops under reduced motion.
 */
import { cx } from './internal/cx';

export interface SkeletonProps {
  /** lines (default) · rows (44px list rows) · block. */
  variant?: 'lines' | 'rows' | 'block';
  /** Number of lines or rows. Default 3. */
  count?: number;
  /** Block size (CSS lengths). */
  width?: string | number;
  height?: string | number;
  /** Announced once, visually hidden. Omit inside a region that already says it is loading. */
  label?: string;
  className?: string;
  testId?: string;
}

const BAR = 'block rounded-sm bg-skeleton-base motion-safe:animate-pulse';

export function Skeleton({ variant = 'lines', count = 3, width, height, label, className, testId = 'Skeleton' }: SkeletonProps): React.JSX.Element {
  return (
    <div data-testid={testId} className={cx('flex flex-col', variant === 'rows' ? 'gap-0' : 'gap-2', className)}>
      {label ? (
        <span role="status" className="sr-only">
          {label}
        </span>
      ) : null}
      <div aria-hidden="true" className="contents">
        {variant === 'block' ? (
          <span className={BAR} style={{ width: width ?? '100%', height: height ?? 120 }} />
        ) : (
          Array.from({ length: count }, (_, i) =>
            variant === 'rows' ? (
              <span key={i} className="flex h-11 items-center gap-3 border-b border-line-decorative px-3">
                <span className={cx(BAR, 'h-3 w-24')} />
                <span className={cx(BAR, 'h-3 flex-1')} />
                <span className={cx(BAR, 'h-3 w-16')} />
              </span>
            ) : (
              <span key={i} className={cx(BAR, 'h-3')} style={{ width: i === count - 1 && count > 1 ? '60%' : (width ?? '100%') }} />
            ),
          )
        )}
      </div>
    </div>
  );
}
