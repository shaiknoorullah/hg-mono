/**
 * StatusTimeline — order progress, driven by the order STATE and the AUDIENCE (02-components.md
 * §23; live `index.d.ts`, `components/StatusTimeline/README.md`). Never free labels: the steps
 * and their words come from the one shared vocabulary (`ORDER_STATE_LABELS`, `resolveTimeline`).
 *
 * - Step states: complete, current, stalled (deadline passed and still here: warning plus a line
 *   saying so), failed (CANCELLED, REJECTED or FAILED, in words), upcoming and unreached.
 * - Variants: vertical (default), horizontal and compact (a bar plus the current label).
 * - `loading`: a skeleton with the audience's number of steps. `connection="reconnecting"`
 *   keeps the last state and says "Not updating — reconnecting"; it never blanks. An unknown
 *   state is reported (`UNKNOWN_ENUM_VALUE`) and drawn all-upcoming with a refresh line.
 * - A11y: `role="list"`; each step is named "{label}, {state}, {time}" with absolute 12-hour
 *   times; the current step is `aria-current="step"`; a change is announced politely once.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { OrderState } from '@hg/api-client';

import { cn } from '../lib/utils.js';
import { reportDsClientError } from './client-error.js';
import { resolveTimeline, timelineLength, type ResolvedStep, type StepState, type TimelineAudience } from './order-track.js';
import { formatTime12h } from './time.js';

/** Props of the live `StatusTimeline` (index.d.ts). */
export interface StatusTimelineProps {
  /** Whose vocabulary to render. Never inferred. */
  audience: TimelineAudience;
  /** The contract order state. An unknown value is reported and rendered as all-upcoming + a refresh line. */
  state?: OrderState | (string & {});
  /** OrderTracking.timeline — gives step times and where a failure happened. */
  transitions?: Array<{ to_state: OrderState; from_state?: OrderState | null; at?: string }>;
  orientation?: 'vertical' | 'horizontal' | 'compact';
  showTimes?: boolean;
  /** OrderTracking.eta_at — shown under the current step. */
  estimatedAt?: string | null;
  /** OrderSummary.deadline_at — once passed, the current step is `stalled` and says so. */
  deadlineAt?: string | null;
  /** Skeleton with the right number of steps. */
  loading?: boolean;
  /** 'reconnecting' keeps the last state and shows "Not updating — reconnecting". */
  connection?: 'live' | 'reconnecting';
  onUnknownState?: (state: string) => void;
  /** Injectable clock (tests). */
  now?: number;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
}

/** The word each step state is spoken as. */
export const STEP_STATE_WORD: Record<StepState, string> = {
  complete: 'done',
  current: 'in progress',
  stalled: 'delayed',
  failed: 'stopped',
  upcoming: 'not started',
  unreached: 'will not happen',
};

const NODE: Record<StepState, string> = {
  complete: 'bg-action-primary-bg text-action-primary-fg',
  current: 'bg-action-primary-bg text-action-primary-fg',
  stalled: 'bg-feedback-warning-solid text-feedback-warning-on-solid',
  failed: 'bg-feedback-danger-solid text-feedback-danger-on-solid',
  upcoming: 'bg-surface-raised text-fg-tertiary ring-[1.5px] ring-line-interactive ring-inset',
  unreached: 'bg-surface-raised text-fg-tertiary ring-[1.5px] ring-line-interactive ring-inset',
};

const RECONNECTING = 'Not updating — reconnecting';
const UNKNOWN_LINE = 'This order is in a state this app does not recognise. Refresh to see the latest status.';

const isActive = (s: StepState) => s === 'current' || s === 'stalled' || s === 'failed';

function Tick() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden="true" focusable="false" className="block">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Node({ state }: { state: StepState }) {
  return (
    <span aria-hidden="true" className={cn('grid size-5 shrink-0 place-items-center rounded-full', NODE[state])}>
      {state === 'complete' ? (
        <Tick />
      ) : state === 'failed' ? (
        <span className="block h-0.5 w-2 rounded-xs bg-current" />
      ) : isActive(state) ? (
        <span className="block size-1.5 rounded-full bg-current" />
      ) : null}
    </span>
  );
}

/** Order progress for one audience, from the contract's state and timeline. */
export function StatusTimeline({
  audience,
  state,
  transitions,
  orientation = 'vertical',
  showTimes = true,
  estimatedAt,
  deadlineAt,
  loading = false,
  connection = 'live',
  onUnknownState,
  now,
  testId = 'StatusTimeline',
  style,
}: StatusTimelineProps) {
  const timeline = loading || state === undefined ? null : resolveTimeline({ audience, state, transitions, deadlineAt, now });
  const [announcement, setAnnouncement] = useState('');
  const last = useRef<string | null>(null);
  const unknownRef = useRef(onUnknownState);
  unknownRef.current = onUnknownState;
  const signature = timeline ? timeline.steps.map((s) => s.state).join(',') : '';

  useEffect(() => {
    if (!timeline) return;
    if (timeline.unknownState) {
      reportDsClientError('UNKNOWN_ENUM_VALUE', { component: 'StatusTimeline', field: 'state', received: timeline.unknownState });
      unknownRef.current?.(timeline.unknownState);
      return;
    }
    const active = timeline.steps.find((s) => isActive(s.state));
    const sig = `${state}|${active ? `${active.key}:${active.state}` : 'done'}`;
    // Announced politely once per change; never on first render.
    if (last.current !== null && last.current !== sig) {
      setAnnouncement(active ? `${active.label}, ${STEP_STATE_WORD[active.state]}` : `Order ${timeline.steps.at(-1)?.label ?? ''}`.trim());
    }
    last.current = sig;
  }, [state, signature]);

  if (!timeline) {
    const count = orientation === 'compact' ? 1 : timelineLength(audience);
    return (
      <div data-testid={testId} data-orientation={orientation} aria-busy="true" className="grid gap-3" style={style}>
        <span className="sr-only">Loading order status.</span>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <span aria-hidden="true" className="block size-5 rounded-full bg-skeleton-base" />
            <span aria-hidden="true" className={cn('block h-3.5 rounded-sm bg-skeleton-base', i % 2 ? 'w-2/5' : 'w-1/2')} />
          </div>
        ))}
      </div>
    );
  }

  const time = (at?: string) => (at ? formatTime12h(at) : null);
  const eta = estimatedAt ? time(estimatedAt) : null;
  const banner = timeline.unknownState ? UNKNOWN_LINE : connection === 'reconnecting' ? RECONNECTING : null;
  const notice = banner ? (
    <div
      role="status"
      className="mb-3 rounded-md border border-feedback-warning-border bg-feedback-warning-tint px-3 py-2 text-body-sm text-feedback-warning-tint-text"
    >
      {banner}
    </div>
  ) : null;
  const live = (
    <span className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </span>
  );

  if (orientation === 'compact') {
    const steps = timeline.steps;
    const done = steps.filter((s) => s.state === 'complete').length;
    const current =
      steps.find((s) => s.state !== 'complete' && s.state !== 'upcoming' && s.state !== 'unreached') ?? steps[steps.length - 1]!;
    const word = `${current.label}, ${STEP_STATE_WORD[current.state]}`;
    const fill = current.state === 'failed' ? 'bg-feedback-danger-solid' : current.state === 'stalled' ? 'bg-feedback-warning-solid' : 'bg-action-primary-bg';
    return (
      <div data-testid={testId} data-orientation="compact" className="grid gap-2" style={style}>
        {notice}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={Math.min(steps.length, done + (current.state === 'complete' ? 0 : 1))}
          aria-valuetext={word}
          aria-label="Order progress"
          className="h-1 overflow-hidden rounded-full bg-line-decorative"
        >
          <div className={cn('h-full', fill)} style={{ width: `${(Math.min(steps.length, done + 1) / steps.length) * 100}%` }} />
        </div>
        <div aria-hidden="true" className="text-label-md font-semibold text-fg-primary">
          {current.label}
        </div>
        {live}
      </div>
    );
  }

  const vertical = orientation !== 'horizontal';
  return (
    <div data-testid={testId} data-orientation={orientation} style={style}>
      {notice}
      <ol role="list" className={cn('m-0 list-none p-0', vertical ? 'grid' : 'flex items-start gap-2')}>
        {timeline.steps.map((step, i) => (
          <Step
            key={step.key}
            step={step}
            vertical={vertical}
            last={i === timeline.steps.length - 1}
            at={showTimes ? time(step.at) : null}
            spokenAt={time(step.at)}
            eta={eta}
          />
        ))}
      </ol>
      {live}
    </div>
  );
}

function Step({
  step,
  vertical,
  last,
  at,
  spokenAt,
  eta,
}: {
  step: ResolvedStep;
  vertical: boolean;
  last: boolean;
  at: string | null;
  spokenAt: string | null;
  eta: string | null;
}) {
  const active = isActive(step.state);
  const dim = step.state === 'upcoming' || step.state === 'unreached';
  const name = [step.label, STEP_STATE_WORD[step.state], spokenAt].filter(Boolean).join(', ');
  const text = (
    <div aria-hidden="true" className={cn('min-w-0', vertical && 'pb-4')}>
      <div
        className={cn(
          vertical ? 'text-label-lg' : 'text-label-md',
          active ? 'font-semibold' : 'font-medium',
          dim ? 'text-fg-tertiary' : 'text-fg-primary',
          step.state === 'unreached' && 'line-through',
        )}
      >
        {step.label}
      </div>
      {at ? <div className="text-caption text-fg-tertiary tabular-nums">{at}</div> : null}
      {step.state === 'current' && eta ? <div className="text-body-sm text-fg-secondary">Estimated {eta}</div> : null}
      {step.state === 'stalled' ? (
        <div className="text-body-sm text-feedback-warning-text">{step.detail ?? 'Taking longer than expected.'}</div>
      ) : null}
      {step.state === 'failed' && step.detail ? <div className="text-body-sm text-feedback-danger-text">{step.detail}</div> : null}
    </div>
  );
  return (
    <li
      aria-label={name}
      aria-current={active && step.state !== 'failed' ? 'step' : undefined}
      data-step-state={step.state}
      className={vertical ? 'grid grid-cols-[20px_1fr] gap-x-3' : 'min-w-0 flex-1'}
    >
      {vertical ? (
        <div className="grid grid-rows-[auto_1fr] justify-items-center">
          <Node state={step.state} />
          {!last ? (
            <span
              aria-hidden="true"
              className={cn('mt-0.5 block min-h-4.5 w-0.5', step.state === 'complete' ? 'bg-action-primary-bg' : 'bg-line-decorative')}
            />
          ) : null}
        </div>
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            'mb-2 h-1 rounded-full',
            dim ? 'bg-line-decorative' : step.state === 'stalled' ? 'bg-feedback-warning-solid' : step.state === 'failed' ? 'bg-feedback-danger-solid' : 'bg-action-primary-bg',
          )}
        />
      )}
      {text}
    </li>
  );
}
