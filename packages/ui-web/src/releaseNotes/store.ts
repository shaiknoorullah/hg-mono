/**
 * What a device knows about the release notes: whether the bundled file has loaded, the last version
 * it was told about, and (for an app that keeps one) the last version whose notes were opened.
 * Storage is per device (`localStorage`) and every access is wrapped: when it is blocked an app shows
 * nothing by itself and What's new stays reachable from its menu. The file is loaded with a dynamic
 * import the app passes in, so it is its own chunk; a chunk that cannot be fetched is the error state.
 */
import { useSyncExternalStore } from 'react';

import { parseReleaseNotes, type Release } from './notes.js';

export type NotesLoad =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly releases: readonly Release[] }
  | { readonly status: 'error' };

export interface NotesState {
  readonly load: NotesLoad;
  /** `blocked`: storage cannot be read, so the app cannot tell what this device has seen. */
  readonly storage: 'ok' | 'blocked';
  readonly lastSeen: string | null;
  readonly opened: string | null;
  /** How many open panels hold the update notice back (unsent input). */
  readonly holds: number;
}

type Loader = () => Promise<unknown>;

export interface NotesStoreConfig {
  /** The build's own version: what "seen" is set to. */
  appVersion: string;
  lastSeenKey: string;
  /** A second marker for an app whose New label outlives the notice. */
  openedKey?: string;
  /** The app's `() => import('../../release-notes.json')`. */
  bundled: Loader;
}

export function createReleaseNotesStore(config: NotesStoreConfig) {
  const { appVersion, lastSeenKey, openedKey, bundled } = config;
  let loader: Loader = bundled;

  function readStorage(): Pick<NotesState, 'storage' | 'lastSeen' | 'opened'> {
    try {
      return {
        storage: 'ok',
        lastSeen: window.localStorage.getItem(lastSeenKey),
        opened: openedKey ? window.localStorage.getItem(openedKey) : null,
      };
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

  let state: NotesState = { load: { status: 'idle' }, holds: 0, ...readStorage() };
  let generation = 0;
  const listeners = new Set<() => void>();

  function set(next: Partial<NotesState>): void {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

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

  return {
    getState: (): NotesState => state,
    useState: (): NotesState => useSyncExternalStore(subscribe, () => state, () => state),
    /** Starts loading the notes once; a load that failed is started again by `retry`. */
    ensureLoaded(): void {
      if (state.load.status === 'idle') start();
    },
    retry(): void {
      if (state.load.status === 'error') start();
    },
    /** This device has been told about the current version ("Not now", or the notes were on screen). */
    markLastSeen(version: string = appVersion): void {
      writeStorage(lastSeenKey, version);
      set({ lastSeen: version });
    },
    /** The panel was opened and its notes were on screen. */
    markOpened(version: string = appVersion): void {
      if (openedKey) writeStorage(openedKey, version);
      writeStorage(lastSeenKey, version);
      set({ opened: version, lastSeen: version });
    },
    /** A panel with unsent input is open: the notice waits. Returns the release function. */
    holdNotice(): () => void {
      set({ holds: state.holds + 1 });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set({ holds: Math.max(0, state.holds - 1) });
      };
    },
    /** Test seam: replace (or, with `null`, restore) how the notes file is fetched. */
    setLoader(next: Loader | null): void {
      loader = next ?? bundled;
    },
    /** Test seam: forget everything in memory and read storage again. */
    reset(): void {
      generation += 1;
      state = { load: { status: 'idle' }, holds: 0, ...readStorage() };
      listeners.forEach((l) => l());
    },
  };
}
