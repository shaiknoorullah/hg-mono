/**
 * The restaurant's open state (`getRestaurantAvailability`), one copy per console shell:
 * the status bar (WP4), the sign-out confirm (WP1), the strip's empty state (WP3) and the
 * Hours page (WP9) all read the same value. `restaurant.status_changed` and the heartbeat's
 * `open_state` update it; it also re-reads every 60 s and on window focus.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Schema } from '@hg/api-client';
import { client } from './client';
import { call } from './call';
import { useServerResource, type ServerResource } from './useServerResource';

export type Availability = Schema['RestaurantAvailability'];

const AvailabilityContext = createContext<ServerResource<Availability> | null>(null);

export function loadAvailability(): Promise<Availability> {
  return call(client.GET('/v1/restaurant/availability', {}));
}

export function AvailabilityProvider({ children }: { children: ReactNode }) {
  const availability = useServerResource(loadAvailability);
  const { refresh } = availability;
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  return <AvailabilityContext.Provider value={availability}>{children}</AvailabilityContext.Provider>;
}

export function useAvailability(): ServerResource<Availability> {
  const ctx = useContext(AvailabilityContext);
  if (!ctx) throw new Error('useAvailability must be used inside <AvailabilityProvider>');
  return ctx;
}

/** Sets `is_accepting_orders` (the Orders switch), and pauses when `pause_until` is given. */
export function setAcceptingOrders(body: { is_accepting_orders: boolean; pause_until?: string | null }): Promise<Availability> {
  return call(client.PATCH('/v1/restaurant/availability', { body }));
}
