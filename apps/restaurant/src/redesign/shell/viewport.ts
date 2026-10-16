/**
 * The console's breakpoints. Desktop is ≥ 1280 CSS px; landscape tablet (1024–1279) gets the
 * tablet layout (icon rail, 380 px panel, no key hints in the strip). Below 768 px a page is
 * one column (the design board for payouts at phone width is drawn at 320 px).
 */
import { useEffect, useState } from 'react';

const DESKTOP = '(min-width: 1280px)';
const PHONE = '(max-width: 767.98px)';

function useMedia(query: string, whenUnknown: boolean): boolean {
  const [match, setMatch] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : whenUnknown));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    on();
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, [query]);
  return match;
}

export function useIsDesktop(): boolean {
  return useMedia(DESKTOP, true);
}

/** Below 768 px: lists draw as stacked rows instead of a table. */
export function useIsPhone(): boolean {
  return useMedia(PHONE, false);
}
