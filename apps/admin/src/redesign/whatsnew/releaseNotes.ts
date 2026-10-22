/**
 * The release notes the console ships with, and the rules for which of them a person has not
 * read yet (admin boards `ASS/WhatsNew*`; issue 102, https://github.com/shaiknoorullah/hg-mono/issues/102).
 *
 * The notes are a file bundled with the app, `src/release-notes.json`, written by hand until the
 * versioned-releases work (issue 97, https://github.com/shaiknoorullah/hg-mono/issues/97) generates
 * the same file at release time. Its shape is the one below: newest release first.
 *
 *     [{ "version": "1.0.0", "date": "2026-10-22", "notes": [{ "title": "...", "body": "..." }] }]
 *
 * `roles` is an optional extra on a note, for the role-filtered boards (`WhatsNewAdmin`,
 * `WhatsNewSupport`); a note without it is for every role. Whether the file carries it is the
 * owner's open call (the board says "Needs decision: a roles field per note").
 *
 * Versions are the console's own: `package.json`'s `version`, which is also the newest release in
 * the file (a unit test keeps the two together until the release tooling writes both).
 */
import { version as PACKAGE_VERSION } from '../../../package.json';

import type { StaffRole } from '../data/session';

export interface ReleaseNote {
  readonly title: string;
  readonly body: string;
  /** Only these roles see the note. Absent: every role. */
  readonly roles?: readonly StaffRole[];
}

export interface Release {
  readonly version: string;
  /** Calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly notes: readonly ReleaseNote[];
}

/** The version of this build of the console. */
export const APP_VERSION: string = PACKAGE_VERSION;

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const ROLES: readonly string[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT_AGENT'];

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
  const roles = Array.isArray(raw['roles']) ? raw['roles'].filter((r): r is StaffRole => typeof r === 'string' && ROLES.includes(r)) : undefined;
  return { title: raw['title'], body: raw['body'], ...(roles ? { roles } : {}) };
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

/** The notes a role may read; a release left with no notes for the role is dropped. */
export function releasesForRole(releases: readonly Release[], role: StaffRole | null): Release[] {
  const out: Release[] = [];
  for (const r of releases) {
    const notes = r.notes.filter((n) => !n.roles || (role !== null && n.roles.includes(role)));
    if (notes.length > 0) out.push({ ...r, notes });
  }
  return out;
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` as "28 Sep 2026" (a calendar date, no time zone, no locale). */
export function releaseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}
