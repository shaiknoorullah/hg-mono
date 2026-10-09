/**
 * `Spinner` — an indeterminate wait under about a second (proposed, #191). Skeletons beat
 * spinners for anything with a known shape.
 *
 * Freestanding, it is a `role="status"` region named by `label`. `decorative` hides it when a
 * parent control already carries `aria-busy` (Button, IconButton). Under reduced motion the ring
 * stops and a static bar shows instead.
 *
 * Keeps the pre-rebuild props; adds `testId` and `style`.
 */

import type { CSSProperties } from 'react';

import { SpinnerGlyph } from '../lib/ui/spinner.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from '../ds/client-error.js';

const SIZE = { sm: 16, md: 24, lg: 40 } as const;

/** Props of the proposed `Spinner`. */
export interface SpinnerProps {
  /** sm 16 · md 24 · lg 40. */
  size?: keyof typeof SIZE;
  /** Announced by the status region. Required unless `decorative`. */
  label?: string;
  /** True when a parent control already carries the busy semantics. */
  decorative?: boolean;
  /** Show the label beside the ring, inline with text. */
  inline?: boolean;
  /** data-testid; defaults to the component name. */
  testId?: string;
  /** Pre-rebuild spelling of `testId`. */
  'data-testid'?: string;
  style?: CSSProperties;
  className?: string;
}

/** A busy indicator, announced once through a polite status region. */
export function Spinner({
  size = 'md',
  label,
  decorative = false,
  inline = false,
  testId,
  'data-testid': legacyTestId,
  style,
  className,
}: SpinnerProps) {
  if (!decorative && !label) reportDsClientError('SPINNER_UNLABELLED', { component: 'Spinner' });
  return (
    <span
      data-testid={testId ?? legacyTestId ?? 'Spinner'}
      data-size={size}
      className={cn(inline ? 'inline-flex' : 'flex', 'items-center gap-2 text-fg-secondary', className)}
      style={style}
      {...(decorative ? { 'aria-hidden': true } : { role: 'status', 'aria-live': 'polite' as const, 'aria-label': label })}
    >
      <SpinnerGlyph size={SIZE[size]} />
      {label && !decorative ? <span className="text-body-sm">{label}</span> : null}
    </span>
  );
}
