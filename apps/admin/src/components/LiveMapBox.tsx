/**
 * The order-detail live-tracking map box — `docs/design/admin-order-detail.md`.
 *
 * Live, not a snapshot: it listens on `order:{id}` and glides the rider pin to every
 * `rider.location` (at most one per 5 s per order). Admin and support receive the precise
 * position (websocket.md "Per-role projection rules") and, unlike the customer's tracking
 * view, see it whenever a rider is assigned and has reported a position. State and dispatch
 * events refetch the order silently (`onOrderChanged`) — events are signals, REST is the truth.
 *
 * Fallback: whenever the socket is not open and the order is still on its way, it polls
 * `getOrderAdmin` every 5 s through the same `onOrderChanged`, and the pin follows the REST
 * `rider_location`. A fix older than 30 s says "last updated Ns ago".
 *
 * Pins come from `color.map.*` (drawn by `LiveMap` in `@hg/ui-web/live`). The only green is the
 * rider pin, the registered exception to "solid green is reserved for halal status" (AGENTS.md
 * "Non-negotiable invariants"), because a rider is not a certification claim. The restaurant pin
 * carries no halal state, so it makes no verification claim. A rider pin is absent, honestly,
 * until a rider has reported a position — never fabricated.
 *
 * Without `VITE_MAPBOX_TOKEN` the box renders its empty state — no token, no tile request.
 */
import { useState } from 'react';
import type { Schema } from '@hg/api-client';
import { Button } from '@hg/ui-web';
import {
  LiveMap,
  eventOfType,
  fixFromEvent,
  fixFromRest,
  newerFix,
  usePolling,
  useRealtimeChannel,
  useRealtimeStatus,
  type LiveMapPlace,
  type RiderFix,
} from '@hg/ui-web/live';

import { MAPBOX_PUBLIC_TOKEN, loadMapbox } from '../lib/realtime.js';

type OrderAdminView = Schema['OrderAdminView'];

/** Order states in which a rider can be on the way — the ones worth following live. */
export const TRACKED_STATES: readonly Schema['OrderState'][] = [
  'RESTAURANT_PENDING',
  'PREPARING',
  'READY_FOR_PICKUP',
  'PICKED_UP',
  'ARRIVED',
];

/** REST fallback cadence while the socket is down (the brief's 5 s for a single order). */
export const ORDER_POLL_MS = 5_000;

/** Signals on an order channel that mean "the order changed: refetch it". */
const REFETCH_ON = [
  'order.state_changed',
  'order.eta_updated',
  'order.cancelled',
  'order.completed',
  'dispatch.assigned',
  'dispatch.unassigned',
  'dispatch.state_changed',
] as const;

export interface LiveMapBoxProps {
  order: OrderAdminView;
  etaLabel: string | null;
  countdownLabel: string | null;
  /** Silent refetch of the order. */
  onOrderChanged: () => void | Promise<void>;
}

/** The places an admin order puts on a map: restaurant and delivery address. */
export function orderPlaces(order: OrderAdminView): LiveMapPlace[] {
  const places: LiveMapPlace[] = [];
  if (order.restaurant_location) {
    places.push({
      id: `restaurant:${order.restaurant.id}`,
      kind: 'restaurant',
      label: order.restaurant.name,
      latitude: order.restaurant_location.latitude,
      longitude: order.restaurant_location.longitude,
    });
  }
  const dest =
    order.delivery_address?.latitude != null && order.delivery_address?.longitude != null
      ? { latitude: order.delivery_address.latitude, longitude: order.delivery_address.longitude }
      : order.destination_location;
  if (dest) {
    places.push({ id: `dest:${order.id}`, kind: 'customer', label: `Delivery for ${order.code}`, latitude: dest.latitude, longitude: dest.longitude });
  }
  return places;
}

/** The live map for one order. */
export function LiveMapBox({ order, etaLabel, countdownLabel, onOrderChanged }: LiveMapBoxProps) {
  const [expanded, setExpanded] = useState(false);
  const [liveFix, setLiveFix] = useState<RiderFix | null>(null);
  const status = useRealtimeStatus();
  const tracked = TRACKED_STATES.includes(order.state);

  useRealtimeChannel(tracked ? `order:${order.id}` : null, (signal) => {
    if (signal.kind === 'refetch') {
      void onOrderChanged();
      return;
    }
    const location = eventOfType(signal, 'rider.location');
    if (location) {
      setLiveFix((current) => newerFix(current, fixFromEvent(location.data)));
      return;
    }
    if (eventOfType(signal, 'dispatch.unassigned')) setLiveFix(null);
    if (REFETCH_ON.some((type) => signal.event.type === type)) void onOrderChanged();
  });

  usePolling(onOrderChanged, ORDER_POLL_MS, tracked && status !== 'open');

  const fix = order.rider ? newerFix(fixFromRest(order.rider_location), liveFix) : null;
  const riderLabel = order.rider ? `${order.rider.first_name} ${order.rider.last_initial}. (rider)` : 'Rider';

  return (
    <div className="adm-stack" style={{ gap: 'var(--hg-space-2)' }}>
      <LiveMap
        accessToken={MAPBOX_PUBLIC_TOKEN}
        loadMapbox={loadMapbox}
        places={orderPlaces(order)}
        riders={[{ id: 'rider', label: riderLabel, fix }]}
        height={expanded ? '560px' : '320px'}
        ariaLabel={`Live map for order ${order.code}`}
        emptyTitle="No coordinates available"
        emptyDescription="This order has no locatable parties yet."
      >
        {etaLabel ? <div>{etaLabel}</div> : null}
        {countdownLabel ? <div className="text-body-sm text-fg-secondary">{countdownLabel}</div> : null}
        {tracked && !fix ? (
          <div className="text-body-sm text-fg-secondary">
            No live rider position yet — a rider has not been assigned or has not reported a location.
          </div>
        ) : null}
        {tracked && status !== 'open' ? (
          <div className="text-body-sm text-fg-secondary" role="status">
            Live updates reconnecting — refreshing every 5 seconds
          </div>
        ) : null}
      </LiveMap>
      <div>
        <Button variant="secondary" size="sm" onPress={() => setExpanded((v) => !v)}>
          {expanded ? 'Collapse map' : 'Expand map'}
        </Button>
      </div>
    </div>
  );
}
