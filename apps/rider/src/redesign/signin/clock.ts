/**
 * A ticking "now" for the sign-in countdowns (resend in 42 s, wait 14 minutes). Re-renders every
 * `everyMs` only while `active`, so a screen with nothing counting down stays still. The value is
 * read at render, never cached, so a wait set this instant reads in full ("14 minutes", not 15).
 */
import * as React from 'react';

export function useNow(active: boolean, everyMs = 1000): number {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return Date.now();
}
