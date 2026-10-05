/**
 * The restaurant app's realtime socket — one per signed-in tab (`contracts/websocket.md`).
 *
 * A single-use ticket is minted over REST (`createRealtimeTicket`) for every connection
 * attempt; the socket then carries the `order:{id}` channels of the orders on screen. The
 * restaurant receives `rider.location` in its **coarse** projection (rounded to ~100 m by the
 * server, websocket.md "Per-role projection rules"); this app never asks for, or draws, more.
 *
 * `VITE_WS_URL` overrides the socket URL for local development; otherwise the ticket's
 * `websocket_url` is used, or `{VITE_API_BASE_URL}/v1/ws` when the ticket's is not a `ws(s)` URL.
 */
import type { ReactNode } from 'react';
import { RealtimeProvider, type MapboxModule } from '@hg/ui-web/live';
import { api, getSession } from './api';
import { unwrapOrThrow } from './apiHelpers';

const API_BASE_URL = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? 'http://localhost:4010';
const SOCKET_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) || undefined;

/** The Mapbox public token for the live map (`VITE_MAPBOX_TOKEN`). */
export const MAPBOX_PUBLIC_TOKEN = (import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined) ?? '';

/** Loads `mapbox-gl` and its stylesheet on first use, so the queue never downloads them until a rider is assigned. */
export const loadMapbox = () =>
  Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]).then(([mod]) => mod as unknown as MapboxModule);

async function mintTicket() {
  const ticket = await unwrapOrThrow(api.POST('/v1/realtime/ticket', { params: { header: { 'X-HG-Client': 'restaurant-web' } } }));
  return { ticket: ticket.ticket, websocket_url: ticket.websocket_url };
}

/** Wraps the signed-in shell in the realtime connection. */
export function RestaurantRealtime({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider
      client="restaurant-web"
      apiBaseUrl={API_BASE_URL}
      socketUrl={SOCKET_URL}
      mintTicket={mintTicket}
      getAccessToken={() => getSession()?.accessToken ?? null}
    >
      {children}
    </RealtimeProvider>
  );
}
