/**
 * The admin console's realtime socket — one per signed-in tab (`contracts/websocket.md`).
 *
 * A single-use ticket is minted over REST (`createRealtimeTicket`) for every connection
 * attempt. Admin and support may subscribe to `admin:ops` and to any `order:{id}`; they
 * receive `rider.location` in full (websocket.md "Per-role projection rules": support and
 * admin see everything, with PII masked by default).
 *
 * `VITE_WS_URL` overrides the socket URL for local development; otherwise the ticket's
 * `websocket_url` is used, or `{VITE_API_BASE_URL}/v1/ws` when the ticket's is not a `ws(s)` URL.
 */
import type { ReactNode } from 'react';
import { RealtimeProvider, type MapboxModule } from '@hg/ui-web/live';

import { api } from './api.js';
import { API_BASE_URL } from './config.js';
import { unwrap } from './load.js';
import { getToken } from './token.js';

const SOCKET_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) || undefined;

/** The Mapbox public token for the live maps (`VITE_MAPBOX_TOKEN`). */
export const MAPBOX_PUBLIC_TOKEN = (import.meta.env['VITE_MAPBOX_TOKEN'] as string | undefined) ?? '';

/** Loads `mapbox-gl` and its stylesheet on first use. */
export const loadMapbox = () =>
  Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')]).then(([mod]) => mod as unknown as MapboxModule);

async function mintTicket() {
  const { data } = await unwrap(api.POST('/v1/realtime/ticket', { params: { header: { 'X-HG-Client': 'admin-web' } } }));
  return { ticket: data.ticket, websocket_url: data.websocket_url };
}

/** Wraps the signed-in console in the realtime connection. */
export function AdminRealtime({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider client="admin-web" apiBaseUrl={API_BASE_URL} socketUrl={SOCKET_URL} mintTicket={mintTicket} getAccessToken={getToken}>
      {children}
    </RealtimeProvider>
  );
}
