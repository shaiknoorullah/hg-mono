/**
 * The app bar's page heading. Every route has a title in the route table; a screen that knows a
 * better one (the restaurant's name on its application) sets it with `usePageTitle`, and it is
 * forgotten when the route changes.
 */
import { createContext, useContext, useEffect } from 'react';

export const PageTitleContext = createContext<(title: string | null) => void>(() => {});

/** Overrides the app bar heading while the calling screen is mounted. `null` keeps the route's. */
export function usePageTitle(title: string | null): void {
  const set = useContext(PageTitleContext);
  useEffect(() => {
    set(title);
    return () => set(null);
  }, [set, title]);
}

/**
 * What the app bar shows beside the heading on the orders area (boards `ORD/OrdersGrid`,
 * `ORD/OrderDetail`, `ORD/LiveAlerts`: `AppBar` tone chrome with a subtitle line, and on an order
 * a back arrow). A screen sets it with `usePageBar`; it is forgotten when the screen unmounts.
 */
export interface PageBar {
  subtitle?: string;
  back?: { label: string; to: string };
  /**
   * A panel is open beside the page (the staff account or the invite form): the nav folds to the
   * rail so the list keeps its width, and opens again when the panel closes (boards `STF/Invite*`,
   * `STF/StaffDetail*`).
   */
  panel?: boolean;
}

export const PageBarContext = createContext<(bar: PageBar | null) => void>(() => {});

export function usePageBar(subtitle: string | undefined, back?: { label: string; to: string }, panel = false): void {
  const set = useContext(PageBarContext);
  const label = back?.label;
  const to = back?.to;
  useEffect(() => {
    set({ ...(subtitle ? { subtitle } : {}), ...(label && to ? { back: { label, to } } : {}), ...(panel ? { panel: true } : {}) });
    return () => set(null);
  }, [set, subtitle, label, to, panel]);
}
