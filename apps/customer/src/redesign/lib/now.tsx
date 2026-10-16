/**
 * The redesign's clock (manifest WP0: `useNow()` with a dev override).
 *
 * Every time-dependent rule (the 15-minute halal cache, deadlines, "ask again at 6:48 pm") reads
 * the time through `getNow()`, never `Date.now()`, so a test or a dev build can move the clock and
 * watch the rule flip. `useNow(intervalMs)` re-renders on that interval; nothing on screen ticks
 * from it (no countdown numerals, constitution §5), it only decides which static state to show.
 */
import * as React from 'react';

let offsetMs = 0;
let frozenAt: number | null = null;
const listeners = new Set<() => void>();

/** The app's current time in epoch milliseconds. */
export function getNow(): number {
  return frozenAt ?? Date.now() + offsetMs;
}

/**
 * How far the device clock is from the server's, from the newest `server_time` an order read
 * carried (server minus device, in milliseconds). Deadlines and countdowns on an order are worked
 * out against the server's clock so a phone with a wrong clock still counts them right. The
 * rider offer's `server_time` has the same job
 * ([#925](https://github.com/shaiknoorullah/hg-mono/issues/925)).
 */
let serverSkewMs = 0;

/**
 * Remember the server's clock from an order response's `server_time`. Call it with the field as it
 * came; anything that is not a date is ignored. Network delay is not subtracted: it is a second or
 * two, where a wrong clock is minutes.
 */
export function adoptServerTime(serverTime: string | null | undefined): void {
  const at = typeof serverTime === 'string' ? Date.parse(serverTime) : NaN;
  if (Number.isNaN(at)) return;
  serverSkewMs = at - getNow();
  for (const fn of listeners) fn();
}

/** The server's current time in epoch milliseconds: the app's clock corrected by the last `server_time`. */
export function getServerNow(): number {
  return getNow() + serverSkewMs;
}

/**
 * Move the app's clock. `{ offsetMs }` shifts real time (dev: "jump 16 minutes"); `{ at }` freezes
 * it (tests). `null` restores real time.
 */
export function setNowOverride(override: { offsetMs: number } | { at: number } | null): void {
  if (override === null) {
    offsetMs = 0;
    frozenAt = null;
    serverSkewMs = 0;
  } else if ('at' in override) {
    frozenAt = override.at;
  } else {
    frozenAt = null;
    offsetMs = override.offsetMs;
  }
  for (const fn of listeners) fn();
}

/** The current app time, re-read every `intervalMs` and whenever the override changes. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(getNow);
  React.useEffect(() => {
    const update = () => setNow(getNow());
    listeners.add(update);
    const id = setInterval(update, intervalMs);
    return () => {
      listeners.delete(update);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

/**
 * The server's current time, re-read every `intervalMs` and whenever a response brings a new
 * `server_time`. Use it, not `useNow`, for any comparison with an order's `deadline_at`.
 */
export function useServerNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(getServerNow);
  React.useEffect(() => {
    const update = () => setNow(getServerNow());
    listeners.add(update);
    const id = setInterval(update, intervalMs);
    return () => {
      listeners.delete(update);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
