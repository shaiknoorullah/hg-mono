/**
 * The release notes the app ships with (restaurant settings boards `WhatsNew-*`; issue 101,
 * https://github.com/shaiknoorullah/hg-mono/issues/101). The shape, parsing and "which releases has
 * this device not seen" rules are shared with the admin console (`@hg/ui-web/release-notes`); this
 * file adds the app's own version.
 *
 * The version is `package.json`'s `version`, which is also the newest release in the file (a unit
 * test keeps the two together until the release tooling writes both).
 */
import { releaseDate as formatReleaseDate } from '@hg/ui-web/release-notes';

import { version as PACKAGE_VERSION } from '../../../package.json';

export { compareVersions, parseReleaseNotes, selectReleases } from '@hg/ui-web/release-notes';
export type { Release, ReleaseNote, Selection } from '@hg/ui-web/release-notes';

/** The version of this build of the app. */
export const APP_VERSION: string = PACKAGE_VERSION;

/** "22 September 2026". */
export const releaseDate = (iso: string): string => formatReleaseDate(iso, 'long');
