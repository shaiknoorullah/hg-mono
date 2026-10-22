/**
 * The redesign's realtime connection: one ticketed socket per signed-in tab
 * (`contracts/websocket.md`), the same `RealtimeProvider` the legacy console uses
 * (`src/lib/realtime.tsx`), with the ticket minted through the redesign's client so a 401 raises
 * the session-ended dialog instead of dropping the page.
 *
 * It also feeds the sidebar's queue counts: `admin.queue_depth` on `admin:ops` goes into the
 * shared store (`./queueDepth`), and so does the connection status (for the stale line). Every
 * other `admin:ops` event is an alert and goes into `../alerts/store`.
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
import { applyAlertEvent, applyReplay, BACKFILL_EVENTS, setAlertsConnection, setAlertsFailure } from '../alerts/store';
import { applyQueueDepthFrame, setQueueConnection } from './queueDepth';

const SOCKET_URL = (import.meta.env['VITE_WS_URL'] as string | undefined) || undefined;

/** The operations channel every staff role may join. */
export const ADMIN_OPS_CHANNEL = 'admin:ops';

async function mintTicket() {
  const { data } = await unwrap(api.POST('/v1/realtime/ticket', { params: { header: { 'X-HG-Client': 'admin-web' } } }));
  return { ticket: data.ticket, websocket_url: data.websocket_url };
}

/**
 * The one listener on `admin:ops`: queue counts for the sidebar and every alert for Live alerts and
 * the banner. The first subscribe asks for the recent events to be replayed, so the alerts page is
 * whole when it opens whatever page the person was on.
 */
function OpsFeed({ role }: { role: StaffRole | null }) {
  const status = useRealtimeStatus();
  useEffect(() => {
    setQueueConnection(status);
    setAlertsConnection(status);
  }, [status]);
  useRealtimeChannel(
    ADMIN_OPS_CHANNEL,
    (signal) => {
      const depth = eventOfType(signal, 'admin.queue_depth');
      if (depth) {
        applyQueueDepthFrame(depth.data, depth.ts ?? null, role);
        return;
      }
      if (signal.kind === 'event') applyAlertEvent(signal.event);
    },
    {
      backfill: BACKFILL_EVENTS,
      onReplay: (result) => applyReplay(result),
      // Two refusals have a screen of their own (`../alerts/AlertsRoute`). `not_found` and
      // `subscription_limit` have no board yet, so they are not turned into words here.
      onSubscribeError: ({ code }) => {
        if (code === 'forbidden') setAlertsFailure({ kind: 'forbidden' });
        else if (code === 'invalid_channel') setAlertsFailure({ kind: 'invalid-channel' });
      },
    },
  );
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
      // The server wants a new sign-in (`reauth_required`, or close 4401): live alerts ask for it.
      onReauthRequired={(info) => setAlertsFailure({ kind: 'reauth', at: new Date(info.at) })}
      enabled={enabled}
      {...(createSocket ? { createSocket } : {})}
    >
      <OpsFeed role={role} />
      {children}
    </RealtimeProvider>
  );
}
