import * as RadixSeparator from '@radix-ui/react-separator';
import { cx } from './utils/cx.js';

/**
 * Divider — 02-components.md §40.
 *
 * Uses `border.decorative`, which is a documented contrast exemption (1.28:1)
 * precisely because a divider carries no information and never delimits an
 * interactive control. Anything that bounds a control uses `border.interactive`.
 *
 * aria-hidden unless it carries a `label`, in which case it is a real
 * separator with an accessible name.
 *
 * Non-interactive: no hover/focus/active/disabled/loading/error states.
 */

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical';
  /** Indents the rule by the default gutter, for list groups. */
  inset?: boolean;
  label?: string;
  className?: string;
}

export function Divider({
  orientation = 'horizontal',
  inset = false,
  label,
  className,
}: DividerProps) {
  if (label) {
    return (
      <div
        role="separator"
        aria-label={label}
        aria-orientation={orientation}
        data-testid="hg-divider"
        className={cx('flex items-center gap-3', inset && 'mx-4', className)}
      >
        <span aria-hidden="true" className="h-px flex-1 bg-line-decorative" />
        {/* Sentence case, not caps: some SR configurations read all-caps
            letter-by-letter (01-foundations.md §3.3). */}
        <span className="text-label-sm text-fg-tertiary">{label}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-line-decorative" />
      </div>
    );
  }

  return (
    <RadixSeparator.Root
      decorative
      orientation={orientation}
      data-testid="hg-divider"
      className={cx(
        'shrink-0 bg-line-decorative',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        inset && (orientation === 'horizontal' ? 'ms-4 w-[calc(100%-var(--hg-space-4))]' : 'my-4'),
        className,
      )}
    />
  );
}
