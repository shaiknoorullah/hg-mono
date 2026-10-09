/** Order progress, driven by the order state and the audience (02-components.md §23). */
export type OrderState =
  | 'CREATED' | 'AUTHORIZED' | 'RESTAURANT_PENDING' | 'PREPARING' | 'READY_FOR_PICKUP' | 'PICKED_UP'
  | 'ARRIVED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'REJECTED' | 'FAILED' | 'DISPUTED' | 'RESOLVED';
export type StepState = 'complete' | 'current' | 'stalled' | 'failed' | 'upcoming' | 'unreached';
export interface StatusTimelineProps {
  /** Whose vocabulary to render. Never inferred. */
  audience: 'customer' | 'restaurant' | 'rider' | 'admin';
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
  style?: React.CSSProperties;
}
export declare function StatusTimeline(props: StatusTimelineProps): JSX.Element;
/** Not components: the ONE shared mapping module (mirror of ui-native order-track.ts). */
export declare const ORDER_STATES: OrderState[];
export declare const ORDER_STATE_LABELS: Record<OrderState, string>;
export declare function resolveTimeline(input: { audience: StatusTimelineProps['audience']; state: string; transitions?: StatusTimelineProps['transitions']; deadlineAt?: string | null; now?: number }):
  { steps: Array<{ key: string; label: string; state: StepState; at?: string }>; currentKey: string | null; failed: boolean; unknownState: string | null };
