/**
 * The one toast the address form leaves for Saved addresses ("Address deleted"), because the form
 * is closed by the time it should show. It lives in memory, is shown once and is cleared when the
 * toast is dismissed or the list takes it; it is never persisted.
 */
import * as React from 'react';

export interface AddressNotice {
  title: string;
  description: string;
}

let current: AddressNotice | null = null;
const listeners = new Set<() => void>();

export function getAddressNotice(): AddressNotice | null {
  return current;
}

export function showAddressNotice(notice: AddressNotice): void {
  current = notice;
  for (const fn of listeners) fn();
}

export function clearAddressNotice(): void {
  if (current === null) return;
  current = null;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAddressNotice(): AddressNotice | null {
  return React.useSyncExternalStore(subscribe, getAddressNotice, getAddressNotice);
}
