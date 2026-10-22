/**
 * What this device knows about the release notes (restaurant boards `WhatsNew-*`; issue 101). The
 * store itself is shared with the admin console (`@hg/ui-web/release-notes`); this file gives it the
 * app's storage key and its bundled file. When storage is blocked the app shows nothing by itself,
 * and What's new stays in the account menu and in Settings.
 */
import { createReleaseNotesStore } from '@hg/ui-web/release-notes';

import { APP_VERSION } from './releaseNotes';

export type { NotesLoad, NotesState as WhatsNewState } from '@hg/ui-web/release-notes';

export const LAST_SEEN_KEY = 'hg.restaurant.whatsnew.last-seen';

const store = createReleaseNotesStore({
  appVersion: APP_VERSION,
  lastSeenKey: LAST_SEEN_KEY,
  bundled: () => import('../../release-notes.json'),
});

export const getWhatsNewState = store.getState;
export const useWhatsNewState = store.useState;
export const ensureReleaseNotes = store.ensureLoaded;
export const retryReleaseNotes = store.retry;
export const markSeen = store.markLastSeen;
export const setReleaseNotesLoader = store.setLoader;
export const resetWhatsNew = store.reset;
