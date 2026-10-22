/**
 * What this device knows about the release notes (admin boards `ASS/WhatsNew*`; issue 102). The
 * store itself is shared with the restaurant console (`@hg/ui-web/release-notes`); this file gives
 * it the console's storage keys and its bundled file.
 *
 * Two versions are kept on purpose (board `WhatsNewAfterNotNow`): "Not now" stores the current
 * version as last-seen so the notice does not come back, while the sidebar's New label stays until
 * the panel itself is opened.
 */
import { createReleaseNotesStore } from '@hg/ui-web/release-notes';

import { APP_VERSION } from './releaseNotes';

export type { NotesLoad, NotesState as WhatsNewState } from '@hg/ui-web/release-notes';

export const LAST_SEEN_KEY = 'hg-admin-whatsnew:last-seen';
export const OPENED_KEY = 'hg-admin-whatsnew:opened';

const store = createReleaseNotesStore({
  appVersion: APP_VERSION,
  lastSeenKey: LAST_SEEN_KEY,
  openedKey: OPENED_KEY,
  bundled: () => import('../../release-notes.json'),
});

export const getWhatsNewState = store.getState;
export const useWhatsNewState = store.useState;
export const ensureReleaseNotes = store.ensureLoaded;
export const retryReleaseNotes = store.retry;
export const markNoticed = store.markLastSeen;
export const markOpened = store.markOpened;
export const holdNotice = store.holdNotice;
export const setReleaseNotesLoader = store.setLoader;
export const resetWhatsNew = store.reset;
