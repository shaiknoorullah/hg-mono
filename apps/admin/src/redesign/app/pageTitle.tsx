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
