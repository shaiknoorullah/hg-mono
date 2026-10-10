/**
 * R43 What's new: the release notes shipped in the app (`release-notes.json`, #97/#100) and the
 * last version this device has seen.
 *
 * HW n-whatsnew: shown once after an update, for every version since the last one seen on this
 * device; a new device with no saved version shows only the latest release. Got it, close, swipe,
 * scrim tap and Back all count as seen; the app closing or an offer covering it does not.
 *
 * The last-seen version sits behind a two-method store (`data/storage.ts`'s `KeyValueStore`).
 * AsyncStorage is not a dependency yet (only the DS track adds dependencies), so the store is
 * memory: the notes come back once per app launch until it lands. A store that throws (no
 * persisted storage, a broken read) never breaks the app: the read counts as "new device" and
 * the version is remembered in memory for the rest of the run.
 */
import * as React from 'react';
import Constants from 'expo-constants';

import { memoryStore, type KeyValueStore } from '../data/storage';
import bundledNotes from './release-notes.json';

export interface ReleaseVersion {
  version: string;
  /** `YYYY-MM-DD`, or null when the file has none for it. */
  date: string | null;
  notes: string[];
}

export const SEEN_KEY = 'hg.rider.whatsNew.lastSeen';

/* ------------------------------------------------------------------ versions */

function parts(v: string): number[] {
  return v
    .split('-')[0]!
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
}

/** Semantic order of `MAJOR.MINOR.PATCH` (a pre-release label is ignored). */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The installed app's version (`app.config.js` from `APP_VERSION`; dev builds are 0.0.0). */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** Versions released up to the installed one, newest first. */
export function released(all: readonly ReleaseVersion[], current: string): ReleaseVersion[] {
  return all.filter((v) => compareVersions(v.version, current) <= 0).sort((a, b) => compareVersions(b.version, a.version));
}

/** What the sheet shows: every version since `lastSeen`; with nothing saved, only the latest. */
export function unseen(all: readonly ReleaseVersion[], current: string, lastSeen: string | null): ReleaseVersion[] {
  const list = released(all, current);
  if (!lastSeen) return list.slice(0, 1);
  return list.filter((v) => compareVersions(v.version, lastSeen) > 0);
}

/* ------------------------------------------------------------------ the file */

/** Throws on a file that is not the expected shape (HW WhatsNew-error: "local file unreadable"). */
export function parseNotes(raw: unknown): ReleaseVersion[] {
  const versions = (raw as { versions?: unknown } | null)?.versions;
  if (!Array.isArray(versions)) throw new Error('release-notes.json: no versions');
  return versions.map((v) => {
    const r = v as { version?: unknown; date?: unknown; notes?: unknown };
    if (typeof r.version !== 'string' || !Array.isArray(r.notes) || r.notes.some((n) => typeof n !== 'string')) {
      throw new Error('release-notes.json: a version is malformed');
    }
    return { version: r.version, date: typeof r.date === 'string' ? r.date : null, notes: r.notes as string[] };
  });
}

const bundled = (): unknown => bundledNotes;
let source: () => unknown = bundled;

/** Read the bundled file (a promise, so a slow read shows HW WhatsNew-loading). */
export async function loadReleaseNotes(): Promise<ReleaseVersion[]> {
  return parseNotes(await source());
}

/* ------------------------------------------------------------------ last seen */

interface SeenState {
  loaded: boolean;
  /** The newest version marked seen, now. */
  lastSeen: string | null;
  /** What was saved when the app started (the page's "New" marks). */
  atLaunch: string | null;
}

let store: KeyValueStore = memoryStore();
let state: SeenState = { loaded: false, lastSeen: null, atLaunch: null };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: SeenState): void {
  state = next;
  for (const fn of listeners) fn();
}

function load(): void {
  if (state.loaded || loading) return;
  loading = (async () => {
    let saved: string | null = null;
    try {
      saved = await store.getItem(SEEN_KEY);
    } catch {
      saved = null; // no persisted storage: a new device, for this run
    }
    // A version marked seen while the read was in flight wins over the stored one.
    const lastSeen = state.lastSeen && (!saved || compareVersions(state.lastSeen, saved) > 0) ? state.lastSeen : saved;
    emit({ loaded: true, lastSeen, atLaunch: saved });
    loading = null;
  })();
}

/** Mark `version` seen: at once in memory, then in the store (a failed write is ignored). */
export function markSeen(version: string): void {
  if (state.lastSeen && compareVersions(state.lastSeen, version) >= 0) return;
  emit({ ...state, lastSeen: version });
  void (async () => {
    try {
      await store.setItem(SEEN_KEY, version);
    } catch {
      // Remembered in memory for this run; the notes come back on the next launch.
    }
  })();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  load();
  return () => {
    listeners.delete(fn);
  };
}

export function useSeen(): SeenState {
  return React.useSyncExternalStore(subscribe, () => state, () => state);
}

/** Test seams: the store behind the last-seen version, the notes file, and a fresh launch. */
export function setSeenStore(next: KeyValueStore): void {
  store = next;
}

export function setReleaseNotesSource(next: (() => unknown) | null): void {
  source = next ?? bundled;
}

export function resetWhatsNew(): void {
  store = memoryStore();
  state = { loaded: false, lastSeen: null, atLaunch: null };
  loading = null;
  source = bundled;
}
