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

/**
 * "First load failed" (LO `Board-first-load-error`): a page whose first read failed (nothing on
 * screen) publishes it, and the status bar reads health "Not connected" and open state
 * "Unknown" even when the availability read itself answered.
 */
const failedSources = new Set<string>();
let failedSnapshot = false;
const failedListeners = new Set<() => void>();

export function publishFirstLoadFailed(key: string, failed: boolean): void {
  if (failed === failedSources.has(key)) return;
  if (failed) failedSources.add(key);
  else failedSources.delete(key);
  failedSnapshot = failedSources.size > 0;
  failedListeners.forEach((l) => l());
}

export function useFirstLoadFailed(): boolean {
  return useSyncExternalStore(
    (l) => {
      failedListeners.add(l);
      return () => failedListeners.delete(l);
    },
    () => failedSnapshot,
  );
}
