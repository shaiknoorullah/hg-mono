import type { CSSProperties } from 'react';
import { cx } from './utils/cx.js';
import { icon as iconToken, space } from '../tokens/index.js';

/**
 * Spinner — 02-components.md §34.
 *
 * Indeterminate wait under ~1s, and the in-button loading indicator.
 * Skeletons beat spinners for anything with known geometry.
 *
 * States: this component has no interactive states. It is never focusable,
 * never disabled, never in error — stated explicitly per rule 0.1.
 *
 * Under reduced motion the rotating ring is replaced by a static indeterminate
 * bar (02-components.md §34), which is why both are in the DOM.
 */

const SIZE: Record<'sm' | 'md' | 'lg', number> = {
  sm: iconToken.sm,
  md: iconToken.lg,
  lg: space['10'],
};

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  /** Announced by the `status` region. Required unless `decorative`. */
  label?: string;
  /** True when a parent control already carries the busy semantics. */
  decorative?: boolean;
  inline?: boolean;
  className?: string;
  'data-testid'?: string;
}

export function Spinner({
  size = 'md',
  label,
  decorative = false,
  inline = false,
  className,
  'data-testid': testId = 'hg-spinner',
}: SpinnerProps) {
  const px = SIZE[size];
  const style: CSSProperties = { width: px, height: px };

  return (
    <span
      data-testid={testId}
      data-hg-size={size}
      className={cx(inline ? 'inline-flex' : 'flex', 'items-center gap-2', className)}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'status', 'aria-live': 'polite', 'aria-label': label })}
    >
      <svg
        style={style}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="motion-reduce:hidden animate-spin"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {/* Reduced-motion fallback: a static indeterminate bar. */}
      <span
        aria-hidden="true"
        style={{ width: px }}
        className="hidden h-1 rounded-full bg-current opacity-40 motion-reduce:block"
      />
      {label && !decorative ? (
        <span className="text-body-sm text-fg-secondary">{label}</span>
      ) : null}
    </span>
  );
}
