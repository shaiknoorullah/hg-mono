/**
 * Shared display formatting. The one place every screen reaches for a date or a money
 * string, so the format never drifts screen to screen.
 */
import { cents, formatCents, type Cents } from '@hg/api-client';

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
const DATE_FMT = new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium' });

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_TIME_FMT.format(parsed);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FMT.format(parsed);
}

/** Money in cents, straight off the wire, as a display string. Never touches a float. */
export function formatMoney(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatCents(cents(value));
}

/** A live "Xm Ys left" / "overdue by Xm" countdown against a `deadline_at`. */
export function formatCountdown(deadlineAt: string | null | undefined, now: Date = new Date()): string | null {
  if (!deadlineAt) return null;
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) return null;
  const diffMs = deadline.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const totalMinutes = Math.floor(abs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return overdue ? `overdue by ${label}` : `${label} left`;
}

export function enumLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export type { Cents };
