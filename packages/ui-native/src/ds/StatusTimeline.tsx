import type { OrderState } from '@hg/api-client';

import {
  StatusTimeline as LegacyStatusTimeline,
  type StatusTimelineOrientation,
  type TimelineConnection,
} from '../feedback/StatusTimeline';
import { ORDER_STATE_LABELS, type TimelineAudience, type TimelineTransition } from '../feedback/order-track';
import { type DsCommon, resolveTestId } from './shared';

export type { OrderState };
export { ORDER_STATE_LABELS, resolveTimeline } from '../feedback/order-track';
export type { StepState } from '../feedback/order-track';

/** The fourteen contract order states, in lifecycle order. */
export const ORDER_STATES = Object.keys(ORDER_STATE_LABELS) as OrderState[];

/** Props of the live `StatusTimeline`. */
export interface StatusTimelineProps extends DsCommon {
  /** Whose vocabulary to render. Never inferred. */
  audience: TimelineAudience;
  /** The contract order state. An unknown value is reported and rendered as all-upcoming. */
  state?: OrderState | (string & {});
  transitions?: readonly TimelineTransition[];
  orientation?: StatusTimelineOrientation;
  showTimes?: boolean;
  estimatedAt?: string | null;
  /** Once passed, the current step is `stalled` and says so. */
  deadlineAt?: string | null;
  /** Skeleton with the right number of steps. */
  loading?: boolean;
  /** 'reconnecting' keeps the last state and says it is not updating. */
  connection?: TimelineConnection;
  onUnknownState?: (state: string) => void;
  /** Injectable clock (tests). */
  now?: number;
}

/** Order progress for one audience; a missing state shows the loading skeleton. */
export function StatusTimeline(props: StatusTimelineProps) {
  const { state, testId: _t, testID: _T, style, ...rest } = props;
  return (
    <LegacyStatusTimeline
      {...rest}
      state={state ?? ''}
      loading={rest.loading ?? state === undefined}
      style={style as never}
      testID={resolveTestId(props, 'StatusTimeline')}
    />
  );
}
