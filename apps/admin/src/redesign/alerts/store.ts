/**
 * The alerts this tab has seen, fed by the `admin:ops` channel (`../realtime/RedesignRealtime`).
 *
 * There is no REST read of alert history (a gap the boards mark "Needs API"), so this store IS the
 * list: the replay of recent events the live connection gives on subscribe, plus what arrives
 * after. It lives at module level, not in the page, so the high-severity banner works on every
 * page and the list is whole when the person opens Live alerts.
 *
 * Redis is not involved in what is true here: the replay reads the immutable event table in
 * Postgres (`contracts/websocket.md` section 6.2), so a Redis flush makes the feed slower, never
 * wrong, and a reload replays the same alerts again.
 */
import { useSyncExternalStore } from 'react';
import type { RealtimeEnvelope } from '@hg/api-client';
import type { RealtimeStatus } from '@hg/ui-web/live';

import { mergeRows, rowFromEvent, type AlertRow } from './model';

/** How many events before the channel's head the first subscribe asks to have replayed. */
export const BACKFILL_EVENTS = 1000;

export interface ReplayState {
  /** `pending` until the first `resume_complete` arrives. */
  readonly phase: 'pending' | 'done';
  /** The replay started at the very first event and nothing was cut: the list is the whole 7 days. */
  readonly complete: boolean;
  /** The server could not replay everything older than the window. */
  readonly truncated: boolean;
}

export interface AlertsState {
  readonly rows: readonly AlertRow[];
  readonly replay: ReplayState;
  readonly connection: RealtimeStatus;
  /** When the connection last stopped being open, for "as of 9:44:10 am" and "Connection lost at". */
  readonly lostAt: Date | null;
  /** Set when a reconnect could not replay everything that happened while away. */
  readonly gap: { readonly from: Date; readonly to: Date } | null;
  /** Alerts whose banner the person dismissed this session (that alert only). */
  readonly dismissed: ReadonlySet<number>;
}

const INITIAL: AlertsState = {
  rows: [],
  replay: { phase: 'pending', complete: false, truncated: false },
  connection: 'idle',
  lostAt: null,
  gap: null,
  dismissed: new Set(),
};

let state: AlertsState = INITIAL;
const listeners = new Set<() => void>();

function emit(next: AlertsState): void {
  state = next;
  for (const fn of listeners) fn();
}

export function getAlerts(): AlertsState {
  return state;
}

export function subscribeAlerts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAlerts(): AlertsState {
  return useSyncExternalStore(subscribeAlerts, getAlerts, getAlerts);
}

/** Adds one `admin:ops` event. Events that are not alerts (queue depth) change nothing. */
export function applyAlertEvent(event: RealtimeEnvelope): void {
  const row = rowFromEvent(event, state.replay.phase === 'done');
  if (!row) return;
  emit({ ...state, rows: mergeRows(state.rows, [row]) });
}

/** A replay finished. The first one is the backfill; a later one is a reconnect's catch-up. */
export function applyReplay(signal: { fromSeq: number; truncated: boolean }, now: Date = new Date()): void {
  if (state.replay.phase === 'pending') {
    emit({
      ...state,
      replay: { phase: 'done', complete: signal.fromSeq <= 1 && !signal.truncated, truncated: signal.truncated },
    });
    return;
  }
  if (signal.truncated) {
    emit({ ...state, gap: { from: state.lostAt ?? now, to: now } });
  }
}

export function setAlertsConnection(connection: RealtimeStatus, now: Date = new Date()): void {
  if (state.connection === connection) return;
  const wasOpen = state.connection === 'open';
  emit({ ...state, connection, lostAt: wasOpen && connection !== 'open' ? now : state.lostAt });
}

/** Hides that alert's banner. The alert stays in the list. */
export function dismissAlertBanner(seq: number): void {
  const dismissed = new Set(state.dismissed);
  dismissed.add(seq);
  emit({ ...state, dismissed });
}

/** Forgets everything (sign out, and between tests). */
export function resetAlerts(): void {
  emit({ ...INITIAL, dismissed: new Set() });
}
