/**
 * The words on the app bar's badges in the compact frame (board `PartTop`): the connection badge
 * ("Live · checked in 12 s ago", "Offline · connection lost 6:41 pm") and the order-sound badge
 * ("Sound on", "Order sound off"). Pure, so the table can be tested without a page.
 */
import type { ConnectionView } from '../data/connection';
import type { BadgeVariant } from '../ds';
import { formatTime } from '../format/time';

export interface ServiceBadge {
  label: string;
  variant: BadgeVariant;
  icon: 'refresh' | 'warning' | 'bell' | 'check' | 'clock';
}

/** "12 s ago", "3 min ago", "2 h ago": how long since the last good check-in. */
export function checkedInAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

export function connectionBadge(
  c: ConnectionView,
  opts: { firstLoadFailed: boolean; lastOkAt: number | null; now: number; timeZone?: string },
): ServiceBadge {
  if (c.kind === 'offline') {
    return {
      label: c.since ? `Offline · connection lost ${formatTime(c.since, opts.timeZone)}` : 'Offline',
      variant: 'warning',
      icon: 'warning',
    };
  }
  if (opts.firstLoadFailed) return { label: 'Not connected', variant: 'danger', icon: 'warning' };
  if (c.kind === 'reconnecting') {
    return { label: c.since ? `Reconnecting · since ${formatTime(c.since, opts.timeZone)}` : 'Reconnecting', variant: 'warning', icon: 'refresh' };
  }
  if (c.kind === 'connecting') return { label: 'Connecting…', variant: 'neutral', icon: 'refresh' };
  return {
    label: opts.lastOkAt === null ? 'Live' : `Live · checked in ${checkedInAgo(opts.now - opts.lastOkAt)}`,
    variant: 'info',
    icon: 'refresh',
  };
}

export function soundBadge(soundOff: boolean): ServiceBadge {
  return soundOff
    ? { label: 'Order sound off', variant: 'warning', icon: 'warning' }
    : { label: 'Sound on', variant: 'neutral', icon: 'bell' };
}
