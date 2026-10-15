import { useEffect, useState } from 'react';

/**
 * The browser clock, re-read every `everyMs` and exactly when `until` passes, so a claim that ends
 * flips the page to "Your claim ended" without a reload.
 */
export function useNow(until: string | null | undefined, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), everyMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (until) {
      const wait = Date.parse(until) - Date.now();
      if (wait > 0 && wait < 2 ** 31 - 1) timer = setTimeout(() => setNow(Date.now()), wait + 20);
    }
    return () => {
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [until, everyMs]);
  return now;
}
