/**
 * R43 What's new: the release notes shipped in the app (`src/release-notes.json`, #97/#100) and
 * the last version this device has seen.
 *
 * HW n-whatsnew: shown once after an update, for every version since the last one seen on this
 * device; a new device with no saved version shows only the latest release. Got it, close, swipe,
 * scrim tap and Back all count as seen; the app closing or an offer covering it does not.
 *
 * The file is the shape the restaurant and admin consoles use too, newest first, so the
 * versioned-releases work (#97) can generate all of them:
 *
 *     [{ "version": "1.0.0", "date": "2026-10-22", "notes": [{ "title": "...", "body": "..." }] }]
 *
 * The last-seen version is kept per device in the phone's small-preferences storage
 * (`data/storage.ts`'s `asyncStorageStore`) behind a two-method `KeyValueStore`. When that storage
 * cannot be read the app cannot tell what was seen, so the sheet does not open by itself (it would
 * repeat on every launch); What's new stays in Account.
 */
import * as React from 'react';
import Constants from 'expo-constants';

import { asyncStorageStore, memoryStore, type KeyValueStore } from '../data/storage';
import bundledNotes from '../../release-notes.json';

export interface ReleaseNote {
  title: string;
  body: string;
}

export interface ReleaseVersion {
  version: string;
  /** `YYYY-MM-DD`, or null when the file has none for it. */
  date: string | null;
  notes: ReleaseNote[];
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

/**
 * Throws on a file that is not a list (HW WhatsNew-error: "local file unreadable"). One malformed
 * version or note is skipped rather than hiding the rest; a version with no readable note is
 * dropped. A file wrapped as `{ default: [...] }` (a JSON module) is unwrapped.
 */
export function parseNotes(raw: unknown): ReleaseVersion[] {
  const inner = (raw as { default?: unknown } | null)?.default;
  const list = Array.isArray(inner) ? inner : raw;
  if (!Array.isArray(list)) throw new Error('release-notes.json: not a list');
  const out: ReleaseVersion[] = [];
  for (const item of list) {
    const r = item as { version?: unknown; date?: unknown; notes?: unknown } | null;
    if (!r || typeof r.version !== 'string' || !/^\d+\.\d+\.\d+/.test(r.version) || !Array.isArray(r.notes)) continue;
    const notes = r.notes
      .map((n): ReleaseNote | null => {
        const note = n as { title?: unknown; body?: unknown } | null;
        return note && typeof note.title === 'string' && typeof note.body === 'string' ? { title: note.title, body: note.body } : null;
      })
      .filter((n): n is ReleaseNote => n !== null);
    if (notes.length > 0) out.push({ version: r.version, date: typeof r.date === 'string' ? r.date : null, notes });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
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
  /** The last-seen version could be read, so the sheet may open by itself. */
  canAutoShow: boolean;
  /** The newest version marked seen, now. */
  lastSeen: string | null;
  /** What was saved when the app started (the page's "New" marks). */
  atLaunch: string | null;
}

let store: KeyValueStore = asyncStorageStore();
let state: SeenState = { loaded: false, canAutoShow: false, lastSeen: null, atLaunch: null };
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
    let readable = true;
    try {
      saved = await store.getItem(SEEN_KEY);
    } catch {
      readable = false; // storage failed: show nothing by itself, still reachable from Account
    }
    // A version marked seen while the read was in flight wins over the stored one.
    const lastSeen = state.lastSeen && (!saved || compareVersions(state.lastSeen, saved) > 0) ? state.lastSeen : saved;
    emit({ loaded: true, canAutoShow: readable, lastSeen, atLaunch: saved });
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
      // Remembered in memory for this run; the sheet comes back on the next launch.
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
  state = { loaded: false, canAutoShow: false, lastSeen: null, atLaunch: null };
  loading = null;
  source = bundled;
}
