/**
 * The release notes the console ships with (admin boards `ASS/WhatsNew*`; issue 102,
 * https://github.com/shaiknoorullah/hg-mono/issues/102). The shape, parsing and "which releases has
 * this device not seen" rules are shared with the restaurant console (`@hg/ui-web/release-notes`);
 * this file adds the console's own version and the role filter.
 *
 * Versions are the console's own: `package.json`'s `version`, which is also the newest release in
 * the file (a unit test keeps the two together until the release tooling writes both).
 */
import { releaseDate as formatReleaseDate, type Release } from '@hg/ui-web/release-notes';

import { version as PACKAGE_VERSION } from '../../../package.json';
import type { StaffRole } from '../data/session';

export { compareVersions, parseReleaseNotes, selectReleases } from '@hg/ui-web/release-notes';
export type { Release, ReleaseNote, Selection } from '@hg/ui-web/release-notes';

/** The version of this build of the console. */
export const APP_VERSION: string = PACKAGE_VERSION;

/** The notes a role may read (a note with no `roles` is for everyone); a release left with none is dropped. */
export function releasesForRole(releases: readonly Release[], role: StaffRole | null): Release[] {
  const out: Release[] = [];
  for (const r of releases) {
    const notes = r.notes.filter((n) => !n.roles || (role !== null && n.roles.includes(role)));
    if (notes.length > 0) out.push({ ...r, notes });
  }
  return out;
}

/** "28 Sep 2026". */
export const releaseDate = (iso: string): string => formatReleaseDate(iso, 'short');
