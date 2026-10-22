/**
 * The signed-in console frame (manifest §1.3, LO `LiveBoard`; spec specs/wp1-shell.md):
 *
 *   [skip links]
 *   SideNav rail | AppBar (page title · restaurant · account menu)
 *                | Status bar  (region "Service status": WP4)
 *                | Banners + inline confirm
 *                | NewOrderStrip (#new-orders: WP3)
 *                | panes: page body | shell panel (?panel=…)
 *
 * The page never scrolls (root = viewport height, overflow hidden); only panes scroll.
 * Below 768 px (the phone board) there is no rail: the app bar carries an "Open navigation"
 * button that opens the same links in a drawer, and a panel opens full screen in place of the
 * page. The rail is icons on tablet and whenever a panel is open; on desktop it remembers the
 * viewer's choice (localStorage, fails soft).
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, IconButton, Menu, NavDrawer, AppBar, SideNav, type SideNavItem } from '../ds';
import { useConsole } from '../data/console';
import { NAV, activeNavKey } from './nav';
import { BannerSlot, SHELL_PANELS, StatusBarSlot, StripSlot } from './slots';
import { ConsoleLayoutContext } from './layout';
import { SignOutConfirm } from './SignOutConfirm';
import { useWaitingCount } from './waiting';
import { useIsDesktop, useIsPhone } from './viewport';

const RAIL_KEY = 'hg_restaurant_rail_expanded_v1';

function readRailPref(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function writeRailPref(expanded: boolean) {
  try {
    localStorage.setItem(RAIL_KEY, expanded ? '1' : '0');
  } catch {
    /* private window: the choice lasts this session only */
  }
}


export interface ConsoleLayoutProps {
  onSignOut: () => Promise<void>;
}

export function ConsoleLayout({ onSignOut }: ConsoleLayoutProps) {
  const { profile } = useConsole();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const isDesktop = useIsDesktop();
  const isPhone = useIsPhone();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railPref, setRailPref] = useState(readRailPref);
  const [pagePanelOpen, setPagePanelOpen] = useState(false);
  const [confirm, setConfirm] = useState<ReactNode | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const waiting = useWaitingCount();

  const panelKey = params.get('panel');
  const shellPanel = panelKey ? SHELL_PANELS[panelKey] : undefined;
  const anyPanelOpen = pagePanelOpen || Boolean(shellPanel);
  const expanded = isDesktop && !anyPanelOpen && railPref;

  // A drawer left open must not outlive a resize past 768 px.
  useEffect(() => {
    if (!isPhone) setDrawerOpen(false);
  }, [isPhone]);

  const active = activeNavKey(location.pathname);
  const pageTitle = NAV.find((n) => n.key === active)?.label ?? 'Live orders';

  const p = profile.data;
  const city = p?.address?.city;
  const subtitle = p ? [p.display_name, city].filter(Boolean).join(' · ') : undefined;
  const ownerName = p ? [p.owner_first_name, p.owner_last_name].filter(Boolean).join(' ') : '';

  const closeShellPanel = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete('panel');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const buildItems = (labelsShown: boolean): SideNavItem[] => NAV.map((n) => ({
    key: n.key,
    label: n.label,
    href: n.to,
    // No Solar glyph yet for History, Payouts, Settings (#198): the collapsed rail shows the
    // item's name in the icon's place, never a blank tile (wp1 spec §3).
    icon: n.icon ? (
      <Icon name={n.icon} weight={n.key === active ? 'bold' : 'linear'} size={22} />
    ) : labelsShown ? undefined : (
      <span aria-hidden="true" className="text-[11px] font-semibold leading-none">
        {n.label}
      </span>
    ),
    badge: n.key === 'orders' && waiting > 0 ? waiting : undefined,
    badgeNoun: n.key === 'orders' ? 'new' : undefined,
  }));
  const items = buildItems(expanded);

  // Rail items are real links (middle-click, copy link), but a plain click stays in
  // the app: a full page load would drop the go-live gesture and stop the order
  // sound (WP3), and re-read everything.
  const keepInApp = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a[href]');
    const href = a?.getAttribute('href');
    if (!a || !href?.startsWith('/') || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setDrawerOpen(false);
    navigate(href);
  };

  const layoutApi = useMemo(() => ({ setPagePanelOpen, setConfirm }), []);

  const startSignOut = () =>
    setConfirm(
      <SignOutConfirm
        onStay={() => setConfirm(null)}
        onSignOut={async () => {
          setSigningOut(true);
          await onSignOut();
        }}
      />,
    );

  const accountItems = [
    ...(ownerName
      ? [{ key: 'who', label: `${ownerName} · Owner`, disabled: true, disabledReason: 'You are signed in as this person' }]
      : []),
    { key: 'settings', label: 'Settings', onSelect: () => navigate('/settings'), separatorBefore: Boolean(ownerName) },
    { key: 'whats-new', label: "What's new", onSelect: () => navigate(`${location.pathname}?panel=whats-new`) },
    { key: 'sign-out', label: 'Sign out…', onSelect: startSignOut, separatorBefore: true },
  ];

  return (
    <ConsoleLayoutContext.Provider value={layoutApi}>
      <div data-testid="console-shell" data-signing-out={signingOut || undefined} className="flex h-dvh overflow-hidden bg-surface-sunken text-fg-primary">
        <div className="sr-only focus-within:not-sr-only focus-within:fixed focus-within:left-3 focus-within:top-2.5 focus-within:z-[900] focus-within:flex focus-within:gap-2">
          <a href="#new-orders" className="hg-focus inline-flex min-h-11 items-center rounded-md bg-surface-raised px-4 text-[15px] font-semibold text-fg-primary shadow-md">
            Skip to new orders
          </a>
          <a href="#main" className="hg-focus inline-flex min-h-11 items-center rounded-md bg-surface-raised px-4 text-[15px] font-semibold text-fg-primary shadow-md">
            Skip to main content
          </a>
        </div>

        {isPhone ? null : (
          <div className="flex shrink-0" onClick={keepInApp}>
            <SideNav
              groups={[{ key: 'main', items }]}
              activeKey={active}
              collapsed={!expanded}
              expandedWidth={232}
              collapseLabel="Collapse navigation"
              expandLabel="Expand navigation"
              onToggleCollapsed={
                isDesktop && !anyPanelOpen
                  ? (collapsed) => {
                      setRailPref(!collapsed);
                      writeRailPref(!collapsed);
                    }
                  : undefined
              }
              testId="console-rail"
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header role="banner">
            <AppBar
              tone="chrome"
              role="none"
              testId="top-bar"
              title={pageTitle}
              subtitle={subtitle}
              titleIsPageHeading={false}
              actions={
                <>
                <Menu
                  label="Account"
                  triggerLabel={ownerName ? `Account: ${ownerName}, owner` : 'Account'}
                  trigger={<Icon name="profile" size={22} />}
                  variant="plain"
                  align="end"
                  items={accountItems}
                  testId="account-menu"
                />
                {isPhone ? (
                  <IconButton
                    icon={<Icon name="menu" size={22} />}
                    accessibilityLabel={waiting > 0 ? `Open navigation, ${waiting} new ${waiting === 1 ? 'order' : 'orders'}` : 'Open navigation'}
                    variant="plain"
                    onPress={() => setDrawerOpen(true)}
                    data-testid="open-navigation"
                  />
                ) : null}
                </>
              }
            />
          </header>

          <div role="region" aria-label="Service status" className="border-b border-line-decorative bg-surface-raised">
            <StatusBarSlot />
          </div>

          <BannerSlot />

          {confirm ? <div className="mx-4 mt-2.5">{confirm}</div> : null}

          <div id="new-orders" tabIndex={-1} className="outline-none">
            <StripSlot />
          </div>

          <div className="flex min-h-0 flex-1 gap-3 px-4 py-3">
            <main id="main" tabIndex={-1} className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none${shellPanel ? ' max-md:hidden' : ''}`}>
              <Outlet />
            </main>
            {shellPanel ? <shellPanel.Component onClose={closeShellPanel} params={params} /> : null}
          </div>
        </div>
        {isPhone ? (
          <NavDrawer id="console-nav-drawer" tone="light" hideTrigger open={drawerOpen} onClose={() => setDrawerOpen(false)} testId="console-nav-drawer">
            <div className="flex min-h-0 flex-1" onClick={keepInApp}>
              <SideNav tone="light" groups={[{ key: 'main', items: buildItems(true) }]} activeKey={active} collapsed={false} testId="console-drawer-nav" />
            </div>
          </NavDrawer>
        ) : null}
      </div>
    </ConsoleLayoutContext.Provider>
  );
}
