/**
 * Countdown arithmetic, kept free of React so it can be tested with plain numbers.
 *
 * Every deadline in the system comes from the SERVER clock (live design system, Countdown README):
 * there is no `seconds` input. Skew is `serverNow − deviceNow`; above five seconds the countdown
 * runs on `serverNow` plus monotonic elapsed time, so a phone ten minutes fast still shows ~30 s.
 */

export const SKEW_LIMIT_MS = 5_000;
/** Remaining fractions announced once each (50%, 25%, 10%, time up). */
export const ANNOUNCE_MARKS = [0.5, 0.25, 0.1, 0] as const;

/** normal, urgent (below 25 %), critical (below 10 %), expired. */
export type CountdownPhase = 'normal' | 'urgent' | 'critical' | 'expired';

/** The server time and monotonic time captured at mount, and the device skew. */
export interface ClockBase {
  skewMs: number;
  serverAt: number;
  monoAt: number;
}

/** Wire dates: RFC 3339 date-time, or a bare YYYY-MM-DD read as UTC midnight. */
export function parseWireDate(value: string | null | undefined): number | null {
  if (!value || typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = new Date(dateOnly ? `${value}T00:00:00Z` : value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Capture the clock base from the server time in the response. */
export function clockBase(serverNowMs: number, deviceNowMs: number, monoNowMs: number): ClockBase {
  return { skewMs: serverNowMs - deviceNowMs, serverAt: serverNowMs, monoAt: monoNowMs };
}

/** The time to count against: the device clock unless it is off by more than five seconds. */
export function trustedNow(base: ClockBase, deviceNowMs: number, monoNowMs: number): number {
  return Math.abs(base.skewMs) > SKEW_LIMIT_MS ? base.serverAt + (monoNowMs - base.monoAt) : deviceNowMs;
}

/** Whole seconds left, never negative. */
export function remainingSeconds(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

/** The phase for the seconds left in a window. */
export function phaseOf(
  left: number,
  windowSeconds: number,
  urgentThreshold = 0.25,
  criticalThreshold = 0.1,
): CountdownPhase {
  if (left <= 0) return 'expired';
  const fraction = windowSeconds > 0 ? left / windowSeconds : 1;
  if (fraction < criticalThreshold) return 'critical';
  if (fraction < urgentThreshold) return 'urgent';
  return 'normal';
}

/** "0:27", "3:00". */
export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "27 seconds", "1 minute 5 seconds", "3 minutes". */
export function spokenSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  if (s || !m) parts.push(`${s} ${s === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

/** The marks newly crossed at `left`, given those already announced. */
export function crossedMarks(left: number, windowSeconds: number, done: ReadonlySet<number>): number[] {
  if (windowSeconds <= 0) return [];
  return ANNOUNCE_MARKS.filter((m) => !done.has(m) && left <= Math.round(windowSeconds * m));
}
