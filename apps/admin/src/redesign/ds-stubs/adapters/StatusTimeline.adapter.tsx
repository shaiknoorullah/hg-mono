/**
 * ADAPTER: live design-system `StatusTimeline` -> `@hg/ui-web` `StatusTimeline`.
 *
 * Live differences handled here: transitions arrive as `{ to_state, from_state, at }` (the
 * contract's OrderTracking.timeline) and become legacy `{ state, at }`; `connection:
 * 'reconnecting'` becomes legacy `disconnected`; an unknown state is reported through
 * `onUnknownState` and `ORDER_STATE_UNKNOWN`, then drawn as all-upcoming.
 */
import { useEffect, type CSSProperties } from 'react';
import type { OrderState } from '@hg/api-client';
import { ORDER_STATE_LABELS, StatusTimeline as LegacyStatusTimeline } from '@hg/ui-web';

import { reportClientError } from '../internal/report';

export interface StatusTimelineProps {
  audience: 'customer' | 'restaurant' | 'rider' | 'admin';
  state?: OrderState | (string & {});
  transitions?: Array<{ to_state: OrderState; from_state?: OrderState | null; at?: string }>;
  orientation?: 'vertical' | 'horizontal' | 'compact';
  showTimes?: boolean;
  estimatedAt?: string | null;
  deadlineAt?: string | null;
  loading?: boolean;
  connection?: 'live' | 'reconnecting';
  onUnknownState?: (state: string) => void;
  /** Injectable clock (tests): passed as the server clock. */
  now?: number;
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

export function StatusTimeline({
  audience,
  state,
  transitions,
  connection,
  onUnknownState,
  now,
  testId = 'StatusTimeline',
  style,
  className,
  ...rest
}: StatusTimelineProps): React.JSX.Element {
  const known = typeof state === 'string' && state in ORDER_STATE_LABELS;
  useEffect(() => {
    if (!known && state !== undefined) {
      reportClientError('ORDER_STATE_UNKNOWN', { state });
      onUnknownState?.(String(state));
    }
  }, [known, state, onUnknownState]);
  const mapped = (transitions ?? [])
    .filter((t) => typeof t.at === 'string')
    .map((t) => ({ state: t.to_state, at: t.at as string }));
  return (
    <div style={style} className={className}>
      <LegacyStatusTimeline
        {...rest}
        testId={testId}
        audience={audience}
        state={(known ? state : 'CREATED') as OrderState}
        transitions={mapped}
        disconnected={connection === 'reconnecting'}
        {...(now !== undefined ? { serverNow: new Date(now).toISOString() } : {})}
      />
    </div>
  );
}
