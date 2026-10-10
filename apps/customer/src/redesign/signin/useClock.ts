/**
 * `usePassed(until)`: `true` once `until` (epoch ms, app clock) has passed (ported from #635
 * `signin/useClock.ts`, moved onto `lib/now.tsx`).
 *
 * One timer per wait, not a ticking clock: the screens show a static time ("You can resend the
 * code at 6:45 pm"), so all that changes is whether the action is open yet. It reads the app clock
 * (`getNow`), so a test or a dev build that moves the clock flips it too.
 */
import * as React from 'react';

import { getNow, useNow } from '../lib/now';

export function usePassed(until: number | null): boolean {
  // Re-render when the clock override moves; the interval is a backstop, never shown.
  useNow(30_000);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const passed = until === null || getNow() >= until;
  React.useEffect(() => {
    if (until === null) return;
    const left = until - getNow();
    if (left <= 0) return;
    const t = setTimeout(bump, left + 50);
    return () => clearTimeout(t);
  }, [until]);
  return passed;
}
