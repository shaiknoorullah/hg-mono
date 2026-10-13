import { unwrap } from '@hg/api-client';
import type { FetchResponse } from 'openapi-fetch';

/**
 * `{ data: T }` envelope → `T`, throwing `HgApiError` on a non-2xx (same contract as the
 * legacy `unwrapOrThrow`, kept here so redesign modules never import legacy app code).
 */
export async function call<T extends Record<string | number, any>, E, O extends `${string}/${string}`>(
  promise: Promise<FetchResponse<T, E, O>>,
): Promise<NonNullable<FetchResponse<T, E, O>['data']> extends { data: infer D } ? D : never> {
  const envelope = await unwrap(promise);
  return (envelope as unknown as { data: unknown }).data as any;
}
