import { describe, expect, it } from 'vitest';

import { compareVersions, parseReleaseNotes, releaseDate, selectReleases, type Release } from '../notes.js';

const note = (title: string, roles?: string[]) => ({ title, body: `${title} body`, ...(roles ? { roles } : {}) });
const RELEASES: Release[] = [
  { version: '1.4.0', date: '2026-09-28', notes: [note('Alerts'), note('Orders')] },
  { version: '1.3.0', date: '2026-09-14', notes: [note('Staff', ['SUPER_ADMIN']), note('System')] },
  { version: '1.2.0', date: '2026-08-31', notes: [note('Invites')] },
];

describe('versions', () => {
  it('orders MAJOR.MINOR.PATCH numerically and a pre-release before its release', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.9', '1.3.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0-rc.1', '1.0.0-rc.2')).toBe(-1);
    expect(compareVersions('latest', '1.0.0')).toBeNull();
  });

  it('writes a calendar date without a time zone, short or long', () => {
    expect(releaseDate('2026-09-28', 'short')).toBe('28 Sep 2026');
    expect(releaseDate('2026-01-05', 'long')).toBe('5 January 2026');
    expect(releaseDate('soon', 'short')).toBe('soon');
  });
});

describe('which releases a device has not seen', () => {
  it('a device with no last-seen version gets the newest release only', () => {
    expect(selectReleases(RELEASES, null, '1.4.0')).toEqual({ mode: 'first', items: [RELEASES[0]] });
    // A stored value that is not a version is the same as none.
    expect(selectReleases(RELEASES, 'garbage', '1.4.0').mode).toBe('first');
  });

  it('a device that saw an older version gets every release since, newest first', () => {
    const picked = selectReleases(RELEASES, '1.2.0', '1.4.0');
    expect(picked.mode).toBe('since');
    expect(picked.items.map((r) => r.version)).toEqual(['1.4.0', '1.3.0']);
  });

  it('a device that saw the current version has nothing new', () => {
    expect(selectReleases(RELEASES, '1.4.0', '1.4.0')).toEqual({ mode: 'current', items: [] });
    // Seen something newer than this build (a rollback): still nothing new.
    expect(selectReleases(RELEASES, '1.9.0', '1.4.0').mode).toBe('current');
  });

  it('never offers a release newer than the build', () => {
    expect(selectReleases(RELEASES, '1.2.0', '1.3.0').items.map((r) => r.version)).toEqual(['1.3.0']);
    expect(selectReleases(RELEASES, null, '1.3.0').items.map((r) => r.version)).toEqual(['1.3.0']);
  });
});

describe('reading the file', () => {
  it('reads a list, newest first, accepts a module wrapper and keeps roles', () => {
    const raw = [RELEASES[2], RELEASES[0], RELEASES[1]];
    expect(parseReleaseNotes(raw).map((r) => r.version)).toEqual(['1.4.0', '1.3.0', '1.2.0']);
    expect(parseReleaseNotes({ default: raw })).toHaveLength(3);
    expect(parseReleaseNotes(raw)[1]?.notes[0]?.roles).toEqual(['SUPER_ADMIN']);
  });

  it('skips a malformed release or note instead of hiding the rest', () => {
    const parsed = parseReleaseNotes([
      { version: 'x', date: '2026-01-01', notes: [] },
      { version: '1.0.0', date: '2026-01-01' },
      { version: '1.1.0', date: '2026-01-02', notes: [{ title: 'Ok', body: 'fine' }, { title: 3 }, null] },
    ]);
    expect(parsed).toEqual([{ version: '1.1.0', date: '2026-01-02', notes: [{ title: 'Ok', body: 'fine' }] }]);
  });

  it('refuses a file that is not a list', () => {
    expect(() => parseReleaseNotes({ not: 'a list' })).toThrow();
    expect(() => parseReleaseNotes('nope')).toThrow();
  });
});
