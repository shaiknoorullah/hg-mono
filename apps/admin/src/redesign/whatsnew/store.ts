/**
 * What this device knows about the release notes: whether the bundled file has loaded, the last
 * version it was told about, and the last version whose notes were opened.
 *
 * Two versions are kept on purpose (admin board `WhatsNewAfterNotNow`): "Not now" stores the
 * current version as last-seen so the notice does not come back, while the sidebar's New label
 * stays until the panel itself is opened.
 *
 * Storage is per device (`localStorage`) and every access is wrapped: when it is blocked the
 * console shows nothing by itself and What's new stays reachable from the sidebar. The file is
 * loaded with a dynamic import, so it is its own chunk: a chunk that cannot be fetched is the
 * panel's error state (and, offline, the offline board).
 */
import { useSyncExternalStore } from 'react';

import { APP_VERSION, parseReleaseNotes, type Release } from './releaseNotes';

export const LAST_SEEN_KEY = 'hg-admin-whatsnew:last-seen';
export const OPENED_KEY = 'hg-admin-whatsnew:opened';

export type NotesLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly releases: readonly Release[] }
  | { readonly status: 'error' };

export interface WhatsNewState {
  readonly load: NotesLoad;
  /** `blocked`: storage cannot be read, so the console cannot tell what this device has seen. */
  readonly storage: 'ok' | 'blocked';
  readonly lastSeen: string | null;
  readonly opened: string | null;
  /** How many open panels hold the notice back (unsent input). */
  readonly holds: number;
}

type Loader = () => Promise<unknown>;

const bundled: Loader = () => import('../../release-notes.json');
let loader: Loader = bundled;

/** Test seam: replace (or, with `null`, restore) how the notes file is fetched. */
export function setReleaseNotesLoader(next: Loader | null): void {
  loader = next ?? bundled;
}

function readStorage(): Pick<WhatsNewState, 'storage' | 'lastSeen' | 'opened'> {
  try {
    return { storage: 'ok', lastSeen: window.localStorage.getItem(LAST_SEEN_KEY), opened: window.localStorage.getItem(OPENED_KEY) };
  } catch {
    return { storage: 'blocked', lastSeen: null, opened: null };
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* blocked or full: the choice holds for this page only */
  }
}

let state: WhatsNewState = { load: { status: 'idle' }, holds: 0, ...readStorage() };
let generation = 0;
const listeners = new Set<() => void>();

function set(next: Partial<WhatsNewState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function getWhatsNewState(): WhatsNewState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWhatsNewState(): WhatsNewState {
  return useSyncExternalStore(subscribe, getWhatsNewState, getWhatsNewState);
}

function start(): void {
  const mine = ++generation;
  set({ load: { status: 'loading' } });
  let pending: Promise<unknown>;
  try {
    pending = loader();
  } catch (error) {
    pending = Promise.reject(error);
  }
  pending.then(
    (module) => {
      if (mine !== generation) return;
      try {
        set({ load: { status: 'ready', releases: parseReleaseNotes(module) } });
      } catch {
        set({ load: { status: 'error' } });
      }
    },
    () => {
      if (mine === generation) set({ load: { status: 'error' } });
    },
  );
}

/** Starts loading the notes once; a load that failed is started again by `retryReleaseNotes`. */
export function ensureReleaseNotes(): void {
  if (state.load.status === 'idle') start();
}

export function retryReleaseNotes(): void {
  if (state.load.status === 'error') start();
}

/** "Not now", and opening the panel: this device has been told about the current version. */
export function markNoticed(version: string = APP_VERSION): void {
  writeStorage(LAST_SEEN_KEY, version);
  set({ lastSeen: version });
}

/** The panel was opened and its notes were on screen: the sidebar's New label goes. */
export function markOpened(version: string = APP_VERSION): void {
  writeStorage(OPENED_KEY, version);
  writeStorage(LAST_SEEN_KEY, version);
  set({ opened: version, lastSeen: version });
}

/** A panel with unsent input is open: the notice waits. Returns the release function. */
export function holdNotice(): () => void {
  set({ holds: state.holds + 1 });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set({ holds: Math.max(0, state.holds - 1) });
  };
}

/** Test seam: forget everything in memory and read storage again. */
export function resetWhatsNew(): void {
  generation += 1;
  state = { load: { status: 'idle' }, holds: 0, ...readStorage() };
  listeners.forEach((l) => l());
}
