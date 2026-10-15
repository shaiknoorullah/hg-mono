/**
 * ProgressBar — determinate or indeterminate progress (gap register "ProgressBar / Spinner",
 * #191; restaurant onboarding uploads and settings). On shadcn `Progress` (Radix).
 *
 * - A named `progressbar`: `label` is the accessible name and is shown above the bar unless
 *   `hideLabel`. `value={null}` (or omitted) is indeterminate: no `aria-valuenow`, and the sweep
 *   holds still under reduced motion.
 * - Tones are brand (default), neutral, info and warning. There is no success tone: a green
 *   fill is reserved to halal (invariant 10, lint L-4), and no danger tone either: a failed
 *   upload is an error message, not a red bar.
 */

import type { CSSProperties } from 'react';

import { Progress } from '../lib/ui/progress.js';
import { cn } from '../lib/utils.js';

/** ProgressBar props (proposed; no packet entry yet). */
export interface ProgressBarProps {
  /** The accessible name, shown above the bar unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  /** 0…max. `null` or omitted is indeterminate. */
  value?: number | null;
  /** Default 100. */
  max?: number;
  /** Spoken value ("3 of 5 files"). Defaults to the percentage. */
  valueText?: string;
  /** Show the percentage (or `valueText`) beside the label. */
  showValue?: boolean;
  tone?: 'brand' | 'neutral' | 'info' | 'warning';
  size?: 'sm' | 'md';
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

const FILL = {
  brand: 'bg-action-primary-bg',
  neutral: 'bg-fg-secondary',
  info: 'bg-feedback-info-icon',
  warning: 'bg-feedback-warning-icon',
} as const;

/** A labelled progress bar. */
export function ProgressBar({
  label,
  hideLabel = false,
  value,
  max = 100,
  valueText,
  showValue = false,
  tone = 'brand',
  size = 'md',
  testId = 'ProgressBar',
  style,
}: ProgressBarProps) {
  const indeterminate = value === null || value === undefined;
  const pct = indeterminate ? null : Math.round((Math.min(max, Math.max(0, value)) / Math.max(1, max)) * 100);
  const spoken = valueText ?? (pct === null ? 'Loading' : `${pct}%`);

  return (
    <div data-testid={testId} data-tone={tone} data-indeterminate={indeterminate || undefined} className="grid w-full gap-1.5" style={style}>
      {hideLabel && !showValue ? null : (
        <div aria-hidden="true" className="flex items-baseline justify-between gap-3">
          {hideLabel ? <span /> : <span className="text-label-md text-fg-primary">{label}</span>}
          {showValue && !indeterminate ? <span className="text-label-md text-fg-secondary tabular-nums">{spoken}</span> : null}
        </div>
      )}
      <Progress
        value={pct}
        aria-label={label}
        getValueLabel={() => spoken}
        className={cn('rounded-full bg-line-decorative', size === 'sm' ? 'h-1' : 'h-2')}
        indicatorClassName={cn('rounded-full', FILL[tone])}
      />
    </div>
  );
}
