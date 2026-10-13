/**
 * Menu writes (WP8). Keys: `createMenuCategory`, `createMenuItem` and `createUpload` take an
 * Idempotency-Key minted once per user intent and reused on every retry of it (the caller
 * owns the key); `setMenuItemAvailability`, `updateMenuItem` and `confirmUpload` take none.
 */
import { isApiError, type Schema } from '@hg/api-client';
import { client } from '../data/client';
import { call } from '../data/call';
import type { MenuItem } from './model';

export type AvailabilityBody = Schema['MenuItemAvailabilityInput'];
export type ItemCreateBody = Schema['MenuItemInput'];
export type ItemUpdateBody = Schema['MenuItemUpdateInput'];

/**
 * A 429 says when to try again in `Retry-After` (CORS-exposed by services/hg) or in
 * `details.retry_after_seconds`; `HgApiError` carries no headers, so it is attached here.
 */
export function retryAfterSeconds(error: unknown): number | null {
  const e = error as { retryAfterSeconds?: number; details?: unknown } | null;
  if (e && typeof e.retryAfterSeconds === 'number' && e.retryAfterSeconds > 0) return e.retryAfterSeconds;
  const d = e?.details as { retry_after_seconds?: number } | undefined;
  return d && typeof d.retry_after_seconds === 'number' ? d.retry_after_seconds : null;
}

export async function setItemAvailability(itemId: string, body: AvailabilityBody): Promise<MenuItem> {
  const res = await client.PUT('/v1/restaurant/menu/items/{itemId}/availability', { params: { path: { itemId } }, body });
  try {
    return (await call(Promise.resolve(res))) as unknown as MenuItem;
  } catch (error) {
    const header = Number(res.response?.headers.get('Retry-After'));
    if (isApiError(error) && Number.isFinite(header) && header > 0) {
      (error as unknown as { retryAfterSeconds: number }).retryAfterSeconds = header;
    }
    throw error;
  }
}

export function createCategory(key: string, body: Schema['MenuCategoryInput']): Promise<Schema['MenuCategory']> {
  return call(
    client.POST('/v1/restaurant/menu/categories', { params: { header: { 'Idempotency-Key': key } }, body }),
  ) as unknown as Promise<Schema['MenuCategory']>;
}

export function createItem(key: string, body: ItemCreateBody): Promise<MenuItem> {
  return call(
    client.POST('/v1/restaurant/menu/items', {
      params: { header: { 'Idempotency-Key': key } },
      // The one monetary field a partner DTO carries: the restaurant pricing its own menu.
      body: body as never,
    }),
  ) as unknown as Promise<MenuItem>;
}

export function updateItem(itemId: string, body: ItemUpdateBody): Promise<MenuItem> {
  return call(
    client.PATCH('/v1/restaurant/menu/items/{itemId}', { params: { path: { itemId } }, body: body as never }),
  ) as unknown as Promise<MenuItem>;
}

export function createUpload(key: string, body: Schema['UploadInput']): Promise<Schema['PresignedUpload']> {
  return call(client.POST('/v1/uploads', { params: { header: { 'Idempotency-Key': key } }, body })) as unknown as Promise<
    Schema['PresignedUpload']
  >;
}

export function confirmUpload(uploadId: string): Promise<Schema['StoredObject']> {
  return call(client.POST('/v1/uploads/{uploadId}/confirm', { params: { path: { uploadId } } })) as unknown as Promise<
    Schema['StoredObject']
  >;
}
