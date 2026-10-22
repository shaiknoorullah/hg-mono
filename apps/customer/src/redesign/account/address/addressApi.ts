/**
 * The address form's calls, all through the redesign client (so a session or account refusal
 * raises its forced route from here too). Types come from the generated client; nothing here
 * sends a price, and `timezone` and `country` are never sent (the server owns them).
 */
import { HgApiError, HgTransportError, unwrap } from '@hg/api-client';
import type { ErrorEnvelope } from '@hg/api-client';

import { api } from '../../api/client';
import type { Address, AddressInput, AddressSuggestion, AddressUpdateInput, GeocodedAddress, GeoPoint } from './addressRules';

export async function getAddress(addressId: string): Promise<Address> {
  return (await unwrap(api.GET('/v1/addresses/{addressId}', { params: { path: { addressId } } }))).data as Address;
}

export async function createAddress(body: AddressInput): Promise<Address> {
  return (await unwrap(api.POST('/v1/addresses', { body }))).data as Address;
}

export async function updateAddress(addressId: string, body: AddressUpdateInput): Promise<Address> {
  return (await unwrap(api.PATCH('/v1/addresses/{addressId}', { params: { path: { addressId } }, body }))).data as Address;
}

/** 204: there is no body for `unwrap` to return, so the error is read from the raw result. */
export async function deleteAddress(addressId: string): Promise<void> {
  const result = await api.DELETE('/v1/addresses/{addressId}', { params: { path: { addressId } } }).catch((cause: unknown) => {
    throw new HgTransportError(cause);
  });
  if (result.error !== undefined) throw new HgApiError(result.response.status, result.error as ErrorEnvelope | undefined);
}

export async function setDefaultAddress(addressId: string): Promise<Address> {
  return (await unwrap(api.POST('/v1/addresses/{addressId}/default', { params: { path: { addressId } } }))).data as Address;
}

/** Search as the customer types. Suggestions carry no coordinates: picking one calls `getPlace`. */
export async function suggestAddresses(q: string, sessionToken: string, near: GeoPoint | null): Promise<AddressSuggestion[]> {
  const query = { q, session_token: sessionToken, ...(near ? { latitude: near.latitude, longitude: near.longitude } : {}) };
  return (await unwrap(api.GET('/v1/geo/autocomplete', { params: { query } }))).data as AddressSuggestion[];
}

/** Ends the search session: the caller makes a new `session_token` afterwards. */
export async function getPlaceAddress(placeId: string, sessionToken: string): Promise<GeocodedAddress> {
  return (
    await unwrap(api.GET('/v1/geo/places/{placeId}', { params: { path: { placeId }, query: { session_token: sessionToken } } }))
  ).data as GeocodedAddress;
}

/** "Use this spot": the address near the pin. Takes no session token. */
export async function reverseGeocode(point: GeoPoint): Promise<GeocodedAddress> {
  return (await unwrap(api.GET('/v1/geo/reverse', { params: { query: { latitude: point.latitude, longitude: point.longitude } } }))).data as GeocodedAddress;
}
