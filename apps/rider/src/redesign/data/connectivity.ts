/**
 * Is the phone reaching the API? Learned from the requests themselves: a transport failure
 * (DNS, TLS, no route — `fetch` rejecting) marks the app offline; any HTTP answer, even an
 * error, marks it back online. No NetInfo dependency: what matters to a rider is whether *our*
 * server answers, and a captive portal or dead cell can show "connected" to NetInfo while every
 * request fails.
 */
import * as React from 'react';

let online = true;
let since = 0;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (online === next) return;
  online = next;
  since = Date.now();
  for (const fn of listeners) fn();
}

export function reportTransportFailure(): void {
  set(false);
}

export function reportReachable(): void {
  set(true);
}

export function isOnline(): boolean {
  return online;
}

/** When the current online/offline state began (ms epoch; 0 = since launch). */
export function connectivitySince(): number {
  return since;
}

export function subscribeConnectivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `true` while the API is reachable. Re-renders on change. */
export function useOnline(): boolean {
  return React.useSyncExternalStore(subscribeConnectivity, isOnline, isOnline);
}

/** Test seam: back to "online", no history. */
export function resetConnectivity(): void {
  online = true;
  since = 0;
  listeners.clear();
}
