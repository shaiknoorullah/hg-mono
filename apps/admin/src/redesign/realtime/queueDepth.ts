/**
 * Queue counts for the sidebar, fed only by the realtime `admin.queue_depth` event on the
 * `admin:ops` channel (`contracts/websocket.md` §4). There is no REST read of these numbers, so
 * the store starts empty and the nav shows no number until the first frame arrives.
 *
 * Rules from the manifest (§1.1) and `ASS/AdminSidebar`:
 * - a count is never 0 as a placeholder: before the first frame there is no number at all;
 * - while the connection is down the last counts stay, marked stale with the time they arrived
 *   ("Counts from 9:44 am. Not live while the connection is down.");
 * - support agents have no rider queue, so the rider count is never kept for them.
 *
 * A plain module store read through `useSyncExternalStore`, so the nav, the alerts page and the
 * tests all see the same numbers.
 */
import { useSyncExternalStore } from 'react';
import type { AdminQueueDepthData } from '@hg/api-client';
import type { RealtimeStatus } from '@hg/ui-web/live';

import { formatTime } from '../data/format';
import type { StaffRole } from '../data/session';

export interface QueueCounts {
  readonly pending_restaurant_reviews: number;
  /** `null` for support agents: they have no rider queue and never see this number. */
  readonly pending_rider_reviews: number | null;
  readonly failed_refunds: number;
  readonly open_disputes: number;
}

export interface QueueDepthState {
  /** `null` until the first `admin.queue_depth` frame. */
  readonly counts: QueueCounts | null;
  /** When the last frame was sent (the envelope's `ts`), or `null` before the first. */
  readonly updatedAt: Date | null;
  /** The realtime connection's status. */
  readonly connection: RealtimeStatus;
}

/** What the sidebar says about its counts. */
export type QueueCountsPhase = 'loading' | 'waiting' | 'live' | 'stale';

const INITIAL: QueueDepthState = { counts: null, updatedAt: null, connection: 'idle' };

let state: QueueDepthState = INITIAL;
const listeners = new Set<() => void>();

function emit(next: QueueDepthState): void {
  state = next;
  for (const fn of listeners) fn();
}

export function getQueueDepth(): QueueDepthState {
  return state;
}

export function subscribeQueueDepth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Applies one `admin.queue_depth` frame. `role` is the viewer's staff role: a support agent's
 * store never holds the rider count, even though the frame carries it.
 */
export function applyQueueDepthFrame(data: AdminQueueDepthData, sentAt: Date | string | null, role: StaffRole | null): void {
  const at = sentAt instanceof Date ? sentAt : sentAt ? new Date(sentAt) : new Date();
  emit({
    ...state,
    counts: {
      pending_restaurant_reviews: count(data.pending_restaurant_reviews),
      pending_rider_reviews: role === 'SUPPORT_AGENT' ? null : count(data.pending_rider_reviews),
      failed_refunds: count(data.failed_refunds),
      open_disputes: count(data.open_disputes),
    },
    updatedAt: Number.isNaN(at.getTime()) ? new Date() : at,
  });
}

/** Records the realtime connection's status. */
export function setQueueConnection(connection: RealtimeStatus): void {
  if (state.connection === connection) return;
  emit({ ...state, connection });
}

/** Forgets every count (sign out, and between tests). */
export function resetQueueDepth(): void {
  emit(INITIAL);
}

export function queueCountsPhase(s: QueueDepthState): QueueCountsPhase {
  const open = s.connection === 'open';
  if (s.counts === null) return open ? 'waiting' : 'loading';
  return open ? 'live' : 'stale';
}

/** The line under the nav items, or `null` while counts are live. Copy from `ASS/AdminSidebar`. */
export function queueCountsNote(s: QueueDepthState): string | null {
  switch (queueCountsPhase(s)) {
    case 'loading':
      return 'Waiting for queue counts from the live connection.';
    case 'waiting':
      return 'Connected. Counts arrive with the next change.';
    case 'stale':
      return `Counts from ${formatTime(s.updatedAt)}. Not live while the connection is down.`;
    default:
      return null;
  }
}

export function useQueueDepth(): QueueDepthState {
  return useSyncExternalStore(subscribeQueueDepth, getQueueDepth, getQueueDepth);
}
