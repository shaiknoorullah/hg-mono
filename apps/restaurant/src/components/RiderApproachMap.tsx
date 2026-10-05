/**
 * "Rider approaching" — the live map on an accepted order once a rider is assigned.
 *
 * It listens on `order:{id}` for `rider.location`, which the restaurant receives in its
 * **coarse** projection (rounded to ~100 m, websocket.md "Per-role projection rules"). The
 * position is drawn as a ~100 m disc, never a pin, because a pin would claim precision the
 * restaurant was deliberately not given. The rider's name, vehicle and pickup ETA come from
 * the order (`OrderRiderRef`), never computed from a position.
 *
 * Fallback: the contract gives the restaurant no REST read of the rider's position — the
 * tracking endpoint is customer-only and `OrderRestaurantView` carries no coordinates by
 * design. So while the socket is down the map keeps the last fix (aged "last updated Ns
 * ago") and says it is reconnecting; the order itself keeps refreshing through the queue's
 * polling, so state and ETA stay right.
 *
 * Dispatch and state events on the channel ask the queue to refetch (`onOrderChanged`):
 * events are signals, REST is the truth.
 */
import { useState } from 'react';
import type { Schema } from '@hg/api-client';
import {
  LiveMap,
  eventOfType,
  fixFromEvent,
  newerFix,
  useRealtimeChannel,
  useRealtimeStatus,
  type LiveMapPlace,
  type RiderFix,
} from '@hg/ui-web/live';
import { MAPBOX_PUBLIC_TOKEN, loadMapbox } from '../lib/realtime';

const VEHICLE_LABEL: Record<Schema['VehicleType'], string> = {
  CAR: 'Car',
  SCOOTER: 'Scooter',
  MOTORCYCLE: 'Motorcycle',
  BICYCLE: 'Bicycle',
  ON_FOOT: 'On foot',
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export interface RiderApproachMapProps {
  orderId: string;
  rider: Schema['OrderRiderRef'];
  /** The restaurant's own coordinates, from its profile; `null` draws the rider only. */
  restaurant: { name: string; latitude: number; longitude: number } | null;
  /** Called when an event says the order changed, so the queue refetches it. */
  onOrderChanged: () => void;
}

/** The live "rider approaching" map for one order. */
export function RiderApproachMap({ orderId, rider, restaurant, onOrderChanged }: RiderApproachMapProps) {
  const [fix, setFix] = useState<RiderFix | null>(null);
  const [atRestaurant, setAtRestaurant] = useState(false);
  const status = useRealtimeStatus();

  useRealtimeChannel(`order:${orderId}`, (signal) => {
    if (signal.kind === 'refetch') {
      onOrderChanged();
      return;
    }
    const location = eventOfType(signal, 'rider.location');
    if (location) {
      // Coarse whatever the payload looks like: this audience is only ever given ~100 m.
      setFix((current) => newerFix(current, fixFromEvent(location.data, true)));
      return;
    }
    const dispatch = eventOfType(signal, 'dispatch.state_changed');
    if (dispatch) {
      setAtRestaurant(dispatch.data.to === 'AT_RESTAURANT');
      onOrderChanged();
      return;
    }
    if (eventOfType(signal, 'dispatch.unassigned')) {
      setFix(null);
      setAtRestaurant(false);
      onOrderChanged();
      return;
    }
    if (
      eventOfType(signal, 'dispatch.assigned') ||
      eventOfType(signal, 'order.state_changed') ||
      eventOfType(signal, 'order.eta_updated')
    ) {
      onOrderChanged();
    }
  });

  const places: LiveMapPlace[] = restaurant
    ? [{ id: 'restaurant', kind: 'restaurant', label: restaurant.name, latitude: restaurant.latitude, longitude: restaurant.longitude }]
    : [];
  const riders = [{ id: 'rider', label: `${rider.display_name} (approximate area)`, fix }];
  const vehicle = VEHICLE_LABEL[rider.vehicle_type] ?? rider.vehicle_type;
  const waiting = !fix && !atRestaurant;

  return (
    <div className="mt-4" data-testid="rider-approach-map">
      <LiveMap
        accessToken={MAPBOX_PUBLIC_TOKEN}
        loadMapbox={loadMapbox}
        places={places}
        riders={riders}
        height="200px"
        ariaLabel={`Map of ${rider.display_name} approaching`}
        emptyTitle="Rider position not shared yet"
        emptyDescription="The rider's approximate area appears here once they start moving."
      >
        <p className="m-0">
          {atRestaurant ? 'Rider arrived' : `${rider.display_name} · ${vehicle}`}
        </p>
        {!atRestaurant && rider.eta_at ? (
          <p className="m-0 text-body-sm text-fg-secondary">Pickup around {time(rider.eta_at)}</p>
        ) : null}
        {waiting && status === 'open' ? (
          <p className="m-0 text-body-sm text-fg-secondary">Waiting for the rider's first position</p>
        ) : null}
        {status !== 'open' ? (
          <p className="m-0 text-body-sm text-fg-secondary" role="status">
            Live position paused — reconnecting
          </p>
        ) : null}
      </LiveMap>
    </div>
  );
}
