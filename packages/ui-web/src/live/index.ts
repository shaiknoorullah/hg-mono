/**
 * Live — the realtime socket and the live map shared by the restaurant and admin web apps.
 *
 *  - `RealtimeProvider` / `useRealtimeChannel` / `useRealtimeStatus`: one ticketed socket per
 *    signed-in tab, per `contracts/websocket.md`.
 *  - `usePolling`: the REST fallback whenever the socket is not open — the socket is an
 *    optimisation, never the only path.
 *  - `LiveMap`: `mapbox-gl` (injected), riders gliding between fixes, coarse fixes drawn as a
 *    ~100 m disc, "last updated Ns ago" after 30 s.
 */

export { RealtimeConnection, resolveSocketUrl } from './realtimeConnection.js';
export type {
  ChannelHandler,
  ChannelSignal,
  RealtimeConnectionOptions,
  RealtimeStatus,
  RealtimeTicketLike,
  SocketLike,
} from './realtimeConnection.js';

export {
  RealtimeProvider,
  eventOfType,
  useRealtimeChannel,
  useRealtimeChannels,
  useRealtimeStatus,
} from './useRealtime.js';
export type { RealtimeProviderProps, TypedRealtimeEvent } from './useRealtime.js';

export { usePolling } from './usePolling.js';

export {
  COARSE_RADIUS_M,
  STALE_FIX_MS,
  fixAgeSeconds,
  fixFromEvent,
  fixFromRest,
  isStale,
  lastUpdatedLabel,
  newerFix,
} from './riderFix.js';
export type { RiderFix } from './riderFix.js';

export { LiveMap, interpolate, metresToPixels } from './LiveMap.js';
export type { LiveMapPlace, LiveMapProps, LiveMapRider, MapboxModule } from './LiveMap.js';
