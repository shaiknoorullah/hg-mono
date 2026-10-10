/**
 * AppShell composition examples (specimens only; AppShell is not a component of its own).
 * How the W2 parts compose into the two desktop shells the canvases draw:
 *
 * - Restaurant console (`restaurant/live-orders/LiveBoard`): SkipLink, the chrome SideNav
 *   rail, then a column of the chrome AppBar (role none, inside main), the system banner
 *   slot, the new-orders strip, and SplitPanes holding the board and a DetailPanel.
 * - Admin (`admin/orders/OrderDetail`): SkipLink, the grouped SideNav, the system banner
 *   slot, a raised AppBar, and SplitPanes holding the list pane and a DetailPanel.
 */

import type { ReactNode } from 'react';

import { AppBar, Button, DetailPanel, IconButton, SideNav, SplitPanes } from '../ds/index.js';
import { Banner, SkipLink, SystemBannerSlot } from './index.js';

/** Not a design-system component: the shell is composed on the page from these parts. */
export const component = 'AppShell';

function List({ title }: { title: string }) {
  return (
    <section aria-label={title} style={{ height: '100%', background: 'var(--hg-surface-raised)', padding: 16, boxSizing: 'border-box' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--hg-text-heading-sm-size)' }}>{title}</h2>
      {['B3M9 · Preparing', 'A7K2 · Ready', 'C1Q4 · Waiting for rider'].map((row) => (
        <p key={row} style={{ margin: '12px 0 0' }}>
          {row}
        </p>
      ))}
    </section>
  );
}

function Shell({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 1400, height: 720, display: 'flex', overflow: 'hidden', background: 'var(--hg-surface-base)' }}>
      {nav}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

/** The restaurant console: rail, chrome bar, a reconnecting banner, board and order panel. */
export function RestaurantConsole() {
  return (
    <Shell
      nav={
        <>
          <SkipLink targetId="w2-console-main" label="Skip to new orders" />
          <SideNav
            defaultCollapsed
            activeKey="orders"
            groups={[
              {
                key: 'main',
                items: [
                  { key: 'orders', label: 'Live orders', shortLabel: 'Orders', icon: 'orders', href: '#o', badge: 3, badgeNoun: 'new' },
                  { key: 'history', label: 'History', icon: 'clock', href: '#h' },
                  { key: 'menu', label: 'Menu', icon: 'menu', href: '#m' },
                  { key: 'settings', label: 'Settings', icon: 'profile', href: '#s' },
                ],
              },
            ]}
          />
        </>
      }
    >
      <main id="w2-console-main" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          tone="chrome"
          role="none"
          title="Live orders"
          subtitle="Zaytoun Grill · Scarborough"
          actions={<IconButton icon="profile" accessibilityLabel="Account: Karim Haddad, owner" />}
        />
        <SystemBannerSlot
          banners={[
            {
              id: 'reconnecting',
              severity: 'warning',
              node: <Banner variant="warning" title="Reconnecting…" description="New orders will show as soon as the connection is back." />,
            },
          ]}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <SplitPanes
            panes={[
              { id: 'board', label: 'Orders in progress', defaultSize: 55, content: <List title="Orders in progress" /> },
              {
                id: 'order',
                label: 'Order',
                content: (
                  <DetailPanel
                    title="Order B3M9"
                    subtitle="Preparing"
                    onClose={() => undefined}
                    focusOnOpen={false}
                    footer={<Button variant="primary">Mark ready</Button>}
                  >
                    <p style={{ margin: 0 }}>Chicken shawarma plate × 2</p>
                  </DetailPanel>
                ),
              },
            ]}
          />
        </div>
      </main>
    </Shell>
  );
}

/** Admin: grouped nav, a raised bar, list pane and detail panel with its action bar. */
export function Admin() {
  return (
    <Shell
      nav={
        <>
          <SkipLink targetId="w2-admin-main" />
          <SideNav
            label="Admin"
            activeKey="orders"
            header="Operations · Ontario"
            footer="Signed in as Admin"
            onSignOut={() => undefined}
            groups={[
              {
                key: 'operate',
                label: 'Operate',
                items: [
                  { key: 'orders', label: 'Orders', icon: 'orders', href: '#o' },
                  { key: 'refunds', label: 'Refunds', icon: 'clock', href: '#r', badge: 2, badgeNoun: 'failed' },
                  { key: 'alerts', label: 'Live alerts', icon: 'bell', href: '#a' },
                ],
              },
            ]}
          />
        </>
      }
    >
      <main id="w2-admin-main" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar tone="raised" role="none" sticky elevated title="Orders" subtitle="Today, Ontario" />
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <SplitPanes
            panes={[
              { id: 'list', label: 'Orders', defaultSize: 32, foldable: true, content: <List title="Orders" /> },
              {
                id: 'detail',
                label: 'Order',
                content: (
                  <DetailPanel
                    title="Order B3M9"
                    onClose={() => undefined}
                    focusOnOpen={false}
                    footer={<Button variant="tertiary">Open a refund</Button>}
                  >
                    <p style={{ margin: 0 }}>Delivered 7:12 pm.</p>
                  </DetailPanel>
                ),
              },
            ]}
          />
        </div>
      </main>
    </Shell>
  );
}
