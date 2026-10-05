import * as React from 'react';

/**
 * `true` once `until` (epoch ms) has passed, re-rendering exactly then. `null` means no wait.
 * One timer per wait, not a ticking clock: the screens show a static time ("You can resend the
 * code at 6:45 pm"), so all that has to change is whether the action is open yet.
 */
export function usePassed(until: number | null): boolean {
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const passed = until === null || Date.now() >= until;
  React.useEffect(() => {
    if (until === null) return;
    const left = until - Date.now();
    if (left <= 0) return;
    const t = setTimeout(bump, left + 50);
    return () => clearTimeout(t);
  }, [until]);
  return passed;
}
