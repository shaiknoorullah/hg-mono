/**
 * This screen's connection to HalalGoes, for the screen-health badge, the health panel and the
 * connection banners (LO `Board-reconnecting`, `Board-closed-offline`; wp1 spec §6, inference
 * Q-C1): the socket is an optimisation, REST is the truth.
 *
 * - REST failing (two heartbeats in a row fail, or the browser says it is offline) → `offline`,
 *   since the last successful heartbeat. One failed beat is a blip, not "offline";
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

/** Failed beats in a row before the screen reads as offline (beats are 30 s apart). */
export const OFFLINE_AFTER_FAILURES = 2;
/** The server computes CLOSED_OFFLINE after this long without a check-in. */
export const SERVER_OFFLINE_AFTER_MS = 5 * 60_000;

export function connectionView(i: ConnectionInputs): ConnectionView {
  if (!i.browserOnline || (i.heartbeat.failingSince !== null && i.heartbeat.failures >= OFFLINE_AFTER_FAILURES)) {
    return { kind: 'offline', since: i.heartbeat.lastOkAt ?? i.heartbeat.failingSince };
  }
  if (i.realtime === 'open') return { kind: 'live', since: null };
  if (!i.everOpen) return { kind: 'connecting', since: null };
  return { kind: 'reconnecting', since: i.droppedAt };
}

/**
 * Offline long enough that the server has stopped offering orders (`Board-closed-offline`):
 * five minutes since the last good check-in, or the server itself said CLOSED_OFFLINE. Before
 * that the screen is offline but orders still flow to it (or to another screen).
 */
export function pastServerCutoff(view: ConnectionView, now: number, serverSaysOffline = false): boolean {
  if (view.kind !== 'offline') return false;
  if (serverSaysOffline) return true;
  return view.since !== null && now - view.since >= SERVER_OFFLINE_AFTER_MS;
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
