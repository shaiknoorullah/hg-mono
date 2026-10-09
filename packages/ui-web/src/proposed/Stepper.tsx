/**
 * `Stepper` (approval packet P17): step progress for restaurant onboarding and admin
 * multi-step flows. Drawn on `restaurant/onboarding/OnbPhoneHead` (compact header) and the
 * onboarding `Tab-*` boards. Proposed: exported from `@hg/ui-web/proposed` until the owner
 * approves the packet.
 *
 * - `full`: an ordered list. Each step shows its number (or a tick when done, an alert glyph
 *   on error) and its label; the current step has `aria-current="step"`, and each status is
 *   also in words for screen readers ("done", "current step", "needs attention"). With
 *   `onStepPress`, done and error steps are buttons (44px rows); the current and upcoming
 *   steps are not.
 * - `compact`: "Step N of M" with the current label and a progressbar.
 * - The current step is a filled marker, never a left border.
 */

import type { CSSProperties } from 'react';

import { Progress } from '../lib/ui/progress.js';
import { cn } from '../lib/utils.js';
import { Button, Icon } from '../ds/index.js';

/** One step. */
export interface StepperStep {
  id: string;
  label: string;
  status: 'done' | 'current' | 'upcoming' | 'error';
}

/** Props of the proposed `Stepper` (P17). */
export interface StepperProps {
  steps: StepperStep[];
  variant?: 'full' | 'compact';
  /** Makes done and error steps navigable. */
  onStepPress?: (id: string) => void;
  /** Names the list or the progressbar; defaults to "Progress". */
  label?: string;
  testId?: string;
  style?: CSSProperties;
}

const STATUS_WORDS: Record<StepperStep['status'], string> = {
  done: 'done',
  current: 'current step',
  upcoming: 'not started',
  error: 'needs attention',
};

/** Step progress as a list, or a compact "Step N of M" header. */
export function Stepper({ steps, variant = 'full', onStepPress, label = 'Progress', testId, style }: StepperProps) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.status === 'current' || s.status === 'error'),
  );
  if (variant === 'compact') {
    const done = steps.filter((s) => s.status === 'done').length;
    const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
    const current = steps[currentIndex];
    return (
      <div
        data-testid={testId ?? 'Stepper'}
        data-variant="compact"
        className="grid gap-2 rounded-lg border border-line-decorative bg-surface-raised px-4 py-3"
        style={style}
      >
        <p className="m-0 text-heading-sm text-fg-primary">
          {`Step ${currentIndex + 1} of ${steps.length}`}
          {current ? <span className="text-fg-secondary">{` · ${current.label}`}</span> : null}
        </p>
        <Progress
          value={pct}
          aria-label={label}
          className="h-2 rounded-full bg-line-decorative"
          indicatorClassName="rounded-full bg-fg-secondary"
        />
        <p className="m-0 text-body-sm text-fg-secondary tabular-nums">{`${pct}% complete`}</p>
      </div>
    );
  }
  return (
    <nav aria-label={label} data-testid={testId ?? 'Stepper'} data-variant="full" style={style}>
      <ol className="m-0 grid list-none gap-1 p-0">
        {steps.map((step, i) => {
          const pressable = Boolean(onStepPress) && (step.status === 'done' || step.status === 'error');
          const marker = (
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-label-md tabular-nums',
                step.status === 'current' && 'bg-action-primary-bg text-action-primary-fg',
                step.status === 'done' && 'bg-surface-sunken text-fg-primary',
                step.status === 'upcoming' && 'border border-control-border text-fg-secondary',
                step.status === 'error' && 'bg-feedback-danger-tint text-feedback-danger-icon',
              )}
            >
              {step.status === 'done' ? <Icon name="check" size="sm" /> : step.status === 'error' ? <Icon name="error" size="sm" /> : i + 1}
            </span>
          );
          const text = (
            <span className="flex flex-col text-start">
              <span className={cn('text-body-md', step.status === 'upcoming' ? 'text-fg-secondary' : 'text-fg-primary')}>
                {step.label}
              </span>
              <span className="sr-only">{`, ${STATUS_WORDS[step.status]}`}</span>
            </span>
          );
          return (
            <li
              key={step.id}
              aria-current={step.status === 'current' ? 'step' : undefined}
              className={cn('flex min-h-11 items-center gap-3 rounded-md px-2', step.status === 'current' && 'bg-accent')}
            >
              {pressable ? (
                <Button variant="ghost" size="md" onPress={() => onStepPress?.(step.id)} style={{ justifyContent: 'flex-start', paddingInline: 0 }}>
                  <span className="flex items-center gap-3">
                    {marker}
                    {text}
                  </span>
                </Button>
              ) : (
                <>
                  {marker}
                  {text}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
