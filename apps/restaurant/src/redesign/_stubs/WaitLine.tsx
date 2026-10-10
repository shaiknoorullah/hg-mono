/**
 * TEMPORARY STUB for the proposed DS `WaitLine` (ds-request(web): #737; the silent timer it
 * draws is the silent `Countdown` of #675). Delete when `@hg/ui-web/ds` or `/proposed` exports it.
 *
 * "You can try again in 0:59": a lead sentence and a silent timer, counted from the SERVER's
 * clock: `serverNow` is the server's `Date` when the response arrived and `expiresAt` that plus
 * `Retry-After`, so the time left is `expiresAt - serverNow` minus the time spent on this device
 * since, never the device's wall clock against `expiresAt`. Its `id` is what a disabled button's
 * `aria-describedby` points at.
 *
 * Silent by design: `role="timer"` is not a live region, so nothing is read out per second; the
 * page announces the start and the end itself. `onExpire` fires once, including when the wait
 * was already over at mount. (The strip's `Countdown` stub counts from epoch deadlines with a
 * caller clock and has no expiry callback; the DS Countdown should cover both.)
 */
import { useEffect, useRef, useState } from 'react';

export interface WaitLineProps {
  wait: { expiresAt: string; serverNow: string; windowSeconds: number };
  /** The words before the time ("You can try again in "). */
  prefix: string;
  /** Names the timer ("until you can try again"). */
  label: string;
  onExpire: () => void;
  id?: string;
}

/** "0:59", "14:05", or "1:05:00" above an hour. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function WaitTimer({ wait, label, onExpire }: Pick<WaitLineProps, 'wait' | 'label' | 'onExpire'>) {
  // Remaining at the moment the server answered, then counted down on this device's clock.
  const [anchor] = useState(() => ({
    remainingAtServerNow: Date.parse(wait.expiresAt) - Date.parse(wait.serverNow),
    receivedAt: Date.now(),
  }));
  const [, tick] = useState(0);
  const fired = useRef(false);
  const remaining = Number.isNaN(anchor.remainingAtServerNow)
    ? 0
    : Math.min(wait.windowSeconds * 1000, anchor.remainingAtServerNow) - (Date.now() - anchor.receivedAt);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [remaining, onExpire]);

  return (
    <span role="timer" aria-label={label} data-testid="Countdown" className="font-semibold tabular-nums text-fg-primary text-label-md">
      {formatRemaining(remaining)}
    </span>
  );
}

export function WaitLine({ wait, prefix, label, onExpire, id = 'wait-reason' }: WaitLineProps) {
  return (
    <p id={id} className="m-0 flex flex-wrap items-baseline gap-1 text-body-sm text-fg-secondary">
      {prefix}
      <WaitTimer key={wait.expiresAt} wait={wait} label={label} onExpire={onExpire} />
    </p>
  );
}
