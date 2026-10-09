/**
 * The delivery address chosen in the address switcher (D2), for this session only.
 *
 * Choosing an address never changes the customer's default (the switcher never calls
 * `setDefaultAddress`): it changes which restaurants Home lists and which address the quote is
 * built for (`createQuote` takes `delivery_address_id`). It lives in memory and is gone on the
 * next launch or sign-out, when Home falls back to the default address again. Manifest §5 G1: no
 * operation sets `cart.delivery_address_id`, so checkout reads this choice too.
 */
import * as React from 'react';

import { isAuthed, subscribe as subscribeToken } from '../../api/token';
import type { Address } from './format';

let chosenId: string | null = null;
const listeners = new Set<() => void>();

export function getChosenAddressId(): string | null {
  return chosenId;
}

export function chooseAddress(id: string | null): void {
  if (chosenId === id) return;
  chosenId = id;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useChosenAddressId(): string | null {
  return React.useSyncExternalStore(subscribe, getChosenAddressId, getChosenAddressId);
}

/**
 * Which saved address Home delivers to: the session's choice while it still exists, else the
 * address marked default, else the profile's default. Never "the first one in the list".
 */
export function resolveDeliveryAddress(
  addresses: readonly Address[],
  profileDefaultId: string | null | undefined,
  chosen: string | null = chosenId,
): Address | null {
  const byId = (id: string | null | undefined) => (id ? addresses.find((a) => a.id === id) ?? null : null);
  return byId(chosen) ?? addresses.find((a) => a.is_default) ?? byId(profileDefaultId) ?? null;
}

export function resetChosenAddress(): void {
  chooseAddress(null);
}

// The choice belongs to this session's customer: signing out (or a forced sign-out) forgets it, so
// the next customer starts on their own default address and checkout never quotes for the last one.
subscribeToken(() => {
  if (!isAuthed()) resetChosenAddress();
});
