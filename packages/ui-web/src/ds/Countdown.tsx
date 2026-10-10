/**
 * Countdown — every deadline in the system, counted from the SERVER clock (02-components.md
 * §38, D-14; live `index.d.ts`, `components/Countdown/README.md`).
 *
 * - There is no `seconds` prop. `expiresAt` and `serverNow` are both required. Skew is
 *   `serverNow − deviceNow`; above 5 s the countdown runs on `serverNow` plus monotonic elapsed
 *   time, so a device ten minutes fast still shows the right amount.
 * - Already past at mount: renders nothing and fires `onExpire` once, so the caller re-fetches.
 *   Expiring while shown: shows 0:00 and fires `onExpire` once. Never a negative number.
 * - States by the remaining fraction of `windowSeconds`: normal, urgent (below
 *   `urgentThreshold`), critical (below `criticalThreshold`, a 1 Hz pulse that reduced motion
 *   suppresses) and expired. Feedback roles only (`feedback-*`), so the colours are themed.
 * - The numeral is `aria-live="off"`. A separate assertive region announces once each at 50%,
 *   25%, 10% and 0. `silent` (approval packet P6) drops that region and every `aria-live`
 *   attribute: the page's PageAnnouncer speaks for several countdowns at once instead.
 * - `variant="bar-only"` or `barOnly` (P6): the bar without the numeral or label; the
 *   `timer` element still carries the time left in its name.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Progress } from '../lib/ui/progress.js';
import { cn } from '../lib/utils.js';
import { reportDsClientError } from './client-error.js';
import { formatRemaining, speakRemaining } from './remaining.js';

/** Props of the live `Countdown` (index.d.ts), plus `silent` and `barOnly` (packet P6). */
export interface CountdownProps {
  /** RFC-3339 deadline from the server. REQUIRED. */
  expiresAt: string;
  /** Server clock at response time. REQUIRED. Skew > 5 s -> runs on serverNow + monotonic time. */
  serverNow: string;
  /** Full length of the window in seconds (rider offer 30, restaurant response 180…). Drives thresholds, ring and bar. */
  windowSeconds: number;
  /** Fires exactly once, including when the deadline had already passed at mount (the caller re-fetches). */
  onExpire?: () => void;
  /** Default `text`. `bar-only` is the bar without text (packet P6); same as `barOnly`. */
  variant?: 'ring' | 'bar' | 'text' | 'bar-only';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  /** Fraction of the window below which the state is urgent (default 0.25). */
  urgentThreshold?: number;
  /** Fraction below which it is critical, with a 1 Hz pulse (default 0.1). */
  criticalThreshold?: number;
  /** On the rider's dark field surface. */
  onDark?: boolean;
  /**
   * No live region and no `aria-live` attribute at all (packet P6). Use when several
   * countdowns share a screen, and announce through PageAnnouncer instead.
   */
  silent?: boolean;
  /** The bar without the numeral or the label (packet P6). */
  barOnly?: boolean;
  /** data-testid; defaults to the component name (02-components.md rule 11). */
  testId?: string;
  style?: CSSProperties;
  /** Extra classes on the root (the admin adapter's prop). */
  className?: string;
}

/** normal · urgent · critical · expired, by the remaining fraction of the window. */
export type CountdownState = 'normal' | 'urgent' | 'critical' | 'expired';

/** Above this clock skew the countdown trusts the server clock plus monotonic time. */
export const COUNTDOWN_SKEW_LIMIT_MS = 5000;
/** The fractions at which a non-silent countdown speaks, once each. */
export const COUNTDOWN_ANNOUNCE_AT = [0.5, 0.25, 0.1, 0] as const;

const TICK_MS = 250;

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface Anchor {
  valid: boolean;
  expiresMs: number;
  serverMs: number;
  monoAtMount: number;
  useServerClock: boolean;
}

function makeAnchor(expiresAt: string, serverNow: string): Anchor {
  const expiresMs = Date.parse(expiresAt);
  const serverMs = Date.parse(serverNow);
  const skew = Number.isNaN(serverMs) ? 0 : serverMs - Date.now();
  return {
    valid: !Number.isNaN(expiresMs),
    expiresMs,
    serverMs,
    monoAtMount: monotonicNow(),
    useServerClock: Math.abs(skew) > COUNTDOWN_SKEW_LIMIT_MS,
  };
}

/** Milliseconds left, by the skew rule. Never negative. */
function remainingMs(anchor: Anchor): number {
  if (!anchor.valid) return 0;
  const now = anchor.useServerClock
    ? anchor.serverMs + (monotonicNow() - anchor.monoAtMount)
    : Date.now();
  return Math.max(0, anchor.expiresMs - now);
}

function stateFor(fraction: number, seconds: number, urgent: number, critical: number): CountdownState {
  if (seconds <= 0) return 'expired';
  if (fraction < critical) return 'critical';
  if (fraction < urgent) return 'urgent';
  return 'normal';
}

const TEXT_TONE: Record<CountdownState, string> = {
  normal: 'text-feedback-info-icon',
  urgent: 'text-feedback-warning-text',
  critical: 'text-feedback-danger-icon',
  expired: 'text-fg-secondary',
};

/** On the rider's dark field surface the numeral steps to the inverse role. */
const TEXT_TONE_ON_DARK: Record<CountdownState, string> = {
  normal: 'text-fg-on-inverse',
  urgent: 'text-feedback-warning-border',
  critical: 'text-feedback-danger-border',
  expired: 'text-fg-on-inverse',
};

const STROKE_TONE: Record<CountdownState, string> = {
  normal: 'stroke-feedback-info-icon',
  urgent: 'stroke-feedback-warning-icon',
  critical: 'stroke-feedback-danger-icon',
  expired: 'stroke-line-decorative',
};

const FILL_TONE: Record<CountdownState, string> = {
  normal: 'bg-feedback-info-icon',
  urgent: 'bg-feedback-warning-icon',
  critical: 'bg-feedback-danger-icon',
  expired: 'bg-line-decorative',
};

/** Ring diameter in px: sm and md 64, lg 96 (the reference drawing). */
const RING_PX = { sm: 64, md: 64, lg: 96 } as const;
const NUMERAL_SIZE = { sm: 'text-label-md', md: 'text-heading-lg', lg: 'text-display-md' } as const;
/** Circumference of the r=16 ring in its 36-unit viewBox. */
const RING_LENGTH = 100.53;
/** 1 Hz pulse while critical; `motion-safe` drops it under reduced motion. */
const PULSE = 'motion-safe:animate-pulse motion-safe:[animation-duration:1s]';

/** Counts down to a server deadline; see the module comment for the rules it keeps. */
export function Countdown({
  expiresAt,
  serverNow,
  windowSeconds,
  onExpire,
  variant = 'text',
  size = 'md',
  label,
  urgentThreshold = 0.25,
  criticalThreshold = 0.1,
  onDark = false,
  silent = false,
  barOnly = false,
  testId = 'Countdown',
  style,
  className,
}: CountdownProps) {
  const anchor = useMemo(() => makeAnchor(expiresAt, serverNow), [expiresAt, serverNow]);
  const [ms, setMs] = useState(() => remainingMs(anchor));
  const expiredAtMount = useMemo(() => remainingMs(anchor) <= 0, [anchor]);

  // onExpire may change every render without restarting the timer.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const firedFor = useRef<string | null>(null);

  const [announcement, setAnnouncement] = useState('');
  const announced = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!anchor.valid) reportDsClientError('COUNTDOWN_DEADLINE_INVALID', { expiresAt });
  }, [anchor.valid, expiresAt]);

  useEffect(() => {
    const span = Math.max(1, windowSeconds);
    // Thresholds already behind us at mount are recorded silently, never spoken late.
    const startFraction = remainingMs(anchor) / 1000 / span;
    announced.current = new Set(COUNTDOWN_ANNOUNCE_AT.filter((t) => startFraction <= t));
    setAnnouncement('');

    const tick = () => {
      const left = remainingMs(anchor);
      setMs(left);
      // Exactly once per deadline, whether it passed before mount or while shown.
      if (left <= 0 && firedFor.current !== expiresAt) {
        firedFor.current = expiresAt;
        onExpireRef.current?.();
      }
      return left;
    };
    if (tick() <= 0) return undefined;
    const id = setInterval(() => {
      if (tick() <= 0) clearInterval(id);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [anchor, expiresAt, windowSeconds]);

  const seconds = Math.ceil(ms / 1000);
  const fraction = Math.min(1, Math.max(0, ms / 1000 / Math.max(1, windowSeconds)));
  const state = stateFor(fraction, seconds, urgentThreshold, criticalThreshold);

  // The assertive region speaks once at each of 50%, 25%, 10% and 0.
  useEffect(() => {
    if (silent) return;
    const crossed = COUNTDOWN_ANNOUNCE_AT.filter((t) => fraction <= t && !announced.current.has(t));
    if (crossed.length === 0) return;
    for (const t of crossed) announced.current.add(t);
    setAnnouncement(seconds <= 0 ? 'Time is up.' : `${speakRemaining(seconds)} left.`);
  }, [fraction, seconds, silent]);

  if (!anchor.valid || expiredAtMount) return null;

  const shape = barOnly || variant === 'bar-only' ? 'bar-only' : variant;
  const spoken = seconds <= 0 ? 'Time is up' : `${speakRemaining(seconds)} left`;
  const name = label ? `${label}: ${spoken}` : spoken;
  const numeralTone = (onDark ? TEXT_TONE_ON_DARK : TEXT_TONE)[state];
  const pulse = state === 'critical' ? PULSE : undefined;

  const numeral =
    shape === 'bar-only' ? null : (
      <span
        // The ticking numeral never speaks by itself; in silent mode there is no live attribute at all.
        {...(silent ? {} : { 'aria-live': 'off' as const })}
        data-slot="countdown-numeral"
        className={cn('font-bold tabular-nums', NUMERAL_SIZE[size], numeralTone, pulse)}
      >
        {formatRemaining(seconds)}
      </span>
    );

  const bar =
    shape === 'bar' || shape === 'bar-only' ? (
      <Progress
        value={Math.round(fraction * 100)}
        aria-hidden="true"
        className={cn('h-1 w-full min-w-30 rounded-full', onDark ? 'bg-fg-tertiary' : 'bg-line-decorative')}
        indicatorClassName={cn('rounded-full', FILL_TONE[state], shape === 'bar-only' && pulse)}
      />
    ) : null;

  const px = RING_PX[size];
  const ring =
    shape === 'ring' ? (
      <span className="relative grid place-items-center" style={{ width: px, height: px }}>
        <svg aria-hidden="true" viewBox="0 0 36 36" width="100%" height="100%" className="absolute inset-0 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            strokeWidth="3"
            className={onDark ? 'stroke-fg-tertiary' : 'stroke-line-decorative'}
          />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(fraction * RING_LENGTH).toFixed(2)} ${RING_LENGTH}`}
            className={STROKE_TONE[state]}
          />
        </svg>
        {numeral}
      </span>
    ) : null;

  return (
    <div
      role="timer"
      aria-label={name}
      data-testid={testId}
      data-variant={shape}
      data-state={state}
      data-silent={silent || undefined}
      className={cn(
        'inline-grid gap-1',
        shape === 'ring' ? 'justify-items-center' : 'justify-items-start',
        bar && 'min-w-30',
        className,
      )}
      style={style}
    >
      {ring ?? numeral}
      {label && shape !== 'bar-only' ? (
        <span className={cn('text-body-sm', onDark ? 'text-fg-on-inverse' : 'text-fg-secondary')}>{label}</span>
      ) : null}
      {bar}
      {silent ? null : (
        <span className="sr-only" aria-live="assertive" aria-atomic="true" data-slot="countdown-announcer">
          {announcement}
        </span>
      )}
    </div>
  );
}
