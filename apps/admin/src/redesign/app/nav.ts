/**
 * The sidebar's contents, as data (manifest §1.1; canonical board `ASS/AdminSidebar`, round 2).
 *
 * Labels are verbatim from the board, with the rail's short label beside each. Visibility per
 * role follows the owner's round-2 decisions: support agents have no rider queue, no menu
 * reviews and no staff page; Profile changes is cut at launch (wholly Needs API, §5) so it is
 * not listed. Counts come only from `admin.queue_depth` (`../realtime/queueDepth`).
 */
import type { AnyIconName, SideNavGroup, SideNavItem } from '../ds';
import type { StaffRole } from '../data/session';
import type { QueueCounts } from '../realtime/queueDepth';

export type NavKey =
  | 'certificates'
  | 'restaurants'
  | 'riders'
  | 'issuingBodies'
  | 'menuReviews'
  | 'orders'
  | 'refunds'
  | 'alerts'
  | 'staff'
  | 'account';

const ALL: readonly StaffRole[] = ['SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN'];
const ADMINS: readonly StaffRole[] = ['ADMIN', 'SUPER_ADMIN'];

interface NavCount {
  readonly count: number;
  readonly countLabel: string;
  readonly countTone: 'neutral' | 'warning';
}

interface NavEntry {
  readonly key: NavKey;
  readonly label: string;
  readonly shortLabel: string;
  readonly path: string;
  readonly icon?: AnyIconName;
  readonly roles: readonly StaffRole[];
  readonly count?: (counts: QueueCounts) => NavCount | null;
}

interface NavGroupDef {
  readonly key: 'review' | 'operate' | 'platform';
  readonly heading: string;
  readonly entries: readonly NavEntry[];
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && n > 0;
}

/**
 * Refunds & disputes carries two counts on the board (failed refunds, warning tint; open
 * disputes, neutral). SideNav draws one chip, so the chip is the failed-refund count when there is
 * one, and the accessible name carries both ("Refunds & disputes, 2 failed refunds, 5 open
 * disputes"). ds-request(web): SideNav item with more than one count.
 */
function refundsCount(c: QueueCounts): NavCount | null {
  const failed = positive(c.failed_refunds) ? c.failed_refunds : 0;
  const disputes = positive(c.open_disputes) ? c.open_disputes : 0;
  if (failed > 0 && disputes > 0) {
    return { count: failed, countLabel: `failed refunds, ${disputes} open disputes`, countTone: 'warning' };
  }
  if (failed > 0) return { count: failed, countLabel: 'failed refunds', countTone: 'warning' };
  if (disputes > 0) return { count: disputes, countLabel: 'open disputes', countTone: 'neutral' };
  return null;
}

export const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    key: 'review',
    heading: 'Review',
    entries: [
      // Needs API: certificate queue depth. No count until then (board note).
      { key: 'certificates', label: 'Halal certificates', shortLabel: 'Certificates', path: '/certificates', roles: ALL },
      {
        key: 'restaurants',
        label: 'Restaurant applications',
        shortLabel: 'Restaurant',
        path: '/restaurants',
        roles: ALL,
        count: (c) => (positive(c.pending_restaurant_reviews) ? { count: c.pending_restaurant_reviews, countLabel: 'waiting', countTone: 'neutral' } : null),
      },
      {
        key: 'riders',
        label: 'Rider applications',
        shortLabel: 'Rider',
        path: '/riders',
        roles: ADMINS,
        count: (c) => (positive(c.pending_rider_reviews) ? { count: c.pending_rider_reviews, countLabel: 'waiting', countTone: 'neutral' } : null),
      },
      { key: 'issuingBodies', label: 'Issuing bodies', shortLabel: 'Bodies', path: '/issuing-bodies', roles: ALL },
      { key: 'menuReviews', label: 'Menu reviews', shortLabel: 'Menus', path: '/menu-reviews', icon: 'orders', roles: ADMINS },
      // Profile changes [Changes] is cut at launch (manifest §1.1, §5): not listed.
    ],
  },
  {
    key: 'operate',
    heading: 'Operate',
    entries: [
      { key: 'orders', label: 'Orders', shortLabel: 'Orders', path: '/orders', icon: 'orders', roles: ALL },
      { key: 'refunds', label: 'Refunds & disputes', shortLabel: 'Refunds', path: '/refunds', roles: ALL, count: refundsCount },
      { key: 'alerts', label: 'Live alerts', shortLabel: 'Alerts', path: '/alerts', icon: 'bell', roles: ALL },
    ],
  },
  {
    key: 'platform',
    heading: 'Platform',
    entries: [
      { key: 'staff', label: 'Staff', shortLabel: 'Staff', path: '/staff', icon: 'profile', roles: ADMINS },
      { key: 'account', label: 'Your account', shortLabel: 'Account', path: '/account', icon: 'profile', roles: ALL },
    ],
  },
];

/** "Signed in as Support agent": the board's role labels (`ASS/AdminSidebar`, `RV/Shell-Forbidden`). */
export const ROLE_LABEL: Record<StaffRole, string> = {
  SUPPORT_AGENT: 'Support agent',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
};

/** Where each role lands after sign-in (manifest §1.2, STF s_invite note). */
export function landingPath(role: StaffRole | null): string {
  return role === 'SUPPORT_AGENT' ? '/alerts' : '/restaurants';
}

/** "restaurant applications" / "live alerts", for "Back to …". */
export function landingLabel(role: StaffRole | null): string {
  return role === 'SUPPORT_AGENT' ? 'live alerts' : 'restaurant applications';
}

/**
 * The SideNav groups for one viewer. `href` builds the link for a path (`#/orders` under the
 * hash router); `counts` is `null` before the first `admin.queue_depth` frame, so no number shows.
 */
export function navGroupsFor(
  role: StaffRole | null,
  current: NavKey | null,
  counts: QueueCounts | null,
  href: (path: string) => string,
): SideNavGroup[] {
  if (!role) return [];
  return NAV_GROUPS.map((group) => {
    const items: SideNavItem[] = group.entries
      .filter((entry) => entry.roles.includes(role))
      .map((entry) => {
        const c = counts && entry.count ? entry.count(counts) : null;
        return {
          key: entry.key,
          label: entry.label,
          shortLabel: entry.shortLabel,
          href: href(entry.path),
          ...(entry.icon ? { icon: entry.icon } : {}),
          ...(c ? { count: c.count, countLabel: c.countLabel, countTone: c.countTone } : {}),
          current: entry.key === current,
        };
      });
    const heading = group.key === 'review' && role === 'SUPPORT_AGENT' ? `${group.heading} · view only` : group.heading;
    return { key: group.key, heading, items };
  }).filter((group) => group.items.length > 0);
}
