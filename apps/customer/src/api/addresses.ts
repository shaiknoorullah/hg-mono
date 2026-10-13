/**
 * Delivery-address reads/writes for checkout.
 *
 * A delivery quote (P-09 / P-11) is priced against a concrete address: the server derives the
 * province from it to select the tax jurisdiction. Checkout picks one of the customer's saved
 * addresses (default first); with none, the customer is sent to the address form. Coordinates
 * come from the address search (`geocode.ts`), never a hard-coded point.
 */
import { idempotencyKey, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type Address = Schema['Address'];
export type AddressInput = Schema['AddressInput'];
export type AddressUpdateInput = Schema['AddressUpdateInput'];

/**
 * Discovery's restaurant list is keyed on `latitude`/`longitude` query params the server uses
 * to compute per-restaurant availability (NO_ADDRESS vs a real distance/ETA/fee) — the address
 * book itself carries no server-side "current address" concept the discovery endpoint reads on
 * its own. `DiscoveryScreen` doesn't remount when the customer returns from the address form
 * (same route key), so without this it would show NO_ADDRESS forever even after a successful
 * save. A version counter any address mutation bumps, subscribed to with
 * `useSyncExternalStore`, is the smallest thing that makes Discovery refetch on return.
 */
let addressVersion = 0;
const addressListeners = new Set<() => void>();
function bumpAddressVersion(): void {
  addressVersion += 1;
  for (const l of addressListeners) l();
}
export function subscribeAddressVersion(listener: () => void): () => void {
  addressListeners.add(listener);
  return () => addressListeners.delete(listener);
}
export function getAddressVersion(): number {
  return addressVersion;
}

export async function listAddresses(): Promise<Address[]> {
  const body = await unwrap(api.GET('/v1/addresses'));
  return body.data as unknown as Address[];
}

export async function getAddress(addressId: string): Promise<Address> {
  const body = await unwrap(api.GET('/v1/addresses/{addressId}', { params: { path: { addressId } } }));
  return body.data as unknown as Address;
}

export async function createAddress(input: AddressInput): Promise<Address> {
  const body = await unwrap(
    api.POST('/v1/addresses', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: input,
    }),
  );
  bumpAddressVersion();
  return body.data as unknown as Address;
}

export async function updateAddress(
  addressId: string,
  input: AddressUpdateInput,
): Promise<Address> {
  const body = await unwrap(
    api.PATCH('/v1/addresses/{addressId}', { params: { path: { addressId } }, body: input }),
  );
  bumpAddressVersion();
  return body.data as unknown as Address;
}

export async function deleteAddress(addressId: string): Promise<void> {
  await unwrap(api.DELETE('/v1/addresses/{addressId}', { params: { path: { addressId } } }));
  bumpAddressVersion();
}

export async function setDefaultAddress(addressId: string): Promise<Address> {
  const body = await unwrap(
    api.POST('/v1/addresses/{addressId}/default', { params: { path: { addressId } } }),
  );
  bumpAddressVersion();
  return body.data as unknown as Address;
}

/** The customer's default address, or their first, or null if they have none yet. */
export async function getDefaultAddress(): Promise<Address | null> {
  const addresses = await listAddresses();
  return addresses.find((a) => a.is_default) ?? addresses[0] ?? null;
}

/** Default address first, then the rest in list order. */
export function sortForDelivery(addresses: Address[]): Address[] {
  return [...addresses].sort((x, y) => Number(y.is_default) - Number(x.is_default));
}
