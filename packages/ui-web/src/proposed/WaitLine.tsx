/**
 * `WaitLine` — "You can try again in 0:42" under a disabled button (proposed, #737; SI
 * `SignIn-TooMany`, `SignIn-Locked`, `Register-RateLimited`, `CheckEmail-Cooldown`,
 * `CheckEmail-DailyLimit`).
 *
 * - The time is the silent `Countdown` from the server clock: `serverNow` is the response's
 *   `Date` header and the deadline is `serverNow + retryAfter` seconds (the `Retry-After`
 *   header, as seconds or an HTTP date), or an explicit `expiresAt`. No deadline (a 423 without
 *   Retry-After): the line is omitted.
 * - The line carries an `id` that a disabled button's `aria-describedby` points at. Pass `id`,
 *   or take it from `useWaitLine`, which also tracks whether the wait is still running so the
 *   button knows when to re-enable.
 * - The visible lead is hidden from the description and a spoken lead stands in, so the button
 *   is described as "Time until you can try again: 42 seconds left", not "You can try again in
 *   42 seconds left".
 * - One polite status message when the wait starts ("You can try again in 42 seconds.") and one
 *   when it ends ("You can try again now."), nothing per second (`announce={false}` when the
 *   page's PageAnnouncer speaks instead).
 * - Expiring while shown: `onExpire` fires once and the line becomes `endMessage`. Already over
 *   at mount: `onExpire` fires once and nothing renders.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { Countdown } from '../ds/Countdown.js';
import { speakRemaining } from '../ds/remaining.js';
import { cn } from '../lib/utils.js';

/** Where a wait's deadline comes from: the response's Date plus Retry-After, or a deadline. */
export interface WaitSource {
  /** The response's `Date` header (HTTP date) or any RFC 3339 time: the server's now. */
  serverNow: string;
  /** The `Retry-After` header: seconds (number or digits) or an HTTP date. */
  retryAfter?: number | string | null;
  /** An explicit RFC 3339 deadline, used when there is no `retryAfter`. */
  expiresAt?: string | null;
}

/** A wait resolved to what Countdown needs. */
export interface WaitDeadline {
  /** RFC 3339 server now. */
  serverNow: string;
  /** RFC 3339 deadline. */
  expiresAt: string;
  /** The whole wait, in seconds (at least 1). */
  windowSeconds: number;
}

/**
 * Resolves `serverNow` + `retryAfter` (or `expiresAt`) to a Countdown deadline. Null when there
 * is no usable deadline, so the caller omits the line.
 */
export function resolveWaitDeadline({ serverNow, retryAfter, expiresAt }: WaitSource): WaitDeadline | null {
  const now = Date.parse(serverNow);
  if (Number.isNaN(now)) return null;
  let deadline = Number.NaN;
  if (retryAfter !== undefined && retryAfter !== null && String(retryAfter).trim() !== '') {
    const raw = String(retryAfter).trim();
    deadline = /^\d+(\.\d+)?$/.test(raw) ? now + Number(raw) * 1000 : Date.parse(raw);
  } else if (expiresAt) {
    deadline = Date.parse(expiresAt);
  }
  if (Number.isNaN(deadline)) return null;
  return {
    serverNow: new Date(now).toISOString(),
    expiresAt: new Date(deadline).toISOString(),
    windowSeconds: Math.max(1, Math.round((deadline - now) / 1000)),
  };
}

/** Props of the proposed `WaitLine` (#737). */
export interface WaitLineProps extends WaitSource {
  /** The id a disabled button's `aria-describedby` points at; generated when omitted. */
  id?: string;
  /** Visible words before the time. Default "You can try again in". */
  lead?: string;
  /**
   * Words before the time in the button's description. Defaults to "Time until you can try
   * again:" with the default lead, else to the lead.
   */
  spokenLead?: string;
  /** The line once the wait is over. Default "You can try again now." */
  endMessage?: string;
  /** Fires once when the wait is over (including when it was over at mount). */
  onExpire?: () => void;
  /** Speak once at the start and once at the end. Default true. */
  announce?: boolean;
  /** data-testid; defaults to the component name. */
  testId?: string;
  style?: CSSProperties;
  className?: string;
}

const DEFAULT_LEAD = 'You can try again in';
const DEFAULT_SPOKEN_LEAD = 'Time until you can try again:';

/** "You can try again in" + the silent Countdown; see the module comment. */
export function WaitLine({
  id,
  lead = DEFAULT_LEAD,
  spokenLead,
  endMessage = 'You can try again now.',
  onExpire,
  announce = true,
  testId = 'WaitLine',
  style,
  className,
  serverNow,
  retryAfter,
  expiresAt,
}: WaitLineProps) {
  const auto = useId();
  const lineId = id ?? `wait-line-${auto}`;
  const wait = useMemo(
    () => resolveWaitDeadline({ serverNow, retryAfter, expiresAt }),
    [serverNow, retryAfter, expiresAt],
  );
  const key = wait?.expiresAt ?? '';

  const [phase, setPhase] = useState<'waiting' | 'ended' | 'over-at-mount'>('waiting');
  const [message, setMessage] = useState('');
  // Child effects run before this component's own: until this is true, an expiry is "at mount".
  const mounted = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    mounted.current = true;
    setPhase((p) => (p === 'over-at-mount' ? p : 'waiting'));
    if (wait && announce) setMessage(`${lead} ${speakRemaining(wait.windowSeconds)}.`);
    return () => {
      mounted.current = false;
      setPhase('waiting');
      setMessage('');
    };
    // A new deadline starts a new wait; the copy props do not.
  }, [key]);

  const handleExpire = useCallback(() => {
    setPhase(mounted.current ? 'ended' : 'over-at-mount');
    if (mounted.current && announce) setMessage(endMessage);
    onExpireRef.current?.();
  }, [announce, endMessage]);

  if (!wait || phase === 'over-at-mount') return null;

  const spoken = spokenLead ?? (lead === DEFAULT_LEAD ? DEFAULT_SPOKEN_LEAD : lead);

  return (
    <div data-testid={testId} data-state={phase} style={style} className={cn('flex flex-col', className)}>
      <p id={lineId} className="m-0 flex flex-wrap items-center gap-1 text-body-sm text-fg-secondary">
        {phase === 'ended' ? (
          endMessage
        ) : (
          <>
            <span aria-hidden="true">{lead}</span>
            <span className="sr-only">{spoken}</span>
            <Countdown
              key={key}
              expiresAt={wait.expiresAt}
              serverNow={wait.serverNow}
              windowSeconds={wait.windowSeconds}
              variant="text"
              size="sm"
              silent
              onExpire={handleExpire}
              testId={`${testId}-countdown`}
            />
          </>
        )}
      </p>
      {announce ? (
        <span role="status" aria-atomic="true" className="sr-only" data-slot="wait-line-status">
          {message}
        </span>
      ) : null}
    </div>
  );
}

/** What `useWaitLine` returns. */
export interface UseWaitLineResult {
  /** The line's id. */
  id: string;
  /** True while the wait runs: keep the button `disabled`. */
  waiting: boolean;
  /** The button's `aria-describedby`: the line's id while waiting, else undefined. */
  describedBy: string | undefined;
  /** Spread onto `<WaitLine>`: the source, the id and the expiry wiring. */
  lineProps: WaitLineProps;
}

/**
 * Wires a WaitLine to the button it explains:
 *
 *   const wait = useWaitLine({ serverNow, retryAfter });
 *   <Button disabled={wait.waiting} aria-describedby={wait.describedBy}>Try again</Button>
 *   <WaitLine {...wait.lineProps} />
 */
export function useWaitLine(source: WaitSource & { id?: string; onExpire?: () => void }): UseWaitLineResult {
  const auto = useId();
  const id = source.id ?? `wait-line-${auto}`;
  const deadline = resolveWaitDeadline(source)?.expiresAt ?? null;
  const [endedFor, setEndedFor] = useState<string | null>(null);
  const onExpireRef = useRef(source.onExpire);
  onExpireRef.current = source.onExpire;

  const onExpire = useCallback(() => {
    setEndedFor(deadline);
    onExpireRef.current?.();
  }, [deadline]);

  const waiting = deadline !== null && endedFor !== deadline;
  return {
    id,
    waiting,
    describedBy: waiting ? id : undefined,
    lineProps: {
      serverNow: source.serverNow,
      retryAfter: source.retryAfter,
      expiresAt: source.expiresAt,
      id,
      onExpire,
    },
  };
}
