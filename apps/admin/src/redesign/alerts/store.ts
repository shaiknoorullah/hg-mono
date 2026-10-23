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

/**
 * Why live alerts are not arriving, when the server or the sign-in is the reason
 * (`contracts/websocket.md`). Each kind has its own screen because each is put right differently.
 * A ticket that could not be minted is not here: the connection itself reports it (`RetryInfo.cause`),
 * and retrying can work.
 *
 *
 * - `forbidden`: `subscribe_error` `forbidden`. This account may not have the channel. Retrying
 *   cannot work; a role change needs a new sign-in.
 * - `invalid-channel`: `subscribe_error` `invalid_channel`. The page asked for a channel the server
 *   does not know, which is our fault. Retrying sends the same request; reloading the page is the
 *   only thing a person can do.
 * - `reauth`: `reauth_required`, or the socket closed `4401`. The session ended. Retrying cannot
 *   work; the person signs in again, then the connection is restarted.
 * - `fatal`: the socket closed `4400` (a malformed frame or an unknown field) or `4403` (the origin
 *   is not allowed), both marked do not retry. Our fault, nothing the person did, and nothing they
 *   can undo. Kept apart from the connection's own "refused five times" state because that one may
 *   work on the sixth attempt and this one never will
 *   ([#1010](https://github.com/shaiknoorullah/hg-mono/issues/1010)).
 *
 * The other two `subscribe_error` codes (`not_found`, `subscription_limit`) have no board and are
 * not recorded here.
 */
export type AlertsFailure =
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'invalid-channel' }
  | { readonly kind: 'reauth'; readonly at: Date }
  | { readonly kind: 'fatal'; readonly code: number; readonly at: Date };

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
  /** Set when the reason alerts are not arriving is one of the three above. */
  readonly failure: AlertsFailure | null;
}

const INITIAL: AlertsState = {
  rows: [],
  replay: { phase: 'pending', complete: false, truncated: false },
  connection: 'idle',
  lostAt: null,
  gap: null,
  dismissed: new Set(),
  failure: null,
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
  // A replay only follows a successful subscribe, so a recorded refusal is over. `fatal` is cleared
  // for the same reason: the socket it was recorded on is open again, which disproves it. `reauth`
  // is not, because its dialog is what asks the person to sign in and must stay until they do.
  const refused = state.failure?.kind === 'forbidden' || state.failure?.kind === 'invalid-channel' || state.failure?.kind === 'fatal';
  const failure = refused ? null : state.failure;
  if (state.replay.phase === 'pending') {
    emit({
      ...state,
      failure,
      replay: { phase: 'done', complete: signal.fromSeq <= 1 && !signal.truncated, truncated: signal.truncated },
    });
    return;
  }
  if (signal.truncated) {
    emit({ ...state, failure, gap: { from: state.lostAt ?? now, to: now } });
  } else if (refused) {
    emit({ ...state, failure });
  }
}

export function setAlertsConnection(connection: RealtimeStatus, now: Date = new Date()): void {
  if (state.connection === connection) return;
  const wasOpen = state.connection === 'open';
  // An open socket ends a refused connection: the close it was recorded from is plainly over. A
  // refused *subscribe* is different and stays until a replay shows it worked, because the socket
  // being open is what lets the subscribe be refused in the first place. A lost sign-in is not
  // ended by an open socket either: the status reaches this store through an effect, so the 'open'
  // of the connection that was just ended for `reauth_required` can arrive after the failure was
  // recorded and would take its dialog away. The dialog's own sign-in clears it.
  const ended = state.failure?.kind === 'fatal';
  const failure = connection === 'open' && ended ? null : state.failure;
  emit({ ...state, connection, failure, lostAt: wasOpen && connection !== 'open' ? now : state.lostAt });
}

/** Records (or clears, with `null`) why alerts are not arriving. */
export function setAlertsFailure(failure: AlertsFailure | null): void {
  if (state.failure === failure) return;
  emit({ ...state, failure });
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
