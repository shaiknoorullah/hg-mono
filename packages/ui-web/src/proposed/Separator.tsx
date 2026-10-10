/**
 * `Separator` — a rule between groups (proposed; the web successor of the legacy `Divider`).
 * Built on the shadcn `Separator` (Radix).
 *
 * Decorative by default (hidden from assistive tech). With `label` it is a real separator with
 * an accessible name and a visible sentence-case caption. `border.decorative` is a documented
 * contrast exemption: a separator never bounds a control.
 */

import type { CSSProperties } from 'react';

import { Separator as LibSeparator } from '../lib/ui/separator.js';
import { cn } from '../lib/utils.js';

/** Props of the proposed `Separator`. */
export interface SeparatorProps {
  orientation?: 'horizontal' | 'vertical';
  /** Indent by the gutter, for list groups. */
  inset?: boolean;
  /** A caption ("or", "Earlier today"); makes the separator semantic and named. */
  label?: string;
  /** Hidden from assistive tech (default true unless `label` is given). */
  decorative?: boolean;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

/** A thin rule between groups of content. */
export function Separator({
  orientation = 'horizontal',
  inset = false,
  label,
  decorative,
  testId = 'Separator',
  style,
  className,
}: SeparatorProps) {
  if (label) {
    return (
      <div
        role="separator"
        aria-label={label}
        aria-orientation={orientation}
        data-testid={testId}
        className={cn('flex items-center gap-3', inset && 'mx-4', className)}
        style={style}
      >
        <LibSeparator className="flex-1" />
        <span className="text-label-sm text-fg-secondary">{label}</span>
        <LibSeparator className="flex-1" />
      </div>
    );
  }
  return (
    <LibSeparator
      data-testid={testId}
      orientation={orientation}
      decorative={decorative ?? true}
      className={cn(inset && (orientation === 'horizontal' ? 'ms-4 w-auto' : 'my-4 h-auto'), className)}
      style={style}
    />
  );
}
