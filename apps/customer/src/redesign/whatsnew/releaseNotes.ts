/**
 * The release notes the customer app ships with, and which of them a person has not read yet
 * (customer boards `AC/WhatsNew*`; issue 99, https://github.com/shaiknoorullah/hg-mono/issues/99).
 *
 * The notes are a file bundled with the app, `src/release-notes.json`, written by hand until the
 * versioned-releases work (issue 97, https://github.com/shaiknoorullah/hg-mono/issues/97) generates
 * the same file at release time. Its shape is the one the restaurant and admin consoles use too:
 * newest release first.
 *
 *     [{ "version": "1.0.0", "date": "2026-10-22", "notes": [{ "title": "...", "body": "..." }] }]
 *
 * The app's version is the one the app already reads everywhere else: `expo-constants`'
 * `expoConfig.version` (set from `APP_VERSION` in `app.config.js`; a dev build is `0.0.0`).
 */
import Constants from 'expo-constants';

import { parseReleaseNotes, releaseDate as formatReleaseDate, type Release } from '@hg/release-notes';

import bundled from '../../release-notes.json';

export { compareVersions, parseReleaseNotes, released, unseen } from '@hg/release-notes';
export type { Release, ReleaseNote } from '@hg/release-notes';

/** The installed app's version. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

let source: () => unknown = () => bundled;

/** The bundled notes; a corrupt file reads as no notes, never an error screen (board `WhatsNew-empty`). */
export function loadReleaseNotes(): Release[] {
  try {
    return parseReleaseNotes(source());
  } catch {
    return [];
  }
}

/** Test seam: replace (or, with `null`, restore) where the notes come from. */
export function setReleaseNotesSource(next: (() => unknown) | null): void {
  source = next ?? (() => bundled);
}

/** "26 September 2026". */
export const releaseDate = (iso: string): string => formatReleaseDate(iso, 'long');
