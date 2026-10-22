import { describe, expect, it } from 'vitest';

import bundled from '../../../release-notes.json';
import { APP_VERSION, parseReleaseNotes, releaseDate, releasesForRole, type Release } from '../releaseNotes';

const note = (title: string, roles?: readonly string[]) => ({ title, body: `${title} body`, ...(roles ? { roles } : {}) });

describe('role filtering', () => {
  const releases: Release[] = [
    { version: '1.4.0', date: '2026-09-28', notes: [note('Alerts'), note('Orders')] },
    { version: '1.3.0', date: '2026-09-14', notes: [note('Staff', ['SUPER_ADMIN']), note('System')] },
    { version: '1.2.0', date: '2026-08-31', notes: [note('Invites')] },
  ];

  it('keeps a note without roles for everyone and drops a note for other roles', () => {
    expect(releasesForRole(releases, 'SUPPORT_AGENT').map((r) => r.notes.map((n) => n.title))).toEqual([['Alerts', 'Orders'], ['System'], ['Invites']]);
    expect(releasesForRole(releases, 'SUPER_ADMIN')[1]?.notes.map((n) => n.title)).toEqual(['Staff', 'System']);
  });

  it('drops a release left with no notes for the role', () => {
    const only: Release[] = [{ version: '1.0.0', date: '2026-01-01', notes: [note('Staff', ['SUPER_ADMIN'])] }];
    expect(releasesForRole(only, 'ADMIN')).toEqual([]);
    expect(releasesForRole(only, null)).toEqual([]);
  });
});

describe('the notes this build ships', () => {
  it('are readable, the newest release is this build, and dates read short', () => {
    const releases = parseReleaseNotes(bundled);
    expect(releases[0]?.version).toBe(APP_VERSION);
    expect(releases.every((r) => r.notes.length > 0 && r.notes.every((n) => n.title.trim() && n.body.trim()))).toBe(true);
    expect(releaseDate('2026-09-28')).toBe('28 Sep 2026');
  });
});
