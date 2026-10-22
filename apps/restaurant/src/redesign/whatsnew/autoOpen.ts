import { useEffect, useRef } from 'react';

import { APP_VERSION, selectReleases } from './releaseNotes';
import { ensureReleaseNotes, useWhatsNewState } from './store';

/**
 * Opens What's new once after an update (or on a device that has not seen any notes), unless
 * something else is in progress: while `blocked` (another panel, a confirmation) it waits, and
 * opens when that clears. It never opens twice in a session, and a device that cannot store
 * what it has seen opens nothing by itself.
 */
export function useAutoOpenWhatsNew({ blocked, open }: { blocked: boolean; open: () => void }): void {
  const state = useWhatsNewState();
  const done = useRef(false);
  useEffect(() => {
    ensureReleaseNotes();
  }, []);
  useEffect(() => {
    if (done.current || blocked || state.storage !== 'ok' || state.load.status !== 'ready') return;
    if (selectReleases(state.load.releases, state.lastSeen, APP_VERSION).items.length === 0) return;
    done.current = true;
    open();
  }, [blocked, open, state]);
}
