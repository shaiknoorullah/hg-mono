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
 * - Activating the aria-disabled button says the wait again (SI `SignIn-Locked`): change
 *   `announceRequest`, or spread `useWaitLine`'s `buttonProps` onto the button.
 * - Expiring while shown: `onExpire` fires once and the line becomes `endMessage`. Already over
 *   at mount: `onExpire` fires once and nothing renders (StrictMode's double effects included).
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
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
  /**
   * Change this number (a counter bumped when the disabled button is activated) to say the time
   * left again in the status region. `useWaitLine` wires it.
   */
  announceRequest?: number;
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
  announceRequest,
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
  // Device time when this deadline arrived: the time left is the window minus what has elapsed.
  const arrivedAt = useMemo(() => Date.now(), [key]);

  // Keyed by the deadline, so a new deadline starts a new wait with no reset in an effect
  // cleanup (which StrictMode's double effects would run, undoing "over at mount").
  const [overFor, setOverFor] = useState<string | null>(null);
  const [endedFor, setEndedFor] = useState<string | null>(null);
  const [message, setMessage] = useState({ text: '', seq: 0 });
  // Child effects run before this component's own: until this is true, an expiry is "at mount".
  const mounted = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  const say = useCallback((text: string) => setMessage((m) => ({ text, seq: m.seq + 1 })), []);

  useEffect(() => {
    mounted.current = true;
    if (wait && announce) say(`${lead} ${speakRemaining(wait.windowSeconds)}.`);
    return () => {
      mounted.current = false;
    };
    // A new deadline starts a new wait; the copy props do not.
  }, [key]);

  // Say the time left again when asked (the disabled button was activated).
  const lastRequest = useRef(announceRequest);
  useEffect(() => {
    if (announceRequest === lastRequest.current) return;
    lastRequest.current = announceRequest;
    if (!wait || !announce || endedFor === key || overFor === key) return;
    const left = wait.windowSeconds - (Date.now() - arrivedAt) / 1000;
    if (left > 0) say(`${lead} ${speakRemaining(left)}.`);
  }, [announceRequest]);

  const handleExpire = useCallback(() => {
    if (mounted.current) {
      setEndedFor(key);
      if (announce) say(endMessage);
    } else {
      setOverFor(key);
    }
    onExpireRef.current?.();
  }, [announce, endMessage, key, say]);

  if (!wait || overFor === key) return null;

  const phase = endedFor === key ? 'ended' : 'waiting';
  const spoken = spokenLead ?? (lead === DEFAULT_LEAD ? DEFAULT_SPOKEN_LEAD : lead);

  return (
    <div data-testid={testId} data-state={phase} style={style} className={cn('flex flex-col', className)}>
      {/* A div, not a p: the Countdown's timer is a div, which a paragraph may not contain. */}
      <div id={lineId} className="flex flex-wrap items-center gap-1 text-body-sm text-fg-secondary">
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
      </div>
      {announce ? (
        <span role="status" aria-atomic="true" className="sr-only" data-slot="wait-line-status">
          {/* A new node per message, so the same words said again are announced again. */}
          <span key={message.seq}>{message.text}</span>
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
  /** Says the time left again in the line's status region; does nothing once the wait is over. */
  reannounce: () => void;
  /**
   * Spread onto the disabled button: its `aria-describedby`, and capture-phase click and
   * Enter/Space handlers that call `reannounce` (a disabled DS Button swallows activation, so
   * the capture phase is where it can still be heard).
   */
  buttonProps: {
    'aria-describedby': string | undefined;
    onClickCapture: () => void;
    onKeyDownCapture: (e: KeyboardEvent) => void;
  };
  /** Spread onto `<WaitLine>`: the source, the id and the expiry and re-announce wiring. */
  lineProps: WaitLineProps;
}

/**
 * Wires a WaitLine to the button it explains:
 *
 *   const wait = useWaitLine({ serverNow, retryAfter });
 *   <Button disabled={wait.waiting} {...wait.buttonProps}>Try again</Button>
 *   <WaitLine {...wait.lineProps} />
 */
export function useWaitLine(source: WaitSource & { id?: string; onExpire?: () => void }): UseWaitLineResult {
  const auto = useId();
  const id = source.id ?? `wait-line-${auto}`;
  const deadline = resolveWaitDeadline(source)?.expiresAt ?? null;
  const [endedFor, setEndedFor] = useState<string | null>(null);
  const [announceRequest, setAnnounceRequest] = useState(0);
  const onExpireRef = useRef(source.onExpire);
  onExpireRef.current = source.onExpire;

  const onExpire = useCallback(() => {
    setEndedFor(deadline);
    onExpireRef.current?.();
  }, [deadline]);

  const waiting = deadline !== null && endedFor !== deadline;
  const reannounce = useCallback(() => {
    if (waiting) setAnnounceRequest((n) => n + 1);
  }, [waiting]);
  const describedBy = waiting ? id : undefined;

  return {
    id,
    waiting,
    describedBy,
    reannounce,
    buttonProps: {
      'aria-describedby': describedBy,
      onClickCapture: reannounce,
      onKeyDownCapture: (e) => {
        if (e.key === 'Enter' || e.key === ' ') reannounce();
      },
    },
    lineProps: {
      serverNow: source.serverNow,
      retryAfter: source.retryAfter,
      expiresAt: source.expiresAt,
      id,
      onExpire,
      announceRequest,
    },
  };
}
