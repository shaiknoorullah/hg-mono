/**
 * The one shared order-state vocabulary.
 *
 * `02-components.md` §23: "The mapping table lives in one shared module, not per surface,
 * so the customer app and the restaurant app can never disagree about what an order state
 * is called." This is that module.
 *
 * The 14 states themselves are **not** declared here. `OrderState` is imported from
 * `@hg/api-client`, which aliases the generated union from `contracts/openapi.yaml`. If the
 * contract grows a fifteenth state this file stops compiling at `ORDER_STATE_SEQUENCE`,
 * which is the intended failure mode.
 */
import {
  type OrderState,
  TERMINAL_ORDER_STATES,
  isTerminalOrderState,
} from '@hg/api-client';

import { reportUnsupportedValue } from './internal.js';

/**
 * Forward progress, in machine order. Terminal branches are excluded — they are not
 * points on the spine, they are exits from it.
 */
export const ORDER_STATE_SPINE = [
  'CREATED',
  'AUTHORIZED',
  'RESTAURANT_PENDING',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'ARRIVED',
  'DELIVERED',
  'COMPLETED',
] as const satisfies readonly OrderState[];

/** The exits. `RESOLVED` is terminal but is a *settled* exit, not a failure. */
export const ORDER_STATE_BRANCHES = [
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'DISPUTED',
  'RESOLVED',
] as const satisfies readonly OrderState[];

/**
 * Every state in the contract, exactly once. A compile error here means the contract
 * changed and this table did not.
 */
export const ORDER_STATE_SEQUENCE: readonly OrderState[] = [
  ...ORDER_STATE_SPINE,
  ...ORDER_STATE_BRANCHES,
];

/** The three states that end an order badly. Distinct rendering is mandatory. */
export const FAILURE_ORDER_STATES = ['CANCELLED', 'REJECTED', 'FAILED'] as const satisfies
  readonly OrderState[];

export function isFailureOrderState(state: OrderState): boolean {
  return (FAILURE_ORDER_STATES as readonly string[]).includes(state);
}

export { TERMINAL_ORDER_STATES, isTerminalOrderState };

/* -------------------------------------------------------------------------- *
 * Step model
 * -------------------------------------------------------------------------- */

export type TimelineStepState =
  /** Passed. */
  | 'complete'
  /** Where the order is now. */
  | 'current'
  /** Not reached yet, still expected. */
  | 'upcoming'
  /** `CANCELLED` / `REJECTED` / `FAILED` — the order ended here. */
  | 'failed'
  /** Deadline passed and the order is still sitting on this step. */
  | 'stalled'
  /** Never going to happen because the order exited before reaching it. */
  | 'abandoned'
  /** The server sent a state this build has never heard of. */
  | 'unsupported';

export interface TimelineStep {
  key: string;
  label: string;
  /** Shown instead of `label` while the step is `current` ("Confirming" vs "Confirmed"). */
  activeLabel?: string;
  /** RFC-3339. Rendered relative, always absolute in the accessible name. */
  at?: string | null;
  state: TimelineStepState;
  /** A sentence explaining a `stalled` / `failed` / `unsupported` step. */
  detail?: string;
  /** The contract states this step stands for. Useful for tests and for admin tooltips. */
  states?: readonly OrderState[];
}

export type TimelineAudience = 'customer' | 'restaurant' | 'rider' | 'admin';

interface VocabularyEntry {
  key: string;
  label: string;
  activeLabel?: string;
  states: readonly OrderState[];
}

/**
 * Customer (C-32): five steps. `CREATED`/`AUTHORIZED` collapse into "Placed";
 * `RESTAURANT_PENDING` reads "Confirming" while it is the current step;
 * `PICKED_UP`/`ARRIVED` are both "On the way"; `COMPLETED` is not shown, because
 * settlement is not a customer concern.
 */
const CUSTOMER_VOCABULARY: readonly VocabularyEntry[] = [
  { key: 'placed', label: 'Placed', states: ['CREATED', 'AUTHORIZED'] },
  {
    key: 'confirmed',
    label: 'Confirmed',
    activeLabel: 'Confirming',
    states: ['RESTAURANT_PENDING'],
  },
  { key: 'preparing', label: 'Preparing', states: ['PREPARING', 'READY_FOR_PICKUP'] },
  { key: 'on_the_way', label: 'On the way', states: ['PICKED_UP', 'ARRIVED'] },
  { key: 'delivered', label: 'Delivered', states: ['DELIVERED', 'COMPLETED'] },
];

/** Restaurant (R-23): the kitchen's own words, matching the queue columns. */
const RESTAURANT_VOCABULARY: readonly VocabularyEntry[] = [
  {
    key: 'new',
    label: 'New order',
    activeLabel: 'Awaiting your response',
    states: ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING'],
  },
  { key: 'preparing', label: 'Preparing', states: ['PREPARING'] },
  { key: 'ready', label: 'Ready for pickup', states: ['READY_FOR_PICKUP'] },
  { key: 'collected', label: 'Collected by rider', states: ['PICKED_UP', 'ARRIVED'] },
  { key: 'delivered', label: 'Delivered', states: ['DELIVERED', 'COMPLETED'] },
];

/** Rider (D-14…D-22). */
const RIDER_VOCABULARY: readonly VocabularyEntry[] = [
  { key: 'placed', label: 'Order placed', states: ['CREATED', 'AUTHORIZED', 'RESTAURANT_PENDING'] },
  {
    key: 'to_restaurant',
    label: 'To restaurant',
    activeLabel: 'Heading to restaurant',
    states: ['PREPARING', 'READY_FOR_PICKUP'],
  },
  { key: 'picked_up', label: 'Picked up', states: ['PICKED_UP'] },
  { key: 'at_customer', label: 'At customer', states: ['ARRIVED'] },
  { key: 'delivered', label: 'Delivered', states: ['DELIVERED', 'COMPLETED'] },
];

/**
 * Human-readable names for the raw machine states. Exported so a `DataTable` enum column
 * and a `StatusTimeline` can never disagree about what a state is called.
 */
export const ORDER_STATE_LABELS: Record<OrderState, string> = {
  CREATED: 'Created',
  AUTHORIZED: 'Authorized',
  RESTAURANT_PENDING: 'Restaurant pending',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  PICKED_UP: 'Picked up',
  ARRIVED: 'Arrived',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  FAILED: 'Failed',
  DISPUTED: 'Disputed',
  RESOLVED: 'Resolved',
};

/**
 * Admin (A-38 / patterns §4.4): "the full 14-state vocabulary, not the customer's
 * collapsed five". One step per contract state — support cannot debug a collapsed view.
 */
const ADMIN_VOCABULARY: readonly VocabularyEntry[] = ORDER_STATE_SPINE.map((state) => ({
  key: state.toLowerCase(),
  label: ORDER_STATE_LABELS[state],
  states: [state] as readonly OrderState[],
}));

const VOCABULARIES: Record<TimelineAudience, readonly VocabularyEntry[]> = {
  customer: CUSTOMER_VOCABULARY,
  restaurant: RESTAURANT_VOCABULARY,
  rider: RIDER_VOCABULARY,
  admin: ADMIN_VOCABULARY,
};

/** The copy each terminal branch carries, per audience-independent plain language. */
const BRANCH_COPY: Record<
  (typeof ORDER_STATE_BRANCHES)[number],
  { label: string; detail: string; state: TimelineStepState }
> = {
  CANCELLED: {
    label: 'Cancelled',
    detail: 'This order was cancelled and will not be delivered.',
    state: 'failed',
  },
  REJECTED: {
    label: 'Rejected by the restaurant',
    detail: 'The restaurant could not take this order.',
    state: 'failed',
  },
  FAILED: {
    label: 'Failed',
    detail: 'This order could not be completed. Payment is being reversed.',
    state: 'failed',
  },
  DISPUTED: {
    label: 'Disputed',
    detail: 'A dispute is open on this order.',
    state: 'stalled',
  },
  RESOLVED: {
    label: 'Resolved',
    detail: 'The dispute on this order has been settled.',
    state: 'complete',
  },
};

export interface BuildTimelineOptions {
  /** The server's state. The only source of truth — nothing is derived client-side (rule 9). */
  state: OrderState;
  audience: TimelineAudience;
  /**
   * `{state, at}` pairs from the order's transition history, so completed steps can carry
   * their real timestamps instead of inventing them.
   */
  transitions?: readonly { state: OrderState; at: string }[];
  /**
   * A server deadline for the *current* step (`response_deadline_at`, `promised_ready_at`).
   * Past it, the current step is `stalled` rather than `current` — C-32 requires the
   * customer never sits on a spinner with no information.
   */
  deadlineAt?: string | null;
  /** Server clock at response time, for skew correction. */
  serverNow?: string | null;
  /** Injectable for tests. */
  now?: number;
}

function timeFor(
  entry: VocabularyEntry,
  transitions: readonly { state: OrderState; at: string }[] | undefined,
): string | null {
  if (!transitions?.length) return null;
  for (const candidate of entry.states) {
    const hit = transitions.find((t) => t.state === candidate);
    if (hit) return hit.at;
  }
  return null;
}

/**
 * Collapse the platform's 14-state machine into one audience's vocabulary.
 *
 * Guarantees, all of them exercised by the tests:
 *  - every one of the 14 `OrderState` values produces a timeline;
 *  - `CANCELLED` / `REJECTED` / `FAILED` produce a step with `state: 'failed'` and every
 *    unreached step becomes `abandoned`, so a dead order can never look like progress;
 *  - an unrecognised state produces a single `unsupported` step and reports itself
 *    instead of throwing (rule 10).
 */
export function buildOrderTimelineSteps(options: BuildTimelineOptions): TimelineStep[] {
  const { state, audience, transitions, deadlineAt, serverNow, now = Date.now() } = options;
  const vocabulary = VOCABULARIES[audience];

  if (!ORDER_STATE_SEQUENCE.includes(state)) {
    reportUnsupportedValue('StatusTimeline', 'OrderState', state);
    return [
      {
        key: 'unsupported',
        label: 'Status unavailable',
        state: 'unsupported',
        detail:
          'This app does not recognise the order’s current status. Refresh the app to continue.',
      },
    ];
  }

  const branch = (ORDER_STATE_BRANCHES as readonly string[]).includes(state)
    ? (state as (typeof ORDER_STATE_BRANCHES)[number])
    : null;

  // How far along the spine the order got, whether or not it then exited.
  const lastSpineState = branch
    ? [...(transitions ?? [])]
        .reverse()
        .map((t) => t.state)
        .find((s) => (ORDER_STATE_SPINE as readonly string[]).includes(s)) ?? null
    : state;

  const currentIndex = lastSpineState
    ? vocabulary.findIndex((entry) => entry.states.includes(lastSpineState))
    : -1;

  const skewMs = serverNow ? new Date(serverNow).getTime() - now : 0;
  const deadlinePassed =
    !!deadlineAt && !Number.isNaN(new Date(deadlineAt).getTime())
      ? new Date(deadlineAt).getTime() - (now + skewMs) <= 0
      : false;

  const steps: TimelineStep[] = vocabulary.map((entry, index) => {
    let stepState: TimelineStepState;
    if (branch) {
      stepState = index <= currentIndex ? 'complete' : 'abandoned';
    } else if (index < currentIndex) {
      stepState = 'complete';
    } else if (index === currentIndex) {
      stepState = deadlinePassed ? 'stalled' : 'current';
    } else {
      stepState = 'upcoming';
    }

    const step: TimelineStep = {
      key: entry.key,
      label: entry.label,
      state: stepState,
      states: entry.states,
      at: timeFor(entry, transitions),
    };
    if (entry.activeLabel) step.activeLabel = entry.activeLabel;
    if (stepState === 'stalled') {
      step.detail = 'This is taking longer than expected. We are chasing it up.';
    }
    return step;
  });

  if (branch) {
    const copy = BRANCH_COPY[branch];
    const at = transitions?.find((t) => t.state === branch)?.at ?? null;
    steps.push({
      key: branch.toLowerCase(),
      label: copy.label,
      state: copy.state,
      detail: copy.detail,
      states: [branch],
      at,
    });
  }

  return steps;
}

/**
 * The single-line summary a compact timeline shows and a screen reader announces.
 * Kept here so the string is identical on every surface.
 */
export function describeOrderState(state: OrderState, audience: TimelineAudience): string {
  const steps = buildOrderTimelineSteps({ state, audience });
  const active = steps.find((s) => s.state === 'current' || s.state === 'failed' || s.state === 'stalled');
  if (!active) return ORDER_STATE_LABELS[state] ?? 'Status unavailable';
  return active.activeLabel ?? active.label;
}
