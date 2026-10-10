/**
 * TEMPORARY STUB for the DS `Countdown` (live index.d.ts; ds-request(web): #675, "Countdown
 * silent mode"). Delete when `@hg/ui-web/ds` exports it (STATUS.md: missing, W4).
 *
 * Time comes from the SERVER: `serverNow` is the server's clock when the response arrived
 * (its `Date` header), so the remaining time is `expiresAt - serverNow` minus the time spent
 * on this device since — never the device's own wall clock against `expiresAt`.
 *
 * Silent by design: `role="timer"` is not a live region, so nothing is read out per second.
 * The page announces once at the start and once at the end. `onExpire` fires once, including
 * when the deadline had already passed at mount.
 */
import { useEffect, useRef, useState } from 'react';

export interface CountdownProps {
  expiresAt: string;
  serverNow: string;
  windowSeconds: number;
  onExpire?: () => void;
  variant?: 'text';
  size?: 'sm' | 'md';
  /** Names the timer for assistive technology ("until you can try again"). */
  label?: string;
  testId?: string;
}

/** "0:59", "14:05", or "1:05:00" above an hour. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function Countdown({ expiresAt, serverNow, windowSeconds, onExpire, size = 'sm', label, testId = 'Countdown' }: CountdownProps) {
  // Remaining at the moment the server answered, then counted down on this device's clock.
  const [anchor] = useState(() => ({
    remainingAtServerNow: Date.parse(expiresAt) - Date.parse(serverNow),
    receivedAt: Date.now(),
  }));
  const [, tick] = useState(0);
  const fired = useRef(false);
  const remaining = Number.isNaN(anchor.remainingAtServerNow)
    ? 0
    : Math.min(windowSeconds * 1000, anchor.remainingAtServerNow) - (Date.now() - anchor.receivedAt);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [remaining, onExpire]);

  return (
    <span
      role="timer"
      aria-label={label}
      data-testid={testId}
      className={`font-semibold tabular-nums text-fg-primary ${size === 'sm' ? 'text-label-md' : 'text-label-lg'}`}
    >
      {formatRemaining(remaining)}
    </span>
  );
}
