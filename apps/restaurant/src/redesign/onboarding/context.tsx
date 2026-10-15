/**
 * What every onboarding screen reads (restaurant onboarding): the server's onboarding status (which decides
 * the step), the profile (halal, account state), the public config (support contact) and the
 * document list. The status and profile come from the console provider; the documents are read
 * here once and shared by the rail and the screens. Everything refreshes together after a write
 * and when a realtime event says the review moved.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useRealtimeChannel, eventOfType } from '@hg/ui-web/live';
import { client } from '../data/client';
import { call } from '../data/call';
import { useConsole, type ConsoleData } from '../data/console';
import { useServerResource, type ServerResource } from '../data/useServerResource';
import { supportFrom, type SupportContact } from '../auth/api';
import type { KycDocument, OnboardingStatus, RestaurantProfile } from './model';

export interface OnboardingContextValue {
  restaurantId: string;
  status: OnboardingStatus;
  /** The status resource: `refresh()` re-reads without a skeleton. */
  core: ServerResource<ConsoleData>;
  profile: ServerResource<RestaurantProfile>;
  docs: ServerResource<KycDocument[]>;
  /** `undefined` while the config is loading, `null` when support is off. */
  support: SupportContact | null | undefined;
  businessName: string;
  /** Re-reads status, profile and documents. */
  refreshAll: () => Promise<void>;
}

const Ctx = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOnboarding must be used inside <OnboardingProvider>');
  return v;
}

async function loadDocuments(): Promise<KycDocument[]> {
  return call(client.GET('/v1/restaurant/documents', {}));
}

export function OnboardingProvider({ children, data }: { children: ReactNode; data: ConsoleData }) {
  const { core, profile, config } = useConsole();
  const docs = useServerResource(loadDocuments);
  const refreshCore = core.refresh;
  const refreshProfile = profile.refresh;
  const refreshDocs = docs.refresh;
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshCore(), refreshProfile(), refreshDocs()]);
  }, [refreshCore, refreshProfile, refreshDocs]);

  // The review moved (a document decided, the setup step changed): re-read, REST is the truth.
  useRealtimeChannel(`restaurant:${data.restaurantId}`, (signal) => {
    if (signal.kind === 'refetch' || eventOfType(signal, 'document.review_state_changed') || eventOfType(signal, 'onboarding.state_changed')) {
      void refreshAll();
    }
  });

  // Coming back to the tab after a while: the review may have finished.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refreshAll]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      restaurantId: data.restaurantId,
      status: data.onboarding,
      core,
      profile,
      docs,
      support: supportFrom(config),
      businessName: profile.data?.display_name ?? '',
      refreshAll,
    }),
    [data, core, profile, docs, config, refreshAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
