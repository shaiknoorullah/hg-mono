/**
 * "Refresh failed, data kept" (LO `Board-error-stale`): a page whose silent refresh failed
 * publishes when it last succeeded and how to retry; the status bar shows the stale badge
 * ("Last updated 6:44 pm · may be out of date") and the banner area shows "Couldn’t refresh"
 * with "Try now". Clearing (`null`) removes both.
 */
import { useSyncExternalStore } from 'react';

export interface StaleInfo {
  /** When the data on screen was last read successfully (epoch ms). */
  lastOkAt: number;
  retry: () => void;
}

const sources = new Map<string, StaleInfo>();
let snapshot: StaleInfo | null = null;
const listeners = new Set<() => void>();

function recompute() {
  let oldest: StaleInfo | null = null;
  for (const s of sources.values()) if (!oldest || s.lastOkAt < oldest.lastOkAt) oldest = s;
  snapshot = oldest;
  listeners.forEach((l) => l());
}

export function publishStale(key: string, info: StaleInfo | null): void {
  const had = sources.get(key);
  if (!info && !had) return;
  if (info && had && had.lastOkAt === info.lastOkAt && had.retry === info.retry) return;
  if (info) sources.set(key, info);
  else sources.delete(key);
  recompute();
}

export function useStale(): StaleInfo | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}
