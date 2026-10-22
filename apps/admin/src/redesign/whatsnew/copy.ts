/** The What's new copy, as data. Verbatim from the boards `ASS/WhatsNew*` where they draw it. */
import type { StaffRole } from '../data/session';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const WHATS_NEW = {
  button: 'What’s new',
  /** The sidebar button's extra words for a screen reader while the New label shows. */
  newHint: ', updates since you last looked',
  panelTitle: 'What’s new',
  close: 'Close',
  done: 'Done',
  newBadge: 'New',
  noticeRegion: 'Console update',
  seeWhatsNew: 'See what’s new',
  seeWhatsNewLabel: 'See what’s new, opens a panel beside the page',
  notNow: 'Not now',
  /** A device with no last-seen version: the current version only, with no count (owner decision, round 2). */
  noticeFirst: (version: string) => `The admin console is on version ${version}.`,
  noticeSince: (version: string) => `The admin console was updated to console version ${version}.`,
  noticeCount: (n: number) => `${n} ${plural(n, 'version', 'versions')} since you last looked.`,
  loading: 'Loading notes…',
  offline: 'You’re offline, but these notes come with the app, so they still show.',
  looked: (version: string) => `You last looked on console version ${version}.`,
  firstIntro: 'Here’s what changed in the latest update.',
  changedSince: 'Here’s what changed since, newest first.',
  changesFor: (role: StaffRole) => `Showing changes for ${role === 'ADMIN' ? 'admins' : 'support agents'}, newest first.`,
  upToDate: 'You’re up to date',
  upToDateBody: (version: string) => `You’re on console version ${version}. Earlier updates are below.`,
  version: 'Console version',
  released: (date: string) => `Released ${date}`,
  empty: {
    title: 'No release notes yet',
    body: (version: string) => `You’re on console version ${version}. Notes appear here after the next update.`,
  },
  error: {
    title: 'The release notes couldn’t be read',
    body: (version: string) =>
      `Everything else in the console works as normal. You’re on console version ${version}. We’ll show the notes the next time they load.`,
    retry: 'Try again',
  },
  /** Narrow windows: the panel takes the content area; this goes back to the page. */
  back: (page: string) => `Back to ${page}`,
} as const;
