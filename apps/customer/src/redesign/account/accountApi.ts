/**
 * The account area's calls, all through the redesign client (so a session or account refusal
 * raises its forced route from here too). Types come from the generated client.
 */
import { unwrap } from '@hg/api-client';

import { api } from '../api/client';
import { getNow } from '../lib/now';
import { serverTimeOf } from '../api/auth';
import { resendLimitOf, type Address, type CustomerProfile, type ProfileUpdate, type ResendLimit } from './rules';

export async function getProfile(): Promise<CustomerProfile> {
  return (await unwrap(api.GET('/v1/me/profile'))).data as CustomerProfile;
}

export async function updateProfile(body: ProfileUpdate): Promise<CustomerProfile> {
  return (await unwrap(api.PATCH('/v1/me/profile', { body }))).data as CustomerProfile;
}

/**
 * The saved addresses. The cap is 20 and a page holds up to 100, so one page is all of them.
 * (`addresses_list` and `addresses_empty` are the fixtures.)
 */
export async function listAddresses(): Promise<Address[]> {
  const res = await unwrap(api.GET('/v1/addresses', { params: { query: { limit: 100 } } }));
  return res.data as Address[];
}

export type ResendResult = { ok: true } | { ok: false; limit: ResendLimit } | { ok: false; limit: null };

/**
 * `resendEmailVerification`: 202 whether or not the address exists. A 429 carries `Retry-After`;
 * it is read from the response, which `unwrap` would drop.
 */
export async function resendEmailLink(email: string): Promise<ResendResult> {
  const { response, error } = await api.POST('/v1/auth/email/resend', { body: { email } });
  if (!error) return { ok: true };
  if (response.status === 429) {
    const header = Number(response.headers.get('Retry-After'));
    const wait = Number.isFinite(header) && header > 0 ? header : 60;
    return { ok: false, limit: resendLimitOf(wait, serverTimeOf(response) || getNow()) };
  }
  return { ok: false, limit: null };
}

/** `verifyEmail`: 204, or 410 `VERIFICATION_TOKEN_EXPIRED` / `VERIFICATION_TOKEN_USED`. No session. */
export async function verifyEmailToken(token: string): Promise<void> {
  const { error, response } = await api.POST('/v1/auth/email/verify', { body: { token } });
  if (error) {
    const code = (error as { error?: { code?: string } }).error?.code ?? 'INTERNAL_ERROR';
    throw new VerifyError(response.status, code);
  }
}

export class VerifyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'VerifyError';
  }
}
