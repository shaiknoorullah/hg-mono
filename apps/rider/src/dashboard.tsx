/**
 * The rider dashboard, polled once for the whole signed-in app (`GET /v1/riders/me/dashboard`).
 *
 * Polling, not the WebSocket: every `POLL_MS` while online (and a slower tick while offline so a
 * crash-recovered delivery or a first offer is still found), paused while the app/tab is in the
 * background. `RiderShell` provides it; screens read it with `useDashboard()`.
 */
import * as React from 'react';
import { AppState, Platform } from 'react-native';
import { unwrap, type Schema } from '@hg/api-client';

import { api } from './api';

export type Dashboard = Schema['RiderDashboard'];

const ONLINE_POLL_MS = 5_000;
const OFFLINE_POLL_MS = 15_000;

const DashboardContext = React.createContext<Dashboard | null>(null);

export function useDashboard(): Dashboard | null {
  return React.useContext(DashboardContext);
}

export function isOnline(d: Dashboard | null): boolean {
  return d !== null && d.mode !== 'OFFLINE';
}

function appVisible(): boolean {
  if (Platform.OS === 'web' && typeof document !== 'undefined') return !document.hidden;
  return AppState.currentState === 'active';
}

export function DashboardProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [dashboard, setDashboard] = React.useState<Dashboard | null>(null);
  const online = isOnline(dashboard);

  React.useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      if (cancelled || !appVisible()) return;
      try {
        const body = await unwrap(api.GET('/v1/riders/me/dashboard'));
        if (!cancelled) setDashboard((body as { data: Dashboard }).data);
      } catch {
        /* keep the last good dashboard; the next tick retries */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), online ? ONLINE_POLL_MS : OFFLINE_POLL_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void tick();
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      sub.remove();
    };
  }, [online]);

  return <DashboardContext.Provider value={dashboard}>{children}</DashboardContext.Provider>;
}
