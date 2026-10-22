import { useEffect, useRef } from 'react';

import { APP_VERSION, compareVersions, selectReleases, type Release } from './releaseNotes';
import { ensureReleaseNotes, markSeen, useWhatsNewState } from './store';

export type NotesView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  /** Nothing newer than what was seen (or no notes at all). */
  | { readonly kind: 'upToDate' }
  | { readonly kind: 'list'; readonly mode: 'first' | 'since' | 'all'; readonly items: readonly Release[]; readonly fresh: ReadonlySet<string> };

/**
 * What a place that shows the notes should draw. `since`: the releases newer than `baseline` (the
 * last-seen version when the place opened); `all`: every release, for the Settings page. Starts
 * loading the file if nothing has.
 */
export function useNotesView(mode: 'since' | 'all', baseline: string | null): NotesView {
  const state = useWhatsNewState();
  useEffect(() => {
    ensureReleaseNotes();
  }, []);
  if (state.load.status === 'error') return { kind: 'error' };
  if (state.load.status !== 'ready') return { kind: 'loading' };
  const releases = state.load.releases.filter((r) => (compareVersions(r.version, APP_VERSION) ?? 1) <= 0);
  if (mode === 'all') {
    return releases.length === 0 ? { kind: 'upToDate' } : { kind: 'list', mode: 'all', items: releases, fresh: new Set() };
  }
  const picked = selectReleases(state.load.releases, baseline, APP_VERSION);
  if (picked.mode === 'current' || picked.items.length === 0) return { kind: 'upToDate' };
  return { kind: 'list', mode: picked.mode, items: picked.items, fresh: new Set(picked.items.map((r) => r.version)) };
}

/** Opening the panel with the notes on screen is what marks them seen (so they are not shown again). */
export function useMarkSeenWhenShown(shown: boolean): void {
  const state = useWhatsNewState();
  const done = useRef(false);
  useEffect(() => {
    if (shown && state.load.status === 'ready' && !done.current) {
      done.current = true;
      markSeen();
    }
  }, [shown, state.load.status]);
}

/** True when this device has notes it has not been told about (the account menu's marker). */
export function useUnseenNotes(): boolean {
  const state = useWhatsNewState();
  if (state.load.status !== 'ready' || state.storage !== 'ok') return false;
  return selectReleases(state.load.releases, state.lastSeen, APP_VERSION).items.length > 0;
}
