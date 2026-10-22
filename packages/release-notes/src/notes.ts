/**
 * The release notes an app ships with, and the rules for which of them a person has not read yet
 * (issues 99, 101 and 102: https://github.com/shaiknoorullah/hg-mono/issues/99,
 * https://github.com/shaiknoorullah/hg-mono/issues/101, https://github.com/shaiknoorullah/hg-mono/issues/102).
 * Shared by the restaurant and admin consoles and the customer app; no React, no storage.
 *
 * The notes are a file bundled with each app, `src/release-notes.json`, written by hand until the
 * versioned-releases work (issue 97, https://github.com/shaiknoorullah/hg-mono/issues/97) generates the
 * same file at release time. Its shape: newest release first.
 *
 *     [{ "version": "1.0.0", "date": "2026-10-22", "notes": [{ "title": "...", "body": "..." }] }]
 *
 * `roles` is an optional extra on a note (the admin console filters by it); a note without it is for
 * everyone. A release with no readable note is dropped by `parseReleaseNotes`.
 */
export interface ReleaseNote {
  readonly title: string;
  readonly body: string;
  /** Only these roles see the note. Absent: every role. */
  readonly roles?: readonly string[];
}

/** One release: its version, its date and the notes written for people who use the app. The file lists them newest first. */
export interface Release {
  readonly version: string;
  /** Calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly notes: readonly ReleaseNote[];
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

/** True for `MAJOR.MINOR.PATCH` with an optional `-label`; a stored last-seen value that fails this counts as none. */
export function isVersion(value: string): boolean {
  return VERSION.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNote(raw: unknown): ReleaseNote | null {
  if (!isRecord(raw) || typeof raw['title'] !== 'string' || typeof raw['body'] !== 'string') return null;
  const roles = Array.isArray(raw['roles']) ? raw['roles'].filter((r): r is string => typeof r === 'string') : undefined;
  return { title: raw['title'], body: raw['body'], ...(roles ? { roles } : {}) };
}

/**
 * Reads the notes file (or the module that wraps it). Anything that is not a list is unreadable and
 * throws (the error state); one malformed release or note is skipped rather than hiding the rest.
 * Newest first.
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

/** Releases up to the build's own version, newest first (a release newer than the build is not shipped in it). */
export function released(releases: readonly Release[], current: string): Release[] {
  return releases.filter((r) => (compareVersions(r.version, current) ?? 1) <= 0);
}

/**
 * Every release newer than `lastSeen`. With nothing stored, or a stored value that is not a version,
 * only the latest release (owner decision, round 2).
 */
export function unseen(releases: readonly Release[], current: string, lastSeen: string | null): Release[] {
  const list = released(releases, current);
  if (lastSeen === null || !VERSION.test(lastSeen)) return list.slice(0, 1);
  return list.filter((r) => (compareVersions(r.version, lastSeen) ?? -1) > 0);
}

/** What to show a device, and why: `first` (nothing seen yet), `since` (newer releases) or `current` (nothing new). */
export type Selection =
  /** No last-seen version on this device: only the newest release. */
  | { readonly mode: 'first'; readonly items: readonly Release[] }
  /** Releases newer than the last-seen version, newest first. */
  | { readonly mode: 'since'; readonly items: readonly Release[] }
  /** Nothing newer than what was seen. */
  | { readonly mode: 'current'; readonly items: readonly [] };

/** Which releases to show a person whose device last saw `lastSeen`, on a build at `current`. */
export function selectReleases(releases: readonly Release[], lastSeen: string | null, current: string): Selection {
  const items = unseen(releases, current, lastSeen);
  if (lastSeen === null || !VERSION.test(lastSeen)) return { mode: 'first', items };
  return items.length > 0 ? { mode: 'since', items } : { mode: 'current', items: [] };
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM-DD` as "28 Sep 2026" or "28 September 2026" (a calendar date, no time zone, no locale). */
export function releaseDate(iso: string, style: 'short' | 'long'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? (style === 'short' ? SHORT : LONG)[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
