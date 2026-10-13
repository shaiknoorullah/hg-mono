/**
 * StatusTimeline specimens for the design preview, one per labelled row of the live
 * components/StatusTimeline/preview.html, so the report pairs them.
 */

import { StatusTimeline } from './StatusTimeline.js';

/** The design system's component name, pairing these specimens with its preview page. */
export const component = 'StatusTimeline';

const T0 = Date.parse('2026-09-28T18:40:00Z');
const TRANSITIONS = [
  { to_state: 'AUTHORIZED', at: '2026-09-28T18:42:00Z' },
  { to_state: 'RESTAURANT_PENDING', at: '2026-09-28T18:42:10Z' },
  { to_state: 'PREPARING', at: '2026-09-28T18:44:00Z' },
] as const;

/** Row "customer · PREPARING". */
export function CustomerPreparing() {
  return (
    <div style={{ width: 320 }}>
      <StatusTimeline audience="customer" state="PREPARING" transitions={[...TRANSITIONS]} estimatedAt="2026-09-28T19:15:00Z" />
    </div>
  );
}

/** Row "stalled (deadline passed)". */
export function StalledDeadlinePassed() {
  return (
    <div style={{ width: 560 }}>
      <StatusTimeline
        audience="customer"
        state="RESTAURANT_PENDING"
        deadlineAt="2026-09-28T18:40:00Z"
        now={T0 + 600000}
        orientation="horizontal"
        showTimes={false}
      />
    </div>
  );
}

/** Row "REJECTED". */
export function Rejected() {
  return (
    <div style={{ width: 560 }}>
      <StatusTimeline audience="customer" state="REJECTED" orientation="horizontal" showTimes={false} />
    </div>
  );
}

/** Row "compact · reconnecting". */
export function CompactReconnecting() {
  return (
    <div style={{ width: 320 }}>
      <StatusTimeline audience="customer" state="PICKED_UP" orientation="compact" connection="reconnecting" />
    </div>
  );
}

/** Row "loading". */
export function Loading() {
  return (
    <div style={{ width: 320 }}>
      <StatusTimeline audience="customer" loading orientation="horizontal" />
    </div>
  );
}

/** The restaurant's track, as the order timeline pane draws it. */
export function RestaurantVertical() {
  return (
    <div style={{ width: 320 }}>
      <StatusTimeline audience="restaurant" state="READY_FOR_PICKUP" transitions={[...TRANSITIONS]} />
    </div>
  );
}
