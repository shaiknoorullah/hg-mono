import * as React from 'react';

import { getOrderTracking } from '../api/orders';
import { openOrderSocket } from '../realtime/orderSocket';
import { createTrackingFeed, lerpPoint, type TrackingSnapshot } from './trackingFeed';

/** Live tracking for one order: socket first, REST poll every 5 s while the socket is down. */
export function useLiveTracking(orderId: string): TrackingSnapshot & { retry: () => void } {
  const feed = React.useMemo(
    () =>
      createTrackingFeed({
        fetchTracking: () => getOrderTracking(orderId),
        openSocket: (handlers) => openOrderSocket(orderId, handlers),
      }),
    [orderId],
  );
  React.useEffect(() => {
    feed.start();
    return () => feed.stop();
  }, [feed]);
  const snap = React.useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  return { ...snap, retry: feed.retry };
}

/**
 * A point that glides to each new position instead of jumping, over `ms`. Returns the position to
 * draw now.
 */
export function useGlide<P extends { latitude: number; longitude: number }>(
  target: P | null,
  ms = 4_000,
): { latitude: number; longitude: number } | null {
  const [shown, setShown] = React.useState<{ latitude: number; longitude: number } | null>(target);
  const shownRef = React.useRef(shown);
  shownRef.current = shown;

  React.useEffect(() => {
    if (!target) {
      setShown(null);
      return;
    }
    const from = shownRef.current ?? target;
    const start = Date.now();
    const id = setInterval(() => {
      const t = (Date.now() - start) / ms;
      setShown(lerpPoint(from, target, t));
      if (t >= 1) clearInterval(id);
    }, 100);
    return () => clearInterval(id);
  }, [target?.latitude, target?.longitude, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return shown;
}
