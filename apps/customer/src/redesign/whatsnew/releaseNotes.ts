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

import bundled from '../../release-notes.json';

export interface ReleaseNote {
  readonly title: string;
  readonly body: string;
}

export interface Release {
  readonly version: string;
  /** Calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly notes: readonly ReleaseNote[];
}

/** The installed app's version. */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Orders `MAJOR.MINOR.PATCH[-label]`; a pre-release sorts before its release. `null` if either is not a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (x[4] === y[4]) return 0;
  if (x[4] === undefined) return 1;
  if (y[4] === undefined) return -1;
  return x[4] < y[4] ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNote(raw: unknown): ReleaseNote | null {
  if (!isRecord(raw) || typeof raw['title'] !== 'string' || typeof raw['body'] !== 'string') return null;
  return { title: raw['title'], body: raw['body'] };
}

/**
 * Reads the notes file, newest first. Anything that is not a list throws (the board's "corrupt
 * bundle" case, drawn as the empty state); one malformed release or note is skipped rather than
 * hiding the rest, and a release with no readable note is dropped.
 */
export function parseReleaseNotes(raw: unknown): Release[] {
  const list = isRecord(raw) && Array.isArray(raw['default']) ? raw['default'] : raw;
  if (!Array.isArray(list)) throw new Error('release notes are not a list');
  const releases: Release[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item['version'] !== 'string' || typeof item['date'] !== 'string' || !Array.isArray(item['notes'])) continue;
    if (!VERSION.test(item['version'])) continue;
    const notes = item['notes'].map(parseNote).filter((n): n is ReleaseNote => n !== null);
    if (notes.length > 0) releases.push({ version: item['version'], date: item['date'], notes });
  }
  return releases.sort((a, b) => -(compareVersions(a.version, b.version) ?? 0));
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

/** Releases up to the installed version, newest first. */
export function released(releases: readonly Release[], current: string): Release[] {
  return releases.filter((r) => (compareVersions(r.version, current) ?? 1) <= 0);
}

/**
 * What the sheet shows: every release newer than `lastSeen`. With no version stored (a new phone,
 * or a sign-in with none) only the latest release, the owner's decision of 1 October.
 */
export function unseen(releases: readonly Release[], current: string, lastSeen: string | null): Release[] {
  const list = released(releases, current);
  if (lastSeen === null || !VERSION.test(lastSeen)) return list.slice(0, 1);
  return list.filter((r) => (compareVersions(r.version, lastSeen) ?? -1) > 0);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM-DD` as "26 September 2026" (a calendar date: no time zone, no locale). */
export function releaseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
