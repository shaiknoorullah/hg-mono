/**
 * The persisted notification inbox (P-24, `x-version: V1`). Reading is non-destructive — there
 * is no delete-on-read path; `markNotificationRead` is the only write, and it is per-notification.
 */
import { unwrap } from '@hg/api-client';
import type { Schema } from '@hg/api-client';

import { api } from './client';

export type Notification = Schema['Notification'];
export type PageMeta = Schema['PageMeta'];

export async function listNotifications(input?: {
  unreadOnly?: boolean;
  cursor?: string | null;
}): Promise<{ notifications: Notification[]; meta: PageMeta }> {
  const body = await unwrap(
    api.GET('/v1/notifications', {
      params: {
        query: {
          limit: 20,
          ...(input?.cursor ? { cursor: input.cursor } : {}),
          ...(input?.unreadOnly ? { unread_only: true } : {}),
        },
      },
    }),
  );
  return {
    notifications: body.data as unknown as Notification[],
    meta: body.meta as unknown as PageMeta,
  };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await unwrap(
    api.POST('/v1/notifications/{notificationId}/read', {
      params: { path: { notificationId } },
    }),
  );
}
