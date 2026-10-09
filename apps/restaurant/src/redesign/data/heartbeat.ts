/**
 * The console heartbeat (manifest WP1, LO `Board-gate`): every 30 s while this screen is
 * visible. Without one for 5 minutes the server computes the restaurant to CLOSED_OFFLINE and
 * stops offering it orders. The rate limit is 4 a minute, so 30 s leaves room for the beat
 * that fires on becoming visible again.
 *
 * Each beat's outcome feeds `useHeartbeatHealth()` (WP4: the screen-health badge and the
 * offline banner): the last success time, and since when beats have been failing. A 429 is
 * neither (back off, no UI); a 401 is the session's business (the signed-out alert).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { client } from './client';

export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface HeartbeatHealth {
  /** When the last beat succeeded (epoch ms), or null before the first. */
  lastOkAt: number | null;
  /** When beats started failing (network error or 5xx), or null while they succeed. */
  failingSince: number | null;
}

let health: HeartbeatHealth = { lastOkAt: null, failingSince: null };
const listeners = new Set<() => void>();

function setHealth(next: HeartbeatHealth) {
  if (next.lastOkAt === health.lastOkAt && next.failingSince === health.failingSince) return;
  health = next;
  listeners.forEach((l) => l());
}

export function recordHeartbeat(ok: boolean, at: number = Date.now()): void {
  if (ok) setHealth({ lastOkAt: at, failingSince: null });
  else setHealth({ lastOkAt: health.lastOkAt, failingSince: health.failingSince ?? at });
}

/** For tests. */
export function resetHeartbeatHealth(): void {
  setHealth({ lastOkAt: null, failingSince: null });
}

export function useHeartbeatHealth(): HeartbeatHealth {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => health,
  );
}

export async function sendHeartbeat(): Promise<unknown> {
  try {
    const res = await client.POST('/v1/restaurant/heartbeat', {});
    const status = res.response.status;
    if (res.response.ok) recordHeartbeat(true);
    else if (status >= 500) recordHeartbeat(false);
    return res;
  } catch {
    // Transient: the next beat retries; the offline banner reports a lasting failure.
    recordHeartbeat(false);
    return undefined;
  }
}

export function useHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      void sendHeartbeat();
      timer = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    };
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
