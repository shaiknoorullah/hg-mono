import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { OrderState } from '@hg/api-client';

import { Skeleton } from '../primitives/index.js';
import { Banner } from './Banner.js';
import { cx, formatAbsoluteTime } from './internal.js';
import {
  buildOrderTimelineSteps,
  type TimelineAudience,
  type TimelineStep,
  type TimelineStepState,
} from './orderStateVocabulary.js';

/**
 * `StatusTimeline` — order progress, rendered from the server's state and nothing else
 * (rule 9: no component derives a business state client-side).
 *
 * Either drive it from the contract (`state` + `audience`, collapsed through the one
 * shared vocabulary in `orderStateVocabulary.ts`) or pass `steps` directly for the
 * non-order timelines that reuse the shape — restaurant onboarding, for instance, which
 * runs off the server's `onboarding_state`.
 */

export type StatusTimelineOrientation = 'vertical' | 'horizontal' | 'compact';

interface CommonProps {
  orientation?: StatusTimelineOrientation;
  showTimes?: boolean;
  /** "Estimated 6:42 PM". Rendered beside the current step. */
  estimatedAt?: string | null;
  /**
   * The timeline never blanks (§23). When the stream is down this renders the last known
   * state plus a "Not updating — reconnecting" banner over the top of it.
   */
  disconnected?: boolean;
  /** Skeleton with the *correct number of steps* — the shape is known before the data. */
  loading?: boolean;
  /** Announce state changes politely, once per change, deduplicated. Default true. */
  announce?: boolean;
  locale?: string;
  timeZone?: string;
  /** Names the list for AT: "Order HG-10482 progress". */
  label?: string;
  className?: string;
  testId?: string;
}

interface FromOrderStateProps extends CommonProps {
  /** The contract's `OrderState`. All 14 values are handled, including the terminal ones. */
  state: OrderState;
  audience: TimelineAudience;
  transitions?: readonly { state: OrderState; at: string }[];
  /** `response_deadline_at` / `promised_ready_at`. Past it, the current step is `stalled`. */
  deadlineAt?: string | null;
  serverNow?: string | null;
  steps?: never;
}

interface FromStepsProps extends CommonProps {
  steps: readonly TimelineStep[];
  state?: never;
  audience?: never;
  transitions?: never;
  deadlineAt?: never;
  serverNow?: never;
}

export type StatusTimelineProps = FromOrderStateProps | FromStepsProps;

/**
 * Step presentation. Terminal failure is deliberately not a variation of "current" — it
 * has its own glyph, its own colour role and its own `data-terminal` marker, and it
 * strikes the steps that will now never happen.
 */
const STEP_STYLE: Record<TimelineStepState, { marker: string; label: string }> = {
  complete: { marker: 'border-line-brand bg-action-primary-bg text-action-primary-fg', label: 'text-fg-secondary' },
  current: { marker: 'border-line-brand bg-surface-base text-fg-primary', label: 'text-fg-primary font-semibold' },
  upcoming: { marker: 'border-line-interactive bg-surface-base text-fg-tertiary', label: 'text-fg-tertiary' },
  failed: { marker: 'border-feedback-danger-border bg-feedback-danger-solid text-feedback-danger-on-solid', label: 'text-feedback-danger-text font-semibold' },
  stalled: { marker: 'border-feedback-warning-border bg-feedback-warning-tint text-feedback-warning-text', label: 'text-feedback-warning-text font-semibold' },
  abandoned: { marker: 'border-line-decorative bg-surface-subtle text-fg-disabled', label: 'text-fg-disabled line-through' },
  unsupported: { marker: 'border-line-interactive bg-surface-subtle text-fg-tertiary', label: 'text-fg-secondary' },
};

/** Never colour-alone: each state carries a glyph *and* a word in the accessible name. */
const STEP_WORD: Record<TimelineStepState, string> = {
  complete: 'done',
  current: 'in progress',
  upcoming: 'not started',
  failed: 'failed',
  stalled: 'delayed',
  abandoned: 'not reached',
  unsupported: 'unknown',
};

function StepGlyph({ state }: { state: TimelineStepState }): ReactNode {
  const common = { 'aria-hidden': true, viewBox: '0 0 24 24', width: 14, height: 14 } as const;
  if (state === 'complete') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
        <path d="m5 13 4 4 10-10" />
      </svg>
    );
  }
  if (state === 'failed') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  if (state === 'stalled' || state === 'unsupported') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
        <path d="M12 7v6l3 2" />
      </svg>
    );
  }
  if (state === 'current') {
    return <span aria-hidden="true" className="block size-2 rounded-full bg-action-primary-bg" />;
  }
  return <span aria-hidden="true" className="block size-1.5 rounded-full bg-current" />;
}

function stepAccessibleName(
  step: TimelineStep,
  locale?: string,
  timeZone?: string,
): string {
  const label = step.state === 'current' && step.activeLabel ? step.activeLabel : step.label;
  // Times are absolute in the accessible name even when shown relative (a11y §23).
  const at = formatAbsoluteTime(step.at, locale, timeZone);
  const parts = [label, STEP_WORD[step.state], at, step.detail].filter(Boolean);
  return parts.join(', ');
}

export function StatusTimeline(props: StatusTimelineProps): ReactNode {
  const {
    orientation = 'vertical',
    showTimes = true,
    estimatedAt,
    disconnected = false,
    loading = false,
    announce = true,
    locale,
    timeZone,
    label,
    className,
    testId = 'status-timeline',
  } = props;

  const steps = useMemo<TimelineStep[]>(() => {
    if (props.steps) return [...props.steps];
    return buildOrderTimelineSteps({
      state: props.state,
      audience: props.audience,
      transitions: props.transitions,
      deadlineAt: props.deadlineAt,
      serverNow: props.serverNow,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the union is discriminated by `steps`
  }, [props.steps, props.state, props.audience, props.transitions, props.deadlineAt, props.serverNow]);

  const active =
    steps.find((s) => s.state === 'current' || s.state === 'failed' || s.state === 'stalled') ??
    steps[steps.length - 1];

  /* Announce once per change, deduplicated — a polled timeline must not re-announce the
     same state every refresh, and it must never move focus (a11y §4.2). */
  const liveRef = useRef<HTMLParagraphElement | null>(null);
  const lastAnnouncedRef = useRef<string | null>(null);
  const announcement = active ? stepAccessibleName(active, locale, timeZone) : null;

  useEffect(() => {
    if (!announce || !announcement || !liveRef.current) return;
    if (lastAnnouncedRef.current === announcement) return;
    lastAnnouncedRef.current = announcement;
    liveRef.current.textContent = announcement;
  }, [announce, announcement]);

  if (loading) {
    return (
      <div
        data-testid={`${testId}-loading`}
        aria-busy="true"
        aria-label={label ? `Loading ${label}` : 'Loading order progress'}
        className={cx(
          orientation === 'vertical' ? 'flex flex-col gap-4' : 'flex flex-row gap-4',
          className,
        )}
      >
        {/* The shape of the timeline is known before the data, so the skeleton has the
            real number of steps rather than a generic grey box. */}
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-3">
            <Skeleton variant="circle" width={24} height={24} />
            <Skeleton variant="text" width={96} />
          </div>
        ))}
      </div>
    );
  }

  const hasTerminalFailure = steps.some((s) => s.state === 'failed');

  if (orientation === 'compact') {
    const done = steps.filter((s) => s.state === 'complete').length;
    const total = steps.length;
    return (
      <div
        data-testid={testId}
        data-orientation="compact"
        data-terminal={hasTerminalFailure || undefined}
        className={cx('flex flex-col gap-2', className)}
      >
        {disconnected ? <ReconnectingBanner /> : null}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={announcement ?? undefined}
          aria-label={label ?? 'Order progress'}
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-subtle"
        >
          <span
            className={cx(
              'block h-full',
              hasTerminalFailure ? 'bg-feedback-danger-solid' : 'bg-action-primary-bg',
            )}
            style={{ inlineSize: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <p
          className={cx(
            'text-label-md',
            hasTerminalFailure ? 'text-feedback-danger-text' : 'text-fg-primary',
          )}
        >
          {active ? active.activeLabel ?? active.label : '—'}
        </p>
        {announce ? <p ref={liveRef} aria-live="polite" className="sr-only" /> : null}
      </div>
    );
  }

  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      data-testid={testId}
      data-orientation={orientation}
      data-terminal={hasTerminalFailure || undefined}
      className={cx('flex flex-col gap-3', className)}
    >
      {disconnected ? <ReconnectingBanner /> : null}

      <ol
        role="list"
        aria-label={label ?? 'Order progress'}
        className={cx(
          isHorizontal ? 'flex flex-row items-start gap-2 overflow-x-auto' : 'flex flex-col',
        )}
      >
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const displayLabel =
            step.state === 'current' && step.activeLabel ? step.activeLabel : step.label;
          const style = STEP_STYLE[step.state];
          const at = formatAbsoluteTime(step.at, locale, timeZone);

          return (
            <li
              key={step.key}
              data-step-key={step.key}
              data-step-state={step.state}
              data-terminal={step.state === 'failed' || undefined}
              aria-current={step.state === 'current' ? 'step' : undefined}
              aria-label={stepAccessibleName(step, locale, timeZone)}
              className={cx(
                'relative flex',
                isHorizontal ? 'min-w-24 flex-1 flex-col items-center text-center' : 'flex-row gap-3 pb-5 last:pb-0',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
                  style.marker,
                )}
              >
                <StepGlyph state={step.state} />
              </span>

              {/* The connector. Struck through once the order has exited the spine. */}
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={cx(
                    'absolute',
                    isHorizontal
                      ? 'top-3 h-0.5 w-full translate-x-1/2'
                      : 'bottom-0 top-6 w-0.5 translate-x-[11px]',
                    step.state === 'complete' ? 'bg-action-primary-bg' : 'bg-border-decorative',
                    isHorizontal ? 'start-1/2' : 'start-0',
                  )}
                />
              ) : null}

              <span className={cx('flex min-w-0 flex-col', isHorizontal ? 'mt-2 items-center' : '')}>
                <span
                  className={cx(
                    'text-label-lg',
                    style.label,
                  )}
                >
                  {displayLabel}
                </span>
                {showTimes && at ? (
                  <span className="text-caption tabular-nums text-fg-tertiary">
                    {at}
                  </span>
                ) : null}
                {step.detail ? (
                  <span className="text-body-sm text-fg-secondary">
                    {step.detail}
                  </span>
                ) : null}
                {step.state === 'current' && estimatedAt ? (
                  <span className="text-caption tabular-nums text-fg-secondary">
                    Estimated {formatAbsoluteTime(estimatedAt, locale, timeZone)}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {announce ? <p ref={liveRef} aria-live="polite" className="sr-only" /> : null}
    </div>
  );
}

function ReconnectingBanner(): ReactNode {
  return (
    <Banner
      variant="warning"
      title="Not updating — reconnecting"
      description="This is the last status we received. It will refresh as soon as the connection is back."
      conditionKey="timeline-disconnected"
      testId="status-timeline-disconnected"
    />
  );
}
