/**
 * The halal badge the console draws on its operational surface, from the restaurant profile
 * (wp4 spec §7): a missing `halal` field draws nothing and is reported, never an optimistic badge.
 * Shared by the service status bar and the compact frame's app bar.
 */
import { useEffect } from 'react';
import { reportHalalClientError } from '../ds';
import { useConsole } from '../data/console';
import { halalConsoleView, type HalalConsoleView } from './halal';

export function useHalalBadge(): { halal: HalalConsoleView | null; restaurantId: string | undefined } {
  const { profile } = useConsole();
  const profileReady = profile.status === 'ready' || profile.status === 'stale';
  const halal = profileReady ? halalConsoleView(profile.data?.halal, null) : null;
  const missingHalal = Boolean(halal?.missing);
  useEffect(() => {
    if (missingHalal) {
      reportHalalClientError('HALAL_DISPLAY_STATE_MISSING', { restaurantId: profile.data?.id, received: profile.data?.halal, surface: 'operational' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingHalal]);
  return { halal, restaurantId: profile.data?.id };
}
