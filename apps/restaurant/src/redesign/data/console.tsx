/**
 * What every signed-in console page needs to know, read once per session (manifest WP1):
 * the restaurant id (from the principal's RESTAURANT role scope), the profile (account
 * state, halal, timezone), the onboarding status (which decides onboarding vs console), and
 * the public config (support phone and hours).
 *
 * The client never works out the next onboarding step itself: `current_step` from the
 * server decides (§1.1).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Schema } from '@hg/api-client';
import { client } from './client';
import { call } from './call';
import { useServerResource, type ServerResource } from './useServerResource';
import { DEFAULT_TIMEZONE } from '../format/time';

export type Principal = Schema['Principal'];
export type RestaurantProfile = Schema['RestaurantProfile'];
export type OnboardingStatus = Schema['RestaurantOnboardingStatus'];
export type PublicConfig = Schema['PublicConfig'];

export interface ConsoleData {
  principal: Principal;
  restaurantId: string;
  onboarding: OnboardingStatus;
}

export interface ConsoleContextValue {
  /** Principal, restaurant id and onboarding status: the router waits for these. */
  core: ServerResource<ConsoleData>;
  /** The restaurant's profile (halal, account state, name). Refreshed on window focus. */
  profile: ServerResource<RestaurantProfile>;
  /** Support phone and hours; may fail without blocking anything. */
  config: ServerResource<PublicConfig>;
  timezone: string;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

/** The restaurant a RESTAURANT-scoped role grant names (owner-only logins: one restaurant per login). */
export function restaurantIdOf(principal: Principal): string | null {
  const grant = principal.roles.find((r) => r.scope_type === 'RESTAURANT' && r.scope_id);
  return grant?.scope_id ?? null;
}

export class NotARestaurantError extends Error {
  constructor() {
    super('This account is not a restaurant account.');
    this.name = 'NotARestaurantError';
  }
}

async function loadCore(): Promise<ConsoleData> {
  const principal: Principal = await call(client.GET('/v1/auth/me', {}));
  const restaurantId = restaurantIdOf(principal);
  if (!restaurantId) throw new NotARestaurantError();
  const onboarding: OnboardingStatus = await call(client.GET('/v1/restaurant/onboarding/status', {}));
  return { principal, restaurantId, onboarding };
}

async function loadProfile(): Promise<RestaurantProfile> {
  return call(client.GET('/v1/restaurant/profile', {}));
}

async function loadConfig(): Promise<PublicConfig> {
  // The `infer` in `call` loses the `Cents` brand on `max_tip_cents`; the shape is the contract's.
  return (await call(client.GET('/v1/config/public', {}))) as unknown as PublicConfig;
}

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const core = useServerResource(loadCore);
  const profile = useServerResource(loadProfile);
  const config = useServerResource(loadConfig);
  const timezone = profile.data?.timezone ?? DEFAULT_TIMEZONE;
  const value = useMemo(() => ({ core, profile, config, timezone }), [core, profile, config, timezone]);
  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleContextValue {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole must be used inside <ConsoleProvider>');
  return ctx;
}

/** For screens rendered in tests or galleries without the full provider. */
export const ConsoleContextForTests = ConsoleContext;

export type ConsoleRoute =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not-restaurant' }
  | { kind: 'onboarding' }
  | { kind: 'console' };

/**
 * Where a signed-in session belongs. Onboarding until the server says `DONE`; the console
 * after that, including the SUSPENDED / DELISTED / DEACTIVATED consoles (they are the console
 * with banners and locks, ON `Suspended-Console`, `Delisted-Console`).
 */
export function consoleRoute(core: ServerResource<ConsoleData>): ConsoleRoute {
  if (core.status === 'loading') return { kind: 'loading' };
  if (core.status === 'error') {
    return core.error instanceof NotARestaurantError ? { kind: 'not-restaurant' } : { kind: 'error' };
  }
  const data = core.data!;
  return data.onboarding.current_step === 'DONE' ? { kind: 'console' } : { kind: 'onboarding' };
}
