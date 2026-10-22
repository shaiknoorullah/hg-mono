import { useEffect } from 'react';

import { holdNotice } from './store';

/**
 * A panel with input the person has not sent calls this while it is open: an update that arrives
 * meanwhile is queued, and its notice shows when the panel closes (board `WhatsNewQueued`, "never
 * interrupts"). Pass `false` while there is nothing to lose.
 */
export function useHoldWhatsNewNotice(active = true): void {
  useEffect(() => (active ? holdNotice() : undefined), [active]);
}
