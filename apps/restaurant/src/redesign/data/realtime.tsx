/**
 * The redesign's realtime socket: one per signed-in tab, ticket minted through the redesign
 * client (so a 401 refreshes instead of redirecting). Screens subscribe with
 * `useRealtimeChannel('restaurant:{id}' | 'order:{id}', …)`; whenever the status is not
 * `open` they poll REST instead (the socket is an optimisation, never the only path).
 */
import type { ReactNode } from 'react';
import { RealtimeProvider } from '@hg/ui-web/live';
import { getSession } from '../../lib/api';
import { API_BASE_URL, client } from './client';
import { call } from './call';

const SOCKET_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) || undefined;

async function mintTicket() {
  const ticket = await call(client.POST('/v1/realtime/ticket', { params: { header: { 'X-HG-Client': 'restaurant-web' } } }));
  return { ticket: ticket.ticket, websocket_url: ticket.websocket_url };
}

export function ConsoleRealtime({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  return (
    <RealtimeProvider
      client="restaurant-web"
      apiBaseUrl={API_BASE_URL}
      socketUrl={SOCKET_URL}
      mintTicket={mintTicket}
      getAccessToken={() => getSession()?.accessToken ?? null}
      enabled={enabled}
    >
      {children}
    </RealtimeProvider>
  );
}
