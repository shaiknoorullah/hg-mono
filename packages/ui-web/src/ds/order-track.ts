/**
 * `resolveTimeline` and `ORDER_STATES`, as the live `index.d.ts` declares them, over the ONE
 * shared vocabulary this package already has (`feedback/orderStateVocabulary.ts`, which also
 * exports `ORDER_STATE_LABELS`). Nothing is restated: the audiences' steps and words come from
 * `buildOrderTimelineSteps`; this module only maps its result to the live step states
 * (complete · current · stalled · failed · upcoming · unreached) and the live transition shape
 * (`{ to_state, from_state?, at? }`).
 */

import type { OrderState } from '@hg/api-client';

import {
  ORDER_STATE_SEQUENCE,
  ORDER_STATE_SPINE,
  buildOrderTimelineSteps,
  isFailureOrderState,
} from '../feedback/orderStateVocabulary.js';

/**
 * Where an order most likely was when it exited, if the transitions do not say: a rejection only
 * happens while the restaurant is deciding; a cancellation or failure with no history is placed
 * at the start.
 */
const DEFAULT_EXIT_FROM: Record<'CANCELLED' | 'REJECTED' | 'FAILED', OrderState> = {
  CANCELLED: 'CREATED',
  REJECTED: 'RESTAURANT_PENDING',
  FAILED: 'CREATED',
};

/** The live step states. */
export type StepState = 'complete' | 'current' | 'stalled' | 'failed' | 'upcoming' | 'unreached';

/** Whose vocabulary a timeline uses. Never inferred. */
export type TimelineAudience = 'customer' | 'restaurant' | 'rider' | 'admin';

/** One contract transition (`OrderTracking.timeline`). */
export interface TimelineTransition {
  to_state: OrderState;
  from_state?: OrderState | null;
  at?: string;
}

/** One resolved step. */
export interface ResolvedStep {
  key: string;
  label: string;
  state: StepState;
  at?: string;
  /** A sentence for a stalled or failed step. */
  detail?: string;
}

/** What `resolveTimeline` returns. */
export interface ResolvedTimeline {
  steps: ResolvedStep[];
  currentKey: string | null;
  failed: boolean;
  unknownState: string | null;
}

/** Every contract order state, in machine order (spine, then exits). */
export const ORDER_STATES: OrderState[] = [...ORDER_STATE_SEQUENCE];

/** Whether a string is one of the 14 contract order states. */
export function isOrderState(value: unknown): value is OrderState {
  return typeof value === 'string' && (ORDER_STATE_SEQUENCE as readonly string[]).includes(value);
}

/** Number of steps an audience's track has (the loading skeleton draws this many). */
export function timelineLength(audience: TimelineAudience): number {
  return buildOrderTimelineSteps({ state: 'CREATED', audience }).length;
}

/**
 * Resolve an audience's track for an order state. An unknown state is data, not a crash: every
 * step is `upcoming` and `unknownState` is set (the component reports it).
 */
export function resolveTimeline(input: {
  audience: TimelineAudience;
  state: string;
  transitions?: TimelineTransition[];
  deadlineAt?: string | null;
  now?: number;
}): ResolvedTimeline {
  const { audience, state, transitions = [], deadlineAt, now } = input;

  if (!isOrderState(state)) {
    const steps = buildOrderTimelineSteps({ state: 'CREATED', audience }).map((s) => ({
      key: s.key,
      label: s.label,
      state: 'upcoming' as const,
    }));
    return { steps, currentKey: null, failed: false, unknownState: String(state) };
  }

  // The vocabulary module reads `{state, at}` pairs. A failure transition's `from_state` says
  // which step the order died on, so it counts as having reached that step.
  const pairs: { state: OrderState; at: string }[] = [];
  for (const t of transitions) {
    if (!t.at) continue;
    if (t.from_state && t.to_state === state) pairs.push({ state: t.from_state, at: t.at });
    pairs.push({ state: t.to_state, at: t.at });
  }

  const raw = buildOrderTimelineSteps({ state, audience, transitions: pairs, deadlineAt, now });
  const steps: ResolvedStep[] = raw.map((s) => {
    const mapped: StepState =
      s.state === 'abandoned' ? 'unreached' : s.state === 'unsupported' ? 'upcoming' : s.state;
    const step: ResolvedStep = {
      key: s.key,
      label: (mapped === 'current' || mapped === 'stalled') && s.activeLabel ? s.activeLabel : s.label,
      state: mapped,
    };
    if (s.at) step.at = s.at;
    if (s.detail && (mapped === 'stalled' || mapped === 'failed')) step.detail = s.detail;
    return step;
  });
  // A failure is drawn ON the step where the order stopped (the live reference: "Confirmed —
  // Rejected by restaurant"), with every later step unreached; no extra step is appended.
  if (isFailureOrderState(state)) {
    const exit = steps.pop();
    const exitTransition = transitions.find((t) => t.to_state === state);
    const lastSpine = [...transitions]
      .reverse()
      .map((t) => t.to_state)
      .find((st) => st !== state && (ORDER_STATE_SPINE as readonly string[]).includes(st));
    const from = exitTransition?.from_state ?? lastSpine ?? DEFAULT_EXIT_FROM[state as keyof typeof DEFAULT_EXIT_FROM];
    const found = raw.findIndex((r) => r.states?.includes(from));
    const failIndex = found === -1 ? 0 : found;
    steps.forEach((step, index) => {
      if (index < failIndex) step.state = 'complete';
      else if (index === failIndex) {
        step.state = 'failed';
        step.label = raw[index]!.label;
        if (exit?.label) step.detail = exit.label;
        if (exit?.at) step.at = exit.at;
      } else {
        step.state = 'unreached';
        delete step.at;
      }
    });
  }

  const failed = steps.some((s) => s.state === 'failed');
  const current = steps.find((s) => s.state === 'current' || s.state === 'stalled');
  return { steps, currentKey: failed ? null : (current?.key ?? null), failed, unknownState: null };
}
