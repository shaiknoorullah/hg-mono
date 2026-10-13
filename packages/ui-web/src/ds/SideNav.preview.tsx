/**
 * SideNav specimens. The live design system has no SideNav preview yet (it is owner-approved
 * but not in the live index), so these are drawn after the canvases:
 * `restaurant/live-orders/LiveBoard` (the rail, collapsed and expanded) and
 * `admin/orders/AdminNav` (grouped, with counts and Sign out).
 */

import type { ReactNode } from 'react';

import { Wordmark } from '../primitives/index.js';
import { SideNav, type SideNavGroup } from './index.js';

/** Pairs with components/SideNav/preview.html once the design system publishes one. */
export const component = 'SideNav';

const restaurant: SideNavGroup[] = [
  {
    key: 'main',
    items: [
      { key: 'orders', label: 'Live orders', shortLabel: 'Orders', icon: 'orders', href: '#orders', badge: 3, badgeNoun: 'new' },
      { key: 'history', label: 'History', icon: 'clock', href: '#history' },
      { key: 'menu', label: 'Menu', icon: 'menu', href: '#menu' },
      { key: 'hours', label: 'Hours', icon: 'clock', href: '#hours' },
      { key: 'payouts', label: 'Payouts', icon: 'home', href: '#payouts' },
      { key: 'settings', label: 'Settings', icon: 'profile', href: '#settings' },
    ],
  },
];

const admin: SideNavGroup[] = [
  {
    key: 'review',
    label: 'Review',
    items: [
      { key: 'restaurants', label: 'Restaurant applications', icon: 'home', href: '#r', badge: 4, badgeNoun: 'to review' },
      { key: 'riders', label: 'Rider applications', icon: 'profile', href: '#ri', badge: 2, badgeNoun: 'to review' },
      { key: 'menu', label: 'Menu reviews', icon: 'orders', href: '#m' },
    ],
  },
  {
    key: 'operate',
    label: 'Operate',
    items: [
      { key: 'orders', label: 'Orders', icon: 'orders', href: '#o' },
      { key: 'refunds', label: 'Refunds', icon: 'clock', href: '#f', badge: 2, badgeNoun: 'failed' },
      { key: 'alerts', label: 'Live alerts', icon: 'bell', href: '#a' },
      {
        key: 'staff',
        label: 'Staff',
        icon: 'profile',
        disabled: true,
        disabledReason: 'Only an admin can manage staff',
      },
    ],
  },
];

function Tall({ children }: { children: ReactNode }) {
  return <div style={{ height: 720, display: 'flex' }}>{children}</div>;
}

const brand = (collapsed: boolean) => (
  <span style={{ display: 'inline-flex', ['--hg-text-primary' as string]: 'var(--hg-text-on-accent)' }}>
    <Wordmark height={collapsed ? 20 : 32} />
  </span>
);

/** Restaurant rail, collapsed to icons (80px), Live orders current with 3 new. */
export function RestaurantCollapsed() {
  return (
    <Tall>
      <SideNav groups={restaurant} activeKey="orders" defaultCollapsed brand={brand(true)} label="Main" />
    </Tall>
  );
}

/** Restaurant rail, expanded, with the restaurant's name in the footer. */
export function RestaurantExpanded() {
  return (
    <Tall>
      <SideNav
        groups={restaurant}
        activeKey="orders"
        brand={brand(false)}
        header="Restaurant partner"
        footer={
          <>
            <strong>Zaytoun Grill</strong>
            <br />
            Scarborough, ON
          </>
        }
        onSignOut={() => undefined}
      />
    </Tall>
  );
}

/** Admin: groups, counts in the names, a disabled item with its reason, Sign out on the chrome. */
export function AdminGrouped() {
  return (
    <Tall>
      <SideNav
        groups={admin}
        activeKey="orders"
        label="Admin"
        brand={brand(false)}
        header="Operations · Ontario"
        footer="Signed in as Admin"
        onSignOut={() => undefined}
      />
    </Tall>
  );
}

/** The pre-redesign light (glass) tone, still available through `tone="light"`. */
export function LightTone() {
  return (
    <Tall>
      <SideNav groups={admin} activeKey="refunds" tone="light" label="Admin" />
    </Tall>
  );
}

const adminRail: SideNavGroup[] = [
  {
    key: 'review',
    heading: 'Review',
    items: [
      {
        key: 'restaurants',
        label: 'Restaurant applications',
        shortLabel: 'Restaurant',
        icon: 'home',
        href: '#r',
        count: 4,
        countLabel: 'waiting',
        current: true,
      },
      {
        key: 'certificates',
        label: 'Certificates',
        shortLabel: 'Certificates',
        icon: 'orders',
        href: '#c',
        count: 2,
        countLabel: 'overdue',
        countTone: 'warning',
      },
      { key: 'riders', label: 'Rider applications', shortLabel: 'Riders', icon: 'profile', href: '#ri', count: null },
    ],
  },
];

/** Admin rail (#699): 80px, a label under every item, a warning-tint overdue count, Sign out. */
export function AdminRail() {
  return (
    <Tall>
      <SideNav groups={adminRail} collapsed onCollapsedChange={() => undefined} onSignOut={() => undefined} />
    </Tall>
  );
}
