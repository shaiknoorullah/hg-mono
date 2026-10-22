/**
 * The release notes the app ships with, and the rules for which of them a person has not read
 * yet (restaurant settings boards `WhatsNew-*`; issue 101, https://github.com/shaiknoorullah/hg-mono/issues/101).
 *
 * The notes are a file bundled with the app, `src/release-notes.json`, written by hand until the
 * versioned-releases work (issue 97, https://github.com/shaiknoorullah/hg-mono/issues/97) generates
 * the same file at release time. Its shape is the one below: newest release first.
 *
 *     [{ "version": "1.0.0", "date": "2026-10-22", "notes": [{ "title": "...", "body": "..." }] }]
 *
 * Versions are the app's own: `package.json`'s `version`, which is also the newest release in
 * the file (a unit test keeps the two together until the release tooling writes both).
 */
import { version as PACKAGE_VERSION } from '../../../package.json';

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

/** The version of this build of the app. */
export const APP_VERSION: string = PACKAGE_VERSION;

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
 * Reads the notes file. Anything that is not a list is unreadable and throws (the panel's error
 * state); one malformed release or note is skipped rather than hiding the rest. Newest first.
 */
export function parseReleaseNotes(raw: unknown): Release[] {
  const list = isRecord(raw) && Array.isArray(raw['default']) ? raw['default'] : raw;
  if (!Array.isArray(list)) throw new Error('release notes are not a list');
  const releases: Release[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item['version'] !== 'string' || typeof item['date'] !== 'string' || !Array.isArray(item['notes'])) continue;
    if (!VERSION.test(item['version'])) continue;
    const notes = item['notes'].map(parseNote).filter((n): n is ReleaseNote => n !== null);
    releases.push({ version: item['version'], date: item['date'], notes });
  }
  return releases.sort((a, b) => -(compareVersions(a.version, b.version) ?? 0));
}

export type Selection =
  /** No last-seen version on this device: only the newest release (owner decision, round 2). */
  | { readonly mode: 'first'; readonly items: readonly Release[] }
  /** Releases newer than the last-seen version, newest first. */
  | { readonly mode: 'since'; readonly items: readonly Release[] }
  /** Nothing newer than what was seen. */
  | { readonly mode: 'current'; readonly items: readonly [] };

/** Which releases to show a person whose device last saw `lastSeen`, on a build at `current`. */
export function selectReleases(releases: readonly Release[], lastSeen: string | null, current: string): Selection {
  const eligible = releases.filter((r) => (compareVersions(r.version, current) ?? 1) <= 0);
  if (lastSeen === null || !VERSION.test(lastSeen)) return { mode: 'first', items: eligible.slice(0, 1) };
  const items = eligible.filter((r) => (compareVersions(r.version, lastSeen) ?? -1) > 0);
  return items.length > 0 ? { mode: 'since', items } : { mode: 'current', items: [] };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM-DD` as "22 September 2026" (a calendar date, no time zone, no locale). */
export function releaseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
