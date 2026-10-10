/**
 * `@hg/ui-web/ds` compatibility layer.
 *
 * The redesign's app code is written against the props of the live Claude Design system
 * (`components/index.d.ts`, artifact 1GwGVZz8Ju9wcz4HfCnzbv). Where a legacy component already
 * renders the right thing but names a prop differently, a thin adapter here translates the live
 * props to the legacy ones. The design-system work packages then replace each adapter with the
 * rebuilt component one at a time, with the same props, so app code never changes.
 *
 * Nothing here changes how a legacy component looks: the adapters only rename props.
 * Root exports (`@hg/ui-web`) are untouched, so the released apps are unaffected.
 */

import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';

import { StatusTimeline as LegacyStatusTimeline } from '../feedback/index.js';
import type { OrderState } from '@hg/api-client';

/* ───── StatusTimeline ───── */

/** Props of the live `StatusTimeline` (index.d.ts). */
export interface StatusTimelineProps {
  audience: 'customer' | 'restaurant' | 'rider' | 'admin';
  state?: OrderState;
  /** OrderTracking.timeline. Entries without a time are not drawn as times. */
  transitions?: Array<{ to_state: OrderState; from_state?: OrderState | null; at?: string }>;
  orientation?: 'vertical' | 'horizontal' | 'compact';
  showTimes?: boolean;
  estimatedAt?: string | null;
  deadlineAt?: string | null;
  loading?: boolean;
  /** 'reconnecting' keeps the last state and says it is not updating. */
  connection?: 'live' | 'reconnecting';
  testId?: string;
}

/** Order progress from the contract timeline, rendered by the legacy StatusTimeline. */
export function StatusTimeline({ state, transitions, connection, ...rest }: StatusTimelineProps) {
  if (!state) return <LegacyStatusTimeline {...rest} state={'CREATED'} loading />;
  return (
    <LegacyStatusTimeline
      {...rest}
      state={state}
      disconnected={connection === 'reconnecting'}
      transitions={(transitions ?? [])
        .filter((t): t is { to_state: OrderState; at: string } => typeof t.at === 'string')
        .map((t) => ({ state: t.to_state, at: t.at }))}
    />
  );
}

/** Props the live design system declares on every component. */
export interface DsCommonProps {
  testId?: string;
  style?: CSSProperties;
}

export type { SyntheticEvent };
