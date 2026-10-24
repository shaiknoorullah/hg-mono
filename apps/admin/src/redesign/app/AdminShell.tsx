/**
 * The signed-in console's layout route (manifest §1.1, §2.8; boards `ASS/AdminSidebar`,
 * `ASS/SystemBannerStack`, `RV/Shell-Forbidden`, `ORD/AdminNavCollapsed`,
 * `ORD/AdminNavCountsPending`, `STF/SkipLinkFocus`).
 *
 *   [skip link] [SideNav 264px | 72px rail] [ banner slot ]
 *                                           [ main: app bar h1 + page ]
 *
 * - "Skip to main content" is the first tab stop.
 * - The SideNav folds to the rail on detail workspaces and opens again on the way back (unless
 *   the person chose otherwise there). Below 1280 CSS px it starts as the rail (the 1024 boards). At 720 CSS px and below (200% zoom of 1440) it moves into a
 *   NavDrawer behind "Open navigation".
 * - Counts come from `admin.queue_depth` only; no number shows before the first frame.
 * - The system banner slot sits above `<main>`, pushes content down and never covers it.
 * - A route the role may not open shows "No permission" (plain content, not an alert) and focus
 *   moves to the app bar heading. Other route changes move focus to the heading too, unless the
 *   page has already put focus somewhere inside itself.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import { Outlet, useHref, useLocation, useNavigate } from 'react-router-dom';

import { Badge, Banner, Button, Icon, IconButton, NavDrawer, SideNav, SideNavIconSlot, Wordmark } from '../ds';
import { api } from '../data/api';
import { getSession, staffRoleOf, subscribeSession, type StaffRole } from '../data/session';
import { queueCountsNote, queueCountsPhase, useQueueDepth } from '../realtime/queueDepth';
import { useSystemStatusPolling } from '../system/status';
import { useSystemBanners } from '../system/banners';
import { WHATS_NEW } from '../whatsnew/copy';
import { WhatsNewNotice } from '../whatsnew/WhatsNewNotice';
import { WhatsNewPanel } from '../whatsnew/WhatsNewPanel';
import { useWhatsNew, useWhatsNewApi, WhatsNewProvider, WHATS_NEW_PANEL_ID } from '../whatsnew/WhatsNewProvider';
import { FORBIDDEN, NOT_FOUND, STAFF_FORBIDDEN } from './copy';
import { useLanding } from './landing';
import { navGroupsFor, ROLE_LABEL } from './nav';
import { PageBarContext, PageTitleContext, type PageBar } from './pageTitle';
import { canOpen, findAdminRoute } from './routes';
import { finishSignOut } from './signOut';

/**
 * 200% zoom of a 1440px window is exactly 720 CSS px: at or below it the nav moves into a
 * drawer (manifest §2.8).
 */
const NARROW_MAX_PX = 720;
const NARROW_QUERY = `(max-width: ${NARROW_MAX_PX}px)`;

/** The drawer's id, for "Open navigation"'s `aria-controls`. */
const NAV_DRAWER_ID = 'admin-nav-drawer-panel';

/**
 * Below 1280 CSS px the nav starts as the 72px rail (boards `RO/QueueNarrow1024`,
 * `ORD/AdminNavCollapsed`; `RO/QueueNarrow1280` still draws it open), so the page keeps its width
 * and every rail item fits a 1024x768 window without scrolling. The person can still open it.
 */
const COMPACT_QUERY = '(max-width: 1279px)';

function readQuery(query: string, fallbackMaxPx: number | null): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(query).matches;
  return fallbackMaxPx !== null && window.innerWidth <= fallbackMaxPx;
}

function useMediaQuery(query: string, fallbackMaxPx: number | null): boolean {
  const [matches, setMatches] = useState(() => readQuery(query, fallbackMaxPx));
  useEffect(() => {
    const update = () => setMatches(readQuery(query, fallbackMaxPx));
    window.addEventListener('resize', update);
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    mql?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql?.removeEventListener?.('change', update);
    };
  }, [query, fallbackMaxPx]);
  return matches;
}

/** An expanded-nav row on the dark chrome (`ASS/AdminSidebar`'s `.nav-item`): 44px, radius-sm, 15/19.5. */
const NAV_ROW =
  'hg-focus [--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-text-on-accent)] flex min-h-11 w-full items-center gap-2.5 rounded-sm px-3 text-start text-body-md leading-[1.3] text-fg-on-accent no-underline';
/** A rail row (`.rail-item`): 68px wide, at least 48px, the label under the icon at 12/14.4. */
const RAIL_ROW =
  'hg-focus [--hg-focus-ring-offset:var(--hg-surface-chrome)] [--hg-focus-ring-color:var(--hg-text-on-accent)] flex min-h-12 w-[68px] flex-col items-center justify-center gap-0.5 rounded-sm px-0 py-1 text-center text-caption leading-[1.2] text-fg-on-accent no-underline';
const ROW_IDLE = 'font-medium hover:bg-[var(--hg-state-hover-overlay)]';
const ROW_ON = 'bg-fg-on-accent font-bold text-surface-chrome';

/** The sidebar footer: count status, What's new, System status, who is signed in, Sign out. */
function NavFooter({
  collapsed,
  role,
  systemHref,
  systemCurrent,
  onSystem,
  onSignOut,
  signingOut,
  countsNote,
  countsStale,
  onWhatsNew,
}: {
  collapsed: boolean;
  role: StaffRole | null;
  systemHref: string;
  systemCurrent: boolean;
  onSystem: (event: MouseEvent<HTMLAnchorElement>) => void;
  onSignOut: () => void;
  signingOut: boolean;
  countsNote: string | null;
  /** Only a stale count line is drawn: the boards draw nothing while counts are still arriving. */
  countsStale: boolean;
  /** Runs after What's new is pressed (the drawer closes behind it). */
  onWhatsNew?: () => void;
}) {
  const whatsNew = useWhatsNew();
  const roleLabel = role ? ROLE_LABEL[role] : '';
  const row = collapsed ? RAIL_ROW : NAV_ROW;
  return (
    <>
      {countsNote ? (
        countsStale && !collapsed ? (
          <p data-testid="queue-counts-note" className="m-0 px-3 pb-1 text-body-sm leading-[1.4] text-fg-on-accent">
            {countsNote}
          </p>
        ) : (
          // The boards draw nothing while counts are still arriving (`ORD/AdminNavCountsPending`), so the
          // line is the status's accessible name, not drawn text.
          <div role="status" data-testid="queue-counts-note" aria-label={countsNote} />
        )
      ) : null}
      {/* What's new, as `ASS/AdminSidebar` draws it: an inverted tile while its panel is open. */}
      <button
        type="button"
        data-testid="whats-new-trigger"
        aria-expanded={whatsNew.open}
        aria-controls={WHATS_NEW_PANEL_ID}
        aria-label={collapsed ? (whatsNew.hasNew ? `${WHATS_NEW.button}${WHATS_NEW.newHint}` : WHATS_NEW.button) : undefined}
        onClick={(event) => {
          whatsNew.toggle(event.currentTarget);
          onWhatsNew?.();
        }}
        className={`${row} cursor-pointer border-0 ${whatsNew.open ? ROW_ON : `bg-transparent ${ROW_IDLE}`}`}
      >
        <SideNavIconSlot />
        <span aria-hidden={collapsed ? 'true' : undefined} className={collapsed ? 'w-full max-w-[64px] [overflow-wrap:anywhere]' : 'flex-grow'}>
          {WHATS_NEW.button}
        </span>
        {!collapsed && whatsNew.hasNew ? (
          <>
            <Badge variant="brand" appearance="solid" size="sm">
              {WHATS_NEW.newBadge}
            </Badge>
            <span className={countsStale ? 'px-2 pb-1 text-body-sm text-fg-on-accent' : 'sr-only'}>{WHATS_NEW.newHint}</span>
          </>
        ) : null}
      </button>
      <a
        href={systemHref}
        aria-current={systemCurrent ? 'page' : undefined}
        aria-label={collapsed ? 'System status' : undefined}
        onClick={onSystem}
        className={`${row} ${systemCurrent ? ROW_ON : ROW_IDLE}`}
      >
        <SideNavIconSlot />
        <span aria-hidden={collapsed ? 'true' : undefined} className={collapsed ? 'w-full max-w-[64px] [overflow-wrap:anywhere]' : 'flex-grow'}>
          {collapsed ? 'System' : 'System status'}
        </span>
      </a>
      {!collapsed && role ? (
        <p className="m-0 px-3 pt-1.5 text-body-sm leading-normal text-fg-on-accent">
          Signed in as <strong className="font-bold">{roleLabel}</strong>
        </p>
      ) : null}
      {collapsed ? (
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          aria-label={role ? `Sign out, signed in as ${roleLabel}` : undefined}
          className={`${RAIL_ROW} cursor-pointer border-0 bg-transparent ${ROW_IDLE} disabled:opacity-70`}
        >
          <SideNavIconSlot />
          <span aria-hidden={role ? 'true' : undefined} className="w-full max-w-[64px] [overflow-wrap:anywhere]">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </span>
        </button>
      ) : (
        <div className="px-1.5 pt-1">
          <button type="button" onClick={onSignOut} disabled={signingOut} className={`${NAV_ROW} cursor-pointer justify-center border border-current bg-transparent font-semibold disabled:opacity-70`}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * 403 (`RV/Shell-Forbidden`): plain content, not an alert. The shell moves focus to the app bar
 * heading "No permission". Copy verbatim from the board, with the role and the permission filled
 * in; "Back to …" is outlined (tertiary), as the board draws it.
 */
function Forbidden({ role, permission, routeId }: { role: StaffRole | null; permission: string | undefined; routeId: string | undefined }) {
  const back = useLanding();
  if (routeId === 'staff' || routeId === 'staffMember') {
    const roleLabel = (role ? ROLE_LABEL[role] : 'signed-out visitor').toLowerCase();
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-surface-base pb-6 ps-6 pe-6 pt-[52px]">
        <section
          aria-label="Why this page is unavailable"
          className="flex w-full max-w-[640px] flex-col items-start gap-3 rounded-xl border border-line-decorative bg-surface-raised p-8"
        >
          <span className="flex size-8 items-center justify-center text-fg-secondary">
            <Icon name="lock" size={32} />
          </span>
          <h2 className="m-0 text-[20px] leading-[30px] font-semibold tracking-normal text-fg-primary">{STAFF_FORBIDDEN.title}</h2>
          <p className="m-0 text-body-md text-fg-secondary">
            {routeId === 'staff' ? STAFF_FORBIDDEN.list(roleLabel) : STAFF_FORBIDDEN.detail(roleLabel)}
          </p>
          <p className="m-0 text-body-md text-fg-secondary">{routeId === 'staff' ? STAFF_FORBIDDEN.help : STAFF_FORBIDDEN.detailHelp}</p>
          <div className="pt-1">
            <Button variant="primary" size="md" onPress={back.go}>
              {back.goLabel}
            </Button>
          </div>
        </section>
      </div>
    );
  }
  // Drawn as the board draws it: an outlined card, a 32px lock in text.secondary, a 20px title.
  // ds-request(web): ErrorState outside tables (the board's "Proposed component").
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
      <div className="w-full max-w-[552px] rounded-lg border border-line-decorative bg-surface-raised p-4">
        <section aria-label="Why this page is unavailable" className="flex flex-col items-center gap-3 p-4 text-center">
          <Icon name="lock" size="xl" className="text-fg-secondary" />
          <h2 className="m-0 text-heading-lg font-semibold text-fg-primary">{FORBIDDEN.title}</h2>
          <p className="m-0 text-body-md text-fg-secondary">
            {FORBIDDEN.body(role ? ROLE_LABEL[role] : 'Signed out', permission ?? 'this page')}
          </p>
          <Button variant="tertiary" onPress={back.go}>
            {back.label}
          </Button>
        </section>
      </div>
    </div>
  );
}

/** The console's frame, with the What's new state (`../whatsnew`) around it. */
export function AdminShell() {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  return (
    <WhatsNewProvider role={staffRoleOf(session.principal)}>
      <AdminShellFrame />
    </WhatsNewProvider>
  );
}

function AdminShellFrame() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const role = staffRoleOf(session.principal);
  const queue = useQueueDepth();
  useSystemStatusPolling();
  const banners = useSystemBanners(undefined, role);
  const whatsNew = useWhatsNewApi();
  const narrow = useMediaQuery(NARROW_QUERY, NARROW_MAX_PX);
  // At 720 px and below the panel takes the whole content area (boards `WhatsNewZoom200`, `-Reflow320`).
  const panelFullArea = narrow && whatsNew.open;
  // No fallback without matchMedia: an unknown width keeps the nav open.
  const compact = useMediaQuery(COMPACT_QUERY, null);
  const base = useHref('/');
  const href = useCallback((path: string) => `${base.replace(/\/$/, '')}${path}`, [base]);

  const route = findAdminRoute(pathname);
  const forbidden = route !== null && !canOpen(route, role);
  const notFound = route === null && pathname !== '/' && !pathname.startsWith('/applications/');

  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [pageBar, setPageBar] = useState<PageBar | null>(null);
  const staffForbidden = forbidden && (route?.id === 'staff' || route?.id === 'staffMember');
  const pageHeading = forbidden && !staffForbidden ? FORBIDDEN.heading : notFound ? NOT_FOUND.heading : (titleOverride ?? route?.title ?? '');
  const heading = panelFullArea ? WHATS_NEW.panelTitle : pageHeading;

  // The rail on detail workspaces; elsewhere whatever the person last chose on a list page.
  const detail = Boolean(route?.detail) && !forbidden;
  const chrome = route?.bar === 'chrome' && !forbidden && !panelFullArea;
  // `null` until the person chooses on a list page: the window's width decides until then.
  const [preferCollapsed, setPreferCollapsed] = useState<boolean | null>(null);
  const [manual, setManual] = useState<{ path: string; collapsed: boolean } | null>(null);
  // The rail whenever What's new is open, so the page keeps its width beside the panel.
  // Also while a panel is open beside the page (the staff account, the invite form).
  const collapsed =
    whatsNew.open || (manual && manual.path === pathname ? manual.collapsed : detail || Boolean(pageBar?.panel) || (preferCollapsed ?? compact));
  const onCollapsedChange = (next: boolean) => {
    setManual({ path: pathname, collapsed: next });
    if (!detail) setPreferCollapsed(next);
  };

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const appBarRef = useRef<HTMLDivElement | null>(null);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    setTitleOverride(null);
    setPageBar(null);
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    const changed = lastPath.current !== null && lastPath.current !== pathname;
    lastPath.current = pathname;
    if (forbidden) {
      headingRef.current?.focus();
      return;
    }
    if (!changed) return;
    // Focus in the app bar is not the page's: "Open navigation" gets focus back when the drawer
    // closes on a navigation (the drawer's cleanup runs before this effect), and the new page's
    // heading must win over it.
    const active = document.activeElement as HTMLElement | null;
    const pageHasFocus =
      active &&
      active !== document.body &&
      active !== mainRef.current &&
      mainRef.current?.contains(active) &&
      !appBarRef.current?.contains(active);
    if (!pageHasFocus) headingRef.current?.focus();
  }, [pathname, forbidden]);

  const groups = navGroupsFor(role, forbidden || notFound ? null : route?.nav && route.nav !== 'system' ? route.nav : null, queue.counts, href);
  const onNavigate = (target: string) => {
    navigate(target.replace(/^#/, ''));
  };

  const signOut = async () => {
    setSigningOut(true);
    try {
      // A 401 here (already expired on the server) is not a session ending under the page:
      // `data/api.ts` lets it through without raising the dialog.
      await api.POST('/v1/auth/logout');
    } catch {
      // Signing out locally still ends the session in this tab; the server session times out.
    }
    navigate('/', { replace: true });
    finishSignOut();
  };

  const footer = (rail: boolean, afterWhatsNew?: () => void) => (
    <NavFooter
      collapsed={rail}
      role={role}
      systemHref={href('/system')}
      systemCurrent={route?.id === 'system' && !forbidden}
      onSystem={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate('/system');
      }}
      onSignOut={() => void signOut()}
      signingOut={signingOut}
      countsNote={queueCountsNote(queue)}
      countsStale={queueCountsPhase(queue) === 'stale'}
      {...(afterWhatsNew ? { onWhatsNew: afterWhatsNew } : {})}
    />
  );

  const header = (
    <>
      <div className="flex h-9 items-center">
        <Wordmark tone="chrome" height={28} />
      </div>
      <span className="text-body-sm leading-normal text-fg-on-accent">Operations · Ontario</span>
    </>
  );

  return (
    <PageTitleContext.Provider value={setTitleOverride}>
      <PageBarContext.Provider value={setPageBar}>
      <div data-testid="AdminShell" className="relative flex h-screen overflow-hidden bg-surface-base text-fg-primary">
        <a
          href="#main-content"
          onClick={(event) => {
            event.preventDefault();
            mainRef.current?.focus();
          }}
          className="hg-focus sr-only z-50 inline-flex min-h-11 items-center rounded-md bg-surface-raised px-4 text-label-lg font-semibold text-fg-primary focus:not-sr-only focus:absolute focus:start-3 focus:top-3"
        >
          Skip to main content
        </a>

        {!narrow ? (
          <div ref={navRef} className="flex h-full shrink-0">
            <SideNav
              id="admin-nav"
              label="Admin"
              groups={groups}
              collapsed={collapsed}
              railLabels={route?.bar !== 'chrome'}
              onCollapsedChange={onCollapsedChange}
              header={header}
              footer={footer(collapsed)}
              onNavigate={onNavigate}
            />
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          {banners.length > 0 ? (
            <div data-testid="system-banner-slot" className="flex shrink-0 flex-col">
              {banners.map((banner) => (
                <section key={banner.id} aria-label={banner.title}>
                  <Banner
                    tone={banner.tone}
                    title={banner.title}
                    {...(banner.description ? { description: banner.description } : {})}
                    announce={banner.announce}
                    {...(banner.action
                      ? { action: { label: banner.action.label, onPress: () => navigate(banner.action!.to) } }
                      : {})}
                    {...(banner.onDismiss ? { dismissible: true, onDismiss: banner.onDismiss } : {})}
                  />
                </section>
              ))}
            </div>
          ) : null}
          {/* Below the warning banners, above the page (board `ASS/WhatsNewNotice`). */}
          <WhatsNewNotice />

          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            aria-labelledby="app-bar-heading"
            className="flex min-h-0 flex-1 flex-col outline-none"
          >
            <div
              ref={appBarRef}
              className={
                chrome
                  ? 'hg-on-accent flex min-h-14 shrink-0 items-center gap-2 bg-surface-chrome px-4 text-fg-on-accent'
                  : 'flex min-h-14 shrink-0 items-center gap-2 border-b border-transparent bg-surface-raised px-4'
              }
            >
              {panelFullArea ? (
                <Button variant="tertiary" iconStart="back" onPress={whatsNew.close}>
                  {WHATS_NEW.back(pageHeading)}
                </Button>
              ) : narrow ? (
                <Button
                  variant="tertiary"
                  iconStart="menu"
                  aria-expanded={drawerOpen}
                  aria-controls={NAV_DRAWER_ID}
                  aria-haspopup="dialog"
                  onPress={() => setDrawerOpen(true)}
                >
                  Open navigation
                </Button>
              ) : null}
              {pageBar?.back ? (
                <span className="-ms-2 inline-flex shrink-0 text-current [&_button]:text-current">
                  <IconButton icon="back" accessibilityLabel={pageBar.back.label} variant="plain" size="md" onPress={() => navigate(pageBar.back!.to)} />
                </span>
              ) : null}
              <div className="grid min-w-0 flex-1 gap-px">
                <h1
                  ref={headingRef}
                  id="app-bar-heading"
                  tabIndex={-1}
                  className={`m-0 text-heading-md leading-normal outline-none ${chrome ? 'truncate font-semibold text-fg-on-accent' : 'text-fg-primary'}`}
                >
                  {heading}
                </h1>
                {(staffForbidden && route?.id === 'staffMember' ? STAFF_FORBIDDEN.detailSubtitle : pageBar?.subtitle) ? (
                  <p className={`m-0 truncate text-body-sm ${chrome ? 'text-fg-on-accent opacity-85' : 'text-fg-secondary'}`}>
                    {staffForbidden && route?.id === 'staffMember' ? STAFF_FORBIDDEN.detailSubtitle : pageBar?.subtitle}
                  </p>
                ) : null}
              </div>
            </div>
            {/* Kept mounted (typed input survives) but out of the way while the panel has the whole area. */}
            <div className={panelFullArea ? 'hidden' : 'contents'}>
              {forbidden ? <Forbidden role={role} permission={route?.permission} routeId={route?.id} /> : <Outlet />}
            </div>
            {narrow ? <WhatsNewPanel layout="page" /> : null}
          </main>
        </div>
        {narrow ? null : <WhatsNewPanel layout="side" />}

        {narrow ? (
          <NavDrawer id={NAV_DRAWER_ID} open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <SideNav
              id="admin-nav-drawer"
              label="Admin"
              groups={groups}
              collapsed={false}
              header={header}
              footer={footer(false, () => setDrawerOpen(false))}
              onNavigate={(target) => {
                setDrawerOpen(false);
                onNavigate(target);
              }}
            />
          </NavDrawer>
        ) : null}
      </div>
      </PageBarContext.Provider>
    </PageTitleContext.Provider>
  );
}
