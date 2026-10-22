/**
 * The What's new state the shell shares: whether the panel is open, where focus returns when it
 * closes, and what the sidebar button needs (boards `ASS/WhatsNewPanel`, `-FocusReturn`).
 *
 * Opening the panel marks the notes seen (once they are on screen), so the New label goes and the
 * notice does not return. The panel keeps the last-seen version it had when it opened, so what it
 * lists does not change under the person while they read.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { StaffRole } from '../data/session';
import { APP_VERSION, releasesForRole, type Release } from './releaseNotes';
import { ensureReleaseNotes, markOpened, useWhatsNewState, type WhatsNewState } from './store';

/** The panel's id, for the sidebar button's `aria-controls`. */
export const WHATS_NEW_PANEL_ID = 'admin-whats-new-panel';
const NAV_DRAWER_OPENER = '[aria-controls="admin-nav-drawer-panel"]';

interface Api {
  open: boolean;
  /** The last-seen version this device had when the panel opened (`null`: a first device). */
  baseline: string | null;
  role: StaffRole | null;
  openFrom: (opener: HTMLElement | null) => void;
  toggle: (opener: HTMLElement | null) => void;
  close: () => void;
}

const WhatsNewContext = createContext<Api | null>(null);

export function WhatsNewProvider({ role, children }: { role: StaffRole | null; children: ReactNode }) {
  const state = useWhatsNewState();
  const [open, setOpen] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const live = useRef({ open, lastSeen: state.lastSeen });
  live.current = { open, lastSeen: state.lastSeen };

  useEffect(() => {
    ensureReleaseNotes();
  }, []);

  // Opened and readable: this device has now seen the current notes.
  useEffect(() => {
    if (open && state.load.status === 'ready') markOpened();
  }, [open, state.load.status]);

  const openFrom = useCallback((from: HTMLElement | null) => {
    if (live.current.open) return;
    opener.current = from;
    setBaseline(live.current.lastSeen);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const from = opener.current;
    opener.current = null;
    // The sidebar button stays mounted. In a narrow window the button was inside the drawer,
    // which has closed: focus goes to the button that opens it.
    const target = from?.isConnected ? from : (document.querySelector<HTMLElement>(NAV_DRAWER_OPENER) ?? document.getElementById('app-bar-heading'));
    target?.focus({ preventScroll: true });
  }, []);

  const toggle = useCallback(
    (from: HTMLElement | null) => {
      if (live.current.open) close();
      else openFrom(from);
    },
    [close, openFrom],
  );

  const api = useMemo<Api>(() => ({ open, baseline, role, openFrom, toggle, close }), [open, baseline, role, openFrom, toggle, close]);
  return <WhatsNewContext.Provider value={api}>{children}</WhatsNewContext.Provider>;
}

export function useWhatsNewApi(): Api {
  const api = useContext(WhatsNewContext);
  if (!api) throw new Error('useWhatsNewApi needs a WhatsNewProvider');
  return api;
}

/** The releases this role may read, once the file has loaded. */
export function readableReleases(state: WhatsNewState, role: StaffRole | null): Release[] | null {
  return state.load.status === 'ready' ? releasesForRole(state.load.releases, role) : null;
}

/** What the sidebar button needs. */
export function useWhatsNew() {
  const api = useWhatsNewApi();
  const state = useWhatsNewState();
  const readable = readableReleases(state, api.role);
  // A device that cannot say what it has seen shows no label; the button still works.
  const hasNew = readable !== null && readable.length > 0 && state.storage === 'ok' && state.opened !== APP_VERSION;
  return { open: api.open, toggle: api.toggle, hasNew };
}
