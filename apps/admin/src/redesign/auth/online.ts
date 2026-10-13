import { useEffect, useState } from 'react';

/** Whether the browser says it is online; follows the `online` / `offline` events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** `Retry-After` as seconds or an HTTP date; `fallbackMs` from now when absent or unreadable. */
export function retryAtFrom(response: Response, fallbackMs = 60_000): Date {
  const raw = response.headers.get('Retry-After')?.trim() ?? '';
  if (/^\d+$/.test(raw)) return new Date(Date.now() + Number(raw) * 1000);
  const at = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(at) ? new Date(at) : new Date(Date.now() + fallbackMs);
}
