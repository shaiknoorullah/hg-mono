import { unwrap } from '@hg/api-client';
import type { FetchResponse } from 'openapi-fetch';

export { api } from './api';

/**
 * `unwrap` throws `HgApiError` on any non-2xx and otherwise returns the parsed body —
 * which, for every operation in this contract, is the `{ data: T }` envelope itself.
 * Call sites in this app want `T` directly, so this peels that one layer off too.
 *
 * Mirrors `unwrap`'s own generic signature exactly (rather than a simplified shape) so
 * TypeScript keeps inferring the real, branded response type — e.g. `Cents` — instead of
 * widening it while unifying against a looser parameter type.
 */
export async function unwrapOrThrow<
  T extends Record<string | number, any>,
  E,
  O extends `${string}/${string}`,
>(promise: Promise<FetchResponse<T, E, O>>): Promise<NonNullable<FetchResponse<T, E, O>['data']> extends { data: infer D } ? D : never> {
  const envelope = await unwrap(promise);
  return (envelope as unknown as { data: unknown }).data as any;
}
