/**
 * What this device knows about the release notes: whether the bundled file has loaded and the last
 * version this device was told about (restaurant boards `WhatsNew-*`; issue 101).
 *
 * The version is kept per device (`localStorage`) and every access is wrapped: when storage is
 * blocked the app shows nothing by itself, and What's new stays in the account menu and in Settings.
 * The file is loaded with a dynamic import, so it is its own chunk; a chunk that cannot be fetched
 * is the error board.
 */
import { useSyncExternalStore } from 'react';

import { APP_VERSION, parseReleaseNotes, type Release } from './releaseNotes';

export const LAST_SEEN_KEY = 'hg.restaurant.whatsnew.last-seen';

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
}

type Loader = () => Promise<unknown>;

const bundled: Loader = () => import('../../release-notes.json');
let loader: Loader = bundled;

/** Test seam: replace (or, with `null`, restore) how the notes file is fetched. */
export function setReleaseNotesLoader(next: Loader | null): void {
  loader = next ?? bundled;
}

function readStorage(): Pick<WhatsNewState, 'storage' | 'lastSeen'> {
  try {
    return { storage: 'ok', lastSeen: window.localStorage.getItem(LAST_SEEN_KEY) };
  } catch {
    return { storage: 'blocked', lastSeen: null };
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* blocked or full: the choice holds for this page only */
  }
}

let state: WhatsNewState = { load: { status: 'idle' }, ...readStorage() };
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

/** The notes were on screen: this device has now been told about the current version. */
export function markSeen(version: string = APP_VERSION): void {
  writeStorage(LAST_SEEN_KEY, version);
  set({ lastSeen: version });
}

/** Test seam: forget everything in memory and read storage again. */
export function resetWhatsNew(): void {
  generation += 1;
  state = { load: { status: 'idle' }, ...readStorage() };
  listeners.forEach((l) => l());
}
