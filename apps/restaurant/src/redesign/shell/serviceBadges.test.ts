/**
 * The compact frame's badge words (board `PartTop`) and which pages draw the compact frame.
 */
import { describe, expect, it } from 'vitest';
import { checkedInAgo, connectionBadge, latestCheckIn, soundBadge } from './serviceBadges';
import { isCompactFrame } from './frame';

const live = { kind: 'live', since: null } as const;
const NOW = 1_000_000_000_000;

describe('connection badge', () => {
  const o = (patch = {}) => ({ firstLoadFailed: false, lastOkAt: NOW - 12_000, now: NOW, timeZone: 'America/Toronto', ...patch });

  it('live reads "Live · checked in 12 s ago", counting from the last good check-in', () => {
    expect(connectionBadge(live, o())).toEqual({ label: 'Live · checked in 12 s ago', variant: 'info', icon: 'refresh' });
    expect(connectionBadge(live, o({ now: NOW + 48_000 })).label).toBe('Live · checked in 1 min ago');
  });

  it('live before the first check-in claims no time', () => {
    expect(connectionBadge(live, o({ lastOkAt: null })).label).toBe('Live');
  });

  it('offline names when the connection was lost, as a warning', () => {
    const since = Date.parse('2026-09-28T22:41:00Z');
    const b = connectionBadge({ kind: 'offline', since }, o());
    expect(b.label).toBe('Offline · connection lost 6:41 pm');
    expect(b.variant).toBe('warning');
    expect(connectionBadge({ kind: 'offline', since: null }, o()).label).toBe('Offline');
  });

  it('reconnecting, connecting and a failed first load never read as Live', () => {
    expect(connectionBadge({ kind: 'reconnecting', since: null }, o()).label).toBe('Reconnecting');
    expect(connectionBadge({ kind: 'connecting', since: null }, o()).label).toBe('Connecting…');
    expect(connectionBadge(live, o({ firstLoadFailed: true })).label).toBe('Not connected');
  });
});

describe('time since the last check-in', () => {
  it('uses seconds, then minutes, then hours; never negative', () => {
    expect(checkedInAgo(0)).toBe('0 s ago');
    expect(checkedInAgo(59_999)).toBe('59 s ago');
    expect(checkedInAgo(60_000)).toBe('1 min ago');
    expect(checkedInAgo(3_600_000)).toBe('1 h ago');
    expect(checkedInAgo(-5_000)).toBe('0 s ago');
  });
});

describe('last check-in', () => {
  it('is the later of this screen\'s heartbeat and the server\'s record, and null when neither exists', () => {
    const server = new Date(NOW - 30_000).toISOString();
    expect(latestCheckIn(NOW - 5_000, server)).toBe(NOW - 5_000);
    expect(latestCheckIn(null, server)).toBe(NOW - 30_000);
    expect(latestCheckIn(NOW - 60_000, server)).toBe(NOW - 30_000);
    expect(latestCheckIn(null, null)).toBeNull();
    expect(latestCheckIn(null, 'not a date')).toBeNull();
  });
});

describe('sound badge', () => {
  it('"Sound on" by default, "Order sound off" as a warning when this device is silenced', () => {
    expect(soundBadge(false)).toEqual({ label: 'Sound on', variant: 'neutral', icon: 'bell' });
    expect(soundBadge(true)).toEqual({ label: 'Order sound off', variant: 'warning', icon: 'warning' });
  });
});

describe('compact frame', () => {
  it('is Settings and Payouts (and their sub-pages) at tablet and desktop width only', () => {
    for (const path of ['/settings', '/settings/device', '/payouts', '/payouts/history']) {
      expect(isCompactFrame(path, false)).toBe(true);
      expect(isCompactFrame(path, true)).toBe(false);
    }
    for (const path of ['/orders', '/orders/history', '/menu', '/hours', '/settingsx']) {
      expect(isCompactFrame(path, false)).toBe(false);
    }
  });
});
