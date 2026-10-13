/**
 * The REST fallback loop for a live screen: runs `tick` every `intervalMs` while `active`
 * and the tab is visible, and once immediately on becoming active (unless told not to) or
 * visible again. The socket is an optimisation, never the only path (websocket.md, rule 3) —
 * every live map uses this whenever `useRealtimeStatus()` is not `open`.
 */
import { useEffect, useRef } from 'react';

/**
 * Polls while `active`. `tick` may change between renders without restarting the loop.
 * `immediate: false` skips the first tick when polling starts (the data was just loaded);
 * returning to a hidden tab always ticks at once.
 */
export function usePolling(
  tick: () => void | Promise<void>,
  intervalMs: number,
  active: boolean,
  { immediate = true }: { immediate?: boolean } = {},
): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const start = (runNow: boolean) => {
      stop();
      if (runNow) void tickRef.current();
      timer = setInterval(() => void tickRef.current(), intervalMs);
    };
    const onVisibility = () => (document.hidden ? stop() : start(true));
    if (!document.hidden) start(immediate);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs, immediate]);
}
