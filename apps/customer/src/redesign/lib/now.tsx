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
 * Move the app's clock. `{ offsetMs }` shifts real time (dev: "jump 16 minutes"); `{ at }` freezes
 * it (tests). `null` restores real time.
 */
export function setNowOverride(override: { offsetMs: number } | { at: number } | null): void {
  if (override === null) {
    offsetMs = 0;
    frozenAt = null;
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
