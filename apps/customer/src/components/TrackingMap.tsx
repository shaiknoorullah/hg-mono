/**
 * The live map for an order that is on its way: the restaurant, the drop-off and the rider,
 * moving as the rider's position arrives (socket first, REST poll every 5 s when it is down; see
 * tracking/trackingFeed.ts). The native Mapbox SDK draws it, so it exists only in a build that has
 * the SDK and a public token (`EXPO_PUBLIC_MAPBOX_TOKEN`). Without either, the card shows the ETA
 * text alone. The rider's position is exposed only once the order is picked up (the contract), so
 * before that the map shows the restaurant and the drop-off. Pins use theme tokens; none of them
 * says anything about halal, and none is red.
 */
import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTheme, useTypeStyle } from '@hg/ui-native';

import type { OrderTracking } from '../api/orders';
import { loadMapbox } from '../maps/nativeMapbox';
import { boundsOf, staleSeconds } from '../tracking/trackingFeed';
import { useGlide, useLiveTracking } from '../tracking/useLiveTracking';

const MAP_HEIGHT = 240;
const mapboxToken = () => process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
let tokenSet = false;

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

function useNow(active: boolean, everyMs = 1_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return now;
}

function Pin({ color, label, size }: { color: string; label: string; size: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        borderWidth: 3,
        borderColor: theme.color.surface.raised,
      }}
    />
  );
}

export function TrackingMap({ orderId }: { orderId: string }): React.ReactElement | null {
  const theme = useTheme();
  const body = useTypeStyle('body.md');
  const { tracking, rider, error, retry } = useLiveTracking(orderId);
  const glide = useGlide(rider);
  const now = useNow(rider !== null);

  const mapbox = loadMapbox();
  const token = mapboxToken();

  if (!tracking) {
    if (!error) return null; // the screen already shows its own loading state
    return (
      <View style={{ gap: 8 }}>
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Live tracking isn't available right now.
        </Text>
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text style={[body, { color: theme.color.text.primary, textDecorationLine: 'underline' }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  const eta = etaText(tracking);
  const stale = staleSeconds(rider, now);
  const restaurant = tracking.restaurant_location;
  const dropoff = tracking.destination_location ?? null;
  const bounds = boundsOf([restaurant, dropoff, rider]);

  let map: React.ReactElement | null = null;
  if (mapbox && token && bounds) {
    if (!tokenSet) {
      void mapbox.setAccessToken(token);
      tokenSet = true;
    }
    const { MapView, Camera, MarkerView } = mapbox;
    const at = (p: { latitude: number; longitude: number }): [number, number] => [
      p.longitude,
      p.latitude,
    ];
    map = (
      <View
        accessible
        accessibilityLabel="Live map of the restaurant, your address and the rider"
        style={{ height: MAP_HEIGHT, borderRadius: 12, overflow: 'hidden' }}
      >
        <MapView
          style={{ flex: 1 }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          scaleBarEnabled={false}
          attributionPosition={{ bottom: 4, left: 4 }}
          logoEnabled
        >
          <Camera
            bounds={{
              ne: bounds.ne,
              sw: bounds.sw,
              paddingTop: 48,
              paddingBottom: 48,
              paddingLeft: 48,
              paddingRight: 48,
            }}
            animationMode="easeTo"
            animationDuration={800}
          />
          <MarkerView id="restaurant" coordinate={at(restaurant)}>
            <Pin color={theme.color.action.secondary} label="Restaurant" size={18} />
          </MarkerView>
          {dropoff ? (
            <MarkerView id="dropoff" coordinate={at(dropoff)}>
              <Pin color={theme.color.text.primary} label="Your address" size={18} />
            </MarkerView>
          ) : null}
          {glide ? (
            <MarkerView id="rider" coordinate={at(glide)}>
              <Pin color={theme.color.action.primary} label="Rider" size={24} />
            </MarkerView>
          ) : null}
        </MapView>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {map}
      {eta ? <Text style={[body, { color: theme.color.text.secondary }]}>{eta}</Text> : null}
      {stale !== null ? (
        <Text style={[body, { color: theme.color.text.secondary }]}>
          Rider location updated {stale}s ago
        </Text>
      ) : null}
    </View>
  );
}
