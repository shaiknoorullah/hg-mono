/**
 * The console heartbeat (manifest WP1, LO `Board-gate`): every 30 s while this screen is
 * visible. Without one for 5 minutes the server computes the restaurant to CLOSED_OFFLINE and
 * stops offering it orders. The rate limit is 4 a minute, so 30 s leaves room for the beat
 * that fires on becoming visible again.
 */
import { useEffect } from 'react';
import { client } from './client';

export const HEARTBEAT_INTERVAL_MS = 30_000;

export function sendHeartbeat(): Promise<unknown> {
  return client.POST('/v1/restaurant/heartbeat', {}).catch(() => {
    /* transient: the next beat retries; the connection banner reports a lasting failure */
  });
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
