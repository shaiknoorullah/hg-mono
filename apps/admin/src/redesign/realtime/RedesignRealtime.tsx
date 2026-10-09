/**
 * The redesign's realtime connection: one ticketed socket per signed-in tab
 * (`contracts/websocket.md`), the same `RealtimeProvider` the legacy console uses
 * (`src/lib/realtime.tsx`), with the ticket minted through the redesign's client so a 401 raises
 * the session-ended dialog instead of dropping the page.
 *
 * It also feeds the sidebar's queue counts: `admin.queue_depth` on `admin:ops` goes into the
 * shared store (`./queueDepth`), and so does the connection status (for the stale line).
 */
import { useEffect, type ReactNode } from 'react';
import {
  RealtimeProvider,
  eventOfType,
  useRealtimeChannel,
  useRealtimeStatus,
  type SocketLike,
} from '@hg/ui-web/live';

import { API_BASE_URL } from '../../lib/config';
import { unwrap } from '../../lib/load';
import { getToken } from '../../lib/token';
import { api } from '../data/api';
import type { StaffRole } from '../data/session';
import { applyQueueDepthFrame, setQueueConnection } from './queueDepth';

const SOCKET_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) || undefined;

/** The operations channel every staff role may join. */
export const ADMIN_OPS_CHANNEL = 'admin:ops';

async function mintTicket() {
  const { data } = await unwrap(api.POST('/v1/realtime/ticket', { params: { header: { 'X-HG-Client': 'admin-web' } } }));
  return { ticket: data.ticket, websocket_url: data.websocket_url };
}

function QueueDepthFeed({ role }: { role: StaffRole | null }) {
  const status = useRealtimeStatus();
  useEffect(() => {
    setQueueConnection(status);
  }, [status]);
  useRealtimeChannel(ADMIN_OPS_CHANNEL, (signal) => {
    const event = eventOfType(signal, 'admin.queue_depth');
    if (event) applyQueueDepthFrame(event.data, event.ts ?? null, role);
  });
  return null;
}

export interface RedesignRealtimeProps {
  children: ReactNode;
  /** The viewer's staff role (support never keeps the rider count). */
  role: StaffRole | null;
  /** `false` keeps the socket closed (the session ended under the page). */
  enabled?: boolean;
  /** Injected by tests (`FakeRealtimeSocket`). */
  createSocket?: (url: string) => SocketLike;
}

/** Wraps the signed-in console in the realtime connection and the queue-count feed. */
export function RedesignRealtime({ children, role, enabled = true, createSocket }: RedesignRealtimeProps) {
  return (
    <RealtimeProvider
      client="admin-web"
      apiBaseUrl={API_BASE_URL}
      socketUrl={SOCKET_URL}
      mintTicket={mintTicket}
      getAccessToken={getToken}
      enabled={enabled}
      {...(createSocket ? { createSocket } : {})}
    >
      <QueueDepthFeed role={role} />
      {children}
    </RealtimeProvider>
  );
}
