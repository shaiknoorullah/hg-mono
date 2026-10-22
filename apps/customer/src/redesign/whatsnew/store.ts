/**
 * The last version of the release notes this phone has been told about (customer boards
 * `AC/WhatsNew*`; issue 99).
 *
 * It sits behind a two-method store so the app can keep it in the phone's small-preferences
 * storage. The app does that at start-up: `RedesignApp` passes the AsyncStorage-backed store
 * (`asyncStorage.ts`) to `setLastSeenStore`, and the sheet opens once per update. The default
 * here is memory and says so: `persistent: false`. While the store is not persistent, or when
 * reading it fails, What's new shows nothing by itself (it cannot tell what was already seen, and
 * would repeat on every launch) and stays one tap away in Account.
 */
import { useSyncExternalStore } from 'react';

import { compareVersions } from './releaseNotes';

export interface LastSeenStore {
  /** True when what is written survives the app being closed. */
  readonly persistent: boolean;
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export const LAST_SEEN_KEY = 'hg.customer.whatsnew.last-seen';

export function memoryStore(): LastSeenStore {
  const map = new Map<string, string>();
  return {
    persistent: false,
    async getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
  };
}

export interface SeenState {
  /** The read has finished (successfully or not). */
  readonly loaded: boolean;
  /** Reads and writes reach storage that survives a restart. Only then may the sheet open by itself. */
  readonly canAutoShow: boolean;
  /** The newest version this phone has been told about, now. */
  readonly lastSeen: string | null;
  /** What was stored when the app started: the page's "Your version" mark does not move. */
  readonly atLaunch: string | null;
}

const INITIAL: SeenState = { loaded: false, canAutoShow: false, lastSeen: null, atLaunch: null };

let store: LastSeenStore = memoryStore();
let state: SeenState = INITIAL;
let loading: Promise<void> | null = null;
let epoch = 0;
const listeners = new Set<() => void>();

function emit(next: SeenState): void {
  state = next;
  listeners.forEach((l) => l());
}

function newer(a: string, b: string | null): boolean {
  return b === null || (compareVersions(a, b) ?? 1) > 0;
}

function load(): void {
  if (state.loaded || loading) return;
  const mine = epoch;
  loading = (async () => {
    let saved: string | null = null;
    let readable = true;
    try {
      saved = await store.getItem(LAST_SEEN_KEY);
    } catch {
      readable = false;
    }
    if (mine !== epoch) return;
    // A version marked seen while the read was in flight wins over the stored one.
    const lastSeen = state.lastSeen !== null && newer(state.lastSeen, saved) ? state.lastSeen : saved;
    emit({ loaded: true, canAutoShow: readable && store.persistent, lastSeen, atLaunch: saved });
    loading = null;
  })();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  load();
  return () => {
    listeners.delete(listener);
  };
}

export function useSeen(): SeenState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The notes for `version` were on screen and closed: this phone has been told about them. */
export function markSeen(version: string): void {
  if (state.lastSeen !== null && !newer(version, state.lastSeen)) return;
  emit({ ...state, lastSeen: version });
  void store.setItem(LAST_SEEN_KEY, version).catch(() => {
    /* a failed write: remembered for this run only; the sheet comes back after a restart */
  });
}

/** Where the last-seen version is kept. `RedesignApp` calls it once at start-up; see the file comment. */
export function setLastSeenStore(next: LastSeenStore): void {
  store = next;
  epoch += 1;
  loading = null;
  emit(INITIAL);
  if (listeners.size > 0) load();
}

/** Test seam: forget everything and go back to the memory store. */
export function resetWhatsNew(): void {
  setLastSeenStore(memoryStore());
}
