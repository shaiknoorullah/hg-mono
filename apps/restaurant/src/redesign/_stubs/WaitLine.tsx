/**
 * TEMPORARY STUB for the proposed DS `WaitLine` (ds-request(web): #737; the silent `Countdown`
 * it wraps is #675). Delete when `@hg/ui-web/ds` or `/proposed` exports it.
 *
 * "You can try again in 0:59": a lead sentence and the silent Countdown, counted from the
 * server's own clock (its `Date` plus `Retry-After`). Its `id` is what a disabled button's
 * `aria-describedby` points at. Nothing is read out per second; the page announces the start
 * and the end itself.
 */
import { Countdown } from "./Countdown";

export interface WaitLineProps {
  wait: { expiresAt: string; serverNow: string; windowSeconds: number };
  /** The words before the time ("You can try again in "). */
  prefix: string;
  /** Names the timer ("until you can try again"). */
  label: string;
  onExpire: () => void;
  id?: string;
}

export function WaitLine({
  wait,
  prefix,
  label,
  onExpire,
  id = "wait-reason",
}: WaitLineProps) {
  return (
    <p
      id={id}
      className="m-0 flex flex-wrap items-baseline gap-1 text-body-sm text-fg-secondary"
    >
      {prefix}
      <Countdown
        key={wait.expiresAt}
        expiresAt={wait.expiresAt}
        serverNow={wait.serverNow}
        windowSeconds={wait.windowSeconds}
        variant="text"
        size="sm"
        label={label}
        onExpire={onExpire}
      />
    </p>
  );
}
