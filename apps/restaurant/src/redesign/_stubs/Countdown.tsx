/**
 * TEMPORARY STUB for the proposed DS `Countdown` with a silent mode (ds-request(web): #675).
 * Delete when `@hg/ui-web/proposed` exports it.
 *
 * The live DS Countdown speaks at 50/25/10/0 per instance and has no way to turn that off
 * (LO `A11y-countdown-silent`). This one is always silent: it draws the time left from
 * `expiresAt` minus the caller's server clock (`now`), and the page announcer is the only
 * speaker. Variants: `ring` (tile), `bar` (panel), `text` (compact strip).
 *
 * Phases: normal above 25 % of the window, urgent below 25 %, critical below 10 %.
 */
import { useEffect, useState } from 'react';

export interface CountdownProps {
  /** The deadline, epoch ms (from `deadline_at`). */
  expiresAt: number;
  /** The server clock (`serverNow`), never the device clock alone. */
  now: () => number;
  /** The full window, seconds (180 for a new order). */
  windowSeconds: number;
  variant?: 'ring' | 'bar' | 'text';
  size?: 'sm' | 'md' | 'lg';
  /** Caption under the numeral, e.g. "left to answer". */
  label?: string;
  className?: string;
  testId?: string;
}

export function countdownSeconds(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const PHASE_TEXT = {
  normal: 'text-feedback-info-icon',
  urgent: 'text-feedback-warning-icon',
  critical: 'text-feedback-danger-icon',
  expired: 'text-fg-secondary',
} as const;

export function Countdown({ expiresAt, now, windowSeconds, variant = 'text', size = 'md', label, className, testId }: CountdownProps) {
  const [left, setLeft] = useState(() => countdownSeconds(expiresAt, now()));
  useEffect(() => {
    const tick = () => setLeft(countdownSeconds(expiresAt, now()));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAt, now]);

  const frac = windowSeconds > 0 ? left / windowSeconds : 1;
  const phase = left <= 0 ? 'expired' : frac < 0.1 ? 'critical' : frac < 0.25 ? 'urgent' : 'normal';
  const pct = Math.max(0, Math.min(1, frac));
  const numSize = size === 'lg' ? 'text-[28px]' : size === 'sm' ? 'text-[15px]' : 'text-[20px]';
  const numeral = (
    <span aria-hidden="true" className={`font-bold tabular-nums ${numSize} ${PHASE_TEXT[phase]}`}>
      {formatClock(left)}
    </span>
  );

  return (
    <div
      // Silent: no live region and no accessible name that changes every second. The page
      // announcer speaks the thresholds once (25 %, 10 %, 0).
      aria-hidden="true"
      data-testid={testId ?? 'countdown'}
      data-phase={phase}
      data-seconds-left={left}
      className={`${variant === 'ring' ? 'inline-grid justify-items-center' : variant === 'bar' ? 'grid w-full gap-1' : 'inline-flex items-baseline gap-1'} ${className ?? ''}`}
    >
      {variant === 'ring' ? (
        <span className="relative grid size-16 place-items-center">
          <svg viewBox="0 0 36 36" width="100%" height="100%" className="absolute inset-0 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" strokeWidth="3" className="stroke-line-decorative" />
            <circle
              cx="18"
              cy="18"
              r="16"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              stroke="currentColor"
              className={PHASE_TEXT[phase]}
              strokeDasharray={`${(pct * 100.53).toFixed(2)} 100.53`}
            />
          </svg>
          {numeral}
        </span>
      ) : variant === 'bar' ? (
        <>
          <span className="flex items-baseline gap-2">
            {numeral}
            {label ? <span className="text-[13px] text-fg-secondary">{label}</span> : null}
          </span>
          <span className="block h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
            <span className={`block h-full rounded-full bg-current ${PHASE_TEXT[phase]}`} style={{ inlineSize: `${pct * 100}%` }} />
          </span>
        </>
      ) : (
        <>
          {numeral}
          {label ? <span className="text-[13px] text-fg-secondary">{label}</span> : null}
        </>
      )}
    </div>
  );
}
