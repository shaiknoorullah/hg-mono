/**
 * Live map for an order that is on its way. Polls `GET /v1/orders/{id}/tracking` every 10 s
 * while mounted (the screen renders it only for delivery-phase states) and draws a Mapbox Static
 * Images picture with the restaurant, the drop-off and, once the contract exposes it, the rider.
 * No native map SDK. With no `EXPO_PUBLIC_MAPBOX_TOKEN` the map is hidden and only the ETA text
 * shows. Polling stops on unmount and once the order is finished.
 */
import * as React from 'react';
import { Image, Text, View } from 'react-native';
import { useTheme, useTypeStyle } from '@hg/ui-native';

import { getOrderTracking, type OrderTracking } from '../api/orders';
import { buildStaticMapUrl } from './staticMapUrl';

const POLL_MS = 10_000;
const FINISHED: ReadonlySet<string> = new Set([
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'RESOLVED',
]);
const MAP_W = 640;
const MAP_H = 320;

function etaText(t: OrderTracking): string | null {
  if (!t.eta_at) return null;
  const at = new Date(t.eta_at);
  if (Number.isNaN(at.getTime())) return null;
  const hm = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const win = t.eta_window_minutes;
  return win
    ? `Arriving ${hm(at)}–${hm(new Date(at.getTime() + win * 60_000))}`
    : `Arriving ${hm(at)}`;
}

export function TrackingMap({ orderId }: { orderId: string }): React.ReactElement | null {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const [tracking, setTracking] = React.useState<OrderTracking | null>(null);
  const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

  React.useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      getOrderTracking(orderId)
        .then((t) => {
          if (!live) return;
          setTracking(t);
          if (!FINISHED.has(t.state)) timer = setTimeout(tick, POLL_MS);
        })
        .catch(() => {
          if (live) timer = setTimeout(tick, POLL_MS);
        });
    };
    tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  if (!tracking) return null;
  const eta = etaText(tracking);
  const uri = token
    ? buildStaticMapUrl({
        token,
        width: MAP_W,
        height: MAP_H,
        restaurant: tracking.restaurant_location,
        destination: tracking.destination_location,
        rider: tracking.rider_location,
      })
    : null;

  return (
    <View style={{ gap: 8 }}>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel="Map showing the restaurant, your address and the rider"
          style={{ width: '100%', aspectRatio: MAP_W / MAP_H, borderRadius: 12 }}
        />
      ) : null}
      {eta ? <Text style={[body, { color: theme.color.text.secondary }]}>{eta}</Text> : null}
    </View>
  );
}
