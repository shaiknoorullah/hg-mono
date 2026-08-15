/**
 * Delivery-address reads/writes for checkout.
 *
 * A delivery quote (P-09 / P-11) is priced against a concrete address: the server derives the
 * province from it to select the tax jurisdiction, and refuses (`PROVINCE_NOT_SERVED`) when it
 * cannot. So checkout needs a `delivery_address_id`. `ensureDeliveryAddress` returns the customer's
 * default address, falling back to their first, and — for V0, where there is no address-book UI yet
 * — seeds a launch-province (Ontario) address the first time so the loop can complete. A real build
 * replaces the seed with the map-picker flow (C-30); the read path (default → first) stays.
 *
 * The `latitude`/`longitude` normally come from the map picker; the V0 seed uses a downtown Toronto
 * point so the address resolves inside the served area.
 */
import { idempotencyKey, unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type Address = Schema['Address'];
export type AddressInput = Schema['AddressInput'];
export type AddressUpdateInput = Schema['AddressUpdateInput'];

export async function listAddresses(): Promise<Address[]> {
  const body = await unwrap(api.GET('/v1/addresses'));
  return body.data as unknown as Address[];
}

export async function getAddress(addressId: string): Promise<Address> {
  const body = await unwrap(api.GET('/v1/addresses/{addressId}', { params: { path: { addressId } } }));
  return body.data as unknown as Address;
}

/**
 * C-30. `latitude`/`longitude` are required by the contract and normally come from the map
 * picker; this app has no map-picker UI yet (the checkout seed carries the same note), so the
 * address form geocodes nothing and pins every new address to the same served (Ontario) point
 * the seed uses. The form itself still collects and sends every other field for real.
 */
const UNPICKED_POINT = { latitude: 43.6534, longitude: -79.3841 };

export async function createAddress(input: Omit<AddressInput, 'latitude' | 'longitude'>): Promise<Address> {
  const body = await unwrap(
    api.POST('/v1/addresses', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: { ...input, ...UNPICKED_POINT },
    }),
  );
  return body.data as unknown as Address;
}

export async function updateAddress(
  addressId: string,
  input: Omit<AddressUpdateInput, 'latitude' | 'longitude'>,
): Promise<Address> {
  const body = await unwrap(
    api.PATCH('/v1/addresses/{addressId}', { params: { path: { addressId } }, body: input }),
  );
  return body.data as unknown as Address;
}

export async function deleteAddress(addressId: string): Promise<void> {
  await unwrap(api.DELETE('/v1/addresses/{addressId}', { params: { path: { addressId } } }));
}

export async function setDefaultAddress(addressId: string): Promise<Address> {
  const body = await unwrap(
    api.POST('/v1/addresses/{addressId}/default', { params: { path: { addressId } } }),
  );
  return body.data as unknown as Address;
}

async function createDefaultAddress(): Promise<Address> {
  const body = await unwrap(
    api.POST('/v1/addresses', {
      params: { header: { 'Idempotency-Key': idempotencyKey() } },
      body: {
        label: 'Home',
        line1: '100 Queen St W',
        city: 'Toronto',
        province: 'ON',
        postal_code: 'M5H 2N2',
        latitude: 43.6534,
        longitude: -79.3841,
        is_default: true,
      },
    }),
  );
  return body.data as unknown as Address;
}

/** The address a delivery quote should be priced against: default → first → freshly seeded. */
export async function ensureDeliveryAddress(): Promise<Address> {
  const addresses = await listAddresses();
  const chosen = addresses.find((a) => a.is_default) ?? addresses[0];
  return chosen ?? (await createDefaultAddress());
}
