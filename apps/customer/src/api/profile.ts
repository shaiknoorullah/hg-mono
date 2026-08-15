/**
 * The customer's own account profile: `GET`/`PATCH /v1/me/profile`.
 *
 * `phone_e164` is read-only at the contract level — a phone change is an account migration
 * with no flow at any version — so `CustomerProfileUpdateInput` never carries it, and this
 * module doesn't either.
 */
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type CustomerProfile = Schema['CustomerProfile'];
export type CustomerProfileUpdateInput = Schema['CustomerProfileUpdateInput'];

export async function getProfile(): Promise<CustomerProfile> {
  const body = await unwrap(api.GET('/v1/me/profile'));
  return body.data as unknown as CustomerProfile;
}

export async function updateProfile(input: CustomerProfileUpdateInput): Promise<CustomerProfile> {
  const body = await unwrap(api.PATCH('/v1/me/profile', { body: input }));
  return body.data as unknown as CustomerProfile;
}
