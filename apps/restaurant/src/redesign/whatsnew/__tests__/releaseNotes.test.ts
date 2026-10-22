import { describe, expect, it } from 'vitest';

import bundled from '../../../release-notes.json';
import { APP_VERSION, parseReleaseNotes, releaseDate } from '../releaseNotes';

describe('the notes this build ships', () => {
  it('are readable, the newest release is this build, and dates read long', () => {
    const releases = parseReleaseNotes(bundled);
    expect(releases[0]?.version).toBe(APP_VERSION);
    expect(releases.every((r) => r.notes.length > 0 && r.notes.every((n) => n.title.trim() && n.body.trim()))).toBe(true);
    expect(releaseDate('2026-09-22')).toBe('22 September 2026');
  });
});
