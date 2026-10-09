/**
 * This screen's connection to HalalGoes, for the screen-health badge, the health panel and the
 * connection banners (LO `Board-reconnecting`, `Board-closed-offline`; wp1 spec §6, inference
 * Q-C1): the socket is an optimisation, REST is the truth.
 *
 * - REST failing (heartbeats fail, or the browser says it is offline) → `offline`, since the
 *   last successful heartbeat;
 * - socket not open but REST answering, after it had been open → `reconnecting`, since the
 *   moment it dropped;
 * - socket never open yet → `connecting`;
 * - otherwise → `live`.
 */
import { useEffect, useState } from 'react';
import { useRealtimeStatus } from '@hg/ui-web/live';
import { useHeartbeatHealth, type HeartbeatHealth } from './heartbeat';

export type ConnectionKind = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface ConnectionView {
  kind: ConnectionKind;
  /** When the condition started (epoch ms): reconnecting = socket dropped, offline = last good beat. */
  since: number | null;
}

export interface ConnectionInputs {
  realtime: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'offline';
  /** The socket has been open at least once on this page load. */
  everOpen: boolean;
  /** When the socket last left `open`. */
  droppedAt: number | null;
  heartbeat: HeartbeatHealth;
  browserOnline: boolean;
}

export function connectionView(i: ConnectionInputs): ConnectionView {
  if (!i.browserOnline || i.heartbeat.failingSince !== null) {
    return { kind: 'offline', since: i.heartbeat.lastOkAt ?? i.heartbeat.failingSince };
  }
  if (i.realtime === 'open') return { kind: 'live', since: null };
  if (!i.everOpen) return { kind: 'connecting', since: null };
  return { kind: 'reconnecting', since: i.droppedAt };
}

function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

// One page load's socket history, shared by every reader (status bar, banners, health panel).
let everOpen = false;
let droppedAt: number | null = null;
let lastSeen: ConnectionInputs['realtime'] | null = null;

/** For tests. */
export function resetConnectionHistory(): void {
  everOpen = false;
  droppedAt = null;
  lastSeen = null;
}

function track(realtime: ConnectionInputs['realtime']): void {
  if (realtime === lastSeen) return;
  if (realtime === 'open') {
    everOpen = true;
    droppedAt = null;
  } else if (lastSeen === 'open') {
    droppedAt = Date.now();
  }
  lastSeen = realtime;
}

export function useConnection(): ConnectionView {
  const realtime = useRealtimeStatus();
  const heartbeat = useHeartbeatHealth();
  const browserOnline = useBrowserOnline();
  track(realtime);
  return connectionView({ realtime, everOpen, droppedAt, heartbeat, browserOnline });
}
