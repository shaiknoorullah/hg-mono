/**
 * Whether the phone can reach our API, as last observed.
 *
 * The app has no network-info dependency, and the question that matters is "did our last call get
 * through", not "is there Wi-Fi". The redesign API client marks the app offline when a request
 * fails in transport and online again on any response, so every screen's offline state
 * ("You're offline. Showing … as of 6:42 pm") follows real reachability.
 */
import * as React from 'react';

import { getNow } from './now';

interface ConnectivityState {
  online: boolean;
  /** When the app last heard from the API (epoch ms), or null before the first response. */
  lastOnlineAt: number | null;
}

let state: ConnectivityState = { online: true, lastOnlineAt: null };
const listeners = new Set<() => void>();

function emit(next: ConnectivityState): void {
  state = next;
  for (const fn of listeners) fn();
}

export function markOnline(): void {
  if (state.online && state.lastOnlineAt !== null && getNow() - state.lastOnlineAt < 1000) return;
  emit({ online: true, lastOnlineAt: getNow() });
}

export function markOffline(): void {
  if (!state.online) return;
  emit({ ...state, online: false });
}

export function getConnectivity(): ConnectivityState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useConnectivity(): ConnectivityState {
  return React.useSyncExternalStore(subscribe, getConnectivity, getConnectivity);
}

/** Tests only: start from a known state. */
export function resetConnectivity(next: ConnectivityState = { online: true, lastOnlineAt: null }): void {
  emit(next);
}
