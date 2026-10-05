/**
 * The single shared mapping from the platform's 14-state order machine to each audience's
 * vocabulary (02-components.md §23: "The mapping table lives in one shared module, not per
 * surface, so the customer app and the restaurant app can never disagree about what an order
 * state is called").
 *
 * The 14 values are NOT redeclared here. They are imported from `@hg/api-client`, which types
 * them off `contracts/openapi.yaml`. `ORDER_STATE_LABELS` is a `Record<OrderState, string>`, so
 * adding a state to the contract is a compile error here until it is given a label — which is
 * exactly the coupling we want.
 */
import type { OrderState } from '@hg/api-client';
import { isTerminalOrderState } from '@hg/api-client';

/* -------------------------------------------------------------------------------------------- *
 * Vocabulary
 * -------------------------------------------------------------------------------------------- */

export type TimelineAudience = 'customer' | 'restaurant' | 'rider' | 'admin';

/**
 * Plain-language name for every contract state. Exhaustive by type. Admin sees these verbatim;
 * the other audiences see their collapsed track labels below.
 */
export const ORDER_STATE_LABELS: Record<OrderState, string> = {
  CREATED: 'Created',
  AUTHORIZED: 'Payment authorised',
  RESTAURANT_PENDING: 'Sent to restaurant',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  ARRIVED: 'Rider arrived',
  DELIVERED: 'Delivered',
  COMPLETED: 'Settled',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected by restaurant',
  FAILED: 'Failed',
  DISPUTED: 'Disputed',
  RESOLVED: 'Dispute resolved',
};

/** The 14 contract values as a runtime set, derived from the label table (never hand-listed). */
const KNOWN_STATES = new Set<string>(Object.keys(ORDER_STATE_LABELS));

export function isKnownOrderState(state: string): state is OrderState {
  return KNOWN_STATES.has(state);
}

/**
 * The three states that end an order badly. `isTerminalOrderState` also counts `COMPLETED` and
 * `RESOLVED`, which end it well — the timeline must not treat those the same way, which is the
 * whole point of separating these two sets.
 */
export const FAILURE_ORDER_STATES = ['CANCELLED', 'REJECTED', 'FAILED'] as const;
export type FailureOrderState = (typeof FAILURE_ORDER_STATES)[number];

export function isFailureOrderState(state: OrderState): state is FailureOrderState {
  return (FAILURE_ORDER_STATES as readonly string[]).includes(state);
}

/* -------------------------------------------------------------------------------------------- *
 * Tracks
 * -------------------------------------------------------------------------------------------- */

export interface TrackStepDef {
  key: string;
  /** Label once the step is behind the order. */
  label: string;
  /** Label while the order is sitting in this step, when the present tense differs. */
  currentLabel?: string;
  /** A present-tense label for one of the step's states, where it reads differently. */
  currentLabelByState?: Partial<Record<OrderState, string>>;
  /** The contract states that collapse into this step. */
  states: readonly OrderState[];
}

export interface OrderTrack {
  audience: TimelineAudience;
  steps: readonly TrackStepDef[];
  /** States at which this audience considers the whole track finished successfully. */
  completeAt: readonly OrderState[];
}

/**
 * Customer: Placed → Confirmed → Preparing → On the way → Delivered.
 *
 * `CREATED`/`AUTHORIZED` collapse into "Placed"; `RESTAURANT_PENDING` reads as "Confirming"
 * while it is the live step; `PICKED_UP`/`ARRIVED` are both "On the way"; `COMPLETED` is not a
 * step of its own — settlement is not a customer concern (02-components.md §23).
 *
 * `READY_FOR_PICKUP` has no entry in the specified five-word vocabulary. It stays inside the
 * "Preparing" step with its own present-tense label ("Your food is ready", the Track & After
 * canvas's copy, so a ready order never reads "Preparing your food") rather than being promoted
 * to a sixth step, because the step count is load-bearing: the loading skeleton renders the
 * correct number of steps before the data arrives (03-patterns.md §1.7).
 */
const CUSTOMER_TRACK: OrderTrack = {
  audience: 'customer',
  completeAt: ['DELIVERED', 'COMPLETED', 'RESOLVED'],
  steps: [
    { key: 'placed', label: 'Placed', states: ['CREATED', 'AUTHORIZED'] },
    {
      key: 'confirmed',
      label: 'Confirmed',
      currentLabel: 'Confirming',
      states: ['RESTAURANT_PENDING'],
    },
    {
      key: 'preparing',
      label: 'Preparing',
      currentLabel: 'Preparing your food',
      currentLabelByState: { READY_FOR_PICKUP: 'Your food is ready' },
      states: ['PREPARING', 'READY_FOR_PICKUP'],
    },
    { key: 'on_the_way', label: 'On the way', states: ['PICKED_UP', 'ARRIVED'] },
    { key: 'delivered', label: 'Delivered', states: ['DELIVERED'] },
  ],
};

const RESTAURANT_TRACK: OrderTrack = {
  audience: 'restaurant',
  completeAt: ['COMPLETED', 'RESOLVED'],
  steps: [
    { key: 'received', label: 'Received', states: ['CREATED', 'AUTHORIZED'] },
    {
      key: 'accepted',
      label: 'Accepted',
      currentLabel: 'Awaiting your response',
      states: ['RESTAURANT_PENDING'],
    },
    { key: 'preparing', label: 'Preparing', states: ['PREPARING'] },
    { key: 'ready', label: 'Ready for pickup', states: ['READY_FOR_PICKUP'] },
    { key: 'collected', label: 'Collected by rider', states: ['PICKED_UP', 'ARRIVED'] },
    { key: 'delivered', label: 'Delivered', states: ['DELIVERED'] },
    { key: 'settled', label: 'Settled', states: ['COMPLETED'] },
  ],
};

const RIDER_TRACK: OrderTrack = {
  audience: 'rider',
  completeAt: ['DELIVERED', 'COMPLETED', 'RESOLVED'],
  steps: [
    {
      key: 'accepted',
      label: 'Accepted',
      states: ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING'],
    },
    { key: 'preparing', label: 'Restaurant preparing', states: ['PREPARING'] },
    { key: 'ready', label: 'Ready for pickup', states: ['READY_FOR_PICKUP'] },
    { key: 'picked_up', label: 'Picked up', states: ['PICKED_UP'] },
    { key: 'arrived', label: 'At the customer', states: ['ARRIVED'] },
    { key: 'delivered', label: 'Delivered', states: ['DELIVERED'] },
  ],
};

/** Admin sees the real machine: one step per forward state, contract names. */
const ADMIN_TRACK: OrderTrack = {
  audience: 'admin',
  completeAt: ['COMPLETED', 'RESOLVED'],
  steps: (
    [
      'CREATED',
      'AUTHORIZED',
      'RESTAURANT_PENDING',
      'PREPARING',
      'READY_FOR_PICKUP',
      'PICKED_UP',
      'ARRIVED',
      'DELIVERED',
      'COMPLETED',
    ] as const
  ).map((state) => ({
    key: state.toLowerCase(),
    label: ORDER_STATE_LABELS[state],
    states: [state] as readonly OrderState[],
  })),
};

export const ORDER_TRACKS: Record<TimelineAudience, OrderTrack> = {
  customer: CUSTOMER_TRACK,
  restaurant: RESTAURANT_TRACK,
  rider: RIDER_TRACK,
  admin: ADMIN_TRACK,
};

/* -------------------------------------------------------------------------------------------- *
 * Outcomes — the states that are not points on the forward spine
 * -------------------------------------------------------------------------------------------- */

export type OutcomeKind = 'in-progress' | 'complete' | 'failed' | 'attention' | 'unknown';
export type OutcomeTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface OrderOutcome {
  kind: OutcomeKind;
  tone: OutcomeTone;
  /** The contract state that produced this outcome, or `null` when the value was unrecognised. */
  state: OrderState | null;
  title: string;
  description: string;
}

const OUTCOME_COPY: Record<
  TimelineAudience,
  Partial<Record<OrderState, Omit<OrderOutcome, 'state'>>>
> = {
  customer: {
    CANCELLED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Order cancelled',
      description: 'This order was cancelled. Any authorised amount is released back to you.',
    },
    REJECTED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Restaurant could not take this order',
      description: 'You have not been charged. Nothing further is needed from you.',
    },
    FAILED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Order could not be completed',
      description: 'Support has been notified. Any authorised amount is released back to you.',
    },
    DISPUTED: {
      kind: 'attention',
      tone: 'warning',
      title: 'Under review',
      description: 'We are looking into this order. We will update you here.',
    },
    RESOLVED: {
      kind: 'complete',
      tone: 'success',
      title: 'Review closed',
      description: 'This order has been reviewed and closed.',
    },
    COMPLETED: {
      kind: 'complete',
      tone: 'success',
      title: 'Delivered',
      description: 'This order is complete.',
    },
  },
  restaurant: {
    CANCELLED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Order cancelled',
      description: 'Stop preparation. This order will not be collected.',
    },
    REJECTED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Order rejected',
      description: 'This order was declined and will not appear in your queue again.',
    },
    FAILED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Order failed',
      description: 'The platform ended this order. Payout is handled by support.',
    },
    DISPUTED: {
      kind: 'attention',
      tone: 'warning',
      title: 'Disputed',
      description: 'This order is under review. Payout is held until it closes.',
    },
    RESOLVED: {
      kind: 'complete',
      tone: 'success',
      title: 'Dispute resolved',
      description: 'The review is closed and payout has resumed.',
    },
  },
  rider: {
    CANCELLED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Order cancelled',
      description: 'This delivery has ended. Return to waiting for offers.',
    },
    REJECTED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Restaurant did not accept',
      description: 'This delivery has ended. Return to waiting for offers.',
    },
    FAILED: {
      kind: 'failed',
      tone: 'danger',
      title: 'Delivery ended',
      description: 'The platform ended this order. Any compensation is shown in Earnings.',
    },
    DISPUTED: {
      kind: 'attention',
      tone: 'warning',
      title: 'Under review',
      description: 'This delivery is being reviewed. Earnings for it may be held.',
    },
    RESOLVED: {
      kind: 'complete',
      tone: 'success',
      title: 'Review closed',
      description: 'This delivery has been reviewed and closed.',
    },
  },
  admin: {
    CANCELLED: {
      kind: 'failed',
      tone: 'danger',
      title: 'CANCELLED',
      description: 'Terminal. Authorisation voided or refunded per the payment ledger.',
    },
    REJECTED: {
      kind: 'failed',
      tone: 'danger',
      title: 'REJECTED',
      description: 'Terminal. Restaurant declined inside the 180 s response window.',
    },
    FAILED: {
      kind: 'failed',
      tone: 'danger',
      title: 'FAILED',
      description: 'Terminal. Platform-side failure; see the transition reason.',
    },
    DISPUTED: {
      kind: 'attention',
      tone: 'warning',
      title: 'DISPUTED',
      description: 'Non-terminal. Settlement held pending resolution.',
    },
    RESOLVED: {
      kind: 'complete',
      tone: 'success',
      title: 'RESOLVED',
      description: 'Terminal. Dispute closed.',
    },
    COMPLETED: {
      kind: 'complete',
      tone: 'success',
      title: 'COMPLETED',
      description: 'Terminal. Settled.',
    },
  },
};

const IN_PROGRESS_OUTCOME: Omit<OrderOutcome, 'state'> = {
  kind: 'in-progress',
  tone: 'neutral',
  title: '',
  description: '',
};

/**
 * Rule 10 of 02-components.md §0: an unknown enum value never crashes. It renders the shape of
 * the timeline with no position claimed, and says why.
 */
const UNKNOWN_OUTCOME: Omit<OrderOutcome, 'state'> = {
  kind: 'unknown',
  tone: 'warning',
  title: 'This order is in a state this app does not recognise',
  description: 'Update the app to see the latest status. Nothing is wrong with the order.',
};

/* -------------------------------------------------------------------------------------------- *
 * Resolution
 * -------------------------------------------------------------------------------------------- */

export type StepState =
  /** Behind the order, and the order actually passed through it. */
  | 'complete'
  /** Behind the order, and the order provably did NOT pass through it (skipped state). */
  | 'skipped'
  /** Where the order is now. */
  | 'current'
  /** Where the order is now, past its `deadline_at`. */
  | 'stalled'
  /** Where the order stopped, badly. */
  | 'failed'
  /** Ahead of the order, still reachable. */
  | 'upcoming'
  /** Ahead of the order, no longer reachable because the order ended badly. */
  | 'unreached';

/** A single order transition. Structurally compatible with the contract's `OrderTransition`. */
export interface TimelineTransition {
  to_state: OrderState;
  from_state?: OrderState | null;
  at?: string;
}

export interface ResolveTimelineInput {
  audience: TimelineAudience;
  /** Widened deliberately: a server may send a state this build does not know (rule 10). */
  state: OrderState | (string & {});
  /** `OrderTracking.timeline`. Optional — without it, skipped steps read as complete. */
  transitions?: readonly TimelineTransition[];
  /** `OrderSummary.deadline_at`. A passed deadline turns the current step `stalled`. */
  deadlineAt?: string | null;
  /** Injectable clock, for tests. */
  now?: number;
}

export interface ResolvedStep {
  key: string;
  label: string;
  state: StepState;
  /** RFC-3339 instant this step was entered, when the transition history says so. */
  at?: string;
}

export interface ResolvedTimeline {
  steps: ResolvedStep[];
  /** The step the order is sitting in, or `null` when the order is finished or unrecognised. */
  currentKey: string | null;
  outcome: OrderOutcome;
  /** Non-null only when `state` was not one of the contract's 14 values. Report it, do not throw. */
  unknownState: string | null;
}

function stepIndexOfState(track: OrderTrack, state: OrderState): number {
  return track.steps.findIndex((s) => s.states.includes(state));
}

/**
 * Where did the order stop? For a failure state there is no position on the forward spine, so it
 * is recovered from the transition that produced the failure. Without history we fall back to the
 * only defensible guess per state, never to "the end".
 */
function failurePosition(
  track: OrderTrack,
  state: FailureOrderState,
  transitions: readonly TimelineTransition[] | undefined,
): number {
  if (transitions) {
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
      const t = transitions[i];
      if (t && t.to_state === state && t.from_state) {
        const idx = stepIndexOfState(track, t.from_state);
        if (idx >= 0) return idx;
      }
    }
    // No explicit failure transition: use the last forward state we did see.
    for (let i = transitions.length - 1; i >= 0; i -= 1) {
      const t = transitions[i];
      if (!t) continue;
      const idx = stepIndexOfState(track, t.to_state);
      if (idx >= 0) return idx;
    }
  }
  if (state === 'REJECTED') {
    const idx = stepIndexOfState(track, 'RESTAURANT_PENDING');
    if (idx >= 0) return idx;
  }
  return 0;
}

/**
 * Collapse an order's current state (plus, when available, its transition history) into a
 * renderable list of steps. Pure, synchronous, and the only place this logic exists.
 */
export function resolveTimeline(input: ResolveTimelineInput): ResolvedTimeline {
  const track = ORDER_TRACKS[input.audience];
  const raw = input.state as string;

  if (!isKnownOrderState(raw)) {
    return {
      steps: track.steps.map((s) => ({ key: s.key, label: s.label, state: 'upcoming' as const })),
      currentKey: null,
      outcome: { ...UNKNOWN_OUTCOME, state: null },
      unknownState: raw,
    };
  }

  const state: OrderState = raw;
  const transitions = input.transitions;

  /* When the step was entered, per step key. */
  const enteredAt = new Map<string, string>();
  /* Which steps the order provably visited. */
  const visited = new Set<string>();
  if (transitions) {
    for (const t of transitions) {
      const idx = stepIndexOfState(track, t.to_state);
      const step = idx >= 0 ? track.steps[idx] : undefined;
      if (!step) continue;
      visited.add(step.key);
      if (t.at && !enteredAt.has(step.key)) enteredAt.set(step.key, t.at);
    }
  }

  const failed = isFailureOrderState(state);
  const finished = track.completeAt.includes(state);
  /* `DISPUTED`/`RESOLVED` sit off the spine but after delivery — anchor them at the last step. */
  const offSpine = state === 'DISPUTED' || state === 'RESOLVED';

  let anchor: number;
  if (failed) {
    anchor = failurePosition(track, state, transitions);
  } else if (offSpine) {
    const delivered = stepIndexOfState(track, 'DELIVERED');
    anchor = delivered >= 0 ? delivered : track.steps.length - 1;
  } else {
    const idx = stepIndexOfState(track, state);
    /* A state with no home in this audience's track (e.g. `COMPLETED` for the customer) means the
     * journey is over as far as this audience is concerned. */
    anchor = idx >= 0 ? idx : track.steps.length - 1;
  }
  if (!failed) visited.add(track.steps[anchor]?.key ?? '');

  const deadlinePassed =
    !failed &&
    !finished &&
    input.deadlineAt != null &&
    Date.parse(input.deadlineAt) < (input.now ?? Date.now());

  const steps: ResolvedStep[] = track.steps.map((def, i) => {
    const at = enteredAt.get(def.key);
    let stepState: StepState;

    if (finished && !failed) {
      stepState = 'complete';
    } else if (i < anchor) {
      /* Only claim a step happened when we can show it happened. Without transition history we
       * have no evidence either way, so we do not draw a false "skipped". */
      stepState = transitions && !visited.has(def.key) ? 'skipped' : 'complete';
    } else if (i === anchor) {
      if (failed) stepState = 'failed';
      else if (deadlinePassed) stepState = 'stalled';
      else stepState = 'current';
    } else {
      stepState = failed ? 'unreached' : 'upcoming';
    }

    const label =
      stepState === 'current' || stepState === 'stalled'
        ? (def.currentLabelByState?.[state] ?? def.currentLabel ?? def.label)
        : def.label;
    return at ? { key: def.key, label, state: stepState, at } : { key: def.key, label, state: stepState };
  });

  const copy = OUTCOME_COPY[input.audience][state];
  const outcome: OrderOutcome = copy
    ? { ...copy, state }
    : { ...IN_PROGRESS_OUTCOME, state, ...(isTerminalOrderState(state) ? { kind: 'complete' as const, tone: 'success' as const } : {}) };

  const currentStep = steps[anchor];
  return {
    steps,
    currentKey: !failed && !finished && currentStep ? currentStep.key : null,
    outcome,
    unknownState: null,
  };
}

/* -------------------------------------------------------------------------------------------- *
 * Presentation helpers shared by the timeline and its accessible names
 * -------------------------------------------------------------------------------------------- */

const STEP_STATE_WORDS: Record<StepState, string> = {
  complete: 'done',
  skipped: 'skipped',
  current: 'in progress',
  stalled: 'taking longer than expected',
  failed: 'stopped here',
  upcoming: 'not started',
  unreached: 'not reached',
};

export function stepStateWord(state: StepState): string {
  return STEP_STATE_WORDS[state];
}

/**
 * Absolute wall-clock time ("2:41 p.m."). 04-accessibility.md and 02-components.md §23 both
 * require the ACCESSIBLE name to carry an absolute time even where the visual is relative — a
 * screen-reader user cannot re-read "4 min ago" to work out when something happened.
 */
export function formatAbsoluteTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit' }).format(
      new Date(ms),
    );
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

/** Relative time for the visual only ("4 min ago"), falling back to absolute past an hour. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const deltaMin = Math.round((now - ms) / 60000);
  if (deltaMin < 1) return 'just now';
  if (deltaMin < 60) return `${deltaMin} min ago`;
  return formatAbsoluteTime(iso);
}

/** "Preparing, in progress, 2:41 p.m." — one string, one list item, one tab stop. */
export function stepAccessibilityLabel(step: ResolvedStep): string {
  const parts = [step.label, stepStateWord(step.state)];
  if (step.at) {
    const t = formatAbsoluteTime(step.at);
    if (t) parts.push(t);
  }
  return parts.join(', ');
}
