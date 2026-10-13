/**
 * The console's one breakpoint: desktop is ≥ 1280 CSS px; landscape tablet (1024–1279) gets the
 * tablet layout (icon rail, 380 px panel, no key hints in the strip).
 */
import { useEffect, useState } from 'react';

const DESKTOP = '(min-width: 1280px)';

export function useIsDesktop(): boolean {
  const [match, setMatch] = useState(() => (typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(DESKTOP);
    const on = () => setMatch(mql.matches);
    mql.addEventListener?.('change', on);
    return () => mql.removeEventListener?.('change', on);
  }, []);
  return match;
}
